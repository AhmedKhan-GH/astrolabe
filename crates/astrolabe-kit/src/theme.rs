//! Theme installation, font configuration, and text layout helpers.
//!
//! Installs a quiet Sternbild workstation style: dark mineral surfaces, square
//! corners, 1 px rules, zero motion, and tabular monospace figures.

use std::sync::Arc;

use egui::{
    Align, Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Id, Painter, Rect, Shadow, Stroke,
    TextFormat, Theme, Ui, pos2, style::ScrollAnimation, text::LayoutJob, text::TextWrapping, vec2,
};

use crate::tokens::{color, font_size, metric};

const SCALE_KEY: &str = "astrolabe_kit_text_scale";

/// Optional owned font bytes overriding system font discovery.
#[derive(Clone, Debug, Default)]
pub struct FontConfig {
    /// Regular UI sans-serif bytes (`.ttf` / `.otf` / `.ttc`).
    pub ui: Option<Vec<u8>>,
    /// Medium-weight UI sans-serif bytes.
    pub medium: Option<Vec<u8>>,
    /// Monospace font bytes for tabular figures and identifiers.
    pub mono: Option<Vec<u8>>,
    /// Optional wordmark display font bytes.
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

/// Primary UI proportional font family.
pub fn ui_family() -> FontFamily {
    FontFamily::Proportional
}

/// Medium-weight UI proportional font family.
pub fn medium_family() -> FontFamily {
    FontFamily::Name("medium".into())
}

/// Monospace font family with uniform tabular figure widths.
pub fn mono_family() -> FontFamily {
    FontFamily::Monospace
}

/// Wordmark display font family (falls back to medium UI sans when absent).
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

    let ui_face = cfg
        .ui
        .clone()
        .map(|b| Arc::new(FontData::from_owned(b)))
        .or_else(|| load_system_face("/System/Library/Fonts/HelveticaNeue.ttc", 0));

    let medium_face = cfg
        .medium
        .clone()
        .map(|b| Arc::new(FontData::from_owned(b)))
        .or_else(|| load_system_face("/System/Library/Fonts/HelveticaNeue.ttc", 10));

    let mono_face = cfg
        .mono
        .clone()
        .map(|b| Arc::new(FontData::from_owned(b)))
        .or_else(|| load_system_face("/System/Library/Fonts/Menlo.ttc", 0));

    let symbols_face = load_system_face("/System/Library/Fonts/Apple Symbols.ttf", 0)
        .or_else(|| load_system_face("/System/Library/Fonts/Supplemental/Apple Symbols.ttf", 0));

    let display_face = cfg.display.clone().map(|b| Arc::new(FontData::from_owned(b)));

    if let Some(face) = ui_face {
        fonts.font_data.insert("kit-sans".into(), face);
        fonts.families.entry(FontFamily::Proportional).or_default().insert(0, "kit-sans".into());
    }

    let mut medium_list = Vec::new();
    if let Some(face) = medium_face {
        fonts.font_data.insert("kit-medium".into(), face);
        medium_list.push("kit-medium".to_owned());
    }

    if let Some(face) = mono_face {
        fonts.font_data.insert("kit-mono".into(), face);
        fonts.families.entry(FontFamily::Monospace).or_default().insert(0, "kit-mono".into());
        // Supply arrows, key symbols, and tabular glyphs behind proportional sans.
        fonts.families.entry(FontFamily::Proportional).or_default().push("kit-mono".into());
    }

    if let Some(face) = symbols_face {
        fonts.font_data.insert("kit-symbols".into(), face);
        fonts.families.entry(FontFamily::Proportional).or_default().push("kit-symbols".into());
        fonts.families.entry(FontFamily::Monospace).or_default().push("kit-symbols".into());
    }

    let prop_fallbacks = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    medium_list.extend(prop_fallbacks);

    let mut display_list = Vec::new();
    if let Some(face) = display_face {
        fonts.font_data.insert("kit-display".into(), face);
        display_list.push("kit-display".to_owned());
    }
    display_list.extend(medium_list.iter().cloned());

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
        v.panel_fill = color::GROUND;
        v.window_fill = color::GROUND;
        v.faint_bg_color = color::PLATE;
        v.extreme_bg_color = color::DEEP;
        v.code_bg_color = color::DEEP;
        v.override_text_color = None;

        // Square corners and zero drop shadows everywhere.
        v.window_corner_radius = CornerRadius::ZERO;
        v.menu_corner_radius = CornerRadius::ZERO;
        v.window_shadow = Shadow::NONE;
        v.popup_shadow = Shadow::NONE;
        v.window_stroke = Stroke::new(metric::RULE, color::RULE);

        // Non-interactive surface and neutral widget states.
        v.widgets.noninteractive.bg_fill = color::GROUND;
        v.widgets.noninteractive.weak_bg_fill = color::GROUND;
        v.widgets.noninteractive.bg_stroke = Stroke::new(metric::RULE, color::RULE);
        v.widgets.noninteractive.fg_stroke = Stroke::new(metric::RULE, color::PARCHMENT);
        v.widgets.noninteractive.corner_radius = CornerRadius::ZERO;

        v.widgets.inactive.bg_fill = color::PLATE;
        v.widgets.inactive.weak_bg_fill = color::PLATE;
        v.widgets.inactive.bg_stroke = Stroke::new(metric::RULE, color::RULE);
        v.widgets.inactive.fg_stroke = Stroke::new(metric::RULE, color::SECONDARY);
        v.widgets.inactive.corner_radius = CornerRadius::ZERO;

        v.widgets.hovered.bg_fill = color::PLATE_HOVER;
        v.widgets.hovered.weak_bg_fill = color::PLATE_HOVER;
        v.widgets.hovered.bg_stroke = Stroke::new(metric::RULE, color::SECONDARY);
        v.widgets.hovered.fg_stroke = Stroke::new(metric::RULE, color::PARCHMENT);
        v.widgets.hovered.corner_radius = CornerRadius::ZERO;

        v.widgets.active.bg_fill = color::PLATE_HOVER;
        v.widgets.active.weak_bg_fill = color::PLATE_HOVER;
        v.widgets.active.bg_stroke = Stroke::new(metric::RULE, color::BRONZE);
        v.widgets.active.fg_stroke = Stroke::new(metric::RULE, color::PARCHMENT);
        v.widgets.active.corner_radius = CornerRadius::ZERO;

        v.widgets.open.bg_fill = color::PLATE;
        v.widgets.open.weak_bg_fill = color::PLATE;
        v.widgets.open.bg_stroke = Stroke::new(metric::RULE, color::BRONZE);
        v.widgets.open.fg_stroke = Stroke::new(metric::RULE, color::PARCHMENT);
        v.widgets.open.corner_radius = CornerRadius::ZERO;

        // Selection and focus accent strictly in bronze.
        v.selection.bg_fill = color::BRONZE_TINT;
        v.selection.stroke = Stroke::new(metric::RULE, color::BRONZE);
        v.text_cursor.stroke = Stroke::new(1.5, color::PARCHMENT);
        v.text_cursor.blink = false;
        v.hyperlink_color = color::PARCHMENT;

        style.spacing.item_spacing = vec2(8.0 * scale, 4.0 * scale);
        style.spacing.button_padding = vec2(8.0 * scale, 4.0 * scale);
        style.spacing.window_margin = egui::Margin::same((metric::PAD * scale).round() as i8);
        style.spacing.scroll = egui::style::ScrollStyle {
            floating: false,
            bar_width: 6.0,
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

/// Builds an uppercase tracked monospace label (column heads, section titles, pane titles).
pub fn label_job(text: &str, text_color: Color32) -> LayoutJob {
    let upper = text.to_ascii_uppercase();
    job(&upper, FontId::new(font_size::LABEL, mono_family()), text_color, metric::TRACKING)
}

/// Builds a monospace tabular value job.
pub fn mono_job(text: &str, size: f32, text_color: Color32) -> LayoutJob {
    job(text, FontId::new(size, mono_family()), text_color, 0.0)
}

/// Builds a proportional sans-serif job in regular or medium weight.
pub fn sans_job(text: &str, size: f32, text_color: Color32, medium: bool) -> LayoutJob {
    let family = if medium { medium_family() } else { ui_family() };
    job(text, FontId::new(size, family), text_color, 0.0)
}

/// Builds a tracked uppercase wordmark job using the display family.
pub fn wordmark_job(text: &str, text_color: Color32) -> LayoutJob {
    let upper = text.to_ascii_uppercase();
    job(&upper, FontId::new(font_size::WORDMARK, display_family()), text_color, 1.8)
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
