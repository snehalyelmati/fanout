# Coding agents on high-latency, low-cost inference

Status: active engineering study, 2026-09-07. This protocol carries the direction transferred from the side conversation into the main task. Existing implementation and historical evidence remain intact. A presentation is deferred until useful results exist.

## Objective and decision labels

Develop and evaluate orchestration that achieves correct coding-task completion at lower full end-to-end user cost and similar or lower time than ordinary realtime Pi, while preserving the provider's economic advantage. Investigate both orchestration for today's service and complementary provider improvements; Fanout need not win on every task. Identify where it helps, where it does not, and why.

Labels used throughout:

- **Agreed direction**: work the user wants pursued; an experimental sequence, not a claim that it will work.
- **Measured**: actual recorded execution, outcome and resource evidence.
- **Hypothesis**: a proposed mechanism or architecture requiring validation.
- **Open question**: an unresolved fact or tradeoff.
- **Deferred**: excluded from the immediate work, with its reason stated.

**Agreed direction:** improve execution and obtain useful data first. Keep engineering docs and evidence current now. Prefer the normal Pi loop and prompt changes before a custom workflow. Ordinary Pi is the baseline; the user's label “RPE” is retained without assuming an expansion. Pi-with-subagents comparisons are deferred because Fanout has not yet beaten ordinary Pi and those workflows also incur context and integration costs.

**Current service condition, explicitly confirmed by the user:** every request pays the high latency. An initial wait followed by immediate followups is a proposed provider improvement, not a description of current behavior. Distinguish time to first streamed output from time until a non-streamed response becomes available.

## First-principles decision rule

The unit to optimize is a **correctly completed task**, and the scarce resource is **sequential slow requests on its critical path**. More workers are useful only when they shorten that path enough to repay planning, duplicate context, integration and repair. A narrow task can favor one whole-task candidate with no model planner.

For a fixed observed execution, write `T = H + sum(request durations on the critical path)`. `H` contains the remaining non-overlapping preparation, tools, integration, validation and cleanup. A request duration includes its admission wait and generation/completion availability; do not add TTFT to a duration that already includes it. Parallel branches contribute their longest dependent path, whereas **all** branches contribute token cost. Include Sol planning and repairs on the relevant path and in cost.

Under the explicit hypothetical assumption of 60 seconds per slow request, p-map's 299.5145-second raw reference permits at most four sequential slow requests even with zero other work. Five waits alone exceed the reference. Real preparation, generation, checks and repair shrink this budget further. This is a feasibility screen, not a claim that Doubleword has a fixed 60-second minimum. Its nonstreamed completion-availability latency must be measured separately.

Cost must satisfy `C_cheap + C_planning + C_integration + C_repairs < C_raw`; cheap token prices alone do not imply cheap completion. For a one-candidate workflow, expected cost is `C_candidate + failure_probability * E[C_recovery | failure] + other_costs`. The corresponding latency tail matters as much as its average: fallback after wasted work can exceed raw Pi, and a two-trial mean cannot establish a reliable operating range.

The minimal candidate architecture to test is existing-source preparation, one slow complete implementation submission, local required checks, and bounded fast recovery. The cheap model must solve the task. Prompt-only native tool batching has already been tried; normal continuation tests whether additional cheap responses displace enough expensive repair. If continuation produces many serial slow requests, a realtime cost win does not justify that workflow for today's per-request high-latency service. The next decision uses the strongest existing complete-edit-batch configuration in actual async service and a fixed-configuration transfer on one different fast task. Further p-map prompt variants, submission tools and harness refinement are deferred unless a concrete validity defect prevents that decision.

Provider fast-continuation windows are a separate hypothesis. Prioritize a bounded dependent followup after local tools without reserving an idle GPU, and measure utilization, queue displacement, cache residency and fairness. No user-price discount proves provider cost savings; actual provider economics require internal telemetry or collaboration. Keep these scenarios separate from today's measured service.

## Starting evidence and completed work

Combined planning, exact prepared worker sources, early ownership checks and compact repair prompts are implemented. Preserve commits `a7b5ef6`, `b6a6fab`, `6d10a08` and `023b5ba`; do not redo them. The [p-map pilot](p-map-efficiency-pilot.md) and its immutable local receipts remain the detailed source.

| Observation | Fanout E2E / estimated cost | Raw Pi E2E / estimated cost | Semantic audit |
| --- | --- | --- | --- |
| Initial improved pair | 393.781s / $0.5128764 | 307.421s / $0.627699 | Both pass recorded checks |
| Reverse-order repeat | 369.965s / $0.5307096 | 255.175s / $0.514409 | Both fail pending-source-value abort |

**Measured:** Fanout's longest worker branch used 13 and 17 sequential responses. Planning/raw Pi used Sol medium; all ordinary Fanout workers immediately used Terra medium via disabled-async Tier 2 fallback. Native allocations call this realtime assignment `tier1`; that does not mean Sol workers or a failed-Sol reactive fallback. Costs are reported token-price estimates, not subscription cash billing.

The failed 255.175s run is resource-use evidence, not a correct-completion target. A green generated suite did not imply semantic acceptance. Neither observed cost savings nor near-baseline E2E are reliable conclusions from these samples. Historical post-run audits were outside measured E2E; the strengthened protocol below changes that boundary explicitly, without rewriting old numbers.

## Five layers of explanation

| Layer | Questions and dimensions |
| --- | --- |
| User | Was the task completed correctly? Total time, total cost, predictability and usability? |
| Task | Reasoning difficulty, work volume, dependency depth, available width and coupling? |
| Harness / orchestrator | Planning, source preparation, scheduling, tools, integration and recovery overhead? |
| Model | Capability, required tokens and requests, mistakes, and repair demand? |
| Provider | Admission/queue delay, inference/generation speed, caching, batching, continuation scheduling and prices? |

Long work is not necessarily parallelizable. Reasoning difficulty is separate from the quantity of edits. Record task-level opportunities and the actual generated execution graph separately; do not force a wide DAG to satisfy the study's premise.

## Two tracks, one evaluation

**Orchestrator track:** reduce serial remote requests, repeated context and control overhead under today's per-request latency while maintaining complete authority and acceptance. Tier 1 may identify scope and relevant context; local code collects existing source bytes. The cheap worker must reason about and implement the change. If Tier 1 already generates the actual implementation, a cheap worker that merely applies files does not establish the intended benefit.

**Provider track:** investigate bounded fast continuation sessions, context reuse and economical scheduling/batching. The grouping proposal concerns dependent requests in one coding session, including gaps for local tools; it is not merely co-arriving independent requests. Fast continuation service might make the ordinary iterative Pi loop preferable to aggressive one-response work. The two tracks may complement or substitute for each other.

## Workflow comparison matrix

| ID | Configuration | Async coverage to record |
| --- | --- | --- |
| 1 | Ordinary Pi / RPE, realtime | No async model calls |
| 2 | Ordinary Pi / RPE, async | Ordinarily every model request; disclose exceptions |
| 3 | Fanout Pi / RPE, realtime workers | Realtime planning, workers and repairs; record each actual assignment |
| 4 | Fanout Pi / RPE, async workers | Declare exactly which workers are async and which planning/repair calls remain realtime |

| Comparison | Question |
| --- | --- |
| 1 vs 2 | What latency/cost tradeoff does async introduce into ordinary Pi? |
| 1 vs 3 | What is Fanout's net effect under realtime service? |
| 1 vs 4 | Can the complete Fanout-plus-async configuration benefit the user? |
| 2 vs 4 | Does Fanout make async useful near realtime completion times? |
| 3 vs 4 | What async economics remain on top of Fanout? |

**Attribution rule:** product-configuration comparisons answer user-facing questions; controlled experiments isolate a particular mechanism. If configuration 4 keeps fast planning while configuration 2 sends every request through async, their comparison changes both orchestration and planning service. If model assignments differ, it also changes capability and pricing. Do not label either a pure orchestration effect. Keep models, task, acceptance, budgets and other settings constant for each small mechanism experiment.

## Immediate experiment sequence

1. **Version independent acceptance.** Promote the known promised-source-value abort case alongside existing p-map semantics and path scope. Preserve old checkers, results and identities. Make the complete semantic checker, repository suite and scope checks required for both workflows. Check known good and bad candidates offline before paying for more work.
2. **Establish correct-completion baselines.** Run a small predeclared set of ordinary-Pi trials under the strengthened checks and fixed recovery limits. Retain every failed trial and all incurred resources. A failed trial cannot be replaced silently by another until the table looks green. After a small calibration cohort, freeze its arithmetic mean as the raw-Pi reference and reuse it across Fanout iterations; do not rerun an unchanged raw arm every time. Preserve individual observations, failures and sample count. Recalibrate when the task, model, environment or measurement protocol materially changes. The current comparable v2 reference uses two trials (299.5145s / $0.622678); historical trials with different acceptance/E2E boundaries are not pooled.
3. **Test the smallest prompt change.** Require complete implementation and behavioral tests before the first advisory validation, with independent edits batched where possible. Compare the existing and changed normal worker prompt on the same protocol and models. Traces show premature validation and incremental edits; this is a falsifiable hypothesis, not a guarantee of fewer requests.
4. **Consider bounded candidate submission only if needed.** A possible experiment asks the cheap worker to submit implementation, tests and summary together, followed by local application/validation and fast repair under existing budgets. Investigate one or two cheap requests on the critical path. Measure missing context, larger outputs, malformed submissions and repair cost. It is an option, not a selected permanent architecture or a file-write optimization.
5. **Replay before expanding live runs.** Reject obviously uncompetitive request graphs under 1/5/10-minute waits and plausible price ranges. Select promising configurations for actual high-TTFT provider measurements against ordinary realtime Pi. Codex realtime measurements and timing simulations cannot establish async viability.
6. **Repeat promising configurations across task shapes.** Expand after correctness and a plausible cost/time margin exist. Report distributions and failures with sample counts. More unchanged canaries without a specific uncertainty to resolve, broad model sweeps, and polished presentation work are deferred.

For each experiment freeze the question, independent variable, source/task/checker hashes, configuration, run order, repetition count, timeouts, recovery allowances and stop rule before launch. Identify exploratory tuning versus subsequent verification. Use fresh task baselines; retain failed/cancelled prefixes. Any configuration change gets a new protocol/run identity rather than editing previous evidence.

Record SDK and worker CLI versions separately. On 2026-09-07 the installed project Pi SDK is 0.83.0 while the global `pi` executable reports 0.84.4. The new raw driver explicitly pins its SDK version. Earlier environment notes recorded a single `pi` version, so they cannot alone prove every role used identical library versions. Future Fanout runs must pin the actual worker executable/version and disclose any SDK/CLI difference alongside model differences.

The initial controlled model settings stay Sol medium for planning/raw Pi and Terra medium for realtime worker fallback. A later real-async trial must declare its exact provider, model, endpoint/service, reasoning settings and current prices. Frontier, open-weight and smaller models in either tier are later dimensions; capability, request count and repair demand must be measured, not transferred from another model's trace.

Pilot timeout limitation: SDK `session.abort()` does not cancel an already executing Fanout extension command; workers use separate process groups. The prepared prompt comparison therefore treats 20 minutes as an advisory failure threshold and retains native worker/command timeouts and fixed recovery limits. It awaits cleanup, includes overtime in E2E, retains all incurred resources and stops the cohort after such a failure. This differs from the raw driver watchdog; no hard native-execution cancellation or new cancellation architecture is claimed.

Implementation checkpoint: `scripts/benchmarks/p-map-acceptance-v2.mjs [targetCwd]` implements `p-map-iterable-abort-acceptance` v2; target defaults to the current directory. It retains the original semantic coverage, adds the promised-value regression and pins scope to task baseline `c3c261e2189f94d1a09724e8f03d5345af518017`. The offline historical-candidate matrix, raw baseline and completed prompt-canary pair are indexed in `docs/BENCHMARKS.md`. The changed prompt was not adopted. The complete-edit-batch cohort is also complete: its whole-task arm passed all gates in 158.180s/`$0.3086735`; the modified Fanout arm's candidate passed native gates after a nine-response Sol validation repair, but the primary harness outcome is error because the reporting check read a nonexistent thinking field. A separate audit confirms the intended medium model assignments from native evidence; exact worker argv was not persisted. A prompt-activation audit found that the canonical batch branch was inactive, leaving normal validation/final-response text alongside the active extension's batch instruction and termination; the assembled provider system prompt was not persisted. Preserve the frozen result without replacement and do not credit the inactive source prompt. This remains benchmark-only and adds no product capability or schema. The full repository suite remains a separate required gate; the checker does not replace it.

## Small varied task set

**Agreed direction:** retain p-map and select roughly three additional fast tasks. Selection remains open; the rows below are coverage criteria, not selected repositories or mandatory separate tasks. A task can cover more than one row.

| Shape | What it exposes |
| --- | --- |
| Small mostly serial parser/validation bug | Fixed orchestration overhead and when to avoid Fanout |
| Async behavioral change, initially p-map | Ordering, cancellation, cleanup and correctness across await boundaries |
| Coupled runtime/API/types/caller change | Genuine dependencies, shared contracts and integration costs |
| Several independent adapter/formatter changes | Useful work width without artificial decomposition |
| Investigation-heavy state/transformation bug | Reasoning difficulty and limits of preparation |

Prefer deterministic acceptance and minimal setup. A meaningful full-validation time around 15–30 seconds or less on the pinned environment is a selection target, not a measured guarantee. Measure fresh setup separately and required in-run preparation inside the run. Pin repository revision, lockfile, environment and task specification. Establish a red-capable independent check before model comparison; do not weaken tests or shorten timeouts to manufacture speed.

Keep Execa as an occasional stress task. Inspection of the local fixture found AVA `concurrency: 1`, `workerThreads: false` and a `240s` timeout; the [recorded successful full suites](execa-web-streams-manual-e2e.md) took 252.3s and 295.261–300.326s. This supports using a faster inner-loop task, but a configured timeout alone does not explain successful-run duration. The suite includes async/subprocess work; precise attribution still requires command/test timings rather than assuming the run waited for a timeout.

A preliminary read-only shortlist found historical pi-mono session-query parsing, coupled `navigateTree` API/caller changes and terminal-width/state fixes. Issue 764's exact 56-column reproduction is externally verified at base `c5cf74e032ec31b926c5acc5e21b017cf434f63e` and one-commit reference `588399594c36cf4ee5bb04d4ab9e8220adc66b5f`, now under `earendil-works/pi`. The reference truncates only the header hint; it does not establish the issue title's broader all-width invariant. A frozen evaluator can cover populated, current-folder-empty and all-sessions-empty rendering at 56 columns, but must be preflighted red/green with repository checks before selection. These candidates share a repository and public solution traces, creating correlation and contamination risks, and do not supply an independent multi-adapter task.

## Acceptance and full E2E accounting

Independent means defined and maintained outside the candidate implementation, not necessarily secret from an agent. Freeze checker bytes and treat their outputs as diagnostics, never new write authority. Expose the same required criteria and available commands to compared workflows. Keep evaluation files outside candidate-owned paths and verify their identities before and after each run.

Success requires the declared semantic checks, full repository validation and authorized-path checks on the final candidate. Generated tests supplement these checks. Record acceptance version, case outcomes, candidate tree/patch identity and any checker limitation. A check suite is bounded evidence rather than proof of every edge case. The current checker assumes non-adversarial task implementations: candidate JavaScript runs in its evaluator process and could deliberately forge results or monkeypatch assertions. Process supervision bounds hangs and cleans up descendants; it is not a security sandbox against malicious candidate code. Stronger adversarial execution isolation is outside this pilot, and observed tampering invalidates a trial.

The strengthened E2E clock starts before the first task model request (before Fanout planning) and ends after required acceptance, integration/final checks and controller cleanup. Include rejected work and every repair. If an independent check triggers correction, the original clock continues through the correction and revalidation. Freeze and record raw-Pi correction limits and Fanout's existing budget semantics; do not imply different recovery mechanics are identical. Exhaustion produces a failed run, not a new budget.

Common preprovisioning may be excluded only when identical and explicitly reported for all modes. Required in-run profile preparation remains included. Record human waits separately without hiding other orchestration gaps; report both gross wall time and any explicitly derived human-wait-adjusted value. Additional post-run research audits may be outside E2E, but their discoveries still affect task outcome and must be disclosed. Never silently compare the old post-hoc-audit boundary with a new required-acceptance boundary.

| Metric group | Required record |
| --- | --- |
| Outcome | Independent acceptance/version, failure stage, budget exhaustion, cancellation, incomplete work |
| User time | Full E2E, human waits, excluded setup/audits with reasons |
| Cost | All-run resources including failures; estimated token cost, billed cost and provider economics separately |
| Work graph | Total model requests, critical-path request depth, actual dependencies and available concurrency |
| Tokens | Input, output, cache read/write and missing usage evidence per actual model assignment |
| Timing | Planning, preparation, observable queue/first-output/generation, tools, validation, integration, repair and cleanup |
| Provenance | Task/source/checker/profile/config identities, model/provider/reasoning, environment, event logs and final candidate |

Only report timing components actually observable. A client-side request-to-first-output interval may include queueing, inference and transport; do not claim it isolates queue time. Polling cadence affects observed completion availability. Missing telemetry is unavailable, not zero. Reuse native identity verification and event replay where valid; record catalog/measurement limitations instead of changing admission merely to obtain a chart.

## Simulation, continuation and caching rules

Keep three evidence classes visible in every derived result:

| Class | What it can establish |
| --- | --- |
| Measured | Observed quality, requests, tokens, time, costs and work graph for that run |
| Trace-based counterfactual | Alternative timing/pricing applied to the same observed work, graph and outcome |
| Hypothetical provider design | Consequences under an explicitly assumed unimplemented scheduling/cache/session policy |

Replay a few immutable real traces; copies of a trace are not independent observations. Where evidence supports it, sweep per-request latency at 1/5/10 minutes; an initial wait followed by N fast continuations; concurrency, queue delay, prices and cache assumptions. Preserve dependencies, fixed recovery work and outcomes. Report break-even regions and sensitivities with all assumptions and omitted costs visible.

Simulation cannot determine another model's success, mistakes, repairs, tokens, decomposition or request count, nor how a changed interactive workflow would adapt. Those need live measurements. A failed trace remains failed when its timestamps or token prices change. A request-depth floor is an optimistic bound, not a provider performance forecast.

For cache estimates, derive eligible repeated prefixes from captured requests and documented vendor semantics. Eligibility does not establish a cache hit. Account for minimum-prefix requirements where documented, retention, eviction, routing and scheduling uncertainty; use ranges. Do not assert vendor-specific cache behavior without primary evidence. Context reuse may save inference work or user cost; it does not by itself remove queue latency.

For the completed prompt pair, the local derivation `runs/p-map-prompt-v2-20260907-r2/interval-counterfactual.json` zeroes only observed critical-runtime `turn_start`→first `message_update` intervals and yields 319.553767s and 376.596189s. Setting the first runtime response to 60 seconds and the rest to zero yields 379.553767s and 436.596189s, versus the frozen 299.5145s raw mean. This holds the observed outcome and other work fixed. The interval is a local client observation, not pure queue time or provider TTFT; about 154.7s/212.1s of runtime remains critical even after it is removed. Native reconciliation/final-validation/pre-execution spans are recorded separately in the benchmark index. Tool durations overlap other spans and are not subtractable components. Do not bypass current shared-worktree safety invariants from this accounting; test any no-audit/no-Fanout profile separately later.

For the whole-task batch trial, `runs/p-map-single-batch-v1-20260907/analysis/whole-01-analysis.json` replaces only the measured 5.359s initial Terra start-to-first-local-update interval with 60s. The resulting 212.821s holds the observed continuation, five realtime Sol responses, repairs, gates, cleanup, outcome and `$0.3086735` cost fixed. It is not evidence for async latency or unchanged quality under another service.

The two subsequent predeclared whole-task repeats passed at 190.539s/$0.346216 and 171.873s/$0.314870, with mean 181.206s/$0.330543. All three whole-task observations, including the exploratory first trial, used both correction prompts. Keep the exploratory-inclusive mean separate and reuse the existing raw reference. Their initial Terra local first-update intervals replaced with 60s yield 246.594s and 228.321s; observed work, realtime Sol repairs, outcome and cost remain fixed. See the benchmark index for full provenance and model/workflow differences.

The offline replay motivated a completed two-trial supplemental-diagnostics experiment, preserving authoritative npm/diff/acceptance gates, candidate integrity and the two-correction budget. Both passed, averaging 326.352s/$0.5050845; the second used one correction prompt but eight Sol responses. Both initial Terra submissions changed only runtime code, leaving Sol to supply required types/tests/docs. Complete diagnostic visibility did not establish a speed benefit. That result motivated the separate public signal typing and task-mapped artifact completion gate, whose v3 was included in the subsequently completed native-continuation cohort. Artifact quality remains a manual review responsibility. Keep acceptance-v2 and the completed cohorts unchanged. The benchmark index discloses the mixed offline setup archive and preserves separate live evidence. The standalone Doubleword async adapter also passed a fake-transport smoke through the real SDK and native batch tools; actual provider quality, availability and cost remain unmeasured. The qs strict-merge task passed independent red/green preflight and its separately timed successful native/acceptance gates sum to 6.64s. Freeze its resolved lock for future cohorts and retain the known-public-task contamination caveat; the raw cohort below followed that preflight.

The separate completion prototype v2 has now passed its offline matrix: three expected failures (base, runtime-only initial candidate and a widened-signal declaration), seven accepted historical finals, unchanged identities, no model calls. It closes the v1 probe's acceptance of `AbortSignal | string`; v1 evidence remains preserved. It uses pinned public-type compilation and relevant added test/type-test/documentation text, whose quality still needs review. These are post-run audits, not retroactively included E2E. The subsequent completion-v3 revision was bound and timed in the now-completed native-continuation cohort.

The qs raw calibration has now run: 265.166s/$0.754926/18 responses and 389.699s/$1.164612/28 responses, both final harness successes and manual completion passes. The second initial candidate was already complete, but the added-lines-only artifact gate missed an unchanged `plainObjects` call surrounding an updated expectation. Its needless correction used six Sol responses/$0.276208. Preserve the descriptive 327.4325s/$0.959769 resource-use mean without adopting it as a fair control. Correct the gate in a new revision; do not replace the measured trial or subtract its incurred work. The benchmark index records setup failures, exact provenance and limitations.

The p-map native-continuation pair is complete: both final candidates passed, averaging 355.666s/$0.60843225 versus the frozen raw 299.5145s/$0.622678. Terra used 8/13 responses and both initial candidates still failed promised-source-value abort semantics. Reject the configuration for today's per-request high-latency target; a marginal realtime cost saving cannot offset that request depth. Completion-v3 and all required gates were timed within the task boundary, with preparation/initialization separately reported. The [benchmark decision](../BENCHMARKS.md#native-pi-continuation-decision--2026-09-07) retains traces, quality reviews, identities and distinct timing scenarios. Stop further p-map variants; next use the strongest existing complete-edit-batch configuration in actual async service and one fixed qs transfer, without treating the biased qs pair mean as a control.

## Provider hypotheses and economic constraints

| Hypothesis | Potential benefit | Required evidence / risk |
| --- | --- | --- |
| Bounded interactive continuation window | Pay initial admission delay, then prioritize dependent followups while tools execute locally | N-request or time limit, idle expiry, renewal, fairness and actual followup latency |
| Shared or renewable capacity instead of a dedicated idle reservation | Preserve responsiveness without reserving a device throughout tool work | Utilization, admission pressure, tail latency and preemption effects |
| Shared-prefix reuse across related workers | Reduce repeated context computation | Actual compatible prefixes, cache placement/hits/eviction and resulting token/compute savings |
| Economical batching of independent requests | Improve throughput and cost | Batch formation delay, task deadlines, workload mix and provider utilization |

Evaluate user and provider objectives separately. Prioritizing continuations may displace other queued work; idle reservations can undermine the cheap-service economics. Fast continuation windows, shared capacity and batching policies are hypotheses, not promises. Actual cost/utilization conclusions need internal provider telemetry or collaboration; without it, state assumptions and limits. No provider outreach is authorized by this research protocol.

Doubleword currently lists GLM-5.3-Flash async prices of `$0.11` input, `$0.02` cached input and `$0.38` output per million tokens, versus realtime `$0.15`, `$0.03` and `$0.50`. Its documentation says Responses prompt caching is unsupported and describes async as individual-request inference targeting under one minute with burst-load exceptions. The current adapter polls until completion availability, so its async interval is not streamed TTFT. Sources: [model pricing](https://docs.doubleword.ai/inference-api/models/zai-org-glm-5-3-flash), [prompt caching](https://docs.doubleword.ai/inference-api/prompt-caching), [async inference](https://docs.doubleword.ai/inference-api/async-inference).

## Open questions and stopping criteria

- Which tasks have enough useful width to repay planning and integration, and can a cheap decision identify them?
- How much request depth can prompt changes remove while preserving complete implementation and tests?
- When does a larger candidate response cost more in generation or repair than the round trips it removes?
- Can sufficiently broad independent acceptance remain fast, and which semantic gaps remain?
- What do real async availability and tail latency look like under the selected provider/model and load?
- Can continuation priority preserve provider utilization, fairness and a real price advantage?
- Which cache benefits are observable rather than merely eligible?
- When do measured model quality and repairs dominate orchestration or service changes?

Reject a configuration when correctness fails within its frozen budget or its optimistic latency/cost bound is already uncompetitive. Continue promising configurations only to resolve named uncertainties. Do not redefine success around fast failed runs or increase budgets after observing failure. Evidence that ordinary Pi is preferable in a region is a valid study result.

## Deliverables and deferred work

Maintain this protocol, [benchmark index](../BENCHMARKS.md), [roadmap](../ROADMAP.md), [adopted decisions](../DESIGN_DECISIONS.md) and [progress tracker](../impl/fanout-efficiency-progress.md). Keep one focused study protocol rather than spreading the framework across multiple overlapping plans. Detailed run reports and ignored immutable evidence remain separate supporting material.

After useful measurements, a likely presentation is an interactive website showing cost/time plots, failed outcomes, timelines, TTFT/continuation/concurrency/pricing controls and break-even regions with evidence labels. Slides can be derived afterward. This is deferred presentation direction, not current implementation scope. Broad model sweeps, Pi-with-subagents baselines, speculative routing/indexes and provider-specific architecture commitments remain deferred until evidence justifies them.
