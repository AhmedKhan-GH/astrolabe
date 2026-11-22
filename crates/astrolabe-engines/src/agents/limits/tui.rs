//! Kimi Code's and Antigravity's `/usage` panels, read through each CLI in a
//! pseudo-terminal, with patterns tolerant of missing spaces.

use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use super::duration;
use crate::agents::model::{Limit, Provider, Status, Window, now};
use crate::agents::pty;

pub const KIMI_EVERY: Duration = Duration::from_secs(120);
pub const AGY_EVERY: Duration = Duration::from_secs(120);

static KIMI_LABEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:5h|Weekly|Monthly) limit").expect("kimi label"));
static KIMI_WINDOW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(5h|Weekly|Monthly) limit\D*?(\d+(?:\.\d+)?)%\s*used\s*resets in\s*((?:\d+\s*[dhms]\s*)+)")
        .expect("kimi pattern")
});

pub fn kimi(program: Option<&Path>, home: &Path, probe: &Path) -> Limit {
    let Some(program) = program else {
        return Limit::new(Provider::Kimi, Status::NotInstalled, "Kimi Code CLI is not installed");
    };
    let ready = regex::bytes::Regex::new("context: ").expect("ready");
    let done = regex::bytes::Regex::new(r"(?:5h|Weekly|Monthly) limit[^%]{0,200}%\s*used\s*resets in").expect("done");
    let script = pty::Script {
        ready: &ready,
        done: &done,
        dismiss: false,
        settle: Duration::from_secs(1),
        timeout: Duration::from_secs(45),
        answer: None,
    };
    let mut limit = match pty::read_usage(program, &[], &pty::env(home, &[]), probe, &script) {
        Ok(text) => parse_kimi(&text, now()),
        Err(e) => Limit::new(Provider::Kimi, Status::Unavailable, format!("Couldn't read /usage: {e}")),
    };
    super::kimi::add_plan(&mut limit, home);
    limit
}

pub fn parse_kimi(text: &str, now: f64) -> Limit {
    let mut windows: Vec<Window> = Vec::new();
    let labels: Vec<_> = KIMI_LABEL.find_iter(text).collect();
    for (i, label) in labels.iter().enumerate() {
        // Terminal redraws can put the next "5h limit" directly after a reset
        // duration. Do not consume that label as another five reset hours.
        let end = labels.get(i + 1).map_or(text.len(), |next| next.start());
        let Some(c) = KIMI_WINDOW.captures(&text[label.start()..end]) else { continue };
        let name = if &c[1] == "5h" { "5-hour" } else { &c[1] };
        let w = Window::new(name, c[2].parse().unwrap_or(0.0), Some(now + duration(&c[3]) as f64));
        match windows.iter_mut().find(|x| x.name == w.name) {
            Some(x) => *x = w,
            None => windows.push(w),
        }
    }
    if windows.is_empty() {
        return Limit::new(Provider::Kimi, Status::Unavailable, "No plan usage in Kimi's /usage panel");
    }
    windows.sort_by_key(|w| match w.name.as_str() {
        "5-hour" => 0,
        "Weekly" => 1,
        _ => 2,
    });
    Limit::ok(Provider::Kimi, "", "From /usage in the CLI", windows)
}

static AGY_GROUP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([A-Z][A-Z &]+ MODELS)").expect("group"));
static AGY_WINDOW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(Weekly|Five Hour) Limit Remaining[^%]{0,200}?(\d+(?:\.\d+)?)%\s*",
        r"(?:Refreshes in\s*((?:\d+\s*[dhm]\s*)+)|Quota available)",
    ))
    .expect("agy window")
});
static AGY_PLAN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\(Google AI ([A-Za-z]+)\)").expect("plan"));
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("spaces"));

/// Antigravity's `agy` reports Google's quota groups, each with a weekly and a
/// 5-hour limit shown as the percentage remaining.
pub fn gemini(program: Option<&Path>, home: &Path, probe: &Path) -> Limit {
    let Some(program) = program else {
        return Limit::new(Provider::Gemini, Status::NotInstalled, "Antigravity's agy is not installed");
    };
    let ready = regex::bytes::Regex::new("for shortcuts").expect("ready");
    let done = regex::bytes::Regex::new(r"Five Hour Limit[\s\S]*Five Hour Limit[^%]*%").expect("done");
    // agy asks once whether to trust a new folder; the probe folder is
    // Astrolabe's own and stays empty, so the first choice, "Yes", is pressed.
    let trust = regex::bytes::Regex::new("Do you trust the contents of this project").expect("trust");
    let script = pty::Script {
        ready: &ready,
        done: &done,
        dismiss: true,
        settle: Duration::from_secs(1),
        timeout: Duration::from_secs(45),
        answer: Some((&trust, b"\r")),
    };
    let result = pty::read_usage(program, &[], &pty::env(home, &[]), probe, &script);
    forget_probe_history(&home.join(AGY_HISTORY), probe);
    match result {
        Ok(text) => parse_agy(&text, now()),
        Err(e) => Limit::new(Provider::Gemini, Status::Unavailable, format!("Couldn't read agy's /usage: {e}")),
    }
}

/// agy's history of typed prompts and commands, one JSON object per line.
const AGY_HISTORY: &str = ".gemini/antigravity-cli/history.jsonl";

/// Remove the lines agy wrote for the engine's own `/usage` checks: those
/// whose `workspace` is the probe folder. Every other line is kept as it was.
pub fn forget_probe_history(history: &Path, probe: &Path) {
    let Ok(text) = std::fs::read_to_string(history) else { return };
    let probe = probe.to_string_lossy();
    let ours = |line: &str| {
        serde_json::from_str::<serde_json::Value>(line)
            .ok()
            .and_then(|v| v.get("workspace").and_then(|w| w.as_str()).map(|w| w == probe))
            .unwrap_or(false)
    };
    if !text.lines().any(ours) {
        return;
    }
    let kept: String = text.lines().filter(|l| !ours(l)).map(|l| format!("{l}\n")).collect();
    let tmp = history.with_extension("jsonl.agent-monitor");
    if std::fs::write(&tmp, kept).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        let _ = std::fs::rename(&tmp, history);
    }
}

pub fn parse_agy(text: &str, now: f64) -> Limit {
    let text = SPACES.replace_all(text, " ");
    let body = text.rfind("Models & Quota").map_or(&text[..], |i| &text[i..]);
    let mut windows = Vec::new();
    let groups: Vec<_> = AGY_GROUP.find_iter(body).collect();
    for (i, g) in groups.iter().enumerate() {
        let end = groups.get(i + 1).map_or(body.len(), |n| n.start());
        let label = title_group(g.as_str());
        for c in AGY_WINDOW.captures_iter(&body[g.end()..end]) {
            let kind = if &c[1] == "Five Hour" { "5-hour" } else { "Weekly" };
            let remaining: f64 = c[2].parse().unwrap_or(100.0);
            windows.push(Window::new(
                format!("{kind} · {label}"),
                ((100.0 - remaining) * 100.0).round() / 100.0,
                c.get(3).map(|r| now + duration(r.as_str()) as f64),
            ));
        }
    }
    let account =
        AGY_PLAN.captures(&text).map(|c| format!("Google AI {}", &c[1])).unwrap_or_else(|| "Google".to_owned());
    if windows.is_empty() {
        let mut l = Limit::new(Provider::Gemini, Status::Unavailable, "No quota in agy's /usage panel");
        l.account = account;
        return l;
    }
    windows.sort_by(|a, b| (!a.name.starts_with("5-hour"), &a.name).cmp(&(!b.name.starts_with("5-hour"), &b.name)));
    Limit::ok(Provider::Gemini, account, "From /usage in agy", windows)
}

/// "CLAUDE AND GPT MODELS" -> "Claude/GPT"; "GEMINI MODELS" -> "Gemini".
fn title_group(group: &str) -> String {
    let words: Vec<String> = group
        .trim_end_matches(" MODELS")
        .split_whitespace()
        .map(|w| match w {
            "AND" | "&" => "/".to_owned(),
            "GPT" => "GPT".to_owned(),
            w => {
                let lower = w.to_lowercase();
                let mut c = lower.chars();
                c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
            }
        })
        .collect();
    words.join(" ").replace(" / ", "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kimi_windows() {
        let text = "context: 0% 5h limit ━━━ 12.5% used resets in 3h 20m Weekly limit ━━ 40%used resets in 2d 4h";
        let l = parse_kimi(text, 1000.0);
        assert_eq!(l.status, Status::Ok);
        assert_eq!(l.windows.len(), 2);
        assert_eq!(l.windows[0], Window::new("5-hour", 12.5, Some(1000.0 + 3.0 * 3600.0 + 20.0 * 60.0)));
        assert_eq!(l.windows[1].name, "Weekly");
        assert_eq!(l.windows[1].resets_at, Some(1000.0 + 2.0 * 86400.0 + 4.0 * 3600.0));
    }

    #[test]
    fn kimi_without_plan_usage() {
        assert_eq!(parse_kimi("context: 0%", 0.0).status, Status::Unavailable);
    }

    #[test]
    fn kimi_monthly_usage_and_latest_redraw() {
        let l = parse_kimi(
            "Monthly limit 10% used resets in 20d 5h limit 1% used resets in 3h Weekly limit 2% used resets in 4d Monthly limit 12% used resets in 20d",
            0.0,
        );
        assert_eq!(l.windows.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(), ["5-hour", "Weekly", "Monthly"]);
        assert_eq!(l.windows[2], Window::new("Monthly", 12.0, Some(20.0 * 86400.0)));
        assert!(l.account.is_empty());
    }

    #[test]
    fn agy_groups() {
        let text = "Signed in (Google AI Ultra) Models & Quota GEMINI MODELS Weekly Limit Remaining ███ 80% \
                    Refreshes in 3d 2h Five Hour Limit Remaining ██ 100% Quota available \
                    CLAUDE AND GPT MODELS Weekly Limit Remaining 55.5% Refreshes in 1d \
                    Five Hour Limit Remaining 10% Refreshes in 2h 30m";
        let l = parse_agy(text, 0.0);
        assert_eq!(l.account, "Google AI Ultra");
        let names: Vec<&str> = l.windows.iter().map(|w| w.name.as_str()).collect();
        assert_eq!(names, ["5-hour · Claude/GPT", "5-hour · Gemini", "Weekly · Claude/GPT", "Weekly · Gemini"]);
        assert_eq!(l.windows[0].used_pct, 90.0);
        assert_eq!(l.windows[0].resets_at, Some(2.0 * 3600.0 + 30.0 * 60.0));
        assert_eq!(l.windows[1].resets_at, None);
        assert_eq!(l.windows[2].used_pct, 44.5);
    }

    #[test]
    fn group_titles() {
        assert_eq!(title_group("CLAUDE AND GPT MODELS"), "Claude/GPT");
        assert_eq!(title_group("GEMINI MODELS"), "Gemini");
    }

    #[test]
    fn removes_only_the_probe_folders_lines() {
        let dir = tempfile::tempdir().unwrap();
        let history = dir.path().join("history.jsonl");
        let probe = std::path::Path::new("/x/Agent Monitor/probe");
        let mine = r#"{"display":"/model","timestamp":1,"workspace":"/opt/workspaces/sample","type":"slash_command"}"#;
        let ours = r#"{"display":"/usage","timestamp":2,"workspace":"/x/Agent Monitor/probe","type":"slash_command"}"#;
        std::fs::write(&history, format!("{mine}\n{ours}\n{mine}\n")).unwrap();
        forget_probe_history(&history, probe);
        assert_eq!(std::fs::read_to_string(&history).unwrap(), format!("{mine}\n{mine}\n"));
        // Nothing of ours: the file is left alone.
        forget_probe_history(&history, probe);
        assert_eq!(std::fs::read_to_string(&history).unwrap(), format!("{mine}\n{mine}\n"));
    }
}
