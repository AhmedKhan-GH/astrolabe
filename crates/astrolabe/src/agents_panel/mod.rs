//! Agents panel: live provider quota/balance table, local Ollama inventory and
//! memory sparkline, status bar telemetry, and Keychain API key Settings modal.

mod limits;
mod ollama;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::Duration;

use astrolabe_engines::agents::{
    self, Cmd, Config, Engine, Provider, Shared, Status, UsageLevel, keychain, limits::xiaomi, paths,
};
use astrolabe_kit::{
    IconKind, Pane, SidebarItem, SidebarSection, StatusTone, color, font_size, primary_button, split_vertical,
    status_indicator, status_item, status_chip, theme,
};
use egui::{Align, Color32, CursorIcon, Rect, Ui, Vec2, pos2, vec2};

use crate::icons;
use crate::widgets;

pub(crate) const PAD: f32 = 12.0;
pub(crate) const GAP: f32 = 12.0;
pub(crate) const ICON: f32 = 22.0;
pub(crate) const LINE_H: f32 = 19.0;
pub(crate) const MIN_ROW_H: f32 = 30.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentsPane {
    Limits,
    Ollama,
}

#[derive(Clone, Debug)]
pub enum Click {
    CheckNow,
    Settings(bool),
    KeyProvider(Provider),
    SaveKey,
    ForgetKey,
    FocusPane(AgentsPane),
}

pub struct AgentsPanel {
    pub(crate) engine: Engine,
    pub(crate) shared: Shared,
    pub(crate) demo: bool,
    pub(crate) fixed_now: Option<f64>,
    pub(crate) focused_pane: AgentsPane,
    pub(crate) settings_open: bool,
    pub(crate) key_input: String,
    pub(crate) key_provider: Provider,
    pub(crate) xiaomi_region: xiaomi::Region,
    pub(crate) logos: HashMap<&'static str, egui::TextureHandle>,
    pub(crate) icons: HashMap<PathBuf, egui::TextureHandle>,
    icon_tx: Sender<(PathBuf, egui::ColorImage)>,
    icon_rx: Receiver<(PathBuf, egui::ColorImage)>,
    icons_asked: HashSet<PathBuf>,
}

impl AgentsPanel {
    pub fn live(ctx: &egui::Context) -> Self {
        let repaint = ctx.clone();
        let engine = Engine::start(Config::real(), move || repaint.request_repaint());
        Self::with_engine(ctx, engine, false, None)
    }

    pub fn demo(ctx: &egui::Context) -> Self {
        let shared = agents::demo::demo_data();
        let engine = Engine::fixed(shared);
        Self::with_engine(ctx, engine, true, Some(agents::DEMO_NOW_SECS))
    }

    pub fn with_engine(ctx: &egui::Context, engine: Engine, demo: bool, fixed_now: Option<f64>) -> Self {
        let (icon_tx, icon_rx) = channel();
        let logos = icons::AGENT_LOGOS
            .into_iter()
            .filter_map(|(id, bytes)| {
                let image = icons::load_png_bytes(bytes)?;
                let tex = ctx.load_texture(format!("agent-logo-{id}"), image, egui::TextureOptions::LINEAR);
                Some((id, tex))
            })
            .collect();
        Self {
            shared: engine.snapshot(),
            engine,
            demo,
            fixed_now,
            focused_pane: AgentsPane::Limits,
            settings_open: false,
            key_input: String::new(),
            key_provider: Provider::Glm,
            xiaomi_region: xiaomi::Region::China,
            logos,
            icons: HashMap::new(),
            icon_tx,
            icon_rx,
            icons_asked: HashSet::new(),
        }
    }

    pub fn now(&self) -> f64 {
        self.fixed_now.unwrap_or_else(agents::now)
    }

    pub fn provider_count(&self) -> usize {
        self.shared.limits.len()
    }

    pub fn tick(&mut self, ctx: &egui::Context) {
        self.shared = self.engine.snapshot();
        if !self.demo {
            self.load_icons(ctx);
            ctx.request_repaint_after(Duration::from_secs(20));
        }
    }

    pub fn apply(&mut self, clicks: Vec<Click>) {
        for click in clicks {
            match click {
                Click::CheckNow => {
                    if !self.demo {
                        self.engine.send(Cmd::CheckNow);
                    }
                }
                Click::Settings(open) => {
                    self.settings_open = open;
                    self.key_input.clear();
                }
                Click::KeyProvider(provider) => {
                    self.key_provider = provider;
                    self.key_input.clear();
                }
                Click::SaveKey => {
                    let mut key = std::mem::take(&mut self.key_input);
                    if !key.trim().is_empty() {
                        if self.demo {
                            let mut s = self.engine.shared.lock().unwrap();
                            s.stored_keys.insert(self.key_provider);
                            s.settings_error = None;
                            self.shared = s.clone();
                        } else {
                            if self.key_provider == Provider::Xiaomi {
                                key = xiaomi::manual_key(self.xiaomi_region, key.trim());
                            }
                            self.engine.send(Cmd::SetKey(self.key_provider, key));
                        }
                    }
                }
                Click::ForgetKey => {
                    if self.demo {
                        let mut s = self.engine.shared.lock().unwrap();
                        s.stored_keys.remove(&self.key_provider);
                        s.settings_error = None;
                        self.shared = s.clone();
                    } else {
                        self.engine.send(Cmd::ForgetKey(self.key_provider));
                    }
                }
                Click::FocusPane(pane) => {
                    self.focused_pane = pane;
                }
            }
        }
    }

    /// Extra sidebar sections shown below `Workspace` when Agents is active.
    pub fn sidebar_sections(&self) -> Vec<SidebarSection<'static>> {
        let summary = agents::summarize_limits(&self.shared.limits, self.now());
        vec![
            SidebarSection {
                title: "Sections",
                items: vec![
                    SidebarItem::new("agents:limits", "Account Limits")
                        .icon(IconKind::Layers)
                        .count(summary.ok)
                        .active(self.focused_pane == AgentsPane::Limits && !self.settings_open),
                    SidebarItem::new("agents:ollama", "Ollama Models")
                        .icon(IconKind::Pulse)
                        .count(self.shared.ollama.installed)
                        .active(self.focused_pane == AgentsPane::Ollama && !self.settings_open),
                ],
            },
            SidebarSection {
                title: "Credentials",
                items: vec![
                    SidebarItem::new("agents:keys", "Stored Keys")
                        .icon(IconKind::Link)
                        .count(self.shared.stored_keys.len())
                        .active(self.settings_open),
                ],
            },
        ]
    }

    pub fn handle_sidebar(&mut self, id: &str) {
        match id {
            "agents:limits" => {
                self.focused_pane = AgentsPane::Limits;
                self.settings_open = false;
            }
            "agents:ollama" => {
                self.focused_pane = AgentsPane::Ollama;
                self.settings_open = false;
            }
            "agents:keys" => {
                self.apply(vec![Click::Settings(true)]);
            }
            _ => {}
        }
    }

    pub fn command_bar_right(&self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        let resp = primary_button(ui, "Check Now", None, true)
            .on_hover_text("Check providers outside 30-second minimum gap");
        if resp.clicked() {
            clicks.push(Click::CheckNow);
        }
    }

    pub fn show_workspace(&mut self, ui: &mut Ui, workspace: Rect, clicks: &mut Vec<Click>) {
        let t = self.now();
        let (limits_rect, ollama_rect) = split_vertical(workspace, 0.715, 280.0, 224.0);

        let list = self.shared.limit_list();
        let read = list.iter().filter(|l| l.status == Status::Ok).count();
        let limits_meta = format!("{read} OF {}", list.len());
        let limits_resp = Pane::new("agents_limits", "Account Limits", self.focused_pane == AgentsPane::Limits)
            .meta(&limits_meta)
            .shortcut("⌘1")
            .padding(0.0)
            .show(ui, limits_rect, |ui| {
                self.limits_body(ui, t);
            });
        if limits_resp.header.clicked() {
            clicks.push(Click::FocusPane(AgentsPane::Limits));
        }

        let ollama_meta = if self.shared.ollama.status == Status::Ok {
            format!("{} MODELS · {} LOADED", self.shared.ollama.installed, self.shared.ollama.loaded.len())
        } else {
            String::new()
        };
        let mut ollama_pane = Pane::new("agents_ollama", "Ollama", self.focused_pane == AgentsPane::Ollama)
            .shortcut("⌘2")
            .top_rule(true)
            .padding(0.0);
        if !ollama_meta.is_empty() {
            ollama_pane = ollama_pane.meta(&ollama_meta);
        }
        let ollama_resp = ollama_pane.show(ui, ollama_rect, |ui| {
            self.ollama_body(ui, t);
        });
        if ollama_resp.header.clicked() {
            clicks.push(Click::FocusPane(AgentsPane::Ollama));
        }

        if self.settings_open {
            let ctx = ui.ctx().clone();
            self.settings_dialog(&ctx, clicks);
        }
    }

    pub fn status_bar_left(&self, ui: &mut Ui) {
        let t = self.now();
        let s = &self.shared;
        let newest =
            s.limits.values().filter(|l| l.status != Status::Checking).map(|l| l.checked_at).fold(0.0, f64::max);
        if s.limits.values().any(|l| l.status == Status::Checking) {
            status_indicator(ui, "CHECKING LIMITS", true, StatusTone::Info);
        } else if newest > 0.0 {
            let label = format!("LIMITS CHECKED {}", agents::limits::ago(t - newest).to_ascii_uppercase());
            status_indicator(ui, &label, true, StatusTone::Ok);
        }
    }

    pub fn status_bar_right(&self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        // Right-to-left layout: first added appears rightmost.
        let settings = widgets::mono_link(ui, "Settings").on_hover_text("Provider API keys");
        if settings.clicked() {
            clicks.push(Click::Settings(true));
        }
        let has_more = !self.shared.probe_left.is_empty() || self.shared.ollama.free_pct.is_some();
        if has_more {
            widgets::status_sep(ui);
        }
        if !self.shared.probe_left.is_empty() {
            let text = format!("{} holds {}", paths::tilde(&paths::probe_dir()), self.shared.probe_left.join(", "));
            let job = theme::mono_job("PROBE FOLDER NOT EMPTY", font_size::MONO_SMALL, color::WARN);
            let w = theme::job_width(ui, job.clone()).ceil();
            let (rect, resp) = ui.allocate_exact_size(vec2(w, astrolabe_kit::metric::STATUS_BAR - 2.0), egui::Sense::hover());
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, "Probe Folder Not Empty"));
            theme::paint_job(ui.painter(), rect, job, Align::Min, false);
            resp.on_hover_text(text);
            if self.shared.ollama.free_pct.is_some() {
                widgets::status_sep(ui);
            }
        }
        if let Some(free) = self.shared.ollama.free_pct {
            let c = match agents::memory_level(free) {
                UsageLevel::Critical => color::ERROR,
                UsageLevel::Warning => color::WARN,
                UsageLevel::Normal => color::SECONDARY,
            };
            status_item(ui, &format!("MEMORY {free}% FREE"), c);
        }
    }

    fn settings_dialog(&mut self, ctx: &egui::Context, clicks: &mut Vec<Click>) {
        let stored = self.shared.stored_keys.contains(&self.key_provider);
        let modal = egui::Modal::new(egui::Id::unique("agents_settings")).frame(widgets::modal_frame()).show(ctx, |ui| {
            ui.set_width(440.0);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("API KEY SETTINGS")
                        .font(egui::FontId::new(font_size::LABEL, theme::ui_family()))
                        .extra_letter_spacing(astrolabe_kit::metric::TRACKING)
                        .color(color::PARCHMENT),
                );
            });
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("PROVIDER")
                        .font(egui::FontId::new(font_size::LABEL, theme::ui_family()))
                        .extra_letter_spacing(astrolabe_kit::metric::TRACKING)
                        .color(color::SECONDARY),
                );
                egui::ComboBox::from_id_salt("key-provider")
                    .selected_text(self.key_provider.name())
                    .show_ui(ui, |ui| {
                        for &provider in keychain::KEY_PROVIDERS {
                            if ui.selectable_label(provider == self.key_provider, provider.name()).clicked() {
                                clicks.push(Click::KeyProvider(provider));
                            }
                        }
                    });
            });
            ui.add_space(8.0);
            let note = match self.key_provider {
                Provider::Glm => "Coding Plan Key · Overrides ZCode",
                Provider::Mistral => "Organization Usage Key · Overrides Vibe .env",
                Provider::MiniMax => "International Token Plan Key",
                Provider::DeepSeek => "Account Balance API Key",
                Provider::Xiaomi => "MiMo Token Plan Key · Overrides MiMo Code",
                _ => "",
            };
            ui.label(egui::RichText::new(note).size(font_size::MONO_SMALL).color(color::SECONDARY));

            if self.key_provider == Provider::Xiaomi {
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new("REGION")
                            .font(egui::FontId::new(font_size::LABEL, theme::ui_family()))
                            .extra_letter_spacing(astrolabe_kit::metric::TRACKING)
                            .color(color::SECONDARY),
                    );
                    egui::ComboBox::from_id_salt("xiaomi-region")
                        .selected_text(self.xiaomi_region.name())
                        .show_ui(ui, |ui| {
                            for region in xiaomi::Region::ALL {
                                ui.selectable_value(&mut self.xiaomi_region, region, region.name());
                            }
                        });
                });
            }

            ui.add_space(10.0);
            ui.horizontal(|ui| {
                let (word, tone) = if stored { ("Key Stored", StatusTone::Ok) } else { ("No Key", StatusTone::Neutral) };
                status_chip(ui, word, tone);
            });

            ui.add_space(10.0);
            let (field_rect, _) = ui.allocate_exact_size(vec2(440.0, 26.0), egui::Sense::hover());
            let id = ui.scope_id().with(("provider-key", self.key_provider));
            let resp = widgets::text_field(ui, field_rect, id, &mut self.key_input, "API key", true, true);
            if let Some((_, e)) = self.shared.settings_error.as_ref().filter(|(p, _)| *p == self.key_provider) {
                ui.add_space(6.0);
                ui.label(egui::RichText::new(e).size(font_size::MONO_SMALL).color(color::ERROR));
            }

            ui.add_space(14.0);
            ui.horizontal(|ui| {
                let can_save = !self.key_input.trim().is_empty();
                let save = primary_button(ui, "Save", None, can_save);
                if save.clicked() || (resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) && can_save) {
                    clicks.push(Click::SaveKey);
                }
                if widgets::action_button(ui, "Remove", stored, 82.0).clicked() {
                    clicks.push(Click::ForgetKey);
                }
                if widgets::action_button(ui, "Close", true, 82.0).clicked() {
                    clicks.push(Click::Settings(false));
                }
            });
        });
        if modal.should_close() {
            clicks.push(Click::Settings(false));
        }
    }

    fn load_icons(&mut self, ctx: &egui::Context) {
        while let Ok((path, image)) = self.icon_rx.try_recv() {
            let tex = ctx.load_texture(format!("agent-icon-{}", path.display()), image, egui::TextureOptions::LINEAR);
            self.icons.insert(path, tex);
        }
        let wanted: Vec<PathBuf> =
            self.shared.agents.iter().filter_map(|a| a.app.clone()).filter(|p| !self.icons_asked.contains(p)).collect();
        if wanted.is_empty() {
            return;
        }
        self.icons_asked.extend(wanted.iter().cloned());
        let (tx, ctx) = (self.icon_tx.clone(), ctx.clone());
        std::thread::spawn(move || {
            let dir = paths::cache_dir().join("icons");
            for app in wanted {
                let id = app.file_stem().map(|s| s.to_string_lossy().replace(' ', "-")).unwrap_or_default();
                if let Some(image) = icons::icon_png(&id, &app, &dir).and_then(|p| icons::load_file(&p)) {
                    let _ = tx.send((app, image));
                    ctx.request_repaint();
                }
            }
        });
    }

    pub(crate) fn tool_icon(&self, id: &str) -> Option<&egui::TextureHandle> {
        self.shared
            .agent(id)
            .and_then(|a| a.app.as_ref())
            .and_then(|p| self.icons.get(p))
            .or_else(|| icons::logo_id(id).and_then(|lid| self.logos.get(lid)))
    }

    pub(crate) fn provider_icon(&self, p: Provider) -> Option<&egui::TextureHandle> {
        let ids: &[&str] = match p {
            Provider::Claude => &["claude"],
            Provider::Codex => &["codex"],
            Provider::Kimi => &["kimi"],
            Provider::Glm => &["ZCode", "zcode"],
            Provider::Gemini => &["Antigravity", "agy", "gemini"],
            Provider::Grok => &["grok"],
            Provider::Meta => &["muse"],
            Provider::Qwen => &["qwen"],
            Provider::Mistral => &["vibe", "mistral"],
            Provider::MiniMax => &["MiniMax Code", "mcode", "minimax"],
            Provider::DeepSeek => &["deepseek"],
            Provider::Xiaomi => &["mimo", "xiaomi"],
            Provider::Tencent => &["CodeBuddy", "codebuddy", "tencent"],
            Provider::Ollama => &["ollama"],
        };
        ids.iter().find_map(|id| self.tool_icon(id))
    }

    pub(crate) fn paint_tile(&self, ui: &Ui, rect: Rect, icon: Option<&egui::TextureHandle>, name: &str) {
        match icon {
            Some(tex) => {
                egui::Image::from_texture((tex.id(), rect.size())).paint_at(ui, rect);
            }
            None => {
                let glyph = name.chars().next().unwrap_or('?').to_ascii_uppercase().to_string();
                widgets::badge_tile(ui.painter(), rect, &glyph, false);
            }
        }
    }

    pub(crate) fn paint_name_cell(
        &self,
        ui: &Ui,
        rect: Rect,
        right: f32,
        icon: Option<&egui::TextureHandle>,
        name: &str,
        muted: &str,
    ) {
        let p = ui.painter();
        let tile_rect = Rect::from_center_size(pos2(rect.left() + PAD + ICON * 0.5, rect.center().y), Vec2::splat(ICON));
        self.paint_tile(ui, tile_rect, icon, name);
        let text_l = rect.left() + PAD + ICON + GAP;
        let mid = rect.center().y;
        let l1 = Rect::from_min_max(pos2(text_l, mid - 10.0), pos2(right.max(text_l + 1.0), mid + 10.0));
        let w = theme::paint_job(p, l1, theme::sans_job(name, font_size::BODY, color::PARCHMENT, true), Align::Min, true);
        let beside = Rect::from_min_max(pos2(l1.left() + w + 8.0, l1.top() + 0.5), l1.max);
        if !muted.is_empty() && beside.width() > 24.0 {
            theme::paint_job(p, beside, theme::sans_job(muted, font_size::CHIP, color::FAINT, false), Align::Min, true);
        }
    }
}

pub(crate) struct Col(pub(crate) f32, pub(crate) &'static str);

pub(crate) fn col_rect(rect: Rect, cols: &[Col], i: usize, y: f32) -> Rect {
    let w = rect.width();
    let left = rect.left() + cols[i].0 * w + PAD;
    let right = cols.get(i + 1).map_or(rect.right() - PAD, |c| rect.left() + c.0 * w);
    Rect::from_min_max(pos2(left, y - LINE_H * 0.5), pos2(right.max(left + 1.0), y + LINE_H * 0.5))
}

pub(crate) fn line_y(rect: Rect, i: usize, n: usize) -> f32 {
    let n = n.max(1) as f32;
    rect.center().y + (i as f32 - (n - 1.0) * 0.5) * LINE_H
}

pub(crate) fn row_height(lines: usize) -> f32 {
    MIN_ROW_H.max(lines as f32 * LINE_H + 4.0)
}

pub(crate) fn level_color(used: f64) -> Color32 {
    widgets::usage_tone(agents::usage_level(used)).color()
}

pub(crate) fn table_row(ui: &mut Ui, width: f32, height: f32, last: bool, label: &str) -> (Rect, egui::Response) {
    let (rect, resp) = ui.allocate_exact_size(vec2(width, height), egui::Sense::hover());
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, label));
    let p = ui.painter();
    if resp.hovered() {
        p.rect_filled(rect, 0.0, color::PLATE_HOVER);
    }
    if !last {
        astrolabe_kit::draw::rule_h(p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE_FAINT);
    }
    (rect, resp)
}

#[allow(dead_code)]
pub(crate) fn hover_cursor(resp: egui::Response) -> egui::Response {
    resp.on_hover_cursor(CursorIcon::PointingHand)
}
