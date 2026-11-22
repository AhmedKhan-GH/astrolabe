//! Design tokens for the Sternbild workstation visual identity.
//!
//! Surfaces are monochrome warm mineral tones separated by 1 px rules.
//! Bronze (`color::BRONZE`) is reserved strictly for focus and active selection.

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
            StatusTone::Neutral => color::SECONDARY,
        }
    }

    /// Returns the subtle background tint for an outlined chip in this tone.
    pub fn chip_fill(self) -> Color32 {
        match self {
            StatusTone::Neutral => color::with_alpha(color::SECONDARY, 16),
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

    // Dark mineral surfaces.
    /// Recessed surfaces: status bar, input wells, and plot fields.
    pub const DEEP: Color32 = Color32::from_rgb(0x12, 0x11, 0x0f);
    /// Window and pane ground.
    pub const GROUND: Color32 = Color32::from_rgb(0x18, 0x17, 0x15);
    /// Pane headers, selected rows, menus, and summary tile surfaces.
    pub const PLATE: Color32 = Color32::from_rgb(0x20, 0x1f, 0x1c);
    /// Hovered row, button, or interactive plate.
    pub const PLATE_HOVER: Color32 = Color32::from_rgb(0x2a, 0x29, 0x25);

    // 1 px structural rules.
    /// Primary 1 px rules, pane dividers, and control borders.
    pub const RULE: Color32 = Color32::from_rgb(0x4b, 0x49, 0x45);
    /// Subtle interior dividers, meter tracks, and disabled outlines.
    pub const RULE_FAINT: Color32 = Color32::from_rgb(0x2c, 0x2b, 0x28);

    // Parchment neutral ink hierarchy.
    /// Primary text, active labels, and brand marks.
    pub const PARCHMENT: Color32 = Color32::from_rgb(0xe8, 0xe0, 0xd0);
    /// Secondary labels, column heads, metadata, and status text.
    pub const SECONDARY: Color32 = Color32::from_rgb(0xc1, 0xba, 0xaa);
    /// Placeholders, disabled ink, zero counts, and booktabs outer rules.
    pub const FAINT: Color32 = Color32::from_rgb(0x8f, 0x89, 0x7c);

    // Single chrome accent.
    /// Focus and active selection only. Never use for decorative chrome or data status.
    pub const BRONZE: Color32 = Color32::from_rgb(0xb3, 0x8b, 0x59);
    /// Low-alpha bronze wash for text selection ranges (premultiplied `#B38B59` at alpha 56).
    pub const BRONZE_TINT: Color32 = Color32::from_rgba_premultiplied(39, 31, 20, 56);

    // Data-only semantic pigments (calibrated for dark mineral ground, distinct from bronze).
    /// Nominal, active, or healthy state.
    pub const OK: Color32 = Color32::from_rgb(0x4c, 0xa9, 0x86);
    /// Queued, running, or informational state.
    pub const INFO: Color32 = Color32::from_rgb(0x61, 0x95, 0xcc);
    /// Warning or elevated usage state (distinct gold-ochre, separate from bronze).
    pub const WARN: Color32 = Color32::from_rgb(0xd9, 0xb8, 0x4e);
    /// Failure, fault, or critical threshold state.
    pub const ERROR: Color32 = Color32::from_rgb(0xd8, 0x64, 0x5e);

    // Plot series pigments (Sternbild fixed data order; data only, never chrome).
    pub const SERIES_BLUE: Color32 = Color32::from_rgb(0x46, 0x77, 0xad);
    pub const SERIES_TEAL: Color32 = Color32::from_rgb(0x3c, 0xa9, 0x9c);
    pub const SERIES_OCHRE: Color32 = Color32::from_rgb(0x86, 0x74, 0x24);
    pub const SERIES_ROSE: Color32 = Color32::from_rgb(0xa3, 0x5a, 0x74);
    pub const SERIES_STONE: Color32 = Color32::from_rgb(0x55, 0x52, 0x4c);
    pub const SERIES: [Color32; 5] = [SERIES_BLUE, SERIES_TEAL, SERIES_OCHRE, SERIES_ROSE, SERIES_STONE];

    /// Returns `c` with its alpha channel replaced by `alpha`.
    pub fn with_alpha(c: Color32, alpha: u8) -> Color32 {
        Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), alpha)
    }
}

/// Logical pixel metrics at `text_scale = 1.0`.
pub mod metric {
    /// Standard data table row height.
    pub const ROW: f32 = 28.0;
    /// Compact data table row height for dense secondary tables.
    pub const ROW_COMPACT: f32 = 24.0;
    /// Table header row height.
    pub const TABLE_HEADER: f32 = 24.0;
    /// Pane header strip height.
    pub const PANE_HEADER: f32 = 26.0;
    /// Top command bar height.
    pub const COMMAND_BAR: f32 = 34.0;
    /// Bottom persistent status bar height.
    pub const STATUS_BAR: f32 = 24.0;
    /// Default sidebar navigation rail width.
    pub const SIDEBAR_DEFAULT: f32 = 216.0;
    /// Minimum sidebar navigation rail width.
    pub const SIDEBAR_MIN: f32 = 180.0;
    /// Maximum sidebar navigation rail width.
    pub const SIDEBAR_MAX: f32 = 280.0;
    /// Standard pane inner padding.
    pub const PAD: f32 = 10.0;
    /// Standard horizontal spacing between inline items.
    pub const GAP: f32 = 12.0;
    /// Height of a key button.
    pub const KEY_BUTTON_H: f32 = 22.0;
    /// Default height of a primary action button.
    pub const PRIMARY_BUTTON_H: f32 = 24.0;
    /// Width and thickness of every structural rule.
    pub const RULE: f32 = 1.0;
    /// Left accent bar width on selected rows and sidebar items.
    pub const SELECTION_BAR: f32 = 2.0;
    /// Extra letter spacing in logical px for uppercase tracked labels.
    pub const TRACKING: f32 = 0.85;
    /// Sidebar item row height.
    pub const SIDEBAR_ROW: f32 = 24.0;
    /// Sidebar section heading height.
    pub const SIDEBAR_HEADING: f32 = 26.0;
    /// Key-value field row height in inspectors.
    pub const FIELD_ROW: f32 = 22.0;
    /// Summary metric tile height.
    pub const TILE_H: f32 = 72.0;
}

/// Logical typography scale at `text_scale = 1.0`.
pub mod font_size {
    /// Masthead uppercase wordmark.
    pub const WORDMARK: f32 = 13.5;
    /// Item or tile header title.
    pub const TITLE: f32 = 14.5;
    /// Body text, sidebar labels, and table strings.
    pub const BODY: f32 = 13.0;
    /// Uppercase tracked column heads, pane headers, and section titles.
    pub const LABEL: f32 = 10.5;
    /// Monospace tabular figures, identifiers, and command input.
    pub const MONO: f32 = 12.0;
    /// Compact monospace counts, shortcut keys, and status strip items.
    pub const MONO_SMALL: f32 = 11.0;
    /// Hero numeric value inside metric summary tiles.
    pub const METRIC_VALUE: f32 = 20.0;
    /// Compact uppercase status chip label.
    pub const CHIP: f32 = 10.0;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bronze_is_distinct_from_all_status_tones() {
        for tone in [StatusTone::Ok, StatusTone::Info, StatusTone::Warn, StatusTone::Error, StatusTone::Neutral] {
            assert_ne!(tone.color(), color::BRONZE, "status tone {tone:?} must not reuse bronze");
        }
    }

    #[test]
    fn dark_mineral_surfaces_progress_in_luminance() {
        let lum = |c: Color32| u32::from(c.r()) + u32::from(c.g()) + u32::from(c.b());
        assert!(lum(color::DEEP) < lum(color::GROUND));
        assert!(lum(color::GROUND) < lum(color::PLATE));
        assert!(lum(color::PLATE) < lum(color::PLATE_HOVER));
        assert!(lum(color::FAINT) < lum(color::SECONDARY));
        assert!(lum(color::SECONDARY) < lum(color::PARCHMENT));
    }
}
