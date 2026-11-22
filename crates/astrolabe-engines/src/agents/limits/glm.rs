//! GLM quotas using a manually stored Coding Plan key, or ZCode's sign-in.
//! Credentials are sent only to their fixed official endpoint, without redirects.

use std::{path::Path, time::Duration};

use serde_json::Value;

use crate::agents::model::{Limit, Provider, Status, Window, now};
use crate::agents::{tools, zcode};

pub const EVERY: Duration = Duration::from_secs(120);
pub const QUOTA_URL: &str = "https://api.z.ai/api/monitor/usage/quota/limit";
const BALANCE_URL: &str = "https://zcode.z.ai/api/v1/zcode-plan/billing/balance";

pub fn check(home: &Path, key: Option<&str>, credentials: &mut zcode::Credentials) -> Limit {
    if let Some(key) = key.filter(|k| !k.trim().is_empty()) {
        return request(QUOTA_URL, key.trim()).map(|v| parse(&v)).unwrap_or_else(|l| l);
    }
    let auth = match credentials.auth(home) {
        Ok(Some(auth)) => auth,
        Ok(None) => {
            return Limit::new(Provider::Glm, Status::Setup, "Sign in to ZCode, or add a Coding Plan key in Settings");
        }
        Err(detail) => return Limit::new(Provider::Glm, Status::Setup, detail),
    };
    let mut quota = Limit::new(Provider::Glm, Status::Unavailable, "ZCode is signed in; no quota reported");
    if !auth.access.trim().is_empty() {
        quota = request(QUOTA_URL, &bearer(&auth.access)).map(|v| parse(&v)).unwrap_or_else(|l| l);
        if quota.status == Status::Ok {
            quota.detail = "From Z.ai using your ZCode sign-in".into();
            return quota;
        }
    }
    if !auth.jwt.trim().is_empty() {
        // ZCode Start plans have a separate credit/token balance from Coding Plans.
        let balance = request(&balance_url(home), &bearer(&auth.jwt))
            .map(|v| parse_balance(&v, now()))
            .unwrap_or_else(|l| l);
        if balance.status == Status::Ok || auth.access.trim().is_empty() {
            return balance;
        }
        if quota.status != Status::Setup && balance.status != Status::Setup {
            return Limit::new(
                Provider::Glm,
                Status::Unavailable,
                "ZCode sign-in found; Z.ai quota and balance are unavailable",
            );
        }
    }
    quota
}

fn balance_url(home: &Path) -> String {
    // Match the client-version query ZCode sends, when its desktop app is present.
    let version = [home.join("Applications/ZCode.app"), "/Applications/ZCode.app".into()]
        .iter()
        .find_map(|p| tools::plist_version(p))
        .filter(|v| v.len() <= 64 && v.bytes().all(|c| c.is_ascii_alphanumeric() || b".-_".contains(&c)));
    match version {
        Some(v) => format!("{BALANCE_URL}?app_version={v}"),
        None => BALANCE_URL.into(),
    }
}

fn bearer(value: &str) -> String {
    let value = value.trim();
    if value.get(..7).is_some_and(|v| v.eq_ignore_ascii_case("bearer ")) {
        value.to_owned()
    } else {
        format!("Bearer {value}")
    }
}

fn request(url: &str, authorization: &str) -> Result<Value, Limit> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .http_status_as_error(false)
        .max_redirects(0)
        .user_agent("astrolabe")
        .build()
        .new_agent();
    let resp = agent.get(url).header("Authorization", authorization).header("Accept", "application/json").call();
    let mut resp = match resp {
        Ok(r) => r,
        Err(_) => return Err(Limit::new(Provider::Glm, Status::Unavailable, "Z.ai could not be reached")),
    };
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err(Limit::new(
            Provider::Glm,
            Status::Setup,
            "Z.ai refused access; sign in again to ZCode or replace the key in Settings",
        ));
    }
    if !(200..300).contains(&status) {
        return Err(Limit::new(Provider::Glm, Status::Unavailable, format!("Z.ai answered HTTP {status}")));
    }
    resp.body_mut()
        .with_config()
        .limit(1_048_576)
        .read_to_string()
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .ok_or_else(|| Limit::new(Provider::Glm, Status::Unavailable, "Z.ai returned an unreadable quota response"))
}

fn success(body: &Value) -> bool {
    body.get("success")
        .and_then(Value::as_bool)
        .unwrap_or(matches!(body.get("code").and_then(Value::as_i64), Some(0 | 200)))
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.parse().ok()).filter(|v| v.is_finite())
}

/// Turn the quota response into windows. Unit codes:
/// 3 = hours, 4 = days, 5 = months, 6 = weeks.
pub fn parse(body: &Value) -> Limit {
    if !success(body) {
        return Limit::new(Provider::Glm, Status::Unavailable, "Z.ai did not return a quota for this account");
    }
    let data = body.get("data").cloned().unwrap_or(Value::Null);
    let items = match &data {
        Value::Object(o) => o.get("limits").and_then(Value::as_array).cloned().unwrap_or_default(),
        Value::Array(a) => a.clone(),
        _ => Vec::new(),
    };
    let mut windows: Vec<(u8, Window)> = Vec::new();
    for item in items.iter().filter_map(Value::as_object) {
        let num = |k: &str| item.get(k).and_then(number);
        let pct = num("percentage").or_else(|| match (num("currentValue"), num("usage")) {
            (Some(cur), Some(total)) if total > 0.0 => Some(100.0 * cur / total),
            _ => None,
        });
        let Some(pct) = pct.filter(|v| v.is_finite()) else { continue };
        let n = num("number").unwrap_or(1.0) as u64;
        let (unit, order) = match item.get("unit").and_then(Value::as_i64) {
            Some(3) => ("hour", 0),
            Some(4) => ("day", 1),
            Some(6) => ("week", 2),
            Some(5) => ("month", 3),
            _ => ("", 9),
        };
        let span = match (unit, n) {
            ("hour", n) => format!("{n}-hour"),
            ("", _) => "Limit".to_owned(),
            ("day", 1) => "Daily".to_owned(),
            (u, 1) => format!("{}{}ly", u[..1].to_uppercase(), &u[1..]),
            (u, n) => format!("{n} {u}s"),
        };
        let name = if item.get("type").and_then(Value::as_str) == Some("TIME_LIMIT") {
            match (num("currentValue"), num("usage")) {
                (Some(cur), Some(total)) if total > 0.0 => format!("{span} tools ({cur}/{total})"),
                _ => format!("{span} tools"),
            }
        } else {
            span
        };
        let resets = num("nextResetTime").filter(|v| *v > 0.0).map(|v| if v > 1e11 { v / 1000.0 } else { v });
        windows.push((order, Window::new(name, pct.clamp(0.0, 100.0), resets)));
    }
    if windows.is_empty() {
        return Limit::new(Provider::Glm, Status::Unavailable, "Z.ai's answer had no limits");
    }
    windows.sort_by_key(|(o, _)| *o);
    let level = data.get("level").and_then(Value::as_str).filter(|l| !l.is_empty());
    let account = match level {
        Some(l) => {
            let mut chars = l.chars();
            format!("Coding Plan {}{}", chars.next().unwrap().to_uppercase(), chars.as_str())
        }
        None => "Coding Plan".to_owned(),
    };
    Limit::ok(Provider::Glm, account, "From Z.ai's quota endpoint", windows.into_iter().map(|(_, w)| w).collect())
}

/// Each balance remains a separate allowance: credits and tokens cannot be added.
fn parse_balance(body: &Value, now: f64) -> Limit {
    let missing =
        || Limit::new(Provider::Glm, Status::Unavailable, "ZCode is signed in; no active plan balance was reported");
    if !success(body) {
        return missing();
    }
    let now = body.pointer("/data/server_time").and_then(number).filter(|v| *v > 0.0).unwrap_or(now);
    let Some(balances) = body.pointer("/data/balances").and_then(Value::as_array) else { return missing() };
    let plans = body.pointer("/data/plans").and_then(Value::as_array);
    let mut windows = Vec::new();
    for b in balances {
        let num = |key: &str| b.get(key).and_then(number);
        let seconds = |v: f64| if v > 1e11 { v / 1000.0 } else { v };
        if ["expires_at", "period_end"].iter().any(|k| num(k).is_some_and(|v| v > 0.0 && seconds(v) <= now))
            || num("period_start").is_some_and(|v| seconds(v) > now)
        {
            continue;
        }
        let plan = plans.and_then(|plans| {
            plans.iter().find(|p| {
                if let Some(id) = b.get("user_plan_id").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                    p.get("user_plan_id").and_then(Value::as_str) == Some(id)
                } else {
                    b.get("plan_id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| p.get("plan_id").and_then(Value::as_str) == Some(id))
                }
            })
        });
        if plan.is_some_and(|p| {
            p.get("status").and_then(Value::as_str).is_some_and(|s| !s.trim().eq_ignore_ascii_case("active"))
                || p.get("ends_at").and_then(number).is_some_and(|v| v > 0.0 && seconds(v) <= now)
                || p.get("starts_at").and_then(number).is_some_and(|v| seconds(v) > now)
        }) {
            continue;
        }
        let Some(total) = num("total_units").filter(|v| *v > 0.0) else { continue };
        let Some(used) = num("used_units").or_else(|| num("remaining_units").map(|v| total - v)) else { continue };
        let pct = (100.0 * used / total).clamp(0.0, 100.0);
        if !pct.is_finite() {
            continue;
        }
        let label = b.get("show_name").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("Plan balance");
        let unit = b.get("unit_type").and_then(Value::as_str).unwrap_or("units");
        // An expiry is not evidence of an automatic reset. Keep the actual
        // balance until the next server reading instead of inventing headroom.
        windows.push(Window::new(format!("{label} ({used}/{total} {unit})"), pct, None));
    }
    if windows.is_empty() {
        return missing();
    }
    Limit::ok(Provider::Glm, "ZCode plan", "From ZCode's plan balance using your sign-in", windows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn windows_from_the_quota_answer() {
        let body = json!({"code": 200, "success": true, "data": {"level": "pro", "limits": [
            {"type": "TIME_LIMIT", "unit": 5, "number": 1, "usage": 1000, "currentValue": 12, "percentage": 1.2,
             "nextResetTime": 1795000000000u64},
            {"type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 42.0, "nextResetTime": 1794000000000u64},
            {"type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 7.5},
        ]}});
        let l = parse(&body);
        assert_eq!(l.status, Status::Ok);
        assert_eq!(l.account, "Coding Plan Pro");
        let names: Vec<&str> = l.windows.iter().map(|w| w.name.as_str()).collect();
        assert_eq!(names, ["5-hour", "Weekly", "Monthly tools (12/1000)"]);
        assert_eq!(l.windows[0].resets_at, Some(1794000000.0));
        assert_eq!(l.windows[1].resets_at, None);
    }

    #[test]
    fn rejected_and_empty_answers() {
        assert_eq!(parse(&json!({"success": false, "msg": "bad key"})).status, Status::Unavailable);
        assert_eq!(parse(&json!({"success": true, "data": []})).status, Status::Unavailable);
    }

    #[test]
    fn no_key_sends_nothing() {
        let home = tempfile::tempdir().unwrap();
        let mut credentials = zcode::Credentials::default();
        assert_eq!(check(home.path(), None, &mut credentials).status, Status::Setup);
        assert_eq!(check(home.path(), Some("  "), &mut credentials).status, Status::Setup);
    }

    #[test]
    fn oauth_success_and_numeric_strings() {
        let l = parse(&json!({"code":0, "data":{"level":"高级", "limits":[{"unit":4,"percentage":"120"}]}}));
        assert_eq!(l.status, Status::Ok);
        assert_eq!(l.windows[0].name, "Daily");
        assert_eq!(l.windows[0].used_pct, 100.0);
        assert_eq!(bearer(" Bearer fixture "), "Bearer fixture");
        assert_eq!(bearer("fixture"), "Bearer fixture");
    }

    #[test]
    fn plan_balances_keep_units_separate_and_exclude_expired_buckets() {
        let l = parse_balance(
            &json!({"code":0,"data":{
            "plans":[{"plan_id":"old","status":"expired"}],
            "balances":[
                {"show_name":"GLM","total_units":"100","used_units":"25","unit_type":"credits","expires_at":2000},
                {"total_units":1000,"remaining_units":600,"unit_type":"tokens"},
                {"total_units":100,"used_units":90,"expires_at":900},
                {"total_units":100,"used_units":90,"period_start":1100},
                {"total_units":100,"used_units":90,"plan_id":"old"},
                {"total_units":0,"used_units":0},
                {"total_units":100}
            ]}}),
            1000.0,
        );
        assert_eq!(l.status, Status::Ok);
        assert_eq!(l.windows.len(), 2);
        assert_eq!(l.windows[0].used_pct, 25.0);
        assert_eq!(l.windows[1].used_pct, 40.0);
        assert!(l.windows.iter().all(|w| w.resets_at.is_none()));
        assert_eq!(parse_balance(&json!({"code":0,"data":{"balances":[]}}), 1000.0).status, Status::Unavailable);
    }
}
