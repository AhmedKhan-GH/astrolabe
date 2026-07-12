# Learner Model & Pedagogy — Design Spec (Layer 5)

**Date:** 2026-07-12 · **Status:** design direction (far-horizon; gated on the graph + reading-state)
**Roadmap home:** docs/2026-07-10-intelligence-layer-roadmap.md **Layer 5** — the user as the
objective function. This is the detailed pedagogy spec for that layer.
**Prerequisites (must exist first):** the knowledge graph (Layers 1–2), reading-state tracking
(the deferred Canvas read/finished heat layers), and the ACP agent harness (Layer 4 — done).

---

## 0. Thesis

A task agent optimizes task completion. **This agent's loss function is the user's knowledge
state** — durable, connected, transferable understanding of a subgraph the user chose. It is
intelligence augmentation made literal: the system observes what the user knows (from their own
library activity), diagnoses gaps, intervenes with research-validated methods grounded in the
user's own sources, measures the response, and updates its model. The user is the environment;
the knowledge-state overlay is the observation; interventions are actions; **measured durable
understanding is the reward.**

## 1. The core design problem: cognitive offloading

Astrolabe *is* an external memory, and external memory is cognitive offloading. The literature
(Risko & Gilbert 2016 on offloading; Sparrow, Liu & Wegner 2011 "Google effects on memory";
Clark & Chalmers 1998, the extended-mind thesis) shows offloading **reduces internal encoding**
and manufactures an **illusion of competence** — the user *feels* they know something because
they can retrieve it from the tool, not from themselves. A second brain that only offloads can
make the user know less while feeling they know more.

Therefore the learner model's central job is NOT "teach everything." It is to decide, **per
concept, continuously**, whether offloading serves understanding or sabotages it — when to be a
good external memory (hold it, surface on demand, never nag) versus when to force internalization
(demand unaided retrieval, apply desirable difficulty). That decision — made against the user's
own graph, and made *honestly* — is the thing no note app does and the reason this layer exists.

**This is the inviolable reframe:** the system is aware of *when to remember for the user and
when to make the user remember.* Everything below serves that.

## 2. First principles (inviolable stances)

1. **The research is the representation, not decoration.** Encode the science's *constructs* as
   state, its *validated interventions* as the action space, its *definition of understanding* as
   the objective function. The system is principled because its representation IS the theory —
   not because a theory's name is printed in the UI.
2. **User-chosen objective (autonomy).** The user sets goals and marks, per concept/subgraph,
   *internalize* vs. *reference-only*. The system never decides unilaterally what the user "should"
   know. A tutor optimizing what it thinks you should learn is a paternalistic taskmaster.
3. **Transparency + correctability.** The system's model of the user's knowledge state is visible
   and user-editable — the same curation discipline as the graph (user assertions outrank
   inference). A hidden model of the user's mind is the failure mode.
4. **Measure real outcomes, never proxies.** Reward durable transfer, not clicks, streaks, or
   time-in-app. A streak-optimizing tutor is the enemy of the goal.
5. **Grounded in the user's own sources.** Every intervention cites the user's library — a
   question is drawn from *their* annotation, a prerequisite from *their* graph. Never generic.
6. **Reflexive grounding.** The pedagogy literature is itself ingested as an Astrolabe corpus, so
   the system's teaching principles are graph-grounded, citeable, and updatable as the user reads
   more — not frozen dogma baked into code (see §8).
7. **On-device, private (D5/D7 ethos).** The knowledge-state overlay and learner model are derived,
   rebuildable, and never leave the machine. A model of someone's mind is the most sensitive
   artifact the app holds.

## 3. Research foundation → system mapping

Each row maps a framework to the construct it contributes, how the system *represents* that
construct, and the intervention it licenses. **These citations are the design's starting basis and
MUST be verified against the ingested corpus (§8) rather than trusted to memory — the reflexive
principle applies to this very table.**

| Framework (basis) | Construct | System representation | Intervention licensed |
|---|---|---|---|
| Offloading (Risko & Gilbert 2016; Sparrow 2011); extended mind (Clark & Chalmers 1998) | Offload vs. internalize; competence illusion | Per-node `internalize` target + `offload_ok` flag; fluency-vs-retrieval gap | The offloading policy (§4.2); the metacognitive mirror (§4.6) |
| Testing effect / retrieval practice (Roediger & Karpicke 2006) | Retrieval strengthens more than re-exposure | `retrieval_count`, `retrieval_success` per node | Socratic recall prompts from the user's sources — not re-presentation |
| Spacing (Ebbinghaus; Cepeda et al. 2006) | Expanding-interval review beats massing | `recency`, forgetting-curve estimate per node | Spaced review scheduling on the decay estimate |
| Desirable difficulties (Bjork) | Effortful retrieval → durable learning | Difficulty calibration vs. current mastery | Titrate prompt difficulty; withhold the easy lookup when internalizing |
| Generation effect (Slamecka & Graf 1978) | Generating > reading | Track whether the user produced vs. consumed the answer | Ask the user to explain *before* revealing the source |
| Self-explanation / elaborative interrogation (Chi) | "Why/how" builds schema | The graph's typed edges = the elaborations to probe | "Why does this annotation support that claim?" edge-probes |
| Levels of processing (Craik & Lockhart 1972); Bloom | Depth: read < annotate < write < explain < apply | `depth` achieved per node (from library activity) | Push up the ladder; recall → relate → apply → synthesize |
| Metacognition/calibration (Dunlosky; Koriat) | Learners misjudge what they know | Compare user's stated confidence to measured state | Surface overconfidence/underconfidence; recalibrate |
| ZPD (Vygotsky) | Learn at the frontier of the known | Graph frontier: nodes adjacent to mastered-but-untouched | Target interventions at the frontier, not the core or the far edge |
| Interleaving (Rohrer) | Mixing topics > blocking | Sample across the goal subgraph, not one cluster | Interleave concepts within a session |
| Cognitive load (Sweller) | Working memory is finite; scaffold | Session intensity budget | Cap new-concept load; scaffold multi-step chains |

## 4. Architecture

### 4.1 The knowledge-state overlay (the observation)

Per graph node (concept/claim/entity and document), a derived, rebuildable state record. Evidence
comes from **existing streams — zero extra tokens, no interrogation to observe:**

```
KnowledgeState(nodeId) {
  // Engagement evidence (all from sync/reading activity, passive)
  read: boolean | dwell_ms          // Canvas/lightbox reading-state (prerequisite)
  annotated: count                  // indexed Zotero annotations on the node's sources
  written_about: count              // wiki-links FROM the user's notes to the node
  discussed: count                  // ACP dialogue links (Layer 4→5 seam, already persisted)
  // Active-recall evidence (from the tutor's own prompts)
  retrieval_count, retrieval_success_rate
  last_retrieved_at                 // feeds the forgetting curve
  generated_vs_consumed             // generation-effect signal
  depth_reached: read|annotate|write|explain|apply   // levels of processing
  // Derived estimates
  mastery: 0..1                     // retrieval success × depth, decayed by recency
  connectivity: 0..1                // can the user relate this to its graph neighbors?
  durability_estimate                // forgetting-curve half-life
  // User-set policy (autonomy)
  target: internalize | reference   // the offloading decision input
  user_confidence: 0..1 | null      // self-report, for calibration
}
```

`mastery`/`connectivity`/`durability` are functions over the evidence; the forgetting curve makes
`mastery` decay with time-since-retrieval (spacing). **This overlay is the forgetting-curve model
itself**, per node, over the graph.

### 4.2 The offloading policy (the load-bearing decision)

For each node the system continuously classifies the right stance, grounded in the graph, not a
guess:

- **Internalize** when: the node is load-bearing (high graph centrality / a prerequisite along a
  goal subgraph edge), OR the user flagged `target: internalize`, OR the user cites it often but
  has never retrieved it unaided (high `written_about`/`discussed`, zero `retrieval_success`).
- **Reference / offload-OK** when: peripheral, low centrality, not on a goal path, and not flagged —
  the system holds it, surfaces it on demand, and does NOT nag.

The policy governs behavior: for *internalize* nodes the system applies retrieval practice, spacing,
and desirable difficulty (may withhold the easy lookup); for *reference* nodes it is a frictionless
external memory. **This is the direct operationalization of the offloading research** — the system
is aware of when offloading serves the user and when it sabotages them.

### 4.3 The objective function (what "understanding" is)

Over the user-chosen goal subgraph G:

```
Understanding(G) = Σ_{n ∈ internalize(G)}  w(n) · mastery(n) · connectivity(n) · durability(n) · transfer(n)
```

- `w(n)` = the node's importance (centrality / goal-proximity).
- `transfer(n)` = success applying n to a *new* node (Bloom's higher tiers), the hardest and most
  valuable signal.
- Explicitly NOT engagement, completion, or coverage. A concept "covered" but not durable/connected
  scores ~0.

### 4.4 The action space (interventions, each cited)

Only research-validated actions, each traceable to §3, each grounded in the user's sources:

1. **Retrieval prompt** — a Socratic recall question generated from the user's own annotation/note,
   answer withheld (testing effect + generation effect).
2. **Spaced review** — scheduled on the node's decay estimate at expanding intervals (spacing).
3. **Elaboration probe** — "why does X connect to Y?" over a real graph edge (self-explanation).
4. **Frontier suggestion** — "read pages 140–162 next" / "this concept sits between what you know
   and what you're reaching for" (ZPD).
5. **Interleaved set** — a mixed micro-session across the goal subgraph (interleaving).
6. **Worksheet** — scaffolded problems built from the user's annotations, ramping difficulty
   (desirable difficulty + cognitive-load scaffolding). (Reuses the existing worksheet skill.)
7. **Calibration check** — ask confidence, compare to measured state, surface the gap
   (metacognition).
8. **Synthesis request** — "reconstruct this argument from memory," graded against the source
   (top of Bloom; also the strongest anti-offloading move).

Actions are executed by the **ACP agent** (Layer 4) with a *tutor system prompt* grounding it in
the frameworks + the retrieved subgraph; the agent is the delivery mechanism, the learner model is
the policy.

### 4.5 The loop

```
observe   → ingest passive evidence from sync/reading/dialogue (zero tokens) → update overlay
diagnose  → frontier nodes; prerequisite gaps along edges; high-centrality-never-retrieved;
            mastery decayed past its half-life; offloading-policy classification per node
intervene → choose the action (agent-delivered, source-grounded) at the right difficulty
measure   → record the response as retrieval evidence; did mastery rise? did it survive the next
            spaced check? did the user relate/apply it unaided?
update    → adjust the overlay AND the intervention policy (what worked for THIS user)
```

The **measure→update** arc is what makes the system *aware* rather than a textbook-rule reciter:
it validates its own interventions and adapts to the individual. Without it, this is theater.

### 4.6 The metacognitive mirror (the headline mechanism)

Because the system holds *objective* knowledge-state, it can do the single most evidence-backed and
most-unique thing: **counter the fluency illusion.** "You cite this paper constantly and it's
richly annotated, but you have never reconstructed its argument unaided and can't currently relate
it to the three adjacent papers — here's a retrieval prompt." This falls directly out of having the
graph + the overlay, requires no new infrastructure beyond them, and is the intervention no tool in
the user's stack performs. It should be the FIRST thing built once the prerequisites exist (§9).

### 4.7 Reflexive grounding — the pedagogy lives in the graph

The system's own operating principles are ingested as an Astrolabe corpus (the cognitive-science
literature). Consequences:
- The tutor's methods are **graph-grounded and citeable** — when it applies spacing, it can point
  to the paper; the §3 table becomes queryable graph nodes, not hard-coded constants.
- As the user reads new/revising research, the system's behavior can **update** — its pedagogy is
  part of the user's knowledge base, not my assumptions frozen in code.
- It closes the loop philosophically: Astrolabe teaches the user *about learning* using the same
  machinery it uses to teach everything else, and is transparent about its own basis.

## 5. Data model (first-party artifacts, `.astrolabe/`)

- `knowledge-state/` — the derived overlay (rebuildable from the graph + activity logs; **never a
  system of record**). Or a derived SQLite table keyed by graph node.
- `goals/<slug>.json` — a user-designated target subgraph + per-node internalize/reference flags +
  optional deadline. First-party, user-owned, versioned, file-syncable.
- `sessions/` — tutor session logs (prompts, responses, grades) as retrieval evidence + audit trail.
- Reading-state (from the Canvas prerequisite) — per-page/section dwell + finished flags, feeding
  the forgetting curve.

All derived-and-rebuildable except `goals/` (a user artifact, like saved views). Inviolable
principle holds: **Astrolabe owns connections, intelligence, dialogue — and now a knowledge model —
but never content, and the model is rebuildable and private.**

## 6. Integration with existing layers

- **Graph (Layers 1–2):** the domain model. Nodes = what's known/unknown; edges = prerequisites +
  elaboration targets; centrality = importance weight.
- **Reading-state (Canvas prerequisite):** the passive evidence feed for `read`/`depth`/decay.
- **ACP agent (Layer 4, done):** the intervention delivery mechanism (tutor system prompt +
  retrieved subgraph). No new agent — a role for the existing one.
- **MCP contract (Layer 3):** the tutor reads the overlay + graph via MCP tools; a `record_recall`
  write tool (gated) lets it log evidence.
- **Dialogue persistence (done):** `documentIds` harvested from dialogues already feed `discussed`.

## 7. Upstream decisions to make NOW (cheap, prevents rework)

Even though this is far-horizon, three small choices upstream avoid expensive retrofits:
1. **Canvas reading-state must record enough to feed a forgetting curve** — per-section dwell +
   a `finished` marker with timestamps, not just a boolean "read." Decide the shape when building
   reading-state, not after.
2. **Graph edges must be typed richly enough to become elaboration prompts** — an edge needs a
   relation label ("supports", "contradicts", "prerequisite-of", "instance-of"), not just
   "related", or §4.4.3 has nothing to probe.
3. **Dialogue/annotation activity should stamp the node it touched**, so `discussed`/`annotated`
   evidence accrues passively from day one (the Layer 4→5 seam already reserves `documentIds`).

## 8. Measurement & validation (falsifiability)

The system must be able to be *wrong* and know it:
- **A/B its own interventions** against measured mastery gain (does retrieval practice beat
  re-presentation for THIS user? — it should, per Roediger & Karpicke, but verify).
- **Calibration tracking:** does the user's confidence converge toward measured state over time?
- **Durability check:** do internalized concepts survive spaced re-tests? A concept that decays
  every time is a failed intervention, not a user failing.
- **Transfer as the gold signal:** unaided application to a novel node is the only unfakeable proof.
If interventions don't move these, the policy is wrong and adapts — that adaptivity is the awareness.

## 9. Phasing (each phase independently usable)

1. **Reading-state + passive overlay (no interventions).** Show the user their own knowledge state
   over the graph — read/annotated/written/discussed as a heat over concepts. Pure mirror,
   zero prompting, already valuable ("here's what you've actually engaged vs. merely stored").
2. **The metacognitive mirror (§4.6).** Surface fluency-vs-retrieval gaps on high-centrality nodes.
   The highest-leverage, lowest-infrastructure intervention. Read-mostly.
3. **Retrieval + spacing on user-flagged internalize nodes.** Opt-in, goal-scoped, source-grounded
   prompts on a spacing schedule. The core loop, bounded to what the user chose.
4. **Full loop + measure→update + interleaving/elaboration/transfer.** The adaptive tutor.
5. **Reflexive grounding.** Ingest the pedagogy corpus; make the §3 table graph-queryable.

## 10. Non-goals / out of scope

- A generic LMS / course platform. This teaches the user's OWN library, not canned curricula.
- Gamification, streaks, engagement metrics — explicitly rejected (§2.4).
- Deciding *what* the user should learn — the user sets goals (§2.2).
- A separate model service / cloud — on-device, derived, private (§2.7).
- Replacing the user's judgment — the mirror informs; it does not coerce.

## 11. Open questions (to resolve when building, ideally against the ingested corpus)

- Concrete forgetting-curve parameterization (which spacing algorithm — SM-2 / FSRS / a fitted
  per-user curve?).
- How to estimate `connectivity` cheaply (graph-neighbor recall vs. an explicit relate-prompt).
- Grading free-form retrieval/synthesis (LLM-judge against the source — cost, reliability, gaming).
- The offloading classifier's exact centrality/goal-proximity thresholds.
- How aggressively to withhold the "easy lookup" for internalize nodes without becoming obstructive.
- Cold-start: behavior before enough evidence exists (default to mirror-only, no prompting).
