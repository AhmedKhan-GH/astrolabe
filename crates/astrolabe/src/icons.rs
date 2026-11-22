//! Bundled provider logos and live macOS `.app` bundle icon caching.
//!
//! Demo mode uses only the bundled PNG logos and never accesses `/Applications`
//! or the local disk cache.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

use astrolabe_engines::repos::Ide;

pub const AGENT_LOGOS: [(&str, &[u8]); 16] = [
    ("claude", include_bytes!("../assets/agents/claude.png")),
    ("codex", include_bytes!("../assets/agents/codex.png")),
    ("kimi", include_bytes!("../assets/agents/kimi.png")),
    ("zcode", include_bytes!("../assets/agents/zcode.png")),
    ("antigravity", include_bytes!("../assets/agents/antigravity.png")),
    ("gemini", include_bytes!("../assets/agents/gemini.png")),
    ("grok", include_bytes!("../assets/agents/grok.png")),
    ("muse", include_bytes!("../assets/agents/meta.png")),
    ("qwen", include_bytes!("../assets/agents/qwen.png")),
    ("opencode", include_bytes!("../assets/agents/opencode.png")),
    ("ollama", include_bytes!("../assets/agents/ollama.png")),
    ("mistral", include_bytes!("../assets/agents/mistral.png")),
    ("minimax", include_bytes!("../assets/agents/minimax.png")),
    ("deepseek", include_bytes!("../assets/agents/deepseek.png")),
    ("mimo", include_bytes!("../assets/agents/mimo.png")),
    ("codebuddy", include_bytes!("../assets/agents/codebuddy.png")),
];

/// Maps CLI, app, and provider aliases to their bundled logo key.
pub fn logo_id(id: &str) -> Option<&'static str> {
    match id {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "kimi" => Some("kimi"),
        "ZCode" | "zcode" => Some("zcode"),
        "Antigravity" | "agy" => Some("antigravity"),
        "gemini" => Some("gemini"),
        "grok" => Some("grok"),
        "muse" => Some("muse"),
        "qwen" => Some("qwen"),
        "opencode" => Some("opencode"),
        "ollama" => Some("ollama"),
        "mistral" | "vibe" => Some("mistral"),
        "minimax" | "mcode" | "MiniMax Code" => Some("minimax"),
        "deepseek" => Some("deepseek"),
        "xiaomi" | "mimo" => Some("mimo"),
        "tencent" | "codebuddy" | "CodeBuddy" => Some("codebuddy"),
        _ => None,
    }
}

/// Decodes PNG bytes into an `egui::ColorImage`.
pub fn load_png_bytes(bytes: &[u8]) -> Option<egui::ColorImage> {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Png).ok()?.into_rgba8();
    let size = [img.width() as usize, img.height() as usize];
    Some(egui::ColorImage::from_rgba_unmultiplied(size, img.as_raw()))
}

/// Decodes a PNG file from disk into an `egui::ColorImage`.
pub fn load_file(png: &Path) -> Option<egui::ColorImage> {
    let img = image::open(png).ok()?.into_rgba8();
    let size = [img.width() as usize, img.height() as usize];
    Some(egui::ColorImage::from_rgba_unmultiplied(size, img.as_raw()))
}

/// Locates an installed JetBrains `.app` bundle on macOS (live mode only).
pub fn ide_app(ide: Ide) -> Option<PathBuf> {
    let file = format!("{}.app", ide.name());
    [PathBuf::from("/Applications"), astrolabe_engines::repos::paths::home().join("Applications")]
        .into_iter()
        .map(|dir| dir.join(&file))
        .find(|p| p.is_dir())
}

/// Converts a `.png`, `.icns`, or `.app` icon source into a cached 128 px PNG.
pub fn icon_png(id: &str, source: &Path, cache_dir: &Path) -> Option<PathBuf> {
    match source.extension().and_then(|e| e.to_str()) {
        Some("png") => source.is_file().then(|| source.to_path_buf()),
        Some("icns") => convert(id, source, cache_dir),
        Some("app") => convert(id, &bundle_icns(source)?, cache_dir),
        _ => None,
    }
}

fn bundle_icns(app: &Path) -> Option<PathBuf> {
    let resources = app.join("Contents/Resources");
    let named = plist::Value::from_file(app.join("Contents/Info.plist")).ok().and_then(|v| {
        let name = v.as_dictionary()?.get("CFBundleIconFile")?.as_string()?.to_owned();
        let mut path = resources.join(name);
        if path.extension().is_none_or(|e| e != "icns") {
            let mut s = path.into_os_string();
            s.push(".icns");
            path = PathBuf::from(s);
        }
        path.is_file().then_some(path)
    });
    if named.is_some() {
        return named;
    }
    let mut icns: Vec<PathBuf> = fs::read_dir(&resources)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "icns"))
        .collect();
    icns.sort();
    icns.into_iter().next()
}

fn convert(id: &str, icns: &Path, cache_dir: &Path) -> Option<PathBuf> {
    let meta = fs::metadata(icns).ok()?;
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
    let prefix = format!("{id}-");
    let out = cache_dir.join(format!("{prefix}{}-{mtime}.png", meta.len()));
    if out.is_file() {
        return Some(out);
    }
    fs::create_dir_all(cache_dir).ok()?;
    let tmp = cache_dir.join(format!(".{prefix}{}.tmp.png", std::process::id()));
    let ok = Command::new("/usr/bin/sips")
        .args(["-s", "format", "png", "-Z", "128"])
        .arg(icns)
        .arg("--out")
        .arg(&tmp)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if !ok || fs::rename(&tmp, &out).is_err() {
        let _ = fs::remove_file(&tmp);
        return None;
    }
    for entry in fs::read_dir(cache_dir).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(rest) = name.strip_prefix(&prefix).and_then(|r| r.strip_suffix(".png"))
            && rest.split('-').count() == 2
            && rest.split('-').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
            && entry.path() != out
        {
            let _ = fs::remove_file(entry.path());
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_agent_logos_decode() {
        for (id, bytes) in AGENT_LOGOS {
            let img = load_png_bytes(bytes).unwrap_or_else(|| panic!("invalid PNG for {id}"));
            assert_eq!(img.size, [128, 128]);
        }
    }
}
