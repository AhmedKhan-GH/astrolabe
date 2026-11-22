//! What the window knows: the repositories as rows, with their category,
//! relation and GitHub answer, the remote checks and the copies.
//! Fed by the engine's messages; recomputed in one place when anything changes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::engine::Msg;
use super::github::RateLimit;
use super::model::{Config, CopyDiff, Found, GhRepo, Relation, RemoteCheck, Repo, Stats};
use super::{discover, related, remote};

#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub config: Config,
    pub config_error: Option<String>,
    /// Sorted by path.
    pub repos: Vec<Repo>,
    index: HashMap<PathBuf, usize>,
    found: Vec<Found>,
    stats: HashMap<PathBuf, Result<Stats, String>>,
    gh: HashMap<String, GhRepo>,
    checks: HashMap<PathBuf, RemoteCheck>,
    pub copies: Vec<CopyDiff>,
    pub groups: Vec<Vec<PathBuf>>,
    pub discovery_errors: Vec<(PathBuf, String)>,
    pub discovered: bool,
    pub reading: usize,
    pub checking: usize,
    pub rate: RateLimit,
    pub watching: Option<Result<(), String>>,
    /// When the last remote check answered.
    pub last_check: Option<SystemTime>,
    /// Counts the rebuilds of the rows, so views over them know when to follow.
    pub generation: u64,
    dirty: bool,
}

impl Default for State {
    fn default() -> Self {
        Self::new()
    }
}

impl State {
    pub fn new() -> State {
        State {
            config: Config::defaults(),
            config_error: None,
            repos: Vec::new(),
            index: HashMap::new(),
            found: Vec::new(),
            stats: HashMap::new(),
            gh: HashMap::new(),
            checks: HashMap::new(),
            copies: Vec::new(),
            groups: Vec::new(),
            discovery_errors: Vec::new(),
            discovered: false,
            reading: 0,
            checking: 0,
            rate: RateLimit::default(),
            watching: None,
            last_check: None,
            generation: 0,
            dirty: false,
        }
    }

    pub fn apply(&mut self, msg: Msg) {
        match msg {
            Msg::Config(config, error) => {
                self.config = *config;
                self.config_error = error;
            }
            Msg::Discovered(d) => {
                self.found = d.repos;
                self.discovery_errors = d.errors;
                self.discovered = true;
            }
            Msg::Stats(path, result) => {
                self.stats.insert(path, *result);
            }
            Msg::Check(path, check) => {
                self.last_check = Some(self.last_check.map_or(check.at, |t| t.max(check.at)));
                self.checks.insert(path, check);
            }
            Msg::GitHub(slug, repo) => {
                self.gh.insert(slug, repo);
            }
            Msg::Copies(diffs) => self.copies = diffs,
            Msg::Rate(rate) => self.rate = rate,
            Msg::Busy { reading, checking } => {
                self.reading = reading;
                self.checking = checking;
                return;
            }
            Msg::Watching(w) => {
                self.watching = Some(w);
                return;
            }
        }
        self.dirty = true;
    }

    /// Rebuild the rows after messages changed something.
    pub fn settle(&mut self) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        self.generation += 1;
        let ids: std::collections::HashSet<&PathBuf> = self.found.iter().map(|f| &f.path).collect();
        self.stats.retain(|p, _| ids.contains(p));
        self.checks.retain(|p, _| ids.contains(p));
        self.repos = self.found.iter().map(|f| self.row(f)).collect();
        self.index = self.repos.iter().enumerate().map(|(i, r)| (r.found.path.clone(), i)).collect();
        self.groups = related::groups(&self.repos);
    }

    fn row(&self, found: &Found) -> Repo {
        let stats = self.stats.get(&found.path).cloned();
        let ok = stats.as_ref().and_then(|s| s.as_ref().ok());
        let gh = ok.and_then(github_slug).and_then(|slug| self.gh.get(&slug.to_lowercase())).cloned();
        let relation = match ok {
            Some(s) => remote::relation(s, gh.as_ref()),
            // Not read yet: no bucket is shown for it.
            None => Relation::OtherHost(String::new()),
        };
        let name = found.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        Repo {
            category: discover::category(found, &self.config, gh.as_ref()),
            ide: found.ide,
            name,
            relation,
            check: self.checks.get(&found.path).cloned(),
            gh,
            stats,
            found: found.clone(),
        }
    }

    pub fn repo(&self, id: &Path) -> Option<&Repo> {
        self.index.get(id).map(|&i| &self.repos[i])
    }

    /// Where a repository is among the rows.
    pub fn position(&self, id: &Path) -> Option<usize> {
        self.index.get(id).copied()
    }

    /// The other copies of a repository.
    pub fn copies_of(&self, id: &Path) -> Vec<PathBuf> {
        related::related_to(&self.groups, id)
    }

    /// How `id` and `other` differ in commits: (on id only, on other only).
    pub fn copy_counts(&self, id: &Path, other: &Path) -> Option<Option<(u32, u32)>> {
        self.copies.iter().find_map(|d| {
            if d.a == id && d.b == other {
                Some(d.counts)
            } else if d.a == other && d.b == id {
                Some(d.counts.map(|(x, y)| (y, x)))
            } else {
                None
            }
        })
    }

    pub fn unreadable(&self) -> Vec<&Repo> {
        self.repos.iter().filter(|r| r.error().is_some()).collect()
    }

    pub fn read_count(&self) -> usize {
        self.repos.iter().filter(|r| r.stats.is_some()).count()
    }
}

pub fn github_slug(stats: &Stats) -> Option<String> {
    stats.main_remote().and_then(|r| remote::parse_url(&r.url)).and_then(|u| remote::github_slug(&u))
}
