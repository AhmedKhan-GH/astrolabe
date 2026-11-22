//! Headless agent and local model monitoring module for Astrolabe: installed
//! tool discovery, live provider limit and balance readers, and local Ollama
//! model memory tracking.

pub mod demo;
pub mod engine;
pub mod keychain;
pub mod limits;
pub mod model;
pub mod paths;
pub mod pty;
pub mod tools;
pub mod zcode;

pub use demo::{DEMO_NOW_SECS, demo_data, demo_data_at};
pub use engine::{AGENTS_EVERY, Cmd, Config, Engine, MIN_GAP, Shared};
pub use model::{
    Balance, Limit, Loaded, MemorySample, ModelActivity, OllamaModel, OllamaState, Provider, Status, StatusSummary,
    UsageLevel, Window, elapsed, gb, grouped, loaded_memory_bytes, local_time, memory_level, now, percent,
    sorted_ollama_models, summarize_limits, until, usage_level,
};
pub use tools::{Agent, Env, Kind, SignIn, detect};
