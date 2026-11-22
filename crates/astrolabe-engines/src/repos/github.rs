//! GitHub reads for the remote relation: what a repository's visibility is and
//! whether the user can push to it. Reads go through the public REST API with
//! an on-disk cache, ETags and rate-limit handling. When `gh` is logged in, its
//! token goes on api.github.com requests; it is kept in memory only, never
//! written to the cache or logged.
//!
//! Interface used by the rest of the crate:
//!
//! - `GitHub::new(cache_dir)` where `cache_dir` is `paths::cache_dir().join("github")`.
//! - `repo(slug, max_age)`: `GET /repos/{owner}/{name}` as a [`GhRepo`]. If the
//!   cached response is younger than `max_age`, it is returned without a
//!   request (`Origin::Cache`). Otherwise a conditional request is made.
//! - `refresh_token()`: ask `gh auth token` again; call it at the start of a check.
//! - `refresh_limit()`: read the current rate limit; free, call it at the end.
//! - `GitHub` is `Send + Sync`; several threads call it at once.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::model::GhRepo;

/// Where a returned value came from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Origin {
    /// 200 from the network.
    Network,
    /// 304; the cached body was used.
    NotModified,
    /// The cache was younger than `max_age`; no request was made.
    Cache,
    /// The request failed or was rate limited; the cached body was used.
    /// The string is a short reason such as "rate limited" or "offline".
    Stale(String),
}

#[derive(Clone, Debug)]
pub struct Fetched<T> {
    pub value: T,
    pub origin: Origin,
    /// When the body was last received from GitHub (200 or 304).
    pub fetched_at: SystemTime,
}

/// Errors are returned only when there is no cached body to fall back on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    RateLimited { reset: SystemTime },
    NotFound,
    Status(u16),
    Network(String),
    Parse(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::RateLimited { .. } => write!(f, "rate limited"),
            Error::NotFound => write!(f, "not found"),
            Error::Status(code) => write!(f, "HTTP {code}"),
            Error::Network(e) => write!(f, "network: {e}"),
            Error::Parse(e) => write!(f, "parse: {e}"),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RateLimit {
    pub remaining: Option<u32>,
    /// Requests per hour: 60 unauthenticated, 5000 with a token.
    pub limit: Option<u32>,
    pub reset: Option<SystemTime>,
}

pub(super) const API: &str = "https://api.github.com";
const API_PREFIX: &str = "https://api.github.com/";

// ---- transport seam ---------------------------------------------------------

/// What the client needs from one HTTP response.
pub(super) struct RawResponse {
    pub(super) status: u16,
    pub(super) etag: Option<String>,
    pub(super) remaining: Option<u32>,
    /// `X-RateLimit-Limit`.
    pub(super) limit: Option<u32>,
    /// `X-RateLimit-Reset`, unix seconds.
    pub(super) reset: Option<u64>,
    /// `Retry-After`, seconds.
    pub(super) retry_after: Option<u64>,
    pub(super) body: String,
}

pub(super) trait Transport: Send + Sync {
    /// `Err` is a transport failure (offline, timeout, TLS); HTTP statuses are `Ok`.
    /// `token` is sent as a bearer token; only api.github.com URLs come here.
    fn get(&self, url: &str, etag: Option<&str>, token: Option<&str>) -> Result<RawResponse, String>;
}

struct UreqTransport {
    agent: ureq::Agent,
}

impl UreqTransport {
    fn new() -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .into();
        UreqTransport { agent }
    }
}

impl Transport for UreqTransport {
    fn get(&self, url: &str, etag: Option<&str>, token: Option<&str>) -> Result<RawResponse, String> {
        let mut req = self
            .agent
            .get(url)
            .header("User-Agent", "repo-monitor")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(etag) = etag {
            req = req.header("If-None-Match", etag);
        }
        // Only ever to the API host. ureq drops it on redirects to other hosts.
        if let Some(token) = token.filter(|_| url.starts_with(API_PREFIX)) {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        let mut resp = req.call().map_err(|e| e.to_string())?;
        let header = |name: &str| resp.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
        let status = resp.status().as_u16();
        let etag = header("etag");
        let remaining = header("x-ratelimit-remaining").and_then(|v| v.trim().parse().ok());
        let limit = header("x-ratelimit-limit").and_then(|v| v.trim().parse().ok());
        let reset = header("x-ratelimit-reset").and_then(|v| v.trim().parse().ok());
        let retry_after = header("retry-after").and_then(|v| v.trim().parse().ok());
        // A 304 has no body, but may still carry Content-Encoding: gzip, which fails to decode.
        let body =
            if status == 304 { String::new() } else { resp.body_mut().read_to_string().map_err(|e| e.to_string())? };
        Ok(RawResponse { status, etag, remaining, limit, reset, retry_after, body })
    }
}

// ---- wire and disk formats --------------------------------------------------

#[derive(Deserialize)]
struct WireRepo {
    full_name: String,
    private: bool,
    visibility: Option<String>,
    permissions: Option<WirePermissions>,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    fork: bool,
    html_url: String,
    #[serde(default)]
    default_branch: String,
}

#[derive(Deserialize)]
struct WirePermissions {
    #[serde(default)]
    push: bool,
}

fn parse_repo(body: &str) -> Result<GhRepo, String> {
    let w: WireRepo = serde_json::from_str(body).map_err(|e| e.to_string())?;
    // Older responses lack `visibility`.
    let visibility = w.visibility.unwrap_or_else(|| if w.private { "private" } else { "public" }.to_owned());
    Ok(GhRepo {
        full_name: w.full_name,
        private: w.private,
        visibility,
        can_push: w.permissions.map(|p| p.push),
        archived: w.archived,
        fork: w.fork,
        html_url: w.html_url,
        default_branch: w.default_branch,
    })
}

/// A [`GhRepo`] as the cache stores it.
#[derive(Serialize, Deserialize)]
struct CachedRepo {
    full_name: String,
    private: bool,
    visibility: String,
    can_push: Option<bool>,
    archived: bool,
    fork: bool,
    html_url: String,
    default_branch: String,
}

impl From<&GhRepo> for CachedRepo {
    fn from(r: &GhRepo) -> Self {
        CachedRepo {
            full_name: r.full_name.clone(),
            private: r.private,
            visibility: r.visibility.clone(),
            can_push: r.can_push,
            archived: r.archived,
            fork: r.fork,
            html_url: r.html_url.clone(),
            default_branch: r.default_branch.clone(),
        }
    }
}

impl From<CachedRepo> for GhRepo {
    fn from(r: CachedRepo) -> Self {
        GhRepo {
            full_name: r.full_name,
            private: r.private,
            visibility: r.visibility,
            can_push: r.can_push,
            archived: r.archived,
            fork: r.fork,
            html_url: r.html_url,
            default_branch: r.default_branch,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct CacheEntry {
    etag: Option<String>,
    /// Unix seconds when GitHub last confirmed the repository (200 or 304).
    fetched_at: u64,
    repo: CachedRepo,
}

/// `resources.core` of `GET /rate_limit`: (limit, remaining, reset).
fn parse_rate_limit(body: &str) -> Result<(u32, u32, u64), String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let core = &v["resources"]["core"];
    let num = |k: &str| core[k].as_u64().ok_or_else(|| format!("rate_limit: no {k}"));
    Ok((num("limit")? as u32, num("remaining")? as u32, num("reset")?))
}

/// A token as `gh auth token` prints it: one line of visible ASCII.
fn clean_token(out: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(out).ok()?.trim();
    (!text.is_empty() && text.bytes().all(|b| b.is_ascii_graphic())).then(|| text.to_owned())
}

/// The token of a logged-in `gh`, or None. Read fresh each time; never stored.
fn gh_token() -> Option<String> {
    let gh = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].into_iter().find(|p| Path::new(p).exists())?;
    let out = Command::new(gh)
        .args(["auth", "token", "--hostname", "github.com"])
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    clean_token(&out.stdout)
}

/// `repo__octocat__hello-world.json` for the slug `Octocat/Hello-World`, or
/// None when the slug is not `owner/name` of GitHub's name characters.
fn repo_cache_name(slug: &str) -> Option<String> {
    let (owner, name) = slug.split_once('/')?;
    let valid =
        |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.');
    (valid(owner) && valid(name)).then(|| format!("repo__{}__{}.json", owner.to_lowercase(), name.to_lowercase()))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct LimitState {
    remaining: Option<u32>,
    #[serde(default)]
    limit: Option<u32>,
    /// Unix seconds.
    reset: Option<u64>,
    /// Whether these numbers are for requests with a token. An exhausted
    /// limit only holds back requests made the same way.
    #[serde(default)]
    authed: bool,
}

pub(super) fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub(super) fn at(secs: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(secs)
}

/// Atomic write: temp file in the same directory, then rename.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

// ---- client -----------------------------------------------------------------

pub struct GitHub {
    cache_dir: PathBuf,
    transport: Box<dyn Transport>,
    limit: Mutex<LimitState>,
    /// From `gh auth token`; memory only.
    token: RwLock<Option<String>>,
    token_source: fn() -> Option<String>,
}

impl GitHub {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self::with_transport(cache_dir, Box::new(UreqTransport::new()))
    }

    pub(super) fn with_transport(cache_dir: PathBuf, transport: Box<dyn Transport>) -> Self {
        let limit = std::fs::read_to_string(cache_dir.join("rate_limit.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        GitHub { cache_dir, transport, limit: Mutex::new(limit), token: RwLock::new(None), token_source: gh_token }
    }

    pub(super) fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub(super) fn current_token(&self) -> Option<String> {
        self.token.read().unwrap().clone()
    }

    #[cfg(test)]
    pub(super) fn set_token_source(&mut self, source: fn() -> Option<String>) {
        self.token_source = source;
    }

    #[cfg(test)]
    pub(super) fn set_token(&self, token: Option<String>) {
        *self.token.write().unwrap() = token;
    }

    pub(super) fn rate_limited_reset(&self, authed: bool) -> Option<u64> {
        let known = *self.limit.lock().unwrap();
        if let (Some(0), Some(reset)) = (known.remaining, known.reset)
            && reset > now_secs()
            && known.authed == authed
        {
            Some(reset)
        } else {
            None
        }
    }

    pub(super) fn current_reset(&self) -> Option<u64> {
        self.limit.lock().unwrap().reset
    }

    pub(super) fn get_raw(&self, url: &str, etag: Option<&str>, token: Option<&str>) -> Result<RawResponse, String> {
        let resp = self.transport.get(url, etag, token)?;
        self.record_limit(&resp, token.is_some());
        Ok(resp)
    }

    /// Ask `gh` for its token again, so a login or logout counts from the next check.
    pub fn refresh_token(&self) {
        let token = (self.token_source)();
        *self.token.write().unwrap() = token;
    }

    pub fn has_token(&self) -> bool {
        self.token.read().unwrap().is_some()
    }

    /// Read the current limit for the way requests are made now. Free: it
    /// doesn't count against the limit.
    pub fn refresh_limit(&self) {
        let token = self.token.read().unwrap().clone();
        let Ok(resp) = self.transport.get(&format!("{API}/rate_limit"), None, token.as_deref()) else {
            return;
        };
        if resp.status != 200 {
            return;
        }
        if let Ok((limit, remaining, reset)) = parse_rate_limit(&resp.body) {
            let state = LimitState {
                remaining: Some(remaining),
                limit: Some(limit),
                reset: Some(reset),
                authed: token.is_some(),
            };
            self.set_limit(state);
        }
    }

    fn set_limit(&self, state: LimitState) {
        let mut current = self.limit.lock().unwrap();
        if *current != state {
            *current = state;
            self.write_json(&self.cache_dir.join("rate_limit.json"), &state);
        }
    }

    pub fn rate(&self) -> RateLimit {
        let state = *self.limit.lock().unwrap();
        RateLimit { remaining: state.remaining, limit: state.limit, reset: state.reset.map(at) }
    }

    /// `GET /repos/{owner}/{name}`. A slug that is not `owner/name` is `NotFound`.
    pub fn repo(&self, slug: &str, max_age: Duration) -> Result<Fetched<GhRepo>, Error> {
        let file = repo_cache_name(slug).ok_or(Error::NotFound)?;
        let url = format!("{API}/repos/{slug}");
        let path = self.cache_dir.join(file);
        // An unreadable or corrupt cache file counts as missing.
        let cached = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<CacheEntry>(&s).ok());
        let stale = |cached: Option<CacheEntry>, reason: &str, err: Error| match cached {
            Some(entry) => Ok(Fetched {
                value: entry.repo.into(),
                origin: Origin::Stale(reason.to_string()),
                fetched_at: at(entry.fetched_at),
            }),
            None => Err(err),
        };

        // 1. Fresh enough.
        if let Some(entry) = &cached
            && now_secs().saturating_sub(entry.fetched_at) < max_age.as_secs()
        {
            let entry = cached.unwrap();
            return Ok(Fetched { value: entry.repo.into(), origin: Origin::Cache, fetched_at: at(entry.fetched_at) });
        }

        // 2. Known rate limit exhausted, for requests made the same way.
        let token = self.token.read().unwrap().clone();
        let known = *self.limit.lock().unwrap();
        if let (Some(0), Some(reset)) = (known.remaining, known.reset)
            && reset > now_secs()
            && known.authed == token.is_some()
        {
            return stale(cached, "rate limited", Error::RateLimited { reset: at(reset) });
        }

        // 3. Conditional request.
        let etag = cached.as_ref().and_then(|e| e.etag.as_deref());
        let resp = match self.transport.get(&url, etag, token.as_deref()) {
            Ok(resp) => resp,
            Err(msg) => return stale(cached, "offline", Error::Network(msg)),
        };
        self.record_limit(&resp, token.is_some());

        match resp.status {
            200 => match parse_repo(&resp.body) {
                Ok(value) => {
                    let entry = CacheEntry { etag: resp.etag, fetched_at: now_secs(), repo: CachedRepo::from(&value) };
                    self.write_json(&path, &entry);
                    Ok(Fetched { value, origin: Origin::Network, fetched_at: at(entry.fetched_at) })
                }
                Err(msg) => stale(cached, "bad response", Error::Parse(msg)),
            },
            304 => match cached {
                Some(mut entry) => {
                    entry.fetched_at = now_secs();
                    self.write_json(&path, &entry);
                    Ok(Fetched {
                        value: entry.repo.into(),
                        origin: Origin::NotModified,
                        fetched_at: at(entry.fetched_at),
                    })
                }
                // We only send If-None-Match when we have a cache, so this is a server oddity.
                None => Err(Error::Status(304)),
            },
            403 | 429 if resp.remaining == Some(0) || resp.retry_after.is_some() => {
                let reset = self.limit.lock().unwrap().reset.unwrap_or_else(|| now_secs() + 60);
                stale(cached, "rate limited", Error::RateLimited { reset: at(reset) })
            }
            404 => Err(Error::NotFound),
            code => stale(cached, &format!("HTTP {code}"), Error::Status(code)),
        }
    }

    /// Update the in-memory rate-limit state from a response and persist it.
    fn record_limit(&self, resp: &RawResponse, authed: bool) {
        let mut state = *self.limit.lock().unwrap();
        if state.authed != authed {
            state = LimitState { authed, ..Default::default() };
        }
        if resp.remaining.is_some() {
            state.remaining = resp.remaining;
        }
        if resp.limit.is_some() {
            state.limit = resp.limit;
        }
        if resp.reset.is_some() {
            state.reset = resp.reset;
        }
        if let (Some(secs), 403 | 429) = (resp.retry_after, resp.status) {
            state.remaining = Some(0);
            state.reset = Some(now_secs() + secs);
        }
        self.set_limit(state);
    }

    /// Best effort: a cache that cannot be written must not fail a fetch.
    pub(super) fn write_json<V: Serialize>(&self, path: &Path, value: &V) {
        if let Ok(bytes) = serde_json::to_vec_pretty(value) {
            let _ = write_atomic(path, &bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Arc;

    const PUBLIC_PUSH: &str = include_str!("../../tests/fixtures/github/repo_public_push.json");
    const PRIVATE: &str = include_str!("../../tests/fixtures/github/repo_private.json");
    const PUBLIC_ANON: &str = include_str!("../../tests/fixtures/github/repo_public_anon.json");
    const RATE_LIMITED: &str = include_str!("../../tests/fixtures/github/rate_limited_403.json");

    const ETAG: &str = "W/\"c2be683c78394d2c6eef13326a49a87b44e985d5d360ac212faf92c58bf4c088\"";
    const HOUR: Duration = Duration::from_secs(3600);
    const SLUG: &str = "Octocat/Hello-World";

    type Seen = Vec<(String, Option<String>)>;

    /// Scripted transport: pops one response per request and records (url, etag)
    /// and the token each request carried.
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
            self.seen.lock().unwrap().push((url.to_string(), etag.map(str::to_owned)));
            self.tokens.lock().unwrap().push(token.map(str::to_owned));
            self.script.lock().unwrap().pop_front().expect("unscripted request")
        }
    }

    fn resp(status: u16, body: &str) -> RawResponse {
        RawResponse {
            status,
            etag: None,
            remaining: Some(57),
            limit: Some(60),
            reset: Some(now_secs() + 3000),
            retry_after: None,
            body: body.to_string(),
        }
    }

    fn ok(body: &str) -> RawResponse {
        RawResponse { etag: Some(ETAG.to_string()), ..resp(200, body) }
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
        fn new() -> Env {
            let tmp = tempfile::tempdir().unwrap();
            let dir = tmp.path().join("cache");
            Env { _tmp: tmp, dir, fake: Fake::default() }
        }
        fn client(&self) -> GitHub {
            let mut gh = GitHub::with_transport(self.dir.clone(), Box::new(self.fake.clone()));
            gh.token_source = || None;
            gh
        }
        fn cache_file(&self) -> PathBuf {
            self.dir.join("repo__octocat__hello-world.json")
        }
        /// Rewrite the cache entry's age.
        fn age_cache(&self, secs: u64) {
            let path = self.cache_file();
            let mut e: CacheEntry = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            e.fetched_at = now_secs() - secs;
            std::fs::write(&path, serde_json::to_vec(&e).unwrap()).unwrap();
        }
    }

    #[test]
    fn public_repo_with_permissions() {
        let env = Env::new();
        env.fake.push(Ok(ok(PUBLIC_PUSH)));
        let got = env.client().repo(SLUG, HOUR).unwrap();
        assert_eq!(got.origin, Origin::Network);
        assert_eq!(
            got.value,
            GhRepo {
                full_name: "Octocat/Hello-World".into(),
                private: false,
                visibility: "public".into(),
                can_push: Some(true),
                archived: false,
                fork: false,
                html_url: "https://github.com/Octocat/Hello-World".into(),
                default_branch: "main".into(),
            }
        );
        assert_eq!(env.fake.requests(), vec![("https://api.github.com/repos/Octocat/Hello-World".to_string(), None)]);
        assert!(env.cache_file().exists());
    }

    #[test]
    fn private_repo() {
        let r = parse_repo(PRIVATE).unwrap();
        assert!(r.private && r.archived);
        assert_eq!(r.visibility, "private");
        assert_eq!(r.can_push, Some(true));
        assert_eq!(r.default_branch, "trunk");
    }

    #[test]
    fn public_repo_without_token_has_no_permissions() {
        let env = Env::new();
        env.fake.push(Ok(ok(PUBLIC_ANON)));
        let got = env.client().repo("someone/widgets", HOUR).unwrap();
        assert_eq!(got.value.can_push, None);
        assert!(got.value.fork && !got.value.private);
        assert_eq!(env.fake.tokens(), vec![None]);
        // The missing permissions survive the cache.
        let again = env.client().repo("Someone/Widgets", HOUR).unwrap();
        assert_eq!(again.origin, Origin::Cache);
        assert_eq!(again.value.can_push, None);
    }

    #[test]
    fn visibility_falls_back_to_private_flag() {
        let body = r#"{"full_name":"a/b","private":true,"html_url":"https://github.com/a/b"}"#;
        let r = parse_repo(body).unwrap();
        assert_eq!(r.visibility, "private");
        assert!(parse_repo("[]").is_err());
    }

    #[test]
    fn not_found_even_with_cache() {
        let env = Env::new();
        env.fake.push(Ok(resp(404, "{}")));
        assert_eq!(env.client().repo(SLUG, HOUR).unwrap_err(), Error::NotFound);

        let env = Env::new();
        env.fake.push(Ok(ok(PUBLIC_PUSH))).push(Ok(resp(404, "{}")));
        let gh = env.client();
        gh.repo(SLUG, HOUR).unwrap();
        env.age_cache(7200);
        assert_eq!(gh.repo(SLUG, HOUR).unwrap_err(), Error::NotFound);
    }

    #[test]
    fn malformed_slugs_make_no_request() {
        let env = Env::new();
        let gh = env.client();
        for slug in ["", "owner", "owner/", "/name", "a/b/c", "a b/c", "a/b?x=1", "../etc/passwd"] {
            assert_eq!(gh.repo(slug, HOUR).unwrap_err(), Error::NotFound, "{slug}");
        }
        assert!(env.fake.requests().is_empty());
    }

    #[test]
    fn rate_limited_403_is_stale_with_cache_and_error_without() {
        let env = Env::new();
        env.fake.push(Ok(rate_limited()));
        let err = env.client().repo(SLUG, HOUR).unwrap_err();
        assert!(matches!(err, Error::RateLimited { .. }));

        let env = Env::new();
        env.fake.push(Ok(ok(PUBLIC_PUSH))).push(Ok(rate_limited()));
        let gh = env.client();
        let first = gh.repo(SLUG, HOUR).unwrap();
        env.age_cache(7200);
        let got = gh.repo(SLUG, HOUR).unwrap();
        assert_eq!(got.origin, Origin::Stale("rate limited".into()));
        assert_eq!(got.value, first.value);
        assert_eq!(gh.rate().remaining, Some(0));
        // The known limit now holds requests back without asking.
        let again = gh.repo(SLUG, HOUR).unwrap();
        assert_eq!(again.origin, Origin::Stale("rate limited".into()));
        assert_eq!(env.fake.requests().len(), 2);
    }

    #[test]
    fn retry_after_counts_as_rate_limit() {
        let env = Env::new();
        env.fake.push(Ok(RawResponse { remaining: None, reset: None, retry_after: Some(120), ..resp(429, "") }));
        let Error::RateLimited { reset } = env.client().repo(SLUG, HOUR).unwrap_err() else { panic!() };
        assert!(reset > SystemTime::now() + Duration::from_secs(100));
    }

    #[test]
    fn persisted_rate_limit_blocks_a_new_client() {
        let env = Env::new();
        env.fake.push(Ok(rate_limited()));
        let _ = env.client().repo(SLUG, HOUR);
        let again = env.client();
        assert_eq!(again.rate().remaining, Some(0));
        assert!(matches!(again.repo("a/b", HOUR).unwrap_err(), Error::RateLimited { .. }));
        assert_eq!(env.fake.requests().len(), 1);
    }

    #[test]
    fn etag_is_sent_and_304_reuses_the_cache() {
        let env = Env::new();
        env.fake.push(Ok(ok(PUBLIC_PUSH))).push(Ok(resp(304, "")));
        let gh = env.client();
        let first = gh.repo(SLUG, HOUR).unwrap();
        env.age_cache(7200);
        let second = gh.repo(SLUG, HOUR).unwrap();
        assert_eq!(second.origin, Origin::NotModified);
        assert_eq!(second.value, first.value);
        assert_eq!(env.fake.requests()[1].1.as_deref(), Some(ETAG));
        // fetched_at was bumped on disk, so the next call is a cache hit.
        assert_eq!(gh.repo(SLUG, HOUR).unwrap().origin, Origin::Cache);
        assert_eq!(env.fake.requests().len(), 2);
    }

    #[test]
    fn max_age_serves_from_cache_without_a_request() {
        let env = Env::new();
        env.fake.push(Ok(ok(PUBLIC_PUSH))).push(Ok(ok(PUBLIC_PUSH)));
        let gh = env.client();
        gh.repo(SLUG, HOUR).unwrap();
        let hit = gh.repo("octocat/hello-world", HOUR).unwrap();
        assert_eq!(hit.origin, Origin::Cache);
        assert_eq!(env.fake.requests().len(), 1);
        // A zero max_age always asks.
        assert_eq!(gh.repo(SLUG, Duration::ZERO).unwrap().origin, Origin::Network);
        assert_eq!(env.fake.requests().len(), 2);
    }

    #[test]
    fn network_error_falls_back_to_stale_cache() {
        let env = Env::new();
        env.fake.push(Ok(ok(PUBLIC_PUSH))).push(Err("dns failure".into())).push(Err("dns failure".into()));
        let gh = env.client();
        let first = gh.repo(SLUG, HOUR).unwrap();
        env.age_cache(7200);
        let got = gh.repo(SLUG, HOUR).unwrap();
        assert_eq!(got.origin, Origin::Stale("offline".into()));
        assert_eq!(got.value, first.value);
        assert_eq!(gh.repo("a/other", HOUR).unwrap_err(), Error::Network("dns failure".into()));
    }

    #[test]
    fn other_status_and_bad_body() {
        let env = Env::new();
        env.fake.push(Ok(resp(500, ""))).push(Ok(ok(PUBLIC_PUSH))).push(Ok(resp(502, ""))).push(Ok(ok("not json")));
        let gh = env.client();
        assert_eq!(gh.repo(SLUG, HOUR).unwrap_err(), Error::Status(500));
        gh.repo(SLUG, HOUR).unwrap();
        env.age_cache(7200);
        assert_eq!(gh.repo(SLUG, HOUR).unwrap().origin, Origin::Stale("HTTP 502".into()));
        env.age_cache(7200);
        assert_eq!(gh.repo(SLUG, HOUR).unwrap().origin, Origin::Stale("bad response".into()));
    }

    #[test]
    fn corrupt_cache_counts_as_missing() {
        let env = Env::new();
        std::fs::create_dir_all(&env.dir).unwrap();
        std::fs::write(env.cache_file(), "{ this is not json").unwrap();
        env.fake.push(Ok(ok(PUBLIC_PUSH)));
        let got = env.client().repo(SLUG, HOUR).unwrap();
        assert_eq!(got.origin, Origin::Network);
        assert_eq!(env.fake.requests()[0].1, None);
        assert!(serde_json::from_str::<CacheEntry>(&std::fs::read_to_string(env.cache_file()).unwrap()).is_ok());
    }

    const RATE_LIMIT_BODY: &str =
        r#"{"resources":{"core":{"limit":5000,"used":3,"remaining":4997,"reset":1794420000}},"rate":{"limit":5000}}"#;

    #[test]
    fn token_goes_on_requests_and_never_to_disk() {
        let env = Env::new();
        env.fake.push(Ok(resp(200, RATE_LIMIT_BODY))).push(Ok(ok(PUBLIC_PUSH))).push(Ok(rate_limited()));
        let mut gh = env.client();
        gh.token_source = || Some("gho_testtoken123".into());
        gh.refresh_token();
        gh.refresh_limit();
        assert!(gh.has_token());
        assert_eq!(gh.rate().limit, Some(5000));
        assert_eq!(gh.rate().remaining, Some(4997));
        gh.repo(SLUG, HOUR).unwrap();
        env.age_cache(7200);
        let _ = gh.repo(SLUG, HOUR);
        assert_eq!(env.fake.requests()[0].0, "https://api.github.com/rate_limit");
        assert!(env.fake.tokens().iter().all(|t| t.as_deref() == Some("gho_testtoken123")));
        let mut files = 0;
        for entry in std::fs::read_dir(&env.dir).unwrap() {
            let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            assert!(!text.contains("gho_testtoken123"));
            files += 1;
        }
        assert_eq!(files, 2);
    }

    #[test]
    fn exhausted_anonymous_limit_does_not_block_a_token() {
        let env = Env::new();
        env.fake.push(Ok(rate_limited()));
        assert!(env.client().repo(SLUG, HOUR).is_err());
        let gh = env.client();
        *gh.token.write().unwrap() = Some("gho_x".into());
        env.fake.push(Ok(RawResponse { limit: Some(5000), remaining: Some(4999), ..ok(PUBLIC_PUSH) }));
        assert_eq!(gh.repo(SLUG, HOUR).unwrap().origin, Origin::Network);
        assert_eq!(gh.rate().limit, Some(5000));
    }

    #[test]
    fn tokens_are_one_visible_line() {
        assert_eq!(clean_token(b"gho_abc123\n").as_deref(), Some("gho_abc123"));
        assert_eq!(clean_token(b""), None);
        assert_eq!(clean_token(b"two words\n"), None);
        assert_eq!(clean_token(b"a\r\nInjected: x"), None);
    }

    #[test]
    fn cache_names_use_the_lowercased_slug() {
        assert_eq!(repo_cache_name("Octocat/Hello-World").as_deref(), Some("repo__octocat__hello-world.json"));
        assert_eq!(repo_cache_name("a/b.c_d").as_deref(), Some("repo__a__b.c_d.json"));
    }

    #[test]
    fn is_send_and_sync() {
        fn check<T: Send + Sync>() {}
        check::<GitHub>();
    }
}
