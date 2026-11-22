//! Background threads, one per source, each on its own interval. They write
//! into one shared snapshot that the caller reads whenever notified.
//!
//! CHECK NOW wakes the sources, but a source checked less than `MIN_GAP` ago
//! is left alone, so a burst of clicks never polls faster than the intervals
//! intend.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::limits::{self, claude, codex, glm, hosted, mistral, ollama, tui, xiaomi};
use super::model::{Limit, OllamaState, Provider, Status, now};
use super::tools::{self, Agent};
use super::{keychain, paths, pty, zcode};

/// How often the installed tools and their sign-in are looked at again.
pub const AGENTS_EVERY: Duration = Duration::from_secs(600);
/// The shortest gap between two checks of one source, even on CHECK NOW.
pub const MIN_GAP: Duration = Duration::from_secs(30);

/// Everything the agent monitor exposes.
#[derive(Clone, Debug, PartialEq)]
pub struct Shared {
    pub limits: BTreeMap<Provider, Limit>,
    pub ollama: OllamaState,
    pub agents: Vec<Agent>,
    pub agents_at: Option<f64>,
    /// Files a tool left in the probe folder, which should stay empty.
    pub probe_left: Vec<String>,
    pub stored_keys: BTreeSet<Provider>,
    /// The last settings error, such as a Keychain failure.
    pub settings_error: Option<(Provider, String)>,
}

impl Default for Shared {
    fn default() -> Shared {
        let limits = Provider::ALL
            .into_iter()
            .filter(|p| *p != Provider::Ollama)
            .map(|p| (p, Limit::new(p, Status::Checking, "First check running")))
            .collect();
        Shared {
            limits,
            ollama: OllamaState::checking(),
            agents: Vec::new(),
            agents_at: None,
            probe_left: Vec::new(),
            stored_keys: BTreeSet::new(),
            settings_error: None,
        }
    }
}

impl Shared {
    /// The limits in display order, Ollama aside.
    pub fn limit_list(&self) -> Vec<&Limit> {
        self.limits.values().collect()
    }

    pub fn agent(&self, id: &str) -> Option<&Agent> {
        self.agents.iter().find(|a| a.id == id)
    }
}

pub enum Cmd {
    CheckNow,
    SetKey(Provider, String),
    ForgetKey(Provider),
}

/// Where the engine reads and writes.
#[derive(Clone, Debug)]
pub struct Config {
    pub home: PathBuf,
    pub probe: PathBuf,
}

impl Config {
    pub fn real() -> Config {
        Config { home: paths::home(), probe: paths::probe_dir() }
    }
}

pub struct Engine {
    pub shared: Arc<Mutex<Shared>>,
    tx: Sender<Cmd>,
}

impl Engine {
    /// An engine that runs nothing: callers read `shared` as it is. Useful for
    /// `--demo` mode and tests.
    pub fn fixed(shared: Shared) -> Engine {
        let (tx, _rx) = channel();
        Engine { shared: Arc::new(Mutex::new(shared)), tx }
    }

    /// Start every source. `notify` is called whenever something changed.
    pub fn start(config: Config, notify: impl Fn() + Send + Sync + 'static) -> Engine {
        let shared = Arc::new(Mutex::new(Shared::default()));
        let notify: Arc<dyn Fn() + Send + Sync> = Arc::new(notify);
        let (tx, rx) = channel();
        let mut wakers: Vec<Sender<()>> = Vec::new();
        let keys: BTreeMap<_, _> = keychain::KEY_PROVIDERS
            .iter()
            .map(|&provider| (provider, Arc::new(Mutex::new(keychain::CachedKey::new(provider)))))
            .collect();
        let mut key_wakers = BTreeMap::new();

        // Installed tools first: the limit checks need to know where they are.
        let found = Arc::new(Mutex::new(None::<Vec<Agent>>));
        {
            let (w, r) = channel();
            wakers.push(w);
            let (shared, notify, found, probe) = (shared.clone(), notify.clone(), found.clone(), config.probe.clone());
            std::thread::Builder::new()
                .name("agents".into())
                .spawn(move || {
                    every(AGENTS_EVERY, r, || {
                        let _ = pty::probe_folder(&probe);
                        let list = tools::detect(&tools::Env::real_with_probe(probe.clone()));
                        *found.lock().unwrap() = Some(list.clone());
                        let left = pty::probe_folder(&probe).unwrap_or_default();
                        let mut s = shared.lock().unwrap();
                        for limit in list.iter().filter_map(limits::harnesses::setup) {
                            s.limits.insert(limit.provider, limit);
                        }
                        s.agents = list;
                        s.agents_at = Some(now());
                        s.probe_left = left;
                        drop(s);
                        notify();
                    })
                })
                .expect("agents thread");
        }
        let program = {
            let found = found.clone();
            move |id: &str| -> Option<Option<PathBuf>> {
                let guard = found.lock().unwrap();
                let list = guard.as_ref()?;
                Some(list.iter().find(|a| a.id == id && a.installed()).and_then(|a| a.path.clone()))
            }
        };

        // The pseudo-terminal checks, each waiting for the tool list first.
        type Check = Box<dyn Fn(Option<&std::path::Path>) -> Limit + Send>;
        let tuis: Vec<(&str, Provider, Duration, Check)> = vec![
            ("claude", Provider::Claude, claude::EVERY, {
                let c = config.clone();
                Box::new(move |p| claude::check(p, &c.home, &c.probe))
            }),
            ("kimi", Provider::Kimi, tui::KIMI_EVERY, {
                let c = config.clone();
                Box::new(move |p| tui::kimi(p, &c.home, &c.probe))
            }),
            ("agy", Provider::Gemini, tui::AGY_EVERY, {
                let c = config.clone();
                Box::new(move |p| tui::gemini(p, &c.home, &c.probe))
            }),
        ];
        for (id, provider, interval, check) in tuis {
            let (w, r) = channel();
            wakers.push(w);
            let (shared, notify, program, probe) =
                (shared.clone(), notify.clone(), program.clone(), config.probe.clone());
            std::thread::Builder::new()
                .name(format!("limits-{id}"))
                .spawn(move || {
                    let path = loop {
                        if let Some(p) = program(id) {
                            break p;
                        }
                        std::thread::sleep(Duration::from_millis(200));
                    };
                    let mut path = path;
                    every(interval, r, || {
                        if let Some(p) = program(id) {
                            path = p;
                        }
                        let limit = check(path.as_deref());
                        let left = pty::probe_folder(&probe).unwrap_or_default();
                        let mut s = shared.lock().unwrap();
                        s.limits.insert(provider, limit);
                        s.probe_left = left;
                        drop(s);
                        notify();
                    })
                })
                .expect("limits thread");
        }

        // Codex, from its session files.
        {
            let (w, r) = channel();
            wakers.push(w);
            let (shared, notify, program, home) = (shared.clone(), notify.clone(), program.clone(), config.home.clone());
            std::thread::Builder::new()
                .name("limits-codex".into())
                .spawn(move || {
                    every(codex::EVERY, r, || {
                        let installed = program("codex").is_none_or(|p| p.is_some());
                        let limit = codex::check(&home.join(".codex/sessions"), installed);
                        shared.lock().unwrap().limits.insert(Provider::Codex, limit);
                        notify();
                    })
                })
                .expect("codex thread");
        }

        // Optional API keys stay in worker-private caches, never in Shared.
        for &provider in keychain::KEY_PROVIDERS {
            let (wake, receive) = channel();
            wakers.push(wake.clone());
            key_wakers.insert(provider, wake);
            let (shared, notify, home) = (shared.clone(), notify.clone(), config.home.clone());
            let key = keys[&provider].clone();
            std::thread::Builder::new()
                .name(format!("limits-{provider:?}"))
                .spawn(move || {
                    let mut credentials = zcode::Credentials::default();
                    let interval = match provider {
                        Provider::Glm => glm::EVERY,
                        Provider::Mistral => mistral::EVERY,
                        Provider::Xiaomi => xiaomi::EVERY,
                        _ => hosted::EVERY,
                    };
                    every(interval, receive, || {
                        let (stored, revision) = {
                            let mut cache = key.lock().unwrap();
                            (cache.read(), cache.revision())
                        };
                        let has_key = stored.as_ref().is_ok_and(|key| key.is_some());
                        let limit = match stored {
                            Err(error) => Limit::new(provider, Status::Setup, error),
                            Ok(key) => match provider {
                                Provider::Glm => glm::check(&home, key.as_deref(), &mut credentials),
                                Provider::Mistral => {
                                    let key = key.or_else(|| mistral::configured_key(&home));
                                    mistral::check(key.as_deref())
                                }
                                Provider::MiniMax | Provider::DeepSeek => {
                                    let key = match key {
                                        Some(key) => Ok(Some(key)),
                                        None => hosted::configured_key(provider),
                                    };
                                    match key {
                                        Ok(key) => hosted::check(provider, key.as_deref()),
                                        Err(error) => Limit::new(provider, Status::Setup, error),
                                    }
                                }
                                Provider::Xiaomi => xiaomi::check(&home, key.as_deref()),
                                _ => unreachable!("only providers with API keys are polled here"),
                            },
                        };
                        // A key saved or removed during the request makes this
                        // response stale. Serialize publication with mutations.
                        let cache = key.lock().unwrap();
                        if cache.revision() != revision {
                            return;
                        }
                        let mut s = shared.lock().unwrap();
                        if has_key {
                            s.stored_keys.insert(provider);
                        } else {
                            s.stored_keys.remove(&provider);
                        }
                        s.limits.insert(provider, limit);
                        drop(s);
                        drop(cache);
                        notify();
                    })
                })
                .expect("provider quota thread");
        }

        // Ollama and free memory.
        {
            let (w, r) = channel();
            wakers.push(w);
            let (shared, notify, program) = (shared.clone(), notify.clone(), program.clone());
            std::thread::Builder::new()
                .name("ollama".into())
                .spawn(move || {
                    let mut shapes = ollama::Shapes::new();
                    let mut tracker = ollama::Tracker::default();
                    every(ollama::EVERY, r, || {
                        let installed = program("ollama").is_none_or(|p| p.is_some());
                        let mut state = ollama::check(installed, &mut shapes);
                        tracker.observe(&mut state);
                        let mut s = shared.lock().unwrap();
                        if s.ollama != state {
                            s.ollama = state;
                            drop(s);
                            notify();
                        }
                    })
                })
                .expect("ollama thread");
        }

        // Commands from the caller.
        {
            let shared = shared.clone();
            let notify = notify.clone();
            std::thread::Builder::new()
                .name("commands".into())
                .spawn(move || {
                    let rx: Receiver<Cmd> = rx;
                    for cmd in rx {
                        match cmd {
                            Cmd::CheckNow => {
                                for w in &wakers {
                                    let _ = w.send(());
                                }
                            }
                            Cmd::SetKey(provider, key) => {
                                let Some(cache) = keys.get(&provider) else { continue };
                                let result = cache.lock().unwrap().store(&key);
                                drop(key);
                                let mut s = shared.lock().unwrap();
                                if result.is_ok() {
                                    s.stored_keys.insert(provider);
                                    s.limits.insert(
                                        provider,
                                        Limit::new(provider, Status::Checking, "Checking updated account"),
                                    );
                                }
                                s.settings_error = result.err().map(|e| (provider, e));
                                drop(s);
                                if let Some(wake) = key_wakers.get(&provider) {
                                    let _ = wake.send(());
                                }
                            }
                            Cmd::ForgetKey(provider) => {
                                let Some(cache) = keys.get(&provider) else { continue };
                                let result = cache.lock().unwrap().forget();
                                let mut s = shared.lock().unwrap();
                                if result.is_ok() {
                                    s.stored_keys.remove(&provider);
                                    s.limits.insert(
                                        provider,
                                        Limit::new(provider, Status::Checking, "Checking account credentials"),
                                    );
                                }
                                s.settings_error = result.err().map(|e| (provider, e));
                                drop(s);
                                if let Some(wake) = key_wakers.get(&provider) {
                                    let _ = wake.send(());
                                }
                            }
                        }
                        notify();
                    }
                })
                .expect("command thread");
        }

        Engine { shared, tx }
    }

    pub fn send(&self, cmd: Cmd) {
        let _ = self.tx.send(cmd);
    }

    pub fn snapshot(&self) -> Shared {
        self.shared.lock().unwrap().clone()
    }
}

/// Run `job` now and then every `interval`, or sooner when woken, but never
/// twice within `MIN_GAP`. Ends when the waking side is gone.
fn every(interval: Duration, wake: Receiver<()>, mut job: impl FnMut()) {
    loop {
        let started = Instant::now();
        job();
        let mut due = started + interval;
        loop {
            let wait = due.saturating_duration_since(Instant::now());
            match wake.recv_timeout(wait) {
                Ok(()) => {
                    // A wake-up brings the next check forward, but not
                    // closer than MIN_GAP to the last one.
                    due = due.min(started + MIN_GAP.min(interval));
                    while wake.try_recv().is_ok() {}
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if Instant::now() >= due {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn wake_ups_respect_the_minimum_gap() {
        let runs = Arc::new(AtomicUsize::new(0));
        let (tx, rx) = channel();
        let r = runs.clone();
        let t = std::thread::spawn(move || {
            every(Duration::from_millis(300), rx, || {
                r.fetch_add(1, Ordering::SeqCst);
            })
        });
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        // Many wake-ups within the gap bring one early run at most; with the
        // interval shorter than MIN_GAP the interval is the gap.
        for _ in 0..5 {
            tx.send(()).unwrap();
        }
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(runs.load(Ordering::SeqCst), 2);
        drop(tx);
        t.join().unwrap();
    }
}
