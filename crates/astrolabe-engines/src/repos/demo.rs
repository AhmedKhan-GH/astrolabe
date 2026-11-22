//! Deterministic synthetic repository fixtures for `--demo` mode.
//!
//! All paths, repository names, branches, remotes, commits, tags, and folders
//! are completely fictional.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::aggregate::{self, Totals};
use super::engine::Msg;
use super::github::RateLimit;
use super::index::Index;
use super::model::{
    Changes, Commit, Config, CopyDiff, Discovery, Found, GhListedRepo, GhRepo, Head, Ide, IdeSource, Remote,
    RemoteCheck, Root, Stash, Stats, Submodule, SubmoduleState, THIRD_PARTY, Tip, Worktree,
};
use super::organize::{Folder, Organize};
use super::state::State;

/// Fixed anchor timestamp (2026-11-18T11:06:40Z) used by [`demo_data`] so
/// repeated calls return identical snapshots.
pub const DEMO_NOW_SECS: u64 = 1_795_000_000;

const MIN: u64 = 60;
const HOUR: u64 = 3600;
const DAY: u64 = 86_400;

/// A complete, self-consistent synthetic repository monitor snapshot.
#[derive(Clone, Debug, PartialEq)]
pub struct DemoData {
    pub now: SystemTime,
    pub state: State,
    pub organize: Organize,
    pub index: Index,
    pub totals: Totals,
}

/// Deterministic synthetic repository snapshot anchored at [`DEMO_NOW_SECS`].
pub fn demo_data() -> DemoData {
    demo_data_at(UNIX_EPOCH + Duration::from_secs(DEMO_NOW_SECS))
}

/// Deterministic synthetic repository snapshot anchored at `now`.
pub fn demo_data_at(now: SystemTime) -> DemoData {
    let ago = |secs: u64| now.checked_sub(Duration::from_secs(secs)).unwrap_or(UNIX_EPOCH);

    let config = Config {
        roots: vec![
            root("/demo/workspaces/rust", Some(Ide::RustRover), "Products and tools", true),
            root("/demo/workspaces/web", Some(Ide::WebStorm), "Products and tools", true),
            root("/demo/workspaces/go", Some(Ide::GoLand), "Products and tools", true),
            root("/demo/workspaces/python", Some(Ide::PyCharm), "Research", true),
            root("/demo/workspaces/cpp", Some(Ide::CLion), "Products and tools", true),
            root("/demo/workspaces/writing", None, "Academic", false),
        ],
        skip_names: vec!["node_modules".into(), "target".into(), "build".into(), ".venv".into()],
        skip_paths: vec![],
        removed_repos: vec![],
        categories: vec![
            "Products and tools".into(),
            "Research".into(),
            "Academic".into(),
            THIRD_PARTY.into(),
            "Archive".into(),
        ],
        overrides: vec![],
        remote_check_minutes: 5,
    };

    let p = |rel: &str| PathBuf::from(format!("/demo/workspaces/{rel}"));
    let sha = |hex_prefix: &str| format!("{hex_prefix:0<40}");

    let sextant_root = sha("1111aaaa");
    let sextant_head = sha("1111f001");
    let sextant_mirror_head = sha("1111f002");
    let compass_head = sha("2222b001");
    let harbor_head = sha("3333c001");
    let harbor_remote = sha("3333c009");
    let meridian_head = sha("4444d001");
    let aurora_head = sha("5555e001");
    let lantern_head = sha("6666f001");
    let fieldbook_head = sha("7777a001");
    let solstice_head = sha("8888b001");

    let found = vec![
        found_repo(p("cpp/aurora-kernels"), 4, Some(Ide::CLion), IdeSource::Root, &["cpp"]),
        found_repo(p("go/harbor-proxy"), 2, Some(Ide::GoLand), IdeSource::Root, &["go"]),
        found_repo(p("python/fresh-scratch"), 3, Some(Ide::PyCharm), IdeSource::Root, &["python"]),
        found_repo(p("python/meridian-sim"), 3, Some(Ide::PyCharm), IdeSource::Root, &["python"]),
        found_repo(p("rust/broken-archive"), 0, Some(Ide::RustRover), IdeSource::Root, &["rust"]),
        found_repo(p("rust/lantern-cli"), 0, Some(Ide::RustRover), IdeSource::Root, &["rust"]),
        found_repo(p("rust/sextant-core"), 0, Some(Ide::RustRover), IdeSource::Root, &["rust"]),
        found_repo(p("rust/sextant-core-mirror"), 0, Some(Ide::RustRover), IdeSource::Root, &["rust"]),
        found_repo(p("web/compass-ui"), 1, Some(Ide::WebStorm), IdeSource::Root, &["typescript"]),
        found_repo(p("web/solstice-docs"), 1, Some(Ide::WebStorm), IdeSource::Root, &["typescript"]),
        found_repo(p("writing/fieldbook-paper"), 5, None, IdeSource::None, &["latex"]),
    ];

    let mut state = State::new();
    state.apply(Msg::Config(Box::new(config), None));
    state.apply(Msg::Discovered(Discovery { repos: found, errors: vec![] }));
    state.apply(Msg::Watching(Ok(())));
    state.apply(Msg::Rate(RateLimit {
        remaining: Some(4820),
        limit: Some(5000),
        reset: Some(now + Duration::from_secs(2400)),
    }));

    // 1. sextant-core: in-sync private Rust repo with a clean linked worktree.
    let mut sextant = base_stats(now);
    sextant.head = Head::Branch("main".into());
    sextant.head_sha = Some(sextant_head.clone());
    sextant.upstream = Some("origin/main".into());
    sextant.upstream_remote = Some("origin".into());
    sextant.upstream_ref = Some("refs/heads/main".into());
    sextant.upstream_tip = Some(sextant_head.clone());
    sextant.ahead = Some(0);
    sextant.behind = Some(0);
    sextant.unpushed = Some(0);
    sextant.commits_total = 412;
    sextant.commits_7d = 9;
    sextant.commits_30d = 28;
    sextant.recent_commits = vec![
        (sextant_head.clone(), ago(35 * MIN)),
        (sha("1111e901"), ago(2 * DAY)),
        (sha("1111e902"), ago(12 * DAY)),
    ];
    sextant.last_commit = Some(Commit {
        sha: sextant_head.clone(),
        commit_time: ago(35 * MIN),
        author_time: ago(40 * MIN),
        subject: "Tighten lock-free index snapshot builder".into(),
    });
    sextant.remotes = vec![Remote { name: "origin".into(), url: "git@github.com:northstar-labs/sextant-core.git".into() }];
    sextant.root_commits = vec![sextant_root.clone()];
    sextant.worktrees = vec![Worktree {
        path: PathBuf::from("/demo/worktrees/sextant-vector"),
        head: Head::Branch("feat/vector-index".into()),
        head_sha: Some(sha("1111f110")),
        changes: Some(Changes::default()),
        oldest_change: None,
        locked: false,
        prunable: false,
    }];
    state.apply(Msg::Stats(p("rust/sextant-core"), Box::new(Ok(sextant))));
    state.apply(Msg::Check(p("rust/sextant-core"), RemoteCheck { at: ago(90), tip: Tip::Same }));
    state.apply(Msg::GitHub(
        "northstar-labs/sextant-core".into(),
        GhRepo {
            full_name: "northstar-labs/sextant-core".into(),
            private: true,
            visibility: "private".into(),
            can_push: Some(true),
            archived: false,
            fork: false,
            html_url: "https://github.com/northstar-labs/sextant-core".into(),
            default_branch: "main".into(),
        },
    ));

    // 2. sextant-core-mirror: second copy of sextant-core with local unpushed work.
    let mut mirror = base_stats(now);
    mirror.head = Head::Branch("bench/zero-copy".into());
    mirror.head_sha = Some(sextant_mirror_head.clone());
    mirror.unpushed = Some(2);
    mirror.unpushed_commits = vec![sextant_mirror_head.clone(), sha("1111f003")];
    mirror.commits_total = 413;
    mirror.commits_7d = 3;
    mirror.commits_30d = 29;
    mirror.recent_commits = vec![(sextant_mirror_head.clone(), ago(4 * HOUR)), (sha("1111e901"), ago(2 * DAY))];
    mirror.last_commit = Some(Commit {
        sha: sextant_mirror_head.clone(),
        commit_time: ago(4 * HOUR),
        author_time: ago(4 * HOUR),
        subject: "Benchmark zero-copy frame parser".into(),
    });
    mirror.remotes = vec![Remote { name: "origin".into(), url: "https://github.com/northstar-labs/sextant-core.git".into() }];
    mirror.root_commits = vec![sextant_root];
    state.apply(Msg::Stats(p("rust/sextant-core-mirror"), Box::new(Ok(mirror))));

    // 3. compass-ui: dirty, unpushed, stashed private TypeScript repo.
    let mut compass = base_stats(now);
    compass.head = Head::Branch("feat/timeline-zoom".into());
    compass.head_sha = Some(compass_head.clone());
    compass.upstream = Some("origin/feat/timeline-zoom".into());
    compass.upstream_remote = Some("origin".into());
    compass.upstream_ref = Some("refs/heads/feat/timeline-zoom".into());
    compass.upstream_tip = Some(sha("2222a999"));
    compass.ahead = Some(2);
    compass.behind = Some(0);
    compass.unpushed = Some(2);
    compass.unpushed_commits = vec![compass_head.clone(), sha("2222b000")];
    compass.changes = Changes { staged: 2, unstaged: 3, untracked: 1, conflicted: 0 };
    compass.oldest_change = Some(ago(3 * HOUR));
    compass.stashes = vec![
        Stash { index: 0, time: Some(ago(18 * HOUR)), subject: "WIP on feat/timeline-zoom: brush preview".into() },
        Stash { index: 1, time: Some(ago(6 * DAY)), subject: "On main: keyboard shortcuts draft".into() },
    ];
    compass.commits_total = 198;
    compass.commits_7d = 5;
    compass.commits_30d = 17;
    compass.recent_commits = vec![(compass_head.clone(), ago(2 * HOUR)), (sha("2222b000"), ago(5 * HOUR))];
    compass.last_commit = Some(Commit {
        sha: compass_head.clone(),
        commit_time: ago(2 * HOUR),
        author_time: ago(2 * HOUR),
        subject: "Add logarithmic zoom ticks to timeline ruler".into(),
    });
    compass.remotes = vec![Remote { name: "origin".into(), url: "https://github.com/northstar-labs/compass-ui".into() }];
    compass.root_commits = vec![sha("22220000")];
    state.apply(Msg::Stats(p("web/compass-ui"), Box::new(Ok(compass))));
    state.apply(Msg::Check(p("web/compass-ui"), RemoteCheck { at: ago(120), tip: Tip::Same }));
    state.apply(Msg::GitHub(
        "northstar-labs/compass-ui".into(),
        GhRepo {
            full_name: "northstar-labs/compass-ui".into(),
            private: true,
            visibility: "private".into(),
            can_push: Some(true),
            archived: false,
            fork: false,
            html_url: "https://github.com/northstar-labs/compass-ui".into(),
            default_branch: "main".into(),
        },
    ));

    // 4. harbor-proxy: behind + moved remote tip + moved/dirty submodule.
    let mut harbor = base_stats(now);
    harbor.head = Head::Branch("main".into());
    harbor.head_sha = Some(harbor_head.clone());
    harbor.upstream = Some("origin/main".into());
    harbor.upstream_remote = Some("origin".into());
    harbor.upstream_ref = Some("refs/heads/main".into());
    harbor.upstream_tip = Some(sha("3333c004"));
    harbor.ahead = Some(0);
    harbor.behind = Some(3);
    harbor.unpushed = Some(0);
    harbor.submodules = vec![Submodule {
        path: "proto/wire-spec".into(),
        sha: sha("33339999"),
        state: SubmoduleState::Moved,
        dirty: true,
    }];
    harbor.commits_total = 284;
    harbor.commits_7d = 2;
    harbor.commits_30d = 11;
    harbor.recent_commits = vec![(harbor_head.clone(), ago(3 * DAY))];
    harbor.last_commit = Some(Commit {
        sha: harbor_head.clone(),
        commit_time: ago(3 * DAY),
        author_time: ago(3 * DAY),
        subject: "Enforce idle timeout on upstream TLS pools".into(),
    });
    harbor.remotes = vec![Remote { name: "origin".into(), url: "git@github.com:northstar-labs/harbor-proxy.git".into() }];
    harbor.root_commits = vec![sha("33330000")];
    state.apply(Msg::Stats(p("go/harbor-proxy"), Box::new(Ok(harbor))));
    state.apply(Msg::Check(
        p("go/harbor-proxy"),
        RemoteCheck { at: ago(95), tip: Tip::Moved { remote_sha: harbor_remote } },
    ));
    state.apply(Msg::GitHub(
        "northstar-labs/harbor-proxy".into(),
        GhRepo {
            full_name: "northstar-labs/harbor-proxy".into(),
            private: false,
            visibility: "public".into(),
            can_push: Some(true),
            archived: false,
            fork: false,
            html_url: "https://github.com/northstar-labs/harbor-proxy".into(),
            default_branch: "main".into(),
        },
    ));

    // 5. meridian-sim: local-only Python research repo, stale + uncommitted.
    let mut meridian = base_stats(now);
    meridian.head = Head::Branch("experiment/bayesian-grid".into());
    meridian.head_sha = Some(meridian_head.clone());
    meridian.changes = Changes { staged: 0, unstaged: 4, untracked: 2, conflicted: 0 };
    meridian.oldest_change = Some(ago(42 * DAY));
    meridian.commits_total = 63;
    meridian.last_commit = Some(Commit {
        sha: meridian_head.clone(),
        commit_time: ago(45 * DAY),
        author_time: ago(45 * DAY),
        subject: "Compare adaptive grid quadrature convergence".into(),
    });
    meridian.root_commits = vec![sha("44440000")];
    state.apply(Msg::Stats(p("python/meridian-sim"), Box::new(Ok(meridian))));

    // 6. aurora-kernels: public third-party C++ clone (can_push = false).
    let mut aurora = base_stats(now);
    aurora.head = Head::Branch("main".into());
    aurora.head_sha = Some(aurora_head.clone());
    aurora.upstream = Some("origin/main".into());
    aurora.upstream_remote = Some("origin".into());
    aurora.upstream_ref = Some("refs/heads/main".into());
    aurora.upstream_tip = Some(aurora_head.clone());
    aurora.ahead = Some(0);
    aurora.behind = Some(0);
    aurora.unpushed = Some(0);
    aurora.commits_total = 1420;
    aurora.commits_7d = 4;
    aurora.commits_30d = 19;
    aurora.recent_commits = vec![(aurora_head.clone(), ago(DAY))];
    aurora.last_commit = Some(Commit {
        sha: aurora_head.clone(),
        commit_time: ago(DAY),
        author_time: ago(DAY),
        subject: "Optimize tiled matrix reduction on Apple Silicon".into(),
    });
    aurora.remotes = vec![Remote { name: "origin".into(), url: "https://github.com/open-forge/aurora-kernels.git".into() }];
    aurora.root_commits = vec![sha("55550000")];
    state.apply(Msg::Stats(p("cpp/aurora-kernels"), Box::new(Ok(aurora))));
    state.apply(Msg::Check(p("cpp/aurora-kernels"), RemoteCheck { at: ago(110), tip: Tip::Same }));
    state.apply(Msg::GitHub(
        "open-forge/aurora-kernels".into(),
        GhRepo {
            full_name: "open-forge/aurora-kernels".into(),
            private: false,
            visibility: "public".into(),
            can_push: Some(false),
            archived: false,
            fork: false,
            html_url: "https://github.com/open-forge/aurora-kernels".into(),
            default_branch: "main".into(),
        },
    ));

    // 7. lantern-cli: detached HEAD, merge conflict, missing remote branch.
    let mut lantern = base_stats(now);
    lantern.head = Head::Detached;
    lantern.head_sha = Some(lantern_head.clone());
    lantern.upstream = Some("origin/release-0.4".into());
    lantern.upstream_remote = Some("origin".into());
    lantern.upstream_ref = Some("refs/heads/release-0.4".into());
    lantern.changes = Changes { staged: 1, unstaged: 0, untracked: 0, conflicted: 1 };
    lantern.oldest_change = Some(ago(14 * HOUR));
    lantern.unpushed = Some(1);
    lantern.unpushed_commits = vec![lantern_head.clone()];
    lantern.commits_total = 95;
    lantern.commits_7d = 1;
    lantern.commits_30d = 6;
    lantern.recent_commits = vec![(lantern_head.clone(), ago(15 * HOUR))];
    lantern.last_commit = Some(Commit {
        sha: lantern_head.clone(),
        commit_time: ago(15 * HOUR),
        author_time: ago(15 * HOUR),
        subject: "Add JSON output mode for diagnostics".into(),
    });
    lantern.remotes = vec![Remote { name: "origin".into(), url: "https://github.com/northstar-labs/lantern-cli".into() }];
    lantern.root_commits = vec![sha("66660000")];
    state.apply(Msg::Stats(p("rust/lantern-cli"), Box::new(Ok(lantern))));
    state.apply(Msg::Check(p("rust/lantern-cli"), RemoteCheck { at: ago(100), tip: Tip::Missing }));

    // 8. fresh-scratch: unborn local-only repository.
    let mut fresh = base_stats(now);
    fresh.head = Head::Unborn("main".into());
    fresh.changes = Changes { staged: 0, unstaged: 0, untracked: 2, conflicted: 0 };
    fresh.oldest_change = Some(ago(20 * MIN));
    state.apply(Msg::Stats(p("python/fresh-scratch"), Box::new(Ok(fresh))));

    // 9. fieldbook-paper: non-GitHub host, stale.
    let mut fieldbook = base_stats(now);
    fieldbook.head = Head::Branch("master".into());
    fieldbook.head_sha = Some(fieldbook_head.clone());
    fieldbook.upstream = Some("origin/master".into());
    fieldbook.upstream_remote = Some("origin".into());
    fieldbook.upstream_ref = Some("refs/heads/master".into());
    fieldbook.upstream_tip = Some(fieldbook_head.clone());
    fieldbook.ahead = Some(0);
    fieldbook.behind = Some(0);
    fieldbook.unpushed = Some(0);
    fieldbook.commits_total = 31;
    fieldbook.last_commit = Some(Commit {
        sha: fieldbook_head.clone(),
        commit_time: ago(55 * DAY),
        author_time: ago(55 * DAY),
        subject: "Revise appendix proofs for camera-ready draft".into(),
    });
    fieldbook.remotes =
        vec![Remote { name: "origin".into(), url: "https://git.overleaf.example/0123456789abcdef01234567".into() }];
    fieldbook.root_commits = vec![sha("77770000")];
    state.apply(Msg::Stats(p("writing/fieldbook-paper"), Box::new(Ok(fieldbook))));

    // 10. solstice-docs: archived public fork.
    let mut solstice = base_stats(now);
    solstice.head = Head::Branch("main".into());
    solstice.head_sha = Some(solstice_head.clone());
    solstice.upstream = Some("origin/main".into());
    solstice.upstream_remote = Some("origin".into());
    solstice.upstream_ref = Some("refs/heads/main".into());
    solstice.upstream_tip = Some(solstice_head.clone());
    solstice.ahead = Some(0);
    solstice.behind = Some(0);
    solstice.unpushed = Some(0);
    solstice.commits_total = 54;
    solstice.last_commit = Some(Commit {
        sha: solstice_head.clone(),
        commit_time: ago(90 * DAY),
        author_time: ago(90 * DAY),
        subject: "Freeze documentation for v1 release".into(),
    });
    solstice.remotes = vec![Remote { name: "origin".into(), url: "https://github.com/example-org/solstice-docs".into() }];
    solstice.root_commits = vec![sha("88880000")];
    state.apply(Msg::Stats(p("web/solstice-docs"), Box::new(Ok(solstice))));
    state.apply(Msg::GitHub(
        "example-org/solstice-docs".into(),
        GhRepo {
            full_name: "example-org/solstice-docs".into(),
            private: false,
            visibility: "public".into(),
            can_push: Some(true),
            archived: true,
            fork: true,
            html_url: "https://github.com/example-org/solstice-docs".into(),
            default_branch: "main".into(),
        },
    ));

    // 11. broken-archive: unreadable repo.
    state.apply(Msg::Stats(
        p("rust/broken-archive"),
        Box::new(Err("fatal: not a git repository (or any of the parent directories): .git".into())),
    ));

    state.apply(Msg::Copies(vec![CopyDiff {
        a: p("rust/sextant-core"),
        b: p("rust/sextant-core-mirror"),
        counts: Some((1, 2)),
    }]));
    state.apply(Msg::GitHubList(vec![
        // Cloned locally (matched against local remotes and excluded from remote_only).
        listed_repo("northstar-labs", "sextant-core", true, "private", "main", Some(ago(35 * MIN))),
        listed_repo("northstar-labs", "compass-ui", true, "private", "main", Some(ago(2 * HOUR))),
        listed_repo("northstar-labs", "harbor-proxy", false, "public", "main", Some(ago(3 * DAY))),
        listed_repo("northstar-labs", "lantern-cli", true, "private", "main", Some(ago(15 * HOUR))),
        listed_repo("example-org", "solstice-docs", false, "public", "main", Some(ago(90 * DAY))),
        // Remote-only repositories (no local clone on this Mac).
        listed_repo("northstar-labs", "orbit-scheduler", true, "private", "main", Some(ago(3 * HOUR))),
        listed_repo("northstar-labs", "beacon-telemetry", false, "public", "main", Some(ago(2 * DAY))),
        listed_repo("cobalt-systems", "kestrel-proto", true, "internal", "trunk", Some(ago(11 * DAY))),
        listed_repo("example-org", "astrolabe-spec", false, "public", "main", Some(ago(48 * DAY))),
    ]));
    state.settle();

    let mut organize = Organize::default();
    organize.unused_tags.insert("ideas".into());
    organize
        .tags
        .insert("github.com/northstar-labs/sextant-core#sextant-core".into(), vec!["northstar".into(), "product".into()]);
    organize.tags.insert("github.com/northstar-labs/compass-ui".into(), vec!["northstar".into(), "product".into()]);
    organize.tags.insert("github.com/northstar-labs/harbor-proxy".into(), vec!["northstar".into(), "infra".into()]);
    organize.tags.insert("github.com/northstar-labs/lantern-cli".into(), vec!["tool".into()]);
    organize.tags.insert("/demo/workspaces/python/meridian-sim".into(), vec!["simulation".into()]);

    organize.folders = vec![
        Folder {
            name: "Northstar".into(),
            query: "northstar".into(),
            repos: vec![],
            exclude: vec![],
            folders: vec![Folder {
                name: "Products".into(),
                query: "product -third-party".into(),
                repos: vec![],
                exclude: vec![],
                folders: vec![],
            }],
        },
        Folder {
            name: "Needs attention".into(),
            query: "uncommitted OR unpushed OR behind".into(),
            repos: vec![],
            exclude: vec!["/demo/workspaces/python/fresh-scratch".into()],
            folders: vec![],
        },
        Folder {
            name: "Forgotten work".into(),
            query: "uncommitted stale".into(),
            repos: vec![],
            exclude: vec![],
            folders: vec![],
        },
    ];

    let index = Index::build(&state.repos, &organize, now);
    let totals = aggregate::totals(state.repos.iter(), now);

    DemoData { now, state, organize, index, totals }
}

fn root(path: &str, ide: Option<Ide>, category: &str, detect_third_party: bool) -> Root {
    Root { path: PathBuf::from(path), ide, category: category.into(), detect_third_party }
}

fn found_repo(path: PathBuf, root: usize, ide: Option<Ide>, ide_source: IdeSource, langs: &[&str]) -> Found {
    let git_dir = path.join(".git");
    Found { path, git_dir, root, ide, ide_source, langs: langs.iter().map(|s| (*s).to_owned()).collect() }
}

fn listed_repo(
    owner: &str,
    name: &str,
    private: bool,
    visibility: &str,
    default_branch: &str,
    pushed_at: Option<SystemTime>,
) -> GhListedRepo {
    let full_name = format!("{owner}/{name}");
    GhListedRepo {
        html_url: format!("https://github.com/{full_name}"),
        full_name,
        name: name.to_owned(),
        owner: owner.to_owned(),
        private,
        visibility: visibility.to_owned(),
        default_branch: default_branch.to_owned(),
        pushed_at,
    }
}

fn base_stats(now: SystemTime) -> Stats {
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
        read_at: now,
        read_ms: 14,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::view::{Flag, flags};

    #[test]
    fn demo_data_is_deterministic_and_rich() {
        let a = demo_data();
        let b = demo_data();
        assert_eq!(a, b);
        assert_eq!(a.state.repos.len(), 11);
        assert_eq!(a.state.remote_only.len(), 4);
        assert_eq!(a.index.auto_counts.get("location:local-only"), Some(&2));
        assert_eq!(a.index.auto_counts.get("location:both"), Some(&7));
        assert!(a.state.discovered);
        assert_eq!(a.state.unreadable().len(), 1);
        assert_eq!(a.state.groups.len(), 1);
        assert_eq!(a.state.groups[0].len(), 2);
        assert_eq!(
            a.state.copy_counts(
                std::path::Path::new("/demo/workspaces/rust/sextant-core"),
                std::path::Path::new("/demo/workspaces/rust/sextant-core-mirror"),
            ),
            Some(Some((1, 2)))
        );
        assert!(a.totals.uncommitted >= 3);
        assert!(a.totals.unpushed >= 5);
        assert!(a.totals.behind >= 1);
        assert!(a.totals.local_only >= 2);
        assert!(a.totals.stalest.is_some());
        // Verify all major status flags are represented across the synthetic fleet.
        let all_flags: Vec<Flag> = a.state.repos.iter().flat_map(flags).collect();
        for expected in [
            Flag::Unreadable,
            Flag::LocalOnly,
            Flag::NotOnRemote,
            Flag::Uncommitted,
            Flag::Unpushed,
            Flag::Behind,
            Flag::Moved,
            Flag::InSync,
        ] {
            assert!(all_flags.contains(&expected), "missing demo flag {expected:?}");
        }
        // Smart folders resolve cleanly without parse errors.
        assert!(a.index.errors.is_empty());
        assert!(a.index.folder_count(&[0]) >= 3);
        assert!(a.index.folder_count(&[2]) >= 1);
    }
}
