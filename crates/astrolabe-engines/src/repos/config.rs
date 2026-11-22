//! The settings file: its default text, parsing, loading and the questions
//! discovery and the watcher ask of it.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Deserialize;

use super::model::{Config, Ide, Override, Root};
use super::paths;

/// The settings file written on first run.
pub const DEFAULT_TOML: &str = r#"# Minutes between remote checks of each repository.
remote_check_minutes = 5

# Categories in display order.
categories = ["Products and tools", "Research", "Academic", "MCP servers", "Third party", "Company", "Creative"]

# Folder names never scanned or watched; * matches any run of characters.
skip_names = [
    "node_modules", "third_party", "target", "build", "cmake-build-*", "_build", "_deps", "dist",
    ".venv", "venv", "__pycache__", ".idea", ".gradle", ".next", ".cache", "DerivedData", "Pods",
    ".tox", ".mypy_cache", ".pytest_cache",
]

# Folders never scanned.
skip_paths = ["~/Library", "~/PycharmProjects/WelcomeScreen"]

# Exact repository paths removed from the monitor; their files are left alone.
removed_repos = []

# Scanned folders; app is omitted to infer it from the project files.
[[root]]
path = "~/CLionProjects"
app = "CLion"
category = "Products and tools"

[[root]]
path = "~/WebstormProjects"
app = "WebStorm"
category = "Products and tools"

[[root]]
path = "~/PycharmProjects"
app = "PyCharm"
category = "Products and tools"

[[root]]
path = "~/RustroverProjects"
app = "RustRover"
category = "Products and tools"

[[root]]
path = "~/GolandProjects"
app = "GoLand"
category = "Products and tools"

[[root]]
path = "~/Research"
category = "Research"

[[root]]
path = "~/Academic"
category = "Academic"

[[root]]
path = "~/MCPServers"
category = "MCP servers"
detect_third_party = false

[[root]]
path = "~/AppSources"
category = "Third party"
detect_third_party = false

[[root]]
path = "~/Company"
category = "Company"

[[root]]
path = "~/Creative"
category = "Creative"

# Per-repository override.
# [repo."~/CLionProjects/example-project"]
# category = "Research"
# app = "PyCharm"
"#;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConfig {
    remote_check_minutes: Option<u32>,
    categories: Option<Vec<String>>,
    skip_names: Option<Vec<String>>,
    skip_paths: Option<Vec<String>>,
    removed_repos: Option<Vec<String>>,
    root: Option<Vec<RawRoot>>,
    #[serde(default)]
    repo: BTreeMap<String, RawOverride>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRoot {
    path: String,
    app: Option<String>,
    category: String,
    detect_third_party: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOverride {
    category: Option<String>,
    app: Option<String>,
}

/// An `app` value: an IDE name, or `inferred` for none.
fn parse_app(app: Option<&str>) -> Result<Option<Ide>, String> {
    match app {
        None => Ok(None),
        Some(a) if a.trim().eq_ignore_ascii_case("inferred") => Ok(None),
        Some(a) => Ide::from_name(a).map(Some).ok_or_else(|| format!("unknown IDE name \"{a}\"")),
    }
}

/// Parse a settings file. A missing key is empty, except `remote_check_minutes`,
/// which is 5. An unknown key or IDE name is an error.
pub fn parse(text: &str) -> Result<Config, String> {
    let raw: RawConfig = toml::from_str(text).map_err(|e| e.to_string())?;
    let mut roots = Vec::new();
    for r in raw.root.unwrap_or_default() {
        roots.push(Root {
            path: paths::expand(&r.path),
            ide: parse_app(r.app.as_deref())?,
            category: r.category,
            detect_third_party: r.detect_third_party.unwrap_or(true),
        });
    }
    let mut overrides = Vec::new();
    for (key, o) in raw.repo {
        overrides.push((paths::expand(&key), Override { category: o.category, ide: parse_app(o.app.as_deref())? }));
    }
    let mut categories = raw.categories.unwrap_or_default();
    let used = roots.iter().map(|r| &r.category).chain(overrides.iter().filter_map(|(_, o)| o.category.as_ref()));
    for c in used.cloned().collect::<Vec<_>>() {
        if !categories.contains(&c) {
            categories.push(c);
        }
    }
    Ok(Config {
        roots,
        skip_names: raw.skip_names.unwrap_or_default(),
        skip_paths: raw.skip_paths.unwrap_or_default().iter().map(|p| paths::expand(p)).collect(),
        removed_repos: raw.removed_repos.unwrap_or_default().iter().map(|p| paths::expand(p)).collect(),
        categories,
        overrides,
        remote_check_minutes: raw.remote_check_minutes.unwrap_or(5),
    })
}

/// Read the settings file. A missing file is written with the defaults; a file
/// that cannot be read or parsed gives the defaults and the reason.
pub fn load(path: &Path) -> (Config, Option<String>) {
    match std::fs::read_to_string(path) {
        Ok(text) => match parse(&text) {
            Ok(config) => (config, None),
            Err(e) => (Config::defaults(), Some(format!("{}: {e}", path.display()))),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let written =
                path.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|()| std::fs::write(path, DEFAULT_TOML));
            let error = written.err().map(|e| format!("{}: could not write the default settings: {e}", path.display()));
            (Config::defaults(), error)
        }
        Err(e) => (Config::defaults(), Some(format!("{}: {e}", path.display()))),
    }
}

/// Persist one exact repository removal while retaining the user's settings and comments.
/// Only the settings file is written; the repository itself is never modified.
pub fn remove_repo(config_path: &Path, repo: &Path) -> Result<Config, String> {
    let save = || -> Result<Config, String> {
        let text = match std::fs::read_to_string(config_path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => DEFAULT_TOML.to_owned(),
            Err(e) => return Err(e.to_string()),
        };
        let before = parse(&text)?;
        if before.removes_repo(repo) {
            return Ok(before);
        }
        let repo = std::fs::canonicalize(repo).unwrap_or_else(|_| repo.to_owned());
        if !repo.is_absolute() {
            return Err("repository path must be absolute".into());
        }
        let repo = repo.to_str().ok_or("repository path is not valid UTF-8")?;
        let mut document: toml_edit::DocumentMut = text.parse().map_err(|e: toml_edit::TomlError| e.to_string())?;
        if document.get("removed_repos").is_none() {
            document["removed_repos"] = toml_edit::value(toml_edit::Array::new());
        }
        document["removed_repos"].as_array_mut().ok_or("removed_repos must be an array")?.push(repo);
        let updated = document.to_string();
        let config = parse(&updated)?;
        // Follow an existing config symlink rather than replacing it.
        let destination = match std::fs::canonicalize(config_path) {
            Ok(path) => path,
            Err(e) if std::fs::symlink_metadata(config_path).is_ok_and(|meta| meta.file_type().is_symlink()) => {
                return Err(format!("could not resolve settings symlink: {e}"));
            }
            Err(_) => config_path.to_owned(),
        };
        let permissions = match std::fs::metadata(&destination) {
            Ok(meta) => {
                if meta.permissions().readonly() {
                    return Err("settings file is read-only".into());
                }
                Some(meta.permissions())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        let parent = destination.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
        let (temporary, mut file) = loop {
            let name = format!(
                ".repo-monitor-config-{}-{}.tmp",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            );
            let temporary = parent.join(name);
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary) {
                Ok(file) => break (temporary, file),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.to_string()),
            }
        };
        let written = (|| {
            if let Some(permissions) = permissions {
                file.set_permissions(permissions)?;
            }
            file.write_all(updated.as_bytes())?;
            file.sync_all()?;
            std::fs::rename(&temporary, &destination)
        })();
        if let Err(e) = written {
            let _ = std::fs::remove_file(&temporary);
            return Err(e.to_string());
        }
        Ok(config)
    };
    save().map_err(|e| format!("{}: could not remove repository from monitor: {e}", config_path.display()))
}

/// Whether `name` matches `pattern`, where `*` stands for any run of characters.
pub fn name_matches(pattern: &str, name: &str) -> bool {
    let (p, n): (Vec<char>, Vec<char>) = (pattern.chars().collect(), name.chars().collect());
    let (mut pi, mut ni) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ni < n.len() {
        if pi < p.len() && p[pi] == '*' {
            star = Some((pi, ni));
            pi += 1;
        } else if pi < p.len() && p[pi] == n[ni] {
            pi += 1;
            ni += 1;
        } else if let Some((sp, sn)) = star {
            pi = sp + 1;
            ni = sn + 1;
            star = Some((sp, sn + 1));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

impl Config {
    /// The built-in settings, the same as [`DEFAULT_TOML`].
    pub fn defaults() -> Config {
        match parse(DEFAULT_TOML) {
            Ok(config) => config,
            Err(e) => unreachable!("the built-in settings do not parse: {e}"),
        }
    }

    /// Whether a folder of this name is never scanned or watched.
    pub fn skips_name(&self, name: &str) -> bool {
        self.skip_names.iter().any(|p| name_matches(p, name))
    }

    /// Whether the folder is a skipped path or inside one.
    pub fn skips_path(&self, path: &Path) -> bool {
        self.skip_paths.iter().any(|s| path.starts_with(s))
    }

    /// Whether this exact repository was removed, resolving aliases where possible.
    pub fn removes_repo(&self, path: &Path) -> bool {
        let canonical = std::fs::canonicalize(path).ok();
        self.removed_repos.iter().any(|removed| {
            removed == path
                || canonical
                    .as_ref()
                    .is_some_and(|c| removed == c || std::fs::canonicalize(removed).is_ok_and(|r| &r == c))
        })
    }

    /// The override of the repository at `path`, matched on the exact path
    /// (canonical where it can be).
    pub fn override_for(&self, path: &Path) -> Option<&Override> {
        let canonical = std::fs::canonicalize(path).ok();
        self.overrides
            .iter()
            .find(|(key, _)| {
                key == path
                    || canonical.as_ref().is_some_and(|c| c == key || std::fs::canonicalize(key).is_ok_and(|k| &k == c))
            })
            .map(|(_, o)| o)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::model::THIRD_PARTY;
    use std::path::PathBuf;

    fn home(p: &str) -> PathBuf {
        paths::home().join(p)
    }

    #[test]
    fn default_file_parses_to_the_defaults() {
        let c = Config::defaults();
        assert_eq!(c.remote_check_minutes, 5);
        assert_eq!(c.roots.len(), 11);
        assert_eq!(c.roots[0].path, home("CLionProjects"));
        assert_eq!(c.roots[0].ide, Some(Ide::CLion));
        assert_eq!(c.roots[3].ide, Some(Ide::RustRover));
        assert_eq!(c.roots[5].ide, None);
        assert_eq!(c.roots[5].category, "Research");
        assert!(c.roots[0].detect_third_party);
        assert!(!c.roots[7].detect_third_party);
        assert!(!c.roots[8].detect_third_party);
        assert_eq!(c.roots[8].category, THIRD_PARTY);
        assert_eq!(c.roots[9].path, home("Company"));
        assert_eq!(c.skip_names.len(), 20);
        assert!(c.skip_names.contains(&"cmake-build-*".to_owned()));
        assert_eq!(c.skip_paths, vec![home("Library"), home("PycharmProjects/WelcomeScreen")]);
        assert_eq!(c.categories.len(), 7);
        assert_eq!(c.categories[0], "Products and tools");
        assert!(c.overrides.is_empty());
    }

    #[test]
    fn matches_names_with_stars() {
        assert!(name_matches("cmake-build-*", "cmake-build-debug"));
        assert!(name_matches("cmake-build-*", "cmake-build-"));
        assert!(!name_matches("cmake-build-*", "build"));
        assert!(name_matches("*", "anything"));
        assert!(name_matches("a*c*e", "abcde"));
        assert!(!name_matches("a*c*e", "abcdf"));
        assert!(name_matches("target", "target"));
        assert!(!name_matches("target", "targets"));
    }

    #[test]
    fn skips_names_and_paths() {
        let c = Config::defaults();
        assert!(c.skips_name("node_modules"));
        assert!(c.skips_name("cmake-build-release"));
        assert!(!c.skips_name("src"));
        assert!(c.skips_path(&home("Library")));
        assert!(c.skips_path(&home("Library/Caches/x")));
        assert!(!c.skips_path(&home("LibraryX")));
        assert!(!c.skips_path(&home("PycharmProjects/other")));
    }

    #[test]
    fn reads_overrides_and_extends_categories() {
        let text = r#"
categories = ["A"]
[[root]]
path = "/r"
category = "B"
app = "inferred"
[repo."~/x"]
category = "C"
app = "goland"
"#;
        let c = parse(text).unwrap();
        assert_eq!(c.categories, ["A", "B", "C"]);
        assert_eq!(c.roots[0].ide, None);
        assert!(c.roots[0].detect_third_party);
        assert_eq!(c.overrides, vec![(home("x"), Override { category: Some("C".into()), ide: Some(Ide::GoLand) })]);
        assert_eq!(c.override_for(&home("x")).and_then(|o| o.ide), Some(Ide::GoLand));
        assert!(c.override_for(&home("y")).is_none());
    }

    #[test]
    fn unknown_ide_is_an_error() {
        let e = parse("[[root]]\npath = \"/r\"\ncategory = \"B\"\napp = \"Vim\"\n").unwrap_err();
        assert!(e.contains("Vim"), "{e}");
    }

    #[test]
    fn broken_file_names_its_line() {
        let e = parse("remote_check_minutes = 5\nskip_names = [\n[[root\n").unwrap_err();
        assert!(e.contains("line 3"), "{e}");
    }

    #[test]
    fn load_writes_the_default_file_and_reports_errors() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sub/config.toml");
        let (c, err) = load(&file);
        assert_eq!(err, None);
        assert_eq!(c, Config::defaults());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), DEFAULT_TOML);
        std::fs::write(&file, "oops = ").unwrap();
        let (c, err) = load(&file);
        assert_eq!(c, Config::defaults());
        assert!(err.unwrap().contains("line 1"));
    }

    #[test]
    fn removing_a_repo_preserves_settings_comments_and_repository_files() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("project");
        std::fs::create_dir(&repo).unwrap();
        std::fs::write(repo.join("keep.txt"), "work").unwrap();
        let file = dir.path().join("config.toml");
        let text = "# My settings\nremote_check_minutes = 12 # keep this\ncategories = ['Personal']\n\n[repo.\"/other\"]\ncategory = 'Personal'\n";
        std::fs::write(&file, text).unwrap();
        let c = remove_repo(&file, &repo).unwrap();
        assert!(c.removes_repo(&repo));
        assert!(!c.removes_repo(&repo.join("nested")));
        assert!(!c.removes_repo(&dir.path().join("project-other")));
        assert_eq!(c.remote_check_minutes, 12);
        assert_eq!(c.overrides.len(), 1);
        let saved = std::fs::read_to_string(&file).unwrap();
        assert!(saved.contains("# My settings"));
        assert!(saved.contains("remote_check_minutes = 12 # keep this"));
        assert!(saved.contains("[repo.\"/other\"]\ncategory = 'Personal'"));
        let (loaded, error) = load(&file);
        assert_eq!(error, None);
        assert_eq!(loaded, c);
        remove_repo(&file, &repo).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), saved);
        assert_eq!(std::fs::read_to_string(repo.join("keep.txt")).unwrap(), "work");
    }

    #[test]
    fn removal_resolves_aliases_and_creates_missing_settings_from_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("project");
        std::fs::create_dir(&repo).unwrap();
        let alias = dir.path().join("alias");
        std::os::unix::fs::symlink(&repo, &alias).unwrap();
        let file = dir.path().join("settings/config.toml");
        let c = remove_repo(&file, &alias).unwrap();
        assert!(c.removes_repo(&repo));
        assert!(c.removes_repo(&alias));
        assert_eq!(c.roots, Config::defaults().roots);
        assert!(load(&file).0.removes_repo(&repo));
    }

    #[test]
    fn removal_leaves_malformed_or_read_only_settings_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("config.toml");
        let broken = "remote_check_minutes = [\n";
        std::fs::write(&file, broken).unwrap();
        assert!(remove_repo(&file, dir.path()).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), broken);
        std::fs::write(&file, DEFAULT_TOML).unwrap();
        let mut permissions = std::fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&file, permissions).unwrap();
        assert!(remove_repo(&file, dir.path()).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), DEFAULT_TOML);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn removal_does_not_replace_a_dangling_settings_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("config.toml");
        let missing = dir.path().join("missing.toml");
        std::os::unix::fs::symlink(&missing, &file).unwrap();
        let error = remove_repo(&file, dir.path()).unwrap_err();
        assert!(error.contains("could not resolve settings symlink"), "{error}");
        assert_eq!(std::fs::read_link(&file).unwrap(), missing);
        assert!(!missing.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
