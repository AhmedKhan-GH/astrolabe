//! Manage mode: dedicated folder and tag CRUD, drag-and-drop folder reordering,
//! live query editor, pin/exclude management, and bulk tag/untag checklists.

use std::collections::BTreeSet;
use std::path::PathBuf;

use astrolabe_engines::repos::{Folder, Ide, query, tags};
use astrolabe_kit::{color, draw, font_size, metric, primary_button, theme};
use egui::{Align, CursorIcon, Key as K, Rect, ScrollArea, Sense, Stroke, Ui, UiBuilder, Vec2, pos2, vec2};

use super::inspector::{Fields, RowClick, header_text};
use super::{Click, FolderDrag, ReposPanel, Tab};
use crate::widgets;

const MARGIN: f32 = 14.0;
const STRIP_H: f32 = 36.0;
const SECTION_H: f32 = 26.0;
const SECTION_GAP: f32 = 10.0;
const ROW_H: f32 = 52.0;
const TAG_ROW_H: f32 = 38.0;
const CHECK_ROW_H: f32 = 30.0;
const ICON: f32 = 32.0;
const PAD: f32 = 12.0;
const GAP: f32 = 12.0;
const INDENT: f32 = 20.0;
const COL_W: f32 = 76.0;

fn folder_kind(f: &Folder) -> &'static str {
    match (f.is_smart(), f.repos.is_empty() && f.exclude.is_empty()) {
        (false, _) => "Folder",
        (true, true) => "Smart Folder",
        (true, false) => "Mixed Folder",
    }
}

#[derive(Clone, Copy, PartialEq)]
enum DropZone {
    Before,
    After,
    Into,
}

#[derive(Clone, Copy)]
enum SearchTarget {
    Add,
    Tag,
}

impl ReposPanel {
    pub(super) fn manage_rows(&mut self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        let rect = ui.max_rect();
        let strip = Rect::from_min_size(rect.min, vec2(rect.width(), STRIP_H));
        self.manage_strip(ui, strip, clicks);
        draw::rule_h(ui.painter(), rect.left(), rect.right(), strip.bottom() - 1.0, color::RULE_FAINT);

        let body = Rect::from_min_max(pos2(rect.left(), strip.bottom()), rect.max);
        let mut child = ui.new_child(
            UiBuilder::new().id_salt("manage_rows_body").max_rect(body).layout(egui::Layout::top_down(Align::Min)),
        );
        child.set_clip_rect(body.intersect(ui.clip_rect()));
        ScrollArea::vertical().id_salt("manage_scroll").auto_shrink([false, false]).show(&mut child, |ui| {
            egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 0, bottom: 16 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                let width = ui.available_width().max(1.0);
                match self.manager.tab {
                    Tab::Folders => self.folder_rows(ui, width, clicks),
                    Tab::Tags => self.tag_rows(ui, width, clicks),
                }
            });
        });
    }

    fn manage_strip(&mut self, ui: &mut Ui, rect: Rect, clicks: &mut Vec<Click>) {
        let inner = Rect::from_min_max(
            pos2(rect.left() + MARGIN, rect.top() + 6.0),
            pos2(rect.right() - MARGIN, rect.bottom() - 6.0),
        );
        let mut bar = ui.new_child(UiBuilder::new().max_rect(inner).layout(egui::Layout::left_to_right(Align::Center)));
        bar.spacing_mut().item_spacing.x = 6.0;
        for (tab, label) in [(Tab::Folders, "Folders"), (Tab::Tags, "Tags")] {
            let on = self.manager.tab == tab;
            if widgets::toggle_button(&mut bar, label, on).clicked() && !on {
                clicks.push(Click::ManageTab(tab));
            }
        }
        bar.add_space(10.0);
        match self.manager.tab {
            Tab::Folders => {
                if widgets::action_button(&mut bar, "New Folder", true, 0.0).on_hover_text("⌘N").clicked() {
                    clicks.push(Click::NewFolder { parent: Vec::new(), smart: false });
                }
                if widgets::action_button(&mut bar, "New Smart Folder", true, 0.0).on_hover_text("⇧⌘N").clicked() {
                    clicks.push(Click::NewFolder { parent: Vec::new(), smart: true });
                }
            }
            Tab::Tags => {
                if widgets::action_button(&mut bar, "New Tag", true, 0.0).clicked() {
                    clicks.push(Click::NewTag);
                }
            }
        }
        bar.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
            if widgets::action_button(ui, "Done", true, 0.0).on_hover_text("Return to list · Escape").clicked() {
                clicks.push(Click::Manage(false));
            }
        });
    }

    fn manage_header(&self, ui: &mut Ui, width: f32, title: &str, count: &str, cols: &[&str]) {
        ui.add_space(SECTION_GAP);
        let (rect, _) = ui.allocate_exact_size(vec2(width, SECTION_H), Sense::hover());
        let p = ui.painter();
        let w = theme::paint_job(p, rect, theme::label_job(title, color::SECONDARY), Align::Min, true);
        let after = Rect::from_min_max(pos2(rect.left() + w + GAP, rect.top()), rect.max);
        theme::paint_job(p, after, theme::label_job(count, color::FAINT), Align::Min, true);
        for (k, head) in cols.iter().rev().enumerate() {
            let right = rect.right() - PAD - COL_W * k as f32;
            let cell = Rect::from_min_max(pos2(right - COL_W, rect.top()), pos2(right, rect.bottom()));
            theme::paint_job(p, cell, theme::label_job(head, color::FAINT), Align::Max, false);
        }
    }

    fn folder_rows(&mut self, ui: &mut Ui, width: f32, clicks: &mut Vec<Click>) {
        let walk: Vec<(Vec<usize>, Folder)> = self.org.walk().into_iter().map(|(at, f)| (at, f.clone())).collect();
        let count = widgets::plural(walk.len(), "Folder", "Folders");
        self.manage_header(ui, width, "01 / Folders", &count, &["Pinned", "Excluded", "Repos"]);
        if walk.is_empty() {
            let (r, _) = ui.allocate_exact_size(vec2(width, SECTION_H), Sense::hover());
            theme::paint_job(ui.painter(), r, theme::label_job("No Folders", color::FAINT), Align::Min, true);
            return;
        }
        let selected = self.manager_folder();
        let left = ui.cursor().left();
        let top = ui.cursor().top();
        let n = walk.len();
        for (k, (at, folder)) in walk.into_iter().enumerate() {
            self.folder_row(ui, width, &at, &folder, selected.as_ref() == Some(&at), k + 1 == n, clicks);
        }
        let block = Rect::from_min_max(pos2(left, top), pos2(left + width, ui.cursor().top()));
        draw::box_outline(ui.painter(), block, color::RULE);
    }

    #[allow(clippy::too_many_arguments)]
    fn folder_row(
        &self,
        ui: &mut Ui,
        width: f32,
        at: &[usize],
        folder: &Folder,
        selected: bool,
        last: bool,
        clicks: &mut Vec<Click>,
    ) {
        let (rect, resp) = ui.allocate_exact_size(vec2(width, ROW_H), Sense::click_and_drag());
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, selected, &folder.name));
        let p = ui.painter().clone();
        if selected {
            p.rect_filled(rect, 0.0, color::PLATE);
            p.rect_filled(Rect::from_min_size(rect.min, vec2(metric::SELECTION_BAR, rect.height())), 0.0, color::BRONZE);
        } else if resp.hovered() {
            p.rect_filled(rect, 0.0, color::PLATE_HOVER);
        }
        if !last {
            draw::rule_h(&p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE_FAINT);
        }
        let x = rect.left() + PAD + INDENT * (at.len() - 1) as f32;
        let tile = Rect::from_center_size(pos2(x + ICON * 0.5, rect.center().y), Vec2::splat(ICON));
        widgets::folder_glyph_tile(&p, tile, folder.is_smart(), selected);

        let figures = [folder.repos.len(), folder.exclude.len(), self.index.folder_count(at)];
        for (k, n) in figures.iter().rev().enumerate() {
            let right = rect.right() - PAD - COL_W * k as f32;
            let cell = Rect::from_min_max(pos2(right - COL_W, rect.top()), pos2(right, rect.bottom()));
            let c = if *n == 0 { color::FAINT } else { color::PARCHMENT };
            theme::paint_job(&p, cell, theme::mono_job(&n.to_string(), font_size::MONO, c), Align::Max, false);
        }

        let text_l = tile.right() + GAP;
        let text_r = rect.right() - PAD - COL_W * 3.0 - GAP;
        let mid = rect.center().y;
        let l1 = Rect::from_min_max(pos2(text_l, mid - 17.0), pos2(text_r.max(text_l + 1.0), mid));
        let l2 = Rect::from_min_max(pos2(text_l, mid + 1.0), pos2(text_r.max(text_l + 1.0), mid + 17.0));
        let name_ink = if selected { color::BRONZE } else { color::PARCHMENT };
        let w = theme::paint_job(&p, l1, theme::sans_job(&folder.name, 14.0, name_ink, true), Align::Min, true);
        let beside = Rect::from_min_max(pos2(l1.left() + w + 8.0, l1.top() + 0.5), l1.max);
        if beside.width() > 30.0 {
            theme::paint_job(&p, beside, theme::mono_job(folder_kind(folder), font_size::MONO_SMALL, color::FAINT), Align::Min, true);
        }
        if folder.is_smart() {
            let c = if self.index.errors.contains_key(at) { color::ERROR } else { color::SECONDARY };
            theme::paint_job(&p, l2, theme::mono_job(&folder.query, font_size::MONO_SMALL, c), Align::Min, true);
        } else {
            theme::paint_job(&p, l2, theme::sans_job("No query", 12.0, color::FAINT, false), Align::Min, true);
        }

        if resp.clicked() {
            clicks.push(Click::ManageFolder(at.to_vec()));
        }
        resp.dnd_set_drag_payload(FolderDrag(at.to_vec()));
        if let Some(d) = resp.dnd_hover_payload::<FolderDrag>()
            && !at.starts_with(&d.0)
            && let Some(pos) = ui.ctx().pointer_latest_pos()
        {
            match drop_zone(rect, pos.y) {
                DropZone::Before => {
                    p.hline(rect.x_range(), rect.top() + 1.0, Stroke::new(2.0, color::BRONZE));
                }
                DropZone::After => {
                    p.hline(rect.x_range(), rect.bottom() - 1.0, Stroke::new(2.0, color::BRONZE));
                }
                DropZone::Into => draw::box_outline(&p, rect, color::BRONZE),
            }
        }
        if let Some(d) = resp.dnd_release_payload::<FolderDrag>()
            && !at.starts_with(&d.0)
            && let Some(pos) = resp.interact_pointer_pos().or(ui.ctx().pointer_latest_pos())
        {
            let (last, parent) = at.split_last().map_or((0, &[][..]), |(l, p)| (*l, p));
            let (parent, index) = match drop_zone(rect, pos.y) {
                DropZone::Before => (parent.to_vec(), last),
                DropZone::After => (parent.to_vec(), last + 1),
                DropZone::Into => (at.to_vec(), usize::MAX),
            };
            clicks.push(Click::PlaceFolder { from: d.0.clone(), parent, index });
        }
    }

    fn tag_rows(&mut self, ui: &mut Ui, width: f32, clicks: &mut Vec<Click>) {
        let manual = self.index.manual_counts.clone();
        let count = widgets::plural(manual.len(), "Tag", "Tags");
        self.manage_header(ui, width, "01 / Tags", &count, &["Repos"]);
        if manual.is_empty() {
            let (r, _) = ui.allocate_exact_size(vec2(width, SECTION_H), Sense::hover());
            theme::paint_job(ui.painter(), r, theme::label_job("No Tags", color::FAINT), Align::Min, true);
        } else {
            let selected = self.manager.tag.clone();
            let (left, top) = (ui.cursor().left(), ui.cursor().top());
            let n = manual.len();
            for (k, (tag, count)) in manual.iter().enumerate() {
                let on = selected.as_deref() == Some(tag.as_str());
                if self.tag_row(ui, width, tag, *count, on, k + 1 == n, true) {
                    clicks.push(Click::ManageTag(tag.clone()));
                }
            }
            let block = Rect::from_min_max(pos2(left, top), pos2(left + width, ui.cursor().top()));
            draw::box_outline(ui.painter(), block, color::RULE);
        }

        let auto = auto_order(&self.index.auto_counts);
        if auto.is_empty() {
            return;
        }
        let count = widgets::plural(auto.len(), "Tag", "Tags");
        self.manage_header(ui, width, "02 / Automatic Tags", &count, &["Repos"]);
        let (left, top) = (ui.cursor().left(), ui.cursor().top());
        let n = auto.len();
        for (k, (tag, count)) in auto.iter().enumerate() {
            self.tag_row(ui, width, tag, *count, false, k + 1 == n, false);
        }
        let block = Rect::from_min_max(pos2(left, top), pos2(left + width, ui.cursor().top()));
        draw::box_outline(ui.painter(), block, color::RULE);
    }

    #[allow(clippy::too_many_arguments)]
    fn tag_row(&self, ui: &mut Ui, width: f32, tag: &str, count: usize, on: bool, last: bool, manual: bool) -> bool {
        let sense = if manual { Sense::click() } else { Sense::hover() };
        let (rect, resp) = ui.allocate_exact_size(vec2(width, TAG_ROW_H), sense);
        if manual {
            resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, on, tag));
        }
        let p = ui.painter().clone();
        if on {
            p.rect_filled(rect, 0.0, color::PLATE);
            p.rect_filled(Rect::from_min_size(rect.min, vec2(metric::SELECTION_BAR, rect.height())), 0.0, color::BRONZE);
        } else if manual && resp.hovered() {
            p.rect_filled(rect, 0.0, color::PLATE_HOVER);
        }
        if !last {
            draw::rule_h(&p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE_FAINT);
        }
        let name = Rect::from_min_max(pos2(rect.left() + PAD, rect.top()), pos2(rect.right() - PAD - COL_W, rect.bottom()));
        let job = if manual {
            theme::sans_job(tag, 13.5, if on { color::BRONZE } else { color::PARCHMENT }, true)
        } else {
            theme::mono_job(tag, font_size::MONO, color::SECONDARY)
        };
        theme::paint_job(&p, name, job, Align::Min, true);
        let cell = Rect::from_min_max(pos2(rect.right() - PAD - COL_W, rect.top()), pos2(rect.right() - PAD, rect.bottom()));
        let c = if count == 0 { color::FAINT } else { color::PARCHMENT };
        theme::paint_job(&p, cell, theme::mono_job(&count.to_string(), font_size::MONO, c), Align::Max, false);
        manual && resp.on_hover_cursor(CursorIcon::PointingHand).clicked()
    }

    // -----------------------------------------------------------------------
    // Right Editor Pane

    pub(super) fn manage_editor(&mut self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        ScrollArea::vertical().id_salt("manage_editor_scroll").auto_shrink([false, false]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 12, bottom: 16 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                let width = ui.available_width().max(1.0);
                match self.manager.tab {
                    Tab::Folders => match self.manager_folder() {
                        Some(at) => self.folder_editor(ui, width, &at, clicks),
                        None => self.editor_empty(ui, width, "Folders", "No Selection"),
                    },
                    Tab::Tags => match self.manager.tag.clone().filter(|t| self.org.all_tags().contains(t)) {
                        Some(tag) => self.tag_editor(ui, width, &tag, clicks),
                        None => self.editor_empty(ui, width, "Tags", "No Selection"),
                    },
                }
            });
        });
    }

    fn editor_empty(&self, ui: &mut Ui, width: f32, title: &str, meta: &str) {
        let (rect, _) = ui.allocate_exact_size(vec2(width, 44.0), Sense::hover());
        let tile = Rect::from_center_size(pos2(rect.left() + ICON * 0.5, rect.center().y), Vec2::splat(ICON));
        let glyph = title.chars().next().unwrap_or('?').to_ascii_uppercase().to_string();
        widgets::badge_tile(ui.painter(), tile, &glyph, false);
        header_text(ui, rect, tile.right() + GAP, title, meta);
    }

    fn name_field(&mut self, ui: &mut Ui, width: f32, commit: impl Fn(String) -> Click, clicks: &mut Vec<Click>) {
        let Some(buffer) = &mut self.manager.renaming else { return };
        ui.add_space(8.0);
        let id = ui.scope_id().with("manage-name");
        let (rect, _) = ui.allocate_exact_size(vec2(width, 24.0), Sense::hover());
        let resp = widgets::text_field(ui, rect, id, buffer, "Name", false, false);
        if self.manager.focus_name {
            self.manager.focus_name = false;
            resp.request_focus();
        }
        if resp.lost_focus() {
            if ui.input(|i| i.key_pressed(K::Escape)) {
                clicks.push(Click::CancelManageRename);
            } else {
                clicks.push(commit(buffer.clone()));
            }
        }
    }

    fn folder_editor(&mut self, ui: &mut Ui, width: f32, at: &[usize], clicks: &mut Vec<Click>) {
        let Some(folder) = self.org.folder(at).cloned() else { return };
        let names = self.org.names(at);

        let (rect, _) = ui.allocate_exact_size(vec2(width, 44.0), Sense::hover());
        let tile = Rect::from_center_size(pos2(rect.left() + ICON * 0.5, rect.center().y), Vec2::splat(ICON));
        widgets::folder_glyph_tile(ui.painter(), tile, folder.is_smart(), false);
        let under = match names.len() {
            1 => folder_kind(&folder).to_owned(),
            _ => format!("{} · {}", folder_kind(&folder), names[..names.len() - 1].join(" / ")),
        };
        header_text(ui, rect, tile.right() + GAP, &folder.name, &under);

        ui.add_space(8.0);
        ui.allocate_ui_with_layout(vec2(width, metric::KEY_BUTTON_H + 2.0), egui::Layout::left_to_right(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            if widgets::action_button(ui, "Rename", true, 0.0).clicked() {
                clicks.push(Click::StartManageRename);
            }
            let (resp, _) = egui::containers::menu::MenuButton::from_button(widgets::menu_button_widget("Move To"))
                .ui(ui, |ui| self.move_menu(ui, at, clicks));
            resp.on_hover_text("Move folder position or parent");
            if widgets::action_button(ui, "New Subfolder", true, 0.0).clicked() {
                clicks.push(Click::NewFolder { parent: at.to_vec(), smart: false });
            }
            if widgets::action_button(ui, "Delete", true, 0.0).clicked() {
                clicks.push(Click::DeleteFolder(at.to_vec()));
            }
        });
        let at_owned = at.to_vec();
        self.name_field(ui, width, move |name| Click::RenameFolder(at_owned.clone(), name), clicks);

        Fields { ui, width }.section("Query");
        ui.add_space(8.0);
        let current = folder.query.clone();
        let id = ui.scope_id().with("manage-query");
        let focused = ui.memory(|m| m.has_focus(id));
        match &mut self.manager.query {
            Some((n, text)) if *n == names => {
                if !focused && *text != current {
                    *text = current.clone();
                }
            }
            _ => self.manager.query = Some((names.clone(), current.clone())),
        }
        if let Some((_, text)) = &mut self.manager.query {
            let (rect, _) = ui.allocate_exact_size(vec2(width, 24.0), Sense::hover());
            let resp = widgets::text_field(ui, rect, id, text, "Query (e.g. uncommitted stale)", true, false);
            let parsed = query::parse(text);
            if resp.changed() && parsed.is_ok() {
                clicks.push(Click::SetQuery { at: at.to_vec(), text: text.clone(), typing: true });
            }
            if resp.lost_focus() || (resp.has_focus() && ui.input(|i| i.key_pressed(K::Enter))) {
                clicks.push(Click::SetQuery { at: at.to_vec(), text: text.clone(), typing: false });
            }
            let mut f = Fields { ui, width };
            match parsed {
                Err(e) => f.note(&e.message, color::ERROR),
                Ok(q) if !q.is_all() => {
                    let n = (0..self.index.len()).filter(|&i| self.index.matches(i, &q)).count();
                    f.ui.add_space(4.0);
                    f.text("Matches", &widgets::plural(n, "repo", "repos"), color::PARCHMENT, false);
                }
                Ok(_) => f.note("Pinned only", color::FAINT),
            }
        }

        let named = |keys: &[String]| -> Vec<(String, String, String)> {
            keys.iter()
                .map(|key| {
                    let found = self.index.keys.iter().position(|k| k.0.iter().any(|x| x == key));
                    let (name, place) = found
                        .map(|i| (self.state.repos[i].name.clone(), self.index.locations[i].clone()))
                        .unwrap_or_else(|| (key.clone(), "Not on Disk".to_owned()));
                    (key.clone(), name, place)
                })
                .collect()
        };
        let pinned = named(&folder.repos);
        let excluded = named(&folder.exclude);

        let mut f = Fields { ui, width };
        f.section(&format!("Pinned  {}", folder.repos.len()));
        for (key, name, place) in &pinned {
            if let RowClick::Action = f.folder_row_with(name, place, "Remove") {
                clicks.push(Click::Unlist { at: at.to_vec(), key: key.clone(), excluded: false });
            }
        }
        if folder.repos.is_empty() {
            f.note("No pinned repos", color::FAINT);
        }
        f.ui.add_space(6.0);
        if !self.manager.adding {
            f.ui.allocate_ui_with_layout(vec2(width, metric::KEY_BUTTON_H + 2.0), egui::Layout::left_to_right(Align::Center), |ui| {
                if widgets::action_button(ui, "Add Repos", true, 0.0).clicked() {
                    clicks.push(Click::AddRepos(true));
                }
            });
        }
        if self.manager.adding {
            self.add_repos(f.ui, width, at, clicks);
        }
        let mut f = Fields { ui, width };
        if !excluded.is_empty() {
            f.section(&format!("Excluded  {}", excluded.len()));
            for (key, name, place) in &excluded {
                if let RowClick::Action = f.folder_row_with(name, place, "Restore") {
                    clicks.push(Click::Unlist { at: at.to_vec(), key: key.clone(), excluded: true });
                }
            }
        }
    }

    fn move_menu(&self, ui: &mut Ui, at: &[usize], clicks: &mut Vec<Click>) {
        let (last, parent) = at.split_last().map_or((0, &[][..]), |(l, p)| (*l, p));
        let siblings = if parent.is_empty() {
            self.org.folders.len()
        } else {
            self.org.folder(parent).map_or(0, |f| f.folders.len())
        };
        if ui.add_enabled(last > 0, egui::Button::new("Up")).clicked() {
            clicks.push(Click::ShiftFolder(at.to_vec(), -1));
        }
        if ui.add_enabled(last + 1 < siblings, egui::Button::new("Down")).clicked() {
            clicks.push(Click::ShiftFolder(at.to_vec(), 1));
        }
        ui.separator();
        if ui.add_enabled(!parent.is_empty(), egui::Button::new("Top Level")).clicked() {
            clicks.push(Click::PlaceFolder { from: at.to_vec(), parent: Vec::new(), index: usize::MAX });
        }
        for (to, f) in self.org.walk() {
            if to.starts_with(at) {
                continue;
            }
            let text = format!("{}{}", "      ".repeat(to.len() - 1), f.name);
            if ui.add_enabled(to != parent, egui::Button::new(text)).clicked() {
                clicks.push(Click::PlaceFolder { from: at.to_vec(), parent: to.clone(), index: usize::MAX });
            }
        }
    }

    fn add_repos(&mut self, ui: &mut Ui, width: f32, at: &[usize], clicks: &mut Vec<Click>) {
        Fields { ui, width }.section("Add Repos");
        ui.add_space(8.0);
        let members = self.index.folder(at).map(<[bool]>::to_vec).unwrap_or_default();
        let shown = self.search(&self.manager.search.clone());
        self.search_field(ui, width, "manage-add-search", SearchTarget::Add);
        ui.add_space(6.0);
        let ticked = self.manager.ticked.len();
        ui.allocate_ui_with_layout(vec2(width, metric::PRIMARY_BUTTON_H + 2.0), egui::Layout::left_to_right(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            let label = format!("Add {}", widgets::plural(ticked, "Repo", "Repos"));
            if primary_button(ui, &label, None, ticked > 0).clicked() {
                clicks.push(Click::PinTicked(at.to_vec()));
            }
            if widgets::action_button(ui, "Cancel", true, 0.0).clicked() {
                clicks.push(Click::AddRepos(false));
            }
        });
        ui.add_space(6.0);
        let rows: Vec<(PathBuf, bool, bool)> = shown
            .into_iter()
            .map(|i| {
                let id = self.state.repos[i].id().to_owned();
                let member = members.get(i).copied().unwrap_or(false);
                let on = member || self.manager.ticked.contains(&id);
                (id, on, !member)
            })
            .collect();
        for (id, on, enabled) in rows {
            if self.check_row(ui, width, &id, on, enabled, if enabled { "" } else { "In folder" }) {
                clicks.push(Click::Tick(id));
            }
        }
    }

    fn tag_editor(&mut self, ui: &mut Ui, width: f32, tag: &str, clicks: &mut Vec<Click>) {
        let carriers: Vec<usize> =
            (0..self.index.len()).filter(|&i| self.index.manual[i].iter().any(|t| t == tag)).collect();
        let (rect, _) = ui.allocate_exact_size(vec2(width, 44.0), Sense::hover());
        let tile = Rect::from_center_size(pos2(rect.left() + ICON * 0.5, rect.center().y), Vec2::splat(ICON));
        let glyph = tag.chars().next().unwrap_or('#').to_ascii_uppercase().to_string();
        widgets::badge_tile(ui.painter(), tile, &glyph, false);
        let under = format!("Tag · {}", widgets::plural(carriers.len(), "repo", "repos"));
        header_text(ui, rect, tile.right() + GAP, tag, &under);

        ui.add_space(8.0);
        ui.allocate_ui_with_layout(vec2(width, metric::KEY_BUTTON_H + 2.0), egui::Layout::left_to_right(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            if widgets::action_button(ui, "Rename", true, 0.0).on_hover_text("Rename or merge onto existing tag").clicked() {
                clicks.push(Click::StartManageRename);
            }
            if widgets::action_button(ui, "Delete", true, 0.0).clicked() {
                clicks.push(Click::AskDeleteTag(tag.to_owned()));
            }
        });
        let from = tag.to_owned();
        self.name_field(ui, width, move |to| Click::RenameTag(from.clone(), to), clicks);

        Fields { ui, width }.section("Repos");
        ui.add_space(8.0);
        self.search_field(ui, width, "manage-tag-search", SearchTarget::Tag);
        let shown = self.search(&self.manager.tag_search.clone());
        let ids: Vec<PathBuf> = shown.iter().map(|&i| self.state.repos[i].id().to_owned()).collect();
        ui.add_space(6.0);
        ui.allocate_ui_with_layout(vec2(width, metric::KEY_BUTTON_H + 2.0), egui::Layout::left_to_right(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            let scope = if self.manager.tag_search.trim().is_empty() { "All" } else { "All Shown" };
            if widgets::action_button(ui, &format!("Tag {scope}"), true, 0.0).clicked() {
                clicks.push(Click::TagRepos { tag: tag.to_owned(), ids: ids.clone(), on: true });
            }
            if widgets::action_button(ui, &format!("Untag {scope}"), true, 0.0).clicked() {
                clicks.push(Click::TagRepos { tag: tag.to_owned(), ids: ids.clone(), on: false });
            }
        });
        ui.add_space(6.0);
        for i in shown {
            let id = self.state.repos[i].id().to_owned();
            let on = carriers.contains(&i);
            if self.check_row(ui, width, &id, on, true, "") {
                clicks.push(Click::TagRepos { tag: tag.to_owned(), ids: vec![id], on: !on });
            }
        }
    }

    fn search(&self, text: &str) -> Vec<usize> {
        let mut rows: Vec<usize> = match query::parse(text) {
            Ok(q) => (0..self.index.len()).filter(|&i| q.is_all() || self.index.matches(i, &q)).collect(),
            Err(_) => {
                let needle = text.trim().to_lowercase();
                (0..self.index.len())
                    .filter(|&i| {
                        self.state.repos[i].name.to_lowercase().contains(&needle)
                            || self.index.paths[i].to_lowercase().contains(&needle)
                    })
                    .collect()
            }
        };
        let repos = &self.state.repos;
        rows.sort_by(|&a, &b| {
            repos[a]
                .name
                .to_lowercase()
                .cmp(&repos[b].name.to_lowercase())
                .then_with(|| repos[a].id().cmp(repos[b].id()))
        });
        rows
    }

    fn search_field(&mut self, ui: &mut Ui, width: f32, salt: &str, which: SearchTarget) {
        let id = ui.scope_id().with(salt);
        let text = match which {
            SearchTarget::Add => &mut self.manager.search,
            SearchTarget::Tag => &mut self.manager.tag_search,
        };
        let (rect, _) = ui.allocate_exact_size(vec2(width, 24.0), Sense::hover());
        widgets::text_field(ui, rect, id, text, "Search by name, tag, or query", true, false);
    }

    fn check_row(&self, ui: &mut Ui, width: f32, id: &std::path::Path, on: bool, enabled: bool, note: &str) -> bool {
        let Some(i) = self.state.position(id) else { return false };
        let repo = &self.state.repos[i];
        let sense = if enabled { Sense::click() } else { Sense::hover() };
        let (rect, resp) = ui.allocate_exact_size(vec2(width, CHECK_ROW_H), sense);
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, enabled, on, &repo.name));
        let p = ui.painter().clone();
        if enabled && resp.hovered() {
            p.rect_filled(rect, 0.0, color::PLATE_HOVER);
        }
        widgets::checkbox(&p, pos2(rect.left() + 9.0, rect.center().y), on, resp.hovered(), enabled);
        let name_r =
            Rect::from_min_max(pos2(rect.left() + 26.0, rect.top()), pos2(rect.left() + width * 0.5, rect.bottom()));
        let c = if enabled { color::PARCHMENT } else { color::SECONDARY };
        let w = theme::paint_job(&p, name_r, theme::sans_job(&repo.name, font_size::BODY, c, false), Align::Min, true);
        let rest =
            Rect::from_min_max(pos2((name_r.left() + w + 10.0).max(rect.left() + width * 0.5), rect.top()), rect.max);
        let place = if note.is_empty() { self.index.locations[i].clone() } else { note.to_owned() };
        theme::paint_job(&p, rest, theme::mono_job(&place, font_size::MONO_SMALL, color::FAINT), Align::Max, true);
        enabled && resp.on_hover_cursor(CursorIcon::PointingHand).on_hover_text(&self.index.paths[i]).clicked()
    }

    pub(super) fn manager_folder(&self) -> Option<Vec<usize>> {
        self.manager.folder.as_ref().and_then(|names| self.org.find(names))
    }
}

fn drop_zone(rect: Rect, y: f32) -> DropZone {
    let q = rect.height() / 4.0;
    if y < rect.top() + q {
        DropZone::Before
    } else if y > rect.bottom() - q {
        DropZone::After
    } else {
        DropZone::Into
    }
}

fn auto_order(counts: &std::collections::BTreeMap<String, usize>) -> Vec<(String, usize)> {
    let mut out: Vec<(String, usize)> =
        tags::STATUS.iter().filter_map(|s| counts.get(*s).map(|n| (s.to_string(), *n))).collect();
    let apps: BTreeSet<String> = Ide::ALL.iter().map(|i| format!("app:{}", i.name().to_lowercase())).collect();
    out.extend(Ide::ALL.iter().filter_map(|i| {
        let t = format!("app:{}", i.name().to_lowercase());
        counts.get(&t).map(|n| (t, *n))
    }));
    for prefix in ["lang:", "category:"] {
        out.extend(
            counts.iter().filter(|(t, _)| t.starts_with(prefix) && !apps.contains(*t)).map(|(t, n)| (t.clone(), *n)),
        );
    }
    out
}
