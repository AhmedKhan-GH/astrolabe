//! Shared Sternbild UI helpers built strictly on `astrolabe-kit` tokens and primitives.

use astrolabe_engines::agents::UsageLevel;
use astrolabe_engines::repos::{Flag, Ide};
use astrolabe_kit::{StatusTone, color, draw, font_size, metric, theme};
use egui::{Align, Color32, CursorIcon, FontId, Id, Margin, Painter, Pos2, Rect, Response, RichText, Sense, TextEdit, Ui, Vec2, vec2};

/// Maps a repository `Flag` to its semantic `StatusTone`.
pub fn flag_tone(flag: Flag) -> StatusTone {
    match flag {
        Flag::Unreadable | Flag::LocalOnly | Flag::NotOnRemote => StatusTone::Error,
        Flag::Uncommitted | Flag::Unpushed => StatusTone::Warn,
        Flag::Behind | Flag::Moved => StatusTone::Info,
        Flag::InSync => StatusTone::Ok,
    }
}

/// Maps an agent `UsageLevel` to its semantic `StatusTone`.
pub fn usage_tone(level: UsageLevel) -> StatusTone {
    match level {
        UsageLevel::Normal => StatusTone::Ok,
        UsageLevel::Warning => StatusTone::Warn,
        UsageLevel::Critical => StatusTone::Error,
    }
}

/// Short 2-letter monogram for a JetBrains IDE when no `.app` texture is loaded.
pub fn ide_monogram(ide: Ide) -> &'static str {
    match ide {
        Ide::CLion => "CL",
        Ide::WebStorm => "WS",
        Ide::PyCharm => "PC",
        Ide::RustRover => "RR",
        Ide::GoLand => "GL",
    }
}

/// Compact toggle button in the Sternbild style: active state uses `PLATE` fill
/// with `BRONZE` outline and ink; inactive uses `RULE` outline and `SECONDARY`/`PARCHMENT` ink.
pub fn toggle_button(ui: &mut Ui, label: &str, active: bool) -> Response {
    let job = theme::label_job(label, color::PARCHMENT);
    let text_w = theme::job_width(ui, job);
    let width = (text_w + 16.0).ceil();
    let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::KEY_BUTTON_H), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, active, label));

    let hovered = resp.hovered();
    let (fill, outline, ink) = if active {
        (Some(color::PLATE), color::BRONZE, color::BRONZE)
    } else if hovered {
        (Some(color::PLATE_HOVER), color::RULE, color::PARCHMENT)
    } else {
        (None, color::RULE, color::SECONDARY)
    };

    let p = ui.painter();
    if let Some(bg) = fill {
        p.rect_filled(rect, 0.0, bg);
    }
    draw::box_outline(p, rect, outline);
    theme::paint_job(p, rect, theme::label_job(label, ink), Align::Center, false);
    resp.on_hover_cursor(CursorIcon::PointingHand)
}

/// Square 1 px outlined action button with optional fixed minimum width.
pub fn action_button(ui: &mut Ui, label: &str, enabled: bool, min_width: f32) -> Response {
    let text_w = theme::job_width(ui, theme::label_job(label, color::PARCHMENT));
    let width = (text_w + 16.0).ceil().max(min_width);
    let sense = if enabled { Sense::click() } else { Sense::hover() };
    let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::KEY_BUTTON_H), sense);
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, enabled, label));

    let hovered = enabled && resp.hovered();
    let held = enabled && resp.is_pointer_button_down_on();
    let focused = enabled && resp.has_focus();

    let (fill, outline, ink) = if !enabled {
        (None, color::RULE_FAINT, color::FAINT)
    } else if held && hovered {
        (Some(color::PARCHMENT), color::PARCHMENT, color::DEEP)
    } else if hovered {
        (Some(color::PLATE_HOVER), if focused { color::BRONZE } else { color::RULE }, color::PARCHMENT)
    } else {
        (None, if focused { color::BRONZE } else { color::RULE }, color::PARCHMENT)
    };

    let p = ui.painter();
    if let Some(bg) = fill {
        p.rect_filled(rect, 0.0, bg);
    }
    draw::box_outline(p, rect, outline);
    theme::paint_job(p, rect, theme::label_job(label, ink), Align::Center, false);
    if enabled { resp.on_hover_cursor(CursorIcon::PointingHand) } else { resp }
}

/// Frameless tracked monospace link button (used in headers and status bars).
pub fn mono_link(ui: &mut Ui, label: &str) -> Response {
    let text_w = theme::job_width(ui, theme::label_job(label, color::SECONDARY));
    let (rect, resp) = ui.allocate_exact_size(vec2(text_w.ceil() + 4.0, metric::KEY_BUTTON_H - 2.0), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, label));
    let ink = if resp.hovered() { color::PARCHMENT } else { color::SECONDARY };
    let p = ui.painter();
    theme::paint_job(p, rect, theme::label_job(label, ink), Align::Center, false);
    if resp.hovered() || resp.has_focus() {
        let line = if resp.has_focus() && !resp.hovered() { color::BRONZE } else { color::PARCHMENT };
        draw::rule_h(p, rect.left() + 1.0, rect.right() - 1.0, rect.bottom() - 2.0, line);
    }
    resp.on_hover_cursor(CursorIcon::PointingHand)
}

/// Recessed `DEEP` single-line text input with 1 px `RULE` border (`BRONZE` on focus).
pub fn text_field(
    ui: &mut Ui,
    rect: Rect,
    id: Id,
    text: &mut String,
    hint: &str,
    mono: bool,
    password: bool,
) -> Response {
    let font = if mono {
        FontId::new(font_size::MONO, theme::mono_family())
    } else {
        FontId::new(font_size::BODY, theme::ui_family())
    };
    let edit = TextEdit::singleline(text)
        .id(id)
        .password(password)
        .frame(egui::Frame::new().fill(color::DEEP).inner_margin(Margin::symmetric(8, 4)))
        .font(font.clone())
        .text_color(color::PARCHMENT)
        .hint_text(RichText::new(hint).font(font).color(color::FAINT))
        .desired_width(rect.width());
    let resp = ui.put(rect, edit);
    draw::box_outline(ui.painter(), rect, if resp.has_focus() { color::BRONZE } else { color::RULE });
    resp
}

/// Square Sternbild plate with a centered 1–2 letter monogram or initial.
pub fn badge_tile(painter: &Painter, rect: Rect, glyph: &str, selected: bool) {
    painter.rect_filled(rect, 0.0, color::DEEP);
    draw::box_outline(painter, rect, if selected { color::BRONZE } else { color::RULE });
    let ink = if selected { color::BRONZE } else { color::PARCHMENT };
    let size = if rect.height() >= 30.0 {
        if glyph.len() > 1 { 12.0 } else { 15.0 }
    } else if glyph.len() > 1 {
        9.5
    } else {
        11.0
    };
    theme::paint_job(painter, rect, theme::mono_job(glyph, size, ink), Align::Center, false);
}

/// Square Sternbild plate holding a folder or smart-query glyph.
pub fn folder_glyph_tile(painter: &Painter, rect: Rect, smart: bool, selected: bool) {
    painter.rect_filled(rect, 0.0, color::DEEP);
    draw::box_outline(painter, rect, if selected { color::BRONZE } else { color::RULE });
    let ink = if selected { color::BRONZE } else { color::SECONDARY };
    let kind = if smart { draw::IconKind::Search } else { draw::IconKind::Folder };
    draw::icon_glyph(painter, rect.center(), kind, ink);
}

/// Square Sternbild checkbox (bronze fill when checked).
pub fn checkbox(painter: &Painter, center: Pos2, on: bool, hovered: bool, enabled: bool) {
    let rect = Rect::from_center_size(center, Vec2::splat(14.0));
    let outline = if !enabled {
        color::RULE_FAINT
    } else if on {
        color::BRONZE
    } else if hovered {
        color::PARCHMENT
    } else {
        color::RULE
    };
    painter.rect_filled(rect, 0.0, color::DEEP);
    draw::box_outline(painter, rect, outline);
    if on {
        let fill = if enabled { color::BRONZE } else { color::FAINT };
        painter.rect_filled(rect.shrink(3.0), 0.0, fill);
    }
}

/// Standard modal dialog frame in Sternbild tones.
pub fn modal_frame() -> egui::Frame {
    egui::Frame::new().fill(color::GROUND).stroke(egui::Stroke::new(1.0, color::RULE)).inner_margin(18)
}

/// Simple pluralization helper (`1 repo` / `3 repos`).
pub fn plural(n: usize, one: &str, many: &str) -> String {
    if n == 1 { format!("1 {one}") } else { format!("{n} {many}") }
}

/// Paints a single button inside an `egui::MenuButton` styled in Sternbild square form.
pub fn menu_button_widget(label: &str) -> egui::Button<'static> {
    egui::Button::new(
        RichText::new(label.to_ascii_uppercase())
            .font(FontId::new(font_size::LABEL, theme::mono_family()))
            .extra_letter_spacing(metric::TRACKING)
            .color(color::PARCHMENT),
    )
    .fill(Color32::TRANSPARENT)
    .stroke(egui::Stroke::new(1.0, color::RULE))
    .corner_radius(0.0)
    .min_size(vec2(0.0, metric::KEY_BUTTON_H))
}

/// Faint `·` separator matching `astrolabe_kit::StatusBar` spacing.
pub fn status_sep(ui: &mut Ui) {
    let (r, _) = ui.allocate_exact_size(vec2(16.0, metric::STATUS_BAR - 2.0), Sense::hover());
    theme::paint_job(ui.painter(), r, theme::mono_job("·", font_size::MONO_SMALL, color::FAINT), Align::Center, false);
}

/// Frameless menu button widget for section headers like `NEW`.
pub fn link_menu_widget(label: &str) -> egui::Button<'static> {
    egui::Button::new(
        RichText::new(label.to_ascii_uppercase())
            .font(FontId::new(font_size::LABEL, theme::mono_family()))
            .extra_letter_spacing(metric::TRACKING)
            .color(color::SECONDARY),
    )
    .frame(false)
}
