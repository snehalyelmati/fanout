# Phase 2B: Adapter-backed `/fanout-plan`

## Goal

Upgrade `/fanout-plan` from prompt + helper script into a Pi-aware planning flow that:

- asks user questions until the plan is decision-complete;
- resolves tier1/tier2 model choices deterministically;
- writes plan artifacts outside the repo in Pi-owned storage;
- emits a compact, readable approval report with boxed ASCII DAG nodes;
- leaves `/fanout-execute` for Phase 3.

## Current status

Phase 2B is implemented and locally validated.

Completed:

- `/fanout-plan` is command-backed and dispatches Phase A/Phase B prompts with deterministic preflight context.
- legacy package prompt registration is removed; `prompts/fanout-implementation-plan.md` and `prompts/fanout-execution-packet.md` are the internal command templates.
- `fanout-core` validates execution packet schema v2.
- artifact helper writes packet/plan/DAG/active pointer under Pi-owned storage by default.
- packet smoke fixtures and tests exist.
- `/fanout-config` provides provider -> model -> thinking selection.
- final plan wording leaves `/fanout-execute` for Phase 3.

## Progress log

- Added packet `tierPlan`, per-node `kind`, and per-node `tier` fields.
- Added tier-policy validation and tier2-unavailable fallback checks.
- Moved artifact helper defaults to Pi-owned storage via `~/.pi/agent/fanout` or `FANOUT_ARTIFACT_DIR`.
- Added `--print-run-dir` and `--print-active-path` helper modes.
- Added boxed ASCII flow, tier/model plan, files section, and two-column metrics to `execution-plan.md` rendering.
- Split `/fanout-plan` into a Phase A implementation-plan prompt and a Phase B execution-packet prompt.
- Added fanout-pi runtime context injection for active model, thinking level, artifact paths, and resolved tier preflight.
- Added smoke coverage for packet tier fields, artifact path helper modes, boxed plan report sections, branch/join ASCII DAG rendering, `/fanout-config`, command-backed `/fanout-plan`, and `FANOUT_ARTIFACT_DIR` override.
- Bumped execution packet schema to version `2` for required tier-aware fields.
- Active pointer now stores an absolute packet path.
- Fixed missing `fanout.artifactDir` fallback so runtime context defaults to Pi-owned storage and `/fanout-config` shows the resolved artifact root.
- Validation currently passes: `rtk npm run smoke:fanout-packet`, `rtk npm run smoke:fanout-config`, `rtk npm run smoke:planning`, `rtk npm run check`, `rtk git diff --check`.

## Decisions locked

### Decision-complete planning

`/fanout-plan` should only write ready packets.

Algorithm:

```text
explore repo facts
  -> ask one user question at a time for non-discoverable intent/tradeoffs
  -> repeat until decision-complete
  -> write implementation-plan.json
  -> convert that plan into work units + execution DAG
  -> validate packet/DAG
  -> fix packet issues internally
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

Tier2 is optional at runtime. If unavailable, all tier2 candidates fall back to tier1 and the report must say so clearly.

## Tier/model settings UX

Fanout settings should use dependent selectors:

```text
select provider -> show models for that provider -> show thinking levels supported by that model
```

Requirements:

- Provider choices come from Pi model/provider discovery.
- Model choices are filtered to the selected provider.
- Thinking choices come from selected model metadata and should only show supported levels.
- Tier1 defaults to the current active Pi realtime model unless the user overrides it.
- Tier2 defaults to `doubleword/zai-org/GLM-5.2-FP8` when available.
- If Pi's built-in settings UI cannot express dependent selectors, `fanout-pi` should provide a small Fanout-specific config command/UI rather than a static free-form JSON-only experience.

Implementation status:

- `/fanout-config` now provides a minimal provider → model → thinking selector and persists `fanout.tiers.tier1` / `fanout.tiers.tier2` to global Pi settings.

## Tier/model resolution algorithm

Source of truth: [`docs/TIER_MODEL_RESOLUTION.md`](../TIER_MODEL_RESOLUTION.md).

Implementation summary:

```text
1. Resolve tier1
   - configured tier1 if present
   - else current active Pi model from ctx.model/model_select
   - else fail planning clearly

2. Resolve tier1 thinking
   - configured value if supported
   - else current Pi thinking setting if available
   - else provider/session default
   - non-reasoning model => off

3. Resolve tier2 candidate
   - configured tier2 if present
   - else doubleword/zai-org/GLM-5.2-FP8
   - thinking default: medium

4. Check tier2 availability
   - provider discoverable
   - model exists
   - auth/API key available
   - explicit async capability supported

5. Assign global tier status
   - if tier2 available, use tier2 for safe worker nodes
   - otherwise mark tier2 unavailable and assign those nodes to tier1 fallback

6. Store resolved provider/model/thinking per node.
```

Do not infer async support from provider/model names. If explicit capability metadata is unavailable, tier2 is unavailable.

## Node tier assignment

Use tier2 as much as safely possible.

```text
for each DAG node:
  if tier2 unavailable:
    assigned = tier1
  else if node is a safe async worker:
    assigned = tier2
  else:
    assigned = tier1
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

## Implementation-plan and packet schema updates

Phase A writes `implementation-plan.json` using schema `fanout.implementation-plan` version `1`. It records implementation items, files to change/read, semantic dependencies, validation, acceptance criteria, and risks. It intentionally has no DAG/tier fields.

Phase B uses execution packet schema version `2` because `tierPlan`, work-unit `kind`, and per-node `tier` are required.

Add global tier summary:

```json
{
  "tierPlan": {
    "tier1": {
      "provider": "<active-provider>",
      "model": "<active-model>",
      "thinking": "<active-thinking>",
      "source": "current Pi active model",
      "status": "available",
      "reason": "control plane, review, synthesis, fallback"
    },
    "tier2": {
      "provider": "doubleword",
      "model": "zai-org/GLM-5.2-FP8",
      "thinking": "medium",
      "source": "default settings",
      "status": "available | unavailable",
      "reason": "parallel async worker nodes"
    }
  }
}
```

Add per-node kind and tier:

```json
{
  "id": "update-validator",
  "kind": "implement",
  "goal": "add DAG/safety checks",
  "ownedFiles": ["packages/fanout-core/src/execution-packet.ts"],
  "dependencies": ["inspect-contract"],
  "tier": {
    "preferred": "tier2",
    "assigned": "tier2",
    "fallback": "tier1",
    "provider": "doubleword",
    "model": "zai-org/GLM-5.2-FP8",
    "thinking": "medium",
    "reason": "safe parallel implementation worker"
  }
}
```

Fallback example:

```json
{
  "tier": {
    "preferred": "tier2",
    "assigned": "tier1",
    "fallback": "tier1",
    "provider": "<active-provider>",
    "model": "<active-model>",
    "thinking": "<active-thinking>",
    "reason": "tier2 unavailable; realtime fallback"
  }
}
```

## User-facing report format

Final `/fanout-plan` response and `execution-plan.md` should use the same main sections.

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
  reason   : planning, review, synthesis, fallback

Tier2 async
  provider : doubleword
  model    : zai-org/GLM-5.2-FP8
  thinking : medium
  status   : available | unavailable
  reason   : background implementation workers

Fallback
  if tier2 unavailable: use tier1 for executable worker nodes
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

### Step 3: packet schema v2

Files likely touched:

- `packages/fanout-core/src/execution-packet.ts`
- fixtures under `datasets/fixtures/fanout-packets/`
- `scripts/smoke-fanout-packet.mjs`

Tasks:

- add `tierPlan` validation; **done**
- add `kind` and `tier` to work units; **done**
- validate assigned tier/model/thinking fields; **done**
- bump schema to version 2 instead of preserving old v1 compatibility; **done**
- update metrics derivation; **done**

### Step 4: report rendering

Files likely touched:

- `packages/fanout-core/src/execution-packet.ts`
- `packages/fanout-pi/prompts/fanout-execution-packet.md`

Tasks:

- render tier/model plan; **done**
- render boxed ASCII DAG; **done**
- render files section; **done**
- render two-column metrics; **done**
- keep final response compact with artifact dir only; **done**

### Step 5: planning prompt update

Files likely touched:

- `packages/fanout-pi/prompts/fanout-implementation-plan.md`
- `packages/fanout-pi/prompts/fanout-execution-packet.md`
- `scripts/smoke-planning.mjs`

Tasks:

- require repo exploration before questions in Phase A; **done**
- write `implementation-plan.json` before packet optimization; **done**
- require Phase B to consume the implementation plan; **done**
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
rtk npm run smoke:fanout-packet
rtk npm run smoke:fanout-config
rtk npm run smoke:planning
rtk npm run check
rtk rg -n "/d[w]-|d[w]-plan|d[w]-fanout|d[w]-execute" . || true
```

Additional targeted checks:

- artifact path outside repo by default;
- `FANOUT_ARTIFACT_DIR` override;
- tier2 unavailable fallback to tier1;
- report contains boxed DAG, files, metrics, and tier/model section;
- `.pi-subagents/` remains ignored.

## Non-goals

- `/fanout-execute`
- tier3/batch
- live async execution
- custom worker orchestration
- packet-prep observability expansion
- complex provider registry if Pi cannot expose async capability metadata yet

## Audit findings to address next

These findings came from the Phase 2 audit and should be addressed before calling Phase 2 complete. Preserve the current Phase 2B implementation as the baseline, then work these down in small slices.

Resolved in this slice:

- `/fanout-plan` is command-backed and dispatches Phase A/Phase B prompts with deterministic preflight context.
- Fanout consumes Doubleword provider tier metadata before Pi `ModelRegistry` strips unknown fields, and tier2 availability requires `fanout.async/background/authReady`.
- `fanout.artifactDir` is documented and `/fanout-config` shows the resolved artifact root.
- Packet-prep observability now includes `fanout_plan_start` and `fanout_plan_preflight` events.
- Boxed ASCII DAG rendering now shows simple branch/join structure for common parallel groups.
- Packet status is ready-only; missing user decisions stop planning without writing artifacts.

Remaining audit findings: none.


## Pending items

These are intentionally left after Phase 2B and should be handled before or during Phase 3:

1. Verify `/fanout-plan` in a live Pi session, including interactive `ask_user_question` behavior and artifact writes under the injected runtime context.
2. Implement `/fanout-execute` in Phase 3 as a revalidation/execution flow, not replanning.
3. Add `fanout_packet_ready` observability if needed beyond current smoke coverage.

Resolved dependencies:

- Question tool dependency: `@juicesharp/rpiv-ask-user-question`.
- Artifact storage default: Pi agent storage via `getAgentDir()/fanout` in runtime context and `~/.pi/agent/fanout` helper fallback, with `FANOUT_ARTIFACT_DIR` override.
