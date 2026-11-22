# Product Direction

This document records the product conclusions from November 8, 17, and 18, 2026. It includes the founder's product definition from November 22, 2026.

## Purpose

Astrolabe is the founder's productivity app. It takes on the containerized Artisan workflows, Repo Monitor, and Agent Monitor. The founder uses it to create clean, refined workflows that carry the difficult parts of work, such as literature and taste. The founder can observe each workflow as it runs and intervene when necessary.

The positioning from November 18 defines the intended result. Astrolabe takes a workflow that works for one person and runs it at production scale, with expertise built in. The same workflow definition applies on one machine, on hosted capacity, in parallel, and for a team. A change of scale must not require a new workflow.

Astrolabe combines agent orchestration with specialized interfaces. Each tool keeps an interface that fits its work, and shared context connects the tools. A document, selection, source, or link can pass between tools. The person chooses where agents can act and can observe the result in the same tools.

## Pain Points as Requirements

The November 18 review identifies nine pain points across the projects. Four requirements matter most: **an agreed spec, durable feedback, visibility with evidence, and a durable ledger**. These four make the work trustworthy. Agent routing, managed environments, and hosted capacity extend that foundation.

**Work from the wrong brief.** Agents produced the wrong weight-space demo, moved Repo Monitor away from Artisan style, and wrote Atlas drafts that missed the intended result. Each task must start with a short plan that the person approves. That agreed spec must govern the work and the checks against its result.

**Repeated corrections.** Style instructions and other rules required repeated explanation across sections, agents, and memory files. A correction must become a durable rule or check. Every agent and model must inherit it, and each later run must benefit from the correction.

**Hidden progress.** The person had to request status and inspect background runs by hand. Astrolabe must show every run's progress, changes, and blockers as they occur. It must notify the person when a run needs attention.

**Claims without proof.** Reports of complete work required further checks, and unreliable tests weakened those reports. Every claim must carry its evidence. Tests, captures, and diffs must remain with the result that they support.

**Separate agents, accounts, and limits.** Claude, Codex, Kimi, GLM, Antigravity, and Ollama each brought separate limits, sign-ins, permission prompts, and CLI behavior. Astrolabe must provide one layer across agents. It must route tasks by the required model and available capacity. Agent Monitor provides the basis through its view of limits across providers.

**Overloaded machines and abandoned resources.** Machines became unresponsive, build jobs needed limits, and agent runs left applications open. Environments must have resource budgets and cleanup when a run ends. Work must have access to more capacity when the local machine is full.

**Repeated boundaries.** Instructions about repository copies, pushes, protected machines, and email required repeated statements. These rules must belong to the workspace. Astrolabe must apply them to every agent through each tool's standard permission settings.

**Lost work and context.** Context compaction, scratchpad loss after a reboot, uncommitted work, and queues held only in conversation caused gaps between sessions. A durable ledger must retain open work, decisions, and handoffs. It must outlast individual sessions and remain useful across machines.

**Mixed project threads.** Work on Caliper, Atlas, the monitors, Artisan, and weight-space shared one conversation. Each project must have a separate thread with its own state. The person must be able to see those threads from one place.

## Workflow Definition

A workflow is a spec, plus its rules and checks, plus its evidence, plus its history. The spec records the intended result before work starts. Rules and checks carry the constraints and the means to assess that result. Evidence supports the claims from each run, and history preserves the work and its corrections.

One definition applies at every scale. The workflow that runs locally must also run on hosted capacity, in parallel, and for a team without a rewrite. Environments and workflows need explicit declarations to support this transfer. The declared workflow format remains an open design decision.

Literature and taste enter the workflow through rules, checks, and curated sources. Literature supplies sources that support the work and its evidence. Taste supplies standards for the result, and corrections turn those standards into repeatable checks. The Atlas writing loop in `PROCESS.md` provides an example of a method that retains feedback.

Curated expertise must arrive as a tested, versioned workflow with evaluations. A team can then assess the workflow through its results before it adopts the method. Each correction improves the rules or checks, and each run adds history and evidence.

Observation must scale with execution. Local and hosted agents must appear in the same interfaces with the same budgets and history. The person must retain the ability to observe work and intervene as capacity grows.

## Layer Model

Astrolabe is the product across five layers. The host and `astrolabe-contract` connect specialized tools within this system. The layer model gives each existing project a place, and the consolidation order below governs when their code comes together.

**Environments** provide the places where agents run. Artisan supplies the first environment type: a desktop VM where agents use real applications. Alchemist is another instance of that environment type. Containers and hosted capacity also belong in this layer. Astrolabe orchestrates Artisan as an environment, while the Craft apps remain applications that agents use there.

**Orchestration** determines which agent runs which task, where it runs, when it runs, and its budget. Loggia supplies the company's own installation of Astrolabe. Its code becomes the orchestration layer, and its installation runs the company's functions. Agent Monitor's limits inform orchestration decisions.

**Interfaces** let the person observe and steer agents through views that fit the work. Repo Monitor, Agent Monitor, Artisan Apps, and the Craft apps occupy this layer. Caliper remains a separate C++ product for machine learning. Astrolabe embeds its views through Caliper Embed, which makes Caliper an expert interface within Astrolabe.

**Workflows** package expertise with checks and evidence. The Atlas writing loop belongs here, alongside design and research workflows. Observations from runs refine these workflows. Environments run the agents, orchestration schedules them, and interfaces expose the results for review before the next run.

**Backbone** services provide shared accounts, sync, licensing, and billing across products. The sources call this shared backend Alidade, but that name also identifies the learning platform. The backend name remains open. Local work must not depend on the server's availability.

## Consolidation Order

First, extract a shared Rust kit from the existing Artisan components. It contains the theme, app shell, settings, Keychain access, SQLite store, and CLI probe runner. Repo Monitor, Agent Monitor, and Artisan Apps use this kit while each remains a separate app. The duplicated monitor themes provide the first concrete extraction.

Next, when the next tool starts, put both monitors on `astrolabe-contract` as standalone tools. The contract can settle through use while the tools continue to ship. The same contract then supports the later host.

Finally, build one Astrolabe app when views across tools become necessary. The contract must also remain free of incompatible changes for a few weeks before this step. The host can then present tools as panels. A useful shared view connects an agent run, its token use, its repository, and its commits. These connections supply the reason to combine the apps.

## First Release

The first release covers the interfaces layer, with Agent Monitor as its first tool. Its standalone view of subscription limits gives people an immediate use for the system. The other layers can remain internal and serve Loggia until they are ready for release.

This release follows the consolidation order. The shared kit and the tool contract establish the foundation before one app combines the tools. The declaration of workflows remains a design priority alongside that contract.

## Existing Solutions and Gap

The table records the source assessment dated **November 18, 2026**. The field changes monthly, and a fresh survey is pending.

| Need | Existing Solutions | Gap in the November 18 Assessment |
|---|---|---|
| Spec before work | Kiro, GitHub Spec Kit, Tessl, plan modes in Claude Code, Cursor, and Codex | Specs stay within one tool or session and do not govern work and its checks. |
| Durable feedback and rules | `AGENTS.md`, `CLAUDE.md`, Cursor rules, Claude Code skills and memory, promptfoo, Braintrust, Langfuse | Agents can ignore text rules. Evaluation tools target AI application developers instead of people who correct agent work. |
| Visibility of agents | Conductor, Vibe Kanban, Claude Squad, Crystal, Sculptor, Claude Code on the web, Codex cloud, Cursor background agents, Devin, LangSmith, Langfuse, Arize Phoenix | Most views cover code or one vendor. Tracing tools serve developers who debug their own pipelines. |
| Evidence for claims | Pull-request workflows with CI, GitHub's Copilot agent, Devin, session recordings | Evidence covers code, with no equivalent for designs, documents, or research. |
| Agents, accounts, and limits | OpenRouter, LiteLLM, Portkey, OpenCode, Goose, Aider, ccusage, menu-bar limit monitors | Gateways route API calls, not subscription CLIs with separate quotas. They do not rank available capacity across subscriptions as Agent Monitor does. |
| Environments and capacity | E2B, Daytona, Modal, Runloop, Morph, Tart, MacStadium's Orka, Cua | Infrastructure lacks connections to workflows, rules, and visibility. Desktop VMs are rare, and Mac hosting is costly. |
| Workspace boundaries | Claude Code and Codex permission settings and sandbox modes, guardrail tools | Each tool needs separate configuration of the same rules. |
| Durable ledger | Linear, GitHub Issues, Beads, Taskmaster, Temporal, Inngest, Restate | Trackers lack knowledge of actual agent actions. Durable execution engines are developer frameworks rather than workspaces. |
| Packaged workflows and expertise | Apify's Store, Claude skills and plugin marketplaces, n8n and Zapier templates, GPT Store | Templates lack measured results that establish whether a workflow works before adoption. |

The assessment identifies a gap around the complete workflow: spec, rules, evidence, and history. No listed product joins that definition across vendors and across local and hosted environments, including desktop VMs. Astrolabe must expose the work through specialized interfaces and preserve observation as the work scales.

The nearest products cover parts of this requirement. Conductor and Vibe Kanban manage multiple local agents for code. Devin and Copilot's agent connect a spec to an evidenced pull request within one vendor's system. Cua supplies desktop VM infrastructure. The assessment describes Apify as a marketplace with hosting, without agents or specialized interfaces for this work.

Astrolabe can use existing infrastructure where it meets these requirements. Sandbox providers can supply capacity, and standard permission settings can apply workspace rules. A durable execution engine could support the ledger, but the sources do not select one. The product's value lies in the connections between these parts. A fresh survey must inform architecture choices that depend on this assessment.
