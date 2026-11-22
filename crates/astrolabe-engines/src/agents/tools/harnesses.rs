//! Inventory for Grok Build, Meta Muse Code and Qwen Code. No interactive
//! startup, browser authentication, model calls or protected Keychain reads.

use std::io::Read;

use super::*;

fn cli(env: &Env, id: &'static str, name: &'static str, provider: Provider, folder: &str) -> Agent {
    let mut a = blank(id, name, Kind::Cli, Some(provider));
    let Some(path) = find_command(env, id, &[env.home.join(folder)]) else { return a };
    locate(&mut a, path.clone());
    let real = a.target.as_deref().unwrap_or(&path);
    a.version = package_version(real)
        .or_else(|| folder_after(real, "Cellar", if id == "qwen" { "qwen-code" } else { id }))
        .or_else(|| name_version(real))
        .or_else(|| {
            if id == "grok" {
                if !env.run_status {
                    return None;
                }
                let text = run(env, &path, &["version"], &[])?;
                VERSION.find(&text).map(|m| m.as_str().to_owned())
            } else {
                run_version(env, &path)
            }
        });
    a
}

pub(super) fn grok(env: &Env) -> Agent {
    let mut a = cli(env, "grok", "Grok Build", Provider::Grok, ".grok/bin");
    if a.installed() {
        // Public installer documents scope -> {key: token} in auth.json.
        a.sign_in = saved_login(&env.home.join(".grok/auth.json"), |v| {
            ["https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828", "https://accounts.x.ai/sign-in"]
                .iter()
                .any(|scope| nonempty(&v[*scope]["key"]))
        });
    }
    a
}

pub(super) fn muse(env: &Env) -> Agent {
    let mut a = cli(env, "muse", "Meta Muse Code", Provider::Meta, ".muse/bin");
    if a.installed() {
        // The public auth guide documents login/logout, but no read-only
        // account-status command or stable credential schema. Do not guess.
        a.sign_in = SignIn::Unknown("Muse account status is not connected; sign in from Muse Code".into());
    }
    a
}

pub(super) fn qwen(env: &Env) -> Agent {
    let mut a = cli(env, "qwen", "Qwen Code", Provider::Qwen, ".qwen/bin");
    a.app = find_app(env, "Qwen Code.app");
    if a.installed() {
        a.sign_in = saved_login(&env.home.join(".qwen/oauth_creds.json"), |v| {
            nonempty(&v["access_token"]) || nonempty(&v["refresh_token"])
        });
        if a.sign_in == SignIn::SignedOut && has_content(&env.home.join(".qwen/settings.json")) {
            // Qwen can use a local model or API provider without Qwen OAuth.
            a.sign_in =
                SignIn::Unknown("No saved Qwen OAuth login; a local model or API provider may be configured".into());
        }
    }
    a
}

pub(super) fn nonempty(value: &serde_json::Value) -> bool {
    value.as_str().is_some_and(|v| !v.trim().is_empty())
}

pub(super) fn saved_login(path: &Path, present: impl FnOnce(&serde_json::Value) -> bool) -> SignIn {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return SignIn::SignedOut,
        Err(_) => return SignIn::Unknown("Saved login could not be read".into()),
    };
    let mut bytes = Vec::new();
    if file.take(65_537).read_to_end(&mut bytes).is_err() || bytes.len() > 65_536 {
        return SignIn::Unknown("Saved login could not be read".into());
    }
    match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(value) if present(&value) => SignIn::SignedIn("Saved login".into()),
        Ok(_) => SignIn::SignedOut,
        Err(_) => SignIn::Unknown("Saved login format was not recognized".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{fixture, get, script};
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn discovers_native_and_npm_installs_without_starting_login() {
        let mut f = fixture();
        f.env.run_status = true;
        for id in ["grok", "muse"] {
            script(
                &f.env.home.join(format!(".{id}/bin/{id}")),
                &format!(
                    "case \"$1\" in {}) echo 'tool 1.2.3';; *) exit 99;; esac",
                    if id == "grok" { "version" } else { "--version" }
                ),
            );
        }
        let pkg = f.root.join("lib/node_modules/@qwen-code/qwen-code");
        fs::create_dir_all(pkg.join("dist")).unwrap();
        fs::write(pkg.join("package.json"), r#"{"version":"0.27.3"}"#).unwrap();
        script(&pkg.join("dist/index.js"), "exit 99");
        symlink(pkg.join("dist/index.js"), f.root.join("bin/qwen")).unwrap();
        let agents = detect(&f.env);
        assert_eq!(get(&agents, "grok").version.as_deref(), Some("1.2.3"));
        assert_eq!(get(&agents, "muse").version.as_deref(), Some("1.2.3"));
        assert_eq!(get(&agents, "qwen").version.as_deref(), Some("0.27.3"));
        assert_eq!(get(&agents, "grok").sign_in, SignIn::SignedOut);
        assert!(matches!(get(&agents, "muse").sign_in, SignIn::Unknown(_)));
        assert_eq!(get(&agents, "qwen").sign_in, SignIn::SignedOut);
    }

    #[test]
    fn empty_and_unreadable_credentials_are_not_signed_in_or_exposed() {
        let f = fixture();
        script(&f.root.join("bin/grok"), "exit 99");
        script(&f.root.join("bin/qwen"), "exit 99");
        for (id, file, body) in [
            (
                "grok",
                ".grok/auth.json",
                r#"{"https://accounts.x.ai/sign-in":{"key":"fixture-secret"},"email":"redacted-contact-value"}"#,
            ),
            ("qwen", ".qwen/oauth_creds.json", r#"{"access_token":"fixture-secret","email":"redacted-contact-value"}"#),
        ] {
            let path = f.env.home.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, "{}").unwrap();
            assert_eq!(get(&detect(&f.env), id).sign_in, SignIn::SignedOut);
            fs::write(&path, body).unwrap();
            let a = detect(&f.env);
            assert!(matches!(get(&a, id).sign_in, SignIn::SignedIn(_)));
            assert!(!format!("{a:?}").contains("fixture-secret"));
            assert!(!format!("{a:?}").contains("redacted-contact-value"));
            fs::write(&path, "invalid").unwrap();
            assert!(matches!(get(&detect(&f.env), id).sign_in, SignIn::Unknown(_)));
        }
    }
}
