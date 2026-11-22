//! Full-window workstation showcase exercising every `astrolabe-kit` component.
//!
//! All data is synthetic and free of personal names, paths, handles, or real
//! repository names.

use egui::{Align, Layout, Ui, vec2};

use crate::chrome::{
    CommandBar, Pane, SidebarAction, SidebarItem, SidebarRail, SidebarSection, StatusBar, command_input, key_button,
    masthead, primary_button, status_indicator, status_item, unavailable_action, word_button,
};
use crate::data::{
    ColumnWidth, DataTable, MetricTileSpec, SortState, TableCell, TableColumn, TableRow, field_row, item_header_tile,
    labeled_usage_bar, metric_tile_row, section_heading, status_chip,
};
use crate::draw::IconKind;
use crate::layout::{ShellSpec, split_horizontal, split_vertical};
use crate::tokens::{StatusTone, color, metric};

/// Which tiled pane holds focus in the showcase.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusedPane {
    Catalog,
    Inspector,
    Operations,
}

/// Synthetic catalog entry for the showcase table and inspector.
#[derive(Clone, Debug)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub tone: StatusTone,
    pub load_pct: f32,
    pub items: u32,
    pub latency_ms: f32,
    pub updated: String,
    pub revision: String,
    pub workers: u32,
    pub p95_ms: f32,
    pub checked: String,
    pub compute_pct: f32,
    pub buffer_pct: f32,
    pub cache_pct: f32,
    pub quota_pct: f32,
    pub relations: Vec<(String, String)>,
}

/// Synthetic recent command operation for the bottom-right operations table.
#[derive(Clone, Debug)]
pub struct OperationEntry {
    pub command: String,
    pub actor: String,
    pub status: String,
    pub tone: StatusTone,
    pub duration: String,
}

/// Interactive state for the full-window `astrolabe-kit` showcase.
#[derive(Clone, Debug)]
pub struct ShowcaseState {
    pub command_text: String,
    pub active_nav: String,
    pub optics_expanded: bool,
    pub telemetry_expanded: bool,
    pub focused_pane: FocusedPane,
    pub selected_row: usize,
    pub sort: SortState,
    pub entries: Vec<CatalogEntry>,
    pub operations: Vec<OperationEntry>,
}

impl ShowcaseState {
    /// Builds a realistic, deterministic workstation sample with synthetic data.
    pub fn sample() -> Self {
        let entries = vec![
            CatalogEntry {
                id: "meridian-core".into(),
                name: "meridian-core".into(),
                kind: "Engine".into(),
                status: "ACTIVE".into(),
                tone: StatusTone::Ok,
                load_pct: 0.74,
                items: 1420,
                latency_ms: 12.4,
                updated: "2m".into(),
                revision: "0.4.2".into(),
                workers: 8,
                p95_ms: 18.2,
                checked: "12s".into(),
                compute_pct: 0.74,
                buffer_pct: 0.86,
                cache_pct: 0.29,
                quota_pct: 0.94,
                relations: vec![
                    ("ephemeris-index".into(), "Upstream".into()),
                    ("transit-ledger".into(), "Sink".into()),
                    ("azimuth-cache".into(), "Cache".into()),
                ],
            },
            CatalogEntry {
                id: "ephemeris-index".into(),
                name: "ephemeris-index".into(),
                kind: "Index".into(),
                status: "ACTIVE".into(),
                tone: StatusTone::Ok,
                load_pct: 0.41,
                items: 8912,
                latency_ms: 4.8,
                updated: "5m".into(),
                revision: "1.2.0".into(),
                workers: 4,
                p95_ms: 7.4,
                checked: "18s".into(),
                compute_pct: 0.41,
                buffer_pct: 0.34,
                cache_pct: 0.62,
                quota_pct: 0.28,
                relations: vec![
                    ("meridian-core".into(), "Consumer".into()),
                    ("horizon-grid".into(), "Mirror".into()),
                ],
            },
            CatalogEntry {
                id: "transit-ledger".into(),
                name: "transit-ledger".into(),
                kind: "Store".into(),
                status: "WARNING".into(),
                tone: StatusTone::Warn,
                load_pct: 0.86,
                items: 3204,
                latency_ms: 38.6,
                updated: "14m".into(),
                revision: "0.9.1".into(),
                workers: 6,
                p95_ms: 52.0,
                checked: "24s".into(),
                compute_pct: 0.68,
                buffer_pct: 0.86,
                cache_pct: 0.54,
                quota_pct: 0.78,
                relations: vec![("meridian-core".into(), "Source".into())],
            },
            CatalogEntry {
                id: "horizon-grid".into(),
                name: "horizon-grid".into(),
                kind: "Canvas".into(),
                status: "QUEUED".into(),
                tone: StatusTone::Info,
                load_pct: 0.18,
                items: 640,
                latency_ms: 9.1,
                updated: "27m".into(),
                revision: "0.3.7".into(),
                workers: 2,
                p95_ms: 14.5,
                checked: "45s".into(),
                compute_pct: 0.18,
                buffer_pct: 0.22,
                cache_pct: 0.15,
                quota_pct: 0.12,
                relations: vec![("ephemeris-index".into(), "Index".into())],
            },
            CatalogEntry {
                id: "zenith-solver".into(),
                name: "zenith-solver".into(),
                kind: "Worker".into(),
                status: "ACTIVE".into(),
                tone: StatusTone::Ok,
                load_pct: 0.62,
                items: 2115,
                latency_ms: 21.0,
                updated: "42m".into(),
                revision: "0.7.4".into(),
                workers: 12,
                p95_ms: 31.8,
                checked: "1m".into(),
                compute_pct: 0.62,
                buffer_pct: 0.48,
                cache_pct: 0.40,
                quota_pct: 0.51,
                relations: vec![("transit-ledger".into(), "Sink".into())],
            },
            CatalogEntry {
                id: "declination-map".into(),
                name: "declination-map".into(),
                kind: "Layer".into(),
                status: "IDLE".into(),
                tone: StatusTone::Neutral,
                load_pct: 0.0,
                items: 512,
                latency_ms: 1.2,
                updated: "2h".into(),
                revision: "0.2.0".into(),
                workers: 0,
                p95_ms: 2.0,
                checked: "4m".into(),
                compute_pct: 0.0,
                buffer_pct: 0.08,
                cache_pct: 0.12,
                quota_pct: 0.05,
                relations: vec![("horizon-grid".into(), "Target".into())],
            },
            CatalogEntry {
                id: "almanac-sync".into(),
                name: "almanac-sync".into(),
                kind: "Adapter".into(),
                status: "ERROR".into(),
                tone: StatusTone::Error,
                load_pct: 0.94,
                items: 96,
                latency_ms: 142.0,
                updated: "3h".into(),
                revision: "0.5.0".into(),
                workers: 1,
                p95_ms: 198.4,
                checked: "9s".into(),
                compute_pct: 0.94,
                buffer_pct: 0.91,
                cache_pct: 0.19,
                quota_pct: 0.96,
                relations: vec![("transit-ledger".into(), "Sink".into())],
            },
            CatalogEntry {
                id: "azimuth-cache".into(),
                name: "azimuth-cache".into(),
                kind: "Buffer".into(),
                status: "ACTIVE".into(),
                tone: StatusTone::Ok,
                load_pct: 0.29,
                items: 4096,
                latency_ms: 3.5,
                updated: "4h".into(),
                revision: "1.0.3".into(),
                workers: 4,
                p95_ms: 5.1,
                checked: "30s".into(),
                compute_pct: 0.29,
                buffer_pct: 0.44,
                cache_pct: 0.81,
                quota_pct: 0.33,
                relations: vec![("meridian-core".into(), "Source".into())],
            },
            CatalogEntry {
                id: "solstice-bus".into(),
                name: "solstice-bus".into(),
                kind: "Broker".into(),
                status: "ACTIVE".into(),
                tone: StatusTone::Ok,
                load_pct: 0.53,
                items: 1280,
                latency_ms: 6.7,
                updated: "5h".into(),
                revision: "0.8.0".into(),
                workers: 6,
                p95_ms: 11.4,
                checked: "22s".into(),
                compute_pct: 0.53,
                buffer_pct: 0.39,
                cache_pct: 0.48,
                quota_pct: 0.41,
                relations: vec![("zenith-solver".into(), "Consumer".into())],
            },
            CatalogEntry {
                id: "parallax-diff".into(),
                name: "parallax-diff".into(),
                kind: "Analyzer".into(),
                status: "QUEUED".into(),
                tone: StatusTone::Info,
                load_pct: 0.24,
                items: 784,
                latency_ms: 15.9,
                updated: "6h".into(),
                revision: "0.4.5".into(),
                workers: 2,
                p95_ms: 24.3,
                checked: "51s".into(),
                compute_pct: 0.24,
                buffer_pct: 0.31,
                cache_pct: 0.20,
                quota_pct: 0.18,
                relations: vec![("ephemeris-index".into(), "Index".into())],
            },
            CatalogEntry {
                id: "nadir-spool".into(),
                name: "nadir-spool".into(),
                kind: "Queue".into(),
                status: "WARNING".into(),
                tone: StatusTone::Warn,
                load_pct: 0.79,
                items: 2560,
                latency_ms: 29.4,
                updated: "8h".into(),
                revision: "0.6.1".into(),
                workers: 4,
                p95_ms: 41.2,
                checked: "16s".into(),
                compute_pct: 0.79,
                buffer_pct: 0.74,
                cache_pct: 0.36,
                quota_pct: 0.69,
                relations: vec![("solstice-bus".into(), "Upstream".into())],
            },
            CatalogEntry {
                id: "equinox-gate".into(),
                name: "equinox-gate".into(),
                kind: "Router".into(),
                status: "ACTIVE".into(),
                tone: StatusTone::Ok,
                load_pct: 0.47,
                items: 5120,
                latency_ms: 2.9,
                updated: "12h".into(),
                revision: "1.1.2".into(),
                workers: 8,
                p95_ms: 4.4,
                checked: "8s".into(),
                compute_pct: 0.47,
                buffer_pct: 0.33,
                cache_pct: 0.58,
                quota_pct: 0.29,
                relations: vec![("meridian-core".into(), "Target".into())],
            },
        ];

        let operations = vec![
            OperationEntry {
                command: "catalog.reindex".into(),
                actor: "Workflow".into(),
                status: "ACTIVE".into(),
                tone: StatusTone::Ok,
                duration: "184 ms".into(),
            },
            OperationEntry {
                command: "store.compact".into(),
                actor: "Agent".into(),
                status: "QUEUED".into(),
                tone: StatusTone::Info,
                duration: "42 ms".into(),
            },
            OperationEntry {
                command: "canvas.export".into(),
                actor: "Person".into(),
                status: "DONE".into(),
                tone: StatusTone::Neutral,
                duration: "12.4 ms".into(),
            },
            OperationEntry {
                command: "adapter.probe".into(),
                actor: "Workflow".into(),
                status: "ERROR".into(),
                tone: StatusTone::Error,
                duration: "910 ms".into(),
            },
        ];

        Self {
            command_text: "catalog.filter status:active".into(),
            active_nav: "catalog".into(),
            optics_expanded: true,
            telemetry_expanded: false,
            focused_pane: FocusedPane::Catalog,
            selected_row: 0,
            sort: SortState { column: 0, ascending: true },
            entries,
            operations,
        }
    }

    fn apply_sort(&mut self, sort: SortState) {
        let selected_id = self.entries.get(self.selected_row).map(|e| e.id.clone());
        self.sort = sort;
        self.entries.sort_by(|a, b| {
            let ord = match sort.column {
                0 => a.name.cmp(&b.name),
                1 => a.kind.cmp(&b.kind),
                2 => a.status.cmp(&b.status),
                3 => a.load_pct.total_cmp(&b.load_pct),
                4 => a.items.cmp(&b.items),
                5 => a.latency_ms.total_cmp(&b.latency_ms),
                _ => a.updated.cmp(&b.updated),
            };
            if sort.ascending { ord } else { ord.reverse() }
        });
        if let Some(id) = selected_id
            && let Some(pos) = self.entries.iter().position(|e| e.id == id)
        {
            self.selected_row = pos;
        }
    }

    /// Renders the complete workstation shell inside `ui.max_rect()`.
    pub fn show(&mut self, ui: &mut Ui) {
        let full = ui.max_rect();
        ui.painter().rect_filled(full, 0.0, color::GROUND);

        let shell = ShellSpec::default().compute(full);

        // Top Command Bar.
        CommandBar::show(
            ui,
            shell.command_bar,
            |ui| {
                masthead(ui, "ASTROLABE");
                ui.add_space(4.0);
                let field_w = (shell.command_bar.width() * 0.32).clamp(220.0, 420.0);
                command_input(ui, "showcase_cmd", &mut self.command_text, "Command or filter", field_w);
            },
            |ui| {
                let _ = primary_button(ui, "Run", Some("⏎"), true);
                let _ = key_button(ui, "⌘R", "Refresh", true, None);
                let _ = key_button(ui, "⌘K", "Command", true, None);
            },
        );

        // Left Sidebar Navigation Rail.
        if let Some(sb_rect) = shell.sidebar {
            let mut collection_items = vec![
                SidebarItem::new("optics", "Optics")
                    .icon(IconKind::Folder)
                    .count(9)
                    .expanded(self.optics_expanded)
                    .active(self.active_nav == "optics"),
            ];
            if self.optics_expanded {
                collection_items.push(
                    SidebarItem::new("lenses", "Lenses")
                        .icon(IconKind::Layers)
                        .count(5)
                        .depth(1)
                        .active(self.active_nav == "lenses"),
                );
                collection_items.push(
                    SidebarItem::new("prisms", "Prisms")
                        .icon(IconKind::Layers)
                        .count(4)
                        .depth(1)
                        .active(self.active_nav == "prisms"),
                );
            }
            collection_items.push(
                SidebarItem::new("telemetry", "Telemetry")
                    .icon(IconKind::Folder)
                    .count(6)
                    .expanded(self.telemetry_expanded)
                    .active(self.active_nav == "telemetry"),
            );
            collection_items.push(
                SidebarItem::new("archive", "Archive")
                    .icon(IconKind::Database)
                    .count(3)
                    .active(self.active_nav == "archive"),
            );

            let rail = SidebarRail::new(
                "showcase_sidebar",
                vec![
                    SidebarSection {
                        title: "Workspace",
                        items: vec![
                            SidebarItem::new("catalog", "Catalog")
                                .icon(IconKind::Grid)
                                .count(12)
                                .active(self.active_nav == "catalog"),
                            SidebarItem::new("workbench", "Workbench")
                                .icon(IconKind::Cpu)
                                .count(6)
                                .active(self.active_nav == "workbench"),
                            SidebarItem::new("documents", "Documents")
                                .icon(IconKind::Document)
                                .count(42)
                                .active(self.active_nav == "documents"),
                            SidebarItem::new("processes", "Processes")
                                .icon(IconKind::Pulse)
                                .count(4)
                                .active(self.active_nav == "processes"),
                        ],
                    },
                    SidebarSection { title: "Collections", items: collection_items },
                    SidebarSection {
                        title: "Filters",
                        items: vec![
                            SidebarItem::new("filter-active", "Active")
                                .icon(IconKind::Filter)
                                .count(11)
                                .active(self.active_nav == "filter-active"),
                            SidebarItem::new("filter-queued", "Queued")
                                .icon(IconKind::Clock)
                                .count(3)
                                .active(self.active_nav == "filter-queued"),
                            SidebarItem::new("filter-attention", "Attention")
                                .icon(IconKind::Search)
                                .count(2)
                                .active(self.active_nav == "filter-attention"),
                        ],
                    },
                ],
            );

            if let Some(ev) = rail.show(ui, sb_rect) {
                match ev {
                    SidebarAction::Selected(id) => self.active_nav = id,
                    SidebarAction::Toggled(id) if id == "optics" => self.optics_expanded = !self.optics_expanded,
                    SidebarAction::Toggled(id) if id == "telemetry" => {
                        self.telemetry_expanded = !self.telemetry_expanded;
                    }
                    SidebarAction::Toggled(_) => {}
                }
            }
        }

        // Workspace tiled panes: main Catalog pane on left, Inspector + Operations stacked on right.
        let (catalog_rect, right_rect) = split_horizontal(shell.workspace, 0.63, 480.0, 380.0);
        let (inspector_rect, operations_rect) = split_vertical(right_rect, 0.72, 260.0, 170.0);

        let catalog_meta = format!("{} ITEMS", self.entries.len());
        let catalog_resp = Pane::new("pane_catalog", "Catalog", self.focused_pane == FocusedPane::Catalog)
            .meta(&catalog_meta)
            .shortcut("⌘1")
            .show(ui, catalog_rect, |ui| self.catalog_body(ui));
        if catalog_resp.header.clicked() {
            self.focused_pane = FocusedPane::Catalog;
        }

        let selected_name = self.entries.get(self.selected_row).map_or("NONE", |e| e.name.as_str()).to_ascii_uppercase();
        let inspector_resp = Pane::new("pane_inspector", "Inspector", self.focused_pane == FocusedPane::Inspector)
            .meta(&selected_name)
            .shortcut("⌘2")
            .left_rule(true)
            .scrollable(true)
            .show(ui, inspector_rect, |ui| self.inspector_body(ui));
        if inspector_resp.header.clicked() {
            self.focused_pane = FocusedPane::Inspector;
        }

        let ops_resp = Pane::new("pane_operations", "Operations", self.focused_pane == FocusedPane::Operations)
            .meta("4 RECENT")
            .shortcut("⌘3")
            .left_rule(true)
            .top_rule(true)
            .show(ui, operations_rect, |ui| self.operations_body(ui));
        if ops_resp.header.clicked() {
            self.focused_pane = FocusedPane::Operations;
        }

        // Bottom Status Bar.
        StatusBar::show(
            ui,
            shell.status_bar,
            |ui| {
                status_indicator(ui, "CONNECTED", true, StatusTone::Ok);
                status_item(ui, "12 ITEMS", color::SECONDARY);
                status_item(ui, "2 QUEUED", color::INFO);
                status_item(ui, "1 ERROR", color::ERROR);
            },
            |ui| {
                status_item(ui, "MEMORY 64.2%", color::SECONDARY);
                status_item(ui, "LATENCY 12.4 MS", color::SECONDARY);
                status_item(ui, "LOCAL", color::FAINT);
            },
        );
    }

    fn catalog_body(&mut self, ui: &mut Ui) {
        let width = ui.available_width();

        // Row of 4 metric summary tiles.
        let total_str = self.entries.len().to_string();
        let tiles = [
            MetricTileSpec::new("Total Items", &total_str).meta("4 GROUPS", StatusTone::Neutral).icon(IconKind::Grid),
            MetricTileSpec::new("Throughput", "482 /s").meta("+6.4%", StatusTone::Ok).icon(IconKind::Pulse),
            MetricTileSpec::new("Queue Depth", "2").meta("ACTIVE", StatusTone::Info).icon(IconKind::Clock),
            MetricTileSpec::new("Memory", "64.2%")
                .meta("10.3 GB", StatusTone::Neutral)
                .icon(IconKind::Cpu)
                .meter(0.642, StatusTone::Ok),
        ];
        metric_tile_row(ui, width, &tiles);

        ui.add_space(10.0);

        // Compact status summary & action bar.
        ui.allocate_ui_with_layout(vec2(width, 24.0), Layout::left_to_right(Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            status_chip(ui, "6 ACTIVE", StatusTone::Ok);
            status_chip(ui, "2 QUEUED", StatusTone::Info);
            status_chip(ui, "2 WARNING", StatusTone::Warn);
            status_chip(ui, "1 ERROR", StatusTone::Error);
            status_chip(ui, "1 IDLE", StatusTone::Neutral);

            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 12.0;
                unavailable_action(ui, "Publish", "Read only");
                let _ = word_button(ui, "Reset");
                let _ = word_button(ui, "Export");
            });
        });

        ui.add_space(10.0);

        // Dense booktabs table.
        let columns = [
            TableColumn::left("item", "Item", ColumnWidth::Weight(2.4)),
            TableColumn::left("kind", "Kind", ColumnWidth::Exact(76.0)),
            TableColumn::left("status", "Status", ColumnWidth::Exact(84.0)),
            TableColumn::left("load", "Load", ColumnWidth::Exact(126.0)),
            TableColumn::right("items", "Items", ColumnWidth::Exact(70.0)),
            TableColumn::right("latency", "Latency", ColumnWidth::Exact(82.0)),
            TableColumn::right("updated", "Updated", ColumnWidth::Exact(66.0)),
        ];

        let rows: Vec<TableRow> = self
            .entries
            .iter()
            .map(|e| TableRow {
                id: e.id.clone(),
                cells: vec![
                    TableCell::BadgeText {
                        badge: e.name.chars().next().unwrap_or('?').to_string(),
                        text: e.name.clone(),
                    },
                    TableCell::Muted(e.kind.clone()),
                    TableCell::Chip(e.status.clone(), e.tone),
                    TableCell::Usage {
                        fraction: e.load_pct,
                        label: format!("{:.0}%", e.load_pct * 100.0),
                        tone: crate::data::usage_bar_tone(e.load_pct),
                    },
                    TableCell::Number(format_grouped(e.items)),
                    TableCell::Number(format!("{:.1} ms", e.latency_ms)),
                    TableCell::Muted(e.updated.clone()),
                ],
            })
            .collect();

        let table_h = ui.available_height().max(metric::ROW * 4.0);
        let ev = DataTable::new("catalog_table", &columns, &rows)
            .selected(Some(self.selected_row))
            .sort(Some(self.sort))
            .max_height(table_h)
            .show(ui);

        if let Some(row) = ev.clicked_row {
            self.selected_row = row;
            self.focused_pane = FocusedPane::Catalog;
        }
        if let Some(sort) = ev.sort_changed {
            self.apply_sort(sort);
        }
    }

    fn inspector_body(&self, ui: &mut Ui) {
        let Some(entry) = self.entries.get(self.selected_row) else { return };
        let width = ui.available_width();

        item_header_tile(ui, width, &entry.name, &entry.name, Some(&format!("{} · v{}", entry.kind, entry.revision)));

        ui.add_space(8.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            status_chip(ui, &entry.status, entry.tone);
            status_chip(ui, &entry.kind, StatusTone::Neutral);
        });

        ui.add_space(8.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            let _ = key_button(ui, "⌘E", "Edit", true, None);
            let _ = key_button(ui, "⌘L", "Log", true, None);
            let _ = key_button(ui, "⌘D", "Drain", false, Some("Read only"));
        });

        ui.add_space(10.0);
        section_heading(ui, width, "Specification", None);
        ui.add_space(4.0);
        let item_ref = format!("astrolabe://catalog/{}/{}", entry.kind.to_ascii_lowercase(), entry.id);
        field_row(ui, width, "Reference", &item_ref, color::PARCHMENT, true);
        field_row(ui, width, "Revision", &entry.revision, color::PARCHMENT, true);
        field_row(ui, width, "Workers", &entry.workers.to_string(), color::PARCHMENT, true);
        field_row(ui, width, "P95 Latency", &format!("{:.1} ms", entry.p95_ms), color::PARCHMENT, true);
        field_row(ui, width, "Checked", &entry.checked, color::SECONDARY, true);

        ui.add_space(10.0);
        section_heading(ui, width, "Utilization", None);
        ui.add_space(4.0);
        labeled_usage_bar(ui, width, "Compute", entry.compute_pct, StatusTone::Ok, &format!("{:.0}%", entry.compute_pct * 100.0));
        labeled_usage_bar(ui, width, "Buffer", entry.buffer_pct, StatusTone::Warn, &format!("{:.0}%", entry.buffer_pct * 100.0));
        labeled_usage_bar(ui, width, "Cache", entry.cache_pct, StatusTone::Info, &format!("{:.0}%", entry.cache_pct * 100.0));
        labeled_usage_bar(ui, width, "Quota", entry.quota_pct, StatusTone::Error, &format!("{:.0}%", entry.quota_pct * 100.0));

        ui.add_space(10.0);
        section_heading(ui, width, "Relations", Some(&entry.relations.len().to_string()));
        ui.add_space(4.0);
        for (target, role) in &entry.relations {
            field_row(ui, width, role, target, color::PARCHMENT, true);
        }
    }

    fn operations_body(&self, ui: &mut Ui) {
        let columns = [
            TableColumn::left("command", "Command", ColumnWidth::Weight(1.8)).unsortable(),
            TableColumn::left("actor", "Actor", ColumnWidth::Exact(66.0)).unsortable(),
            TableColumn::left("status", "Status", ColumnWidth::Exact(74.0)).unsortable(),
            TableColumn::right("duration", "Duration", ColumnWidth::Exact(70.0)).unsortable(),
        ];

        let rows: Vec<TableRow> = self
            .operations
            .iter()
            .map(|op| TableRow {
                id: op.command.clone(),
                cells: vec![
                    TableCell::Number(op.command.clone()),
                    TableCell::Muted(op.actor.clone()),
                    TableCell::Chip(op.status.clone(), op.tone),
                    TableCell::Number(op.duration.clone()),
                ],
            })
            .collect();

        let table_h = ui.available_height().max(metric::ROW_COMPACT * 3.0);
        let _ = DataTable::new("operations_table", &columns, &rows)
            .row_height(metric::ROW_COMPACT)
            .max_height(table_h)
            .show(ui);
    }
}

fn format_grouped(n: u32) -> String {
    let s = n.to_string();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    for (i, ch) in s.chars().enumerate() {
        let rem = s.len() - i;
        if i > 0 && rem.is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use egui_kittest::{Harness, kittest::Queryable};

    use super::*;
    use crate::capture::{CaptureConfig, render_ui_png};
    use crate::theme;

    fn sample_output_path() -> PathBuf {
        if let Some(custom) = std::env::var_os("ASTROLABE_KIT_SAMPLE_PATH") {
            return PathBuf::from(custom);
        }
        if let Some(home) = std::env::var_os("HOME") {
            let scratch = PathBuf::from(home).join(".worktrees").join("astrolabe").join("scratch");
            if scratch.is_dir() {
                return scratch.join("kit-sample.png");
            }
        }
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("kit-sample.png")
    }

    #[test]
    fn showcase_interactions_work_headless() {
        let mut installed = false;
        let mut harness = Harness::builder()
            .with_size(vec2(1440.0, 900.0))
            .build_ui_state(
                move |ui, state: &mut ShowcaseState| {
                    if !installed {
                        theme::install(ui.ctx());
                        installed = true;
                    }
                    state.show(ui);
                },
                ShowcaseState::sample(),
            );
        harness.run_steps(3);

        // Selecting a table row updates the selected entry.
        harness.get_by_label("transit-ledger").click();
        harness.run_steps(2);
        assert_eq!(harness.state().entries[harness.state().selected_row].id, "transit-ledger");

        // Clicking a sidebar item switches active navigation.
        harness.get_by_label("Documents").click();
        harness.run_steps(2);
        assert_eq!(harness.state().active_nav, "documents");

        // Clicking the Inspector pane header moves pane focus.
        harness.get_by_label("Inspector").click();
        harness.run_steps(2);
        assert_eq!(harness.state().focused_pane, FocusedPane::Inspector);

        // Clicking a sortable column header updates sort order.
        harness.get_by_label("Latency").click();
        harness.run_steps(2);
        assert_eq!(harness.state().sort, SortState { column: 5, ascending: true });
        assert_eq!(harness.state().entries[0].id, "declination-map");
    }

    #[test]
    fn showcase_renders_offscreen_png() {
        let out_path = sample_output_path();
        let config = CaptureConfig { size: vec2(1440.0, 900.0), pixels_per_point: 2.0, steps: 5 };
        let mut state = ShowcaseState::sample();

        let output = render_ui_png(&out_path, &config, |_| {}, |ui| state.show(ui))
            .expect("offscreen showcase render");

        assert!(output.path.is_file(), "expected sample PNG at {}", output.path.display());
        assert_eq!((output.width, output.height), (2880, 1800));

        let decoded = image::open(&output.path).expect("valid PNG").to_rgba8();
        assert_eq!(decoded.dimensions(), (2880, 1800));
        // Confirm the frame contains multiple distinct dark mineral and text colors (not blank).
        let first = *decoded.get_pixel(0, 0);
        let non_uniform = decoded.pixels().any(|px| *px != first);
        assert!(non_uniform, "rendered screenshot must not be a single flat color");
    }
}
