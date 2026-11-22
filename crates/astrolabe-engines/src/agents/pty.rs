//! Agent CLIs in a pseudo-terminal: the only agent processes the engine starts.
//!
//! Each runs in the empty probe folder with a clean environment: the user's
//! identity, a `PATH` of the usual install places, a terminal type, and the
//! tool's own switches. Nothing else is inherited, so a marker such as a parent
//! session's variables cannot change what the tool records. The screen text is
//! returned to the caller, which keeps only the figures it parses; it is never
//! logged or stored.

use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use regex::bytes::Regex;

/// Columns and rows of the pseudo-terminal: wide, so panels do not wrap.
const COLS: u16 = 160;
const ROWS: u16 = 50;

/// Escape sequences. Cursor movements become a space so that words drawn in
/// separate places stay apart; every other sequence is dropped.
static MOVES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\[[0-9;?]*[ABCDEFGHJKdf]").expect("cursor-move pattern"));
static ESCAPES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"\x1b\[[0-9;?<>=!]*[ -/]*[@-~]",       // CSI
        r"|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?", // OSC
        r"|\x1b[PX^_][^\x1b]*\x1b\\",           // DCS, SOS, PM, APC
        r"|\x1b[()*+][A-Za-z0-9]",              // character sets
        r"|\x1b[=>78DEHMNOZc\\]",               // single-character escapes
        r"|\r",
    ))
    .expect("escape pattern")
});

/// The screen output as plain text.
pub fn plain(raw: &[u8]) -> String {
    let moved = MOVES.replace_all(raw, &b" "[..]);
    let text = ESCAPES.replace_all(&moved, &b""[..]);
    String::from_utf8_lossy(&text).into_owned()
}

/// The environment every agent process gets, plus `extra`.
pub fn env(home: &Path, extra: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut path: Vec<String> = super::paths::bin_dirs(home).iter().map(|p| p.display().to_string()).collect();
    for system in ["/usr/sbin", "/sbin"] {
        if !path.iter().any(|p| p == system) {
            path.push(system.to_owned());
        }
    }
    let mut env = vec![
        ("HOME".to_owned(), home.display().to_string()),
        ("PATH".to_owned(), path.join(":")),
        ("TERM".to_owned(), "xterm-256color".to_owned()),
        ("LANG".to_owned(), "en_US.UTF-8".to_owned()),
    ];
    for key in ["USER", "LOGNAME", "SHELL", "TMPDIR"] {
        if let Ok(v) = std::env::var(key) {
            env.push((key.to_owned(), v));
        }
    }
    for (k, v) in extra {
        env.push(((*k).to_owned(), (*v).to_owned()));
    }
    env
}

/// Make the probe folder if needed, and list anything a tool left in it.
pub fn probe_folder(dir: &Path) -> io::Result<Vec<String>> {
    std::fs::create_dir_all(dir)?;
    let mut left: Vec<String> =
        std::fs::read_dir(dir)?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    left.sort();
    Ok(left)
}

/// A process on the slave side of a pseudo-terminal, and everything it has
/// written so far.
pub struct Pty {
    master: OwnedFd,
    child: Child,
    raw: Vec<u8>,
    /// Set when the master side reports end of file: the process has gone.
    closed: bool,
}

/// Start `program` in `cwd` on a new pseudo-terminal, as the leader of a new
/// session with the terminal as its controlling terminal.
pub fn spawn(program: &Path, args: &[&str], env: &[(String, String)], cwd: &Path) -> io::Result<Pty> {
    let (mut master, mut slave) = (-1, -1);
    let mut size = libc::winsize { ws_row: ROWS, ws_col: COLS, ws_xpixel: 0, ws_ypixel: 0 };
    // SAFETY: openpty writes two descriptors; the name and termios are optional.
    let rc = unsafe { libc::openpty(&mut master, &mut slave, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: both descriptors were just opened and are owned here alone.
    let (master, slave) = unsafe { (OwnedFd::from_raw_fd(master), OwnedFd::from_raw_fd(slave)) };
    for fd in [&master, &slave] {
        // Other processes the engine starts must not inherit either side.
        // SAFETY: plain fcntl on descriptors owned here.
        unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) };
    }
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::from(slave.try_clone()?))
        .stdout(Stdio::from(slave.try_clone()?))
        .stderr(Stdio::from(slave));
    // SAFETY: only async-signal-safe calls between fork and exec.
    unsafe {
        cmd.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(io::Error::last_os_error());
            }
            if libc::ioctl(0, libc::TIOCSCTTY as _, 0) == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let child = cmd.spawn()?;
    // Dropping the command closes the parent's copies of the slave side, so
    // the master reads end of file once the process exits.
    drop(cmd);
    Ok(Pty { master, child, raw: Vec::new(), closed: false })
}

impl Pty {
    /// Read for up to `wait`, stopping early once the plain text matches
    /// `until`. Returns whether it matched.
    pub fn pump(&mut self, wait: Duration, until: Option<&Regex>) -> bool {
        let end = Instant::now() + wait;
        let mut fresh = true;
        loop {
            if fresh
                && let Some(re) = until
                && re.is_match(plain(&self.raw).as_bytes())
            {
                return true;
            }
            fresh = false;
            let now = Instant::now();
            if now >= end || self.closed {
                return false;
            }
            let ms = (end - now).as_millis().min(100) as i32;
            let mut pfd = libc::pollfd { fd: self.master.as_raw_fd(), events: libc::POLLIN, revents: 0 };
            // SAFETY: one valid pollfd.
            let n = unsafe { libc::poll(&mut pfd, 1, ms) };
            if n <= 0 {
                continue;
            }
            let mut chunk = [0u8; 65536];
            // SAFETY: reading into a buffer of the given length.
            let got = unsafe { libc::read(self.master.as_raw_fd(), chunk.as_mut_ptr().cast(), chunk.len()) };
            if got > 0 {
                self.raw.extend_from_slice(&chunk[..got as usize]);
                fresh = true;
            } else {
                // 0 or EIO: the slave side is closed.
                self.closed = true;
            }
        }
    }

    pub fn write(&mut self, bytes: &[u8]) {
        // SAFETY: writing a buffer of the given length.
        unsafe { libc::write(self.master.as_raw_fd(), bytes.as_ptr().cast(), bytes.len()) };
    }

    /// Type `text` a key at a time, as a person would; some interfaces drop
    /// keys that arrive all at once.
    pub fn type_keys(&mut self, text: &str) {
        for ch in text.chars() {
            let mut b = [0u8; 4];
            self.write(ch.encode_utf8(&mut b).as_bytes());
            self.pump(Duration::from_millis(80), None);
        }
    }

    /// Everything shown so far, as plain text.
    pub fn text(&self) -> String {
        plain(&self.raw)
    }

    /// Forget what was shown so far, so the next match reads only new output.
    pub fn clear(&mut self) {
        self.raw.clear();
    }

    /// Press `keys` to leave the program, give it a few seconds to exit by
    /// itself, then end it: first the process, then its session.
    pub fn finish(mut self, keys: &[&[u8]]) -> Option<i32> {
        for key in keys {
            self.write(key);
            self.pump(Duration::from_millis(400), None);
        }
        self.wait_for_exit(Duration::from_secs(5))
    }

    /// Wait for the process to exit by itself, reading its output meanwhile
    /// so it never blocks on a full terminal; end it if it does not.
    fn wait_for_exit(&mut self, grace: Duration) -> Option<i32> {
        let end = Instant::now() + grace;
        while Instant::now() < end {
            if let Ok(Some(status)) = self.child.try_wait() {
                self.end_session();
                return status.code();
            }
            self.pump(Duration::from_millis(100), None);
        }
        let pid = self.child.id() as libc::pid_t;
        // SAFETY: signalling the process this Pty started.
        unsafe { libc::kill(pid, libc::SIGTERM) };
        let end = Instant::now() + Duration::from_secs(2);
        while Instant::now() < end {
            if let Ok(Some(status)) = self.child.try_wait() {
                self.end_session();
                return status.code();
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.end_session();
        None
    }

    /// Anything the program started in its own session goes with it. The
    /// session id is the started process's id, so only its processes match.
    fn end_session(&mut self) {
        let pgid = self.child.id() as libc::pid_t;
        // SAFETY: signalling the process group this Pty created with setsid.
        unsafe { libc::killpg(pgid, libc::SIGKILL) };
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        if let Ok(None) = self.child.try_wait() {
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.end_session();
        }
    }
}

/// How to read a `/usage` panel.
pub struct Script<'a> {
    /// Text that shows the prompt is ready for typing.
    pub ready: &'a Regex,
    /// Text that shows the panel has drawn its figures.
    pub done: &'a Regex,
    /// Press Escape twice before typing, to close announcement banners.
    pub dismiss: bool,
    /// How long to keep reading after `done`, for the rest of the panel.
    pub settle: Duration,
    /// The longest the whole run may take.
    pub timeout: Duration,
    /// A question the CLI may ask before its prompt, and the keys that answer
    /// it, such as agy's trust question for the empty probe folder.
    pub answer: Option<(&'a Regex, &'a [u8])>,
}

/// Start an interactive CLI, type `/usage` once it is ready, and return the
/// plain screen text once the panel is drawn. The program is then closed with
/// Escape and two Control-C presses.
pub fn read_usage(
    program: &Path,
    args: &[&str],
    env: &[(String, String)],
    cwd: &Path,
    s: &Script,
) -> io::Result<String> {
    let start = Instant::now();
    let left = |start: Instant| s.timeout.saturating_sub(start.elapsed());
    let mut pty = spawn(program, args, env, cwd)?;
    let first = match s.answer {
        Some((question, _)) => Regex::new(&format!("(?:{})|(?:{})", s.ready.as_str(), question.as_str()))
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?,
        None => s.ready.clone(),
    };
    let mut ready = pty.pump(left(start).min(Duration::from_secs(30)), Some(&first));
    if let Some((question, keys)) = s.answer
        && question.is_match(pty.text().as_bytes())
    {
        pty.write(keys);
        pty.clear();
        ready = pty.pump(left(start).min(Duration::from_secs(30)), Some(s.ready));
    }
    pty.pump(Duration::from_millis(if ready { 1500 } else { 500 }), None);
    if s.dismiss {
        for _ in 0..2 {
            pty.write(b"\x1b");
            pty.pump(Duration::from_millis(800), None);
        }
    }
    pty.type_keys("/usage");
    pty.write(b"\r");
    let done = pty.pump(left(start), Some(s.done));
    if done {
        pty.pump(s.settle.min(left(start)), None);
    }
    let text = pty.text();
    pty.finish(&[b"\x1b", b"\x03", b"\x03"]);
    if !done {
        let what = if ready { "the usage panel did not appear" } else { "the prompt did not appear" };
        return Err(io::Error::new(io::ErrorKind::TimedOut, what));
    }
    Ok(text)
}

/// Run a status command to its end and return its exit code and plain output.
pub fn run_status(
    program: &Path,
    args: &[&str],
    env: &[(String, String)],
    cwd: &Path,
    timeout: Duration,
) -> io::Result<(Option<i32>, String)> {
    let mut pty = spawn(program, args, env, cwd)?;
    let end = Instant::now() + timeout;
    while Instant::now() < end && !pty.closed {
        pty.pump(Duration::from_millis(200), None);
        if let Ok(Some(_)) = pty.child.try_wait() {
            // Collect what is still buffered.
            pty.pump(Duration::from_millis(200), None);
            break;
        }
    }
    let text = pty.text();
    let code = pty.wait_for_exit(Duration::from_millis(500));
    Ok((code, text))
}

/// The first `name` found in `dirs` that is an executable file.
pub fn which(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    dirs.iter()
        .map(|d| d.join(name))
        .find(|p| std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_keeps_words_apart() {
        let raw = b"\x1b[2J\x1b[1;1H83%\x1b[2Cused\x1b[0mResets\r\n\x1b]0;title\x07ok";
        assert_eq!(plain(raw), "  83% usedResets\nok");
    }

    #[test]
    fn env_is_clean() {
        let env = env(Path::new("/h"), &[("A", "1")]);
        let keys: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"HOME") && keys.contains(&"PATH") && keys.contains(&"A"));
        assert!(!keys.iter().any(|k| k.starts_with("CLAUDE")));
    }

    /// A shell plays a tiny TUI: it waits for a line, then prints a panel.
    #[test]
    fn reads_a_panel_from_a_tui() {
        let dir = tempfile::tempdir().unwrap();
        let script =
            "printf 'ready> '; read line; printf '\\033[2Jgot %s\\033[1;5HWeekly 12%% used\\n' \"$line\"; sleep 30";
        let ready = Regex::new("ready>").unwrap();
        let done = Regex::new(r"Weekly \d+% used").unwrap();
        let s = Script {
            ready: &ready,
            done: &done,
            dismiss: false,
            settle: Duration::ZERO,
            timeout: Duration::from_secs(15),
            answer: None,
        };
        let env = env(dir.path(), &[]);
        let start = Instant::now();
        let text = read_usage(Path::new("/bin/sh"), &["-c", script], &env, dir.path(), &s).unwrap();
        assert!(text.contains("got /usage"), "{text:?}");
        assert!(text.contains("Weekly 12% used"));
        // The sleeping shell was ended, not waited for.
        assert!(start.elapsed() < Duration::from_secs(14));
    }

    #[test]
    fn a_status_command_runs_to_its_end() {
        let dir = tempfile::tempdir().unwrap();
        let env = env(dir.path(), &[]);
        let (code, text) = run_status(
            Path::new("/bin/sh"),
            &["-c", "echo signed in; exit 3"],
            &env,
            dir.path(),
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(code, Some(3));
        assert_eq!(text.trim(), "signed in");
    }

    #[test]
    fn a_missing_panel_times_out() {
        let dir = tempfile::tempdir().unwrap();
        let ready = Regex::new("never").unwrap();
        let done = Regex::new("never").unwrap();
        let s = Script {
            ready: &ready,
            done: &done,
            dismiss: false,
            settle: Duration::ZERO,
            timeout: Duration::from_secs(3),
            answer: None,
        };
        let env = env(dir.path(), &[]);
        let err = read_usage(Path::new("/bin/sh"), &["-c", "sleep 30"], &env, dir.path(), &s).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn probe_folder_lists_leftovers() {
        let dir = tempfile::tempdir().unwrap();
        let probe = dir.path().join("probe");
        assert!(probe_folder(&probe).unwrap().is_empty());
        std::fs::write(probe.join("x"), "").unwrap();
        assert_eq!(probe_folder(&probe).unwrap(), ["x"]);
    }
}
