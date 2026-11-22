//! Data presentation components: dense booktabs tables with tabular figures,
//! Artisan-style metric summary tiles, compact uppercase status chips,
//! progress and usage bars, and inspector field lists.

use egui::{Align, Color32, CursorIcon, Painter, Rect, Response, ScrollArea, Sense, Ui, Vec2, pos2, vec2};

use crate::draw::{self, IconKind};
use crate::layout::grid_rects;
use crate::theme;
use crate::tokens::{StatusTone, color, font_size, metric};

// ---------------------------------------------------------------------------
// Status Chips

fn chip_job(text: &str, tone: StatusTone) -> egui::text::LayoutJob {
    let upper = text.to_ascii_uppercase();
    theme::job(&upper, egui::FontId::new(font_size::CHIP, theme::mono_family()), tone.color(), 0.85)
}

/// Measures the exact logical size of an uppercase status chip.
pub fn status_chip_size(painter: &Painter, text: &str) -> Vec2 {
    painter.layout_job(chip_job(text, StatusTone::Neutral)).size() + vec2(12.0, 6.0)
}

/// Paints an Artisan-style square outlined status chip with left edge `left` centered on `center_y`.
pub fn paint_status_chip(painter: &Painter, left: f32, center_y: f32, text: &str, tone: StatusTone) -> Rect {
    let galley = painter.layout_job(chip_job(text, tone));
    let size = vec2((galley.size().x + 12.0).ceil(), (galley.size().y + 6.0).ceil());
    let rect = Rect::from_min_size(pos2(left.floor(), (center_y - size.y * 0.5).floor()), size);
    painter.rect_filled(rect, 0.0, tone.chip_fill());
    draw::box_outline(painter, rect, tone.chip_stroke());
    let text_pos = pos2((rect.left() + 6.0).floor(), (rect.center().y - galley.size().y * 0.5).floor());
    painter.galley(text_pos, galley, Color32::PLACEHOLDER);
    rect
}

/// Renders an inline compact uppercase status chip in cursor flow.
pub fn status_chip(ui: &mut Ui, text: &str, tone: StatusTone) -> Response {
    let size = status_chip_size(ui.painter(), text);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, text));
    paint_status_chip(ui.painter(), rect.left(), rect.center().y, text, tone);
    resp
}

// ---------------------------------------------------------------------------
// Usage & Progress Bars

/// Maps a usage fraction (`0.0..=1.0`) to a semantic data tone.
pub fn usage_bar_tone(fraction: f32) -> StatusTone {
    if fraction >= 0.90 {
        StatusTone::Error
    } else if fraction >= 0.75 {
        StatusTone::Warn
    } else {
        StatusTone::Ok
    }
}

/// Paints a square mineral progress or usage bar inside `rect`, optionally showing right-aligned tabular text.
pub fn paint_usage_bar(
    painter: &Painter,
    rect: Rect,
    fraction: f32,
    tone: StatusTone,
    value_text: Option<&str>,
) {
    let clamped = fraction.clamp(0.0, 1.0);
    let value_reserve = if value_text.is_some() { 44.0 } else { 0.0 };
    let track_right = (rect.right() - value_reserve).max(rect.left() + 12.0);
    let track_h = 6.0;
    let track = Rect::from_min_max(
        pos2(rect.left().floor(), (rect.center().y - track_h * 0.5).floor()),
        pos2(track_right.floor(), (rect.center().y + track_h * 0.5).floor()),
    );
    painter.rect_filled(track, 0.0, color::RULE_FAINT);
    if clamped > 0.0 {
        let fill_w = (track.width() * clamped).round().max(1.0);
        let fill = Rect::from_min_size(track.min, vec2(fill_w.min(track.width()), track.height()));
        painter.rect_filled(fill, 0.0, tone.color());
    }
    if let Some(value) = value_text {
        let value_rect = Rect::from_min_max(pos2(track.right() + 6.0, rect.top()), rect.max);
        theme::paint_job(
            painter,
            value_rect,
            theme::mono_job(value, font_size::MONO_SMALL, tone.color()),
            Align::Max,
            false,
        );
    }
}

/// Draws a labeled horizontal usage bar row with tabular value and AccessKit progress metadata.
pub fn labeled_usage_bar(
    ui: &mut Ui,
    width: f32,
    label: &str,
    fraction: f32,
    tone: StatusTone,
    value_text: &str,
) -> Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::FIELD_ROW), Sense::hover());
    resp.widget_info(|| {
        let mut info = egui::WidgetInfo::labeled(egui::Role::ProgressIndicator, true, label);
        info.value = Some((fraction.clamp(0.0, 1.0) * 100.0) as f64);
        info
    });
    let label_w = (width * 0.30).clamp(64.0, 108.0).floor();
    let label_rect = Rect::from_min_size(rect.min, vec2(label_w, rect.height()));
    let meter_rect = Rect::from_min_max(pos2(rect.left() + label_w + 6.0, rect.top()), rect.max);
    let p = ui.painter();
    theme::paint_job(p, label_rect, theme::label_job(label, color::FAINT), Align::Min, true);
    paint_usage_bar(p, meter_rect, fraction, tone, Some(value_text));
    resp
}

// ---------------------------------------------------------------------------
// Icon / Metric Summary Tiles

/// Specification for an Artisan-style metric summary tile in Sternbild geometry.
#[derive(Clone, Debug)]
pub struct MetricTileSpec<'a> {
    pub label: &'a str,
    pub value: &'a str,
    pub meta: Option<&'a str>,
    pub meta_tone: StatusTone,
    pub icon: Option<IconKind>,
    /// Optional embedded usage bar `(fraction, tone)` at the base of the tile.
    pub meter: Option<(f32, StatusTone)>,
}

impl<'a> MetricTileSpec<'a> {
    pub fn new(label: &'a str, value: &'a str) -> Self {
        Self {
            label,
            value,
            meta: None,
            meta_tone: StatusTone::Neutral,
            icon: None,
            meter: None,
        }
    }

    pub fn meta(mut self, meta: &'a str, tone: StatusTone) -> Self {
        self.meta = Some(meta);
        self.meta_tone = tone;
        self
    }

    pub fn icon(mut self, icon: IconKind) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn meter(mut self, fraction: f32, tone: StatusTone) -> Self {
        self.meter = Some((fraction, tone));
        self
    }
}

/// Paints a single square summary tile inside `rect`.
pub fn metric_tile(ui: &mut Ui, rect: Rect, spec: &MetricTileSpec<'_>) -> Response {
    let resp = ui.interact(rect, ui.scope_id().with(("metric_tile", spec.label)), Sense::hover());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, format!("{}: {}", spec.label, spec.value)));

    let p = ui.painter();
    let bg = if resp.hovered() { color::PLATE_HOVER } else { color::PLATE };
    let border = if resp.hovered() { color::RULE } else { color::RULE_FAINT };
    p.rect_filled(rect, 0.0, bg);
    draw::box_outline(p, rect, border);

    let pad_x = 10.0;
    let pad_y = 8.0;
    let inner = Rect::from_min_max(
        pos2(rect.left() + pad_x, rect.top() + pad_y),
        pos2((rect.right() - pad_x).max(rect.left() + pad_x), (rect.bottom() - pad_y).max(rect.top() + pad_y)),
    );

    // Top row: uppercase tracked label + optional geometric icon on right.
    let head_rect = Rect::from_min_size(inner.min, vec2((inner.width() - 18.0).max(1.0), 14.0));
    theme::paint_job(p, head_rect, theme::label_job(spec.label, color::SECONDARY), Align::Min, true);
    if let Some(icon) = spec.icon {
        draw::icon_glyph(p, pos2(inner.right() - 7.0, head_rect.center().y), icon, color::FAINT);
    }

    // Value band kept on a consistent vertical baseline across tiles with or without a bottom meter.
    let val_top = head_rect.bottom() + 6.0;
    let val_bottom = (val_top + 26.0).min(inner.bottom() - if spec.meter.is_some() { 10.0 } else { 0.0 });
    let val_rect = Rect::from_min_max(pos2(inner.left(), val_top), pos2(inner.right(), val_bottom.max(val_top + 1.0)));
    let val_w = theme::paint_job(
        p,
        val_rect,
        theme::mono_job(spec.value, font_size::METRIC_VALUE, color::PARCHMENT),
        Align::Min,
        true,
    );

    if let Some(meta) = spec.meta {
        let meta_left = val_rect.left() + val_w + 8.0;
        if meta_left + 12.0 < inner.right() {
            let meta_rect = Rect::from_min_max(pos2(meta_left, val_rect.top() + 5.0), pos2(inner.right(), val_rect.bottom()));
            theme::paint_job(
                p,
                meta_rect,
                theme::mono_job(meta, font_size::MONO_SMALL, spec.meta_tone.color()),
                Align::Max,
                true,
            );
        }
    }

    if let Some((fraction, tone)) = spec.meter {
        let bar_rect = Rect::from_min_max(pos2(inner.left(), inner.bottom() - 6.0), pos2(inner.right(), inner.bottom()));
        paint_usage_bar(p, bar_rect, fraction, tone, None);
    }

    resp
}

/// Lays out a horizontal row of evenly distributed metric summary tiles across `width`.
pub fn metric_tile_row(ui: &mut Ui, width: f32, tiles: &[MetricTileSpec<'_>]) {
    if tiles.is_empty() {
        return;
    }
    let (row_rect, _) = ui.allocate_exact_size(vec2(width, metric::TILE_H), Sense::hover());
    let cells = grid_rects(row_rect, tiles.len(), 8.0);
    for (cell, spec) in cells.into_iter().zip(tiles.iter()) {
        metric_tile(ui, cell, spec);
    }
}

// ---------------------------------------------------------------------------
// Inspector Section Headings, Item Header Tiles, & Key-Value Field Rows

/// Draws an uppercase tracked section divider with optional right-aligned count or note.
pub fn section_heading(ui: &mut Ui, width: f32, title: &str, right_meta: Option<&str>) {
    let (rect, _) = ui.allocate_exact_size(vec2(width, 24.0), Sense::hover());
    let p = ui.painter();
    let meta_w = right_meta.map_or(0.0, |m| {
        theme::paint_job(p, rect, theme::mono_job(m, font_size::MONO_SMALL, color::FAINT), Align::Max, false) + 8.0
    });
    let title_rect = Rect::from_min_max(rect.min, pos2((rect.right() - meta_w).max(rect.left() + 1.0), rect.bottom()));
    theme::paint_job(p, title_rect, theme::label_job(title, color::SECONDARY), Align::Min, true);
    draw::rule_h(p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE_FAINT);
}

/// Draws an Artisan-style square badge/letter tile beside an item title and short metadata.
pub fn item_header_tile(ui: &mut Ui, width: f32, badge: &str, title: &str, meta: Option<&str>) {
    let height = 42.0;
    let (rect, _) = ui.allocate_exact_size(vec2(width, height), Sense::hover());
    let p = ui.painter();

    let tile_size = 34.0;
    let tile_rect = Rect::from_center_size(pos2(rect.left() + tile_size * 0.5, rect.center().y), Vec2::splat(tile_size));
    p.rect_filled(tile_rect, 0.0, color::PLATE);
    draw::box_outline(p, tile_rect, color::RULE);
    let glyph = badge.chars().next().unwrap_or('?').to_ascii_uppercase().to_string();
    theme::paint_job(p, tile_rect, theme::mono_job(&glyph, 16.0, color::PARCHMENT), Align::Center, false);

    let text_left = tile_rect.right() + 10.0;
    let mid = rect.center().y;
    if let Some(meta_text) = meta {
        let l1 = Rect::from_min_max(pos2(text_left, mid - 16.0), pos2(rect.right(), mid));
        let l2 = Rect::from_min_max(pos2(text_left, mid + 1.0), pos2(rect.right(), mid + 16.0));
        theme::paint_job(p, l1, theme::sans_job(title, font_size::TITLE, color::PARCHMENT, true), Align::Min, true);
        theme::paint_job(p, l2, theme::mono_job(meta_text, font_size::MONO_SMALL, color::SECONDARY), Align::Min, true);
    } else {
        let line = Rect::from_min_max(pos2(text_left, rect.top()), rect.max);
        theme::paint_job(p, line, theme::sans_job(title, font_size::TITLE, color::PARCHMENT, true), Align::Min, true);
    }
}

/// Draws a dense key-value field row (`LABEL` on left, value on right in mono or sans).
pub fn field_row(ui: &mut Ui, width: f32, label: &str, value: &str, value_color: Color32, mono: bool) {
    let (rect, _) = ui.allocate_exact_size(vec2(width, metric::FIELD_ROW), Sense::hover());
    let label_w = (width * 0.28).clamp(76.0, 108.0).floor();
    let label_rect = Rect::from_min_size(rect.min, vec2(label_w, rect.height()));
    let value_rect = Rect::from_min_max(pos2(rect.left() + label_w + 6.0, rect.top()), rect.max);
    let p = ui.painter();
    theme::paint_job(p, label_rect, theme::label_job(label, color::FAINT), Align::Min, true);
    let value_job = if mono {
        theme::mono_job(value, font_size::MONO, value_color)
    } else {
        theme::sans_job(value, font_size::BODY, value_color, false)
    };
    let painted_w = theme::paint_job(p, value_rect, value_job, Align::Min, true);
    if painted_w >= value_rect.width() - 1.0 {
        ui.interact(value_rect, ui.scope_id().with(("field_overflow", label, value)), Sense::hover()).on_hover_text(value);
    }
}

// ---------------------------------------------------------------------------
// Dense Booktabs Data Table

/// Horizontal alignment of a table column.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColumnAlign {
    Left,
    Right,
}

/// Sizing policy of a table column.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ColumnWidth {
    /// Fixed logical width in pixels.
    Exact(f32),
    /// Proportional weight sharing the remaining table width.
    Weight(f32),
}

/// Column definition for [`DataTable`].
#[derive(Clone, Debug)]
pub struct TableColumn<'a> {
    pub id: &'a str,
    pub label: &'a str,
    pub align: ColumnAlign,
    pub width: ColumnWidth,
    pub sortable: bool,
}

impl<'a> TableColumn<'a> {
    pub fn left(id: &'a str, label: &'a str, width: ColumnWidth) -> Self {
        Self { id, label, align: ColumnAlign::Left, width, sortable: true }
    }

    pub fn right(id: &'a str, label: &'a str, width: ColumnWidth) -> Self {
        Self { id, label, align: ColumnAlign::Right, width, sortable: true }
    }

    pub fn unsortable(mut self) -> Self {
        self.sortable = false;
        self
    }
}

/// Active sort state for a [`DataTable`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SortState {
    pub column: usize,
    pub ascending: bool,
}

/// Typed cell payload for a [`DataTable`] row.
#[derive(Clone, Debug)]
pub enum TableCell {
    /// Regular sans-serif label.
    Text(String),
    /// Tabular monospace numeric or identifier value.
    Number(String),
    /// Muted secondary metadata value.
    Muted(String),
    /// Compact uppercase status chip (keeps its semantic tone even when row is selected).
    Chip(String, StatusTone),
    /// Inline usage bar with tabular percentage.
    Usage { fraction: f32, label: String, tone: StatusTone },
    /// Small square 1-letter badge beside primary text.
    BadgeText { badge: String, text: String },
}

/// One row of cells in a [`DataTable`].
#[derive(Clone, Debug)]
pub struct TableRow {
    pub id: String,
    pub cells: Vec<TableCell>,
}

/// Events emitted by [`DataTable::show`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TableEvent {
    pub clicked_row: Option<usize>,
    pub double_clicked_row: Option<usize>,
    pub sort_changed: Option<SortState>,
}

/// Dense Sternbild booktabs table with sticky header, tabular alignment, and bronze row selection.
pub struct DataTable<'a> {
    pub id: &'a str,
    pub columns: &'a [TableColumn<'a>],
    pub rows: &'a [TableRow],
    pub selected: Option<usize>,
    pub sort: Option<SortState>,
    pub row_height: f32,
    pub max_height: Option<f32>,
}

impl<'a> DataTable<'a> {
    pub fn new(id: &'a str, columns: &'a [TableColumn<'a>], rows: &'a [TableRow]) -> Self {
        Self {
            id,
            columns,
            rows,
            selected: None,
            sort: None,
            row_height: metric::ROW,
            max_height: None,
        }
    }

    pub fn selected(mut self, selected: Option<usize>) -> Self {
        self.selected = selected;
        self
    }

    pub fn sort(mut self, sort: Option<SortState>) -> Self {
        self.sort = sort;
        self
    }

    pub fn row_height(mut self, row_height: f32) -> Self {
        self.row_height = row_height;
        self
    }

    pub fn max_height(mut self, max_height: f32) -> Self {
        self.max_height = Some(max_height);
        self
    }

    /// Computes horizontal `(left, right)` bounds for each column inside `total_width`.
    pub fn column_spans(columns: &[TableColumn<'_>], left: f32, total_width: f32) -> Vec<(f32, f32)> {
        let mut exact_sum = 0.0;
        let mut weight_sum = 0.0;
        for col in columns {
            match col.width {
                ColumnWidth::Exact(w) => exact_sum += w,
                ColumnWidth::Weight(w) => weight_sum += w.max(0.01),
            }
        }
        let flex_space = (total_width - exact_sum).max(0.0);
        let mut x = left;
        let mut spans = Vec::with_capacity(columns.len());
        for (i, col) in columns.iter().enumerate() {
            let w = match col.width {
                ColumnWidth::Exact(px) => px,
                ColumnWidth::Weight(weight) => {
                    if weight_sum > 0.0 {
                        (flex_space * (weight.max(0.01) / weight_sum)).floor()
                    } else {
                        0.0
                    }
                }
            };
            let right = if i + 1 == columns.len() { left + total_width } else { (x + w).min(left + total_width) };
            spans.push((x, right.max(x)));
            x = right;
        }
        spans
    }

    /// Renders the sticky header and vertically scrollable booktabs body.
    pub fn show(self, ui: &mut Ui) -> TableEvent {
        let mut event = TableEvent::default();
        let width = ui.available_width().max(1.0);
        let left = ui.cursor().left();
        let spans = Self::column_spans(self.columns, left, width);

        ui.spacing_mut().item_spacing.y = 0.0;

        // Sticky booktabs header row: faint toprule, uppercase tracked heads, bronze sort chevron, rule midrule.
        let (header_rect, _) = ui.allocate_exact_size(vec2(width, metric::TABLE_HEADER), Sense::hover());
        let p = ui.painter().clone();
        draw::rule_h(&p, header_rect.left(), header_rect.right(), header_rect.top(), color::FAINT);
        draw::rule_h(&p, header_rect.left(), header_rect.right(), header_rect.bottom() - 1.0, color::RULE);

        let cell_pad_x = 6.0;
        let chevron_w = 8.0;
        let chevron_gap = 5.0;

        for (i, (col, &(c_left, c_right))) in self.columns.iter().zip(&spans).enumerate() {
            let cell_rect = Rect::from_min_max(pos2(c_left, header_rect.top() + 1.0), pos2(c_right, header_rect.bottom() - 1.0));
            let resp = ui.interact(
                cell_rect,
                ui.scope_id().with((self.id, "col_head", col.id, i)),
                if col.sortable { Sense::click() } else { Sense::hover() },
            );
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, col.sortable, col.label));
            if col.sortable && resp.hovered() {
                p.rect_filled(cell_rect, 0.0, color::PLATE_HOVER);
            }
            if col.sortable && resp.on_hover_cursor(CursorIcon::PointingHand).clicked() {
                let next = match self.sort {
                    Some(s) if s.column == i => SortState { column: i, ascending: !s.ascending },
                    _ => SortState { column: i, ascending: true },
                };
                event.sort_changed = Some(next);
            }

            let is_sorted = col.sortable && self.sort.is_some_and(|s| s.column == i);
            let inner = Rect::from_min_max(
                pos2(cell_rect.left() + cell_pad_x, cell_rect.top()),
                pos2((cell_rect.right() - cell_pad_x).max(cell_rect.left() + cell_pad_x), cell_rect.bottom()),
            );
            let label_color = if is_sorted { color::PARCHMENT } else { color::SECONDARY };
            let job = theme::label_job(col.label, label_color);
            let align = match col.align {
                ColumnAlign::Left => Align::Min,
                ColumnAlign::Right => Align::Max,
            };
            let w = theme::paint_job(&p, inner, job, align, true);

            if let Some(sort) = self.sort.filter(|s| col.sortable && s.column == i) {
                let chev_x = match col.align {
                    ColumnAlign::Left => (inner.left() + w + chevron_gap).min(inner.right() - chevron_w),
                    ColumnAlign::Right => (inner.right() - w - chevron_gap - chevron_w).max(inner.left()),
                };
                draw::sort_chevron(&p, chev_x, inner.center().y, sort.ascending, color::BRONZE);
            }
        }

        // Scrollable rows body.
        let body_height = self.max_height.unwrap_or_else(|| ui.available_height().max(self.row_height));
        let mut area = ScrollArea::vertical().id_salt((self.id, "body")).auto_shrink([false, false]);
        if self.max_height.is_some() || body_height > 0.0 {
            area = area.max_height((body_height - 1.0).max(self.row_height));
        }

        let scroll_out = area.show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 0.0;
            let row_spans = Self::column_spans(self.columns, ui.cursor().left(), width);
            for (row_idx, row) in self.rows.iter().enumerate() {
                let selected = self.selected == Some(row_idx);
                let (row_rect, resp) = ui.allocate_exact_size(vec2(width, self.row_height), Sense::click());
                let primary_label = row.cells.first().map(cell_a11y_label).unwrap_or_else(|| row.id.clone());
                resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, selected, primary_label.clone()));

                let rp = ui.painter();
                if selected {
                    rp.rect_filled(row_rect, 0.0, color::PLATE);
                    rp.rect_filled(
                        Rect::from_min_size(row_rect.min, vec2(metric::SELECTION_BAR, row_rect.height())),
                        0.0,
                        color::BRONZE,
                    );
                } else if resp.hovered() {
                    rp.rect_filled(row_rect, 0.0, color::PLATE_HOVER);
                }

                if row_idx + 1 < self.rows.len() {
                    draw::rule_h(rp, row_rect.left(), row_rect.right(), row_rect.bottom() - 1.0, color::RULE_FAINT);
                }

                for ((col, &(c_left, c_right)), cell) in
                    self.columns.iter().zip(&row_spans).zip(row.cells.iter())
                {
                    let inner = Rect::from_min_max(
                        pos2(c_left + cell_pad_x, row_rect.top()),
                        pos2((c_right - cell_pad_x).max(c_left + cell_pad_x), row_rect.bottom() - 1.0),
                    );
                    let align = match col.align {
                        ColumnAlign::Left => Align::Min,
                        ColumnAlign::Right => Align::Max,
                    };
                    paint_cell(rp, inner, cell, align, selected);
                }

                let resp = resp.on_hover_cursor(CursorIcon::PointingHand);
                if resp.double_clicked() {
                    event.double_clicked_row = Some(row_idx);
                    event.clicked_row = Some(row_idx);
                } else if resp.clicked() {
                    event.clicked_row = Some(row_idx);
                }
            }
        });

        // Booktabs bottomrule (`FAINT`) below the visible rows or scroll viewport.
        let bottom_y = scroll_out.inner_rect.bottom().min(scroll_out.content_size.y + scroll_out.inner_rect.top());
        draw::rule_h(ui.painter(), left, left + width, bottom_y, color::FAINT);

        event
    }
}

fn cell_a11y_label(cell: &TableCell) -> String {
    match cell {
        TableCell::Text(s) | TableCell::Number(s) | TableCell::Muted(s) | TableCell::Chip(s, _) => s.clone(),
        TableCell::Usage { label, .. } => label.clone(),
        TableCell::BadgeText { text, .. } => text.clone(),
    }
}

fn paint_cell(painter: &Painter, rect: Rect, cell: &TableCell, align: Align, selected: bool) {
    let primary_ink = if selected { color::BRONZE } else { color::PARCHMENT };
    let secondary_ink = if selected { color::BRONZE } else { color::SECONDARY };
    match cell {
        TableCell::Text(text) => {
            theme::paint_job(painter, rect, theme::sans_job(text, font_size::BODY, primary_ink, selected), align, true);
        }
        TableCell::Number(text) => {
            theme::paint_job(painter, rect, theme::mono_job(text, font_size::MONO, primary_ink), align, true);
        }
        TableCell::Muted(text) => {
            theme::paint_job(painter, rect, theme::mono_job(text, font_size::MONO_SMALL, secondary_ink), align, true);
        }
        TableCell::Chip(text, tone) => {
            let chip_w = status_chip_size(painter, text).x;
            let x = match align {
                Align::Min => rect.left(),
                Align::Center => rect.center().x - chip_w * 0.5,
                Align::Max => rect.right() - chip_w,
            };
            let clipped = painter.with_clip_rect(rect.intersect(painter.clip_rect()));
            paint_status_chip(&clipped, x, rect.center().y, text, *tone);
        }
        TableCell::Usage { fraction, label, tone } => {
            paint_usage_bar(painter, rect, *fraction, *tone, Some(label.as_str()));
        }
        TableCell::BadgeText { badge, text } => {
            let side = 18.0;
            let b_rect = Rect::from_center_size(pos2(rect.left() + side * 0.5, rect.center().y), Vec2::splat(side));
            painter.rect_filled(b_rect, 0.0, color::DEEP);
            draw::box_outline(painter, b_rect, if selected { color::BRONZE } else { color::RULE_FAINT });
            let ch = badge.chars().next().unwrap_or('?').to_ascii_uppercase().to_string();
            theme::paint_job(painter, b_rect, theme::mono_job(&ch, font_size::CHIP, primary_ink), Align::Center, false);
            let text_rect = Rect::from_min_max(pos2(b_rect.right() + 7.0, rect.top()), rect.max);
            theme::paint_job(
                painter,
                text_rect,
                theme::sans_job(text, font_size::BODY, primary_ink, selected),
                Align::Min,
                true,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_spans_mix_exact_and_weighted_columns() {
        let cols = [
            TableColumn::left("name", "Item", ColumnWidth::Weight(2.0)),
            TableColumn::left("status", "Status", ColumnWidth::Exact(100.0)),
            TableColumn::right("count", "Count", ColumnWidth::Weight(1.0)),
        ];
        let spans = DataTable::column_spans(&cols, 10.0, 400.0);
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[0], (10.0, 210.0));
        assert_eq!(spans[1], (210.0, 310.0));
        assert_eq!(spans[2], (310.0, 410.0));
    }

    #[test]
    fn usage_bar_tone_thresholds_match_bands() {
        assert_eq!(usage_bar_tone(0.25), StatusTone::Ok);
        assert_eq!(usage_bar_tone(0.74), StatusTone::Ok);
        assert_eq!(usage_bar_tone(0.75), StatusTone::Warn);
        assert_eq!(usage_bar_tone(0.89), StatusTone::Warn);
        assert_eq!(usage_bar_tone(0.90), StatusTone::Error);
    }
}
