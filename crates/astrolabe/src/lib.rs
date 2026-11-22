//! Astrolabe desktop application: unified Sternbild shell hosting the command
//! layer, Repos monitor panel, and Agents limits/Ollama monitor panel.

pub mod agents_panel;
pub mod app;
pub mod host;
pub mod icons;
pub mod repos_panel;
pub mod widgets;

#[cfg(test)]
mod tests;

pub use app::{AstrolabeApp, LaunchOptions, Panel, write_bundle_icon};
pub use host::{Entry, Host};
