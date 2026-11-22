//! Crisp 1 px vector drawing primitives for Sternbild chrome and data widgets.
//!
//! Structural rules use pixel-snapped 1 px filled rectangles to avoid anti-aliasing
//! fringe across HiDPI and 1x displays.

use egui::{Color32, Painter, Pos2, Rect, Shape, Stroke, StrokeKind, pos2, vec2};

/// Built-in 1 px geometric icons for navigation rails, headers, and summary tiles.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum IconKind {
    Grid,
    Layers,
    Document,
    Pulse,
    Folder,
    Search,
    Clock,
    Cpu,
    Link,
    Database,
    Filter,
}

/// Draws a crisp 1 px horizontal rule from `x0` to `x1` along row `y`.
pub fn rule_h(painter: &Painter, x0: f32, x1: f32, y: f32, color: Color32) {
    let (left, right) = if x0 <= x1 { (x0.floor(), x1.floor()) } else { (x1.floor(), x0.floor()) };
    let y = y.floor();
    if right > left {
        painter.rect_filled(Rect::from_min_max(pos2(left, y), pos2(right, y + 1.0)), 0.0, color);
    }
}

/// Draws a crisp 1 px vertical rule along column `x` from `y0` to `y1`.
pub fn rule_v(painter: &Painter, x: f32, y0: f32, y1: f32, color: Color32) {
    let x = x.floor();
    let (top, bottom) = if y0 <= y1 { (y0.floor(), y1.floor()) } else { (y1.floor(), y0.floor()) };
    if bottom > top {
        painter.rect_filled(Rect::from_min_max(pos2(x, top), pos2(x + 1.0, bottom)), 0.0, color);
    }
}

/// Draws a pixel-snapped 1 px square outline strictly inside `rect`.
pub fn box_outline(painter: &Painter, rect: Rect, color: Color32) {
    let x0 = rect.left().floor();
    let y0 = rect.top().floor();
    let x1 = rect.right().floor();
    let y1 = rect.bottom().floor();
    if x1 - x0 < 2.0 || y1 - y0 < 2.0 {
        return;
    }
    rule_h(painter, x0, x1, y0, color);
    rule_h(painter, x0, x1, y1 - 1.0, color);
    rule_v(painter, x0, y0 + 1.0, y1 - 1.0, color);
    rule_v(painter, x1 - 1.0, y0 + 1.0, y1 - 1.0, color);
}

/// Draws a 45-degree rotated diamond status marker (`filled` when live, outlined when idle).
pub fn diamond(painter: &Painter, center: Pos2, half: f32, color: Color32, filled: bool) {
    let cx = center.x.floor() + 0.5;
    let cy = center.y.floor() + 0.5;
    let pts = vec![pos2(cx, cy - half), pos2(cx + half, cy), pos2(cx, cy + half), pos2(cx - half, cy)];
    if filled {
        painter.add(Shape::convex_polygon(pts, color, Stroke::NONE));
    } else {
        painter.add(Shape::closed_line(pts, Stroke::new(1.0, color)));
    }
}

/// Draws a small fold/unfold triangle for tree rows in a sidebar rail.
pub fn disclosure(painter: &Painter, center: Pos2, open: bool, color: Color32) {
    let pts = if open {
        vec![center + vec2(-3.5, -1.8), center + vec2(3.5, -1.8), center + vec2(0.0, 2.4)]
    } else {
        vec![center + vec2(-1.8, -3.5), center + vec2(-1.8, 3.5), center + vec2(2.4, 0.0)]
    };
    painter.add(Shape::convex_polygon(pts, color, Stroke::NONE));
}

/// Draws a crisp 1 px sort direction chevron (`8 x 4` px).
pub fn sort_chevron(painter: &Painter, left_x: f32, center_y: f32, ascending: bool, color: Color32) {
    let x0 = left_x.floor() + 0.5;
    let y0 = (center_y - 2.0).floor() + 0.5;
    let (y_tip, y_arm) = if ascending { (y0, y0 + 4.0) } else { (y0 + 4.0, y0) };
    let pts = vec![pos2(x0, y_arm), pos2(x0 + 4.0, y_tip), pos2(x0 + 8.0, y_arm)];
    painter.add(Shape::line(pts, Stroke::new(1.0, color)));
}

/// Draws the geometric Astrolabe emblem in 1 px strokes inside a square of side `size`.
pub fn astrolabe_mark(painter: &Painter, top_left: Pos2, size: f32, color: Color32) {
    let ox = top_left.x.floor();
    let oy = top_left.y.floor();
    let s = size.round().max(12.0);
    let mid = pos2(ox + s * 0.5, oy + s * 0.5);
    let stroke = Stroke::new(1.0, color);

    // Outer instrument ring and vertical meridian / horizontal horizon axes.
    let outer_r = (s * 0.44).floor();
    painter.circle_stroke(mid, outer_r, stroke);

    // Offset ecliptic ring characteristic of a planispheric astrolabe.
    let ecliptic_center = pos2(mid.x + s * 0.08, mid.y - s * 0.08);
    painter.circle_stroke(ecliptic_center, (s * 0.25).floor(), stroke);

    // Alidade sight bar tilted across the center pivot.
    let d = outer_r * 0.72;
    painter.line_segment([pos2(mid.x - d, mid.y + d), pos2(mid.x + d, mid.y - d)], stroke);
    painter.circle_filled(mid, 1.5, color);
}

/// Draws one of the built-in 1 px technical glyphs centered on `center`.
pub fn icon_glyph(painter: &Painter, center: Pos2, kind: IconKind, color: Color32) {
    let c = pos2(center.x.floor() + 0.5, center.y.floor() + 0.5);
    let stroke = Stroke::new(1.0, color);
    match kind {
        IconKind::Grid => {
            for dx in [-4.5, 0.5] {
                for dy in [-4.5, 0.5] {
                    let r = Rect::from_min_size(c + vec2(dx, dy), vec2(4.0, 4.0));
                    painter.rect_stroke(r, 0.0, stroke, StrokeKind::Inside);
                }
            }
        }
        IconKind::Layers => {
            let top = vec![c + vec2(0.0, -5.0), c + vec2(5.5, -2.0), c + vec2(0.0, 1.0), c + vec2(-5.5, -2.0)];
            painter.add(Shape::closed_line(top, stroke));
            let mid = vec![c + vec2(-5.5, 1.0), c + vec2(0.0, 4.0), c + vec2(5.5, 1.0)];
            painter.add(Shape::line(mid, stroke));
            let bot = vec![c + vec2(-5.5, 3.5), c + vec2(0.0, 6.5), c + vec2(5.5, 3.5)];
            painter.add(Shape::line(bot, stroke));
        }
        IconKind::Document => {
            let body = Rect::from_center_size(c, vec2(9.0, 11.0));
            painter.rect_stroke(body, 0.0, stroke, StrokeKind::Inside);
            painter.line_segment([pos2(body.left() + 2.0, c.y - 2.0), pos2(body.right() - 2.0, c.y - 2.0)], stroke);
            painter.line_segment([pos2(body.left() + 2.0, c.y + 0.5), pos2(body.right() - 2.0, c.y + 0.5)], stroke);
            painter.line_segment([pos2(body.left() + 2.0, c.y + 3.0), pos2(body.right() - 3.5, c.y + 3.0)], stroke);
        }
        IconKind::Pulse => {
            let pts = vec![
                c + vec2(-6.0, 0.5),
                c + vec2(-3.0, 0.5),
                c + vec2(-1.5, -4.5),
                c + vec2(1.0, 4.5),
                c + vec2(3.0, -1.5),
                c + vec2(4.5, 0.5),
                c + vec2(6.0, 0.5),
            ];
            painter.add(Shape::line(pts, stroke));
        }
        IconKind::Folder => {
            let body = Rect::from_center_size(c + vec2(0.0, 1.0), vec2(11.0, 7.5));
            painter.rect_stroke(body, 0.0, stroke, StrokeKind::Inside);
            let tab = vec![
                pos2(body.left() + 0.5, body.top()),
                pos2(body.left() + 0.5, body.top() - 2.0),
                pos2(body.left() + 4.5, body.top() - 2.0),
                pos2(body.left() + 6.0, body.top()),
            ];
            painter.add(Shape::line(tab, stroke));
        }
        IconKind::Search => {
            let o = c + vec2(-1.5, -1.5);
            painter.circle_stroke(o, 3.6, stroke);
            painter.line_segment([o + vec2(2.6, 2.6), o + vec2(5.8, 5.8)], stroke);
        }
        IconKind::Clock => {
            painter.circle_stroke(c, 5.2, stroke);
            painter.line_segment([c, c + vec2(0.0, -3.2)], stroke);
            painter.line_segment([c, c + vec2(2.6, 1.2)], stroke);
        }
        IconKind::Cpu => {
            let core = Rect::from_center_size(c, vec2(7.0, 7.0));
            painter.rect_stroke(core, 0.0, stroke, StrokeKind::Inside);
            for d in [-2.0, 2.0] {
                painter.line_segment([pos2(c.x + d, core.top()), pos2(c.x + d, core.top() - 2.5)], stroke);
                painter.line_segment([pos2(c.x + d, core.bottom()), pos2(c.x + d, core.bottom() + 2.5)], stroke);
                painter.line_segment([pos2(core.left(), c.y + d), pos2(core.left() - 2.5, c.y + d)], stroke);
                painter.line_segment([pos2(core.right(), c.y + d), pos2(core.right() + 2.5, c.y + d)], stroke);
            }
        }
        IconKind::Link => {
            let a = Rect::from_center_size(c + vec2(-2.2, 0.0), vec2(5.5, 4.5));
            let b = Rect::from_center_size(c + vec2(2.2, 0.0), vec2(5.5, 4.5));
            painter.rect_stroke(a, 0.0, stroke, StrokeKind::Inside);
            painter.rect_stroke(b, 0.0, stroke, StrokeKind::Inside);
        }
        IconKind::Database => {
            let r = Rect::from_center_size(c, vec2(9.0, 10.0));
            painter.rect_stroke(r, 0.0, stroke, StrokeKind::Inside);
            painter.line_segment([pos2(r.left(), c.y - 1.5), pos2(r.right(), c.y - 1.5)], stroke);
            painter.line_segment([pos2(r.left(), c.y + 2.0), pos2(r.right(), c.y + 2.0)], stroke);
        }
        IconKind::Filter => {
            let pts = vec![
                c + vec2(-5.5, -4.0),
                c + vec2(5.5, -4.0),
                c + vec2(1.5, 0.5),
                c + vec2(1.5, 4.5),
                c + vec2(-1.5, 3.0),
                c + vec2(-1.5, 0.5),
            ];
            painter.add(Shape::closed_line(pts, stroke));
        }
    }
}
