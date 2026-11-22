//! Deterministic synthetic agent and quota fixtures for `--demo` mode.
//!
//! All paths, versions, account figures, local models, and session residency
//! metrics are completely synthetic.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use super::engine::Shared;
use super::model::{
    Balance, Limit, Loaded, MemorySample, ModelActivity, OllamaModel, OllamaState, Provider, Status, Window,
};
use super::tools::{Agent, Kind, SignIn};

/// Fixed anchor timestamp (2026-11-18T11:06:40Z) used by [`demo_data`] so
/// repeated calls return identical snapshots.
pub const DEMO_NOW_SECS: f64 = 1_795_000_000.0;

const MIN: f64 = 60.0;
const HOUR: f64 = 3600.0;
const DAY: f64 = 86_400.0;

/// Deterministic synthetic agents engine snapshot anchored at [`DEMO_NOW_SECS`].
pub fn demo_data() -> Shared {
    demo_data_at(DEMO_NOW_SECS)
}

/// Deterministic synthetic agents engine snapshot anchored at `now`.
pub fn demo_data_at(now: f64) -> Shared {
    let mut limits = BTreeMap::new();

    let mut insert = |mut limit: Limit, checked_offset: f64| {
        limit.checked_at = now - checked_offset;
        limits.insert(limit.provider, limit);
    };

    insert(
        Limit::ok(
            Provider::Claude,
            "Claude Max",
            "From /usage in the CLI; the check used 0 tokens",
            vec![
                Window::new("5-hour", 34.0, Some(now + 2.0 * HOUR + 15.0 * MIN)),
                Window::new("Weekly", 62.0, Some(now + 3.0 * DAY + 14.0 * HOUR)),
                Window::new("Weekly · Sonnet", 18.0, Some(now + 3.0 * DAY + 14.0 * HOUR)),
            ],
        ),
        35.0,
    );

    insert(
        Limit::ok(
            Provider::Codex,
            "ChatGPT Pro",
            "As of the last Codex request, 4 min ago",
            vec![
                Window::new("5-hour", 12.0, Some(now + 4.0 * HOUR + 5.0 * MIN)),
                Window::new("Weekly", 48.0, Some(now + 5.0 * DAY + 2.0 * HOUR)),
            ],
        ),
        4.0 * MIN,
    );

    insert(
        Limit::ok(
            Provider::Kimi,
            "Allegretto",
            "From /usage in the CLI",
            vec![
                Window::new("5-hour", 74.0, Some(now + 1.0 * HOUR + 40.0 * MIN)),
                Window::new("Weekly", 29.0, Some(now + 4.0 * DAY + 8.0 * HOUR)),
            ],
        ),
        50.0,
    );

    insert(
        Limit::ok(
            Provider::Glm,
            "Coding Plan Pro",
            "From Z.ai's quota endpoint",
            vec![
                Window::new("5-hour", 41.0, Some(now + 3.0 * HOUR + 10.0 * MIN)),
                Window::new("Weekly", 19.0, Some(now + 6.0 * DAY + 1.0 * HOUR)),
                Window::new("Monthly tools (42/1000)", 4.2, Some(now + 12.0 * DAY)),
            ],
        ),
        45.0,
    );

    insert(
        Limit::ok(
            Provider::Gemini,
            "Google AI Pro",
            "From /usage in agy",
            vec![
                Window::new("5-hour · Claude/GPT", 92.0, Some(now + 45.0 * MIN)),
                Window::new("5-hour · Gemini", 15.0, Some(now + 4.0 * HOUR + 50.0 * MIN)),
                Window::new("Weekly · Claude/GPT", 54.0, Some(now + 2.0 * DAY + 6.0 * HOUR)),
                Window::new("Weekly · Gemini", 22.0, Some(now + 2.0 * DAY + 6.0 * HOUR)),
            ],
        ),
        60.0,
    );

    insert(Limit::new(Provider::Grok, Status::Setup, "Sign in with grok · usage tracking not connected"), 90.0);
    insert(Limit::new(Provider::Meta, Status::NotInstalled, "Install Meta Muse Code"), 90.0);
    insert(Limit::new(Provider::Qwen, Status::Unavailable, "Usage tracking not connected"), 90.0);

    insert(
        Limit::ok(
            Provider::Mistral,
            "Pro",
            "From Mistral's organization Vibe Code budget; pay-as-you-go disabled",
            vec![Window::new("Monthly · Vibe Code", 38.5, Some(now + 13.0 * DAY))],
        ),
        55.0,
    );

    insert(
        Limit::ok(
            Provider::MiniMax,
            "Token Plan",
            "From MiniMax's Token Plan endpoint",
            vec![
                Window::new("5-hour", 27.0, Some(now + 2.0 * HOUR + 55.0 * MIN)),
                Window::new("Weekly", 64.0, Some(now + 4.0 * DAY + 11.0 * HOUR)),
            ],
        ),
        50.0,
    );

    let mut deepseek = Limit::new(Provider::DeepSeek, Status::Ok, "From DeepSeek's balance endpoint");
    deepseek.balances = vec![
        Balance { currency: "USD".into(), available: 18.40 },
        Balance { currency: "CNY".into(), available: 125.00 },
    ];
    insert(deepseek, 40.0);

    insert(
        Limit::ok(
            Provider::Xiaomi,
            "Token Plan pro",
            "From MiMo Token Plan (Europe)",
            vec![Window::new("Token Plan (1850000/10000000 credits)", 18.5, Some(now + 13.0 * DAY))],
        ),
        65.0,
    );

    insert(Limit::new(Provider::Tencent, Status::NotInstalled, "Install Tencent CodeBuddy Code"), 90.0);

    let loaded = vec![
        Loaded {
            name: "atlas-coder:27b".into(),
            size: 26_300_000_000,
            size_vram: 26_300_000_000,
            weights: Some(17_700_000_000),
            context: Some(131_072),
            kv_per_token: Some(65_536),
            expires_at: Some(now + 4.0 * MIN),
        },
        Loaded {
            name: "cobalt-instruct:8b".into(),
            size: 5_400_000_000,
            size_vram: 5_400_000_000,
            weights: Some(4_900_000_000),
            context: Some(16_384),
            kv_per_token: Some(32_768),
            expires_at: Some(now + 9.0 * MIN),
        },
    ];

    let models = vec![
        OllamaModel {
            name: "atlas-coder:27b".into(),
            size: 17_700_000_000,
            family: "atlas".into(),
            parameters: "27B".into(),
            quantization: "Q4_K_M".into(),
        },
        OllamaModel {
            name: "cobalt-instruct:8b".into(),
            size: 4_900_000_000,
            family: "cobalt".into(),
            parameters: "8B".into(),
            quantization: "Q8_0".into(),
        },
        OllamaModel {
            name: "prism-embed:0.6b".into(),
            size: 720_000_000,
            family: "prism".into(),
            parameters: "0.6B".into(),
            quantization: "F16".into(),
        },
        OllamaModel {
            name: "spark-reason:32b".into(),
            size: 20_100_000_000,
            family: "spark".into(),
            parameters: "32B".into(),
            quantization: "Q4_K_M".into(),
        },
    ];

    let mut activity = BTreeMap::new();
    activity.insert(
        "atlas-coder:27b".into(),
        ModelActivity { loaded_seconds: 1_860.0, last_seen: now, peak_bytes: 26_300_000_000 },
    );
    activity.insert(
        "cobalt-instruct:8b".into(),
        ModelActivity { loaded_seconds: 740.0, last_seen: now, peak_bytes: 5_400_000_000 },
    );
    activity.insert(
        "prism-embed:0.6b".into(),
        ModelActivity { loaded_seconds: 215.0, last_seen: now - 14.0 * MIN, peak_bytes: 950_000_000 },
    );

    let pattern: [Option<u64>; 24] = [
        Some(5_400_000_000),
        Some(5_400_000_000),
        Some(5_400_000_000),
        Some(14_200_000_000),
        Some(26_300_000_000),
        Some(26_300_000_000),
        Some(26_300_000_000),
        Some(26_300_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
        None,
        Some(31_700_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
        Some(26_300_000_000),
        Some(26_300_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
        Some(31_700_000_000),
    ];
    let memory_history: Vec<MemorySample> = pattern
        .into_iter()
        .enumerate()
        .map(|(i, bytes)| MemorySample { at: now - ((23 - i) as f64) * 25.0, bytes })
        .collect();

    let ollama = OllamaState {
        status: Status::Ok,
        detail: "2 loaded".into(),
        checked_at: now - 3.0,
        loaded,
        installed: models.len(),
        models,
        activity,
        memory_history,
        peak_bytes: 31_700_000_000,
        free_pct: Some(58),
        total_memory: Some(68_719_476_736),
    };

    let agents = vec![
        cli_agent("claude", "Claude Code", Some(Provider::Claude), "/demo/bin/claude", "2.1.325", SignIn::SignedIn("Max".into())),
        cli_agent("codex", "Codex", Some(Provider::Codex), "/demo/bin/codex", "0.168.0", SignIn::SignedIn("ChatGPT".into())),
        cli_agent("kimi", "Kimi Code CLI", Some(Provider::Kimi), "/demo/bin/kimi", "2.6.2", SignIn::SignedIn(String::new())),
        app_agent("ZCode", "Z.ai's desktop app for GLM", Some(Provider::Glm), "/demo/Applications/ZCode.app", "3.18.2", SignIn::SignedIn(String::new())),
        cli_agent("zcode", "ZCode CLI", Some(Provider::Glm), "/demo/bin/zcode", "3.18.2", SignIn::SignedIn(String::new())),
        app_agent("Antigravity", "Google's agent IDE", Some(Provider::Gemini), "/demo/Applications/Antigravity.app", "1.5.9", SignIn::SignedIn("Google".into())),
        cli_agent("agy", "Antigravity CLI", Some(Provider::Gemini), "/demo/bin/agy", "1.5.9", SignIn::SignedIn("Google".into())),
        cli_agent("gemini", "Gemini CLI", Some(Provider::Gemini), "/demo/bin/gemini", "0.7.2", SignIn::SignedIn("Google".into())),
        cli_agent("grok", "Grok Build", Some(Provider::Grok), "/demo/bin/grok", "1.1.0", SignIn::SignedOut),
        missing_agent("muse", "Meta Muse Code", Kind::Cli, Some(Provider::Meta)),
        cli_agent("qwen", "Qwen Code", Some(Provider::Qwen), "/demo/bin/qwen", "0.27.3", SignIn::SignedIn("Saved login".into())),
        cli_agent("vibe", "Mistral Vibe", Some(Provider::Mistral), "/demo/bin/vibe", "1.4.0", SignIn::SignedIn("API key configured".into())),
        cli_agent("mcode", "MiniMax Code CLI", Some(Provider::MiniMax), "/demo/bin/mcode", "0.8.1", SignIn::Unknown("Check your account with /status in MiniMax Code".into())),
        missing_agent("MiniMax Code", "MiniMax Code", Kind::App, Some(Provider::MiniMax)),
        cli_agent("mimo", "Xiaomi MiMo Code", Some(Provider::Xiaomi), "/demo/bin/mimo", "0.7.4", SignIn::SignedIn("Saved login".into())),
        missing_agent("codebuddy", "Tencent CodeBuddy Code", Kind::Cli, Some(Provider::Tencent)),
        missing_agent("CodeBuddy", "Tencent CodeBuddy IDE", Kind::App, Some(Provider::Tencent)),
        cli_agent("opencode", "OpenCode", None, "/demo/bin/opencode", "1.14.2", SignIn::SignedIn(String::new())),
        cli_agent("ollama", "Ollama", Some(Provider::Ollama), "/demo/bin/ollama", "0.40.16", SignIn::NotNeeded),
    ];

    let stored_keys = BTreeSet::from([Provider::Glm, Provider::Mistral, Provider::DeepSeek]);

    Shared {
        limits,
        ollama,
        agents,
        agents_at: Some(now - 90.0),
        probe_left: Vec::new(),
        stored_keys,
        settings_error: None,
    }
}

fn cli_agent(
    id: &'static str,
    name: &'static str,
    provider: Option<Provider>,
    path: &str,
    version: &str,
    sign_in: SignIn,
) -> Agent {
    Agent {
        id,
        name,
        kind: Kind::Cli,
        provider,
        path: Some(PathBuf::from(path)),
        target: None,
        version: Some(version.to_owned()),
        app: None,
        sign_in,
    }
}

fn app_agent(
    id: &'static str,
    name: &'static str,
    provider: Option<Provider>,
    path: &str,
    version: &str,
    sign_in: SignIn,
) -> Agent {
    let p = PathBuf::from(path);
    Agent {
        id,
        name,
        kind: Kind::App,
        provider,
        path: Some(p.clone()),
        target: None,
        version: Some(version.to_owned()),
        app: Some(p),
        sign_in,
    }
}

fn missing_agent(id: &'static str, name: &'static str, kind: Kind, provider: Option<Provider>) -> Agent {
    Agent {
        id,
        name,
        kind,
        provider,
        path: None,
        target: None,
        version: None,
        app: None,
        sign_in: SignIn::Unknown("not installed".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::limits::ollama;
    use crate::agents::model::{UsageLevel, loaded_memory_bytes, sorted_ollama_models, summarize_limits, usage_level};

    #[test]
    fn demo_data_is_deterministic_and_covers_all_providers() {
        let a = demo_data();
        let b = demo_data();
        assert_eq!(a, b);
        assert_eq!(a.limits.len(), Provider::ALL.len() - 1);
        for provider in Provider::ALL.into_iter().filter(|p| *p != Provider::Ollama) {
            assert!(a.limits.contains_key(&provider), "missing {provider:?}");
        }
        assert_eq!(a.agents.len(), 19);
        assert_eq!(a.ollama.status, Status::Ok);
        assert_eq!(a.ollama.loaded.len(), 2);
        assert_eq!(a.ollama.installed, 4);
        assert_eq!(loaded_memory_bytes(&a.ollama), 31_700_000_000);
        assert_eq!(ollama::warning(&a.ollama.loaded[0]), Some(ollama::Warning::VeryLarge));
        assert_eq!(ollama::warning(&a.ollama.loaded[1]), None);
        let ordered = sorted_ollama_models(&a.ollama);
        assert_eq!(ordered[0].name, "atlas-coder:27b");
        assert_eq!(ordered[1].name, "cobalt-instruct:8b");

        let summary = summarize_limits(&a.limits, DEMO_NOW_SECS);
        assert_eq!(summary.total, 13);
        assert_eq!(summary.ok, 9);
        assert_eq!(summary.setup, 1);
        assert_eq!(summary.not_installed, 2);
        assert_eq!(summary.unavailable, 1);
        assert_eq!(summary.highest_used_pct, Some(92.0));
        assert_eq!(usage_level(summary.highest_used_pct.unwrap()), UsageLevel::Critical);
    }
}
