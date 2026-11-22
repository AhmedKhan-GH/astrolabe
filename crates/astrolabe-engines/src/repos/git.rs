//! The read-only git reader: one full read of a repository, a remote tip
//! check and a commit comparison, all through the git command line with
//! optional locks off so no repository file is ever written.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime};

use super::model::{Changes, Commit, Head, Remote, Stash, Stats, Submodule, SubmoduleState, Worktree};

const TIMEOUT: Duration = Duration::from_secs(30);
const REMOTE_TIMEOUT: Duration = Duration::from_secs(20);
/// How many unpushed commit SHAs are kept.
const UNPUSHED_CAP: usize = 2000;
/// How many uncommitted paths are examined for their modification time.
const STAT_CAP: usize = 5000;
const DAY: u64 = 24 * 60 * 60;

/// A git that won't pop up the Command Line Tools installer: Homebrew's, or
/// /usr/bin/git when the developer tools are installed.
fn git_path() -> Option<&'static Path> {
    static GIT: OnceLock<Option<PathBuf>> = OnceLock::new();
    GIT.get_or_init(|| {
        for p in ["/opt/homebrew/bin/git", "/usr/local/bin/git"] {
            if Path::new(p).exists() {
                return Some(PathBuf::from(p));
            }
        }
        let tools = Command::new("/usr/bin/xcode-select").arg("-p").output().ok()?;
        tools.status.success().then(|| PathBuf::from("/usr/bin/git"))
    })
    .as_deref()
}

/// Whether a usable git exists.
pub fn available() -> bool {
    git_path().is_some()
}

/// Run a read-only git command in `dir` and return its standard output.
fn git(dir: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    git_env(dir, args, timeout, &[])
}

fn git_env(dir: &Path, args: &[&str], timeout: Duration, env: &[(&str, &str)]) -> Result<String, String> {
    let git = git_path().ok_or("git is not available")?;
    let mut child = Command::new(git)
        .arg("-C")
        .arg(dir)
        .args(["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false"])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .envs(env.iter().copied())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run git: {e}"))?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        })
    };
    let out = drain(child.stdout.take().map(|p| Box::new(p) as _));
    let err = drain(child.stderr.take().map(|p| Box::new(p) as _));
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Ok(s),
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!("git timed out after {} s", timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(2)),
            Err(e) => break Err(format!("cannot wait for git: {e}")),
        }
    };
    let out = out.join().unwrap_or_default();
    let err = err.join().unwrap_or_default();
    let status = status?;
    if status.success() {
        return Ok(String::from_utf8_lossy(&out).into_owned());
    }
    let err = String::from_utf8_lossy(&err);
    Err(err
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("git failed: {status}")))
}

/// One full read of the repository whose main working tree is `path`.
pub fn read(path: &Path) -> Result<Stats, String> {
    let started = Instant::now();
    let now = SystemTime::now();
    let main = read_status(path)?;
    let (head, head_sha) = main.head();
    let unborn = head_sha.is_none();

    let mut upstream = None;
    let mut upstream_remote = None;
    let mut upstream_ref = None;
    let mut upstream_tip = None;
    if let Some(branch) = head.branch()
        && let Ok(text) = git(
            path,
            &[
                "for-each-ref",
                "--format=%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)",
                &format!("refs/heads/{branch}"),
            ],
            TIMEOUT,
        )
    {
        let mut f = text.trim_end_matches('\n').split('\0').map(|s| (!s.is_empty()).then(|| s.to_owned()));
        upstream = f.next().flatten();
        upstream_remote = f.next().flatten();
        upstream_ref = f.next().flatten();
        if let Some(full) = f.next().flatten()
            && let Ok(t) = git(path, &["for-each-ref", "--format=%(objectname)", &full], TIMEOUT)
        {
            upstream_tip = t.lines().next().map(str::to_owned).filter(|s| !s.is_empty());
        }
    }

    let remotes = read_remotes(path);

    let mut commits_total = 0;
    let (mut commits_7d, mut commits_30d) = (0, 0);
    let mut recent_commits = Vec::new();
    let mut last_commit = None;
    let mut root_commits = Vec::new();
    let mut unpushed = None;
    let mut unpushed_commits = Vec::new();
    if !unborn {
        commits_total =
            git(path, &["rev-list", "--count", "HEAD"], TIMEOUT).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
        let log = git(path, &["log", "--since=30.days.ago", "--format=%H%x00%ct", "HEAD"], TIMEOUT).unwrap_or_default();
        let (week, month) = (now - Duration::from_secs(7 * DAY), now - Duration::from_secs(30 * DAY));
        for line in log.lines() {
            if let Some((sha, ct)) = line.split_once('\0')
                && let Some(t) = unix_time(ct)
                && t >= month
            {
                commits_30d += 1;
                commits_7d += u32::from(t >= week);
                recent_commits.push((sha.to_owned(), t));
            }
        }
        if let Ok(text) = git(path, &["log", "-1", "--format=%H%x00%ct%x00%at%x00%s", "HEAD"], TIMEOUT) {
            let mut f = text.trim_end_matches('\n').splitn(4, '\0');
            if let (Some(sha), Some(ct), Some(at), Some(subject)) = (f.next(), f.next(), f.next(), f.next())
                && let (Some(commit_time), Some(author_time)) = (unix_time(ct), unix_time(at))
            {
                last_commit =
                    Some(Commit { sha: sha.to_owned(), commit_time, author_time, subject: subject.to_owned() });
            }
        }
        if let Ok(text) = git(path, &["rev-list", "--max-parents=0", "HEAD"], TIMEOUT) {
            root_commits = text.lines().filter(|l| !l.is_empty()).map(str::to_owned).collect();
            root_commits.sort();
        }
    }
    if !remotes.is_empty() {
        if unborn {
            unpushed = Some(0);
        } else if let Ok(text) = git(path, &["rev-list", "HEAD", "--not", "--remotes"], TIMEOUT) {
            let shas: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();
            unpushed = Some(shas.len() as u32);
            unpushed_commits = shas.into_iter().take(UNPUSHED_CAP).map(str::to_owned).collect();
        }
    }

    let stashes = if main.stash > 0 { read_stashes(path) } else { Vec::new() };
    let worktrees = read_worktrees(path);
    let submodules =
        if path.join(".gitmodules").exists() { read_submodules(path, &main.submodules) } else { Vec::new() };
    let oldest_change = oldest_mtime(path, &main.paths);

    Ok(Stats {
        head,
        head_sha,
        upstream,
        upstream_remote,
        upstream_ref,
        upstream_tip,
        ahead: main.ahead,
        behind: main.behind,
        unpushed,
        unpushed_commits,
        changes: main.changes,
        oldest_change,
        stashes,
        worktrees,
        submodules,
        commits_total,
        commits_7d,
        commits_30d,
        recent_commits,
        last_commit,
        remotes,
        root_commits,
        read_at: now,
        read_ms: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
    })
}

/// The SHA of exactly `refname` on `remote`, asked in `path` so the configured
/// URL, `insteadOf` rules and credential helpers apply. None when the remote lacks it.
pub fn ls_remote(path: &Path, remote: &str, refname: &str) -> Result<Option<String>, String> {
    let mut env = Vec::new();
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        let own = git(path, &["config", "--get", "core.sshCommand"], TIMEOUT).is_ok_and(|s| !s.trim().is_empty());
        if !own {
            env.push(("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=10"));
        }
    }
    let text = git_env(path, &["ls-remote", "--quiet", remote, refname], REMOTE_TIMEOUT, &env)?;
    Ok(text.lines().filter_map(|l| l.split_once('\t')).find(|(_, r)| *r == refname).map(|(sha, _)| sha.to_owned()))
}

/// Commits on `a` not on `b` and on `b` not on `a`; None when either object
/// is missing in `dir`.
pub fn compare(dir: &Path, a: &str, b: &str) -> Option<(u32, u32)> {
    let text = git(dir, &["rev-list", "--left-right", "--count", &format!("{a}...{b}")], TIMEOUT).ok()?;
    let mut parts = text.split_whitespace().map(|p| p.parse::<u32>().ok());
    Some((parts.next()??, parts.next()??))
}

/// What `git status --porcelain=v2` reports for one working tree.
#[derive(Default)]
struct Status {
    oid: Option<String>,
    branch: Option<String>,
    ahead: Option<u32>,
    behind: Option<u32>,
    stash: u32,
    changes: Changes,
    /// Uncommitted paths, relative to the working tree.
    paths: Vec<String>,
    /// Submodule path to its dirty flag.
    submodules: HashMap<String, bool>,
}

impl Status {
    fn head(&self) -> (Head, Option<String>) {
        let sha = self.oid.clone();
        match (&self.branch, &sha) {
            (Some(b), Some(_)) => (Head::Branch(b.clone()), sha),
            (Some(b), None) => (Head::Unborn(b.clone()), None),
            (None, _) => (Head::Detached, sha),
        }
    }
}

fn read_status(dir: &Path) -> Result<Status, String> {
    let text =
        git(dir, &["status", "--porcelain=v2", "--branch", "--show-stash", "-z", "--untracked-files=normal"], TIMEOUT)?;
    Ok(parse_status(&text))
}

fn parse_status(text: &str) -> Status {
    let mut s = Status::default();
    let mut records = text.split('\0');
    while let Some(rec) = records.next() {
        if let Some(h) = rec.strip_prefix("# ") {
            let (key, val) = h.split_once(' ').unwrap_or((h, ""));
            match key {
                "branch.oid" => s.oid = (val != "(initial)").then(|| val.to_owned()),
                "branch.head" => s.branch = (val != "(detached)").then(|| val.to_owned()),
                "branch.ab" => {
                    let mut p = val.split(' ');
                    s.ahead = p.next().and_then(|a| a.trim_start_matches('+').parse().ok());
                    s.behind = p.next().and_then(|b| b.trim_start_matches('-').parse().ok());
                }
                "stash" => s.stash = val.parse().unwrap_or(0),
                _ => {}
            }
            continue;
        }
        let kind = rec.chars().next();
        let (xy, sub, path) = match kind {
            Some('1') => {
                let mut f = rec.splitn(9, ' ');
                (f.nth(1), f.next(), f.nth(5))
            }
            Some('2') => {
                let mut f = rec.splitn(10, ' ');
                let t = (f.nth(1), f.next(), f.nth(6));
                records.next();
                t
            }
            Some('u') => {
                let mut f = rec.splitn(11, ' ');
                (f.nth(1), f.next(), f.nth(7))
            }
            Some('?') => {
                s.changes.untracked += 1;
                s.paths.push(rec[2..].to_owned());
                continue;
            }
            _ => continue,
        };
        let (Some(xy), Some(sub), Some(path)) = (xy, sub, path) else { continue };
        if kind == Some('u') {
            s.changes.conflicted += 1;
        } else {
            let mut c = xy.chars();
            s.changes.staged += u32::from(c.next().is_some_and(|x| x != '.'));
            s.changes.unstaged += u32::from(c.next().is_some_and(|y| y != '.'));
        }
        if sub.starts_with('S') {
            let b = sub.as_bytes();
            s.submodules.insert(path.to_owned(), b.get(2) == Some(&b'M') || b.get(3) == Some(&b'U'));
        }
        s.paths.push(path.to_owned());
    }
    s
}

fn unix_time(secs: &str) -> Option<SystemTime> {
    secs.trim().parse::<u64>().ok().map(|s| SystemTime::UNIX_EPOCH + Duration::from_secs(s))
}

fn read_remotes(path: &Path) -> Vec<Remote> {
    let Ok(text) = git(path, &["config", "--get-regexp", r"^remote\..*\.url$"], TIMEOUT) else { return Vec::new() };
    let mut remotes: Vec<Remote> = Vec::new();
    for line in text.lines() {
        let Some((key, url)) = line.split_once(' ') else { continue };
        let Some(name) = key.strip_prefix("remote.").and_then(|k| k.strip_suffix(".url")) else { continue };
        if !remotes.iter().any(|r| r.name == name) {
            remotes.push(Remote { name: name.to_owned(), url: url.to_owned() });
        }
    }
    remotes
}

fn read_stashes(path: &Path) -> Vec<Stash> {
    let Ok(text) = git(path, &["stash", "list", "--format=%gd%x00%ct%x00%gs"], TIMEOUT) else { return Vec::new() };
    text.lines()
        .filter_map(|line| {
            let mut f = line.splitn(3, '\0');
            let (gd, ct, subject) = (f.next()?, f.next()?, f.next()?);
            let index = gd.strip_prefix("stash@{")?.strip_suffix('}')?.parse().ok()?;
            Some(Stash { index, time: unix_time(ct), subject: subject.to_owned() })
        })
        .collect()
}

fn read_worktrees(path: &Path) -> Vec<Worktree> {
    let Ok(text) = git(path, &["worktree", "list", "--porcelain", "-z"], TIMEOUT) else { return Vec::new() };
    let mut entries: Vec<Vec<&str>> = vec![Vec::new()];
    for rec in text.split('\0') {
        if rec.is_empty() {
            entries.push(Vec::new());
        } else if let Some(last) = entries.last_mut() {
            last.push(rec);
        }
    }
    entries
        .into_iter()
        .filter(|e| !e.is_empty())
        .skip(1)
        .filter_map(|e| {
            let wt_path = PathBuf::from(e.first()?.strip_prefix("worktree ")?);
            let mut sha = None;
            let mut branch = None;
            let (mut locked, mut prunable) = (false, false);
            for line in &e[1..] {
                let (key, val) = line.split_once(' ').unwrap_or((line, ""));
                match key {
                    "HEAD" => sha = Some(val.to_owned()),
                    "branch" => branch = Some(val.strip_prefix("refs/heads/").unwrap_or(val).to_owned()),
                    "locked" => locked = true,
                    "prunable" => prunable = true,
                    _ => {}
                }
            }
            let sha = sha.filter(|s| s.bytes().any(|b| b != b'0'));
            let head = match (branch, &sha) {
                (Some(b), Some(_)) => Head::Branch(b),
                (Some(b), None) => Head::Unborn(b),
                (None, _) => Head::Detached,
            };
            let status = if wt_path.is_dir() { read_status(&wt_path).ok() } else { None };
            let oldest_change = status.as_ref().and_then(|s| oldest_mtime(&wt_path, &s.paths));
            Some(Worktree {
                changes: status.map(|s| s.changes),
                path: wt_path,
                head,
                head_sha: sha,
                oldest_change,
                locked,
                prunable,
            })
        })
        .collect()
}

fn read_submodules(path: &Path, dirty: &HashMap<String, bool>) -> Vec<Submodule> {
    let Ok(text) = git(path, &["submodule", "status"], TIMEOUT) else { return Vec::new() };
    text.lines()
        .filter_map(|line| {
            let state = match line.chars().next()? {
                ' ' => SubmoduleState::Current,
                '+' => SubmoduleState::Moved,
                '-' => SubmoduleState::Uninitialized,
                'U' => SubmoduleState::Conflict,
                _ => return None,
            };
            let (sha, rest) = line[1..].split_once(' ')?;
            let sub = match rest.rfind(" (") {
                Some(i) if rest.ends_with(')') => &rest[..i],
                _ => rest,
            };
            Some(Submodule {
                path: sub.to_owned(),
                sha: sha.to_owned(),
                state,
                dirty: dirty.get(sub).copied().unwrap_or(false),
            })
        })
        .collect()
}

/// The oldest modification time among the uncommitted paths that exist.
fn oldest_mtime(dir: &Path, paths: &[String]) -> Option<SystemTime> {
    paths
        .iter()
        .take(STAT_CAP)
        .filter_map(|p| std::fs::symlink_metadata(dir.join(p.trim_end_matches('/'))).ok()?.modified().ok())
        .min()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Run any git command in a temp repository with a test identity and no user config.
    fn g(dir: &Path, args: &[&str]) -> String {
        g_at(dir, args, None)
    }

    fn g_at(dir: &Path, args: &[&str], date: Option<&str>) -> String {
        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(dir)
            .args(["-c", "user.name=Test", "-c", "user.email=test-local", "-c", "init.defaultBranch=main"])
            .args(["-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always"])
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1");
        if let Some(d) = date {
            cmd.env("GIT_COMMITTER_DATE", d).env("GIT_AUTHOR_DATE", d);
        }
        let out = cmd.output().expect("run git");
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    fn init() -> TempDir {
        let t = TempDir::new().expect("tempdir");
        g(t.path(), &["init", "-q"]);
        t
    }

    fn commit(dir: &Path, file: &str, text: &str) -> String {
        std::fs::write(dir.join(file), text).expect("write");
        g(dir, &["add", file]);
        g(dir, &["commit", "-q", "-m", &format!("edit {file}")]);
        g(dir, &["rev-parse", "HEAD"])
    }

    /// A bare repository and a clone of it with one pushed commit.
    fn with_remote() -> (TempDir, PathBuf, PathBuf) {
        let t = TempDir::new().expect("tempdir");
        let bare = t.path().join("bare.git");
        let a = t.path().join("a");
        std::fs::create_dir(&bare).expect("mkdir");
        g(&bare, &["init", "-q", "--bare"]);
        g(t.path(), &["clone", "-q", bare.to_str().expect("utf8"), "a"]);
        commit(&a, "f", "1");
        g(&a, &["push", "-q", "-u", "origin", "main"]);
        (t, bare, a)
    }

    #[test]
    fn git_exists() {
        assert!(available());
    }

    #[test]
    fn clean_repo() {
        let t = init();
        let sha = commit(t.path(), "f", "1");
        let s = read(t.path()).expect("read");
        assert_eq!(s.head, Head::Branch("main".into()));
        assert_eq!(s.head_sha.as_deref(), Some(sha.as_str()));
        assert!(s.changes.is_clean());
        assert_eq!(s.oldest_change, None);
        assert_eq!((s.upstream, s.ahead, s.behind, s.unpushed), (None, None, None, None));
        assert!(s.remotes.is_empty() && s.unpushed_commits.is_empty());
        assert_eq!(s.commits_total, 1);
        assert_eq!(s.last_commit.as_ref().map(|c| c.subject.as_str()), Some("edit f"));
        assert_eq!(s.root_commits, vec![sha]);
        assert!(s.read_ms < 30_000);
    }

    #[test]
    fn counts_changes_with_rename() {
        let t = init();
        let p = t.path();
        for f in ["a", "b", "c", "d"] {
            std::fs::write(p.join(f), f).expect("write");
        }
        g(p, &["add", "."]);
        g(p, &["commit", "-q", "-m", "base"]);
        g(p, &["mv", "a", "renamed file"]);
        std::fs::write(p.join("b"), "changed").expect("write");
        std::fs::write(p.join("c"), "changed").expect("write");
        g(p, &["add", "c"]);
        std::fs::write(p.join("c"), "changed again").expect("write");
        std::fs::create_dir(p.join("dir")).expect("mkdir");
        std::fs::write(p.join("dir/x"), "x").expect("write");
        std::fs::write(p.join("dir/y"), "y").expect("write");
        std::fs::write(p.join("loose"), "z").expect("write");
        let s = read(p).expect("read");
        // staged: renamed file, c; unstaged: b, c; untracked: dir/, loose.
        assert_eq!(s.changes, Changes { staged: 2, unstaged: 2, untracked: 2, conflicted: 0 });
        assert!(s.oldest_change.is_some());
    }

    #[test]
    fn conflicts() {
        let t = init();
        let p = t.path();
        commit(p, "f", "base\n");
        g(p, &["checkout", "-q", "-b", "other"]);
        commit(p, "f", "other\n");
        g(p, &["checkout", "-q", "main"]);
        commit(p, "f", "main\n");
        let merge = Command::new("git")
            .arg("-C")
            .arg(p)
            .args(["-c", "user.name=Test", "-c", "user.email=test-local", "merge", "other"])
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .expect("merge");
        assert!(!merge.status.success());
        let s = read(p).expect("read");
        assert_eq!(s.changes.conflicted, 1);
        assert_eq!(s.changes.untracked, 0);
    }

    #[test]
    fn detached_and_unborn() {
        let t = init();
        let s = read(t.path()).expect("read");
        assert_eq!(s.head, Head::Unborn("main".into()));
        assert_eq!((s.head_sha, s.commits_total, s.last_commit, s.unpushed), (None, 0, None, None));
        assert!(s.root_commits.is_empty());
        let sha = commit(t.path(), "f", "1");
        g(t.path(), &["checkout", "-q", "--detach"]);
        let s = read(t.path()).expect("read");
        assert_eq!(s.head, Head::Detached);
        assert_eq!(s.head_sha.as_deref(), Some(sha.as_str()));
        assert_eq!(s.upstream, None);
    }

    #[test]
    fn upstream_ahead_behind() {
        let (t, bare, a) = with_remote();
        let b = t.path().join("b");
        g(t.path(), &["clone", "-q", bare.to_str().expect("utf8"), "b"]);
        let theirs = commit(&b, "g", "theirs");
        g(&b, &["push", "-q"]);
        g(&a, &["fetch", "-q"]);
        commit(&a, "h", "mine");
        let s = read(&a).expect("read");
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!(s.upstream_remote.as_deref(), Some("origin"));
        assert_eq!(s.upstream_ref.as_deref(), Some("refs/heads/main"));
        assert_eq!(s.upstream_tip.as_deref(), Some(theirs.as_str()));
        assert_eq!((s.ahead, s.behind), (Some(1), Some(1)));
        assert_eq!(s.unpushed, Some(1));
        assert_eq!(s.unpushed_commits.len(), 1);
        assert_eq!(s.remotes.len(), 1);
        assert_eq!(s.main_remote().map(|r| r.name.as_str()), Some("origin"));
    }

    #[test]
    fn gone_upstream_has_no_tip() {
        let (_t, _bare, a) = with_remote();
        g(&a, &["update-ref", "-d", "refs/remotes/origin/main"]);
        let s = read(&a).expect("read");
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!(s.upstream_tip, None);
        assert_eq!(s.ahead, None);
    }

    #[test]
    fn unpushed_without_upstream() {
        let (_t, _bare, a) = with_remote();
        g(&a, &["checkout", "-q", "-b", "feature"]);
        commit(&a, "x", "1");
        commit(&a, "y", "2");
        let s = read(&a).expect("read");
        assert_eq!((s.upstream.clone(), s.ahead), (None, None));
        assert_eq!(s.unpushed, Some(2));
        assert_eq!(s.unpushed_commits.len(), 2);
        let lone = init();
        commit(lone.path(), "f", "1");
        let s = read(lone.path()).expect("read");
        assert_eq!((s.unpushed, s.unpushed_commits.len()), (None, 0));
    }

    #[test]
    fn stash_list() {
        let t = init();
        let p = t.path();
        commit(p, "f", "1");
        std::fs::write(p.join("f"), "2").expect("write");
        g(p, &["stash", "push", "-q", "-m", "parked work"]);
        std::fs::write(p.join("f"), "3").expect("write");
        g(p, &["stash", "push", "-q", "-m", "more work"]);
        let s = read(p).expect("read");
        assert_eq!(s.stashes.len(), 2);
        assert_eq!(s.stashes[0].index, 0);
        assert!(s.stashes[0].subject.contains("more work"));
        assert!(s.stashes[1].subject.contains("parked work"));
        assert!(s.stashes[0].time.is_some());
    }

    #[test]
    fn linked_worktree() {
        let t = TempDir::new().expect("tempdir");
        let p = &t.path().join("main");
        std::fs::create_dir(p).expect("mkdir");
        g(p, &["init", "-q"]);
        commit(p, "f", "1");
        let wt = t.path().join("wt");
        let gone = t.path().join("gone");
        g(p, &["worktree", "add", "-q", "-b", "side", wt.to_str().expect("utf8")]);
        g(p, &["worktree", "add", "-q", "--detach", gone.to_str().expect("utf8")]);
        g(p, &["worktree", "lock", gone.to_str().expect("utf8")]);
        std::fs::write(wt.join("new"), "n").expect("write");
        std::fs::write(wt.join("f"), "edited").expect("write");
        let s = read(p).expect("read");
        assert_eq!(s.worktrees.len(), 2);
        let side = s.worktrees.iter().find(|w| w.head == Head::Branch("side".into())).expect("side");
        assert_eq!(side.changes, Some(Changes { staged: 0, unstaged: 1, untracked: 1, conflicted: 0 }));
        assert!(side.oldest_change.is_some() && side.head_sha.is_some());
        let det = s.worktrees.iter().find(|w| w.head == Head::Detached).expect("detached");
        assert!(det.locked && !det.prunable);
        assert!(s.has_uncommitted());
        assert!(s.changes.is_clean());
    }

    #[test]
    fn submodules_dirty_and_moved() {
        let t = TempDir::new().expect("tempdir");
        let sub = t.path().join("sub");
        let top = t.path().join("top");
        std::fs::create_dir(&sub).expect("mkdir");
        std::fs::create_dir(&top).expect("mkdir");
        g(&sub, &["init", "-q"]);
        commit(&sub, "s", "1");
        commit(&sub, "s", "2");
        g(&top, &["init", "-q"]);
        commit(&top, "f", "1");
        g(&top, &["submodule", "add", "-q", sub.to_str().expect("utf8"), "mod"]);
        g(&top, &["commit", "-q", "-m", "add submodule"]);
        let s = read(&top).expect("read");
        assert_eq!(s.submodules.len(), 1);
        assert_eq!(
            (s.submodules[0].path.as_str(), s.submodules[0].state, s.submodules[0].dirty),
            ("mod", SubmoduleState::Current, false)
        );
        assert_eq!(s.submodules[0].sha.len(), 40);
        std::fs::write(top.join("mod/untracked"), "u").expect("write");
        let s = read(&top).expect("read");
        assert!(s.submodules[0].dirty);
        std::fs::remove_file(top.join("mod/untracked")).expect("rm");
        g(&top.join("mod"), &["checkout", "-q", "--detach", "HEAD~1"]);
        let s = read(&top).expect("read");
        assert_eq!(s.submodules[0].state, SubmoduleState::Moved);
        assert!(!s.submodules[0].dirty);
        assert_eq!(s.changes.unstaged, 1);
    }

    #[test]
    fn commit_windows() {
        let t = init();
        let p = t.path();
        let day = |n: u64| {
            let secs = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).expect("clock").as_secs() - n * DAY;
            format!("{secs} +0000")
        };
        for (i, age) in [100u64, 20, 3, 0].iter().enumerate() {
            std::fs::write(p.join("f"), i.to_string()).expect("write");
            g(p, &["add", "f"]);
            g_at(p, &["commit", "-q", "-m", &format!("c{i}")], Some(&day(*age)));
        }
        let s = read(p).expect("read");
        assert_eq!((s.commits_total, s.commits_30d, s.commits_7d), (4, 3, 2));
        assert_eq!(s.recent_commits.len(), 3);
        assert!(s.recent_commits[0].1 >= s.recent_commits[2].1);
        assert_eq!(s.last_commit.expect("last").subject, "c3");
    }

    #[test]
    fn root_commits_sorted() {
        let t = init();
        let p = t.path();
        commit(p, "f", "1");
        g(p, &["checkout", "-q", "--orphan", "other"]);
        commit(p, "o", "1");
        g(p, &["checkout", "-q", "main"]);
        g(p, &["merge", "-q", "--allow-unrelated-histories", "-m", "join", "other"]);
        let s = read(p).expect("read");
        assert_eq!(s.root_commits.len(), 2);
        assert!(s.root_commits[0] < s.root_commits[1]);
    }

    #[test]
    fn ls_remote_present_and_missing() {
        let (_t, bare, a) = with_remote();
        let tip = g(&a, &["rev-parse", "HEAD"]);
        let url = bare.to_str().expect("utf8");
        assert_eq!(ls_remote(&a, "origin", "refs/heads/main"), Ok(Some(tip.clone())));
        assert_eq!(ls_remote(&a, "origin", "refs/heads/nope"), Ok(None));
        assert_eq!(ls_remote(&a, url, "refs/heads/main"), Ok(Some(tip)));
        assert!(ls_remote(&a, "no-such-remote", "refs/heads/main").is_err());
    }

    #[test]
    fn compare_clones() {
        let (t, bare, a) = with_remote();
        let b = t.path().join("b");
        g(t.path(), &["clone", "-q", bare.to_str().expect("utf8"), "b"]);
        let base = g(&a, &["rev-parse", "HEAD"]);
        let mine = commit(&a, "x", "1");
        let mine2 = commit(&a, "y", "1");
        let theirs = commit(&b, "z", "1");
        assert_eq!(compare(&a, &mine2, &base), Some((2, 0)));
        assert_eq!(compare(&a, &base, &mine), Some((0, 1)));
        assert_eq!(compare(&a, &mine2, &theirs), None);
        g(&a, &["fetch", "-q", b.to_str().expect("utf8"), "main"]);
        assert_eq!(compare(&a, &mine2, &theirs), Some((2, 1)));
    }

    fn tree(dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).expect("read_dir").flatten() {
                out.push(e.path());
                if e.file_type().is_ok_and(|t| t.is_dir()) {
                    stack.push(e.path());
                }
            }
        }
        out.sort();
        out
    }

    #[test]
    fn read_does_not_write() {
        let (_t, _bare, a) = with_remote();
        std::fs::write(a.join("f"), "dirty").expect("write");
        std::fs::write(a.join("new"), "n").expect("write");
        g(&a, &["stash", "push", "-q", "-u"]);
        std::fs::write(a.join("f"), "dirty again").expect("write");
        std::thread::sleep(Duration::from_millis(1100));
        let index = a.join(".git/index");
        let (files, mtime) =
            (tree(&a.join(".git")), std::fs::metadata(&index).and_then(|m| m.modified()).expect("mtime"));
        read(&a).expect("read");
        read(&a).expect("read");
        assert_eq!(tree(&a.join(".git")), files);
        assert_eq!(std::fs::metadata(&index).and_then(|m| m.modified()).expect("mtime"), mtime);
        assert!(!tree(&a.join(".git")).iter().any(|p| p.extension().is_some_and(|e| e == "lock")));
    }

    #[test]
    fn rejects_non_repositories() {
        let t = TempDir::new().expect("tempdir");
        assert!(read(t.path()).is_err());
        let bare = t.path().join("b.git");
        std::fs::create_dir(&bare).expect("mkdir");
        g(&bare, &["init", "-q", "--bare"]);
        assert!(read(&bare).is_err());
        assert!(read(&t.path().join("missing")).is_err());
    }

    #[test]
    fn parses_status_records() {
        let text = "# branch.oid abc\0# branch.head main\0# branch.upstream o/main\0# branch.ab +3 -4\0# stash 2\0\
            1 .M N... 100644 100644 100644 h h with space.txt\0\
            2 R. N... 100644 100644 100644 h h R100 new name\0old name\0\
            1 .M S.M. 160000 160000 160000 h h sub\0\
            u UU N... 1 2 3 4 h h h conflicted\0? some dir/\0! ignored\0";
        let s = parse_status(text);
        assert_eq!((s.ahead, s.behind, s.stash), (Some(3), Some(4), 2));
        assert_eq!(s.changes, Changes { staged: 1, unstaged: 2, untracked: 1, conflicted: 1 });
        assert_eq!(s.paths, ["with space.txt", "new name", "sub", "conflicted", "some dir/"]);
        assert_eq!(s.submodules.get("sub"), Some(&true));
    }
}
