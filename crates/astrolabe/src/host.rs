//! Host command layer that routes invocations to registered tools and records execution history.

use astrolabe_contract::{Actor, CommandSpec, Effect, Invocation, Outcome, Tool, ToolError};

/// One entry in the shared history.
pub struct Entry {
    pub invocation: Invocation,
    pub outcome: Outcome,
}

/// Routes commands to tools and records everything that ran.
#[derive(Default)]
pub struct Host {
    tools: Vec<Box<dyn Tool>>,
    pub history: Vec<Entry>,
}

impl Host {
    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    /// Every command of every registered tool: what an agent, the command palette and the MCP surface all see.
    pub fn catalogue(&self) -> Vec<CommandSpec> {
        self.tools.iter().flat_map(|t| t.catalogue()).collect()
    }

    /// Whether this invocation must wait for the person's approval: agents and workflows ask before anything that
    /// cannot be undone or that reaches outside the machine.
    pub fn needs_approval(&self, invocation: &Invocation) -> bool {
        if invocation.actor == Actor::Person {
            return false;
        }
        self.catalogue()
            .iter()
            .find(|c| c.id == invocation.command)
            .is_some_and(|c| matches!(c.effect, Effect::Destructive | Effect::External))
    }

    pub fn invoke(&mut self, invocation: Invocation) -> Result<&Entry, ToolError> {
        let tool_id = invocation.command.split('.').next().unwrap_or_default().to_owned();
        let tool = self
            .tools
            .iter_mut()
            .find(|t| t.id() == tool_id)
            .ok_or_else(|| ToolError::UnknownCommand(invocation.command.clone()))?;
        let outcome = tool.invoke(&invocation)?;
        self.history.push(Entry { invocation, outcome });
        Ok(self.history.last().expect("just pushed"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use astrolabe_contract::{Format, ItemRef, RenderRequest, Rendered};
    use serde_json::{Value, json};

    /// A toy tool: a list of notes, enough to exercise the command layer.
    struct Notes(Vec<String>);

    impl Tool for Notes {
        fn id(&self) -> &str {
            "notes"
        }
        fn catalogue(&self) -> Vec<CommandSpec> {
            vec![
                CommandSpec {
                    id: "notes.add".into(),
                    summary: "Add a note.".into(),
                    params: json!({"type": "object"}),
                    result: json!({}),
                    effect: Effect::Write,
                },
                CommandSpec {
                    id: "notes.clear".into(),
                    summary: "Delete every note.".into(),
                    params: json!({"type": "object"}),
                    result: json!({}),
                    effect: Effect::Destructive,
                },
            ]
        }
        fn invoke(&mut self, inv: &Invocation) -> Result<Outcome, ToolError> {
            match inv.command.as_str() {
                "notes.add" => {
                    let text = inv.params["text"].as_str().ok_or_else(|| ToolError::BadParams("text".into()))?;
                    self.0.push(text.to_owned());
                    let id = (self.0.len() - 1).to_string();
                    Ok(Outcome {
                        result: json!({"id": id}),
                        changed: vec![ItemRef { tool: "notes".into(), kind: "note".into(), id }],
                        undo: None,
                    })
                }
                "notes.clear" => {
                    self.0.clear();
                    Ok(Outcome::default())
                }
                other => Err(ToolError::UnknownCommand(other.into())),
            }
        }
        fn inspect(&self, item: &ItemRef, _query: &Value) -> Result<Value, ToolError> {
            let i: usize = item.id.parse().map_err(|_| ToolError::NotFound(item.clone()))?;
            self.0.get(i).map(|t| json!({"text": t})).ok_or_else(|| ToolError::NotFound(item.clone()))
        }
        fn render_formats(&self) -> Vec<Format> {
            vec![Format { media_type: "text/plain".into(), extensions: vec!["txt".into()] }]
        }
        fn render(&self, item: &ItemRef, _r: &RenderRequest) -> Result<Rendered, ToolError> {
            let v = self.inspect(item, &Value::Null)?;
            Ok(Rendered {
                media_type: "text/plain".into(),
                bytes: v["text"].as_str().unwrap_or_default().as_bytes().to_vec(),
            })
        }
    }

    #[test]
    fn routes_records_and_gates() {
        let mut host = Host::default();
        host.register(Box::new(Notes(Vec::new())));
        let agent = Actor::Agent { name: "test".into() };

        let entry = host
            .invoke(Invocation { command: "notes.add".into(), params: json!({"text": "hello"}), actor: agent.clone() })
            .unwrap();
        assert_eq!(entry.outcome.changed[0].to_string(), "astrolabe://notes/note/0");
        assert_eq!(host.history.len(), 1);

        let clear = Invocation { command: "notes.clear".into(), params: json!({}), actor: agent };
        assert!(host.needs_approval(&clear));
        assert!(!host.needs_approval(&Invocation { actor: Actor::Person, ..clear }));
        assert!(
            host.invoke(Invocation { command: "canvas.draw".into(), params: json!({}), actor: Actor::Person }).is_err()
        );
    }
}
