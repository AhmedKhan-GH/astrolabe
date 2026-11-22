//! Middle repository list pane: sort/density/folder-query control strip,
//! numbered framed sections, Comfortable and Compact row layouts, drag-and-drop,
//! double-click open, and row context menus.

use astrolabe_engines::repos::{
    Density, GhListedRepo, Grouping, Nav, Section, SectionKey, Sort, paths, query, remote, tags, view,
};
use astrolabe_kit::{StatusTone, color, draw, font_size, metric, paint_status_chip, theme};
use egui::{Align, CursorIcon, Key as K, Rect, ScrollArea, Sense, Ui, UiBuilder, Vec2, pos2, vec2};

use super::{Click, RepoDrag, ReposPanel};
use crate::widgets;

const MARGIN: f32 = 14.0;
const STRIP_H: f32 = 36.0;
const SECTION_H: f32 = 26.0;
const SECTION_GAP: f32 = 10.0;
const COL_HEADER_H: f32 = 24.0;
const PAD: f32 = 12.0;
const GAP: f32 = 12.0;
const FIELD_W_MIN: f32 = 160.0;

struct RemoteCols {
    left: Rect,
    vis: Rect,
    branch: Rect,
    push: Rect,
}

fn remote_cols(rect: Rect) -> RemoteCols {
    let narrow = rect.width() < 520.0;
    let push_w = if narrow { 76.0 } else { 96.0 };
    let branch_w = if narrow { 78.0 } else { 110.0 };
    let vis_w = 84.0;

    let push_r = rect.right() - PAD;
    let push_l = (push_r - push_w).max(rect.left() + PAD);
    let branch_r = (push_l - GAP).max(rect.left() + PAD);
    let branch_l = (branch_r - branch_w).max(rect.left() + PAD);
    let vis_r = (branch_l - GAP).max(rect.left() + PAD);
    let vis_l = (vis_r - vis_w).max(rect.left() + PAD);
    let left_l = rect.left() + PAD;
    let left_r = (vis_l - GAP).max(left_l + 1.0);

    RemoteCols {
        left: Rect::from_min_max(pos2(left_l, rect.top()), pos2(left_r, rect.bottom())),
        vis: Rect::from_min_max(pos2(vis_l, rect.top()), pos2(vis_r, rect.bottom())),
        branch: Rect::from_min_max(pos2(branch_l, rect.top()), pos2(branch_r, rect.bottom())),
        push: Rect::from_min_max(pos2(push_l, rect.top()), pos2(push_r, rect.bottom())),
    }
}

fn visibility_tone(repo: &GhListedRepo) -> StatusTone {
    match repo.visibility.to_ascii_lowercase().as_str() {
        "public" => StatusTone::Info,
        "internal" => StatusTone::Warn,
        _ if !repo.private => StatusTone::Info,
        _ => StatusTone::Neutral,
    }
}

fn row_h(density: Density) -> f32 {
    match density {
        Density::Compact => 34.0,
        Density::Comfortable => 52.0,
    }
}

fn icon_size(density: Density) -> f32 {
    match density {
        Density::Compact => 22.0,
        Density::Comfortable => 32.0,
    }
}

impl ReposPanel {
    pub(super) fn is_remote_only_nav(&self) -> bool {
        matches!(&self.view.nav, Nav::Tag(t) if t == tags::LOCATION_REMOTE_ONLY)
    }

    pub(super) fn remote_only_rows(&self) -> Vec<usize> {
        view::remote_only_shown(&self.state.remote_only, &self.filter_query, self.view.sort, self.view.desc)
    }

    pub(crate) fn visible_row_count(&self) -> usize {
        if self.is_remote_only_nav() {
            self.remote_only_rows().len()
        } else {
            self.shown().len()
        }
    }

    pub(super) fn list(&mut self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        let rect = ui.max_rect();
        let strip = Rect::from_min_size(rect.min, vec2(rect.width(), STRIP_H));
        self.list_controls(ui, strip, clicks);
        draw::rule_h(ui.painter(), rect.left(), rect.right(), strip.bottom() - 1.0, color::RULE_FAINT);

        let body = Rect::from_min_max(pos2(rect.left(), strip.bottom()), rect.max);
        let mut child =
            ui.new_child(UiBuilder::new().id_salt("repos_rows").max_rect(body).layout(egui::Layout::top_down(Align::Min)));
        child.set_clip_rect(body.intersect(ui.clip_rect()));
        if self.is_remote_only_nav() {
            let indices = self.remote_only_rows();
            self.remote_only_list(&mut child, &indices, clicks);
        } else {
            let sections = self.sections();
            self.rows(&mut child, &sections, clicks);
        }
    }

    fn list_controls(&mut self, ui: &mut Ui, rect: Rect, clicks: &mut Vec<Click>) {
        let inner = Rect::from_min_max(
            pos2(rect.left() + MARGIN, rect.top() + 6.0),
            pos2(rect.right() - MARGIN, rect.bottom() - 6.0),
        );
        let mut right =
            ui.new_child(UiBuilder::new().max_rect(inner).layout(egui::Layout::right_to_left(Align::Center)));
        right.spacing_mut().item_spacing.x = 6.0;
        for (d, label) in [(Density::Comfortable, "Comfortable"), (Density::Compact, "Compact")] {
            let on = self.view.density == d;
            if widgets::toggle_button(&mut right, label, on).clicked() && !on {
                clicks.push(Click::Density(d));
            }
        }
        right.add_space(10.0);
        let remote_only = self.is_remote_only_nav();
        for s in Sort::ALL.into_iter().rev() {
            let on = self.view.sort == s;
            let arrow = match (on, self.view.desc) {
                (false, _) => "",
                (true, true) => " ▼",
                (true, false) => " ▲",
            };
            let name = match s {
                Sort::Name => "Name",
                Sort::Location => "Location",
                Sort::Recent => "Recent",
            };
            let hover = match (s, remote_only) {
                (Sort::Name, _) => "Sort by name",
                (Sort::Location, true) => "Sort by owner and name",
                (Sort::Location, false) => "Sort by path",
                (Sort::Recent, true) => "Sort by last push",
                (Sort::Recent, false) => "Sort by latest commit",
            };
            if widgets::toggle_button(&mut right, &format!("{name}{arrow}"), on).on_hover_text(hover).clicked() {
                clicks.push(Click::Sort(s));
            }
        }

        let used_left = right.min_rect().left();
        let Some(at) = self.nav_folder() else { return };
        let smart = self.org.folder(&at).is_some_and(|f| f.is_smart());
        let left =
            Rect::from_min_max(inner.min, pos2((used_left - 16.0).max(inner.left() + FIELD_W_MIN), inner.bottom()));
        if smart || self.query_open {
            self.query_field(ui, left, &at, clicks);
        } else {
            let mut left_ui =
                ui.new_child(UiBuilder::new().max_rect(left).layout(egui::Layout::left_to_right(Align::Center)));
            let resp = widgets::action_button(&mut left_ui, "Add Query", true, 0.0)
                .on_hover_text("Add boolean query rule to folder");
            if resp.clicked() {
                clicks.push(Click::OpenQuery);
            }
        }
    }

    fn query_field(&mut self, ui: &mut Ui, rect: Rect, at: &[usize], clicks: &mut Vec<Click>) {
        let Some(folder) = self.org.folder(at) else { return };
        let names = self.org.names(at);
        let current = folder.query.clone();
        let id = ui.scope_id().with("folder-query");
        let focused = ui.memory(|m| m.has_focus(id));
        match &mut self.query_edit {
            Some((n, text)) if *n == names => {
                if !focused && *text != current {
                    *text = current.clone();
                }
            }
            _ => self.query_edit = Some((names, current.clone())),
        }
        let Some((_, text)) = &mut self.query_edit else { return };
        let field = Rect::from_min_size(pos2(rect.left(), rect.center().y - 12.0), vec2(rect.width(), 24.0));
        let resp = widgets::text_field(ui, field, id, text, "Query (e.g. uncommitted stale)", true, false);
        if self.focus_query {
            self.focus_query = false;
            resp.request_focus();
        }
        let parsed = query::parse(text);
        if let Err(e) = &parsed {
            let p = ui.painter();
            let galley = p.layout_job(theme::mono_job(&e.message, font_size::MONO_SMALL, color::ERROR));
            let pos = pos2(field.right() - galley.size().x - 8.0, field.center().y - galley.size().y * 0.5);
            p.rect_filled(Rect::from_min_size(pos - vec2(6.0, 2.0), galley.size() + vec2(12.0, 4.0)), 0.0, color::DEEP);
            p.galley(pos, galley, color::ERROR);
        }
        if resp.changed() && parsed.is_ok() {
            clicks.push(Click::SetQuery { at: at.to_vec(), text: text.clone(), typing: true });
        }
        if resp.lost_focus() || (resp.has_focus() && ui.input(|i| i.key_pressed(K::Enter))) {
            clicks.push(Click::SetQuery { at: at.to_vec(), text: text.clone(), typing: false });
        }
    }

    fn section_title(&self, group: &str) -> String {
        if self.view.grouping != Grouping::None {
            return group.to_ascii_uppercase();
        }
        match &self.view.nav {
            Nav::All => "ALL REPOS".to_owned(),
            Nav::Folder(names) => names.join(" / ").to_ascii_uppercase(),
            Nav::Tag(t) => self.tag_label(t).to_ascii_uppercase(),
        }
    }

    fn rows(&mut self, ui: &mut Ui, sections: &[Section], clicks: &mut Vec<Click>) {
        self.view.selected_section = self.row_section(sections);
        let rh = row_h(self.view.density);
        let mut area = ScrollArea::vertical().id_salt("repos_list_scroll").auto_shrink([false, false]);
        let mut revealed = false;
        if self.reveal {
            let selected = self.view.selected.as_deref();
            let mut y = 0.0;
            let mut target = None;
            for section in sections {
                y += SECTION_GAP + SECTION_H;
                for (n, &i) in section.rows.iter().enumerate() {
                    if Some(&section.key) == self.view.selected_section.as_ref()
                        && Some(self.state.repos[i].id()) == selected
                    {
                        let top = if n == 0 { y - SECTION_GAP - SECTION_H } else { y };
                        target = Some((top, y + rh));
                    }
                    y += rh;
                }
            }
            let (off, h) = (self.list_offset, ui.max_rect().height());
            match target {
                Some((top, _)) if top < off => area = area.vertical_scroll_offset(top.max(0.0)),
                Some((_, bottom)) if bottom > off + h => area = area.vertical_scroll_offset(bottom - h + MARGIN),
                _ => revealed = true,
            }
        }

        let out = area.show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 0, bottom: 16 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                let width = ui.available_width().max(1.0);
                let left = ui.cursor().left();
                if sections.is_empty() {
                    self.empty_note(ui, width);
                }
                for (n, section) in sections.iter().enumerate() {
                    ui.add_space(SECTION_GAP);
                    self.section_header(ui, width, n + 1, &section.title, section.rows.len(), clicks);
                    let top = ui.cursor().top();
                    for (k, &i) in section.rows.iter().enumerate() {
                        self.row(ui, width, i, &section.key, k + 1 == section.rows.len(), clicks);
                    }
                    let block = Rect::from_min_max(pos2(left, top), pos2(left + width, ui.cursor().top()));
                    draw::box_outline(ui.painter(), block, color::RULE);
                }
                let rest = ui.available_height().max(36.0);
                let (_, blank) = ui.allocate_exact_size(vec2(width, rest), Sense::click());
                if blank.clicked() {
                    clicks.push(Click::Deselect);
                }
            });
        });
        self.list_offset = out.state.clamped_offset().y;
        if revealed {
            self.reveal = false;
        }
    }

    fn section_header(&self, ui: &mut Ui, width: f32, n: usize, group: &str, count: usize, clicks: &mut Vec<Click>) {
        let (rect, _) = ui.allocate_exact_size(vec2(width, SECTION_H), Sense::hover());
        let p = ui.painter().clone();
        let arrow = match (self.view.sort, self.view.desc) {
            (Sort::Name, false) => " ▲",
            (Sort::Name, true) => " ▼",
            _ => "",
        };
        let word = if count == 1 { "REPO" } else { "REPOS" };
        let count_job = theme::label_job(&format!("{count} {word}"), color::FAINT);
        let count_w = theme::job_width(ui, count_job.clone());
        theme::paint_job(&p, rect, count_job, Align::Max, false);
        let title_rect = Rect::from_min_max(rect.min, pos2((rect.right() - count_w - GAP).max(rect.left() + 1.0), rect.bottom()));
        let title = format!("{n:02} / {}{arrow}", self.section_title(group));
        let w = theme::paint_job(&p, title_rect, theme::label_job(&title, color::SECONDARY), Align::Min, true);
        let hit = Rect::from_min_size(title_rect.min, vec2(w, title_rect.height()));
        let resp = ui.interact(hit, ui.scope_id().with(("section_title", n)), Sense::click());
        if resp.on_hover_cursor(CursorIcon::PointingHand).on_hover_text("Sort by name").clicked() {
            clicks.push(Click::Sort(Sort::Name));
        }
    }

    fn empty_note(&self, ui: &mut Ui, width: f32) {
        let text = if !self.state.discovered {
            "LOOKING FOR REPOSITORIES"
        } else if !self.view.filter.trim().is_empty() {
            "NOTHING MATCHES FILTER"
        } else {
            match &self.view.nav {
                Nav::Folder(_) => "EMPTY · DROP REPOS ONTO FOLDER OR ADD QUERY",
                Nav::Tag(_) => "NO REPOSITORY HAS THIS TAG",
                Nav::All => "NO REPOSITORIES",
            }
        };
        ui.add_space(SECTION_GAP);
        let (r, _) = ui.allocate_exact_size(vec2(width, SECTION_H), Sense::hover());
        theme::paint_job(ui.painter(), r, theme::label_job(text, color::FAINT), Align::Min, true);
    }

    fn row(&self, ui: &mut Ui, width: f32, i: usize, section: &SectionKey, last: bool, clicks: &mut Vec<Click>) {
        let repo = &self.state.repos[i];
        let density = self.view.density;
        let (rect, resp) = ui.allocate_exact_size(vec2(width, row_h(density)), Sense::click_and_drag());
        let selected =
            self.view.selected.as_deref() == Some(repo.id()) && self.view.selected_section.as_ref() == Some(section);
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, selected, &repo.name));

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

        let icon = icon_size(density);
        let tile_rect = Rect::from_center_size(pos2(rect.left() + PAD + icon * 0.5, rect.center().y), Vec2::splat(icon));
        self.paint_repo_tile(ui, tile_rect, repo, selected);

        let text_l = rect.left() + PAD + icon + GAP;
        let tags = self.index.manual[i].join(" · ");
        let location = &self.index.locations[i];
        let name_ink = if selected { color::BRONZE } else { color::PARCHMENT };

        match density {
            Density::Comfortable => {
                let mid = rect.center().y;
                let l1 = Rect::from_min_max(pos2(text_l, mid - 17.0), pos2(rect.right() - PAD, mid));
                let l2 = Rect::from_min_max(pos2(text_l, mid + 1.0), pos2(rect.right() - PAD, mid + 17.0));
                let w = theme::paint_job(&p, l1, theme::sans_job(&repo.name, 14.0, name_ink, true), Align::Min, true);
                let beside = Rect::from_min_max(pos2(l1.left() + w + 8.0, l1.top() + 0.5), l1.max);
                if !tags.is_empty() && beside.width() > 30.0 {
                    theme::paint_job(&p, beside, theme::mono_job(&tags, font_size::MONO_SMALL, color::FAINT), Align::Min, true);
                }
                theme::paint_job(&p, l2, theme::mono_job(location, font_size::MONO_SMALL, color::SECONDARY), Align::Min, true);
            }
            Density::Compact => {
                let split = text_l + ((rect.right() - text_l) * 0.45).max(190.0);
                let l1 = Rect::from_min_max(pos2(text_l, rect.top()), pos2((split - GAP).max(text_l + 1.0), rect.bottom()));
                let w = theme::paint_job(&p, l1, theme::sans_job(&repo.name, font_size::BODY, name_ink, true), Align::Min, true);
                let beside = Rect::from_min_max(pos2(l1.left() + w + 8.0, l1.top() + 0.5), l1.max);
                if !tags.is_empty() && beside.width() > 30.0 {
                    theme::paint_job(&p, beside, theme::mono_job(&tags, font_size::MONO_SMALL, color::FAINT), Align::Min, true);
                }
                let loc = Rect::from_min_max(pos2(split, rect.top()), pos2(rect.right() - PAD, rect.bottom()));
                theme::paint_job(&p, loc, theme::mono_job(location, font_size::MONO_SMALL, color::SECONDARY), Align::Min, true);
            }
        }

        if resp.double_clicked() {
            clicks.push(Click::Open(repo.id().to_owned()));
        } else if resp.clicked() {
            clicks.push(Click::SelectRow(repo.id().to_owned(), section.clone()));
        }
        resp.dnd_set_drag_payload(RepoDrag(repo.id().to_owned()));
        let resp = resp.on_hover_cursor(CursorIcon::PointingHand).on_hover_text(paths::tilde(repo.id()));
        resp.context_menu(|ui| self.row_menu(ui, i, clicks));
    }

    fn row_menu(&self, ui: &mut Ui, i: usize, clicks: &mut Vec<Click>) {
        let repo = &self.state.repos[i];
        let id = repo.id().to_owned();
        if let Some(ide) = repo.ide
            && ui.button(format!("Open in {}", ide.name())).clicked()
        {
            clicks.push(Click::Open(id.clone()));
        }
        if ui.button("Reveal in Finder").clicked() {
            clicks.push(Click::Finder(id.clone()));
        }
        if ui.button("Open in Terminal").clicked() {
            clicks.push(Click::Terminal(id.clone()));
        }
        if let Some(url) = repo.stats().and_then(|s| remote::web_url(s, repo.gh.as_ref()))
            && ui.button("Open on GitHub").clicked()
        {
            clicks.push(Click::Web(url));
        }
        ui.separator();
        ui.menu_button("Add to Folder", |ui| self.folder_menu(ui, i, clicks));
        if let Some(at) = self.nav_folder()
            && self.index.folder(&at).is_some_and(|m| m.get(i).copied().unwrap_or(false))
            && ui.button(format!("Remove From {}", self.nav_title())).clicked()
        {
            clicks.push(Click::TakeOut(at, id.clone()));
        }
        if ui.button("Edit Tags").clicked() {
            clicks.push(Click::EditTags(id.clone()));
        }
        if repo.error().is_some() {
            ui.separator();
            if ui
                .button("Remove From Monitor")
                .on_hover_text("Stop monitoring repository; files on disk remain")
                .clicked()
            {
                clicks.push(Click::RemoveRepo(id));
            }
        }
    }

    pub(super) fn folder_menu(&self, ui: &mut Ui, i: usize, clicks: &mut Vec<Click>) {
        let id = self.state.repos[i].id().to_owned();
        for (at, folder) in self.org.walk() {
            let holds = self.index.folder(&at).is_some_and(|m| m.get(i).copied().unwrap_or(false));
            let text = format!("{}{}", "      ".repeat(at.len() - 1), folder.name);
            if ui.add_enabled(!holds, egui::Button::new(text)).clicked() {
                clicks.push(Click::Pin(at.clone(), id.clone()));
            }
        }
        if !self.org.folders.is_empty() {
            ui.separator();
        }
        if ui.button("New Folder With Repo").clicked() {
            clicks.push(Click::NewFolderWith(id));
        }
    }

    fn remote_only_list(&mut self, ui: &mut Ui, indices: &[usize], clicks: &mut Vec<Click>) {
        let area = ScrollArea::vertical().id_salt("repos_list_scroll").auto_shrink([false, false]);
        let out = area.show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 0, bottom: 16 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                let width = ui.available_width().max(1.0);
                let left = ui.cursor().left();
                if indices.is_empty() {
                    let text = if !self.view.filter.trim().is_empty() {
                        "NOTHING MATCHES FILTER"
                    } else {
                        "NO REMOTE-ONLY REPOSITORIES"
                    };
                    ui.add_space(SECTION_GAP);
                    let (r, _) = ui.allocate_exact_size(vec2(width, SECTION_H), Sense::hover());
                    theme::paint_job(ui.painter(), r, theme::label_job(text, color::FAINT), Align::Min, true);
                    return;
                }
                ui.add_space(SECTION_GAP);
                self.section_header(ui, width, 1, "Remote Only", indices.len(), clicks);
                let top = ui.cursor().top();
                self.remote_only_header(ui, width);
                for (k, &i) in indices.iter().enumerate() {
                    self.remote_only_row(ui, width, &self.state.remote_only[i], k + 1 == indices.len());
                }
                let block = Rect::from_min_max(pos2(left, top), pos2(left + width, ui.cursor().top()));
                draw::box_outline(ui.painter(), block, color::RULE);
            });
        });
        self.list_offset = out.state.clamped_offset().y;
        self.reveal = false;
    }

    fn remote_only_header(&self, ui: &mut Ui, width: f32) {
        let (rect, _) = ui.allocate_exact_size(vec2(width, COL_HEADER_H), Sense::hover());
        let p = ui.painter();
        p.rect_filled(rect, 0.0, color::DEEP);
        draw::rule_h(p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE_FAINT);
        let cols = remote_cols(rect);
        match self.view.density {
            Density::Comfortable => {
                theme::paint_job(p, cols.left, theme::label_job("Name / Owner", color::FAINT), Align::Min, true);
            }
            Density::Compact => {
                let split = cols.left.left() + (cols.left.width() * 0.56).max(120.0).min(cols.left.width());
                let name_r = Rect::from_min_max(cols.left.min, pos2((split - GAP).max(cols.left.left() + 1.0), cols.left.bottom()));
                let owner_r = Rect::from_min_max(pos2(split, cols.left.top()), cols.left.max);
                theme::paint_job(p, name_r, theme::label_job("Name", color::FAINT), Align::Min, true);
                theme::paint_job(p, owner_r, theme::label_job("Owner", color::FAINT), Align::Min, true);
            }
        }
        theme::paint_job(p, cols.vis, theme::label_job("Visibility", color::FAINT), Align::Min, true);
        theme::paint_job(p, cols.branch, theme::label_job("Branch", color::FAINT), Align::Min, true);
        theme::paint_job(p, cols.push, theme::label_job("Last Push", color::FAINT), Align::Max, false);
    }

    fn remote_only_row(&self, ui: &mut Ui, width: f32, repo: &GhListedRepo, last: bool) {
        let density = self.view.density;
        let (rect, resp) = ui.allocate_exact_size(vec2(width, row_h(density)), Sense::hover());
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, &repo.name));

        let p = ui.painter().clone();
        if !last {
            draw::rule_h(&p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE_FAINT);
        }

        let cols = remote_cols(rect);
        match density {
            Density::Comfortable => {
                let mid = rect.center().y;
                let l1 = Rect::from_min_max(pos2(cols.left.left(), mid - 17.0), pos2(cols.left.right(), mid));
                let l2 = Rect::from_min_max(pos2(cols.left.left(), mid + 1.0), pos2(cols.left.right(), mid + 17.0));
                theme::paint_job(&p, l1, theme::sans_job(&repo.name, 14.0, color::PARCHMENT, true), Align::Min, true);
                theme::paint_job(&p, l2, theme::mono_job(&repo.owner, font_size::MONO_SMALL, color::SECONDARY), Align::Min, true);
            }
            Density::Compact => {
                let split = cols.left.left() + (cols.left.width() * 0.56).max(120.0).min(cols.left.width());
                let name_r = Rect::from_min_max(cols.left.min, pos2((split - GAP).max(cols.left.left() + 1.0), cols.left.bottom()));
                let owner_r = Rect::from_min_max(pos2(split, cols.left.top()), cols.left.max);
                theme::paint_job(&p, name_r, theme::sans_job(&repo.name, font_size::BODY, color::PARCHMENT, true), Align::Min, true);
                theme::paint_job(&p, owner_r, theme::mono_job(&repo.owner, font_size::MONO_SMALL, color::SECONDARY), Align::Min, true);
            }
        }

        let vis = if repo.visibility.is_empty() {
            if repo.private { "private" } else { "public" }
        } else {
            &repo.visibility
        };
        paint_status_chip(&p, cols.vis.left(), rect.center().y, vis, visibility_tone(repo));

        let branch = if repo.default_branch.is_empty() { "–" } else { &repo.default_branch };
        theme::paint_job(&p, cols.branch, theme::mono_job(branch, font_size::MONO_SMALL, color::SECONDARY), Align::Min, true);

        let pushed = repo.pushed_at.map(|t| self.ago(t)).unwrap_or_else(|| "–".to_owned());
        theme::paint_job(&p, cols.push, theme::mono_job(&pushed, font_size::MONO_SMALL, color::SECONDARY), Align::Max, false);
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use astrolabe_engines::repos::{Nav, Sort, tags};
    use astrolabe_kit::capture::{CaptureConfig, render_eframe_png};
    use egui::accesskit::Role;
    use egui::vec2;
    use egui_kittest::Harness;
    use egui_kittest::kittest::Queryable;

    use crate::app::{AstrolabeApp, LaunchOptions, Panel};
    use crate::repos_panel::Click;

    fn demo_harness() -> Harness<'static, AstrolabeApp> {
        Harness::builder()
            .with_size(vec2(1440.0, 900.0))
            .with_pixels_per_point(2.0)
            .build_eframe(|cc| AstrolabeApp::new(cc, LaunchOptions::demo(Panel::Repos)))
    }

    #[test]
    fn location_filters_and_remote_only_rows_have_no_actions() {
        let mut h = demo_harness();
        h.run_steps(3);
        assert_eq!(h.state().repos.visible_row_count(), 11);

        // Local Only filter: local repos without remotes.
        h.get_by_label("Local Only").click();
        h.run_steps(2);
        assert_eq!(h.state().repos.view.nav, Nav::Tag(tags::LOCATION_LOCAL_ONLY.to_owned()));
        assert_eq!(h.state().repos.visible_row_count(), 2);
        h.get_by_label("meridian-sim");
        h.get_by_label("fresh-scratch");

        // Both filter: local clones of GitHub repositories.
        h.get_by_label("Both").click();
        h.run_steps(2);
        assert_eq!(h.state().repos.view.nav, Nav::Tag(tags::LOCATION_BOTH.to_owned()));
        assert_eq!(h.state().repos.visible_row_count(), 7);
        h.get_by_label("compass-ui");
        h.get_by_label("sextant-core");

        // Remote Only filter: GitHub repositories without a local clone.
        h.get_by_label("Remote Only").click();
        h.run_steps(2);
        assert_eq!(h.state().repos.view.nav, Nav::Tag(tags::LOCATION_REMOTE_ONLY.to_owned()));
        assert_eq!(h.state().repos.visible_row_count(), 4);

        for name in ["orbit-scheduler", "beacon-telemetry", "kestrel-proto", "astrolabe-spec"] {
            h.get_by_role_and_label(Role::Label, name);
        }

        // Clicking a remote-only row triggers no selection or action.
        h.get_by_role_and_label(Role::Label, "orbit-scheduler").click();
        h.run_steps(2);
        assert!(h.state().repos.selected().is_none());
        assert!(h.state().repos.view.selected.is_none());

        // Filter query narrows remote-only rows by visibility, owner, or name.
        h.state_mut().repos.apply(vec![Click::Filter("private".into())]);
        h.run_steps(2);
        assert_eq!(h.state().repos.visible_row_count(), 2);

        h.state_mut().repos.apply(vec![Click::Filter("cobalt-systems".into())]);
        h.run_steps(2);
        assert_eq!(h.state().repos.visible_row_count(), 1);

        h.state_mut().repos.apply(vec![Click::Filter(String::new())]);
        h.run_steps(2);
        assert_eq!(h.state().repos.visible_row_count(), 4);

        // Sort controls reorder remote-only rows.
        h.get_by_label("Recent").click();
        h.run_steps(2);
        assert_eq!(h.state().repos.view.sort, Sort::Recent);
        let ordered = h.state().repos.remote_only_rows();
        assert_eq!(h.state().repos.state.remote_only[ordered[0]].name, "orbit-scheduler");
    }

    #[test]
    fn offscreen_capture_remote_only_location_png() {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return;
        };
        let out_path = home.join(".worktrees").join("astrolabe").join("scratch").join("wf").join("location.png");
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).expect("create wf capture directory");
        }
        let cfg = CaptureConfig { size: vec2(1440.0, 900.0), pixels_per_point: 2.0, steps: 5 };
        let rendered = render_eframe_png(&out_path, &cfg, |cc| {
            let mut app = AstrolabeApp::new(cc, LaunchOptions::demo(Panel::Repos));
            app.repos.apply(vec![Click::Nav(Nav::Tag(tags::LOCATION_REMOTE_ONLY.to_owned()))]);
            app
        })
        .expect("offscreen wgpu render for location.png");
        assert_eq!((rendered.width, rendered.height), (2880, 1800));
        assert!(out_path.is_file());
    }
}
