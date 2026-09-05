# Phase 3 component notes (historical)

This file preserves pre-cutover exploration and is not executable authority. The current pointer-v2/packet-v10/attempt-v6/event-v6/projection-v7 contract is maintained in [`docs/impl/phase-3-fanout-execute.md`](impl/phase-3-fanout-execute.md); legacy shapes below must not be implemented or accepted.

Phase 3 component 1: Active packet loader

```text
Design alignment:
- This component is 100% deterministic code. No LLM usage.
- /fanout-execute loads the active accepted packet by default.
- It must not replan, repair, infer, migrate, or ask the user.
- Active packet remains a pointer; execution-packet.json remains source of truth.
- Artifact root/project root resolution is a fanout-pi concern.
- Pointer/packet validation should live in fanout-core where packet schema already lives.

Flow:
1. fanout-pi resolves:
   - projectArtifactRoot
   - activePointerPath
2. fanout-core reads active-packet.json.
3. Validate pointer:
   - object
   - schema === fanout.active-packet
   - version === 1
   - updatedAt non-empty string
   - packetPath non-empty string
4. Resolve packetPath and enforce containment under projectArtifactRoot.
5. Read execution-packet.json.
6. Run existing validateExecutionPacket(packet).
7. Return loaded packet + validation metadata, or fail clearly.

Recommended module boundary:
- fanout-pi:
  - expose/reuse runtime context resolution to get activePointerPath/projectArtifactRoot.
- fanout-core:
  - add validateActivePacketPointer(value)
  - add readActivePacketPointer(path)
  - add loadActiveExecutionPacket(activePointerPath, projectArtifactRoot)

Security/safety:
- Reject missing pointer.
- Reject malformed pointer.
- Reject packetPath outside projectArtifactRoot after resolve().
- Reject missing/unreadable packet.
- Reject non-executable packet validation.
- Do not continue to preflight unless the packet is structurally valid.

Out of scope for component 1:
- dirty worktree check
- stale HEAD check
- user confirmation
- validation command availability
- scheduler
- workers
- patch capture/apply
- final review
- explicit packet path CLI arg
- pointer repair/migration

Prior decision changes:
- none

Deferred:
- explicit packet path argument, only if users later need multiple selectable packets.
- pointer repair/migration, only if real compatibility need appears.
- extra symlink hardening beyond resolve containment, only if artifact roots become shared/untrusted.
```
---
Phase 3 component: Execution run recorder

```text
Design alignment:
- This component is deterministic code. No LLM usage.
- Recorder writes execution audit artifacts under the packet artifact dir, not the repo.
- Observability/metrics are part of MVP and are mandatory, not optional.
- No null metric placeholders for accepted worker results.
- "No metrics, no accepted worker."

Artifact layout:
<packet-artifact-dir>/
  executions/
    <execution-run-id>/
      events.jsonl
      execution-run.json
      summary.md

Core behavior:
1. Create execution run dir before mutation.
   - If it cannot create the run dir/events file, stop before execution.
2. Append every state transition to events.jsonl.
3. Maintain execution-run.json as current/final snapshot.
4. Write summary.md at the end.
5. Recorder remains dumb:
   - records facts/statuses/metrics passed by scheduler/runner/validators.
   - does not schedule DAGs, spawn workers, decide patch acceptance, or apply patches.

Event examples:
- execution_start
- packet_loaded
- preflight_start / preflight_end
- confirmation_requested / confirmation_accepted
- node_ready / node_started / node_finished / node_failed
- worker_started / worker_finished / worker_failed
- metrics_imported / metrics_missing
- patch_captured
- patch_rejected / patch_accepted
- validation_started / validation_finished
- patch_applied
- final_validation_started / final_validation_finished
- execution_finished

Required metrics:
For deterministic/local steps, recorder or caller records from local clock/git stats:
- run durationMs
- per-node durationMs
- validation durationMs
- patch apply durationMs
- patch filesChanged
- patch insertions
- patch deletions

For every accepted LLM worker result, worker runner must provide complete metrics:
- provider
- model
- tier
- inputTokens
- outputTokens
- totalTokens
- estimatedCostUsd
- pricingSource
- ttftMs
- pollCount
- pollDurationMs
- toolDurationMs
- workerDurationMs

Policy:
- Missing worker metrics => worker result cannot be accepted.
- Missing pricing for known provider/model/tier => metrics import failure.
- Do not guess tokens from text length.
- Do not invent TTFT/poll/tool timings.
- Do not write nulls for required accepted-worker metrics.
- Failed/rejected workers may record partial diagnostic metrics, but accepted workers require complete metrics.

execution-run.json shape:
{
  "schema": "fanout.execution-run",
  "version": 1,
  "runId": "...",
  "packetPath": "...",
  "artifactDir": "...",
  "startedAt": "...",
  "finishedAt": "...",
  "status": "running|succeeded|failed|aborted",
  "nodes": [
    {
      "id": "...",
      "status": "pending|running|succeeded|failed|skipped",
      "startedAt": "...",
      "finishedAt": "...",
      "durationMs": 123,
      "worker": {
        "provider": "...",
        "model": "...",
        "tier": "tier1|tier2",
        "inputTokens": 1,
        "outputTokens": 1,
        "totalTokens": 2,
        "estimatedCostUsd": 0.0001,
        "pricingSource": "...",
        "ttftMs": 123,
        "pollCount": 0,
        "pollDurationMs": 0,
        "toolDurationMs": 456,
        "workerDurationMs": 789
      },
      "patch": {
        "filesChanged": 1,
        "insertions": 2,
        "deletions": 3
      },
      "validation": {
        "commandCount": 1,
        "durationMs": 123,
        "status": "passed|failed"
      }
    }
  ],
  "totals": {
    "durationMs": 1234,
    "inputTokens": 1,
    "outputTokens": 1,
    "totalTokens": 2,
    "estimatedCostUsd": 0.0001,
    "workerDurationMs": 789,
    "validationDurationMs": 123,
    "toolDurationMs": 456,
    "pollDurationMs": 0,
    "filesChanged": 1,
    "insertions": 2,
    "deletions": 3
  }
}

Recommended module boundary:
- fanout-core:
  - execution run/event/metric types.
  - metric completeness validation helpers.
- fanout-pi:
  - filesystem recorder implementation.
  - artifact path/run-dir creation.
  - summary.md rendering if we keep it Pi-specific.

Prior decision changes:
- Strengthen observability requirement for Phase 3:
  - accepted LLM worker metrics are mandatory, not best-effort/null.

Deferred/skipped:
- database/store: JSONL + snapshot is enough.
- dashboard UI: summary.md is enough.
- resume/replay: add after first successful execution path.
- synthetic/estimated tokens from text length: do not add.
```
---
Phase 3 component: DAG scheduler

```text
Design alignment:
- Scheduler is deterministic code. No LLM usage.
- Scheduler is a traffic cop, not a worker.
- Scheduler does not create worktrees, spawn Pi, capture patches, validate patches, merge/apply patches, or run repair.
- Scheduler calls an injected node executor:
    runNode(workUnit) -> NodeResult
- Node executor owns the full per-node pipeline:
    worktree -> worker -> patch capture -> ownership enforcement -> validation -> patch apply gate -> optional integration repair.

Scheduler inputs:
- validated execution packet
- validated execution graph from existing fanout-core validator/buildExecutionGraph
- options:
    maxConcurrency
    failFast default false
    runNode callback
    recorder

Node states:
- pending
- ready
- running
- succeeded
- failed
- skipped

Readiness rule:
- node is ready when:
    status == pending
    AND every dependency status == succeeded

Ordering:
- deterministic packet order when multiple nodes are ready.
- no priority scheduling initially.

Failure behavior:
- If node fails:
    - mark node failed.
    - recursively mark dependents skipped.
    - independent nodes may continue unless failFast is enabled.
- Final execution status is failed/partial if any node failed or skipped.
- Default failFast: false.

Worktree/apply boundary:
- Scheduler never merges worktree changes.
- Node executor/patch apply gate applies accepted patches to the active worktree.
- A dependent node should only become ready after upstream node result has succeeded, including successful patch application.
- Downstream worktrees are created from the active worktree after upstream patches have landed.

Parallel patch flow:
- Independent nodes can run in parallel in separate worktrees.
- When they finish, node executor/patch gate checks each patch against current active worktree:
    git apply --check
    git apply
- Packet ownership rules should prevent most conflicts, but patch gate is authoritative.

Conflict-triggered integration repair:
- Adopt bounded integration repair for git apply conflicts.
- This is a revision to the earlier “no retries initially” recommendation.
- Repair belongs inside node executor / patch apply gate, not scheduler.
- Scheduler still sees only runNode success/failure.

Integration repair trigger:
- Only when original patch passed ownership/metrics checks but git apply --check fails against current integrated active worktree.
- Not triggered for:
    worker failure
    missing metrics
    forbidden/owned-file violation
    validation failure
    general review failure
    scope ambiguity

Integration repair policy:
- Always tier1 realtime, even if original node was tier2.
- Reason: conflict repair blocks the active DAG and needs current integrated state.
- Bounded attempts, e.g. maxRepairAttempts = 2.
- Allowed writes: original conflicted unit ownedFiles only, unless packet explicitly allows overlap/serialization.
- Prompt/input:
    original workerPacket
    original task intent
    ownedFiles
    rejected patch.diff
    git apply --check stderr
    current contents of ownedFiles from active worktree
    summary of already applied upstream/parallel patches if available
- Goal:
    make the rejected patch intent apply cleanly to current integrated state.
    no scope expansion.
- If repair succeeds:
    capture repair patch
    enforce ownership
    run node validation
    git apply --check/apply
    mark original node succeeded
- If repair fails/exhausts:
    mark original node failed
    skip dependents

Recorder events scheduler should emit/cause:
- node_ready
- node_started
- node_succeeded
- node_failed
- node_skipped
- scheduler_finished

Repair events are emitted by node executor/patch gate:
- patch_apply_conflict
- integration_repair_started tier=tier1
- integration_repair_finished
- integration_repair_failed

Recommended API:
runDag(packet, {
  maxConcurrency,
  failFast: false,
  runNode,
  recorder
})

Prior decision changes:
- Change “no automatic retry/repair initially” to:
    no general retry/repair, but allow bounded tier1 conflict-triggered integration repair for git apply conflicts.

Deferred/skipped:
- priority scheduling
- dynamic DAG mutation
- resume/replay
- general test-failure repair
- general LLM review repair
- user-facing retry config
```
---
Phase 3 component: Worktree manager + subprocess worker runner

```text
Design alignment:
- Worktree manager is deterministic code. No LLM.
- Worker prompt builder is deterministic code. No LLM.
- Subprocess worker runner is the LLM boundary.
- Fanout remains provider-agnostic. Use FANOUT_* env vars for execution artifacts/metrics.
- Doubleword-specific env vars may be set only as compatibility bridge if current provider metrics need it.

Worker command shape:
pi \
  --no-context-files \
  -e <fanout-extension-entry> \
  --model <provider>/<model> \
  -p @<worker-dir>/prompt.md

Exact prompt-file flag can be confirmed during implementation; contract is:
- non-interactive print run
- cwd = isolated worker worktree
- one deterministic prompt
- exits after one work unit
- parent captures artifacts

Why --no-context-files:
- Global AGENTS.md contains interactive main-session rules such as “plan and wait for user confirmation.”
- Those rules are wrong for approved, non-interactive worker subprocesses.
- Main session already handled planning and approval.
- Worker must not ask user questions or wait for confirmation.

Context policy:
- Worker subprocesses should not automatically load global/project context files.
- Parent builds a curated prompt/context bundle instead.
- Include relevant project instructions explicitly.
- Exclude global interactive instructions.

Prompt must state:
- This is a Fanout worker subprocess.
- Parent session already received user approval.
- Do not ask for confirmation.
- Do not broaden scope.
- Implement only this work unit.
- Edit only owned files.
- Do not commit.
- Stop after completing this unit.

Prompt/context bundle includes:
- packet objective
- userContext
- discoveredRepoFacts
- workUnit.workerPacket
- ownedFiles
- readOnlyFiles
- validationCommands
- acceptanceCriteria
- stopRules
- relevant repo-local AGENTS.md / CLAUDE.md content if curated by parent
- no main chat history unless explicitly summarized into workerPacket/handoffContext

Main vs worker:
Main Pi session:
- interactive TUI
- full conversation history
- global AGENTS.md applies
- plans/asks/gets confirmation
- active repo worktree
- controller

Worker Pi subprocess:
- non-interactive
- no inherited chat history
- --no-context-files
- isolated git worktree cwd
- one approved work unit
- returns patch + metrics only

Per-node flow:
1. Scheduler calls runNode(workUnit).
2. runNode creates isolated git worktree when node starts.
   - Worktree is based on current active worktree state at node start.
   - Downstream nodes see upstream applied patches.
3. Build deterministic worker prompt.
4. Spawn child pi in worker worktree.
5. Capture stdout/stderr/session/observability artifacts.
6. Import mandatory metrics.
7. Capture git diff as patch.diff.
8. Return worker result to node executor pipeline.
9. Node executor handles ownership enforcement, validation, patch apply gate, and typed recovery.

Recommended worker artifact layout:
<execution-run-dir>/
  workers/
    <node-id>/
      worktree/
      prompt.md
      stdout.log
      stderr.log
      observability.jsonl
      patch.diff
      patch-stat.json
      result.json

Provider-agnostic environment contract:
- FANOUT_OBSERVABILITY_FILE=<worker-dir>/observability.jsonl
- FANOUT_RUN_ID=<execution-run-id>
- FANOUT_NODE_ID=<node-id>
- FANOUT_WORKER_DIR=<worker-dir>

Optional provider bridge:
- DOUBLEWORD_OBSERVABILITY_FILE=$FANOUT_OBSERVABILITY_FILE
- DOUBLEWORD_RUN_ID=$FANOUT_RUN_ID-$FANOUT_NODE_ID
Only set if needed for current Doubleword provider observability.

Worker success requires:
- child process completed successfully
- mandatory metrics are complete
- required patch exists unless unit explicitly allows no-op
- result artifacts are readable

Accepted LLM worker metrics are mandatory:
- provider
- model
- tier
- inputTokens
- outputTokens
- totalTokens
- estimatedCostUsd
- pricingSource
- ttftMs
- pollCount
- pollDurationMs
- toolDurationMs
- workerDurationMs

Missing metrics:
- worker result fails
- no patch acceptance
- no recovery repair

Recovery framework:
- Typed recovery hooks only; no generic repair agent.
- Recovery belongs inside node executor / patch apply gate, not scheduler.
- Initial recovery classes:
  1. integration-conflict-repair
     - trigger: git apply --check conflict after metrics/ownership/validation passed
     - tier: always tier1 realtime
     - writes: original ownedFiles only
     - bounded attempts, e.g. 2
  2. validation-failure-repair
     - trigger: node validation failed after ownership passed
     - tier: tier1 realtime
     - writes: original ownedFiles only
     - bounded attempts
  3. one clean rerun
     - trigger: timeout/transient subprocess failure
     - tier: original assigned tier
     - fresh worktree, original prompt
     - at most once

Hard-stop failures with no recovery:
- missing metrics
- ownership violation
- forbidden file/resource touch
- malformed result
- scope ambiguity
- unsafe command/tool behavior

Prior decision changes:
- Worker subprocesses use --no-context-files with curated prompt context, rather than inheriting global/project AGENTS.md automatically.
- Change “no automatic repair” to typed bounded recovery hooks only.

Deferred/skipped:
- worker pool
- resume/replay
- container sandbox
- generic subagent framework
- generic repair agent
- interactive child workers
- user-facing recovery config
```
---
Phase 3 component: Patch capture / ownership enforcement / apply gate

```text
Design alignment:
- Patch capture/enforcement is deterministic except typed recovery workers.
- Worker edits only its isolated worktree.
- Scheduler does not capture, validate, or apply patches.
- Node executor owns:
    capture patch -> ownership enforcement -> validation -> apply gate -> typed recovery if allowed.
- Active worktree is the only apply target.
- Node patch application is atomic: apply whole node patch or fail the node.
- No partial patch application.

Pipeline:
1. Worker subprocess completes and mandatory metrics are present.
2. Capture patch from worker worktree:
    git diff --binary --no-ext-diff
    git diff --name-only
    git diff --numstat
3. Write artifacts:
    patch.diff
    patch-stat.json
    changed-files.json
4. Enforce ownership:
    every changed file must be inside workUnit.ownedFiles / owned resources.
5. Hard fail if ownership or forbidden scope is violated.
6. Run node validation commands in the worker worktree after ownership passes.
7. If validation passes, run git apply --check against active worktree.
8. If apply check passes, git apply patch.diff to active worktree.
9. Mark node succeeded only after apply succeeds.
10. If validation/apply conflict recoveries are triggered, repaired output goes through the same gates again.

Recommended worker patch artifacts:
<worker-dir>/
  patch.diff
  patch-stat.json
  changed-files.json
  ownership-check.json
  validation.json
  apply-check.json

Ownership rule:
- changed path must be covered by original workUnit.ownedFiles.
- Path matching should normalize paths relative to repo root.
- Directory ownership covers descendants.
- Exact file ownership covers only that file.
- Writes outside ownedFiles are hard fail.
- Forbidden file/resource touch is hard fail.
- No recovery for ownership violations.

Validation:
- Run workUnit.validationCommands in the worker worktree after ownership passes.
- Capture command, exit code, stdout/stderr, durationMs.
- Unsafe commands should already be rejected by packet validation; still record failures.
- Validation failure may trigger typed validation-failure-repair.

Apply gate:
- Run git apply --check patch.diff from active worktree.
- If clean, run git apply patch.diff.
- If git apply --check fails due to conflict/staleness, trigger integration-conflict-repair.
- If repair succeeds, apply repaired patch after all gates pass.
- If repair fails/exhausts, node fails.

Typed recovery hooks:
1. validation-failure-repair
   - Trigger: ownership passed, validation failed.
   - Tier: tier1 realtime.
   - Writes: original ownedFiles only.
   - Inputs: original intent, ownedFiles, validation command/output, current worker worktree state.
   - Attempts bounded, e.g. maxValidationRepairAttempts = 2.
   - After repair: recapture patch and rerun ownership + validation + apply gate.

2. integration-conflict-repair
   - Trigger: metrics/ownership/validation passed, but git apply --check failed against active worktree.
   - Tier: tier1 realtime.
   - Writes: original ownedFiles only unless packet explicitly allows overlap.
   - Inputs: original intent, workerPacket, rejected patch.diff, git apply stderr, current active contents for ownedFiles, summary of already applied patches if available.
   - Attempts bounded, e.g. maxIntegrationRepairAttempts = 2.
   - After repair: capture repair patch and rerun ownership + validation + apply gate.

Hard stops with no recovery:
- missing mandatory worker metrics
- patch touches outside ownedFiles
- forbidden file/resource changes
- malformed/unreadable patch
- unsafe command/tool behavior
- scope ambiguity
- repair output violates ownership
- repair output missing metrics

Git commands:
- Capture patch:
    git diff --binary --no-ext-diff
    git diff --name-only
    git diff --numstat
- Apply:
    git apply --check <patch.diff>
    git apply <patch.diff>

Design decisions:
- Use git patch format, not custom diff.
- Enforce ownership before validation and before apply.
- Worker never applies to active worktree.
- Scheduler never applies patches.
- Same gates apply to original and repair patches.
- No three-way merge magic initially.
- No partial apply.
- No scope expansion.
- No generic repair agent.

Recorder events expected:
- patch_capture_started / patch_capture_finished
- ownership_check_started / ownership_check_finished
- validation_started / validation_finished
- patch_apply_check_started / patch_apply_check_finished
- patch_applied
- patch_rejected
- validation_repair_started / validation_repair_finished / validation_repair_failed
- integration_repair_started / integration_repair_finished / integration_repair_failed

Prior decision changes:
- none beyond already accepted typed bounded recovery hooks.

Deferred/skipped:
- partial patch application
- manual conflict UI
- three-way merge strategy
- generic repair agent
- ownership expansion during execution
```
---
Phase 3 component: Tier2 retry / tier1 fallback policy

> **Historical schema-v3 note — superseded 2026-07-10.** The component text below preserves the original Tier2 → Tier1-control-model fallback decision for chronology; it is not the current execution contract. Schema v4 uses the packet's concrete realtime `tierPlan.tier2Fallback` model after retryable Tier 2 exhaustion, while typed validation and integration repairs remain on Tier 1. See [`docs/impl/phase-3-fanout-execute.md`](TIER_MODEL_RESOLUTION.md#execution-routing).

```text
Design alignment:
- Retry/fallback decisions are deterministic. No LLM for policy decisions.
- Worker attempts use LLM; policy classification/counting/accounting does not.
- Retry/fallback belongs inside node executor, not scheduler.
- Scheduler sees only runNode(workUnit) -> succeeded/failed.
- No replanning or scope expansion during retry/fallback.
- Same workUnit intent and same workerPacket are reused.

Definitions:
- retry = same tier, same prompt, fresh worktree.
- fallback = tier2 -> tier1, same work unit intent, fresh worktree.
- repair = tier1 narrow fix after validation/apply failure.

Default limits:
- tier2MaxAttempts = 2 total
  - original tier2 attempt + one retry
- tier1FallbackMaxAttempts = 1
- no dynamic budgets initially
- no user-facing retry config initially

Retryable tier2 failures:
- provider 429/5xx
- async poll transient error
- timeout before model result
- network failure
- child process crash before usable patch/result
- subprocess infrastructure failure

Not retryable / hard-stop failures:
- missing mandatory metrics
- ownership violation
- forbidden file/resource touch
- unsafe command/tool behavior
- malformed/unreadable patch
- scope ambiguity
- validation failure
- git apply conflict

Fallback policy:
- If tier2 attempts are exhausted due to retryable failures, run one tier1 fallback attempt.
- Only fallback when workUnit.tier.fallback === "tier1".
- Fallback uses same workUnit intent/workerPacket and a fresh worktree.
- If tier1 fallback succeeds, continue normal gates.
- If tier1 fallback fails, node fails.
- No fallback for unsafe output or missing metrics.

Worktree policy:
- Every attempt gets a fresh worktree.
- Failed worktrees/logs/artifacts are preserved.
- Never reuse a dirty failed worktree.

Accounting:
- Every attempt is recorded, including failed/retried/fallback attempts.
- Totals include all known attempt tokens/costs/durations.
- Do not hide tier2 waste when fallback succeeds.
- Missing metrics remains hard fail; do not invent or backfill fake metrics.

Example flow:
tier2 node A
  -> attempt 1 tier2 transient timeout
  -> attempt 2 tier2 transient 5xx
  -> tier1 fallback attempt
  -> normal patch gates
  -> node succeeded or failed

Interaction with typed repair:
- If tier2/fallback worker succeeds and produces a patch:
    patch capture -> ownership -> validation -> apply gate.
- validation failure triggers tier1 validation-failure-repair.
- git apply conflict triggers tier1 integration-conflict-repair.
- retry/fallback handles worker/provider/subprocess failures before patch gates.
- repair handles valid worker output that fails validation/apply.

Recorder events expected:
- worker_attempt_started
- worker_attempt_finished
- worker_attempt_failed
- worker_retry_scheduled
- worker_fallback_started
- worker_fallback_finished
- worker_fallback_failed

Design decisions:
- Retry/fallback in node executor, not scheduler.
- Retry only retryable/transient tier2 execution failures.
- Tier1 fallback only after retryable tier2 exhaustion and only if packet says fallback tier1.
- Same work unit, no replanning.
- All attempts count toward metrics/cost.
- Missing metrics is hard failure, not retry/fallback.

Prior decision changes:
- none; this refines existing tier fallback fields already present in packet schema.

Deferred/skipped:
- dynamic retry budgets
- exponential backoff tuning
- user-facing retry config
- multi-provider fallback
- fallback for unsafe output
- fallback after validation/apply failures, because those use typed repair instead
```
