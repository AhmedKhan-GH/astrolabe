//! Ollama model inventory, memory sparkline, and residency table.

use astrolabe_engines::agents::{self, Loaded, OllamaModel, Provider, Status, limits::ollama};
use astrolabe_kit::{color, draw, font_size, metric, theme};
use egui::{Align, Rect, ScrollArea, Sense, Stroke, Ui, pos2, vec2};

use super::{AgentsPanel, Col, PAD, col_rect, table_row};

const COLS: [Col; 7] = [
    Col(0.24, "Size"),
    Col(0.34, "Memory"),
    Col(0.44, "GPU"),
    Col(0.54, "Context"),
    Col(0.65, "KV Est."),
    Col(0.75, "Loaded Time"),
    Col(0.87, "Last Seen"),
];

const MODEL_ROW_H: f32 = 34.0;

impl AgentsPanel {
    pub(super) fn ollama_body(&self, ui: &mut Ui, t: f64) {
        ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
        let width = ui.available_width().max(1.0);

        // Band 1: Model Memory overview + 10-minute sparkline.
        self.ollama_memory(ui, width);

        // Band 2: Sticky column header.
        let (head, _) = ui.allocate_exact_size(vec2(width, metric::TABLE_HEADER), Sense::hover());
        let p = ui.painter();
        draw::rule_h(p, head.left(), head.right(), head.bottom() - 1.0, color::RULE);
        let name_rect = Rect::from_min_max(
            pos2(head.left() + PAD, head.top()),
            pos2(head.left() + width * COLS[0].0, head.bottom() - 1.0),
        );
        theme::paint_job(p, name_rect, theme::label_job("Model", color::SECONDARY), Align::Min, true);
        for (i, col) in COLS.iter().enumerate() {
            theme::paint_job(
                p,
                col_rect(head, &COLS, i, head.center().y),
                theme::label_job(col.1, color::SECONDARY),
                Align::Min,
                true,
            );
        }

        // Band 3: Scrollable model rows.
        ScrollArea::vertical().id_salt("agents_ollama_scroll").auto_shrink([false, false]).show(ui, |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            let w = ui.available_width().max(1.0);
            let o = &self.shared.ollama;
            if o.status == Status::Ok {
                let models = agents::sorted_ollama_models(o);
                if models.is_empty() {
                    self.ollama_empty(ui, w, "No Installed Models", "");
                } else {
                    for (i, m) in models.iter().enumerate() {
                        let loaded = o.loaded.iter().find(|l| l.name == m.name);
                        self.ollama_model(ui, w, m, loaded, i + 1 == models.len(), t);
                    }
                }
            } else {
                self.ollama_empty(ui, w, "Ollama", &o.detail);
            }
        });
    }

    fn ollama_empty(&self, ui: &mut Ui, width: f32, name: &str, detail: &str) {
        let (rect, _) = table_row(ui, width, MODEL_ROW_H, true, name);
        self.paint_name_cell(ui, rect, rect.right() - PAD, self.provider_icon(Provider::Ollama), name, detail);
    }

    fn ollama_memory(&self, ui: &mut Ui, width: f32) {
        let o = &self.shared.ollama;
        let (rect, response) = table_row(ui, width, 30.0, false, "Ollama memory overview");
        response.on_hover_text("Loaded model memory / physical RAM. Timeline: last 10 minutes.");

        let live = o.status == Status::Ok;
        let bytes = agents::loaded_memory_bytes(o);
        let total = o.total_memory.filter(|n| *n > 0);
        let value = if live {
            total.map(|n| format!("{} / {}", agents::gb(bytes), agents::gb(n))).unwrap_or_else(|| agents::gb(bytes))
        } else {
            "—".into()
        };

        let label = Rect::from_min_max(rect.min + vec2(PAD, 0.0), rect.max - vec2(PAD, 0.0));
        let label_w = theme::paint_job(ui.painter(), label, theme::label_job("Model Memory", color::SECONDARY), Align::Min, false);
        let val_rect = Rect::from_min_max(pos2(label.left() + label_w + 12.0, rect.top()), label.max);
        let val_w = theme::paint_job(ui.painter(), val_rect, theme::mono_job(&value, font_size::MONO, color::PARCHMENT), Align::Min, false);

        let plot_left = (val_rect.left() + val_w + 20.0).max(rect.left() + width * COLS[0].0 + PAD);
        let summary_rect = Rect::from_min_max(label.min, pos2((plot_left - 16.0).max(label.left() + 1.0), rect.bottom()));
        ui.interact(summary_rect, ui.scope_id().with("ollama-memory-total"), Sense::hover())
            .widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, format!("Model memory: {value}")));

        let plot = Rect::from_min_max(pos2(plot_left, rect.top() + 5.0), rect.max - vec2(PAD, 6.0));
        ui.interact(plot, ui.scope_id().with("ollama-memory-timeline"), Sense::hover())
            .widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, "Model memory over the last 10 minutes"));

        let p = ui.painter();
        p.rect_filled(plot, 0.0, color::DEEP);
        draw::rule_h(p, plot.left(), plot.right(), plot.bottom(), color::RULE);

        let max = total.unwrap_or(o.peak_bytes.max(1)).max(o.peak_bytes) as f32;
        let end = o.checked_at;
        let point = |at: f64, b: u64| {
            pos2(
                plot.right() - ((end - at) / 600.0) as f32 * plot.width(),
                plot.bottom() - (b as f32 / max).clamp(0.0, 1.0) * (plot.height() - 2.0) - 1.0,
            )
        };
        let max_gap = if self.demo { 30.0 } else { ollama::EVERY.as_secs_f64() * 3.0 };
        let clipped = ui.painter().with_clip_rect(plot.intersect(ui.clip_rect()));
        for pair in o.memory_history.windows(2) {
            if let (Some(a), Some(b)) = (pair[0].bytes, pair[1].bytes)
                && pair[1].at - pair[0].at <= max_gap
            {
                clipped.line_segment([point(pair[0].at, a), point(pair[1].at, b)], Stroke::new(1.5, color::INFO));
            }
        }
        if let Some(last) = o.memory_history.last().filter(|s| s.bytes.is_some()) {
            clipped.circle_filled(point(last.at, last.bytes.unwrap()), 2.5, color::INFO);
        }
    }

    fn ollama_model(&self, ui: &mut Ui, width: f32, m: &OllamaModel, loaded: Option<&Loaded>, last: bool, t: f64) {
        let (rect, response) = table_row(ui, width, MODEL_ROW_H, last, &m.name);
        let detail = [&m.family, &m.parameters, &m.quantization]
            .into_iter()
            .filter(|s| !s.is_empty())
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(" · ");

        self.paint_name_cell(
            ui,
            rect,
            rect.left() + width * COLS[0].0,
            self.provider_icon(Provider::Ollama),
            &m.name,
            "",
        );

        let activity = self.shared.ollama.activity.get(&m.name);
        let warning = loaded.and_then(ollama::warning);
        let warning_color = match warning {
            Some(ollama::Warning::VeryLarge) => color::ERROR,
            Some(ollama::Warning::Large) => color::WARN,
            None => color::PARCHMENT,
        };

        let mut tooltip = detail;
        if let Some(l) = loaded {
            tooltip.push_str(&format!(
                "\n{} in memory; {} on GPU.",
                agents::gb(l.size),
                agents::gb(l.size_vram.min(l.size))
            ));
            if let Some(cache) = l.cache() {
                tooltip.push_str(&format!(" Estimated 16-bit KV cache: {}.", agents::gb(cache)));
            }
            if let Some(at) = l.expires_at.filter(|at| *at > t) {
                tooltip.push_str(&format!(" Scheduled unload {}.", agents::until(at - t)));
            }
        }
        if let Some(a) = activity {
            tooltip.push_str(&format!("\nSession peak memory: {}.", agents::gb(a.peak_bytes)));
        }
        if !tooltip.is_empty() {
            response.on_hover_text(tooltip);
        }

        let figures = [
            (if m.size > 0 { agents::gb(m.size) } else { "—".into() }, color::PARCHMENT),
            (
                loaded.map(|l| agents::gb(l.size)).unwrap_or_else(|| "Not loaded".into()),
                if loaded.is_some() { color::PARCHMENT } else { color::FAINT },
            ),
            (loaded.map(|l| agents::gb(l.size_vram.min(l.size))).unwrap_or_else(|| "—".into()), color::PARCHMENT),
            (loaded.and_then(|l| l.context).map(agents::grouped).unwrap_or_else(|| "—".into()), warning_color),
            (loaded.and_then(Loaded::cache).map(agents::gb).unwrap_or_else(|| "—".into()), warning_color),
            (activity.map(|a| agents::elapsed(a.loaded_seconds)).unwrap_or_else(|| "—".into()), color::PARCHMENT),
            (
                if loaded.is_some() {
                    "Now".into()
                } else {
                    activity.map(|a| agents::limits::ago(t - a.last_seen)).unwrap_or_else(|| "—".into())
                },
                if loaded.is_some() { color::OK } else { color::SECONDARY },
            ),
        ];

        for (i, (value, c)) in figures.iter().enumerate() {
            theme::paint_job(
                ui.painter(),
                col_rect(rect, &COLS, i, rect.center().y),
                theme::mono_job(value, font_size::MONO, *c),
                Align::Min,
                true,
            );
        }
    }
}
