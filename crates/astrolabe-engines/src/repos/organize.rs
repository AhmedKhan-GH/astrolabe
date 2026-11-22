//! The user's tags and folders, stored in `organize.toml`: the file format,
//! repository keys, editing, and which repositories a folder holds.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::model::{Repo, tag_slug};
use super::tags::is_automatic;
use super::{paths, remote};

/// The text at the top of every saved file.
const HEADER: &str = "# Tags and folders for Astrolabe. Repositories are named by their remote
# (host/owner/name), or by their path when they have none. Edit freely; the
# app rereads this file when it changes.

";

/// The name given to a new folder whose name is blank.
const DEFAULT_FOLDER_NAME: &str = "New folder";

/// The user's tags and folders.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Organize {
    /// Manual tags by repository key. Tags are `tag_slug`s, unique, in the order added.
    pub tags: BTreeMap<String, Vec<String>>,
    /// Manual tags no repository carries now. They are kept so they can be
    /// given to repositories later, and never overlap the tags in use.
    pub unused_tags: BTreeSet<String>,
    /// The top-level folders, in display order.
    pub folders: Vec<Folder>,
}

/// A folder of repositories, which may hold subfolders.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Folder {
    pub name: String,
    /// A query in the filter language; empty for none. With a query this is a smart folder.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub query: String,
    /// Pinned repositories, by key.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repos: Vec<String>,
    /// Repositories left out although the query or a subfolder brings them in, by key.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<String>,
    /// Subfolders, in display order.
    #[serde(default, rename = "folder", skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<Folder>,
}

impl Folder {
    /// A folder with a name and nothing in it.
    pub fn named(name: &str) -> Folder {
        Folder { name: name.to_owned(), ..Folder::default() }
    }

    /// Whether the folder has a query.
    pub fn is_smart(&self) -> bool {
        !self.query.trim().is_empty()
    }
}

/// The file as it is written: `unused_tags`, `[tags]` and `[[folder]]`.
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    unused_tags: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    tags: BTreeMap<String, Vec<String>>,
    #[serde(default, rename = "folder", skip_serializing_if = "Vec::is_empty")]
    folders: Vec<Folder>,
}

// ---------------------------------------------------------------------------
// The file

/// Slugged tags with the empty ones and the duplicates removed, in order.
fn clean_tags<'a>(tags: impl IntoIterator<Item = &'a String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let slug = tag_slug(tag);
        if !slug.is_empty() && !out.contains(&slug) {
            out.push(slug);
        }
    }
    out
}

/// Trim a list of keys and drop the empty ones and the duplicates.
fn clean_keys(keys: &mut Vec<String>) {
    let mut out: Vec<String> = Vec::new();
    for key in keys.iter().map(|k| k.trim()).filter(|k| !k.is_empty()) {
        if !out.iter().any(|o| o == key) {
            out.push(key.to_owned());
        }
    }
    *keys = out;
}

/// Trim the names and keys of a folder and its subfolders. A blank name is an error.
fn normalise_folder(folder: &mut Folder, trail: &str) -> Result<(), String> {
    folder.name = folder.name.trim().to_owned();
    if folder.name.is_empty() {
        let place = if trail.is_empty() { "at the top level".to_owned() } else { format!("inside \"{trail}\"") };
        return Err(format!("a folder {place} has an empty name"));
    }
    folder.query = folder.query.trim().to_owned();
    clean_keys(&mut folder.repos);
    clean_keys(&mut folder.exclude);
    let here = if trail.is_empty() { folder.name.clone() } else { format!("{trail}/{}", folder.name) };
    folder.folders.iter_mut().try_for_each(|f| normalise_folder(f, &here))
}

/// Parse the file. Tags are slugged, emptied ones dropped and duplicates removed
/// (the first kept); a key whose list ends up empty is dropped; unused tags are
/// cleaned the same way and lose any that a repository carries; keys and folder
/// names are trimmed. A folder with an empty name is an error. Errors name the
/// line where the text has one.
pub fn parse(text: &str) -> Result<Organize, String> {
    let raw: Raw = toml::from_str(text).map_err(|e| e.to_string())?;
    let mut tags: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (key, list) in &raw.tags {
        let key = key.trim();
        if !key.is_empty() {
            tags.entry(key.to_owned()).or_default().extend(list.iter().cloned());
        }
    }
    let tags =
        tags.into_iter().map(|(key, list)| (key, clean_tags(&list))).filter(|(_, list)| !list.is_empty()).collect();
    let mut folders = raw.folders;
    folders.iter_mut().try_for_each(|f| normalise_folder(f, ""))?;
    let mut organize = Organize { tags, unused_tags: clean_tags(&raw.unused_tags).into_iter().collect(), folders };
    organize.drop_used_from_unused();
    Ok(organize)
}

/// Read the file. A missing file is an empty `Organize` and no error; the file
/// is only created by the first save. A file that cannot be read or parsed gives
/// an empty `Organize` and the reason, prefixed by the path.
pub fn load(path: &Path) -> (Organize, Option<String>) {
    match std::fs::read_to_string(path) {
        Ok(text) => match parse(&text) {
            Ok(organize) => (organize, None),
            Err(e) => (Organize::default(), Some(format!("{}: {e}", path.display()))),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Organize::default(), None),
        Err(e) => (Organize::default(), Some(format!("{}: {e}", path.display()))),
    }
}

/// Write the file atomically: create the folder, write `<path>.tmp`, then
/// rename it over `path`.
pub fn save(path: &Path, organize: &Organize) -> Result<(), String> {
    let fail = |e: std::io::Error| format!("{}: could not save the tags and folders: {e}", path.display());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(fail)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    std::fs::write(&tmp, organize.to_toml()).map_err(fail)?;
    std::fs::rename(&tmp, path).map_err(fail)
}

// ---------------------------------------------------------------------------
// Repository keys

/// The keys a repository goes by, most specific first. Writes use the first;
/// reads accept any.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepoKeys(pub Vec<String>);

impl RepoKeys {
    /// The key that writes use.
    pub fn first(&self) -> Option<&str> {
        self.0.first().map(String::as_str)
    }

    fn has(&self, key: &str) -> bool {
        self.0.iter().any(|k| k == key)
    }
}

/// The keys of one repository. `remote` is the main remote as `remote::copy_key`
/// gives it, or None; `shared` is whether another repository has the same
/// remote; `name` is the folder name; `path` is the path with `~`.
pub fn keys(remote: Option<&str>, shared: bool, name: &str, path: &str) -> RepoKeys {
    let path = path.to_owned();
    RepoKeys(match remote {
        None => vec![path],
        Some(r) if shared => vec![format!("{r}#{name}"), path, r.to_owned()],
        Some(r) => vec![r.to_owned(), format!("{r}#{name}"), path],
    })
}

/// The keys of every repository, in order. A repository not read yet, or with a
/// remote that does not parse, has no remote; a remote is shared when two or
/// more of `repos` have it.
pub fn keys_of(repos: &[Repo]) -> Vec<RepoKeys> {
    let remotes: Vec<Option<String>> = repos
        .iter()
        .map(|r| {
            let url = remote::parse_url(&r.stats()?.main_remote()?.url)?;
            Some(remote::copy_key(&url))
        })
        .collect();
    let mut count: BTreeMap<&str, usize> = BTreeMap::new();
    for key in remotes.iter().flatten() {
        *count.entry(key).or_default() += 1;
    }
    repos
        .iter()
        .zip(&remotes)
        .map(|(repo, remote)| {
            let shared = remote.as_deref().is_some_and(|k| count[k] > 1);
            keys(remote.as_deref(), shared, &repo.name, &paths::tilde(repo.id()))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Tags

impl Organize {
    /// The file's text: the header comment, then the TOML.
    pub fn to_toml(&self) -> String {
        let raw = Raw {
            unused_tags: self.unused_tags.iter().cloned().collect(),
            tags: self.tags.clone(),
            folders: self.folders.clone(),
        };
        match toml::to_string(&raw) {
            Ok(body) => format!("{HEADER}{body}"),
            Err(e) => unreachable!("tags and folders always serialise: {e}"),
        }
    }

    /// The manual tags of a repository: the entry under the first of its keys
    /// that has one; empty if none.
    pub fn tags_of(&self, keys: &RepoKeys) -> &[String] {
        keys.0.iter().find_map(|k| self.tags.get(k).filter(|t| !t.is_empty())).map_or(&[], Vec::as_slice)
    }

    /// Replace a repository's tags (slugged, deduplicated, empties dropped).
    /// They are stored under its first key and entries under its other keys are
    /// removed. An empty list removes the entry. A tag the repository was the
    /// last to carry becomes unused; a tag it now carries stops being unused.
    pub fn set_tags(&mut self, keys: &RepoKeys, tags: &[String]) {
        let before = self.tags_in_use();
        for key in &keys.0 {
            self.tags.remove(key);
        }
        let tags = clean_tags(tags);
        if let (Some(first), false) = (keys.first(), tags.is_empty()) {
            self.tags.insert(first.to_owned(), tags);
        }
        self.settle_unused(&before);
    }

    /// Add one tag (slugged). Returns false when it is empty or already there.
    pub fn add_tag(&mut self, keys: &RepoKeys, tag: &str) -> bool {
        let tag = tag_slug(tag);
        let mut tags = self.tags_of(keys).to_vec();
        if tag.is_empty() || tags.contains(&tag) {
            return false;
        }
        tags.push(tag);
        self.set_tags(keys, &tags);
        true
    }

    /// Remove one tag (slugged) from a repository. If no other repository
    /// carries it, it becomes unused.
    pub fn remove_tag(&mut self, keys: &RepoKeys, tag: &str) {
        let tag = tag_slug(tag);
        let tags: Vec<String> = self.tags_of(keys).iter().filter(|t| **t != tag).cloned().collect();
        self.set_tags(keys, &tags);
    }

    /// The manual tags some repository carries, sorted.
    fn tags_in_use(&self) -> BTreeSet<String> {
        self.tags.values().flatten().cloned().collect()
    }

    /// Take the tags in use out of `unused_tags`.
    fn drop_used_from_unused(&mut self) {
        let used = self.tags_in_use();
        self.unused_tags.retain(|t| !used.contains(t));
    }

    /// After an edit: the tags that were in use `before` and no longer are
    /// become unused, and the tags now in use stop being unused.
    fn settle_unused(&mut self, before: &BTreeSet<String>) {
        let after = self.tags_in_use();
        self.unused_tags.extend(before.difference(&after).cloned());
        self.drop_used_from_unused();
    }

    /// Every manual tag, in use or not, sorted.
    pub fn all_tags(&self) -> BTreeSet<String> {
        let mut all = self.tags_in_use();
        all.extend(self.unused_tags.iter().cloned());
        all
    }

    /// Make a tag that no repository carries yet. Returns its slug, or None
    /// when it is empty, automatic, or already exists.
    pub fn create_tag(&mut self, tag: &str) -> Option<String> {
        let tag = tag_slug(tag);
        if tag.is_empty() || is_automatic(&tag) || self.all_tags().contains(&tag) {
            return None;
        }
        self.unused_tags.insert(tag.clone());
        Some(tag)
    }

    /// Rename a tag everywhere, unused ones included; where a list already has
    /// the new name, the old one is just removed. Both are slugged; an empty or
    /// automatic new name does nothing.
    pub fn rename_tag(&mut self, from: &str, to: &str) {
        let (from, to) = (tag_slug(from), tag_slug(to));
        if to.is_empty() || from == to || is_automatic(&to) {
            return;
        }
        for list in self.tags.values_mut() {
            let Some(at) = list.iter().position(|t| *t == from) else { continue };
            if list.contains(&to) {
                list.remove(at);
            } else {
                list[at] = to.clone();
            }
        }
        if self.unused_tags.remove(&from) {
            self.unused_tags.insert(to);
        }
        self.drop_used_from_unused();
    }

    /// Remove a tag (slugged) from every repository and from the unused tags.
    pub fn delete_tag(&mut self, tag: &str) {
        let tag = tag_slug(tag);
        for list in self.tags.values_mut() {
            list.retain(|t| *t != tag);
        }
        self.tags.retain(|_, list| !list.is_empty());
        self.unused_tags.remove(&tag);
    }
}

// ---------------------------------------------------------------------------
// Folders
//
// Folders are addressed by index path from the top: `[2, 0]` is the first
// subfolder of the third top-level folder; `[]` is the top level itself, as a
// parent.

/// A name no sibling has: `name`, else `name 2`, `name 3`, and so on.
fn unique_name(siblings: &[Folder], name: &str) -> String {
    let name = name.trim();
    let name = if name.is_empty() { DEFAULT_FOLDER_NAME } else { name };
    let taken = |n: &str| siblings.iter().any(|f| f.name == n);
    if !taken(name) {
        return name.to_owned();
    }
    (2..).map(|i| format!("{name} {i}")).find(|n| !taken(n)).unwrap_or_default()
}

impl Organize {
    fn siblings_mut(&mut self, parent: &[usize]) -> Option<&mut Vec<Folder>> {
        if parent.is_empty() { Some(&mut self.folders) } else { self.folder_mut(parent).map(|f| &mut f.folders) }
    }

    /// The folder at this path.
    pub fn folder(&self, at: &[usize]) -> Option<&Folder> {
        let (first, rest) = at.split_first()?;
        rest.iter().try_fold(self.folders.get(*first)?, |f, i| f.folders.get(*i))
    }

    pub fn folder_mut(&mut self, at: &[usize]) -> Option<&mut Folder> {
        let (first, rest) = at.split_first()?;
        rest.iter().try_fold(self.folders.get_mut(*first)?, |f, i| f.folders.get_mut(*i))
    }

    /// Add `folder` at the end of the parent's subfolders (`[]` for the top
    /// level). If a sibling already has its name, " 2", " 3", and so on is
    /// appended until it is unique. Returns its path, or None when the parent
    /// does not exist.
    pub fn add_folder(&mut self, parent: &[usize], mut folder: Folder) -> Option<Vec<usize>> {
        let siblings = self.siblings_mut(parent)?;
        folder.name = unique_name(siblings, &folder.name);
        siblings.push(folder);
        let mut path = parent.to_vec();
        path.push(siblings.len() - 1);
        Some(path)
    }

    /// Remove a folder with everything in it.
    pub fn remove_folder(&mut self, at: &[usize]) -> Option<Folder> {
        let (last, parent) = at.split_last()?;
        let siblings = self.siblings_mut(parent)?;
        (*last < siblings.len()).then(|| siblings.remove(*last))
    }

    /// Rename (trimmed). Refuses an empty name or one a sibling has; returns
    /// whether the name changed.
    pub fn rename_folder(&mut self, at: &[usize], name: &str) -> bool {
        let name = name.trim();
        let Some((last, parent)) = at.split_last() else { return false };
        let Some(siblings) = self.siblings_mut(parent) else { return false };
        let free = !name.is_empty() && !siblings.iter().enumerate().any(|(i, f)| i != *last && f.name == name);
        match siblings.get_mut(*last) {
            Some(f) if free && f.name != name => {
                f.name = name.to_owned();
                true
            }
            _ => false,
        }
    }

    /// Move a folder to the end of another parent's subfolders, renaming it as
    /// `add_folder` does if needed. Refuses moving a folder into itself or one
    /// of its descendants. Returns the new path.
    pub fn move_folder(&mut self, from: &[usize], to_parent: &[usize]) -> Option<Vec<usize>> {
        self.place_folder(from, to_parent, usize::MAX)
    }

    /// Move a folder so it becomes the subfolder at `index` of `parent` (`[]` for the top level), where `index`
    /// counts the parent's subfolders as they are before the move: the folder lands just before the one now at
    /// `index`, and `index` at or past the end puts it last. Refuses moving a folder into itself or one of its
    /// descendants. Moving to another parent renames it as `add_folder` does when a sibling has its name; moving
    /// within the same parent keeps the name. Returns the new path.
    pub fn place_folder(&mut self, from: &[usize], parent: &[usize], index: usize) -> Option<Vec<usize>> {
        self.folder(from)?;
        if !parent.is_empty() {
            self.folder(parent)?;
        }
        if parent.starts_with(from) {
            return None;
        }
        let (last, old_parent) = from.split_last()?;
        let mut index = index;
        if old_parent == parent && index > *last {
            index -= 1;
        }
        let mut parent = parent.to_vec();
        // Removing the folder shifts the later siblings on the way to the target.
        let level = old_parent.len();
        if parent.len() > level && parent[..level] == from[..level] && parent[level] > from[level] {
            parent[level] -= 1;
        }
        let mut folder = self.remove_folder(from)?;
        let siblings = self.siblings_mut(&parent)?;
        if old_parent != parent {
            folder.name = unique_name(siblings, &folder.name);
        }
        let index = index.min(siblings.len());
        siblings.insert(index, folder);
        parent.push(index);
        Some(parent)
    }

    /// Move a folder up (negative) or down (positive) among its siblings, stopping at the ends. Returns the new
    /// path, or None when there is no such folder.
    pub fn shift_folder(&mut self, at: &[usize], delta: isize) -> Option<Vec<usize>> {
        self.folder(at)?;
        let (last, parent) = at.split_last()?;
        let count = self.siblings_mut(parent)?.len();
        let target = last.saturating_add_signed(delta).min(count - 1);
        // Moving down lands after the sibling at `target`, so the index is one past it.
        let index = if target > *last { target + 1 } else { target };
        self.place_folder(at, parent, index)
    }

    /// Every folder with its path, depth first: a parent before its subfolders.
    pub fn walk(&self) -> Vec<(Vec<usize>, &Folder)> {
        fn visit<'a>(folders: &'a [Folder], base: &[usize], out: &mut Vec<(Vec<usize>, &'a Folder)>) {
            for (i, folder) in folders.iter().enumerate() {
                let mut path = base.to_vec();
                path.push(i);
                out.push((path.clone(), folder));
                visit(&folder.folders, &path, out);
            }
        }
        let mut out = Vec::new();
        visit(&self.folders, &[], &mut out);
        out
    }

    /// The path of the folder reached by these names from the top; None for no
    /// names or a name that is not there.
    pub fn find(&self, names: &[String]) -> Option<Vec<usize>> {
        let mut siblings = &self.folders;
        let mut path = Vec::new();
        for name in names {
            let i = siblings.iter().position(|f| f.name == *name)?;
            path.push(i);
            siblings = &siblings[i].folders;
        }
        (!path.is_empty()).then_some(path)
    }

    /// The names of the folders along a path.
    pub fn names(&self, at: &[usize]) -> Vec<String> {
        (1..=at.len()).filter_map(|n| self.folder(&at[..n]).map(|f| f.name.clone())).collect()
    }

    /// Pin a repository: add its first key to `repos` unless one of its keys is
    /// there already, and remove all its keys from `exclude`. Returns whether
    /// anything changed.
    pub fn pin(&mut self, at: &[usize], keys: &RepoKeys) -> bool {
        let Some(folder) = self.folder_mut(at) else { return false };
        let mut changed = remove_keys(&mut folder.exclude, keys);
        if let (Some(first), false) = (keys.first(), folder.repos.iter().any(|k| keys.has(k))) {
            folder.repos.push(first.to_owned());
            changed = true;
        }
        changed
    }

    /// Unpin: remove all its keys from `repos`. Returns whether anything changed.
    pub fn unpin(&mut self, at: &[usize], keys: &RepoKeys) -> bool {
        self.folder_mut(at).is_some_and(|f| remove_keys(&mut f.repos, keys))
    }

    /// Leave a repository out: add its first key to `exclude` unless one of its
    /// keys is there. Returns whether anything changed.
    pub fn exclude(&mut self, at: &[usize], keys: &RepoKeys) -> bool {
        let Some(folder) = self.folder_mut(at) else { return false };
        match keys.first() {
            Some(first) if !folder.exclude.iter().any(|k| keys.has(k)) => {
                folder.exclude.push(first.to_owned());
                true
            }
            _ => false,
        }
    }
}

/// Remove every key of a repository from a list; whether any was there.
fn remove_keys(list: &mut Vec<String>, keys: &RepoKeys) -> bool {
    let before = list.len();
    list.retain(|k| !keys.has(k));
    list.len() != before
}

// ---------------------------------------------------------------------------
// Membership

/// Which repositories a folder holds, as one bool per repository: pinned, or
/// (matched by the query or held by a subfolder) and not excluded. A repository
/// is pinned or excluded when any of its keys is in `repos` or `exclude`; a pin
/// wins over an exclusion. `query` is called only for a non-blank query and
/// returns one bool per repository (the caller parses and evaluates it; a query
/// that does not parse matches nothing).
pub fn members(folder: &Folder, keys: &[RepoKeys], query: &mut dyn FnMut(&str) -> Vec<bool>) -> Vec<bool> {
    let mut brought = vec![false; keys.len()];
    if folder.is_smart() {
        let matched = query(folder.query.trim());
        for (b, m) in brought.iter_mut().zip(matched) {
            *b = m;
        }
    }
    for sub in &folder.folders {
        for (b, m) in brought.iter_mut().zip(members(sub, keys, query)) {
            *b |= m;
        }
    }
    let listed = |list: &[String], k: &RepoKeys| list.iter().any(|key| k.has(key));
    keys.iter().zip(brought).map(|(k, b)| listed(&folder.repos, k) || (b && !listed(&folder.exclude, k))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::model::{Changes, Found, Head, IdeSource, Relation, Remote, Stats};
    use std::path::PathBuf;
    use std::time::SystemTime;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|i| i.to_string()).collect()
    }

    fn folder(name: &str) -> Folder {
        Folder::named(name)
    }

    fn rich() -> Organize {
        let mut o = Organize::default();
        o.tags.insert("github.com/a/compass".into(), s(&["northstar", "product"]));
        o.tags.insert("~/Research/notes".into(), s(&["research"]));
        let mut top = folder("Northstar");
        top.repos = s(&["github.com/a/compass"]);
        let mut products = Folder { query: "product -third-party".into(), ..folder("Products") };
        products.exclude = s(&["~/x"]);
        let mut deep = folder("Deep");
        deep.repos = s(&["~/y", "~/z"]);
        products.folders.push(deep);
        top.folders.push(products);
        o.folders.push(top);
        o.folders.push(Folder {
            query: "uncommitted stale".into(),
            exclude: s(&["~/Creative/old-site"]),
            ..folder("Forgotten")
        });
        o
    }

    #[test]
    fn full_schema_example_parses() {
        let example = r#"unused_tags = ["ideas"]

[tags]
"github.com/owner/compass#compass" = ["northstar", "product"]
"github.com/owner/sextant" = ["tool"]
"~/Research/notes" = ["research"]

[[folder]]
name = "Northstar"
query = "northstar"

[[folder.folder]]
name = "Products"
query = "product -third-party"

[[folder]]
name = "Tools"
repos = ["github.com/owner/sextant", "~/PycharmProjects/lantern"]

[[folder]]
name = "Forgotten work"
query = "uncommitted stale"
exclude = ["~/Creative/old-site"]
"#;
        let o = parse(example).unwrap();
        assert_eq!(o.tags.len(), 3);
        assert_eq!(o.unused_tags, ["ideas".to_owned()].into());
        assert_eq!(o.folders.len(), 3);
        assert_eq!(o.folders[0].folders[0].query, "product -third-party");
        assert_eq!(o.folders[2].exclude, ["~/Creative/old-site"]);
    }

    #[test]
    fn round_trip() {
        let o = rich();
        let text = o.to_toml();
        assert!(text.starts_with("# Tags and folders for Astrolabe."), "{text}");
        assert!(text.contains("[[folder.folder]]"), "{text}");
        assert!(text.contains("[[folder.folder.folder]]"), "{text}");
        assert_eq!(parse(&text), Ok(o));
        let plain = Organize { folders: vec![folder("Plain")], ..Organize::default() }.to_toml();
        for key in ["query", "repos", "exclude", "[tags]"] {
            assert!(!plain.contains(key), "{plain}");
        }
        assert_eq!(parse(&Organize::default().to_toml()), Ok(Organize::default()));
    }

    #[test]
    fn parses_the_example() {
        let text = r#"
# Tags and folders.

[tags]
"github.com/example-org/compass" = ["northstar", "product"]
  "~/Research/notes"   =   [ "research" ]   # note

[[folder]]
name = "Northstar"
repos = ["github.com/example-org/compass"]

[[folder.folder]]
name = "Products"
query = "product -third-party"

[[folder]]
name    = "Forgotten work"
query = "uncommitted stale"
exclude = ["~/Creative/old-site"]
"#;
        let o = parse(text).unwrap();
        assert_eq!(o.tags.len(), 2);
        assert_eq!(o.tags["~/Research/notes"], s(&["research"]));
        assert_eq!(o.folders.len(), 2);
        assert_eq!(o.folders[0].folders[0].name, "Products");
        assert!(o.folders[0].folders[0].is_smart());
        assert!(!o.folders[0].is_smart());
        assert_eq!(o.folders[1].exclude, s(&["~/Creative/old-site"]));
        assert_eq!(parse("").unwrap(), Organize::default());
    }

    #[test]
    fn normalises() {
        let text = "[tags]\n\" ~/a \" = [\"Machine  Learning\", \"machine-learning\", \"  \", \"X\"]\n\"~/b\" = [\" \"]\n\
                    \"  \" = [\"t\"]\n[[folder]]\nname = \"  Top \"\nquery = \"  \"\nrepos = [\" ~/a \", \"\"]\n";
        let o = parse(text).unwrap();
        assert_eq!(o.tags.len(), 1);
        assert_eq!(o.tags["~/a"], s(&["machine-learning", "x"]));
        assert_eq!(o.folders[0].name, "Top");
        assert_eq!(o.folders[0].query, "");
        assert_eq!(o.folders[0].repos, s(&["~/a"]));
    }

    #[test]
    fn parse_errors() {
        let e = parse("[tags]\n\n[[folder]]\nname = \"a\"\ncolour = \"red\"\n").unwrap_err();
        assert!(e.contains("colour") && e.contains("line 5"), "{e}");
        let e = parse("stuff = 1\n").unwrap_err();
        assert!(e.contains("stuff") && e.contains("line 1"), "{e}");
        let e = parse("[[folder]]\nname = \"  \"\n").unwrap_err();
        assert!(e.contains("empty name"), "{e}");
        let e = parse("[[folder]]\nname = \"a\"\n[[folder.folder]]\nname = \"\"\n").unwrap_err();
        assert!(e.contains("empty name") && e.contains("\"a\""), "{e}");
        let e = parse("[tags\nx = ").unwrap_err();
        assert!(e.contains("line"), "{e}");
    }

    #[test]
    fn load_and_save() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("organize.toml");
        assert_eq!(load(&missing), (Organize::default(), None));
        assert!(!missing.exists());

        std::fs::write(&missing, "[[folder]]\nbogus = 1\n").unwrap();
        let (o, e) = load(&missing);
        assert_eq!(o, Organize::default());
        let e = e.unwrap();
        assert!(e.starts_with(&missing.display().to_string()) && e.contains("bogus"), "{e}");

        let path = dir.path().join("deeper/still/organize.toml");
        save(&path, &rich()).unwrap();
        assert_eq!(load(&path), (rich(), None));
        assert!(!dir.path().join("deeper/still/organize.toml.tmp").exists());
        save(&path, &Organize::default()).unwrap();
        assert_eq!(load(&path), (Organize::default(), None));
    }

    fn stats(remotes: &[(&str, &str)], upstream_remote: Option<&str>) -> Stats {
        Stats {
            head: Head::Branch("main".into()),
            head_sha: None,
            upstream: None,
            upstream_remote: upstream_remote.map(str::to_owned),
            upstream_ref: None,
            upstream_tip: None,
            ahead: None,
            behind: None,
            unpushed: None,
            unpushed_commits: vec![],
            changes: Changes::default(),
            oldest_change: None,
            stashes: vec![],
            worktrees: vec![],
            submodules: vec![],
            commits_total: 0,
            commits_7d: 0,
            commits_30d: 0,
            recent_commits: vec![],
            last_commit: None,
            remotes: remotes.iter().map(|(n, u)| Remote { name: n.to_string(), url: u.to_string() }).collect(),
            root_commits: vec![],
            read_at: SystemTime::UNIX_EPOCH,
            read_ms: 0,
        }
    }

    fn repo(path: &str, stats: Option<Stats>) -> Repo {
        Repo {
            found: Found {
                path: path.into(),
                git_dir: PathBuf::from(path).join(".git"),
                root: 0,
                ide: None,
                ide_source: IdeSource::None,
                langs: Vec::new(),
            },
            name: path.rsplit('/').next().unwrap().into(),
            ide: None,
            category: String::new(),
            stats: stats.map(Ok),
            relation: Relation::LocalOnly,
            gh: None,
            check: None,
        }
    }

    #[test]
    fn keys_by_rule() {
        assert_eq!(keys(None, false, "n", "~/n").0, s(&["~/n"]));
        assert_eq!(keys(None, true, "n", "~/n").0, s(&["~/n"]));
        assert_eq!(keys(Some("h/o/r"), false, "n", "~/n").0, s(&["h/o/r", "h/o/r#n", "~/n"]));
        assert_eq!(keys(Some("h/o/r"), true, "n", "~/n").0, s(&["h/o/r#n", "~/n", "h/o/r"]));
    }

    #[test]
    fn keys_of_repositories() {
        let shared = |n: &str| {
            repo(&format!("/opt/{n}/compass"), Some(stats(&[("origin", "git@GitHub.com:A/Compass.git")], None)))
        };
        let solo = stats(&[("fork", "https://github.com/x/y"), ("up", "https://github.com/p/q")], Some("up"));
        let repos = vec![
            shared("one"),
            shared("two"),
            shared("three"),
            repo("/opt/solo", Some(solo)),
            repo("/opt/local", Some(stats(&[], None))),
            repo("/opt/odd", Some(stats(&[("origin", "/some/where")], None))),
            repo("/opt/unread", None),
        ];
        let k = keys_of(&repos);
        assert_eq!(k[0].0, s(&["github.com/a/compass#compass", "/opt/one/compass", "github.com/a/compass"]));
        assert_eq!(k[1].0[0], "github.com/a/compass#compass");
        assert_eq!(k[2].0[1], "/opt/three/compass");
        assert_eq!(k[3].0, s(&["github.com/p/q", "github.com/p/q#solo", "/opt/solo"]));
        assert_eq!(k[4].0, s(&["/opt/local"]));
        assert_eq!(k[5].0, s(&["/opt/odd"]));
        assert_eq!(k[6].0, s(&["/opt/unread"]));
    }

    fn rk(items: &[&str]) -> RepoKeys {
        RepoKeys(s(items))
    }

    #[test]
    fn tags_fall_back_and_move() {
        let mut o = Organize::default();
        o.tags.insert("~/a".into(), s(&["old"]));
        let now = rk(&["h/o/r", "h/o/r#a", "~/a"]);
        assert_eq!(o.tags_of(&now), ["old"]);
        assert!(o.tags_of(&rk(&["~/other"])).is_empty());
        o.tags.insert("h/o/r#a".into(), s(&["mid"]));
        assert_eq!(o.tags_of(&now), ["mid"]);
        o.set_tags(&now, &s(&["New Tag", "new-tag", " ", "b"]));
        assert_eq!(o.tags.len(), 1);
        assert_eq!(o.tags["h/o/r"], s(&["new-tag", "b"]));
        o.set_tags(&now, &[]);
        assert!(o.tags.is_empty());
    }

    #[test]
    fn add_and_remove_tags() {
        let mut o = Organize::default();
        let k = rk(&["~/a"]);
        assert!(o.add_tag(&k, " Machine Learning "));
        assert!(!o.add_tag(&k, "machine-learning"));
        assert!(!o.add_tag(&k, "   "));
        assert!(o.add_tag(&k, "b"));
        assert_eq!(o.tags_of(&k), ["machine-learning", "b"]);
        o.remove_tag(&k, "B");
        assert_eq!(o.tags_of(&k), ["machine-learning"]);
        o.remove_tag(&k, "machine-learning");
        assert!(o.tags.is_empty());
    }

    #[test]
    fn rename_and_delete_tags() {
        let mut o = Organize::default();
        o.tags.insert("a".into(), s(&["x", "y"]));
        o.tags.insert("b".into(), s(&["y", "z"]));
        o.tags.insert("c".into(), s(&["x"]));
        assert_eq!(o.all_tags().into_iter().collect::<Vec<_>>(), s(&["x", "y", "z"]));
        o.rename_tag("X", "Y");
        assert_eq!(o.tags["a"], s(&["y"]));
        assert_eq!(o.tags["b"], s(&["y", "z"]));
        assert_eq!(o.tags["c"], s(&["y"]));
        o.rename_tag("z", "  ");
        assert_eq!(o.tags["b"], s(&["y", "z"]));
        o.rename_tag("z", "New Name");
        assert_eq!(o.tags["b"], s(&["y", "new-name"]));
        o.delete_tag("Y");
        assert_eq!(o.tags.len(), 1);
        assert_eq!(o.tags["b"], s(&["new-name"]));
    }

    /// A { A1 { A1a }, A2 }, B, C
    fn tree() -> Organize {
        let mut o = Organize::default();
        let a = o.add_folder(&[], folder("A")).unwrap();
        let a1 = o.add_folder(&a, folder("A1")).unwrap();
        o.add_folder(&a1, folder("A1a")).unwrap();
        o.add_folder(&a, folder("A2")).unwrap();
        o.add_folder(&[], folder("B")).unwrap();
        o.add_folder(&[], folder("C")).unwrap();
        o
    }

    fn outline(o: &Organize) -> Vec<String> {
        o.walk().iter().map(|(p, f)| format!("{}{}", "-".repeat(p.len() - 1), f.name)).collect()
    }

    #[test]
    fn adds_folders_with_unique_names() {
        let mut o = Organize::default();
        assert_eq!(o.add_folder(&[], folder("X")), Some(vec![0]));
        assert_eq!(o.add_folder(&[], folder(" X ")), Some(vec![1]));
        assert_eq!(o.add_folder(&[], folder("X")), Some(vec![2]));
        assert_eq!(o.add_folder(&[0], folder("X")), Some(vec![0, 0]));
        assert_eq!(o.add_folder(&[0], folder("X")), Some(vec![0, 1]));
        assert_eq!(o.add_folder(&[], folder("")), Some(vec![3]));
        assert_eq!(o.add_folder(&[9], folder("Y")), None);
        assert_eq!(o.add_folder(&[0, 5], folder("Y")), None);
        let names: Vec<_> = o.folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["X", "X 2", "X 3", "New folder"]);
        assert_eq!(o.folders[0].folders[1].name, "X 2");
    }

    #[test]
    fn renames_folders() {
        let mut o = tree();
        assert!(o.rename_folder(&[0, 1], "  Second  "));
        assert_eq!(o.folder(&[0, 1]).unwrap().name, "Second");
        assert!(!o.rename_folder(&[0, 1], "Second"));
        assert!(!o.rename_folder(&[0, 1], "  "));
        assert!(!o.rename_folder(&[0, 1], "A1"));
        assert!(!o.rename_folder(&[1], "C"));
        assert!(!o.rename_folder(&[7], "Z"));
        assert!(!o.rename_folder(&[], "Z"));
        assert!(o.rename_folder(&[1], "A1"));
    }

    #[test]
    fn removes_folders() {
        let mut o = tree();
        assert_eq!(o.remove_folder(&[0, 0]).unwrap().name, "A1");
        assert_eq!(outline(&o), ["A", "-A2", "B", "C"]);
        assert!(o.remove_folder(&[0, 5]).is_none());
        assert!(o.remove_folder(&[]).is_none());
        assert!(o.remove_folder(&[3]).is_none());
        assert_eq!(o.remove_folder(&[0]).unwrap().name, "A");
        assert_eq!(outline(&o), ["B", "C"]);
    }

    #[test]
    fn places_folders_among_siblings() {
        // Before the first sibling, between siblings both ways, and last.
        let mut o = tree();
        assert_eq!(o.place_folder(&[2], &[], 0), Some(vec![0]));
        assert_eq!(outline(&o), ["C", "A", "-A1", "--A1a", "-A2", "B"]);
        let mut o = tree();
        assert_eq!(o.place_folder(&[0], &[], 2), Some(vec![1]));
        assert_eq!(outline(&o), ["B", "A", "-A1", "--A1a", "-A2", "C"]);
        let mut o = tree();
        assert_eq!(o.place_folder(&[2], &[], 1), Some(vec![1]));
        assert_eq!(outline(&o), ["A", "-A1", "--A1a", "-A2", "C", "B"]);
        let mut o = tree();
        assert_eq!(o.place_folder(&[0], &[], usize::MAX), Some(vec![2]));
        assert_eq!(outline(&o), ["B", "C", "A", "-A1", "--A1a", "-A2"]);
        // Just before or after itself leaves it where it is.
        let mut o = tree();
        assert_eq!(o.place_folder(&[1], &[], 1), Some(vec![1]));
        assert_eq!(o.place_folder(&[1], &[], 2), Some(vec![1]));
        assert_eq!(o, tree());
    }

    #[test]
    fn places_folders_across_parents() {
        // Into another parent at a position.
        let mut o = tree();
        assert_eq!(o.place_folder(&[1], &[0], 1), Some(vec![0, 1]));
        assert_eq!(outline(&o), ["A", "-A1", "--A1a", "-B", "-A2", "C"]);
        // Into a nested parent whose path shifts when the folder leaves.
        let mut o = tree();
        assert_eq!(o.place_folder(&[0], &[2], 0), Some(vec![1, 0]));
        assert_eq!(outline(&o), ["B", "C", "-A", "--A1", "---A1a", "--A2"]);
        // Never into itself or a descendant.
        let mut o = tree();
        assert_eq!(o.place_folder(&[0], &[0], 0), None);
        assert_eq!(o.place_folder(&[0], &[0, 0], 0), None);
        assert_eq!(o, tree());
        // A clash is renamed across parents; within one parent the name stays.
        let mut o = tree();
        o.add_folder(&[], folder("A1"));
        assert_eq!(o.place_folder(&[0, 0], &[], 0), Some(vec![0]));
        assert_eq!(o.folder(&[0]).unwrap().name, "A1 2");
        let mut o = tree();
        assert_eq!(o.place_folder(&[0, 1], &[0], 0), Some(vec![0, 0]));
        assert_eq!(o.folder(&[0, 0]).unwrap().name, "A2");
    }

    #[test]
    fn shifts_folders() {
        let mut o = tree();
        assert_eq!(o.shift_folder(&[1], -1), Some(vec![0]));
        assert_eq!(outline(&o), ["B", "A", "-A1", "--A1a", "-A2", "C"]);
        assert_eq!(o.shift_folder(&[0], 1), Some(vec![1]));
        assert_eq!(o, tree());
        assert_eq!(o.shift_folder(&[0], -1), Some(vec![0]));
        assert_eq!(o.shift_folder(&[2], 5), Some(vec![2]));
        assert_eq!(o, tree());
        assert_eq!(o.shift_folder(&[0, 0], 1), Some(vec![0, 1]));
        assert_eq!(outline(&o), ["A", "-A2", "-A1", "--A1a", "B", "C"]);
        assert_eq!(o.shift_folder(&[7], 1), None);
        assert_eq!(o.shift_folder(&[], 1), None);
    }

    #[test]
    fn unused_tags_round_trip_and_normalise() {
        let mut o = Organize::default();
        o.tags.insert("~/a".into(), s(&["used"]));
        o.unused_tags = ["ideas".to_owned(), "later".to_owned()].into();
        let text = o.to_toml();
        let unused_at = text.find("unused_tags").expect("unused tags written");
        assert!(unused_at < text.find("[tags]").unwrap(), "{text}");
        assert_eq!(parse(&text).unwrap(), o);
        assert!(!Organize::default().to_toml().contains("unused_tags"));
        let o = parse("unused_tags = [\"Ideas\", \"ideas\", \" \", \"Used\"]\n[tags]\n\"~/a\" = [\"used\"]\n").unwrap();
        assert_eq!(o.unused_tags, ["ideas".to_owned()].into());
        assert_eq!(o.all_tags(), ["ideas".to_owned(), "used".to_owned()].into());
    }

    #[test]
    fn tags_outlive_their_last_repository() {
        let a = rk(&["h/o/a", "~/a"]);
        let b = rk(&["~/b"]);
        let mut o = Organize::default();
        o.add_tag(&a, "shared");
        o.add_tag(&b, "shared");
        o.add_tag(&a, "only-a");
        o.remove_tag(&a, "only-a");
        assert!(o.unused_tags.contains("only-a"));
        o.remove_tag(&a, "shared");
        assert!(!o.unused_tags.contains("shared"), "b still carries it");
        // Moving an entry to another key neither loses nor invents an unused tag.
        let mut moved = Organize::default();
        moved.tags.insert("~/a".into(), s(&["x"]));
        moved.set_tags(&a, &s(&["x"]));
        assert_eq!(moved.tags.keys().collect::<Vec<_>>(), ["h/o/a"]);
        assert!(moved.unused_tags.is_empty());
        // Carrying it again takes it out of the unused tags.
        o.add_tag(&b, "only-a");
        assert!(!o.unused_tags.contains("only-a"));
        assert_eq!(o.all_tags(), ["only-a".to_owned(), "shared".to_owned()].into());
    }

    #[test]
    fn creates_renames_and_deletes_unused_tags() {
        let a = rk(&["~/a"]);
        let mut o = Organize::default();
        assert_eq!(o.create_tag(" New  Idea "), Some("new-idea".to_owned()));
        assert_eq!(o.create_tag("new-idea"), None);
        assert_eq!(o.create_tag("  "), None);
        assert_eq!(o.create_tag("stale"), None);
        assert_eq!(o.create_tag("lang:rust"), None);
        o.add_tag(&a, "product");
        assert_eq!(o.create_tag("product"), None);
        // Renaming an unused tag, and merging one onto a tag in use.
        o.rename_tag("new-idea", "idea");
        assert_eq!(o.unused_tags, ["idea".to_owned()].into());
        o.rename_tag("idea", "product");
        assert!(o.unused_tags.is_empty());
        assert_eq!(o.all_tags(), ["product".to_owned()].into());
        // Never onto an automatic name.
        o.rename_tag("product", "uncommitted");
        assert_eq!(o.tags_of(&a), ["product"]);
        // Deleting removes it from repositories and the unused tags alike.
        o.create_tag("spare");
        o.delete_tag("spare");
        o.delete_tag("product");
        assert!(o.all_tags().is_empty());
    }

    #[test]
    fn moves_folders() {
        let mut o = tree();
        assert_eq!(o.move_folder(&[0, 0], &[]), Some(vec![3]));
        assert_eq!(outline(&o), ["A", "-A2", "B", "C", "A1", "-A1a"]);
        // The target index shifts when the folder leaves an earlier sibling slot.
        assert_eq!(o.move_folder(&[0], &[2]), Some(vec![1, 0]));
        assert_eq!(outline(&o), ["B", "C", "-A", "--A2", "A1", "-A1a"]);
        assert_eq!(o.move_folder(&[1], &[1, 0]), None);
        assert_eq!(o.move_folder(&[1], &[1]), None);
        assert_eq!(o.move_folder(&[1], &[9]), None);
        assert_eq!(o.move_folder(&[9], &[]), None);
        // A name clash is renamed.
        let mut o = tree();
        o.add_folder(&[1], folder("A2"));
        assert_eq!(o.move_folder(&[0, 1], &[1]), Some(vec![1, 1]));
        assert_eq!(o.folder(&[1, 1]).unwrap().name, "A2 2");
        // Moving to the current parent puts it last.
        let mut o = tree();
        assert_eq!(o.move_folder(&[0, 0], &[0]), Some(vec![0, 1]));
        assert_eq!(outline(&o), ["A", "-A2", "-A1", "--A1a", "B", "C"]);
    }

    #[test]
    fn walks_and_finds() {
        let o = tree();
        assert_eq!(outline(&o), ["A", "-A1", "--A1a", "-A2", "B", "C"]);
        assert_eq!(o.walk()[2].0, vec![0, 0, 0]);
        assert_eq!(o.find(&s(&["A", "A1", "A1a"])), Some(vec![0, 0, 0]));
        assert_eq!(o.find(&s(&["C"])), Some(vec![2]));
        assert_eq!(o.find(&s(&["A", "B"])), None);
        assert_eq!(o.find(&[]), None);
        assert_eq!(o.names(&[0, 1]), s(&["A", "A2"]));
        assert_eq!(o.names(&[]), Vec::<String>::new());
        assert_eq!(o.names(&[0, 9]), s(&["A"]));
    }

    #[test]
    fn pins_and_excludes() {
        let mut o = tree();
        let k = rk(&["h/o/r#a", "~/a", "h/o/r"]);
        assert!(o.exclude(&[0], &k));
        assert!(!o.exclude(&[0], &rk(&["~/zzz", "h/o/r#a"])));
        assert_eq!(o.folder(&[0]).unwrap().exclude, s(&["h/o/r#a"]));
        assert!(o.pin(&[0], &k));
        assert_eq!(o.folder(&[0]).unwrap().repos, s(&["h/o/r#a"]));
        assert!(o.folder(&[0]).unwrap().exclude.is_empty());
        assert!(!o.pin(&[0], &rk(&["~/a", "h/o/r#a"])));
        assert!(o.unpin(&[0], &rk(&["x", "h/o/r#a"])));
        assert!(!o.unpin(&[0], &k));
        assert!(!o.pin(&[9], &k));
        assert!(!o.unpin(&[], &k));
        assert!(!o.exclude(&[9], &k));
    }

    fn fleet() -> Vec<RepoKeys> {
        vec![
            rk(&["h/o/r#one", "~/one", "h/o/r"]),
            rk(&["h/o/r#two", "~/two", "h/o/r"]),
            rk(&["h/o/q", "h/o/q#three", "~/three"]),
            rk(&["~/four"]),
        ]
    }

    /// A query that matches the repositories at these positions, and records its calls.
    fn matching<'a>(at: &'a [usize], calls: &'a mut Vec<String>) -> impl FnMut(&str) -> Vec<bool> + 'a {
        move |q| {
            calls.push(q.to_owned());
            (0..4).map(|i| at.contains(&i)).collect()
        }
    }

    #[test]
    fn manual_folder_members() {
        let mut f = folder("M");
        f.repos = s(&["h/o/r#one", "~/four"]);
        let mut calls = Vec::new();
        assert_eq!(members(&f, &fleet(), &mut matching(&[0, 1, 2, 3], &mut calls)), [true, false, false, true]);
        f.query = "   ".into();
        f.repos = s(&["h/o/r"]);
        assert_eq!(members(&f, &fleet(), &mut matching(&[], &mut calls)), [true, true, false, false]);
        f.repos = s(&["h/o/q#three"]);
        assert_eq!(members(&f, &fleet(), &mut matching(&[], &mut calls)), [false, false, true, false]);
        assert!(calls.is_empty(), "a blank query is never evaluated");
    }

    #[test]
    fn smart_and_mixed_members() {
        let mut f = Folder { query: "q".into(), ..folder("S") };
        let mut calls = Vec::new();
        assert_eq!(members(&f, &fleet(), &mut matching(&[1, 2], &mut calls)), [false, true, true, false]);
        assert_eq!(calls, ["q"]);
        assert_eq!(members(&f, &fleet(), &mut matching(&[], &mut calls)), [false; 4]);
        f.repos = s(&["~/four"]);
        f.exclude = s(&["~/two", "~/four"]);
        assert_eq!(members(&f, &fleet(), &mut matching(&[0, 1, 2], &mut calls)), [true, false, true, true]);
    }

    #[test]
    fn nested_members() {
        let mut sub = Folder { query: "q".into(), ..folder("Sub") };
        sub.repos = s(&["~/four"]);
        let mut parent = folder("Parent");
        parent.folders.push(sub);
        let mut calls = Vec::new();
        assert_eq!(members(&parent, &fleet(), &mut matching(&[0], &mut calls)), [true, false, false, true]);
        parent.exclude = s(&["h/o/r"]);
        assert_eq!(members(&parent, &fleet(), &mut matching(&[0, 2], &mut calls)), [false, false, true, true]);
        parent.repos = s(&["~/one"]);
        assert_eq!(members(&parent, &fleet(), &mut matching(&[0, 2], &mut calls)), [true, false, true, true]);
    }
}
