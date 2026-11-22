//! Totals over a set of repositories, and the stalest uncommitted work among
//! them. Pure counting; no I/O.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use super::model::{Relation, Repo, Tip};

const DAY: Duration = Duration::from_secs(86_400);

/// The counts for one group of repositories.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Totals {
    pub repos: u32,
    pub local_only: u32,
    pub private: u32,
    pub public: u32,
    /// A GitHub remote of unknown visibility, or another host.
    pub other: u32,
    /// No stats yet, or a read error.
    pub unread: u32,
    /// Repositories with uncommitted work.
    pub uncommitted: u32,
    /// Commits on no remote, each shared commit counted once.
    pub unpushed: u32,
    /// Repositories behind their upstream or whose remote branch has moved.
    pub behind: u32,
    pub commits_7d: u32,
    pub commits_30d: u32,
    /// The oldest uncommitted change in the group.
    pub stalest: Option<(PathBuf, SystemTime)>,
}

/// The oldest change in a repository's main working tree and its worktrees, when it has uncommitted work.
pub fn stalest_of(repo: &Repo) -> Option<SystemTime> {
    let stats = repo.stats().filter(|s| s.has_uncommitted())?;
    stats.worktrees.iter().filter_map(|w| w.oldest_change).chain(stats.oldest_change).min()
}

/// The counts for any set of repositories.
pub fn totals<'a>(repos: impl Iterator<Item = &'a Repo>, now: SystemTime) -> Totals {
    let mut t = Totals::default();
    let (mut unpushed, mut r7, mut r30) = (HashSet::new(), HashSet::new(), HashSet::new());
    for repo in repos {
        t.repos += 1;
        match &repo.relation {
            Relation::LocalOnly => t.local_only += 1,
            Relation::Private => t.private += 1,
            Relation::Public => t.public += 1,
            Relation::GitHub | Relation::OtherHost(_) => t.other += 1,
        }
        let Some(stats) = repo.stats() else {
            t.unread += 1;
            continue;
        };
        if stats.has_uncommitted() {
            t.uncommitted += 1;
        }
        if repo.relation != Relation::LocalOnly {
            unpushed.extend(stats.unpushed_commits.iter().map(String::as_str));
            let excess = stats.unpushed.unwrap_or(0).saturating_sub(stats.unpushed_commits.len() as u32);
            t.unpushed += excess;
        }
        if stats.behind.unwrap_or(0) > 0 || repo.check.as_ref().is_some_and(|c| matches!(c.tip, Tip::Moved { .. })) {
            t.behind += 1;
        }
        for (sha, time) in &stats.recent_commits {
            let age = now.duration_since(*time).unwrap_or_default();
            if age <= 7 * DAY {
                r7.insert(sha.as_str());
            }
            if age <= 30 * DAY {
                r30.insert(sha.as_str());
            }
        }
        if let Some(time) = stalest_of(repo)
            && t.stalest.as_ref().is_none_or(|(_, old)| time < *old)
        {
            t.stalest = Some((repo.id().to_path_buf(), time));
        }
    }
    t.unpushed += unpushed.len() as u32;
    t.commits_7d = r7.len() as u32;
    t.commits_30d = r30.len() as u32;
    t
}

/// The repositories with the oldest uncommitted changes, oldest first, at most `n`.
pub fn stalest<'a>(repos: impl Iterator<Item = &'a Repo>, n: usize) -> Vec<(&'a Repo, SystemTime)> {
    let mut list: Vec<(&Repo, SystemTime)> = repos.filter_map(|r| Some((r, stalest_of(r)?))).collect();
    list.sort_by_key(|(_, t)| *t);
    list.truncate(n);
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::model::{Changes, Found, Head, Ide, IdeSource, RemoteCheck, Stats, Worktree};

    fn at(days_ago: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(100 * 86_400 - days_ago * 86_400)
    }

    fn now() -> SystemTime {
        at(0)
    }

    fn stats() -> Stats {
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
            remotes: vec![],
            root_commits: vec![],
            read_at: SystemTime::UNIX_EPOCH,
            read_ms: 0,
        }
    }

    fn repo(path: &str, ide: Option<Ide>, category: &str, relation: Relation, stats: Stats) -> Repo {
        Repo {
            found: Found {
                path: path.into(),
                git_dir: PathBuf::from(path).join(".git"),
                root: 0,
                ide,
                ide_source: IdeSource::None,
                langs: Vec::new(),
            },
            name: path.into(),
            ide,
            category: category.into(),
            stats: Some(Ok(stats)),
            relation,
            gh: None,
            check: None,
        }
    }

    fn dirty(days_ago: u64) -> Stats {
        let mut s = stats();
        s.changes.unstaged = 1;
        s.oldest_change = Some(at(days_ago));
        s
    }

    #[test]
    fn counts_relations_and_unread() {
        let mut broken = repo("/e", None, "A", Relation::Private, stats());
        broken.stats = Some(Err("bad".into()));
        let mut pending = repo("/p", None, "A", Relation::LocalOnly, stats());
        pending.stats = None;
        let repos = [
            repo("/a", None, "A", Relation::LocalOnly, dirty(3)),
            repo("/b", None, "A", Relation::Public, stats()),
            repo("/c", None, "A", Relation::GitHub, stats()),
            repo("/d", None, "A", Relation::OtherHost("x".into()), stats()),
            broken,
            pending,
        ];
        let t = totals(repos.iter(), now());
        assert_eq!((t.repos, t.local_only, t.private, t.public, t.other, t.unread), (6, 2, 1, 1, 2, 2));
        assert_eq!(t.uncommitted, 1);
    }

    #[test]
    fn dedups_unpushed_and_recent_across_copies() {
        let shared = |extra: &str| {
            let mut s = stats();
            s.unpushed = Some(2);
            s.unpushed_commits = vec!["s1".into(), extra.into()];
            s.recent_commits = vec![("c1".into(), at(1)), (format!("n{extra}"), at(20)), ("old".into(), at(40))];
            s
        };
        let mut over = stats();
        over.unpushed = Some(5);
        over.unpushed_commits = vec!["s1".into()];
        let mut local = stats();
        local.unpushed = Some(9);
        local.unpushed_commits = vec!["l1".into()];
        let repos = [
            repo("/a", Some(Ide::CLion), "A", Relation::Private, shared("x")),
            repo("/b", Some(Ide::PyCharm), "A", Relation::Private, shared("y")),
            repo("/c", Some(Ide::CLion), "B", Relation::Private, over),
            repo("/d", Some(Ide::CLion), "B", Relation::LocalOnly, local),
        ];
        let all = totals(repos.iter(), now());
        // s1, x, y, plus 4 excess commits of /c.
        assert_eq!(all.unpushed, 3 + 4);
        assert_eq!((all.commits_7d, all.commits_30d), (1, 3));
        let clion = totals(repos.iter().filter(|r| r.ide == Some(Ide::CLion)), now());
        assert_eq!(clion.unpushed, 2 + 4);
        let a = totals(repos.iter().filter(|r| r.category == "A"), now());
        assert_eq!(a.unpushed, 3);
        assert_eq!(a.commits_30d, 3);
    }

    #[test]
    fn behind_counts_repos() {
        let mut a = stats();
        a.behind = Some(2);
        let mut moved = repo("/m", None, "A", Relation::Private, stats());
        moved.check = Some(RemoteCheck { at: now(), tip: Tip::Moved { remote_sha: "z".into() } });
        let mut same = repo("/s", None, "A", Relation::Private, stats());
        same.check = Some(RemoteCheck { at: now(), tip: Tip::Same });
        let repos = [repo("/a", None, "A", Relation::Private, a), moved, same];
        assert_eq!(totals(repos.iter(), now()).behind, 2);
    }

    #[test]
    fn stalest_ordering() {
        let mut with_wt = stats();
        with_wt.changes.staged = 1;
        with_wt.oldest_change = Some(at(5));
        with_wt.worktrees.push(Worktree {
            path: "/wt".into(),
            head: Head::Detached,
            head_sha: None,
            changes: Some(Changes { untracked: 1, ..Changes::default() }),
            oldest_change: Some(at(20)),
            locked: false,
            prunable: false,
        });
        let mut clean_old = stats();
        clean_old.oldest_change = Some(at(90));
        let repos = [
            repo("/a", Some(Ide::CLion), "A", Relation::LocalOnly, dirty(10)),
            repo("/b", Some(Ide::CLion), "B", Relation::LocalOnly, with_wt),
            repo("/c", Some(Ide::CLion), "B", Relation::LocalOnly, clean_old),
            repo("/d", Some(Ide::CLion), "B", Relation::LocalOnly, dirty(2)),
        ];
        let list: Vec<(PathBuf, SystemTime)> =
            stalest(repos.iter(), 2).into_iter().map(|(r, t)| (r.id().to_path_buf(), t)).collect();
        assert_eq!(list, vec![(PathBuf::from("/b"), at(20)), (PathBuf::from("/a"), at(10))]);
        assert_eq!(totals(repos.iter(), now()).stalest, Some((PathBuf::from("/b"), at(20))));
        let a = totals(repos.iter().filter(|r| r.category == "A"), now());
        assert_eq!(a.stalest, Some((PathBuf::from("/a"), at(10))));
        let b = totals(repos.iter().filter(|r| r.category == "B"), now());
        assert_eq!(b.stalest, Some((PathBuf::from("/b"), at(20))));
    }
}
