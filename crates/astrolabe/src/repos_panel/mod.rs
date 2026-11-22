//! Repos panel: repository discovery view, grouping, live boolean filter,
//! sidebar tree, inspector (Totals and Repository Detail), Manage mode,
//! modals, keyboard shortcuts, and status bar telemetry.

mod inspector;
mod list;
mod manage;
mod sidebar;

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant, SystemTime};

use astrolabe_engines::repos::{
    self, Cmd, Density, Engine, Folder, Grouping, Ide, Index, Msg, Nav, Organize, Prefs, Query, Repo, RepoKeys,
    Section, SectionKey, Sort, State, actions, git, organize, paths, query, tag_slug, tags, view,
};
use astrolabe_kit::{
    Pane, StatusTone, color, command_input, draw, font_size, key_button, metric, split_horizontal, status_indicator,
    status_item, theme, word_button,
};
use egui::{Align, Color32, CursorIcon, Key as K, KeyboardShortcut, Modifiers, Rect, Sense, Ui, vec2};

use crate::icons;
use crate::widgets;

const TYPING_SAVE: Duration = Duration::from_millis(800);
const ORGANIZE_POLL: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReposPane {
    List,
    Inspector,
}

#[derive(Clone, Debug)]
pub struct Files {
    pub organize: PathBuf,
    pub window: PathBuf,
}

impl Files {
    pub fn real() -> Self {
        Self { organize: paths::organize_file(), window: paths::window_file() }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RepoDrag(pub(crate) PathBuf);

#[derive(Clone, Debug)]
pub(crate) struct FolderDrag(pub(crate) Vec<usize>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tab {
    Folders,
    Tags,
}

pub(crate) struct View {
    pub(crate) nav: Nav,
    pub(crate) grouping: Grouping,
    pub(crate) density: Density,
    pub(crate) sort: Sort,
    pub(crate) desc: bool,
    pub(crate) filter: String,
    pub(crate) selected: Option<PathBuf>,
    pub(crate) selected_section: Option<SectionKey>,
    pub(crate) folded: BTreeSet<String>,
}

impl View {
    fn from_prefs(p: &Prefs) -> Self {
        Self {
            nav: p.nav(),
            grouping: p.grouping,
            density: p.density,
            sort: p.sort,
            desc: p.descending,
            filter: String::new(),
            selected: None,
            selected_section: None,
            folded: p.folded.clone(),
        }
    }

    fn prefs(&self) -> Prefs {
        let mut p = Prefs {
            folder: Vec::new(),
            tag: String::new(),
            grouping: self.grouping,
            density: self.density,
            sort: self.sort,
            descending: self.desc,
            folded: self.folded.clone(),
        };
        p.set_nav(&self.nav);
        p
    }
}

pub(crate) struct Manager {
    pub(crate) open: bool,
    pub(crate) tab: Tab,
    pub(crate) folder: Option<Vec<String>>,
    pub(crate) tag: Option<String>,
    pub(crate) renaming: Option<String>,
    pub(crate) focus_name: bool,
    pub(crate) query: Option<(Vec<String>, String)>,
    pub(crate) adding: bool,
    pub(crate) search: String,
    pub(crate) ticked: BTreeSet<PathBuf>,
    pub(crate) tag_search: String,
}

impl Manager {
    fn new() -> Self {
        Self {
            open: false,
            tab: Tab::Folders,
            folder: None,
            tag: None,
            renaming: None,
            focus_name: false,
            query: None,
            adding: false,
            search: String::new(),
            ticked: BTreeSet::new(),
            tag_search: String::new(),
        }
    }

    fn reset_editing(&mut self) {
        self.renaming = None;
        self.query = None;
        self.adding = false;
        self.search.clear();
        self.ticked.clear();
        self.tag_search.clear();
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Confirm {
    DeleteFolder(Vec<usize>),
    DeleteTag(String),
    MergeTag(String, String),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Renaming {
    Folder(Vec<usize>, String),
    Tag(String, String),
}

pub(crate) struct FolderDraft {
    pub(crate) parent: Vec<String>,
    pub(crate) name: String,
    pub(crate) query: String,
    pub(crate) smart: bool,
    pub(crate) pin: Option<RepoKeys>,
    pub(crate) focus_name: bool,
    pub(crate) error: Option<String>,
}

pub enum Click {
    Select(PathBuf),
    SelectRow(PathBuf, SectionKey),
    Deselect,
    Open(PathBuf),
    Finder(PathBuf),
    Terminal(PathBuf),
    Web(String),
    Settings,
    Nav(Nav),
    Sort(Sort),
    Group(Grouping),
    Density(Density),
    Filter(String),
    Rescan,
    RemoveRepo(PathBuf),
    Remotes,
    Fold(String),
    NewFolder { parent: Vec<usize>, smart: bool },
    NewFolderWith(PathBuf),
    CreateFolder,
    CancelNewFolder,
    StartRename(Vec<usize>),
    RenameFolder(Vec<usize>, String),
    SetQuery { at: Vec<usize>, text: String, typing: bool },
    OpenQuery,
    DeleteFolder(Vec<usize>),
    DeleteFolderNow(Vec<usize>),
    CancelConfirm,
    MoveFolder(Vec<usize>, Vec<usize>),
    Pin(Vec<usize>, PathBuf),
    TakeOut(Vec<usize>, PathBuf),
    Unlist { at: Vec<usize>, key: String, excluded: bool },
    AddTag(PathBuf, String),
    RemoveTag(PathBuf, String),
    StartTagRename(String),
    RenameTag(String, String),
    MergeTagNow(String, String),
    AskDeleteTag(String),
    DeleteTag(String),
    CancelRename,
    EditTags(PathBuf),
    Manage(bool),
    ManageTab(Tab),
    ManageFolder(Vec<usize>),
    ManageTag(String),
    StartManageRename,
    CancelManageRename,
    PlaceFolder { from: Vec<usize>, parent: Vec<usize>, index: usize },
    ShiftFolder(Vec<usize>, isize),
    NewTag,
    AddRepos(bool),
    Tick(PathBuf),
    PinTicked(Vec<usize>),
    TagRepos { tag: String, ids: Vec<PathBuf>, on: bool },
    FocusPane(ReposPane),
}

pub struct ReposPanel {
    pub(crate) engine: Engine,
    pub(crate) rx: Receiver<Msg>,
    pub(crate) state: State,
    pub(crate) view: View,
    pub(crate) files: Option<Files>,
    pub(crate) demo: bool,
    pub(crate) fixed_now: Option<SystemTime>,
    pub(crate) focused_pane: ReposPane,
    saved_prefs: Prefs,
    pub(crate) icons: HashMap<Ide, egui::TextureHandle>,
    icon_rx: Receiver<(Ide, egui::ColorImage)>,
    pub(crate) reveal: bool,
    pub(crate) list_offset: f32,
    pub(crate) focus_filter: bool,

    pub(crate) org: Organize,
    pub(crate) org_error: Option<String>,
    pub(crate) save_error: Option<String>,
    org_stamp: Option<SystemTime>,
    org_rev: u64,
    save_at: Option<Instant>,
    next_org_poll: Instant,
    pub(crate) index: Index,
    index_key: (u64, u64, u64),

    pub(crate) filter_query: Query,
    pub(crate) filter_error: Option<String>,
    pub(crate) renaming: Option<Renaming>,
    pub(crate) focus_rename: bool,
    pub(crate) query_edit: Option<(Vec<String>, String)>,
    pub(crate) query_open: bool,
    pub(crate) focus_query: bool,
    pub(crate) tag_input: String,
    pub(crate) tag_note: Option<String>,
    pub(crate) focus_tag_input: bool,
    pub(crate) confirm: Option<Confirm>,
    pub(crate) new_folder: Option<FolderDraft>,
    pub(crate) manager: Manager,
}

impl ReposPanel {
    pub fn live(ctx: &egui::Context) -> Self {
        let repaint = ctx.clone();
        let (engine, rx) = Engine::start(move || repaint.request_repaint());
        Self::with_sources(Some(Files::real()), engine, rx, load_ide_icons(ctx.clone()), false, None)
    }

    pub fn demo(_ctx: &egui::Context) -> Self {
        let demo = repos::demo::demo_data();
        let (engine, rx) = Engine::idle();
        let (_, icon_rx) = channel();
        let mut panel = Self::with_sources(None, engine, rx, icon_rx, true, Some(demo.now));
        panel.state = demo.state;
        panel.org = demo.organize;
        panel.index = demo.index;
        panel.index_key = (panel.state.generation, panel.org_rev, 0);
        panel
    }

    pub fn with_sources(
        files: Option<Files>,
        engine: Engine,
        rx: Receiver<Msg>,
        icon_rx: Receiver<(Ide, egui::ColorImage)>,
        demo: bool,
        fixed_now: Option<SystemTime>,
    ) -> Self {
        let (org, org_error, org_stamp, prefs) = match &files {
            Some(f) => {
                let (o, e) = organize::load(&f.organize);
                let p = view::load_prefs(&f.window);
                (o, e, modified(&f.organize), p)
            }
            None => (Organize::default(), None, None, Prefs::default()),
        };
        Self {
            engine,
            rx,
            state: State::new(),
            view: View::from_prefs(&prefs),
            files,
            demo,
            fixed_now,
            focused_pane: ReposPane::List,
            saved_prefs: prefs,
            icons: HashMap::new(),
            icon_rx,
            reveal: false,
            list_offset: 0.0,
            focus_filter: false,
            org,
            org_error,
            save_error: None,
            org_stamp,
            org_rev: 0,
            save_at: None,
            next_org_poll: Instant::now() + ORGANIZE_POLL,
            index: Index::default(),
            index_key: (u64::MAX, u64::MAX, u64::MAX),
            filter_query: Query::All,
            filter_error: None,
            renaming: None,
            focus_rename: false,
            query_edit: None,
            query_open: false,
            focus_query: false,
            tag_input: String::new(),
            tag_note: None,
            focus_tag_input: false,
            confirm: None,
            new_folder: None,
            manager: Manager::new(),
        }
    }

    pub fn now(&self) -> SystemTime {
        self.fixed_now.unwrap_or_else(SystemTime::now)
    }

    pub fn age(&self, t: SystemTime) -> String {
        view::age_at(t, self.now())
    }

    pub fn ago(&self, t: SystemTime) -> String {
        view::ago_at(t, self.now())
    }

    pub fn repo_count(&self) -> usize {
        self.index.len()
    }

    pub fn select_by_name(&mut self, name: &str) {
        if let Some(id) = self.state.repos.iter().find(|r| r.name == name).map(|r| r.id().to_owned()) {
            self.apply(vec![Click::Select(id)]);
        }
    }

    pub fn tick(&mut self, ctx: &egui::Context) {
        while let Ok((ide, image)) = self.icon_rx.try_recv() {
            let tex = ctx.load_texture(format!("ide-{}", ide.name()), image, egui::TextureOptions::LINEAR);
            self.icons.insert(ide, tex);
        }
        while let Ok(msg) = self.rx.try_recv() {
            self.state.apply(msg);
        }
        self.state.settle();
        if self.files.is_some() {
            self.poll_org();
            if let Some(due) = self.save_at {
                let now = Instant::now();
                if due <= now {
                    self.save_org();
                } else {
                    ctx.request_repaint_after(due - now);
                }
            }
        }
        self.rebuild_index();
        if let Some(id) = &self.view.selected
            && self.state.discovered
            && self.state.repo(id).is_none()
        {
            self.apply_one(Click::Deselect);
        }
        if let Nav::Folder(names) = &self.view.nav
            && self.org.find(names).is_none()
        {
            self.view.nav = Nav::All;
        }
        if let Some(files) = &self.files {
            let prefs = self.view.prefs();
            if prefs != self.saved_prefs {
                let _ = view::save_prefs(&files.window, &prefs);
                self.saved_prefs = prefs;
            }
        }
        if !self.demo {
            ctx.request_repaint_after(Duration::from_secs(30));
        }
    }

    pub fn flush_pending_save(&mut self) {
        if self.save_at.is_some() {
            self.save_org();
        }
    }

    fn change(&mut self, typing: bool, f: impl FnOnce(&mut Organize, &Index) -> bool) {
        if f(&mut self.org, &self.index) {
            self.org_rev += 1;
            if self.files.is_some() {
                let delay = if typing { TYPING_SAVE } else { Duration::ZERO };
                self.save_at = Some(Instant::now() + delay);
            }
        }
    }

    fn save_org(&mut self) {
        self.save_at = None;
        let Some(files) = &self.files else { return };
        if self.org_error.is_some() {
            return;
        }
        match organize::save(&files.organize, &self.org) {
            Ok(()) => {
                self.save_error = None;
                self.org_stamp = modified(&files.organize);
            }
            Err(e) => self.save_error = Some(e),
        }
    }

    fn poll_org(&mut self) {
        let Some(files) = &self.files else { return };
        let now = Instant::now();
        if now < self.next_org_poll || self.save_at.is_some() {
            return;
        }
        self.next_org_poll = now + ORGANIZE_POLL;
        let stamp = modified(&files.organize);
        if stamp != self.org_stamp {
            let (org, error) = organize::load(&files.organize);
            self.org = org;
            self.org_error = error;
            self.org_stamp = stamp;
            self.org_rev += 1;
            self.query_edit = None;
        }
    }

    fn rebuild_index(&mut self) {
        let now = self.now();
        let tick = now.duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs() / 600);
        let key = (self.state.generation, self.org_rev, tick);
        if key != self.index_key || self.index.len() != self.state.repos.len() {
            self.index = Index::build(&self.state.repos, &self.org, now);
            self.index_key = key;
        }
    }

    pub(crate) fn nav_folder(&self) -> Option<Vec<usize>> {
        view::nav_folder(&self.org, &self.view.nav)
    }

    fn keys_of(&self, id: &Path) -> Option<RepoKeys> {
        self.state.position(id).and_then(|i| self.index.keys.get(i)).cloned()
    }

    pub(crate) fn shown(&self) -> Vec<usize> {
        view::shown(
            &self.state.repos,
            &self.index,
            &self.org,
            &self.view.nav,
            &self.filter_query,
            self.view.sort,
            self.view.desc,
        )
    }

    pub(crate) fn sections(&self) -> Vec<Section> {
        view::sections(
            &self.state.repos,
            &self.index,
            &self.org,
            &self.view.nav,
            &self.filter_query,
            self.view.grouping,
            self.view.sort,
            self.view.desc,
        )
    }

    pub(crate) fn row_section(&self, sections: &[Section]) -> Option<SectionKey> {
        let id = self.view.selected.as_deref()?;
        let mut matches = sections.iter().filter(|s| s.rows.iter().any(|&i| self.state.repos[i].id() == id));
        let first = matches.next()?;
        let preferred = self.view.selected_section.as_ref();
        Some(matches.find(|s| Some(&s.key) == preferred).unwrap_or(first).key.clone())
    }

    pub(crate) fn selected(&self) -> Option<&Repo> {
        self.view.selected.as_deref().and_then(|id| self.state.repo(id))
    }

    pub(crate) fn nav_title(&self) -> String {
        match &self.view.nav {
            Nav::All => "All Repos".to_owned(),
            Nav::Folder(names) => names.last().cloned().unwrap_or_default(),
            Nav::Tag(t) => self.tag_label(t),
        }
    }

    pub(crate) fn tag_label(&self, tag: &str) -> String {
        view::tag_label(&self.state.config, tag)
    }

    pub(crate) fn paint_repo_tile(&self, ui: &Ui, rect: Rect, repo: &Repo, selected: bool) {
        if let Some(tex) = repo.ide.and_then(|ide| self.icons.get(&ide)) {
            egui::Image::from_texture((tex.id(), rect.size())).paint_at(ui, rect);
        } else {
            let glyph = match repo.ide {
                Some(ide) => widgets::ide_monogram(ide).to_owned(),
                None => repo.name.chars().next().unwrap_or('?').to_ascii_uppercase().to_string(),
            };
            widgets::badge_tile(ui.painter(), rect, &glyph, selected);
        }
    }

    // -----------------------------------------------------------------------
    // Command bar, workspace panes, status bar

    pub fn command_bar_left(&mut self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        if self.manager.open {
            return;
        }
        for (g, label, hint) in [
            (Grouping::None, "Flat", "One section · ⌘1"),
            (Grouping::Folder, "Folder", "Group by folder · ⌘2"),
            (Grouping::Tag, "Tag", "Group by tag · ⌘3"),
            (Grouping::App, "App", "Group by app · ⌘4"),
        ] {
            let on = self.view.grouping == g;
            let resp = widgets::toggle_button(ui, label, on).on_hover_text(hint);
            if resp.clicked() && !on {
                clicks.push(Click::Group(g));
            }
        }
        ui.add_space(6.0);

        let mut text = self.view.filter.clone();
        let has_save = self.filter_error.is_none() && !self.view.filter.trim().is_empty();
        let reserve_right = if has_save { 470.0 } else { 330.0 };
        let field_w = (ui.available_width() - reserve_right).clamp(170.0, 310.0);
        let resp = command_input(ui, "repos_filter", &mut text, "Filter by name, tag, or query", field_w)
            .on_hover_text("Boolean filter: AND, OR, NOT, -, parentheses, tag:, name:, path: · ⌘F");
        if self.focus_filter {
            resp.request_focus();
            self.focus_filter = false;
        }
        if resp.has_focus() && ui.input(|i| i.key_pressed(K::Escape)) {
            text.clear();
            resp.surrender_focus();
        }
        if text != self.view.filter {
            clicks.push(Click::Filter(text));
        }

        if let Some(e) = &self.filter_error {
            ui.add_space(4.0);
            ui.label(egui::RichText::new(e).size(font_size::MONO_SMALL).color(color::ERROR));
        } else if !self.view.filter.trim().is_empty() {
            ui.add_space(4.0);
            let save = word_button(ui, "Save As Smart Folder").on_hover_text("Create smart folder from filter · ⇧⌘N");
            if save.clicked() {
                clicks.push(Click::NewFolder { parent: Vec::new(), smart: true });
            }
        }
    }

    pub fn command_bar_right_controls(ui: &mut Ui, manage_open: bool, clicks: &mut Vec<Click>) {
        // Right-to-left layout: first added is rightmost.
        if key_button(ui, "⇧⌘R", "Remotes", true, None).on_hover_text("Check remotes · ⇧⌘R").clicked() {
            clicks.push(Click::Remotes);
        }
        if key_button(ui, "⌘R", "Rescan", true, None).on_hover_text("Rescan roots · ⌘R").clicked() {
            clicks.push(Click::Rescan);
        }
        let manage_resp = if manage_open {
            widgets::toggle_button(ui, "Manage", true)
        } else {
            key_button(ui, "⇧⌘M", "Manage", true, None)
        };
        if manage_resp.on_hover_text("Manage folders and tags · ⇧⌘M").clicked() {
            clicks.push(Click::Manage(!manage_open));
        }
    }

    pub fn show_workspace(&mut self, ui: &mut Ui, workspace: Rect, clicks: &mut Vec<Click>) {
        let (list_rect, insp_rect) = split_horizontal(workspace, 0.63, 460.0, 360.0);

        if self.manager.open {
            let tab_meta = match self.manager.tab {
                Tab::Folders => "FOLDERS",
                Tab::Tags => "TAGS",
            };
            let left_resp = Pane::new("repos_manage", "Manage", self.focused_pane == ReposPane::List)
                .meta(tab_meta)
                .padding(0.0)
                .show(ui, list_rect, |ui| self.manage_rows(ui, clicks));
            if left_resp.header.clicked() {
                clicks.push(Click::FocusPane(ReposPane::List));
            }

            let editor_meta = match self.manager.tab {
                Tab::Folders => self
                    .manager_folder()
                    .and_then(|at| self.org.folder(&at))
                    .map(|f| f.name.to_ascii_uppercase())
                    .unwrap_or_else(|| "NONE".into()),
                Tab::Tags => self
                    .manager
                    .tag
                    .as_deref()
                    .map(str::to_ascii_uppercase)
                    .unwrap_or_else(|| "NONE".into()),
            };
            let right_resp = Pane::new("repos_manage_editor", "Editor", self.focused_pane == ReposPane::Inspector)
                .meta(&editor_meta)
                .left_rule(true)
                .padding(0.0)
                .show(ui, insp_rect, |ui| self.manage_editor(ui, clicks));
            if right_resp.header.clicked() {
                clicks.push(Click::FocusPane(ReposPane::Inspector));
            }
        } else {
            let shown_count = self.shown().len();
            let list_meta = format!("{} {}", shown_count, if shown_count == 1 { "REPO" } else { "REPOS" });
            let list_title = self.nav_title();
            let left_resp = Pane::new("repos_list", &list_title, self.focused_pane == ReposPane::List)
                .meta(&list_meta)
                .padding(0.0)
                .show(ui, list_rect, |ui| self.list(ui, clicks));
            if left_resp.header.clicked() {
                clicks.push(Click::FocusPane(ReposPane::List));
            }

            let (insp_title, insp_meta) = match self.selected() {
                Some(repo) => ("Inspector", repo.name.to_ascii_uppercase()),
                None => ("Totals", list_title.to_ascii_uppercase()),
            };
            let right_resp = Pane::new("repos_inspector", insp_title, self.focused_pane == ReposPane::Inspector)
                .meta(&insp_meta)
                .left_rule(true)
                .padding(0.0)
                .show(ui, insp_rect, |ui| self.inspector(ui, clicks));
            if right_resp.header.clicked() {
                clicks.push(Click::FocusPane(ReposPane::Inspector));
            }
        }
    }

    pub fn status_bar_left(&self, ui: &mut Ui) {
        let s = &self.state;
        if !self.demo && !git::available() {
            status_indicator(ui, "NO GIT", false, StatusTone::Error);
        } else if !s.discovered {
            status_indicator(ui, "LOOKING FOR REPOSITORIES", true, StatusTone::Info);
        } else {
            let label = format!("{} REPOS", s.repos.len());
            status_indicator(ui, &label, true, StatusTone::Ok);
        }
        if s.reading > 0 {
            status_item(ui, &format!("READING {}", s.reading), color::INFO);
        }
        if s.checking > 0 {
            status_item(ui, &format!("CHECKING {}", s.checking), color::INFO);
        }
        let unreadable = s.unreadable();
        if !unreadable.is_empty() {
            let names: Vec<String> =
                unreadable.iter().map(|r| format!("{}: {}", paths::tilde(r.id()), r.error().unwrap_or(""))).collect();
            self.hover_status(ui, &format!("{} UNREADABLE", unreadable.len()), color::ERROR, &names.join("\n"));
        }
        if !s.discovery_errors.is_empty() {
            let names: Vec<String> =
                s.discovery_errors.iter().map(|(p, e)| format!("{}: {e}", paths::tilde(p))).collect();
            self.hover_status(
                ui,
                &format!("{} FOLDERS UNREADABLE", s.discovery_errors.len()),
                color::ERROR,
                &names.join("\n"),
            );
        }
        if let Some(e) = &s.config_error {
            self.hover_status(ui, "SETTINGS ERROR", color::ERROR, e);
        }
        if let Some(e) = &self.org_error {
            self.hover_status(ui, "ORGANIZE.TOML ERROR · NOT SAVED", color::ERROR, e);
        } else if let Some(e) = &self.save_error {
            self.hover_status(ui, "NOT SAVED", color::ERROR, e);
        }
    }

    fn hover_status(&self, ui: &mut Ui, text: &str, c: Color32, hover: &str) {
        let sep_w = 16.0;
        let (sr, _) = ui.allocate_exact_size(vec2(sep_w, metric::STATUS_BAR - 2.0), Sense::hover());
        theme::paint_job(ui.painter(), sr, theme::mono_job("·", font_size::MONO_SMALL, color::FAINT), Align::Center, false);
        let job = theme::mono_job(text, font_size::MONO_SMALL, c);
        let w = theme::job_width(ui, job.clone()).ceil();
        let (r, resp) = ui.allocate_exact_size(vec2(w, metric::STATUS_BAR - 2.0), Sense::hover());
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, true, text));
        theme::paint_job(ui.painter(), r, job, Align::Min, false);
        resp.on_hover_text(hover);
    }

    pub fn status_bar_right(&self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        let s = &self.state;
        // Right-to-left layout: first added appears rightmost.
        let hover = if let Some(files) = &self.files {
            format!("{}\n{}", paths::tilde(&paths::config_file()), paths::tilde(&files.organize))
        } else {
            "Demo Mode · In-memory settings".to_owned()
        };
        if widgets::mono_link(ui, "Settings").on_hover_text(hover).clicked() {
            clicks.push(Click::Settings);
        }
        let has_more =
            (s.rate.remaining.is_some() && s.rate.limit.is_some()) || s.watching.is_some() || s.last_check.is_some();
        if has_more {
            widgets::status_sep(ui);
        }
        if let (Some(rem), Some(lim)) = (s.rate.remaining, s.rate.limit) {
            status_item(ui, &format!("GITHUB {rem}/{lim}"), color::SECONDARY);
        }
        match &s.watching {
            Some(Ok(())) => status_item(ui, "WATCHING", color::OK),
            Some(Err(e)) => {
                if s.rate.remaining.is_some() && s.rate.limit.is_some() {
                    widgets::status_sep(ui);
                }
                let job = theme::mono_job("NOT WATCHING", font_size::MONO_SMALL, color::WARN);
                let w = theme::job_width(ui, job.clone()).ceil();
                let (r, resp) = ui.allocate_exact_size(vec2(w, metric::STATUS_BAR - 2.0), Sense::hover());
                theme::paint_job(ui.painter(), r, job, Align::Min, false);
                resp.on_hover_text(e);
            }
            None => {}
        }
        if let Some(t) = s.last_check {
            status_item(ui, &format!("REMOTES CHECKED {}", self.ago(t).to_ascii_uppercase()), color::FAINT);
        }
    }

    // -----------------------------------------------------------------------
    // Clicks

    pub fn apply(&mut self, clicks: Vec<Click>) {
        for click in clicks {
            self.apply_one(click);
        }
    }

    fn apply_one(&mut self, click: Click) {
        match click {
            Click::Select(id) => {
                if self.view.selected.as_ref() != Some(&id) {
                    self.tag_input.clear();
                    self.tag_note = None;
                    self.view.selected_section = None;
                }
                self.view.selected = Some(id);
                self.reveal = true;
            }
            Click::SelectRow(id, section) => {
                self.apply_one(Click::Select(id));
                self.view.selected_section = Some(section);
            }
            Click::Deselect => {
                self.view.selected = None;
                self.view.selected_section = None;
            }
            Click::Open(id) => {
                if !self.demo
                    && let Some(ide) = self.state.repo(&id).and_then(|r| r.ide)
                {
                    let _ = actions::open_in_ide(ide, &id);
                }
            }
            Click::Finder(id) => {
                if !self.demo {
                    let _ = actions::open_in_finder(&id);
                }
            }
            Click::Terminal(id) => {
                if !self.demo {
                    let _ = actions::open_in_terminal(&id);
                }
            }
            Click::Web(url) => {
                if !self.demo {
                    let _ = actions::open_url(&url);
                }
            }
            Click::Settings => {
                if !self.demo {
                    let _ = actions::open_in_finder(&paths::support_dir());
                }
            }
            Click::Nav(nav) if self.manager.open => match nav {
                Nav::Folder(names) => {
                    if let Some(at) = self.org.find(&names) {
                        self.apply_one(Click::ManageTab(Tab::Folders));
                        self.apply_one(Click::ManageFolder(at));
                    }
                }
                Nav::Tag(tag) if !tags::is_automatic(&tag) => {
                    self.apply_one(Click::ManageTab(Tab::Tags));
                    self.apply_one(Click::ManageTag(tag));
                }
                nav => {
                    self.manager.open = false;
                    self.apply_one(Click::Nav(nav));
                }
            },
            Click::Nav(nav) => {
                if nav != self.view.nav {
                    self.view.nav = nav;
                    self.apply_one(Click::Deselect);
                    self.query_edit = None;
                    self.query_open = false;
                    self.list_offset = 0.0;
                }
            }
            Click::Sort(s) => {
                if self.view.sort == s {
                    self.view.desc = !self.view.desc;
                } else {
                    self.view.sort = s;
                    self.view.desc = s.descending_first();
                }
                self.reveal = true;
            }
            Click::Group(g) => {
                self.view.grouping = g;
                self.reveal = true;
            }
            Click::Density(d) => {
                self.view.density = d;
                self.reveal = true;
            }
            Click::Filter(text) => {
                match query::parse(&text) {
                    Ok(q) => {
                        self.filter_query = q;
                        self.filter_error = None;
                    }
                    Err(e) => self.filter_error = Some(e.message),
                }
                self.view.filter = text;
            }
            Click::Rescan => self.engine.send(Cmd::Rescan),
            Click::RemoveRepo(id) => {
                if self.state.repo(&id).is_some_and(|repo| repo.error().is_some()) {
                    self.engine.send(Cmd::RemoveRepo(id));
                }
            }
            Click::Remotes => self.engine.send(Cmd::CheckRemotes(None)),
            Click::Fold(key) => {
                if !self.view.folded.remove(&key) {
                    self.view.folded.insert(key);
                }
            }
            Click::NewFolder { parent, smart } => {
                if !parent.is_empty() && self.org.folder(&parent).is_none() {
                    return;
                }
                let query = if smart { self.view.filter.trim().to_owned() } else { String::new() };
                self.new_folder = Some(FolderDraft {
                    parent: self.org.names(&parent),
                    name: String::new(),
                    query,
                    smart,
                    pin: None,
                    focus_name: true,
                    error: None,
                });
            }
            Click::NewFolderWith(id) => {
                let Some(keys) = self.keys_of(&id) else { return };
                self.new_folder = Some(FolderDraft {
                    parent: Vec::new(),
                    name: String::new(),
                    query: String::new(),
                    smart: false,
                    pin: Some(keys),
                    focus_name: true,
                    error: None,
                });
            }
            Click::CancelNewFolder => self.new_folder = None,
            Click::CreateFolder => {
                let Some(draft) = &self.new_folder else { return };
                let parent = if draft.parent.is_empty() {
                    Vec::new()
                } else if let Some(at) = self.org.find(&draft.parent) {
                    at
                } else {
                    self.new_folder.as_mut().unwrap().error = Some("Parent folder unavailable".into());
                    return;
                };
                let draft = self.new_folder.take().unwrap();
                let clear_filter = draft.smart && !draft.query.is_empty();
                let folder = Folder { query: draft.query, ..Folder::named(draft.name.trim()) };
                let mut made = None;
                self.change(false, |org, _| {
                    made = org.add_folder(&parent, folder);
                    if let (Some(at), Some(keys)) = (&made, &draft.pin) {
                        org.pin(at, keys);
                    }
                    made.is_some()
                });
                if let Some(at) = made {
                    if clear_filter {
                        self.apply_one(Click::Filter(String::new()));
                    }
                    self.unfold_to(&at);
                    if self.manager.open {
                        self.apply_one(Click::ManageFolder(at));
                    } else {
                        self.apply_one(Click::Nav(Nav::Folder(self.org.names(&at))));
                    }
                }
            }
            Click::StartRename(at) => {
                if let Some(f) = self.org.folder(&at) {
                    self.renaming = Some(Renaming::Folder(at, f.name.clone()));
                    self.focus_rename = true;
                }
            }
            Click::RenameFolder(at, name) => {
                self.renaming = None;
                self.manager.renaming = None;
                let before = self.org.names(&at);
                let mut renamed = false;
                self.change(false, |org, _| {
                    renamed = org.rename_folder(&at, &name);
                    renamed
                });
                if renamed {
                    let after = self.org.names(&at);
                    self.follow_rename(&before, &after);
                }
            }
            Click::SetQuery { at, text, typing } => {
                self.change(typing, |org, _| match org.folder_mut(&at) {
                    Some(f) if f.query != text.trim() => {
                        f.query = text.trim().to_owned();
                        true
                    }
                    _ => false,
                });
                if !typing {
                    if text.trim().is_empty() {
                        self.query_open = false;
                    }
                    if self.save_at.is_some() {
                        self.save_org();
                    }
                }
            }
            Click::OpenQuery => {
                self.query_open = true;
                self.focus_query = true;
            }
            Click::DeleteFolder(at) => {
                let busy = self.org.folder(&at).is_some_and(|f| !f.folders.is_empty() || !f.repos.is_empty());
                if busy {
                    self.confirm = Some(Confirm::DeleteFolder(at));
                } else {
                    self.apply_one(Click::DeleteFolderNow(at));
                }
            }
            Click::DeleteFolderNow(at) => {
                self.confirm = None;
                self.change(false, |org, _| org.remove_folder(&at).is_some());
            }
            Click::CancelConfirm => self.confirm = None,
            Click::MoveFolder(from, to) => {
                let before = self.org.names(&from);
                let mut moved = None;
                self.change(false, |org, _| {
                    moved = org.move_folder(&from, &to);
                    moved.is_some()
                });
                if let Some(at) = moved {
                    self.unfold_to(&at);
                    let after = self.org.names(&at);
                    self.follow_rename(&before, &after);
                }
            }
            Click::Pin(at, id) => {
                let Some(keys) = self.keys_of(&id) else { return };
                self.change(false, |org, _| org.pin(&at, &keys));
            }
            Click::TakeOut(at, id) => {
                let (Some(keys), Some(i)) = (self.keys_of(&id), self.state.position(&id)) else { return };
                self.change(false, |org, index| {
                    let mut changed = org.unpin(&at, &keys);
                    let still = org.folder(&at).is_some_and(|f| index.members(f).get(i).copied().unwrap_or(false));
                    if still {
                        changed |= org.exclude(&at, &keys);
                    }
                    changed
                });
                if self.view.selected.as_ref() == Some(&id) && self.nav_folder().as_ref() == Some(&at) {
                    self.apply_one(Click::Deselect);
                }
            }
            Click::Unlist { at, key, excluded } => {
                self.change(false, |org, _| {
                    let Some(f) = org.folder_mut(&at) else { return false };
                    let list = if excluded { &mut f.exclude } else { &mut f.repos };
                    let before = list.len();
                    list.retain(|k| *k != key);
                    list.len() != before
                });
            }
            Click::AddTag(id, text) => {
                let tag = tag_slug(&text);
                if tag.is_empty() {
                    return;
                }
                if tags::is_automatic(&tag) {
                    self.tag_note = Some(format!("Automatic tag \"{tag}\" cannot be added manually."));
                    return;
                }
                let Some(keys) = self.keys_of(&id) else { return };
                self.change(false, |org, _| org.add_tag(&keys, &tag));
                self.tag_input.clear();
                self.tag_note = None;
            }
            Click::RemoveTag(id, tag) => {
                let Some(keys) = self.keys_of(&id) else { return };
                self.change(false, |org, _| {
                    let had = org.tags_of(&keys).contains(&tag);
                    org.remove_tag(&keys, &tag);
                    had
                });
            }
            Click::StartTagRename(tag) => {
                self.renaming = Some(Renaming::Tag(tag.clone(), tag));
                self.focus_rename = true;
            }
            Click::RenameTag(from, to) => {
                self.renaming = None;
                self.manager.renaming = None;
                let to = tag_slug(&to);
                if to.is_empty() || to == from || tags::is_automatic(&to) {
                    return;
                }
                if self.org.all_tags().contains(&to) {
                    self.confirm = Some(Confirm::MergeTag(from, to));
                } else {
                    self.apply_one(Click::MergeTagNow(from, to));
                }
            }
            Click::MergeTagNow(from, to) => {
                self.confirm = None;
                self.change(false, |org, _| {
                    let before = org.clone();
                    org.rename_tag(&from, &to);
                    *org != before
                });
                if self.view.nav == Nav::Tag(from.clone()) {
                    self.view.nav = Nav::Tag(to.clone());
                }
                if self.manager.tag.as_deref() == Some(from.as_str()) {
                    self.manager.tag = Some(to);
                }
            }
            Click::AskDeleteTag(tag) => {
                let carried = self.index.manual.iter().any(|m| m.contains(&tag));
                if carried {
                    self.confirm = Some(Confirm::DeleteTag(tag));
                } else {
                    self.apply_one(Click::DeleteTag(tag));
                }
            }
            Click::DeleteTag(tag) => {
                self.confirm = None;
                self.change(false, |org, _| {
                    org.delete_tag(&tag);
                    true
                });
                if self.view.nav == Nav::Tag(tag.clone()) {
                    self.view.nav = Nav::All;
                }
                if self.manager.tag.as_deref() == Some(tag.as_str()) {
                    self.manager.tag = None;
                }
            }
            Click::CancelRename => self.renaming = None,
            Click::EditTags(id) => {
                self.apply_one(Click::Select(id));
                self.focus_tag_input = true;
            }
            Click::Manage(open) => {
                self.manager.open = open;
                self.manager.reset_editing();
                self.renaming = None;
                if open && self.manager.folder.is_none()
                    && let Nav::Folder(names) = &self.view.nav
                {
                    self.manager.folder = Some(names.clone());
                }
            }
            Click::ManageTab(tab) => {
                if tab != self.manager.tab {
                    self.manager.tab = tab;
                    self.manager.reset_editing();
                }
            }
            Click::ManageFolder(at) => {
                let names = self.org.names(&at);
                if self.manager.folder.as_ref() != Some(&names) {
                    self.manager.reset_editing();
                }
                self.manager.folder = Some(names);
            }
            Click::ManageTag(tag) => {
                if self.manager.tag.as_ref() != Some(&tag) {
                    self.manager.reset_editing();
                }
                self.manager.tag = Some(tag);
            }
            Click::StartManageRename => {
                let name = match self.manager.tab {
                    Tab::Folders => self.manager_folder().and_then(|at| self.org.folder(&at)).map(|f| f.name.clone()),
                    Tab::Tags => self.manager.tag.clone(),
                };
                self.manager.renaming = name;
                self.manager.focus_name = true;
            }
            Click::CancelManageRename => self.manager.renaming = None,
            Click::PlaceFolder { from, parent, index } => {
                let before = self.org.names(&from);
                let mut placed = None;
                self.change(false, |org, _| {
                    let old = org.clone();
                    placed = org.place_folder(&from, &parent, index);
                    *org != old
                });
                if let Some(at) = placed {
                    self.unfold_to(&at);
                    let after = self.org.names(&at);
                    self.follow_rename(&before, &after);
                }
            }
            Click::ShiftFolder(at, delta) => {
                let before = self.org.names(&at);
                let mut placed = None;
                self.change(false, |org, _| {
                    let old = org.clone();
                    placed = org.shift_folder(&at, delta);
                    *org != old
                });
                if let Some(at) = placed {
                    let after = self.org.names(&at);
                    self.follow_rename(&before, &after);
                }
            }
            Click::NewTag => {
                let mut made = None;
                self.change(false, |org, _| {
                    made = (1..)
                        .map(|n| if n == 1 { "new-tag".to_owned() } else { format!("new-tag-{n}") })
                        .find_map(|name| org.create_tag(&name));
                    made.is_some()
                });
                if let Some(tag) = made {
                    self.apply_one(Click::ManageTab(Tab::Tags));
                    self.apply_one(Click::ManageTag(tag));
                    self.apply_one(Click::StartManageRename);
                }
            }
            Click::AddRepos(open) => {
                self.manager.adding = open;
                self.manager.search.clear();
                self.manager.ticked.clear();
            }
            Click::Tick(id) => {
                if !self.manager.ticked.remove(&id) {
                    self.manager.ticked.insert(id);
                }
            }
            Click::PinTicked(at) => {
                let keys: Vec<RepoKeys> = self.manager.ticked.iter().filter_map(|id| self.keys_of(id)).collect();
                self.change(false, |org, _| {
                    let mut changed = false;
                    for k in &keys {
                        changed |= org.pin(&at, k);
                    }
                    changed
                });
                self.apply_one(Click::AddRepos(false));
            }
            Click::TagRepos { tag, ids, on } => {
                let keys: Vec<RepoKeys> = ids.iter().filter_map(|id| self.keys_of(id)).collect();
                self.change(false, |org, _| {
                    let before = org.clone();
                    for k in &keys {
                        if on {
                            org.add_tag(k, &tag);
                        } else {
                            org.remove_tag(k, &tag);
                        }
                    }
                    *org != before
                });
            }
            Click::FocusPane(pane) => {
                self.focused_pane = pane;
            }
        }
        if let Some(due) = self.save_at
            && due <= Instant::now()
        {
            self.save_org();
        }
    }

    fn follow_rename(&mut self, before: &[String], after: &[String]) {
        if let Nav::Folder(names) = &self.view.nav
            && names.starts_with(before)
        {
            let mut new = after.to_vec();
            new.extend_from_slice(&names[before.len()..]);
            self.view.nav = Nav::Folder(new);
            self.query_edit = None;
        }
        if let Some(names) = &self.manager.folder
            && names.starts_with(before)
        {
            let mut new = after.to_vec();
            new.extend_from_slice(&names[before.len()..]);
            self.manager.folder = Some(new);
            self.manager.query = None;
        }
        let old = fold_key(before);
        let moved: Vec<String> = self.view.folded.iter().filter(|k| k.starts_with(&old)).cloned().collect();
        for k in moved {
            self.view.folded.remove(&k);
            self.view.folded.insert(format!("{}{}", fold_key(after), &k[old.len()..]));
        }
    }

    fn unfold_to(&mut self, at: &[usize]) {
        for n in 1..at.len() {
            let names = self.org.names(&at[..n]);
            self.view.folded.remove(&fold_key(&names));
        }
        self.view.folded.remove("folders");
    }

    // -----------------------------------------------------------------------
    // Keyboard shortcuts

    pub fn keyboard(&mut self, ctx: &egui::Context, clicks: &mut Vec<Click>) {
        if self.new_folder.is_some() {
            return;
        }
        let shortcut = |m: Modifiers, k: K| ctx.input_mut(|i| i.consume_shortcut(&KeyboardShortcut::new(m, k)));
        if shortcut(Modifiers::COMMAND | Modifiers::SHIFT, K::R) {
            clicks.push(Click::Remotes);
        }
        if shortcut(Modifiers::COMMAND, K::R) {
            clicks.push(Click::Rescan);
        }
        if shortcut(Modifiers::COMMAND, K::F) {
            self.focus_filter = true;
        }
        if shortcut(Modifiers::COMMAND | Modifiers::SHIFT, K::M) {
            clicks.push(Click::Manage(!self.manager.open));
        }
        if shortcut(Modifiers::COMMAND | Modifiers::SHIFT, K::N) {
            clicks.push(Click::NewFolder { parent: Vec::new(), smart: true });
        }
        if shortcut(Modifiers::COMMAND, K::N) {
            clicks.push(Click::NewFolder { parent: Vec::new(), smart: false });
        }
        for (k, g) in [
            (K::Num1, Grouping::None),
            (K::Num2, Grouping::Folder),
            (K::Num3, Grouping::Tag),
            (K::Num4, Grouping::App),
        ] {
            if shortcut(Modifiers::COMMAND, k) {
                clicks.push(Click::Group(g));
            }
        }
        if let Some(id) = self.view.selected.clone() {
            if shortcut(Modifiers::COMMAND, K::O) {
                clicks.push(Click::Open(id.clone()));
            }
            if shortcut(Modifiers::COMMAND | Modifiers::SHIFT, K::F) {
                clicks.push(Click::Finder(id.clone()));
            }
            if shortcut(Modifiers::COMMAND | Modifiers::SHIFT, K::T) {
                clicks.push(Click::Terminal(id.clone()));
            }
            if shortcut(Modifiers::COMMAND, K::T) {
                clicks.push(Click::EditTags(id));
            }
        }
        if ctx.memory(|m| m.focused().is_some())
            || self.confirm.is_some()
            || self.renaming.is_some()
            || self.manager.renaming.is_some()
        {
            return;
        }
        if self.manager.open {
            if shortcut(Modifiers::NONE, K::Escape) {
                clicks.push(if self.manager.adding { Click::AddRepos(false) } else { Click::Manage(false) });
            }
            return;
        }
        if shortcut(Modifiers::NONE, K::Escape) {
            if self.view.selected.is_some() {
                clicks.push(Click::Deselect);
            } else if !self.view.filter.is_empty() {
                clicks.push(Click::Filter(String::new()));
            }
        }
        let step = if shortcut(Modifiers::NONE, K::ArrowDown) {
            1
        } else if shortcut(Modifiers::NONE, K::ArrowUp) {
            -1
        } else {
            0
        };
        if step != 0 {
            let sections = self.sections();
            let section = self.row_section(&sections);
            let repos = &self.state.repos;
            let order: Vec<_> =
                sections.iter().flat_map(|s| s.rows.iter().map(move |&i| (repos[i].id(), &s.key))).collect();
            let at = order
                .iter()
                .position(|(id, key)| Some(*id) == self.view.selected.as_deref() && Some(*key) == section.as_ref());
            let next = match at {
                Some(i) => (i as isize + step).clamp(0, order.len() as isize - 1) as usize,
                None => 0,
            };
            if let Some((id, key)) = order.get(next) {
                clicks.push(Click::SelectRow(id.to_path_buf(), (*key).clone()));
            }
        }
        if shortcut(Modifiers::NONE, K::Enter)
            && let Some(id) = self.view.selected.clone()
        {
            clicks.push(Click::Open(id));
        }
    }

    // -----------------------------------------------------------------------
    // Overlays (drag preview, New Folder modal, Confirmation modal)

    pub fn overlays(&mut self, ctx: &egui::Context, clicks: &mut Vec<Click>) {
        self.drag_preview(ctx);
        self.confirm_dialog(ctx, clicks);
        self.new_folder_dialog(ctx, clicks);
    }

    fn drag_preview(&self, ctx: &egui::Context) {
        let text = if let Some(d) = egui::DragAndDrop::payload::<RepoDrag>(ctx) {
            self.state.repo(&d.0).map(|r| r.name.clone())
        } else {
            egui::DragAndDrop::payload::<FolderDrag>(ctx).and_then(|d| self.org.folder(&d.0).map(|f| f.name.clone()))
        };
        let (Some(text), Some(pos)) = (text, ctx.pointer_latest_pos()) else { return };
        ctx.set_cursor_icon(CursorIcon::Grabbing);
        let painter = ctx.layer_painter(egui::LayerId::new(egui::Order::Tooltip, egui::Id::unique("drag-preview")));
        let galley = painter.layout_job(theme::sans_job(&text, 12.5, color::PARCHMENT, true));
        let rect = Rect::from_min_size(pos + vec2(14.0, 8.0), galley.size() + vec2(20.0, 10.0));
        painter.rect_filled(rect, 0.0, color::PLATE);
        draw::box_outline(&painter, rect, color::BRONZE);
        painter.galley(rect.min + vec2(10.0, 5.0), galley, Color32::PLACEHOLDER);
    }

    fn new_folder_dialog(&mut self, ctx: &egui::Context, clicks: &mut Vec<Click>) {
        let Some(draft) = &mut self.new_folder else { return };
        let modal = egui::Modal::new(egui::Id::unique("new-folder")).frame(widgets::modal_frame()).show(ctx, |ui| {
            ui.set_width(340.0);
            ui.label(
                egui::RichText::new(if draft.smart { "NEW SMART FOLDER" } else { "NEW FOLDER" })
                    .font(egui::FontId::new(font_size::LABEL, theme::mono_family()))
                    .extra_letter_spacing(metric::TRACKING)
                    .color(color::PARCHMENT),
            );
            ui.add_space(10.0);
            let (rect, _) = ui.allocate_exact_size(vec2(340.0, 26.0), Sense::hover());
            let field = widgets::text_field(
                ui,
                rect,
                ui.scope_id().with("new-folder-name"),
                &mut draft.name,
                "New folder",
                false,
                false,
            );
            if draft.focus_name {
                field.request_focus();
                draft.focus_name = false;
            }
            if let Some(error) = &draft.error {
                ui.add_space(6.0);
                ui.label(egui::RichText::new(error).size(font_size::MONO_SMALL).color(color::ERROR));
            }
            ui.add_space(14.0);
            ui.horizontal(|ui| {
                let create = astrolabe_kit::primary_button(ui, "Create", None, true).clicked();
                let enter = field.lost_focus() && ui.input(|i| i.key_pressed(K::Enter));
                if create || enter {
                    field.surrender_focus();
                    clicks.push(Click::CreateFolder);
                }
                if widgets::action_button(ui, "Cancel", true, 84.0).clicked() {
                    field.surrender_focus();
                    clicks.push(Click::CancelNewFolder);
                }
            });
        });
        if modal.should_close() {
            clicks.push(Click::CancelNewFolder);
        }
    }

    fn confirm_dialog(&self, ctx: &egui::Context, clicks: &mut Vec<Click>) {
        let Some(confirm) = &self.confirm else { return };
        let carriers = |tag: &str| self.index.manual.iter().filter(|m| m.iter().any(|t| t == tag)).count();
        let (title, text, action, go) = match confirm {
            Confirm::DeleteFolder(at) => {
                let Some(folder) = self.org.folder(at) else { return };
                let mut parts = Vec::new();
                if !folder.folders.is_empty() {
                    parts.push(widgets::plural(folder.folders.len(), "subfolder", "subfolders"));
                }
                if !folder.repos.is_empty() {
                    parts.push(widgets::plural(folder.repos.len(), "pinned repository", "pinned repositories"));
                }
                (
                    format!("Delete Folder \"{}\"", folder.name),
                    format!("Contains {}. Files on disk remain unchanged.", parts.join(" and ")),
                    "Delete",
                    Click::DeleteFolderNow(at.clone()),
                )
            }
            Confirm::DeleteTag(tag) => (
                format!("Delete Tag \"{tag}\""),
                format!("Removes tag from {}. Files on disk remain unchanged.", widgets::plural(carriers(tag), "repository", "repositories")),
                "Delete",
                Click::DeleteTag(tag.clone()),
            ),
            Confirm::MergeTag(from, to) => (
                format!("Merge \"{from}\" Into \"{to}\""),
                format!(
                    "Moves {} from \"{from}\" to \"{to}\".",
                    widgets::plural(carriers(from), "repository", "repositories")
                ),
                "Merge",
                Click::MergeTagNow(from.clone(), to.clone()),
            ),
        };
        let mut go = Some(go);
        let modal = egui::Modal::new(egui::Id::unique("confirm")).frame(widgets::modal_frame()).show(ctx, |ui| {
            ui.set_width(380.0);
            ui.label(egui::RichText::new(&title).size(font_size::TITLE).color(color::PARCHMENT));
            ui.add_space(6.0);
            ui.label(egui::RichText::new(&text).size(font_size::BODY).color(color::SECONDARY));
            ui.add_space(14.0);
            ui.horizontal(|ui| {
                if astrolabe_kit::primary_button(ui, action, None, true).clicked()
                    && let Some(go) = go.take()
                {
                    clicks.push(go);
                }
                if widgets::action_button(ui, "Cancel", true, 84.0).clicked() {
                    clicks.push(Click::CancelConfirm);
                }
            });
        });
        if modal.should_close() {
            clicks.push(Click::CancelConfirm);
        }
    }
}

pub(crate) fn fold_key(names: &[String]) -> String {
    format!("folder/{}", names.join("/"))
}

pub(crate) fn opt_u32(v: Option<u32>) -> String {
    v.map_or("–".to_owned(), |n| n.to_string())
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

fn load_ide_icons(ctx: egui::Context) -> Receiver<(Ide, egui::ColorImage)> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let dir = paths::cache_dir().join("icons");
        for ide in Ide::ALL {
            let Some(app) = icons::ide_app(ide) else { continue };
            let Some(image) = icons::icon_png(ide.name(), &app, &dir).and_then(|p| icons::load_file(&p)) else {
                continue;
            };
            if tx.send((ide, image)).is_err() {
                return;
            }
            ctx.request_repaint();
        }
    });
    rx
}
