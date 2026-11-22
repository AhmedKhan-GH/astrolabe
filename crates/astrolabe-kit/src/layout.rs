//! Pure rectangle layout geometry for workstation shells and tiled panes.
//!
//! All pane bounds are computed from plain [`egui::Rect`] values without requiring
//! a live window, so layout invariants can be verified in unit tests across
//! viewport sizes.

use egui::{Align, AsIdSalt, Layout, Rect, Ui, UiBuilder, pos2, vec2};

use crate::tokens::metric;

/// Shell chrome dimensions and sidebar proportions.
#[derive(Clone, Copy, Debug)]
pub struct ShellSpec {
    pub command_bar_h: f32,
    pub status_bar_h: f32,
    pub sidebar_share: f32,
    pub sidebar_min: f32,
    pub sidebar_max: f32,
    pub show_sidebar: bool,
}

impl Default for ShellSpec {
    fn default() -> Self {
        Self {
            command_bar_h: metric::COMMAND_BAR,
            status_bar_h: metric::STATUS_BAR,
            sidebar_share: 0.16,
            sidebar_min: metric::SIDEBAR_MIN,
            sidebar_max: metric::SIDEBAR_MAX,
            show_sidebar: true,
        }
    }
}

/// Computed rectangles for the outer workstation chrome and inner workspace.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShellRects {
    pub full: Rect,
    pub command_bar: Rect,
    pub status_bar: Rect,
    pub sidebar: Option<Rect>,
    pub workspace: Rect,
}

impl ShellSpec {
    /// Computes shell strip and pane rectangles inside `full`.
    pub fn compute(&self, full: Rect) -> ShellRects {
        let cmd_h = self.command_bar_h.min(full.height()).max(0.0).floor();
        let remaining_after_cmd = (full.height() - cmd_h).max(0.0);
        let status_h = self.status_bar_h.min(remaining_after_cmd).max(0.0).floor();

        let command_bar = Rect::from_min_size(full.min, vec2(full.width(), cmd_h));
        let status_bar = Rect::from_min_max(pos2(full.left(), (full.bottom() - status_h).floor()), full.max);
        let body = Rect::from_min_max(pos2(full.left(), command_bar.bottom()), pos2(full.right(), status_bar.top()));

        let (sidebar, workspace) = if self.show_sidebar && body.width() > self.sidebar_min + 120.0 {
            let max_w = self.sidebar_max.min((body.width() - 120.0).max(self.sidebar_min));
            let w = (body.width() * self.sidebar_share).clamp(self.sidebar_min, max_w).floor();
            let sb = Rect::from_min_size(body.min, vec2(w, body.height()));
            let ws = Rect::from_min_max(pos2(sb.right(), body.top()), body.max);
            (Some(sb), ws)
        } else {
            (None, body)
        };

        ShellRects { full, command_bar, status_bar, sidebar, workspace }
    }
}

/// Splits `rect` into left and right panes by `left_share`, respecting minimum widths.
pub fn split_horizontal(rect: Rect, left_share: f32, left_min: f32, right_min: f32) -> (Rect, Rect) {
    let total = rect.width().max(0.0);
    let max_left = (total - right_min).max(left_min.min(total));
    let left_w = (total * left_share).clamp(left_min.min(total), max_left).floor();
    let left = Rect::from_min_size(rect.min, vec2(left_w, rect.height()));
    let right = Rect::from_min_max(pos2(left.right(), rect.top()), rect.max);
    (left, right)
}

/// Splits `rect` into top and bottom panes by `top_share`, respecting minimum heights.
pub fn split_vertical(rect: Rect, top_share: f32, top_min: f32, bottom_min: f32) -> (Rect, Rect) {
    let total = rect.height().max(0.0);
    let max_top = (total - bottom_min).max(top_min.min(total));
    let top_h = (total * top_share).clamp(top_min.min(total), max_top).floor();
    let top = Rect::from_min_size(rect.min, vec2(rect.width(), top_h));
    let bottom = Rect::from_min_max(pos2(rect.left(), top.bottom()), rect.max);
    (top, bottom)
}

/// Divides `rect` horizontally into `cols` equal cells separated by `gap` logical px.
pub fn grid_rects(rect: Rect, cols: usize, gap: f32) -> Vec<Rect> {
    if cols == 0 {
        return Vec::new();
    }
    let total_gap = gap * (cols.saturating_sub(1) as f32);
    let cell_w = ((rect.width() - total_gap).max(0.0) / cols as f32).floor();
    (0..cols)
        .map(|i| {
            let left = rect.left() + i as f32 * (cell_w + gap);
            let right = if i + 1 == cols { rect.right() } else { left + cell_w };
            Rect::from_min_max(pos2(left, rect.top()), pos2(right.max(left), rect.bottom()))
        })
        .collect()
}

/// Creates a clipped child [`Ui`] occupying `rect` with top-down layout.
pub fn pane_child<R>(ui: &mut Ui, id_salt: impl AsIdSalt, rect: Rect, add: impl FnOnce(&mut Ui) -> R) -> R {
    let mut child =
        ui.new_child(UiBuilder::new().id_salt(id_salt).max_rect(rect).layout(Layout::top_down(Align::Min)));
    child.set_clip_rect(rect.intersect(ui.clip_rect()));
    add(&mut child)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_layout_holds_at_1440_and_2560() {
        for (w, h) in [(1440.0, 900.0), (2560.0, 1440.0)] {
            let full = Rect::from_min_size(pos2(0.0, 0.0), vec2(w, h));
            let shell = ShellSpec::default().compute(full);

            assert_eq!(shell.command_bar.height(), metric::COMMAND_BAR);
            assert_eq!(shell.status_bar.height(), metric::STATUS_BAR);
            assert_eq!(shell.command_bar.top(), 0.0);
            assert_eq!(shell.status_bar.bottom(), h);

            let sb = shell.sidebar.expect("sidebar visible on desktop viewport");
            assert!(sb.width() >= metric::SIDEBAR_MIN && sb.width() <= metric::SIDEBAR_MAX);
            assert_eq!(sb.top(), shell.command_bar.bottom());
            assert_eq!(sb.bottom(), shell.status_bar.top());
            assert_eq!(shell.workspace.left(), sb.right());
            assert_eq!(shell.workspace.right(), w);
            assert!(shell.workspace.width() > w * 0.75);

            // Verify tiled splits stay non-overlapping and cover the full workspace.
            let (main, side) = split_horizontal(shell.workspace, 0.66, 480.0, 320.0);
            assert_eq!(main.right(), side.left());
            assert_eq!(main.width() + side.width(), shell.workspace.width());
            let (inspector, ops) = split_vertical(side, 0.64, 240.0, 160.0);
            assert_eq!(inspector.bottom(), ops.top());
            assert_eq!(inspector.height() + ops.height(), side.height());
        }
    }

    #[test]
    fn grid_rects_span_full_width() {
        let row = Rect::from_min_size(pos2(10.0, 20.0), vec2(800.0, 72.0));
        let cells = grid_rects(row, 4, 8.0);
        assert_eq!(cells.len(), 4);
        assert_eq!(cells[0].left(), row.left());
        assert_eq!(cells[3].right(), row.right());
        for w in cells.windows(2) {
            assert_eq!(w[1].left() - w[0].right(), 8.0);
        }
    }
}
