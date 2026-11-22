//! Design tokens for the Sternbild workstation visual identity.
//!
//! Every color, spacing metric, rule width, tracking ratio, and type size
//! comes directly from `sternbild_tokens`. Bronze (`color::ACCENT` / `color::FOCUS`)
//! is reserved strictly for focus and active selection.

use egui::Color32;

/// Semantic status tone for data badges, status chips, and usage meters.
///
/// Data pigments stay distinct from the bronze focus and selection accent.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum StatusTone {
    Ok,
    Info,
    Warn,
    Error,
    #[default]
    Neutral,
}

impl StatusTone {
    /// Returns the foreground mineral pigment for this status tone.
    pub const fn color(self) -> Color32 {
        match self {
            StatusTone::Ok => color::OK,
            StatusTone::Info => color::INFO,
            StatusTone::Warn => color::WARN,
            StatusTone::Error => color::ERROR,
            StatusTone::Neutral => color::TEXT_MUTED,
        }
    }

    /// Returns the subtle background tint for an outlined chip in this tone.
    pub fn chip_fill(self) -> Color32 {
        match self {
            StatusTone::Neutral => color::with_alpha(color::TEXT_MUTED, 16),
            _ => color::with_alpha(self.color(), 24),
        }
    }

    /// Returns the 1 px outline color for a chip in this tone.
    pub fn chip_stroke(self) -> Color32 {
        match self {
            StatusTone::Neutral => color::RULE,
            _ => color::with_alpha(self.color(), 145),
        }
    }
}

/// Color tokens for surfaces, rules, typography, focus accent, and data pigments.
pub mod color {
    use egui::Color32;

    const fn from_token(c: sternbild_tokens::Color) -> Color32 {
        Color32::from_rgb(c.r, c.g, c.b)
    }

    const fn premultiply_channel(channel: u8, alpha: u8) -> u8 {
        ((channel as u16 * alpha as u16 + 127) / 255) as u8
    }

    const fn premultiply(c: Color32, alpha: u8) -> Color32 {
        Color32::from_rgba_premultiplied(
            premultiply_channel(c.r(), alpha),
            premultiply_channel(c.g(), alpha),
            premultiply_channel(c.b(), alpha),
            alpha,
        )
    }

    // Canonical Sternbild role surfaces.
    /// Window and pane ground (`role::BACKGROUND_APP`).
    pub const BACKGROUND_APP: Color32 = from_token(sternbild_tokens::role::BACKGROUND_APP);
    /// Recessed surfaces: status bar, input wells, and plot fields (`role::WELL`).
    pub const WELL: Color32 = from_token(sternbild_tokens::role::WELL);
    /// Pane headers, menus, controls, and summary tile surfaces (`role::SURFACE`).
    pub const SURFACE: Color32 = from_token(sternbild_tokens::role::SURFACE);
    /// Hovered row, button, or interactive plate (`role::SURFACE_HOVER`).
    pub const SURFACE_HOVER: Color32 = from_token(sternbild_tokens::role::SURFACE_HOVER);
    /// Active selected row or sidebar item surface (`role::SELECTED`).
    pub const SELECTED: Color32 = from_token(sternbild_tokens::role::SELECTED);

    // 1 px structural rules.
    /// Primary 1 px rules, pane dividers, and control borders (`role::RULE`).
    pub const RULE: Color32 = from_token(sternbild_tokens::role::RULE);
    /// Subtle interior dividers, meter tracks, and disabled outlines (`role::RULE_FAINT`).
    pub const RULE_FAINT: Color32 = from_token(sternbild_tokens::role::RULE_FAINT);

    // Neutral parchment ink hierarchy.
    /// Primary text, active labels, and brand marks (`role::TEXT`).
    pub const TEXT: Color32 = from_token(sternbild_tokens::role::TEXT);
    /// Secondary labels, column heads, metadata, and status text (`role::TEXT_MUTED`).
    pub const TEXT_MUTED: Color32 = from_token(sternbild_tokens::role::TEXT_MUTED);
    /// Placeholders, disabled ink, zero counts, and booktabs outer rules (`role::TEXT_FAINT`).
    pub const TEXT_FAINT: Color32 = from_token(sternbild_tokens::role::TEXT_FAINT);

    // Single chrome accent.
    /// Active selection accent (`role::ACCENT`). Never use for decorative chrome or data status.
    pub const ACCENT: Color32 = from_token(sternbild_tokens::role::ACCENT);
    /// Keyboard focus outline and ring (`role::FOCUS`).
    pub const FOCUS: Color32 = from_token(sternbild_tokens::role::FOCUS);
    /// Low-alpha accent wash for text selection ranges (premultiplied `ACCENT` at alpha 56).
    pub const ACCENT_TINT: Color32 = premultiply(ACCENT, 56);

    // Compatibility aliases mapped onto canonical role tokens.
    pub const DEEP: Color32 = WELL;
    pub const GROUND: Color32 = BACKGROUND_APP;
    pub const PLATE: Color32 = SURFACE;
    pub const PLATE_HOVER: Color32 = SURFACE_HOVER;
    pub const PARCHMENT: Color32 = TEXT;
    pub const SECONDARY: Color32 = TEXT_MUTED;
    pub const FAINT: Color32 = TEXT_FAINT;
    pub const BRONZE: Color32 = ACCENT;
    pub const BRONZE_TINT: Color32 = ACCENT_TINT;

    // Data-only semantic pigments from `sternbild_tokens::data`.
    /// Nominal, active, or healthy state (`data::VERDIGRIS`).
    pub const OK: Color32 = from_token(sternbild_tokens::data::VERDIGRIS);
    /// Queued, running, or informational state (`data::SMALT`).
    pub const INFO: Color32 = from_token(sternbild_tokens::data::SMALT);
    /// Warning or elevated usage state (`data::OLIVE_OCHRE`).
    pub const WARN: Color32 = from_token(sternbild_tokens::data::OLIVE_OCHRE);
    /// Failure, fault, or critical threshold state (`data::MADDER`).
    pub const ERROR: Color32 = from_token(sternbild_tokens::data::MADDER);

    // Plot series pigments (Sternbild fixed data order; data only, never chrome).
    pub const SERIES_BLUE: Color32 = from_token(sternbild_tokens::data::SMALT);
    pub const SERIES_TEAL: Color32 = from_token(sternbild_tokens::data::VERDIGRIS);
    pub const SERIES_OCHRE: Color32 = from_token(sternbild_tokens::data::OLIVE_OCHRE);
    pub const SERIES_ROSE: Color32 = from_token(sternbild_tokens::data::MADDER);
    pub const SERIES_STONE: Color32 = from_token(sternbild_tokens::data::SLATE);
    pub const SERIES: [Color32; 5] = [SERIES_BLUE, SERIES_TEAL, SERIES_OCHRE, SERIES_ROSE, SERIES_STONE];

    /// Returns `c` with its alpha channel replaced by `alpha`.
    pub fn with_alpha(c: Color32, alpha: u8) -> Color32 {
        Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), alpha)
    }
}

/// Logical pixel metrics at `text_scale = 1.0`, derived from `sternbild_tokens`.
pub mod metric {
    use super::font_size;

    /// Standard data table row height (`app::ROW`).
    pub const ROW: f32 = sternbild_tokens::app::ROW;
    /// Compact data table row height (`app::ROW`).
    pub const ROW_COMPACT: f32 = sternbild_tokens::app::ROW;
    /// Table header row height (`app::PANE_HEADER`).
    pub const TABLE_HEADER: f32 = sternbild_tokens::app::PANE_HEADER;
    /// Pane header strip height (`app::PANE_HEADER`).
    pub const PANE_HEADER: f32 = sternbild_tokens::app::PANE_HEADER;
    /// Top command bar height (`app::COMMAND_BAR`).
    pub const COMMAND_BAR: f32 = sternbild_tokens::app::COMMAND_BAR;
    /// Bottom persistent status bar height (`app::STATUS_BAR`).
    pub const STATUS_BAR: f32 = sternbild_tokens::app::STATUS_BAR;
    /// Default sidebar navigation rail width.
    pub const SIDEBAR_DEFAULT: f32 = 216.0;
    /// Minimum sidebar navigation rail width.
    pub const SIDEBAR_MIN: f32 = 180.0;
    /// Maximum sidebar navigation rail width.
    pub const SIDEBAR_MAX: f32 = 280.0;
    /// Standard pane inner padding (`app::PAD`).
    pub const PAD: f32 = sternbild_tokens::app::PAD;
    /// Standard horizontal spacing between inline items (`app::GAP`).
    pub const GAP: f32 = sternbild_tokens::app::GAP;
    /// Height of a key button (`app::KEY_BUTTON`).
    pub const KEY_BUTTON_H: f32 = sternbild_tokens::app::KEY_BUTTON;
    /// Default height of a primary action button (`app::PANE_HEADER`).
    pub const PRIMARY_BUTTON_H: f32 = sternbild_tokens::app::PANE_HEADER;
    /// Width and thickness of every structural rule (`rule::WIDTH`).
    pub const RULE: f32 = sternbild_tokens::rule::WIDTH;
    /// Focus ring offset in logical px (`app::FOCUS_OFFSET`).
    pub const FOCUS_OFFSET: f32 = sternbild_tokens::app::FOCUS_OFFSET;
    /// Scrollbar track thickness (`app::SCROLLBAR`).
    pub const SCROLLBAR: f32 = sternbild_tokens::app::SCROLLBAR;
    /// Masthead mark side length (`app::MARK`).
    pub const MARK: f32 = sternbild_tokens::app::MARK;
    /// Left accent bar width on selected rows and sidebar items.
    pub const SELECTION_BAR: f32 = 2.0;
    /// Extra letter spacing in logical px for uppercase tracked labels (`tracking::UI_LABEL * LABEL`).
    pub const TRACKING: f32 = sternbild_tokens::tracking::UI_LABEL * font_size::LABEL;
    /// Sidebar item row height (`app::ROW`).
    pub const SIDEBAR_ROW: f32 = sternbild_tokens::app::ROW;
    /// Sidebar section heading height (`app::PANE_HEADER`).
    pub const SIDEBAR_HEADING: f32 = sternbild_tokens::app::PANE_HEADER;
    /// Key-value field row height in inspectors (`app::ROW`).
    pub const FIELD_ROW: f32 = sternbild_tokens::app::ROW;
    /// Summary metric tile height (`space::S18`).
    pub const TILE_H: f32 = sternbild_tokens::space::S18;
}

/// Logical typography scale at `text_scale = 1.0`, derived from `sternbild_tokens`.
pub mod font_size {
    /// Masthead uppercase wordmark (`app::font_size::DISPLAY`).
    pub const WORDMARK: f32 = sternbild_tokens::app::font_size::DISPLAY;
    /// Item or tile header title (`font::size::DESC`).
    pub const TITLE: f32 = sternbild_tokens::font::size::DESC;
    /// Body text, sidebar labels, and table strings (`app::font_size::UI`).
    pub const BODY: f32 = sternbild_tokens::app::font_size::UI;
    /// Uppercase tracked column heads, pane headers, and section titles (`app::font_size::UI_SMALL`).
    pub const LABEL: f32 = sternbild_tokens::app::font_size::UI_SMALL;
    /// Monospace tabular figures, identifiers, and command input (`app::font_size::MONO`).
    pub const MONO: f32 = sternbild_tokens::app::font_size::MONO;
    /// Compact monospace counts, shortcut keys, and status strip items (`app::font_size::UI_SMALL`).
    pub const MONO_SMALL: f32 = sternbild_tokens::app::font_size::UI_SMALL;
    /// Hero numeric value inside metric summary tiles (`font::size::HEADING`).
    pub const METRIC_VALUE: f32 = sternbild_tokens::font::size::HEADING;
    /// Compact uppercase status chip label (`font::size::LABEL_S`).
    pub const CHIP: f32 = sternbild_tokens::font::size::LABEL_S;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accent_is_distinct_from_all_status_tones() {
        for tone in [StatusTone::Ok, StatusTone::Info, StatusTone::Warn, StatusTone::Error, StatusTone::Neutral] {
            assert_ne!(tone.color(), color::ACCENT, "status tone {tone:?} must not reuse accent");
        }
    }

    #[test]
    fn dark_mineral_surfaces_progress_in_luminance() {
        let lum = |c: Color32| u32::from(c.r()) + u32::from(c.g()) + u32::from(c.b());
        assert!(lum(color::WELL) < lum(color::BACKGROUND_APP));
        assert!(lum(color::BACKGROUND_APP) < lum(color::SURFACE));
        assert!(lum(color::SURFACE) < lum(color::SURFACE_HOVER));
        assert!(lum(color::TEXT_FAINT) < lum(color::TEXT_MUTED));
        assert!(lum(color::TEXT_MUTED) < lum(color::TEXT));
    }

    #[test]
    fn accent_tint_matches_premultiplied_accent_channels() {
        let alpha = 56u16;
        let expected_r = ((u16::from(color::ACCENT.r()) * alpha + 127) / 255) as u8;
        let expected_g = ((u16::from(color::ACCENT.g()) * alpha + 127) / 255) as u8;
        let expected_b = ((u16::from(color::ACCENT.b()) * alpha + 127) / 255) as u8;
        assert_eq!(color::ACCENT_TINT.to_array(), [expected_r, expected_g, expected_b, 56]);
        assert_eq!(color::BRONZE_TINT, color::ACCENT_TINT);
    }

    #[test]
    fn status_and_series_tokens_match_sternbild_data_palette() {
        let eq_tok = |c: Color32, tok: sternbild_tokens::Color| [c.r(), c.g(), c.b()] == tok.rgb();
        assert!(eq_tok(color::OK, sternbild_tokens::data::VERDIGRIS));
        assert!(eq_tok(color::INFO, sternbild_tokens::data::SMALT));
        assert!(eq_tok(color::WARN, sternbild_tokens::data::OLIVE_OCHRE));
        assert!(eq_tok(color::ERROR, sternbild_tokens::data::MADDER));
        assert!(eq_tok(color::SERIES_STONE, sternbild_tokens::data::SLATE));
        for (kit_c, tok_c) in color::SERIES.iter().zip(sternbild_tokens::data::SERIES.iter()) {
            assert!(eq_tok(*kit_c, *tok_c));
        }
    }
}
