//! The contract every Astrolabe tool implements.
//!
//! A tool is a specialised interface (a library, a canvas, a reader, a board). Whatever it is, it exposes the same
//! four things, so that a person and an agent can work in it the same way and one tool's output can become another's
//! input:
//!
//! - **commands:** every action is a named command with typed parameters and a result ([`CommandSpec`],
//!   [`Invocation`], [`Outcome`]). The tool's own buttons call these commands too; there is no second, private path.
//! - **inspection:** the tool answers structured questions about what it holds ([`Tool::inspect`]).
//! - **rendering:** the tool can draw or export what it holds, so the result of an action can be checked
//!   ([`Tool::render`]).
//! - **references:** everything a tool holds has a stable [`ItemRef`] that other tools can point at.
//!
//! See `docs/architecture.md` for how the host, the agent runtime and workflows use this contract.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

/// A stable reference to something a tool holds, valid across tools and sessions.
/// Written as `astrolabe://<tool>/<kind>/<id>`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ItemRef {
    pub tool: String,
    pub kind: String,
    pub id: String,
}

impl fmt::Display for ItemRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "astrolabe://{}/{}/{}", self.tool, self.kind, self.id)
    }
}

/// What running a command can do, which decides whether an agent needs the person's approval first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Effect {
    /// Reads only.
    Read,
    /// Changes the tool's documents and can be undone.
    Write,
    /// Deletes, overwrites or otherwise cannot be undone. An agent asks first.
    Destructive,
    /// Reaches outside the machine (sends, publishes, pays). An agent asks first.
    External,
}

/// One entry in a tool's command catalogue.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandSpec {
    /// Namespaced by the tool, e.g. `library.tag.add`.
    pub id: String,
    /// One plain sentence: what the command does.
    pub summary: String,
    /// JSON Schema of the parameters.
    pub params: Value,
    /// JSON Schema of the result.
    pub result: Value,
    pub effect: Effect,
}

/// Who asked for a command to run. Every entry in the history says who acted.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Actor {
    Person,
    Agent { name: String },
    Workflow { id: String },
}

/// A request to run one command.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Invocation {
    pub command: String,
    pub params: Value,
    pub actor: Actor,
}

/// What running a command produced.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Outcome {
    pub result: Value,
    /// The items the command created or changed, so the host can tell other tools and the agent what moved.
    pub changed: Vec<ItemRef>,
    /// The invocation that would reverse this one, when the command can be undone.
    pub undo: Option<Invocation>,
}

/// A request to draw or export an item.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RenderRequest {
    /// A media type the tool lists in [`Tool::render_formats`], e.g. `image/png` or `image/svg+xml`.
    pub media_type: String,
    /// Pixel size for raster output; ignored for vector formats.
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// A drawn or exported item.
#[derive(Clone, Debug)]
pub struct Rendered {
    pub media_type: String,
    pub bytes: Vec<u8>,
}

/// A file format a tool can read in or write out.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Format {
    pub media_type: String,
    pub extensions: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolError {
    UnknownCommand(String),
    BadParams(String),
    NotFound(ItemRef),
    Unsupported(String),
    Failed(String),
}

impl fmt::Display for ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ToolError::UnknownCommand(c) => write!(f, "unknown command {c}"),
            ToolError::BadParams(m) => write!(f, "bad parameters: {m}"),
            ToolError::NotFound(r) => write!(f, "not found: {r}"),
            ToolError::Unsupported(m) => write!(f, "unsupported: {m}"),
            ToolError::Failed(m) => write!(f, "failed: {m}"),
        }
    }
}

impl std::error::Error for ToolError {}

/// A specialised interface inside Astrolabe. Tools built in Rust implement this directly; tools in other languages
/// run as their own process and are wrapped by an adapter that speaks the same contract over a control port.
pub trait Tool {
    /// Short and stable, e.g. `library`. Prefixes every command id and item reference.
    fn id(&self) -> &str;

    /// Every action the tool offers. The tool's UI calls these same commands.
    fn catalogue(&self) -> Vec<CommandSpec>;

    /// Run one command.
    fn invoke(&mut self, invocation: &Invocation) -> Result<Outcome, ToolError>;

    /// Answer a structured question about an item, e.g. its fields, its children, its links.
    fn inspect(&self, item: &ItemRef, query: &Value) -> Result<Value, ToolError>;

    /// Media types [`Tool::render`] can produce.
    fn render_formats(&self) -> Vec<Format>;

    /// Draw or export an item, so the result of an action can be looked at and checked.
    fn render(&self, item: &ItemRef, request: &RenderRequest) -> Result<Rendered, ToolError>;

    /// Formats the tool can bring in (as items) and write out.
    fn imports(&self) -> Vec<Format> {
        Vec::new()
    }
    fn exports(&self) -> Vec<Format> {
        Vec::new()
    }
}
