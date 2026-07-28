# p-map AbortSignal canary tracker

Date: 2026-07-14; optimization-candidate runs: 2026-07-27 and 2026-07-28

Status: Candidate `c75ff9a` and Attempt 14 remain historical successful evidence. The 2026-07-27 profile-bound sequence completed the canary and repetitions 1–2, then stopped when repetition 3 exhausted the fused runtime/test node's fixed validation-repair budget. The reviewed 2026-07-28 Worker-summary candidate first stopped before worker launch on a confirmation-label defect. Commit `3fef090` fixed that defect and passed both review axes. Its restarted canary completed, then repetition 1 stopped on bounded runtime-test validation-repair exhaustion. Repetitions 2–3 were not run. The release-confidence gate remains open.

## 2026-07-28 Worker-summary sequence

Fixed controls:

- Worker-summary implementation: reviewed commit `a06755bf3bbfab06e64a3915cfed1cdbb0647409`.
- Confirmation fix and frozen execution source: commit `3fef09013dde4ad32e1446bd76201d8f2f161e49`; focused red/green confirmation regression, full `npm run check`, Doubleword-provider tests, and diff check passed. Review of `3c3e6e7...3fef090` returned zero Standards findings and zero Spec findings.
- Clean detached p-map worktrees `controlled-20260728-worker-summary/{canary,rep-1,rep-2,rep-3}` at baseline `c3c261e2189f94d1a09724e8f03d5345af518017`; isolated `npm ci --ignore-scripts` preparation and all four independent 51-test baselines passed.
- Fresh panes in `doubleword:fanout-canary`: corrected canary `%252` was closed after evidence capture and repetition pane `%253` was confirmed alive; failed repetition pane `%253` remains for inspection. Initial stopped pane `%251` was closed only after `%252` was alive.
- Tier 1 `openai-codex/gpt-5.6-sol` medium; async Tier 2 disabled; Tier 2 fallback `openai-codex/gpt-5.6-terra` medium; maximum concurrency 2; no `FANOUT_WORKTREE_SHARED_PATHS`.
- Active packet pointer SHA-256 `b7b733e141c705d462ab4906bc66cce04f895ff3bf243918a6c3439c8601f6b4`, 322 bytes; active profile pointer SHA-256 `0e9958891ad5fceaa942a23c2aa55794dd2480c753ba4c32df41f963cf5b69e3`, 333 bytes.
- Packet SHA-256 `d2a0e3726b78abfdba02709ba86798e91d0f2975cbc97e737c66ed0fb4cd76ea`, 38,661 bytes; profile SHA-256 `77573f46e3b2f8dbbb975a3e6ca73ee583ad37ca454d6ff6842edd3c1172c6c0`, 2,230 bytes; planning base commit/tree `c3c261e2189f94d1a09724e8f03d5345af518017` / `8a2aeffb7e9e378c05dcb0cec8503b1fb530143f`. Pointer and artifact bytes matched exactly in repetition 1.

| Run | Pane/worktree | Outcome and final tree | Independent validation/cleanup | Timing, tokens, and cost |
| --- | --- | --- | --- | --- |
| Corrected canary | `%252` (closed); `controlled-20260728-worker-summary/canary` | Completed; final validation passed; final tree `73e501a361dbb433faae3bc4ef6c013021076584`; five allowed files, +307/-51 | 55 tests passed; cleanup 11.355s; no current-run worker, worktree, or lock leak | 420.728s wall; 401.893s post-confirmation; 390.535s profiler completion chain; 44.818s node overlap; 486,170 tokens; `$0.8393655`; 7 attempts |
| Repetition 1 | `%253` (retained); `controlled-20260728-worker-summary/rep-1` | Failed after `runtime-tests` exhausted 2/2 validation repairs; final validation not run; accepted partial tree `f1863b2c735f9d82ece8d31664ea1dde5490d52c`; four accepted files, +120/-51 | Original 51-test suite passed on the accepted partial tree; diff check passed; cleanup 10.510s; no current-run worker, worktree, or lock leak | 396.535s wall; 377.800s post-confirmation; 367.282s recorded profiler prefix; 47.050s node overlap; 529,343 tokens; `$1.0167785`; 7 attempts |
| Repetitions 2–3 | prepared but not run | Mandatory stop after repetition 1 failure | No execution artifacts created | No measurements |

Canary profile preparation/readiness/normalization-probe timings were 4.658s/0.376s/2.104s; repetition 1 recorded 4.316s/0.270s/2.008s. Neither run recorded reconciliation or exact no-progress termination. Both used three validation-repair launches. The canary used 121,988 input, 17,046 output, and 347,136 cache-read tokens; repetition 1 used 152,175 input, 17,232 output, and 359,936 cache-read tokens.

The live canary exercised the advisory handoff end to end. Each original validation repair received its immediate predecessor's extracted summary, and `runtime-tests` repair 2 received repair 1's summary rather than falling back to the original. The optional summaries were present in attempt `result.json` artifacts and absent from Attempt Outcomes, Event v4, and Projection v5 authority.

Repetition 1's last worker summary accurately localized the failure: 57 AVA tests passed and the deterministic pending-abort test failed because `index.js` destructures the `undefined` result returned by the abort side of `Promise.race`. The test-only repair node could not modify `index.js`, so it preserved its valid coverage and Fanout correctly terminated at the fixed budget. This is a worker/ownership decomposition miss, not evidence that summaries gained authority. With only one completed run, no completed-run median or range is reported, and no reliability rate or universal SLO is inferred.

### Initial confirmation stop

The same packet/profile first ran from reviewed Worker-summary commit `a06755b` in pane `%251`. Dry-run `2026-07-28T10-24-22-168Z-8dab93a2` passed. Live run `2026-07-28T10-24-49-234Z-12637a82` was declined before workers because confirmation rendered implementation-details SHA `f0264cb025eb…` under the `Packet` label. It ended with zero attempts, tokens, cost, or accepted changes. This historical stop is not part of the corrected cohort.

## 2026-07-27 controlled sequence

Fixed controls:

- Fanout source: branch `feature/fanout-optimization`, HEAD `0310527a552d98df666471f675f2d3db171bdb53`, tracked-diff SHA-256 `a1389d18861a7357d7276af93559d942b0e6d6d713d2af89a67ccce5f75b0fff`, plus the seven recorded untracked source artifacts. This exact state was unchanged through all four runs.
- Profile v1, plan v3, details v5, work contract v3, packet v7, pointer v2, Attempt Outcome v4, final evidence v2, Event v4, Projection v5.
- Clean independent p-map worktree per run at baseline `c3c261e2189f94d1a09724e8f03d5345af518017`.
- Fresh tmux pane per run in `doubleword:fanout-canary`; completed panes were closed after durable evidence capture at the user's direction, while the failed repetition pane remains visible.
- No `FANOUT_WORKTREE_SHARED_PATHS`.
- Identical packet/profile bytes, routing, concurrency, and platform for all repetitions.
- Packet SHA-256 `ffb4d3915eb3464824e3a4b030a419e717c631c2527264553c2d3d44643b6e0b`; profile SHA-256 `1fba48e8caf34ea2d81299ab57052d63ba69f61b198c0456601169669267dcd0`.

The seven untracked source files present throughout the cohort had these
SHA-256 identities: `project-execution-profile.ts` (core)
`15dde81f667dced69ef7ccfaf39bba5897c8adfebbb5fb9c5c09af5c8eed7e58`,
`repair-state.ts`
`6b295a2e69769a040e24344e97f80cbcb9083999adcad36755ea07dea1b3282d`,
`vertical-chain-fusion.ts`
`f34c9d3ee105fba57def8ceff0f2bda23017730d3238590ef9dda250711cd402`,
`fanout-execution-profile.md`
`a4f886151b06b3dd3e0aebb6ec81b0febaee4840d51babe82d70426422edd81a`,
`candidate-reconciliation.ts`
`c6b1dbd16852e86a418146104ff81b57207bb8f9ad0927acab3eb4274dfe884e`,
`final-validation-adapter.ts`
`250f8523bf1591c070b1defaab94c15ca3dbe68bc931899da6e79bf0f164b37a`,
and `project-execution-profile.ts` (Pi)
`87cc6b246c3510f99ef0a688a2c842691a446a825fefac053c505f34bc75a5ff`.

| Run | Pane | Worktree | Packet/profile identity | Outcome | Independent tests | Cleanup | Wall/cost/range evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Canary | `%246` (closed after capture) | `controlled-20260727-r2/canary` | exact shared packet/profile | completed; final tree `441aa84953ba7338a8a3157a2f5fc9e8b75357b3` | 55 passed; five allowed files | 7.716s; no current-run worker/worktree/lock leak | 408.114s; 617,895 tokens; `$0.843834`; 5 attempts |
| Repetition 1 | `%247` (closed after capture) | `controlled-20260727-r2/rep-1` | exact shared packet/profile | completed; final tree `3a727fdb8494391633afea5f3cb883e2bda95d14` | 56 passed; five allowed files | 5.800s; no current-run worker/worktree/lock leak | 306.291s; 502,710 tokens; `$0.547498`; 4 attempts |
| Repetition 2 | `%248` (closed after capture) | `controlled-20260727-r2/rep-2` | exact shared packet/profile | completed; final tree `962a454736ab808771f41d5d5abde52edd349bf8` | 53 passed; five allowed files | 7.792s; no current-run worker/worktree/lock leak | 278.563s; 348,095 tokens; `$0.624695`; 5 attempts |
| Repetition 3 | `%249` (retained) | `controlled-20260727-r2/rep-3` | exact shared packet/profile | failed; fused node exhausted 2/2 validation repairs; final validation not run | 51 baseline tests passed on the accepted partial types/docs tree | 7.815s; no current-run worker/worktree/lock leak | 285.959s; 436,509 tokens; `$0.681089`; 5 attempts |

Stop on the first failure or configuration/artifact change. Any code, packet,
profile, or configuration change restarts the table at Canary. Report medians
and full ranges only; do not infer a reliability rate or universal SLO.

Successful-run measurements:

| Metric | Median | Full range |
| --- | ---: | ---: |
| Total wall time | 306.291s | 278.563–408.114s |
| Post-confirmation observed boundary | 275.517s | 250.213–375.268s |
| Profiler-derived completion-chain boundary | 269.715s | 242.419–367.549s |
| Measured parallel node overlap | 45.523s | 42.835–57.857s |
| Total tokens | 502,710 | 348,095–617,895 |
| Estimated cost | `$0.624695` | `$0.547498`–`$0.843834` |
| Aggregate recorded turn TTFT | 43s | 42–56s |
| Aggregate recorded turn generation | 194s | 151–270s |
| Profile preparation | 4.512s | 4.511–13.880s |
| Profile readiness | 0.295s | 0.265–0.296s |
| Profile normalization probe | 2.392s | 2.359–2.582s |
| Candidate normalization | 13.362s | 10.747–13.701s |
| Final-validation command time | 15.066s | 14.682–15.311s |
| Cleanup | 7.716s | 5.800–7.792s |

All four packets contained one compiler-fused vertical node. No run recorded a
deterministic reconciliation or exact-no-progress stop. The canary exercised
cumulative node-validation repair continuity live: its second repair started
from the immediately preceding rejected candidate and the accepted ledger did
not advance until validation passed. Final-validation repair continuity remains
offline regression evidence because every completed run passed its initial
final-validation round.

Repetition 3 is a bounded worker semantic miss, not a Fanout authority or
accounting failure. The original fused candidate failed XO
`no-inner-declarations`; both repairs then left the same two generated AVA
abort tests invalid. Every allocation received one terminal outcome, the
accepted ledger retained only the successful types/docs transitions, cleanup
completed, and final validation correctly remained `not-run
(upstream-failure)`.

Post-run profiler inspection initially rejected the valid canary because total
run duration includes profile validation before `run-started`. The profiler now
accepts a total duration greater than or equal to the Event-log span, still
rejects an impossible shorter duration, and derives scheduling from the
post-confirmation Event boundary. This source change occurred after the live
sequence and therefore requires a new canary before any further repetitions.

## Fixed candidate

| Item | Value |
| --- | --- |
| Fanout branch | `feature/fanout-execute` |
| Fanout candidate | `c75ff9a` |
| p-map fixture | `c3c261e2189f94d1a09724e8f03d5345af518017` |
| Task brief | `/Users/snehalyelmati/Documents/p-map-abort-signal/TASK.md` |
| p-map repository | `/Users/snehalyelmati/Documents/p-map-abort-signal/repo` |
| Baseline | clean; 51 tests passed |
| Visible session | tmux `doubleword:fanout-canary` |

## Routing used

| Role | Route |
| --- | --- |
| Tier 1 | `openai-codex/gpt-5.6-sol` · medium |
| Tier 2 | disabled |
| Tier 2 fallback | `openai-codex/gpt-5.6-terra` · medium |

Pi was launched with extension auto-discovery disabled and `DOUBLEWORD_API_KEY` removed from the process environment. No Doubleword provider call was made.

Historical Attempt 14 used `FANOUT_WORKTREE_SHARED_PATHS`. The current generation rejects that configuration and instead runs independently approved profile preparation/readiness in every disposable worktree.

## Gate tracker

- [x] Reconfirm immutable Fanout and fixture revisions.
- [x] Run the fixture baseline: 51 tests passed.
- [x] Confirm Sol/Terra routing with async Tier 2 disabled.
- [x] Publish a fresh accepted plan v2, details v4, packet v6, and pointer v2.
- [x] Review the replanned packet against the intended five-node contract and explicit `npx xo --fix` normalizer.
- [x] Run `/fanout-execute --dry-run` and verify no repository mutation.
- [x] Obtain explicit live-mutation approval through the terminal instruction to continue until full E2E succeeds.
- [x] Run `/fanout-execute`.
- [x] Independently inspect the diff, artifacts, metrics, cleanup, and `rtk npm test`.
- [ ] Obtain repository-owner approval of the exact Fanout candidate.

## Attempt ledger

| Attempt | Result | Evidence |
| --- | --- | --- |
| Initial planning attempt | Operator accidentally interrupted Phase A; no packet published. | Artifact run `20260714-062000813-read-task-md-and-implement-that-benchmar` |
| Fresh Pi session via `/new` | Phase A was accepted after one schema-guided correction. Phase B incorrectly treated absent `active-packet.json` as a prerequisite and returned prose instead of calling `fanout_submit_artifact`; only `implementation-plan.json` exists. | Artifact run `20260714-062207785-read-task-md-and-implement-that-benchmar` |
| Offline diagnosis and repair | Pi 0.80.6 queues `sendUserMessage(..., {deliverAs: "followUp"})` called from `agent_end` without emitting `before_agent_start`. Phase B therefore missed its controller prompt, tool state, `planRunId`, and `phase`. Candidate `7020ea0` defers initial and repair turns until Pi settles, removes unpublished pointer context from internal planning prompts, and clarifies controller-owned output semantics. | Focused planning smokes and full `rtk npm run check` passed. First two-axis review: Standards 0, Spec 2; both findings fixed. Second review: Standards 0, Spec 0. No provider call. |
| Attempt 3 after `/quit`, fixed-candidate restart, and `/new` | Phase A recovered from one invalid `advisoryNotes.kind` submission and was accepted. The repaired Phase B handoff carried `planRunId`/`phase`, submitted details, and passed details validation. Compilation then rejected the apparently correct `final-validation` item with `invalid-final-validation-id` and `final-validation-count`. | Artifact run `20260714-064938099-read-task-md-and-implement-that-benchmar`; observability session `2026-07-14T06-49-19-903Z-11902`. Wall 276.526s; 11 turns; 27 tools; 475,066 total tokens including cache reads; estimated cost `$1.096699`; Phase A 151.265s; Phase B 125.261s. |
| Offline final-validation diagnosis and repair | Phase B had duplicated compiler authority by submitting a reserved `final-validation` item in addition to top-level `finalValidationCommands`. Candidate `28fe079` rejects the reserved item at details admission with actionable recovery and tells Phase B that commands are the sole input for the compiler-owned node. | Artifact-shaped compiler regression, focused planning smokes, and full `rtk npm run check` passed. Two-axis review: Standards 0, Spec 0. No provider call. |
| Attempt 4 after `/quit`, candidate restart, and `/new` | Phase A was accepted. The user requested stopping during Phase B so the benchmark could be moved out of the Fanout repository; no details artifact or packet was published. | Artifact run `20260714-065927102-read-task-md-and-implement-that-benchmar`; observability session `2026-07-14T06-59-08-331Z-45053`. Wall 109.261s; 5 turns; 20 tools; 88,017 total tokens including cache reads; estimated cost `$0.341871`. The full benchmark folder was moved cleanly to `/Users/snehalyelmati/Documents/p-map-abort-signal`. |
| Attempt 5 from the relocated repository after fresh `/new` | Phase A and Phase B each recovered from one schema-guided submission correction and were accepted. Compilation rejected the synthesized final-validation node: its reads of the five owned files were not grounded, and the runtime-test node's typed forbidden write for `index.js` collided with the runtime implementation owner and final validation. | Artifact run `20260714-070403903-read-task-md-and-implement-that-benchmar`; observability session `2026-07-14T07-03-42-404Z-48572`. Wall 269.194s; 9 turns; 23 tools; 292,351 total tokens including cache reads; estimated cost `$0.901173`; Phase A 145.227s; Phase B 123.968s. Compiler errors: one `owned-forbidden-overlap`, five `planned-read-not-grounded`, and one `write-forbidden-overlap`. |
| Offline Attempt 5 diagnosis and repair | Exact-byte replay reproduced all seven errors. Removing the reserved Phase A final item removed the five grounding errors; removing `index.js` from the runtime-test forbidden sets removed both authority collisions; removing both produced the intended five nodes and runtime-to-tests-to-final edges. Candidate `fd5ca1f` rejects reserved Phase A final authority and any Phase A packet-global forbidden write overlapping planned write authority, with planning prompt guidance. | Focused compiler, planning, planning-boundary, and diff checks passed; full `rtk npm run check` passed. First two-axis review: Standards P2 because Phase A did not yet explain packet-global forbidden scope; Spec P1 because a Phase-B-only cross-owner forbidden write still passed details admission. No provider call. |
| Review-finding repair | Candidate `a250e4e` explains packet-global forbidden scope before Phase A submission and passes the accepted plan into Phase B admission, where cross-owner forbiddens now fail immediately with actionable guidance. The regression models separate implementation and test items so the test-only forbidden guard cannot cancel implementation authority. | Focused compiler/planning/lifecycle smokes and full `rtk npm run check` passed. Final two-axis re-review: Standards 0, Spec 0. No provider call. |
| Attempt 6 after fresh Pi restart and `/new` | Phase A accepted after the recurring advisory-note enum correction. Phase B accepted after adding required forbidden-write provenance. The compiler requested its bounded typed-read repair, then compiled successfully and published plan v2, details v3, packet v5, DAG, report, and pointer v2. Immediately afterward Pi crashed because the custom report renderer returned an unwrapped 360-column objective into a 148-column TUI. | Artifact run `20260714-072338237-read-task-md-and-implement-that-benchmar`; observability session `2026-07-14T07-22-35-922Z-49213`; packet SHA-256 `94089392a4640e86df196c0d094bddc722553351b5663eba10a60037f9b9583d`, 47,336 bytes. Wall 292.647s; 11 turns; 19 tools; 367,163 total tokens including cache reads; estimated cost `$1.189658`; Phase A 121.257s; Phase B including repair 171.390s. p-map checkout remained clean at tree `8a2aeffb7e9e378c05dcb0cec8503b1fb530143f`. Crash log identifies rendered line 271 width 360 versus terminal width 148. |
| Offline Attempt 6 TUI diagnosis and repair | The context-free custom entry boundary was correct, but its renderer ignored Pi's mandatory `render(width)` contract and returned raw Markdown lines. Candidate `1c0379e` wraps the unchanged content at presentation time with Pi's ANSI-aware utility; canonical report and packet bytes remain terminal-independent. | Focused narrow-width regression passed; replaying the actual 37.1 KB report at width 148 produced 1,163 lines with zero violations; full `rtk npm run check` passed. First review: Standards 0, Spec P2 for zero-width and width-1 wide Unicode. No provider call. |
| TUI review-finding repair | Candidate `6731d8a` returns safe empty output for nonpositive widths and post-truncates every positive-width wrapped line to the exact supplied width. | Unicode/zero-width regression and full `rtk npm run check` passed. Final two-axis re-review: Standards 0, Spec 0. No provider call. |
| Attempt 6 packet review | Independent review found no blocker: pointer digest/length/path, plan/details identities, planning commit/tree/platform, five write owners, runtime-to-tests edge, final edges, commands, typed reads/forbiddens, routing, runtime policy, and semantic abort criteria all match the task and issue #8 boundary. | Clean for dry-run. Harmless presentation differences: grounded node IDs, duplicate global forbidden entries, and explicit `sh -c` argv for the combined runtime check. |
| Attempt 7 after reviewed renderer restart and fresh `/new` | `/fanout-execute --dry-run` verified pointer/packet identity, planning base/tree, clean repository state, policy, and node set. It launched no workers or validation, wrote the three-event audit, rendered the report without a TUI crash, and left p-map unchanged. | Execution run `2026-07-14T07-39-21-318Z-75ca7aa4`. Outcome `dry-run-completed`; duration 786 ms; attempts/tokens/cost/changed files all zero; final validation `not-run (dry-run)`; p-map remained commit `c3c261e...18017`, tree `8a2aeffb...143f`; no execution lock remains. |
| Attempt 8 after fresh `/new` and live confirmation | Preflight and confirmation passed and two Tier-1 workers launched. The types worker exited successfully with a patch, but Pi cache-read tokens made two turns fail Fanout's stricter token equality. Its filtered partial metrics then could not round-trip through `attempt-completed`; the scheduler lost the causal attempt ID, aborted the concurrent runtime worker, and the reducer correctly refused to finish with the types allocation unmatched. The active p-map repository remained clean and unchanged. | Execution run `2026-07-14T07-41-08-446Z-9fb2cd67`; events 1-5 cover start, preflight, confirmation, and both allocations; event 6 records only the runtime abort. Types attempt `types-abort-grounded:000001` observed 57,473 tokens including cache and `$0.107221`, with an outcome artifact but no committed completion event. No worker process, execution lock, or run worktree remains. |
| Offline Attempt 8 diagnosis and repair | Three exact defects were reproduced: ordinary worker `agent_end` treated two absent planning states as a match and dereferenced `runId`; generic attempt metrics rejected cache-inclusive totals despite the worker-metrics contract already allowing them; explicitly partial correlated metrics could become apparently complete after filtering and fail serialized replay. Candidate `b3af538` guards the non-planning lifecycle, aligns token validation with `totalTokens >= inputTokens + outputTokens`, and conservatively preserves explicit `complete: false` during outcome parsing without weakening accepted-attempt or projection invariants. | Exact Attempt 8 outcome replay, cached-token worker regression, ordinary real-Pi worker regression, partial-outcome regression, focused lifecycle/event smokes, and full `rtk npm run check` passed. Independent diagnosis found no recorder race, stuck process, or leaked Attempt 8 lock/worktree. Two-axis code review: Standards 0 findings, Spec 0 findings. No provider call was made during diagnosis or review. |
| Attempt 9 after reviewed candidate restart and fresh `/new` | Attempt 8's lifecycle, cache-token, and partial-outcome fixes held: all types-worker metrics were complete and the first two validation failures committed typed `validation-repair` outcomes. Each detached types worktree lacked the active checkout's installed `tsd`, so controller `npx tsd` failed identically. The second repair consumed the final repair slot and correctly routed its validation fact to `fail`, but outcome admission rejected the still-correlated recovery evidence because recovery was previously allowed only with a repair action. That left attempt 3 unmatched and caused the same protective `run-finished` refusal. | Execution run `2026-07-14T07-58-00-678Z-d3bc6308`; 10 committed events from `07:58:00.696Z` through `07:59:36.029Z`. Three complete types attempts observed 129,305 total tokens including cache and `$0.3311885`; all produced the same patch SHA `bf8b34e9...c3a27d`. The active p-map tree remained `8a2aeffb...143f`; no Attempt 9 worktree or lock remains. |
| Offline Attempt 9 diagnosis and repair | Candidate `9c7bdae` admits correlated validation/integration evidence when an exhausted budget routes a repairable fact to terminal `fail`, while still requiring evidence for repair actions. Dependency availability moved to an explicit preparation boundary: a JSON list of top-level repository paths is normalized, preflighted for presence and Git-ignore status, shown at confirmation, then exposed to both worker and final-validation worktrees. At the user's direction, the abandoned hard-coded `node_modules` reconstruction change was removed; generic reconstruction contains no runtime-specific path. Follow-up `cc5f58c` records the material design decision. | Exact exhausted-validation round-trip, public execute lifecycle, preparation parsing/escape rejection, worker access, final-validation access, and full `rtk npm run check` passed. Regressions use `.preinstalled`, not a Node-specific path. Independent diagnosis confirmed the third outcome-admission failure and the detached dependency gap. First review: Standards P2 documentation gap, Spec 0; final re-review: Standards 0, Spec 0. No provider call was made during diagnosis or review. |
| Attempt 10 after reviewed candidate restart and fresh `/new` | The explicit preparation boundary worked: types and docs passed on their original attempts with dependencies available. Runtime's original patch reached controller validation and failed only XO's `no-inner-declarations` rule. While that worker ran, the independent types/docs patches advanced accepted state from the planning tree to `e33b4809...`; validation-repair reconstruction replayed that accepted ledger and then incorrectly tried to seed the rejected runtime patch as an exact whole-tree transition from the original planning tree. Both repair slots therefore failed before model work with the same accepted-state base conflict, runtime failed, runtime-tests was skipped, and final validation did not run. | Execution run `2026-07-14T08-22-47-500Z-f9d53ccf`; 18 gapless events. All five allocations have one terminal outcome. Types patch `bf8b34e9...` and docs patch `48e27b8a...` remain as the accepted partial tree; runtime patch `46c3511d...` was rejected. No Attempt 10 lock or worktree remains. |
| Offline Attempt 10 diagnosis and repair | Candidate `3193048` keeps exact accepted-transition admission unchanged but treats a rejected validation patch as a non-authoritative repair seed: verified bytes overlay the latest disposable accepted reconstruction, the repair worker edits that state, and its result is recaptured relative to the current accepted tree before ordinary exact admission. Repository-level coverage proves disjoint accepted content survives and conflicting same-path content fails; an executor-level concurrency regression proves a sibling accepts first and the repaired transition chains from that sibling's result tree. Follow-up `946e7f3` records this seed-only exception in the design decision. | Focused identity and public executor smokes passed; full `rtk npm run check` passed. First two-axis review: Standards P2 documentation gap, Spec 0; final re-review: Standards 0, Spec 0. The exact Attempt 10 docs/types patches were reversed in ledger order and p-map was restored cleanly to planning tree `8a2aeffb...143f`. No provider call was made during diagnosis, testing, or review. |
| Attempt 11 after reviewed candidate restart and fresh `/new` | The full DAG executed. Types and docs passed first try. Runtime required both validation repairs; the first live repair correctly launched over the disjoint accepted tree, proving the Attempt 10 fix, and the second passed. Runtime tests passed after one repair. All four work nodes succeeded and final `npm test` ran, but XO found ten style errors in the generated `test.js`. Final repair 1 reduced them to four; final repair 2 fixed those exact locations but introduced two adjacent `padding-line-between-statements` findings at the newly shifted lines 545 and 550. The fixed two-launch final repair pool exhausted before AVA/tsd could run, so final validation and the run failed. | Execution run `2026-07-14T08-38-52-393Z-b11e33ea`; 28 gapless events and 9/9 allocated attempts have terminal outcomes. Accepted scope is exactly the intended five files, +293/-23. Last rejected final candidate `6d79436c...` left only two XO errors. No Attempt 11 lock or worktree remains. |
| Offline Attempt 11 diagnosis | Independent artifact review found no Fanout defect. Both repair prompts contained complete verbatim XO output, exact failed-round evidence, stable identities, scoped contracts, and prior candidate context. Both workers completed normally with valid owned patches and complete metrics but incorrectly claimed lint success without controller validation: repair 1 misplaced two blank lines and introduced a yield-less generator; repair 2 fixed the generator but repeated the misplaced blank lines. The controller correctly rejected both candidates, kept them out of the accepted ledger, exhausted the fixed budget, and failed closed. | Classified as a bounded model miss; no Fanout change, budget expansion, code review, or Pi restart warranted. The four accepted patches were reversed in ledger order and p-map is clean again at planning tree `8a2aeffb...143f`. |
| Candidate-normalization evaluation | An explicit, generic pre-capture normalization stage would fit the trust model and would have prevented Attempt 11: reconstructing its accepted patches, running repository-provided `npx xo --fix` once, then `npm test` passed all 55 tests. It is not a canary-sized change under issue #8, however: work-contract v1 declares `validationCommands` as the sole command list and strict packet admission rejects new fields. A correct implementation needs a coordinated details/work-contract/packet schema revision, replanning, typed normalizer outcomes/audit, precise nonzero/partial-result semantics, and final-repair authority rules. | Do not smuggle normalization through environment configuration or mutate packet v5; that would bypass immutable packet consent and mixed-generation rejection. Continue Attempt 12 unchanged. If fresh runs reproduce the deterministic formatting miss, stop and design the stage explicitly. |
| Attempt 12 after fresh `/new` on unchanged reviewed candidate | Types/docs passed first try. Runtime's original patch passed validation but collided with the disjoint accepted tree and correctly routed through integration repair; that repair then needed one validation repair before acceptance. Runtime tests passed after one repair. All four work nodes succeeded. Initial final `npm test` stopped on 18 XO errors in generated `test.js`; final repair 1 reduced them to one blank-line error, while final repair 2 regressed to 17 XO errors. Both repairs exhausted before AVA/tsd, so final validation failed. | Execution run `2026-07-14T08-58-32-203Z-97a3eab5`; 28 gapless events and 9/9 allocations have terminal outcomes. Accepted scope was exactly the five allowed files, +345/-27. No Attempt 12 lock/worktree remains. The four accepted patches were reversed in ledger order and p-map is clean at planning tree `8a2aeffb...143f`. |
| Attempt 12 decision | A second fresh run reproduced deterministic final-format repair exhaustion after every work node succeeded. This satisfies the evidence threshold from the normalization evaluation: unchanged stochastic reruns are no longer the smallest reliable path. | Design and implement the explicit packet-declared, language-agnostic, audited pre-capture normalization stage as a coordinated strict schema revision; keep budgets unchanged, replan, review, and rerun. |
| Issue #32 design and implementation candidate | Reopened issue #8 and cross-referenced #13, #17, #18, and #19. Details v4 owns one ordered repository-level direct-argv normalizer list; the compiler copies it into every work-contract v2 node and packet v6. Runtime executes it once after successful edits and complete metrics but before capture/ownership/validation, records evidence v1, continues after nonzero exits, and fails closed on launch/interruption/repository-identity faults. Attempt outcome/event v2 and projection v3 make the new routing fact an explicit generation cutover. Candidate `c75ff9a` is immutable. | Counterfactual Attempt 11 plus `npx xo --fix` passed all 55 tests. Focused core/runtime smokes, full `rtk npm run check`, standalone provider mocks, and `rtk git diff --check` pass. Review rounds found and fixed packet-manifest divergence, identity/audit routing, final-repair coverage, diagnostic and abort races, and evidence-reference integrity; final re-review: Standards 0, Spec 0. No hard-coded `node_modules`, Node, XO, stderr inference, environment escape hatch, retry expansion, or final-validation weakening exists in Fanout core. |
| Attempt 13 fresh planning after candidate restart and `/new` | Phase A corrected unsupported advisory-note kinds, then Phase B corrected missing forbidden-write provenance and unstable anchors. The accepted generation is plan v2, details v4, packet v6, work-contract v2, and pointer v2. Details declares exactly `npx xo --fix`; packet admission proves the identical ordered manifest in all five contracts. Writes are exactly `index.js`, `index.d.ts`, `index.test-d.ts`, `test.js`, and `readme.md`; runtime→runtime-tests→final is the critical path; final validation is `npm test`. | Artifact run `20260714-095921357-read-task-md-and-implement-that-benchmar`; packet SHA-256 `c6728f2023ec081fccc112198277c9bd9481949f607d921e4a90ebcb4b31bb64`, 48,815 bytes. Independent recomputation matched pointer digest/length. Planning base remained clean at `c3c261e...18017` / `8a2aeffb...143f`. Visible planning metrics: about 76k input, 9.5k output, 145k cache reads, `$0.739`. Independent packet review found no blocker. |
| Attempt 13 packet-v6 dry-run after fresh `/new` | Exact artifact, platform, planning tree, shared-path preparation, normalizer/validation executables, worker capability, and lock preflight passed. No workers or validation launched. | Execution `2026-07-14T10-05-21-075Z-5582024a`; dry-run completed in 799 ms with event v2 sequences 1–3, projection v3, zero attempts/tokens/cost/patches, final validation not run, p-map still at `8a2aeffb...143f`, and no execution lock. |
| Attempt 13 live execution after fresh `/new` | Types and docs passed their original attempts. Runtime original normalization ran once and preserved one non-autofixable `no-inner-declarations` failure for semantic repair; repair 1 fixed lint, but AVA exposed `pMapIterable - concurrency: 2` at about 305 ms instead of 200–250 ms. Repair 2 normalized/linted cleanly but repeated the same failure at about 303 ms. Runtime exhausted 2/2 validation repairs, runtime tests were skipped, and final validation did not run. All five attempts have one normalization audit; no hard normalization, identity, ownership, or accounting fault occurred. | Execution `2026-07-14T10-06-43-516Z-b1be4b1d`; 18 gapless events, 5/5 allocations/outcomes, actions 2 accept / 2 validation-repair / 1 fail, 373,116 total tokens, estimated cost `$0.8087425`, duration 259.77 s. Accepted scope is only `index.d.ts`, `index.test-d.ts`, and `readme.md` (+9/-2). Rejected runtime patch inspection shows `trySpawn()` runs before `pendingPromisesCount--` in the async task's `finally`, so concurrency is not replenished when the shorter mapper settles and the third mapper starts about 100 ms late. No Attempt 13 lock or worktree remains. |
| Offline Attempt 13 diagnosis and restoration | Reconstructed runtime repair #2 reproduced the timing failure at 302.889, 300.495, and 303.425 ms (3/3). Restoring baseline accounting order—decrement before success-path `trySpawn()`, decrement on done/error, and no trailing `finally` decrement—made the targeted test pass 3/3 and full AVA pass 51/51. Repair #2 had the exact assertion, rejected patch/tree, readable baseline, and semantic criterion preserving no-signal concurrency; it instead blamed `Promise.race` and left scheduling unchanged. This is a deterministic worker semantic miss, not Fanout, planning, normalization, or test flakiness. | No Fanout change, review, or Pi restart. Reversed the accepted docs patch and then types patch using their exact ledger artifacts. p-map is clean again at `c3c261e...18017` / `8a2aeffb...143f`; no execution lock remains. Reuse the reviewed v6 packet for a fresh Attempt 14 after `/new`. |
| Attempt 14 live execution after fresh `/new` | The unchanged reviewed packet v6 completed the full DAG. Types and docs passed on their original attempts. Runtime passed its original validation and then one integration repair after concurrent sibling acceptance. Runtime tests used one semantic validation repair. All six attempts ran the declared `npx xo --fix` normalizer exactly once with exit 0, stable repository identity, and outcome-linked audit evidence. All four work nodes were accepted and controller-owned final `npm test` passed all 56 tests. | Execution `2026-07-14T10-17-57-391Z-5895ab5f`; outcome `completed`; duration 465.391 s; 22 gapless event-v2 records; 6/6 allocations/outcomes; projection v3 replayed to `completed`; 655,081 total tokens (169,619 input / 19,542 output); estimated cost `$1.1384025`; worker/tool/poll time 436,770.139 / 727.111 / 0 ms. Accepted scope is exactly the five allowed files, +327/-30, at final tree `8bb9b6a3afc037c32f5bb7649bc6f60eb80a125a`. |
| Attempt 14 independent audit | Recomputed event/projection accounting, inspected all six normalizer audits and their evidence references, verified final-validation identity and command evidence, reran `rtk npm test`, and checked cleanup. No Attempt 14 lock, worker process, or worktree leaked. Three unrelated July 10 worktrees from another repository identity predate this canary and remain external cleanup debt. | Final evidence `final-validation/rounds/initial.json` records direct argv `npm test`, exit 0, 7.029 s, 56 tests, and matching before/after active and validation tree `8bb9b6a3...`. Independent `rtk npm test` also passed 56 tests before review fixes. |
| Post-E2E p-map review and repair | The code-review Standards axis found that an abort during synchronous iterator construction could leave the abort promise unobserved, including when the iterator factory also threw. The Spec axis found that using error truthiness as the abort discriminator changed existing falsey no-signal behavior. The active p-map checkout now uses an explicit abort result discriminator, observes the rejected abort promise whether iterator construction returns or throws, and adds deterministic regressions for both paths plus falsey mapper/source failures. Pi was quit and restarted after each code/test edit as required. | These are post-E2E review fixes and are not claimed as part of Attempt 14's immutable `8bb9b6a3...` tree. The independent full `rtk npm test` passes 59 tests on the final active five-file diff; `git diff --check` passes; final code-review re-review is Standards 0 / Spec 0. |

## Observed planning evidence

| Metric | Observation |
| --- | --- |
| Fresh attempt wall interval | `2026-07-14T06:22:07Z` to `2026-07-14T06:24:55Z` (about 2m 48s) |
| Pi-displayed cumulative cost | `$0.759` |
| Correlated Phase A estimated cost | `$0.492058` from `assistant_usage` events |
| Phase A schema recovery | First submission used unsupported `advisoryNotes.kind` values; the controller returned typed errors and the second submission was accepted. |
| Phase B failure | Model read the accepted plan but looked for `active-packet.json` and `implementation-details.json`, then declined submission because both were absent. Their absence is expected before packet publication. |
| Observability gap | Phase B events lacked `planRunId` and `phase`, so its exact cost cannot be attributed from the observability stream. |

The missing Phase B correlation and the missing controller prompt had one lifecycle root cause: the follow-up was queued while Pi still considered the prior agent streaming, bypassing `before_agent_start`. Attempt 3 confirmed the fix: Phase B events carry `planRunId` and `phase: "details"`, and the details artifact was accepted.

Attempt 3 exposed a new compiler boundary issue: the submitted details visibly contain one item with `id: "final-validation"` and `kind: "final-validation"`, yet work-contract compilation reports that derived node 4 has the wrong ID and that no valid final-validation node exists. Reproduce and minimize this exact artifact shape offline before changing the compiler or prompt.

Attempt 5 confirmed the reserved final-validation-item repair and the moved repository identity, then exposed a separate synthesized-node grounding issue. The accepted details contain four implementation items plus top-level `finalValidationCommands`; the compiler derives the fifth node, but gives that node reads which cannot satisfy the typed grounding validator. Independently, `runtime-tests-grounded` correctly forbids writing `index.js` because another node owns it, while the compiler currently treats that cross-node guard as a global ownership conflict.

Do not treat the displayed cost as a provider comparison or a completed-canary baseline. Packet, dry-run, and failed worker-attempt evidence exists, but no accepted live DAG or final-validation result exists yet.

## Evidence paths

- Runbook: `docs/benchmarks/p-map-abort-signal-manual-e2e.md`
- 2026-07-28 Worker-summary planning artifacts: `/Users/snehalyelmati/.pi/agent/fanout/canary-542788e65f3f/20260728-101941514-read-task-md-and-implement-that-benchmar`
- 2026-07-28 initial Worker-summary dry-run: `/Users/snehalyelmati/.pi/agent/fanout/canary-542788e65f3f/20260728-101941514-read-task-md-and-implement-that-benchmar/executions/2026-07-28T10-24-22-168Z-8dab93a2`
- 2026-07-28 initial stopped live run: `/Users/snehalyelmati/.pi/agent/fanout/canary-542788e65f3f/20260728-101941514-read-task-md-and-implement-that-benchmar/executions/2026-07-28T10-24-49-234Z-12637a82`
- 2026-07-28 corrected canary dry-run: `/Users/snehalyelmati/.pi/agent/fanout/canary-542788e65f3f/20260728-101941514-read-task-md-and-implement-that-benchmar/executions/2026-07-28T10-58-27-522Z-6667ab27`
- 2026-07-28 corrected canary live run: `/Users/snehalyelmati/.pi/agent/fanout/canary-542788e65f3f/20260728-101941514-read-task-md-and-implement-that-benchmar/executions/2026-07-28T10-59-03-363Z-f88ca6ff`
- 2026-07-28 repetition 1 dry-run: `/Users/snehalyelmati/.pi/agent/fanout/rep-1-b59f00098cff/20260728-101941514-read-task-md-and-implement-that-benchmar/executions/2026-07-28T11-10-26-097Z-f2a54d08`
- 2026-07-28 stopped repetition 1 live run: `/Users/snehalyelmati/.pi/agent/fanout/rep-1-b59f00098cff/20260728-101941514-read-task-md-and-implement-that-benchmar/executions/2026-07-28T11-11-03-020Z-81129b36`
- Accepted Phase A plan: `/Users/snehalyelmati/.pi/agent/fanout/repo-f3c0f3a183c0/20260714-062207785-read-task-md-and-implement-that-benchmar/implementation-plan.json`
- Planning observability: `/Users/snehalyelmati/.pi/agent/fanout/repo-f3c0f3a183c0/observability/2026-07-14T06-18-43-347Z-33114/observability.jsonl`
- Attempt 5 accepted plan: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-070403903-read-task-md-and-implement-that-benchmar/implementation-plan.json`
- Attempt 5 accepted details: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-070403903-read-task-md-and-implement-that-benchmar/implementation-details.json`
- Attempt 5 observability: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/observability/2026-07-14T07-03-42-404Z-48572/observability.jsonl`
- Attempt 6 packet: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-072338237-read-task-md-and-implement-that-benchmar/execution-packet.json`
- Attempt 6 pointer: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/active-packet.json`
- Attempt 6 observability: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/observability/2026-07-14T07-22-35-922Z-49213/observability.jsonl`
- Attempt 6 Pi crash: `/Users/snehalyelmati/.pi/agent/pi-crash.log`
- Attempt 7 dry-run: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-072338237-read-task-md-and-implement-that-benchmar/executions/2026-07-14T07-39-21-318Z-75ca7aa4`
- Attempt 8 live run: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-072338237-read-task-md-and-implement-that-benchmar/executions/2026-07-14T07-41-08-446Z-9fb2cd67`
- Attempt 9 live run: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-072338237-read-task-md-and-implement-that-benchmar/executions/2026-07-14T07-58-00-678Z-d3bc6308`
- Attempt 10 live run: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-072338237-read-task-md-and-implement-that-benchmar/executions/2026-07-14T08-22-47-500Z-f9d53ccf`
- Attempt 11 live run: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-072338237-read-task-md-and-implement-that-benchmar/executions/2026-07-14T08-38-52-393Z-b11e33ea`
- Attempt 12 live run: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-072338237-read-task-md-and-implement-that-benchmar/executions/2026-07-14T08-58-32-203Z-97a3eab5`
- Attempt 13 packet and planning artifacts: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-095921357-read-task-md-and-implement-that-benchmar`
- Attempt 13 live run: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-095921357-read-task-md-and-implement-that-benchmar/executions/2026-07-14T10-06-43-516Z-b1be4b1d`
- Attempt 14 successful live run: `/Users/snehalyelmati/.pi/agent/fanout/repo-066724ea2003/20260714-095921357-read-task-md-and-implement-that-benchmar/executions/2026-07-14T10-17-57-391Z-5895ab5f`

## Next decision

Preserve reviewed Worker-summary commit `a06755b`, confirmation fix `3fef090`, and the stopped cohort unchanged. Diagnose the ownership/decomposition miss outside the frozen cohort before any new code or planning change. Any change must start a new controlled sequence at a fresh canary; repetitions 2–3 from this cohort must not run.
