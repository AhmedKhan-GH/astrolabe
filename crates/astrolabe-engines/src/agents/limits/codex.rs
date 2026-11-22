//! Codex records the account's rate limits with every request in its session
//! rollouts under `~/.codex/sessions/YYYY/MM/DD`. This reads the newest
//! snapshot from the end of the newest files; it starts no process.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::agents::model::{Limit, Provider, Status, Window, now};

pub const EVERY: Duration = Duration::from_secs(30);

/// How much of a rollout's end is read, and how many of the newest rollouts.
const TAIL: u64 = 512 * 1024;
const NEWEST: usize = 6;

#[derive(Deserialize)]
struct Line {
    timestamp: Option<String>,
    payload: Option<Payload>,
}

#[derive(Deserialize)]
struct Payload {
    #[serde(rename = "type")]
    kind: Option<String>,
    rate_limits: Option<RateLimits>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct RateLimits {
    pub limit_id: Option<String>,
    pub limit_name: Option<String>,
    pub primary: Option<RateWindow>,
    pub secondary: Option<RateWindow>,
    pub plan_type: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct RateWindow {
    pub used_percent: Option<f64>,
    pub window_minutes: Option<u64>,
    pub resets_at: Option<f64>,
}

/// The newest rate-limit snapshot of each limit id, and when it was taken.
pub fn latest(sessions: &Path) -> BTreeMap<String, (f64, RateLimits)> {
    let mut found: BTreeMap<String, (f64, RateLimits)> = BTreeMap::new();
    for file in newest_rollouts(sessions, NEWEST) {
        let Ok(text) = tail(&file, TAIL) else { continue };
        for line in text.lines() {
            if !line.contains("\"rate_limits\"") {
                continue;
            }
            let Ok(rec) = serde_json::from_str::<Line>(line) else { continue };
            let Some(p) = rec.payload else { continue };
            let (Some("token_count"), Some(rl)) = (p.kind.as_deref(), p.rate_limits) else { continue };
            let at = rec.timestamp.as_deref().and_then(epoch).unwrap_or(0.0);
            let id = rl.limit_id.clone().unwrap_or_else(|| "codex".to_owned());
            if found.get(&id).is_none_or(|(t, _)| at >= *t) {
                found.insert(id, (at, rl));
            }
        }
    }
    found
}

pub fn check(sessions: &Path, installed: bool) -> Limit {
    let found = latest(sessions);
    if found.is_empty() {
        return if installed {
            Limit::new(Provider::Codex, Status::Setup, "No Codex requests recorded yet")
        } else {
            Limit::new(Provider::Codex, Status::NotInstalled, "Codex is not installed")
        };
    }
    to_limit(&found, now())
}

pub fn to_limit(found: &BTreeMap<String, (f64, RateLimits)>, now: f64) -> Limit {
    let mut windows = Vec::new();
    let mut plan = None;
    let mut at = 0.0f64;
    for (id, (t, rl)) in found {
        at = at.max(*t);
        if plan.is_none() {
            plan = rl.plan_type.clone();
        }
        // The account-wide limit is "codex"; others count one model family.
        let scope = (id != "codex").then(|| rl.limit_name.clone().unwrap_or_else(|| id.clone()));
        for w in [&rl.primary, &rl.secondary].into_iter().flatten() {
            let mins = w.window_minutes.unwrap_or(0);
            let span = match mins {
                300 => "5-hour".to_owned(),
                10080 => "Weekly".to_owned(),
                0 => "Limit".to_owned(),
                m if m % 1440 == 0 => format!("{}-day", m / 1440),
                m => format!("{}-hour", (m as f64 / 60.0).round()),
            };
            let name = match &scope {
                Some(s) => format!("{span} · {s}"),
                None => span,
            };
            windows.push(Window::new(name, w.used_percent.unwrap_or(0.0), w.resets_at));
        }
    }
    windows.sort_by_key(|w| (w.scope().is_some(), w.name != "5-hour"));
    let account = match plan {
        Some(p) if !p.is_empty() => format!("ChatGPT {}{}", p[..1].to_uppercase(), &p[1..]),
        _ => "ChatGPT".to_owned(),
    };
    let detail = format!("As of the last Codex request, {}", super::ago(now - at));
    let mut l = Limit::ok(Provider::Codex, account, detail, windows);
    l.checked_at = at;
    l
}

/// The newest rollout files, walking the dated folders from the newest.
fn newest_rollouts(sessions: &Path, n: usize) -> Vec<PathBuf> {
    fn sorted_dirs(dir: &Path) -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
            .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default();
        v.sort();
        v.reverse();
        v
    }
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    'walk: for year in sorted_dirs(sessions) {
        for month in sorted_dirs(&year) {
            for day in sorted_dirs(&month) {
                let Ok(rd) = std::fs::read_dir(&day) else { continue };
                for e in rd.flatten() {
                    let p = e.path();
                    let name = e.file_name();
                    let name = name.to_string_lossy();
                    if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                        let t = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                        files.push((t, p));
                    }
                }
                // A long session keeps writing into an older day's folder, so
                // look a little past the first day that has enough files.
                if files.len() >= n * 3 {
                    break 'walk;
                }
            }
        }
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files.into_iter().take(n).map(|(_, p)| p).collect()
}

/// The last `max` bytes of a file, from its first whole line.
fn tail(path: &Path, max: u64) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    let start = len.saturating_sub(max);
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    f.read_to_end(&mut buf)?;
    let from = if start > 0 { buf.iter().position(|&b| b == b'\n').map_or(buf.len(), |i| i + 1) } else { 0 };
    Ok(String::from_utf8_lossy(&buf[from..]).into_owned())
}

pub fn epoch(iso: &str) -> Option<f64> {
    iso.parse::<jiff::Timestamp>().ok().map(|t| t.as_millisecond() as f64 / 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(ts: &str, pct: f64, mins: u64) -> String {
        format!(
            r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{}},"rate_limits":{{"limit_id":"codex","limit_name":null,"primary":{{"used_percent":{pct},"window_minutes":{mins},"resets_at":1795193584}},"secondary":null,"plan_type":"pro"}}}}}}"#
        )
    }

    #[test]
    fn newest_snapshot_wins_across_files() {
        let dir = tempfile::tempdir().unwrap();
        let day = dir.path().join("2026/11/14");
        std::fs::create_dir_all(&day).unwrap();
        let a =
            format!("{}\n{}\n", line("2026-11-14T10:00:00Z", 10.0, 10080), line("2026-11-14T11:00:00Z", 12.0, 10080));
        std::fs::write(day.join("rollout-a.jsonl"), a).unwrap();
        let day2 = dir.path().join("2026/11/15");
        std::fs::create_dir_all(&day2).unwrap();
        std::fs::write(day2.join("rollout-b.jsonl"), line("2026-11-15T09:00:00Z", 20.0, 10080) + "\n").unwrap();
        std::fs::write(day2.join("other.jsonl"), line("2026-11-16T09:00:00Z", 99.0, 10080) + "\n").unwrap();
        let found = latest(dir.path());
        let (at, rl) = &found["codex"];
        assert_eq!(*at, epoch("2026-11-15T09:00:00Z").unwrap());
        assert_eq!(rl.primary.as_ref().unwrap().used_percent, Some(20.0));

        let l = to_limit(&found, *at + 600.0);
        assert_eq!(l.account, "ChatGPT Pro");
        assert_eq!(l.windows, [Window::new("Weekly", 20.0, Some(1795193584.0))]);
        assert!(l.detail.contains("10 min ago"), "{}", l.detail);
    }

    #[test]
    fn nothing_recorded() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(check(dir.path(), true).status, Status::Setup);
        assert_eq!(check(dir.path(), false).status, Status::NotInstalled);
    }

    #[test]
    fn tail_starts_at_a_whole_line() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f");
        std::fs::write(&p, "aaaa\nbbbb\ncc\n").unwrap();
        assert_eq!(tail(&p, 6).unwrap(), "cc\n");
        assert_eq!(tail(&p, 100).unwrap(), "aaaa\nbbbb\ncc\n");
    }
}
