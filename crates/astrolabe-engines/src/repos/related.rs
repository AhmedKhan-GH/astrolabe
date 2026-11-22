//! Copies of the same repository, found by a shared remote or a shared root
//! commit. Pure grouping; no I/O.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::model::Repo;
use super::remote::{copy_key, parse_url};

fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// Groups of two or more copies of one repository, members and groups sorted by path.
pub fn groups(repos: &[Repo]) -> Vec<Vec<PathBuf>> {
    let mut parent: Vec<usize> = (0..repos.len()).collect();
    let mut seen: HashMap<String, usize> = HashMap::new();
    for (i, repo) in repos.iter().enumerate() {
        let Some(stats) = repo.stats() else { continue };
        let url = stats.main_remote().and_then(|r| parse_url(&r.url)).map(|u| format!("url:{}", copy_key(&u)));
        let roots = stats.root_commits.iter().map(|c| format!("root:{c}"));
        for key in url.into_iter().chain(roots) {
            let first = *seen.entry(key).or_insert(i);
            let (a, b) = (find(&mut parent, first), find(&mut parent, i));
            if a != b {
                parent[b] = a;
            }
        }
    }
    let mut by_root: HashMap<usize, Vec<PathBuf>> = HashMap::new();
    for (i, repo) in repos.iter().enumerate() {
        if repo.stats().is_some() {
            let r = find(&mut parent, i);
            by_root.entry(r).or_default().push(repo.id().to_path_buf());
        }
    }
    let mut out: Vec<Vec<PathBuf>> = by_root.into_values().filter(|g| g.len() > 1).collect();
    for g in &mut out {
        g.sort();
    }
    out.sort();
    out
}

/// The other members of the group that holds `id`, or none.
pub fn related_to(groups: &[Vec<PathBuf>], id: &Path) -> Vec<PathBuf> {
    groups
        .iter()
        .find(|g| g.iter().any(|p| p == id))
        .map(|g| g.iter().filter(|p| *p != id).cloned().collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::model::{Changes, Found, Head, IdeSource, Relation, Remote, Stats};
    use std::time::SystemTime;

    fn repo(path: &str, url: Option<&str>, roots: &[&str]) -> Repo {
        let stats = Stats {
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
            remotes: url.map(|u| Remote { name: "origin".into(), url: u.into() }).into_iter().collect(),
            root_commits: roots.iter().map(|r| r.to_string()).collect(),
            read_at: SystemTime::UNIX_EPOCH,
            read_ms: 0,
        };
        Repo {
            found: Found {
                path: path.into(),
                git_dir: PathBuf::from(path).join(".git"),
                root: 0,
                ide: None,
                ide_source: IdeSource::None,
                langs: Vec::new(),
            },
            name: path.into(),
            ide: None,
            category: String::new(),
            stats: Some(Ok(stats)),
            relation: Relation::LocalOnly,
            gh: None,
            check: None,
        }
    }

    fn paths(g: &[&[&str]]) -> Vec<Vec<PathBuf>> {
        g.iter().map(|m| m.iter().map(PathBuf::from).collect()).collect()
    }

    #[test]
    fn groups_by_url() {
        let repos = [
            repo("/b", Some("git@github.com:O/R.git"), &[]),
            repo("/a", Some("https://github.com/o/r"), &[]),
            repo("/c", Some("https://github.com/o/other"), &[]),
        ];
        assert_eq!(groups(&repos), paths(&[&["/a", "/b"]]));
    }

    #[test]
    fn groups_by_root_commit() {
        let repos = [
            repo("/a", None, &["r1"]),
            repo("/b", Some("https://x.org/b/b"), &["r0", "r1"]),
            repo("/c", None, &["r2"]),
        ];
        assert_eq!(groups(&repos), paths(&[&["/a", "/b"]]));
    }

    #[test]
    fn groups_transitively() {
        let repos = [
            repo("/a", Some("https://x.org/p/q"), &[]),
            repo("/b", Some("https://x.org/p/q"), &["r1"]),
            repo("/c", None, &["r1"]),
            repo("/d", Some("https://y.org/z/z"), &[]),
            repo("/e", Some("https://y.org/z/z"), &[]),
        ];
        assert_eq!(groups(&repos), paths(&[&["/a", "/b", "/c"], &["/d", "/e"]]));
    }

    #[test]
    fn no_group_without_remote_or_root() {
        let mut unread = repo("/u", Some("https://x.org/p/q"), &[]);
        unread.stats = None;
        let repos = [repo("/a", None, &[]), repo("/b", None, &[]), repo("/c", Some("https://x.org/p/q"), &[]), unread];
        assert!(groups(&repos).is_empty());
    }

    #[test]
    fn related_members() {
        let g = paths(&[&["/a", "/b", "/c"], &["/d", "/e"]]);
        assert_eq!(related_to(&g, Path::new("/b")), vec![PathBuf::from("/a"), PathBuf::from("/c")]);
        assert_eq!(related_to(&g, Path::new("/e")), vec![PathBuf::from("/d")]);
        assert!(related_to(&g, Path::new("/z")).is_empty());
    }
}
