//! Well-known locations on the machine.

use std::path::{Path, PathBuf};

pub fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// `~/Library/Application Support/Astrolabe`: the settings.
pub fn support_dir() -> PathBuf {
    home().join("Library/Application Support/Astrolabe")
}

/// `~/Library/Application Support/Astrolabe/config.toml`
pub fn config_file() -> PathBuf {
    support_dir().join("config.toml")
}

/// `~/Library/Application Support/Astrolabe/organize.toml`: tags and folders.
pub fn organize_file() -> PathBuf {
    support_dir().join("organize.toml")
}

/// `~/Library/Application Support/Astrolabe/window.toml`: the window's own
/// choices, such as the open folder, grouping and density.
pub fn window_file() -> PathBuf {
    support_dir().join("window.toml")
}

/// `~/Library/Caches/astrolabe`
pub fn cache_dir() -> PathBuf {
    home().join("Library/Caches/astrolabe")
}

/// Read-only support directory for first-run import of standalone repository settings.
pub fn repo_monitor_support_dir() -> PathBuf {
    home().join("Library/Application Support/Repo Monitor")
}

/// Read-only `config.toml` path for first-run import of standalone repository settings.
pub fn repo_monitor_config_file() -> PathBuf {
    repo_monitor_support_dir().join("config.toml")
}

/// Expand a leading `~/` (or a lone `~`) to the home folder.
pub fn expand(path: &str) -> PathBuf {
    if path == "~" {
        home()
    } else if let Some(rest) = path.strip_prefix("~/") {
        home().join(rest)
    } else {
        PathBuf::from(path)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_and_tildes() {
        assert_eq!(expand("~/x/y"), home().join("x/y"));
        assert_eq!(expand("~"), home());
        assert_eq!(expand("/abs"), PathBuf::from("/abs"));
        assert_eq!(tilde(&home().join("a/b")), "~/a/b");
        assert_eq!(tilde(&home()), "~");
        assert_eq!(tilde(Path::new("/opt/x")), "/opt/x");
    }

    #[test]
    fn astrolabe_and_repo_monitor_paths() {
        let h = home();
        assert_eq!(support_dir(), h.join("Library/Application Support/Astrolabe"));
        assert_eq!(config_file(), h.join("Library/Application Support/Astrolabe/config.toml"));
        assert_eq!(organize_file(), h.join("Library/Application Support/Astrolabe/organize.toml"));
        assert_eq!(window_file(), h.join("Library/Application Support/Astrolabe/window.toml"));
        assert_eq!(cache_dir(), h.join("Library/Caches/astrolabe"));
        assert_eq!(repo_monitor_support_dir(), h.join("Library/Application Support/Repo Monitor"));
        assert_eq!(repo_monitor_config_file(), h.join("Library/Application Support/Repo Monitor/config.toml"));
    }
}
