//! Live limits per account on this Mac's paths and tools. Each source has its
//! own polling interval: Claude, Kimi, GLM, Gemini, Mistral, MiniMax, DeepSeek,
//! and Xiaomi every 2 minutes, Codex every 30 seconds, Ollama every 5 seconds.

pub mod claude;
pub mod codex;
pub mod glm;
pub mod harnesses;
pub mod hosted;
mod kimi;
pub mod mistral;
pub mod ollama;
pub mod tui;
pub mod xiaomi;

use super::model::Window;

/// "3h 20m", "2d 4h", "45 s" -> seconds.
pub fn duration(text: &str) -> u64 {
    let mut total = 0;
    let mut num = String::new();
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            num.push(ch);
        } else if let Some(unit) = match ch {
            'd' => Some(86400),
            'h' => Some(3600),
            'm' => Some(60),
            's' => Some(1),
            _ => None,
        } {
            total += num.parse::<u64>().unwrap_or(0) * unit;
            num.clear();
        } else if !ch.is_whitespace() {
            num.clear();
        }
    }
    total
}

/// A reset time as a panel shows it: an optional "Nov 21" date, a clock time
/// such as "12am" or "1:20 pm", and an IANA zone. Without a date it is the
/// next such time; with one, this year's unless that was over a day ago.
pub fn reset_at(date: Option<&str>, time: &str, zone: &str, now: f64) -> Option<f64> {
    use jiff::civil::{Date, Time};
    let tz = jiff::tz::TimeZone::get(zone).ok()?;
    let now_z = jiff::Timestamp::from_second(now as i64).ok()?.to_zoned(tz.clone());
    let t = time.replace(' ', "").to_lowercase();
    let pm = t.ends_with("pm");
    let clock = t.trim_end_matches("am").trim_end_matches("pm");
    let (h, m) = match clock.split_once(':') {
        Some((h, m)) => (h.parse::<i8>().ok()?, m.parse::<i8>().ok()?),
        None => (clock.parse::<i8>().ok()?, 0),
    };
    let hour = match (h % 12, pm) {
        (h, true) => h + 12,
        (h, false) => h,
    };
    let at = Time::new(hour, m, 0, 0).ok()?;
    let zoned = match date {
        Some(d) => {
            let mut parts = d.trim_matches(|c: char| c == ',' || c == '.' || c.is_whitespace()).split_whitespace();
            let month = month_number(parts.next()?)?;
            let day: i8 = parts.next()?.trim_matches(',').parse().ok()?;
            let mut z = Date::new(now_z.year(), month, day).ok()?.to_datetime(at).to_zoned(tz.clone()).ok()?;
            if z.timestamp().as_second() < now as i64 - 86400 {
                z = Date::new(now_z.year() + 1, month, day).ok()?.to_datetime(at).to_zoned(tz).ok()?;
            }
            z
        }
        None => {
            let mut z = now_z.date().to_datetime(at).to_zoned(tz.clone()).ok()?;
            if z.timestamp().as_second() <= now as i64 {
                z = now_z.date().tomorrow().ok()?.to_datetime(at).to_zoned(tz).ok()?;
            }
            z
        }
    };
    Some(zoned.timestamp().as_second() as f64)
}

fn month_number(name: &str) -> Option<i8> {
    const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let lower = name.to_lowercase();
    MONTHS.iter().position(|m| lower.starts_with(m)).map(|i| i as i8 + 1)
}

/// "just now", "4 min ago", "3 h ago", "2 d ago".
pub fn ago(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    match s {
        0..60 => "just now".to_owned(),
        60..3600 => format!("{} min ago", s / 60),
        3600..86400 => format!("{} h ago", s / 3600),
        _ => format!("{} d ago", s / 86400),
    }
}

/// A window's use now: a window whose reset time has passed starts again.
pub fn used_now(w: &Window, now: f64) -> f64 {
    match w.resets_at {
        Some(t) if t <= now => 0.0,
        _ => w.used_pct,
    }
}

/// A tool-call allowance, such as GLM's monthly web tools, rather than a
/// limit on model use; it uses a neutral progress bar.
pub fn is_tool_window(w: &Window) -> bool {
    w.name.contains(" tools")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn epoch(s: &str) -> f64 {
        s.parse::<jiff::Timestamp>().unwrap().as_second() as f64
    }

    #[test]
    fn durations() {
        assert_eq!(duration("3h 20m"), 3 * 3600 + 20 * 60);
        assert_eq!(duration("2d4h"), 2 * 86400 + 4 * 3600);
        assert_eq!(duration("45 s"), 45);
        assert_eq!(duration(""), 0);
    }

    #[test]
    fn reset_times() {
        let now = epoch("2026-11-16T14:00:00Z"); // 06:00 in Los Angeles
        let la = "America/Los_Angeles";
        assert_eq!(reset_at(Some("Nov 21"), "12am", la, now), Some(epoch("2026-11-21T08:00:00Z")));
        assert_eq!(reset_at(Some("Nov 21,"), "4:30 pm", la, now), Some(epoch("2026-11-22T00:30:00Z")));
        assert_eq!(reset_at(None, "7am", la, now), Some(epoch("2026-11-16T15:00:00Z")));
        assert_eq!(reset_at(None, "5am", la, now), Some(epoch("2026-11-17T13:00:00Z")));
        // A date long past means next year.
        assert_eq!(reset_at(Some("Jan 2"), "12pm", la, now), Some(epoch("2027-01-02T20:00:00Z")));
        assert_eq!(reset_at(None, "7am", "Not/AZone", now), None);
    }

    #[test]
    fn ages() {
        assert_eq!(ago(5.0), "just now");
        assert_eq!(ago(600.0), "10 min ago");
        assert_eq!(ago(7300.0), "2 h ago");
        assert_eq!(ago(200000.0), "2 d ago");
    }
}
