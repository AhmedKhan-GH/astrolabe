//! Headless live monitoring engines for Astrolabe.
//!
//! - [`repos`]: repository discovery, read-only Git inspection, GitHub remote
//!   visibility, filesystem watching, tagging, query filtering, sorting,
//!   grouping, and host actions.
//! - [`agents`]: installed agent tool discovery, live provider quota and
//!   balance readers, Ollama model memory tracking, and reset/status helpers.
//!
//! Both modules also provide deterministic synthetic fixtures (`repos::demo_data`
//! and `agents::demo_data`) for `--demo` mode.

pub mod agents;
pub mod repos;
