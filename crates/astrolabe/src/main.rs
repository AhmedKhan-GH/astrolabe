//! Entry point for the Astrolabe desktop workstation.
//!
//! Supports `--demo` for isolated synthetic snapshots (zero access to real
//! repositories, files, Keychain, network, or CLIs) and `--panel repos|agents`
//! to select the initial workspace panel.

use astrolabe::{AstrolabeApp, LaunchOptions};

fn main() -> eframe::Result {
    let options = LaunchOptions::from_args(std::env::args().skip(1));
    let native = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Astrolabe")
            .with_inner_size([1440.0, 900.0])
            .with_min_inner_size([1180.0, 640.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Astrolabe",
        native,
        Box::new(move |cc| Ok(Box::new(AstrolabeApp::new(cc, options)))),
    )
}
