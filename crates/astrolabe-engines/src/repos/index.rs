//! What the sidebar, the list and the inspector ask about organisation: every
//! repository's keys, tags and location, which repositories each folder holds,
//! and how many repositories carry each tag. Built from the rows and
//! `organize.toml` together, and rebuilt when either changes. No I/O.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::time::SystemTime;

use super::model::Repo;
use super::organize::{self, Organize, RepoKeys};
use super::query::{self, Facts, Query};
use super::{paths, tags};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Index {
    /// Per repository, in the order of the rows.
    pub keys: Vec<RepoKeys>,
    pub manual: Vec<Vec<String>>,
    pub auto: Vec<Vec<String>>,
    /// The path with `~`.
    pub paths: Vec<String>,
    /// The folder the repository is in, with `~`: where it is.
    pub locations: Vec<String>,
    names: Vec<String>,
    sets: Vec<HashSet<String>>,
    /// Every tag a bare word in a query can name.
    vocab: HashSet<String>,
    /// Which repositories each folder holds, by the folder's index path.
    folders: HashMap<Vec<usize>, Vec<bool>>,
    /// Folders whose query does not parse, with the reason.
    pub errors: HashMap<Vec<usize>, String>,
    /// Every manual tag in `organize.toml`, sorted, with how many repositories carry it.
    pub manual_counts: Vec<(String, usize)>,
    /// Every automatic tag some repository has, with how many do.
    pub auto_counts: BTreeMap<String, usize>,
}

/// One repository as a query sees it.
struct Item<'a> {
    index: &'a Index,
    i: usize,
}

impl Facts for Item<'_> {
    fn has_tag(&self, tag: &str) -> bool {
        self.index.sets[self.i].contains(tag)
    }

    fn name(&self) -> &str {
        &self.index.names[self.i]
    }

    fn location(&self) -> &str {
        &self.index.paths[self.i]
    }
}

impl Index {
    pub fn build(repos: &[Repo], org: &Organize, now: SystemTime) -> Index {
        let keys = organize::keys_of(repos);
        let manual: Vec<Vec<String>> = keys.iter().map(|k| org.tags_of(k).to_vec()).collect();
        let auto: Vec<Vec<String>> = repos.iter().map(|r| tags::automatic(r, now)).collect();
        let sets: Vec<HashSet<String>> =
            manual.iter().zip(&auto).map(|(m, a)| m.iter().chain(a).cloned().collect()).collect();
        let paths: Vec<String> = repos.iter().map(|r| paths::tilde(r.id())).collect();
        let locations = repos.iter().map(|r| paths::tilde(r.id().parent().unwrap_or(Path::new("/")))).collect();
        let names = repos.iter().map(|r| r.name.clone()).collect();

        let mut vocab: HashSet<String> = sets.iter().flatten().cloned().collect();
        vocab.extend(org.all_tags());
        vocab.extend(tags::STATUS.iter().map(|s| s.to_string()));
        vocab.extend(tags::LOCATION.iter().map(|s| s.to_string()));

        let manual_counts = org
            .all_tags()
            .into_iter()
            .map(|t| {
                let n = manual.iter().filter(|m| m.contains(&t)).count();
                (t, n)
            })
            .collect();
        let mut auto_counts = BTreeMap::new();
        for tag in auto.iter().flatten() {
            *auto_counts.entry(tag.clone()).or_insert(0) += 1;
        }

        let mut index = Index {
            keys,
            manual,
            auto,
            paths,
            locations,
            names,
            sets,
            vocab,
            folders: HashMap::new(),
            errors: HashMap::new(),
            manual_counts,
            auto_counts,
        };
        for (at, folder) in org.walk() {
            if folder.is_smart()
                && let Err(e) = query::parse(&folder.query)
            {
                index.errors.insert(at.clone(), e.message);
            }
        }
        let folders = org.walk().into_iter().map(|(at, f)| (at, index.members(f))).collect();
        index.folders = folders;
        index
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// Whether a bare word in a query names a tag: one some repository has, one
    /// in `organize.toml`, or an automatic one.
    pub fn is_tag(&self, word: &str) -> bool {
        self.vocab.contains(word) || tags::is_automatic(word)
    }

    pub fn has_tag(&self, i: usize, tag: &str) -> bool {
        self.sets[i].contains(tag)
    }

    pub fn matches(&self, i: usize, q: &Query) -> bool {
        q.matches(&Item { index: self, i }, &|w| self.is_tag(w))
    }

    /// Whether each repository matches a query; one that does not parse matches none.
    pub fn matching_text(&self, text: &str) -> Vec<bool> {
        match query::parse(text) {
            Ok(q) => (0..self.len()).map(|i| self.matches(i, &q)).collect(),
            Err(_) => vec![false; self.len()],
        }
    }

    /// Which repositories a folder holds, worked out now (after a change that
    /// the index has not been rebuilt for).
    pub fn members(&self, folder: &organize::Folder) -> Vec<bool> {
        organize::members(folder, &self.keys, &mut |q| self.matching_text(q))
    }

    /// Which repositories a folder held when the index was built.
    pub fn folder(&self, at: &[usize]) -> Option<&[bool]> {
        self.folders.get(at).map(Vec::as_slice)
    }

    pub fn folder_count(&self, at: &[usize]) -> usize {
        self.folder(at).map_or(0, |m| m.iter().filter(|b| **b).count())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::model::{Changes, Found, Head, IdeSource, Relation, Remote, Stats};
    use crate::repos::organize::Folder;

    fn stats(remote: Option<&str>, dirty: bool) -> Stats {
        Stats {
            head: Head::Branch("main".into()),
            head_sha: None,
            upstream: None,
            upstream_remote: None,
            upstream_ref: None,
            upstream_tip: None,
            ahead: None,
            behind: None,
            unpushed: None,
            unpushed_commits: vec![],
            changes: Changes { unstaged: u32::from(dirty), ..Changes::default() },
            oldest_change: None,
            stashes: vec![],
            worktrees: vec![],
            submodules: vec![],
            commits_total: 0,
            commits_7d: 0,
            commits_30d: 0,
            recent_commits: vec![],
            last_commit: None,
            remotes: remote.map(|u| Remote { name: "origin".into(), url: u.into() }).into_iter().collect(),
            root_commits: vec![],
            read_at: SystemTime::UNIX_EPOCH,
            read_ms: 0,
        }
    }

    fn repo(path: &str, remote: Option<&str>, dirty: bool) -> Repo {
        let path = paths::home().join(path);
        Repo {
            found: Found {
                path: path.clone(),
                git_dir: path.join(".git"),
                root: 0,
                ide: None,
                ide_source: IdeSource::None,
                langs: vec!["rust".into()],
            },
            name: path.file_name().unwrap().to_string_lossy().into_owned(),
            ide: None,
            category: "Research".into(),
            stats: Some(Ok(stats(remote, dirty))),
            relation: if remote.is_some() { Relation::Private } else { Relation::LocalOnly },
            gh: None,
            check: None,
        }
    }

    fn sample() -> (Vec<Repo>, Organize) {
        let repos = vec![
            repo("Code/alpha", Some("https://github.com/me/alpha.git"), true),
            repo("Code/beta", None, false),
            repo("Research/gamma", Some("git@github.com:me/gamma.git"), false),
        ];
        let mut org = Organize::default();
        org.tags.insert("github.com/me/alpha".into(), vec!["northstar".into(), "product".into()]);
        org.tags.insert("~/Code/beta".into(), vec!["northstar".into()]);
        org.folders.push(Folder {
            name: "Northstar".into(),
            query: "northstar".into(),
            folders: vec![Folder {
                name: "Gamma".into(),
                repos: vec!["github.com/me/gamma".into()],
                ..Folder::default()
            }],
            ..Folder::default()
        });
        org.folders.push(Folder { name: "Broken".into(), query: "(a".into(), ..Folder::default() });
        (repos, org)
    }

    #[test]
    fn tags_locations_and_counts() {
        let (repos, org) = sample();
        let index = Index::build(&repos, &org, SystemTime::UNIX_EPOCH);
        assert_eq!(index.manual[0], ["northstar", "product"]);
        assert_eq!(index.manual[1], ["northstar"]);
        assert!(index.has_tag(0, "uncommitted") && index.has_tag(0, "private") && index.has_tag(0, "lang:rust"));
        assert!(index.has_tag(0, "location:both") && index.has_tag(2, "location:both"));
        assert!(index.has_tag(1, "local-only") && index.has_tag(1, "location:local-only") && !index.has_tag(1, "uncommitted"));
        assert_eq!(index.locations[0], "~/Code");
        assert_eq!(index.paths[2], "~/Research/gamma");
        assert_eq!(index.manual_counts, vec![("northstar".to_string(), 2), ("product".to_string(), 1)]);
        assert_eq!(index.auto_counts.get("category:research"), Some(&3));
        assert_eq!(index.auto_counts.get("location:both"), Some(&2));
        assert_eq!(index.auto_counts.get("location:local-only"), Some(&1));
        assert_eq!(index.auto_counts.get("uncommitted"), Some(&1));
        assert_eq!(index.auto_counts.get("behind"), None);
    }

    #[test]
    fn words_are_tags_or_text() {
        let (repos, org) = sample();
        let index = Index::build(&repos, &org, SystemTime::UNIX_EPOCH);
        assert!(index.is_tag("northstar") && index.is_tag("behind") && index.is_tag("lang:haskell"));
        assert!(index.is_tag("location:local-only") && index.is_tag("location:remote-only") && index.is_tag("location:both"));
        assert!(!index.is_tag("gam"));
        assert_eq!(index.matching_text("northstar -product"), [false, true, false]);
        assert_eq!(index.matching_text("gam"), [false, false, true]);
        assert_eq!(index.matching_text("research"), [false, false, true]);
        assert_eq!(index.matching_text("behind"), [false, false, false]);
        assert_eq!(index.matching_text("uncommitted OR local-only"), [true, true, false]);
        assert_eq!(index.matching_text("location:both"), [true, false, true]);
        assert_eq!(index.matching_text("location:local-only"), [false, true, false]);
        assert_eq!(index.matching_text("(a"), [false, false, false]);
    }

    #[test]
    fn folders_and_errors() {
        let (repos, org) = sample();
        let index = Index::build(&repos, &org, SystemTime::UNIX_EPOCH);
        assert_eq!(index.folder(&[0]), Some(&[true, true, true][..]));
        assert_eq!(index.folder(&[0, 0]), Some(&[false, false, true][..]));
        assert_eq!(index.folder_count(&[1]), 0);
        assert!(index.errors.contains_key(&vec![1]));
        assert!(!index.errors.contains_key(&vec![0]));
        assert_eq!(index.folder(&[7]), None);
    }
}
