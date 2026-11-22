//! The settings file: its default text, parsing, loading and the questions
//! discovery and the watcher ask of it.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
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

/// Read the settings file. When `path` is Astrolabe's default settings path and
/// does not yet exist, attempts a one-time read-only import from an existing
/// standalone repository settings file before falling back to [`DEFAULT_TOML`].
pub fn load(path: &Path) -> (Config, Option<String>) {
    let repo_monitor = (path == paths::config_file()).then(paths::repo_monitor_config_file);
    load_or_import(path, repo_monitor.as_deref())
}

/// Read the settings file at `path`. When `path` does not exist and
/// `repo_monitor_path` points to a readable, valid standalone repository
/// settings file, imports its watched roots, `skip_names`, and `skip_paths`
/// into a file seeded from [`DEFAULT_TOML`] without modifying
/// `repo_monitor_path`. Otherwise writes [`DEFAULT_TOML`].
pub fn load_or_import(path: &Path, repo_monitor_path: Option<&Path>) -> (Config, Option<String>) {
    match std::fs::read_to_string(path) {
        Ok(text) => match parse(&text) {
            Ok(config) => (config, None),
            Err(e) => (Config::defaults(), Some(format!("{}: {e}", path.display()))),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Some((text, config)) = repo_monitor_path.and_then(import_from_repo_monitor) {
                let error = write_atomic(path, &text)
                    .err()
                    .map(|e| format!("{}: could not write the imported settings: {e}", path.display()));
                return (config, error);
            }
            let error = write_atomic(path, DEFAULT_TOML)
                .err()
                .map(|e| format!("{}: could not write the default settings: {e}", path.display()));
            (Config::defaults(), error)
        }
        Err(e) => (Config::defaults(), Some(format!("{}: {e}", path.display()))),
    }
}

/// Validate watched roots against disk: every root must have a non-empty
/// category and point to an existing directory, and canonicalized roots must not
/// duplicate or contain each other.
pub fn validate_roots(roots: &[Root]) -> Result<(), String> {
    let mut canonical = Vec::with_capacity(roots.len());
    for root in roots {
        if root.category.trim().is_empty() {
            return Err("category cannot be empty".into());
        }
        if root.path.as_os_str().is_empty() {
            return Err("folder path cannot be empty".into());
        }
        if !root.path.is_dir() {
            let display = paths::tilde(&root.path);
            if root.path.exists() {
                return Err(format!("not a folder: {display}"));
            }
            return Err(format!("folder does not exist: {display}"));
        }
        let resolved = std::fs::canonicalize(&root.path)
            .map_err(|e| format!("could not resolve {}: {e}", paths::tilde(&root.path)))?;
        canonical.push(resolved);
    }
    validate_root_pairs(roots, &canonical)
}

/// Validate watched roots without checking disk existence, for demo and
/// in-memory editing: every root must have a non-empty category and non-empty
/// path, and normalized paths must not duplicate or contain each other.
pub fn validate_roots_in_memory(roots: &[Root]) -> Result<(), String> {
    let mut normalized = Vec::with_capacity(roots.len());
    for root in roots {
        if root.category.trim().is_empty() {
            return Err("category cannot be empty".into());
        }
        if root.path.as_os_str().is_empty() {
            return Err("folder path cannot be empty".into());
        }
        normalized.push(normalize_path(&root.path));
    }
    validate_root_pairs(roots, &normalized)
}

fn normalize_path(path: &Path) -> PathBuf {
    let expanded = path.to_str().map_or_else(|| path.to_path_buf(), paths::expand);
    let mut parts: Vec<Component<'_>> = Vec::new();
    for component in expanded.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match parts.last() {
                Some(Component::Normal(_)) => {
                    parts.pop();
                }
                Some(Component::RootDir | Component::Prefix(_)) => {}
                _ => parts.push(component),
            },
            _ => parts.push(component),
        }
    }
    let mut out = PathBuf::new();
    if parts.is_empty() {
        out.push(".");
    } else {
        for part in parts {
            out.push(part.as_os_str());
        }
    }
    out
}

fn validate_root_pairs(roots: &[Root], resolved: &[PathBuf]) -> Result<(), String> {
    for i in 0..resolved.len() {
        for j in (i + 1)..resolved.len() {
            if resolved[i] == resolved[j] {
                return Err(format!("duplicate folder: {}", paths::tilde(&roots[j].path)));
            }
            if resolved[i].starts_with(&resolved[j]) {
                return Err(format!(
                    "nested folder: {} is inside {}",
                    paths::tilde(&roots[i].path),
                    paths::tilde(&roots[j].path),
                ));
            }
            if resolved[j].starts_with(&resolved[i]) {
                return Err(format!(
                    "nested folder: {} is inside {}",
                    paths::tilde(&roots[j].path),
                    paths::tilde(&roots[i].path),
                ));
            }
        }
    }
    Ok(())
}

fn root_table(root: &Root, category: &str) -> toml_edit::Table {
    let mut table = toml_edit::Table::new();
    table["path"] = toml_edit::value(paths::tilde(&root.path));
    if let Some(ide) = root.ide {
        table["app"] = toml_edit::value(ide.name());
    }
    table["category"] = toml_edit::value(category);
    if !root.detect_third_party {
        table["detect_third_party"] = toml_edit::value(false);
    }
    table
}

fn replace_string_array<'a>(
    document: &mut toml_edit::DocumentMut,
    key: &str,
    values: impl IntoIterator<Item = &'a str>,
) {
    let suffix = document.get(key).and_then(|item| item.as_value()).and_then(|v| v.decor().suffix().cloned());
    let mut arr = toml_edit::Array::new();
    for value in values {
        arr.push(value);
    }
    let mut val = toml_edit::Value::Array(arr);
    val.decor_mut().set_prefix(" ");
    if let Some(suffix) = suffix {
        val.decor_mut().set_suffix(suffix);
    }
    document[key] = toml_edit::Item::Value(val);
}

fn replace_roots(document: &mut toml_edit::DocumentMut, roots: &[Root], trim_category: bool) {
    if let Some(arr) = document.get_mut("categories").and_then(|item| item.as_array_mut()) {
        for root in roots {
            let category = if trim_category { root.category.trim() } else { root.category.as_str() };
            if !category.is_empty() && !arr.iter().any(|v| v.as_str() == Some(category)) {
                arr.push(category);
            }
        }
    }

    let first_prefix = match document.get("root") {
        Some(toml_edit::Item::ArrayOfTables(aot)) => aot.get(0).and_then(|t| t.decor().prefix().cloned()),
        Some(_) => document.key("root").and_then(|k| k.leaf_decor().prefix().cloned()),
        None => None,
    };

    if roots.is_empty() {
        if let Some(slot) = document.get_mut("root") {
            let mut val = toml_edit::Value::Array(toml_edit::Array::new());
            val.decor_mut().set_prefix(" ");
            *slot = toml_edit::Item::Value(val);
            if let Some(prefix) = first_prefix
                && let Some(mut key) = document.key_mut("root")
            {
                key.leaf_decor_mut().set_prefix(prefix);
            }
        }
        return;
    }

    let mut aot = toml_edit::ArrayOfTables::new();
    for (idx, root) in roots.iter().enumerate() {
        let category = if trim_category { root.category.trim() } else { root.category.as_str() };
        let mut table = root_table(root, category);
        if idx == 0 {
            if let Some(prefix) = &first_prefix {
                table.decor_mut().set_prefix(prefix.clone());
            } else {
                table.decor_mut().set_prefix("\n");
            }
        } else {
            table.decor_mut().set_prefix("\n");
        }
        aot.push(table);
    }

    if let Some(slot) = document.get_mut("root") {
        *slot = toml_edit::Item::ArrayOfTables(aot);
        if let Some(mut key) = document.key_mut("root") {
            key.leaf_decor_mut().clear();
        }
    } else {
        document["root"] = toml_edit::Item::ArrayOfTables(aot);
    }
}

fn import_from_repo_monitor(source: &Path) -> Option<(String, Config)> {
    let text = std::fs::read_to_string(source).ok()?;
    let imported = parse(&text).ok()?;
    let mut document: toml_edit::DocumentMut = DEFAULT_TOML.parse().ok()?;
    replace_string_array(&mut document, "skip_names", imported.skip_names.iter().map(String::as_str));
    let skip_paths: Vec<String> = imported.skip_paths.iter().map(|p| paths::tilde(p)).collect();
    replace_string_array(&mut document, "skip_paths", skip_paths.iter().map(String::as_str));
    replace_roots(&mut document, &imported.roots, false);
    let updated = document.to_string();
    let config = parse(&updated).ok()?;
    Some((updated, config))
}

fn write_atomic(config_path: &Path, content: &str) -> Result<(), String> {
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
            ".astrolabe-config-{}-{}.tmp",
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
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&temporary, &destination)
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&temporary);
        return Err(e.to_string());
    }
    Ok(())
}

/// Validate and save watched roots to `config_path`, preserving all comments and
/// all other settings (`skip_names`, `skip_paths`, `removed_repos`,
/// `remote_check_minutes`, and `[repo]` overrides).
pub fn save_roots(config_path: &Path, roots: &[Root]) -> Result<Config, String> {
    validate_roots(roots)?;
    let save = || -> Result<Config, String> {
        let text = match std::fs::read_to_string(config_path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => DEFAULT_TOML.to_owned(),
            Err(e) => return Err(e.to_string()),
        };
        let _before = parse(&text)?;
        let mut document: toml_edit::DocumentMut = text.parse().map_err(|e: toml_edit::TomlError| e.to_string())?;
        replace_roots(&mut document, roots, true);
        let updated = document.to_string();
        let config = parse(&updated)?;
        write_atomic(config_path, &updated)?;
        Ok(config)
    };
    save().map_err(|e| format!("{}: could not save watched folders: {e}", config_path.display()))
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
        write_atomic(config_path, &updated)?;
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

    fn make_root(path: PathBuf, ide: Option<Ide>, category: &str, detect_third_party: bool) -> Root {
        Root { path, ide, category: category.to_owned(), detect_third_party }
    }

    #[test]
    fn load_or_import_imports_repo_monitor_without_touching_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("repo-monitor.toml");
        let source_text = r#"# Repo Monitor original
remote_check_minutes = 99
categories = ["CustomOnly"]
skip_names = ["custom_skip", "build-*"]
skip_paths = ["~/SkipOne", "/opt/skip-two"]
removed_repos = ["/old/removed"]

[[root]]
path = "~/CustomCode"
app = "RustRover"
category = "Products and tools"

[[root]]
path = "/opt/external"
category = "Imported Category"
detect_third_party = false

[repo."~/CustomCode/app"]
category = "Research"
"#;
        std::fs::write(&source, source_text).unwrap();
        let mut ro = std::fs::metadata(&source).unwrap().permissions();
        ro.set_readonly(true);
        std::fs::set_permissions(&source, ro).unwrap();

        let dest = dir.path().join("astrolabe/config.toml");
        let (config, err) = load_or_import(&dest, Some(&source));
        assert_eq!(err, None);
        assert_eq!(config.remote_check_minutes, 5);
        assert_eq!(config.roots.len(), 2);
        assert_eq!(config.roots[0], make_root(home("CustomCode"), Some(Ide::RustRover), "Products and tools", true));
        assert_eq!(config.roots[1], make_root(PathBuf::from("/opt/external"), None, "Imported Category", false));
        assert_eq!(config.skip_names, vec!["custom_skip", "build-*"]);
        assert_eq!(config.skip_paths, vec![home("SkipOne"), PathBuf::from("/opt/skip-two")]);
        assert!(config.removed_repos.is_empty());
        assert!(config.overrides.is_empty());
        assert_eq!(config.categories.len(), 8);
        assert_eq!(config.categories[0], "Products and tools");
        assert_eq!(config.categories[7], "Imported Category");

        // Source file was never modified.
        assert_eq!(std::fs::read_to_string(&source).unwrap(), source_text);

        // Written file preserves DEFAULT_TOML comments and tilde formatting.
        let saved = std::fs::read_to_string(&dest).unwrap();
        assert!(saved.contains("# Minutes between remote checks of each repository."), "{saved}");
        assert!(saved.contains("# Categories in display order."), "{saved}");
        assert!(saved.contains("# Folder names never scanned or watched;"), "{saved}");
        assert!(saved.contains("# Folders never scanned."), "{saved}");
        assert!(saved.contains("# Scanned folders; app is omitted to infer it from the project files."), "{saved}");
        assert!(saved.contains("# Per-repository override."), "{saved}");
        assert!(saved.contains("# [repo.\"~/CLionProjects/example-project\"]"), "{saved}");
        assert!(saved.contains("path = \"~/CustomCode\""), "{saved}");
        assert!(saved.contains("app = \"RustRover\""), "{saved}");
        assert!(saved.contains("detect_third_party = false"), "{saved}");
        assert!(saved.contains("\"~/SkipOne\""), "{saved}");

        // Reloading existing Astrolabe config reads it directly.
        let (reloaded, err2) = load_or_import(&dest, Some(&source));
        assert_eq!(err2, None);
        assert_eq!(reloaded, config);
    }

    #[test]
    fn load_or_import_falls_back_to_defaults_when_source_missing_or_malformed() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope.toml");
        let dest1 = dir.path().join("dest1/config.toml");
        let (c1, err1) = load_or_import(&dest1, Some(&missing));
        assert_eq!(err1, None);
        assert_eq!(c1, Config::defaults());
        assert_eq!(std::fs::read_to_string(&dest1).unwrap(), DEFAULT_TOML);

        let broken = dir.path().join("broken.toml");
        std::fs::write(&broken, "[[root\npath = ").unwrap();
        let dest2 = dir.path().join("dest2/config.toml");
        let (c2, err2) = load_or_import(&dest2, Some(&broken));
        assert_eq!(err2, None);
        assert_eq!(c2, Config::defaults());
        assert_eq!(std::fs::read_to_string(&dest2).unwrap(), DEFAULT_TOML);

        let unknown_ide = dir.path().join("unknown-ide.toml");
        std::fs::write(&unknown_ide, "[[root]]\npath = \"/r\"\ncategory = \"Work\"\napp = \"Vim\"\n").unwrap();
        let dest3 = dir.path().join("dest3/config.toml");
        let (c3, err3) = load_or_import(&dest3, Some(&unknown_ide));
        assert_eq!(err3, None);
        assert_eq!(c3, Config::defaults());
        assert_eq!(std::fs::read_to_string(&dest3).unwrap(), DEFAULT_TOML);
    }

    #[test]
    fn validate_roots_rejects_empty_category_missing_non_dir_duplicates_and_nesting() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("alpha");
        let b = dir.path().join("alpha-two");
        let child = a.join("nested");
        let file = dir.path().join("plain.txt");
        let link_a = dir.path().join("alpha-link");
        let link_child = dir.path().join("nested-link");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        std::fs::create_dir(&child).unwrap();
        std::fs::write(&file, "x").unwrap();
        std::os::unix::fs::symlink(&a, &link_a).unwrap();
        std::os::unix::fs::symlink(&child, &link_child).unwrap();

        // Valid sibling folders (including shared string prefix) and empty slice.
        assert!(validate_roots(&[]).is_ok());
        assert!(validate_roots(&[
            make_root(a.clone(), Some(Ide::RustRover), "Work", true),
            make_root(b.clone(), None, "Research", false),
        ]).is_ok());

        // Empty / whitespace category.
        assert!(validate_roots(&[make_root(a.clone(), None, "", true)]).is_err());
        assert!(validate_roots(&[make_root(a.clone(), None, "   \t ", true)]).is_err());

        // Missing path and regular file.
        assert!(validate_roots(&[make_root(dir.path().join("missing"), None, "Work", true)]).is_err());
        assert!(validate_roots(&[make_root(file, None, "Work", true)]).is_err());
        assert!(validate_roots(&[make_root(PathBuf::new(), None, "Work", true)]).is_err());

        // Direct duplicate and symlink duplicate.
        let dup = validate_roots(&[
            make_root(a.clone(), None, "Work", true),
            make_root(a.clone(), None, "Other", true),
        ])
        .unwrap_err();
        assert!(dup.contains("duplicate"), "{dup}");

        let sym_dup = validate_roots(&[
            make_root(a.clone(), None, "Work", true),
            make_root(link_a, None, "Other", true),
        ])
        .unwrap_err();
        assert!(sym_dup.contains("duplicate"), "{sym_dup}");

        // Nested parent -> child, child -> parent, and symlinked child.
        let p_c = validate_roots(&[
            make_root(a.clone(), None, "Work", true),
            make_root(child.clone(), None, "Sub", true),
        ])
        .unwrap_err();
        assert!(p_c.contains("nested"), "{p_c}");

        let c_p = validate_roots(&[
            make_root(child, None, "Sub", true),
            make_root(a.clone(), None, "Work", true),
        ])
        .unwrap_err();
        assert!(c_p.contains("nested"), "{c_p}");

        let sym_nested = validate_roots(&[
            make_root(a, None, "Work", true),
            make_root(link_child, None, "Sub", true),
        ])
        .unwrap_err();
        assert!(sym_nested.contains("nested"), "{sym_nested}");
    }

    #[test]
    fn validate_roots_in_memory_checks_without_disk_access() {
        assert!(validate_roots_in_memory(&[]).is_ok());
        assert!(validate_roots_in_memory(&[
            make_root(PathBuf::from("/nonexistent/alpha"), Some(Ide::CLion), "Work", true),
            make_root(PathBuf::from("/nonexistent/alpha-two"), None, "Personal", false),
        ])
        .is_ok());

        assert!(validate_roots_in_memory(&[make_root(PathBuf::from("/nonexistent/a"), None, "  ", true)]).is_err());
        assert!(validate_roots_in_memory(&[make_root(PathBuf::new(), None, "Work", true)]).is_err());

        // Normalized duplicates: trailing slash, dot, parent dir, tilde expansion.
        assert!(validate_roots_in_memory(&[
            make_root(PathBuf::from("/nonexistent/a/b"), None, "Work", true),
            make_root(PathBuf::from("/nonexistent/a/b/"), None, "Work", true),
        ])
        .is_err());
        assert!(validate_roots_in_memory(&[
            make_root(PathBuf::from("/nonexistent/a/b"), None, "Work", true),
            make_root(PathBuf::from("/nonexistent/a/./x/../b"), None, "Work", true),
        ])
        .is_err());
        assert!(validate_roots_in_memory(&[
            make_root(PathBuf::from("~/NonexistentDemo"), None, "Work", true),
            make_root(home("NonexistentDemo"), None, "Work", true),
        ])
        .is_err());

        // Nested in both orders.
        assert!(validate_roots_in_memory(&[
            make_root(PathBuf::from("/nonexistent/parent"), None, "Work", true),
            make_root(PathBuf::from("/nonexistent/parent/child"), None, "Sub", true),
        ])
        .is_err());
        assert!(validate_roots_in_memory(&[
            make_root(PathBuf::from("/nonexistent/parent/child/sub/.."), None, "Sub", true),
            make_root(PathBuf::from("/nonexistent/parent/"), None, "Work", true),
        ])
        .is_err());
    }

    #[test]
    fn save_roots_preserves_comments_and_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("alpha");
        let b = dir.path().join("beta");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();

        let file = dir.path().join("config.toml");
        let initial = r#"# Top comment
remote_check_minutes = 15 # keep inline

# Categories header
categories = ["Existing"]

# Skip header
skip_names = ["target", "dist"]
skip_paths = ["~/SkipMe"]
removed_repos = ["/gone/repo"]

# Watched folders header
[[root]]
path = "/old/path"
category = "Existing"

# Override header
[repo."~/Keep/me"]
category = "Existing"
app = "PyCharm"
"#;
        std::fs::write(&file, initial).unwrap();

        let new_roots = vec![
            make_root(a.clone(), Some(Ide::RustRover), "Existing", true),
            make_root(b.clone(), None, "Brand New", false),
        ];
        let saved_cfg = save_roots(&file, &new_roots).unwrap();
        assert_eq!(saved_cfg.remote_check_minutes, 15);
        assert_eq!(saved_cfg.categories, vec!["Existing", "Brand New"]);
        assert_eq!(saved_cfg.skip_names, vec!["target", "dist"]);
        assert_eq!(saved_cfg.skip_paths, vec![home("SkipMe")]);
        assert_eq!(saved_cfg.removed_repos, vec![PathBuf::from("/gone/repo")]);
        assert_eq!(saved_cfg.overrides.len(), 1);
        assert_eq!(saved_cfg.roots, new_roots);

        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("# Top comment"), "{text}");
        assert!(text.contains("remote_check_minutes = 15 # keep inline"), "{text}");
        assert!(text.contains("# Categories header"), "{text}");
        assert!(text.contains("# Skip header"), "{text}");
        assert!(text.contains("# Watched folders header"), "{text}");
        assert!(text.contains("# Override header"), "{text}");
        assert!(text.contains("[repo.\"~/Keep/me\"]"), "{text}");
        assert!(text.contains("app = \"RustRover\""), "{text}");
        assert!(text.contains("detect_third_party = false"), "{text}");
        assert!(!text.contains("detect_third_party = true"), "{text}");
        assert!(!text.contains("/old/path"), "{text}");

        // Round-trip through load().
        let (reloaded, err) = load(&file);
        assert_eq!(err, None);
        assert_eq!(reloaded, saved_cfg);

        // Clearing all roots and then re-adding preserves comments too.
        let cleared = save_roots(&file, &[]).unwrap();
        assert!(cleared.roots.is_empty());
        let cleared_text = std::fs::read_to_string(&file).unwrap();
        assert!(cleared_text.contains("# Watched folders header"), "{cleared_text}");
        assert!(cleared_text.contains("# Override header"), "{cleared_text}");
        let restored = save_roots(&file, &[make_root(a.clone(), None, "Existing", true)]).unwrap();
        assert_eq!(restored.roots.len(), 1);
        let restored_text = std::fs::read_to_string(&file).unwrap();
        assert!(restored_text.contains("# Watched folders header"), "{restored_text}");
        assert!(restored_text.contains("# Override header"), "{restored_text}");
    }

    #[test]
    fn save_roots_creates_missing_from_defaults_and_follows_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("projects");
        std::fs::create_dir(&a).unwrap();

        // Missing file seeded from DEFAULT_TOML preserves trailing comments.
        let missing_cfg = dir.path().join("new/config.toml");
        let cfg = save_roots(&missing_cfg, &[make_root(a.clone(), Some(Ide::GoLand), "Custom", true)]).unwrap();
        assert_eq!(cfg.roots.len(), 1);
        assert!(cfg.categories.contains(&"Custom".to_owned()));
        let text = std::fs::read_to_string(&missing_cfg).unwrap();
        assert!(text.contains("# Scanned folders; app is omitted to infer it from the project files."), "{text}");
        assert!(text.contains("# Per-repository override."), "{text}");
        assert!(text.contains("# [repo.\"~/CLionProjects/example-project\"]"), "{text}");

        // Valid symlink is followed rather than replaced.
        let target = dir.path().join("real-config.toml");
        std::fs::write(&target, DEFAULT_TOML).unwrap();
        let link = dir.path().join("link-config.toml");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        save_roots(&link, &[make_root(a.clone(), None, "Research", true)]).unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_link(&link).unwrap(), target);
        assert_eq!(load(&target).0.roots.len(), 1);

        // Dangling symlink is rejected without modifying it.
        let dangling_target = dir.path().join("missing-target.toml");
        let dangling_link = dir.path().join("dangling.toml");
        std::os::unix::fs::symlink(&dangling_target, &dangling_link).unwrap();
        let err = save_roots(&dangling_link, &[make_root(a, None, "Research", true)]).unwrap_err();
        assert!(err.contains("could not resolve settings symlink"), "{err}");
        assert!(!dangling_target.exists());
    }

    #[test]
    fn save_roots_uses_tilde_format_for_home_paths() {
        let table = root_table(&make_root(home("SampleProjects"), Some(Ide::CLion), "Work", true), "Work");
        assert_eq!(table["path"].as_str(), Some("~/SampleProjects"));
        assert_eq!(table["app"].as_str(), Some("CLion"));
        assert_eq!(table["category"].as_str(), Some("Work"));
        assert!(table.get("detect_third_party").is_none());

        let table2 = root_table(&make_root(home("ThirdParty"), None, "Third party", false), "Third party");
        assert_eq!(table2["path"].as_str(), Some("~/ThirdParty"));
        assert!(table2.get("app").is_none());
        assert_eq!(table2["detect_third_party"].as_bool(), Some(false));
    }

    #[test]
    fn save_roots_handles_repo_table_before_roots_and_leaves_invalid_files_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("alpha");
        std::fs::create_dir(&a).unwrap();

        // [repo] appearing before [[root]] should still allow clearing and restoring roots.
        let file = dir.path().join("ordered.toml");
        let text = "# Header\nremote_check_minutes = 7\n\n[repo.\"/other\"]\ncategory = \"Work\"\n\n# Roots\n[[root]]\npath = \"/old\"\ncategory = \"Work\"\n";
        std::fs::write(&file, text).unwrap();
        let cleared = save_roots(&file, &[]).unwrap();
        assert!(cleared.roots.is_empty());
        assert_eq!(cleared.overrides.len(), 1);
        let restored = save_roots(&file, &[make_root(a.clone(), None, "Work", true)]).unwrap();
        assert_eq!(restored.roots.len(), 1);
        assert_eq!(restored.overrides.len(), 1);

        // No [[root]] initially, only [repo].
        let no_roots = dir.path().join("no-roots.toml");
        std::fs::write(&no_roots, "remote_check_minutes = 9\n\n[repo.\"/x\"]\ncategory = \"Work\"\n").unwrap();
        let added = save_roots(&no_roots, &[make_root(a.clone(), Some(Ide::WebStorm), "  Trimmed  ", true)]).unwrap();
        assert_eq!(added.roots[0].category, "Trimmed");
        assert_eq!(added.categories, vec!["Trimmed", "Work"]);
        assert_eq!(added.overrides.len(), 1);

        // Invalid roots leave existing valid config untouched.
        let before = std::fs::read_to_string(&no_roots).unwrap();
        assert!(save_roots(&no_roots, &[make_root(dir.path().join("missing"), None, "Work", true)]).is_err());
        assert_eq!(std::fs::read_to_string(&no_roots).unwrap(), before);

        // Malformed and read-only files are left untouched with no stray temp files.
        let broken_dir = tempfile::tempdir().unwrap();
        let broken = broken_dir.path().join("config.toml");
        std::fs::write(&broken, "remote_check_minutes = [\n").unwrap();
        assert!(save_roots(&broken, &[make_root(a.clone(), None, "Work", true)]).is_err());
        assert_eq!(std::fs::read_to_string(&broken).unwrap(), "remote_check_minutes = [\n");
        assert_eq!(std::fs::read_dir(broken_dir.path()).unwrap().count(), 1);

        let ro_dir = tempfile::tempdir().unwrap();
        let ro_file = ro_dir.path().join("config.toml");
        std::fs::write(&ro_file, DEFAULT_TOML).unwrap();
        let mut perms = std::fs::metadata(&ro_file).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&ro_file, perms).unwrap();
        assert!(save_roots(&ro_file, &[make_root(a, None, "Work", true)]).is_err());
        assert_eq!(std::fs::read_to_string(&ro_file).unwrap(), DEFAULT_TOML);
        assert_eq!(std::fs::read_dir(ro_dir.path()).unwrap().count(), 1);
    }
}
