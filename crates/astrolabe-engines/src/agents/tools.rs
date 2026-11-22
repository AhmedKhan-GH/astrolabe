//! Which agent tools are on this Mac: where each lives, its version, and
//! whether it is signed in, where that can be seen without spending quota.
//!
//! Contract with the rest of the crate (keep these signatures):
//!
//! - `Env::real()`: the real home folder, command folders and app folders.
//! - `detect(&env) -> Vec<Agent>`: every known tool, installed or not, in a
//!   fixed order.
//!
//! Sign-in is read from a tool's status command or credential presence.
//! ZCode checks only its sign-in fields. No token or key is ever kept here.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;

use super::model::Provider;
use super::{paths, pty, zcode};

mod additional;
mod harnesses;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Cli,
    App,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignIn {
    /// Signed in; the plain word says how or to which plan, such as "ChatGPT"
    /// or "Max", and may be empty.
    SignedIn(String),
    SignedOut,
    /// The tool has no account, such as Ollama.
    NotNeeded,
    /// It cannot be seen without spending quota or reading a secret; the
    /// text says why.
    Unknown(String),
}

/// One agent tool.
#[derive(Clone, Debug, PartialEq)]
pub struct Agent {
    /// The command or app name, such as `claude` or `ZCode`.
    pub id: &'static str,
    /// What it is, in a few words, such as "Claude Code".
    pub name: &'static str,
    pub kind: Kind,
    pub provider: Option<Provider>,
    /// Where it was found: the command on a search folder, or the `.app`.
    pub path: Option<PathBuf>,
    /// Where `path` leads when it is a link.
    pub target: Option<PathBuf>,
    pub version: Option<String>,
    /// An app bundle whose icon stands for the tool in its tile.
    pub app: Option<PathBuf>,
    pub sign_in: SignIn,
}

impl Agent {
    pub fn installed(&self) -> bool {
        self.path.is_some()
    }
}

/// Where to look.
#[derive(Clone, Debug)]
pub struct Env {
    pub home: PathBuf,
    /// Folders searched for commands, in order.
    pub bin_dirs: Vec<PathBuf>,
    /// Folders searched for `.app` bundles, in order.
    pub app_dirs: Vec<PathBuf>,
    /// The empty folder status commands run in.
    pub probe: PathBuf,
    /// Whether status commands may run; off in tests.
    pub run_status: bool,
}

impl Env {
    pub fn real() -> Env {
        let home = paths::home();
        Env {
            bin_dirs: paths::bin_dirs(&home),
            app_dirs: vec![PathBuf::from("/Applications"), home.join("Applications")],
            probe: paths::probe_dir(),
            run_status: true,
            home,
        }
    }

    /// The real places, with status commands run in `probe`.
    pub fn real_with_probe(probe: PathBuf) -> Env {
        Env { probe, ..Env::real() }
    }
}

static VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+\.\d+\.\d+[\w.-]*").unwrap());
static WHOLE_VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+\.\d+\.\d+[\w.-]*$").unwrap());

const STATUS_TIMEOUT: Duration = Duration::from_secs(10);

/// Every known tool, in a fixed order, installed or not.
pub fn detect(env: &Env) -> Vec<Agent> {
    let zcode_app = find_app(env, "ZCode.app");
    let antigravity_app = find_app(env, "Antigravity.app");
    vec![
        claude(env),
        codex(env),
        kimi(env),
        zcode_desktop(env, zcode_app.clone()),
        zcode_cli(env, zcode_app),
        antigravity_desktop(env, antigravity_app.clone()),
        agy(env, antigravity_app),
        gemini(env),
        harnesses::grok(env),
        harnesses::muse(env),
        harnesses::qwen(env),
        additional::vibe(env),
        additional::mcode(env),
        additional::minimax_desktop(env),
        additional::mimo(env),
        additional::codebuddy(env),
        additional::codebuddy_desktop(env),
        opencode(env),
        ollama(env),
    ]
}

fn blank(id: &'static str, name: &'static str, kind: Kind, provider: Option<Provider>) -> Agent {
    Agent {
        id,
        name,
        kind,
        provider,
        path: None,
        target: None,
        version: None,
        app: None,
        sign_in: SignIn::Unknown("not installed".to_owned()),
    }
}

/// Fill in `path` and `target` for a command found at `path`.
fn locate(agent: &mut Agent, path: PathBuf) {
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        agent.target = fs::canonicalize(&path).ok();
    }
    agent.path = Some(path);
}

fn find_app(env: &Env, name: &str) -> Option<PathBuf> {
    env.app_dirs.iter().map(|d| d.join(name)).find(|p| p.is_dir())
}

fn find_command(env: &Env, name: &str, extra: &[PathBuf]) -> Option<PathBuf> {
    let mut dirs = env.bin_dirs.clone();
    dirs.extend(extra.iter().cloned());
    pty::which(name, &dirs)
}

/// A file that exists and is not empty. Its content is never read.
fn has_content(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() > 0)
}

/// The version in an app bundle's `Info.plist`.
pub fn plist_version(app: &Path) -> Option<String> {
    let value = plist::Value::from_file(app.join("Contents/Info.plist")).ok()?;
    let text = value.as_dictionary()?.get("CFBundleShortVersionString")?.as_string()?.trim().to_owned();
    (!text.is_empty()).then_some(text)
}

/// The `version` of the first `package.json` above `target`, not leaving the
/// `node_modules` folder the tool is installed in.
fn package_version(target: &Path) -> Option<String> {
    #[derive(Deserialize)]
    struct Package {
        version: Option<String>,
    }
    for dir in target.ancestors().skip(1) {
        if dir.file_name().is_some_and(|n| n == "node_modules") {
            break;
        }
        if let Ok(raw) = fs::read(dir.join("package.json")) {
            return serde_json::from_slice::<Package>(&raw).ok()?.version.filter(|v| !v.is_empty());
        }
    }
    None
}

/// The folder name after `<first>/<second>` in a path, such as the version
/// folder in `Caskroom/codex/0.167.1/codex`.
fn folder_after(target: &Path, first: &str, second: &str) -> Option<String> {
    let parts: Vec<_> = target.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    parts.windows(3).find(|w| w[0] == first && w[1] == second).map(|w| w[2].clone()).filter(|v| VERSION.is_match(v))
}

/// The `.app` folder that contains `target`.
fn enclosing_app(target: &Path) -> Option<PathBuf> {
    target.ancestors().skip(1).find(|p| p.extension().is_some_and(|e| e == "app")).map(Path::to_path_buf)
}

/// Run a command in the probe folder through the pseudo-terminal runner.
fn run(env: &Env, program: &Path, args: &[&str], extra: &[(&str, &str)]) -> Option<String> {
    let vars = pty::env(&env.home, extra);
    pty::run_status(program, args, &vars, &env.probe, STATUS_TIMEOUT).ok().map(|(_, text)| text)
}

/// The version printed by `--version`.
fn run_version(env: &Env, program: &Path) -> Option<String> {
    if !env.run_status {
        return None;
    }
    let text = run(env, program, &["--version"], &[])?;
    VERSION.find(&text).map(|m| m.as_str().to_owned())
}

/// The file name of the target when it is itself a version.
fn name_version(target: &Path) -> Option<String> {
    let name = target.file_name()?.to_string_lossy().into_owned();
    WHOLE_VERSION.is_match(&name).then_some(name)
}

fn unknown_off() -> SignIn {
    SignIn::Unknown("status commands are off".to_owned())
}

fn file_sign_in(path: &Path, how: &str) -> SignIn {
    if has_content(path) { SignIn::SignedIn(how.to_owned()) } else { SignIn::SignedOut }
}

fn claude(env: &Env) -> Agent {
    let mut a = blank("claude", "Claude Code", Kind::Cli, Some(Provider::Claude));
    a.app = find_app(env, "Claude.app");
    let Some(path) = find_command(env, "claude", &[]) else { return a };
    locate(&mut a, path.clone());
    let real = a.target.clone().unwrap_or_else(|| path.clone());
    a.version = name_version(&real).or_else(|| package_version(&real)).or_else(|| run_version(env, &path));
    a.sign_in = if env.run_status { claude_sign_in(env, &path) } else { unknown_off() };
    a
}

/// `claude auth status` prints JSON that also holds the email and the
/// organisation; only the two fields below are deserialized.
fn claude_sign_in(env: &Env, path: &Path) -> SignIn {
    #[derive(Deserialize)]
    struct Status {
        #[serde(rename = "loggedIn")]
        logged_in: Option<bool>,
        #[serde(rename = "subscriptionType")]
        subscription_type: Option<String>,
    }
    let extra = [("DISABLE_AUTOUPDATER", "1"), ("CLAUDE_CODE_SKIP_PROMPT_HISTORY", "1")];
    let Some(text) = run(env, path, &["auth", "status"], &extra) else {
        return SignIn::Unknown("the status command did not run".to_owned());
    };
    let json = match (text.find('{'), text.rfind('}')) {
        (Some(a), Some(b)) if a < b => &text[a..=b],
        _ => return SignIn::Unknown("the status command printed no JSON".to_owned()),
    };
    match serde_json::from_str::<Status>(json) {
        Ok(Status { logged_in: Some(true), subscription_type }) => {
            let mut plan = subscription_type.unwrap_or_default();
            if let Some(first) = plan.get(..1) {
                plan = first.to_uppercase() + &plan[1..];
            }
            SignIn::SignedIn(plan)
        }
        Ok(Status { logged_in: Some(false), .. }) => SignIn::SignedOut,
        _ => SignIn::Unknown("the status was not readable".to_owned()),
    }
}

fn codex(env: &Env) -> Agent {
    let mut a = blank("codex", "Codex", Kind::Cli, Some(Provider::Codex));
    let Some(path) = find_command(env, "codex", &[]) else { return a };
    locate(&mut a, path.clone());
    let real = a.target.clone().unwrap_or_else(|| path.clone());
    a.version =
        folder_after(&real, "Caskroom", "codex").or_else(|| package_version(&real)).or_else(|| run_version(env, &path));
    a.sign_in = if !env.home.join(".codex/auth.json").is_file() {
        SignIn::SignedOut
    } else if !env.run_status {
        unknown_off()
    } else {
        match run(env, &path, &["login", "status"], &[]) {
            Some(t) if t.contains("Not logged in") => SignIn::SignedOut,
            Some(t) if t.contains("Logged in using ChatGPT") => SignIn::SignedIn("ChatGPT".to_owned()),
            Some(t) if t.contains("API key") => SignIn::SignedIn("API key".to_owned()),
            _ => SignIn::Unknown("the status was not readable".to_owned()),
        }
    };
    a
}

/// Read Kimi Code CLI sign-in from `kimi provider list`.
fn kimi(env: &Env) -> Agent {
    let mut a = blank("kimi", "Kimi Code CLI", Kind::Cli, Some(Provider::Kimi));
    let Some(path) = find_command(env, "kimi", &[env.home.join(".kimi-code/bin")]) else { return a };
    locate(&mut a, path.clone());
    a.version = run_version(env, &path);
    a.sign_in = if !env.run_status {
        unknown_off()
    } else {
        match run(env, &path, &["provider", "list"], &[]) {
            Some(t) if t.trim().is_empty() || t.contains("No providers configured") => SignIn::SignedOut,
            Some(_) => SignIn::SignedIn(String::new()),
            None => SignIn::Unknown("the status command did not run".to_owned()),
        }
    };
    a
}

fn zcode_sign_in(env: &Env) -> SignIn {
    match zcode::has_login(&env.home) {
        Ok(true) => SignIn::SignedIn(String::new()),
        Ok(false) => SignIn::SignedOut,
        Err(e) => SignIn::Unknown(e.into()),
    }
}

fn zcode_desktop(env: &Env, app: Option<PathBuf>) -> Agent {
    let mut a = blank("ZCode", "Z.ai's desktop app for GLM", Kind::App, Some(Provider::Glm));
    let Some(app) = app else { return a };
    a.version = plist_version(&app);
    a.app = Some(app.clone());
    a.path = Some(app);
    a.sign_in = zcode_sign_in(env);
    a
}

fn zcode_cli(env: &Env, app: Option<PathBuf>) -> Agent {
    let mut a = blank("zcode", "ZCode CLI", Kind::Cli, Some(Provider::Glm));
    a.app = app.clone();
    let command = find_command(env, "zcode", &[]);
    let from_bundle = command.is_none();
    let bundled = app.as_ref().map(|p| p.join("Contents/Resources/glm/zcode.cjs")).filter(|p| p.is_file());
    let Some(path) = command.or(bundled) else { return a };
    locate(&mut a, path);
    // The bundled CLI has its own version; the desktop version is not it.
    a.version = if from_bundle { None } else { app.as_deref().and_then(plist_version) };
    a.sign_in = zcode_sign_in(env);
    a
}

/// Sign-in for `agy` and the Antigravity app. Antigravity keeps it in the
/// login Keychain; only the exit status of the lookup is used.
fn antigravity_sign_in(env: &Env) -> SignIn {
    let google = || SignIn::SignedIn("Google".to_owned());
    if has_content(&env.home.join(".gemini/antigravity-cli/antigravity-oauth-token")) {
        return google();
    }
    if !env.run_status {
        return unknown_off();
    }
    // agy 1.5 keeps its sign-in under the service "gemini"; older builds and
    // the app used "Antigravity CLI".
    let found = ["gemini", "Antigravity CLI"].iter().any(|service| {
        Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", service])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    });
    if found { google() } else { SignIn::SignedOut }
}

fn antigravity_desktop(env: &Env, app: Option<PathBuf>) -> Agent {
    let mut a = blank("Antigravity", "Google's agent IDE", Kind::App, Some(Provider::Gemini));
    let Some(app) = app else { return a };
    a.version = plist_version(&app);
    a.app = Some(app.clone());
    a.path = Some(app);
    a.sign_in = antigravity_sign_in(env);
    a
}

fn agy(env: &Env, app: Option<PathBuf>) -> Agent {
    let mut a = blank("agy", "Antigravity CLI", Kind::Cli, Some(Provider::Gemini));
    a.app = app;
    let Some(path) = find_command(env, "agy", &[]) else { return a };
    locate(&mut a, path.clone());
    a.version = run_version(env, &path);
    a.sign_in = antigravity_sign_in(env);
    a
}

fn gemini(env: &Env) -> Agent {
    let mut a = blank("gemini", "Gemini CLI", Kind::Cli, Some(Provider::Gemini));
    let Some(path) = find_command(env, "gemini", &[]) else { return a };
    locate(&mut a, path.clone());
    let real = a.target.clone().unwrap_or_else(|| path.clone());
    a.version = package_version(&real)
        .or_else(|| folder_after(&real, "Cellar", "gemini-cli"))
        .or_else(|| run_version(env, &path));
    a.sign_in = file_sign_in(&env.home.join(".gemini/oauth_creds.json"), "Google");
    a
}

fn opencode(env: &Env) -> Agent {
    let mut a = blank("opencode", "OpenCode", Kind::Cli, None);
    a.app = find_app(env, "OpenCode.app");
    let bundled = a.app.as_ref().map(|app| app.join("Contents/Resources/opencode-cli")).filter(|p| p.is_file());
    if let Some(path) = find_command(env, "opencode", &[]) {
        locate(&mut a, path.clone());
        let real = a.target.clone().unwrap_or_else(|| path.clone());
        a.version = package_version(&real).or_else(|| run_version(env, &path));
    } else if let Some(cli) = bundled {
        a.version = fs::read_to_string(cli.with_file_name("opencode-cli.version"))
            .ok()
            .and_then(|t| VERSION.find(&t).map(|m| m.as_str().to_owned()));
        locate(&mut a, cli);
    } else {
        return a;
    }
    a.sign_in = file_sign_in(&env.home.join(".local/share/opencode/auth.json"), "");
    a
}

fn ollama(env: &Env) -> Agent {
    let mut a = blank("ollama", "Ollama", Kind::Cli, Some(Provider::Ollama));
    a.app = find_app(env, "Ollama.app");
    let Some(path) = find_command(env, "ollama", &[]) else { return a };
    locate(&mut a, path.clone());
    let real = a.target.clone().unwrap_or_else(|| path.clone());
    if let Some(app) = enclosing_app(&real) {
        a.version = plist_version(&app);
        a.app = Some(app);
    }
    a.version = a.version.take().or_else(|| run_version(env, &path));
    a.sign_in = SignIn::NotNeeded;
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};

    pub(super) struct Fixture {
        _dir: tempfile::TempDir,
        pub(super) root: PathBuf,
        pub(super) env: Env,
    }

    pub(super) fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for sub in ["home", "bin", "apps", "probe"] {
            fs::create_dir_all(root.join(sub)).unwrap();
        }
        let env = Env {
            home: root.join("home"),
            bin_dirs: vec![root.join("bin")],
            app_dirs: vec![root.join("apps")],
            probe: root.join("probe"),
            run_status: false,
        };
        Fixture { _dir: dir, root, env }
    }

    pub(super) fn script(path: &Path, body: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn app(apps: &Path, name: &str, version: &str) -> PathBuf {
        let app = apps.join(name);
        fs::create_dir_all(app.join("Contents")).unwrap();
        let mut dict = plist::Dictionary::new();
        dict.insert("CFBundleShortVersionString".into(), plist::Value::String(version.into()));
        plist::Value::Dictionary(dict).to_file_xml(app.join("Contents/Info.plist")).unwrap();
        app
    }

    pub(super) fn get<'a>(agents: &'a [Agent], id: &str) -> &'a Agent {
        agents.iter().find(|a| a.id == id).unwrap()
    }

    #[test]
    fn lists_every_tool_in_order_when_nothing_is_installed() {
        let f = fixture();
        let agents = detect(&f.env);
        let ids: Vec<_> = agents.iter().map(|a| a.id).collect();
        assert_eq!(
            ids,
            [
                "claude",
                "codex",
                "kimi",
                "ZCode",
                "zcode",
                "Antigravity",
                "agy",
                "gemini",
                "grok",
                "muse",
                "qwen",
                "vibe",
                "mcode",
                "MiniMax Code",
                "mimo",
                "codebuddy",
                "CodeBuddy",
                "opencode",
                "ollama"
            ]
        );
        assert!(agents.iter().all(|a| !a.installed() && a.path.is_none() && a.version.is_none()));
    }

    #[test]
    fn claude_version_comes_from_the_target_name() {
        let f = fixture();
        let target = f.root.join("share/claude/versions/1.2.3");
        script(&target, "exit 1");
        symlink(&target, f.root.join("bin/claude")).unwrap();
        app(&f.root.join("apps"), "Claude.app", "9.9.9");
        let a = detect(&f.env);
        let c = get(&a, "claude");
        assert_eq!(c.version.as_deref(), Some("1.2.3"));
        assert_eq!(c.path, Some(f.root.join("bin/claude")));
        assert_eq!(c.target, Some(target));
        assert_eq!(c.app, Some(f.root.join("apps/Claude.app")));
        assert!(matches!(c.sign_in, SignIn::Unknown(_)));
    }

    #[test]
    fn npm_installs_read_package_json() {
        let f = fixture();
        let pkg = f.root.join("lib/node_modules/@google/gemini-cli");
        fs::create_dir_all(pkg.join("dist")).unwrap();
        fs::write(pkg.join("package.json"), r#"{"name":"@google/gemini-cli","version":"0.5.1"}"#).unwrap();
        script(&pkg.join("dist/index.js"), "exit 1");
        symlink(pkg.join("dist/index.js"), f.root.join("bin/gemini")).unwrap();
        let a = detect(&f.env);
        assert_eq!(get(&a, "gemini").version.as_deref(), Some("0.5.1"));
    }

    #[test]
    fn homebrew_paths_give_versions() {
        let f = fixture();
        let cask = f.root.join("Caskroom/codex/0.167.1/codex");
        script(&cask, "exit 1");
        symlink(&cask, f.root.join("bin/codex")).unwrap();
        let cellar = f.root.join("Cellar/gemini-cli/0.7.2/bin/gemini");
        script(&cellar, "exit 1");
        symlink(&cellar, f.root.join("bin/gemini")).unwrap();
        let a = detect(&f.env);
        assert_eq!(get(&a, "codex").version.as_deref(), Some("0.167.1"));
        assert_eq!(get(&a, "gemini").version.as_deref(), Some("0.7.2"));
    }

    #[test]
    fn apps_read_plist_versions_and_zcode_wrapper_shares_it() {
        let f = fixture();
        app(&f.root.join("apps"), "ZCode.app", "3.4.5");
        app(&f.root.join("apps"), "Antigravity.app", "1.0.2");
        script(&f.root.join("bin/zcode"), "exit 1");
        let a = detect(&f.env);
        let z = get(&a, "ZCode");
        assert_eq!((z.kind, z.version.as_deref()), (Kind::App, Some("3.4.5")));
        assert_eq!(z.path, z.app);
        let w = get(&a, "zcode");
        assert_eq!(w.version.as_deref(), Some("3.4.5"));
        assert_eq!(w.app, Some(f.root.join("apps/ZCode.app")));
        assert_eq!(get(&a, "Antigravity").version.as_deref(), Some("1.0.2"));
    }

    #[test]
    fn zcode_bundled_cli_is_detected_without_a_path_wrapper() {
        let f = fixture();
        let app = app(&f.root.join("apps"), "ZCode.app", "3.18.2");
        let cli = app.join("Contents/Resources/glm/zcode.cjs");
        script(&cli, "exit 1");
        let agents = detect(&f.env);
        let a = get(&agents, "zcode");
        assert_eq!(a.path, Some(cli));
        assert_eq!(a.app, Some(app));
        assert_eq!(a.version, None);
        assert_eq!(a.sign_in, SignIn::SignedOut);
    }

    #[test]
    fn opencode_falls_back_to_the_bundled_cli() {
        let f = fixture();
        let app = app(&f.root.join("apps"), "OpenCode.app", "1.0.0");
        script(&app.join("Contents/Resources/opencode-cli"), "exit 1");
        fs::write(app.join("Contents/Resources/opencode-cli.version"), "1.14.2\n").unwrap();
        let a = detect(&f.env);
        let o = get(&a, "opencode");
        assert_eq!(o.path, Some(app.join("Contents/Resources/opencode-cli")));
        assert_eq!(o.version.as_deref(), Some("1.14.2"));
        assert_eq!(o.app, Some(app));
        assert_eq!(o.sign_in, SignIn::SignedOut);
    }

    #[test]
    fn ollama_inside_an_app_uses_its_version() {
        let f = fixture();
        let app = app(&f.root.join("apps"), "Ollama.app", "0.40.16");
        script(&app.join("Contents/Resources/ollama"), "exit 1");
        symlink(app.join("Contents/Resources/ollama"), f.root.join("bin/ollama")).unwrap();
        let a = detect(&f.env);
        let o = get(&a, "ollama");
        assert_eq!(o.version.as_deref(), Some("0.40.16"));
        assert_eq!(o.app, Some(app));
        assert_eq!(o.sign_in, SignIn::NotNeeded);
    }

    #[test]
    fn credential_presence_and_zcode_sign_in_fields() {
        let f = fixture();
        for name in ["gemini", "opencode", "zcode"] {
            script(&f.root.join("bin").join(name), "exit 1");
        }
        let signed = |f: &Fixture| {
            let a = detect(&f.env);
            ["gemini", "opencode", "zcode"].map(|id| get(&a, id).sign_in.clone())
        };
        assert_eq!(signed(&f), [SignIn::SignedOut, SignIn::SignedOut, SignIn::SignedOut]);
        let files = [".gemini/oauth_creds.json", ".local/share/opencode/auth.json", ".zcode/v2/credentials.json"];
        for file in files {
            let p = f.env.home.join(file);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, if file.contains(".zcode") { "{}" } else { "" }).unwrap();
        }
        assert_eq!(signed(&f), [SignIn::SignedOut, SignIn::SignedOut, SignIn::SignedOut]);
        for file in files {
            fs::write(
                f.env.home.join(file),
                if file.contains(".zcode") { r#"{"oauth:zai:access_token":"fixture"}"# } else { "x" },
            )
            .unwrap();
        }
        assert_eq!(
            signed(&f),
            [SignIn::SignedIn("Google".into()), SignIn::SignedIn(String::new()), SignIn::SignedIn(String::new())]
        );
    }

    #[test]
    fn agy_token_file_counts_and_codex_without_auth_is_signed_out() {
        let f = fixture();
        script(&f.root.join("bin/agy"), "exit 1");
        script(&f.root.join("bin/codex"), "echo codex-cli 0.1.0");
        let a = detect(&f.env);
        assert!(matches!(get(&a, "agy").sign_in, SignIn::Unknown(_)));
        assert_eq!(get(&a, "codex").sign_in, SignIn::SignedOut);
        let token = f.env.home.join(".gemini/antigravity-cli/antigravity-oauth-token");
        fs::create_dir_all(token.parent().unwrap()).unwrap();
        fs::write(&token, "t").unwrap();
        assert_eq!(get(&detect(&f.env), "agy").sign_in, SignIn::SignedIn("Google".into()));
    }

    #[test]
    fn status_commands_run_and_keep_no_account_details() {
        let mut f = fixture();
        f.env.run_status = true;
        script(
            &f.root.join("bin/codex"),
            r#"case "$1" in --version) echo "codex-cli 0.9.9";; login) echo "Logged in using ChatGPT";; esac"#,
        );
        let versions = f.root.join("share/versions/2.5.6");
        script(
            &versions,
            r#"echo '{"loggedIn":true,"email":"redacted-contact-value","orgName":"Acme","subscriptionType":"max"}'"#,
        );
        symlink(&versions, f.root.join("bin/claude")).unwrap();
        let auth = f.env.home.join(".codex/auth.json");
        fs::create_dir_all(auth.parent().unwrap()).unwrap();
        fs::write(&auth, "secret").unwrap();
        let a = detect(&f.env);
        let c = get(&a, "claude");
        assert_eq!(c.sign_in, SignIn::SignedIn("Max".into()));
        assert_eq!(c.version.as_deref(), Some("2.5.6"));
        let x = get(&a, "codex");
        assert_eq!(x.sign_in, SignIn::SignedIn("ChatGPT".into()));
        assert_eq!(x.version.as_deref(), Some("0.9.9"));
        let dump = format!("{a:?}");
        assert!(!dump.contains("redacted-contact-value") && !dump.contains("Acme"));
    }
}
