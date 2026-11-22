//! Live change detection. One FSEvents watcher covers the scan roots and any
//! work tree or git dir outside them. Each event is mapped to a repository,
//! filtered to the paths that can change what the window shows, and debounced
//! per repository on a single background thread.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};

/// How long a repository must be quiet before its change is reported.
const QUIET: Duration = Duration::from_millis(300);
/// The longest a change waits, however busy the repository is.
const MAX_WAIT: Duration = Duration::from_millis(1500);
/// How long new repository events are gathered before one is reported.
const NEW_REPO_DELAY: Duration = Duration::from_secs(2);

/// The paths that make up one repository.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WatchedRepo {
    /// The main working tree.
    pub id: PathBuf,
    /// The main working tree and every linked worktree.
    pub work_trees: Vec<PathBuf>,
    /// The common git dir and each linked worktree's own git dir.
    pub git_dirs: Vec<PathBuf>,
}

/// What the watcher reports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WatchEvent {
    /// Something changed in the repository with this id.
    Changed(PathBuf),
    /// A repository may have appeared under a root.
    NewRepo,
    /// Events may have been lost, so everything should be read again.
    Rescan,
}

enum Msg {
    Fs(notify::Result<notify::Event>),
    SetRepos(Vec<WatchedRepo>),
    Stop,
}

/// Watches the roots and repositories until dropped.
pub struct Watcher {
    tx: Sender<Msg>,
    thread: Option<JoinHandle<()>>,
}

impl Watcher {
    /// Starts watching every existing root recursively. Paths with a component matching `skip_names` are ignored.
    pub fn start(
        roots: &[PathBuf],
        skip_names: Vec<String>,
        notify: Box<dyn Fn(WatchEvent) + Send>,
    ) -> Result<Watcher, String> {
        let roots: Vec<PathBuf> = roots.iter().filter_map(|r| r.canonicalize().ok()).collect();
        let (tx, rx) = mpsc::channel();
        let fs_tx = tx.clone();
        let mut watcher = notify::recommended_watcher(move |res| {
            let _ = fs_tx.send(Msg::Fs(res));
        })
        .map_err(|e| e.to_string())?;
        let mut core = Core {
            index: Index::new(roots.clone(), skip_names, &[]),
            pending: HashMap::new(),
            new_repo_due: None,
            extras: HashSet::new(),
            notify,
        };
        for root in minimal(roots) {
            watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| format!("{}: {e}", root.display()))?;
        }
        let thread = thread::Builder::new()
            .name("repo-watch".into())
            .spawn(move || core.run(rx, watcher))
            .map_err(|e| e.to_string())?;
        Ok(Watcher { tx, thread: Some(thread) })
    }

    /// Replaces the known repositories, watching any that lie outside the roots.
    pub fn set_repos(&self, repos: Vec<WatchedRepo>) {
        let _ = self.tx.send(Msg::SetRepos(repos));
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Whether `name` matches `pattern`, where `*` stands for any run of characters.
pub fn name_matches(pattern: &str, name: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == name;
    }
    let (first, last) = (parts[0], parts[parts.len() - 1]);
    if name.len() < first.len() + last.len() || !name.starts_with(first) || !name.ends_with(last) {
        return false;
    }
    let mut rest = &name[first.len()..name.len() - last.len()];
    for part in &parts[1..parts.len() - 1] {
        match rest.find(part) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }
    true
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Area {
    WorkTree,
    GitDir,
}

/// What one event path means.
#[derive(Debug, PartialEq, Eq)]
enum Class {
    Repo(PathBuf),
    NewRepo,
    Ignore,
}

enum Scan {
    Counts,
    NewRepo,
    Ignore,
}

/// Maps paths to repositories and decides which of them count.
struct Index {
    roots: Vec<PathBuf>,
    skip: Vec<String>,
    owners: HashMap<PathBuf, (usize, Area)>,
    ids: Vec<PathBuf>,
}

impl Index {
    fn new(roots: Vec<PathBuf>, skip: Vec<String>, repos: &[WatchedRepo]) -> Index {
        let mut owners = HashMap::new();
        let mut ids = Vec::new();
        for (i, repo) in repos.iter().enumerate() {
            ids.push(repo.id.clone());
            for dir in &repo.work_trees {
                owners.insert(dir.clone(), (i, Area::WorkTree));
            }
        }
        for (i, repo) in repos.iter().enumerate() {
            for dir in &repo.git_dirs {
                owners.insert(dir.clone(), (i, Area::GitDir));
            }
        }
        Index { roots, skip, owners, ids }
    }

    /// The longest known prefix of the path owns it.
    fn classify(&self, path: &Path) -> Class {
        for dir in path.ancestors() {
            let Some(&(i, area)) = self.owners.get(dir) else { continue };
            let Ok(rel) = path.strip_prefix(dir) else { return Class::Ignore };
            return match area {
                Area::GitDir if git_dir_path_counts(rel) => Class::Repo(self.ids[i].clone()),
                Area::GitDir => Class::Ignore,
                Area::WorkTree => match self.scan(rel, true) {
                    Scan::Counts => Class::Repo(self.ids[i].clone()),
                    Scan::NewRepo => Class::NewRepo,
                    Scan::Ignore => Class::Ignore,
                },
            };
        }
        match self.roots.iter().find_map(|r| path.strip_prefix(r).ok()) {
            Some(rel) => match self.scan(rel, false) {
                Scan::NewRepo => Class::NewRepo,
                _ => Class::Ignore,
            },
            None => Class::Ignore,
        }
    }

    /// Walks the components below a work tree or root. A `.git` directly in a known work tree is
    /// that work tree's own, so only a deeper one is a new repository.
    fn scan(&self, rel: &Path, known: bool) -> Scan {
        let names: Vec<&str> = rel.components().filter_map(component_str).collect();
        for (k, name) in names.iter().enumerate() {
            if *name == ".git" {
                let appears = k + 1 == names.len() || (k + 2 == names.len() && names[k + 1] == "HEAD");
                return if appears && !(known && k == 0) { Scan::NewRepo } else { Scan::Ignore };
            }
            if *name == ".DS_Store" || self.skip.iter().any(|p| name_matches(p, name)) {
                return Scan::Ignore;
            }
        }
        Scan::Counts
    }
}

fn component_str(c: Component<'_>) -> Option<&str> {
    match c {
        Component::Normal(s) => s.to_str(),
        _ => None,
    }
}

/// Whether a path inside a git dir can change what the window shows.
fn git_dir_path_counts(rel: &Path) -> bool {
    let names: Vec<&str> = rel.components().filter_map(component_str).collect();
    if names.iter().any(|n| n.ends_with(".lock") || *n == "fsmonitor--daemon" || *n == "objects") {
        return false;
    }
    let Some(&first) = names.first() else { return false };
    match first {
        "HEAD" | "index" | "packed-refs" | "FETCH_HEAD" | "ORIG_HEAD" | "MERGE_HEAD" | "CHERRY_PICK_HEAD"
        | "REVERT_HEAD" | "REBASE_HEAD" => names.len() == 1,
        "refs" | "logs" => true,
        "worktrees" => match names.get(2) {
            Some(&("HEAD" | "index")) => names.len() == 3,
            Some(&"logs") => true,
            _ => false,
        },
        "modules" => {
            let tail = &names[1..];
            tail.len() >= 2 && (matches!(tail[tail.len() - 1], "HEAD" | "index") || tail[1..].contains(&"refs"))
        }
        _ => false,
    }
}

/// Drops paths that lie inside another path of the list.
fn minimal(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let all: HashSet<PathBuf> = paths.into_iter().collect();
    all.iter().filter(|p| !p.ancestors().skip(1).any(|a| all.contains(a))).cloned().collect()
}

struct Span {
    first: Instant,
    last: Instant,
}

impl Span {
    fn due(&self) -> Instant {
        (self.last + QUIET).min(self.first + MAX_WAIT)
    }
}

/// The state of the background thread.
struct Core {
    index: Index,
    pending: HashMap<PathBuf, Span>,
    new_repo_due: Option<Instant>,
    extras: HashSet<PathBuf>,
    notify: Box<dyn Fn(WatchEvent) + Send>,
}

impl Core {
    fn run(&mut self, rx: mpsc::Receiver<Msg>, mut watcher: RecommendedWatcher) {
        loop {
            let msg = match self.next_due() {
                Some(due) => rx.recv_timeout(due.saturating_duration_since(Instant::now())),
                None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match msg {
                Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                Ok(Msg::Fs(res)) => self.on_fs(res),
                Ok(Msg::SetRepos(repos)) => self.set_repos(repos, &mut watcher),
                Err(RecvTimeoutError::Timeout) => {}
            }
            self.flush(Instant::now());
        }
    }

    fn next_due(&self) -> Option<Instant> {
        self.pending.values().map(Span::due).chain(self.new_repo_due).min()
    }

    fn on_fs(&mut self, res: notify::Result<notify::Event>) {
        let event = match res {
            Ok(event) => event,
            Err(_) => return (self.notify)(WatchEvent::Rescan),
        };
        if event.need_rescan() {
            return (self.notify)(WatchEvent::Rescan);
        }
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let now = Instant::now();
        for path in &event.paths {
            match self.index.classify(path) {
                Class::Repo(id) => {
                    self.pending.entry(id).and_modify(|s| s.last = now).or_insert(Span { first: now, last: now });
                }
                Class::NewRepo => {
                    self.new_repo_due.get_or_insert(now + NEW_REPO_DELAY);
                }
                Class::Ignore => {}
            }
        }
    }

    fn flush(&mut self, now: Instant) {
        let due: Vec<PathBuf> = self.pending.iter().filter(|(_, s)| s.due() <= now).map(|(id, _)| id.clone()).collect();
        for id in due {
            self.pending.remove(&id);
            (self.notify)(WatchEvent::Changed(id));
        }
        if self.new_repo_due.is_some_and(|d| d <= now) {
            self.new_repo_due = None;
            (self.notify)(WatchEvent::NewRepo);
        }
    }

    fn set_repos(&mut self, repos: Vec<WatchedRepo>, watcher: &mut RecommendedWatcher) {
        let repos: Vec<WatchedRepo> = repos
            .into_iter()
            .map(|r| WatchedRepo {
                id: canon(&r.id),
                work_trees: r.work_trees.iter().map(|p| canon(p)).collect(),
                git_dirs: r.git_dirs.iter().map(|p| canon(p)).collect(),
            })
            .collect();
        let outside = repos
            .iter()
            .flat_map(|r| r.work_trees.iter().chain(&r.git_dirs))
            .filter(|p| p.exists() && !self.index.roots.iter().any(|root| p.starts_with(root)))
            .cloned();
        let wanted: HashSet<PathBuf> = minimal(outside).into_iter().collect();
        for gone in self.extras.difference(&wanted) {
            let _ = watcher.unwatch(gone);
        }
        let mut kept = HashSet::new();
        for path in &wanted {
            if self.extras.contains(path) || watcher.watch(path, RecursiveMode::Recursive).is_ok() {
                kept.insert(path.clone());
            }
        }
        self.extras = kept;
        let (roots, skip) = (self.index.roots.clone(), self.index.skip.clone());
        self.index = Index::new(roots, skip, &repos);
        let known: HashSet<&PathBuf> = repos.iter().map(|r| &r.id).collect();
        self.pending.retain(|id, _| known.contains(id));
    }
}

fn canon(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::{Arc, Mutex};

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    fn repo(id: &str, wts: &[&str], gds: &[&str]) -> WatchedRepo {
        WatchedRepo {
            id: p(id),
            work_trees: wts.iter().map(|s| p(s)).collect(),
            git_dirs: gds.iter().map(|s| p(s)).collect(),
        }
    }

    fn class(path: &str) -> Class {
        let repos = [
            repo("/r/a", &["/r/a", "/other/wt"], &["/r/a/.git", "/r/a/.git/worktrees/wt"]),
            repo("/r/a/nested", &["/r/a/nested"], &["/r/a/nested/.git"]),
        ];
        let skip = vec!["node_modules".into(), "target".into(), "cmake-build-*".into()];
        Index::new(vec![p("/r")], skip, &repos).classify(&p(path))
    }

    fn a() -> Class {
        Class::Repo(p("/r/a"))
    }

    #[test]
    fn glob_rule() {
        assert!(name_matches("target", "target"));
        assert!(!name_matches("target", "targets"));
        assert!(name_matches("cmake-build-*", "cmake-build-debug"));
        assert!(name_matches("cmake-build-*", "cmake-build-"));
        assert!(!name_matches("cmake-build-*", "cmake-debug"));
        assert!(name_matches("*.o", "x.o"));
        assert!(name_matches("a*b*c", "aXbYc"));
        assert!(!name_matches("a*b*c", "acb"));
        assert!(name_matches("*", ""));
    }

    #[test]
    fn work_tree_files_count() {
        assert_eq!(class("/r/a/src/main.rs"), a());
        assert_eq!(class("/r/a"), a());
        assert_eq!(class("/other/wt/x.rs"), a());
    }

    #[test]
    fn work_tree_skips() {
        assert_eq!(class("/r/a/node_modules/x/y.js"), Class::Ignore);
        assert_eq!(class("/r/a/sub/target/debug/x"), Class::Ignore);
        assert_eq!(class("/r/a/cmake-build-debug/x"), Class::Ignore);
        assert_eq!(class("/r/a/.DS_Store"), Class::Ignore);
        assert_eq!(class("/r/a/src/.DS_Store"), Class::Ignore);
        assert_eq!(class("/other/wt/target/x"), Class::Ignore);
        assert_eq!(class("/r/a/targets/x"), a());
    }

    #[test]
    fn git_dir_allowed() {
        for f in [
            "HEAD",
            "index",
            "packed-refs",
            "FETCH_HEAD",
            "ORIG_HEAD",
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "REBASE_HEAD",
            "refs/heads/main",
            "refs/remotes/origin/x/y",
            "logs/HEAD",
            "logs/refs/heads/main",
            "worktrees/wt/HEAD",
            "worktrees/wt/index",
            "worktrees/wt/logs/HEAD",
            "modules/sub/HEAD",
            "modules/sub/index",
            "modules/sub/refs/heads/main",
            "modules/x/y/refs/heads/main",
        ] {
            assert_eq!(class(&format!("/r/a/.git/{f}")), a(), "{f}");
        }
    }

    #[test]
    fn git_dir_ignored() {
        for f in [
            "objects/ab/cdef",
            "objects/pack/x.pack",
            "index.lock",
            "HEAD.lock",
            "refs/heads/main.lock",
            "fsmonitor--daemon/cookies/1",
            "config",
            "description",
            "hooks/pre-commit",
            "info/exclude",
            "worktrees/wt/gitdir",
            "worktrees/wt/commondir",
            "worktrees/wt/index.lock",
            "worktrees/wt/objects/x",
            "modules/sub/objects/ab/cd",
            "modules/sub/config",
            "modules/sub/HEAD.lock",
            "HEAD/x",
        ] {
            assert_eq!(class(&format!("/r/a/.git/{f}")), Class::Ignore, "{f}");
        }
        assert_eq!(class("/r/a/.git"), Class::Ignore);
    }

    #[test]
    fn longest_prefix_wins() {
        assert_eq!(class("/r/a/nested/src/x.rs"), Class::Repo(p("/r/a/nested")));
        assert_eq!(class("/r/a/nested/.git/HEAD"), Class::Repo(p("/r/a/nested")));
        assert_eq!(class("/r/a/nested/.git/objects/x"), Class::Ignore);
        assert_eq!(class("/r/a/other.rs"), a());
    }

    #[test]
    fn new_repo_rules() {
        assert_eq!(class("/r/new/.git"), Class::NewRepo);
        assert_eq!(class("/r/new/.git/HEAD"), Class::NewRepo);
        assert_eq!(class("/r/deep/er/new/.git/HEAD"), Class::NewRepo);
        assert_eq!(class("/r/new/.git/config"), Class::Ignore);
        assert_eq!(class("/r/new/.git/refs/heads/x"), Class::Ignore);
        assert_eq!(class("/r/new/file.txt"), Class::Ignore);
        assert_eq!(class("/r/node_modules/pkg/.git/HEAD"), Class::Ignore);
        assert_eq!(class("/r/a/sub/.git/HEAD"), Class::NewRepo);
        assert_eq!(class("/r/a/.git/HEAD"), a());
        assert_eq!(class("/elsewhere/new/.git/HEAD"), Class::Ignore);
    }

    #[test]
    fn linked_worktree_dot_git_file_is_known() {
        assert_eq!(class("/other/wt/.git"), Class::Ignore);
    }

    #[test]
    fn minimal_drops_nested() {
        let mut m = minimal([p("/a"), p("/a/b"), p("/c")]);
        m.sort();
        assert_eq!(m, vec![p("/a"), p("/c")]);
    }

    type Log = Arc<Mutex<Vec<WatchEvent>>>;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test-local"])
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    fn init(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("a.txt"), "one").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "first"]);
    }

    fn repo_for(dir: &Path) -> WatchedRepo {
        WatchedRepo { id: dir.to_path_buf(), work_trees: vec![dir.to_path_buf()], git_dirs: vec![dir.join(".git")] }
    }

    /// Starts a watcher, waits for it to settle and forgets whatever it saw meanwhile.
    fn start(root: &Path, repos: Vec<WatchedRepo>) -> (Watcher, Log) {
        let log: Log = Arc::default();
        let sink = log.clone();
        let w = Watcher::start(
            &[root.to_path_buf()],
            vec!["node_modules".into(), "target".into()],
            Box::new(move |e| sink.lock().unwrap().push(e)),
        )
        .unwrap();
        w.set_repos(repos);
        thread::sleep(Duration::from_millis(800));
        log.lock().unwrap().clear();
        (w, log)
    }

    fn events(log: &Log) -> Vec<WatchEvent> {
        log.lock().unwrap().clone()
    }

    fn wait_for(log: &Log, want: &WatchEvent, timeout: Duration) -> Option<Duration> {
        let t0 = Instant::now();
        while t0.elapsed() < timeout {
            if events(log).contains(want) {
                return Some(t0.elapsed());
            }
            thread::sleep(Duration::from_millis(20));
        }
        None
    }

    fn tmp() -> (tempfile::TempDir, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().canonicalize().unwrap();
        (t, root)
    }

    #[test]
    fn edit_reports_change() {
        let (_t, root) = tmp();
        let r = root.join("repo");
        init(&r);
        let (_w, log) = start(&root, vec![repo_for(&r)]);
        std::fs::write(r.join("a.txt"), "two").unwrap();
        let latency = wait_for(&log, &WatchEvent::Changed(r.clone()), Duration::from_secs(3)).expect("no event");
        eprintln!("edit latency: {latency:?}");
    }

    #[test]
    fn commit_reports_change() {
        let (_t, root) = tmp();
        let r = root.join("repo");
        init(&r);
        let (_w, log) = start(&root, vec![repo_for(&r)]);
        git(&r, &["commit", "-q", "--allow-empty", "-m", "second"]);
        let latency = wait_for(&log, &WatchEvent::Changed(r.clone()), Duration::from_secs(3)).expect("no event");
        eprintln!("commit latency: {latency:?}");
    }

    #[test]
    fn skipped_directories_are_quiet() {
        let (_t, root) = tmp();
        let r = root.join("repo");
        init(&r);
        std::fs::create_dir_all(r.join("node_modules/x")).unwrap();
        std::fs::create_dir_all(r.join("target")).unwrap();
        let (_w, log) = start(&root, vec![repo_for(&r)]);
        std::fs::write(r.join("node_modules/x/i.js"), "1").unwrap();
        std::fs::write(r.join("target/o"), "1").unwrap();
        thread::sleep(Duration::from_secs(2));
        assert_eq!(events(&log), vec![]);
    }

    #[test]
    fn objects_writes_are_quiet() {
        let (_t, root) = tmp();
        let r = root.join("repo");
        init(&r);
        let (_w, log) = start(&root, vec![repo_for(&r)]);
        std::fs::create_dir_all(r.join(".git/objects/zz")).unwrap();
        std::fs::write(r.join(".git/objects/zz/blob"), "1").unwrap();
        thread::sleep(Duration::from_secs(2));
        assert_eq!(events(&log), vec![]);
    }

    #[test]
    fn burst_is_debounced() {
        let (_t, root) = tmp();
        let r = root.join("repo");
        init(&r);
        let (_w, log) = start(&root, vec![repo_for(&r)]);
        for i in 0..100 {
            std::fs::write(r.join("a.txt"), i.to_string()).unwrap();
            thread::sleep(Duration::from_millis(5));
        }
        thread::sleep(Duration::from_secs(3));
        let n = events(&log).len();
        assert!((1..=2).contains(&n), "{n} events");
    }

    #[test]
    fn nested_repo_reports_only_itself() {
        let (_t, root) = tmp();
        let r = root.join("repo");
        let n = r.join("nested");
        init(&r);
        init(&n);
        let (_w, log) = start(&root, vec![repo_for(&r), repo_for(&n)]);
        std::fs::write(n.join("a.txt"), "two").unwrap();
        wait_for(&log, &WatchEvent::Changed(n.clone()), Duration::from_secs(3)).expect("no event");
        thread::sleep(Duration::from_secs(1));
        assert!(events(&log).iter().all(|e| *e == WatchEvent::Changed(n.clone())), "{:?}", events(&log));
    }

    #[test]
    fn linked_worktree_outside_root() {
        let (_t, base) = tmp();
        let root = base.join("root");
        let r = root.join("repo");
        init(&r);
        let wt = base.join("outside-wt");
        git(&r, &["worktree", "add", "-q", "-b", "side", wt.to_str().unwrap()]);
        let mut watched = repo_for(&r);
        watched.work_trees.push(wt.clone());
        watched.git_dirs.push(r.join(".git/worktrees/outside-wt"));
        let (_w, log) = start(&root, vec![watched]);
        std::fs::write(wt.join("a.txt"), "changed").unwrap();
        wait_for(&log, &WatchEvent::Changed(r.clone()), Duration::from_secs(3)).expect("no event");
    }

    #[test]
    fn new_repo_is_reported() {
        let (_t, root) = tmp();
        let (_w, log) = start(&root, vec![]);
        init(&root.join("fresh"));
        wait_for(&log, &WatchEvent::NewRepo, Duration::from_secs(6)).expect("no NewRepo");
    }

    #[test]
    fn dropping_stops_the_thread() {
        let (_t, root) = tmp();
        let (w, _log) = start(&root, vec![]);
        drop(w);
    }
}
