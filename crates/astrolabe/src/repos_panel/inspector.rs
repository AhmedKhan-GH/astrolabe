//! Right inspector pane: Totals view (when nothing is selected) and Repository
//! Detail view (when a repository is selected).

use astrolabe_engines::repos::{
    Flag, Folder, Head, Ide, Nav, Relation, Repo, Stats, SubmoduleState, Tip, aggregate, paths, query, remote, tags,
    view,
};
use astrolabe_kit::{
    StatusTone, color, draw, font_size, key_button, metric, paint_status_chip, status_chip_size, theme,
};
use egui::{Align, Color32, CursorIcon, Key as K, Rect, ScrollArea, Sense, Ui, Vec2, pos2, vec2};

use super::{Click, ReposPanel, opt_u32};
use crate::widgets;

const HEADER_H: f32 = 44.0;
const ICON: f32 = 34.0;
const GAP: f32 = 12.0;
const FIELD_H: f32 = 22.0;
const FIELD_LABEL_W: f32 = 112.0;
const SECTION_H: f32 = 24.0;
const SECTION_GAP: f32 = 10.0;
const CHIP_ROW: f32 = 24.0;
const STALEST: usize = 8;

fn count_color(n: u32, c: Color32) -> Color32 {
    if n == 0 { color::FAINT } else { c }
}

impl ReposPanel {
    pub(super) fn inspector(&mut self, ui: &mut Ui, clicks: &mut Vec<Click>) {
        ScrollArea::vertical().id_salt("repos_inspector_scroll").auto_shrink([false, false]).show(ui, |ui| {
            egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 12, bottom: 16 }).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                let width = ui.available_width().max(1.0);
                match self.selected().cloned() {
                    Some(repo) => self.repo_view(ui, width, &repo, clicks),
                    None => self.totals_view(ui, width, clicks),
                }
            });
        });
    }

    // -----------------------------------------------------------------------
    // Repository Detail View

    fn repo_view(&mut self, ui: &mut Ui, width: f32, repo: &Repo, clicks: &mut Vec<Click>) {
        let Some(i) = self.state.position(repo.id()).filter(|i| *i < self.index.len()) else { return };

        let (rect, _) = ui.allocate_exact_size(vec2(width, HEADER_H), Sense::hover());
        let tile_rect = Rect::from_center_size(pos2(rect.left() + ICON * 0.5, rect.center().y), Vec2::splat(ICON));
        self.paint_repo_tile(ui, tile_rect, repo, false);
        let classes: Vec<String> =
            [repo.ide.map(|i| i.name().to_owned()), Some(repo.category.clone())].into_iter().flatten().collect();
        header_text(ui, rect, tile_rect.right() + GAP, &repo.name, &classes.join(" · "));

        // Status chips.
        ui.add_space(8.0);
        let states: Vec<(String, StatusTone)> =
            view::flags(repo).into_iter().map(|f| (f.word().to_owned(), widgets::flag_tone(f))).collect();
        chip_rows(ui, width, &states, "repo_states", false);

        // Actions.
        ui.add_space(8.0);
        ui.allocate_ui_with_layout(vec2(width, metric::KEY_BUTTON_H + 2.0), egui::Layout::left_to_right(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            if let Some(ide) = repo.ide
                && key_button(ui, "⌘O", ide.name(), true, None).clicked()
            {
                clicks.push(Click::Open(repo.id().to_owned()));
            }
            if key_button(ui, "⇧⌘F", "Finder", true, None).clicked() {
                clicks.push(Click::Finder(repo.id().to_owned()));
            }
            if key_button(ui, "⇧⌘T", "Terminal", true, None).clicked() {
                clicks.push(Click::Terminal(repo.id().to_owned()));
            }
            if let Some(url) = repo.stats().and_then(|s| remote::web_url(s, repo.gh.as_ref()))
                && key_button(ui, "", "GitHub", true, None).on_hover_text(&url).clicked()
            {
                clicks.push(Click::Web(url));
            }
        });
        ui.add_space(4.0);

        self.tag_section(ui, width, repo, i, clicks);
        self.folder_section(ui, width, repo, i, clicks);
        let mut f = Fields { ui, width };
        self.repo_fields(&mut f, repo, clicks);
    }

    fn tag_section(&mut self, ui: &mut Ui, width: f32, repo: &Repo, i: usize, clicks: &mut Vec<Click>) {
        Fields { ui, width }.section("Tags");
        ui.add_space(8.0);
        let id = repo.id().to_owned();
        let manual = self.index.manual[i].clone();
        if !manual.is_empty() {
            let items: Vec<(String, StatusTone)> = manual.iter().map(|t| (format!("{t}  ×"), StatusTone::Neutral)).collect();
            if let Some((k, on_x)) = chip_rows(ui, width, &items, "manual_tags", true) {
                if on_x {
                    clicks.push(Click::RemoveTag(id.clone(), manual[k].clone()));
                } else {
                    clicks.push(Click::Nav(Nav::Tag(manual[k].clone())));
                }
            }
            ui.add_space(6.0);
        }

        let input_id = ui.scope_id().with("tag-input");
        let (rect, _) = ui.allocate_exact_size(vec2(width.min(240.0), 24.0), Sense::hover());
        let resp = widgets::text_field(ui, rect, input_id, &mut self.tag_input, "Add tag", true, false);
        if self.focus_tag_input {
            self.focus_tag_input = false;
            resp.request_focus();
        }
        if resp.lost_focus() && ui.input(|i| i.key_pressed(K::Enter)) {
            clicks.push(Click::AddTag(id.clone(), self.tag_input.clone()));
            resp.request_focus();
        }

        let typed = self.tag_input.trim().to_lowercase();
        if resp.has_focus() || !typed.is_empty() {
            let mut known: Vec<(String, usize)> = self
                .index
                .manual_counts
                .iter()
                .filter(|(t, _)| !manual.contains(t) && (typed.is_empty() || t.contains(&typed)))
                .cloned()
                .collect();
            known.sort_by(|a, b| b.0.starts_with(&typed).cmp(&a.0.starts_with(&typed)).then(b.1.cmp(&a.1)));
            known.truncate(8);
            if !known.is_empty() {
                ui.add_space(6.0);
                let items: Vec<(String, StatusTone)> = known.iter().map(|(t, _)| (t.clone(), StatusTone::Neutral)).collect();
                if let Some((k, _)) = chip_rows(ui, width, &items, "suggested_tags", false) {
                    clicks.push(Click::AddTag(id.clone(), known[k].0.clone()));
                }
            }
        }
        if let Some(note) = &self.tag_note {
            let mut f = Fields { ui, width };
            f.note(note, color::WARN);
        }

        let auto = self.index.auto[i].join("  ");
        if !auto.is_empty() {
            ui.add_space(6.0);
            let mut f = Fields { ui, width };
            f.wrapped_value("Automatic", &auto, color::SECONDARY);
        }
    }

    fn folder_section(&self, ui: &mut Ui, width: f32, repo: &Repo, i: usize, clicks: &mut Vec<Click>) {
        let mut f = Fields { ui, width };
        f.section("Folders");
        let keys = &self.index.keys[i];
        let mut any = false;
        for (at, folder) in self.org.walk() {
            let own = Folder { folders: Vec::new(), ..folder.clone() };
            if !self.index.members(&own).get(i).copied().unwrap_or(false) {
                continue;
            }
            any = true;
            let pinned = folder.repos.iter().any(|k| keys.0.contains(k));
            let names = self.org.names(&at);
            match f.folder_row(&names.join(" / "), if pinned { "Pinned" } else { "Query" }) {
                RowClick::Action => clicks.push(Click::TakeOut(at.clone(), repo.id().to_owned())),
                RowClick::Row => clicks.push(Click::Nav(Nav::Folder(names))),
                RowClick::None => {}
            }
        }
        if !any {
            f.text("In", "No folder", color::FAINT, false);
        }
        ui.add_space(6.0);
        ui.allocate_ui_with_layout(vec2(width, metric::KEY_BUTTON_H + 2.0), egui::Layout::left_to_right(Align::Center), |ui| {
            let button = widgets::menu_button_widget("Add to Folder");
            let (resp, _) =
                egui::containers::menu::MenuButton::from_button(button).ui(ui, |ui| self.folder_menu(ui, i, clicks));
            resp.on_hover_text("Add to folder or drag row onto sidebar folder");
        });
    }

    fn repo_fields(&self, f: &mut Fields<'_>, repo: &Repo, clicks: &mut Vec<Click>) {
        f.section("Folder");
        f.text("Path", &paths::tilde(repo.id()), color::PARCHMENT, true);
        if let Some(e) = repo.error() {
            f.text("Read", "Unreadable", color::ERROR, false);
            f.wrapped(e, color::SECONDARY);
            f.ui.add_space(8.0);
            if widgets::action_button(f.ui, "Remove From Monitor", true, 0.0)
                .on_hover_text("Stop monitoring repository; files on disk remain")
                .clicked()
            {
                clicks.push(Click::RemoveRepo(repo.id().to_owned()));
            }
            return;
        }
        let Some(s) = repo.stats() else { return };

        f.section("Remote");
        let (label, c) = relation_text(&repo.relation);
        f.text("Relation", &label, c, false);
        for r in &s.remotes {
            f.text(&r.name, &r.url, color::PARCHMENT, true);
        }
        if let Some(gh) = &repo.gh {
            let push = match gh.can_push {
                Some(true) => "Push",
                Some(false) => "Read Only",
                None => "Unknown",
            };
            f.text("Access", push, color::SECONDARY, false);
            if gh.archived {
                f.text("Archived", "Yes", color::SECONDARY, false);
            }
            if gh.fork {
                f.text("Fork", "Yes", color::SECONDARY, false);
            }
        }

        f.section("Branch");
        match &s.head {
            Head::Branch(b) => f.text("Branch", b, color::PARCHMENT, true),
            Head::Unborn(b) => f.text("Branch", &format!("{b} · no commits"), color::FAINT, true),
            Head::Detached => f.text("Branch", "Detached HEAD", color::PARCHMENT, false),
        }
        if let Some(sha) = &s.head_sha {
            f.text("Head", &sha[..sha.len().min(12)], color::PARCHMENT, true);
        }
        match &s.upstream {
            Some(u) => {
                f.text("Upstream", u, color::PARCHMENT, true);
                let (ahead, behind) = (s.ahead.unwrap_or(0), s.behind.unwrap_or(0));
                f.text("Ahead", &opt_u32(s.ahead), if ahead > 0 { color::WARN } else { color::PARCHMENT }, true);
                f.text("Behind", &opt_u32(s.behind), if behind > 0 { color::INFO } else { color::PARCHMENT }, true);
            }
            None => f.text("Upstream", "None", color::FAINT, false),
        }
        if repo.relation != Relation::LocalOnly {
            let n = s.unpushed.unwrap_or(0);
            f.text("Unpushed", &opt_u32(s.unpushed), if n > 0 { color::WARN } else { color::PARCHMENT }, true);
        }
        if let Some(check) = &repo.check {
            let (label, c) = match &check.tip {
                Tip::Same => ("Same".to_owned(), color::OK),
                Tip::Moved { remote_sha } => (format!("Moved · {}", &remote_sha[..remote_sha.len().min(7)]), color::INFO),
                Tip::Missing => ("Not on remote".to_owned(), color::ERROR),
                Tip::Failed(e) => (format!("Failed · {e}"), color::SECONDARY),
            };
            f.text("Remote Tip", &label, c, false);
            f.text("Checked", &self.ago(check.at), color::SECONDARY, false);
        } else if s.upstream.is_some() {
            f.text("Remote Tip", "Unchecked", color::FAINT, false);
        }

        f.section("Changes");
        let ch = s.changes;
        let warn = |n: u32| if n > 0 { color::WARN } else { color::PARCHMENT };
        f.text("Staged", &ch.staged.to_string(), warn(ch.staged), true);
        f.text("Unstaged", &ch.unstaged.to_string(), warn(ch.unstaged), true);
        f.text("Untracked", &ch.untracked.to_string(), warn(ch.untracked), true);
        if ch.conflicted > 0 {
            f.text("Conflicted", &ch.conflicted.to_string(), color::ERROR, true);
        }
        if !ch.is_clean()
            && let Some(t) = s.oldest_change
        {
            f.text("Oldest Change", &format!("{} · {}", self.age(t), view::local_time(t)), color::PARCHMENT, true);
        }

        f.section("Commits");
        f.text("Total", &s.commits_total.to_string(), color::PARCHMENT, true);
        f.text("7 Days", &s.commits_7d.to_string(), color::PARCHMENT, true);
        f.text("30 Days", &s.commits_30d.to_string(), color::PARCHMENT, true);
        if let Some(c) = &s.last_commit {
            f.text("Last", &format!("{} · {}", &c.sha[..c.sha.len().min(7)], self.age(c.commit_time)), color::PARCHMENT, true);
            f.text("Commit Date", &view::local_time(c.commit_time), color::PARCHMENT, true);
            f.text("Author Date", &view::local_time(c.author_time), color::PARCHMENT, true);
            f.wrapped(&c.subject, color::SECONDARY);
        }

        if !s.stashes.is_empty() {
            f.section(&format!("Stashes  {}", s.stashes.len()));
            for st in &s.stashes {
                let when = st.time.map(|t| self.age(t)).unwrap_or_default();
                f.text(&format!("stash@{{{}}}", st.index), &format!("{when} · {}", st.subject), color::SECONDARY, false);
            }
        }
        if !s.worktrees.is_empty() {
            f.section(&format!("Worktrees  {}", s.worktrees.len()));
            for w in &s.worktrees {
                let name = w.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let branch = match &w.head {
                    Head::Branch(b) | Head::Unborn(b) => b.clone(),
                    Head::Detached => format!("detached {}", view::short_sha(w.head_sha.as_deref())),
                };
                let (c, value) = match w.changes {
                    None => (color::FAINT, format!("{branch} · missing")),
                    Some(ch) if ch.is_clean() => (color::PARCHMENT, branch),
                    Some(ch) => (color::WARN, format!("{branch} · {}", view::changes_text(ch))),
                };
                f.item(&name, &value, c, &paths::tilde(&w.path));
            }
        }
        if !s.submodules.is_empty() {
            let dirty = s.submodules.iter().filter(|m| m.dirty).count();
            let title = if dirty > 0 {
                format!("Submodules  {}  ·  {dirty} Dirty", s.submodules.len())
            } else {
                format!("Submodules  {}", s.submodules.len())
            };
            f.section(&title);
            for m in &s.submodules {
                let name = m.path.rsplit('/').next().unwrap_or(&m.path).to_owned();
                let (state, c) = match m.state {
                    SubmoduleState::Current => ("Current", color::SECONDARY),
                    SubmoduleState::Moved => ("Moved", color::INFO),
                    SubmoduleState::Uninitialized => ("Not Initialized", color::FAINT),
                    SubmoduleState::Conflict => ("Conflict", color::ERROR),
                };
                let (value, c) = if m.dirty { (format!("{state} · dirty"), color::WARN) } else { (state.to_owned(), c) };
                f.item(&name, &value, c, &m.path);
            }
        }
        let copies = self.state.copies_of(repo.id());
        if !copies.is_empty() {
            f.section(&format!("Copies  {}", copies.len()));
            for other in copies {
                let Some(o) = self.state.repo(&other) else { continue };
                let os = o.stats();
                let branch = os.and_then(|s| s.head.branch().map(str::to_owned)).unwrap_or_else(|| "detached".into());
                let rel = match self.state.copy_counts(repo.id(), &other) {
                    Some(Some((0, 0))) => "Same commit".to_owned(),
                    Some(Some((mine, theirs))) => format!("+{mine} here · +{theirs} there"),
                    Some(None) => "No shared commit".to_owned(),
                    None => String::new(),
                };
                let mut value = if rel.is_empty() { branch } else { format!("{branch} · {rel}") };
                if os.is_some_and(Stats::has_uncommitted) {
                    value.push_str(" · uncommitted");
                }
                if f.link(&o.name, &value, &paths::tilde(&other)) {
                    clicks.push(Click::Select(other.clone()));
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Totals View

    fn totals_view(&mut self, ui: &mut Ui, width: f32, clicks: &mut Vec<Click>) {
        let shown = self.shown();
        let repos: Vec<&Repo> = shown.iter().map(|&i| &self.state.repos[i]).collect();
        let t = aggregate::totals(repos.iter().copied(), self.now());
        let at = self.nav_folder();
        let folder = at.as_deref().and_then(|a| self.org.folder(a)).cloned();

        let title = self.nav_title();
        let (rect, _) = ui.allocate_exact_size(vec2(width, HEADER_H), Sense::hover());
        let tile_rect = Rect::from_center_size(pos2(rect.left() + ICON * 0.5, rect.center().y), Vec2::splat(ICON));
        let glyph = title.chars().next().unwrap_or('R').to_ascii_uppercase().to_string();
        widgets::badge_tile(ui.painter(), tile_rect, &glyph, false);

        let kind = match (&self.view.nav, &folder) {
            (Nav::All, _) => widgets::plural(self.state.config.roots.len(), "Root", "Roots"),
            (Nav::Folder(_), Some(f)) => {
                let mut kind = match (f.is_smart(), f.repos.is_empty()) {
                    (true, true) => "Smart Folder".to_owned(),
                    (true, false) => "Smart Folder · Pinned".to_owned(),
                    (false, _) => "Folder".to_owned(),
                };
                if !f.folders.is_empty() {
                    kind.push_str(&format!(" · {}", widgets::plural(f.folders.len(), "Subfolder", "Subfolders")));
                }
                kind
            }
            (Nav::Folder(_), None) => String::new(),
            (Nav::Tag(t), _) if tags::is_automatic(t) => format!("Automatic Tag · {t}"),
            (Nav::Tag(t), _) => format!("Manual Tag · {t}"),
        };
        let kind = if self.view.filter.trim().is_empty() {
            kind
        } else {
            format!("{kind} · Filter: {}", self.view.filter.trim())
        };
        header_text(ui, rect, tile_rect.right() + GAP, &title, &kind);

        // Attention chips (clicking appends tag to top filter).
        ui.add_space(8.0);
        let mut states: Vec<(String, StatusTone, &str)> = Vec::new();
        let mut push = |n: u32, word: &str, flag: Flag, tag: &'static str| {
            if n > 0 {
                states.push((format!("{n} {word}"), widgets::flag_tone(flag), tag));
            }
        };
        push(t.local_only, "LOCAL ONLY", Flag::LocalOnly, "local-only");
        push(t.uncommitted, "UNCOMMITTED", Flag::Uncommitted, "uncommitted");
        push(t.unpushed, "UNPUSHED", Flag::Unpushed, "unpushed");
        push(t.behind, "BEHIND", Flag::Behind, "behind");
        if states.is_empty() && t.repos > 0 {
            states.push((Flag::InSync.word().to_owned(), StatusTone::Ok, ""));
        }
        let items: Vec<(String, StatusTone)> = states.iter().map(|(w, tone, _)| (w.clone(), *tone)).collect();
        if let Some((k, _)) = chip_rows(ui, width, &items, "totals_chips", false)
            && !states[k].2.is_empty()
        {
            let current = self.view.filter.trim();
            let tag = states[k].2;
            let text = if current.is_empty() { tag.to_owned() } else { format!("({current}) {tag}") };
            clicks.push(Click::Filter(text));
        }

        if let (Some(at), Some(folder)) = (&at, &folder) {
            self.folder_definition(ui, width, at, folder, clicks);
        }

        let stale = shown.iter().filter(|&&i| self.index.has_tag(i, "stale")).count() as u32;
        let mut f = Fields { ui, width };
        f.section("Totals");
        f.text("Repos", &t.repos.to_string(), count_color(t.repos, color::PARCHMENT), true);
        f.text("Local Only", &t.local_only.to_string(), count_color(t.local_only, color::ERROR), true);
        f.text("Private", &t.private.to_string(), count_color(t.private, color::PARCHMENT), true);
        f.text("Public", &t.public.to_string(), count_color(t.public, color::PARCHMENT), true);
        if t.other > 0 {
            f.text("Other Hosts", &t.other.to_string(), color::PARCHMENT, true);
        }
        f.text("Uncommitted", &t.uncommitted.to_string(), count_color(t.uncommitted, color::WARN), true);
        f.text("Unpushed", &t.unpushed.to_string(), count_color(t.unpushed, color::WARN), true);
        f.text("Behind", &t.behind.to_string(), count_color(t.behind, color::INFO), true);
        f.text("Stale", &stale.to_string(), count_color(stale, color::PARCHMENT), true);
        f.text("7 Days", &t.commits_7d.to_string(), count_color(t.commits_7d, color::PARCHMENT), true);
        f.text("30 Days", &t.commits_30d.to_string(), count_color(t.commits_30d, color::PARCHMENT), true);

        let by_app: Vec<(String, usize)> = Ide::ALL
            .into_iter()
            .map(Some)
            .chain([None])
            .map(|ide| (ide.map_or("No App", Ide::name).to_owned(), repos.iter().filter(|r| r.ide == ide).count()))
            .filter(|(_, n)| *n > 0)
            .collect();
        if by_app.len() > 1 {
            f.section("By App");
            for (name, n) in by_app {
                f.text(&name, &n.to_string(), color::PARCHMENT, true);
            }
        }

        let stalest = aggregate::stalest(repos.iter().copied(), STALEST);
        if !stalest.is_empty() {
            f.section("Stalest Uncommitted");
            for (r, since) in stalest {
                if f.aged(&r.name, &self.age(since), &paths::tilde(r.id())) {
                    clicks.push(Click::Select(r.id().to_owned()));
                }
            }
        }
    }

    fn folder_definition(&self, ui: &mut Ui, width: f32, at: &[usize], folder: &Folder, clicks: &mut Vec<Click>) {
        let mut f = Fields { ui, width };
        if folder.is_smart() {
            f.section("Query");
            f.wrapped_value("Matches", &folder.query, color::PARCHMENT);
            if let Some(e) = self.index.errors.get(at) {
                f.text("Error", e, color::ERROR, false);
            } else if let Err(e) = query::parse(&folder.query) {
                f.text("Error", &e.message, color::ERROR, false);
            }
        }
        let name_of = |key: &str| {
            self.index
                .keys
                .iter()
                .position(|k| k.0.iter().any(|x| x == key))
                .map(|i| (self.state.repos[i].name.clone(), self.index.paths[i].clone()))
        };
        if !folder.repos.is_empty() {
            f.section(&format!("Pinned  {}", folder.repos.len()));
            for key in &folder.repos {
                let (name, place) = name_of(key).unwrap_or_else(|| (key.clone(), "Not on Disk".to_owned()));
                if let RowClick::Action = f.folder_row_with(&name, &place, "Remove") {
                    clicks.push(Click::Unlist { at: at.to_vec(), key: key.clone(), excluded: false });
                }
            }
        }
        if !folder.exclude.is_empty() {
            f.section(&format!("Excluded  {}", folder.exclude.len()));
            for key in &folder.exclude {
                let (name, place) = name_of(key).unwrap_or_else(|| (key.clone(), "Not on Disk".to_owned()));
                if let RowClick::Action = f.folder_row_with(&name, &place, "Restore") {
                    clicks.push(Click::Unlist { at: at.to_vec(), key: key.clone(), excluded: true });
                }
            }
        }
    }
}

pub(super) fn header_text(ui: &Ui, rect: Rect, left: f32, name: &str, under: &str) {
    let p = ui.painter();
    let mid = rect.center().y;
    let l1 = Rect::from_min_max(pos2(left, mid - 16.0), pos2(rect.right(), mid));
    let l2 = Rect::from_min_max(pos2(left, mid + 1.0), pos2(rect.right(), mid + 16.0));
    theme::paint_job(p, l1, theme::sans_job(name, font_size::TITLE, color::PARCHMENT, true), Align::Min, true);
    if !under.is_empty() {
        theme::paint_job(p, l2, theme::mono_job(under, font_size::MONO_SMALL, color::SECONDARY), Align::Min, true);
    }
}

fn chip_rows(
    ui: &mut Ui,
    width: f32,
    items: &[(String, StatusTone)],
    salt: &str,
    removable: bool,
) -> Option<(usize, bool)> {
    if items.is_empty() {
        return None;
    }
    let p = ui.painter().clone();
    let sizes: Vec<Vec2> = items.iter().map(|(t, _)| status_chip_size(&p, t)).collect();
    let mut places = Vec::new();
    let (mut x, mut row) = (0.0, 0);
    for s in &sizes {
        if x > 0.0 && x + s.x > width {
            x = 0.0;
            row += 1;
        }
        places.push((x, row));
        x += s.x + 6.0;
    }
    let (rect, _) = ui.allocate_exact_size(vec2(width, CHIP_ROW * (row + 1) as f32), Sense::hover());
    let mut clicked = None;
    for (k, ((text, tone), (x, row))) in items.iter().zip(places).enumerate() {
        let y = rect.top() + CHIP_ROW * row as f32 + CHIP_ROW * 0.5;
        let chip = paint_status_chip(&p, rect.left() + x, y, text, *tone);
        let resp = ui.interact(chip, ui.scope_id().with((salt, k)), Sense::click());
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, text.trim_end_matches(" ×").trim()));
        if resp.hovered() {
            draw::box_outline(&p, chip, tone.color());
        }
        let resp = resp.on_hover_cursor(CursorIcon::PointingHand);
        if resp.clicked() {
            let on_x = removable && resp.interact_pointer_pos().is_some_and(|pos| pos.x > chip.right() - 16.0);
            clicked = Some((k, on_x));
        }
    }
    clicked
}

fn relation_text(r: &Relation) -> (String, Color32) {
    match r {
        Relation::LocalOnly => ("Local Only".to_owned(), color::ERROR),
        Relation::Private => ("Private".to_owned(), color::PARCHMENT),
        Relation::Public => ("Public".to_owned(), color::PARCHMENT),
        Relation::GitHub => ("GitHub".to_owned(), color::SECONDARY),
        Relation::OtherHost(h) => (h.clone(), color::PARCHMENT),
    }
}

pub(super) enum RowClick {
    None,
    Row,
    Action,
}

pub(super) struct Fields<'a> {
    pub(super) ui: &'a mut Ui,
    pub(super) width: f32,
}

impl Fields<'_> {
    fn split(&self, rect: Rect) -> (Rect, Rect) {
        let label = Rect::from_min_size(rect.min, vec2(FIELD_LABEL_W, rect.height()));
        let value = Rect::from_min_max(pos2(rect.left() + FIELD_LABEL_W, rect.top()), rect.max);
        (label, value)
    }

    pub(super) fn section(&mut self, title: &str) {
        self.ui.add_space(SECTION_GAP);
        let (rect, _) = self.ui.allocate_exact_size(vec2(self.width, SECTION_H), Sense::hover());
        let p = self.ui.painter();
        theme::paint_job(p, rect, theme::label_job(title, color::SECONDARY), Align::Min, true);
        draw::rule_h(p, rect.left(), rect.right(), rect.bottom() - 1.0, color::RULE_FAINT);
    }

    pub(super) fn text(&mut self, label: &str, value: &str, c: Color32, mono: bool) {
        let (rect, _) = self.ui.allocate_exact_size(vec2(self.width, FIELD_H), Sense::hover());
        let (l, v) = self.split(rect);
        let p = self.ui.painter();
        theme::paint_job(p, l, theme::label_job(label, color::FAINT), Align::Min, true);
        let job = if mono {
            theme::mono_job(value, font_size::MONO, c)
        } else {
            theme::sans_job(value, 12.5, c, false)
        };
        let w = theme::paint_job(p, v, job, Align::Min, true);
        if w >= v.width() - 1.0 {
            self.ui.interact(v, self.ui.scope_id().with(("field", label, value)), Sense::hover()).on_hover_text(value);
        }
    }

    fn wrapped_value(&mut self, label: &str, value: &str, c: Color32) {
        let w = self.width - FIELD_LABEL_W;
        let mut job = theme::mono_job(value, font_size::MONO_SMALL, c);
        job.wrap.max_width = w.max(40.0);
        let galley = self.ui.painter().layout_job(job);
        let h = (galley.size().y + 6.0).max(FIELD_H);
        let (rect, _) = self.ui.allocate_exact_size(vec2(self.width, h), Sense::hover());
        let label_r = Rect::from_min_size(rect.min, vec2(FIELD_LABEL_W, FIELD_H));
        theme::paint_job(self.ui.painter(), label_r, theme::label_job(label, color::FAINT), Align::Min, true);
        let y = rect.top() + (FIELD_H - galley.rows.first().map_or(galley.size().y, |r| r.height())) * 0.5;
        self.ui.painter().galley(pos2(rect.left() + FIELD_LABEL_W, y), galley, c);
    }

    fn item(&mut self, label: &str, value: &str, c: Color32, hover: &str) {
        let (rect, resp) = self.ui.allocate_exact_size(vec2(self.width, FIELD_H), Sense::hover());
        let (l, v) = self.split(rect);
        let p = self.ui.painter();
        theme::paint_job(p, l, theme::sans_job(label, 12.5, color::PARCHMENT, false), Align::Min, true);
        theme::paint_job(p, v, theme::sans_job(value, 12.5, c, false), Align::Min, true);
        resp.on_hover_text(hover);
    }

    fn link(&mut self, label: &str, value: &str, hover: &str) -> bool {
        let (rect, resp) = self.ui.allocate_exact_size(vec2(self.width, FIELD_H), Sense::click());
        if resp.hovered() {
            self.ui.painter().rect_filled(rect, 0.0, color::PLATE_HOVER);
        }
        let (l, v) = self.split(rect);
        let p = self.ui.painter();
        theme::paint_job(p, l, theme::sans_job(label, 12.5, color::PARCHMENT, true), Align::Min, true);
        theme::paint_job(p, v, theme::sans_job(value, 12.5, color::SECONDARY, false), Align::Min, true);
        resp.on_hover_cursor(CursorIcon::PointingHand).on_hover_text(hover).clicked()
    }

    fn folder_row(&mut self, path: &str, how: &str) -> RowClick {
        self.folder_row_with(path, how, "Remove")
    }

    pub(super) fn folder_row_with(&mut self, name: &str, value: &str, action: &str) -> RowClick {
        let (rect, resp) = self.ui.allocate_exact_size(vec2(self.width, FIELD_H), Sense::click());
        let action_w = theme::job_width(self.ui, theme::label_job(action, color::SECONDARY)) + 6.0;
        let action_r = Rect::from_min_max(pos2(rect.right() - action_w, rect.top()), rect.max);
        let a = self.ui.interact(action_r, self.ui.scope_id().with(("act", name, action)), Sense::click());
        a.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, format!("{action} {name}")));
        if resp.hovered() && !a.hovered() {
            self.ui.painter().rect_filled(rect, 0.0, color::PLATE_HOVER);
        }
        let p = self.ui.painter().clone();
        let body = Rect::from_min_max(rect.min, pos2(action_r.left() - 8.0, rect.bottom()));
        let name_w = (body.width() * 0.60).clamp(FIELD_LABEL_W, 210.0).min(body.width());
        let l = Rect::from_min_size(body.min, vec2(name_w, body.height()));
        let v = Rect::from_min_max(pos2(body.left() + name_w + 6.0, body.top()), body.max);
        theme::paint_job(&p, l, theme::sans_job(name, 12.5, color::PARCHMENT, false), Align::Min, true);
        theme::paint_job(&p, v, theme::sans_job(value, 12.5, color::SECONDARY, false), Align::Min, true);
        let ac = if a.hovered() { color::PARCHMENT } else { color::SECONDARY };
        theme::paint_job(&p, action_r, theme::label_job(action, ac), Align::Max, false);
        if a.on_hover_cursor(CursorIcon::PointingHand).clicked() {
            RowClick::Action
        } else if resp.on_hover_cursor(CursorIcon::PointingHand).clicked() {
            RowClick::Row
        } else {
            RowClick::None
        }
    }

    fn aged(&mut self, name: &str, age: &str, hover: &str) -> bool {
        let (rect, resp) = self.ui.allocate_exact_size(vec2(self.width, FIELD_H), Sense::click());
        if resp.hovered() {
            self.ui.painter().rect_filled(rect, 0.0, color::PLATE_HOVER);
        }
        let p = self.ui.painter();
        let age_r = Rect::from_min_max(pos2(rect.right() - 74.0, rect.top()), rect.max);
        let name_r = Rect::from_min_max(rect.min, pos2(age_r.left() - 8.0, rect.bottom()));
        theme::paint_job(p, name_r, theme::sans_job(name, 12.5, color::PARCHMENT, false), Align::Min, true);
        theme::paint_job(p, age_r, theme::mono_job(age, font_size::MONO, color::WARN), Align::Max, false);
        resp.on_hover_cursor(CursorIcon::PointingHand).on_hover_text(hover).clicked()
    }

    pub(super) fn note(&mut self, text: &str, c: Color32) {
        let mut job = theme::sans_job(text, 12.0, c, false);
        job.wrap.max_width = self.width;
        let galley = self.ui.painter().layout_job(job);
        let (rect, _) = self.ui.allocate_exact_size(vec2(self.width, galley.size().y + 8.0), Sense::hover());
        self.ui.painter().galley(rect.min + vec2(0.0, 4.0), galley, c);
    }

    fn wrapped(&mut self, text: &str, c: Color32) {
        let w = self.width - FIELD_LABEL_W;
        let mut job = theme::sans_job(text, 12.5, c, false);
        job.wrap.max_width = w.max(40.0);
        job.wrap.max_rows = 3;
        let galley = self.ui.painter().layout_job(job);
        let (rect, _) = self.ui.allocate_exact_size(vec2(self.width, galley.size().y + 6.0), Sense::hover());
        self.ui.painter().galley(pos2(rect.left() + FIELD_LABEL_W, rect.top() + 2.0), galley, c);
    }
}
