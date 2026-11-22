//! Mistral Vibe's organization-wide monthly budget, using its read-only API.
//! The official CLI uses these routes in `vibe/app_server/_billing.py`:
//! https://github.com/mistralai/mistral-vibe/blob/main/vibe/app_server/_billing.py
//! Credentials go only to the fixed Mistral origin, with redirects disabled.

use std::{io::Read, path::Path, time::Duration};

use serde::Deserialize;

use crate::agents::model::{Limit, Provider, Status, Window};

pub const EVERY: Duration = Duration::from_secs(120);
const BUDGET_URL: &str = "https://api.mistral.ai/v1/billing/budget";
const SUBSCRIPTION_URL: &str = "https://api.mistral.ai/v1/billing/subscription";
const MAX_BYTES: u64 = 1_048_576;

#[derive(Deserialize)]
struct Budget {
    vibe_budget: Option<BudgetDetail>,
}

#[derive(Deserialize)]
struct BudgetDetail {
    usage_percentage: f64,
    initial_budget: f64,
    reset_at: Option<String>,
    payg_enabled: Option<bool>,
}

#[derive(Deserialize)]
struct Subscription {
    plan_name: String,
    vibe_payg_enabled: Option<bool>,
}

/// Match Vibe's documented environment, then `~/.vibe/.env` precedence.
/// The remaining OS keyring source is deliberately left to Vibe itself.
pub fn configured_key(home: &Path) -> Option<String> {
    if let Ok(key) = std::env::var("MISTRAL_API_KEY")
        && valid_key(&key)
    {
        return Some(key.trim().to_owned());
    }
    let mut text = String::new();
    std::fs::File::open(home.join(".vibe/.env")).ok()?.take(MAX_BYTES + 1).read_to_string(&mut text).ok()?;
    if text.len() as u64 > MAX_BYTES {
        return None;
    }
    dotenv_key(&text)
}

fn valid_key(key: &str) -> bool {
    let key = key.trim();
    !key.is_empty() && !key.chars().any(|ch| ch.is_control() || ch.is_whitespace())
}

fn dotenv_key(text: &str) -> Option<String> {
    let mut selected = None;
    for line in text.lines() {
        let line = line.trim();
        let line = line.strip_prefix("export ").map(str::trim_start).unwrap_or(line);
        let Some((name, raw)) = line.split_once('=') else { continue };
        if name.trim() != "MISTRAL_API_KEY" {
            continue;
        }
        let raw = raw.trim();
        let value = if raw.starts_with(['\'', '"']) {
            let quote = raw.chars().next()?;
            let Some(end) = raw[1..].find(quote).map(|i| i + 1) else { continue };
            let suffix = raw[end + 1..].trim_start();
            if !suffix.is_empty() && !suffix.starts_with('#') {
                continue;
            }
            &raw[1..end]
        } else {
            // In dotenv syntax an unquoted comment starts after whitespace.
            raw.split_once(" #").map(|(value, _)| value.trim_end()).unwrap_or(raw)
        };
        // Do not approximate python-dotenv's interpolation or escape rules.
        // A plain API key needs neither; ambiguous syntax requires Settings.
        if valid_key(value) && !value.contains(['\\', '$', '\'', '"']) {
            selected = Some(value.to_owned());
        } else {
            selected = None;
        }
    }
    selected
}

/// The caller supplies an explicitly configured or safely discovered API key.
/// Refresh never starts Vibe, generates a prompt, or reads the OS keyring.
pub fn check(key: Option<&str>) -> Limit {
    let Some(key) = key.map(str::trim).filter(|k| !k.is_empty()) else {
        return Limit::new(
            Provider::Mistral,
            Status::Setup,
            "Add a Mistral API key in Settings with permission to view organization inference usage",
        );
    };
    if !valid_key(key) {
        return Limit::new(Provider::Mistral, Status::Setup, "Replace the Mistral API key in Settings");
    }
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .http_status_as_error(false)
        .max_redirects(0)
        .user_agent("agent-monitor")
        .build()
        .new_agent();
    let body = match request(&agent, BUDGET_URL, key) {
        Ok(body) => body,
        Err(limit) => return limit,
    };
    let mut limit = parse(&body, None);
    if limit.status != Status::Ok {
        return limit;
    }
    // The quota remains useful when the optional subscription request fails.
    if let Ok(subscription) = request(&agent, SUBSCRIPTION_URL, key) {
        limit = parse(&body, Some(&subscription));
    }
    limit
}

fn request(agent: &ureq::Agent, url: &'static str, key: &str) -> Result<String, Limit> {
    let mut response = agent
        .get(url)
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .call()
        .map_err(|_| unavailable("Mistral billing could not be reached"))?;
    let status = response.status().as_u16();
    if let Some(limit) = status_error(status) {
        return Err(limit);
    }
    response
        .body_mut()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_string()
        .map_err(|_| unavailable("Mistral's billing response could not be read"))
}

fn status_error(status: u16) -> Option<Limit> {
    match status {
        200..300 => None,
        401 => {
            Some(Limit::new(Provider::Mistral, Status::Setup, "Mistral refused the API key; replace it in Settings"))
        }
        403 => Some(Limit::new(
            Provider::Mistral,
            Status::Setup,
            "Mistral requires the see_org_inference_usage permission to read the organization's budget",
        )),
        404 => Some(unavailable("Mistral does not expose a billing budget for this account")),
        _ => Some(unavailable("Mistral billing is temporarily unavailable")),
    }
}

fn unavailable(detail: &'static str) -> Limit {
    Limit::new(Provider::Mistral, Status::Unavailable, detail)
}

pub fn parse(body: &str, subscription: Option<&str>) -> Limit {
    let budget: Budget = match serde_json::from_str(body) {
        Ok(budget) => budget,
        Err(_) => return unavailable("Mistral returned an unreadable billing budget"),
    };
    let Some(budget) = budget.vibe_budget else {
        return unavailable("Mistral did not report a Vibe Code allowance for this organization");
    };
    if !budget.initial_budget.is_finite() || budget.initial_budget <= 0.0 {
        return unavailable("Mistral did not report a positive Vibe Code allowance for this organization");
    }
    if !budget.usage_percentage.is_finite() || budget.usage_percentage < 0.0 {
        return unavailable("Mistral did not report valid Vibe Code usage");
    }
    let subscription = subscription.and_then(|body| serde_json::from_str::<Subscription>(body).ok());
    let account = subscription
        .as_ref()
        .map(|subscription| subscription.plan_name.trim())
        .filter(|name| !name.is_empty() && name.chars().count() <= 128 && !name.chars().any(char::is_control))
        .unwrap_or("");
    let payg = budget.payg_enabled.or_else(|| subscription.as_ref().and_then(|s| s.vibe_payg_enabled));
    let detail = match payg {
        Some(true) => "From Mistral's organization Vibe Code budget; pay-as-you-go enabled",
        Some(false) => "From Mistral's organization Vibe Code budget; pay-as-you-go disabled",
        None => "From Mistral's organization Vibe Code budget",
    };
    let reset = budget
        .reset_at
        .as_deref()
        .and_then(|value| value.parse::<jiff::Timestamp>().ok())
        .map(|value| value.as_second() as f64);
    Limit::ok(
        Provider::Mistral,
        account,
        detail,
        vec![Window::new("Monthly · Vibe Code", budget.usage_percentage.min(100.0), reset)],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_mistral_dotenv_key_without_executing_or_interpolating() {
        for (text, expected) in [
            ("MISTRAL_API_KEY=plain", Some("plain")),
            (" export MISTRAL_API_KEY = 'quoted-key' # saved", Some("quoted-key")),
            ("MISTRAL_API_KEY=\"double-quoted\"", Some("double-quoted")),
            ("MISTRAL_API_KEY=key # comment", Some("key")),
            ("MISTRAL_API_KEY=key#literal", Some("key#literal")),
            ("OTHER_KEY=ignored\n# MISTRAL_API_KEY=commented", None),
            ("MISTRAL_API_KEY=first\nMISTRAL_API_KEY=last", Some("last")),
            ("MISTRAL_API_KEY=first\nMISTRAL_API_KEY=", None),
            ("MISTRAL_API_KEY='unclosed", None),
            ("MISTRAL_API_KEY=\"key\"unexpected", None),
            ("MISTRAL_API_KEY=${OTHER_KEY}", None),
            ("MISTRAL_API_KEY=\"escaped\\nkey\"", None),
        ] {
            assert_eq!(dotenv_key(text).as_deref(), expected);
        }
    }

    #[test]
    fn reads_reported_organization_usage_reset_and_subscription() {
        let limit = parse(
            r#"{"vibe_budget":{"usage_percentage":23.5,"initial_budget":300,"reset_at":"2026-12-01T00:00:00Z"}}"#,
            Some(r#"{"plan_name":" Pro ","vibe_payg_enabled":true,"email":"ignored"}"#),
        );
        assert_eq!(limit.status, Status::Ok);
        assert_eq!(limit.account, "Pro");
        assert_eq!(limit.windows[0].name, "Monthly · Vibe Code");
        assert_eq!(limit.windows[0].used_pct, 23.5);
        assert_eq!(limit.windows[0].resets_at, Some(1796083200.0));
        assert!(limit.detail.ends_with("pay-as-you-go enabled"));
        assert!(!limit.detail.contains("ignored"));
    }

    #[test]
    fn retains_usage_without_subscription_or_reset_and_honors_budget_payg() {
        let body = r#"{"vibe_budget":{"usage_percentage":125,"initial_budget":300,"reset_at":"unknown","payg_enabled":false}}"#;
        let limit = parse(body, Some(r#"{"plan_name":"Future plan","vibe_payg_enabled":true}"#));
        assert_eq!(limit.account, "Future plan");
        assert_eq!(limit.windows[0].used_pct, 100.0);
        assert_eq!(limit.windows[0].resets_at, None);
        assert!(limit.detail.ends_with("pay-as-you-go disabled"));
        for subscription in [None, Some("not json"), Some(r#"{"plan_name":"A\nB"}"#)] {
            let limit = parse(body, subscription);
            assert_eq!(limit.status, Status::Ok);
            assert!(limit.account.is_empty());
        }
    }

    #[test]
    fn never_turns_missing_or_invalid_budget_into_unused_allowance() {
        for body in [
            "not json",
            "{}",
            r#"{"vibe_budget":null}"#,
            r#"{"api_budget":{"usage_percentage":10,"initial_budget":100}}"#,
            r#"{"vibe_budget":{"usage_percentage":0,"initial_budget":0}}"#,
            r#"{"vibe_budget":{"usage_percentage":0,"initial_budget":-10}}"#,
            r#"{"vibe_budget":{"usage_percentage":-1,"initial_budget":100}}"#,
            r#"{"vibe_budget":{"initial_budget":100}}"#,
            r#"{"vibe_budget":{"usage_percentage":"NaN","initial_budget":100}}"#,
        ] {
            let limit = parse(body, None);
            assert_eq!(limit.status, Status::Unavailable);
            assert!(limit.windows.is_empty());
            assert!(limit.account.is_empty());
        }
        let zero = parse(r#"{"vibe_budget":{"usage_percentage":0,"initial_budget":100}}"#, None);
        assert_eq!(zero.status, Status::Ok);
        assert_eq!(zero.windows[0].used_pct, 0.0);
    }

    #[test]
    fn setup_and_http_errors_are_actionable_without_response_content() {
        for key in [None, Some(""), Some("  "), Some("bad\nkey")] {
            let limit = check(key);
            assert_eq!(limit.status, Status::Setup);
            assert!(limit.windows.is_empty());
        }
        assert!(status_error(200).is_none());
        assert_eq!(status_error(401).unwrap().status, Status::Setup);
        let forbidden = status_error(403).unwrap();
        assert_eq!(forbidden.status, Status::Setup);
        assert!(forbidden.detail.contains("see_org_inference_usage"));
        for code in [302, 404, 429, 500] {
            assert_eq!(status_error(code).unwrap().status, Status::Unavailable);
        }
    }
}
