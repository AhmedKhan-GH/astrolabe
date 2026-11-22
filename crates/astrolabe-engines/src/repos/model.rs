//! Shared data: the settings, what discovery finds, what a read of a
//! repository returns, what GitHub and the remote checks report, and the
//! assembled row the window shows. Plain data with small helpers; no I/O.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

// ---------------------------------------------------------------------------
// IDEs

/// The JetBrains IDEs on this Mac.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Ide {
    CLion,
    WebStorm,
    PyCharm,
    RustRover,
    GoLand,
}

impl Ide {
    pub const ALL: [Ide; 5] = [Ide::CLion, Ide::WebStorm, Ide::PyCharm, Ide::RustRover, Ide::GoLand];

    /// The name shown in the window and passed to `open -a`.
    pub fn name(self) -> &'static str {
        match self {
            Ide::CLion => "CLion",
            Ide::WebStorm => "WebStorm",
            Ide::PyCharm => "PyCharm",
            Ide::RustRover => "RustRover",
            Ide::GoLand => "GoLand",
        }
    }

    /// Case-insensitive match on the name.
    pub fn from_name(name: &str) -> Option<Ide> {
        Ide::ALL.into_iter().find(|i| i.name().eq_ignore_ascii_case(name.trim()))
    }
}

// ---------------------------------------------------------------------------
// Tags

/// A tag as it is stored and compared: trimmed, lowercase, with each run of
/// whitespace written as one `-`. `"Machine  Learning "` is `machine-learning`.
pub fn tag_slug(text: &str) -> String {
    text.split_whitespace().map(str::to_lowercase).collect::<Vec<_>>().join("-")
}

// ---------------------------------------------------------------------------
// Settings

/// The category of read-only clones of other people's projects.
pub const THIRD_PARTY: &str = "Third party";

/// One folder that is scanned for repositories.
#[derive(Clone, Debug, PartialEq)]
pub struct Root {
    /// Absolute, with `~` expanded.
    pub path: PathBuf,
    /// The IDE of every repository under this root; None infers it from the project files.
    pub ide: Option<Ide>,
    /// The default category of repositories under this root.
    pub category: String,
    /// Whether a repository here whose GitHub remote the user cannot push to
    /// moves to [`THIRD_PARTY`].
    pub detect_third_party: bool,
}

/// A per-repository override from the settings.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Override {
    pub category: Option<String>,
    pub ide: Option<Ide>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub roots: Vec<Root>,
    /// Folder names never descended into or watched, such as `node_modules`.
    /// A `*` matches any run of characters (`cmake-build-*`).
    pub skip_names: Vec<String>,
    /// Absolute folders never descended into or listed.
    pub skip_paths: Vec<PathBuf>,
    /// Exact repository paths removed from the monitor; descendants remain discoverable.
    pub removed_repos: Vec<PathBuf>,
    /// Categories in display order, the defaults followed by the user's own.
    pub categories: Vec<String>,
    /// Keyed by the repository's absolute path.
    pub overrides: Vec<(PathBuf, Override)>,
    /// How often `git ls-remote` runs for each repository with an upstream.
    pub remote_check_minutes: u32,
}

// ---------------------------------------------------------------------------
// Discovery

/// Where a repository's IDE came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdeSource {
    Root,
    ProjectFile,
    Config,
    None,
}

/// A repository found under a root: a main working tree. Linked worktrees and
/// submodules are not repositories of their own here.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    /// The main working tree, canonical. This is the repository's id.
    pub path: PathBuf,
    /// The git directory: `<path>/.git`, or where a `.git` file points.
    pub git_dir: PathBuf,
    /// Index into `Config::roots`.
    pub root: usize,
    pub ide: Option<Ide>,
    pub ide_source: IdeSource,
    /// Languages from the project files, lowercase, such as `rust` or `python`; most likely first.
    pub langs: Vec<String>,
}

/// What a discovery pass returns.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Discovery {
    pub repos: Vec<Found>,
    /// Folders that could not be read, with the reason.
    pub errors: Vec<(PathBuf, String)>,
}

// ---------------------------------------------------------------------------
// A read of one repository

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Head {
    Branch(String),
    /// HEAD points at a commit, not a branch.
    Detached,
    /// A branch with no commits yet.
    Unborn(String),
}

impl Head {
    pub fn branch(&self) -> Option<&str> {
        match self {
            Head::Branch(b) | Head::Unborn(b) => Some(b),
            Head::Detached => None,
        }
    }
}

/// Uncommitted paths of one working tree, from `git status --porcelain=v2`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Changes {
    /// Paths with a change in the index (X of XY is not `.`).
    pub staged: u32,
    /// Paths with a change in the working tree (Y of XY is not `.`).
    pub unstaged: u32,
    /// `?` entries. With `--untracked-files=normal` an untracked folder counts once.
    pub untracked: u32,
    /// `u` entries.
    pub conflicted: u32,
}

impl Changes {
    pub fn is_clean(&self) -> bool {
        self.staged == 0 && self.unstaged == 0 && self.untracked == 0 && self.conflicted == 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    /// Full SHA.
    pub sha: String,
    /// Committer date.
    pub commit_time: SystemTime,
    pub author_time: SystemTime,
    pub subject: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stash {
    /// `stash@{n}`
    pub index: u32,
    pub time: Option<SystemTime>,
    pub subject: String,
}

/// A linked worktree (not the main one).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Worktree {
    pub path: PathBuf,
    pub head: Head,
    pub head_sha: Option<String>,
    /// None when the folder is missing.
    pub changes: Option<Changes>,
    pub oldest_change: Option<SystemTime>,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubmoduleState {
    /// Checked out at the recorded commit (` ` in `git submodule status`).
    Current,
    /// Checked out at another commit (`+`).
    Moved,
    /// Not initialised (`-`).
    Uninitialized,
    /// Merge conflicts (`U`).
    Conflict,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Submodule {
    /// Relative to the working tree.
    pub path: String,
    pub sha: String,
    pub state: SubmoduleState,
    /// Modified or untracked content inside, from the `S<c><m><u>` field of the
    /// parent's status (false when `.gitmodules` ignores it).
    pub dirty: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Remote {
    pub name: String,
    /// The fetch URL as configured.
    pub url: String,
}

/// Everything one read of a repository returns. Read-only git commands only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stats {
    pub head: Head,
    /// None on an unborn branch.
    pub head_sha: Option<String>,
    /// The upstream as git shows it, `origin/main`.
    pub upstream: Option<String>,
    /// The upstream's remote, `origin`.
    pub upstream_remote: Option<String>,
    /// The upstream's ref on the remote, `refs/heads/main`.
    pub upstream_ref: Option<String>,
    /// SHA of the local remote-tracking ref of the upstream, as of the last fetch.
    pub upstream_tip: Option<String>,
    /// Commits on HEAD not on the upstream, and the reverse. None without an upstream.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// Commits on HEAD not on any remote-tracking ref. None without remotes.
    pub unpushed: Option<u32>,
    /// Their SHAs, newest first, at most 2000, so totals can count a commit
    /// shared by copies of a repository once.
    pub unpushed_commits: Vec<String>,
    pub changes: Changes,
    /// The oldest modification time among the uncommitted paths that exist on disk.
    pub oldest_change: Option<SystemTime>,
    pub stashes: Vec<Stash>,
    pub worktrees: Vec<Worktree>,
    pub submodules: Vec<Submodule>,
    pub commits_total: u32,
    /// Commits on HEAD with a committer date in the last 7 and 30 days.
    pub commits_7d: u32,
    pub commits_30d: u32,
    /// SHA and committer date of each commit on HEAD from the last 30 days,
    /// newest first, so totals can count a commit shared by copies once.
    pub recent_commits: Vec<(String, SystemTime)>,
    pub last_commit: Option<Commit>,
    pub remotes: Vec<Remote>,
    /// Parentless commits reachable from HEAD, sorted.
    pub root_commits: Vec<String>,
    pub read_at: SystemTime,
    /// How long the read took.
    pub read_ms: u32,
}

impl Stats {
    /// The remote that stands for the repository: the upstream's remote, else
    /// `origin`, else the first.
    pub fn main_remote(&self) -> Option<&Remote> {
        let by_name = |n: &str| self.remotes.iter().find(|r| r.name == n);
        self.upstream_remote.as_deref().and_then(by_name).or_else(|| by_name("origin")).or(self.remotes.first())
    }

    /// Uncommitted work in the main working tree or any linked worktree.
    pub fn has_uncommitted(&self) -> bool {
        !self.changes.is_clean() || self.worktrees.iter().any(|w| w.changes.is_some_and(|c| !c.is_clean()))
    }
}

// ---------------------------------------------------------------------------
// Remotes

/// A remote URL split into host and path, `github.com` and `owner/name`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RemoteUrl {
    /// Lowercase.
    pub host: String,
    /// Without a leading `/` or a trailing `.git`; case kept.
    pub path: String,
}

/// What GitHub says about a repository, from `GET /repos/{owner}/{name}`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GhRepo {
    /// `owner/name` as GitHub spells it.
    pub full_name: String,
    pub private: bool,
    /// `public`, `private` or `internal`.
    pub visibility: String,
    /// `permissions.push`; None when GitHub sent no permissions (no token).
    pub can_push: Option<bool>,
    pub archived: bool,
    pub fork: bool,
    pub html_url: String,
    pub default_branch: String,
}

/// One repository returned by `GET /user/repos` for the authenticated account.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GhListedRepo {
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub private: bool,
    pub visibility: String,
    pub default_branch: String,
    pub pushed_at: Option<SystemTime>,
    pub html_url: String,
}

/// How a repository stands against its remote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Relation {
    /// No remote at all: not backed up.
    LocalOnly,
    Private,
    Public,
    /// A GitHub remote whose visibility is not known (yet, or not readable).
    GitHub,
    /// Another host, such as `git.overleaf.com`.
    OtherHost(String),
}

/// The result of one `git ls-remote` of the upstream branch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Tip {
    /// The remote branch is where the local remote-tracking ref says.
    Same,
    /// The remote branch has moved since the last fetch.
    Moved {
        remote_sha: String,
    },
    /// The branch is not on the remote.
    Missing,
    Failed(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteCheck {
    pub at: SystemTime,
    pub tip: Tip,
}

// ---------------------------------------------------------------------------
// Copies of the same repository

/// How two copies of the same repository differ, read in either one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CopyDiff {
    pub a: PathBuf,
    pub b: PathBuf,
    /// Commits on a's HEAD not on b's, and the reverse. None when neither
    /// copy has the other's HEAD commit.
    pub counts: Option<(u32, u32)>,
}

// ---------------------------------------------------------------------------
// The assembled row

/// One repository as the window shows it.
#[derive(Clone, Debug, PartialEq)]
pub struct Repo {
    pub found: Found,
    /// The folder name.
    pub name: String,
    pub ide: Option<Ide>,
    pub category: String,
    /// The latest read; None before the first one finishes.
    pub stats: Option<Result<Stats, String>>,
    pub relation: Relation,
    pub gh: Option<GhRepo>,
    pub check: Option<RemoteCheck>,
}

impl Repo {
    pub fn id(&self) -> &Path {
        &self.found.path
    }

    pub fn stats(&self) -> Option<&Stats> {
        self.stats.as_ref().and_then(|s| s.as_ref().ok())
    }

    pub fn error(&self) -> Option<&str> {
        self.stats.as_ref().and_then(|s| s.as_ref().err()).map(String::as_str)
    }

    /// Commits on no remote, for a repository that has one.
    pub fn unpushed(&self) -> u32 {
        if self.relation == Relation::LocalOnly {
            return 0;
        }
        self.stats().map_or(0, |s| s.unpushed.or(s.ahead).unwrap_or(0))
    }

    /// Behind its upstream, or its remote branch has moved since the last fetch.
    pub fn is_behind(&self) -> bool {
        self.stats().is_some_and(|s| s.behind.unwrap_or(0) > 0)
            || matches!(self.check.as_ref().map(|c| &c.tip), Some(Tip::Moved { .. }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_slugs() {
        assert_eq!(tag_slug("  Machine  Learning "), "machine-learning");
        assert_eq!(tag_slug("Northstar"), "northstar");
        assert_eq!(tag_slug("third-party"), "third-party");
        assert_eq!(tag_slug("Products and tools"), "products-and-tools");
        assert_eq!(tag_slug("   "), "");
    }
}
