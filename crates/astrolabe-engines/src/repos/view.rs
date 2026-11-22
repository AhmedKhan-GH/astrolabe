//! Pure filtering, sorting, grouping, status classification, age/time
//! formatting, and window-preference helpers extracted from Repo Monitor's
//! view layer. Zero GUI dependencies.

use std::collections::BTreeSet;
use std::path::Path;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use super::index::Index;
use super::model::{Changes, Config, Ide, Relation, Repo, Tip, tag_slug};
use super::organize::{Folder, Organize};
use super::query::Query;

/// What the sidebar has chosen.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Nav {
    #[default]
    All,
    /// A folder, by the names along its path from the top.
    Folder(Vec<String>),
    Tag(String),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Grouping {
    #[default]
    None,
    Folder,
    Tag,
    App,
}

impl Grouping {
    pub const ALL: [Grouping; 4] = [Grouping::None, Grouping::Folder, Grouping::Tag, Grouping::App];

    pub fn label(self) -> &'static str {
        match self {
            Grouping::None => "FLAT",
            Grouping::Folder => "FOLDER",
            Grouping::Tag => "TAG",
            Grouping::App => "APP",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    Compact,
    #[default]
    Comfortable,
}

impl Density {
    pub fn label(self) -> &'static str {
        match self {
            Density::Compact => "COMPACT",
            Density::Comfortable => "COMFORTABLE",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sort {
    #[default]
    Name,
    Location,
    Recent,
}

impl Sort {
    pub const ALL: [Sort; 3] = [Sort::Name, Sort::Location, Sort::Recent];

    pub fn label(self) -> &'static str {
        match self {
            Sort::Name => "NAME",
            Sort::Location => "LOCATION",
            Sort::Recent => "RECENT",
        }
    }

    /// The newest commit comes first on the first click.
    pub fn descending_first(self) -> bool {
        self == Sort::Recent
    }
}

/// Persisted list and navigation choices, stored in `window.toml`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Prefs {
    /// The open folder, by names; empty for none.
    pub folder: Vec<String>,
    /// The open tag; empty for none.
    pub tag: String,
    pub grouping: Grouping,
    pub density: Density,
    pub sort: Sort,
    pub descending: bool,
    /// Folded sidebar sections and folders.
    pub folded: BTreeSet<String>,
}

impl Prefs {
    pub fn nav(&self) -> Nav {
        if !self.folder.is_empty() {
            Nav::Folder(self.folder.clone())
        } else if !self.tag.is_empty() {
            Nav::Tag(self.tag.clone())
        } else {
            Nav::All
        }
    }

    pub fn set_nav(&mut self, nav: &Nav) {
        self.folder = match nav {
            Nav::Folder(names) => names.clone(),
            _ => Vec::new(),
        };
        self.tag = match nav {
            Nav::Tag(t) => t.clone(),
            _ => String::new(),
        };
    }
}

pub fn load_prefs(path: &Path) -> Prefs {
    std::fs::read_to_string(path).ok().and_then(|t| toml::from_str(&t).ok()).unwrap_or_default()
}

pub fn save_prefs(path: &Path, prefs: &Prefs) -> Result<(), String> {
    let text = toml::to_string(prefs).map_err(|e| e.to_string())?;
    let text = format!("# The window's own choices; Repo Monitor rewrites this file.\n\n{text}");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// A section's identity, independent of its title and position in the list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SectionKey {
    Flat,
    App(Option<Ide>),
    Tag(Option<String>),
    Folder(Option<Vec<String>>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Section {
    pub key: SectionKey,
    pub title: String,
    pub rows: Vec<usize>,
}

/// The states a repository can be in, most pressing first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Flag {
    Unreadable,
    LocalOnly,
    NotOnRemote,
    Uncommitted,
    Unpushed,
    Behind,
    Moved,
    InSync,
}

impl Flag {
    pub fn word(self) -> &'static str {
        match self {
            Flag::Unreadable => "UNREADABLE",
            Flag::LocalOnly => "LOCAL ONLY",
            Flag::NotOnRemote => "NOT ON REMOTE",
            Flag::Uncommitted => "UNCOMMITTED",
            Flag::Unpushed => "UNPUSHED",
            Flag::Behind => "BEHIND",
            Flag::Moved => "REMOTE MOVED",
            Flag::InSync => "IN SYNC",
        }
    }
}

/// Every state a repository is in, most pressing first; never empty once read.
pub fn flags(repo: &Repo) -> Vec<Flag> {
    let Some(s) = repo.stats() else {
        return if repo.error().is_some() { vec![Flag::Unreadable] } else { Vec::new() };
    };
    let tip = repo.check.as_ref().map(|c| &c.tip);
    let mut f = Vec::new();
    if repo.relation == Relation::LocalOnly {
        f.push(Flag::LocalOnly);
    }
    if matches!(tip, Some(Tip::Missing)) {
        f.push(Flag::NotOnRemote);
    }
    if s.has_uncommitted() {
        f.push(Flag::Uncommitted);
    }
    if repo.unpushed() > 0 {
        f.push(Flag::Unpushed);
    }
    if s.behind.unwrap_or(0) > 0 {
        f.push(Flag::Behind);
    }
    if matches!(tip, Some(Tip::Moved { .. })) {
        f.push(Flag::Moved);
    }
    if f.is_empty() {
        f.push(Flag::InSync);
    }
    f
}

/// The committer time of a repository's latest commit, if read and non-empty.
pub fn last_commit(repo: &Repo) -> Option<SystemTime> {
    repo.stats().and_then(|s| s.last_commit.as_ref()).map(|c| c.commit_time)
}

/// The open folder's index path in `org`, when `nav` selects a folder.
pub fn nav_folder(org: &Organize, nav: &Nav) -> Option<Vec<usize>> {
    match nav {
        Nav::Folder(names) => org.find(names),
        _ => None,
    }
}

fn in_nav(nav: &Nav, index: &Index, members: Option<&[bool]>, i: usize) -> bool {
    match nav {
        Nav::All => true,
        Nav::Folder(_) => members.is_some_and(|m| m.get(i).copied().unwrap_or(false)),
        Nav::Tag(t) => index.has_tag(i, t),
    }
}

/// Filter and sort repositories by navigation scope, query, and sort order,
/// returning indices into `repos`.
pub fn shown(
    repos: &[Repo],
    index: &Index,
    org: &Organize,
    nav: &Nav,
    filter: &Query,
    sort: Sort,
    desc: bool,
) -> Vec<usize> {
    let n = index.len().min(repos.len());
    let at = nav_folder(org, nav);
    let members = at.as_deref().and_then(|a| index.folder(a));
    let all = filter.is_all();
    let mut rows: Vec<usize> =
        (0..n).filter(|&i| in_nav(nav, index, members, i) && (all || index.matches(i, filter))).collect();
    rows.sort_by(|&a, &b| {
        let ord = match sort {
            Sort::Name => repos[a].name.to_lowercase().cmp(&repos[b].name.to_lowercase()),
            Sort::Location => index.locations[a].to_lowercase().cmp(&index.locations[b].to_lowercase()),
            Sort::Recent => last_commit(&repos[a]).cmp(&last_commit(&repos[b])),
        };
        let ord = if desc { ord.reverse() } else { ord };
        ord.then_with(|| repos[a].name.to_lowercase().cmp(&repos[b].name.to_lowercase()))
            .then_with(|| repos[a].id().cmp(repos[b].id()))
    });
    rows
}

/// Group the filtered and sorted rows into non-empty display sections. A
/// repository in several folders or with several tags appears in each section.
#[allow(clippy::too_many_arguments)]
pub fn sections(
    repos: &[Repo],
    index: &Index,
    org: &Organize,
    nav: &Nav,
    filter: &Query,
    grouping: Grouping,
    sort: Sort,
    desc: bool,
) -> Vec<Section> {
    let shown = shown(repos, index, org, nav, filter, sort, desc);
    let mut out: Vec<Section> = Vec::new();
    let rest = |out: &mut Vec<Section>, key: SectionKey, title: &str| {
        let placed: BTreeSet<usize> = out.iter().flat_map(|s| s.rows.iter().copied()).collect();
        let left: Vec<usize> = shown.iter().copied().filter(|i| !placed.contains(i)).collect();
        out.push(Section { key, title: title.to_owned(), rows: left });
    };
    match grouping {
        Grouping::None => out.push(Section { key: SectionKey::Flat, title: String::new(), rows: shown.clone() }),
        Grouping::App => {
            for ide in Ide::ALL.into_iter().map(Some).chain([None]) {
                let title = ide.map_or("No app", Ide::name).to_owned();
                out.push(Section {
                    key: SectionKey::App(ide),
                    title,
                    rows: shown.iter().copied().filter(|&i| repos[i].ide == ide).collect(),
                });
            }
        }
        Grouping::Tag => {
            for (tag, _) in &index.manual_counts {
                let rows = shown.iter().copied().filter(|&i| index.manual[i].contains(tag)).collect();
                out.push(Section { key: SectionKey::Tag(Some(tag.clone())), title: tag.clone(), rows });
            }
            rest(&mut out, SectionKey::Tag(None), "No tags");
        }
        Grouping::Folder => {
            // The subfolders of the open folder, or the top-level folders.
            let parent = nav_folder(org, nav).filter(|at| org.folder(at).is_some_and(|f| !f.folders.is_empty()));
            let children: Vec<(Vec<usize>, &Folder)> = match &parent {
                Some(at) => org.folder(at).map_or(Vec::new(), |f| {
                    f.folders
                        .iter()
                        .enumerate()
                        .map(|(i, c)| {
                            let mut p = at.clone();
                            p.push(i);
                            (p, c)
                        })
                        .collect()
                }),
                None => org.folders.iter().enumerate().map(|(i, f)| (vec![i], f)).collect(),
            };
            for (at, folder) in children {
                let members = index.folder(&at).unwrap_or(&[]);
                let rows = shown.iter().copied().filter(|&i| members.get(i).copied().unwrap_or(false)).collect();
                out.push(Section {
                    key: SectionKey::Folder(Some(org.names(&at))),
                    title: folder.name.clone(),
                    rows,
                });
            }
            rest(
                &mut out,
                SectionKey::Folder(None),
                if parent.is_some() { "Not in a subfolder" } else { "Not in a folder" },
            );
        }
    }
    out.retain(|s| !s.rows.is_empty());
    out
}

/// How a tag reads in the UI: an app or category by its own name, a language
/// without its prefix, other tags as they are.
pub fn tag_label(config: &Config, tag: &str) -> String {
    if let Some(app) = tag.strip_prefix("app:") {
        let ide = Ide::ALL.into_iter().find(|i| i.name().eq_ignore_ascii_case(app));
        return ide.map_or_else(|| app.to_owned(), |i| i.name().to_owned());
    }
    if let Some(cat) = tag.strip_prefix("category:") {
        let named = config.categories.iter().find(|c| tag_slug(c) == cat);
        return named.cloned().unwrap_or_else(|| cat.to_owned());
    }
    tag.strip_prefix("lang:").unwrap_or(tag).to_owned()
}

/// The first 7 characters of a commit SHA.
pub fn short_sha(sha: Option<&str>) -> String {
    sha.map(|s| s.chars().take(7).collect()).unwrap_or_default()
}

/// Human-readable uncommitted change counts, joined by ` · `.
pub fn changes_text(c: Changes) -> String {
    let counts =
        [(c.staged, "staged"), (c.unstaged, "unstaged"), (c.untracked, "untracked"), (c.conflicted, "conflicted")];
    counts.into_iter().filter(|(n, _)| *n > 0).map(|(n, w)| format!("{n} {w}")).collect::<Vec<_>>().join(" · ")
}

/// How long before `now`, in one unit: `now`, `12 min`, `3 h`, `5 d`, `4 mo`, `2 y`.
pub fn age_at(t: SystemTime, now: SystemTime) -> String {
    let s = now.duration_since(t).unwrap_or_default().as_secs();
    match s {
        0..60 => "now".to_owned(),
        60..3600 => format!("{} min", s / 60),
        3600..86_400 => format!("{} h", s / 3600),
        86_400..5_184_000 => format!("{} d", s / 86_400),
        5_184_000..63_072_000 => format!("{} mo", s / 2_592_000),
        _ => format!("{} y", s / 31_536_000),
    }
}

/// How long ago, in one unit: `now`, `12 min`, `3 h`, `5 d`, `4 mo`, `2 y`.
pub fn age(t: SystemTime) -> String {
    age_at(t, SystemTime::now())
}

/// `now` or `12 min ago`, relative to `now`.
pub fn ago_at(t: SystemTime, now: SystemTime) -> String {
    match age_at(t, now).as_str() {
        "now" => "now".to_owned(),
        a => format!("{a} ago"),
    }
}

/// `now` or `12 min ago`.
pub fn ago(t: SystemTime) -> String {
    ago_at(t, SystemTime::now())
}

/// `2026-11-14 18:22` in the local time zone.
pub fn local_time(t: SystemTime) -> String {
    let secs = t.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let Ok(ts) = jiff::Timestamp::from_second(secs) else { return String::new() };
    let zoned = ts.to_zoned(jiff::tz::TimeZone::system());
    format!("{:04}-{:02}-{:02} {:02}:{:02}", zoned.year(), zoned.month(), zoned.day(), zoned.hour(), zoned.minute())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::repos::demo::demo_data;
    use crate::repos::query;

    #[test]
    fn ages() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_795_000_000);
        assert_eq!(age_at(now, now), "now");
        assert_eq!(ago_at(now, now), "now");
        assert_eq!(age_at(now - Duration::from_secs(125), now), "2 min");
        assert_eq!(ago_at(now - Duration::from_secs(125), now), "2 min ago");
        assert_eq!(age_at(now - Duration::from_secs(3 * 3600 + 5), now), "3 h");
        assert_eq!(age_at(now - Duration::from_secs(5 * 86_400), now), "5 d");
        assert_eq!(age_at(now - Duration::from_secs(90 * 86_400), now), "3 mo");
        assert_eq!(age_at(now - Duration::from_secs(800 * 86_400), now), "2 y");
    }

    #[test]
    fn local_time_formats() {
        let t = SystemTime::UNIX_EPOCH + Duration::from_secs(1_763_000_000);
        let s = local_time(t);
        assert_eq!(s.len(), 16);
        assert!(s.starts_with("2025-11-1"));
    }

    #[test]
    fn prefs_round_trip() {
        let p = Prefs {
            folder: vec!["Northstar".into(), "Products".into()],
            tag: String::new(),
            grouping: Grouping::Tag,
            density: Density::Compact,
            sort: Sort::Recent,
            descending: true,
            folded: ["folder/Northstar".to_owned()].into(),
        };
        let text = toml::to_string(&p).unwrap();
        let back: Prefs = toml::from_str(&text).unwrap();
        assert_eq!(back, p);
        assert_eq!(back.nav(), Nav::Folder(vec!["Northstar".into(), "Products".into()]));
        let tag = Prefs { tag: "uncommitted".into(), ..Prefs::default() };
        assert_eq!(tag.nav(), Nav::Tag("uncommitted".into()));
        let broken: Prefs = toml::from_str("grouping = \"sideways\"").unwrap_or_default();
        assert_eq!(broken, Prefs::default());
    }

    #[test]
    fn sorting_and_grouping_on_demo_snapshot() {
        let demo = demo_data();
        let all_name = shown(&demo.state.repos, &demo.index, &demo.organize, &Nav::All, &Query::All, Sort::Name, false);
        assert_eq!(all_name.len(), demo.state.repos.len());
        let names: Vec<&str> = all_name.iter().map(|&i| demo.state.repos[i].name.as_str()).collect();
        let mut sorted_names = names.clone();
        sorted_names.sort_by_key(|n| n.to_lowercase());
        assert_eq!(names, sorted_names);

        let recent_desc =
            shown(&demo.state.repos, &demo.index, &demo.organize, &Nav::All, &Query::All, Sort::Recent, true);
        let times: Vec<Option<SystemTime>> = recent_desc.iter().map(|&i| last_commit(&demo.state.repos[i])).collect();
        for pair in times.windows(2) {
            assert!(pair[0] >= pair[1]);
        }

        let q = query::parse("uncommitted").unwrap();
        let dirty = shown(&demo.state.repos, &demo.index, &demo.organize, &Nav::All, &q, Sort::Name, false);
        assert!(!dirty.is_empty());
        assert!(dirty.iter().all(|&i| demo.state.repos[i].stats().is_some_and(super::super::Stats::has_uncommitted)));

        let by_app = sections(
            &demo.state.repos,
            &demo.index,
            &demo.organize,
            &Nav::All,
            &Query::All,
            Grouping::App,
            Sort::Name,
            false,
        );
        assert!(by_app.len() >= 4);
        let by_tag = sections(
            &demo.state.repos,
            &demo.index,
            &demo.organize,
            &Nav::All,
            &Query::All,
            Grouping::Tag,
            Sort::Name,
            false,
        );
        assert!(by_tag.iter().any(|s| s.key == SectionKey::Tag(Some("product".into()))));
        let by_folder = sections(
            &demo.state.repos,
            &demo.index,
            &demo.organize,
            &Nav::All,
            &Query::All,
            Grouping::Folder,
            Sort::Name,
            false,
        );
        assert!(by_folder.iter().any(|s| s.title == "Northstar"));
    }

    #[test]
    fn changes_and_tag_labels() {
        let c = Changes { staged: 2, unstaged: 0, untracked: 3, conflicted: 1 };
        assert_eq!(changes_text(c), "2 staged · 3 untracked · 1 conflicted");
        assert_eq!(short_sha(Some("0123456789abcdef")), "0123456");
        let cfg = Config::defaults();
        assert_eq!(tag_label(&cfg, "app:rustrover"), "RustRover");
        assert_eq!(tag_label(&cfg, "lang:rust"), "rust");
        assert_eq!(tag_label(&cfg, "category:products-and-tools"), "Products and tools");
        assert_eq!(tag_label(&cfg, "uncommitted"), "uncommitted");
    }
}
