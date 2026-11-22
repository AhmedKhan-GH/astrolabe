//! Authenticated GitHub account repository listing (`GET /user/repos`) and
//! matching against local clones. Uses the [`GitHub`] client's in-memory token,
//! disk cache, per-page ETags (`If-None-Match`), and rate-limit tracking.

use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::github::{API, Error, Fetched, GitHub, Origin, at, now_secs};
pub use super::model::GhListedRepo;
use super::model::Repo;
use super::remote;

/// Minimum interval between GitHub account list refreshes (15 minutes).
pub const LIST_MAX_AGE: Duration = Duration::from_secs(900);

/// GitHub REST API maximum page size for `/user/repos`.
pub const PER_PAGE: usize = 100;

/// Defensive upper bound on pages fetched in a single sweep.
const MAX_PAGES: usize = 50;

const CACHE_FILE: &str = "user_repos.json";

// ---- wire and disk formats --------------------------------------------------

#[derive(Deserialize)]
struct WireOwner {
    login: String,
}

#[derive(Deserialize)]
struct WireListedRepo {
    full_name: String,
    name: String,
    owner: WireOwner,
    private: bool,
    visibility: Option<String>,
    #[serde(default)]
    default_branch: String,
    #[serde(default)]
    pushed_at: Option<String>,
    html_url: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct CachedListedRepo {
    full_name: String,
    name: String,
    owner: String,
    private: bool,
    visibility: String,
    default_branch: String,
    pushed_at: Option<i64>,
    html_url: String,
}

impl From<&GhListedRepo> for CachedListedRepo {
    fn from(r: &GhListedRepo) -> Self {
        CachedListedRepo {
            full_name: r.full_name.clone(),
            name: r.name.clone(),
            owner: r.owner.clone(),
            private: r.private,
            visibility: r.visibility.clone(),
            default_branch: r.default_branch.clone(),
            pushed_at: r.pushed_at.map(system_time_to_secs),
            html_url: r.html_url.clone(),
        }
    }
}

impl From<&CachedListedRepo> for GhListedRepo {
    fn from(r: &CachedListedRepo) -> Self {
        GhListedRepo {
            full_name: r.full_name.clone(),
            name: r.name.clone(),
            owner: r.owner.clone(),
            private: r.private,
            visibility: r.visibility.clone(),
            default_branch: r.default_branch.clone(),
            pushed_at: r.pushed_at.and_then(secs_to_system_time),
            html_url: r.html_url.clone(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct CachedPage {
    etag: Option<String>,
    repos: Vec<CachedListedRepo>,
}

#[derive(Serialize, Deserialize)]
struct ListCacheEntry {
    /// Unix seconds when GitHub last confirmed the list (200 or 304).
    fetched_at: u64,
    pages: Vec<CachedPage>,
}

/// Parses an ISO-8601 timestamp (such as GitHub's `pushed_at`) into a [`SystemTime`].
pub fn parse_timestamp(text: &str) -> Option<SystemTime> {
    let ts: jiff::Timestamp = text.trim().parse().ok()?;
    secs_to_system_time(ts.as_second())
}

fn secs_to_system_time(secs: i64) -> Option<SystemTime> {
    if secs >= 0 {
        UNIX_EPOCH.checked_add(Duration::from_secs(secs as u64))
    } else {
        UNIX_EPOCH.checked_sub(Duration::from_secs(secs.unsigned_abs()))
    }
}

fn system_time_to_secs(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(e) => -(e.duration().as_secs() as i64),
    }
}

/// Parses one page of `GET /user/repos` JSON into [`GhListedRepo`] entries.
pub fn parse_user_repos(body: &str) -> Result<Vec<GhListedRepo>, String> {
    let items: Vec<WireListedRepo> = serde_json::from_str(body).map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .map(|w| {
            let visibility = w.visibility.unwrap_or_else(|| if w.private { "private" } else { "public" }.to_owned());
            let pushed_at = w.pushed_at.as_deref().and_then(parse_timestamp);
            GhListedRepo {
                full_name: w.full_name,
                name: w.name,
                owner: w.owner.login,
                private: w.private,
                visibility,
                default_branch: w.default_branch,
                pushed_at,
                html_url: w.html_url,
            }
        })
        .collect())
}

fn flatten_pages(pages: &[CachedPage]) -> Vec<GhListedRepo> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for page in pages {
        for item in &page.repos {
            if seen.insert(github_copy_key(&item.full_name)) {
                out.push(GhListedRepo::from(item));
            }
        }
    }
    out
}

fn list_url(page: usize) -> String {
    format!("{API}/user/repos?affiliation=owner,organization_member&per_page={PER_PAGE}&page={page}")
}

// ---- matching against local clones ------------------------------------------

/// Canonical lowercase `github.com/{full_name}` key for a GitHub repository.
pub fn github_copy_key(full_name: &str) -> String {
    remote::github_copy_key(full_name)
}

/// Set of lowercase `host/path` keys across all remotes of all local repositories.
pub fn local_remote_keys(repos: &[Repo]) -> HashSet<String> {
    let mut keys = HashSet::new();
    for repo in repos {
        let Some(stats) = repo.stats() else { continue };
        for r in &stats.remotes {
            let Some(url) = remote::parse_url(&r.url) else { continue };
            keys.insert(remote::copy_key(&url));
            if let Some(slug) = remote::github_slug(&url) {
                keys.insert(github_copy_key(&slug));
            }
        }
    }
    keys
}

/// Filters `listed` down to GitHub repositories that have no local clone in `repos`.
pub fn remote_only(listed: &[GhListedRepo], repos: &[Repo]) -> Vec<GhListedRepo> {
    let local = local_remote_keys(repos);
    listed.iter().filter(|r| !local.contains(&github_copy_key(&r.full_name))).cloned().collect()
}

// ---- GitHub client extension ------------------------------------------------

impl GitHub {
    /// Lists repositories for the authenticated account via
    /// `GET /user/repos?affiliation=owner,organization_member&per_page=100&page={n}`.
    ///
    /// When unauthenticated (no `gh` token in memory), returns an empty list cleanly
    /// without making any network request.
    pub fn user_repos(&self, max_age: Duration) -> Result<Fetched<Vec<GhListedRepo>>, Error> {
        let Some(token) = self.current_token() else {
            return Ok(Fetched { value: Vec::new(), origin: Origin::Cache, fetched_at: UNIX_EPOCH });
        };

        let path = self.cache_dir().join(CACHE_FILE);
        let cached =
            std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<ListCacheEntry>(&s).ok());
        let stale = |cached: Option<ListCacheEntry>, reason: &str, err: Error| match cached {
            Some(entry) => Ok(Fetched {
                value: flatten_pages(&entry.pages),
                origin: Origin::Stale(reason.to_owned()),
                fetched_at: at(entry.fetched_at),
            }),
            None => Err(err),
        };

        // 1. Fresh enough.
        if let Some(entry) = &cached
            && now_secs().saturating_sub(entry.fetched_at) < max_age.as_secs()
        {
            let entry = cached.unwrap();
            return Ok(Fetched {
                value: flatten_pages(&entry.pages),
                origin: Origin::Cache,
                fetched_at: at(entry.fetched_at),
            });
        }

        // 2. Known rate limit exhausted for authenticated requests.
        if let Some(reset) = self.rate_limited_reset(true) {
            return stale(cached, "rate limited", Error::RateLimited { reset: at(reset) });
        }

        // 3. Conditional paged fetch.
        let mut new_pages: Vec<CachedPage> = Vec::new();
        let mut any_network = false;

        for page in 1..=MAX_PAGES {
            if page > 1
                && let Some(reset) = self.rate_limited_reset(true)
            {
                return stale(cached, "rate limited", Error::RateLimited { reset: at(reset) });
            }
            let url = list_url(page);
            let cached_page = cached.as_ref().and_then(|c| c.pages.get(page - 1));
            let etag = cached_page.and_then(|p| p.etag.as_deref());
            let resp = match self.get_raw(&url, etag, Some(&token)) {
                Ok(resp) => resp,
                Err(msg) => return stale(cached, "offline", Error::Network(msg)),
            };

            match resp.status {
                200 => match parse_user_repos(&resp.body) {
                    Ok(repos) => {
                        any_network = true;
                        let page_len = repos.len();
                        let cached_repos: Vec<CachedListedRepo> = repos.iter().map(CachedListedRepo::from).collect();
                        new_pages.push(CachedPage { etag: resp.etag, repos: cached_repos });
                        if page_len < PER_PAGE {
                            break;
                        }
                    }
                    Err(msg) => return stale(cached, "bad response", Error::Parse(msg)),
                },
                304 => match cached_page {
                    Some(cp) => {
                        let page_len = cp.repos.len();
                        new_pages.push(CachedPage {
                            etag: resp.etag.or_else(|| cp.etag.clone()),
                            repos: cp.repos.clone(),
                        });
                        if page_len < PER_PAGE {
                            break;
                        }
                    }
                    None => return Err(Error::Status(304)),
                },
                403 | 429 if resp.remaining == Some(0) || resp.retry_after.is_some() => {
                    let reset = self.current_reset().unwrap_or_else(|| now_secs() + 60);
                    return stale(cached, "rate limited", Error::RateLimited { reset: at(reset) });
                }
                404 => return Err(Error::NotFound),
                code => return stale(cached, &format!("HTTP {code}"), Error::Status(code)),
            }
        }

        let fetched_at = now_secs();
        let value = flatten_pages(&new_pages);
        let entry = ListCacheEntry { fetched_at, pages: new_pages };
        self.write_json(&path, &entry);
        let origin = if any_network { Origin::Network } else { Origin::NotModified };
        Ok(Fetched { value, origin, fetched_at: at(fetched_at) })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::repos::github::{RawResponse, Transport};
    use crate::repos::model::{Changes, Found, Head, IdeSource, Relation, Remote, Stats};

    const SINGLE_PAGE: &str = include_str!("../../tests/fixtures/github/user_repos_single.json");
    const PAGE_1: &str = include_str!("../../tests/fixtures/github/user_repos_page1.json");
    const PAGE_2: &str = include_str!("../../tests/fixtures/github/user_repos_page2.json");
    const RATE_LIMITED: &str = include_str!("../../tests/fixtures/github/rate_limited_403.json");

    const ETAG_1: &str = "W/\"list-page-1-etag\"";
    const ETAG_2: &str = "W/\"list-page-2-etag\"";

    type Seen = Vec<(String, Option<String>)>;

    #[derive(Clone, Default)]
    struct Fake {
        script: Arc<Mutex<VecDeque<Result<RawResponse, String>>>>,
        seen: Arc<Mutex<Seen>>,
        tokens: Arc<Mutex<Vec<Option<String>>>>,
    }

    impl Fake {
        fn push(&self, r: Result<RawResponse, String>) -> &Self {
            self.script.lock().unwrap().push_back(r);
            self
        }
        fn requests(&self) -> Seen {
            self.seen.lock().unwrap().clone()
        }
        fn tokens(&self) -> Vec<Option<String>> {
            self.tokens.lock().unwrap().clone()
        }
    }

    impl Transport for Fake {
        fn get(&self, url: &str, etag: Option<&str>, token: Option<&str>) -> Result<RawResponse, String> {
            self.seen.lock().unwrap().push((url.to_owned(), etag.map(str::to_owned)));
            self.tokens.lock().unwrap().push(token.map(str::to_owned));
            self.script.lock().unwrap().pop_front().expect("unscripted request")
        }
    }

    fn resp(status: u16, body: &str) -> RawResponse {
        RawResponse {
            status,
            etag: None,
            remaining: Some(4990),
            limit: Some(5000),
            reset: Some(now_secs() + 3000),
            retry_after: None,
            body: body.to_owned(),
        }
    }

    fn ok_etag(body: &str, etag: &str) -> RawResponse {
        RawResponse { etag: Some(etag.to_owned()), ..resp(200, body) }
    }

    fn rate_limited() -> RawResponse {
        RawResponse { remaining: Some(0), ..resp(403, RATE_LIMITED) }
    }

    struct Env {
        _tmp: tempfile::TempDir,
        dir: PathBuf,
        fake: Fake,
    }

    impl Env {
        fn new() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let dir = tmp.path().join("cache");
            Env { _tmp: tmp, dir, fake: Fake::default() }
        }

        fn client(&self, token: Option<&str>) -> GitHub {
            let mut gh = GitHub::with_transport(self.dir.clone(), Box::new(self.fake.clone()));
            gh.set_token_source(|| None);
            gh.set_token(token.map(str::to_owned));
            gh
        }

        fn cache_file(&self) -> PathBuf {
            self.dir.join(CACHE_FILE)
        }

        fn age_cache(&self, secs: u64) {
            let path = self.cache_file();
            let mut e: ListCacheEntry = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            e.fetched_at = now_secs() - secs;
            std::fs::write(&path, serde_json::to_vec(&e).unwrap()).unwrap();
        }
    }

    fn local_repo(name: &str, remotes: &[(&str, &str)]) -> Repo {
        let path = PathBuf::from(format!("/demo/workspaces/{name}"));
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
            remotes: remotes.iter().map(|(n, u)| Remote { name: (*n).into(), url: (*u).into() }).collect(),
            root_commits: vec![],
            read_at: UNIX_EPOCH,
            read_ms: 0,
        };
        Repo {
            found: Found {
                path: path.clone(),
                git_dir: path.join(".git"),
                root: 0,
                ide: None,
                ide_source: IdeSource::None,
                langs: vec![],
            },
            name: name.into(),
            ide: None,
            category: "Products and tools".into(),
            stats: Some(Ok(stats)),
            relation: if remotes.is_empty() { Relation::LocalOnly } else { Relation::GitHub },
            gh: None,
            check: None,
        }
    }

    #[test]
    fn unauthenticated_returns_empty_without_network_call() {
        let env = Env::new();
        let gh = env.client(None);
        let got = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert!(got.value.is_empty());
        assert!(env.fake.requests().is_empty());
        assert!(!env.cache_file().exists());
    }

    #[test]
    fn single_page_parses_fields_and_never_writes_token_to_disk() {
        let env = Env::new();
        env.fake.push(Ok(ok_etag(SINGLE_PAGE, ETAG_1)));
        let gh = env.client(Some("gho_secret_token_999"));
        let got = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(got.origin, Origin::Network);
        assert_eq!(got.value.len(), 3);
        assert_eq!(
            got.value[0],
            GhListedRepo {
                full_name: "Northstar-Labs/Sextant-Core".into(),
                name: "Sextant-Core".into(),
                owner: "Northstar-Labs".into(),
                private: true,
                visibility: "private".into(),
                default_branch: "main".into(),
                pushed_at: parse_timestamp("2026-11-18T10:31:40Z"),
                html_url: "https://github.com/Northstar-Labs/Sextant-Core".into(),
            }
        );
        assert_eq!(got.value[1].visibility, "public");
        assert_eq!(got.value[1].default_branch, "trunk");
        assert_eq!(got.value[2].visibility, "private");
        assert_eq!(got.value[2].pushed_at, None);
        assert_eq!(
            env.fake.requests(),
            vec![(
                "https://api.github.com/user/repos?affiliation=owner,organization_member&per_page=100&page=1".into(),
                None,
            )]
        );
        assert_eq!(env.fake.tokens(), vec![Some("gho_secret_token_999".into())]);
        assert_eq!(gh.rate().remaining, Some(4990));
        assert_eq!(gh.rate().limit, Some(5000));

        // Token must never be written to any cache file on disk.
        for entry in std::fs::read_dir(&env.dir).unwrap() {
            let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            assert!(!text.contains("gho_secret_token_999"));
        }
    }

    #[test]
    fn paging_fetches_until_page_shorter_than_100() {
        let env = Env::new();
        env.fake.push(Ok(ok_etag(PAGE_1, ETAG_1))).push(Ok(ok_etag(PAGE_2, ETAG_2)));
        let gh = env.client(Some("gho_tok"));
        let got = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(got.origin, Origin::Network);
        assert_eq!(got.value.len(), 102);
        assert_eq!(got.value[0].full_name, "northstar-labs/fleet-001");
        assert_eq!(got.value[99].full_name, "northstar-labs/fleet-100");
        assert_eq!(got.value[100].full_name, "northstar-labs/beacon-telemetry");
        assert_eq!(got.value[101].full_name, "cobalt-systems/kestrel-proto");
        assert_eq!(got.value[101].visibility, "internal");
        assert_eq!(
            env.fake.requests(),
            vec![
                (
                    "https://api.github.com/user/repos?affiliation=owner,organization_member&per_page=100&page=1"
                        .into(),
                    None,
                ),
                (
                    "https://api.github.com/user/repos?affiliation=owner,organization_member&per_page=100&page=2"
                        .into(),
                    None,
                ),
            ]
        );

        // Fresh cache serves immediately without requests.
        let cached = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(cached.origin, Origin::Cache);
        assert_eq!(cached.value, got.value);
        assert_eq!(env.fake.requests().len(), 2);
    }

    #[test]
    fn exact_100_page_fetches_empty_second_page_and_stops() {
        let env = Env::new();
        env.fake.push(Ok(ok_etag(PAGE_1, ETAG_1))).push(Ok(ok_etag("[]", ETAG_2)));
        let gh = env.client(Some("gho_tok"));
        let got = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(got.origin, Origin::Network);
        assert_eq!(got.value.len(), 100);
        assert_eq!(env.fake.requests().len(), 2);
    }

    #[test]
    fn etags_sent_across_pages_and_304_reuses_cache() {
        let env = Env::new();
        env.fake
            .push(Ok(ok_etag(PAGE_1, ETAG_1)))
            .push(Ok(ok_etag(PAGE_2, ETAG_2)))
            .push(Ok(resp(304, "")))
            .push(Ok(resp(304, "")));
        let gh = env.client(Some("gho_tok"));
        let first = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(first.value.len(), 102);

        // Age cache past 15 minutes (900s).
        env.age_cache(950);
        let second = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(second.origin, Origin::NotModified);
        assert_eq!(second.value, first.value);
        let reqs = env.fake.requests();
        assert_eq!(reqs.len(), 4);
        assert_eq!(reqs[2].1.as_deref(), Some(ETAG_1));
        assert_eq!(reqs[3].1.as_deref(), Some(ETAG_2));

        // fetched_at was refreshed so the next call hits cache without network.
        let third = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(third.origin, Origin::Cache);
        assert_eq!(env.fake.requests().len(), 4);
    }

    #[test]
    fn rate_limit_and_offline_fall_back_to_stale_cache() {
        let env = Env::new();
        env.fake
            .push(Ok(ok_etag(SINGLE_PAGE, ETAG_1)))
            .push(Err("offline".into()))
            .push(Ok(rate_limited()));
        let gh = env.client(Some("gho_tok"));
        let first = gh.user_repos(LIST_MAX_AGE).unwrap();
        env.age_cache(950);

        let offline = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(offline.origin, Origin::Stale("offline".into()));
        assert_eq!(offline.value, first.value);

        let limited = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(limited.origin, Origin::Stale("rate limited".into()));
        assert_eq!(limited.value, first.value);
        assert_eq!(gh.rate().remaining, Some(0));

        // Known exhausted limit prevents further requests.
        let blocked = gh.user_repos(LIST_MAX_AGE).unwrap();
        assert_eq!(blocked.origin, Origin::Stale("rate limited".into()));
        assert_eq!(env.fake.requests().len(), 3);
    }

    #[test]
    fn matches_ssh_https_case_git_suffix_and_secondary_remotes() {
        let mut listed = parse_user_repos(SINGLE_PAGE).unwrap();
        listed.extend(parse_user_repos(PAGE_2).unwrap());
        listed.push(GhListedRepo {
            full_name: "northstar-labs/harbor-proxy".into(),
            name: "harbor-proxy".into(),
            owner: "northstar-labs".into(),
            private: false,
            visibility: "public".into(),
            default_branch: "main".into(),
            pushed_at: None,
            html_url: "https://github.com/northstar-labs/harbor-proxy".into(),
        });
        listed.push(GhListedRepo {
            full_name: "example-org/solstice-docs".into(),
            name: "solstice-docs".into(),
            owner: "example-org".into(),
            private: false,
            visibility: "public".into(),
            default_branch: "main".into(),
            pushed_at: None,
            html_url: "https://github.com/example-org/solstice-docs".into(),
        });

        let locals = vec![
            // SSH SCP syntax + lowercase vs mixed-case full_name + .git suffix
            local_repo("sextant-core", &[("origin", "git@github.com:northstar-labs/sextant-core.git")]),
            // HTTPS without .git + mixed case host/path
            local_repo("orbit-scheduler", &[("origin", "https://GitHub.com/NORTHSTAR-LABS/ORBIT-SCHEDULER")]),
            // Secondary (upstream) remote with ssh:// URL and port
            local_repo(
                "harbor-fork",
                &[
                    ("origin", "https://git.overleaf.example/123456"),
                    ("upstream", "ssh://git@github.com:22/Northstar-Labs/Harbor-Proxy.git"),
                ],
            ),
            // ssh.github.com variant
            local_repo("solstice-docs", &[("origin", "ssh://git@ssh.github.com:443/example-org/solstice-docs.git")]),
            // Local-only repo (no remotes)
            local_repo("meridian-sim", &[]),
        ];

        let remaining = remote_only(&listed, &locals);
        let names: Vec<&str> = remaining.iter().map(|r| r.full_name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "example-org/empty-draft",
                "northstar-labs/beacon-telemetry",
                "cobalt-systems/kestrel-proto",
            ]
        );
    }
}
