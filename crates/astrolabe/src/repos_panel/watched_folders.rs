//! Watched Folders view: dense inline table for configured repository roots.

use std::collections::HashMap;
use std::path::PathBuf;

use astrolabe_engines::repos::{Cmd, Ide, Root, config, paths};
use astrolabe_kit::{Pane, color, draw, font_size, metric, primary_button, theme};
use egui::{Align, CursorIcon, FontId, Key as K, Layout, Rect, Response, RichText, ScrollArea, Sense, Ui, UiBuilder, pos2, vec2};

use super::{Click, ReposPanel};
use crate::widgets;

const MARGIN: f32 = 14.0;
const STRIP_H: f32 = 36.0;
const ROW_H: f32 = 36.0;
const FIELD_H: f32 = 24.0;
const CELL_PAD: f32 = 10.0;
const COL_GAP: f32 = 14.0;
const APP_W: f32 = 132.0;
const REPOS_W: f32 = 60.0;
const ACTION_W: f32 = 76.0;

pub(crate) struct WatchedFolders {
    pub(crate) open: bool,
    pub(crate) editing: bool,
    pub(crate) drafts: HashMap<(usize, PathBuf), String>,
    pub(crate) error: Option<String>,
}

impl WatchedFolders {
    pub(crate) fn new() -> Self {
        Self { open: false, editing: false, drafts: HashMap::new(), error: None }
    }
}

struct Columns {
    path: (f32, f32),
    category: (f32, f32),
    app: (f32, f32),
    repos: (f32, f32),
    action: (f32, f32),
}

impl Columns {
    fn compute(rect: Rect) -> Self {
        let w = rect.width().max(1.0);
        let action_r = rect.right() - CELL_PAD;
        let action_l = action_r - ACTION_W;

        let repos_r = action_l - COL_GAP;
        let repos_l = repos_r - REPOS_W;

        let app_r = repos_l - COL_GAP;
        let app_l = app_r - APP_W;

        let cat_w = (w * 0.24).clamp(160.0, 240.0).floor();
        let cat_r = app_l - COL_GAP;
        let cat_l = cat_r - cat_w;

        let path_l = rect.left() + CELL_PAD;
        let path_r = (cat_l - COL_GAP).max(path_l + 80.0);

        Self {
            path: (path_l, path_r),
            category: (cat_l, cat_r),
            app: (app_l, app_r),
            repos: (repos_l, repos_r),
            action: (action_l, action_r),
        }
    }
}

fn app_label(ide: Option<Ide>) -> &'static str {
    ide.map_or("Inferred", Ide::name)
}

/// Active toggle-state keycap button matching `astrolabe_kit::key_button` geometry.
pub(super) fn active_key_button(ui: &mut Ui, key: &str, action: &str) -> Response {
    let key_job = theme::mono_job(key, font_size::MONO_SMALL, color::BRONZE);
    let action_job = theme::sans_job(action, font_size::BODY, color::BRONZE, false);
    let key_w = theme::job_width(ui, key_job);
    let action_w = theme::job_width(ui, action_job);
    let inner_gap = if key_w > 0.0 && action_w > 0.0 { 6.0 } else { 0.0 };
    let content_w = key_w + inner_gap + action_w;
    let width = (content_w + 16.0).ceil();

    let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::KEY_BUTTON_H), Sense::click());
    resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, true, action));

    let p = ui.painter();
    let bg = if resp.hovered() { color::PLATE_HOVER } else { color::PLATE };
    p.rect_filled(rect, 0.0, bg);
    draw::box_outline(p, rect, color::BRONZE);

    let mut x = (rect.center().x - content_w * 0.5).floor();
    if !key.is_empty() {
        let r = Rect::from_min_max(pos2(x, rect.top()), pos2(x + key_w + 1.0, rect.bottom()));
        theme::paint_job(p, r, theme::mono_job(key, font_size::MONO_SMALL, color::BRONZE), Align::Min, false);
        x += key_w + inner_gap;
    }
    if !action.is_empty() {
        let r = Rect::from_min_max(pos2(x, rect.top()), pos2(x + action_w + 1.0, rect.bottom()));
        theme::paint_job(p, r, theme::sans_job(action, font_size::BODY, color::BRONZE, false), Align::Min, false);
    }
    resp.on_hover_cursor(CursorIcon::PointingHand)
}

pub(super) fn pick_folder() -> Option<PathBuf> {
    #[cfg(test)]
    {
        None
    }
    #[cfg(not(test))]
    {
        rfd::FileDialog::new().pick_folder()
    }
}

impl ReposPanel {
    pub(super) fn show_watched_folders_pane(&mut self, ui: &mut Ui, workspace: Rect, clicks: &mut Vec<Click>) {
        let count = self.state.config.roots.len();
        let meta = format!("{count} {}", if count == 1 { "FOLDER" } else { "FOLDERS" });
        Pane::new("repos_watched_folders", "Watched Folders", true)
            .meta(&meta)
            .shortcut("⌘,")
            .padding(0.0)
            .show(ui, workspace, |ui| self.watched_folders_body(ui, clicks));
    }

    fn watched_folders_body(&mut self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        let rect = ui.max_rect();
        let strip = Rect::from_min_size(rect.min, vec2(rect.width(), STRIP_H));
        self.watched_folders_strip(ui, strip, clicks);
        draw::rule_h(ui.painter(), rect.left(), rect.right(), strip.bottom() - 1.0, color::RULE_FAINT);

        let body = Rect::from_min_max(
            pos2(rect.left() + MARGIN, strip.bottom() + 12.0),
            pos2((rect.right() - MARGIN).max(rect.left() + MARGIN + 1.0), (rect.bottom() - 14.0).max(strip.bottom() + 12.0)),
        );
        let mut child = ui.new_child(
            UiBuilder::new().id_salt("watched_folders_table").max_rect(body).layout(Layout::top_down(Align::Min)),
        );
        child.set_clip_rect(body.intersect(ui.clip_rect()));
        child.spacing_mut().item_spacing = vec2(0.0, 0.0);

        let width = child.available_width().max(1.0);
        self.watched_folders_header(&mut child, width);

        let roots = self.state.config.roots.clone();
        self.watched_folders.editing = false;
        self.watched_folders
            .drafts
            .retain(|(idx, path), _| roots.get(*idx).is_some_and(|r| r.path == *path));

        ScrollArea::vertical().id_salt("watched_folders_scroll").auto_shrink([false, false]).show(&mut child, |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            let row_w = ui.available_width().max(1.0);
            let count = roots.len();
            for (i, root) in roots.iter().enumerate() {
                self.watched_folder_row(ui, row_w, i, root, i + 1 == count, clicks);
            }
            let bottom_y = ui.cursor().top();
            draw::rule_h(ui.painter(), ui.cursor().left(), ui.cursor().left() + row_w, bottom_y, color::FAINT);
        });
        self.watched_folders.editing |= egui::Popup::is_any_open(ui.ctx());
    }

    fn watched_folders_strip(&self, ui: &mut Ui, rect: Rect, clicks: &mut Vec<Click>) {
        let inner = Rect::from_min_max(
            pos2(rect.left() + MARGIN, rect.top() + 6.0),
            pos2((rect.right() - MARGIN).max(rect.left() + MARGIN + 1.0), rect.bottom() - 6.0),
        );

        let mut right = ui.new_child(UiBuilder::new().max_rect(inner).layout(Layout::right_to_left(Align::Center)));
        right.spacing_mut().item_spacing.x = 6.0;
        if widgets::action_button(&mut right, "Done", true, 0.0).clicked() {
            clicks.push(Click::WatchedFolders(false));
        }

        let used_left = right.min_rect().left();
        let left_rect = Rect::from_min_max(inner.min, pos2((used_left - 12.0).max(inner.left() + 60.0), inner.bottom()));
        let mut left = ui.new_child(UiBuilder::new().max_rect(left_rect).layout(Layout::left_to_right(Align::Center)));
        left.set_clip_rect(left_rect.intersect(ui.clip_rect()));
        left.spacing_mut().item_spacing.x = 10.0;
        if primary_button(&mut left, "Add", None, true).clicked() {
            clicks.push(Click::PickWatchedFolder);
        }
        if let Some(err) = &self.watched_folders.error {
            left.add(
                egui::Label::new(
                    RichText::new(err)
                        .font(FontId::new(font_size::MONO_SMALL, theme::mono_family()))
                        .color(color::ERROR),
                )
                .truncate(),
            );
        }
    }

    fn watched_folders_header(&self, ui: &mut Ui, width: f32) {
        let (rect, _) = ui.allocate_exact_size(vec2(width, metric::TABLE_HEADER), Sense::hover());
        let cols = Columns::compute(rect);
        let p = ui.painter().clone();
        draw::rule_h(&p, rect.left(), rect.right(), rect.top(), color::FAINT);
        draw::rule_h(&p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE);

        for (label, (left, right), align) in [
            ("PATH", cols.path, Align::Min),
            ("CATEGORY", cols.category, Align::Min),
            ("APP", cols.app, Align::Min),
            ("REPOS", cols.repos, Align::Max),
        ] {
            let cell = Rect::from_min_max(pos2(left, rect.top() + 1.0), pos2(right, rect.bottom() - 1.0));
            let resp = ui.interact(cell, ui.scope_id().with(("watched_col", label)), Sense::hover());
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, label));
            theme::paint_job(&p, cell, theme::label_job(label, color::SECONDARY), align, true);
        }
    }

    fn watched_folder_row(
        &mut self,
        ui: &mut Ui,
        width: f32,
        index: usize,
        root: &Root,
        last: bool,
        clicks: &mut Vec<Click>,
    ) {
        let (rect, _) = ui.allocate_exact_size(vec2(width, ROW_H), Sense::hover());
        let cols = Columns::compute(rect);
        let hovered = ui.rect_contains_pointer(rect);
        let p = ui.painter().clone();
        if hovered {
            p.rect_filled(rect, 0.0, color::PLATE_HOVER);
        }
        if !last {
            draw::rule_h(&p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE_FAINT);
        }

        // PATH
        let path_text = paths::tilde(&root.path);
        let path_rect = Rect::from_min_max(pos2(cols.path.0, rect.top()), pos2(cols.path.1, rect.bottom() - 1.0));
        let path_resp = ui.interact(path_rect, ui.scope_id().with(("watched_path", index)), Sense::hover());
        path_resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, path_text.clone()));
        theme::paint_job(&p, path_rect, theme::mono_job(&path_text, font_size::MONO, color::PARCHMENT), Align::Min, true);

        // CATEGORY
        let key = (index, root.path.clone());
        let draft = self.watched_folders.drafts.entry(key).or_insert_with(|| root.category.clone());
        let field_top = (rect.center().y - FIELD_H * 0.5).floor();
        let cat_rect = Rect::from_min_size(pos2(cols.category.0, field_top), vec2((cols.category.1 - cols.category.0).max(40.0), FIELD_H));
        let cat_id = ui.scope_id().with(("watched_category", index, &root.path));
        let mut cat_ui = ui.new_child(UiBuilder::new().id_salt(("watched_cat_cell", index)).max_rect(cat_rect));
        let cat_resp = widgets::text_field(&mut cat_ui, cat_rect, cat_id, draft, "Category", false, false);
        let escape_pressed = cat_resp.lost_focus() && ui.input(|i| i.key_pressed(K::Escape));
        let enter_pressed = (cat_resp.lost_focus() || cat_resp.has_focus()) && ui.input(|i| i.key_pressed(K::Enter));
        if escape_pressed {
            *draft = root.category.clone();
        } else if cat_resp.lost_focus() || enter_pressed {
            if enter_pressed && cat_resp.has_focus() {
                cat_resp.surrender_focus();
            }
            if *draft != root.category {
                clicks.push(Click::SetWatchedCategory(index, draft.clone()));
            }
        } else if !cat_resp.has_focus() && *draft != root.category {
            *draft = root.category.clone();
        }
        if cat_resp.has_focus() {
            self.watched_folders.editing = true;
        }

        // APP
        let app_rect = Rect::from_min_max(pos2(cols.app.0, rect.top()), pos2(cols.app.1, rect.bottom() - 1.0));
        let mut app_ui = ui.new_child(
            UiBuilder::new().id_salt(("watched_app_cell", index)).max_rect(app_rect).layout(Layout::left_to_right(Align::Center)),
        );
        let selected_color = if root.ide.is_some() { color::PARCHMENT } else { color::SECONDARY };
        let combo = egui::ComboBox::from_id_salt(("watched_app", index, &root.path))
            .width((cols.app.1 - cols.app.0).max(80.0))
            .selected_text(RichText::new(app_label(root.ide)).size(font_size::BODY).color(selected_color))
            .show_ui(&mut app_ui, |ui| {
                if ui.selectable_label(root.ide.is_none(), "Inferred").clicked() {
                    clicks.push(Click::SetWatchedApp(index, None));
                }
                for ide in Ide::ALL {
                    if ui.selectable_label(root.ide == Some(ide), ide.name()).clicked() {
                        clicks.push(Click::SetWatchedApp(index, Some(ide)));
                    }
                }
            });
        ui.ctx().accesskit_node_builder(combo.response.id, |node| {
            node.set_label(format!("App for {path_text}"));
        });

        // REPOS
        let repo_count = self.state.repos.iter().filter(|r| r.found.path.starts_with(&root.path)).count();
        let count_str = repo_count.to_string();
        let count_color = if repo_count == 0 { color::FAINT } else { color::PARCHMENT };
        let repos_rect = Rect::from_min_max(pos2(cols.repos.0, rect.top()), pos2(cols.repos.1, rect.bottom() - 1.0));
        let repos_resp = ui.interact(repos_rect, ui.scope_id().with(("watched_repos", index)), Sense::hover());
        repos_resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, count_str.clone()));
        theme::paint_job(&p, repos_rect, theme::mono_job(&count_str, font_size::MONO, count_color), Align::Max, false);

        // Remove action
        let action_rect = Rect::from_min_max(pos2(cols.action.0, rect.top()), pos2(cols.action.1, rect.bottom() - 1.0));
        let mut act_ui = ui.new_child(
            UiBuilder::new().id_salt(("watched_action_cell", index)).max_rect(action_rect).layout(Layout::right_to_left(Align::Center)),
        );
        if widgets::action_button(&mut act_ui, "Remove", true, 0.0).clicked() {
            clicks.push(Click::RemoveWatchedFolder(index));
        }
    }

    pub(super) fn add_watched_folder(&mut self, path: PathBuf) {
        let path = path.to_str().map(paths::expand).unwrap_or(path);
        let category = self
            .state
            .config
            .categories
            .iter()
            .find(|c| !c.trim().is_empty())
            .cloned()
            .or_else(|| self.state.config.roots.first().map(|r| r.category.trim().to_owned()).filter(|c| !c.is_empty()))
            .unwrap_or_else(|| "General".to_owned());
        let mut next = self.state.config.roots.clone();
        next.push(Root { path, ide: None, category, detect_third_party: true });
        self.commit_watched_roots(next);
    }

    pub(super) fn remove_watched_folder(&mut self, index: usize) {
        if index >= self.state.config.roots.len() {
            return;
        }
        let mut next = self.state.config.roots.clone();
        next.remove(index);
        self.commit_watched_roots(next);
    }

    pub(super) fn set_watched_category(&mut self, index: usize, category: String) {
        if index >= self.state.config.roots.len() {
            return;
        }
        let trimmed = category.trim().to_owned();
        if trimmed == self.state.config.roots[index].category {
            self.watched_folders.error = None;
            return;
        }
        let mut next = self.state.config.roots.clone();
        next[index].category = trimmed;
        self.commit_watched_roots(next);
    }

    pub(super) fn set_watched_app(&mut self, index: usize, ide: Option<Ide>) {
        if index >= self.state.config.roots.len() {
            return;
        }
        if self.state.config.roots[index].ide == ide {
            self.watched_folders.error = None;
            return;
        }
        let mut next = self.state.config.roots.clone();
        next[index].ide = ide;
        self.commit_watched_roots(next);
    }

    fn commit_watched_roots(&mut self, next: Vec<Root>) {
        if !self.demo
            && let Some(files) = &self.files
        {
            let cfg_path = files.organize.parent().map(|d| d.join("config.toml")).unwrap_or_else(paths::config_file);
            match config::save_roots(&cfg_path, &next) {
                Ok(saved) => {
                    self.state.config = saved;
                    self.watched_folders.error = None;
                    self.watched_folders.drafts.clear();
                    self.engine.send(Cmd::Rescan);
                }
                Err(e) => self.watched_folders.error = Some(e),
            }
        } else {
            match config::validate_roots_in_memory(&next) {
                Ok(()) => {
                    for root in &next {
                        if !root.category.is_empty() && !self.state.config.categories.contains(&root.category) {
                            self.state.config.categories.push(root.category.clone());
                        }
                    }
                    self.state.config.roots = next;
                    self.watched_folders.error = None;
                    self.watched_folders.drafts.clear();
                }
                Err(e) => self.watched_folders.error = Some(e),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::mpsc::channel;

    use astrolabe_engines::repos::{self, Cmd, Discovery, Engine as ReposEngine, Found, Ide, IdeSource, Msg, config};
    use astrolabe_kit::capture::{CaptureConfig, render_eframe_png};
    use egui::accesskit::Role;
    use egui::{Key as K, Modifiers, vec2};
    use egui_kittest::Harness;
    use egui_kittest::kittest::{NodeT, Queryable};

    use crate::agents_panel::AgentsPanel;
    use crate::app::{AstrolabeApp, LaunchOptions, Panel};
    use crate::repos_panel::{Click, Files, ReposPanel};

    fn demo_harness() -> Harness<'static, AstrolabeApp> {
        Harness::builder()
            .with_size(vec2(1440.0, 900.0))
            .with_pixels_per_point(2.0)
            .build_eframe(|cc| AstrolabeApp::new(cc, LaunchOptions::demo(Panel::Repos)))
    }

    fn scratch_wf_dir() -> Option<PathBuf> {
        let dir = std::env::var_os("HOME")
            .map(PathBuf::from)?
            .join(".worktrees")
            .join("astrolabe")
            .join("scratch")
            .join("wf");
        dir.is_dir().then_some(dir)
    }

    #[test]
    fn watched_folders_shortcut_command_bar_and_mutual_exclusion() {
        let mut h = demo_harness();
        h.run_steps(3);
        assert!(!h.state().repos.watched_folders.open);
        h.get_by_label("Flat");

        // Toggle open via ⌘,.
        h.key_press_modifiers(Modifiers::COMMAND, K::Comma);
        h.run_steps(2);
        assert!(h.state().repos.watched_folders.open);
        assert!(h.query_by_label("Flat").is_none());
        for head in ["PATH", "CATEGORY", "APP", "REPOS"] {
            h.get_by_label(head);
        }
        h.get_by_label("Add");
        h.get_by_label("Done");
        let cmd_btn = h.query_all_by_label("Watched Folders").next().expect("command bar toggle");
        assert_eq!(cmd_btn.accesskit_node().toggled(), Some(egui::accesskit::Toggled::True));

        // Toggle closed via ⌘,.
        h.key_press_modifiers(Modifiers::COMMAND, K::Comma);
        h.run_steps(2);
        assert!(!h.state().repos.watched_folders.open);
        h.get_by_label("Flat");

        // Open via command bar button, then switch to Manage and back.
        h.get_by_label("Watched Folders").click();
        h.run_steps(2);
        assert!(h.state().repos.watched_folders.open);
        assert!(!h.state().repos.manager.open);

        h.get_by_label("Manage").click();
        h.run_steps(2);
        assert!(h.state().repos.manager.open);
        assert!(!h.state().repos.watched_folders.open);

        h.get_by_label("Watched Folders").click();
        h.run_steps(2);
        assert!(h.state().repos.watched_folders.open);
        assert!(!h.state().repos.manager.open);

        // Close via unfocused Escape.
        h.key_press(K::Escape);
        h.run_steps(2);
        assert!(!h.state().repos.watched_folders.open);

        // Reopen and close via Done button.
        h.get_by_label("Watched Folders").click();
        h.run_steps(2);
        assert!(h.state().repos.watched_folders.open);
        h.get_by_label("Done").click();
        h.run_steps(2);
        assert!(!h.state().repos.watched_folders.open);
    }

    #[test]
    fn watched_folders_inline_category_and_app_edits() {
        let mut h = demo_harness();
        h.run_steps(3);
        h.key_press_modifiers(Modifiers::COMMAND, K::Comma);
        h.run_steps(2);

        // Verify all 6 demo roots and their paths appear.
        assert_eq!(h.state().repos.state.config.roots.len(), 6);
        h.get_by_label("/demo/workspaces/rust");
        h.get_by_label("/demo/workspaces/writing");

        // Inline category edit committed on Enter.
        h.query_all_by_role(Role::TextInput).nth(5).expect("row 5 category").click();
        h.run_steps(2);
        h.key_press_modifiers(Modifiers::COMMAND, K::A);
        h.event(egui::Event::Text("Papers".into()));
        h.run_steps(1);
        h.key_press(K::Enter);
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots[5].category, "Papers");
        assert!(h.state().repos.watched_folders.error.is_none());

        // Inline category edit committed on focus loss.
        h.query_all_by_role(Role::TextInput).nth(4).expect("row 4 category").click();
        h.run_steps(2);
        h.key_press_modifiers(Modifiers::COMMAND, K::A);
        h.event(egui::Event::Text("Native".into()));
        h.run_steps(1);
        h.query_all_by_role(Role::TextInput).next().expect("row 0 category").click();
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots[4].category, "Native");
        assert!(h.state().repos.watched_folders.error.is_none());

        // Escape inside focused category cancels edit without closing Watched Folders.
        h.query_all_by_role(Role::TextInput).nth(3).expect("row 3 category").click();
        h.run_steps(2);
        h.key_press_modifiers(Modifiers::COMMAND, K::A);
        h.event(egui::Event::Text("Unsaved".into()));
        h.run_steps(1);
        h.key_press(K::Escape);
        h.run_steps(2);
        assert!(h.state().repos.watched_folders.open);
        assert_eq!(h.state().repos.state.config.roots[3].category, "Research");

        // Inline App ComboBox: change row 5 from Inferred -> RustRover, row 0 from RustRover -> Inferred.
        h.query_all_by_role(Role::ComboBox).nth(5).expect("row 5 app").click();
        h.run_steps(3);
        h.get_by_role(Role::ListBox).get_by_label("RustRover").click();
        h.run_steps(3);
        assert_eq!(h.state().repos.state.config.roots[5].ide, Some(Ide::RustRover));

        h.query_all_by_role(Role::ComboBox).next().expect("row 0 app").click();
        h.run_steps(3);
        h.get_by_role(Role::ListBox).get_by_label("Inferred").click();
        h.run_steps(3);
        assert_eq!(h.state().repos.state.config.roots[0].ide, None);
    }

    #[test]
    fn watched_folders_add_remove_and_validation_errors_in_demo_mode() {
        let mut h = demo_harness();
        h.run_steps(3);
        h.key_press_modifiers(Modifiers::COMMAND, K::Comma);
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots.len(), 6);

        // Clicking Add in demo mode never invokes rfd and keeps roots intact.
        h.get_by_label("Add").click();
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots.len(), 6);

        // Deterministic add.
        let added = PathBuf::from("/demo/workspaces/sandbox");
        h.state_mut().repos.apply(vec![Click::AddWatchedFolder(added.clone())]);
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots.len(), 7);
        let last = h.state().repos.state.config.roots.last().unwrap();
        assert_eq!(last.path, added);
        assert_eq!(last.ide, None);
        assert!(last.detect_third_party);
        assert!(!last.category.is_empty());
        assert!(h.state().repos.watched_folders.error.is_none());

        // Duplicate root validation error.
        h.state_mut().repos.apply(vec![Click::AddWatchedFolder(PathBuf::from("/demo/workspaces/rust"))]);
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots.len(), 7);
        let dup_err = h.state().repos.watched_folders.error.clone().expect("duplicate error");
        assert!(dup_err.contains("duplicate folder"), "{dup_err}");
        h.get_by_label(&dup_err);

        // Nested root validation error.
        h.state_mut().repos.apply(vec![Click::AddWatchedFolder(PathBuf::from("/demo/workspaces/rust/nested"))]);
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots.len(), 7);
        let nested_err = h.state().repos.watched_folders.error.clone().expect("nested error");
        assert!(nested_err.contains("nested folder"), "{nested_err}");

        // Empty category validation error.
        h.state_mut().repos.apply(vec![Click::SetWatchedCategory(0, "   ".into())]);
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots[0].category, "Products and tools");
        let cat_err = h.state().repos.watched_folders.error.clone().expect("empty category error");
        assert!(cat_err.contains("category cannot be empty"), "{cat_err}");

        // Remove newly added row via UI Remove button; clears validation error.
        h.query_all_by_label("Remove").nth(6).expect("row 6 remove").click();
        h.run_steps(2);
        assert_eq!(h.state().repos.state.config.roots.len(), 6);
        assert!(h.state().repos.watched_folders.error.is_none());
    }

    #[test]
    fn watched_folders_live_tempdir_saves_roots_and_sends_rescan() {
        let dir = tempfile::tempdir().unwrap();
        let root_a = dir.path().join("alpha-root");
        let root_b = dir.path().join("beta-root");
        std::fs::create_dir_all(root_a.join("repo-one/.git")).unwrap();
        std::fs::create_dir_all(&root_b).unwrap();

        let cfg_path = dir.path().join("config.toml");
        let initial_toml = format!(
            "# Custom settings header\nremote_check_minutes = 9\ncategories = [\"Tools\"]\nskip_names = [\"custom_skip\"]\n\n[[root]]\npath = {:?}\napp = \"RustRover\"\ncategory = \"Tools\"\n",
            root_a.to_str().unwrap(),
        );
        std::fs::write(&cfg_path, initial_toml).unwrap();
        let (initial_cfg, load_err) = config::load(&cfg_path);
        assert_eq!(load_err, None);

        let files = Files { organize: dir.path().join("organize.toml"), window: dir.path().join("window.toml") };
        let (engine, rx, commands) = ReposEngine::recording();
        let mut h = Harness::builder().with_size(vec2(1440.0, 900.0)).build_eframe(move |cc| {
            let mut repos = ReposPanel::with_sources(Some(files), engine, rx, channel().1, false, Some(repos::demo_data().now));
            repos.state.apply(Msg::Config(Box::new(initial_cfg), None));
            repos.state.apply(Msg::Discovered(Discovery {
                repos: vec![Found {
                    path: root_a.join("repo-one"),
                    git_dir: root_a.join("repo-one/.git"),
                    root: 0,
                    ide: Some(Ide::RustRover),
                    ide_source: IdeSource::Root,
                    langs: vec!["rust".into()],
                }],
                errors: vec![],
            }));
            repos.state.settle();
            let agents = AgentsPanel::demo(&cc.egui_ctx);
            AstrolabeApp::with_panels(cc, Panel::Repos, repos, agents)
        });
        h.run_steps(3);
        h.key_press_modifiers(Modifiers::COMMAND, K::Comma);
        h.run_steps(2);
        assert!(h.state().repos.watched_folders.open);

        // Add valid root_b -> persists config.toml preserving comments/other settings and sends Cmd::Rescan.
        h.state_mut().repos.apply(vec![Click::AddWatchedFolder(root_b.clone())]);
        h.run_steps(2);
        assert_eq!(commands.try_recv().ok(), Some(Cmd::Rescan));
        assert!(h.state().repos.watched_folders.error.is_none());
        let saved_text = std::fs::read_to_string(&cfg_path).unwrap();
        assert!(saved_text.contains("# Custom settings header"), "{saved_text}");
        assert!(saved_text.contains("remote_check_minutes = 9"), "{saved_text}");
        assert!(saved_text.contains("custom_skip"), "{saved_text}");
        let (reloaded, err) = config::load(&cfg_path);
        assert_eq!(err, None);
        assert_eq!(reloaded.roots.len(), 2);
        assert_eq!(reloaded.roots[1].path, root_b);
        assert_eq!(reloaded.roots[1].ide, None);
        assert!(reloaded.roots[1].detect_third_party);

        // Edit category and app of row 1 -> saves and sends Cmd::Rescan each time.
        h.state_mut().repos.apply(vec![Click::SetWatchedCategory(1, "Labs".into())]);
        h.run_steps(2);
        assert_eq!(commands.try_recv().ok(), Some(Cmd::Rescan));
        assert_eq!(config::load(&cfg_path).0.roots[1].category, "Labs");

        h.query_all_by_role(Role::ComboBox).nth(1).expect("row 1 app").click();
        h.run_steps(3);
        h.get_by_role(Role::ListBox).get_by_label("GoLand").click();
        h.run_steps(3);
        assert_eq!(commands.try_recv().ok(), Some(Cmd::Rescan));
        assert_eq!(config::load(&cfg_path).0.roots[1].ide, Some(Ide::GoLand));

        // Invalid non-existent path -> inline error, no save, no Cmd::Rescan.
        let missing = dir.path().join("missing-folder");
        h.state_mut().repos.apply(vec![Click::AddWatchedFolder(missing)]);
        h.run_steps(2);
        assert!(commands.try_recv().is_err());
        let err_msg = h.state().repos.watched_folders.error.clone().expect("missing folder error");
        assert!(err_msg.contains("folder does not exist"), "{err_msg}");
        assert_eq!(config::load(&cfg_path).0.roots.len(), 2);

        // Remove row 1 via UI Remove button -> saves and sends Cmd::Rescan.
        h.query_all_by_label("Remove").nth(1).expect("row 1 remove").click();
        h.run_steps(2);
        assert_eq!(commands.try_recv().ok(), Some(Cmd::Rescan));
        assert_eq!(config::load(&cfg_path).0.roots.len(), 1);
    }

    #[test]
    fn offscreen_capture_watched_folders_demo_png() {
        let cfg = CaptureConfig { size: vec2(1440.0, 900.0), pixels_per_point: 2.0, steps: 5 };
        let tmp;
        let out_path = match scratch_wf_dir() {
            Some(dir) => dir.join("watched-folders.png"),
            None => {
                tmp = tempfile::tempdir().unwrap();
                tmp.path().join("watched-folders.png")
            }
        };
        let out = render_eframe_png(&out_path, &cfg, |cc| {
            let mut app = AstrolabeApp::new(cc, LaunchOptions::demo(Panel::Repos));
            app.repos.apply(vec![Click::WatchedFolders(true)]);
            app
        })
        .expect("offscreen wgpu render for watched-folders.png");
        assert_eq!((out.width, out.height), (2880, 1800));
    }
}
