//! Official Mistral, MiniMax, Xiaomi and Tencent harness inventory. Only
//! documented version flags run; account checks never start a login flow or
//! read the Keychain. Saved credentials indicate presence, not validity.

use super::*;

fn cli(env: &Env, id: &'static str, name: &'static str, provider: Provider, folders: &[PathBuf]) -> Agent {
    let mut a = blank(id, name, Kind::Cli, Some(provider));
    let Some(path) = find_command(env, id, folders) else { return a };
    locate(&mut a, path.clone());
    let real = a.target.as_deref().unwrap_or(&path);
    a.version = package_version(real).or_else(|| name_version(real)).or_else(|| run_version(env, &path));
    a
}

pub(super) fn vibe(env: &Env) -> Agent {
    // https://docs.mistral.ai/vibe/code/cli/install-setup
    // uv's standard tool executable directory is already in bin_dirs.
    let mut a = cli(env, "vibe", "Mistral Vibe", Provider::Mistral, &[]);
    if a.installed() {
        a.sign_in = if crate::agents::limits::mistral::configured_key(&env.home).is_some() {
            SignIn::SignedIn("API key configured".into())
        } else {
            SignIn::Unknown("Check your account in Vibe; saved keys may be in the OS keyring".into())
        };
    }
    a
}

pub(super) fn mcode(env: &Env) -> Agent {
    // https://github.com/MiniMax-AI/minimax-code#quick-start
    let mut a = cli(env, "mcode", "MiniMax Code CLI", Provider::MiniMax, &[env.home.join(".minimax-code/bin")]);
    a.app = find_app(env, "MiniMax Code.app");
    if a.installed() {
        a.sign_in = minimax_account();
    }
    a
}

fn minimax_account() -> SignIn {
    // /status is an interactive TUI command. Do not infer login from a
    // config file, or start the TUI to obtain account status.
    SignIn::Unknown("Check your account with /status in MiniMax Code".into())
}

pub(super) fn minimax_desktop(env: &Env) -> Agent {
    // https://github.com/MiniMax-AI/homebrew-tap/blob/main/Casks/minimax-code.rb
    desktop(env, "MiniMax Code", "MiniMax Code", "MiniMax Code.app", Provider::MiniMax, minimax_account())
}

pub(super) fn mimo(env: &Env) -> Agent {
    // https://github.com/XiaomiMiMo/MiMo-Code/blob/main/install
    // The release archives are named mimocode, but install `bin/mimo`.
    let mut a = cli(env, "mimo", "Xiaomi MiMo Code", Provider::Xiaomi, &[env.home.join(".mimocode/bin")]);
    if a.installed() {
        a.sign_in = mimo_account(&crate::agents::paths::mimo_auth_paths(&env.home));
    }
    a
}

fn mimo_account(paths: &[PathBuf]) -> SignIn {
    // Verified in packages/cli/src/auth/index.ts and
    // packages/cli/src/provider/xiaomi-family.ts in XiaomiMiMo/MiMo-Code.
    // Other providers may be configured in the same file, so only Xiaomi
    // family API entries establish a saved Xiaomi login.
    let path = paths.iter().find(|path| fs::symlink_metadata(path).is_ok());
    let Some(path) = path else {
        return SignIn::Unknown("No saved Xiaomi login found; another provider may be configured in MiMo Code".into());
    };
    match harnesses::saved_login(path, |v| {
        ["xiaomi", "xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp"]
            .iter()
            .any(|id| v[*id]["type"] == "api" && harnesses::nonempty(&v[*id]["key"]))
    }) {
        SignIn::SignedOut => {
            SignIn::Unknown("No saved Xiaomi login found; another provider may be configured in MiMo Code".into())
        }
        status => status,
    }
}

pub(super) fn codebuddy(env: &Env) -> Agent {
    // https://www.codebuddy.ai/docs/cli/installation
    let mut a = cli(env, "codebuddy", "Tencent CodeBuddy Code", Provider::Tencent, &[]);
    a.app = find_app(env, "CodeBuddy.app");
    if a.installed() {
        a.sign_in = codebuddy_account();
    }
    a
}

fn codebuddy_account() -> SignIn {
    // https://www.codebuddy.ai/docs/cli/iam documents macOS Keychain
    // storage, with no supported account-status command.
    SignIn::Unknown("Check your account in CodeBuddy; credentials are managed by CodeBuddy".into())
}

pub(super) fn codebuddy_desktop(env: &Env) -> Agent {
    // https://www.codebuddy.ai/docs/ide/Support/Troubleshooting
    desktop(env, "CodeBuddy", "Tencent CodeBuddy IDE", "CodeBuddy.app", Provider::Tencent, codebuddy_account())
}

fn desktop(env: &Env, id: &'static str, name: &'static str, bundle: &str, provider: Provider, status: SignIn) -> Agent {
    let mut a = blank(id, name, Kind::App, Some(provider));
    if let Some(app) = find_app(env, bundle) {
        a.version = plist_version(&app);
        a.path = Some(app.clone());
        a.app = Some(app);
        a.sign_in = status;
    }
    a
}

#[cfg(test)]
mod tests {
    use super::super::tests::{fixture, get, script};
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn official_native_paths_probe_versions_without_starting_the_harness() {
        let mut f = fixture();
        f.env.run_status = true;
        for path in [
            f.root.join("bin/vibe"),
            f.env.home.join(".minimax-code/bin/mcode"),
            f.env.home.join(".mimocode/bin/mimo"),
            f.root.join("bin/codebuddy"),
        ] {
            script(&path, "case \"$1\" in --version) echo 'tool 1.2.3';; *) touch harness-started; exit 99;; esac");
        }
        fs::create_dir_all(f.env.home.join(".vibe")).unwrap();
        fs::write(f.env.home.join(".vibe/.env"), "MISTRAL_API_KEY='fixture-secret'\n").unwrap();
        let agents = detect(&f.env);
        for id in ["vibe", "mcode", "mimo", "codebuddy"] {
            assert_eq!(get(&agents, id).version.as_deref(), Some("1.2.3"));
            if id != "vibe" {
                assert!(matches!(get(&agents, id).sign_in, SignIn::Unknown(_)));
            }
        }
        assert_eq!(get(&agents, "vibe").sign_in, SignIn::SignedIn("API key configured".into()));
        assert!(!format!("{agents:?}").contains("fixture-secret"));
        assert!(!f.env.probe.join("harness-started").exists());
    }

    #[test]
    fn npm_versions_are_read_without_running_the_cli() {
        let f = fixture();
        for (id, package) in
            [("mcode", "@minimax-ai/code"), ("codebuddy", "@tencent-ai/codebuddy-code"), ("mimo", "@mimo-ai/cli")]
        {
            let pkg = f.root.join("lib/node_modules").join(package);
            fs::create_dir_all(pkg.join("bin")).unwrap();
            fs::write(pkg.join("package.json"), r#"{"version":"0.7.2"}"#).unwrap();
            script(&pkg.join("bin/cli.js"), "exit 99");
            symlink(pkg.join("bin/cli.js"), f.root.join("bin").join(id)).unwrap();
        }
        let agents = detect(&f.env);
        for id in ["mcode", "codebuddy", "mimo"] {
            assert_eq!(get(&agents, id).version.as_deref(), Some("0.7.2"));
        }
    }

    #[test]
    fn credentials_require_a_verified_xiaomi_field_and_are_never_exposed() {
        let f = fixture();
        let path = f.root.join("auth.json");
        for body in
            ["{}", r#"{"xiaomi":{"type":"api","key":" "}}"#, r#"{"anthropic":{"type":"api","key":"fixture-secret"}}"#]
        {
            fs::write(&path, body).unwrap();
            assert!(matches!(mimo_account(std::slice::from_ref(&path)), SignIn::Unknown(_)));
        }
        fs::write(
            &path,
            r#"{"xiaomi-token-plan-cn":{"type":"api","key":"fixture-secret","email":"redacted-contact-value"}}"#,
        )
        .unwrap();
        let status = mimo_account(std::slice::from_ref(&path));
        assert_eq!(status, SignIn::SignedIn("Saved login".into()));
        assert!(!format!("{status:?}").contains("fixture-secret"));
        assert!(!format!("{status:?}").contains("redacted-contact-value"));
        fs::write(&path, "invalid").unwrap();
        assert!(matches!(mimo_account(std::slice::from_ref(&path)), SignIn::Unknown(_)));
        fs::write(&path, vec![b'x'; 65_537]).unwrap();
        assert!(matches!(mimo_account(&[path]), SignIn::Unknown(_)));
    }

    #[test]
    fn desktop_bundles_are_detected_independently_of_cli_installation() {
        let f = fixture();
        for bundle in ["MiniMax Code.app", "CodeBuddy.app"] {
            let app = f.env.app_dirs[0].join(bundle);
            fs::create_dir_all(app.join("Contents")).unwrap();
            let mut dict = plist::Dictionary::new();
            dict.insert("CFBundleShortVersionString".into(), plist::Value::String("3.1.0".into()));
            plist::Value::Dictionary(dict).to_file_xml(app.join("Contents/Info.plist")).unwrap();
        }
        let agents = detect(&f.env);
        for id in ["MiniMax Code", "CodeBuddy"] {
            let a = get(&agents, id);
            assert!(a.installed());
            assert_eq!(a.kind, Kind::App);
            assert_eq!(a.version.as_deref(), Some("3.1.0"));
            assert!(matches!(a.sign_in, SignIn::Unknown(_)));
        }
        assert!(!get(&agents, "mcode").installed());
        assert!(!get(&agents, "codebuddy").installed());
    }
}
