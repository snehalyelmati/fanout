# p-map AbortSignal manual Fanout E2E

Status: the profile-v1/packet-v7 sequence ran on 2026-07-27. The canary and repetitions 1–2 completed; repetition 3 stopped on bounded fused-node validation-repair exhaustion. The 2026-07-28 Worker-summary sequence first exposed and stopped on a confirmation-label defect. After the reviewed `3fef090` fix, its restarted canary completed and repetition 1 stopped on bounded runtime-test validation-repair exhaustion. The later realistic-task canary naturally joined runtime implementation and behavioral tests under reviewed planning fix `0f008e1`, then stopped when that joint node exhausted its two validation repairs. All three 2026-07-29 live prompt canaries completed: the first used one all-files work node, the second preserved three serial independently owned items, and the third made those three work nodes concurrently ready while retaining a joint runtime/test boundary. The user paused the third canary's repetitions before any were started. Exact evidence is retained in the tracker.

## 2026-07-29 parallelism prompt canary

Source commit `3926f8f57d4b454cf31f0fe676ac74ddd9b51069` plus batching-discipline SHA-256 `84e9661ee7325a98b0003518e2e9d6846efbbe9b67387e403a7bfac389209898` and implementation-plan/details prompt SHA-256 identities `09ba7e3336621a54e0eeb07f9114995e0dad835a19d0c2f05b93f4391046e8b3` / `f2427fec894a41c51eeb94a4c7c5ea95fdf3090daaf350ccbc081e4cfd4fce9f` passed focused planning gates. Pane `%263` ran from clean detached worktree `controlled-20260729-prompt-update/canary-3` at the fixed baseline; all 51 baseline tests passed.

Ordinary planning used the unchanged realistic task without a decomposition override. The immutable graph made the joint runtime/test item, types item, and README item concurrently ready, followed only by final validation. Profile SHA-256 was `712517fe7194f0343c9e65077ed1661a38b54d36f4936a2702cef52712e1e099`, 1,884 bytes; packet SHA-256 was `19aae3ecf5629efe52d771cba408659bd7ace8c5ca228b24297a14e4a2feecba`, 30,042 bytes. Dry-run `2026-07-29T17-04-06-745Z-0ccaa087` passed with zero attempts or tokens.

Live canary `2026-07-29T17-07-55-275Z-f8eca267` completed after types and README passed on their original Terra attempts and the original Terra runtime candidate failed four XO checks. Sol validation repair 1 received the original Worker summary, repaired the cumulative candidate, and passed. Both ordered final `npm test` gates and an independent 55-test run passed on exact accepted tree `02541d0d3dc8b18df9a36220664e873ac3d53cc9`.

The run took 267.536s, used 340,140 tokens, and cost `$0.497531`; the profiler recorded a 224.839s completion boundary and 48.313s node overlap. Cleanup took 6.366s with no current-run worker process, worker worktree, or execution lock. Pane `%263` remains visible. The user paused repetitions 1–3 before any repetition resources or runs were created, so no median, range, reliability rate, or SLO is reported.

## 2026-07-29 safe-parallelism prompt canary

Source commit `3926f8f57d4b454cf31f0fe676ac74ddd9b51069` plus the user's uncommitted batching-discipline SHA-256 `84e9661ee7325a98b0003518e2e9d6846efbbe9b67387e403a7bfac389209898` and implementation-plan prompt SHA-256 `e6d7a3c46f8d05278cc6803886c16e01ed41e6c83087c81c00e25b236c2b1b48` passed the full Fanout check, provider tests, and diff check. Pane `%262` ran from clean detached worktree `controlled-20260729-prompt-update/canary-2` at the fixed baseline; all 51 baseline tests passed. Pane `%261` was closed only after `%262` was confirmed alive.

Ordinary planning used the unchanged realistic task without a decomposition override. Phase A produced a joint runtime/test item (`index.js`, `test.js`), a types item (`index.d.ts`, `index.test-d.ts`), and a documentation item (`readme.md`). Honest typed reads from types to `index.js` and documentation to `index.d.ts` made the immutable graph serial; no fusion occurred. The fresh profile included isolated preparation, offline readiness, deterministic XO candidate normalization, and `npm test`. Profile SHA-256 was `b0b890d05e72ebe3afea325e09b2250841a22bce9cac8cf59c7a200004e88894`, 1,873 bytes; packet SHA-256 was `d9a09e778e3290ee5ba14de71fc954ce38acce85ed09f10a26f99328e586b55b`, 30,974 bytes.

Dry-run `2026-07-29T16-34-47-209Z-b71541d6` passed. Live canary `2026-07-29T16-35-28-543Z-9dbcf498` completed after the original Terra runtime candidate failed two XO checks, Sol repair 1 passed XO but failed one existing out-of-order iterable test, and Sol repair 2 passed. Types and documentation passed on their original Terra attempts. Both ordered final `npm test` gates and an independent 54-test run passed on exact accepted tree `7cd01449805065d2a57f732e2d7431875d216b9e`.

The run took 525.529s, used 539,203 tokens, and cost `$0.833411`; the profiler recorded a 467.485s completion boundary and zero node overlap. Cleanup took 7.681s with no current-run worker, worker worktree, process, or lock leak. Runtime summary continuity held original → repair 1 → repair 2, and summaries remained outside Event v4. Pane `%262` remains visible. This is another fresh packet/profile sample, not an identical repetition, so no median, range, reliability rate, or SLO is reported.

## 2026-07-29 action-first prompt canary

Source commit `3926f8f57d4b454cf31f0fe676ac74ddd9b51069` plus the user's uncommitted batching-discipline SHA-256 `25597ad6f2447a08073b20ac7b44921a60745811e7833bea82ce9826435e4281` passed the full Fanout and provider gates before execution. Pane `%261` ran from fresh detached worktree `controlled-20260729-prompt-update/canary` at the fixed p-map baseline; all 51 baseline tests passed.

Fresh planning used the realistic task without a boundary override. The action-first Phase A prompt grouped `index.js`, `test.js`, types, type tests, and documentation into one work item. This safely preserved the inseparable runtime/test boundary but removed the previous parallel types/docs branches. The fresh profile omitted candidate normalization. Profile SHA-256 was `7e1adb3fda9cf4c2846020292f53cdc80f9496e85dde2ef3189a553df013a633`, 1,380 bytes; packet SHA-256 was `c0855dbdaf07d2a642e0eb16c52f450d22b38efea75051abcd3bde554eb76779`, 24,650 bytes.

Dry-run `2026-07-29T15-39-45-828Z-f95147c9` passed. Live canary `2026-07-29T15-40-31-736Z-90f6d680` completed after the original Terra candidate failed XO and one Sol validation repair passed. Both ordered final `npm test` gates and an independent 56-test run passed on exact tree `8ab065bea4d19f73bae7036278666028d0b3db55`.

The run took 416.529s, used 629,129 tokens, and cost `$0.657389`; the profiler recorded a 381.009s completion boundary and zero node overlap. Cleanup took 2.879s with no current-run worker, worktree, process, or lock leak. Immediate worker-summary continuity held and summaries remained outside events. Pane `%261` was retained through evidence capture, then closed after replacement pane `%262` was alive. Because the plan shape and profile changed, this is not an identical repeat and no median, range, reliability rate, or SLO is reported.

## 2026-07-28 realistic-task stopping result

Reviewed planning fix `0f008e1a94b6abad78e188fbac6d74517d7b89b3` ran from pane `%259` against realistic issue-style task SHA-256 `fbce63dd802d73b83d7861c3981d7a4fd4f1b4bd79aff92c5e0e3175c737e585`. Ordinary planning used no decomposition override and produced one runtime work contract owning and reading both `index.js` and `test.js`.

The fresh profile was SHA-256 `441847c95a17aa63dbb949556c7126809fbc7498e60a7972563d304e9a7908e6`, 2,054 bytes; packet SHA-256 `d2f5aba9b5c91e3bea50b13025b875b56e34f1a9e8a62726706c7cb51a690c72`, 46,540 bytes. Their pointer and artifact bytes remained unchanged through dry-run and live execution.

Dry-run `2026-07-28T13-18-11-916Z-43f4ee83` passed. Live canary `2026-07-28T13-19-03-879Z-2f6c81a7` stopped after the joint runtime/test node used both validation repairs. The terminal AVA output passed the new deterministic abort coverage but failed the existing timing-bound `pMapIterable - concurrency: 2` assertion at 304.840 ms. One isolated byte-exact replay of rejected tree `f25f683277d723bc9419151564eaec7103fae947` failed the same assertion at 303.720 ms while the new tests again passed, indicating a repeatable candidate scheduling regression rather than a simple one-off flake. The documentation node's accepted tree `01fe048ef351ae311607da711ae456b7c1e060e8` passed the independent 51-test baseline. Cleanup removed current-run workers, worktrees, processes, and the lock; failed pane `%259` remains visible.

The run took 387.393s, used 548,192 tokens, and cost `$1.028695`; the profiler recorded a 367.567s prefix and 71.500s parallel overlap. Immediate worker-summary continuity held through both runtime repairs and the documentation repair, while summaries remained outside outcomes and events. The stop rule prevented repetitions 1–3. This revised-task input is not byte-identical to prior cohorts, so no completed-run median, range, reliability rate, or SLO is reported.

## 2026-07-28 Worker-summary stopping result

Reviewed Worker-summary commit `a06755bf3bbfab06e64a3915cfed1cdbb0647409` plus reviewed confirmation fix `3fef09013dde4ad32e1446bd76201d8f2f161e49` used fresh panes `%252` and `%253` in detached `controlled-20260728-worker-summary/{canary,rep-1}` worktrees. Tier 1 was `openai-codex/gpt-5.6-sol` medium, async Tier 2 was disabled, and the Tier 2 fallback was `openai-codex/gpt-5.6-terra` medium. The exact packet was SHA-256 `d2a0e3726b78abfdba02709ba86798e91d0f2975cbc97e737c66ed0fb4cd76ea`, 38,661 bytes; its profile was SHA-256 `77573f46e3b2f8dbbb975a3e6ca73ee583ad37ca454d6ff6842edd3c1172c6c0`, 2,230 bytes. Pointer and artifact identities matched exactly across both runs.

Corrected canary `2026-07-28T10-59-03-363Z-f88ca6ff` completed in 420.728s for 486,170 tokens and `$0.8393655`; final validation and an independent 55-test run passed on tree `73e501a361dbb433faae3bc4ef6c013021076584`. Repetition 1 `2026-07-28T11-11-03-020Z-81129b36` stopped after `runtime-tests` exhausted its two validation repairs: its deterministic pending-abort test exposed production `index.js` destructuring an undefined abort-race result, which the test-only worker could not repair. The accepted partial tree `f1863b2c735f9d82ece8d31664ea1dde5490d52c` passed the original 51 tests. It ran 396.535s, used 529,343 tokens, and cost `$1.0167785`.

The canary proved original → repair 1 and repair 1 → repair 2 summary continuity; summaries remained confined to prompts and optional `result.json` evidence and were absent from authoritative outcomes/events/projections. Pane `%252` was closed after capture; failed pane `%253` remains visible. No lock or current-run worker/worktree leaked. The stop rule prevented repetitions 2–3. With only one completed run, no median, completed-run range, reliability rate, or SLO is reported.

## Objective

Run one complete Fanout benchmark as a product-debugging session against [`sindresorhus/p-map`](https://github.com/sindresorhus/p-map). Prioritize UX refinement, correctness bugs, recovery behavior, and observability gaps.

Do not automate the benchmark, create routing variations, or modify benchmark files merely to force a pass. Diagnose whether each issue belongs to Fanout, the provider/runtime, the benchmark task, or p-map before changing anything.

## Fixed setup

| Item | Value |
| --- | --- |
| Task | Add `AbortSignal` support to `pMapIterable` |
| Task brief | `<p-map-benchmark>/TASK.md` |
| Nested repository | `<p-map-benchmark>/repo` |
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
cd <p-map-benchmark>/repo
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
rtk tmux split-window -t doubleword:fanout-canary -c <absolute-run-worktree> -P -F '#{pane_id}' -- env -u DOUBLEWORD_API_KEY pi -e <fanout-source>/packages/fanout-pi/src/index.ts
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
/fanout-plan --refresh-profile Read ../TASK.md and implement that feature request exactly.
```

The profile uses isolated direct-argv preparation/readiness with explicit purpose, mutation, network, and lifecycle disclosures, declares direct-argv offline XO candidate normalization, and includes the repository-wide required final gate. It must not share or link `node_modules`. Repetitions reuse the exact validated profile and packet bytes.

Expected flow:

1. Phase A reads `../TASK.md`, explores p-map, and writes an implementation plan with the resolved objective.
2. Phase B binds the exact accepted plan identity and grounds task-specific files, anchors, edit intent, and validation commands; it does not own profile commands.
3. The deterministic compiler emits plan v3, details v5, and profile-bound packet v7 with embedded work-contract v3 nodes and any eligible vertical fusion.
4. Planning writes immutable artifacts under Pi-owned storage, derives human views from packet v7, and publishes pointer v2 last without modifying p-map.

The task brief is a realistic issue-style feature request. It states that the
runtime implementation and behavioral regression tests must pass together,
without prescribing nodes, ownership, fusion, or repair boundaries. A
clarification question is acceptable only if repository evidence exposes a real
unresolved choice.

## 5. Review gate

Do not execute a materially incorrect packet. Confirm the generated plan is understandable and preserves these repair boundaries:

```text
runtime-and-behavioral-tests ──┐
types ─────────────────────────┤
docs ──────────────────────────┤
                               └──> final validation
```

Expected ownership and validation:

| Node | Owns | Depends on | Validation |
| --- | --- | --- | --- |
| `runtime-and-behavioral-tests` | `index.js`, `test.js` | none | `npx xo index.js test.js && npx ava test.js` |
| `types-abort` | `index.d.ts`, `index.test-d.ts` | none | `npx tsd` |
| `docs-abort` | `readme.md` | none | `git diff --check` |
| final validation | none | all workers | `npm test` |

The runtime implementation and deterministic behavioral regression tests must
share one independently acceptable and repairable boundary. Prefer one Phase A
item; compiler fusion is acceptable only when the immutable packet proves the
same union. Split items may declare shared reads only when they genuinely need
that context; reads must never be padded merely to force fusion.

The active profile, not details or the packet, declares candidate
normalization. Packet final commands execute before profile-required final
gates.

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
Task: <p-map-benchmark>/TASK.md
Repo: <p-map-benchmark>/repo
Baseline: c3c261e2189f94d1a09724e8f03d5345af518017
Mode: manual product-debugging E2E; no automated variations
Constraint: do not initiate live or cost-incurring calls without explicit authorization
```

Paste Pi output, screenshots, errors, and relevant artifacts into that chat as the run progresses. The monitoring chat should keep the findings ledger and produce the final report; the user remains the operator and authorization owner.
