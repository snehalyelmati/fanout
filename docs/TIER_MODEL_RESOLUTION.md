# Tier Model Resolution

Fanout currently supports two execution tiers only:

- **Tier 1 / realtime**
- **Tier 2 / async**

Batch execution is intentionally out of scope for now.

## Goals

Fanout should use tier2 as much as possible. The point of Fanout is to split work into independent executable nodes and run parallel work outside the user-blocking realtime path.

Default rule:

```text
parallel executable work -> tier2
orchestration / user interaction / final synthesis -> tier1
```

If tier2 is unavailable, Fanout falls back to tier1 and reports that clearly.

## Tier Purposes

### Tier 1 / realtime

Tier1 is the control plane.

Use tier1 for:

- `/fanout-plan` orchestration
- reading the active Pi session model
- repo inspection needed to build the DAG
- user questions and clarification
- packet validation
- DAG safety checks
- final review
- synthesis
- final validation decision
- final response
- any node blocked on user input
- any node with unclear ownership or safety
- fallback when tier2 is unavailable or fails

Default model:

```text
current active Pi realtime model
```

Pi extensions can read this from:

```ts
ctx.model
```

and can track changes via:

```ts
pi.on("model_select", (event) => {
  event.model
})
```

If the active model cannot be read, Fanout should use configured tier1 settings if present. Otherwise planning fails clearly because tier1 is required.

### Tier 2 / async

Tier2 is the worker plane.

Use tier2 for:

- implementation worker nodes
- test-writing worker nodes
- doc-update worker nodes
- independent bugfix/refactor nodes
- independent validation shards
- non-final review shards that return structured findings
- any safe, parallelizable, non-interactive work unit

Default provider/model:

```text
doubleword / zai-org/GLM-5.2-FP8
```

Doubleword should be optional support plus Pi provider discovery:

- `fanout-pi` may declare optional Doubleword support/dependency.
- Actual resolution should use Pi provider/model discovery.
- Fanout core should not hard-depend on Doubleword.

Tier2 is auto-enabled when:

```text
Doubleword provider exists
GLM 5.2 model exists
auth/API key is available
async capability is supported
```

If tier2 is unavailable, use tier1.

## Settings

Fanout should expose Pi settings for users to override tier defaults. In `fanout-pi`, `/fanout-config` provides a minimal dependent selector flow: choose provider, then choose a model from that provider, then choose a thinking level supported by the selected model.

Example:

```json
{
  "fanout": {
    "tiers": {
      "tier1": {
        "provider": "auto",
        "model": "auto",
        "thinking": "auto",
        "reason": "current active Pi realtime model"
      },
      "tier2": {
        "provider": "doubleword",
        "model": "zai-org/GLM-5.2-FP8",
        "thinking": "medium",
        "enabled": "auto",
        "reason": "async background worker model"
      }
    },
    "execution": {
      "tier2Retries": 2,
      "fallbackTier": "tier1",
      "revalidateOnly": true
    }
  }
}
```

Use `reason`, not `reasoning`, for user-facing explanation. Pi model metadata already uses `reasoning` as a boolean capability.

## Thinking / Reasoning Level

Tier settings should include a configurable thinking level.

Use Pi/provider thinking levels rather than inventing a Fanout-specific enum:

```text
off | minimal | low | medium | high | xhigh
```

Resolution rule:

```text
1. Resolve provider/model first.
2. Read model thinking capability from Pi/provider metadata.
3. Resolve thinking:
   - configured value if supported
   - if configured but unsupported, clamp/fallback to nearest supported level
   - if "auto", use provider/model/session default
   - if model is non-reasoning, use "off"
4. Record resolved thinking in the plan report and execution packet.
```

Tier1 default thinking:

```text
auto -> current session thinking setting if available
```

Tier2 default thinking:

```text
medium
```

unless unsupported by the provider/model.

## Resolution Algorithm

```text
resolveTierModels(ctx, settings):

1. Resolve tier1
   if settings.fanout.tiers.tier1.provider/model exists:
      tier1 = configured tier1
   else if ctx.model exists:
      tier1 = current active Pi model
   else:
      fail planning: "Cannot resolve tier1 model"

2. Resolve tier1 thinking
   if configured:
      use configured value if supported, otherwise clamp/fallback
   else:
      use current Pi thinking level if available
   if model is non-reasoning:
      thinking = off

3. Resolve tier2 candidate
   provider = settings tier2 provider ?? "doubleword"
   model    = settings tier2 model ?? "zai-org/GLM-5.2-FP8"
   thinking = settings tier2 thinking ?? "medium"

4. Check tier2 availability
   tier2 available if:
     - provider is discoverable in Pi model registry
     - model exists
     - auth/API key is configured
     - provider supports async execution

5. Resolve tier2 thinking
   if tier2 available:
      use configured/default thinking if supported
      otherwise clamp/fallback
   else:
      tier2 status = unavailable

6. Assign global tier status
   if tier2 available:
      tier2 = resolved doubleword/GLM-5.2 config
      status = available
   else:
      tier2 = tier1 fallback
      status = unavailable
      reason = "tier2 provider/model/auth/async unavailable"

7. Assign nodes
   if node is async-eligible and tier2 available:
      assigned = tier2
   else:
      assigned = tier1

8. Store concrete provider/model/thinking per node in packet.

9. Emit plan report tier/model section.
```

Bad tier2 config never fails planning. Even if user config names an unavailable tier2 provider/model, Fanout falls back to tier1 and reports the issue.

Tier1 is different: tier1 is mandatory. If neither config nor active Pi model can resolve tier1, planning must fail clearly.

## Node Tier Assignment

Fanout should use tier2 as much as possible.

Tier assignment rule:

```text
for each DAG node:
  if tier2 unavailable:
    assign tier1

  else if node is safe async worker:
    assign tier2

  else:
    assign tier1
```

A node is a safe async worker when:

```text
- node is executable work, not control-plane work
- node has no user interaction
- node has clear owned files
- node has declared read-only files if needed
- node has no cross-node file ownership conflict
- node has dependencies represented in the DAG
- node has validation or acceptance criteria
- node result is not needed immediately for user interaction
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

Parallel work defaults to tier2. Serial/control work defaults to tier1.

Example:

```text
tier1 [plan + packet]
   |
   +--> tier2 [worker A: core change]
   +--> tier2 [worker B: tests]
   +--> tier2 [worker C: docs]
          |
tier1 [synthesis/review]
          |
tier1 [final validation + response]
```

## Plan Phase Fallback

During `/fanout-plan`:

```text
1. Resolve tier1.
2. Resolve/check tier2.
3. If tier2 unavailable:
   - keep planning
   - assign tier2-eligible nodes to tier1 fallback
   - report tier2 unavailable
4. Do not fail planning because tier2 is unavailable.
```

Plan report must include a clear section:

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

If unavailable:

```text
Tier2 async
  status   : unavailable
  reason   : provider/model/auth/async capability unavailable
  fallback : all tier2 candidates assigned to tier1
```

## Execution Phase Fallback

`/fanout-execute` must not re-plan.

Execution behavior:

```text
1. Load accepted packet.
2. Revalidate safety only.
3. Revalidate provider/model/thinking availability.
4. If tier2 is available, run tier2 nodes there.
5. If tier2 fails transiently, retry a small number of times.
6. If still failing, fallback remaining tier2 nodes to tier1.
7. Record/report fallback.
```

Default retries:

```text
tier2Retries = 2
```

Execution fallback report:

```text
tier2 unavailable during execution after 2 retries; remaining tier2 nodes fell back to tier1
```

Execution may fallback from tier2 to tier1, but should not change the DAG shape or reassign file ownership.

## Execution Packet

Tier-aware packets use execution packet schema version `3`. The accepted packet should store concrete provider/model/thinking per node plus per-unit `workerPacket` handoff context from the compiler.

Example node:

```json
{
  "id": "update-validator",
  "goal": "add DAG/safety checks",
  "ownedFiles": ["packages/fanout-core/src/execution-packet.ts"],
  "dependencies": [],
  "workerPacket": {
    "sourcePlanIds": ["update-validator"],
    "targetAnchors": ["packages/fanout-core/src/execution-packet.ts: symbol validateExecutionPacket"],
    "requiredChanges": ["add DAG/safety checks"],
    "contractInputs": ["Acceptance: validator rejects unsafe packets"],
    "readDependencies": [],
    "forbiddenChanges": [],
    "handoffContext": []
  },
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

The packet should also include a global tier model summary to avoid repeating all reasoning only in nodes:

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
      "status": "available",
      "reason": "parallel async worker nodes"
    }
  }
}
```

## Open Implementation Detail

The only remaining required capability hook is deterministic async support detection.

Do not infer async support from provider or model names.

Use an explicit capability such as:

```ts
providerCapabilities.supportsAsync === true
```

or equivalent provider registry metadata.

If that metadata is unavailable, tier2 should be treated as unavailable and Fanout should fall back to tier1.
