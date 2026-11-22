//! Headless `egui_kittest` interaction tests and strictly offscreen `wgpu` PNG
//! captures for the Astrolabe shell, Repos panel, and Agents panel.

use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;

use astrolabe_engines::agents::{Provider, limits::xiaomi::Region};
use astrolabe_engines::repos::{
    self, Cmd, Density, Discovery, Engine as ReposEngine, Found, Grouping, Ide, IdeSource, Msg, Nav, Sort,
};
use astrolabe_kit::capture::{CaptureConfig, render_eframe_png};
use egui::accesskit::Role;
use egui::{Key as K, vec2};
use egui_kittest::Harness;
use egui_kittest::kittest::{NodeT, Queryable};

use crate::agents_panel::AgentsPanel;
use crate::app::{AstrolabeApp, LaunchOptions, Panel};
use crate::repos_panel::{self, Files, ReposPanel};

fn demo_harness(panel: Panel) -> Harness<'static, AstrolabeApp> {
    Harness::builder()
        .with_size(vec2(1440.0, 900.0))
        .with_pixels_per_point(2.0)
        .build_eframe(move |cc| AstrolabeApp::new(cc, LaunchOptions::demo(panel)))
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_path_buf()
}

fn scratch_dir() -> Option<PathBuf> {
    let dir = std::env::var_os("HOME")
        .map(PathBuf::from)?
        .join(".worktrees")
        .join("astrolabe")
        .join("scratch");
    dir.is_dir().then_some(dir)
}

#[test]
fn cli_launch_options_parse_demo_and_panel() {
    let default = LaunchOptions::from_args(Vec::<String>::new());
    assert_eq!(default, LaunchOptions { demo: false, initial_panel: Panel::Repos });

    let demo_agents = LaunchOptions::from_args(["--demo".into(), "--panel".into(), "agents".into()]);
    assert_eq!(demo_agents, LaunchOptions { demo: true, initial_panel: Panel::Agents });

    let eq_syntax = LaunchOptions::from_args(["--panel=agents".into(), "--demo".into()]);
    assert_eq!(eq_syntax, LaunchOptions { demo: true, initial_panel: Panel::Agents });

    let repos_flag = LaunchOptions::from_args(["--panel=repos".into()]);
    assert_eq!(repos_flag, LaunchOptions { demo: false, initial_panel: Panel::Repos });
}

#[test]
fn sidebar_switches_between_repos_and_agents() {
    let mut h = demo_harness(Panel::Repos);
    h.run_steps(3);
    assert_eq!(h.state().active_panel, Panel::Repos);
    h.get_by_label("compass-ui");

    h.get_by_label("Agents").click();
    h.run_steps(3);
    assert_eq!(h.state().active_panel, Panel::Agents);
    h.get_by_label("Claude");
    h.get_by_label("atlas-coder:27b");

    h.get_by_label("Repos").click();
    h.run_steps(3);
    assert_eq!(h.state().active_panel, Panel::Repos);
    h.get_by_label("sextant-core");
}

#[test]
fn repos_demo_interactions_grouping_sorting_filtering_and_inspector() {
    let mut h = demo_harness(Panel::Repos);
    h.run_steps(3);
    assert_eq!(h.state().repos.repo_count(), 11);

    // Grouping controls.
    h.get_by_label("App").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.view.grouping, Grouping::App);

    h.get_by_label("Tag").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.view.grouping, Grouping::Tag);

    h.get_by_label("Folder").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.view.grouping, Grouping::Folder);

    h.get_by_label("Flat").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.view.grouping, Grouping::None);

    // Density & sort controls.
    h.get_by_label("Compact").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.view.density, Density::Compact);

    h.get_by_label("Recent").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.view.sort, Sort::Recent);
    assert!(h.state().repos.view.desc);

    h.get_by_label("Comfortable").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.view.density, Density::Comfortable);

    // Clicking an attention chip in Totals view narrows the filter.
    h.get_by_label("4 UNCOMMITTED").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.view.filter, "uncommitted");
    assert!(h.state().repos.shown().len() < 11);
    h.get_by_label("Save As Smart Folder");

    // Clear filter and select a repository to inspect its details.
    h.state_mut().repos.apply(vec![repos_panel::Click::Filter(String::new())]);
    h.run_steps(2);
    h.get_by_label("compass-ui").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.selected().map(|r| r.name.as_str()), Some("compass-ui"));
    assert!(h.query_all_by_label("WebStorm").count() >= 2);
    h.get_by_label("Finder");
    h.get_by_label("Terminal");
    h.get_by_label("GitHub");

    // Keyboard navigation (still sorted by Recent desc: compass-ui -> sextant-core-mirror) and Escape deselect.
    h.key_press(K::ArrowDown);
    h.run_steps(2);
    assert_eq!(h.state().repos.selected().map(|r| r.name.as_str()), Some("sextant-core-mirror"));
    h.key_press(K::Escape);
    h.run_steps(2);
    assert!(h.state().repos.selected().is_none());

    // Re-select compass-ui and add/remove a manual tag in memory (no disk writes).
    h.get_by_label("compass-ui").click();
    h.run_steps(2);
    let id = h.state().repos.selected().unwrap().id().to_owned();
    h.state_mut().repos.apply(vec![repos_panel::Click::AddTag(id.clone(), "Release Prep".into())]);
    h.run_steps(2);
    assert!(h.state().repos.org.all_tags().contains("release-prep"));
    h.state_mut().repos.apply(vec![repos_panel::Click::RemoveTag(id, "release-prep".into())]);
    h.run_steps(2);
}

#[test]
fn repos_modals_and_manage_mode_work_in_memory() {
    let mut h = demo_harness(Panel::Repos);
    h.run_steps(3);
    let initial_folders = h.state().repos.org.folders.len();

    // New Folder modal via sidebar NEW menu.
    h.get_by_label("NEW").click();
    h.run_steps(2);
    h.get_by_label("New Folder").click();
    h.run_steps(2);
    assert!(h.state().repos.new_folder.is_some());
    h.event(egui::Event::Text("Research".into()));
    h.run_steps(1);
    h.get_by_label("Create").click();
    h.run_steps(3);
    assert!(h.state().repos.new_folder.is_none());
    assert_eq!(h.state().repos.org.folders.len(), initial_folders + 1);
    assert_eq!(h.state().repos.view.nav, Nav::Folder(vec!["Research".into()]));

    // Toggle Manage mode and exercise Folders & Tags tabs.
    h.get_by_label("Manage").click();
    h.run_steps(2);
    assert!(h.state().repos.manager.open);
    h.get_by_label("Tags").click();
    h.run_steps(2);
    assert_eq!(h.state().repos.manager.tab, repos_panel::Tab::Tags);
    h.get_by_label("New Tag").click();
    h.run_steps(3);
    assert!(h.state().repos.org.all_tags().contains("new-tag"));
    h.key_press(K::Escape);
    h.run_steps(2);
    assert!(h.state().repos.manager.open);
    h.get_by_label("Done").click();
    h.run_steps(2);
    assert!(!h.state().repos.manager.open);
}

#[test]
fn repos_commands_dispatch_to_engine_recording() {
    let dir = tempfile::tempdir().unwrap();
    let files = Files { organize: dir.path().join("organize.toml"), window: dir.path().join("window.toml") };
    let (engine, rx, commands) = ReposEngine::recording();
    let mut h = Harness::builder().with_size(vec2(1440.0, 900.0)).build_eframe(move |cc| {
        let repos = ReposPanel::with_sources(Some(files), engine, rx, channel().1, false, Some(repos::demo_data().now));
        let agents = AgentsPanel::demo(&cc.egui_ctx);
        AstrolabeApp::with_panels(cc, Panel::Repos, repos, agents)
    });

    let broken = dir.path().join("broken-repo");
    h.state_mut().repos.state.apply(Msg::Discovered(Discovery {
        repos: vec![Found {
            path: broken.clone(),
            git_dir: broken.join(".git"),
            root: 0,
            ide: Some(Ide::RustRover),
            ide_source: IdeSource::Root,
            langs: vec!["rust".into()],
        }],
        errors: vec![],
    }));
    h.state_mut().repos.state.apply(Msg::Stats(broken.clone(), Box::new(Err("broken .git".into()))));
    h.run_steps(3);

    h.get_by_label("Rescan").click();
    h.run_steps(2);
    assert_eq!(commands.try_recv().ok(), Some(Cmd::Rescan));

    h.get_by_label("Remotes").click();
    h.run_steps(2);
    assert_eq!(commands.try_recv().ok(), Some(Cmd::CheckRemotes(None)));

    h.get_by_label("broken-repo").click();
    h.run_steps(2);
    h.get_by_label("Remove From Monitor").click();
    h.run_steps(2);
    assert_eq!(commands.try_recv().ok(), Some(Cmd::RemoveRepo(broken)));
}

fn select_key_provider(h: &mut Harness<'static, AstrolabeApp>, provider: Provider) {
    h.query_all_by_role(Role::ComboBox).next().expect("provider selector").click();
    h.run_steps(3);
    h.get_by_role(Role::ListBox).get_by_label(provider.name()).click();
    h.run_steps(3);
    assert_eq!(h.state().agents.key_provider, provider);
}

#[test]
fn agents_demo_limits_balances_ollama_and_settings_modal() {
    let mut h = demo_harness(Panel::Agents);
    h.run_steps(3);

    // Every provider has a bundled logo ready immediately.
    for provider in Provider::ALL {
        assert!(h.state().agents.provider_icon(provider).is_some(), "missing logo for {provider:?}");
    }

    // All 13 providers and all 4 Ollama models are rendered.
    for provider in Provider::ALL.into_iter().filter(|p| *p != Provider::Ollama) {
        h.get_by_label(provider.name());
    }
    for model in ["atlas-coder:27b", "cobalt-instruct:8b", "prism-embed:0.6b", "spark-reason:32b"] {
        h.get_by_label(model);
    }
    h.get_by_label("Ollama memory overview");

    // DeepSeek shows currency balances with zero ProgressIndicators.
    h.get_by_role_and_label(Role::Label, "DeepSeek balance: USD 18.40");
    h.get_by_role_and_label(Role::Label, "DeepSeek balance: CNY 125.00");
    let meters: Vec<_> = h.query_all_by_role(Role::ProgressIndicator).collect();
    assert!(meters.len() >= 16);
    assert!(meters.iter().all(|n| !n.accesskit_node().label().unwrap_or_default().contains("DeepSeek")));

    // Settings modal: provider switching clears unsaved input, Xiaomi shows Region selector, Save/Remove update in-memory state.
    h.get_by_label("Settings").click();
    h.run_steps(3);
    assert!(h.state().agents.settings_open);

    h.state_mut().agents.key_input = "unsaved-temp".into();
    select_key_provider(&mut h, Provider::Xiaomi);
    assert!(h.state().agents.key_input.is_empty());
    assert_eq!(h.state().agents.xiaomi_region, Region::China);
    assert_eq!(h.query_all_by_role(Role::ComboBox).count(), 2);

    // Pick Europe region.
    h.query_all_by_role(Role::ComboBox).nth(1).expect("region selector").click();
    h.run_steps(3);
    h.get_by_role(Role::ListBox).get_by_label("Europe").click();
    h.run_steps(3);
    assert_eq!(h.state().agents.xiaomi_region, Region::Europe);

    // Save and remove in demo mode without touching Keychain.
    h.state_mut().agents.key_input = "tp-demo-token".into();
    h.run_steps(1);
    h.get_by_label("Save").click();
    h.run_steps(2);
    assert!(h.state().agents.shared.stored_keys.contains(&Provider::Xiaomi));
    assert!(h.state().agents.key_input.is_empty());

    h.get_by_label("Remove").click();
    h.run_steps(2);
    assert!(!h.state().agents.shared.stored_keys.contains(&Provider::Xiaomi));

    // Switch back to DeepSeek -> region selector disappears.
    select_key_provider(&mut h, Provider::DeepSeek);
    assert_eq!(h.query_all_by_role(Role::ComboBox).count(), 1);

    h.get_by_label("Close").click();
    h.run_steps(2);
    assert!(!h.state().agents.settings_open);
}

#[test]
fn offscreen_capture_repos_and_agents_demo_pngs() {
    let cfg = CaptureConfig { size: vec2(1440.0, 900.0), pixels_per_point: 2.0, steps: 5 };
    let capture_dir = std::env::var_os("ASTROLABE_CAPTURE_DIR").map(PathBuf::from);
    let out_dir = capture_dir.clone().unwrap_or_else(|| repo_root().join("docs").join("assets"));

    let repos_path = out_dir.join("repos-panel.png");
    let repos_out = render_eframe_png(&repos_path, &cfg, |cc| {
        let mut app = AstrolabeApp::new(cc, LaunchOptions::demo(Panel::Repos));
        app.repos.select_by_name("compass-ui");
        app
    })
    .expect("offscreen wgpu render for repos-panel.png");
    assert_eq!((repos_out.width, repos_out.height), (2880, 1800));

    let agents_path = out_dir.join("agents-panel.png");
    let agents_out = render_eframe_png(&agents_path, &cfg, |cc| AstrolabeApp::new(cc, LaunchOptions::demo(Panel::Agents)))
        .expect("offscreen wgpu render for agents-panel.png");
    assert_eq!((agents_out.width, agents_out.height), (2880, 1800));

    if capture_dir.is_none()
        && let Some(scratch) = scratch_dir()
    {
        std::fs::copy(&repos_path, scratch.join("repos-panel.png")).expect("copy repos-panel.png to scratch");
        std::fs::copy(&agents_path, scratch.join("agents-panel.png")).expect("copy agents-panel.png to scratch");
    }
}
