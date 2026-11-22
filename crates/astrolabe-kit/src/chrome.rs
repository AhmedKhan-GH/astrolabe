//! Workstation layout chrome: command bar, status bar, sidebar navigation rail,
//! pane container, pane header, and Sternbild action controls.
//!
//! Bronze (`color::BRONZE`) appears strictly for focus and active selection.

use egui::{
    Align, AsIdSalt, Color32, CursorIcon, FontId, Id, Layout, Margin, Rect, Response, RichText, ScrollArea, Sense,
    TextEdit, Ui, UiBuilder, pos2, vec2,
};

use crate::draw::{self, IconKind};
use crate::layout::pane_child;
use crate::theme;
use crate::tokens::{StatusTone, color, font_size, metric};

// ---------------------------------------------------------------------------
// Command Bar

/// Top shell command bar strip (`GROUND` fill, 1 px bottom rule).
pub struct CommandBar;

impl CommandBar {
    /// Draws the top command bar in `rect` with left and right inline slots.
    pub fn show(
        ui: &mut Ui,
        rect: Rect,
        left: impl FnOnce(&mut Ui),
        right: impl FnOnce(&mut Ui),
    ) {
        let p = ui.painter();
        p.rect_filled(rect, 0.0, color::GROUND);
        draw::rule_h(p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE);

        let inner = Rect::from_min_max(
            pos2(rect.left() + metric::PAD, rect.top()),
            pos2(rect.right() - metric::PAD, rect.bottom() - 1.0),
        );
        let mut bar_ui = ui.new_child(
            UiBuilder::new()
                .id_salt("astrolabe_command_bar")
                .max_rect(inner)
                .layout(Layout::left_to_right(Align::Center)),
        );
        bar_ui.set_clip_rect(inner.intersect(ui.clip_rect()));
        bar_ui.spacing_mut().item_spacing.x = 8.0;

        left(&mut bar_ui);
        bar_ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            right(ui);
        });
    }
}

/// The Astrolabe app icon (the Minerals icon with its lapis border), from
/// `docs-theme/assets/astrolabe-icon-minerals.svg`, rendered at 96 px.
const ICON_PNG: &[u8] = include_bytes!("../assets/astrolabe-icon.png");

/// The icon's texture, decoded once per context and kept in its temporary data.
fn icon_texture(ctx: &egui::Context) -> Option<egui::TextureHandle> {
    let id = Id::unique("astrolabe_kit_icon");
    if let Some(texture) = ctx.data(|d| d.get_temp::<egui::TextureHandle>(id)) {
        return Some(texture);
    }
    let rgba = image::load_from_memory_with_format(ICON_PNG, image::ImageFormat::Png).ok()?.into_rgba8();
    let size = [rgba.width() as usize, rgba.height() as usize];
    let pixels = egui::ColorImage::from_rgba_unmultiplied(size, rgba.as_raw());
    let texture = ctx.load_texture("astrolabe-icon", pixels, egui::TextureOptions::LINEAR);
    ctx.data_mut(|d| d.insert_temp(id, texture.clone()));
    Some(texture)
}

/// Draws the Astrolabe icon and uppercase tracked wordmark inside a command bar.
pub fn masthead(ui: &mut Ui, wordmark: &str) -> Response {
    let mark_size = 22.0;
    let mark_gap = 8.0;
    let job = theme::wordmark_job(wordmark, color::PARCHMENT);
    let word_w = theme::job_width(ui, job.clone());
    let total_w = mark_size + mark_gap + word_w + 4.0;
    let (rect, resp) = ui.allocate_exact_size(vec2(total_w, metric::COMMAND_BAR - 2.0), Sense::hover());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, wordmark));

    let texture = icon_texture(ui.ctx());
    let p = ui.painter();
    let mark_min = pos2(rect.left(), (rect.center().y - mark_size * 0.5).floor());
    match texture {
        Some(texture) => {
            let mark_rect = Rect::from_min_size(mark_min, vec2(mark_size, mark_size));
            let uv = Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0));
            p.image(texture.id(), mark_rect, uv, Color32::WHITE);
        }
        None => draw::astrolabe_mark(p, mark_min, mark_size, color::PARCHMENT),
    }

    let text_rect = Rect::from_min_max(pos2(mark_min.x + mark_size + mark_gap, rect.top()), rect.max);
    theme::paint_job(p, text_rect, job, Align::Min, false);
    resp
}

/// Monospace command or filter input in a `DEEP` well with a 1 px border.
///
/// The border turns `BRONZE` while focused and remains `RULE` at rest.
pub fn command_input(
    ui: &mut Ui,
    id_salt: impl AsIdSalt,
    text: &mut String,
    placeholder: &str,
    width: f32,
) -> Response {
    let height = 24.0;
    let (rect, _) = ui.allocate_exact_size(vec2(width.max(100.0), height), Sense::hover());
    let id = ui.scope_id().with(id_salt);
    let edit = TextEdit::singleline(text)
        .id(id)
        .frame(egui::Frame::new().fill(color::DEEP).inner_margin(Margin::symmetric(8, 4)))
        .font(FontId::new(font_size::MONO, theme::mono_family()))
        .text_color(color::PARCHMENT)
        .hint_text(RichText::new(placeholder).font(FontId::new(font_size::MONO, theme::mono_family())).color(color::FAINT))
        .desired_width(rect.width());
    let resp = ui.put(rect, edit);
    let border = if resp.has_focus() { color::BRONZE } else { color::RULE };
    draw::box_outline(ui.painter(), rect, border);
    resp
}

// ---------------------------------------------------------------------------
// Sternbild Action Controls

/// Square 1 px outlined key button pairing a shortcut key and action label (e.g. `⌘K Command`).
///
/// Uses bronze only on hover (the key glyph) and keyboard focus (the 1 px outline).
pub fn key_button(
    ui: &mut Ui,
    key: &str,
    action: &str,
    enabled: bool,
    disabled_reason: Option<&str>,
) -> Response {
    let key_job = if key.is_empty() {
        None
    } else {
        Some(theme::mono_job(key, font_size::MONO_SMALL, color::SECONDARY))
    };
    let action_job = if action.is_empty() {
        None
    } else {
        Some(theme::sans_job(action, font_size::BODY, color::PARCHMENT, false))
    };

    let key_w = key_job.as_ref().map_or(0.0, |j| theme::job_width(ui, j.clone()));
    let action_w = action_job.as_ref().map_or(0.0, |j| theme::job_width(ui, j.clone()));
    let inner_gap = if key_w > 0.0 && action_w > 0.0 { 6.0 } else { 0.0 };
    let content_w = key_w + inner_gap + action_w;
    let width = (content_w + 16.0).ceil();

    let sense = if enabled { Sense::click() } else { Sense::hover() };
    let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::KEY_BUTTON_H), sense);
    let a11y = if action.is_empty() { key } else { action };
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, enabled, a11y));

    let hovered = enabled && resp.hovered();
    let held = enabled && resp.is_pointer_button_down_on();
    let focused = enabled && resp.has_focus();

    let (fill, outline, key_ink, action_ink) = if !enabled {
        (None, color::RULE_FAINT, color::FAINT, color::FAINT)
    } else if held && hovered {
        (Some(color::PARCHMENT), color::PARCHMENT, color::DEEP, color::DEEP)
    } else if hovered {
        (Some(color::PLATE_HOVER), if focused { color::BRONZE } else { color::RULE }, color::BRONZE, color::PARCHMENT)
    } else {
        (None, if focused { color::BRONZE } else { color::RULE }, color::SECONDARY, color::PARCHMENT)
    };

    let p = ui.painter();
    if let Some(bg) = fill {
        p.rect_filled(rect, 0.0, bg);
    }
    draw::box_outline(p, rect, outline);

    let mut x = (rect.center().x - content_w * 0.5).floor();
    if !key.is_empty() {
        let r = Rect::from_min_max(pos2(x, rect.top()), pos2(x + key_w + 1.0, rect.bottom()));
        theme::paint_job(p, r, theme::mono_job(key, font_size::MONO_SMALL, key_ink), Align::Min, false);
        x += key_w + inner_gap;
    }
    if !action.is_empty() {
        let r = Rect::from_min_max(pos2(x, rect.top()), pos2(x + action_w + 1.0, rect.bottom()));
        theme::paint_job(p, r, theme::sans_job(action, font_size::BODY, action_ink, false), Align::Min, false);
    }

    if enabled {
        resp.on_hover_cursor(CursorIcon::PointingHand)
    } else if let Some(reason) = disabled_reason {
        resp.on_hover_text(reason)
    } else {
        resp
    }
}

/// Sternbild primary action button with 45-degree chamfered corners.
pub fn primary_button(ui: &mut Ui, label: &str, key: Option<&str>, enabled: bool) -> Response {
    let key_str = key.unwrap_or("");
    let key_w = if key_str.is_empty() {
        0.0
    } else {
        theme::job_width(ui, theme::mono_job(key_str, font_size::MONO_SMALL, color::PARCHMENT))
    };
    let label_w = theme::job_width(ui, theme::sans_job(label, font_size::BODY, color::PARCHMENT, true));
    let inner_gap = if key_w > 0.0 { 6.0 } else { 0.0 };
    let content_w = key_w + inner_gap + label_w;
    let width = (content_w + 24.0).ceil();

    let sense = if enabled { Sense::click() } else { Sense::hover() };
    let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::PRIMARY_BUTTON_H), sense);
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, enabled, label));

    let hovered = enabled && resp.hovered();
    let held = enabled && resp.is_pointer_button_down_on();
    let focused = enabled && resp.has_focus();

    let (outline, fill, key_ink, label_ink) = if !enabled {
        (color::RULE, None, color::FAINT, color::FAINT)
    } else if held && hovered {
        (color::PARCHMENT, Some(color::PARCHMENT), color::DEEP, color::DEEP)
    } else if hovered {
        (color::PARCHMENT, Some(color::PLATE_HOVER), color::BRONZE, color::PARCHMENT)
    } else {
        (color::PARCHMENT, None, color::SECONDARY, color::PARCHMENT)
    };

    let p = ui.painter();
    draw::cut_plate(p, rect, outline, fill, metric::CUT);
    if focused {
        draw::cut_plate(p, rect.expand(3.0), color::BRONZE, None, metric::CUT + 1.0);
    }

    let mut x = (rect.center().x - content_w * 0.5).floor();
    if !key_str.is_empty() {
        let r = Rect::from_min_max(pos2(x, rect.top()), pos2(x + key_w + 1.0, rect.bottom()));
        theme::paint_job(p, r, theme::mono_job(key_str, font_size::MONO_SMALL, key_ink), Align::Min, false);
        x += key_w + inner_gap;
    }
    let lr = Rect::from_min_max(pos2(x, rect.top()), pos2(x + label_w + 1.0, rect.bottom()));
    theme::paint_job(p, lr, theme::sans_job(label, font_size::BODY, label_ink, true), Align::Min, false);

    if enabled { resp.on_hover_cursor(CursorIcon::PointingHand) } else { resp }
}

/// Secondary action as a bare parchment word with a 1 px underline on hover or focus.
pub fn word_button(ui: &mut Ui, label: &str) -> Response {
    let w = theme::job_width(ui, theme::sans_job(label, font_size::BODY, color::PARCHMENT, false));
    let (rect, resp) = ui.allocate_exact_size(vec2(w.ceil() + 2.0, metric::KEY_BUTTON_H), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, label));

    let p = ui.painter();
    theme::paint_job(p, rect, theme::sans_job(label, font_size::BODY, color::PARCHMENT, false), Align::Min, false);
    if resp.hovered() || resp.has_focus() {
        let line_color = if resp.has_focus() && !resp.hovered() { color::BRONZE } else { color::PARCHMENT };
        draw::rule_h(p, rect.left(), rect.right() - 2.0, rect.bottom() - 3.0, line_color);
    }
    resp.on_hover_cursor(CursorIcon::PointingHand)
}

/// Honest disabled action displaying the muted control name and short reason inline.
pub fn unavailable_action(ui: &mut Ui, label: &str, reason: &str) {
    let label_job = theme::sans_job(label, font_size::BODY, color::FAINT, false);
    let reason_job = theme::mono_job(reason, font_size::MONO_SMALL, color::FAINT);
    let lw = theme::job_width(ui, label_job.clone());
    let rw = theme::job_width(ui, reason_job.clone());
    let gap = 8.0;
    let (rect, resp) = ui.allocate_exact_size(vec2((lw + gap + rw).ceil(), metric::KEY_BUTTON_H), Sense::hover());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, false, format!("{label}: {reason}")));
    let p = ui.painter();
    let lr = Rect::from_min_max(rect.min, pos2(rect.left() + lw + 1.0, rect.bottom()));
    let rr = Rect::from_min_max(pos2(rect.left() + lw + gap, rect.top()), rect.max);
    theme::paint_job(p, lr, label_job, Align::Min, false);
    theme::paint_job(p, rr, reason_job, Align::Min, false);
}

// ---------------------------------------------------------------------------
// Status Bar

const STATUS_SEP_KEY: &str = "astrolabe_kit_status_sep";

/// Bottom persistent status strip (`DEEP` fill, 1 px top rule).
pub struct StatusBar;

impl StatusBar {
    /// Draws the bottom status bar in `rect` with left-aligned and right-aligned groups.
    pub fn show(
        ui: &mut Ui,
        rect: Rect,
        left: impl FnOnce(&mut Ui),
        right: impl FnOnce(&mut Ui),
    ) {
        let p = ui.painter();
        p.rect_filled(rect, 0.0, color::DEEP);
        draw::rule_h(p, rect.left(), rect.right(), rect.top(), color::RULE);

        let inner = Rect::from_min_max(
            pos2(rect.left() + metric::PAD, rect.top() + 1.0),
            pos2(rect.right() - metric::PAD, rect.bottom()),
        );
        let mut bar_ui = ui.new_child(
            UiBuilder::new()
                .id_salt("astrolabe_status_bar")
                .max_rect(inner)
                .layout(Layout::left_to_right(Align::Center)),
        );
        bar_ui.set_clip_rect(inner.intersect(ui.clip_rect()));
        bar_ui.spacing_mut().item_spacing.x = 0.0;

        reset_status_group(&bar_ui, "left");
        left(&mut bar_ui);

        bar_ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 0.0;
            reset_status_group(ui, "right");
            right(ui);
        });
    }
}

fn reset_status_group(ui: &Ui, tag: &str) {
    let id = Id::unique((STATUS_SEP_KEY, tag));
    ui.ctx().data_mut(|d| d.insert_temp(id, false));
}

fn next_status_sep(ui: &mut Ui, right_to_left: bool) {
    let tag = if right_to_left { "right" } else { "left" };
    let id = Id::unique((STATUS_SEP_KEY, tag));
    let had_prev = ui.ctx().data(|d| d.get_temp::<bool>(id).unwrap_or(false));
    if had_prev {
        let sep_w = 16.0;
        let (r, _) = ui.allocate_exact_size(vec2(sep_w, metric::STATUS_BAR - 2.0), Sense::hover());
        theme::paint_job(
            ui.painter(),
            r,
            theme::mono_job("·", font_size::MONO_SMALL, color::FAINT),
            Align::Center,
            false,
        );
    }
    ui.ctx().data_mut(|d| d.insert_temp(id, true));
}

/// Draws one status bar item, automatically inserting a faint `·` separator between items.
pub fn status_item(ui: &mut Ui, text: &str, text_color: Color32) {
    let rtl = matches!(ui.layout().main_dir(), egui::Direction::RightToLeft);
    next_status_sep(ui, rtl);
    let job = theme::mono_job(text, font_size::MONO_SMALL, text_color);
    let w = theme::job_width(ui, job.clone()).ceil();
    let (rect, resp) = ui.allocate_exact_size(vec2(w, metric::STATUS_BAR - 2.0), Sense::hover());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, text));
    theme::paint_job(ui.painter(), rect, job, Align::Min, false);
}

/// Draws a live status diamond plus label in the status bar using a data tone (never bronze).
pub fn status_indicator(ui: &mut Ui, label: &str, live: bool, tone: StatusTone) {
    let rtl = matches!(ui.layout().main_dir(), egui::Direction::RightToLeft);
    next_status_sep(ui, rtl);
    let job = theme::mono_job(label, font_size::MONO_SMALL, tone.color());
    let text_w = theme::job_width(ui, job.clone()).ceil();
    let diamond_span = 14.0;
    let (rect, resp) = ui.allocate_exact_size(vec2(diamond_span + text_w, metric::STATUS_BAR - 2.0), Sense::hover());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, label));
    let p = ui.painter();
    draw::diamond(p, pos2(rect.left() + 4.5, rect.center().y), 3.5, tone.color(), live);
    let text_r = Rect::from_min_max(pos2(rect.left() + diamond_span, rect.top()), rect.max);
    theme::paint_job(p, text_r, job, Align::Min, false);
}

// ---------------------------------------------------------------------------
// Pane Header & Pane Container

/// Configuration for [`pane_header`] and [`Pane`].
#[derive(Clone, Copy, Debug)]
pub struct PaneHeaderSpec<'a> {
    /// Declarative Title Case noun phrase (rendered uppercase and tracked).
    pub title: &'a str,
    /// Optional short right-of-title metadata value (e.g. `"18 ITEMS"`).
    pub meta: Option<&'a str>,
    /// Optional right-aligned shortcut label (e.g. `"⌘1"`).
    pub shortcut: Option<&'a str>,
    /// True when this pane holds active focus (activates bronze title, key, and bottom rule).
    pub focused: bool,
}

/// Draws a full-width Sternbild pane header strip inside `rect`.
///
/// Clicking the strip returns a clicked [`Response`] so callers can transfer pane focus.
pub fn pane_header(ui: &mut Ui, rect: Rect, spec: PaneHeaderSpec<'_>) -> Response {
    let resp = ui.interact(rect, ui.scope_id().with(("pane_header", spec.title)), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, spec.title));

    let hovered = !spec.focused && resp.hovered();
    let bg = if hovered { color::PLATE_HOVER } else { color::PLATE };
    let title_color = if spec.focused { color::BRONZE } else { color::PARCHMENT };
    let rule_color = if spec.focused { color::BRONZE } else { color::RULE };
    let key_color = if spec.focused { color::BRONZE } else { color::SECONDARY };

    let p = ui.painter();
    p.rect_filled(rect, 0.0, bg);
    draw::rule_h(p, rect.left(), rect.right(), rect.bottom() - 1.0, rule_color);

    let inset = metric::PAD;
    let text_band = Rect::from_min_max(pos2(rect.left() + inset, rect.top()), pos2(rect.right() - inset, rect.bottom() - 1.0));

    let shortcut_w = spec.shortcut.map_or(0.0, |sc| {
        let sc_job = theme::mono_job(sc, font_size::MONO_SMALL, key_color);
        let w = theme::paint_job(p, text_band, sc_job, Align::Max, false);
        w + metric::GAP
    });

    let left_limit = (text_band.right() - shortcut_w).max(text_band.left() + 1.0);
    let title_rect = Rect::from_min_max(text_band.min, pos2(left_limit, text_band.bottom()));
    let title_w = theme::paint_job(p, title_rect, theme::label_job(spec.title, title_color), Align::Min, true);

    if let Some(meta) = spec.meta {
        let meta_left = title_rect.left() + title_w + metric::GAP;
        if meta_left + 12.0 < left_limit {
            let meta_rect = Rect::from_min_max(pos2(meta_left, text_band.top()), pos2(left_limit, text_band.bottom()));
            theme::paint_job(p, meta_rect, theme::mono_job(meta, font_size::MONO_SMALL, color::SECONDARY), Align::Min, true);
        }
    }

    if spec.focused { resp } else { resp.on_hover_cursor(CursorIcon::PointingHand) }
}

/// Output returned by [`Pane::show`].
pub struct PaneResponse {
    pub header: Response,
    pub body_rect: Rect,
}

/// Tiled pane container with pinned header strip, 1 px edge dividers, and optional body padding.
pub struct Pane<'a> {
    pub id: &'a str,
    pub header: PaneHeaderSpec<'a>,
    pub left_rule: bool,
    pub top_rule: bool,
    pub scrollable: bool,
    pub padding: f32,
}

impl<'a> Pane<'a> {
    /// Creates a standard pane container with inner padding and vertical scrolling off by default.
    pub fn new(id: &'a str, title: &'a str, focused: bool) -> Self {
        Self {
            id,
            header: PaneHeaderSpec { title, meta: None, shortcut: None, focused },
            left_rule: false,
            top_rule: false,
            scrollable: false,
            padding: metric::PAD,
        }
    }

    pub fn meta(mut self, meta: &'a str) -> Self {
        self.header.meta = Some(meta);
        self
    }

    pub fn shortcut(mut self, shortcut: &'a str) -> Self {
        self.header.shortcut = Some(shortcut);
        self
    }

    pub fn left_rule(mut self, draw_rule: bool) -> Self {
        self.left_rule = draw_rule;
        self
    }

    pub fn top_rule(mut self, draw_rule: bool) -> Self {
        self.top_rule = draw_rule;
        self
    }

    pub fn scrollable(mut self, scrollable: bool) -> Self {
        self.scrollable = scrollable;
        self
    }

    pub fn padding(mut self, padding: f32) -> Self {
        self.padding = padding;
        self
    }

    /// Renders the pane inside `rect` and invokes `body` in the content region below the header.
    pub fn show(self, ui: &mut Ui, rect: Rect, body: impl FnOnce(&mut Ui)) -> PaneResponse {
        let p = ui.painter();
        p.rect_filled(rect, 0.0, color::GROUND);

        let left_offset = if self.left_rule {
            draw::rule_v(p, rect.left(), rect.top(), rect.bottom(), color::RULE);
            1.0
        } else {
            0.0
        };
        let top_offset = if self.top_rule {
            draw::rule_h(p, rect.left(), rect.right(), rect.top(), color::RULE);
            1.0
        } else {
            0.0
        };

        let inner = Rect::from_min_max(pos2(rect.left() + left_offset, rect.top() + top_offset), rect.max);
        let header_rect = Rect::from_min_size(inner.min, vec2(inner.width(), metric::PANE_HEADER.min(inner.height())));
        let body_rect = Rect::from_min_max(pos2(inner.left(), header_rect.bottom()), inner.max);

        let header = pane_child(ui, (self.id, "header"), header_rect, |ui| pane_header(ui, header_rect, self.header));

        let pad = self.padding;
        let content_rect = Rect::from_min_max(
            pos2(body_rect.left() + pad, body_rect.top() + pad),
            pos2((body_rect.right() - pad).max(body_rect.left() + pad), (body_rect.bottom() - pad).max(body_rect.top() + pad)),
        );

        pane_child(ui, (self.id, "body"), body_rect, |ui| {
            if self.scrollable {
                ScrollArea::vertical().id_salt((self.id, "scroll")).auto_shrink([false, false]).show(ui, |ui| {
                    egui::Frame::new().inner_margin(Margin::same(pad.round() as i8)).show(ui, |ui| {
                        ui.set_width((body_rect.width() - 2.0 * pad).max(1.0));
                        body(ui);
                    });
                });
            } else {
                pane_child(ui, (self.id, "fixed"), content_rect, body);
            }
        });

        PaneResponse { header, body_rect }
    }
}

// ---------------------------------------------------------------------------
// Sidebar Navigation Rail

/// One selectable entry in a [`SidebarSection`].
#[derive(Clone, Debug)]
pub struct SidebarItem<'a> {
    pub id: &'a str,
    pub label: &'a str,
    pub icon: Option<IconKind>,
    pub count: Option<usize>,
    pub depth: usize,
    /// `Some(true)` for expanded parent, `Some(false)` for collapsed parent, `None` for leaf.
    pub expanded: Option<bool>,
    pub active: bool,
}

impl<'a> SidebarItem<'a> {
    pub fn new(id: &'a str, label: &'a str) -> Self {
        Self { id, label, icon: None, count: None, depth: 0, expanded: None, active: false }
    }

    pub fn icon(mut self, icon: IconKind) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn count(mut self, count: usize) -> Self {
        self.count = Some(count);
        self
    }

    pub fn depth(mut self, depth: usize) -> Self {
        self.depth = depth;
        self
    }

    pub fn expanded(mut self, expanded: bool) -> Self {
        self.expanded = Some(expanded);
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }
}

/// Named group of navigation entries in a [`SidebarRail`].
#[derive(Clone, Debug)]
pub struct SidebarSection<'a> {
    pub title: &'a str,
    pub items: Vec<SidebarItem<'a>>,
}

/// User interaction returned by [`SidebarRail::show`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SidebarAction {
    Selected(String),
    Toggled(String),
}

/// Vertical sidebar navigation rail on `GROUND` with a 1 px right border.
///
/// Active selection is marked by a `PLATE` fill, a 2 px left `BRONZE` bar, and
/// `BRONZE` label ink.
pub struct SidebarRail<'a> {
    pub id: &'a str,
    pub sections: Vec<SidebarSection<'a>>,
}

impl<'a> SidebarRail<'a> {
    pub fn new(id: &'a str, sections: Vec<SidebarSection<'a>>) -> Self {
        Self { id, sections }
    }

    pub fn show(self, ui: &mut Ui, rect: Rect) -> Option<SidebarAction> {
        let p = ui.painter();
        p.rect_filled(rect, 0.0, color::GROUND);
        draw::rule_v(p, rect.right() - 1.0, rect.top(), rect.bottom(), color::RULE);

        let inner = Rect::from_min_max(rect.min, pos2((rect.right() - 1.0).max(rect.left()), rect.bottom()));
        let mut action = None;

        pane_child(ui, (self.id, "rail"), inner, |ui| {
            ScrollArea::vertical().id_salt((self.id, "scroll")).auto_shrink([false, false]).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                let width = ui.available_width();
                ui.add_space(6.0);

                for (idx, section) in self.sections.iter().enumerate() {
                    if idx > 0 {
                        ui.add_space(8.0);
                        let y = ui.cursor().top();
                        draw::rule_h(ui.painter(), inner.left() + metric::PAD, inner.right() - metric::PAD, y, color::RULE_FAINT);
                        ui.add_space(4.0);
                    }
                    let (head_rect, _) = ui.allocate_exact_size(vec2(width, metric::SIDEBAR_HEADING), Sense::hover());
                    let title_rect = Rect::from_min_max(
                        pos2(head_rect.left() + metric::PAD, head_rect.top()),
                        pos2(head_rect.right() - metric::PAD, head_rect.bottom()),
                    );
                    theme::paint_job(ui.painter(), title_rect, theme::label_job(section.title, color::FAINT), Align::Min, true);

                    for item in &section.items {
                        if let Some(ev) = draw_sidebar_item(ui, width, item) {
                            action = Some(ev);
                        }
                    }
                }
                ui.add_space(12.0);
            });
        });

        action
    }
}

fn draw_sidebar_item(ui: &mut Ui, width: f32, item: &SidebarItem<'_>) -> Option<SidebarAction> {
    let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::SIDEBAR_ROW), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, item.active, item.label));

    let p = ui.painter().clone();
    if item.active {
        p.rect_filled(rect, 0.0, color::PLATE);
        p.rect_filled(Rect::from_min_size(rect.min, vec2(metric::SELECTION_BAR, rect.height())), 0.0, color::BRONZE);
    } else if resp.hovered() {
        p.rect_filled(rect, 0.0, color::PLATE_HOVER);
    }

    let indent = item.depth as f32 * 14.0;
    let mut x = rect.left() + metric::PAD + indent;
    let mid_y = rect.center().y;

    let mut toggled = false;
    if let Some(open) = item.expanded {
        let hit = Rect::from_center_size(pos2(x + 4.0, mid_y), vec2(14.0, metric::SIDEBAR_ROW));
        let fold_resp = ui.interact(hit, ui.scope_id().with(("sidebar_fold", item.id)), Sense::click());
        let tri_color = if fold_resp.hovered() {
            color::PARCHMENT
        } else if item.active {
            color::BRONZE
        } else {
            color::FAINT
        };
        draw::disclosure(&p, pos2(x + 4.0, mid_y), open, tri_color);
        if fold_resp.on_hover_cursor(CursorIcon::PointingHand).clicked() {
            toggled = true;
        }
        x += 14.0;
    }

    if let Some(icon) = item.icon {
        let icon_color = if item.active { color::BRONZE } else { color::SECONDARY };
        draw::icon_glyph(&p, pos2(x + 6.0, mid_y), icon, icon_color);
        x += 18.0;
    }

    let count_w = if let Some(n) = item.count {
        let count_str = n.to_string();
        let count_color = if n == 0 {
            color::FAINT
        } else if item.active {
            color::BRONZE
        } else {
            color::FAINT
        };
        let count_rect = Rect::from_min_max(
            pos2(rect.right() - 48.0, rect.top()),
            pos2(rect.right() - metric::PAD, rect.bottom()),
        );
        theme::paint_job(&p, count_rect, theme::mono_job(&count_str, font_size::MONO_SMALL, count_color), Align::Max, false)
            + 8.0
    } else {
        0.0
    };

    let text_right = (rect.right() - metric::PAD - count_w).max(x + 1.0);
    let text_rect = Rect::from_min_max(pos2(x, rect.top()), pos2(text_right, rect.bottom()));
    let text_color = if item.active { color::BRONZE } else { color::PARCHMENT };
    theme::paint_job(&p, text_rect, theme::sans_job(item.label, font_size::BODY, text_color, item.active), Align::Min, true);

    let resp = resp.on_hover_cursor(CursorIcon::PointingHand);
    if toggled {
        Some(SidebarAction::Toggled(item.id.to_owned()))
    } else if resp.clicked() {
        Some(SidebarAction::Selected(item.id.to_owned()))
    } else {
        None
    }
}
