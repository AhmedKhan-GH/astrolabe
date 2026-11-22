//! MiMo Token Plan credits, using only the key's explicitly selected region.
//!
//! Official contract: https://mimo.mi.com/docs/en-US/api/asset/credits-get
//! Credential slots: XiaomiMiMo/MiMo-Code, packages/cli/src/provider/xiaomi-family.ts.

use std::{fs::File, io::Read, path::Path, time::Duration};

use serde_json::{Value, json};

use crate::agents::model::{Limit, Provider, Status, Window, now};
use crate::agents::paths;

pub const EVERY: Duration = Duration::from_secs(120);
const MAX_BYTES: u64 = 1_048_576;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Region {
    China,
    Europe,
    Singapore,
}

impl Region {
    pub const ALL: [Self; 3] = [Self::China, Self::Europe, Self::Singapore];

    pub fn name(self) -> &'static str {
        match self {
            Self::China => "China",
            Self::Europe => "Europe",
            Self::Singapore => "Singapore",
        }
    }

    fn code(self) -> &'static str {
        match self {
            Self::China => "cn",
            Self::Europe => "ams",
            Self::Singapore => "sgp",
        }
    }

    fn provider(self) -> &'static str {
        match self {
            Self::China => "xiaomi-token-plan-cn",
            Self::Europe => "xiaomi-token-plan-ams",
            Self::Singapore => "xiaomi-token-plan-sgp",
        }
    }

    fn base(self) -> &'static str {
        match self {
            Self::China => "https://token-plan-cn.xiaomimimo.com/v1",
            Self::Europe => "https://token-plan-ams.xiaomimimo.com/v1",
            Self::Singapore => "https://token-plan-sgp.xiaomimimo.com/v1",
        }
    }

    fn url(self) -> &'static str {
        match self {
            Self::China => "https://token-plan-cn.xiaomimimo.com/v1/platform/token_plan",
            Self::Europe => "https://token-plan-ams.xiaomimimo.com/v1/platform/token_plan",
            Self::Singapore => "https://token-plan-sgp.xiaomimimo.com/v1/platform/token_plan",
        }
    }
}

/// Stored as one Keychain value so a key can never lose its destination region.
pub fn manual_key(region: Region, key: &str) -> String {
    json!({"region": region.code(), "api_key": key.trim()}).to_string()
}

struct Credential {
    region: Region,
    key: String,
}

fn unavailable(detail: impl Into<String>) -> Limit {
    Limit::new(Provider::Xiaomi, Status::Unavailable, detail)
}

fn setup(detail: impl Into<String>) -> Limit {
    Limit::new(Provider::Xiaomi, Status::Setup, detail)
}

pub fn check(home: &Path, key: Option<&str>) -> Limit {
    let credential = match key {
        Some(key) if !key.trim().is_empty() => manual_credential(key),
        _ => saved_credential(home),
    };
    let credential = match credential {
        Ok(credential) => credential,
        Err(limit) => return limit,
    };
    request(&credential).map(|body| parse(&body, credential.region, now())).unwrap_or_else(|l| l)
}

fn valid_key(value: &str) -> bool {
    value.starts_with("tp-")
        && value.len() > 3
        && value.len() <= 4096
        && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control)
}

fn manual_credential(value: &str) -> Result<Credential, Limit> {
    let value: Value = serde_json::from_str(value)
        .map_err(|_| setup("Select the MiMo Token Plan region and save its tp- key in Settings"))?;
    let region = Region::ALL
        .into_iter()
        .find(|r| value.get("region").and_then(Value::as_str) == Some(r.code()))
        .ok_or_else(|| setup("Select a supported MiMo Token Plan region in Settings"))?;
    let key = value
        .get("api_key")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|k| valid_key(k))
        .ok_or_else(|| setup("MiMo Token Plan requires a dedicated tp- key; replace it in Settings"))?;
    Ok(Credential { region, key: key.to_owned() })
}

fn saved_credential(home: &Path) -> Result<Credential, Limit> {
    for path in paths::mimo_auth_paths(home) {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err(setup("MiMo Code credentials could not be read; add a Token Plan key in Settings")),
        };
        let mut body = String::new();
        file.take(MAX_BYTES + 1)
            .read_to_string(&mut body)
            .map_err(|_| setup("MiMo Code credentials could not be read; add a Token Plan key in Settings"))?;
        if body.len() as u64 > MAX_BYTES {
            return Err(setup("MiMo Code credentials are too large to read; add a Token Plan key in Settings"));
        }
        let body: Value = serde_json::from_str(&body)
            .map_err(|_| setup("MiMo Code credentials are unreadable; add a Token Plan key in Settings"))?;
        // MiMo uses one auth store, so the first existing path is authoritative.
        return credential_from_auth(&body);
    }
    Err(setup("Sign in to MiMo Code with a Token Plan, or add its region and tp- key in Settings"))
}

fn credential_from_auth(body: &Value) -> Result<Credential, Limit> {
    let mut credentials: Vec<Credential> = Vec::new();
    for region in Region::ALL {
        if let Some(entry) = body.get(region.provider())
            && let Some(credential) = api_credential(entry, region)
        {
            credentials.push(credential);
        }
    }
    if let Some(entry) = body.get("xiaomi")
        && let Some(base) = entry.pointer("/metadata/base_url").and_then(Value::as_str)
        && let Some(region) = Region::ALL.into_iter().find(|r| base.trim_end_matches('/') == r.base())
        && let Some(credential) = api_credential(entry, region)
        && !credentials.iter().any(|c| c.region == credential.region && c.key == credential.key)
    {
        // Match complete URLs, rejecting custom hosts, credentials, ports,
        // query strings and schemes even when they contain an official host.
        credentials.push(credential);
    }
    match credentials.len() {
        1 => Ok(credentials.remove(0)),
        0 => Err(setup("No regional MiMo Token Plan key found; add its region and tp- key in Settings")),
        _ => Err(setup("Several MiMo Token Plan keys found; select the region and key to monitor in Settings")),
    }
}

fn api_credential(entry: &Value, region: Region) -> Option<Credential> {
    if entry.get("type").and_then(Value::as_str) != Some("api") {
        return None;
    }
    let key = entry.get("key").and_then(Value::as_str)?.trim();
    valid_key(key).then(|| Credential { region, key: key.to_owned() })
}

fn request(credential: &Credential) -> Result<Value, Limit> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .http_status_as_error(false)
        .max_redirects(0)
        .user_agent("astrolabe")
        .build()
        .new_agent();
    let mut response = agent
        .get(credential.region.url())
        .header("Authorization", format!("Bearer {}", credential.key))
        .header("Accept", "application/json")
        .call()
        .map_err(|_| unavailable("MiMo Token Plan could not be reached"))?;
    match response.status().as_u16() {
        200..=299 => {}
        401 | 403 => return Err(setup("MiMo refused access; check the Token Plan key and region in Settings")),
        status => return Err(unavailable(format!("MiMo Token Plan answered HTTP {status}"))),
    }
    response
        .body_mut()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_string()
        .ok()
        .and_then(|body| serde_json::from_str(&body).ok())
        .ok_or_else(|| unavailable("MiMo returned an unreadable Token Plan response"))
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.parse().ok()).filter(|v| v.is_finite() && *v >= 0.0 && v.fract() == 0.0)
}

fn utc(value: &str) -> Option<f64> {
    // The documented timestamps have no timezone suffix and explicitly use UTC.
    let timestamp = format!("{}Z", value.trim().replace(' ', "T"));
    timestamp.parse::<jiff::Timestamp>().ok().map(|t| t.as_second() as f64)
}

pub fn parse(body: &Value, region: Region, now: f64) -> Limit {
    let missing = || unavailable("MiMo did not report a valid active Token Plan credit allowance");
    if body.get("object").and_then(Value::as_str) != Some("token_plan") {
        return missing();
    }
    let Some(start) = body.pointer("/period/start_at").and_then(Value::as_str).and_then(utc) else { return missing() };
    let Some(end) = body.pointer("/period/end_at").and_then(Value::as_str).and_then(utc) else { return missing() };
    if start > now || end <= now || end <= start {
        return missing();
    }
    let Some(total) = body.pointer("/quota/total_credits").and_then(number).filter(|v| *v > 0.0) else {
        return missing();
    };
    let Some(used) = body.pointer("/quota/used_credits").and_then(number) else { return missing() };
    let Some(remaining) = body.pointer("/quota/remaining_credits").and_then(number) else { return missing() };
    if remaining > total || remaining != (total - used).max(0.0) {
        return missing();
    }
    let pct = 100.0 * (used / total);
    if !pct.is_finite() {
        return missing();
    }
    let plan = body
        .get("plan_code")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|p| !p.is_empty() && p.chars().count() <= 80 && !p.chars().any(char::is_control));
    let account = match plan {
        Some(plan) => format!("Token Plan {plan}"),
        None => "Token Plan".to_owned(),
    };
    // A nonrenewing plan's expiry does not create fresh credits.
    let reset = (body.get("auto_renew").and_then(Value::as_bool) == Some(true)).then_some(end);
    Limit::ok(
        Provider::Xiaomi,
        account,
        format!("From MiMo Token Plan ({})", region.name()),
        vec![Window::new(format!("Token Plan ({used}/{total} credits)"), pct.clamp(0.0, 100.0), reset)],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        json!({"object":"token_plan","plan_code":"pro","period":{
            "start_at":"2026-11-01 00:00:00","end_at":"2026-12-01 00:00:00"},
            "quota":{"total_credits":10000000,"used_credits":1500000,"remaining_credits":8500000},"auto_renew":true})
    }

    fn now() -> f64 {
        utc("2026-11-17 00:00:00").unwrap()
    }

    #[test]
    fn official_response_preserves_credits_and_reported_tier() {
        let limit = parse(&fixture(), Region::Europe, now());
        assert_eq!(limit.status, Status::Ok);
        assert_eq!(limit.account, "Token Plan pro");
        assert_eq!(limit.windows[0].used_pct, 15.0);
        assert_eq!(limit.windows[0].name, "Token Plan (1500000/10000000 credits)");
        assert_eq!(limit.windows[0].resets_at, utc("2026-12-01 00:00:00"));
        assert!(limit.detail.contains("Europe"));
        let mut body = fixture();
        body["auto_renew"] = json!(false);
        assert_eq!(parse(&body, Region::China, now()).windows[0].resets_at, None);
    }

    #[test]
    fn malformed_zero_and_wrong_units_never_create_headroom() {
        for body in [json!(null), json!({"quota":{"total_credits":100}}), json!({"error":"private server message"})] {
            let limit = parse(&body, Region::China, now());
            assert_eq!(limit.status, Status::Unavailable);
            assert!(limit.windows.is_empty());
            assert!(!limit.detail.contains("private"));
        }
        for (field, value) in [
            ("total_credits", json!(0)),
            ("used_credits", json!(-1)),
            ("used_credits", json!(0.5)),
            ("used_credits", json!("NaN")),
            ("remaining_credits", json!(8500001)),
            ("remaining_credits", json!(99999999)),
        ] {
            let mut body = fixture();
            body["quota"][field] = value;
            assert_eq!(parse(&body, Region::China, now()).status, Status::Unavailable);
        }
        let mut body = fixture();
        body["quota"] = json!({"total_tokens":100,"used_tokens":10,"remaining_tokens":90});
        assert_eq!(parse(&body, Region::China, now()).status, Status::Unavailable);
        assert_eq!(parse(&fixture(), Region::China, utc("2026-12-02 00:00:00").unwrap()).status, Status::Unavailable);
        assert_eq!(parse(&fixture(), Region::China, utc("2026-10-01 00:00:00").unwrap()).status, Status::Unavailable);
    }

    #[test]
    fn zero_usage_is_real_only_with_a_positive_allowance() {
        let mut body = fixture();
        body["quota"] = json!({"total_credits":"100","used_credits":"0","remaining_credits":"100"});
        assert_eq!(parse(&body, Region::Singapore, now()).windows[0].used_pct, 0.0);
        body["quota"] = json!({"total_credits":100,"used_credits":120,"remaining_credits":0});
        assert_eq!(parse(&body, Region::Singapore, now()).windows[0].used_pct, 100.0);
    }

    #[test]
    fn manual_keys_keep_explicit_region_and_never_accept_bare_keys_or_urls() {
        for region in Region::ALL {
            let stored = manual_key(region, " tp-fixture ");
            let credential = manual_credential(&stored).unwrap_or_else(|_| panic!("fixture credential"));
            assert_eq!(credential.region, region);
            assert_eq!(credential.key, "tp-fixture");
            assert!(credential.region.url().starts_with(region.base()));
        }
        for value in [
            "tp-fixture",
            r#"{"region":"https://evil.test","api_key":"tp-fixture"}"#,
            r#"{"region":"cn","api_key":"sk-fixture"}"#,
            r#"{"region":"cn","api_key":"tp-line\nbreak"}"#,
        ] {
            assert!(manual_credential(value).is_err());
            // Invalid explicit settings must never fall back to a saved login.
            assert_eq!(check(Path::new("/unused-fixture-home"), Some(value)).status, Status::Setup);
        }
    }

    #[test]
    fn saved_auth_uses_only_api_fields_and_exact_regional_provider_slots() {
        for region in Region::ALL {
            let body = json!({region.provider():{"type":"api","key":"tp-fixture","metadata":{"base_url":"https://evil.test"}}});
            assert_eq!(credential_from_auth(&body).unwrap_or_else(|_| panic!("fixture credential")).region, region);
        }
        for body in [
            json!({"xiaomi":{"type":"api","key":"tp-fixture"}}),
            json!({"xiaomi-token-plan-cn":{"type":"oauth","key":"tp-fixture","access":"private","refresh":"private"}}),
            json!({"xiaomi-token-plan-cn":{"type":"api","token":"tp-fixture"}}),
            json!({"xiaomi-token-plan-cn.evil":{"type":"api","key":"tp-fixture"}}),
        ] {
            assert!(credential_from_auth(&body).is_err());
        }
    }

    #[test]
    fn legacy_metadata_must_identify_one_fixed_official_gateway() {
        for region in Region::ALL {
            let body = json!({"xiaomi":{"type":"api","key":"tp-fixture","metadata":{"base_url":format!("{}/",region.base())}}});
            assert_eq!(credential_from_auth(&body).unwrap_or_else(|_| panic!("fixture credential")).region, region);
        }
        for base in [
            "http://token-plan-cn.xiaomimimo.com/v1",
            "https://token-plan-cn.xiaomimimo.com.evil/v1",
            "https://evil@token-plan-cn.xiaomimimo.com/v1",
            "https://token-plan-cn.xiaomimimo.com:444/v1",
            "https://token-plan-cn.xiaomimimo.com/v1?redirect=evil",
        ] {
            let body = json!({"xiaomi":{"type":"api","key":"tp-fixture","metadata":{"base_url":base}}});
            assert!(credential_from_auth(&body).is_err());
        }
        let body = json!({"xiaomi-token-plan-cn":{"type":"api","key":"tp-one"},
            "xiaomi-token-plan-ams":{"type":"api","key":"tp-two"}});
        assert!(credential_from_auth(&body).is_err());
    }
}
