//! Reusable `egui` interface kit for Astrolabe in the Sternbild workstation style.
//!
//! Surfaces use warm dark mineral tones separated by 1 px rules. Bronze is reserved
//! strictly for keyboard focus and active selection. Data elements use tabular
//! monospace figures and muted mineral pigments.

pub mod chrome;
pub mod data;
pub mod draw;
pub mod layout;
pub mod showcase;
pub mod theme;
pub mod tokens;

#[cfg(any(test, feature = "capture"))]
pub mod capture;

pub use chrome::{
    CommandBar, Pane, PaneHeaderSpec, PaneResponse, SidebarAction, SidebarItem, SidebarRail, SidebarSection, StatusBar,
    command_input, key_button, masthead, pane_header, primary_button, status_indicator, status_item,
    unavailable_action, word_button,
};
pub use data::{
    ColumnAlign, ColumnWidth, DataTable, MetricTileSpec, SortState, TableCell, TableColumn, TableEvent, TableRow,
    field_row, item_header_tile, labeled_usage_bar, metric_tile, metric_tile_row, paint_status_chip, paint_usage_bar,
    section_heading, status_chip, status_chip_size, usage_bar_tone,
};
pub use draw::IconKind;
pub use layout::{ShellRects, ShellSpec, grid_rects, pane_child, split_horizontal, split_vertical};
pub use sternbild_tokens;
pub use theme::{FontConfig, ThemeConfig, install, install_with};
pub use tokens::{StatusTone, color, font_size, metric};
