//! The shared data model: providers, their limits, Ollama's loaded models,
//! status aggregation, and reset/figure formatting helpers.
//! Times are seconds since the Unix epoch, as `f64`.

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use super::limits;

/// Whose plan a limit belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Provider {
    Claude,
    Codex,
    Kimi,
    Glm,
    /// Google's plan, read through Antigravity's `agy`.
    Gemini,
    Grok,
    Meta,
    Qwen,
    Mistral,
    MiniMax,
    DeepSeek,
    Xiaomi,
    Tencent,
    Ollama,
}

impl Provider {
    pub const ALL: [Provider; 14] = [
        Provider::Claude,
        Provider::Codex,
        Provider::Kimi,
        Provider::Glm,
        Provider::Gemini,
        Provider::Grok,
        Provider::Meta,
        Provider::Qwen,
        Provider::Mistral,
        Provider::MiniMax,
        Provider::DeepSeek,
        Provider::Xiaomi,
        Provider::Tencent,
        Provider::Ollama,
    ];

    /// The name shown in the window.
    pub fn name(self) -> &'static str {
        match self {
            Provider::Claude => "Claude",
            Provider::Codex => "Codex",
            Provider::Kimi => "Kimi",
            Provider::Glm => "GLM / ZCode",
            Provider::Gemini => "Gemini",
            Provider::Grok => "Grok",
            Provider::Meta => "Meta / Muse",
            Provider::Qwen => "Qwen",
            Provider::Mistral => "Mistral",
            Provider::MiniMax => "MiniMax",
            Provider::DeepSeek => "DeepSeek",
            Provider::Xiaomi => "Xiaomi / MiMo",
            Provider::Tencent => "Tencent / CodeBuddy",
            Provider::Ollama => "Ollama",
        }
    }
}

/// One usage window of an account, such as 5-hour or weekly.
#[derive(Clone, Debug, PartialEq)]
pub struct Window {
    /// "5-hour", "Weekly", "Monthly", or with a scope after a middle dot, such
    /// as "Weekly · Fable" for a window that counts one model only.
    pub name: String,
    pub used_pct: f64,
    pub resets_at: Option<f64>,
}

impl Window {
    pub fn new(name: impl Into<String>, used_pct: f64, resets_at: Option<f64>) -> Window {
        Window { name: name.into(), used_pct, resets_at }
    }

    /// The part after " · ", for a window that counts only some models.
    pub fn scope(&self) -> Option<&str> {
        self.name.split_once(" · ").map(|(_, s)| s)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// The first check has not finished.
    Checking,
    Ok,
    /// Something is missing that the user can add, such as an API key or
    /// a sign-in. `detail` says what.
    Setup,
    /// The tool that reports this provider's limits is not on this Mac.
    NotInstalled,
    /// The check ran and failed; `detail` says why.
    Unavailable,
}

/// The live limits of one account.
#[derive(Clone, Debug, PartialEq)]
pub struct Limit {
    pub provider: Provider,
    /// The plan, such as "Claude Max" or "ChatGPT Pro"; empty when unknown.
    pub account: String,
    pub status: Status,
    /// A short plain sentence: where the figures came from, or what is wrong.
    pub detail: String,
    pub checked_at: f64,
    pub windows: Vec<Window>,
    /// Available account credit, with no invented quota denominator.
    pub balances: Vec<Balance>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Balance {
    pub currency: String,
    pub available: f64,
}

impl Limit {
    pub fn new(provider: Provider, status: Status, detail: impl Into<String>) -> Limit {
        Limit {
            provider,
            account: String::new(),
            status,
            detail: detail.into(),
            checked_at: now(),
            windows: Vec::new(),
            balances: Vec::new(),
        }
    }

    pub fn ok(
        provider: Provider,
        account: impl Into<String>,
        detail: impl Into<String>,
        windows: Vec<Window>,
    ) -> Limit {
        Limit { account: account.into(), windows, ..Limit::new(provider, Status::Ok, detail) }
    }
}

/// A model Ollama has in memory.
#[derive(Clone, Debug, PartialEq)]
pub struct Loaded {
    pub name: String,
    /// Bytes in memory, as Ollama reports them.
    pub size: u64,
    /// The part of `size` on the GPU.
    pub size_vram: u64,
    /// The model file's size, from the installed list.
    pub weights: Option<u64>,
    /// The context length it was loaded with, in tokens.
    pub context: Option<u64>,
    /// Bytes of context cache per token at 16 bits, worked out from the
    /// model's attention layers.
    pub kv_per_token: Option<u64>,
    pub expires_at: Option<f64>,
}

impl Loaded {
    /// The context cache its context length takes: an estimate at 16 bits.
    /// Ollama's `size` is no measure of it; at 32,768 tokens it reported less
    /// than the model file.
    pub fn cache(&self) -> Option<u64> {
        Some(self.kv_per_token? * self.context?)
    }
}

/// An installed model, including models that are not currently in memory.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub family: String,
    pub parameters: String,
    pub quantization: String,
}

/// Observations made while the engine is running; residency is not inference time.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ModelActivity {
    pub loaded_seconds: f64,
    pub last_seen: f64,
    pub peak_bytes: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MemorySample {
    pub at: f64,
    /// None means the poll failed; do not draw a zero or bridge the gap.
    pub bytes: Option<u64>,
}

/// What Ollama has installed and loaded, and this Mac's memory headroom.
#[derive(Clone, Debug, PartialEq)]
pub struct OllamaState {
    pub status: Status,
    pub detail: String,
    pub checked_at: f64,
    pub loaded: Vec<Loaded>,
    pub installed: usize,
    pub models: Vec<OllamaModel>,
    pub activity: BTreeMap<String, ModelActivity>,
    pub memory_history: Vec<MemorySample>,
    pub peak_bytes: u64,
    /// `memory_pressure`'s system-wide free percentage.
    pub free_pct: Option<u8>,
    /// Physical memory in bytes.
    pub total_memory: Option<u64>,
}

impl OllamaState {
    pub fn checking() -> OllamaState {
        OllamaState {
            status: Status::Checking,
            detail: String::new(),
            checked_at: now(),
            loaded: Vec::new(),
            installed: 0,
            models: Vec::new(),
            activity: BTreeMap::new(),
            memory_history: Vec::new(),
            peak_bytes: 0,
            free_pct: None,
            total_memory: None,
        }
    }
}

pub fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

// ---------------------------------------------------------------------------
// Status aggregation & formatting helpers

/// Severity tier for usage bars and memory headroom.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum UsageLevel {
    Normal,
    Warning,
    Critical,
}

/// Classify a window's percentage used: warning at 70%, critical at 90%.
pub fn usage_level(used: f64) -> UsageLevel {
    if used >= 90.0 {
        UsageLevel::Critical
    } else if used >= 70.0 {
        UsageLevel::Warning
    } else {
        UsageLevel::Normal
    }
}

/// Classify system free memory percentage: warning below 30%, critical below 15%.
pub fn memory_level(free_pct: u8) -> UsageLevel {
    if free_pct < 15 {
        UsageLevel::Critical
    } else if free_pct < 30 {
        UsageLevel::Warning
    } else {
        UsageLevel::Normal
    }
}

/// Aggregated status counts across all tracked provider accounts.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct StatusSummary {
    pub total: usize,
    pub ok: usize,
    pub checking: usize,
    pub setup: usize,
    pub not_installed: usize,
    pub unavailable: usize,
    pub newest_check: Option<f64>,
    pub highest_used_pct: Option<f64>,
}

/// Summarize provider limit statuses and peak active model-window usage at `now`.
pub fn summarize_limits(limits: &BTreeMap<Provider, Limit>, now: f64) -> StatusSummary {
    let mut summary = StatusSummary { total: limits.len(), ..StatusSummary::default() };
    for limit in limits.values() {
        match limit.status {
            Status::Checking => summary.checking += 1,
            Status::Ok => summary.ok += 1,
            Status::Setup => summary.setup += 1,
            Status::NotInstalled => summary.not_installed += 1,
            Status::Unavailable => summary.unavailable += 1,
        }
        if limit.status != Status::Checking && limit.checked_at > 0.0 {
            summary.newest_check = Some(summary.newest_check.map_or(limit.checked_at, |t| t.max(limit.checked_at)));
        }
        for window in &limit.windows {
            if limits::is_tool_window(window) {
                continue;
            }
            let used = limits::used_now(window, now);
            summary.highest_used_pct = Some(summary.highest_used_pct.map_or(used, |m| m.max(used)));
        }
    }
    summary
}

/// All Ollama models ordered loaded-first then by name, including any loaded
/// model missing from `/api/tags`.
pub fn sorted_ollama_models(state: &OllamaState) -> Vec<OllamaModel> {
    let mut models = state.models.clone();
    for m in &state.loaded {
        if !models.iter().any(|i| i.name == m.name) {
            models.push(OllamaModel { name: m.name.clone(), size: m.weights.unwrap_or(0), ..Default::default() });
        }
    }
    models.sort_by_key(|m| (!state.loaded.iter().any(|l| l.name == m.name), m.name.clone()));
    models
}

/// Total memory occupied by currently loaded Ollama models, in bytes.
pub fn loaded_memory_bytes(state: &OllamaState) -> u64 {
    state.loaded.iter().map(|m| m.size).fold(0u64, u64::saturating_add)
}

/// "now", "in 12 min", "in 3 h 20 min", "in 4 d 18 h".
pub fn until(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    let (d, h, m) = (s / 86400, s % 86400 / 3600, s % 3600 / 60);
    match (d, h, m) {
        (0, 0, 0) => "now".to_owned(),
        (0, 0, m) => format!("in {m} min"),
        (0, h, 0) => format!("in {h} h"),
        (0, h, m) => format!("in {h} h {m} min"),
        (d, 0, _) => format!("in {d} d"),
        (d, h, _) => format!("in {d} d {h} h"),
    }
}

/// A local date and time, "Nov 21 12:00 AM", or "Today 4:30 PM".
pub fn local_time(t: f64, now: f64) -> String {
    let tz = jiff::tz::TimeZone::system();
    let (Ok(at), Ok(today)) = (jiff::Timestamp::from_second(t as i64), jiff::Timestamp::from_second(now as i64)) else {
        return String::new();
    };
    let (at, today) = (at.to_zoned(tz.clone()), today.to_zoned(tz));
    let hour = match at.hour() % 12 {
        0 => 12,
        h => h,
    };
    let clock = format!("{hour}:{:02} {}", at.minute(), if at.hour() < 12 { "AM" } else { "PM" });
    if at.date() == today.date() { format!("Today {clock}") } else { format!("{} {clock}", at.strftime("%b %-d")) }
}

/// "83%", or "1.2%" below ten.
pub fn percent(used: f64) -> String {
    if used < 10.0 && used.fract() != 0.0 { format!("{used:.1}%") } else { format!("{used:.0}%") }
}

/// Bytes as gigabytes, "17.7 GB".
pub fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1e9)
}

/// A whole number with thousands separators, "262,144".
pub fn grouped(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

/// Observed load duration: "45 s", "12 min", "2 h 15 min".
pub fn elapsed(seconds: f64) -> String {
    let seconds = seconds.max(0.0) as u64;
    if seconds < 60 {
        format!("{seconds} s")
    } else if seconds < 3600 {
        format!("{} min", seconds / 60)
    } else {
        format!("{} h {} min", seconds / 3600, seconds % 3600 / 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_scope() {
        assert_eq!(Window::new("Weekly · Fable", 1.0, None).scope(), Some("Fable"));
        assert_eq!(Window::new("5-hour", 1.0, None).scope(), None);
    }

    #[test]
    fn cache_is_context_times_bytes_per_token() {
        let m = Loaded {
            name: "m".into(),
            size: 34_000_000_000,
            size_vram: 34_000_000_000,
            weights: Some(17_700_000_000),
            context: Some(262_144),
            kv_per_token: Some(65_536),
            expires_at: None,
        };
        assert_eq!(m.cache(), Some(17_179_869_184));
    }

    #[test]
    fn figures_countdowns_and_levels() {
        assert_eq!(gb(17_741_872_154), "17.7 GB");
        assert_eq!(grouped(262_144), "262,144");
        assert_eq!(grouped(999), "999");
        assert_eq!(percent(83.0), "83%");
        assert_eq!(percent(1.25), "1.2%");
        assert_eq!(percent(0.0), "0%");
        assert_eq!(elapsed(45.0), "45 s");
        assert_eq!(elapsed(720.0), "12 min");
        assert_eq!(elapsed(8100.0), "2 h 15 min");
        assert_eq!(until(30.0), "now");
        assert_eq!(until(12.0 * 60.0), "in 12 min");
        assert_eq!(until(3.0 * 3600.0 + 20.0 * 60.0), "in 3 h 20 min");
        assert_eq!(until(4.0 * 86400.0 + 18.0 * 3600.0 + 5.0), "in 4 d 18 h");
        assert_eq!(usage_level(10.0), UsageLevel::Normal);
        assert_eq!(usage_level(75.0), UsageLevel::Warning);
        assert_eq!(usage_level(95.0), UsageLevel::Critical);
        assert_eq!(memory_level(50), UsageLevel::Normal);
        assert_eq!(memory_level(20), UsageLevel::Warning);
        assert_eq!(memory_level(10), UsageLevel::Critical);
    }

    #[test]
    fn summarizes_limits_and_skips_tool_windows() {
        let mut map = BTreeMap::new();
        let mut a = Limit::ok(
            Provider::Glm,
            "Coding Plan",
            "ok",
            vec![Window::new("5-hour", 40.0, Some(2000.0)), Window::new("Monthly tools (95/100)", 95.0, Some(2000.0))],
        );
        a.checked_at = 1000.0;
        let mut b = Limit::new(Provider::Grok, Status::Setup, "Sign in");
        b.checked_at = 1200.0;
        map.insert(Provider::Glm, a);
        map.insert(Provider::Grok, b);
        let summary = summarize_limits(&map, 1500.0);
        assert_eq!(summary.total, 2);
        assert_eq!(summary.ok, 1);
        assert_eq!(summary.setup, 1);
        assert_eq!(summary.newest_check, Some(1200.0));
        assert_eq!(summary.highest_used_pct, Some(40.0));
    }
}
