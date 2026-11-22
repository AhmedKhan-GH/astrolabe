//! Guard test rejecting raw color literals anywhere under `crates/astrolabe-kit/src/`.
//!
//! All colors in `astrolabe-kit` must come from `sternbild_tokens` role or data tokens,
//! with zero hardcoded hex strings, numeric RGB/RGBA constructors, or named palette constants.

use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
struct Violation {
    file: String,
    line: usize,
    reason: String,
    excerpt: String,
}

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", dir.display()))
        .map(|entry| entry.expect("dir entry").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().and_then(|s| s.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

fn is_ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn is_hex_digit(b: u8) -> bool {
    b.is_ascii_hexdigit()
}

fn line_number_at(source: &str, byte_idx: usize) -> usize {
    source[..byte_idx].bytes().filter(|&b| b == b'\n').count() + 1
}

fn line_excerpt(source: &str, byte_idx: usize) -> String {
    let start = source[..byte_idx].rfind('\n').map_or(0, |i| i + 1);
    let end = source[byte_idx..].find('\n').map_or(source.len(), |i| byte_idx + i);
    source[start..end].trim().to_owned()
}

fn extract_delimited(source: &str, open_idx: usize, open: u8, close: u8) -> Option<&str> {
    let bytes = source.as_bytes();
    if bytes.get(open_idx) != Some(&open) {
        return None;
    }
    let mut depth = 0usize;
    for (offset, &b) in bytes[open_idx..].iter().enumerate() {
        if b == open {
            depth += 1;
        } else if b == close {
            depth -= 1;
            if depth == 0 {
                return Some(&source[open_idx + 1..open_idx + offset]);
            }
        }
    }
    None
}

fn split_top_level_args(inner: &str) -> Vec<&str> {
    let mut args = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (idx, b) in inner.bytes().enumerate() {
        match b {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                args.push(inner[start..idx].trim());
                start = idx + 1;
            }
            _ => {}
        }
    }
    let tail = inner[start..].trim();
    if !tail.is_empty() {
        args.push(tail);
    }
    args
}

/// Returns true when `expr` contains any numeric literal token (decimal or `0x` hex).
fn contains_numeric_literal(expr: &str) -> bool {
    let bytes = expr.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let prev_ident = i > 0 && is_ident_char(bytes[i - 1]);
        if !prev_ident && bytes[i].is_ascii_digit() {
            return true;
        }
        i += 1;
    }
    false
}

/// Returns true when `expr` reads a channel (`.r`, `.g`, `.b` or `.r()`, `.g()`, `.b()`) without numeric literals.
fn is_token_channel_expr(expr: &str) -> bool {
    if contains_numeric_literal(expr) {
        return false;
    }
    for channel in [".r", ".g", ".b"] {
        let mut offset = 0;
        while let Some(pos) = expr[offset..].find(channel) {
            let after = offset + pos + channel.len();
            let rest = &expr.as_bytes()[after..];
            let valid_boundary = rest.is_empty() || !is_ident_char(rest[0]);
            if valid_boundary {
                return true;
            }
            offset = after;
        }
    }
    false
}

fn scan_hex_colors(file: &str, source: &str, violations: &mut Vec<Violation>) {
    let bytes = source.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'#' {
            let prev = if i > 0 { Some(bytes[i - 1]) } else { None };
            // Ignore Rust attributes `#[...]`, inner attributes `#![...]`, raw strings `r#"..."#`, and char `'#'`.
            let next = bytes.get(i + 1).copied();
            if matches!(next, Some(b'[' | b'!' | b'"' | b'\'')) || prev == Some(b'\'') || prev.is_some_and(is_ident_char)
            {
                i += 1;
                continue;
            }
            let mut j = i + 1;
            while j < bytes.len() && is_hex_digit(bytes[j]) {
                j += 1;
            }
            let hex_len = j - (i + 1);
            let trailing_ident = j < bytes.len() && is_ident_char(bytes[j]);
            if !trailing_ident && matches!(hex_len, 3 | 4 | 6 | 8) {
                violations.push(Violation {
                    file: file.to_owned(),
                    line: line_number_at(source, i),
                    reason: format!("raw hex color literal `{}`", &source[i..j]),
                    excerpt: line_excerpt(source, i),
                });
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

fn scan_constructor_calls(file: &str, source: &str, violations: &mut Vec<Violation>) {
    // Always-disallowed constructors (single-channel gray/alpha or hex string).
    const ALWAYS_FORBIDDEN: &[&str] = &[
        concat!("Color32::from_", "gray"),
        concat!("Color32::from_", "black_alpha"),
        concat!("Color32::from_", "white_alpha"),
        concat!("Color32::from_", "hex"),
        concat!("Rgba::from_", "gray"),
        concat!("Rgba::from_", "black_alpha"),
        concat!("Rgba::from_", "white_alpha"),
        concat!("Rgba::from_", "srgba"),
        concat!("Rgba::from_", "rgba"),
        concat!("Rgba::from_", "rgb"),
        concat!("Rgba::from_", "luminance"),
    ];

    // RGB/RGBA constructors allowed only when the first 3 RGB arguments forward token channel reads.
    const CHANNEL_GUARDED: &[&str] = &[
        concat!("Color32::from_", "rgb"),
        concat!("Color32::from_", "rgba_unmultiplied"),
        concat!("Color32::from_", "rgba_premultiplied"),
    ];

    for pat in ALWAYS_FORBIDDEN {
        let mut search_from = 0;
        while let Some(rel) = source[search_from..].find(pat) {
            let pos = search_from + rel;
            let after = pos + pat.len();
            let prev_ok = pos == 0 || !is_ident_char(source.as_bytes()[pos - 1]);
            let rest = source[after..].trim_start();
            if prev_ok && rest.starts_with('(') {
                violations.push(Violation {
                    file: file.to_owned(),
                    line: line_number_at(source, pos),
                    reason: format!("forbidden color constructor `{pat}(...)`"),
                    excerpt: line_excerpt(source, pos),
                });
            }
            search_from = after;
        }
    }

    for pat in CHANNEL_GUARDED {
        let mut search_from = 0;
        while let Some(rel) = source[search_from..].find(pat) {
            let pos = search_from + rel;
            let after = pos + pat.len();
            let prev_ok = pos == 0 || !is_ident_char(source.as_bytes()[pos - 1]);
            if prev_ok {
                let ws_len = source[after..].len() - source[after..].trim_start().len();
                let open_idx = after + ws_len;
                if source.as_bytes().get(open_idx) == Some(&b'(')
                    && let Some(inner) = extract_delimited(source, open_idx, b'(', b')')
                {
                    let args = split_top_level_args(inner);
                    let rgb_ok = args.len() >= 3 && args[..3].iter().all(|arg| is_token_channel_expr(arg));
                    if !rgb_ok {
                        violations.push(Violation {
                            file: file.to_owned(),
                            line: line_number_at(source, pos),
                            reason: format!("raw RGB literal in `{pat}(...)`"),
                            excerpt: line_excerpt(source, pos),
                        });
                    }
                }
            }
            search_from = after;
        }
    }

    // CSS-like `rgb(...)` / `rgba(...)` with numeric arguments.
    for pat in ["rgb(", "rgba("] {
        let mut search_from = 0;
        while let Some(rel) = source[search_from..].find(pat) {
            let pos = search_from + rel;
            let prev_ok = pos == 0 || (!is_ident_char(source.as_bytes()[pos - 1]) && source.as_bytes()[pos - 1] != b'.');
            let open_idx = pos + pat.len() - 1;
            if prev_ok
                && let Some(inner) = extract_delimited(source, open_idx, b'(', b')')
                && contains_numeric_literal(inner)
            {
                violations.push(Violation {
                    file: file.to_owned(),
                    line: line_number_at(source, pos),
                    reason: format!("numeric literal in `{pat}...)`"),
                    excerpt: line_excerpt(source, pos),
                });
            }
            search_from = pos + pat.len();
        }
    }
}

fn scan_named_color32_constants(file: &str, source: &str, violations: &mut Vec<Violation>) {
    let prefix = "Color32::";
    let mut search_from = 0;
    while let Some(rel) = source[search_from..].find(prefix) {
        let pos = search_from + rel;
        let prev_ok = pos == 0 || !is_ident_char(source.as_bytes()[pos - 1]);
        let name_start = pos + prefix.len();
        let bytes = source.as_bytes();
        let mut name_end = name_start;
        while name_end < bytes.len() && is_ident_char(bytes[name_end]) {
            name_end += 1;
        }
        let ident = &source[name_start..name_end];
        let is_const_ident = !ident.is_empty()
            && ident.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            && ident.bytes().any(|b| b.is_ascii_uppercase());
        if prev_ok && is_const_ident {
            let line = line_excerpt(source, pos);
            let allowed = match ident {
                "PLACEHOLDER" | "TRANSPARENT" => true,
                "WHITE" => line.contains(".image("),
                _ => false,
            };
            if !allowed {
                violations.push(Violation {
                    file: file.to_owned(),
                    line: line_number_at(source, pos),
                    reason: format!("named palette constant `Color32::{ident}`"),
                    excerpt: line,
                });
            }
        }
        search_from = name_end.max(name_start);
    }
}

fn scan_image_rgba_arrays(file: &str, source: &str, violations: &mut Vec<Violation>) {
    let pat = "image::Rgba(";
    let mut search_from = 0;
    while let Some(rel) = source[search_from..].find(pat) {
        let pos = search_from + rel;
        let open_paren = pos + pat.len() - 1;
        if let Some(paren_inner) = extract_delimited(source, open_paren, b'(', b')') {
            let trimmed = paren_inner.trim();
            if trimmed.starts_with('[')
                && let Some(bracket_inner) = extract_delimited(trimmed, 0, b'[', b']')
            {
                let elems = split_top_level_args(bracket_inner);
                let rgb_ok = elems.len() >= 3 && elems[..3].iter().all(|el| is_token_channel_expr(el));
                if !rgb_ok {
                    violations.push(Violation {
                        file: file.to_owned(),
                        line: line_number_at(source, pos),
                        reason: "raw numeric RGB elements in `image::Rgba([...])`".to_owned(),
                        excerpt: line_excerpt(source, pos),
                    });
                }
            }
        }
        search_from = pos + pat.len();
    }
}

fn scan_source(file: &str, source: &str) -> Vec<Violation> {
    let mut violations = Vec::new();
    scan_hex_colors(file, source, &mut violations);
    scan_constructor_calls(file, source, &mut violations);
    scan_named_color32_constants(file, source, &mut violations);
    scan_image_rgba_arrays(file, source, &mut violations);
    violations
}

#[test]
fn no_raw_color_literals_in_kit() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    collect_rs_files(&src_dir, &mut files);
    assert!(!files.is_empty(), "expected Rust source files under {}", src_dir.display());

    let mut all_violations = Vec::new();
    for path in files {
        let content = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
        let rel = path
            .strip_prefix(env!("CARGO_MANIFEST_DIR"))
            .unwrap_or(&path)
            .display()
            .to_string();
        all_violations.extend(scan_source(&rel, &content));
    }

    if !all_violations.is_empty() {
        let mut msg = String::from("Raw color literals found in astrolabe-kit/src:\n");
        for v in &all_violations {
            msg.push_str(&format!("  {}:{}: {} -> {}\n", v.file, v.line, v.reason, v.excerpt));
        }
        panic!("{msg}");
    }
}

#[test]
fn color_literal_scanner_catches_synthetic_violations_and_allows_token_helpers() {
    let bad_rgb = concat!("let c = Color32::from_", "rgb(0x12, 0x11, 0x0f);");
    assert!(!scan_source("synthetic.rs", bad_rgb).is_empty(), "must reject numeric from_rgb");

    let bad_premul = concat!("let c = Color32::from_", "rgba_premultiplied(39, 31, 20, 56);");
    assert!(!scan_source("synthetic.rs", bad_premul).is_empty(), "must reject numeric from_rgba_premultiplied");

    let bad_hex_str = concat!("let h = \"", "#", "b38b59\";");
    assert!(!scan_source("synthetic.rs", bad_hex_str).is_empty(), "must reject 6-digit hex color string");

    let bad_hex_comment = concat!("// accent ", "#", "B38B59ff");
    assert!(!scan_source("synthetic.rs", bad_hex_comment).is_empty(), "must reject 8-digit hex in comments");

    let bad_hex_short = concat!("// short ", "#", "abc");
    assert!(!scan_source("synthetic.rs", bad_hex_short).is_empty(), "must reject 3-digit hex in comments");

    let bad_named = concat!("let c = Color32::", "RED;");
    assert!(!scan_source("synthetic.rs", bad_named).is_empty(), "must reject named Color32::RED");

    let bad_white_non_image = concat!("let c = Color32::", "WHITE;");
    assert!(!scan_source("synthetic.rs", bad_white_non_image).is_empty(), "must reject Color32::WHITE outside image()");

    let bad_image_rgba = concat!("let px = image::", "Rgba([18, 17, 15, 255]);");
    assert!(!scan_source("synthetic.rs", bad_image_rgba).is_empty(), "must reject numeric image::Rgba array");

    let bad_gray = concat!("let c = Color32::from_", "gray(128);");
    assert!(!scan_source("synthetic.rs", bad_gray).is_empty(), "must reject Color32::from_gray");

    let bad_css_rgb = concat!("// ", "rgb(18, 17, 15)");
    assert!(!scan_source("synthetic.rs", bad_css_rgb).is_empty(), "must reject rgb(18, 17, 15)");

    // Benign token-forwarding patterns and Rust syntax must pass cleanly.
    let benign = concat!(
        "#[derive(Debug)]\n",
        "#[test]\n",
        "const fn from_token(c: sternbild_tokens::Color) -> Color32 { Color32::from_",
        "rgb(c.r, c.g, c.b) }\n",
        "fn with_alpha(c: Color32, a: u8) -> Color32 { Color32::from_",
        "rgba_unmultiplied(c.r(), c.g(), c.b(), a) }\n",
        "const fn premul(c: Color32, a: u8) -> Color32 {\n",
        "    Color32::from_",
        "rgba_premultiplied(pm(c.r(), a), pm(c.g(), a), pm(c.b(), a), a)\n",
        "}\n",
        "let ok_img = p.image(tex.id(), rect, uv, Color32::WHITE);\n",
        "let ok_ph = Color32::PLACEHOLDER;\n",
        "let ok_tr = Color32::TRANSPARENT;\n",
        "let ok_decode = egui::ColorImage::from_rgba_unmultiplied(size, raw);\n",
        "let ok_px = image::Rgba([color::TEXT.r(), color::TEXT.g(), color::TEXT.b(), 255]);\n",
        "let ok_ch = '#';\n",
    );
    let benign_violations = scan_source("benign.rs", benign);
    assert!(benign_violations.is_empty(), "unexpected violations on benign code: {benign_violations:?}");
}
