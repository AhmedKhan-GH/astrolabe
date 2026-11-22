//! Ollama's loaded models from its local API on 127.0.0.1, and the machine's
//! free memory from `memory_pressure`. Residency is observed every five
//! seconds; inference requests and tokens require separate metering.
//!
//! The context cache is estimated from each model's attention layers, read
//! once per model from `/api/show`: layers with full attention, times KV
//! heads, times key and value widths, times 2 bytes, per token. For
//! `qwen3.8:27b` that is 64 KiB a token, so 17.2 GB at 262,144 tokens, which
//! matches the 34 GB one server reached with 17.7 GB of weights.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use crate::agents::model::{Loaded, MemorySample, ModelActivity, OllamaModel, OllamaState, Status, now};

pub const EVERY: Duration = Duration::from_secs(5);
pub const URL: &str = "http://127.0.0.1:11434";

/// A context this long, or a cache this large, is worth a warning.
pub const LONG_CONTEXT: u64 = 65_536;
pub const VERY_LONG_CONTEXT: u64 = 131_072;
pub const LARGE_CACHE: u64 = 8_000_000_000;
pub const VERY_LARGE_CACHE: u64 = 16_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Warning {
    Large,
    VeryLarge,
}

/// Whether a loaded model's context cache is large enough to warn about.
pub fn warning(m: &Loaded) -> Option<Warning> {
    let cache = m.cache().unwrap_or(0);
    let ctx = m.context.unwrap_or(0);
    if cache >= VERY_LARGE_CACHE || ctx >= VERY_LONG_CONTEXT {
        Some(Warning::VeryLarge)
    } else if cache >= LARGE_CACHE || ctx >= LONG_CONTEXT {
        Some(Warning::Large)
    } else {
        None
    }
}

#[derive(Deserialize)]
struct Ps {
    #[serde(default)]
    models: Vec<PsModel>,
}

#[derive(Deserialize)]
struct PsModel {
    name: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    size_vram: u64,
    context_length: Option<u64>,
    expires_at: Option<String>,
}

#[derive(Deserialize)]
struct Tags {
    #[serde(default)]
    models: Vec<Tag>,
}

#[derive(Deserialize)]
struct Tag {
    name: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    details: Details,
}

#[derive(Default, Deserialize)]
struct Details {
    #[serde(default)]
    family: String,
    #[serde(default)]
    parameter_size: String,
    #[serde(default)]
    quantization_level: String,
}

/// Bytes of context cache per token, by model name; `/api/show` is asked once
/// per model.
pub type Shapes = HashMap<String, Option<u64>>;

pub fn check(installed: bool, shapes: &mut Shapes) -> OllamaState {
    let mut state = OllamaState::checking();
    state.free_pct = free_pct();
    state.total_memory = total_memory();
    let agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(3))).build().new_agent();
    let get = |path: &str| -> Result<String, String> {
        agent
            .get(format!("{URL}{path}"))
            .call()
            .map_err(|e| e.to_string())?
            .body_mut()
            .read_to_string()
            .map_err(|e| e.to_string())
    };
    let (ps, tags) = match (get("/api/ps"), get("/api/tags")) {
        (Ok(ps), Ok(tags)) => (ps, tags),
        (Err(e), _) | (_, Err(e)) => {
            state.status = if installed { Status::Unavailable } else { Status::NotInstalled };
            state.detail =
                if installed { format!("Ollama is not serving: {e}") } else { "Ollama is not installed".into() };
            return state;
        }
    };
    match parse(&ps, &tags) {
        Some((mut loaded, models)) => {
            for m in &mut loaded {
                m.kv_per_token = *shapes.entry(m.name.clone()).or_insert_with(|| {
                    let body = format!("{{\"model\":{}}}", serde_json::to_string(&m.name).ok()?);
                    let text = agent
                        .post(format!("{URL}/api/show"))
                        .header("Content-Type", "application/json")
                        .send(body)
                        .ok()?
                        .body_mut()
                        .read_to_string()
                        .ok()?;
                    kv_per_token(&serde_json::from_str(&text).ok()?)
                });
            }
            state.status = Status::Ok;
            state.detail = if loaded.is_empty() { "Idle".into() } else { format!("{} loaded", loaded.len()) };
            state.loaded = loaded;
            state.installed = models.len();
            state.models = models;
        }
        None => {
            state.status = Status::Unavailable;
            state.detail = "Ollama's answer was not understood".into();
        }
    }
    state.checked_at = now();
    state
}

pub fn parse(ps: &str, tags: &str) -> Option<(Vec<Loaded>, Vec<OllamaModel>)> {
    let ps: Ps = serde_json::from_str(ps).ok()?;
    let tags: Tags = serde_json::from_str(tags).ok()?;
    let loaded = ps
        .models
        .into_iter()
        .map(|m| {
            let weights = tags
                .models
                .iter()
                .find(|t| t.name == m.name || (!m.model.is_empty() && t.model == m.model))
                .map(|t| t.size)
                .filter(|s| *s > 0);
            Loaded {
                expires_at: m
                    .expires_at
                    .as_deref()
                    .and_then(|s| s.parse::<jiff::Timestamp>().ok())
                    .map(|t| t.as_second() as f64),
                name: m.name,
                size: m.size,
                size_vram: m.size_vram,
                weights,
                context: m.context_length.filter(|c| *c > 0),
                kv_per_token: None,
            }
        })
        .collect();
    let mut models: Vec<_> = tags
        .models
        .into_iter()
        .map(|m| OllamaModel {
            name: m.name,
            size: m.size,
            family: m.details.family,
            parameters: m.details.parameter_size,
            quantization: m.details.quantization_level,
        })
        .collect();
    models.sort_by(|a, b| a.name.cmp(&b.name));
    Some((loaded, models))
}

/// Session-local observations. Failed polls and sleep gaps are never billed
/// as loaded time. The graph holds at most ten minutes of samples.
#[derive(Default)]
pub struct Tracker {
    previous: Option<(f64, HashSet<String>)>,
    activity: BTreeMap<String, ModelActivity>,
    history: VecDeque<MemorySample>,
    peak_bytes: u64,
}

impl Tracker {
    pub fn observe(&mut self, state: &mut OllamaState) {
        let at = state.checked_at;
        let bytes = if state.status == Status::Ok {
            let elapsed = self.previous.as_ref().map_or(0.0, |(t, _)| at - t);
            for m in &state.loaded {
                let activity = self.activity.entry(m.name.clone()).or_default();
                if elapsed > 0.0
                    && elapsed <= EVERY.as_secs_f64() * 3.0
                    && self.previous.as_ref().is_some_and(|(_, names)| names.contains(&m.name))
                {
                    activity.loaded_seconds += elapsed;
                }
                activity.last_seen = at;
                activity.peak_bytes = activity.peak_bytes.max(m.size);
            }
            self.previous = Some((at, state.loaded.iter().map(|m| m.name.clone()).collect()));
            let bytes = state.loaded.iter().map(|m| m.size).fold(0u64, u64::saturating_add);
            self.peak_bytes = self.peak_bytes.max(bytes);
            Some(bytes)
        } else {
            self.previous = None;
            None
        };
        self.history.push_back(MemorySample { at, bytes });
        while self.history.len() > 121 || self.history.front().is_some_and(|s| s.at < at - 600.0) {
            self.history.pop_front();
        }
        state.activity = self.activity.clone();
        state.memory_history = self.history.iter().cloned().collect();
        state.peak_bytes = self.peak_bytes;
    }
}

/// Bytes of context cache per token at 16 bits, from `/api/show`'s
/// `model_info`. A hybrid model with `full_attention_interval` keeps a cache
/// only in every n-th layer; a per-layer list of KV heads is summed.
pub fn kv_per_token(show: &Value) -> Option<u64> {
    let info = show.get("model_info")?.as_object()?;
    let arch = info.get("general.architecture")?.as_str()?;
    let field = |k: &str| info.get(&format!("{arch}.{k}"));
    let num = |k: &str| field(k).and_then(Value::as_u64);
    let blocks = num("block_count")?;
    let heads = num("attention.head_count").filter(|h| *h > 0)?;
    let width = num("embedding_length").map(|e| e / heads);
    let k = num("attention.key_length").or(width)?;
    let v = num("attention.value_length").or(width)?;
    let kv_heads: u64 = match field("attention.head_count_kv") {
        Some(Value::Array(per_layer)) => per_layer.iter().filter_map(Value::as_u64).sum(),
        Some(n) => {
            let layers = match num("full_attention_interval") {
                Some(i) if i > 1 => blocks / i,
                _ => blocks,
            };
            n.as_u64()? * layers
        }
        None => heads * blocks,
    };
    Some(kv_heads * (k + v) * 2)
}

/// `memory_pressure`'s "System-wide memory free percentage: 77%".
pub fn free_pct() -> Option<u8> {
    let out = std::process::Command::new("/usr/bin/memory_pressure").output().ok()?;
    parse_free(&String::from_utf8_lossy(&out.stdout))
}

pub fn parse_free(text: &str) -> Option<u8> {
    let line = text.lines().rev().find(|l| l.contains("free percentage"))?;
    let digits: String = line.rsplit(':').next()?.chars().filter(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Physical memory in bytes.
pub fn total_memory() -> Option<u64> {
    let mut value: u64 = 0;
    let mut len = std::mem::size_of::<u64>();
    // SAFETY: hw.memsize is a 64-bit integer; the buffer and length match.
    let rc = unsafe {
        libc::sysctlbyname(c"hw.memsize".as_ptr(), (&raw mut value).cast(), &mut len, std::ptr::null_mut(), 0)
    };
    (rc == 0 && value > 0).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS: &str = r#"{"models":[{"name":"qwen3.8:27b","model":"qwen3.8:27b","size":34000000000,"digest":"x",
        "details":{"family":"qwen35"},"expires_at":"2026-11-16T06:30:00.0-08:00","size_vram":34000000000,
        "context_length":262144},{"name":"small:1b","model":"small:1b","size":1500000000,"size_vram":1500000000,
        "context_length":4096}]}"#;
    const TAGS: &str = r#"{"models":[{"name":"qwen3.8:27b","model":"qwen3.8:27b","size":17741872154},
        {"name":"small:1b","model":"small:1b","size":1300000000},{"name":"other:7b","model":"other:7b","size":1}]}"#;

    #[test]
    fn loaded_models_with_their_cache() {
        let (loaded, installed) = parse(PS, TAGS).unwrap();
        assert_eq!(installed.len(), 3);
        assert!(installed.iter().any(|m| m.name == "other:7b"));
        assert_eq!(loaded.len(), 2);
        let big = &mut loaded.clone()[0];
        assert_eq!(big.context, Some(262_144));
        assert_eq!(big.weights, Some(17_741_872_154));
        assert_eq!(big.cache(), None);
        big.kv_per_token = Some(65_536);
        assert_eq!(big.cache(), Some(17_179_869_184));
        assert_eq!(big.expires_at, Some("2026-11-16T14:30:00Z".parse::<jiff::Timestamp>().unwrap().as_second() as f64));
        assert_eq!(warning(big), Some(Warning::VeryLarge));
        let at_32k = Loaded { context: Some(32_768), ..big.clone() };
        assert_eq!(warning(&at_32k), None);
        assert_eq!(warning(&loaded[1]), None);
    }

    #[test]
    fn a_long_context_alone_warns() {
        let m = Loaded {
            name: "m".into(),
            size: 10,
            size_vram: 10,
            weights: None,
            context: Some(65_536),
            kv_per_token: None,
            expires_at: None,
        };
        assert_eq!(warning(&m), Some(Warning::Large));
    }

    #[test]
    fn cache_per_token_of_a_hybrid_model() {
        let show = serde_json::json!({"model_info": {
            "general.architecture": "qwen35",
            "qwen35.attention.head_count": 24,
            "qwen35.attention.head_count_kv": 4,
            "qwen35.attention.key_length": 256,
            "qwen35.attention.value_length": 256,
            "qwen35.block_count": 65,
            "qwen35.embedding_length": 5120,
            "qwen35.full_attention_interval": 4,
        }});
        assert_eq!(kv_per_token(&show), Some(65_536));
    }

    #[test]
    fn cache_per_token_of_plain_and_per_layer_models() {
        let plain = serde_json::json!({"model_info": {
            "general.architecture": "llama",
            "llama.attention.head_count": 32,
            "llama.attention.head_count_kv": 8,
            "llama.block_count": 32,
            "llama.embedding_length": 4096,
        }});
        // 32 layers x 8 heads x (128 + 128) x 2 bytes.
        assert_eq!(kv_per_token(&plain), Some(131_072));
        let per_layer = serde_json::json!({"model_info": {
            "general.architecture": "x",
            "x.attention.head_count": 8,
            "x.attention.head_count_kv": [2, 0, 2, 0],
            "x.attention.key_length": 64,
            "x.attention.value_length": 64,
            "x.block_count": 4,
        }});
        assert_eq!(kv_per_token(&per_layer), Some(4 * 128 * 2));
        assert_eq!(kv_per_token(&serde_json::json!({})), None);
    }

    #[test]
    fn idle_server() {
        let (loaded, installed) = parse(r#"{"models":[]}"#, r#"{"models":[]}"#).unwrap();
        assert!(loaded.is_empty());
        assert!(installed.is_empty());
        assert!(parse("nope", "{}").is_none());
    }

    #[test]
    fn installed_models_keep_details_even_when_unloaded() {
        let (_, models) = parse(r#"{"models":[]}"#, r#"{"models":[
            {"name":"small:1b","size":1234,"details":{"family":"llama","parameter_size":"1B","quantization_level":"Q8_0"}}
        ]}"#).unwrap();
        assert_eq!(models[0].name, "small:1b");
        assert_eq!(models[0].parameters, "1B");
        assert_eq!(models[0].quantization, "Q8_0");
        assert_eq!(models[0].size, 1234);
    }

    #[test]
    fn observations_skip_disconnections_sleep_and_unloaded_intervals() {
        let (loaded, models) = parse(PS, TAGS).unwrap();
        let mut state =
            OllamaState { status: Status::Ok, loaded, models, checked_at: 100.0, ..OllamaState::checking() };
        let mut tracker = Tracker::default();
        tracker.observe(&mut state);
        assert_eq!(state.activity["small:1b"].loaded_seconds, 0.0);
        state.checked_at = 105.0;
        tracker.observe(&mut state);
        assert_eq!(state.activity["small:1b"].loaded_seconds, 5.0);
        assert_eq!(state.peak_bytes, 35_500_000_000);
        state.checked_at = 500.0; // The Mac slept; this is not observed activity.
        tracker.observe(&mut state);
        assert_eq!(state.activity["small:1b"].loaded_seconds, 5.0);
        state.checked_at = 505.0;
        state.status = Status::Unavailable;
        tracker.observe(&mut state);
        assert_eq!(state.memory_history.last().unwrap().bytes, None);
        state.checked_at = 510.0;
        state.status = Status::Ok;
        tracker.observe(&mut state);
        assert_eq!(state.activity["small:1b"].loaded_seconds, 5.0);
        state.loaded.clear();
        state.checked_at = 515.0;
        tracker.observe(&mut state);
        assert_eq!(state.memory_history.last().unwrap().bytes, Some(0));
        assert_eq!(state.activity["small:1b"].last_seen, 510.0);
        assert_eq!(state.activity["small:1b"].peak_bytes, 1_500_000_000);
        state.loaded = parse(PS, TAGS).unwrap().0;
        state.checked_at = 520.0;
        tracker.observe(&mut state);
        assert_eq!(state.activity["small:1b"].loaded_seconds, 5.0);
        for at in (525..=1225).step_by(5) {
            state.checked_at = at as f64;
            tracker.observe(&mut state);
        }
        assert_eq!(state.memory_history.len(), 121);
        assert_eq!(state.memory_history[0].at, 625.0);
    }

    #[test]
    fn free_percentage() {
        let text = "The system has 68719476736 (4194304 pages with a page size of 16384).\n\
                    System-wide memory free percentage: 77%\n";
        assert_eq!(parse_free(text), Some(77));
        assert_eq!(parse_free("nothing"), None);
    }

    #[test]
    fn memory_size() {
        assert!(total_memory().unwrap_or(0) > 1_000_000_000);
    }
}
