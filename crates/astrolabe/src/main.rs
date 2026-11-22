//! Entry point for the Astrolabe desktop workstation.
//!
//! Supports `--demo` for isolated synthetic snapshots (zero access to real
//! repositories, files, Keychain, network, or CLIs), `--panel repos|agents`
//! to select the initial workspace panel, and `--write-bundle-icon <PATH>`
//! to emit the canonical 1024x1024 Minerals PNG icon and exit immediately.

use astrolabe::{AstrolabeApp, LaunchOptions, write_bundle_icon};

fn main() -> eframe::Result {
    let options = LaunchOptions::from_args(std::env::args().skip(1));
    if let Some(path) = &options.write_bundle_icon {
        if let Err(err) = write_bundle_icon(path) {
            eprintln!("error: failed to write bundle icon {}: {err}", path.display());
            std::process::exit(1);
        }
        return Ok(());
    }
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
