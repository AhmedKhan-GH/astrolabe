//! Actions on a repository through `/usr/bin/open`: IDE, Finder, Terminal and links.

use std::ffi::OsString;
use std::path::Path;
use std::process::{Command, Stdio};

use super::model::Ide;

/// Open the folder in a JetBrains IDE.
pub fn open_in_ide(ide: Ide, path: &Path) -> Result<(), String> {
    run(app_args(ide.name(), path))
}

/// Reveal the folder in Finder.
pub fn open_in_finder(path: &Path) -> Result<(), String> {
    run(vec![path.into()])
}

/// Open a Terminal window in the folder.
pub fn open_in_terminal(path: &Path) -> Result<(), String> {
    run(app_args("Terminal", path))
}

/// Open an http or https link in the default browser; any other URL is refused.
pub fn open_url(url: &str) -> Result<(), String> {
    run(url_args(url)?)
}

/// Arguments for `open -a <app> <path>`.
fn app_args(app: &str, path: &Path) -> Vec<OsString> {
    vec!["-a".into(), app.into(), path.into()]
}

/// Arguments for opening a URL, or an error when it is not http(s).
fn url_args(url: &str) -> Result<Vec<OsString>, String> {
    let url = url.trim();
    let scheme = url.split_once("://").map(|(s, _)| s.to_ascii_lowercase());
    match scheme.as_deref() {
        Some("http" | "https") => Ok(vec!["--".into(), url.into()]),
        _ => Err(format!("not an http(s) URL: {url}")),
    }
}

/// Start `/usr/bin/open` without waiting for it.
fn run(args: Vec<OsString>) -> Result<(), String> {
    let mut child = Command::new("/usr/bin/open")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not run open: {e}"))?;
    // Reap the child in the background so it does not linger as a zombie.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_arguments() {
        let args = app_args("CLion", Path::new("/a/b c"));
        assert_eq!(args, ["-a", "CLion", "/a/b c"].map(OsString::from));
    }

    #[test]
    fn only_http_urls_are_opened() {
        assert_eq!(url_args("https://github.com/a/b"), Ok(vec!["--".into(), "https://github.com/a/b".into()]));
        assert!(url_args("HTTP://example.com").is_ok());
        assert!(url_args("file:///etc/passwd").is_err());
        assert!(url_args("javascript:alert(1)").is_err());
        assert!(url_args("/Applications/Foo.app").is_err());
        assert!(url_args("").is_err());
        assert!(open_url("ssh://host").is_err());
    }
}
