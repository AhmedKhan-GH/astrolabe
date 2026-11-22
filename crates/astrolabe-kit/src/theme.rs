//! Theme installation, font configuration, and text layout helpers.
//!
//! Installs a quiet Sternbild workstation style: dark mineral surfaces, square
//! corners, 1 px rules, zero motion, single regular weight, and tabular
//! monospace figures.

use std::sync::Arc;

use egui::{
    Align, Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Id, Painter, Rect, Shadow, Stroke,
    TextFormat, Theme, Ui, pos2, style::ScrollAnimation, text::LayoutJob, text::TextWrapping, vec2,
};

use crate::tokens::{color, font_size, metric};

const SCALE_KEY: &str = "astrolabe_kit_text_scale";

/// Optional owned font bytes overriding embedded `sternbild-tokens` fonts.
#[derive(Clone, Debug, Default)]
pub struct FontConfig {
    /// Regular UI sans-serif bytes (`.ttf` / `.otf` / `.ttc`).
    pub ui: Option<Vec<u8>>,
    /// Secondary UI sans-serif bytes (defaults to regular `UI_TTF`; Sternbild uses weight 400 only).
    pub medium: Option<Vec<u8>>,
    /// Monospace font bytes for tabular figures and identifiers.
    pub mono: Option<Vec<u8>>,
    /// Wordmark display font bytes.
    pub display: Option<Vec<u8>>,
}

/// Configuration for [`install_with`].
#[derive(Clone, Debug)]
pub struct ThemeConfig {
    /// Global text and metric scale multiplier (clamped to `0.75..=2.0`).
    pub text_scale: f32,
    /// Optional explicit font face bytes.
    pub fonts: FontConfig,
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self { text_scale: 1.0, fonts: FontConfig::default() }
    }
}

/// Primary UI proportional font family (`IBM Plex Sans Condensed`).
pub fn ui_family() -> FontFamily {
    FontFamily::Proportional
}

/// Emphasis UI proportional font family (weight 400 regular `IBM Plex Sans Condensed` by default).
pub fn medium_family() -> FontFamily {
    FontFamily::Name("medium".into())
}

/// Monospace font family with uniform tabular figure widths (`Source Code Pro`).
pub fn mono_family() -> FontFamily {
    FontFamily::Monospace
}

/// Wordmark display font family (`Sternbild Display`).
pub fn display_family() -> FontFamily {
    FontFamily::Name("display".into())
}

/// Returns the installed text scale for `ctx` (defaults to `1.0`).
pub fn text_scale(ctx: &egui::Context) -> f32 {
    ctx.data(|d| d.get_temp::<f32>(Id::unique(SCALE_KEY)).unwrap_or(1.0))
}

/// Installs the default Sternbild theme and font stack into `ctx`.
pub fn install(ctx: &egui::Context) {
    install_with(ctx, &ThemeConfig::default());
}

/// Installs the Sternbild theme with explicit scale and font overrides.
pub fn install_with(ctx: &egui::Context, config: &ThemeConfig) {
    let scale = config.text_scale.clamp(0.75, 2.0);
    ctx.data_mut(|d| d.insert_temp(Id::unique(SCALE_KEY), scale));
    install_fonts(ctx, &config.fonts);
    install_style(ctx, scale);
}

fn load_system_face(path: &str, index: u32) -> Option<Arc<FontData>> {
    std::fs::read(path).ok().map(|bytes| {
        let mut data = FontData::from_owned(bytes);
        data.index = index;
        Arc::new(data)
    })
}

fn install_fonts(ctx: &egui::Context, cfg: &FontConfig) {
    let mut fonts = FontDefinitions::default();

    let default_ui = Arc::new(FontData::from_static(sternbild_tokens::fonts::UI_TTF));
    let ui_face = cfg
        .ui
        .clone()
        .map(|b| Arc::new(FontData::from_owned(b)))
        .unwrap_or_else(|| default_ui.clone());

    let medium_face = cfg
        .medium
        .clone()
        .map(|b| Arc::new(FontData::from_owned(b)))
        .unwrap_or(default_ui);

    let mono_face = cfg
        .mono
        .clone()
        .map(|b| Arc::new(FontData::from_owned(b)))
        .unwrap_or_else(|| Arc::new(FontData::from_static(sternbild_tokens::fonts::MONO_TTF)));

    let display_face = cfg
        .display
        .clone()
        .map(|b| Arc::new(FontData::from_owned(b)))
        .unwrap_or_else(|| Arc::new(FontData::from_static(sternbild_tokens::fonts::DISPLAY_OTF)));

    let symbols_face = load_system_face("/System/Library/Fonts/Apple Symbols.ttf", 0)
        .or_else(|| load_system_face("/System/Library/Fonts/Supplemental/Apple Symbols.ttf", 0));
    let menlo_face = load_system_face("/System/Library/Fonts/Menlo.ttc", 0);

    fonts.font_data.insert("kit-sans".into(), ui_face);
    fonts.font_data.insert("kit-medium".into(), medium_face);
    fonts.font_data.insert("kit-mono".into(), mono_face);
    fonts.font_data.insert("kit-display".into(), display_face);

    let mut symbol_fallbacks: Vec<String> = Vec::new();
    if let Some(face) = symbols_face {
        fonts.font_data.insert("kit-symbols".into(), face);
        symbol_fallbacks.push("kit-symbols".to_owned());
    }
    if let Some(face) = menlo_face {
        fonts.font_data.insert("kit-menlo".into(), face);
        symbol_fallbacks.push("kit-menlo".to_owned());
    }

    // Build deterministic fallback stacks so Sternbild faces resolve first,
    // followed by macOS symbol fallbacks for shortcut glyphs (`⌘`, `⇧`, `⏎`, `×`, `·`).
    let mut prop_list = vec!["kit-sans".to_owned(), "kit-mono".to_owned()];
    prop_list.extend(symbol_fallbacks.iter().cloned());

    let mut mono_list = vec!["kit-mono".to_owned()];
    mono_list.extend(symbol_fallbacks.iter().cloned());

    let mut medium_list = vec!["kit-medium".to_owned(), "kit-mono".to_owned()];
    medium_list.extend(symbol_fallbacks.iter().cloned());

    let mut display_list = vec!["kit-display".to_owned(), "kit-sans".to_owned(), "kit-mono".to_owned()];
    display_list.extend(symbol_fallbacks);

    fonts.families.insert(FontFamily::Proportional, prop_list);
    fonts.families.insert(FontFamily::Monospace, mono_list);
    fonts.families.insert(medium_family(), medium_list);
    fonts.families.insert(display_family(), display_list);

    ctx.set_fonts(fonts);
}

fn install_style(ctx: &egui::Context, scale: f32) {
    ctx.set_theme(Theme::Dark);
    ctx.style_mut_of(Theme::Dark, |style| {
        // Quiet workstation: no implicit motion, transitions, or cursor blink.
        style.animation_time = 0.0;
        style.scroll_animation = ScrollAnimation::none();

        let v = &mut style.visuals;
        v.dark_mode = true;
        v.panel_fill = color::BACKGROUND_APP;
        v.window_fill = color::BACKGROUND_APP;
        v.faint_bg_color = color::SURFACE;
        v.extreme_bg_color = color::WELL;
        v.code_bg_color = color::WELL;
        v.override_text_color = None;

        // Square corners and zero drop shadows everywhere.
        v.window_corner_radius = CornerRadius::ZERO;
        v.menu_corner_radius = CornerRadius::ZERO;
        v.window_shadow = Shadow::NONE;
        v.popup_shadow = Shadow::NONE;
        v.window_stroke = Stroke::new(metric::RULE, color::RULE);

        // Non-interactive surface and neutral widget states.
        v.widgets.noninteractive.bg_fill = color::BACKGROUND_APP;
        v.widgets.noninteractive.weak_bg_fill = color::BACKGROUND_APP;
        v.widgets.noninteractive.bg_stroke = Stroke::new(metric::RULE, color::RULE);
        v.widgets.noninteractive.fg_stroke = Stroke::new(metric::RULE, color::TEXT);
        v.widgets.noninteractive.corner_radius = CornerRadius::ZERO;

        v.widgets.inactive.bg_fill = color::SURFACE;
        v.widgets.inactive.weak_bg_fill = color::SURFACE;
        v.widgets.inactive.bg_stroke = Stroke::new(metric::RULE, color::RULE);
        v.widgets.inactive.fg_stroke = Stroke::new(metric::RULE, color::TEXT_MUTED);
        v.widgets.inactive.corner_radius = CornerRadius::ZERO;

        v.widgets.hovered.bg_fill = color::SURFACE_HOVER;
        v.widgets.hovered.weak_bg_fill = color::SURFACE_HOVER;
        v.widgets.hovered.bg_stroke = Stroke::new(metric::RULE, color::TEXT_MUTED);
        v.widgets.hovered.fg_stroke = Stroke::new(metric::RULE, color::TEXT);
        v.widgets.hovered.corner_radius = CornerRadius::ZERO;

        v.widgets.active.bg_fill = color::SURFACE_HOVER;
        v.widgets.active.weak_bg_fill = color::SURFACE_HOVER;
        v.widgets.active.bg_stroke = Stroke::new(metric::RULE, color::FOCUS);
        v.widgets.active.fg_stroke = Stroke::new(metric::RULE, color::TEXT);
        v.widgets.active.corner_radius = CornerRadius::ZERO;

        v.widgets.open.bg_fill = color::SURFACE;
        v.widgets.open.weak_bg_fill = color::SURFACE;
        v.widgets.open.bg_stroke = Stroke::new(metric::RULE, color::FOCUS);
        v.widgets.open.fg_stroke = Stroke::new(metric::RULE, color::TEXT);
        v.widgets.open.corner_radius = CornerRadius::ZERO;

        // Selection and focus accent strictly in bronze.
        v.selection.bg_fill = color::ACCENT_TINT;
        v.selection.stroke = Stroke::new(metric::RULE, color::FOCUS);
        v.text_cursor.stroke = Stroke::new(1.5, color::TEXT);
        v.text_cursor.blink = false;
        v.hyperlink_color = color::TEXT;

        style.spacing.item_spacing = vec2(sternbild_tokens::space::S2 * scale, sternbild_tokens::space::S1 * scale);
        style.spacing.button_padding = vec2(sternbild_tokens::space::S2 * scale, sternbild_tokens::space::S1 * scale);
        style.spacing.window_margin = egui::Margin::same((metric::PAD * scale).round() as i8);
        style.spacing.scroll = egui::style::ScrollStyle {
            floating: false,
            bar_width: metric::SCROLLBAR,
            bar_inner_margin: 2.0,
            bar_outer_margin: 1.0,
            ..egui::style::ScrollStyle::solid()
        };
    });
}

// ---------------------------------------------------------------------------
// Text layout helpers

/// Builds a single-line [`LayoutJob`] with explicit font, color, and tracking.
pub fn job(text: &str, font: FontId, text_color: Color32, tracking: f32) -> LayoutJob {
    let mut out = LayoutJob::default();
    out.append(
        text,
        0.0,
        TextFormat { font_id: font, extra_letter_spacing: tracking, color: text_color, ..Default::default() },
    );
    out
}

/// Builds an uppercase tracked UI label (`IBM Plex Sans Condensed`, column heads, section titles, pane titles).
pub fn label_job(text: &str, text_color: Color32) -> LayoutJob {
    let upper = text.to_ascii_uppercase();
    job(
        &upper,
        FontId::new(font_size::LABEL, ui_family()),
        text_color,
        sternbild_tokens::tracking::UI_LABEL * font_size::LABEL,
    )
}

/// Builds a monospace tabular value job.
pub fn mono_job(text: &str, size: f32, text_color: Color32) -> LayoutJob {
    job(text, FontId::new(size, mono_family()), text_color, 0.0)
}

/// Builds a proportional sans-serif job using the regular or secondary UI family.
pub fn sans_job(text: &str, size: f32, text_color: Color32, medium: bool) -> LayoutJob {
    let family = if medium { medium_family() } else { ui_family() };
    job(text, FontId::new(size, family), text_color, 0.0)
}

/// Builds a tracked uppercase wordmark job using `Sternbild Display`.
pub fn wordmark_job(text: &str, text_color: Color32) -> LayoutJob {
    let upper = text.to_ascii_uppercase();
    job(
        &upper,
        FontId::new(font_size::WORDMARK, display_family()),
        text_color,
        sternbild_tokens::tracking::APP_WORDMARK * font_size::WORDMARK,
    )
}

/// Paints `layout_job` vertically centered in `rect`, aligned horizontally by `align`.
///
/// When `truncate` is true, overflowing text truncates with an ellipsis inside `rect`.
/// Returns the laid-out width of the painted text.
pub fn paint_job(painter: &Painter, rect: Rect, mut layout_job: LayoutJob, align: Align, truncate: bool) -> f32 {
    if truncate {
        layout_job.wrap = TextWrapping::truncate_at_width(rect.width().max(1.0));
    }
    let galley = painter.layout_job(layout_job);
    let size = galley.size();
    let x = match align {
        Align::Min => rect.left(),
        Align::Center => rect.center().x - size.x * 0.5,
        Align::Max => rect.right() - size.x,
    };
    let y = (rect.center().y - size.y * 0.5).round();
    painter.with_clip_rect(rect.intersect(painter.clip_rect())).galley(pos2(x.floor(), y), galley, Color32::PLACEHOLDER);
    size.x
}

/// Measures the horizontal width of `layout_job` without painting it.
pub fn job_width(ui: &Ui, layout_job: LayoutJob) -> f32 {
    ui.painter().layout_job(layout_job).size().x
}
