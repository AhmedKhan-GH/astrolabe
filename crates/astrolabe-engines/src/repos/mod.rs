//! Headless repository monitoring engine for Astrolabe.

pub mod actions;
pub mod aggregate;
pub mod config;
pub mod demo;
pub mod discover;
pub mod engine;
pub mod git;
pub mod github;
pub mod github_list;
pub mod index;
pub mod model;
pub mod organize;
pub mod paths;
pub mod query;
pub mod related;
pub mod remote;
pub mod state;
pub mod tags;
pub mod view;
pub mod watch;

pub use aggregate::Totals;
pub use demo::{DEMO_NOW_SECS, DemoData, demo_data, demo_data_at};
pub use engine::{Cmd, Engine, Msg};
pub use github::{Error as GitHubError, Fetched, GitHub, Origin, RateLimit};
pub use index::Index;
pub use model::{
    Changes, Commit, Config, CopyDiff, Discovery, Found, GhListedRepo, GhRepo, Head, Ide, IdeSource, Override,
    Relation, Remote, RemoteCheck, RemoteUrl, Repo, Root, Stash, Stats, Submodule, SubmoduleState, THIRD_PARTY, Tip,
    Worktree, tag_slug,
};
pub use organize::{Folder, Organize, RepoKeys};
pub use query::{Facts, ParseError, Query, Term};
pub use state::State;
pub use view::{Density, Flag, Grouping, Nav, Prefs, Section, SectionKey, Sort};
pub use watch::{WatchEvent, WatchedRepo, Watcher};
