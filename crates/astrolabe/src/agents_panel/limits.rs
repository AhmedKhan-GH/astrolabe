//! Account Limits booktabs table across all 13 non-Ollama providers.

use astrolabe_engines::agents::{self, Limit, limits};
use astrolabe_kit::{color, draw, font_size, metric, theme};
use egui::{Align, Color32, Rect, ScrollArea, Sense, Ui, pos2, vec2};

use super::{AgentsPanel, Col, PAD, col_rect, level_color, line_y, row_height, table_row};

const COLS: [Col; 3] = [Col(0.26, "Window"), Col(0.49, "Usage / Balance"), Col(0.74, "Resets")];

impl AgentsPanel {
    pub(super) fn limits_body(&self, ui: &mut Ui, t: f64) {
        ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
        let width = ui.available_width().max(1.0);

        // Sticky booktabs column header.
        let (head, _) = ui.allocate_exact_size(vec2(width, metric::TABLE_HEADER), Sense::hover());
        let p = ui.painter();
        draw::rule_h(p, head.left(), head.right(), head.bottom() - 1.0, color::RULE);
        let prov_rect = Rect::from_min_max(
            pos2(head.left() + PAD, head.top()),
            pos2(head.left() + COLS[0].0 * width, head.bottom() - 1.0),
        );
        theme::paint_job(p, prov_rect, theme::label_job("Provider", color::SECONDARY), Align::Min, true);
        for (i, col) in COLS.iter().enumerate() {
            theme::paint_job(p, col_rect(head, &COLS, i, head.center().y), theme::label_job(col.1, color::SECONDARY), Align::Min, true);
        }

        // Scrollable provider rows.
        ScrollArea::vertical().id_salt("agents_limits_scroll").auto_shrink([false, false]).show(ui, |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            let w = ui.available_width().max(1.0);
            let list = self.shared.limit_list();
            for (k, limit) in list.iter().enumerate() {
                self.limit_row(ui, w, limit, k + 1 == list.len(), t);
            }
        });
    }

    fn limit_row(&self, ui: &mut Ui, width: f32, l: &Limit, last: bool, t: f64) {
        let lines = (l.windows.len() + l.balances.len()).max(1);
        let (rect, response) = table_row(ui, width, row_height(lines), last, l.provider.name());
        response.on_hover_text(&l.detail);

        let has_figures = !l.windows.is_empty() || !l.balances.is_empty();
        let right = if has_figures { rect.left() + COLS[0].0 * width } else { rect.right() - PAD };
        let extra = if has_figures { &l.account } else { &l.detail };
        self.paint_name_cell(ui, rect, right, self.provider_icon(l.provider), l.provider.name(), extra);

        let p = ui.painter().clone();
        for (i, w) in l.windows.iter().enumerate() {
            let y = line_y(rect, i, lines);
            theme::paint_job(
                &p,
                col_rect(rect, &COLS, 0, y),
                theme::sans_job(&w.name, font_size::MONO_SMALL, color::SECONDARY, false),
                Align::Min,
                true,
            );
            let used = limits::used_now(w, t);
            let c = if limits::is_tool_window(w) { color::SECONDARY } else { level_color(used) };
            usage_bar(ui, col_rect(rect, &COLS, 1, y), used, c, &format!("{} · {} usage", l.provider.name(), w.name));

            let resets = col_rect(rect, &COLS, 2, y);
            match w.resets_at {
                Some(at) if at > t => {
                    let wd = theme::paint_job(
                        &p,
                        resets,
                        theme::mono_job(&agents::until(at - t), font_size::MONO_SMALL, color::SECONDARY),
                        Align::Min,
                        false,
                    );
                    let rest = Rect::from_min_max(pos2(resets.left() + wd + 10.0, resets.top()), resets.max);
                    if rest.width() > 24.0 {
                        theme::paint_job(
                            &p,
                            rest,
                            theme::sans_job(&agents::local_time(at, t), font_size::CHIP, color::FAINT, false),
                            Align::Min,
                            true,
                        );
                    }
                }
                Some(_) => {
                    theme::paint_job(
                        &p,
                        resets,
                        theme::sans_job("Reset Since Reading", font_size::MONO_SMALL, color::FAINT, false),
                        Align::Min,
                        true,
                    );
                }
                None => {
                    theme::paint_job(&p, resets, theme::mono_job("—", font_size::MONO_SMALL, color::FAINT), Align::Min, false);
                }
            }
        }

        for (i, balance) in l.balances.iter().enumerate() {
            let y = line_y(rect, l.windows.len() + i, lines);
            theme::paint_job(
                &p,
                col_rect(rect, &COLS, 0, y),
                theme::sans_job("Available Credit", font_size::MONO_SMALL, color::SECONDARY, false),
                Align::Min,
                true,
            );
            let value = format!("{} {:.2}", balance.currency, balance.available);
            let value_rect = col_rect(rect, &COLS, 1, y);
            let resp = ui.interact(value_rect, ui.scope_id().with(("balance", l.provider, i)), Sense::hover());
            resp.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::Label, true, format!("{} balance: {value}", l.provider.name()))
            });
            resp.on_hover_text(format!("{} {} available", balance.currency, balance.available));
            let c = if balance.available > 0.0 { color::PARCHMENT } else { color::WARN };
            theme::paint_job(&p, value_rect, theme::mono_job(&value, font_size::MONO, c), Align::Min, true);
            theme::paint_job(
                &p,
                col_rect(rect, &COLS, 2, y),
                theme::mono_job("—", font_size::MONO_SMALL, color::FAINT),
                Align::Min,
                false,
            );
        }
    }
}

/// Sternbild square usage bar with right-aligned tabular percentage and AccessKit progress info.
fn usage_bar(ui: &mut Ui, rect: Rect, used: f64, c: Color32, label: &str) {
    let used = used.clamp(0.0, 100.0);
    let value = agents::percent(used);
    let resp = ui.interact(rect, ui.scope_id().with(label), Sense::hover());
    resp.widget_info(|| {
        let mut info = egui::WidgetInfo::labeled(egui::Role::ProgressIndicator, ui.is_enabled(), label);
        info.value = Some(used);
        info
    });
    resp.on_hover_text(format!("{label}: {value} used"));

    let p = ui.painter();
    let track_h = 6.0;
    let track = Rect::from_min_max(
        pos2(rect.left().floor(), (rect.center().y - track_h * 0.5).floor()),
        pos2((rect.right() - 48.0).max(rect.left() + 8.0).floor(), (rect.center().y + track_h * 0.5).floor()),
    );
    p.rect_filled(track, 0.0, color::RULE_FAINT);
    if used > 0.0 {
        let fill_w = (track.width() * (used / 100.0) as f32).round().max(1.0).min(track.width());
        let fill = Rect::from_min_size(track.min, vec2(fill_w, track.height()));
        p.rect_filled(fill, 0.0, c);
    }
    let value_rect = Rect::from_min_max(pos2(track.right() + 6.0, rect.top()), rect.max);
    theme::paint_job(p, value_rect, theme::mono_job(&value, font_size::MONO_SMALL, c), Align::Max, false);
}
