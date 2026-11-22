//! Claude Code's `/usage` panel, read through the CLI in a pseudo-terminal.
//! It uses no quota: the probe's own session line in the panel reads
//! "0 input, 0 output".
//!
//! The CLI runs with `--safe-mode` and `--strict-mcp-config`, so no hooks,
//! plugins or MCP servers start, and with `CLAUDE_CODE_SKIP_PROMPT_HISTORY`
//! so the typed `/usage` is not added to `~/.claude/history.jsonl`. It writes
//! no transcript for a session without prompts.

use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use super::reset_at;
use crate::agents::model::{Limit, Provider, Status, Window, now};
use crate::agents::pty;

pub const EVERY: Duration = Duration::from_secs(120);

pub const ARGS: [&str; 2] = ["--safe-mode", "--strict-mcp-config"];
pub const ENV: [(&str, &str); 2] = [("DISABLE_AUTOUPDATER", "1"), ("CLAUDE_CODE_SKIP_PROMPT_HISTORY", "1")];

static WINDOW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(Current session|Current week \(([^)]+)\))[^%]{0,400}?(\d+(?:\.\d+)?)%\s*used",
        r"(?:\s*Resets?\s*(?:([A-Z][a-z]{2,8}\.? \d{1,2})(?:,|\s+at)?\s*)?",
        r"(\d{1,2}(?::\d{2})?\s*[ap]m)\s*\(([\w/+-]+)\))?",
    ))
    .expect("window pattern")
});
static PLAN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Claude (Max|Pro|Team|Enterprise|Ultra)\b").expect("plan pattern"));
/// The probe's own session in the panel: proof that it spent nothing.
static OWN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Usage:\s*(\d+) input, (\d+) output").expect("own-usage pattern"));

/// Read the panel and turn it into a limit.
pub fn check(program: Option<&Path>, home: &Path, probe: &Path) -> Limit {
    let Some(program) = program else {
        return Limit::new(Provider::Claude, Status::NotInstalled, "Claude Code is not installed");
    };
    let ready = regex::bytes::Regex::new("❯").expect("ready pattern");
    let done = regex::bytes::Regex::new(r"Current (?:session|week)[^%]{0,400}%\s*used").expect("done pattern");
    let script = pty::Script {
        ready: &ready,
        done: &done,
        dismiss: false,
        settle: Duration::from_millis(2500),
        timeout: Duration::from_secs(60),
        answer: None,
    };
    let env = pty::env(home, &ENV);
    match pty::read_usage(program, &ARGS, &env, probe, &script) {
        Ok(text) => parse(&text, now()),
        Err(e) => Limit::new(Provider::Claude, Status::Unavailable, format!("Couldn't read /usage: {e}")),
    }
}

/// The windows in the panel's text. The panel redraws, so the last drawing of
/// each window wins.
pub fn parse(text: &str, now: f64) -> Limit {
    let mut windows: Vec<Window> = Vec::new();
    for c in WINDOW.captures_iter(text) {
        let name = match c.get(2) {
            None => "5-hour".to_owned(),
            Some(scope) if scope.as_str().eq_ignore_ascii_case("all models") => "Weekly".to_owned(),
            Some(scope) => format!("Weekly · {}", scope.as_str().trim_end_matches(" only")),
        };
        let used: f64 = c[3].parse().unwrap_or(0.0);
        let resets = match (c.get(5), c.get(6)) {
            (Some(time), Some(tz)) => reset_at(c.get(4).map(|m| m.as_str()), time.as_str(), tz.as_str(), now),
            _ => None,
        };
        let w = Window::new(name, used, resets);
        match windows.iter_mut().find(|x| x.name == w.name) {
            Some(x) => *x = w,
            None => windows.push(w),
        }
    }
    let account = PLAN.captures(text).map(|c| format!("Claude {}", &c[1])).unwrap_or_else(|| "Claude".into());
    if windows.is_empty() {
        let mut l = Limit::new(Provider::Claude, Status::Unavailable, "No limits in the /usage panel");
        l.account = account;
        return l;
    }
    // Sessions first, then weekly windows, the all-models one before scoped ones.
    windows.sort_by_key(|w| (w.name != "5-hour", w.scope().is_some()));
    let spent = OWN.captures(text).map(|c| c[1].parse::<u64>().unwrap_or(0) + c[2].parse::<u64>().unwrap_or(0));
    let detail = match spent {
        Some(0) => "From /usage in the CLI; the check used 0 tokens".to_owned(),
        Some(n) => format!("From /usage in the CLI; the check reported {n} tokens"),
        None => "From /usage in the CLI".to_owned(),
    };
    Limit::ok(Provider::Claude, account, detail, windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The panel as Claude Code 2.1.325 draws it, after plain text conversion.
    const PANEL: &str = "Claude Code v2.1.325 Opus 5.5 with xhigh effort · Claude Ultra ~/Library/Application \
        Support/Agent Monitor/probe Settings Status Config Usage Stats Session Total cost: $0.0000 \
        Usage: 0 input, 0 output, 0 cache read, 0 cache write \
        Current week (all models)██████▌ 83%usedResets Nov 21 at 12am (America/Los_Angeles)What's \
        contributing Refreshing… Current week (Fable)██▌ 33%usedResets Nov 21 at 12am (America/Los_Angeles) \
        Current week (all models)██████▌ 84% used Resets Nov 21 at 12am (America/Los_Angeles) Usage credits Unlimited";

    fn epoch(s: &str) -> f64 {
        s.parse::<jiff::Timestamp>().unwrap().as_second() as f64
    }

    #[test]
    fn reads_weekly_windows_and_the_plan() {
        let now = epoch("2026-11-16T14:00:00Z");
        let l = parse(PANEL, now);
        assert_eq!(l.status, Status::Ok);
        assert_eq!(l.account, "Claude Ultra");
        let names: Vec<&str> = l.windows.iter().map(|w| w.name.as_str()).collect();
        assert_eq!(names, ["Weekly", "Weekly · Fable"]);
        // The later drawing of the all-models window wins.
        assert_eq!(l.windows[0].used_pct, 84.0);
        assert_eq!(l.windows[1].used_pct, 33.0);
        // Nov 21 at 12am in Los Angeles is 08:00 UTC.
        assert_eq!(l.windows[0].resets_at, Some(epoch("2026-11-21T08:00:00Z")));
        assert!(l.detail.contains("used 0 tokens"));
    }

    #[test]
    fn reads_the_session_window_in_the_older_format() {
        let now = epoch("2026-10-17T07:00:00Z");
        let text = "Claude Max Current session ███ 12% used Resets 1:20am (America/Los_Angeles) \
                    Current week (all models) 40% used Resets Oct 17, 4am (America/Los_Angeles) \
                    Current week (Sonnet only) 5% used";
        let l = parse(text, now);
        let names: Vec<&str> = l.windows.iter().map(|w| w.name.as_str()).collect();
        assert_eq!(names, ["5-hour", "Weekly", "Weekly · Sonnet"]);
        assert_eq!(l.account, "Claude Max");
        // 1:20am Los Angeles is 08:20 UTC; it is 00:00 there now, so today.
        assert_eq!(l.windows[0].resets_at, Some(epoch("2026-10-17T08:20:00Z")));
        assert_eq!(l.windows[1].resets_at, Some(epoch("2026-10-17T11:00:00Z")));
        assert_eq!(l.windows[2].resets_at, None);
    }

    #[test]
    fn no_windows_is_unavailable() {
        let l = parse("Claude Pro something else", 0.0);
        assert_eq!(l.status, Status::Unavailable);
        assert_eq!(l.account, "Claude Pro");
    }

    #[test]
    fn missing_cli_is_not_installed() {
        let l = check(None, Path::new("/h"), Path::new("/h/p"));
        assert_eq!(l.status, Status::NotInstalled);
    }
}
