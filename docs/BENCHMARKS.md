# Benchmark Metrics

This is the primary running document for Doubleword cost/time experiments. Update it whenever workflow changes, routing changes, pricing changes, or benchmark datasets change.

Benchmark procedure: [`docs/benchmarks/fanout-execution-benchmark-procedure.md`](benchmarks/fanout-execution-benchmark-procedure.md) defines the staged path from read-only Fanout DAG prompt experiments through `/fanout-execute` and TermBench-style execution benchmarks.

## P0 — Fanout prompt-DAG dry-run benchmark

Date: 2026-07-07

Purpose: tune `/fanout-plan` DAG prompt wording before `/fanout-execute` existed. This measures prompt-produced DAG quality only, not executable task success.

Tracked summaries:

- [`docs/benchmarks/fanout-dag-prompt-results.md`](benchmarks/fanout-dag-prompt-results.md)
- [`docs/benchmarks/fanout-dag-best-prompts.md`](benchmarks/fanout-dag-best-prompts.md)
- [`docs/benchmarks/fanout-dag-experiment-template.md`](benchmarks/fanout-dag-experiment-template.md)

Raw artifacts remain ignored under:

```text
runs/fanout-dag-prompt-experiments/loop-20260707-145016/
```

Current graduated prompt: `combined-general-conflict-proof`.

| Metric | Value |
| --- | ---: |
| Prompt variants in graduating loop | 5 |
| Tasks in graduating loop | 5 |
| Heldout tasks | 2 |
| Best average score | 4.916 / 5 |
| Best minimum task score | 4.88 / 5 |
| Stop condition | Passed |

Caveat: P0 uses generated DAGs and evaluator rubrics. Revalidate the winning prompt under P1/P2 execution benchmarks before treating it as an executable-runtime default.

## P1 — `/fanout-execute` packet smoke benchmark

Date: 2026-07-09

Purpose: validate deterministic Phase 3 controller mechanics with fake Pi subprocesses before controlled live-provider execution. This is runtime safety/contract evidence, not a model-quality, latency, or provider-cost baseline.

Command:

```bash
rtk npm run smoke:fanout-execute
```

Current result: the prior plan-v2/details-v3/packet-v5 generation passed locally, but the live canary reopened deterministic-glue scope in issue #32. The coordinated replacement is plan v2, details v4, packet v6, pointer v2, work-contract v2, attempt outcome v2, final evidence v1, event v2, and projection v3. Its added proof covers one explicit candidate-normalization manifest, run-once pre-capture execution, nonzero continuation into authoritative validation, hard-failure routing without model-repair budget, audit identities/results, and ownership rejection of normalizer-created unauthorized changes. Do not treat the replacement as locally green until the full `rtk npm run check` result is recorded after implementation.

Supersession note (2026-07-20): this remains historical contract evidence for Attempt outcome v2/event v2/projection v3. Attempt Outcome v3/Event v3/Projection v4 is now the only current replayable generation and records exact Worker Turn, Provider Response, named Tool Invocation, and cache evidence. The complete keyless root contract/replay/worker matrix passes through `rtk npm run check`; this is validation evidence, not a new live latency, cost, or release-readiness claim.

Current-generation note (2026-08-04): planning uses profile v1, plan v3, details v6, work contract v4, packet v9, and pointer v2; runtime evidence remains Attempt Outcome v5, Event v5, Projection v6, and final evidence v2. Work contract v3 and packet v8 are descriptive Legacy authority and require replanning; there is no migration or compatibility adapter. Workers now receive zero-argument, manifest-bound `fanout_validate` beside the six file tools, while controller validation remains authoritative. Offline smokes prove exact command binding, lone-call enforcement, same-call failure feedback, manifest-tamper rejection, per-call evidence, and unchanged controller reruns.

The first packet-v9 model-backed canary, `2026-08-04T15-47-51-375Z-6255f7df`, is a stopped prefix rather than a completed comparison. Runtime advisory validation failed, then passed twice in the same original attempt; documentation failed, then passed; both original candidates passed controller validation and were accepted. The TypeScript node's immutable direct-argv command contained a literal brace expression unsupported by `tsd`, so its original and one exact-no-progress repair failed before final validation. Compared with completed historical run `2026-08-04T13-58-43-157Z-e46c2a14`, observed repairs fell from three to one, repair fresh input from 163,536 to 32,346 tokens, and repair cost from `$1.329` to `$0.275`; these prefix observations are not an end-to-end latency, cost, quality, or reliability result.

The corrected packet-v9 canary, `2026-08-05T03-55-29-413Z-80959fd6`, replaced the malformed TypeScript manifest with direct-argv-safe `npm run type` and completed from the exact Execa baseline. Four original Terra workers launched at concurrency four; types, API docs, and runtime reconciled deterministically, and one Sol final-validation repair fixed three XO findings across two test files. Worker `fanout_validate`, controller final validation, and an independent `npm test` all passed. The run finished in 998.923s on exact 14-path tree `375b89e307bb59cd121cb5b8eb5abc8c6aa08a5c`, using 1,376,170 tokens and `$1.1057552`. No internal failure recurred, but the corrected exact-no-progress causal branch was not re-exercised.

Five fixed packet-v9 repetitions then completed at runtime-equivalent commit `ebbbd7e`; its only change from the canary source was benchmark documentation. All five passed controller and independent full-suite validation. Wall time had median 995.074s and range 631.296–1,530.488s, tokens median 1,143,064 and range 756,614–1,654,515, and cost median `$0.8866022` and range `$0.5685264`–`$1.1499204`. The cohort used one clean runtime retry and four final repairs across 25 attempts; 36 worker-validation calls recorded 29 passes and seven advisory failures. The exact-no-progress causal branch remained unexercised.

Validation-routing update (2026-08-05, canary pending): final-repair worker manifests now retain only packet-focused final commands; profile-required project gates remain controller-only, while recovery prompts preserve the complete authoritative failure evidence. The default post-run protocol now inspects tree-bound controller evidence instead of launching another full suite. This changes benchmark methodology and routing policy but adds no latency, cost, or reliability result until a newly authorized canary completes.

Previous-generation note (2026-08-03): planning used profile v1, plan v3, details v6, work contract v3, packet v8, and pointer v2; runtime evidence remained Attempt Outcome v5, Event v5, Projection v6, and final evidence v2. Details v5 and packet v7 became descriptive Legacy data. Deterministic smokes covered phase-specific schemas, provider-call termination, serialized context reduction, Pi-native planning read scope, and Phase A ban propagation. The projected 64.7s/`$0.178`, 92,285-token inherited transcript, and 187,691-input-token/`$0.133` post-submit savings came from overlapping observed samples and are not summed.

Previous-generation note (2026-07-28): profile v1, plan v3, details v5, work contract v3, packet v7, Attempt Outcome v4, final evidence v2, Event v4, and Projection v5 superseded the prior executable generation. Focused offline evidence covers cumulative repair seeds, isolated profile preparation, exact path-disjoint reconciliation, exact no-progress termination, vertical serial-chain fusion, profile-aware profiler compatibility, cleanup timing before the terminal event, and optional advisory Worker-summary continuity across node validation repairs without a schema change. Older execution evidence is descriptive Legacy data; there is no migration. The Worker-summary candidate's initial live confirmation exposed a mislabeled digest and launched no worker. Reviewed fix `3fef090` corrected the display; the restarted canary completed and repetition 1 then stopped on bounded runtime-test validation-repair exhaustion.

The attempt-outcome check passes A10–A12 offline: prose-like output cannot affect typed routing, accepted generic and instrumented metrics require exact correlated identities, failed attempts retain observed partial cost, and nested validation/integration repair cannot exceed either fixed two-launch pool. This remains contract evidence only.

The companion execution-event check passes A13–A14 offline: serialized commits remain gapless, projection/report publication failures leave a complete authoritative log, audit replay regenerates only derived views, corrupt logs fail closed, live/dry-run outcomes remain explicit, and accepted final repair rolls projection authority to the newly validated tree. Reports have a byte-stable projection-only contract.

Caveat: worker usage and cost in this smoke are synthetic fake-provider fixtures. P2 now has controlled real-Pi diagnostic evidence below; P4 live tier-routing measurements remain pending.

## P2 — Manual p-map AbortSignal E2E

Date prepared: 2026-07-10; release-candidate update: 2026-07-14

Status: the 2026-07-27 implementation addresses the prerequisite and Points 1–4 from the reliability investigation. Its controlled sequence completed the canary and repetitions 1–2, then stopped when repetition 3 exhausted the fused runtime/test node's two validation repairs. The release-confidence gate therefore remains open. The 2026-07-28 Worker-summary sequence first stopped before workers on a confirmation-label defect. After reviewed fix `3fef090`, its restarted canary completed with final tree `73e501a3…`, 55 passing tests, 420.728s wall time, 486,170 tokens, and `$0.8393655`. Repetition 1 stopped after the test-only node exhausted two repairs against a production abort-race defect outside its write authority; repetitions 2–3 were not run.

The subsequent reviewed planning-boundary fix `0f008e1` was exercised with a realistic issue-style task rather than a Fanout-specific decomposition. Ordinary planning naturally placed `index.js` and `test.js` in one repair boundary. Canary `2026-07-28T13-19-03-879Z-2f6c81a7` then stopped after that joint node exhausted its two validation repairs; the last AVA run passed the new deterministic abort tests but failed the existing timing-bound `pMapIterable - concurrency: 2` assertion at 304.840 ms against its 200–250 ms interval. One exact offline replay of rejected tree `f25f6832…` failed the same assertion at 303.720 ms while the new tests again passed, ruling out a simple one-off timing flake and pointing to a repeatable candidate scheduling regression. The independent accepted partial tree retained only the documentation transition and passed all 51 baseline tests. Repetitions 1–3 were not run. This revised-task cohort is not byte-identical to earlier task-input cohorts, and no completed-run median, range, reliability rate, or universal SLO is inferred.

The 2026-07-29 action-first prompt canary used source commit `3926f8f` plus the user-edited batching discipline SHA-256 `25597ad6…`. Its fresh plan grouped all five allowed files into one work node, so it is not an identical or parallel-speed comparison. Canary `2026-07-29T15-40-31-736Z-90f6d680` completed on exact tree `8ab065be…`: the original candidate failed XO, one summary-backed validation repair passed, both final `npm test` gates passed, and an independent run reported 56 tests. Wall time was 416.529s, profiler completion boundary 381.009s, total tokens 629,129, and estimated cost `$0.657389`. No repeat cohort or reliability claim is attached to this single changed-plan canary.

A second fresh-planning sample exercised the user's next prompt revision at the same source commit, with batching-discipline SHA-256 `84e9661e…` and implementation-plan prompt SHA-256 `e6d7a3c4…`. Ordinary planning produced three independently owned items and kept `index.js` with `test.js`; honest typed reads serialized runtime, types, and documentation. Canary `2026-07-29T16-35-28-543Z-9dbcf498` completed on exact accepted tree `7cd01449…` after the runtime node used both validation repairs; types and documentation passed on their original attempts. Both final gates and an independent 54-test run passed. Wall time was 525.529s, profiler completion boundary 467.485s, tokens were 539,203, and estimated cost was `$0.833411`. This fresh packet/profile is not an identical repeat of the preceding canary, so no median, range, reliability rate, or SLO is reported.

A third prompt revision used implementation-plan/details prompt SHA-256 identities `09ba7e33…` / `f2427fec…` and produced three disjoint work nodes concurrently ready in the first group, followed only by final validation. Runtime retained joint `index.js`/`test.js` authority, while type and README reads were correctly classified as planning-baseline context. Dry-run `2026-07-29T17-04-06-745Z-0ccaa087` completed in 17.538s with zero attempts, tokens, cost, or repository changes. Live canary `2026-07-29T17-07-55-275Z-f8eca267` then completed on exact tree `02541d0d…`: types and README passed on their original attempts, while the runtime original failed four XO checks and one summary-backed validation repair passed. Both final `npm test` gates and an independent 55-test run passed. Wall time was 267.536s, the profiler completion boundary was 224.839s with 48.313s observed node overlap, tokens were 340,140, and estimated cost was `$0.497531`. The user paused the three repetitions before any repetition worktree or run was started, so no median, range, reliability rate, or SLO is reported.

Runbook: [`docs/benchmarks/p-map-abort-signal-manual-e2e.md`](benchmarks/p-map-abort-signal-manual-e2e.md)

Live tracker: [`docs/benchmarks/p-map-abort-signal-canary-tracker.md`](benchmarks/p-map-abort-signal-canary-tracker.md)

Reliability/latency investigation: [`docs/benchmarks/fanout-optimization-progress.md`](benchmarks/fanout-optimization-progress.md)

Purpose: exercise `/fanout-config` → `/fanout-plan` → `/fanout-execute --dry-run` → `/fanout-execute` manually against a fixed `sindresorhus/p-map` task before building a benchmark harness or routing variations. The run prioritizes correctness, UX, recovery, artifact quality, and observability. It uses local baseline `c3c261e2189f94d1a09724e8f03d5345af518017` and the decision-complete `pMapIterable` AbortSignal benchmark under `/Users/snehalyelmati/Documents/p-map-abort-signal`.

The user operates Pi and authorizes every live or cost-incurring step. Preserve failed artifacts, diagnose the owning component before edits, and record results only after comparing Fanout reports with the nested repository Git state and independent `npm test` output. The 2026-07-27 sequence ran from clean independent 51-test baselines with Tier 1 `openai-codex/gpt-5.6-sol` medium, async Tier 2 disabled, and `openai-codex/gpt-5.6-terra` medium as the realtime worker fallback; the Pi process had the Doubleword credential removed. Across the three completed identical runs, wall time had median 306.291s and range 278.563–408.114s, tokens median 502,710 and range 348,095–617,895, and estimated cost median `$0.624695` and range `$0.547498`–`$0.843834`. See the tracker for phase, critical-path, overlap, repair, pane, cleanup, tree, and failed-run evidence.

Deferred until this manual path is reliable: automated execution harnesses, policy/model variations, and provider-tier cost or latency comparisons. Add a running-experiment ledger row only after observed artifacts and metrics exist.

## P2b — Execa Web Streams transfer canary

Date: 2026-07-29

Status: the first controlled canary completed; the 2026-07-30 focused-validation canary stopped on its first worker-scope failure; a subsequent bounded unauthorized-change-recovery canary completed without invoking that route; a normal Pi control completed from the same baseline; the 2026-08-04 packet-v9 worker-validation canary stopped on malformed direct-argv TypeScript validation authority; the corrected packet-v9 canary completed on 2026-08-05; and five fixed repetitions completed on 2026-08-05.

Purpose: exercise the same manual product-debugging path on a larger repository and cross-module feature after the p-map control. The task adds asynchronous subprocess Web Stream conversion methods across runtime behavior, pipeline forwarding, early-error handling, public types, type tests, behavioral tests, and documentation. It is transfer/complexity evidence, not a byte-identical p-map repetition or a directly comparable speed cohort.

Fixed fixture:

- task: `/Users/snehalyelmati/Documents/execa-web-streams/TASK.md`;
- repository: `/Users/snehalyelmati/Documents/execa-web-streams/repo`;
- upstream commit: `c31c94c2c65e1aaf1b4d3295eaf927b910a2dc46`;
- reproducible local baseline: `6e9ed1185adca485097d299da263a38d74ee636b`;
- local baseline tree: `475de97e8bce060242e1ce9025d10e7f763735bd`;
- baseline difference: committed `package-lock.json` only;
- baseline validation: 5,096 unit tests plus lint, `tsd`, and `tsc` passed on Node `v26.5.0` and npm `11.17.0`.

The fixture is a shallow single-history checkout with no remote, keeping the historical implementation unavailable to workers through local Git history. Runbook and exact evidence: [`docs/benchmarks/execa-web-streams-manual-e2e.md`](benchmarks/execa-web-streams-manual-e2e.md).

Dry run `2026-07-29T18-34-56-001Z-b5556ab8` passed without workers or mutations. Live canary `2026-07-29T18-35-56-724Z-06e1182a` completed from the exact baseline with four ordinary nodes, concurrency two, and final accepted tree `c3ad52480adfb65a9bda2b63f609b7133aaef7b7`. The final checkout changed exactly the 14 allowed paths, independent `npm test` and `git diff --check` passed, and no current-run process, extra worktree, or execution lock remained.

Three ordinary nodes passed first try. The joint runtime/test node required both validation repairs after a 240-second focused AVA timeout and a second program failure. One project final-validation repair fixed three integrated XO findings, then both ordered full `npm test` gates passed. Immediate worker-summary continuity held across the runtime repair chain and remained outside authoritative event and recovery state. There was no integration repair, reconciliation, exact-no-progress stop, budget exhaustion, fusion, or attempt fallback.

The run took 1,240.055s, used 1,403,298 tokens, and cost an estimated `$1.8652415`. Profiler compatibility passed with the exact profile identity and derived a 1,193.167s observed completion boundary, 231.712s ordinary-node overlap, 596.734s final-validation span, 65.718s aggregate TTFT, and 316.537s aggregate generation. Ordinary workers used Terra medium as the configured realtime fallback for unavailable async Tier 2; repairs used Sol medium, with no Tier 2 provider calls.

Post-canary protocol analysis found avoidable validation breadth: Phase B repeated the profile's exact `npm test` gate as packet-final validation, so effective final validation ran the full suite twice; the type node also selected repository-wide `npm run type` rather than a focused type-test invocation. The 2026-07-30 planning fix supplies the exact approved profile to Phase B, requires the narrowest meaningful node checks, reserves packet-final commands for additional task-specific integration, and rejects exact profile-gate duplicates as correctable drafts without ending planning. This is workflow-validation hardening, not a revised Execa performance result; measure its effect only in a newly authorized clean canary.

Keep p-map as the existing control and release gate. This single Execa canary is transfer/complexity evidence only; do not report a median, range, reliability rate, direct p-map speed comparison, or universal SLO. Repetitions require separate authorization and a clean baseline with byte-identical frozen inputs.

The 2026-07-30 rerun at Fanout commit `071a978` reused the exact prior profile while producing a new ordinary plan and packet. The packet correctly replaced the type-wide gate with focused `tsd`, combined docs under one focused XO command, reserved packet-final validation for one task-specific AVA command, and left the sole project-wide `npm test` in the profile. Dry run `2026-07-30T13-30-04-955Z-515240ac` passed without workers or mutations.

Live run `2026-07-30T13-31-34-936Z-035a16ed` stopped when the Terra runtime worker edited all 14 task files despite explicit write authority for only its seven runtime/test files. Fanout rejected that candidate as `unauthorized-change` before validation and did not apply or repair it. Types and docs passed and produced exact accepted tree `c401cf558d22387faf1756c133e7dab5f12382ee`; final validation did not run. Cleanup left no current-run process, extra worktree, or execution lock.

The adopted routing follow-up discards an original unauthorized candidate whole and spends at most the existing clean retry in a fresh reconstruction with the same assignment, prompt, and work contract. It does not trim unauthorized paths, seed rejected bytes, expand ownership, or retry forbidden/repeated violations. This is a bounded reliability-policy change, not a revised Execa result; measure it only in a separately authorized canary.

The focused type gate fell from 9.376s to 3.887s, and the combined docs gate took 1.897s versus 3.524s summed previously. Because the run stopped before runtime and final validation, it cannot measure the full duplicate-suite removal. The stopped run lasted 307.657s, used 999,692 tokens, and cost `$1.030657`; profiler evidence covers only the recorded prefix. Treat the failure as worker scope obedience, not evidence against the validation-scope change.

The recovery-policy canary ran at Fanout commit `5ee0d8e` with a new ordinary plan and packet, the exact unchanged profile, and the same Sol medium / disabled async Tier 2 / Terra medium fallback routing. Dry run `2026-07-30T14-49-23-602Z-ddb21840` passed without workers or mutations. Live run `2026-07-30T14-50-17-829Z-86af4e51` completed with current Event v5 / Projection v6 evidence and final accepted tree `b320d9829b6257000cf22845c932a0e594fae5e8`.

All original candidates stayed within authority, so the new clean retry for an original `unauthorized-change` was not exercised. Types and docs passed originally; runtime required one validation repair after focused AVA failure; project final validation required one repair for two XO findings. The repaired XO gate and the profile's sole full `npm test` passed. Exactly the 14 allowed paths changed, `git diff --check` passed, and cleanup left no current-run process, extra worktree, or lock.

The completed canary took 733.668s, used 989,440 tokens, and cost `$1.1097045`. The profiler admitted it as Current with exact profile identity: 657.421s observed completion boundary, 214.021s ordinary-node overlap, 367.586s final-validation span, 64.381s aggregate TTFT, and 302.938s aggregate generation. This separately planned canary shows successful-path compatibility only; it does not establish a recovery rate, median, range, reliability rate, or universal SLO.

A normal Pi control then ran from the same clean baseline in pane `%272`, using Sol medium without the Fanout extension. It completed in 712.072s prompt-to-final, including a 127.232s plan-approval interval, or 584.840s after approval. The session used 1,928,547 tokens and cost `$1.891544`; its full `npm test` passed 5,115 tests. Exactly the 14 allowed paths changed, `git diff --check` passed, and the result tree was `ed7963c8f5e7304acfb9d5074f4190bcb7b2d7e9`.

For the closest end-to-end comparison, adding Fanout's 561,857-token / `$1.548218` planning session to its live execution yields 1,551,297 tokens and `$2.6579225` across 1,206.511s from Phase A prompt through the terminal execution report. Normal Pi was 494.439s (41.0%) shorter and `$0.7663785` (28.8%) cheaper, while recording 377,250 (24.3%) more total tokens because of heavier cache reads. Fanout used 8 planning plus 33 execution turns and 180 model tool calls; normal Pi used 33 turns and 63 tool calls.

The outputs are not byte-equivalent: Fanout ended at tree `b320d9829b6257000cf22845c932a0e594fae5e8`, normal Pi at `ed7963c8f5e7304acfb9d5074f4190bcb7b2d7e9`. Both passed their self-authored integrated suites and stayed within the allowlist, but the fixture has no common independently authored hidden acceptance suite. Fanout additionally supplies typed authority, rejected-candidate isolation, accepted-ledger replay, deterministic repair routing, isolated preparation, and profiler evidence. Treat this as one workflow comparison, not a quality ranking, reliability rate, median, range, or SLO.

The packet-v9 worker-validation canary `2026-08-04T15-47-51-375Z-6255f7df` ran from the same fixed baseline with three ordinary nodes. Runtime used advisory `fanout_validate` as failed → passed → passed and documentation as failed → passed; controller validation accepted both original attempts. TypeScript planning supplied `npx tsd --files test-d/convert/{readable-stream,writable-stream,transform-stream}.test-d.ts --files test-d/pipe.test-d.ts`. Direct argv passed the brace expression literally, `tsd` rejected it, and the one repair repeated the exact candidate/failure state. The recorded prefix ended after 327.517s, 825,187 tokens, and `$0.784550`, with two original accepted transitions, one exact-no-progress termination, and no final validation. A routing bug then reported controller `internal-failure` instead of causally completing the failed node; this does not change the underlying typed repair outcome.

Against completed historical run `2026-08-04T13-58-43-157Z-e46c2a14`, repair launches fell from three to one in the recorded prefix, repair fresh input fell from 163,536 to 32,346 tokens, and repair cost fell from `$1.329` to `$0.275`. Because malformed validation authority stopped the packet-v9 run before final validation, do not compare its total time, tokens, cost, accepted tree, or correctness with the completed historical run and do not infer a repair or reliability rate.

After correcting the direct-argv validation authority and causal failed-node routing, packet-v9 canary `2026-08-05T03-55-29-413Z-80959fd6` completed from the exact baseline at Fanout commit `505c258`. Its four original Terra workers launched at concurrency four and all passed without node repair; types, API docs, and runtime used deterministic reconciliation. Initial integrated XO found three findings across two test files, and one Sol final-validation repair passed its manifest-bound worker validation before the controller independently reran focused XO and the profile's full `npm test`.

The final checkout changed exactly the 14 authorized paths and produced tree `375b89e307bb59cd121cb5b8eb5abc8c6aa08a5c`. Independent `npm test` passed lint, 5,109 AVA tests, `tsd`, and `tsc`; `git diff --check`, worktree, process, and lock cleanup checks passed. The 998.923s run used 1,376,170 tokens and `$1.1057552`; median TTFT was 4.505s, and the four original generation envelopes saved 295.202s through overlap. This is one separately planned successful canary, not a repetition cohort. The prior exact-no-progress causal-failure route was not exercised, so no claim is made for that corrected branch or for a repair/reliability rate.

Five repetitions reused the exact corrected packet/profile, Execa baseline, routing, concurrency four, and platform at Fanout commit `ebbbd7e`; compared with the canary commit, only the benchmark documentation differed and runtime bytes were unchanged. All five runs completed and passed controller final validation, independent `npm test`, `git diff --check`, authority, worktree, process, and lock checks. Their exact final trees differed, as expected from independently generated implementations.

Across those repetitions, wall time had median 995.074s and range 631.296–1,530.488s; tokens median 1,143,064 and range 756,614–1,654,515; and cost median `$0.8866022` and range `$0.5685264`–`$1.1499204`. The 25 attempts comprised 20 originals, one successful clean runtime retry after a 602-second worker-process timeout, and four successful final repairs. Workers made 36 manifest-bound validation calls, 29 passing and seven failing before in-attempt correction. No fallback, node validation repair, integration repair, exact-no-progress termination, budget exhaustion, internal failure, or manual code intervention occurred. This supports a 5/5 completed-run observation for the fixed repetition cohort, not a universal reliability claim; the corrected exact-no-progress causal branch remains untested.

Pricing synchronization update (2026-08-26, no live result): current provider pricing now comes from a manually generated exact-ID snapshot of the official Doubleword model catalogue, including cache-read rates and source URL/retrieval-date/SHA-256 provenance. `deepseek-ai/DeepSeek-V4-Flash-0731` is recorded at realtime `$0.09/$0.02/$0.18`, async `$0.07/$0.01/$0.14`, and batch `$0.05/$0.01/$0.09` per million input/cache-read/output tokens. Historical benchmark costs below retain the rates used when those experiments ran and were not recalculated. Deterministic mocks are not native-usage or paid-canary evidence.

Model-routing update (2026-08-29, no live result): `zai-org/GLM-5.3-Flash` replaces GLM 5.2 in the provider fallback/stub and Fanout Tier 2 default. The synchronized catalogue records realtime `$0.15/$0.03/$0.50`, async `$0.11/$0.02/$0.38`, and batch `$0.08/$0.02/$0.25` per million input/cache-read/output tokens. Historical GLM 5.2 benchmark commands, costs, and conclusions below remain unchanged; no GLM 5.3 latency, quality, reliability, or paid-cost result is claimed.

## Current baseline: B0 — Pi session traces, GLM 5.2 pricing

Date: 2026-06-25

Purpose: establish the baseline for the normal sequential Pi agent loop before optimizing workflow or deciding where tier 2 can be used without hurting usability.

Dataset: [`badlogicgames/pi-mono`](https://huggingface.co/datasets/badlogicgames/pi-mono), sampled raw Pi session JSONL traces.

Benchmark command:

```bash
rtk npm run benchmark:traces -- \
  datasets/traces/pi-mono-sample/2026-01-16T03-18-40-694Z_89afd3da-1fa3-45f9-87ad-a023f92372ee.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T02-37-34-075Z_4293a326-81ca-4327-b450-85275e1ca645.jsonl \
  --model glm-5-2
```

Generated summary: `runs/phase6/summary.md`.

### Pricing used

| Model | Realtime / tier 1 input | Realtime / tier 1 output | Tier 2 input | Tier 2 output |
| --- | ---: | ---: | ---: | ---: |
| `glm-5-2` | $1.40 / MTok | $4.40 / MTok | $1.05 / MTok | $3.30 / MTok |
| `deepseek-v4-flash` | $0.14 / MTok | $0.28 / MTok | $0.10 / MTok | $0.20 / MTok |

Tier 2 latency simulation: deterministic random 5–10 minutes per assistant/model turn.

### Sample traces

More trace details live in [`docs/benchmarks/pi-mono-sample.md`](benchmarks/pi-mono-sample.md).

| Label | Session id | User segments | Assistant turns | Tool calls | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| tiny-tools | `89afd3da-1fa3-45f9-87ad-a023f92372ee` | 1 | 2 | 3 | tiny tool-use loop |
| medium-pr-review-merge | `105b45a9-be31-4997-95c3-c95ab814daf8` | 2 | 22 | 25 | PR review/merge workflow |
| large-issue-732 | `4293a326-81ca-4327-b450-85275e1ca645` | 19 | 157 | 144 | long issue implementation workflow |
| **total** |  | **22** | **181** | **172** |  |

### Agent-loop shape

The sampled loop is sequential at the model-call level:

```text
user → assistant/tool call(s) → tool result(s) → assistant/tool call(s) → ... → assistant final text
```

Tool calls can be batched inside one assistant turn, but assistant turns are not parallel in these traces.

Assistant turns between user messages:

```text
{0: 1, 1: 4, 2: 5, 3: 2, 5: 2, 6: 1, 7: 1, 10: 1, 12: 1, 15: 1, 16: 1, 18: 1, 67: 1}
```

Tool calls per assistant turn:

```text
{0: 19, 1: 153, 2: 8, 3: 1}
```

### Assistant response-time baseline

Response time is a raw Pi-session timestamp-gap proxy: assistant message timestamp minus previous message timestamp. This includes model time plus any surrounding recorded delay, so use it as a comparative baseline, not exact provider TTFT.

| Metric | Value |
| --- | ---: |
| Assistant/model calls | 181 |
| Total tier 1 response time | 17.5m |
| Average call | 5.8s |
| Median call | 4.4s |
| P90 call | 8.5s |
| Max call | 41.3s |
| Calls over 60s | 0 |
| Calls over 5m | 0 |

### Baseline cost/time comparison

| Strategy | Cost | Turnaround |
| --- | ---: | ---: |
| Normal realtime GLM | $23.0533 | 17.5m |
| Doubleword tier 1 GLM | $23.0533 | 17.5m |
| Doubleword tier 2 GLM, all turns | $17.2899 | 23.4h |

Cost saved by all-tier-2: $5.7633, but turnaround grows from 17.5m to 23.4h.

### Naive hybrid routing

This chooses tier 2 turns by best dollar saved per added second, under an extra-turnaround budget. It is not a product policy yet; it shows the current tradeoff.

| Extra turnaround allowed | Tier 2 turns | Cost saved | Total turnaround |
| ---: | ---: | ---: | ---: |
| ~10m | 2 | $0.1003 | 27.5m |
| ~1h | 10 | $0.4956 | 73.1m |
| ~4h | 37 | $1.7587 | 4.3h |
| ~8h | 70 | $3.0064 | 8.3h |
| all tier 2 | 181 | $5.7633 | 23.4h |

### Baseline conclusion

Tier 2 does not improve active sequential turnaround on these traces. Every sampled tier 1 assistant call is faster than tier 2's 5-minute minimum SLA.

Tier 2 can still reduce cost if used for work that does not block the active loop, such as:

- background review or analysis after a tier 1 planning turn;
- speculative context gathering where stale/late results are acceptable;
- batch replay/eval jobs;
- parallel branches where the user is not waiting on every branch sequentially.

## D1 — Trace-DAG routing check

Date: 2026-06-25

Purpose: check whether turning the same B0 traces into a DAG creates enough off-critical-path model work to justify a DAG executor or tier1+tier2 routing.

Command:

```bash
rtk node scripts/dag-trace-analysis.mjs \
  datasets/traces/pi-mono-sample/2026-01-16T03-18-40-694Z_89afd3da-1fa3-45f9-87ad-a023f92372ee.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T02-37-34-075Z_4293a326-81ca-4327-b450-85275e1ca645.jsonl \
  --out runs/dag-analysis
```

Detailed notes: [`docs/benchmarks/dag-analysis.md`](benchmarks/dag-analysis.md).

| Strategy | Cost | Provider turnaround | Notes |
| --- | ---: | ---: | --- |
| Realtime endpoints / tier 1 all turns | $23.0533 | 17.5m | B0 baseline |
| Faithful trace DAG, tier1+tier2 combo | $23.0533 | 17.5m | 0 off-critical assistant turns |
| All tier 2, blocking | $17.2899 | 23.4h | Cost floor, not interactive |
| Optimistic segment DAG combo | $18.5364 | 110.9m | First/last segment turns tier 1, middle turns parallel tier 2 |

Conclusion: the trace-derived DAG is effectively linear at the model-call level. Tool-call fan-out exists but does not affect provider cost and is already cheap. A faithful DAG executor is not enough; the next work is an optimistic DAG workflow that deliberately creates background branches.

## D2 — Manual semantic DAG review

Design notes and detailed results: [`docs/benchmarks/semantic-dag-and-rpe.md`](benchmarks/semantic-dag-and-rpe.md).

Purpose: replace the coarse optimistic-DAG heuristic with subagent line-by-line semantic reviews.

Method:

- Subagents read each JSONL trace line-by-line.
- Every JSONL line is covered in notes.
- DAG branches are marked tier2-eligible only when semantically off the user-visible critical path or safe to miss a deadline.
- DAG/prompt-efficiency savings are tracked separately from Doubleword tier savings.

| Metric | 10-trace manual semantic total |
| --- | ---: |
| Baseline tier1 cost | $20.7282 |
| Semantic tier2 savings | $0.3068 |
| Semantic tier2 savings pct | 1.48% |
| Separate DAG/prompt-efficiency estimate | ~$5.1419 |
| DAG/prompt-efficiency pct | ~24.8% |

Conclusion: generic optimistic DAG tier2 routing is weak for normal interactive traces. Most model turns are critical-path. The larger opportunity is tier1 workflow efficiency: fewer model turns, less context bloat, better batching, and fewer symptom-fix loops.

## D3 — Research-plan-execute tier routing

Purpose: test a narrower workflow where research+plan stays tier1 and approved execution runs on tier2.

| Trace | Execute turns | Tier1 baseline | R+P tier1 + execute tier2 | Savings | Baseline provider time | Hybrid provider completion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `10-50-40_13d61130` | 21 | $2.4825 | $2.1352 | $0.3473 / 14.0% | 4.7m | 108.6m-3.6h |
| `11-27-41_7e5bb6ee` | 14 | $0.6010 | $0.4811 | $0.1199 / 20.0% | 2.1m | 71.0m-2.3h |
| `19-35-54_90c2c1e4` | 102 | $17.4756 | $13.3270 | $4.1486 / 23.7% | 11.6m | 8.5h-17.0h |
| `20-55-34_e18dee76` | 9 | $0.5259 | $0.4098 | $0.1161 / 22.1% | 78.7s | 45.7m-90.7m |
| `21-53-12_1375d9e7` | 22 | $2.0820 | $1.7228 | $0.3592 / 17.3% | 3.8m | 111.9m-3.7h |
| **total, sequential** | **168** | **$23.1670** | **$18.0758** | **$5.0912 / 22.0%** | **23.5m** | **14.2h-28.2h** |

Conclusion: RPE is the first trace-backed shape where tier2 savings are material. It is not suitable for blocking interactive execution; it is a background/portfolio workflow.

## D4 - Hybrid workflow fixture schema

Date: 2026-06-25

Purpose: add a committed local JSONL fixture format for future tier1/tier2 workflow simulation while preserving existing observability and Pi session parsing.

Command:

```bash
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
```

Committed fixtures:

- `datasets/fixtures/hybrid-workflows.jsonl`
- `datasets/fixtures/hybrid-workflows-out-of-order.jsonl`

The hybrid format uses `schema: "doubleword.hybrid-workflow"`, `version: 1`, one `kind: "workflow"` metadata row per workflow, and `kind: "node"` rows for graph nodes. Workflow metadata includes scenario id, source type, target ratio, budget, deadline origin, concurrency cap, and active boundary. Node metadata preserves dependencies, phase, tier eligibility, active/background, mandatory/optional, durations, token cost inputs, deadlines, outcomes, groups, shards, branches, portfolio, conflict, stale, fallback, review, and validation links.

Scenario coverage in `hybrid-workflows.jsonl`:

| Scenario | Source type | Purpose |
| --- | --- | --- |
| `linear-critical-path` | synthetic | mandatory linear control |
| `wide-fanout` | synthetic | optional background fan-out |
| `serial-rpe` | synthetic | research-plan active boundary with background execution |
| `sharded-rpe` | synthetic | independent background execute shards |
| `speculative-branch-race` | synthetic | branch winner plus late loser metadata |
| `speculative-invalid-fastest-branch` | synthetic | fastest invalid speculative branch rejected before next valid winner |
| `renamed-mandatory-critical-path` | synthetic | graph-structural linear mandatory critical path with non-literal scenario id |
| `deadline-miss` | synthetic | optional late result |
| `budget-constrained-routing` | synthetic | budget metadata for routing policies |
| `conflict-stale-output` | synthetic | conflict and stale output metadata |
| `validation-failure-fallback` | synthetic | failed tier2 output with tier1 fallback and review |

These fixtures are synthetic assumptions, not observed trace feasibility evidence.

## D5 - Hybrid policy simulation engine

Date: 2026-06-25

Purpose: deterministically compare tier1/tier2 workflow policies over the committed hybrid fixture graph while keeping active user-facing TAT separate from background completion.

Command:

```bash
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
```

The simulator emits all required policies for every hybrid workflow: all tier1 baseline, all tier2 blocking, critical-path/slack, deadline synthesis, RPE background, sharded RPE, speculative portfolio, and budget-constrained routing. Each result includes per-node schedule evidence with tier assignment, dependency start/end times, active/background classification, accepted/late/failed state, cost, budget status, tier2 concurrency, and 3x target status.

Representative synthetic outcomes:

| Fixture | Policy | Active TAT | Background completion | Target status | Notes |
| --- | --- | ---: | ---: | --- | --- |
| `hybrid-linear-critical-path` | all tier2 blocking | 11.0s | 11.0s | infeasible | Mandatory tier2 work is on the active linear critical path. |
| `hybrid-wide-fanout` | critical-path/slack | 1.5s | 7.5s | pass | Optional research fan-out moves to tier2; one optional result is late. |
| `hybrid-serial-rpe` | RPE background | 1.8s | 9.8s | pass | Active response stops at the tier1 plan; execute completes in background. |
| `hybrid-sharded-rpe` | sharded RPE | 1.6s | 8.1s | pass | Two independent execute shards honor the tier2 concurrency cap. |
| `hybrid-branch-race` | speculative portfolio | 5.8s | 9.7s | pass | Fast valid branch wins, slow loser cost is counted as speculative waste. |
| `hybrid-invalid-fastest-branch` | speculative portfolio | 6.1s | 7.6s | pass | Failed fastest and stale slowest branches are rejected and counted as speculative waste; the next valid branch wins. |
| `hybrid-structural-linear-mandatory` | all tier2 blocking | 9.8s | 9.8s | infeasible | Mandatory tier2 work on a linear active critical path is detected structurally, not by scenario id. |
| `hybrid-budget-routing` | budget-constrained routing | 1.9s | 1.9s | fail | Cost exceeds the configured synthetic budget. |

These are fixture-policy results only. They prove simulator semantics and target accounting over synthetic assumptions; they do not claim observed real-trace feasibility.

## D7 - Hybrid target evidence workflow

Date: 2026-06-25

Purpose: run the mixed existing-plus-synthetic evidence workflow and record the honest 3x active TAT target status. The generated reports separate observed trace fixtures from synthetic workflow fixtures; all target passes below are synthetic fixture-policy evidence, not observed trace feasibility.

Command:

```bash
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
```

Generated evidence:

- `runs/mission-hybrid-benchmark/summary.json`
- `runs/mission-hybrid-benchmark/summary.md`

Run summary:

| Metric | Value |
| --- | ---: |
| Input files | 4 |
| Trace groups | 15 |
| Hybrid workflows | 12 |
| Hybrid policy results | 96 |
| Formats in one run | `hybrid-workflow`, `observability`, `pi-session` |
| Non-baseline pass results with tier2 calls and active ratio <= 3 | 49 |

Source labels in the generated JSON keep observed and synthetic evidence separate. `phase6-observability.jsonl` is summarized as `observability`, `pi-session-trace.jsonl` is summarized as `pi-session`, and the hybrid workflow fixtures are summarized as `hybrid-workflow` with `sourceType: "synthetic"` and `provenance.synthetic: true`.

Representative synthetic target passes:

| Fixture | Policy | Source | Active boundary | Active TAT | Background completion | Ratio | Tier2 calls | Target status | Caveat |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `hybrid-wide-fanout` | `critical_path_slack` | synthetic | `synthesis` | 1.5s | 7.5s | 1.000 | 3 | pass | Optional fan-out is explicit background work; one optional result is late and counted. |
| `hybrid-serial-rpe` | `rpe_background` | synthetic | `plan` | 1.8s | 9.8s | 1.000 | 1 | pass | Tier1 research and plan are the next actionable response; execute is deferred background work. |
| `hybrid-sharded-rpe` | `sharded_rpe` | synthetic | `plan` | 1.6s | 8.1s | 1.000 | 2 | pass | Independent execute shards run after the tier1 plan and honor the tier2 concurrency cap. |
| `hybrid-branch-race` | `speculative_portfolio` | synthetic | `accept-winner` | 5.8s | 9.7s | 1.526 | 2 | pass | Tier1 `accept-winner` reviews the winning tier2 branch; loser cost is counted as speculative waste. |
| `hybrid-invalid-fastest-branch` | `speculative_portfolio` | synthetic | `accept-winner` | 6.1s | 7.6s | 1.649 | 3 | pass | Tier1 `accept-winner` accepts `branch-valid-slower`; failed/stale branches are rejected and counted as waste. |

Representative infeasible synthetic classes:

| Fixture | Policy | Active TAT | Background completion | Ratio | Tier2 calls | Target status | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `hybrid-linear-critical-path` | `all_tier2_blocking` | 11.0s | 11.0s | 2.750 | 1 | infeasible | Mandatory tier2 work is on the active linear critical path. |
| `hybrid-structural-linear-mandatory` | `all_tier2_blocking` | 9.8s | 9.8s | 2.722 | 1 | infeasible | Mandatory tier2 work is on the active linear critical path, detected from graph structure rather than scenario id. |

Active/background interpretation:

- Active user-facing TAT is measured to each fixture's declared `activeBoundaryNodeId` plus mandatory active acceptance work.
- Work is excluded from active TAT only when fixture metadata marks it background, optional, non-user-blocking, or after a next-actionable boundary such as the RPE `plan`.
- Background completion still includes launched tier2 work, optional late results, and speculative losers.
- Passing policies that use mandatory tier2 output include a tier1 review, validation, synthesis, or acceptance node before claiming success. Examples include `accept-winner` reviewing portfolio branches and `repair-tier1`/`accept-fallback` validating failed tier2 output.

Detailed supporting notes: [`docs/benchmarks/hybrid-target-evidence.md`](benchmarks/hybrid-target-evidence.md).

## D8 - Planned Parallel RPE direction

Date: 2026-06-25

Purpose: record the post-mission workflow direction after comparing simulator evidence with observed multi-turn Pi trace reviews.

Evidence status:

- **Simulator evidence**: one-turn synthetic hybrid fixtures prove parser, scheduler, active/background accounting, target statuses, speculative waste, and infeasibility semantics.
- **Observed execution evidence**: manual multi-turn `pi-mono` reviews show generic interactive tier2 DAG routing is weak, with about 1.5% semantic tier2 savings in the reviewed sample.
- **Trace-backed RPE evidence**: five RPE-shaped traces show about 22% provider cost savings when research+plan stays tier1 and execution moves to tier2, but blocking completion grows to hours.
- **Future runtime work**: no live runtime TAT improvement is claimed yet. Planned Parallel RPE remains a design and evaluation direction.

Revised direction:

1. Do not build a generic tier2 DAG router for arbitrary middle turns.
2. Do not default to speculative duplicate feature implementations. They often repeat investigation, contend for the same files, create merge/review overhead, and waste tier2 budget unless independence is proven.
3. Focus tier2 work on **RPE background execution** and **sharded RPE**.
4. Use a **Planned Parallel RPE** workflow: tier1 planner, conflict-aware scheduler, isolated background executors, parallel reviewers, cancellation for speculative pre-confirm work, file ownership constraints, and final tier1 review/synthesis.

The next benchmark/evaluation step is retrospective and prefix-based:

```text
pi-mono trace prefix
  -> GPT-5.5 predicts safe work units, file ownership, dependencies, cancellation, review needs
  -> compare against full trace suffix
  -> score independence, conflict risk, validation preservation, and active-boundary correctness
```

This evaluation should decide whether GPT-5.5 can reliably identify safe independent work units from partial Pi trace context before any runtime scheduler or background executor is built.

## Running experiment ledger

Add one row per meaningful workflow or routing change.

| ID | Date | Change | Dataset | Model/routing | Cost | Turnaround | Notes |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| B0 | 2026-06-25 | Baseline sequential Pi loop | 3 `badlogicgames/pi-mono` traces | GLM realtime/tier 1 only | $23.0533 | 17.5m | Current baseline |
| B0-all-tier2 | 2026-06-25 | Same turns, all tier 2 SLA simulation | same | GLM tier 2 all turns | $17.2899 | 23.4h | Not usable interactively |
| D1 | 2026-06-25 | Faithful trace-DAG routing check | same | GLM tier1+tier2 combo | $23.0533 | 17.5m | No off-critical model turns; structural optimistic estimate later superseded |
| D2 | 2026-06-25 | Manual semantic DAG review | 10 Pi traces | GLM semantic tier1+tier2 | $20.4214 effective hybrid | same active path | Only 1.48% semantic tier2 savings; ~24.8% separate DAG/prompt-efficiency opportunity |
| D3 | 2026-06-25 | Research-plan-execute routing | 5 RPE Pi traces | GLM tier1 research+plan, tier2 execute | $18.0758 | 14.2h-28.2h sequential completion | Saves 22.0%; only viable async/background |
| D4 | 2026-06-25 | Hybrid workflow fixture schema | committed synthetic fixtures | parser only | n/a | n/a | Covers required workflow shapes and graph validation; no policy claims yet |
| D5 | 2026-06-25 | Hybrid policy simulation engine | committed synthetic fixtures | GLM tier1/tier2 policy matrix | per policy | active + background reported separately | Emits schedules, target statuses, concurrency/budget/deadline/fallback/speculative evidence |
| D6 | 2026-06-25 | Hybrid policy hardening | committed synthetic fixtures | speculative portfolio + structural infeasibility | per policy | active + background reported separately | Rejects invalid fastest speculative branches by completion time and detects linear mandatory infeasibility from graph structure |
| D7 | 2026-06-25 | Hybrid target evidence workflow | existing fixtures plus synthetic hybrid workflows | GLM tier1/tier2 policy matrix | per policy | active + background reported separately | Mixed run preserves observed/synthetic source labels; synthetic eligible workflows pass <=3x active TAT while linear mandatory classes are infeasible |
| D8 | 2026-06-25 | Planned Parallel RPE direction | simulator docs + manual Pi trace reviews | design/evaluation only | n/a | no runtime TAT claim | Generic tier2 DAG and duplicate implementations deferred; next step is prefix-based safe-work-unit evaluation |
| E1 | 2026-06-25 | Safe work unit prefix evaluation | Pi trace prefix + prediction artifact fixture | offline evaluator | safety precision primary | no runtime TAT claim | Reports safe independent, dependent, unsafe, and inconclusive verdicts from prefix context plus suffix evidence |
| E2 | 2026-06-26 | TAT bucket code-shard evaluation | 15 full `pi-mono` traces, 3 per TAT bucket | offline safe-unit evaluator + tier2 wait estimate | safety precision primary | 5-40m tier2 background by DAG depth | 49 code-edit units; long decomposable traces often compress remaining realtime loops to shallow tier2 DAGs |
| P1-fallback-role | 2026-07-10 | Introduced separate Tier 2 fallback model role in the then-current packet v4 | fake-provider execution smoke | Tier 1 control plane + Tier 2 async + independent realtime fallback | synthetic | synthetic | Historical schema evidence; the role persists in packet v5. No live cost/TAT claim. |
| P1-hardened-cutover | 2026-07-14 | Cut planning and execution to plan v2/details v3/packet v5/pointer v2 with event-v1/projection-v2 runtime, exact patch-ledger replay, and typed bounded recovery | complete keyless A1-A20 smoke matrix with fake/stub workers | immutable packet tier policy; public dry-run/live seams | synthetic; no provider-cost claim | synthetic; no live TAT claim | Offline implementation evidence only. The explicitly authorized macOS p-map canary and repository-owner approval remain release gates. |
| P1-normalization-canary | 2026-07-14 | Packet-declared, language-agnostic candidate normalization with details v4/work-contract v2/packet v6 and event-v2/projection-v3 audit evidence | live `p-map` AbortSignal canary, Attempt 14 | Sol control/final review; Terra workers; async Tier 2 disabled | `$1.1384025` estimated | 465.391s | Full DAG completed: 6 attempts, 655,081 tokens, five accepted files (+327/-30), all normalizers exited 0, and final `npm test` passed 56 tests. Post-E2E review fixes are separately validated at 59 tests and are not attributed to the immutable canary tree. |
| P2-profile-v1-controlled | 2026-07-27 | Profile v1, packet v7, vertical fusion, cumulative repair seeds, and current Event v4 evidence | one live canary plus three byte-identical `p-map` repetitions | Sol medium control; Tier 2 disabled; Terra medium fallback workers | completed-run median `$0.624695`, range `$0.547498`–`$0.843834` | completed-run median 306.291s, range 278.563–408.114s | Canary and repetitions 1–2 completed; repetition 3 stopped on bounded worker validation-repair exhaustion. This is diagnostic evidence, not release acceptance or a reliability-rate claim. |
| P2-worker-summary-stop | 2026-07-28 | Reviewed Worker-summary continuity candidate `a06755b` | fresh `p-map` canary profile validation, dry-run, and declined live confirmation | Sol medium control; Tier 2 disabled; Terra medium fallback workers | `$0.000000` live execution | 95.669s to operator decline | Dry-run completed with zero attempts. Live execution stopped before worker launch because confirmation rendered details SHA `f0264cb025eb…` as `Packet`; authoritative packet SHA is `d2a0e3726b78…`. Repetitions were not run and no rate is inferred. |
| P2-worker-summary-controlled | 2026-07-28 | Worker-summary commit `a06755b` plus confirmation fix `3fef090`; exact packet/profile replay | corrected canary plus repetition 1; stopped before repetitions 2–3 | Sol medium control; Tier 2 disabled; Terra medium fallback workers | canary `$0.8393655`; stopped repetition `$1.0167785` | canary 420.728s; stopped repetition 396.535s | Canary completed and proved immediate summary continuity through repair 2 without authoritative-state leakage. Repetition 1 exhausted the test node's fixed repair budget after exposing a production defect outside its write authority. One completed run is insufficient for a median, range, rate, or SLO. |
| P2-execa-focused-stop | 2026-07-30 | Focused node validation and one task-specific packet-final gate | one stopped Execa Web Streams transfer canary | Sol medium control; Tier 2 disabled; Terra medium fallback workers | `$1.030657` | 307.657s | Focused type/docs checks were faster, but the runtime candidate exceeded its write authority and was rejected before validation; no end-to-end optimization claim. |
| P2-execa-recovery-controlled | 2026-07-30 | Bounded clean retry policy for an original unauthorized candidate | one completed Execa Web Streams transfer canary | Sol medium control; Tier 2 disabled; Terra medium fallback workers | `$1.1097045` execution only | 733.668s live execution | The successful path completed, but no original candidate was unauthorized, so the new recovery route was not exercised and no recovery rate is inferred. |
| P2-execa-normal-control | 2026-07-30 | Normal Pi control without Fanout | same Execa task and clean baseline | Sol medium | `$1.891544` | 712.072s prompt-to-final | Control used fewer model tool calls and was cheaper/faster than Fanout end to end; final trees differ and there is no shared hidden suite, so no quality ranking is claimed. |
| P2-execa-worker-validation-stop | 2026-08-04 | Packet-v9 manifest-bound worker validation | one stopped Execa canary prefix compared descriptively with one completed historical run | Sol control/repairs; Terra workers; Tier 2 disabled | `$0.784550` recorded prefix; repair-only `$0.275` | 327.517s recorded prefix | Original runtime/docs candidates self-corrected and were accepted; literal brace syntax made TypeScript validation authority malformed, one exact-no-progress repair stopped before final validation, and no completed performance comparison is claimed. |

## E1 - Safe work unit prefix evaluation

Purpose: evaluate Planned Parallel RPE planner reliability from local trace prefixes before building runtime parallel execution. This is retrospective trace-derived evidence, not runtime TAT evidence.

Command:

```bash
rtk npm run eval:safe-work-units -- \
  datasets/traces/pi-mono-sample \
  --predictions datasets/fixtures/safe-work-unit-predictions.jsonl \
  --out runs/safe-work-unit-eval
```

The evaluator is offline and deterministic. It reads structured prediction artifacts rather than calling GPT-5.5, Doubleword, or any live provider. Reports separate prefix-visible context from suffix retrospective evidence and write `summary.json` plus `summary.md`.

Fixture coverage in `datasets/fixtures/safe-work-unit-predictions.jsonl`:

| Case | Expected verdict | Evidence checked |
| --- | --- | --- |
| independent docs note | `safe_independent` | Declared ownership, validation, review, cancellation, and no overlap. |
| shared package edits | `safe_after_dependency` | Overlapping owned file and mutable resource with explicit dependency. |
| hidden README dependency | `unsafe` | Read-only file appears only in suffix evidence. |
| missing checks/review | `unsafe` | Mutable source work omits validation and tier1 review. |
| wrong active boundary | `unsafe` | Background claim conflicts with next-actionable response requirement. |
| speculative stale work | `unsafe` | Speculative README edit omits cancellation and suffix touches the same file. |
| unknown surface | `inconclusive` | No declared file or mutable resource surface. |

Primary metric is safety precision. The labeled fixture reports safety precision `1`, unsafe false positives `0`, recall `1`, and all four verdict buckets. When labels are absent, recall is reported as unavailable instead of guessed.

## E2 - TAT bucket code-shard evaluation

Purpose: test whether code-edit safe work units can compress longer realtime execution loops into bounded tier2 background DAGs.

Detailed notes: [`docs/benchmarks/tat-bucket-code-shards.md`](benchmarks/tat-bucket-code-shards.md).

Command:

```bash
rtk npm run eval:safe-work-units -- \
  datasets/traces/pi-mono-full \
  --predictions datasets/fixtures/tat-bucket-code-shards-predictions.jsonl \
  --out runs/safe-work-unit-eval/tat-bucket-code-shards
```

Result summary:

| Metric | Value |
| --- | ---: |
| Evaluated prediction rows/traces | 15 |
| Code-edit units | 49 |
| Safe independent | 31 |
| Safe after dependency | 16 |
| Unsafe | 2 |
| Safety precision | 1 |
| Recall | 0.969 |
| Dependency accuracy | 0.941 |

Wait model: use tier2 SLA as the scheduling quantum. Conservative routing uses `tier2_exec_wait_worst_case = accepted_DAG_depth * 10m`; the table reports the prior 5-10m per-depth range for comparison.

| Bucket | Median DAG depth | Typical tier2 wait | Readout |
| --- | ---: | ---: | --- |
| <5m | 2 | 5-20m | Usually worse than realtime. |
| 5-10m | 3 | 5-30m | Mixed; only shallow DAGs are competitive. |
| 10-15m | 2 | 5-20m | Often comparable to remaining realtime. |
| 15-30m | 1 | 5-20m | Best observed fit for compression. |
| 30-45m | 3 | 5-40m | Depends on how late the planning boundary is and DAG depth. |

Conclusion: tier2 Planned Parallel RPE is not a generic realtime accelerator. It is useful when tier1 planning produces an acyclic, conflict-free code DAG and the user accepts bounded background execution. Prefix time is not a hard routing guard: if no execution remains, no job is launched; otherwise route by safety, user wait budget, DAG critical path, and cost.

The 15-trace prediction artifact is tracked at `datasets/fixtures/tat-bucket-code-shards-predictions.jsonl`; it acts as the selected trace manifest because each row includes the target `traceId` and `prefixBoundary`. The full command may load all local `badlogicgames/pi-mono` JSONL traces from `datasets/traces/pi-mono-full` (626 trace files in the downloaded sample), but only the 15 prediction rows are evaluated. The prediction protocol is documented in [`docs/benchmarks/safe-work-unit-eval-protocol.md`](benchmarks/safe-work-unit-eval-protocol.md).

## P3 — Offline profiler fixed-behavior concurrency and Provider Profile scenarios

The profiler's public scenario query calculates observed, sequential, custom positive-safe-integer, and unlimited Fanout-concurrency schedules over admitted Event v5/Projection v6 evidence bound to exact profile identity. Independent Tier 1 and Tier 2 mappings may retain observed calls or apply fixed/cold-warm TTFT, FIFO provider capacity, explicit warmth/reset assumptions, output-token generation speed, and displayed input/output/cache-read/cache-write per-million rates. Missing usage keeps cost Partial or Unavailable. The packet DAG, recorded Attempt and repair chains, tier assignments, Worker Turns, Provider Responses, Tool Invocations, outcomes, validations, patches, and Accepted Ledger order stay fixed. Results expose Fanout/provider capacity and acceptance-gate waits, TTFT, generation, cost, uncovered time, the completion chain, recorded-prefix or dry-run limits, and one Evidence Receipt. They are deterministic workflow experiments under fixed assumptions, not provider forecasts, quality claims, routing recommendations, or measured performance baselines.

Validation:

```bash
rtk bun test packages/fanout-profiler/src/scenario.test.ts
rtk npm run check
```

The focused table covers observed-boundary reproduction and rejection, sequential/custom/unlimited Fanout capacity, deterministic allocation and provider FIFO ties, dependency and repair preservation, ledger-order acceptance, fixed and cold/warm timing, reset controls, cache-aware cost evidence, incomplete prefixes, and dry runs. No benchmark dataset, fixed price input, routing policy, cost baseline, or measured latency result changed in this slice.

## P4 — Offline profiler representative local performance

Run separately from normal validation:

```bash
rtk npm run benchmark:profiler
```

The generated temporary storage root contains exactly 50 project directories. Three are admitted projects: one contains 100 Workflow Lineages, 500 Execution Runs, 100,000 Event Log rows, and one 134,217,728-byte (128 MiB) supporting log, while two contain lightweight execution evidence. The other 47 directories contain runtime context only and must not enter the project registry. Two completed current runs contribute 400 fully admitted Event v5 rows bound to one exact profile and support the workspace, exact same-packet comparison, and observed-scenario measurements. The other 498 runs contribute 99,600 recognized Event v2 envelope rows, exercising Legacy discovery without pretending old evidence is current or replayable. The supporting log contains 1,048,576 complete 128-byte JSONL rows. Catalog load accounting must report zero supporting-evidence content bytes before the benchmark requests the capped first 500 rows, and the immutable snapshot must not contain the row payload.

Local targets from issue #46 are under 5,000 ms for initial storage-root discovery/catalog load or refresh, under 250 ms for workspace/comparison/scenario queries, and under 500 ms for a capped evidence page. The Event v5/Projection v6 compatibility run on 2026-07-30 used Bun 1.3.14 on macOS arm64 with an Apple M1 Pro:

| Measurement | Result | Target |
| --- | ---: | ---: |
| Fixture generation (reported separately) | 209.68 ms | n/a |
| Initial storage-root discovery and catalog | 1,749.16 ms | <5,000 ms |
| Storage-root rescan and selected-project refresh | 1,699.17 ms | <5,000 ms |
| Workspace query | 6.38 ms | <250 ms |
| Exact comparison query | 7.82 ms | <250 ms |
| Observed scenario query | 7.18 ms | <250 ms |
| 500-row evidence page | 0.76 ms | <500 ms |

These are one local wall-clock observation, not a CI guarantee, provider benchmark, or claim that 99,600 Legacy rows cost the same as replaying 99,600 current events. The benchmark contains no timing assertions. Normal checks instead prove structurally that a 128 MiB supporting log is represented only by metadata until selected, is not retained in the immutable snapshot, and cannot return more than 500 rows per page.

## Hardened execution baseline

1. **Measure the admitted packet-v9 scheduler policy**
   - Execution authority is the exact profile-v1/packet-v9/work-contract-v4 tuple with typed resources, derived dependencies, direct-argv validation, immutable runtime policy, fixed attempt budgets, and causal events.
   - Report worker `fanout_validate` evidence separately from controller validation; compare repair-attempt count, wall time, tokens, and cost against a controller-only historical cohort without treating advisory passes as acceptance.
   - Future routing experiments must preserve that authority and compare measured critical-path time, accepted metrics, and cost without adding prose stop-rule or budget fields.

2. **Improve tier1 workflow efficiency**
   - Better batching, complete root-cause inspection, fewer redundant checks, and less tool-output bloat.
   - Measure this as `semantic-batching-tier1`, not as Doubleword savings.

3. **Evaluate the implemented background execution path**
   - Tier 1 planning publishes the accepted packet; eligible Tier 2 nodes execute under packet-owned concurrency and fixed budgets.
   - Controller-owned validation, exact accepted transitions, and fresh final reconstruction remain acceptance authority.

4. **Measure sharded RPE concurrency only after scheduler policy exists**
   - Estimate N independent RPE execute jobs launched together.
   - Report active planning time, background completion time, total cost, failures, late outputs, canceled speculative work, reviewer time, and file conflicts.

5. **Keep generic DAG tier2 routing deferred**
   - Manual semantic review found only ~1.5% tier2 savings in normal interactive traces.
   - Do not route critical edit/tool loops to tier2.
   - Do not use duplicate implementations unless the scheduler proves independent ownership and bounded waste.

## Reproduction notes

External traces are intentionally ignored under `datasets/traces/`; keep committed fixtures under `datasets/fixtures/`.

Fetch a trace manually if needed:

```bash
rtk mkdir -p datasets/traces/pi-mono-sample
rtk curl -L --fail \
  https://huggingface.co/datasets/badlogicgames/pi-mono/resolve/main/<trace-file>.jsonl \
  -o datasets/traces/pi-mono-sample/<trace-file>.jsonl
```

Validation command:

```bash
rtk npm run smoke:benchmarks
```
