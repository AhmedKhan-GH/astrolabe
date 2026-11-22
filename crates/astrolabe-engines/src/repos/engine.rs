//! The background work. One coordinator thread owns the settings, the list of
//! repositories and the watcher; pools of threads read repositories and run
//! remote checks; one thread asks GitHub. Callers send `Cmd`s and receive
//! `Msg`s. No git command runs on the caller's thread.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime};

use super::github::{GitHub, Origin, RateLimit};
use super::github_list::LIST_MAX_AGE;
use super::model::{Config, CopyDiff, Discovery, Found, GhListedRepo, GhRepo, Relation, RemoteCheck, Repo, Stats};
use super::watch::{WatchEvent, WatchedRepo, Watcher};
use super::{config, discover, git, paths, related, remote};

const READERS: usize = 4;
const CHECKERS: usize = 3;
/// Every repository is read again this often, in case an event was missed.
const FULL_READ_EVERY: Duration = Duration::from_secs(300);
const DISCOVER_EVERY: Duration = Duration::from_secs(600);
const CONFIG_POLL: Duration = Duration::from_secs(3);
/// GitHub answers younger than this are used without a request.
const GITHUB_MAX_AGE: Duration = Duration::from_secs(6 * 3600);
/// Authenticated GitHub account list is refreshed at most every 15 minutes.
const GITHUB_LIST_EVERY: Duration = LIST_MAX_AGE;
/// Copies are compared once reads have been quiet this long.
const COPIES_QUIET: Duration = Duration::from_millis(1500);

/// What the caller asks for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cmd {
    /// Find repositories again and read them all.
    Rescan,
    /// Run `git ls-remote` now, for one repository or all.
    CheckRemotes(Option<PathBuf>),
    /// Persistently hide a repository from the monitor, leaving its files alone.
    RemoveRepo(PathBuf),
}

/// What the caller receives.
#[derive(Clone, Debug, PartialEq)]
pub enum Msg {
    Config(Box<Config>, Option<String>),
    Discovered(Discovery),
    Stats(PathBuf, Box<Result<Stats, String>>),
    Check(PathBuf, RemoteCheck),
    GitHub(String, GhRepo),
    GitHubList(Vec<GhListedRepo>),
    Copies(Vec<CopyDiff>),
    Rate(RateLimit),
    Busy { reading: usize, checking: usize },
    Watching(Result<(), String>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum GhReq {
    Repo(String),
    List,
}

enum Event {
    Cmd(Cmd),
    Watch(WatchEvent),
    Discovered(Discovery),
    Read(PathBuf, Box<Result<Stats, String>>),
    Ls(PathBuf, Result<Option<String>, String>, SystemTime),
    Copies(Vec<CopyDiff>, HashMap<(PathBuf, PathBuf), (String, String)>),
}

pub struct Engine {
    tx: Sender<Event>,
    capture: Option<Sender<Cmd>>,
}

impl Engine {
    /// An engine that starts no background threads, useful for `--demo` mode and tests.
    pub fn idle() -> (Engine, Receiver<Msg>) {
        let (tx, _) = mpsc::channel();
        let (_, rx) = mpsc::channel();
        (Engine { tx, capture: None }, rx)
    }

    /// An idle engine that records sent commands instead of dispatching them.
    pub fn recording() -> (Engine, Receiver<Msg>, Receiver<Cmd>) {
        let (tx, _) = mpsc::channel();
        let (_, rx) = mpsc::channel();
        let (capture, commands) = mpsc::channel();
        (Engine { tx, capture: Some(capture) }, rx, commands)
    }

    /// Start the coordinator and worker pools using the standard settings and
    /// cache locations. `notify` is called whenever a [`Msg`] is sent.
    pub fn start(notify: impl Fn() + Send + Sync + 'static) -> (Engine, Receiver<Msg>) {
        Self::start_with_paths(paths::config_file(), paths::cache_dir(), notify)
    }

    /// Start the coordinator and worker pools with explicit settings file and
    /// cache directory paths.
    pub fn start_with_paths(
        config_file: PathBuf,
        cache_dir: PathBuf,
        notify: impl Fn() + Send + Sync + 'static,
    ) -> (Engine, Receiver<Msg>) {
        let (tx, rx) = mpsc::channel();
        let (ui_tx, ui_rx) = mpsc::channel();
        let out = Out { tx: ui_tx, notify: Arc::new(notify) };
        let ev = tx.clone();
        std::thread::Builder::new()
            .name("repo-coordinator".into())
            .spawn(move || Coordinator::new(ev, out, config_file, cache_dir).run(rx))
            .expect("coordinator thread");
        (Engine { tx, capture: None }, ui_rx)
    }

    pub fn send(&self, cmd: Cmd) {
        if let Some(capture) = &self.capture {
            let _ = capture.send(cmd);
            return;
        }
        let _ = self.tx.send(Event::Cmd(cmd));
    }
}

/// The outbound channel: every message triggers the caller's notification callback.
#[derive(Clone)]
struct Out {
    tx: Sender<Msg>,
    notify: Arc<dyn Fn() + Send + Sync>,
}

impl Out {
    fn send(&self, msg: Msg) {
        let _ = self.tx.send(msg);
        (self.notify)();
    }
}

// ---------------------------------------------------------------------------
// Work queues

/// A queue of jobs keyed by path. A path is queued at most once, and a path
/// pushed while it is being worked on is queued again when that finishes, so
/// two threads never work on one path and no change is missed.
struct Queue<J> {
    state: Mutex<QueueState<J>>,
    ready: Condvar,
}

struct QueueState<J> {
    jobs: VecDeque<(PathBuf, J)>,
    queued: HashSet<PathBuf>,
    running: HashSet<PathBuf>,
    again: HashMap<PathBuf, J>,
}

impl<J> Queue<J> {
    fn new() -> Arc<Self> {
        Arc::new(Queue {
            state: Mutex::new(QueueState {
                jobs: VecDeque::new(),
                queued: HashSet::new(),
                running: HashSet::new(),
                again: HashMap::new(),
            }),
            ready: Condvar::new(),
        })
    }

    fn push(&self, path: PathBuf, job: J) {
        let mut s = self.state.lock().unwrap();
        if s.running.contains(&path) {
            s.again.insert(path, job);
        } else if s.queued.insert(path.clone()) {
            s.jobs.push_back((path, job));
            self.ready.notify_one();
        }
    }

    fn pop(&self) -> (PathBuf, J) {
        let mut s = self.state.lock().unwrap();
        loop {
            if let Some((path, job)) = s.jobs.pop_front() {
                s.queued.remove(&path);
                s.running.insert(path.clone());
                return (path, job);
            }
            s = self.ready.wait(s).unwrap();
        }
    }

    fn done(&self, path: &Path) {
        let mut s = self.state.lock().unwrap();
        s.running.remove(path);
        if let Some(job) = s.again.remove(path) {
            s.queued.insert(path.to_owned());
            s.jobs.push_back((path.to_owned(), job));
            self.ready.notify_one();
        }
    }

    fn len(&self) -> usize {
        let s = self.state.lock().unwrap();
        s.jobs.len() + s.running.len()
    }

    fn remove(&self, path: &Path) {
        let mut s = self.state.lock().unwrap();
        s.jobs.retain(|(p, _)| p != path);
        s.queued.remove(path);
        s.again.remove(path);
    }
}

/// An `ls-remote` job: the remote and the ref on it.
type LsJob = (String, String);

// ---------------------------------------------------------------------------
// The coordinator

struct Coordinator {
    ev: Sender<Event>,
    out: Out,
    config_file: PathBuf,
    config: Config,
    config_stamp: Option<SystemTime>,
    found: Vec<Found>,
    discovery_errors: Vec<(PathBuf, String)>,
    stats: HashMap<PathBuf, Stats>,
    /// The raw answer of the last `ls-remote` per repository, and when.
    ls: HashMap<PathBuf, (Result<Option<String>, String>, SystemTime)>,
    last_check: HashMap<PathBuf, Instant>,
    watcher: Option<Watcher>,
    watched: Vec<WatchedRepo>,
    reads: Arc<Queue<()>>,
    checks: Arc<Queue<LsJob>>,
    gh_tx: Sender<GhReq>,
    gh_asked: HashSet<String>,
    last_github_list: Option<Instant>,
    /// HEAD pairs already compared, and the results.
    copies: HashMap<(PathBuf, PathBuf), (String, String)>,
    copy_results: Vec<CopyDiff>,
    copies_due: Option<Instant>,
    copies_running: bool,
    discovering: bool,
    discover_again: bool,
    next_full_read: Instant,
    next_discover: Instant,
    next_remote_sweep: Instant,
    next_config_poll: Instant,
    next_github_list: Instant,
    busy: (usize, usize),
}

impl Coordinator {
    fn new(ev: Sender<Event>, out: Out, config_file: PathBuf, cache_dir: PathBuf) -> Coordinator {
        let reads = Queue::new();
        for n in 0..READERS {
            let (q, ev) = (reads.clone(), ev.clone());
            std::thread::Builder::new()
                .name(format!("repo-read-{n}"))
                .spawn(move || {
                    loop {
                        let (path, ()) = q.pop();
                        let result = git::read(&path);
                        q.done(&path);
                        if ev.send(Event::Read(path, Box::new(result))).is_err() {
                            return;
                        }
                    }
                })
                .expect("reader thread");
        }
        let checks: Arc<Queue<LsJob>> = Queue::new();
        for n in 0..CHECKERS {
            let (q, ev) = (checks.clone(), ev.clone());
            std::thread::Builder::new()
                .name(format!("repo-check-{n}"))
                .spawn(move || {
                    loop {
                        let (path, (remote, refname)) = q.pop();
                        let result = git::ls_remote(&path, &remote, &refname);
                        q.done(&path);
                        if ev.send(Event::Ls(path, result, SystemTime::now())).is_err() {
                            return;
                        }
                    }
                })
                .expect("check thread");
        }
        let gh_tx = spawn_github(cache_dir.join("github"), out.clone());
        Self::with_queues(ev, out, config_file, reads, checks, gh_tx)
    }

    fn with_queues(
        ev: Sender<Event>,
        out: Out,
        config_file: PathBuf,
        reads: Arc<Queue<()>>,
        checks: Arc<Queue<LsJob>>,
        gh_tx: Sender<GhReq>,
    ) -> Coordinator {
        let now = Instant::now();
        Coordinator {
            ev,
            out,
            config_file,
            config: Config::defaults(),
            config_stamp: None,
            found: Vec::new(),
            discovery_errors: Vec::new(),
            stats: HashMap::new(),
            ls: HashMap::new(),
            last_check: HashMap::new(),
            watcher: None,
            watched: Vec::new(),
            reads,
            checks,
            gh_tx,
            gh_asked: HashSet::new(),
            last_github_list: None,
            copies: HashMap::new(),
            copy_results: Vec::new(),
            copies_due: None,
            copies_running: false,
            discovering: false,
            discover_again: false,
            next_full_read: now + FULL_READ_EVERY,
            next_discover: now + DISCOVER_EVERY,
            next_remote_sweep: now + Duration::from_secs(remote_minutes(5)),
            next_config_poll: now + CONFIG_POLL,
            next_github_list: now + GITHUB_LIST_EVERY,
            busy: (usize::MAX, usize::MAX),
        }
    }

    fn run(mut self, rx: Receiver<Event>) {
        self.load_config();
        self.start_watcher();
        self.discover();
        self.request_github_list();
        loop {
            let wait = self.next_deadline().saturating_duration_since(Instant::now());
            match rx.recv_timeout(wait) {
                Ok(event) => self.handle(event),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            self.tick();
            self.report_busy();
        }
    }

    fn next_deadline(&self) -> Instant {
        let mut t = self
            .next_full_read
            .min(self.next_discover)
            .min(self.next_remote_sweep)
            .min(self.next_config_poll)
            .min(self.next_github_list);
        if let Some(due) = self.copies_due {
            t = t.min(due);
        }
        t
    }

    fn handle(&mut self, event: Event) {
        match event {
            Event::Cmd(Cmd::Rescan) => {
                if self.config_changed() {
                    self.load_config();
                    self.start_watcher();
                }
                self.discover();
            }
            Event::Cmd(Cmd::CheckRemotes(None)) => self.check_all(),
            Event::Cmd(Cmd::CheckRemotes(Some(path))) => self.check(&path),
            Event::Cmd(Cmd::RemoveRepo(path)) => {
                let file = self.config_file.clone();
                self.remove_repo(&file, &path);
            }
            Event::Watch(WatchEvent::Changed(path)) => {
                if self.found.iter().any(|f| f.path == path) {
                    self.reads.push(path, ());
                }
            }
            Event::Watch(WatchEvent::NewRepo) => self.discover(),
            Event::Watch(WatchEvent::Rescan) => self.read_all(),
            Event::Discovered(discovery) => self.discovered(discovery),
            Event::Read(path, result) => self.read_done(path, *result),
            Event::Ls(path, result, at) => {
                if self.found.iter().any(|f| f.path == path) {
                    self.ls.insert(path.clone(), (result, at));
                    self.send_check(&path);
                }
            }
            Event::Copies(mut diffs, mut pairs) => {
                self.copies_running = false;
                let ids: HashSet<&PathBuf> = self.found.iter().map(|f| &f.path).collect();
                diffs.retain(|d| ids.contains(&d.a) && ids.contains(&d.b));
                pairs.retain(|(a, b), _| ids.contains(a) && ids.contains(b));
                self.copies = pairs;
                self.copy_results = diffs.clone();
                self.out.send(Msg::Copies(diffs));
            }
        }
    }

    fn tick(&mut self) {
        let now = Instant::now();
        if now >= self.next_config_poll {
            self.next_config_poll = now + CONFIG_POLL;
            if self.config_changed() {
                let roots_before = (self.config.roots.clone(), self.config.skip_names.clone());
                self.load_config();
                if roots_before != (self.config.roots.clone(), self.config.skip_names.clone()) {
                    self.start_watcher();
                }
                self.discover();
            }
        }
        if now >= self.next_full_read {
            self.next_full_read = now + FULL_READ_EVERY;
            self.read_all();
        }
        if now >= self.next_discover {
            self.next_discover = now + DISCOVER_EVERY;
            self.discover();
        }
        if now >= self.next_remote_sweep {
            self.next_remote_sweep = now + self.remote_interval();
            self.check_all();
        }
        if now >= self.next_github_list {
            self.next_github_list = now + GITHUB_LIST_EVERY;
            self.request_github_list();
        }
        if self.copies_due.is_some_and(|t| now >= t) && !self.copies_running {
            self.copies_due = None;
            self.compare_copies();
        }
    }

    fn report_busy(&mut self) {
        let busy = (self.reads.len(), self.checks.len());
        if busy != self.busy {
            self.busy = busy;
            self.out.send(Msg::Busy { reading: busy.0, checking: busy.1 });
        }
    }

    // ---- settings and the watcher

    fn config_changed(&self) -> bool {
        modified(&self.config_file) != self.config_stamp
    }

    fn load_config(&mut self) {
        let file = &self.config_file;
        let (config, error) = config::load(file);
        self.config_stamp = modified(file);
        self.config = config;
        self.next_remote_sweep = Instant::now() + self.remote_interval();
        self.out.send(Msg::Config(Box::new(self.config.clone()), error));
    }

    fn remote_interval(&self) -> Duration {
        Duration::from_secs(remote_minutes(self.config.remote_check_minutes))
    }

    fn remove_repo(&mut self, file: &Path, path: &Path) {
        if !self.found.iter().any(|f| f.path == path) {
            return;
        }
        let config = match config::remove_repo(file, path) {
            Ok(config) => config,
            Err(error) => {
                self.out.send(Msg::Config(Box::new(self.config.clone()), Some(error)));
                return;
            }
        };
        // A removal may race an external settings edit. Keep the settings that
        // existing Found.root indexes refer to until the normal reload handles
        // those edits and restarts the watcher. Only consume the file stamp
        // when removal was the sole settings change.
        let mut other_settings = config.clone();
        other_settings.removed_repos = self.config.removed_repos.clone();
        if other_settings == self.config {
            self.config_stamp = modified(file);
        }
        self.config.removed_repos = config.removed_repos;
        self.next_remote_sweep = Instant::now() + self.remote_interval();
        self.found.retain(|f| !self.config.removes_repo(&f.path));
        self.stats.remove(path);
        self.ls.remove(path);
        self.last_check.remove(path);
        self.reads.remove(path);
        self.checks.remove(path);
        self.copies.retain(|(a, b), _| a != path && b != path);
        self.copy_results.retain(|d| d.a != path && d.b != path);
        self.out.send(Msg::Config(Box::new(self.config.clone()), None));
        self.out.send(Msg::Discovered(Discovery { repos: self.found.clone(), errors: self.discovery_errors.clone() }));
        self.out.send(Msg::Copies(self.copy_results.clone()));
        self.update_watched();
        self.discover();
    }

    fn start_watcher(&mut self) {
        self.watcher = None;
        let roots: Vec<PathBuf> = self.config.roots.iter().map(|r| r.path.clone()).collect();
        let ev = Mutex::new(self.ev.clone());
        let notify = Box::new(move |e: WatchEvent| {
            let _ = ev.lock().unwrap().send(Event::Watch(e));
        });
        match Watcher::start(&roots, self.config.skip_names.clone(), notify) {
            Ok(w) => {
                w.set_repos(self.watched.clone());
                self.watcher = Some(w);
                self.out.send(Msg::Watching(Ok(())));
            }
            Err(e) => self.out.send(Msg::Watching(Err(e))),
        }
    }

    fn update_watched(&mut self) {
        let watched: Vec<WatchedRepo> = self
            .found
            .iter()
            .map(|f| {
                let mut work_trees = vec![f.path.clone()];
                if let Some(s) = self.stats.get(&f.path) {
                    work_trees.extend(s.worktrees.iter().filter(|w| w.path.is_dir()).map(|w| w.path.clone()));
                }
                WatchedRepo { id: f.path.clone(), work_trees, git_dirs: vec![f.git_dir.clone()] }
            })
            .collect();
        if watched != self.watched {
            self.watched = watched;
            if let Some(w) = &self.watcher {
                w.set_repos(self.watched.clone());
            }
        }
    }

    // ---- discovery and reads

    fn discover(&mut self) {
        if self.discovering {
            self.discover_again = true;
            return;
        }
        self.discovering = true;
        let (config, ev) = (self.config.clone(), self.ev.clone());
        std::thread::spawn(move || {
            let _ = ev.send(Event::Discovered(discover::discover(&config)));
        });
    }

    fn discovered(&mut self, mut discovery: Discovery) {
        self.discovering = false;
        discovery.repos.retain(|f| !self.config.removes_repo(&f.path));
        self.discovery_errors = discovery.errors.clone();
        self.found = discovery.repos.clone();
        let ids: HashSet<&PathBuf> = self.found.iter().map(|f| &f.path).collect();
        self.stats.retain(|p, _| ids.contains(p));
        self.ls.retain(|p, _| ids.contains(p));
        self.last_check.retain(|p, _| ids.contains(p));
        self.out.send(Msg::Discovered(discovery));
        self.update_watched();
        self.read_all();
        if std::mem::take(&mut self.discover_again) {
            self.discover();
        }
    }

    fn read_all(&mut self) {
        for f in &self.found {
            self.reads.push(f.path.clone(), ());
        }
    }

    fn read_done(&mut self, path: PathBuf, result: Result<Stats, String>) {
        if !self.found.iter().any(|f| f.path == path) {
            return;
        }
        if let Ok(stats) = &result {
            let worktrees_changed =
                self.stats.get(&path).is_none_or(|old| old.worktrees.len() != stats.worktrees.len());
            let head_changed = self.stats.get(&path).is_none_or(|old| old.head_sha != stats.head_sha);
            self.ask_github(stats);
            self.stats.insert(path.clone(), stats.clone());
            if worktrees_changed {
                self.update_watched();
            }
            if head_changed {
                self.copies_due = Some(Instant::now() + COPIES_QUIET);
            }
            // The first read of a repository with an upstream checks its remote.
            if !self.last_check.contains_key(&path) {
                self.check(&path);
            }
            self.send_check(&path);
        }
        self.out.send(Msg::Stats(path, Box::new(result)));
    }

    // ---- remotes

    fn check_all(&mut self) {
        let paths: Vec<PathBuf> = self.found.iter().map(|f| f.path.clone()).collect();
        for p in paths {
            self.check(&p);
        }
    }

    fn check(&mut self, path: &Path) {
        let Some(stats) = self.stats.get(path) else { return };
        if let (Some(remote), Some(refname)) = (&stats.upstream_remote, &stats.upstream_ref) {
            self.last_check.insert(path.to_owned(), Instant::now());
            self.checks.push(path.to_owned(), (remote.clone(), refname.clone()));
        }
    }

    /// Compare the last `ls-remote` answer with the current remote-tracking
    /// ref and tell the caller.
    fn send_check(&self, path: &Path) {
        let (Some((ls, at)), Some(stats)) = (self.ls.get(path), self.stats.get(path)) else { return };
        let tip = remote::tip(stats, ls.clone());
        self.out.send(Msg::Check(path.to_owned(), RemoteCheck { at: *at, tip }));
    }

    fn ask_github(&mut self, stats: &Stats) {
        let Some(slug) =
            stats.main_remote().and_then(|r| remote::parse_url(&r.url)).and_then(|u| remote::github_slug(&u))
        else {
            return;
        };
        if self.gh_asked.insert(slug.to_lowercase()) {
            let _ = self.gh_tx.send(GhReq::Repo(slug));
        }
    }

    fn request_github_list(&mut self) {
        let now = Instant::now();
        if self.last_github_list.is_some_and(|t| now.saturating_duration_since(t) < GITHUB_LIST_EVERY) {
            return;
        }
        self.last_github_list = Some(now);
        self.next_github_list = now + GITHUB_LIST_EVERY;
        let _ = self.gh_tx.send(GhReq::List);
    }

    // ---- copies

    fn compare_copies(&mut self) {
        let repos: Vec<Repo> = self
            .found
            .iter()
            .filter_map(|f| {
                let stats = self.stats.get(&f.path)?;
                Some(Repo {
                    found: f.clone(),
                    name: String::new(),
                    ide: None,
                    category: String::new(),
                    stats: Some(Ok(stats.clone())),
                    relation: Relation::GitHub,
                    gh: None,
                    check: None,
                })
            })
            .collect();
        let groups = related::groups(&repos);
        let heads: HashMap<PathBuf, String> =
            self.stats.iter().filter_map(|(p, s)| Some((p.clone(), s.head_sha.clone()?))).collect();
        let mut pairs = Vec::new();
        for group in &groups {
            for (i, a) in group.iter().enumerate() {
                for b in &group[i + 1..] {
                    if let (Some(ha), Some(hb)) = (heads.get(a), heads.get(b)) {
                        pairs.push((a.clone(), b.clone(), ha.clone(), hb.clone()));
                    }
                }
            }
        }
        let known = self.copies.clone();
        let previous = self.copy_results.clone();
        let ev = self.ev.clone();
        self.copies_running = true;
        std::thread::spawn(move || {
            let mut diffs = Vec::new();
            let mut done = HashMap::new();
            for (a, b, ha, hb) in pairs {
                let key = (a.clone(), b.clone());
                let same_heads = known.get(&key) == Some(&(ha.clone(), hb.clone()));
                let cached = previous.iter().find(|d| d.a == a && d.b == b).cloned();
                let diff = match cached {
                    Some(d) if same_heads => d,
                    _ => {
                        let counts = if ha == hb {
                            Some((0, 0))
                        } else {
                            git::compare(&a, &ha, &hb).or_else(|| git::compare(&b, &hb, &ha).map(|(x, y)| (y, x)))
                        };
                        CopyDiff { a: a.clone(), b: b.clone(), counts }
                    }
                };
                done.insert(key, (ha, hb));
                diffs.push(diff);
            }
            let _ = ev.send(Event::Copies(diffs, done));
        });
    }
}

fn remote_minutes(m: u32) -> u64 {
    u64::from(m.max(1)) * 60
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// The GitHub thread: repository queries and account listing, answered from
/// the cache while young. The rate limit is read once a batch that hit the
/// network is through.
fn spawn_github(cache_dir: PathBuf, out: Out) -> Sender<GhReq> {
    let (tx, rx) = mpsc::channel::<GhReq>();
    std::thread::Builder::new()
        .name("repo-github".into())
        .spawn(move || {
            let gh = GitHub::new(cache_dir);
            let mut token_at: Option<Instant> = None;
            let mut pending: VecDeque<GhReq> = VecDeque::new();
            let mut batch_touched_network = false;
            loop {
                if pending.is_empty() {
                    match rx.recv() {
                        Ok(req) => pending.push_back(req),
                        Err(_) => return,
                    }
                }
                pending.extend(rx.try_iter());
                if token_at.is_none_or(|t| t.elapsed() > GITHUB_LIST_EVERY) {
                    gh.refresh_token();
                    token_at = Some(Instant::now());
                }
                let Some(req) = pending.pop_front() else { continue };
                match req {
                    GhReq::Repo(slug) => {
                        batch_touched_network = true;
                        if let Ok(fetched) = gh.repo(&slug, GITHUB_MAX_AGE) {
                            out.send(Msg::GitHub(slug.to_lowercase(), fetched.value));
                        }
                    }
                    GhReq::List => {
                        if let Ok(fetched) = gh.user_repos(GITHUB_LIST_EVERY) {
                            if gh.has_token() && fetched.origin != Origin::Cache {
                                batch_touched_network = true;
                            }
                            out.send(Msg::GitHubList(fetched.value));
                        }
                    }
                }
                pending.extend(rx.try_iter());
                if pending.is_empty() && batch_touched_network {
                    gh.refresh_limit();
                    out.send(Msg::Rate(gh.rate()));
                    batch_touched_network = false;
                }
            }
        })
        .expect("github thread");
    tx
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coordinator(config: Config, file: PathBuf) -> (Coordinator, Receiver<Msg>) {
        let (ev, _) = mpsc::channel();
        let (tx, rx) = mpsc::channel();
        let (gh, _) = mpsc::channel();
        let mut coordinator =
            Coordinator::with_queues(ev, Out { tx, notify: Arc::new(|| {}) }, file, Queue::new(), Queue::new(), gh);
        coordinator.config = config;
        (coordinator, rx)
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, Config, Discovery) {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        for name in ["broken", "broken/nested", "sibling"] {
            std::fs::create_dir_all(root.join(name).join(".git")).unwrap();
        }
        std::fs::write(root.join("broken/work.txt"), "unfinished work").unwrap();
        let file = root.join("config.toml");
        std::fs::write(&file, format!("[[root]]\npath = {:?}\ncategory = 'Test'\n", root.to_str().unwrap())).unwrap();
        let (config, error) = config::load(&file);
        assert_eq!(error, None);
        let discovery = discover::discover(&config);
        assert_eq!(discovery.repos.len(), 3);
        (dir, file, config, discovery)
    }

    #[test]
    fn removal_survives_inflight_discovery_read_remote_and_copy_results() {
        let (_dir, file, config, original) = fixture();
        let removed = file.parent().unwrap().join("broken");
        let sibling = file.parent().unwrap().join("sibling");
        let (mut c, output) = coordinator(config, file.clone());
        c.discovered(original.clone());
        output.try_iter().for_each(drop);
        // A worker already has the removed repository; one more read/check is queued.
        assert_eq!(c.reads.pop().0, removed);
        c.reads.push(removed.clone(), ());
        c.checks.push(removed.clone(), ("origin".into(), "refs/heads/main".into()));
        c.last_check.insert(removed.clone(), Instant::now());
        c.discovering = true;
        c.remove_repo(&file, &removed);
        assert!(c.config.removes_repo(&removed));
        assert_eq!(c.found.len(), 2);
        assert!(c.found.iter().any(|f| f.path == removed.join("nested")));
        assert!(!c.watched.iter().any(|w| w.id == removed));
        assert!(!c.last_check.contains_key(&removed));
        assert_eq!(c.checks.len(), 0);
        assert!(c.discover_again);
        let immediate: Vec<_> = output.try_iter().collect();
        assert!(matches!(immediate.first(), Some(Msg::Config(_, None))));
        assert!(immediate.iter().any(|m| matches!(m, Msg::Discovered(d) if d.repos.len() == 2)));
        c.reads.done(&removed);
        assert!(!c.reads.state.lock().unwrap().queued.contains(&removed));
        c.handle(Event::Read(removed.clone(), Box::new(Err("stale failure".into()))));
        c.handle(Event::Ls(removed.clone(), Ok(None), SystemTime::now()));
        c.handle(Event::Copies(
            vec![CopyDiff { a: removed.clone(), b: sibling.clone(), counts: Some((0, 0)) }],
            HashMap::from([((removed.clone(), sibling), ("a".into(), "b".into()))]),
        ));
        assert!(output.try_iter().all(|m| matches!(m, Msg::Copies(d) if d.is_empty())));
        assert!(c.ls.is_empty());
        assert!(c.copies.is_empty());
        c.discovered(original);
        assert_eq!(c.found.len(), 2);
        assert!(c.discovering, "the requested fresh scan must follow the old result");
        let loaded = config::load(&file).0;
        c.discovered(discover::discover(&loaded));
        assert_eq!(c.found.len(), 2);
        assert!(
            output.try_iter().all(|m| !matches!(m, Msg::Discovered(d) if d.repos.iter().any(|f| f.path == removed)))
        );
        assert_eq!(std::fs::read_to_string(removed.join("work.txt")).unwrap(), "unfinished work");
        assert!(removed.join(".git").is_dir());
    }

    #[test]
    fn failed_removal_keeps_repository_visible_and_reports_error() {
        let (_dir, file, config, discovery) = fixture();
        let removed = file.parent().unwrap().join("broken");
        let (mut c, output) = coordinator(config, file.clone());
        c.discovered(discovery);
        output.try_iter().for_each(drop);
        std::fs::write(&file, "invalid = [").unwrap();
        let before = c.found.clone();
        c.remove_repo(&file, &removed);
        assert_eq!(c.found, before);
        assert!(!c.config.removes_repo(&removed));
        assert!(c.watched.iter().any(|w| w.id == removed));
        let messages: Vec<_> = output.try_iter().collect();
        assert_eq!(messages.len(), 1);
        assert!(matches!(&messages[0], Msg::Config(_, Some(error)) if error.contains("could not remove repository")));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "invalid = [");
    }

    #[test]
    fn removal_does_not_adopt_external_root_edits_before_the_normal_reload() {
        let (_dir, file, mut config, _) = fixture();
        let removed = file.parent().unwrap().join("broken");
        let mut missing = config.roots[0].clone();
        missing.path = file.parent().unwrap().join("missing");
        config.roots.insert(0, missing);
        config.skip_names = vec!["old-skip".into()];
        let original = discover::discover(&config);
        assert!(original.repos.iter().all(|f| f.root == 1));
        let (mut c, output) = coordinator(config.clone(), file.clone());
        c.config_stamp = Some(SystemTime::UNIX_EPOCH);
        c.discovered(original);
        output.try_iter().for_each(drop);
        // The disk now has one root, so adopting it would invalidate root 1.
        let text = std::fs::read_to_string(&file).unwrap();
        std::fs::write(&file, format!("skip_names = ['new-skip']\nremote_check_minutes = 19\n{text}")).unwrap();
        c.remove_repo(&file, &removed);
        assert_eq!(c.config.roots, config.roots);
        assert_eq!(c.config.skip_names, ["old-skip"]);
        assert_eq!(c.config.remote_check_minutes, config.remote_check_minutes);
        assert_eq!(c.config_stamp, Some(SystemTime::UNIX_EPOCH));
        assert_ne!(c.config_stamp, modified(&file), "the normal poll must still detect the external edit");
        for found in &c.found {
            assert_eq!(discover::category(found, &c.config, None), "Test");
        }
        assert!(c.config.removes_repo(&removed));
        let disk = config::load(&file).0;
        assert_eq!(disk.roots.len(), 1);
        assert_eq!(disk.skip_names, ["new-skip"]);
        assert_eq!(disk.remote_check_minutes, 19);
        assert!(disk.removes_repo(&removed));
        let mut ui_config = config;
        for message in output.try_iter() {
            match message {
                Msg::Config(config, None) => ui_config = *config,
                Msg::Discovered(discovery) => {
                    for found in discovery.repos {
                        assert_eq!(discover::category(&found, &ui_config, None), "Test");
                    }
                }
                _ => {}
            }
        }
    }

    #[test]
    fn unknown_repository_cannot_change_settings() {
        let (_dir, file, config, discovery) = fixture();
        let (mut c, output) = coordinator(config, file.clone());
        c.discovered(discovery);
        output.try_iter().for_each(drop);
        let before = std::fs::read_to_string(&file).unwrap();
        c.remove_repo(&file, &file.parent().unwrap().join("unknown"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), before);
        assert!(output.try_recv().is_err());
    }

    #[test]
    fn recording_engine_captures_commands() {
        let (engine, _rx, cmds) = Engine::recording();
        engine.send(Cmd::Rescan);
        engine.send(Cmd::CheckRemotes(None));
        assert_eq!(cmds.try_recv().unwrap(), Cmd::Rescan);
        assert_eq!(cmds.try_recv().unwrap(), Cmd::CheckRemotes(None));
    }

    #[test]
    fn rescan_reloads_changed_config_and_restarts_watcher_before_discover() {
        let (_dir, file, config, _) = fixture();
        let extra_dir = tempfile::tempdir().unwrap();
        let extra_root = std::fs::canonicalize(extra_dir.path()).unwrap();
        let added_repo = extra_root.join("fresh-root-repo");
        std::fs::create_dir_all(added_repo.join(".git")).unwrap();

        let (ev, ev_rx) = mpsc::channel();
        let (tx, output) = mpsc::channel();
        let (gh, _gh_rx) = mpsc::channel();
        let mut c =
            Coordinator::with_queues(ev, Out { tx, notify: Arc::new(|| {}) }, file.clone(), Queue::new(), Queue::new(), gh);
        c.config = config;
        c.config_stamp = modified(&file);

        // Edit config.toml to add the second root and force a distinct mtime.
        let mut text = std::fs::read_to_string(&file).unwrap();
        text.push_str(&format!("\n[[root]]\npath = {:?}\ncategory = 'Added'\n", extra_root.to_str().unwrap()));
        std::fs::write(&file, &text).unwrap();
        if modified(&file) == c.config_stamp {
            c.config_stamp = Some(SystemTime::UNIX_EPOCH);
        }

        c.handle(Event::Cmd(Cmd::Rescan));
        assert_eq!(c.config.roots.len(), 2);
        assert_eq!(c.config_stamp, modified(&file));

        let messages: Vec<_> = output.try_iter().collect();
        assert!(messages.iter().any(|m| matches!(m, Msg::Config(cfg, None) if cfg.roots.len() == 2)));
        assert!(messages.iter().any(|m| matches!(m, Msg::Watching(_))));

        // The spawned discovery pass uses the newly reloaded config.
        let Event::Discovered(discovery) = ev_rx.recv_timeout(Duration::from_secs(5)).expect("discovery event") else {
            panic!("expected Event::Discovered");
        };
        assert!(discovery.repos.iter().any(|f| f.path == added_repo));
    }

    #[test]
    fn github_list_is_requested_at_most_once_per_15_minutes() {
        let (_dir, file, config, _) = fixture();
        let (ev, _) = mpsc::channel();
        let (tx, _) = mpsc::channel();
        let (gh_tx, gh_rx) = mpsc::channel();
        let mut c = Coordinator::with_queues(ev, Out { tx, notify: Arc::new(|| {}) }, file, Queue::new(), Queue::new(), gh_tx);
        c.config = config;

        c.request_github_list();
        assert_eq!(gh_rx.try_recv().ok(), Some(GhReq::List));

        // Calling again immediately is throttled by the 15-minute window.
        c.request_github_list();
        assert!(gh_rx.try_recv().is_err());
    }
}
