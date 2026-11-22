//! Headless offscreen PNG capture helper backed by `egui_kittest` and `wgpu`.
//!
//! Renders an `egui` UI or `eframe::App` completely offscreen with zero visible OS
//! windows. Enable via the `capture` Cargo feature in downstream dev-dependencies.

use std::path::{Path, PathBuf};

use egui::Vec2;
use egui_kittest::Harness;

use crate::theme;

/// Settings for an offscreen headless capture.
#[derive(Clone, Copy, Debug)]
pub struct CaptureConfig {
    /// Logical viewport size in points.
    pub size: Vec2,
    /// Rasterization scale factor (`2.0` produces crisp Retina output).
    pub pixels_per_point: f32,
    /// Number of layout/render frames to step before capturing pixels.
    pub steps: usize,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self { size: Vec2::new(1440.0, 900.0), pixels_per_point: 2.0, steps: 4 }
    }
}

/// Result metadata for a saved offscreen screenshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaptureOutput {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
}

/// Renders an `egui` UI closure offscreen via headless `wgpu` and returns the RGBA image.
///
/// Installs the default Sternbild theme before calling `init` (if any) on the first frame.
pub fn render_ui_image(
    config: &CaptureConfig,
    init: impl FnOnce(&egui::Context),
    mut ui_fn: impl FnMut(&mut egui::Ui),
) -> Result<image::RgbaImage, String> {
    let mut init = Some(init);
    let mut harness = Harness::builder()
        .with_size(config.size)
        .with_pixels_per_point(config.pixels_per_point)
        .wgpu()
        .build_ui(move |ui| {
            if let Some(setup) = init.take() {
                theme::install(ui.ctx());
                setup(ui.ctx());
            }
            ui_fn(ui);
        });
    for _ in 0..config.steps.max(1) {
        harness.step();
    }
    harness.render()
}

/// Renders an `egui` UI closure offscreen and saves it as a PNG at `path`.
pub fn render_ui_png(
    path: impl AsRef<Path>,
    config: &CaptureConfig,
    init: impl FnOnce(&egui::Context),
    ui_fn: impl FnMut(&mut egui::Ui),
) -> Result<CaptureOutput, String> {
    let image = render_ui_image(config, init, ui_fn)?;
    save_png(path.as_ref(), &image)
}

/// Renders a full `eframe::App` offscreen via headless `wgpu` and saves it as a PNG at `path`.
pub fn render_eframe_png<A: eframe::App + 'static>(
    path: impl AsRef<Path>,
    config: &CaptureConfig,
    creator: impl FnOnce(&mut eframe::CreationContext<'static>) -> A,
) -> Result<CaptureOutput, String> {
    let mut harness = Harness::builder()
        .with_size(config.size)
        .with_pixels_per_point(config.pixels_per_point)
        .wgpu()
        .build_eframe(creator);
    for _ in 0..config.steps.max(1) {
        harness.step();
    }
    let image = harness.render()?;
    save_png(path.as_ref(), &image)
}

fn save_png(path: &Path, image: &image::RgbaImage) -> Result<CaptureOutput, String> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|e| format!("create output directory {}: {e}", parent.display()))?;
    }
    image.save(path).map_err(|e| format!("save PNG {}: {e}", path.display()))?;
    Ok(CaptureOutput { path: path.to_path_buf(), width: image.width(), height: image.height() })
}
