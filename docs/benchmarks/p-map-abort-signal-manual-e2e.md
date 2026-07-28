# p-map AbortSignal manual Fanout E2E

Status: the profile-v1/packet-v7 sequence ran on 2026-07-27. The canary and repetitions 1–2 completed; repetition 3 stopped on bounded fused-node validation-repair exhaustion. A fresh Worker-summary sequence started on 2026-07-28, passed profile validation and dry-run, and stopped before worker launch when the live confirmation mislabeled the details digest as the packet identity. Exact evidence is retained in the tracker; a corrected source revision must restart at the canary.

## 2026-07-28 Worker-summary stopping result

Reviewed Fanout commit `a06755bf3bbfab06e64a3915cfed1cdbb0647409` used pane `%251` in detached worktree `controlled-20260728-worker-summary/canary`. Tier 1 was `openai-codex/gpt-5.6-sol` medium, async Tier 2 was disabled, and the Tier 2 fallback was `openai-codex/gpt-5.6-terra` medium. The exact packet was SHA-256 `d2a0e3726b78abfdba02709ba86798e91d0f2975cbc97e737c66ed0fb4cd76ea`, 38,661 bytes; its profile was SHA-256 `77573f46e3b2f8dbbb975a3e6ca73ee583ad37ca454d6ff6842edd3c1172c6c0`, 2,230 bytes.

Dry-run `2026-07-28T10-24-22-168Z-8dab93a2` passed with zero attempts. At the live confirmation, the renderer showed `Packet: f0264cb025eb`, which is the packet's source implementation-details SHA, not the authoritative active-packet SHA. The operator declined. Run `2026-07-28T10-24-49-234Z-12637a82` therefore ended `aborted` with zero worker attempts, tokens, cost, accepted patches, or final validation. Independent `npm test` still passed all 51 baseline tests and the detached p-map worktree remained clean. No repetition ran and no median, range, reliability rate, or SLO is reported.

## Objective

Run one complete Fanout benchmark as a product-debugging session against [`sindresorhus/p-map`](https://github.com/sindresorhus/p-map). Prioritize UX refinement, correctness bugs, recovery behavior, and observability gaps.

Do not automate the benchmark, create routing variations, or modify benchmark files merely to force a pass. Diagnose whether each issue belongs to Fanout, the provider/runtime, the benchmark task, or p-map before changing anything.

## Fixed setup

| Item | Value |
| --- | --- |
| Task | Add `AbortSignal` support to `pMapIterable` |
| Task brief | `/Users/snehalyelmati/Documents/p-map-abort-signal/TASK.md` |
| Nested repository | `/Users/snehalyelmati/Documents/p-map-abort-signal/repo` |
| Upstream SHA | `3ada5f36632aca8df860c376856270b6d2ba2de8` |
| Reproducible local baseline | `c3c261e2189f94d1a09724e8f03d5345af518017` |
| Baseline difference | committed `package-lock.json` only |
| Install | `rtk npm ci --ignore-scripts` |
| Baseline validation | `rtk npm test`; 51 tests |

The benchmark lives outside the Fanout repository, and the nested p-map repository must have no Git-visible changes when planning or executing. Hardened preflight requires the captured planning tree to equal its commit tree so detached workers can reconstruct it, then requires the active commit/full Git-visible tree to remain identical to that packet base.

## Constraints

- The user operates Pi and explicitly authorizes every live or cost-incurring step; this runbook is not authorization.
- The monitoring assistant must not initiate provider calls or live execution.
- Run benchmark Git commands from the nested p-map repository.
- Prefix executable shell commands with `rtk`.
- Do not expose or commit API keys.
- Preserve outer-repository work.
- Do not commit benchmark or Fanout changes unless explicitly requested.
- Keep failed and interrupted run artifacts for diagnosis.
- Do not build an automated harness or run experimental variations.
- Hold Fanout commit, packet/profile bytes, routing, concurrency, platform, and clean independent worktrees constant across the canary and repetitions.

## 1. Preflight

Change to the nested repository:

```bash
cd /Users/snehalyelmati/Documents/p-map-abort-signal/repo
```

Confirm the fixed baseline:

```bash
rtk git status --short --branch
rtk git rev-parse HEAD
rtk npm test
```

Required state:

- worktree is clean;
- `HEAD` is `c3c261e2189f94d1a09724e8f03d5345af518017`;
- all 51 baseline tests pass;
- no stale execution lock is present;
- the Fanout source revision used by the local extension is recorded with the run.

The nested branch being one commit ahead of upstream is expected because the reproducible baseline adds `package-lock.json`. Untracked `runs/` inside the nested repository is not expected; archive it outside `repo/` before continuing.

## 2. Launch Pi in a fresh visible pane

Confirm the existing visible target:

```bash
rtk tmux has-session -t doubleword
rtk tmux list-windows -t doubleword
```

For every canary or repetition, create a new pane rooted at that run's absolute clean p-map worktree, record the returned pane ID, then select it:

```bash
rtk tmux split-window -t doubleword:fanout-canary -c <absolute-run-worktree> -P -F '#{pane_id}' -- env -u DOUBLEWORD_API_KEY pi -e /Users/snehalyelmati/Documents/doubleword-pi/packages/fanout-pi/src/index.ts
rtk tmux select-pane -t <pane-id>
```

Do not set `FANOUT_WORKTREE_SHARED_PATHS`; current execution rejects it. Do not automatically kill the pane after completion. Visible output remains benchmark evidence, and pane cleanup is manual after evidence collection.

## 3. Inspect routing configuration

Inside Pi:

```text
/fanout-config
```

Record before leaving the screen:

- Tier 1 provider, model, and thinking level;
- Tier 2 provider, model, thinking level, and availability;
- Tier 2 fallback provider, model, thinking level, and whether it inherits Tier 1;
- Fanout artifact root;
- any missing prerequisite or confusing label.

Evaluate whether role descriptions, multiline rendering, arrow and `j`/`k` navigation, Enter, Escape, fallback inheritance, and cancellation are understandable. Keep one routing policy for this first run; do not create comparison variants.

## 4. Prepare the execution packet

For the canary, publish or refresh the approved Project Execution Profile before planning:

```text
/fanout-plan --refresh-profile Read ../TASK.md and implement that benchmark task exactly.
```

The profile uses isolated direct-argv preparation/readiness with explicit purpose, mutation, network, and lifecycle disclosures, declares `npx xo --fix` candidate normalization, and includes the repository-wide required final gate. It must not share or link `node_modules`. Repetitions reuse the exact validated profile and packet bytes.

Expected flow:

1. Phase A reads `../TASK.md`, explores p-map, and writes an implementation plan with the resolved objective.
2. Phase B binds the exact accepted plan identity and grounds task-specific files, anchors, edit intent, and validation commands; it does not own profile commands.
3. The deterministic compiler emits plan v3, details v5, and profile-bound packet v7 with embedded work-contract v3 nodes and any eligible vertical fusion.
4. Planning writes immutable artifacts under Pi-owned storage, derives human views from packet v7, and publishes pointer v2 last without modifying p-map.

The task brief is decision-complete. A clarification question is acceptable only if repository evidence exposes a real unresolved choice.

## 5. Review gate

Do not execute a materially incorrect packet. Confirm the generated plan is understandable and matches this intended DAG:

```text
runtime-abort ──> runtime-tests ──┐
types-abort ─────────────────────┤
docs-abort ──────────────────────┤
                                 └──> final validation
```

Expected ownership and validation:

| Node | Owns | Depends on | Validation |
| --- | --- | --- | --- |
| `runtime-abort` | `index.js` | none | `npx xo index.js && npx ava` |
| `types-abort` | `index.d.ts`, `index.test-d.ts` | none | `npx tsd` |
| `docs-abort` | `readme.md` | none | `git diff --check` |
| `runtime-tests` | `test.js` | `runtime-abort` | `npx ava` |
| final validation | none | all workers | `npm test` |

The active profile, not details or the packet, declares `npx xo --fix`. Packet final commands execute before profile-required final gates.

Evaluate this contract semantically rather than by textual equality with the table. Safe, non-mutating validation commands may be added when they are traceable to task requirements and preserve the authoritative final validation. Command wrappers such as `rtk` are operational conveniences, not packet-correctness requirements. Record harmless presentation differences separately; reject only behavior that changes ownership, dependencies, safety boundaries, required behavior, or authoritative validation. Generated summaries must either agree with the authoritative packet or clearly label omitted detail.

Only these files may be writable:

```text
index.js
index.d.ts
index.test-d.ts
readme.md
test.js
```

Also check:

- no ownership overlaps or unnecessary serialization;
- no dependency or configuration changes;
- Tier/provider assignments and fallback behavior are visible;
- concurrency and expected cost information are visible;
- artifact paths and the next action are obvious.
- the pointer is schema/version `fanout.active-packet`/2 and binds the exact packet digest, byte length, and artifact-relative path;
- the packet-bound profile is v1 and its exact path/digest/length verify; the active profile pointer may have advanced independently;
- the packet is `fanout.execution-packet` v7, binds plan v3/details v5 plus planning identity/platform, embeds work-contract v3 nodes, and contains no copied profile commands or flattened legacy authority.

If the packet is wrong, stop. Classify and diagnose the planning, routing, benchmark-task, or repository-grounding issue before editing anything.

## 6. Dry-run gate

```text
/fanout-execute --dry-run
```

Expected behavior:

- exact pointer-v2/packet-v7/profile-v1 identity, isolated profile validation, planning commit/tree/platform, derived DAG, executable commands, worker capability, and lock checks pass;
- no workers or provider calls launch;
- no p-map files change;
- an execution audit is written;
- displayed nodes, assignments, concurrency, and final validation match the reviewed packet.

After dry-run, confirm from the nested repository:

```bash
rtk git status --short --branch
```

A difference between the accepted plan and dry-run output is a Fanout correctness or observability finding. Do not proceed until it is understood.

## 7. Live execution gate

Provider-cost and mutation gate: the user must explicitly choose to run this command after accepting dry-run output.

```text
/fanout-execute
```

Run one canary first. If it and all post-run checks pass, run three additional repetitions from fresh independent clean worktrees and fresh tmux panes with identical Fanout commit, packet/profile bytes, routing, concurrency, and platform. Stop on any failure or artifact/configuration change; after any code, packet, profile, or configuration change, restart at the canary.

During execution, capture or note:

- start and finish timestamps;
- active execution versus waiting;
- worker starts, completions, and blocked dependencies;
- provider/model/tier per attempt;
- progress messages and unexplained quiet periods;
- retries, realtime fallback attempts, validation repairs, and integration repairs;
- deterministic reconciliations, exact-no-progress stops, and fused-node count;
- errors, recovery instructions, and user interventions.

Do not manually edit p-map while execution is active.

## 8. Repository verification

After execution, run from the nested repository:

```bash
rtk git status --short
rtk git diff --name-only
rtk git diff --check
rtk npm test
rtk git worktree list --porcelain
rtk ps -axo pid,etime,command
rtk tmux list-panes -t doubleword:fanout-canary -F '#{pane_id} #{pane_current_path} #{pane_dead} #{pane_current_command}'
```

Verify:

- only the five allowed files changed;
- Fanout did not commit the active worktree;
- the integrated diff implements the task rather than merely satisfying a test;
- independent `rtk npm test` agrees with reported final validation;
- reported status agrees with actual Git state.

## 9. Artifact inspection

Use paths printed by `/fanout-plan` and `/fanout-execute`. Inspect when relevant:

```text
events.jsonl
execution-run.json
summary.md
final-validation/rounds/*.json
workers/<node-artifact-id>/attempts/<attempt-artifact-id>/
```

Worker-attempt inspection should include `prompt.md`, stdout/stderr, `observability.jsonl`, `patch.bin` when capture succeeds, ownership checks, validation results, apply checks, and `result.json` for the patch identity, changed paths, statistics, process, metrics, and failure data.

Track:

- wall-clock duration;
- active execution and waiting time;
- TTFT, tool time, and provider polling time;
- input/output/cache tokens and provider cost;
- retries, fallback attempts, and repairs;
- worker and validation failures;
- changed files and patch statistics;
- discrepancies between events, summary, final validation, and Git.
- exact profile identity, phase timings, cleanup duration, tmux pane ID, and pane worktree.

## 10. Failure and interruption protocol

Do not rerun blindly.

1. Preserve the failed run directory.
2. Identify the last trustworthy event and artifact.
3. Check whether a worker process or execution lock remains.
4. Remove a lock only after confirming no execution owns it.
5. Classify the issue and identify its owning component.
6. Recommend the smallest owning-component fix.
7. Run focused offline validation after an approved fix.
8. Restart from the fixed baseline unless recovery is explicitly proven safe.

Never change the benchmark task or p-map files solely to hide a Fanout/provider failure.

## 11. Findings ledger

Maintain this table during the session:

| ID | Step | Classification | Symptom/reproduction | Owner/files | Severity | Decision/fix | Validation/status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P2-OBS-1 | Dry-run gate | observability gap | Historical dry run `2026-07-10T19-53-13-301Z-675e78e1` used a generic execution title and could be mistaken for a completed live run. | `packages/fanout-core/src/execution-report.ts`, `packages/fanout-pi/src/fanout-execute.ts` | medium | Current projection v5 renders an explicit dry-run outcome and states that workers/final validation did not run. | Profile-v1/packet-v7 dry run remains part of the new canary. |
| P2-WORKER-2 | Repetition 3 | provider/runtime problem | The fused runtime/test candidate first failed XO `no-inner-declarations`; both bounded repairs then left the same two generated AVA abort tests invalid, exhausting 2/2 validation repairs. | Terra worker output; no Fanout source owner | medium | Preserve the failed artifacts and stop the sequence. Do not expand budgets or alter the benchmark to force a pass. | All 5 allocations have terminal outcomes; accepted ledger contains only types/docs; cleanup passed; independent baseline tests pass; final validation correctly did not run. |
| P2-PROF-2 | Post-run inspection | correctness bug | The current profiler rejected a valid canary because total run duration begins before profile validation while `run-started` is emitted after that phase. | `packages/fanout-profiler/src/scenario.ts`, `scenario.test.ts` | medium | Admit total duration greater than the Event-log span while still rejecting a shorter impossible duration; continue deriving schedules from Event timestamps. | Focused regression passes and the original canary scenario now loads with exact profile identity and observed schedule evidence. Any new live sequence restarts at canary because source changed. |

Allowed classifications:

- correctness bug;
- UX friction;
- observability gap;
- planning/routing problem;
- provider/runtime problem;
- benchmark-task problem.

For every pasted error, screenshot, output, or observation:

1. explain what happened in plain language;
2. classify it;
3. identify the likely owner and relevant files;
4. recommend the smallest appropriate fix;
5. edit only when implementation is requested and approved;
6. update the findings ledger.

## 12. End-of-run report

Produce medians and the full observed range across the identical successful runs, without inferring a reliability rate or universal SLO:

1. a concise narrative of the E2E path;
2. ranked correctness bugs with reproduction steps;
3. ranked UX friction;
4. missing observability or artifact information;
5. changes made and validation results;
6. remaining blockers;
7. the recommended next manual run;
8. controlled benchmark variations only after the manual path is reliable.

Do not claim runtime, latency, routing, or cost results until the corresponding artifacts have been inspected.

## Fresh-chat handoff

Start the monitoring chat with this document as the source of truth and provide:

```text
Runbook: docs/benchmarks/p-map-abort-signal-manual-e2e.md
Task: /Users/snehalyelmati/Documents/p-map-abort-signal/TASK.md
Repo: /Users/snehalyelmati/Documents/p-map-abort-signal/repo
Baseline: c3c261e2189f94d1a09724e8f03d5345af518017
Mode: manual product-debugging E2E; no automated variations
Constraint: do not initiate live or cost-incurring calls without explicit authorization
```

Paste Pi output, screenshots, errors, and relevant artifacts into that chat as the run progresses. The monitoring chat should keep the findings ledger and produce the final report; the user remains the operator and authorization owner.
