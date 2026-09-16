# p-map efficiency pilot — 2026-09-06

Status: the initial three controller runs and an additional reverse-order pair completed. In the initial pilot, raw Pi and improved Fanout pass both semantic audits while current Fanout fails the pending-value abort case. Both candidates in the repeat fail that case; improved Fanout is slower and costlier in the repeat. The high-latency and reliability goals remain unmet.

Current direction (2026-09-07): the [high-latency study protocol](fanout-high-latency-study.md) broadens task/provider investigation and prioritizes stronger acceptance, correct-completion ordinary-Pi baselines and a small prompt experiment. The candidate-submission proposal below remains historical experimental reasoning, not an adopted architecture or the mandatory next step. Preserve this report's measurements and accounting boundaries.

The user approved implementation and measurement using p-map, and selected Codex Sol medium for Tier 1/raw Pi with Terra medium as Tier 2 fallback. This scoped pilot supersedes the historical manual-only/no-automation restrictions for these three runs. The user subsequently authorized further canary runs; the bounded reverse-order repeat below uses the same routing. No provider switch is included.

## Frozen inputs

- Task: unchanged `<p-map-benchmark>/TASK.md`.
- p-map baseline: `c3c261e2189f94d1a09724e8f03d5345af518017`; three independent local clones under `<local-workspace>/fanout-pmap-pilot-20260906/{raw,current,improved}`. User checkout `readme.md` remains untouched.
- Fanout current: exact archived revision `07db63f` at `<local-workspace>/fanout-efficiency-baseline-07db63f`. Improved: frozen reviewed source snapshot `<local-workspace>/fanout-efficiency-improved-source`; `improved-source-manifest.json` SHA-256 `2d287205591c864bc397b125a6f8d03e55e44609c5f0cd8bf322d54a354b1746`. Byte identities establish the measured source. Following direct user commit authorization, implementation was committed as `a7b5ef6` and `b6a6fab`; source/test bytes match that frozen snapshot.
- Routing: `openai-codex/gpt-5.6-sol` medium controller/raw Pi, async Tier 2 disabled, `openai-codex/gpt-5.6-terra` medium Tier 2 fallback, concurrency 4. Fixed product recovery budgets unchanged.
- Observed routing in both the initial pilot and repeat: every ordinary Fanout worker ran **Terra medium from its first attempt**, while planning and raw Pi ran Sol medium. Disabled async Tier 2 resolves directly to the configured realtime fallback; native worker allocations label this `tier1`. That label does not mean those workers used Sol, and no failed Sol attempt preceded them. This compares Sol-controlled/Terra-worker Fanout with raw Sol, not an all-Sol Fanout run.
- Reused approved profile: `20260727-161147660-read-users-snehalyelmati-documents-p-map` from prior p-map run. Identical bytes for both Fanout modes: `npm ci --ignore-scripts`; `npm ls --depth=0`; existing XO normalization; final `npm test` and `git diff --check`. No paid profile discovery. Profile preparation/validation during execution remains charged to E2E.
- Node 26.5.0. Exact lockfile dependencies installed independently. Each clean baseline passed all 51 tests.
- Pi SDK drives the ordinary session and extension commands; no custom worker loop. Isolated settings omit unrelated global extensions/skills for all modes, including subprocesses. Raw Pi receives the same task with ordinary built-in tools. Explicit approval text avoids artificial human waits. Confirmation decisions are logged with user authorization. No decomposition override.
- Run sequentially to avoid cross-mode local contention. One run per mode; a 20-minute SDK watchdog requests abort, with native execution/worker budgets unchanged. Preserve failed attempts and runs; no automatic reruns or budget increases.

## Acceptance and accounting

The external `acceptance.mjs` is frozen before provider runs. It checks exact abort reasons, zero work before an already-aborted signal, prompt abort of pending source and mapper operations, no later mapper/source starts, no later values, iterator close, listener removal on completion/failure/early exit, and changed-file scope. Deferred promises/counters drive ordering; a two-second deadline detects hangs, not performance. Its new-behavior checks fail on the original baseline. `npm test` and patch/test review supplement these checks; the model's own tests alone do not establish success. The acceptance script is not supplied in model context.

Evidence root: `<local-workspace>/fanout-pmap-pilot-20260906`. `run.mjs` records timestamped SDK events, notifications, confirmations and total driver wall time; Fanout retains its native complete planning/execution artifacts. `*-setup.json` records excluded common environment setup. Independent post-run audits are excluded consistently; their durations were not instrumented. Product final-validation time remains inside each E2E result. Human waits are zero unless a genuine unresolved clarification appears. Cost is Pi-reported estimated token cost, not cash billing for the user's Codex subscription.

The user explicitly reconfirmed that planning time must be included. Report full planning + execution + rejected work + repairs + final checks, along with model requests and outcome. Never compare only worker time with raw-Pi E2E. Any fixed-60-second-per-request calculation is a **counterfactual for the observed call graph**, not observed Doubleword performance or a forecast of provider quality. One sample per mode is not a reliability rate, median, p95 or SLO.

## Results

| Mode | E2E including planning | Planning | Reported token cost | Model requests | Independent acceptance |
| --- | ---: | ---: | ---: | ---: | --- |
| Raw Pi, Sol medium | 307.421s | In ordinary loop | $0.627699 | 20 | Passed; full suite 54 tests |
| Current Fanout, 07db63f | 486.832s | 146.604s | $0.8119022 | 4 planning +24 workers | Initial checks/56 tests passed; supplemental abort check failed |
| Improved Fanout | 393.781s | 89.811s | $0.5128764 | 2 planning + 16 workers | Passed; full suite 56 tests |

Current Fanout is 58.4% slower and 29.3% more expensive than raw Pi in this sample. Planning costs $0.451855 (72.0% of the entire raw-Pi cost); worker cost is $0.3600472. Three independent nodes each succeed on their original attempt, but runtime uses 16 model requests and five advisory validations, including three failed validations. Types and docs each use 4 requests. No controller repair/fallback budget is consumed. Counting attempts alone hides these internal correction rounds.

Current accepted tree:`7dc068a16fdf1f3c2747ec41fddede6e49671b94`. Final controller gates pass; final validation command time 8.780492s and cleanup 6.352894s are included in E2E. Exact event log:`artifacts/current-2760ac1d4eda/20260906-153938723-implement-the-following-approved-task-th/executions/2026-09-06T15-42-05-327Z-f418a961/events.jsonl` under the evidence root.

The profiler catalog incorrectly rejects a valid profile-bound planning lineage when `finalValidationCommands:[]` delegates all final gates to the bound profile. Measurement uses native packet identity verification, packet validation and strict event replay, not catalog admission. This read-only profiler defect is recorded separately; no benchmark authority was changed.


## Why request depth controls the outcome

Let `P` be paid planning time, `n_i` sequential model requests in branch `i` including repairs, `L` request latency, `g_i` generation/tool time, and `V` controller validation/integration overhead. Even with unlimited concurrent branches, execution cannot beat approximately `P + max_i(n_i L + g_i) + V`; genuine dependencies make the critical path longer. Parallelizing three 10-request agents still leaves ten latency payments, plus planning. With 60 seconds per request, removing a serial request is worth roughly a minute before generation and local work.

Cost includes all branches and failed attempts: `C_fanout = C_planning + sum(C_attempts)`. Cheaper workers help only when their aggregate cost plus the control plane stays below raw Pi. If planning alone approaches the raw cost, concurrency cannot fix the economics. A repair that replays the whole contract and source consumes both the latency margin and the cost margin.

The approved changes attack these terms directly: combine repeated planning investigations, preload exact source to remove discovery round trips, preserve independently repairable units, block ownership mistakes immediately, include scope-appropriate lint before controller rejection, and remove duplicate repair authority. More concurrency, speculative replicas and larger retry budgets cannot substitute for reducing sequential requests and rejected work.

A reliable operating policy ultimately needs measured savings margin across repeated tasks/providers and an inexpensive way to decline fanout on tasks with too little independent work. This pilot tests mechanisms and accounting, not that routing policy or reliability threshold. Those remain future decisions requiring evidence.

## Improvement and remaining limit

The improved run is **19.1% faster and 36.8% cheaper than current Fanout**, but **28.1% slower and 18.3% cheaper than raw Pi**. These are observed single-run resource deltas, not causal estimates or reliability claims. Current Fanout subsequently failed a supplemental semantic check, so its numbers are not the cost/time of a correctly completed task. Planning fell from 146.604s/$0.451855 to 89.811s/$0.21408; execution fell from 340.102s/$0.3600472 to 303.848s/$0.2987964. Driver timing includes small command handoff overhead in addition to these native phases.

The improved planner naturally grouped types and documentation into one independent public-contract node alongside runtime/tests. Therefore this pilot measures the whole changed workflow, not a controlled ablation of source preloading. The public-contract worker used prepared sources directly: edit all three files, validate, summarize (3 responses). Runtime still used 13 responses: it reread supplied files, implemented runtime before adding tests, validated incrementally five times (two failures), fixed behavior/lint and then finished. Early ownership never rejected a write in this pilot. No controller repairs occurred, so the ownership and compact-repair changes have offline regression coverage but no measured p-map speed contribution.

Improved accepted tree: `9edd506c53e26efdb6637bd1add1f45bbf228c9e`. Final controller gates passed, taking 8.127194s; cleanup took 3.677261s, both included in E2E. Native execution log: `artifacts/improved-3f6b9f4337a1/20260906-154907363-implement-the-following-approved-task-th/executions/2026-09-06T15-50-37-180Z-8ef47915/events.jsonl`.

### Fixed-60-second latency lower bound

Hold each observed graph and request count fixed, retain observed fast planning, replace every ordinary worker request with 60 seconds of latency, and optimistically make worker generation, tools, preparation, integration and final validation free. The lower bounds are:

| Workflow | Planning + critical worker latency alone |
| --- | ---: |
| Current Fanout | 146.604 + 16 × 60 = 1106.604s (18.44 min) |
| Improved Fanout | 89.811 + 13 × 60 = 869.811s (14.50 min) |
| Observed raw Pi reference | 307.421s (5.12 min) |

This is a counterfactual lower bound, not a provider prediction. It demonstrates that this observed worker loop cannot meet the intended latency target even if its tokens become nearly free. Reducing total requests from 28 to 18 helped, but the 13-request critical worker path remains decisive. With roughly 90s planning and 31s of other execution overhead in the improved sample, three 60s worker calls already consume about 301s before generation. The next experiment should target one cheap candidate response, with at most one bounded correction and fast repairs, rather than hoping ordinary exploration converges in a few turns.

### Proposed next experiment — requires approval

Inspected: `worker-context.ts`, `worker-capabilities.ts`, `worker-validation.ts`, `fanout-worker-contract.ts`, `worker-attempt-execution.ts`, `index.ts`, the planning controller’s `terminate:true` submission, and all three pilot traces.

Decisions followed: independent provider/core boundaries, normal Pi session machinery, exact manifest/patch authority, isolated candidates, fixed repair budgets and independent controller validation.

Proposed change to prior decisions: custom candidate transport becomes a bounded prototype. Original decision: retain ordinary Pi worker tools and defer custom candidate submission until evidence justifies it. Proposed change: prototype a terminating `fanout_submit_candidate` tool for a fully prepared p-map worker, reusing Pi's existing terminating-tool mechanism. The model submits all authorized file changes and its summary in one response. Existing manifest ownership checks, normalization, patch capture, controller validation, accepted-state isolation and fixed repair budgets still apply. Validation failure goes through existing fast repair handling; no larger retry budget or speculative replicas.

Expected benefit: remove model round trips for source discovery, incremental validation and post-validation narration from the cheap-provider critical path. Tradeoff: a bounded source packet may miss necessary context, and a one-response candidate may fail more often. Measure that failure/repair cost rather than hiding it. Keep normal workers available for unsuitable contracts; this is a bounded experiment, not a general routing change.

Touch only the inspected seams, a focused candidate-submission module, boundary tests and benchmark/decision docs. Validate malformed/duplicate/out-of-scope writes, absent context, termination, preserved normalization and final acceptance, then one isolated p-map candidate pilot with the same Codex routing. Deferred/skipped: larger cohorts, actual slow-provider calls, adaptive routing, provider concurrency changes and caching until this mode has measured evidence. No implementation of this proposed change is included in the current diff.

## Preserved evidence and caveats

Durable local evidence: `runs/p-map-efficiency-20260906/` (ignored by Git), containing task/profile bytes, driver and independent checks, per-mode candidate patches, timestamped SDK logs, native Fanout artifacts, summaries, validation logs and SHA-256 receipts. Temporary source/run paths remain available. Credentials are excluded from the archive.

- Frozen acceptance SHA-256: `eb6087e5da4211846823199f33345e07f759d5279657d704f7ab34a2f60a9225`.
- Shared profile SHA-256: `1fba48e8caf34ea2d81299ab57052d63ba69f61b198c0456601169669267dcd0`.
- Common setup excluded from all E2E values: raw 67.391s, current 16.594s, improved 12.079s. The first install warmed package caches; subsequent execution still includes each profile's required preparation.
- Sequential run order and one sample cannot separate model randomness, cache and host/provider variation from the changes. No median, p95, success rate or reliable latency promise is justified.
- All three passed the original external acceptance plus full suites. A subsequent same-case supplemental audit found current Fanout incorrect while raw Pi and improved Fanout passed; see below. These are bounded semantic checks, not proof of every edge case.
- Configured typecheck, complete offline check (49 profiler tests), provider mock suite and both code-review axes pass. The expanded TypeScript probe has pre-existing diagnostics outside the configured entrypoints, with no new diagnostic category introduced by this change.
- The first baseline-check draft accidentally used an infinite source with unlimited backpressure and exhausted its process heap. It was fixed to finite concurrency/backpressure before any provider run; all modes use the same corrected frozen acceptance script. No candidate or benchmark task was changed to force a pass.

## Supplemental semantic audit and intermediate replay

No new provider calls or candidate changes were made. The recorded successful runtime edits were replayed with Pi's actual edit tool into a disposable baseline clone. The final replayed `index.js` and `test.js` exactly match the accepted improved candidate. Every intermediate source state passed the original frozen external acceptance—even the first state, before behavioral tests were added. That original acceptance is therefore insufficient on its own for judging task completion; existing full-suite/test-change review remains necessary.

A focused additional check exercises task requirement 3, “stop starting new mapper calls” after abort: `iterator.next()` returns an item whose **value is a pending thenable**; the test waits until that value is being awaited, aborts, then resolves it. Starting a mapper after that resolution violates the requirement. This is separate from a pending `iterator.next()` promise, which the original acceptance already covered. The supplemental test uses synchronization rather than timing sleeps and was applied identically to all three existing final candidates.

| Candidate | Mapper starts after abort | Supplemental result |
| --- | ---: | --- |
| Raw Pi | 0 | Pass |
| Current Fanout | 1 | Fail |
| Improved Fanout | 0 | Pass |

The intermediate improved candidate after response 9 also starts one mapper after abort. It had already passed its advisory checks at response 10. The runtime fix in response 11 adds a post-`await value` abort guard and is necessary for correctness. Thus simply terminating an ordinary worker on its first passing advisory validation would have delivered an incorrect candidate. The proposed candidate-submission experiment must submit complete work and retain independent acceptance plus bounded fast repair; it cannot assume every later request was waste.

Raw/improved E2E and cost measurements are unchanged. Current Fanout's native controller outcome remains `completed`, but the task-level semantic audit is **failed**; comparisons against it describe resource use, not equal successful outcomes. No failed candidate was repaired after measurement. The additional checks and replay ran outside the measured provider runs and are excluded from all three E2E values.

Evidence: `replay-runtime-candidates.mjs`, `runtime-replay-results.json`, `acceptance-pending-value.mjs`, `supplemental-final-acceptance.json`, `audit-last-runtime-fix.mjs` and `last-runtime-fix-audit.json` in the durable evidence directory. The original frozen acceptance script and its recorded results remain unchanged.

## Authorized reverse-order repeat

The user said “You're free to do canary runs.” One additional improved-Fanout/raw-Pi pair completed, in that order, using fresh clones at the same p-map baseline, task, profile, acceptance scripts and model settings. All 140 source/test files match the first improved pilot's frozen manifest. Both fresh baselines passed all 51 tests before measurement. This repeat changes no product code and does not implement the proposed candidate-submission workflow.

Temporary evidence root: `<local-workspace>/fanout-pmap-repeat-20260906-01`; durable evidence: `runs/p-map-efficiency-repeat-20260906-01/` (ignored by Git). The runner, setup and summarizer are reused with the isolated root and two-mode order changed; the original evidence remains untouched. Full measured E2E still includes planning, execution and native final checks. Both independent acceptance scripts and the full suite audited both final candidates outside measured E2E, consistently with the first pilot. This repeat also records those audit durations separately. Human wait is zero in both runs. Both run processes and audits exited; the isolated credential copy was removed and excluded from durable evidence.

| Mode | E2E including planning | Planning | Estimated token cost | Model requests | Independent audit |
| --- | ---: | ---: | ---: | ---: | --- |
| Improved Fanout, repeat | 369.965s | 80.007s | $0.5307096 | 2 planning + 20 workers | Initial checks/55 tests passed; pending-value abort failed |
| Raw Pi, repeat | 255.175s | In ordinary loop | $0.514409 | 12 | Initial checks/54 tests passed; pending-value abort failed |

Fanout consumed **45.0% more time and 3.2% more estimated cost** in this pair. Both are failed task outcomes, so this is a resource comparison, not a comparison of the cost/time to successful completion. Neither candidate was repaired after measurement. The initial pilot's cost advantage did not repeat; two observations per mode are too few for a reliable rate, tail estimate or causal attribution. Across the two attempts for each mode, one candidate passes the recorded semantic audits and one fails; this is an observed count, not a success-rate estimate.

The repeated Fanout planning cost was $0.245810; workers cost $0.2848996. The public API worker again used three requests. Runtime used 17 requests and six advisory validations, two of which failed. Its first passing validation (response 6) preceded adding behavioral tests (response 7). Subsequent responses corrected tests and runtime behavior but still left `mapper(await value, currentIndex)` without a post-value-await abort guard. Raw Pi independently left the same gap. Both supplemental checks observe one mapper start after abort. Green model-written tests alone are insufficient to establish task correctness.

Both Fanout original attempts were accepted, no controller repair was launched, and native final validation passed in 8.088867s. Accepted tree: `76bee95de629cc502fbf0d0626d5427da898de42`. Thus controller repair budgets cannot help with semantic failures that the configured gates do not detect. The fixed-60-second lower bound for this observed worker graph is `80.007 + 17 × 60 = 1100.007s` (18.33 minutes), before generation and local overhead. This remains a counterfactual, not an actual slow-provider measurement.

Next experiments need both fewer dependent worker requests and acceptance that catches the task's asynchronous boundaries before success is reported. The proposed candidate-submission experiment must retain independent semantic acceptance and bounded repair; early termination on an advisory pass is contradicted by both traces. Further canaries are authorized, but the deferred candidate-submission workflow still awaits its separate design approval.

Receipts: `summary.json`, `protocol.json`, `runtime-request-audit.json`, both `*-audit.json` and `*-supplemental.json` files, complete SDK/native event logs, candidate patches and `evidence-manifest.json` in the repeat evidence directory. The source, task, profile and acceptance identities remain pinned to the initial pilot.
