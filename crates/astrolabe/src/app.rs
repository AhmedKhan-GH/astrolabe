//! Unified Astrolabe desktop shell built on `astrolabe-kit`.
//!
//! Hosts the top `CommandBar`, left `SidebarRail` (switching between `Repos`
//! and `Agents` plus contextual Repos navigation), workspace panes, and bottom
//! `StatusBar`.

use astrolabe_kit::{
    CommandBar, IconKind, ShellSpec, SidebarAction, SidebarItem, SidebarRail, SidebarSection, StatusBar, color,
    masthead,
};
use egui::Ui;

use crate::agents_panel::{self, AgentsPanel};
use crate::host::Host;
use crate::repos_panel::{self, ReposPanel};

/// Active top-level monitor panel in the unified workspace.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Panel {
    #[default]
    Repos,
    Agents,
}

/// CLI launch flags parsed in `main` or constructed directly in tests.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LaunchOptions {
    pub demo: bool,
    pub initial_panel: Panel,
}

impl LaunchOptions {
    /// Parses `--demo` and `--panel repos|agents` (or `--panel=repos|agents`).
    pub fn from_args(args: impl IntoIterator<Item = String>) -> Self {
        let mut opts = Self::default();
        let mut iter = args.into_iter();
        while let Some(arg) = iter.next() {
            if arg == "--demo" {
                opts.demo = true;
            } else if arg == "--panel" {
                if let Some(val) = iter.next()
                    && let Some(panel) = parse_panel(&val)
                {
                    opts.initial_panel = panel;
                }
            } else if let Some(val) = arg.strip_prefix("--panel=")
                && let Some(panel) = parse_panel(val)
            {
                opts.initial_panel = panel;
            }
        }
        opts
    }

    pub fn demo(panel: Panel) -> Self {
        Self { demo: true, initial_panel: panel }
    }
}

fn parse_panel(value: &str) -> Option<Panel> {
    match value.trim().to_ascii_lowercase().as_str() {
        "repos" => Some(Panel::Repos),
        "agents" => Some(Panel::Agents),
        _ => None,
    }
}

/// Main `eframe::App` for Astrolabe.
pub struct AstrolabeApp {
    pub host: Host,
    pub active_panel: Panel,
    pub repos: ReposPanel,
    pub agents: AgentsPanel,
    pub demo: bool,
}

impl AstrolabeApp {
    pub fn new(cc: &eframe::CreationContext<'_>, options: LaunchOptions) -> Self {
        astrolabe_kit::install(&cc.egui_ctx);
        let (repos, agents) = if options.demo {
            (ReposPanel::demo(&cc.egui_ctx), AgentsPanel::demo(&cc.egui_ctx))
        } else {
            (ReposPanel::live(&cc.egui_ctx), AgentsPanel::live(&cc.egui_ctx))
        };
        Self { host: Host::default(), active_panel: options.initial_panel, repos, agents, demo: options.demo }
    }

    /// Constructs an `AstrolabeApp` with caller-supplied panels (for deterministic tests).
    pub fn with_panels(cc: &eframe::CreationContext<'_>, panel: Panel, repos: ReposPanel, agents: AgentsPanel) -> Self {
        astrolabe_kit::install(&cc.egui_ctx);
        let demo = repos.demo && agents.demo;
        Self { host: Host::default(), active_panel: panel, repos, agents, demo }
    }
}

impl eframe::App for AstrolabeApp {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.repos.tick(ctx);
        self.agents.tick(ctx);
    }

    fn ui(&mut self, ui: &mut Ui, _frame: &mut eframe::Frame) {
        let mut repo_clicks: Vec<repos_panel::Click> = Vec::new();
        let mut agent_clicks: Vec<agents_panel::Click> = Vec::new();
        let mut next_panel = None;

        if self.active_panel == Panel::Repos {
            let ctx = ui.ctx().clone();
            self.repos.keyboard(&ctx, &mut repo_clicks);
        }

        let full = ui.max_rect();
        ui.painter().rect_filled(full, 0.0, color::GROUND);

        let shell = ShellSpec {
            sidebar_share: 0.16,
            sidebar_min: 216.0,
            sidebar_max: 270.0,
            ..ShellSpec::default()
        }
        .compute(full);

        // Top CommandBar.
        let panel = self.active_panel;
        let manage_open = self.repos.manager.open;
        let watched_open = self.repos.watched_folders.open;
        let mut cmd_right_repo_clicks = Vec::new();
        CommandBar::show(
            ui,
            shell.command_bar,
            |ui| {
                masthead(ui, "ASTROLABE");
                if panel == Panel::Repos {
                    ui.add_space(6.0);
                    self.repos.command_bar_left(ui, &mut repo_clicks);
                }
            },
            |ui| match panel {
                Panel::Repos => ReposPanel::command_bar_right_controls(
                    ui,
                    manage_open,
                    watched_open,
                    &mut cmd_right_repo_clicks,
                ),
                Panel::Agents => self.agents.command_bar_right(ui, &mut agent_clicks),
            },
        );
        repo_clicks.extend(cmd_right_repo_clicks);

        // Left SidebarRail.
        if let Some(sb_rect) = shell.sidebar {
            let repos_count = self.repos.repo_count();
            let agents_count = self.agents.provider_count();
            match self.active_panel {
                Panel::Repos => {
                    if let Some(switched) =
                        self.repos.show_sidebar(ui, sb_rect, repos_count, agents_count, &mut repo_clicks)
                    {
                        next_panel = Some(switched);
                    }
                }
                Panel::Agents => {
                    let mut sections = vec![SidebarSection {
                        title: "Workspace",
                        items: vec![
                            SidebarItem::new("panel:repos", "Repos")
                                .icon(IconKind::Database)
                                .count(repos_count)
                                .active(false),
                            SidebarItem::new("panel:agents", "Agents")
                                .icon(IconKind::Cpu)
                                .count(agents_count)
                                .active(true),
                        ],
                    }];
                    sections.extend(self.agents.sidebar_sections());
                    if let Some(SidebarAction::Selected(id)) = SidebarRail::new("astrolabe_sidebar", sections).show(ui, sb_rect) {
                        if id == "panel:repos" {
                            next_panel = Some(Panel::Repos);
                        } else if id == "panel:agents" {
                            next_panel = Some(Panel::Agents);
                        } else {
                            self.agents.handle_sidebar(&id);
                        }
                    }
                }
            }
        }

        // Workspace Panes.
        match self.active_panel {
            Panel::Repos => self.repos.show_workspace(ui, shell.workspace, &mut repo_clicks),
            Panel::Agents => self.agents.show_workspace(ui, shell.workspace, &mut agent_clicks),
        }

        // Bottom StatusBar.
        StatusBar::show(
            ui,
            shell.status_bar,
            |ui| match panel {
                Panel::Repos => self.repos.status_bar_left(ui),
                Panel::Agents => self.agents.status_bar_left(ui),
            },
            |ui| match panel {
                Panel::Repos => self.repos.status_bar_right(ui, &mut repo_clicks),
                Panel::Agents => self.agents.status_bar_right(ui, &mut agent_clicks),
            },
        );

        // Apply deferred actions.
        if self.active_panel == Panel::Repos {
            let ctx = ui.ctx().clone();
            self.repos.overlays(&ctx, &mut repo_clicks);
        }
        self.repos.apply(repo_clicks);
        self.agents.apply(agent_clicks);
        if let Some(p) = next_panel {
            self.active_panel = p;
        }
    }

    fn on_exit(&mut self) {
        self.repos.flush_pending_save();
    }
}
