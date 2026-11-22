//! Kimi Code 2.x keeps the subscription name in `/coding/v1/me`, separately
//! from the CLI's `/usage` panel. Read only the configured managed login;
//! the CLI handles token refresh before we read its current access token.

use std::{io::Read, path::Path, time::Duration};

use serde::Deserialize;

use crate::agents::model::Limit;

const MAX_BYTES: u64 = 1_048_576;
const CHINA_BASE: &str = "https://api.kimi.com/coding/v1";
const GLOBAL_BASE: &str = "https://api.kimi.ai/coding/v1";

#[derive(Deserialize)]
struct Config {
    providers: Providers,
}

#[derive(Deserialize)]
struct Providers {
    #[serde(rename = "managed:kimi-code")]
    kimi: Managed,
}

#[derive(Deserialize)]
struct Managed {
    base_url: Option<String>,
    oauth: OAuth,
}

#[derive(Deserialize)]
struct OAuth {
    storage: Option<String>,
    key: String,
}

// Authentication material intentionally has no Debug or Serialize implementation.
#[derive(Deserialize)]
struct Token {
    access_token: String,
}

#[derive(Deserialize)]
struct Profile {
    user_level_name: String,
}

pub(super) fn add_plan(limit: &mut Limit, home: &Path) {
    apply_plan(limit, plan(home));
}

fn apply_plan(limit: &mut Limit, result: Result<String, &'static str>) {
    match result {
        Ok(plan) => limit.account = plan,
        Err(reason) => {
            // A missing profile must not hide valid usage. This detail appears
            // on hover, with no extra badge, subtitle or status column.
            limit.detail.push_str("; subscription level unavailable: ");
            limit.detail.push_str(reason);
        }
    }
}

fn read_limited(path: &Path) -> Option<String> {
    let mut text = String::new();
    std::fs::File::open(path).ok()?.take(MAX_BYTES + 1).read_to_string(&mut text).ok()?;
    (text.len() as u64 <= MAX_BYTES).then_some(text)
}

fn login(home: &Path) -> Result<(&'static str, Token), &'static str> {
    // Match the clean HOME used for the CLI probe, rather than inheriting a
    // different parent process's KIMI_CODE_HOME or endpoint overrides.
    let dir = home.join(".kimi-code");
    let config = read_limited(&dir.join("config.toml")).ok_or("Kimi account configuration could not be read")?;
    let config: Config = toml::from_str(&config).map_err(|_| "Kimi managed account configuration is missing")?;
    let (base, name) = source(&config.providers.kimi)?;
    let token =
        read_limited(&dir.join("credentials").join(format!("{name}.json"))).ok_or("Kimi sign-in could not be read")?;
    let token: Token = serde_json::from_str(&token).map_err(|_| "Kimi sign-in format was not recognized")?;
    if token.access_token.trim().is_empty() {
        return Err("sign in to Kimi Code");
    }
    Ok((base, token))
}

fn source(managed: &Managed) -> Result<(&'static str, &str), &'static str> {
    // Never forward a token to a configured third-party server or a redirect.
    let base = match managed.base_url.as_deref().unwrap_or(CHINA_BASE).trim_end_matches('/') {
        CHINA_BASE => CHINA_BASE,
        GLOBAL_BASE => GLOBAL_BASE,
        _ => return Err("Kimi profile lookup requires an official Kimi endpoint"),
    };
    if managed.oauth.storage.as_deref().is_some_and(|s| s != "file") {
        return Err("this Kimi credential storage is not supported");
    }
    let name = managed.oauth.key.strip_prefix("oauth/").unwrap_or(&managed.oauth.key);
    if name.is_empty()
        || name.starts_with('.')
        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    {
        return Err("Kimi credential reference was not recognized");
    }
    Ok((base, name))
}

fn plan(home: &Path) -> Result<String, &'static str> {
    let (base, token) = login(home)?;
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .http_status_as_error(false)
        .max_redirects(0)
        .user_agent("astrolabe")
        .build()
        .new_agent();
    let mut response = agent
        .get(format!("{base}/me"))
        .header("Authorization", format!("Bearer {}", token.access_token))
        .header("Accept", "application/json")
        .call()
        .map_err(|_| "Kimi profile could not be reached")?;
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err("Kimi profile access was refused; check the Kimi Code sign-in"),
        _ => return Err("Kimi profile is temporarily unavailable"),
    }
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_string()
        .map_err(|_| "Kimi profile response could not be read")?;
    parse_plan(&body)
}

fn parse_plan(body: &str) -> Result<String, &'static str> {
    // Discard all profile fields other than the subscription name, including
    // identity/contact details. Do not infer a tier from a numeric user level.
    let profile: Profile = serde_json::from_str(body).map_err(|_| "Kimi did not report a subscription name")?;
    let name = profile.user_level_name.trim();
    if name.is_empty() || name.chars().count() > 128 || name.chars().any(char::is_control) {
        return Err("Kimi did not report a subscription name");
    }
    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::{Provider, Status, Window};

    #[test]
    fn uses_reported_subscription_name_without_guessing_from_level() {
        assert_eq!(
            parse_plan(r#"{"user_level_name":" Allegretto ","user_level":10,"email":"ignored"}"#).unwrap(),
            "Allegretto"
        );
        assert_eq!(parse_plan(r#"{"user_level_name":"Future plan"}"#).unwrap(), "Future plan");
        for body in [r#"{"user_level":10}"#, r#"{"user_level_name":""}"#, r#"{"user_level_name":"A\nB"}"#, "not json"] {
            assert!(parse_plan(body).is_err());
        }
    }

    #[test]
    fn profile_failure_preserves_usage_and_success_sets_the_tier() {
        let mut limit = Limit::ok(Provider::Kimi, "", "From /usage", vec![Window::new("Weekly", 20.0, None)]);
        let windows = limit.windows.clone();
        apply_plan(&mut limit, Err("offline"));
        assert_eq!(limit.status, Status::Ok);
        assert_eq!(limit.windows, windows);
        assert!(limit.account.is_empty());
        assert!(limit.detail.contains("subscription level unavailable: offline"));
        apply_plan(&mut limit, Ok("Allegretto".into()));
        assert_eq!(limit.account, "Allegretto");
    }

    #[test]
    fn follows_configured_region_and_credential_slot() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".kimi-code");
        std::fs::create_dir_all(dir.join("credentials")).unwrap();
        std::fs::write(
            dir.join("config.toml"),
            r#"
            [providers."managed:kimi-code"]
            base_url = "https://api.kimi.ai/coding/v1/"
            oauth = {storage = "file", key = "oauth/kimi-code-env-fixture"}
        "#,
        )
        .unwrap();
        std::fs::write(
            dir.join("credentials/kimi-code-env-fixture.json"),
            r#"{"access_token":"selected","refresh_token":"ignored"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("credentials/kimi-code.json"), r#"{"access_token":"wrong-account"}"#).unwrap();
        let (base, token) = login(home.path()).unwrap();
        assert_eq!(base, GLOBAL_BASE);
        assert_eq!(token.access_token, "selected");
    }

    #[test]
    fn refuses_untrusted_destinations_and_credential_paths() {
        let mut managed = Managed { base_url: None, oauth: OAuth { storage: None, key: "oauth/kimi-code".into() } };
        assert_eq!(source(&managed).unwrap(), (CHINA_BASE, "kimi-code"));
        for base in ["http://api.kimi.ai/coding/v1", "https://api.kimi.ai.evil.test/coding/v1", "https://example.com"] {
            managed.base_url = Some(base.into());
            assert!(source(&managed).is_err());
        }
        managed.base_url = None;
        for key in ["", "oauth/", "oauth/../other", "/var/key", "oauth/a/b", "oauth/.hidden"] {
            managed.oauth.key = key.into();
            assert!(source(&managed).is_err());
        }
        managed.oauth.key = "oauth/kimi-code".into();
        managed.oauth.storage = Some("keyring".into());
        assert!(source(&managed).is_err());
    }
}
