# Phase 2B: Adapter-backed `/fanout-plan`

## Goal

Upgrade `/fanout-plan` from prompt + helper script into a Pi-aware planning flow that:

- asks user questions until the plan is decision-complete;
- resolves Tier 1, Tier 2, and Tier 2 fallback model roles deterministically;
- writes plan artifacts outside the repo in Pi-owned storage;
- emits a compact, readable approval report with boxed ASCII DAG nodes;
- leaves `/fanout-execute` for Phase 3.

## Current status

Phase 2B is implemented and locally validated.

Completed:

- `/fanout-plan` is command-backed and dispatches Phase A/Phase B prompts with deterministic preflight context. Phase A's resolved objective is authoritative for Phase B and compilation; the invocation text is retained separately for traceability.
- main-session planning observability is stored under Pi-owned Fanout storage rather than the target repository and correlates `sessionRunId` with each `planRunId`.
- legacy package prompt registration is removed; `prompts/fanout-implementation-plan.md` and `prompts/fanout-implementation-details.md` are the internal command templates.
- `fanout-core` compiles implementation details into execution packet schema v4 and validates the result. Later schema-v3 sections below remain as history for the `workerPacket` introduction.
- artifact helper writes packet/plan/DAG/active pointer under Pi-owned storage by default.
- packet smoke fixtures and tests exist.
- `/fanout-config` provides descriptive role selection followed by provider -> model -> thinking selection.
- final plan wording leaves `/fanout-execute` for Phase 3.

## Progress log

- Added packet `tierPlan`, per-node `kind`, and per-node `tier` fields.
- Added tier-policy validation and tier2-unavailable fallback checks.
- Moved artifact helper defaults to Pi-owned storage via `~/.pi/agent/fanout` or `FANOUT_ARTIFACT_DIR`.
- Added `--print-run-dir` and `--print-active-path` helper modes.
- Added boxed ASCII flow, tier/model plan, files section, and two-column metrics to `execution-plan.md` rendering.
- Split `/fanout-plan` into a Phase A implementation-plan prompt, Phase B implementation-details prompt, and deterministic `fanout-core` compiler.
- Added fanout-pi runtime context injection for active model, thinking level, artifact paths, and resolved tier preflight.
- Added smoke coverage for packet tier fields, artifact path helper modes, boxed plan report sections, branch/join ASCII DAG rendering, `/fanout-config`, command-backed `/fanout-plan`, and `FANOUT_ARTIFACT_DIR` override.
- Bumped execution packet schema to version `3` for required per-unit `workerPacket` handoff fields, then to version `4` for the concrete `tierPlan.tier2Fallback` role. Schema-v3 records below are retained as implementation history.
- Active pointer now stores an absolute packet path.
- Fixed missing `fanout.artifactDir` fallback so runtime context defaults to Pi-owned storage and `/fanout-config` shows the resolved artifact root.
- Fixed live Phase B finalization so `/fanout-plan` advances from pending run state plus artifacts instead of requiring prompt-marker handoff state, and displays the deterministic `execution-plan.md` report in chat.
- Added contract-first anti-serialization guidance to Phase A/B prompts so tests, docs, fixtures, and package scripts can remain authorable from the contract without adding an execution-packet contract node.
- Changed compiler scheduling to file/resource-owned work units: Phase A semantic dependencies stay as traceability context, and only Phase B `post-change-required` file reads create execution DAG edges.
- Added planning telemetry for usage/cache tokens, cost, local TTFT, wall duration, union-of-tool-active wall time, non-tool wall time, per-phase duration, `fanout_plan_end`, and `fanout_plan_failed`; validation failures keep the prior active pointer and report actionable artifact/error details.
- Tier 2 capability filtering now requires explicit `fanout.async`, `fanout.background`, and `fanout.authReady` metadata; `/fanout-config` exposes descriptions, Escape/back navigation, fallback inheritance, and explicit fallback selection.
- Validation currently passes: `rtk npm run smoke:fanout-compiler`, `rtk npm run smoke:fanout-packet`, `rtk npm run smoke:fanout-config`, `rtk npm run smoke:planning`, `rtk npm run check`, `rtk git diff --check`.

## Decisions locked

### Decision-complete planning

`/fanout-plan` should only write ready packets.

Algorithm:

```text
explore repo facts
  -> ask one user question at a time for non-discoverable intent/tradeoffs
  -> repeat until decision-complete
  -> write implementation-plan.json
  -> ground anchors/edit intent in implementation-details.json
  -> compile work units + execution DAG deterministically
  -> validate packet/DAG
  -> fail without active pointer update on compiler errors
  -> finalize ready packet
```

Rules:

- If the answer is discoverable from files/docs/tests/config/git, inspect instead of asking.
- If user input is needed, ask exactly one question at a time.
- Each question should include a recommended answer.
- If the user cancels or declines to decide, stop without writing/updating implementation or active packet artifacts.

### Required question tool

`fanout-pi` should require the adapter question tool.

Current selected behavior:

```text
Required dependency: ask_user_question capability is required for fanout-pi.
```

Implementation note:

- The package dependency is declared as `@juicesharp/rpiv-ask-user-question`.
- The prompt explicitly uses the adapter-provided `ask_user_question` tool for clarification.

### Artifact storage

Artifacts should not be stored in the repo by default.

Default:

```text
Pi data dir / agent-owned storage
```

Fallback if Pi has no exposed data-dir API:

```text
~/.pi/agent/fanout/<project-id>/<run-id>/
~/.pi/agent/fanout/<project-id>/active-packet.json
```

Override:

```text
FANOUT_ARTIFACT_DIR=/custom/path
```

The final user report should show only the artifact directory, not every file.

### Tier support scope

Only two tiers are in scope:

- Tier 1 / realtime
- Tier 2 / async

Batch/tier3 is out of scope.

### Tier defaults

Tier1 default:

```text
current active Pi realtime model
```

Tier2 default:

```text
doubleword / zai-org/GLM-5.2-FP8
```

Tier2 is optional at runtime. If unavailable, tier2-eligible nodes use the resolved realtime `tier2Fallback` model role and the report must say so clearly. That role inherits Tier 1 by default but is not a third execution tier.

## Tier/model settings UX

Fanout settings should use dependent selectors:

```text
select provider -> show models for that provider -> show thinking levels supported by that model
```

Requirements:

- Provider choices come from Pi model/provider discovery.
- Model choices are filtered to the selected provider.
- Thinking choices use Pi's supported-level resolution for the selected model metadata.
- Tier1 is always the current active Pi realtime model and thinking level; changing it through Fanout changes Pi's active state.
- Tier2 defaults to `doubleword/zai-org/GLM-5.2-FP8` when available.
- If Pi's built-in settings UI cannot express dependent selectors, `fanout-pi` should provide a small Fanout-specific config command/UI rather than a static free-form JSON-only experience.

Implementation status:

- `/fanout-config` provides wrapping multiline Tier 1, Tier 2, and Tier 2 fallback role entries, then provider → model → thinking selection. The Tier 2 provider screen also offers **Disable Tier 2 — use realtime fallback**, including when no async model qualifies; selecting a Tier 2 model re-enables it. Arrow keys and `j`/`k` navigate every Fanout selector; the displayed help includes those keys. Tier 1 passes through to Pi's `setModel()` and `setThinkingLevel()`; Tier 2 and optional `fanout.execution.tier2Fallback` persist globally by default, or to an existing project override for that role so project precedence cannot shadow the change. **Use Tier 1** deletes the global fallback override or writes a project inheritance marker that masks a global fallback. Effective settings are validated before switching Tier 1; a post-switch legacy-cleanup failure is reported as partial success rather than as an unchanged model.

## Tier/model resolution algorithm

Source of truth: [`docs/TIER_MODEL_RESOLUTION.md`](../TIER_MODEL_RESOLUTION.md).

Implementation summary:

```text
1. Resolve tier1
   - current active Pi model from ctx.model/model_select
   - ignore legacy fanout.tiers.tier1 overrides
   - fail planning clearly if Pi has no active model

2. Resolve tier1 thinking
   - current Pi thinking setting
   - clamp through Pi's model capability handling
   - non-reasoning model => off

3. Resolve tier2 candidate
   - configured tier2 if present
   - else doubleword/zai-org/GLM-5.2-FP8
   - thinking default: medium

4. Check tier2 availability
   - `fanout.tiers.tier2.enabled !== false`
   - provider/model discoverable
   - `fanout.authReady === true`
   - `fanout.async === true`
   - `fanout.background === true`

5. Resolve Tier 2 fallback
   - configured `fanout.execution.tier2Fallback` if present
   - otherwise inherit the resolved Tier 1 model

6. Assign global tier status
   - if tier2 available, use tier2 for safe worker nodes
   - otherwise mark tier2 unavailable and assign those nodes to the realtime Tier 2 fallback role
   - keep control-plane and typed recovery nodes on Tier 1

7. Store resolved provider/model/thinking per node and all three role summaries in packet schema v4.
```

Do not infer async support from provider/model names. If explicit capability metadata is unavailable, tier2 is unavailable.

## Node tier assignment

Use tier2 as much as safely possible.

```text
for each DAG node:
  if node is tier1-only:
    assigned = tier1
  else if tier2 is available:
    assigned = tier2
  else:
    assigned = realtime tier2Fallback
```

Tier2-eligible node kinds:

```text
implement
test
docs
inspect
validate-shard
review-shard
```

Tier1-only node kinds:

```text
plan
clarify
packet-validation
dag-safety
final-review
synthesis
final-validation
final-response
```

A safe async worker must have:

- no user interaction;
- clear owned files/resources;
- dependencies represented in the DAG;
- validation or acceptance criteria;
- no ownership conflict;
- no immediate user-blocking result requirement.

## Implementation-plan, details, and packet schema updates

Phase A writes `implementation-plan.json` using schema `fanout.implementation-plan` version `1`. It records implementation items, files to change/read, semantic dependencies, non-executable validation intent, acceptance criteria, risks, and forbidden scope. Its resolved `objective` becomes the authoritative objective for Phase B and deterministic compilation; `/fanout-plan` invocation shorthand remains separately in state and telemetry and is not an exact artifact-validation contract. Phase A validation fields describe coverage and must never be sent to a shell. Semantic dependencies are planning context and traceability labels, not execution DAG edges, except that an explicit task-declared validation dependency with a concrete upstream file read must be carried into Phase B as `post-change-required`. It intentionally has no anchor, worker, parallelism, DAG, or tier fields.

Phase B writes `implementation-details.json` using schema `fanout.implementation-details` version `2`. It records Phase A source ids, owned resources, existing-file anchors, new-file intent, read-dependency classification, forbidden changes, per-item literal executable validation commands, and required top-level `finalValidationCommands` for final integrated validation. Machine-readable path fields are bare repository-relative paths; Markdown backticks belong only in human-readable `forbiddenChanges` prose. It must not invent contracts/APIs/product scope or packet fields.

> **Historical schema-v3 snapshot — superseded by schema v4.** The packet excerpt and compiler rules below preserve the `workerPacket` introduction. Current packets also require the concrete `tierPlan.tier2Fallback` model role described earlier in this document.

The deterministic compiler emitted execution packet schema version `3` because each work unit gained a required `workerPacket` handoff:

```json
{
  "workerPacket": {
    "sourcePlanIds": ["update-validator"],
    "targetAnchors": ["packages/fanout-core/src/execution-packet.ts: symbol validateExecutionPacket"],
    "requiredChanges": ["Add workerPacket validation."],
    "contractInputs": ["Acceptance: v3 packet validates."],
    "readDependencies": ["packages/fanout-core/src/execution-packet.ts (baseline-context): existing validator shape"],
    "forbiddenChanges": ["Do not add /fanout-execute."],
    "handoffContext": ["Read package smoke tests before editing."]
  }
}
```

Compiler rules:

- Phase B should emit one details item per independently editable file/resource and reuse `sourcePlanIds` when splitting one Phase A item, except an explicit task-declared ownership bundle remains one details item/work unit;
- every Phase A `filesToChange` entry must be covered by a same-id Phase B writable resource;
- machine-readable artifact paths are bare repository-relative strings and executable command fields are literal shell commands;
- each item's `validationCommands` validates only its isolated change; required top-level `finalValidationCommands` run after all accepted changes are integrated;
- repository paths named in human-readable `forbiddenChanges` prose are wrapped in backticks, with a trailing `/` retained for directories;
- same owned file/resource compiles into one worker packet by default;
- missing anchors, source ids, or Phase A contract inputs fail compilation;
- Phase A semantic dependencies do not serialize file/resource shards;
- for an explicit task-declared validation dependency with a concrete upstream read, Phase B must use `post-change-required`; a missing or `baseline-context` classification is rejected;
- Phase A `filesToRead` overlaps with sibling-owned resources must be reclassified in Phase B read dependencies;
- the adapter includes a computed `requiredReadClassifications` checklist in the Phase B prompt, but Phase B still chooses `baseline-context` vs `post-change-required`;
- `baseline-context` read overlap does not serialize;
- `post-change-required` read overlap creates a dependency;
- ambiguous read/write overlap fails compilation;
- `/fanout-plan` may run one details repair pass for ambiguous Phase A read overlaps, then use conservative sequential fallback with a warning if repair still misses classification;
- compiler assigns kind/tier from the resolved tier plan and node-kind policy;
- no default contract node is emitted.

## User-facing report format

Final `/fanout-plan` response is the deterministic `execution-plan.md` rendered from the compiled packet, so chat and artifact use the same main sections.

### Header

```text
Fanout plan ready ✅
Artifacts: <artifact-dir>
```

### Tier/model plan

```text
Tier/model plan
===============

Tier1 realtime
  provider : <active provider>
  model    : <active model>
  thinking : <resolved thinking>
  reason   : planning, review, synthesis, typed recovery

Tier2 async
  provider : doubleword
  model    : zai-org/GLM-5.2-FP8
  thinking : medium
  status   : available | unavailable
  reason   : background implementation workers

Tier2 fallback realtime
  provider : <configured provider or tier1 provider>
  model    : <configured model or tier1 model>
  thinking : <resolved thinking>
  reason   : tier2-unavailable compilation and exhausted retryable tier2 execution
```

### Boxed ASCII execution flow

Each node should be visually bounded and include concise objective, tier, and owned files.

```text
Execution flow
==============

+-------------------------------+
| [1] Inspect packet contract   |
| goal : understand validator   |
| tier : tier1 realtime         |
| owns : none                   |
+-------------------------------+
                |
                v
+-------------------------------+
| [2] Update validator          |
| goal : add DAG/safety checks  |
| tier : tier2 async            |
| owns : fanout-core/...        |
+-------------------------------+
                |
        +-------+-------+
        |               |
        v               v
+-------------------+   +----------------------+
| [3] Update CLI    |   | [4] Update tests     |
| goal : safe paths |   | goal : cover packet  |
| tier : tier2      |   | tier : tier2         |
| owns : scripts/...|   | owns : scripts/...   |
+-------------------+   +----------------------+
        |               |
        +-------+-------+
                v
+-------------------------------+
| [5] Final review/validation   |
| goal : verify accepted packet |
| tier : tier1 realtime         |
| owns : none                   |
+-------------------------------+
```

Notes:

- Use shortened paths inside boxes.
- Full paths go in the Files section.
- Mermaid remains the precise graph artifact; ASCII is the approval view.

### Files section

```text
Files
=====

Planned writes
- packages/fanout-core/src/execution-packet.ts
- scripts/fanout-packet-artifacts.mjs
- scripts/smoke-fanout-packet.mjs

Read-only context
- README.md
- docs/ROADMAP.md
- package.json
```

### Two-column metrics

```text
Metrics
=======

Work units            5        DAG depth              4
Max parallel width    2        Planned write files    3
Read-only files       3        Validation commands    3
Tier1 nodes           2        Tier2 nodes            3
Active wait           ~5-10m   Background work        none
Tier plan             mixed    Status                 ready
```

### Next step

```text
Next
====

Review this plan now. `/fanout-execute` will consume the active packet when Phase 3 is available.
```

If more user input is needed, show only the next question instead of producing this report.

## Implementation steps

### Step 1: adapter/runtime context

Files likely touched:

- `packages/fanout-pi/src/index.ts`
- `packages/fanout-pi/package.json`
- `package.json`

Tasks:

- track current active model from `ctx.model` and `model_select`; **done**
- expose Fanout artifact base path to the prompt/helper; **done**
- add required ask-user-question dependency/tool expectation; **done**
- add tier settings defaults; **runtime context done**
- add dependent selector settings UX; **minimal `/fanout-config` command done**

### Step 2: artifact path migration

Files likely touched:

- `scripts/fanout-packet-artifacts.mjs`
- `scripts/smoke-fanout-packet.mjs`
- docs

Tasks:

- default artifact base to Pi data dir / `~/.pi/agent/fanout` fallback; **done**
- support `FANOUT_ARTIFACT_DIR`; **done**
- update active pointer path; **done**
- remove repo `runs/fanout` assumptions; **done**
- keep boundary/symlink protections for configured artifact root; **done**

### Step 3: packet schema v3 (historical; superseded by v4)

This completed step records the `workerPacket` schema-v3 migration. Current packet validation requires schema v4 and its concrete `tierPlan.tier2Fallback` summary.

Files likely touched:

- `packages/fanout-core/src/execution-packet.ts`
- fixtures under `datasets/fixtures/fanout-packets/`
- `scripts/smoke-fanout-packet.mjs`

Tasks:

- add `tierPlan` validation; **done**
- add `kind` and `tier` to work units; **done**
- validate assigned tier/model/thinking fields; **done**
- bump schema to version 3 instead of preserving old v1/v2 compatibility; **done**
- require per-unit `workerPacket`; **done**
- update metrics derivation; **done**

### Step 4: report rendering

Files likely touched:

- `packages/fanout-core/src/execution-packet.ts`

Tasks:

- render tier/model plan; **done**
- render boxed ASCII DAG; **done**
- render files section; **done**
- render two-column metrics; **done**
- keep final response compact with artifact dir only; **done**

### Step 5: planning prompt update

Files likely touched:

- `packages/fanout-pi/prompts/fanout-implementation-plan.md`
- `packages/fanout-pi/prompts/fanout-implementation-details.md`
- `packages/fanout-core/src/fanout-compiler.ts`
- `scripts/smoke-planning.mjs`
- `scripts/smoke-fanout-compiler.mjs`

Tasks:

- require repo exploration before questions in Phase A; **done**
- write `implementation-plan.json` before repo grounding; **done**
- require Phase B to consume the implementation plan and write `implementation-details.json`; **done**
- compile packet/DAG deterministically after details validation; **done**
- ask one question at a time with recommended option; **done**
- use `ask_user_question`; **done**
- do not finalize packet until decision-complete; **done**
- if not decision-complete, ask the next question instead of writing active packet; **done**

### Step 6: docs/tests

Files likely touched:

- `README.md`
- `docs/ROADMAP.md`
- `docs/DESIGN_DECISIONS.md`
- `docs/TIER_MODEL_RESOLUTION.md` if algorithm changes

Tasks:

- document Pi data-dir artifact storage; **done**
- document tier defaults and fallback; **done**
- document final report format; **done**
- update smoke checks; **done**

## Validation plan

Run after implementation slices:

```bash
rtk git diff --check
rtk npm run smoke:fanout-compiler
rtk npm run smoke:fanout-packet
rtk npm run smoke:fanout-config
rtk npm run smoke:planning
rtk npm run check
rtk rg -n "/d[w]-|d[w]-plan|d[w]-fanout|d[w]-execute" . || true
```

Additional targeted checks:

- artifact path outside repo by default;
- `FANOUT_ARTIFACT_DIR` override;
- tier2 unavailable routing to the resolved realtime Tier 2 fallback role;
- same-file details merge into one worker packet;
- baseline-context overlaps stay parallel and post-change-required overlaps serialize;
- report contains boxed DAG, files, metrics, and tier/model section;
- `.pi-subagents/` remains ignored.

## Non-goals

- tier3/batch
- automated live benchmark variations
- schema-v3 packet migration (replan to produce schema v4 instead)

## Audit findings to address next

These findings came from the Phase 2 audit and should be addressed before calling Phase 2 complete. Preserve the current Phase 2B implementation as the baseline, then work these down in small slices.

Resolved in this slice:

- `/fanout-plan` is command-backed and dispatches Phase A/Phase B prompts with deterministic preflight context plus compiler finalization.
- Fanout consumes Doubleword provider tier metadata before Pi `ModelRegistry` strips unknown fields, and tier2 availability requires `fanout.async/background/authReady`.
- `fanout.artifactDir` is documented and `/fanout-config` shows the resolved artifact root.
- Packet-prep observability is external to the target repository and includes `sessionRunId`/`planRunId`, `fanout_plan_start`, `fanout_plan_preflight`, assistant usage/cache/cost and local TTFT, per-tool events, detail/compiler validation, `fanout_plan_end`, `fanout_plan_failed`, and wall/tool/non-tool/phase timing summaries. `toolDurationMs` is the union of tool-active wall-clock intervals, so overlapping calls are not double-counted.
- Boxed ASCII DAG rendering now shows simple branch/join structure for common parallel groups.
- Packet status is ready-only; missing user decisions stop planning without writing artifacts.

Remaining audit findings: none.


## Pending items

These are intentionally left after Phase 2B and should be handled before or during Phase 3:

1. Verify the updated `/fanout-config` TUI and `/fanout-plan` Phase A → Phase B flow in a live Pi session, including interactive `ask_user_question`, external telemetry, and schema-v4 artifact writes.
2. Run `/fanout-execute --dry-run` against the resulting packet before requesting authorization for live execution.
3. Add a distinct `fanout_packet_ready` event only if downstream evidence shows `fanout_plan_end` is insufficient.

Resolved dependencies:

- Question tool dependency: `@juicesharp/rpiv-ask-user-question`.
- Artifact storage default: Pi agent storage via `getAgentDir()/fanout` in runtime context and `~/.pi/agent/fanout` helper fallback, with `FANOUT_ARTIFACT_DIR` override.
