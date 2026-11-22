//! Left sidebar rail when Repos is active: Workspace panel switcher (`Repos` /
//! `Agents`) followed by contextual repository navigation (`All Repos`,
//! `Location`, `Folders`, `Tags`, `Status`, `Apps`, `Languages`, `Categories`)
//! with drag-and-drop, inline rename, and context menus.

use astrolabe_engines::repos::{Ide, Nav, tags};
use astrolabe_kit::{IconKind, color, draw, font_size, metric, pane_child, theme};
use egui::text::{CCursor, CCursorRange};
use egui::{Align, CursorIcon, Key as K, Rect, Response, ScrollArea, Sense, Ui, UiBuilder, pos2, vec2};

use super::{Click, FolderDrag, Renaming, RepoDrag, ReposPanel, fold_key};
use crate::app::Panel;
use crate::widgets;

const INDENT: f32 = 14.0;

struct RowSpec<'a> {
    depth: usize,
    icon: Option<IconKind>,
    text: &'a str,
    count: Option<usize>,
    active: bool,
    fold: Option<bool>,
    quiet: bool,
    drag: bool,
}

impl ReposPanel {
    /// Draws the complete left sidebar rail for the Repos panel and returns `Some(Panel)`
    /// when the user clicks the top-level workspace panel switcher.
    pub fn show_sidebar(
        &mut self,
        ui: &mut Ui,
        rect: Rect,
        repos_count: usize,
        agents_count: usize,
        clicks: &mut Vec<Click>,
    ) -> Option<Panel> {
        let p = ui.painter();
        p.rect_filled(rect, 0.0, color::GROUND);
        draw::rule_v(p, rect.right() - 1.0, rect.top(), rect.bottom(), color::RULE);

        let inner = Rect::from_min_max(rect.min, pos2((rect.right() - 1.0).max(rect.left()), rect.bottom()));
        let mut switched = None;

        pane_child(ui, "repos_sidebar_rail", inner, |ui| {
            ScrollArea::vertical().id_salt("repos_sidebar_scroll").auto_shrink([false, false]).show(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                let width = ui.available_width();
                ui.add_space(6.0);

                // Top-level Workspace switcher (aligned pixel-for-pixel with SidebarRail).
                self.section_heading(ui, width, "Workspace");
                let repos_row = RowSpec {
                    depth: 0,
                    icon: Some(IconKind::Database),
                    text: "Repos",
                    count: Some(repos_count),
                    active: true,
                    fold: None,
                    quiet: false,
                    drag: false,
                };
                let (r_resp, _) = self.sidebar_row(ui, width, "panel:repos", &repos_row);
                if r_resp.clicked() {
                    switched = Some(Panel::Repos);
                }
                let agents_row = RowSpec {
                    depth: 0,
                    icon: Some(IconKind::Cpu),
                    text: "Agents",
                    count: Some(agents_count),
                    active: false,
                    fold: None,
                    quiet: false,
                    drag: false,
                };
                let (a_resp, _) = self.sidebar_row(ui, width, "panel:agents", &agents_row);
                if a_resp.clicked() {
                    switched = Some(Panel::Agents);
                }

                // Separator between Workspace switcher and Repos sections.
                self.section_divider(ui, inner);

                // All Repos item.
                let all = RowSpec {
                    depth: 0,
                    icon: Some(IconKind::Grid),
                    text: "All Repos",
                    count: Some(self.index.len()),
                    active: self.view.nav == Nav::All && !self.manager.open && !self.watched_folders.open,
                    fold: None,
                    quiet: false,
                    drag: false,
                };
                let (resp, _) = self.sidebar_row(ui, width, "repos:all", &all);
                if resp.clicked() {
                    clicks.push(Click::Nav(Nav::All));
                }

                self.section_divider(ui, inner);
                self.location_section(ui, width, clicks);

                self.section_divider(ui, inner);
                self.folders_section(ui, width, clicks);

                self.section_divider(ui, inner);
                self.manual_tags_section(ui, width, clicks);

                self.auto_tags_sections(ui, inner, width, clicks);
                ui.add_space(16.0);
            });
        });

        switched
    }

    fn section_divider(&self, ui: &mut Ui, inner: Rect) {
        ui.add_space(5.0);
        let y = ui.cursor().top();
        draw::rule_h(ui.painter(), inner.left() + metric::PAD, inner.right() - metric::PAD, y, color::RULE_FAINT);
        ui.add_space(3.0);
    }

    fn section_heading(&self, ui: &mut Ui, width: f32, title: &str) -> Response {
        let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::SIDEBAR_HEADING), Sense::hover());
        let title_rect = Rect::from_min_max(
            pos2(rect.left() + metric::PAD, rect.top()),
            pos2(rect.right() - metric::PAD, rect.bottom()),
        );
        theme::paint_job(ui.painter(), title_rect, theme::label_job(title, color::FAINT), Align::Min, true);
        resp
    }

    fn location_section(&self, ui: &mut Ui, width: f32, clicks: &mut Vec<Click>) {
        self.section_heading(ui, width, "Location");
        let items = [
            (
                tags::LOCATION_LOCAL_ONLY,
                "Local Only",
                self.index.auto_counts.get(tags::LOCATION_LOCAL_ONLY).copied().unwrap_or(0),
            ),
            (tags::LOCATION_REMOTE_ONLY, "Remote Only", self.state.remote_only.len()),
            (tags::LOCATION_BOTH, "Both", self.index.auto_counts.get(tags::LOCATION_BOTH).copied().unwrap_or(0)),
        ];
        for (tag, label, count) in items {
            let nav = Nav::Tag(tag.to_owned());
            let row = RowSpec {
                depth: 0,
                icon: None,
                text: label,
                count: Some(count),
                active: !self.manager.open && !self.watched_folders.open && self.view.nav == nav,
                fold: None,
                quiet: false,
                drag: false,
            };
            let (resp, _) = self.sidebar_row(ui, width, &format!("loc-{tag}"), &row);
            let resp = resp.on_hover_text(format!("Location filter: {label}"));
            if resp.clicked() {
                clicks.push(Click::Nav(nav));
            }
        }
    }

    fn folders_section(&mut self, ui: &mut Ui, width: f32, clicks: &mut Vec<Click>) {
        let head = self.section_heading(ui, width, "Folders");
        if let Some(d) = head.dnd_release_payload::<FolderDrag>()
            && d.0.len() > 1
        {
            clicks.push(Click::MoveFolder(d.0.clone(), Vec::new()));
        }
        if head.dnd_hover_payload::<FolderDrag>().is_some_and(|d| d.0.len() > 1) {
            draw::box_outline(ui.painter(), head.rect, color::BRONZE);
        }

        let new_rect = Rect::from_min_max(
            pos2(head.rect.right() - 64.0, head.rect.top()),
            pos2(head.rect.right() - metric::PAD, head.rect.bottom()),
        );
        let mut child = ui.new_child(UiBuilder::new().max_rect(new_rect).layout(egui::Layout::right_to_left(Align::Center)));
        let (resp, _) = egui::containers::menu::MenuButton::from_button(widgets::link_menu_widget("New")).ui(&mut child, |ui| {
            if ui.button("New Folder").clicked() {
                clicks.push(Click::NewFolder { parent: Vec::new(), smart: false });
            }
            if ui.button("New Smart Folder").clicked() {
                clicks.push(Click::NewFolder { parent: Vec::new(), smart: true });
            }
        });
        resp.on_hover_cursor(CursorIcon::PointingHand).on_hover_text("New Folder ⌘N · New Smart Folder ⇧⌘N");

        if self.org.folders.is_empty() {
            let (rect, resp) = ui.allocate_exact_size(vec2(width, 32.0), Sense::hover());
            let inner = Rect::from_min_max(pos2(rect.left() + metric::PAD, rect.top()), pos2(rect.right() - metric::PAD, rect.bottom()));
            theme::paint_job(
                ui.painter(),
                inner,
                theme::sans_job("Drop repo or select New", font_size::MONO_SMALL, color::FAINT, false),
                Align::Min,
                true,
            );
            if let Some(d) = resp.dnd_release_payload::<RepoDrag>() {
                clicks.push(Click::NewFolderWith(d.0.clone()));
            }
            if resp.dnd_hover_payload::<RepoDrag>().is_some() {
                draw::box_outline(ui.painter(), rect, color::BRONZE);
            }
            return;
        }

        let nav = if self.manager.open {
            self.manager_folder()
        } else if self.watched_folders.open {
            None
        } else {
            self.nav_folder()
        };
        let walk: Vec<(Vec<usize>, String, bool, bool)> = self
            .org
            .walk()
            .into_iter()
            .map(|(at, f)| (at, f.name.clone(), f.is_smart(), !f.folders.is_empty()))
            .collect();
        for (at, name, smart, has_children) in walk {
            let hidden = (1..at.len()).any(|n| self.view.folded.contains(&fold_key(&self.org.names(&at[..n]))));
            if hidden {
                continue;
            }
            let key = fold_key(&self.org.names(&at));
            let open = !self.view.folded.contains(&key);
            let renaming = matches!(&self.renaming, Some(Renaming::Folder(p, _)) if *p == at);
            let row = RowSpec {
                depth: at.len() - 1,
                icon: Some(if smart { IconKind::Search } else { IconKind::Folder }),
                text: if renaming { "" } else { &name },
                count: Some(self.index.folder_count(&at)),
                active: nav.as_ref() == Some(&at),
                fold: has_children.then_some(open),
                quiet: false,
                drag: !renaming,
            };
            let (resp, fold) = self.sidebar_row(ui, width, &format!("folder{at:?}"), &row);
            if renaming {
                self.rename_field(ui, resp.rect, at.len() - 1, clicks);
            }
            if fold.is_some_and(|f| f.clicked()) {
                clicks.push(Click::Fold(key));
            } else if resp.double_clicked() {
                clicks.push(Click::StartRename(at.clone()));
            } else if resp.clicked() {
                clicks.push(Click::Nav(Nav::Folder(self.org.names(&at))));
            }
            if !renaming {
                resp.dnd_set_drag_payload(FolderDrag(at.clone()));
            }
            let repo_over = resp.dnd_hover_payload::<RepoDrag>().is_some();
            let folder_over = resp.dnd_hover_payload::<FolderDrag>().is_some_and(|d| !at.starts_with(&d.0));
            if repo_over || folder_over {
                draw::box_outline(ui.painter(), resp.rect, color::BRONZE);
            }
            if let Some(d) = resp.dnd_release_payload::<RepoDrag>() {
                clicks.push(Click::Pin(at.clone(), d.0.clone()));
            }
            if let Some(d) = resp.dnd_release_payload::<FolderDrag>()
                && !at.starts_with(&d.0)
            {
                clicks.push(Click::MoveFolder(d.0.clone(), at.clone()));
            }
            resp.context_menu(|ui| {
                if ui.button("New Subfolder").clicked() {
                    clicks.push(Click::NewFolder { parent: at.clone(), smart: false });
                }
                if ui.button("New Smart Subfolder").clicked() {
                    clicks.push(Click::NewFolder { parent: at.clone(), smart: true });
                }
                ui.separator();
                if ui.button("Rename").clicked() {
                    clicks.push(Click::StartRename(at.clone()));
                }
                if at.len() > 1 && ui.button("Move to Top Level").clicked() {
                    clicks.push(Click::MoveFolder(at.clone(), Vec::new()));
                }
                ui.separator();
                if ui.button("Delete").clicked() {
                    clicks.push(Click::DeleteFolder(at.clone()));
                }
            });
        }
    }

    fn rename_field(&mut self, ui: &mut Ui, row: Rect, depth: usize, clicks: &mut Vec<Click>) {
        let Some(renaming) = &mut self.renaming else { return };
        let buffer = match renaming {
            Renaming::Folder(_, b) | Renaming::Tag(_, b) => b,
        };
        let left = row.left() + metric::PAD + depth as f32 * INDENT + 22.0;
        let rect = Rect::from_min_max(pos2(left, row.top() + 1.0), pos2(row.right() - 8.0, row.bottom() - 1.0));
        let id = ui.scope_id().with("sidebar_rename");
        let resp = widgets::text_field(ui, rect, id, buffer, "Name", false, false);
        if self.focus_rename {
            self.focus_rename = false;
            resp.request_focus();
            if let Some(mut state) = egui::TextEdit::load_state(ui.ctx(), id) {
                let end = buffer.chars().count();
                state.cursor.set_char_range(Some(CCursorRange::two(CCursor::new(0), CCursor::new(end))));
                state.store(ui.ctx(), id);
            }
        }
        if resp.lost_focus() {
            let text = buffer.clone();
            if ui.input(|i| i.key_pressed(K::Escape)) {
                clicks.push(Click::CancelRename);
            } else {
                match renaming {
                    Renaming::Folder(at, _) => clicks.push(Click::RenameFolder(at.clone(), text)),
                    Renaming::Tag(from, _) => clicks.push(Click::RenameTag(from.clone(), text)),
                }
            }
        }
    }

    fn manual_tags_section(&mut self, ui: &mut Ui, width: f32, clicks: &mut Vec<Click>) {
        self.section_heading(ui, width, "Tags");
        if self.index.manual_counts.is_empty() {
            let (rect, _) = ui.allocate_exact_size(vec2(width, 24.0), Sense::hover());
            let inner = Rect::from_min_max(pos2(rect.left() + metric::PAD, rect.top()), pos2(rect.right() - metric::PAD, rect.bottom()));
            theme::paint_job(
                ui.painter(),
                inner,
                theme::sans_job("No manual tags", font_size::MONO_SMALL, color::FAINT, false),
                Align::Min,
                true,
            );
            return;
        }
        let tags = self.index.manual_counts.clone();
        for (tag, count) in tags {
            let renaming = matches!(&self.renaming, Some(Renaming::Tag(t, _)) if *t == tag);
            let row = RowSpec {
                depth: 0,
                icon: None,
                text: if renaming { "" } else { &tag },
                count: Some(count),
                active: if self.manager.open {
                    self.manager.tag.as_ref() == Some(&tag)
                } else if self.watched_folders.open {
                    false
                } else {
                    self.view.nav == Nav::Tag(tag.clone())
                },
                fold: None,
                quiet: false,
                drag: false,
            };
            let (resp, _) = self.sidebar_row(ui, width, &format!("tag-{tag}"), &row);
            if renaming {
                self.rename_field(ui, resp.rect, 0, clicks);
            }
            if resp.double_clicked() {
                clicks.push(Click::StartTagRename(tag.clone()));
            } else if resp.clicked() {
                clicks.push(Click::Nav(Nav::Tag(tag.clone())));
            }
            if resp.dnd_hover_payload::<RepoDrag>().is_some() {
                draw::box_outline(ui.painter(), resp.rect, color::BRONZE);
            }
            if let Some(d) = resp.dnd_release_payload::<RepoDrag>() {
                clicks.push(Click::AddTag(d.0.clone(), tag.clone()));
            }
            resp.context_menu(|ui| {
                if ui.button("Rename").clicked() {
                    clicks.push(Click::StartTagRename(tag.clone()));
                }
                if ui.button("Delete Tag").clicked() {
                    clicks.push(Click::AskDeleteTag(tag.clone()));
                }
            });
        }
    }

    fn auto_tags_sections(&mut self, ui: &mut Ui, inner: Rect, width: f32, clicks: &mut Vec<Click>) {
        let counts = &self.index.auto_counts;
        let status: Vec<(String, usize)> =
            tags::STATUS.iter().filter_map(|s| counts.get(*s).map(|n| (s.to_string(), *n))).collect();
        let apps: Vec<(String, usize)> = Ide::ALL
            .iter()
            .filter_map(|i| {
                let tag = format!("app:{}", i.name().to_lowercase());
                counts.get(&tag).map(|n| (tag, *n))
            })
            .collect();
        let mut langs: Vec<(String, usize)> =
            counts.iter().filter(|(t, _)| t.starts_with("lang:")).map(|(t, n)| (t.clone(), *n)).collect();
        langs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

        let order = |t: &str| {
            let label = self.tag_label(t);
            self.state.config.categories.iter().position(|c| *c == label).unwrap_or(usize::MAX)
        };
        let mut cats: Vec<(String, usize)> =
            counts.iter().filter(|(t, _)| t.starts_with("category:")).map(|(t, n)| (t.clone(), *n)).collect();
        cats.sort_by_key(|(t, _)| (order(t), t.clone()));

        for (title, list) in [("Status", status), ("Apps", apps), ("Languages", langs), ("Categories", cats)] {
            if list.is_empty() {
                continue;
            }
            self.section_divider(ui, inner);
            self.section_heading(ui, width, title);
            for (tag, count) in list {
                let label = self.tag_label(&tag);
                let row = RowSpec {
                    depth: 0,
                    icon: None,
                    text: &label,
                    count: Some(count),
                    active: !self.manager.open && !self.watched_folders.open && self.view.nav == Nav::Tag(tag.clone()),
                    fold: None,
                    quiet: true,
                    drag: false,
                };
                let (resp, _) = self.sidebar_row(ui, width, &format!("auto-{tag}"), &row);
                let resp = resp.on_hover_text(format!("Automatic tag: {tag}"));
                if resp.clicked() {
                    clicks.push(Click::Nav(Nav::Tag(tag.clone())));
                }
            }
        }
    }

    fn sidebar_row(&self, ui: &mut Ui, width: f32, id: &str, row: &RowSpec<'_>) -> (Response, Option<Response>) {
        let sense = if row.drag { Sense::click_and_drag() } else { Sense::click() };
        let (rect, resp) = ui.allocate_exact_size(vec2(width, metric::SIDEBAR_ROW), sense);
        resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, true, row.active, row.text));

        let p = ui.painter().clone();
        if row.active {
            p.rect_filled(rect, 0.0, color::PLATE);
            p.rect_filled(Rect::from_min_size(rect.min, vec2(metric::SELECTION_BAR, rect.height())), 0.0, color::BRONZE);
        } else if resp.hovered() {
            p.rect_filled(rect, 0.0, color::PLATE_HOVER);
        }

        let mut x = rect.left() + metric::PAD + row.depth as f32 * INDENT;
        let mid_y = rect.center().y;

        let fold = row.fold.map(|open| {
            let hit = Rect::from_center_size(pos2(x + 4.0, mid_y), vec2(14.0, metric::SIDEBAR_ROW));
            let fresp = ui.interact(hit, ui.scope_id().with((id, "fold")), Sense::click());
            let c = if fresp.hovered() {
                color::PARCHMENT
            } else if row.active {
                color::BRONZE
            } else {
                color::FAINT
            };
            draw::disclosure(&p, pos2(x + 4.0, mid_y), open, c);
            x += 14.0;
            fresp.on_hover_cursor(CursorIcon::PointingHand)
        });

        if let Some(icon) = row.icon {
            let ic = if row.active { color::BRONZE } else { color::SECONDARY };
            draw::icon_glyph(&p, pos2(x + 6.0, mid_y), icon, ic);
            x += 18.0;
        }

        let count_w = if let Some(n) = row.count {
            let count_str = n.to_string();
            let count_color = if n == 0 {
                color::FAINT
            } else if row.active {
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
        let text_color = if row.active {
            color::BRONZE
        } else if row.quiet {
            color::SECONDARY
        } else {
            color::PARCHMENT
        };
        theme::paint_job(&p, text_rect, theme::sans_job(row.text, font_size::BODY, text_color, row.active), Align::Min, true);

        (resp.on_hover_cursor(CursorIcon::PointingHand), fold)
    }
}
