//! Read-only hosted quota endpoints. Credentials stay on fixed official hosts.
//!
//! Schemas: https://api-docs.deepseek.com/api/get-user-balance/ and
//! https://github.com/MiniMax-AI/cli/blob/main/src/types/api.ts . MiniMax's
//! official CLI also documents the legacy remaining-count semantics in
//! src/utils/quota.ts and millisecond resets in src/output/quota-table.ts.

use std::time::Duration;

use serde_json::Value;

use crate::agents::model::{Balance, Limit, Provider, Status, Window, now};

pub const EVERY: Duration = Duration::from_secs(120);
const DEEPSEEK_URL: &str = "https://api.deepseek.com/user/balance";
const MINIMAX_URL: &str = "https://www.minimax.io/v1/token_plan/remains";
const MAX_BYTES: u64 = 1_048_576;

/// Read an optional environment key without silently changing its region.
/// Keys entered in Settings are explicitly for this adapter and bypass this
/// environment fallback; no CLI credential or configuration files are read.
pub fn configured_key(provider: Provider) -> Result<Option<String>, String> {
    configured_key_with(provider, |name| match std::env::var_os(name) {
        None => Ok(None),
        Some(value) => value.into_string().map(Some).map_err(|_| ()),
    })
}

fn configured_key_with(
    provider: Provider,
    mut env: impl FnMut(&str) -> Result<Option<String>, ()>,
) -> Result<Option<String>, String> {
    let key_name = match provider {
        Provider::DeepSeek => "DEEPSEEK_API_KEY",
        Provider::MiniMax => "MINIMAX_API_KEY",
        _ => return Ok(None),
    };
    let unreadable = || "The provider environment configuration could not be read; add a key in Settings".to_owned();
    let Some(key) = env(key_name).map_err(|_| unreadable())?.filter(|key| !key.trim().is_empty()) else {
        return Ok(None);
    };
    if provider == Provider::MiniMax {
        // Official CLI config schema: global => https://api.minimax.io.
        // Never send a China-region or custom-endpoint environment key to our
        // international quota endpoint, even if the other setting says global.
        // Treat non-Unicode and present-but-empty settings as ambiguous.
        let region = env("MINIMAX_REGION").map_err(|_| unreadable())?;
        let base = env("MINIMAX_BASE_URL").map_err(|_| unreadable())?;
        if region.as_deref().is_some_and(|region| region != "global")
            || base.as_deref().is_some_and(|base| base != "https://api.minimax.io")
        {
            return Err("MiniMax environment settings do not select the supported international service; add an international subscription key in Settings".to_owned());
        }
    }
    Ok(Some(key.trim().to_owned()))
}

pub fn check(provider: Provider, key: Option<&str>) -> Limit {
    let url = match provider {
        Provider::DeepSeek => DEEPSEEK_URL,
        Provider::MiniMax => MINIMAX_URL,
        _ => return Limit::new(provider, Status::Unavailable, "No hosted quota endpoint is configured"),
    };
    let Some(key) = key.map(str::trim).filter(|k| !k.is_empty()) else {
        return Limit::new(provider, Status::Setup, "Add a key in Settings");
    };
    if key.chars().any(char::is_control) {
        return Limit::new(provider, Status::Setup, "Replace the key in Settings");
    }
    match request(provider, url, key) {
        Ok(body) if provider == Provider::DeepSeek => parse_deepseek(&body),
        Ok(body) => parse_minimax(&body, now()),
        Err(limit) => limit,
    }
}

fn request(provider: Provider, url: &'static str, key: &str) -> Result<Value, Limit> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .http_status_as_error(false)
        .max_redirects(0)
        .user_agent("astrolabe")
        .build()
        .new_agent();
    let mut response = agent
        .get(url)
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .call()
        .map_err(|_| Limit::new(provider, Status::Unavailable, "The quota service could not be reached"))?;
    if let Some(limit) = http_failure(provider, response.status().as_u16()) {
        return Err(limit);
    }
    response
        .body_mut()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_string()
        .ok()
        .and_then(|body| serde_json::from_str(&body).ok())
        .ok_or_else(|| Limit::new(provider, Status::Unavailable, "The quota service returned an unreadable response"))
}

fn http_failure(provider: Provider, code: u16) -> Option<Limit> {
    let (status, detail) = match code {
        200..=299 => return None,
        401 | 403 => (Status::Setup, "Access was refused; replace the key in Settings"),
        429 => (Status::Unavailable, "The quota service is rate limited; try again later"),
        _ => (Status::Unavailable, "The quota service is temporarily unavailable"),
    };
    Some(Limit::new(provider, status, detail))
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.parse().ok()).filter(|n| n.is_finite())
}

pub fn parse_deepseek(body: &Value) -> Limit {
    let missing = || Limit::new(Provider::DeepSeek, Status::Unavailable, "DeepSeek did not report an account balance");
    let Some(available) = body.get("is_available").and_then(Value::as_bool) else { return missing() };
    // An error object never becomes a valid balance even if other fields exist.
    if body.get("error").is_some() {
        return missing();
    }
    let Some(items) = body.get("balance_infos").and_then(Value::as_array).filter(|items| !items.is_empty()) else {
        return missing();
    };
    let mut balances: Vec<Balance> = Vec::new();
    for item in items {
        let Some(currency @ ("USD" | "CNY")) = item.get("currency").and_then(Value::as_str) else { return missing() };
        let Some(amount) = item.get("total_balance").and_then(number) else { return missing() };
        if balances.iter().any(|balance| balance.currency == currency) {
            return missing();
        }
        balances.push(Balance { currency: currency.to_owned(), available: amount });
    }
    let detail = if available {
        "From DeepSeek's balance endpoint"
    } else {
        "From DeepSeek's balance endpoint; balance is insufficient for API calls"
    };
    let mut limit = Limit::new(Provider::DeepSeek, Status::Ok, detail);
    // total_balance already includes grants and top-ups. It has no quota
    // denominator: never add its components again or invent a usage percent.
    limit.balances = balances;
    limit
}

pub fn parse_minimax(body: &Value, now: f64) -> Limit {
    let missing =
        || Limit::new(Provider::MiniMax, Status::Unavailable, "MiniMax did not report usable Token Plan quotas");
    if body.get("error").is_some() || body.get("success").and_then(Value::as_bool) == Some(false) {
        return missing();
    }
    if let Some(base) = body.get("base_resp") {
        match base.get("status_code").and_then(Value::as_i64) {
            Some(0) => {}
            // MiniMax documents 1004 as authentication failure.
            Some(1004 | 2049) => {
                return Limit::new(Provider::MiniMax, Status::Setup, "Access was refused; replace the key in Settings");
            }
            Some(2057) => {
                return Limit::new(Provider::MiniMax, Status::Setup, "Add a MiniMax subscription key in Settings");
            }
            _ => return missing(),
        }
    }
    let Some(items) = body.get("model_remains").and_then(Value::as_array) else { return missing() };
    let mut windows = Vec::new();
    let mut boosted = false;
    for item in items {
        let scope = item.get("model_name").and_then(Value::as_str).filter(|name| {
            !name.is_empty()
                && name.len() <= 80
                && name.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        });
        for (prefix, label, end, countdown) in [
            ("current_interval", "5-hour", "end_time", "remains_time"),
            ("current_weekly", "Weekly", "weekly_end_time", "weekly_remains_time"),
        ] {
            if prefix == "current_weekly" && item.get("weekly_boost_permille").is_some() {
                // Boosted plans can show >100% of a base allowance. The model
                // represents percent used of a finite allowance, not credits
                // relative to an undisclosed base. Leave this window unknown.
                if item.get("weekly_boost_permille").and_then(number) != Some(1000.0) {
                    boosted = true;
                    continue;
                }
            }
            let Some(used) = minimax_used(item, prefix) else { continue };
            let resets_at = reset(item, end, countdown, now);
            let label = if prefix == "current_interval" { interval_label(item) } else { label.to_owned() };
            let name = match scope {
                Some("general") | None => label,
                Some(scope) => format!("{label} · {scope}"),
            };
            windows.push(Window::new(name, used, resets_at));
        }
    }
    if windows.is_empty() {
        return missing();
    }
    let detail = if boosted {
        "From MiniMax's Token Plan endpoint; boosted weekly quota unavailable"
    } else {
        "From MiniMax's Token Plan endpoint"
    };
    // This response schema has no subscription tier. Do not infer one from
    // quota sizes, model access, or an API key prefix.
    Limit::ok(Provider::MiniMax, "Token Plan", detail, windows)
}

fn interval_label(item: &Value) -> String {
    // Older media allowances can have daily windows. Prefer the actual
    // reported span over labelling every interval as five hours.
    let span = item
        .get("end_time")
        .and_then(number)
        .zip(item.get("start_time").and_then(number))
        .map(|(end, start)| end - start);
    match span {
        Some(86_400_000.0) => "Daily".to_owned(),
        Some(ms) if ms > 0.0 && ms <= 604_800_000.0 && ms % 3_600_000.0 == 0.0 => {
            format!("{}-hour", ms / 3_600_000.0)
        }
        _ => "5-hour".to_owned(),
    }
}

fn minimax_used(item: &Value, prefix: &str) -> Option<f64> {
    if let Some(status) = item.get(format!("{prefix}_status")) {
        match status.as_i64() {
            Some(1 | 2) => {}
            // 3 means unlimited (or no plan bucket): neither has a finite %.
            _ => return None,
        }
    }
    let percent = format!("{prefix}_remaining_percent");
    if let Some(value) = item.get(percent) {
        // Explicit remaining percent is authoritative, including real zero.
        // Reject malformed present fields rather than disguising them with a
        // fallback. New Token Plan responses may have zero count placeholders.
        return number(value).filter(|v| (0.0..=100.0).contains(v)).map(|remaining| 100.0 - remaining);
    }
    let total = item.get(format!("{prefix}_total_count")).and_then(number).filter(|n| *n > 0.0)?;
    let remaining = item.get(format!("{prefix}_usage_count")).and_then(number).filter(|n| *n >= 0.0 && *n <= total)?;
    // As in MiniMax's official CLI resolver, legacy usage_count is a
    // remaining count when an explicit percentage is absent.
    Some(100.0 * (1.0 - remaining / total))
}

fn reset(item: &Value, end: &str, countdown: &str, now: f64) -> Option<f64> {
    // Official CLI uses epoch milliseconds for end times and milliseconds for
    // countdowns. Do not guess units from magnitude or treat a countdown as an
    // epoch. Ignore implausible seconds-shaped epoch values.
    item.get(end).and_then(number).filter(|n| (1e12..1e14).contains(n)).map(|n| n / 1000.0).or_else(|| {
        let duration = item.get(countdown).and_then(number).filter(|n| *n >= 0.0 && *n <= 604_800_000.0)?;
        (now.is_finite() && now > 0.0).then_some(now + duration / 1000.0)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn configured_fixture(provider: Provider, entries: &[(&str, &str)]) -> Result<Option<String>, String> {
        configured_key_with(provider, |name| {
            Ok(entries.iter().find(|(key, _)| *key == name).map(|(_, value)| (*value).to_owned()))
        })
    }

    #[test]
    fn environment_keys_use_absent_or_explicit_global_minimax_configuration() {
        assert_eq!(configured_fixture(Provider::MiniMax, &[]).unwrap(), None);
        assert_eq!(
            configured_fixture(Provider::MiniMax, &[("MINIMAX_API_KEY", " fixture ")]).unwrap().as_deref(),
            Some("fixture")
        );
        assert_eq!(
            configured_fixture(
                Provider::MiniMax,
                &[
                    ("MINIMAX_API_KEY", "fixture"),
                    ("MINIMAX_REGION", "global"),
                    ("MINIMAX_BASE_URL", "https://api.minimax.io"),
                ]
            )
            .unwrap()
            .as_deref(),
            Some("fixture")
        );
        assert_eq!(
            configured_fixture(
                Provider::DeepSeek,
                &[("DEEPSEEK_API_KEY", "deepseek-fixture"), ("MINIMAX_REGION", "cn"),]
            )
            .unwrap()
            .as_deref(),
            Some("deepseek-fixture")
        );
    }

    #[test]
    fn china_custom_and_ambiguous_environment_keys_are_never_rebound() {
        for (setting, value) in [
            ("MINIMAX_REGION", "cn"),
            ("MINIMAX_REGION", "china"),
            ("MINIMAX_REGION", ""),
            ("MINIMAX_REGION", " global "),
            ("MINIMAX_BASE_URL", "https://api.minimax.cn"),
            ("MINIMAX_BASE_URL", "https://api.minimaxi.com"),
            ("MINIMAX_BASE_URL", "https://custom.example/private-identity"),
            ("MINIMAX_BASE_URL", "https://api.minimax.io.evil.example"),
            ("MINIMAX_BASE_URL", "http://api.minimax.io"),
            ("MINIMAX_BASE_URL", "https://api.minimax.io/"),
            ("MINIMAX_BASE_URL", ""),
        ] {
            let error =
                configured_fixture(Provider::MiniMax, &[("MINIMAX_API_KEY", "private-fixture-key"), (setting, value)])
                    .unwrap_err();
            assert!(error.contains("Settings"));
            assert!(!error.contains("private") && !error.contains("https://") && !error.contains("http://"));
        }
        assert!(
            configured_fixture(
                Provider::MiniMax,
                &[
                    ("MINIMAX_API_KEY", "fixture"),
                    ("MINIMAX_REGION", "cn"),
                    ("MINIMAX_BASE_URL", "https://api.minimax.io"),
                ]
            )
            .is_err()
        );
        assert!(
            configured_key_with(Provider::MiniMax, |name| {
                if name == "MINIMAX_API_KEY" { Ok(Some("fixture".into())) } else { Err(()) }
            })
            .is_err()
        );
    }

    #[test]
    fn empty_keys_and_unrelated_providers_do_not_consult_region_configuration() {
        for key in [None, Some(""), Some("  ")] {
            assert_eq!(
                configured_key_with(Provider::MiniMax, |name| {
                    assert_eq!(name, "MINIMAX_API_KEY");
                    Ok(key.map(str::to_owned))
                })
                .unwrap(),
                None
            );
        }
        assert_eq!(
            configured_key_with(Provider::Claude, |_| panic!("unrelated provider read environment")).unwrap(),
            None
        );
        assert_eq!(
            configured_key_with(Provider::DeepSeek, |name| {
                assert_eq!(name, "DEEPSEEK_API_KEY");
                Ok(None)
            })
            .unwrap(),
            None
        );
    }

    #[test]
    fn missing_key_or_unsupported_provider_never_sends_a_request() {
        for provider in [Provider::DeepSeek, Provider::MiniMax] {
            for key in [None, Some("  "), Some("bad\nkey")] {
                assert_eq!(check(provider, key).status, Status::Setup);
            }
        }
        assert_eq!(check(Provider::Claude, Some("fixture")).status, Status::Unavailable);
    }

    #[test]
    fn deepseek_preserves_currency_balances_without_a_percentage_or_double_counting() {
        let limit = parse_deepseek(&json!({"is_available":true,"balance_infos":[
            {"currency":"CNY","total_balance":"110.00","granted_balance":"10.00","topped_up_balance":"100.00"},
            {"currency":"USD","total_balance":"2.5"}
        ]}));
        assert_eq!(limit.status, Status::Ok);
        assert!(limit.windows.is_empty());
        assert!(limit.account.is_empty());
        assert_eq!(limit.balances.len(), 2);
        assert_eq!(limit.balances[0].currency, "CNY");
        assert_eq!(limit.balances[0].available, 110.0);
        assert_eq!(limit.balances[1].available, 2.5);
    }

    #[test]
    fn deepseek_zero_is_valid_but_missing_or_malformed_is_unknown() {
        let zero =
            parse_deepseek(&json!({"is_available":false,"balance_infos":[{"currency":"USD","total_balance":"0"}]}));
        assert_eq!(zero.status, Status::Ok);
        assert_eq!(zero.balances[0].available, 0.0);
        assert!(zero.detail.contains("insufficient"));
        for body in [
            json!({}),
            json!({"error":{"message":"private key"}}),
            json!({"is_available":true,"balance_infos":[]}),
            json!({"is_available":true,"balance_infos":[{"currency":"USD"}]}),
            json!({"is_available":true,"balance_infos":[{"currency":"USD","total_balance":"NaN"}]}),
            json!({"is_available":true,"balance_infos":[{"currency":"USD","total_balance":null}]}),
            json!({"is_available":true,"balance_infos":[{"currency":"private identity","total_balance":10}]}),
        ] {
            let limit = parse_deepseek(&body);
            assert_eq!(limit.status, Status::Unavailable);
            assert!(limit.windows.is_empty() && limit.balances.is_empty());
            assert!(!limit.detail.contains("private"));
        }
    }

    #[test]
    fn minimax_explicit_remaining_percent_overrides_ambiguous_counts() {
        let limit = parse_minimax(
            &json!({"base_resp":{"status_code":0},"model_remains":[{
                "model_name":"general","current_interval_total_count":100,"current_interval_usage_count":7,
                "current_interval_remaining_percent":93,"current_weekly_total_count":0,"current_weekly_usage_count":0,
                "current_weekly_remaining_percent":0,"end_time":1795000000000u64,"weekly_remains_time":3600000
            }]}),
            1794000000.0,
        );
        assert_eq!(limit.status, Status::Ok);
        assert_eq!(limit.account, "Token Plan");
        assert_eq!(limit.windows.len(), 2);
        assert_eq!(limit.windows[0].used_pct, 7.0);
        assert_eq!(limit.windows[1].used_pct, 100.0);
        assert_eq!(limit.windows[0].resets_at, Some(1795000000.0));
        assert_eq!(limit.windows[1].resets_at, Some(1794003600.0));
    }

    #[test]
    fn minimax_legacy_counts_are_remaining_and_never_zero_filled() {
        let limit = parse_minimax(
            &json!({"model_remains":[
                {"model_name":"MiniMax-M2.7","current_interval_total_count":"100","current_interval_usage_count":"80"},
                {"model_name":"video","current_interval_total_count":0,"current_interval_usage_count":0},
                {"model_name":"speech","current_interval_total_count":100},
                {"current_interval_total_count":100,"current_interval_usage_count":101},
                {"current_interval_remaining_percent":null,"current_interval_total_count":100,"current_interval_usage_count":50}
            ]}),
            1000.0,
        );
        assert_eq!(limit.status, Status::Ok);
        assert_eq!(limit.windows.len(), 1);
        assert_eq!(limit.windows[0].name, "5-hour · MiniMax-M2.7");
        assert!((limit.windows[0].used_pct - 20.0).abs() < 1e-10);
        assert_eq!(limit.windows[0].resets_at, None);
    }

    #[test]
    fn minimax_errors_and_invalid_values_do_not_become_zero_usage() {
        for body in [
            json!({}),
            json!({"model_remains":[]}),
            json!({"base_resp":{"status_code":1008,"status_msg":"private key"},"model_remains":[{"current_interval_remaining_percent":100}]}),
            json!({"base_resp":{},"model_remains":[{"current_interval_remaining_percent":100}]}),
            json!({"model_remains":[{"current_interval_remaining_percent":"NaN"}]}),
            json!({"model_remains":[{"current_interval_remaining_percent":101}]}),
            json!({"model_remains":[{"current_interval_remaining_percent":-1}]}),
            json!({"model_remains":[{"current_interval_status":3,"current_interval_remaining_percent":100}]}),
            json!({"model_remains":[{"current_interval_status":99,"current_interval_remaining_percent":100}]}),
        ] {
            let limit = parse_minimax(&body, 1000.0);
            assert_eq!(limit.status, Status::Unavailable);
            assert!(limit.windows.is_empty());
            assert!(!limit.detail.contains("private"));
        }
        let refused = parse_minimax(&json!({"base_resp":{"status_code":1004,"status_msg":"private identity"}}), 1000.0);
        assert_eq!(refused.status, Status::Setup);
        assert!(!refused.detail.contains("private"));
    }

    #[test]
    fn minimax_omits_unlimited_and_boosted_weekly_windows() {
        for fields in [json!({"current_weekly_status":3}), json!({"weekly_boost_permille":1500})] {
            let mut row = json!({"current_interval_remaining_percent":100,"current_weekly_remaining_percent":50});
            row.as_object_mut().unwrap().extend(fields.as_object().unwrap().clone());
            let limit = parse_minimax(&json!({"model_remains":[row]}), 1000.0);
            assert_eq!(limit.windows.len(), 1);
            assert_eq!(limit.windows[0].used_pct, 0.0);
        }
    }

    #[test]
    fn reset_units_are_explicit_and_invalid_values_stay_unknown() {
        assert_eq!(reset(&json!({"end":1795000000000u64}), "end", "left", 1000.0), Some(1795000000.0));
        assert_eq!(reset(&json!({"left":1000}), "end", "left", 1000.0), Some(1001.0));
        assert_eq!(reset(&json!({"left":0}), "end", "left", 1000.0), Some(1000.0));
        for body in [json!({}), json!({"end":1795000000}), json!({"left":-1}), json!({"left":"NaN"})] {
            assert_eq!(reset(&body, "end", "left", 1000.0), None);
        }
    }

    #[test]
    fn reported_media_intervals_use_their_actual_span() {
        let limit = parse_minimax(
            &json!({"model_remains":[{
                "model_name":"video","current_interval_remaining_percent":75,
                "start_time":1794000000000u64,"end_time":1794086400000u64
            }]}),
            1794000000.0,
        );
        assert_eq!(limit.windows[0].name, "Daily · video");
        assert_eq!(limit.windows[0].used_pct, 25.0);
        assert_eq!(parse_minimax(&json!({"base_resp":{"status_code":2057}}), 1000.0).status, Status::Setup);
    }

    #[test]
    fn http_failures_are_sanitized() {
        assert!(http_failure(Provider::MiniMax, 200).is_none());
        for code in [301, 401, 403, 429, 500] {
            let limit = http_failure(Provider::MiniMax, code).unwrap();
            assert_eq!(limit.status, if matches!(code, 401 | 403) { Status::Setup } else { Status::Unavailable });
            assert!(limit.windows.is_empty() && limit.balances.is_empty());
        }
    }
}
