# Tier Model Resolution

Fanout supports two execution tiers and three configurable model roles:

- **Tier 1 / realtime control plane**
- **Tier 2 / async workers**
- **Tier 2 fallback / realtime execution fallback** — a model role, not a third tier

Batch execution is intentionally out of scope for now.

## Goals

Fanout should use tier2 as much as possible. The point of Fanout is to split work into independent executable nodes and run parallel work outside the user-blocking realtime path.

Default rule:

```text
parallel executable work -> tier2
orchestration / user interaction / final synthesis -> tier1
```

If tier2 is unavailable, Fanout assigns eligible execution work to the concrete Tier 2 fallback role and reports that clearly. The fallback role inherits Tier 1 unless independently configured.

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
- typed Tier 1 validation and integration recovery

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

Tier 1 has no independent Fanout override. Changing Tier 1 through `/fanout-config tier1` calls Pi's `setModel()` and `setThinkingLevel()` so the active session and Tier 1 cannot drift. If the active model cannot be read, planning fails clearly because Tier 1 is required.

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

If tier2 is unavailable, use the Tier 2 fallback role.

### Tier 2 fallback / realtime

Tier 2 fallback is a separate realtime execution model role. It is used only when Tier 2 is unavailable during compilation or exhausts retryable attempts during execution.

Default:

```text
inherit the resolved Tier 1 provider/model/thinking
```

An explicit fallback may select any runnable realtime model from Pi's registry. It does not replace Tier 1 for planning, safety, review, synthesis, final decisions, or typed Tier 1 recovery.

## Settings

Fanout exposes Pi settings for users to override Tier 2, the Tier 2 fallback, and execution concurrency. In `fanout-pi`, `/fanout-config` first shows the three model roles as wrapping multiline entries with descriptions and current values, then provides the dependent provider → model → supported-thinking flow. Arrow keys or `j`/`k` navigate every Fanout selector, Enter configures, and Escape returns or closes without a partial write.

Example:

```json
{
  "fanout": {
    "tiers": {
      "tier2": {
        "provider": "doubleword",
        "model": "zai-org/GLM-5.2-FP8",
        "thinking": "medium",
        "enabled": "auto",
        "reason": "async background worker model"
      }
    },
    "execution": {
      "maxConcurrency": 2,
      "tier2Fallback": {
        "provider": "openai-codex",
        "model": "gpt-5.6-mini",
        "thinking": "low"
      }
    }
  }
}
```

`execution.tier2Fallback` configures the fallback model role. Its absence means “inherit Tier 1”; choosing **Use Tier 1** removes only that override, even when the model registry is empty. `/fanout-config tier1` changes Pi's current model and thinking level and removes any legacy `fanout.tiers.tier1` override; `/fanout-config tier2` and `/fanout-config fallback` persist their independent roles. Settings are read before modification; malformed or unreadable existing settings abort the change rather than being replaced. `maxConcurrency` remains the only execution-policy setting consumed directly by `/fanout-execute`. Retry counts and repair limits remain fixed MVP policy.

Use `reason`, not `reasoning`, for user-facing explanation. Pi model metadata already uses `reasoning` as a boolean capability.

## Thinking / Reasoning Level

Tier settings should include a configurable thinking level.

Use Pi/provider thinking levels rather than inventing a Fanout-specific enum:

```text
off | minimal | low | medium | high | xhigh | max
```

Fanout reads models from Pi's model registry and uses Pi's `getSupportedThinkingLevels(model)`. Standard levels through `high` remain supported when omitted from `thinkingLevelMap`, `null` disables a level, and `xhigh`/`max` require explicit mappings.

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

Tier 2 fallback thinking inherits Tier 1 by default. An explicit fallback uses its configured supported thinking level.

## Resolution Algorithm

```text
resolveTierModels(ctx, settings):

1. Resolve tier1
   if ctx.model exists:
      tier1 = current active Pi model
   else:
      fail planning: "Cannot resolve tier1 model"
   ignore legacy settings.fanout.tiers.tier1 values

2. Resolve tier1 thinking
   use current Pi thinking level
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

6. Resolve Tier 2 fallback
   if settings.fanout.execution.tier2Fallback names a registry model:
      resolve that realtime provider/model/thinking
   else:
      inherit the resolved Tier 1 provider/model/thinking

7. Assign nodes
   if node is tier1-only/control-plane:
      assigned model role = tier1
   else if node is async-eligible and tier2 available:
      assigned model role = tier2
   else:
      assigned execution tier = tier1
      assigned model role = tier2Fallback

8. Store all three concrete model summaries plus concrete provider/model/thinking per node in packet.

9. Emit plan report tier/model-role section.
```

Bad tier2 config never fails planning. Even if user config names an unavailable tier2 provider/model, Fanout uses the resolved Tier 2 fallback role and reports the issue.

Tier1 is different: tier1 is mandatory and always comes from the active Pi model. If Pi has no active model, planning must fail clearly.

## Node Tier Assignment

Fanout should use tier2 as much as possible.

Tier assignment rule:

```text
for each DAG node:
  if node is tier1-only/control-plane:
    assign tier1 model role

  else if tier2 is available and node is a safe async worker:
    assign tier2

  else:
    assign tier1 execution with the tier2Fallback model role
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
   - assign tier2-eligible nodes to the concrete tier2Fallback realtime model
   - report tier2 unavailable
4. Do not fail planning because tier2 is unavailable.
```

Plan report must include a clear section:

```text
Tier/model plan
===============

Tier1 realtime control plane
  provider : <active provider>
  model    : <active model>
  thinking : <resolved thinking>
  reason   : planning, safety, review, synthesis, final decisions

Tier2 async
  provider : doubleword
  model    : zai-org/GLM-5.2-FP8
  thinking : medium
  status   : available | unavailable
  reason   : background implementation workers

Tier2 fallback realtime execution
  provider : <fallback provider>
  model    : <fallback model>
  thinking : <fallback thinking>
  source   : tier1 inheritance | fanout.execution.tier2Fallback
```

If unavailable:

```text
Tier2 async
  status   : unavailable
  reason   : provider/model/auth/async capability unavailable
  fallback : all tier2 candidates assigned to tier2Fallback on the realtime tier
```

## Execution Phase Fallback

`/fanout-execute` must not re-plan.

Execution behavior:

```text
1. Load accepted packet.
2. Revalidate safety only.
3. Run each node with its concrete packet-assigned provider/model/thinking.
4. If that node has a classified transient tier2 subprocess/provider failure, run one clean tier2 rerun.
5. If that node exhausts retryable tier2 attempts and declares `fallback: "tier1"`, run one realtime attempt with the packet's concrete `tier2Fallback` model.
6. Record every attempt and fallback; do not reassign other nodes or change the DAG.
```

Execution does not run a separate provider/model availability preflight. An unavailable provider or invalid model fails that worker subprocess and is not treated as a global signal to reroute remaining nodes.

Accepted generic-provider workers use Pi JSON usage with pricing source `pi-json-usage`. Accepted Doubleword workers require matching provider-reported usage with the exact pricing source `doubleword-model-metadata`; `doubleword-stub` synthetic usage remains useful for provider smoke tests but cannot satisfy `/fanout-execute` acceptance metrics.

Fixed MVP attempt policy:

```text
tier2MaxAttempts = 2 (original attempt plus one clean rerun)
tier1CleanRerunMaxAttempts = 1 additional rerun
tier1FallbackMaxAttempts = 1 fallback attempt
maxValidationRepairAttempts = 2
maxIntegrationRepairAttempts = 2
```

Execution fallback report:

```text
tier2 unavailable after 2 total attempts; the node fell back to one realtime tier2Fallback attempt
```

Execution may fallback from tier2 to the realtime tier using `tier2Fallback`, but it must not change the DAG shape or file ownership. Typed validation/integration repairs continue to use the Tier 1 control-plane model.

## Execution Packet

Tier-aware packets use execution packet schema version `4`. Schema v4 requires a concrete `tier2Fallback` summary in addition to Tier 1 and Tier 2. Older packets fail validation and require replanning; there is no migration machinery. The accepted packet stores concrete provider/model/thinking per node plus per-unit `workerPacket` handoff context from the compiler.

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
    "provider": "<tier2-fallback-provider>",
    "model": "<tier2-fallback-model>",
    "thinking": "<tier2-fallback-thinking>",
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
      "reason": "control plane, safety, review, synthesis, final decisions"
    },
    "tier2": {
      "provider": "doubleword",
      "model": "zai-org/GLM-5.2-FP8",
      "thinking": "medium",
      "source": "default settings",
      "status": "available",
      "reason": "parallel async worker nodes"
    },
    "tier2Fallback": {
      "provider": "openai-codex",
      "model": "gpt-5.6-mini",
      "thinking": "low",
      "source": "fanout.execution.tier2Fallback",
      "status": "available",
      "reason": "realtime fallback for tier2 execution"
    }
  }
}
```

## Implemented capability detection

Tier 2 eligibility is deterministic and never inferred from provider or model names. A registry model is eligible only when its preserved Fanout metadata advertises all three flags:

```ts
model.fanout.async === true
model.fanout.background === true
model.fanout.authReady === true
```

Doubleword metadata is restored before Pi registry filtering can discard provider-specific fields. If any flag is absent or false, Tier 2 is unavailable and eligible execution nodes use the resolved Tier 2 fallback role on the realtime tier. `/fanout-config` applies the same filter to Tier 2 choices; Tier 1 and Tier 2 fallback choices remain unrestricted because they are realtime roles.
