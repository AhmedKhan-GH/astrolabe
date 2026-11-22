//! Well-known locations on the machine.

use std::path::{Path, PathBuf};

pub fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// Shared on-disk support directory for agent support files and the probe folder.
pub fn support_dir() -> PathBuf {
    home().join("Library/Application Support/Agent Monitor")
}

/// Empty probe directory inside [`support_dir`] that every `/usage` and status
/// command runs in.
pub fn probe_dir() -> PathBuf {
    support_dir().join("probe")
}

/// Shared on-disk cache directory for agent assets and icons.
pub fn cache_dir() -> PathBuf {
    home().join("Library/Caches/agent-monitor")
}

/// The path with the home folder written as `~`, for display.
pub fn tilde(path: &Path) -> String {
    let home = home();
    match path.strip_prefix(&home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".to_owned(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

/// The folders searched for agent commands. An app opened from the Finder gets
/// a minimal `PATH`, so the usual install places are listed here.
pub fn bin_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![
        home.join(".local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".opencode/bin"),
        home.join(".grok/bin"),
        home.join(".muse/bin"),
        home.join(".qwen/bin"),
        home.join(".minimax-code/bin"),
        home.join(".mimocode/bin"),
        home.join(".npm-global/bin"),
        home.join(".bun/bin"),
        home.join(".cargo/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            if dir.is_absolute() && !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

/// MiMo Code documents MIMOCODE_HOME and XDG overrides, plus both these
/// default credential locations in its macOS/Linux installation guide.
pub(crate) fn mimo_auth_paths(home: &Path) -> Vec<PathBuf> {
    let custom = std::env::var_os("MIMOCODE_HOME").map(PathBuf::from).filter(|p| p.is_absolute());
    let data = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|p| p.is_absolute());
    mimo_auth_paths_with(home, custom.as_deref(), data.as_deref())
}

fn mimo_auth_paths_with(home: &Path, custom: Option<&Path>, data: Option<&Path>) -> Vec<PathBuf> {
    if let Some(custom) = custom {
        return vec![custom.join("data/auth.json")];
    }
    if let Some(data) = data {
        return vec![data.join("mimocode/auth.json")];
    }
    vec![home.join("Library/Application Support/mimocode/auth.json"), home.join(".local/share/mimocode/auth.json")]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tildes() {
        assert_eq!(tilde(&home().join("a/b")), "~/a/b");
        assert_eq!(tilde(&home()), "~");
        assert_eq!(tilde(Path::new("/opt/x")), "/opt/x");
    }

    #[test]
    fn bin_dirs_start_with_the_install_places() {
        let dirs = bin_dirs(Path::new("/h"));
        assert_eq!(dirs[0], PathBuf::from("/h/.local/bin"));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/h/.minimax-code/bin")));
        assert!(dirs.contains(&PathBuf::from("/h/.mimocode/bin")));
    }

    #[test]
    fn mimo_explicit_data_directory_replaces_defaults() {
        let home = Path::new("/h");
        assert_eq!(
            mimo_auth_paths_with(home, Some(Path::new("/custom")), Some(Path::new("/xdg"))),
            vec![PathBuf::from("/custom/data/auth.json")]
        );
        assert_eq!(
            mimo_auth_paths_with(home, None, Some(Path::new("/xdg"))),
            vec![PathBuf::from("/xdg/mimocode/auth.json")]
        );
        assert_eq!(
            mimo_auth_paths_with(home, None, None),
            vec![
                home.join("Library/Application Support/mimocode/auth.json"),
                home.join(".local/share/mimocode/auth.json")
            ]
        );
    }
}
