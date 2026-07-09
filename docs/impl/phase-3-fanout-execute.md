# Phase 3: `/fanout-execute` implementation design

Status: design aligned; implementation pending.

Source: validated Phase 3 component notes in [`docs/phase3_notes.md`](../phase3_notes.md).

## Goal

Implement `/fanout-execute` as a deterministic revalidation and execution flow for the active accepted packet produced by `/fanout-plan`.

`/fanout-execute` must not replan, repair packet artifacts, infer missing scope, migrate old packets, or ask workers to make product decisions. It loads the active packet, runs approved work units in isolated worktrees, accepts only validated in-scope patches, applies accepted patches to the active worktree, and writes execution metrics/artifacts.

## Non-goals

- Explicit packet path argument.
- Pointer repair or migration.
- Generic DAG mutation or priority scheduling.
- Generic repair agent.
- Partial patch application.
- Three-way merge magic.
- Resume/replay.
- Dashboard UI.
- Worker pool.
- Container sandbox.
- Autobatcher or tier3/batch execution.
- User-facing retry/recovery configuration.

## Component 1: Active packet loader

### Design

The loader is deterministic code. It loads the active accepted packet by default and returns either a structurally valid executable packet or a clear failure.

### Flow

1. `fanout-pi` resolves `projectArtifactRoot` and `activePointerPath` from runtime context.
2. `fanout-core` reads `active-packet.json`.
3. Validate pointer:
   - object;
   - `schema === "fanout.active-packet"`;
   - `version === 1`;
   - `updatedAt` non-empty string;
   - `packetPath` non-empty string.
4. Resolve `packetPath` and enforce containment under `projectArtifactRoot`.
5. Read `execution-packet.json`.
6. Run existing `validateExecutionPacket(packet)`.
7. Return loaded packet plus validation metadata.

### Module boundary

- `fanout-pi`
  - expose/reuse runtime context resolution for `activePointerPath` and `projectArtifactRoot`.
- `fanout-core`
  - `validateActivePacketPointer(value)`;
  - `readActivePacketPointer(path)`;
  - `loadActiveExecutionPacket(activePointerPath, projectArtifactRoot)`.

### Safety

Reject missing/malformed pointers, packet paths outside the project artifact root, missing/unreadable packets, and non-executable packets. Do not continue to preflight unless packet loading succeeds.

## Component 2: Execution run recorder

### Design

The recorder is deterministic. It writes execution audit artifacts under the packet artifact directory, not the repo. It records facts passed by the loader, scheduler, worker runner, patch gate, and validators; it does not make execution decisions.

No metrics means no accepted worker.

### Artifact layout

```text
<packet-artifact-dir>/
  executions/
    <execution-run-id>/
      events.jsonl
      execution-run.json
      summary.md
```

Create the execution run directory before mutation. If the run directory or `events.jsonl` cannot be created, stop before execution.

### Canonical event names

Use these canonical names in tests and artifacts. Older note names such as `node_finished`, `worker_started`, `patch_captured`, and `patch_accepted` normalize to the more specific names below rather than becoming separate event types.

- `execution_start`
- `packet_loaded`
- `preflight_start` / `preflight_end`
- `confirmation_requested` / `confirmation_accepted`
- `node_ready` / `node_started` / `node_succeeded` / `node_failed` / `node_skipped`
- `scheduler_finished`
- `worker_attempt_started` / `worker_attempt_finished` / `worker_attempt_failed`
- `worker_clean_rerun_scheduled`
- `worker_retry_scheduled`
- `worker_fallback_started` / `worker_fallback_finished` / `worker_fallback_failed`
- `metrics_imported` / `metrics_missing`
- `patch_capture_started` / `patch_capture_finished`
- `ownership_check_started` / `ownership_check_finished`
- `validation_started` / `validation_finished`
- `patch_apply_check_started` / `patch_apply_check_finished`
- `patch_apply_conflict`
- `patch_rejected` / `patch_applied`
- `validation_repair_started` / `validation_repair_finished` / `validation_repair_failed`
- `integration_repair_started` / `integration_repair_finished` / `integration_repair_failed`
- `final_validation_started` / `final_validation_finished`
- `execution_finished`

### Required metrics

Deterministic/local metrics come from local clocks and git stats:

- run duration;
- per-node duration;
- validation duration;
- patch apply duration;
- patch files changed;
- patch insertions;
- patch deletions.

Every accepted LLM worker result must include complete worker metrics:

- provider;
- model;
- tier;
- input tokens;
- output tokens;
- total tokens;
- estimated cost USD;
- pricing source;
- TTFT;
- poll count;
- poll duration;
- tool duration;
- worker duration.

Policy:

- Missing worker metrics means the worker result cannot be accepted.
- Missing pricing for a known provider/model/tier is a metrics import failure.
- Do not guess tokens from text length.
- Do not invent TTFT, poll, or tool timings.
- Do not write nulls for required accepted-worker metrics.
- Failed/rejected workers may record partial diagnostic metrics.

### Snapshot shape

`execution-run.json` uses schema `fanout.execution-run`, version `1`, with:

- run metadata: `runId`, `packetPath`, `artifactDir`, timestamps, and status;
- run status enum: `running | succeeded | failed | aborted`;
- per-node status/timestamps/durations;
- node status enum: `pending | ready | running | succeeded | failed | skipped`;
- accepted worker metrics;
- patch stats;
- validation stats;
- validation status enum: `passed | failed`;
- totals for duration, tokens, cost, tool time, poll time, validation time, and git patch stats.

### Module boundary

- `fanout-core`
  - execution run/event/metric types;
  - metric completeness validation helpers.
- `fanout-pi`
  - filesystem recorder implementation;
  - run directory creation;
  - `summary.md` rendering.

## Component 3: DAG scheduler

### Design

The scheduler is deterministic and only manages node state. It does not create worktrees, spawn Pi, capture patches, validate, apply patches, or run repair.

The scheduler calls an injected node executor:

```ts
runNode(workUnit) -> NodeResult
```

The node executor owns the per-node pipeline:

```text
worktree -> worker -> patch capture -> ownership enforcement -> validation -> apply gate -> typed recovery
```

### Inputs

- Validated execution packet.
- Validated execution graph from `fanout-core`.
- Options:
  - `maxConcurrency`;
  - `failFast` default `false`;
  - `runNode` callback;
  - recorder.

### States

- `pending`
- `ready`
- `running`
- `succeeded`
- `failed`
- `skipped`

A node is ready when it is pending and every dependency succeeded.

### Ordering and failure behavior

- Ready nodes run in deterministic packet order.
- No priority scheduling initially.
- If a node fails, mark it failed and recursively mark dependents skipped.
- Independent nodes may continue unless `failFast` is enabled.
- Final status is failed/partial if any node failed or was skipped.

### Patch/apply boundary

A dependent node becomes ready only after upstream `runNode` succeeds, including successful patch application to the active worktree. Downstream worktrees are created from the active worktree after upstream patches land.

Parallel independent nodes can run in separate worktrees. Their patches are still checked against the current active worktree with `git apply --check` before apply. Packet ownership should prevent most conflicts; the patch gate is authoritative.

### API

```ts
runDag(packet, {
  maxConcurrency,
  failFast: false,
  runNode,
  recorder,
})
```

## Component 4: Worktree manager and subprocess worker runner

### Design

- Worktree manager: deterministic.
- Worker prompt builder: deterministic.
- Subprocess worker runner: LLM boundary.
- Fanout remains provider-agnostic through `FANOUT_*` environment variables.
- Doubleword-specific environment variables may be set only as a compatibility bridge for current provider metrics.

### Worker command contract

Target shape:

```text
pi \
  --no-context-files \
  -e <fanout-extension-entry> \
  --model <provider>/<model> \
  -p @<worker-dir>/prompt.md
```

The exact Pi prompt-file flag is confirmed during implementation. The contract is:

- non-interactive print run;
- cwd is the isolated worker worktree;
- one deterministic prompt;
- process exits after one work unit;
- parent captures artifacts.

### Context policy

Worker subprocesses do not automatically load global/project context files. The parent builds a curated prompt/context bundle.

Reason: global instructions may require planning and user confirmation. Those rules are correct for the main session but wrong for an approved non-interactive worker.

Worker prompt must state:

- this is a Fanout worker subprocess;
- parent already received user approval;
- do not ask for confirmation;
- do not broaden scope;
- implement only this work unit;
- edit only owned files;
- do not commit;
- stop after completing this unit.

Prompt bundle includes:

- packet objective;
- user context;
- discovered repo facts;
- `workUnit.workerPacket`;
- owned files;
- read-only files;
- validation commands;
- acceptance criteria;
- stop rules;
- curated repo-local instructions if needed;
- no main chat history unless summarized into `workerPacket` or handoff context.

### Per-node flow

1. Scheduler calls `runNode(workUnit)`.
2. `runNode` creates an isolated git worktree based on the current active worktree state.
3. Build deterministic worker prompt.
4. Spawn child Pi in the worker worktree.
5. Capture stdout/stderr/session/observability artifacts.
6. Import mandatory metrics.
7. Capture git diff as `patch.diff`.
8. Return result to the node executor pipeline.
9. Node executor handles ownership, validation, apply gate, and typed recovery.

### Worker artifact layout

Artifacts are attempt-scoped so failed attempts stay inspectable and are never overwritten by retries, fallback, or repair attempts.

```text
<execution-run-dir>/
  workers/
    <node-id>/
      attempts/
        <attempt-id>/
          worktree/
          prompt.md
          stdout.log
          stderr.log
          observability.jsonl
          patch.diff
          patch-stat.json
          result.json
```

Every attempt gets a fresh worktree. Failed worktrees, logs, patches, and result artifacts are preserved. Never reuse a dirty failed worktree.

### Environment contract

Provider-agnostic:

```text
FANOUT_OBSERVABILITY_FILE=<worker-attempt-dir>/observability.jsonl
FANOUT_RUN_ID=<execution-run-id>
FANOUT_NODE_ID=<node-id>
FANOUT_WORKER_DIR=<worker-attempt-dir>
```

Optional Doubleword bridge:

```text
DOUBLEWORD_OBSERVABILITY_FILE=$FANOUT_OBSERVABILITY_FILE
DOUBLEWORD_RUN_ID=$FANOUT_RUN_ID-$FANOUT_NODE_ID
```

### Worker success requirements

- Child process completed successfully.
- Mandatory metrics are complete.
- Required patch exists unless the unit explicitly allows no-op.
- Result artifacts are readable.

Missing metrics fail the worker result. No patch acceptance and no recovery repair.

## Component 5: Patch capture, ownership enforcement, and apply gate

### Design

Worker edits only its isolated worktree. Active worktree patch application is atomic: apply the whole node patch or fail the node. No partial patch application.

### Pipeline

1. Worker subprocess completes and mandatory metrics are present.
2. Capture patch from worker worktree:
   - `git diff --binary --no-ext-diff`
   - `git diff --name-only`
   - `git diff --numstat`
3. Write `patch.diff`, `patch-stat.json`, and `changed-files.json`.
4. Enforce ownership: every changed file must be covered by `workUnit.ownedFiles` or owned resources.
5. Hard fail on ownership or forbidden scope violations.
6. Run node validation commands in the worker worktree after ownership passes.
7. If validation passes, run `git apply --check` against the active worktree.
8. If apply check passes, run `git apply patch.diff` in the active worktree.
9. Mark node succeeded only after apply succeeds.
10. Recovery output goes through the same gates again.

### Patch artifacts

```text
<worker-dir>/
  patch.diff
  patch-stat.json
  changed-files.json
  ownership-check.json
  validation.json
  apply-check.json
```

### Ownership rules

- Normalize paths relative to repo root.
- Directory ownership covers descendants.
- Exact file ownership covers only that file.
- Writes outside owned files are hard failures.
- Forbidden file/resource touches are hard failures.
- No recovery for ownership violations.

### Validation

Run `workUnit.validationCommands` in the worker worktree after ownership passes. Capture command, exit code, stdout/stderr, and duration. Packet validation should reject unsafe commands, but execution still records command failures.

### Apply gate

Run:

```text
git apply --check <patch.diff>
git apply <patch.diff>
```

If `git apply --check` fails due to conflict/staleness, trigger integration conflict repair. If repair fails or exhausts attempts, the node fails.

## Component 6: Typed recovery hooks

### Design

Recovery belongs inside node executor / patch gate, not scheduler. There is no generic repair agent.

### Validation-failure repair

Trigger: ownership passed, validation failed.

Policy:

- tier1 realtime;
- writes original owned files only;
- bounded attempts, default `maxValidationRepairAttempts = 2`;
- inputs: original intent, owned files, validation command/output, current worker worktree state;
- after repair: recapture patch, rerun ownership, validation, and apply gate.

### Integration-conflict repair

Trigger: metrics, ownership, and validation passed, but `git apply --check` failed against the active worktree.

Policy:

- tier1 realtime;
- writes original owned files only unless packet explicitly allows overlap;
- bounded attempts, default `maxIntegrationRepairAttempts = 2`;
- inputs: original intent, worker packet, rejected patch, apply stderr, current active contents for owned files, summary of already applied patches;
- after repair: capture repair patch, rerun ownership, validation, and apply gate.

### Hard stops with no recovery

- Missing mandatory worker metrics.
- Ownership violation.
- Forbidden file/resource changes.
- Malformed or unreadable patch/result.
- Unsafe command/tool behavior.
- Scope ambiguity.
- Repair output violates ownership.
- Repair output misses metrics.

## Component 7: Tier2 retry and tier1 fallback policy

### Design

Retry/fallback policy is deterministic and lives inside node executor. Scheduler sees only `runNode(workUnit)` success or failure.

Definitions:

- Clean rerun: same original assigned tier, same prompt, fresh worktree, only for transient subprocess/timeout failures.
- Retry: same tier, same prompt, fresh worktree; for tier2 this is the clean rerun counted by `tier2MaxAttempts`.
- Fallback: tier2 to tier1, same work unit, fresh worktree.
- Repair: tier1 narrow fix after validation/apply failure.

### Defaults

- `tier2MaxAttempts = 2` total: original tier2 attempt plus one clean rerun/retry.
- `tier1CleanRerunMaxAttempts = 1` rerun for nodes originally assigned to tier1.
- `tier1FallbackMaxAttempts = 1` fallback attempt after retryable tier2 exhaustion.
- No dynamic budgets initially.

### Clean rerun and retryable failures

A clean rerun uses the original assigned tier, original prompt, and a fresh worktree. It is allowed at most once for transient failures before usable worker output exists.

Retryable tier2/provider failures:

- Provider 429/5xx.
- Async poll transient error.
- Timeout before model result.
- Network failure.
- Child process crash before usable patch/result.
- Subprocess infrastructure failure.

Retryable tier1 subprocess failures:

- Timeout before model result.
- Child process crash before usable patch/result.
- Subprocess infrastructure failure.

### Not handled by retry/fallback

These outcomes do not trigger clean rerun, tier2 retry, or tier1 fallback:

- Missing mandatory metrics: hard fail.
- Ownership violation: hard fail.
- Forbidden file/resource touch: hard fail.
- Unsafe command/tool behavior: hard fail.
- Malformed/unreadable patch: hard fail.
- Scope ambiguity: hard fail.
- Validation failure: handled only by typed validation-failure repair.
- Git apply conflict: handled only by typed integration-conflict repair.

### Fallback policy

If tier2 attempts are exhausted due to retryable failures, run one tier1 fallback attempt only when `workUnit.tier.fallback === "tier1"`. Fallback uses the same work unit intent and worker packet. If fallback succeeds, normal patch gates continue. If fallback fails, the node fails.

No fallback for unsafe output or missing metrics.

### Attempt worktree policy

- Every original attempt, clean rerun, retry, fallback, and repair attempt gets a fresh worktree.
- Failed worktrees, logs, patches, and result artifacts are preserved.
- Never reuse a dirty failed worktree.

### Accounting

Every attempt is recorded. Totals include all known tokens, costs, and durations, including failed attempts, clean reruns, and tier2 waste before fallback. Missing metrics remain a hard failure; do not invent or backfill metrics.

## End-to-end execution flow

```text
/fanout-execute
  -> resolve Fanout runtime context
  -> load active packet pointer
  -> load and validate execution packet
  -> create execution run recorder
  -> preflight repo/artifacts/commands
  -> confirm launch with user
  -> scheduler runs ready nodes
      -> node executor creates worktree
      -> worker subprocess attempts/retries/fallbacks
      -> import metrics
      -> capture patch
      -> enforce ownership
      -> run node validation
      -> apply gate
      -> typed recovery if allowed
      -> apply accepted patch to active worktree
  -> run final validation plan in active worktree
  -> write execution-run.json and summary.md
  -> report concise summary and artifact links
```

## Build slices

### Slice 1: loader + recorder + dry-run

- Active pointer validation/loading.
- Execution run directory and JSONL/snapshot writing.
- `/fanout-execute --dry-run` or internal dry-run path.
- No mutation.

### Slice 2: scheduler + stub node executor

- Deterministic DAG scheduling.
- Stub `runNode` status transitions.
- Failure/skipped behavior.
- Summary artifacts.

### Slice 3: worktree + subprocess worker MVP

- Create/remove worktrees.
- Build worker prompt.
- Spawn child Pi.
- Capture stdout/stderr/observability.
- Import mandatory metrics.

### Slice 4: patch gate

- Capture patch/stats.
- Enforce ownership.
- Run node validation.
- Apply check/apply to active worktree.
- Final validation.

### Slice 5: bounded recovery + retry/fallback

- One clean rerun for transient original-tier subprocess failures.
- Tier2 retry classification.
- Tier1 fallback.
- Validation-failure repair.
- Integration-conflict repair.

## Acceptance criteria

- `/fanout-execute` loads the active packet and refuses malformed/stale/unsafe input before mutation.
- Execution artifacts are created before mutation and include `events.jsonl`, `execution-run.json`, and `summary.md`.
- Scheduler executes an acyclic packet in dependency order with deterministic ready-node ordering.
- Mutating workers run in isolated git worktrees.
- No worker patch can touch files outside its owned files.
- Accepted workers have complete mandatory metrics.
- Patches are validated before active-worktree apply.
- Failed/rejected workers cannot silently corrupt the active worktree.
- Final validation status and artifact links are returned to the user.

## Decisions followed

- Execute active packet by default.
- Active pointer remains a pointer; packet file is source of truth.
- `/fanout-execute` does not replan.
- Fanout core stays deterministic and Pi/Doubleword independent where possible.
- Observability is part of MVP.
- Direct async endpoints before Autobatcher.
- Batch/tier3 remains out of scope.

## Decisions updated by this design

- Accepted LLM worker metrics are mandatory, not best-effort/null.
- Worker subprocesses use curated prompt context with `--no-context-files` instead of automatically inheriting global/project context files.
- Allow typed bounded recovery hooks for validation failure and integration conflict repair.
- No generic retry/repair agent.
