# Design Decisions

## Decode encoded planning objects before Pi validation — 2026-09-28

The Fanout submission tool uses Pi's `prepareArguments` hook to strictly JSON-decode a string-valued `artifact` once before argument validation. Keep the advertised object schema, core artifact contracts, compiler admission, and correction budget unchanged. Apply the same hook to profile, initial combined plan, and correction submissions. Preserve the original tool call and reject malformed JSON with explicit resubmission feedback; do not infer missing structure or recursively decode nested values. Doubleword provider serialization remains independent of Fanout.

The stopped Kimi canary contained malformed encoded artifacts, so decoding alone cannot admit those captured calls. Offline CLI and SDK regressions cover valid encoded submissions, malformed-input recovery, strict schema rejection, and correction-budget enforcement; no live model-quality or performance claim follows from those checks.

## Make planning recovery and validation ownership explicit — 2026-09-27

The dynamic correction schema names the exact retained draft revision. Corrections submit that current base revision, not the next revision; only a successful atomic whole-record merge advances it. Feedback states the correction object shape and current revision. Stale submissions still fail, invalid calls still consume the existing two-correction budget, and inventories remain fixed.

Describe `forbiddenWrites` at its schema field and in planning guidance as packet-global bans, never another worker's ownership list. Existing write authority and controller changed-path checks already enforce ownership; planners must not duplicate those gates with generated Git status/path parsers. Task-specific validation remains required.

## Require Pi 0.87 and resolve transcript context at the Doubleword boundary — 2026-09-24

Pi 0.86 changed custom provider inputs from `Context` to `TranscriptContext`: system instructions and tool declarations now live in system messages, not top-level fields. Fanout and Doubleword now require Pi 0.87.0; source development pins its SDK and CLI packages to that version. Doubleword uses direct imports of Pi's `getCurrentSystemPrompt` and `getCurrentTools` in realtime/async serialization and usage paths. The development stub uses the same contract. Replay honors section replacement/deletion and tool removal/redefinition without mutating the transcript or double-counting system text. Remove the interim namespace lookup, legacy-context adapter and feature detection rather than maintaining two contracts. Do not duplicate Pi's replay algorithm or move provider logic into Fanout core. The standalone provider release is 0.2.0 because the minimum Pi version is a breaking compatibility change.

Pi 0.87's `context` hook excludes system messages. Planning phase offsets and compaction overlap comparisons must therefore use the non-system projection too; raw session indices can admit an old whole-branch summary into an explicit-objective phase. Keep the existing context hook and align its index domain rather than handling system messages in Fanout. The existing compaction-isolation regression caught this migration defect and passes with aligned indices.

The offline regression runs the actual CLI through `/fanout-plan`, captures loopback HTTP metadata (prompt presence, byte length, SHA-256, user-message lengths/hashes, tool names, model), and requires a real task read plus accepted synthetic submission. Unit coverage also checks transcript deltas. It logs no prompt or credential contents and deletes its disposable fixture. Run `npm run smoke:planning-request` for the pinned local Pi, or set `FANOUT_TEST_PI=/absolute/path/to/pi` to select another supported runtime explicitly. The initial compatibility fix was verified on Pi 0.83.0 and 0.87.0 before the owner chose the 0.87.0 minimum; older Pi versions are no longer supported. No gateway call or model-quality assertion follows from mock success.

## Collect only explicitly independent advisory validation failures — 2026-09-23

Planning prefers `collect-independent` whenever independence is established, rather than merely permitting it as an exceptional opt-in. The planner makes this explicit choice without a user toggle. Dependent or uncertain lists remain fail-fast, including omitted policy fields. This changes prompt/schema guidance only: persisted artifact meaning, compiler merge/fusion rules and controller gates are unchanged; no generation bump is needed.

Details v8 and Work Contract v6 carry `advisoryValidationMode: fail-fast | collect-independent`. Planning bodies default omission to fail-fast before persistence; persisted authority requires an explicit valid value. Opt-in means every ordered check examines the same candidate independently of prior success, consumes no other check's generated outputs, and is not a mutating prerequisite chain. No executable, script-name or path heuristic grants this authority. Multi-input ownership merges and every vertical fusion reset to fail-fast without changing grouping, fusion eligibility, command selection, order or multiplicity. Ordinary retries and validation repairs retain their original contract; final-validation and derived final-repair contracts are fail-fast.

Packet v11 records the controller's existing `compilationPolicy.sequentialReadFallback` boolean so exact provenance can be reconstructed without guessing. The model gains no new planning knob. Active admission verifies contained plan/details/profile bytes and identities, recompiles with the recorded decision, and compares the ordered node IDs/kinds, validation commands and advisory modes. This comparison does not extend to unrelated contract fields. Missing, legacy and mixed execution authority requires replanning; no migration is added. The digest-bound worker manifest becomes v3. Profile, plan, pointer, Attempt Outcome, Event, Projection, worker-validation evidence and final-validation evidence versions remain unchanged: their interpretation and authoritative routing do not change.

Only the worker's lone zero-argument `fanout_validate` enables the runner's existing sequential continuation after ordinary nonzero exits. Abort, timeout, signal, spawn, preflight and evidence-publication faults remain failures; no command reruns, parallelism, normalization, extra retries or routing changes are introduced. All positional statuses remain visible and failures share one 8,000-character diagnostic budget with head/tail truncation; stored command/results/timing evidence remains complete. Workers may fix independent known causes together before revalidating, but green checks never replace completing required code/tests. Diagnostics remain untrusted. Controller node, reconciliation and fresh final gates retain fail-fast execution and the strict final-evidence parser.

This is an interface and advisory-feedback mechanism, not a demonstrated performance improvement or a planning optimization. Keyless tests exercise real processes and the normal Pi tool boundary. No paid canary or causal savings claim accompanies this change.

## Bounded efficiency and supporting diagnostics — 2026-09-20

`runDag` requires both the packet and graph returned by validation; it no longer derives the same graph a second time. Profile preflight resolves each manifest position independently once within that invocation, then expands node-major positional evidence and failures. Text-identical entries remain distinct. No cross-invocation cache, caller graph, validation bypass, or change to packet-node resolution, validation-runner whole-list preflight, or immediate pre-launch resolution is introduced.

Small `fanout.controller-diagnostic` v1 supporting JSON artifacts use monotonic elapsed time. They are best-effort and no-clobber, never acceptance authority and never allowed to replace a causal error or release an ambiguous-apply lock. Run identity plus scope paths identify attempts, final rounds, and reconciliation trials. Early admission rejection still writes no run artifacts. Admission and post-qualification preflight are separate measurements; qualification includes reconstruction and cleanup. Reconstruction includes replay, while replay counts attempted and completed transitions separately. Setup wall time contains preparation/readiness wall times, each containing its command sum; null means a phase never ran, not a zero-duration success. Do not add nested measures to their parents.

Each reconciliation result remains immutable, including a successful trial discarded because another worker advanced the accepted ledger. A separate executor decision references the exact trial and records `used`, `rejected`, `discarded-on-ledger-advance`, or `discarded-on-abort`; `used` means selected for the subsequent apply check, not proof of acceptance. Existing trial duration excludes subsequent decision/apply and cleanup. The accepted transition and fresh final validation remain authoritative. Failed profile normalization retains its measured normalization duration.

## Execution lifecycle boundaries — 2026-09-20

Attempt allocation is durably published before reconstruction, repair overlays, preparation, or worker launch. Setup runs inside the worker attempt's typed failure boundary: infrastructure failures use the existing bounded routing policy, aborts terminate causally, and absent worker execution contributes no invented usage. Failed allocation publication permits no subsequent attempt setup.

Deterministic reconciliation uses single-use numbered trial directories and scope IDs. Each trial retains its preparation, patch, and result identities; `reconciliation.json` remains the profiler-discoverable latest summary plus an ordered trial identity index. The executor registers worktrees before creation and retains failed removals for terminal cleanup, without replacing already-completed attempt results.

After exact packet/profile/base admission, missing worker extensions or launchers throw admission errors before locks, execution artifacts, worktrees, or profile commands. Valid dry runs still execute real profile validation, followed by an independent active-tree check. Run duration starts at `executeFanout` entry rather than after admission; historical measurements retain their original timing semantics.

Worker source reads batch Git tree metadata and size-admitted blob content with an invocation-local immutable blob cache. Output order, tree selection, duplicate handling, binary/UTF-8 exclusions, and context ceilings remain unchanged. No prepared-state cache, checkpoint, validation parallelism, scheduler change, or planning optimization is introduced.

## Reading this record

This is a dated design history, including experiments, reversals and retained tradeoffs. Statements such as “current,” “next” or “deferred” refer to their checkpoint unless a status note says otherwise. Later refinements are linked where an older instruction would conflict with today's behavior. The [architecture](ARCHITECTURE.md) and [accepted execution authority](adr/0002-use-one-strict-execution-authority.md) describe the current implementation; historical schema numbers and measured outcomes remain unchanged here.

| Problem encountered | Design response and subsequent refinement |
| --- | --- |
| Prompted schedules over-serialized work or produced invalid dependencies | [Compile canonical work contracts and derive the DAG](#compiler-owns-execution-dag-construction) |
| Separate planning stages repeated model investigation | [Share model context while retaining distinct artifacts](#optimize-sequential-provider-requests-with-combined-planning-and-prepared-workers) |
| Formatting consumed semantic repair attempts | [Explicit normalization](#normalize-candidates-only-through-packet-declared-commands), later owned by [repository profiles](#cut-planning-and-execution-to-project-execution-profiles) |
| Restricted workers lacked useful failure feedback | [Bounded worker validation](#let-workers-run-only-their-immutable-contract-validation), with [project gates reserved for the controller](#keep-project-final-gates-controller-only-during-final-repair) |
| Repairs lost progress and parallel candidates became stale | [Cumulative repair seeds](#preserve-rejected-repair-candidates-cumulatively) and [disjoint reconciliation](#reconcile-only-exact-path-disjoint-stale-candidates) |
| Missing measurements blocked repository acceptance | [Separate valid partial evidence from contradictory evidence](#apply-the-approved-fanout-audit-cutover) |
| Provider users inherited orchestration-specific metadata | [Keep Fanout capabilities in the adapter](#keep-fanout-capability-metadata-in-the-fanout-adapter) |

## 2026-09-20

### Reserve linked worktrees for concurrent benchmark runs

Use one verified clean checkout for a singleton canary or sequential repetition cohort, restoring it between runs; a standalone clone is also acceptable. Do not create linked Git worktrees for one-at-a-time execution. Separate active worktrees remain required for intentionally concurrent runs because each execution needs its own lock and repository state. This simplifies sequential operation without weakening baseline or cleanup checks.

### Reuse approved execution profiles at an unchanged baseline

Do not rebuild a Project Execution Profile for each benchmark canary when the target repository remains at the exact clean baseline. Reuse the approved profile only after verifying that dependency state, platform, required commands, profile schema and bytes, and active-pointer identity are still applicable. Refresh after any profile-defining change, when no approved profile exists, or when verification is incomplete. This removes an unnecessary model call without weakening profile authority or changing historical benchmark accounting.

### Retain rejected planning drafts for bounded typed corrections

Keep one ordinary Pi implementation context and the initial combined `{plan, details}` tool submission. Remove the redundant JSON example from the prompt, retaining ownership, read-timing, repair-coupled tests and focused-validation guidance. After a structurally valid, uniquely addressed draft fails admission, retain it only in controller memory and switch the same tool to a closed repair schema on the next automatic response. Repairs replace whole plan/detail records by existing ID and may replace final validation commands. Headers and inventories remain fixed; changes to those require replanning.

Merge each batch atomically, preserve untouched records and ordering, reject stale revisions, duplicate/unknown IDs and no-op corrections, then run the entire existing admission/compiler path. Structurally valid compiler-rejected revisions become the next repair base, never executable artifacts. Plan authority remains independent from detail grounding, including many-to-many source attribution. Plan-body-bound sequential read fallback is unchanged and cannot reset the overall two-correction budget.

Count repair tool calls at assistant completion before SDK argument validation; schema-rejected calls consume the budget even without execution. Abort exhausted runs after their tool results, discard draft authority and restore tools. Cancellation/session reset also discards drafts; successful submission still terminates directly and publication remains identity-checked, pointer-last at settlement. Persisted profile v1, plan v4 and details v7 contracts are unchanged.

This is a local repair optimization, not a checkpoint protocol: malformed or length-truncated initial generations are not salvaged. No additional successful-path request, planner scheduler, JSON patch language, flag, paid benchmark or measured token/time saving is introduced. Real Pi SDK stub tests verify dynamic schema replacement and the pre-execution budget boundary.

## 2026-09-20

### Reuse successful setup validation for unchanged benchmark baselines

Decision: Across all benchmarks, reuse recorded passing setup tests when preflight verifies the same clean baseline, task, dependency state, and platform. Skip duplicate baseline tests by default without a per-run waiver. Initial setup and changed or unverified fixtures require validation; required checks on generated implementations remain unchanged.

Reason: Repeating setup tests against an already-verified unchanged fixture adds iteration time without testing the generated implementation. Record reused evidence and identity checks rather than treating a clean Git tree alone as proof of unchanged dependencies or environment.

## 2026-09-19

### TTFT probe records client delivery boundaries, not inferred engine phases

Decision: The standalone realtime probe persists private incremental body-read/SSE observations with a UTC request anchor and monotonic offsets. All events completed by one read share its receipt time. Reports distinguish reasoning deltas, text deltas, completed-response text fallback, completion, and stream closure; preserve raw usage; and leave unobserved boundaries and missing reasoning-token counts unavailable. No metric is named queue time, compute time, or avoidable wait without corresponding evidence. This change does not alter the Pi provider adapter.

Reason: Reasoning can arrive long before visible text, while coalescing, prefill, buffering, and scheduling pauses prevent client delivery intervals from isolating engine phases. First observed reasoning can upper-bound initial pre-generation queueing, but generated work is not necessarily required work. Retaining original observations enables later analysis without treating retrieved metadata, absent usage, or per-event parse overhead as timing authority.

The probe also accepts an explicit request file for repeated observation of an existing request. It preserves conversation/tool payloads, model settings, and the required output cap, defaults an omitted service tier to realtime priority, and records the source hash plus effective body privately. Replay never executes tools or claims output correctness. Missing exact-model prices remain unavailable rather than blocking collection; separately supplied rates must carry their own provenance. This is endpoint replay, not an agent workflow or accepted-code benchmark.

## 2026-09-16

### Prepare a public research preview with curated evidence

Decision: Keep parallel Fanout as the primary architecture. Publish repository source, a readable [study report](STUDY.md), curated scalar results and static figures. Whole-task candidate submission remains a request-depth experiment that can inform individual Fanout workers; it is not adopted as the replacement product. Modeled winning conditions are meaningful under their declared assumptions, while reliable real task/model/provider coverage remains incomplete.

New raw Fanout traces, model sessions, prompts and tool-event streams remain local and ignored. Synthetic test inputs must be clearly fictional. The original evidence is preserved locally. Use MIT for original project code/documentation and retain third-party licenses/notices.

This release needs no additional paid canary, interactive explorer, website, slide deck, routing system or executor redesign. It does not itself merge branches, change visibility, publish packages or rewrite history. Earlier next-experiment directions remain historical context, not the current preparation task. See [publication checks](PUBLICATION.md).

## 2026-09-08

### Prepare the fresh-repair experiment with independently checked acceptance

Status: Historical preparation checkpoint. The [study's transfer results](STUDY.md#4-transfer-the-fixed-whole-task-configuration) record the subsequent network stop and unlaunched cohort. The next-step text below is not a completed experiment or a current execution instruction.

Decision: The bounded first-repair prototype is ready for final live freeze after offline review. Keep Terra medium, full initial sources, Sol medium, the same candidate/seven guarded tools, two corrections and nine authoritative commands. Start a fresh Sol session only for the first correction; reuse it for the second. Count setup/disposal and all reads inside E2E. Use the existing process supervisor for a hard outer bound and retain failed process-termination time when late cleanup outlives an inner result.

Validation: Reviewed acceptance-v2 rejects the three observed defective candidates and accepts correct alternatives, including changed heading levels and tilde fences. Public hook scope and task-related snippet syntax are checked without replacing manual prose review. The complete positive fixture passes nine commands/36 tests with a 9.419s command sum; normal, failed, timed-out and late session paths have scripted driver/native-tool evidence. The initial prompt differs only in cwd. This proves offline operation, not a performance benefit.

Next: freeze two whole observations, retaining fixed-v1 failures and individually qualified raw references. No new raw runs, selected-success mean or retroactive timing changes. Both acceptance and context change, so no isolated causal claim; record how many observations actually exercise repair. No product/provider/source-excerpt decision changes. Original checker preparation evidence stays preserved, with an explicit limitation for overwritten initial stdout available only as a reconstructed summary.

### Close PR787 with quality failures; investigate bounded recovery context

Decision: Preserve the complete five-trial fixed cohort: two of three raw candidates and zero of two batch candidates pass manual quality review. All final automated checks pass, but neither arm earns a correct-completion mean under the frozen policy. Keep raw-02/raw-03 as individual qualified references, all failed costs/times, and the original raw-02 review with its collective-documentation adjudication. Do not adopt the batch configuration or infer async viability from its shorter failed traces.

Reason: Batch costs are $2.593488 and $1.392048, exceeding both accepted raw observations ($1.105290 and $1.097025). Whole-01's Sol repair cost alone is $2.184303; whole-02 also needed two sequential Terra requests. Automatic checks missed public hook scope expansion and malformed documentation. Reducing request count without controlling repair context and accepted quality is insufficient.

Next experiment to prepare: one fresh normal Sol repair session after the initial Terra attempt, with the same candidate, task, guarded tools and bounded failed-check diagnostics; keep its construction/disposal and all reads inside E2E. Production Fanout already uses fresh attempt processes, so this is a prototype recovery-context hypothesis, not a new product architecture. Independently validate acceptance improvements for the observed defects before another cohort; preserve current frozen inputs and allow alternative correct prose. No recovery variant, source-excerpt policy or provider change is adopted by this decision. Broader task-shape gaps and actual Doubleword evidence remain open.

### Admit PR787 validation while preserving the historical reference and full preload policy

Decision: Use the independently checked `navigateTree` contract task as a candidate for the next fixed comparison. Preserve the upstream reference, whose code passes but documentation is incomplete for the explicit task. Freeze a separate complete positive fixture with clarified prose and a valid direct-options adapter; do not weaken task requirements to match the reference. Its nine-gate boundary passes in 10.120s with 36 focused tests and stable candidate/runtime identities.

Reason: Positive/negative public typing, fake-transport prompts, real hooks, labels/cancellation, executed adapter wiring and three regression mutations provide task-specific correctness evidence. Documentation text presence remains a bounded filter followed by manual review. The full 505,568-byte task-source preload stays the baseline policy; smaller excerpts would introduce another configuration change. Exact assembled live context and driver/cohort preparation remain pending. This validates a shared-contract/input-cost contrast, not useful inherent width or provider viability.

### Preserve the interrupted Pi cohort without claiming a batch win

Decision: Apply the frozen cohort's stop rule after the first whole-task observation returned a Codex usage-limit error. Keep raw-01's successful 118.149s/$0.192988 observation and whole-01's 28.118s/$0.0709225 time/cost to error. Do not execute the remaining three trials, replace the interrupted trial, compute an arm mean or adopt a performance change. New live work needs a separately declared cohort; offline task admission can continue.

Reason: The initial batch passed semantics but required formatting repair. Its final patch matches accepted raw-01, yet the repair continuation failed before successful completion and final gates. Code equivalence cannot recover the missing execution measurement. Preserve immutable protocol, all costs and errors, and the distinction between unavailable service and model-quality failure. Actual async and product adoption still require the existing evidence gate.

## 2026-09-07

### Admit the bounded Pi rendering fixture without claiming broad task coverage

Decision: Keep Pi issue 764 limited to the pinned 56-column reproduction. Its offline acceptance and full read-only repository check expansion plus focused tests pass in 5.073s. Use it as a very small narrow-edit/overhead contrast when the fixed-configuration cohort is prepared. Preserve the complete 78-column guidance and empty-state behavior; accept valid shorter truncation. No product change or live configuration is adopted.

Reason: Reference `588399594c36cf4ee5bb04d4ab9e8220adc66b5f` fixes the header at 56, not every narrow width. Historical debugging length does not establish inherent investigation difficulty or task-work depth. Separately pin PR 787 as a possible shared-contract contrast, but require an independent evaluator, timing and source-context fit before admission. Its 505,568-byte snapshot is source volume, not implementation volume or useful width. Coverage v2 supersedes the inventory without changing frozen v1 or prior benchmarks.

### Screen fixed orchestration with Codex before spending async credits

Decision: Follow the user-approved Codex-first study sequence and replacement stored goal. The approved sequence called for the bounded qs transfer (now complete below), then a concrete task coverage matrix and evaluation of the fixed promising configuration against ordinary realtime Pi across contrasting real fast tasks before task-specific tuning. The subsequent PR787 closure above supersedes the immediate next experiment with acceptance and recovery-context investigation; this Codex-first evidence gate still governs provider spending. Preserve fixed Codex assignments, small declared cohorts, budgets, independent acceptance, full E2E and all failures. Reuse valid raw references; never adopt the biased qs mean.

Change to prior ordering: actual async was the immediate next step alongside qs. It is now deferred until repeatable Codex savings across relevant profiles and plausible trace-based latency headroom justify a small bounded Doubleword pilot. Doubleword credits are scarce, and missing credentials must not block Codex screening. The tradeoff is postponing direct provider evidence; simulated timing remains explicitly unable to establish provider quality, repairs, tokens or billing. The full realtime/async matrix and provider hypotheses remain later work.

Validation: the new stored goal was created and verified after the user removed the paused predecessor. The task matrix must identify pins, independent checks, measured validation duration, readiness and coverage gaps across width/depth/volume/coupling/reasoning; file/worker counts do not establish width. Execa stays an occasional stress case. A defensible limited or negative result is acceptable; no new orchestration layer, broad model sweep or more p-map tuning is authorized by this scheduling change.

### Retain the fixed batch configuration after one positive qs transfer

Decision: Keep the configuration fixed for further Codex screening. The single declared qs transfer passed all required gates and manual review in 174.992s/$0.56494, using one Terra and four Sol responses, versus the one valid raw observation of 265.166s/$0.754926. This supports continued evaluation, not adoption or repeatability. No qs tuning, biased raw average or new orchestration is justified by this one result.

Reason: The initial candidate implemented the required runtime behavior but left native expectation/test work for Sol. The measured recovery is part of both time and cost. Sixty-second request substitutions leave plausible headroom; 5/10-minute substitutions do not. These scenarios cannot predict actual provider quality or economics. The coverage inventory explicitly leaves narrow/deep work, a volume contrast, useful loose width and fast shared-contract width unproven or unready; fill those gaps with pinned real tasks before judging generality.

### Evaluate correct completion across orchestration and provider service

Decision: Adopt the [high-latency study protocol](benchmarks/fanout-high-latency-study.md). Preserve completed optimizations and measured failures. Ordinary realtime Pi remains the baseline; investigate both orchestration for today's high latency on every request and complementary provider changes. Prefer controlled prompt changes before custom candidate submission. Tier 1 may identify scope/context and local code may collect existing sources; the cheap worker must perform implementation reasoning rather than only apply Tier 1's completed solution.

Reason: Repeated p-map runs did not establish reliable cost/time benefit and exposed semantic failures despite green suites. The investigation must identify operating limits rather than assume Fanout wins. Fast continuation windows, shared caches and provider scheduling changes remain hypotheses; no provider architecture is adopted by this decision.

### Preserve the current prompt after the first controlled canary

Decision: Do not adopt the complete-before-validation wording as a performance optimization from this pair. Both arms passed acceptance v2, but the changed arm used 13 runtime responses versus 12 and more time/cost. Investigate an explicit complete-candidate submission/finishing experiment and execution overhead next; native Pi tool-result termination is a possible implementation seam. Unconditional stopping at the first green advisory check remains unsafe, and no new product workflow is adopted here.

Reason: Prompt wording changed validation order but did not establish reduced request depth or user benefit. Fresh-plan variation and the small sample constrain causal/reliability claims.

### Test complete candidate batching without changing product authority

Decision: Run an authorized benchmark-only complete-edit-batch experiment: first ask Terra for one whole candidate, then run the modified initial-worker Fanout arm with Sol planning and Terra workers. Successful native edit/write results may terminate the Pi turn; the unchanged external gates determine completeness and correctness. Errors, truncation or guard failure continue normally. Count all continuation and repair responses, and retain Fanout's existing Sol repair budgets. Do not add a product capability schema, recovery rule or adopted workflow.

Reason: The prompt-only pair left 12–13 runtime responses. A bounded experiment can test whether explicit complete submission removes turns without weakening validation or expanding permanent architecture.

Result: The single whole-task trial passed all required gates in 158.180s at `$0.3086735`, after one Terra response and five Sol correction responses. Both modified Fanout original workers met the one-response target, but one Sol validation repair used nine responses; total observed time/cost were 490.575s/`$0.7992885`. Fanout's native candidate and final gates passed, while the harness remains archived as an error because a post-run reporting check queried a nonexistent thinking field. A separate evidence audit confirms the configured Sol/Terra medium assignments, although exact worker argv was not persisted. A second audit found the canonical single-batch prompt branch inactive; normal canonical validation/final-response text and the active extension batch instruction conflicted, and the assembled provider system prompt was not persisted. Do not attribute the observed depth to the inactive canonical change, rerun this frozen cohort or adopt the prototype. The p-map repeats are recorded below. Continue on varied tasks and actual async service under new frozen protocols; any further modified Fanout arm must fix both reporting and prompt activation first.

### Continue whole-task evaluation and expose complete repair diagnostics

Decision: Preserve the two predeclared whole-task repeats and the existing raw mean. Their mean was 181.206s / $0.330543, with both passing, but all three whole-task observations including the exploratory trial exhausted the two-correction allowance. Keep the prototype experimental. Next test complete diagnostic collection before a repair in a separately frozen runner, retaining all required checks, candidate identity checks and recovery limits. Do not change product validation authority or the old cohorts.

Reason: The initial `xo && ava && tsd` command stopped at lint in all three trials. Offline replay of whole-02's initial tree showed that running AVA independently exposed both later test failures before the first repair. This supports an experiment about feedback timing; it does not establish a saved model round or performance benefit. Standalone async-provider/native-tool compatibility passed with fake transport, while actual async quality and latency remain unmeasured. Broader task and provider validation are still required before adoption.

### Require complete-task acceptance before more whole-task trials

Decision: Do not adopt supplemental diagnostics as a performance optimization from its two-trial follow-up. Both passed at a mean 326.352s/$0.5050845, slower than both the earlier whole-task repeats and the frozen raw mean. Preserve the fixed cohorts and separate candidate variation from the diagnostic change. Add a separate benchmark completion gate for public signal typing and required tests/documentation before further p-map whole-task trials, leaving acceptance-v2 unchanged. Review artifact quality as well as presence.

Reason: Both initial one-response Terra submissions changed only runtime code; Sol completed required types, tests and documentation. The runtime checker and unchanged suite could pass that incomplete work, so one-response termination and fewer correction prompts are inadequate success measures. The second trial used one correction prompt but eight Sol responses. Continue varied-task and actual async evaluation after acceptance readiness; no product workflow is adopted.

Implementation evidence: completion prototype v2 now rejects the clean base, runtime-only initial candidate and a widened-signal type regression while accepting seven archived final candidates, with identities unchanged. V1 and its narrower type-probe limitation remain preserved separately. It adds public type compilation and relevant test/type-test/documentation additions; artifact quality remains a review responsibility. These offline audits do not change historical E2E or acceptance-v2, and the gate must be bound into the next frozen cohort.

### Preserve the qs gate defect and test native continuation separately

Decision: Keep both qs raw outcomes and their full resource use, but do not adopt the 327.4325s/$0.959769 mean as a fair performance control. The second initial candidate was task-complete; an added-lines-only artifact predicate falsely rejected a test whose call remained unchanged context, inducing six extra Sol responses. Correct artifact-context handling in a separate checker revision and validate it offline before further comparisons. Keep the original cohort immutable and retain manual quality review; textual categories cannot prove relevance or quality.

Reason: Gate-induced work would inflate the raw baseline and make a later optimization look better. The first trial remains one valid observation. Separately, p-map traces show that terminating after a successful initial edit batch prevents Terra from continuing when it chooses a partial batch. Prepare a benchmark-only normal-Pi-continuation experiment with the same prepared context, Terra/Sol assignments and recovery budget, removing termination and its one-response instruction. Measure total cheap requests and displaced Sol repairs; no product adoption or performance benefit is inferred.

Implementation evidence: qs completion-v2 now passes seven offline cases, including the valid original raw-02 candidate and tests placed in only one permitted file. Read the full content of changed files to avoid losing unchanged context; retain explicit presence-heuristic limits and manual review. Keep the frozen v1 checker and its incurred correction unchanged. The corresponding p-map completion-v3 gate preserves typing and compiler supervision, passes its eleven-candidate matrix including a contextual-documentation regression, and was bound into the separately frozen native-continuation cohort below.

### Reject native continuation for the current high-latency target

Decision: Preserve the completed native-continuation pair without adopting its configuration. Both final candidates pass, but the mean 355.666s/$0.60843225 is slower than raw Pi for only 2.29% estimated savings, and initial Terra chains require 8/13 sequential responses. At an assumed minute per slow request these chains fail the time budget before other work. Both still needed Sol to fix a real promised-value abort defect.

Reason: The objective is correct completion per unit time and cost, not more parallel workers or cheaper individual turns. Stop further p-map prompt, architecture and harness variants unless a validity defect prevents the next decision. The immediate async/qs ordering at this checkpoint was superseded by the Codex-first decision above; qs is now complete and actual async is deferred. Keep its routing and two-repair budget fixed; use only the valid qs raw-01 observation, not the biased pair mean. Structured submission tools, fast provider continuation and broader architecture remain deferred hypotheses.

### Reuse a calibrated raw-Pi reference

Decision: After a small raw-Pi calibration cohort, reuse its arithmetic mean across Fanout iterations. Preserve the individual trials, sample count and failure evidence. Run raw Pi again when task/model/environment/measurement changes make the reference stale, rather than pairing an unchanged raw arm with every optimization. The current v2 reference uses its two comparable trials; do not pool historical runs whose acceptance/E2E boundaries differ.

Reason: The user explicitly requested baseline reuse on 2026-09-07 to avoid repeated unchanged control runs. More calibration samples are useful only when their uncertainty affects a decision.

### Strengthen acceptance and broaden the fast task set

Decision: Version independent acceptance and make required semantic checks and their repairs part of future full E2E for both ordinary Pi and Fanout. Preserve historical post-hoc-audit measurements without relabeling their accounting. Start with correct-completion baselines and a small prompt experiment using existing Sol/Terra settings. Expand p-map with roughly three varied fast-validating tasks; retain Execa for occasional stress runs. Task selection is not complete, and no artificial DAG shape is required.

This supersedes the p-map-only scope of the initial efficiency pilot. Routine engineering/canary work and atomic reviewed commits follow the user's updated global instructions; the previous blanket plan-before-write gate is superseded. Existing authority, isolation, provider/core boundaries and fixed repair budgets remain. Polished presentation, broad model sweeps and Pi-with-subagents comparisons are deferred so useful execution evidence comes first.

Reason: Correct completion is the user outcome. Failed-run time is not a successful-completion baseline; task difficulty, work volume and useful parallelism are independent dimensions. Measured results, trace-based counterfactuals and hypothetical provider designs require distinct evidence labels.

## 2026-09-06

### Optimize sequential provider requests with combined planning and prepared workers

Decision: The approved [efficiency work](impl/fanout-efficiency-progress.md) merges Phase A/B model planning into one context and combined submission, followed by deterministic validation and compilation. Keep the existing persisted plan/details/packet semantics and identity links; their logical semantic/grounding halves no longer require separate model investigations. Reuse existing profiles and user context. Prepare bounded actual worker source context, add verified pre-edit/write ownership feedback while retaining final patch audits, align validation with repair ownership, and remove duplicated model-facing repair material while keeping complete audit evidence.

This supersedes the requirement for two separate planning model phases. Pi worker tools, candidate continuity, Tier 1 validation repairs, fixed budgets and independent controller acceptance remain. The per-attempt worker manifest will bind write resources and bans with a local format revision; execution outcome/event generations do not change for prompt or pre-tool feedback alone.

Reason: A one-minute request latency is paid on each dependent model call. Recent traces spend calls rediscovering context and pay for rejected ownership or unrepairable validation. These changes target that repeated work without weakening accepted repository authority. One-shot completion and performance gains remain hypotheses to measure.

### Use p-map for the efficiency pilot

Decision: Compare raw Pi, baseline Fanout and improved Fanout on the same p-map AbortSignal task, clean baseline and independent acceptance checks. Record all planning, execution, failure, repair and final-check costs/time, with human waits separate. Begin with the three-mode pilot; larger cohorts remain pending. Keep Execa results historical.

Reason: p-map's shorter full suite makes workflow overhead easier and cheaper to investigate. A pilot establishes accounting and feasibility, not reliable tail performance or a universal speed claim.

## 2026-09-05

### Apply the approved Fanout audit cutover

Decision: Implement the [approved audit plan](impl/fanout-audit-implementation-plan.md) with plan 4, details 7, contract 5, packet 10, outcome/event 6 and projection 7. Profiles/pointers and per-round final evidence retain their generations; old execution records remain descriptive Legacy evidence. The [register](impl/fanout-audit-progress.md) records validation and review.

This supersedes exhaustive Phase A baseline-read membership, forced fine-grained splitting, initiating-message-only implicit context, accepting Phase B before compilation, complete-measurement acceptance (including the strict-worker pricing restriction on 2026-08-26), and requiring nonempty additional packet-final commands. Writes/post-change scope remain Phase A bounded; profile-only final validation requires nonempty exact combined gates. Canonical measurement evidence needs positive observed assignment identity and rejects supplied contradictions; missing fields yield unavailable totals rather than rejection or fabricated zeros.

Phases advance at Pi settlement. Fail-fast drains already-running work and records policy skips separately from dependency skips. Event outcomes are the sole terminal attempt records. Final-controller status, immutable latest round, all-round command time and typed failure remain distinct; post-mutation publication failures retain the reconciliation lock. Invocation keeps standing authorization for bound-profile commands even in dry-run and before live confirmation; disclosures state possible external/network effects.

Reason: Preserve exact repository authority while removing redundant admission and fixing lifecycle, replay and evidence semantics. Two phases, safe fusion, direct argv and atomic whole-log replacement remain; predictive scheduling, command caching and broader efficiency claims remain deferred. Offline regressions are not live E2E or performance evidence.

## 2026-08-29

### Default new work to GLM 5.3 Flash

Decision: Replace GLM 5.2 with exact model `zai-org/GLM-5.3-Flash` in the standalone provider's minimal fallback list, development stub, and Fanout Tier 2 default/model-picker preference. Preserve historical GLM 5.2 benchmark inputs and results. Pricing remains generated from the official catalogue by the existing reviewed snapshot workflow.

Reason: Doubleword now exposes GLM 5.3 Flash, and its official model page describes improved coding, tool-use, and general capability over GLM 5.2 at lower published prices. New provider and Fanout work should use the current model without rewriting historical evidence.

## 2026-08-26

### Synchronize exact Doubleword pricing into reviewed snapshots

Status: Reviewed exact-model pricing snapshots remain the pricing design. The complete-metrics and strict-worker acceptance restrictions below were superseded by the [September audit](#apply-the-approved-fanout-audit-cutover): valid partial measurements may accompany repository acceptance, while unsupported totals remain unavailable and supplied contradictions remain invalid.

Decision: Replace the provider's hand-maintained tier-price table with a generated TypeScript snapshot of every exact model ID and realtime/async/batch row published by the official Doubleword model catalogue. A manual `npm run sync:doubleword-pricing` fetches the documented Markdown pages, fails on unexpected structure, and records the source URL, retrieval date, and SHA-256 of canonical pricing rows. Provider startup remains offline with respect to pricing: `/v1/models` supplies live availability, exact IDs join to the committed snapshot, and missing tiers receive no trusted pricing provenance. Discovered unpriced models remain visible to ordinary Pi with its required zero-cost placeholder, but Fanout cannot accept them as strict workers. When discovery and its cache are both unavailable, the minimal hard-coded fallback list remains visible to ordinary Pi and may display exact snapshot costs, but it receives no trusted pricing provenance until discovery or cache supplies availability evidence. Strict Fanout usage evidence requires the Responses API's native `input_tokens` and `output_tokens`; compatibility aliases and estimates remain available only to ordinary Pi accounting and cannot satisfy strict admission. This supersedes the fixed prices and source described on 2026-06-25 without changing ordinary model-discovery availability.

Reason: The published catalogue and cache-read rates change independently from provider releases, while exact usage/cost evidence must remain reviewable and reproducible. A committed identity-bound snapshot avoids startup scraping, aliases, inferred prices, and silent zero-price admission while retaining normal Pi model discovery.

## 2026-08-05

### Keep project final gates controller-only during final repair

Decision: Final-repair workers receive the packet final node's focused validation commands in their immutable `fanout_validate` manifest, while authoritative controller rounds retain the complete ordered packet-final plus profile-required command manifest and failure evidence. Recovery admission requires the focused repair commands to be an ordered prefix of that authoritative manifest. The controller still validates every repaired candidate in a fresh reconstruction and applies it only after the complete authoritative round passes. This supersedes only the 2026-07-27 requirement that final-repair worker validation derive from the combined packet/profile manifest; schemas, profiles, repair budgets, and controller acceptance authority remain unchanged.

Reason: Profile-required project gates are long, controller-owned acceptance checks. Running them inside a repair worker and then again in the controller duplicated the same gate on one candidate tree without adding authority. Focused worker feedback preserves in-context correction, complete controller failure evidence, fresh-context seed continuity, and bounded repair while removing the duplicate route.

## 2026-08-04

### Let workers run only their immutable contract validation

Status: Contract-bound diagnostic validation remains; the [current generation table](ARCHITECTURE.md#current-contract-generation) supersedes the versions below. Correction stays within the worker attempt, but using tool feedback can require another provider response; the historical phrase “same model call” does not establish one-response completion.

Decision: Cut over atomically to work contract v4 and execution packet v9. The fixed worker profile now exposes the existing six file tools plus one worker-only, zero-argument `fanout_validate` tool. Before each worker launch, the controller publishes a digest-bound manifest containing the exact contract-declared ordered direct-argv commands, platform, timeout, and canonical run/node/attempt/worktree identity. The extension registers the tool only after verifying that manifest and identity, reverifies it on every call, rejects any call not alone in its assistant message, returns command failures in the same tool result, and stores per-call advisory evidence. Shell and every other extension tool remain unavailable.

Worker validation is diagnostic, not acceptance authority. The controller still captures the patch, enforces ownership, and independently reruns the same contract commands through the existing validation runner before accepting or repairing a candidate. Work contract v3 and packet v8 require replanning; no adapter or migration is added. Attempt Outcome, Event, Projection, final-evidence, profile, plan, details, and pointer generations remain unchanged because routing and acceptance semantics do not change.

Reason: Controller-only validation forced workers to finish without seeing deterministic failures, converting locally correctable feedback into extra validation-repair attempts. A manifest-bound no-argument tool provides the narrow capability needed to fix failures in the same model call without restoring arbitrary shell access or weakening controller authority. Benchmark whether it reduces repair attempts, runtime, tokens, and cost before making broader workflow claims.

## 2026-08-03

### Cut planning structures and context to one fail-closed generation

Status: Historical generation and context checkpoint. Worker validation changed contract/packet generations on August 4; the [September audit](#apply-the-approved-fanout-audit-cutover) subsequently changed generations, draft admission and objective-context handling. [Combined planning](#optimize-sequential-provider-requests-with-combined-planning-and-prepared-workers) then replaced separate model investigations. Pi-native read permissions remain part of the current design.

Decision: The executable planning generation at this cutover was Project Execution Profile v1, implementation plan v3, implementation details v6, work contract v3, execution packet v8, and active pointer v2. Canonical Pi-independent TypeBox schemas define planning bodies and persisted artifacts, drive the phase-specific `fanout_submit_artifact` parameters, and run before contextual semantic checks. Details v5 and packet v7 are Legacy and receive no adapter or migration.

Phase A is the sole planning source of global forbidden writes. Phase B grounds changes, typed reads, task validation, and advisory context without repeating bans; its omitted model-body `advisoryNotes` canonicalizes to `[]`, while persisted details require the field. The compiler propagates every Phase A ban with provenance into ordinary and final Work Contracts.

Each successful lone submission returns a terminating tool result; a submission batched with another tool is rejected before execution, while invalid submissions throw and remain correctable in the same phase. Provider context retains only the current phase suffix and controller-built inputs, preserving only the initiating user request for implicit objectives. Planning read/search/list calls use Pi's ordinary filesystem permissions without an additional repository-only restriction. The session file and visible transcript remain intact. This reverses only the repository-containment gate introduced by `5b5dffe`; planning remains limited to read-only filesystem tools, user clarification, and controller-bound submission.

Reason: Structural retries, inherited cross-phase transcripts, and post-submit continuation consumed paid turns without adding semantic judgment. One schema source, one global-ban owner, phase-local provider context, and Pi-native read scope remove those traps while preserving Pi's normal agent loop and accepted local-trust boundary.

## 2026-07-30

### Cut ownership-retry routing to a new execution generation

Status: The retry policy remains; the v5/v5/v6 generation below was superseded by the [September audit](#apply-the-approved-fanout-audit-cutover). Its rationale explains why recorded routing semantics require an explicit generation boundary.

Decision: The original-candidate `unauthorized-change` retry changes controller-action semantics, so the only current runtime evidence generation is Attempt Outcome v5, Event v5, and Projection v6. Event v4 and Projection v5 become descriptive Legacy evidence and are not replayed through current routing. Packet v7 and the remaining profile, planning, work-contract, final-evidence, pointer, and presentation generations stay unchanged. There is no compatibility adapter or migration.

Reason: Recomputing the new retry action while replaying an existing Event v4 outcome recorded as `fail` makes same-version evidence contradictory. A coordinated fail-closed cutover preserves one routing meaning per generation instead of trusting stored actions selectively or adding historical routing branches.

### Keep project-wide validation out of packet task checks

Decision: Phase B receives the exact approved Project Execution Profile and treats its preparation, readiness, candidate normalization, and required final gates as already guaranteed. Ordinary-node validation uses the narrowest meaningful checks covering that node's owned changes, retaining broader scope for shared infrastructure, configuration, build, test-harness, and similarly wide-impact work, while packet-final validation contains only additional task-specific integrated checks. Core artifact admission rejects an exact node or packet-final duplicate of a profile final gate only for the submitted Phase B draft, with both command locations and a correction instruction; the Pi planning session remains open for resubmission. Fanout never silently deduplicates submitted command authority.

Reason: The Execa transfer canary repeated `npm test` in the packet-final contract and profile gate, while one ordinary type node selected a broader command than its changed type-test surface required. Supplying the profile closes the documented planning-context gap, draft-only rejection prevents repeated full-suite work without aborting planning, and focused prompt guidance remains ecosystem-independent instead of interpreting package scripts.

## 2026-07-28

### Carry advisory Worker summaries only into node validation repair

Decision: Every worker ends its existing Pi response with a short numbered `Worker summary`. The adapter extracts the body beneath the final assistant message's exact heading, stores it as optional diagnostic data in the existing attempt `result.json`, and safely includes it only in the immediately following node validation-repair prompt. Missing or malformed summaries do not block repair, and a later repair receives only its immediate predecessor's summary. Integration-repair and project final-validation-repair prompts do not receive predecessor summaries in this version.

The summary is not recovery evidence, validation evidence, repository authority, an Attempt Outcome field, an Event/Projection field, or repair-state input. It cannot alter capabilities, ownership, budgets, typed routing, exact no-progress identity, acceptance, or replay. No worker session resumes and no summarization model call runs.

Reason: The worker already knows what it changed and why before its existing call ends. Reusing that bounded account gives validation repair useful implementation context without collecting chain of thought, adding a model call, widening authority, or cutting the executable schema generation.

## 2026-07-26

### Discover projects within one fixed profiler storage root

Decision: Repository `npm run profiler` resolves the current working directory through `fanout-pi`'s existing artifact settings, supplies one storage root and preferred current-project identity to `fanout-profiler`, and presents every immediate canonical child containing planning or execution evidence in a URL-addressable project picker. Every HTTP operation names only an admitted opaque project identity. Refresh rescans membership and atomically refreshes the selected catalog; root-level failure preserves prior registry state. `--artifact-root` retains single-project forensic mode. The composition stays in the repository launcher, so the profiler package still depends only on `fanout-core`. This supersedes the current-project-only repository default and the one-project startup scope, but not the fixed-root, read-only, or no-filesystem-selector contracts.

Reason: Fanout's default Pi-owned storage already groups hashed project roots beneath one user storage root. Discovering only evidence-bearing children removes manual path reconstruction and supports switching among real projects without a database, source-repository reads, arbitrary browser paths, or profiler-to-Pi coupling. Project-specific artifact roots outside the selected storage root remain explicit forensic inputs until a concrete cross-root indexing need exists.

## 2026-07-19

### Omit profiler exports from v1

Decision: V1 has no profiler export endpoint, browser download action, export schema, persisted report, or Counterfactual Scenario serialization. The read-only UI presents profiler-derived views, while Source References and evidence inspection lead back to authoritative Fanout artifacts. Any later export requires a concrete sharing, archival, or machine-consumption need and must remain a user-invoked derived view that Fanout never admits as execution authority.

Reason: Without a concrete consumer, Markdown or JSON exports would duplicate the UI, create a de facto profiler contract, and risk being mistaken for durable artifacts. See [Define the profiler export contract](https://github.com/snehalyelmati/fanout/issues/45).

### Add one private Bun profiler package

Decision: Add a private, repo-local `fanout-profiler` workspace package that depends only on `fanout-core`. It runs as one `Bun.serve` process bound to an explicit artifact root and `127.0.0.1`, builds atomically refreshed immutable in-memory catalogs, lazily streams large supporting evidence, and serves a vanilla HTML/CSS/ES-module workspace through a fixed bounded HTTP interface. Core retains artifact parsing, graph derivation, metric correlation, and authoritative event replay; the profiler owns read-only lineage relationships, receipts, comparisons, observations, and scenarios. This supersedes the three-package limit only for this concrete application; it does not add a generic CLI framework, publication path, database, frontend framework, or Pi/Doubleword coupling.

Reason: The profiler is now a concrete product boundary rather than speculative adapter infrastructure. A dedicated package keeps filesystem, HTTP, and presentation concerns out of `fanout-core` and avoids false `fanout-pi` coupling while preserving the existing provider/core/Pi dependency directions. Bun and native browser facilities provide the smallest offline implementation without new production dependencies. See [Choose the minimal local web-app architecture](https://github.com/snehalyelmati/fanout/issues/42).

### Cut profiling evidence forward without compatibility

Status: Historical evidence-generation checkpoint, superseded by later cutovers including the [September audit](#apply-the-approved-fanout-audit-cutover). Exact correlated intervals and explicitly unavailable evidence remain design principles; current versions are in the [architecture](ARCHITECTURE.md#current-contract-generation).

Decision: The current coordinated executable generation keeps implementation plan v2, implementation details v4, execution packet v6, active pointer v2, embedded work contract v2, and final-validation evidence v1, while cutting Attempt outcomes to v3, execution events to v3, and execution projections to v4. Correlated metrics record exact Worker Turn request/first-output/finish intervals, Provider Response request/first-token/finish intervals, Tool Invocation names and intervals, and cache-read/cache-write usage. The cutover is atomic and fail-closed; event-v2/projection-v3 and earlier artifacts are legacy descriptive evidence without replay, migration, or compatibility adapters.

Reason: Fixed-envelope Attempt totals cannot distinguish provider queueing, generation, tools, or inter-call gaps, so they cannot calibrate stateful cold/warm provider scenarios. Exact correlated intervals make uncovered time visible without creating another execution authority. This supersedes the earlier no-producer-change profiling baseline and the prior generation only when the coordinated cutover is implemented. See [Define counterfactual scheduling simulations](https://github.com/snehalyelmati/fanout/issues/41).

### Keep counterfactuals fixed-behavior and post-confirmation

Decision: A Counterfactual Scenario is an immutable read-only overlay that reschedules only recorded post-confirmation `/fanout-execute` work. It may vary Fanout concurrency and one fixed or cold/warm Provider Profile per recorded tier while preserving the packet DAG, Attempt and repair chains, Worker Turns, tools, tokens, outcomes, validation, non-provider intervals, and Accepted Ledger order. It reports one scenario execution time, cost, packet path, and Scenario Completion Chain against the observed baseline; incomplete runs cover only their recorded prefix. It never reroutes calls, predicts model behavior or quality, or declares a winner.

Reason: Holding work and outcomes fixed makes the result deterministic arithmetic rather than an unsupported provider or scheduler forecast. One completion boundary matches `/fanout-execute`; a separate active-completion metric would invent a user-visible boundary before required work and Final Validation finish.

## 2026-07-16

### Keep Fanout capability metadata in the Fanout adapter

Decision: The standalone Doubleword provider owns provider-native model discovery, reasoning metadata, pricing, and transport only. It does not expose or preserve `fanout` metadata from the live catalog. `fanout-pi` projects remembered Doubleword models into Pi's registry with realtime/async/background/auth-ready capabilities; live readiness follows `DOUBLEWORD_API_KEY`, while the local stub is ready by construction. This supersedes the 2026-07-05 provider-owned tier-metadata decision.

Reason: Provider users should not acquire a Fanout-specific API or policy surface. The Pi adapter is the integration boundary that understands both the provider model and Fanout's routing contract, so it can derive the required capability view without coupling the standalone package to Fanout.

### Record closed preflight evidence before execution starts

Decision: Preflight completes before the first event is published, while `run-started` remains event sequence 1 and carries required closed evidence for expected/actual commit, tree, and platform; worker launcher, extension, and fixed tool capabilities; and packet-ordered normalization/validation argv resolution. Event v2 and projection v3 remain unchanged because this branch is an unreleased offline candidate; earlier pre-release logs without the evidence fail closed. Audit replay publishes `summary.md` only for terminal projections and removes a stale summary when replaying nonterminal state.

Reason: A start record without the exact launch and command facts cannot prove which admitted environment was checked. Keeping the evidence in sequence 1 preserves causal replay, while terminal-only summaries prevent an old completion report from misrepresenting an incomplete log.

## 2026-07-14

### Cut every producer and consumer to one hardened generation

Status: Historical hardened-generation checkpoint. Subsequent cutovers changed planning, execution and evidence contracts; use the [current generation table](ARCHITECTURE.md#current-contract-generation). The one-authority and exact-identity rationale below remains relevant.

Decision: The only executable planning/runtime generation is implementation plan v2, implementation details v4, execution packet v6, active pointer v2, embedded work contract v2, attempt outcome v2, final-validation evidence v1, execution event v2, execution projection v3, and disposable `fanout.planning-report`/`fanout.execution-report` presentation data v1. Models submit planning bodies; controllers bind envelopes, exact source bytes, planning commit/tree/platform, IDs, and timestamps. Packet nodes embed canonical contracts and derive their graph/views; the sole final-validation node uses the reserved exact ID `final-validation`, which ordinary nodes cannot claim. Concrete node tier assignments are derived from the closed node kind and packet tier plan, and admission re-derives them to reject downgraded, unavailable, or substituted routing tuples. Pointer/packet admission rejects legacy, future, mixed, substituted, and unknown-field artifacts before lock creation or mutation. There is no compatibility adapter or migration path; obsolete authority requires replanning.

Reason: A staged compatibility bridge would leave multiple executable authorities for ownership, dependencies, commands, budgets, repository identity, and reporting. A coordinated fail-closed cutover makes every artifact boundary reviewable and lets package-independent core checks prove the same generation that Pi executes.

### Validate and repair only fresh exact reconstructions

Decision: The final-validation node is a controller gate rather than an ordinary worker. The controller rebuilds the planning base plus accepted ledger in a fresh detached worktree, verifies planning commit, clean index relation, and full Git-visible trees for both validation and active checkouts before and after the complete ordered command sequence, and records versioned exact evidence whose parser causally binds each failure class to its command and boundary state. Only nonzero, timeout, and signal results may consume the final node's fixed two-launch validation-repair pool. Every repair prompt embeds the immutable packet identity, original final command contract, packet-ordered upstream work contracts, and admitted failed-round evidence, including both checkout identities and any rejected candidate transition. The executor verifies that packet identity against the exact canonical packet bytes, and prompt rendering requires the node's effective contract to equal the recovery contract. Repair authority is the union of upstream typed change endpoints under their typed forbidden writes; every candidate is ownership-checked by closed violation codes and replayed into another fresh reconstruction before verified stdin apply to active.

Reason: Running validation in active or adopting a repair worker's checkout would make validation side effects and ignored residue part of the returned repository without proof. Sequence-boundary checks allow intentional create-then-remove checks while persistent drift fails closed without reset, replay, or rollback. This remains repository integrity under trusted-local-program semantics, not containment of ignored files, external paths, network, processes, services, or mutate-then-restore behavior.

### Run workers through fixed file capabilities and exact accepted patches

Superseded only for the fixed tool list by the 2026-08-04 contract-bound `fanout_validate` decision; the patch and integration boundaries remain current.

Decision: Every worker attempt keeps Pi's trusted automatic extension/provider discovery, `--approve`, `--no-context-files`, curated repository instructions, and the inherited parent environment, while `--tools` exposes exactly `read`, `grep`, `find`, `ls`, `edit`, and `write`. The Fanout extension synchronously rejects unavailable tools and edit/write targets using absolute, traversal, `.git`, or existing symlink segments. The node executor rebuilds fresh worktrees from the planning base plus ordered accepted-state transitions, captures and reverifies binary patches by digest/length/paths/HEAD/trees, and applies verified bytes through Git stdin with exact pre/post trees. A rejected validation-repair seed is not an accepted transition: its verified bytes may be overlaid only into the latest disposable reconstruction, after which the repaired candidate is recaptured relative to the current accepted tree and must pass the ordinary exact transition boundary before active mutation. Active drift fails without repair or reset; failure after active mutation is a distinct bookkeeping hard fail and Fanout does not guess a rollback.

Reason: Model capability restriction must happen before tool execution, while repository integration authority must remain exact bytes and tree transitions rather than mutable patch paths, unadmitted overlays, stdout scanning, or error-text routing. The seed-only overlay preserves disjoint concurrent accepted work without granting repository integration authority to a rejected candidate. This is repository hardening under Pi's local trust model, not containment of trusted extensions, providers, validation programs, ignored files, external paths, network, or processes.

### Prepare disposable worktrees only through explicit ignored paths

Status: Superseded by [Project Execution Profiles](#cut-planning-and-execution-to-project-execution-profiles). Current worktrees run profile-declared preparation and readiness independently; `FANOUT_WORKTREE_SHARED_PATHS` is rejected. The decision below records why the earlier shared-path approach was chosen.

Decision: Dependency and tool availability in disposable worker and final-validation worktrees uses one explicit preparation input, supplied through `FANOUT_WORKTREE_SHARED_PATHS` or the equivalent executor option. Every entry must be a unique top-level repository-relative path that already exists in the active checkout and is ignored by Git. Preflight validates the complete list and live confirmation displays it before any worker allocation. The preparation boundary links the selected paths into each fresh reconstruction after authoritative patch replay; generic reconstruction has no language-, runtime-, or package-manager-specific path.

Reason: Reinstalling dependencies in every detached worktree adds network and lifecycle authority, while hard-coding one ecosystem's dependency directory would couple Fanout to a runtime. Explicit ignored paths reuse the user's preinstalled local environment without entering the Git-visible planning tree, accepted patch, or result-tree identity. Their contents remain outside Fanout write containment and may be read or mutated by trusted local extensions and validation programs under the existing local-Pi trust model.

### Normalize candidates only through packet-declared commands

Status: The normalization mechanism remains, but command ownership moved from packets to [Project Execution Profiles](#cut-planning-and-execution-to-project-execution-profiles). The current [normalization contract](adr/0006-normalize-candidates-before-capture.md) preserves candidate ownership and exact capture. The p-map observations below remain historical evidence for introducing the mechanism.

Decision: Implementation details v4 owns one required, empty-able, repository-level `candidateNormalizationCommands` direct-argv list, and the compiler copies it into every work-contract v2 node, including final validation. Packet v6 admission rejects any node whose ordered manifest differs from the first node's manifest. After any successful worker or repair edit, the controller runs each configured command once in order in that disposable candidate worktree before patch capture, typed ownership enforcement, and the existing validation commands. Nonzero results remain audited and do not stop later normalizers; original validation alone decides whether model repair is needed. Preflight, spawn, timeout, signal, user abort, audit-publication failure, or repository-identity drift remain typed controller facts and never cause fixer inference or budget expansion. `candidate-normalization.json` records the manifest, results, timings, output, and before/after identities when readable, explicitly records unavailable identity evidence, and the attempt links that evidence. Initial integrated final validation remains unchanged; final-repair candidates use the final contract's list under the existing derived write union.

Reason: Attempts 11 and 12 of the p-map canary independently reached four successful work nodes, then exhausted both final repairs on deterministic XO formatting before semantic tests could run. Reconstructing Attempt 11, running the repository's explicit fixer once, then running `npm test` passed all 55 tests. A small packet-declared normalization seam reserves bounded model judgment for remaining failures while keeping Fanout language/runtime agnostic, user-reviewable, fail-closed, and exact at ownership and accepted-transition seams. Environment escape hatches, stderr classifiers, implicit fixers, and configurable repair budgets would create unreviewed or prose-derived authority. See GitHub issue #32.

## 2026-07-13

### Enforce planning capabilities and context-free reports

Decision: `/fanout-plan` injects typed Phase A, Phase B, and repair instructions once through `before_agent_start.systemPrompt` behind short visible triggers. Each attributed turn exposes only Pi's `read`, `grep`, `find`, and `ls` tools, `ask_user_question`, and one controller-bound `fanout_submit_artifact` tool; a fail-closed tool-call gate backs the active profile, and the exact prior profile is restored at the turn boundary. Planning and execution reports use versioned `appendEntry` data with registered entry renderers and never fall back to a message channel.

Reason: Prompt text is semantic guidance, not a capability boundary, and custom messages remain later model context even when they do not trigger a turn. Controller-derived artifact destinations plus context-free report entries preserve deterministic authority without claiming host containment.

## 2026-07-27

### Cut planning and execution to Project Execution Profiles

Status: Profiles still own preparation, readiness, normalization and required project gates. The generation numbers below were superseded by later cutovers; [final-repair worker validation](#keep-project-final-gates-controller-only-during-final-repair) now receives only focused packet commands while the controller retains the combined gates.

Decision: The only executable generation is Project Execution Profile v1, implementation plan v3, implementation details v5, work contract v3, execution packet v7, active packet pointer v2, Attempt Outcome v5, final-validation evidence v2, execution event v5, and projection v6. Profiles own approved preparation, readiness, candidate normalization, and project-wide final gates; packets retain task scope, graph, task validation, routing, and model-work authority and bind the exact profile artifact identity. Packet final commands run before profile final gates, and final-repair recovery derives from that exact combined ordered command manifest. `/fanout-plan --refresh-profile` validates a replacement in a disposable clean worktree before atomically publishing it; failure preserves the previous profile. Older executable artifacts require replanning, while older events and projections remain descriptive Legacy evidence.

Profile mutation disclosure is phase-specific: `candidate-owned` is valid only for candidate normalization and does not expand the packet/work-contract write boundary. Preparation and readiness remain limited to `none` or `ignored-only`, and clean-baseline validation still rejects tracked mutation.

Reason: Environment commands and project-wide gates change independently from task decomposition. One immutable, user-approved profile removes duplicated command authority, makes isolated setup auditable before paid allocation, and avoids migration or another orchestrator.

### Preserve rejected repair candidates cumulatively

Decision: Every final repair is seeded from the immediately preceding rejected candidate, including across process-only launch failures. The candidate remains evidence rather than ledger authority; a successful repair is recaptured from the accepted tree and may enter the ledger only after ordinary identity, ownership, validation, and compare-and-swap acceptance.

Reason: Reconstructing every repair from the accepted tree silently discarded prior repair work. Exact seed continuity fixes the loss without granting rejected bytes repository authority.

### Reconcile only exact path-disjoint stale candidates

Decision: Before model-driven integration repair, the controller may reconcile a stale candidate only when its exact changed paths are disjoint from every intervening accepted transition. It reconstructs the latest ledger, overlays the candidate, runs profile normalization, recaptures, enforces ownership, validates, and compare-and-swap applies. It retries only after ledger advancement. Unavailable base, overlap, overlay, normalization, ownership, or combined-validation failure routes through existing typed integration repair; preparation and repository infrastructure failure terminates without repair allocation.

Reason: Exact path disjointness proves the narrow safe case with existing reconstruction and validation machinery. Same-file, semantic, fuzzy, and three-way policies remain out of scope.

### Stop repairs on exact repeated state

Decision: Core hashes candidate identity plus typed failure state while excluding only attempt IDs, timestamps, and durations. An identical pair terminates as exact no-progress without spending remaining repair budget; changed candidates or failure facts continue.

Reason: Fixed budgets cap cost but still allow provably identical work. Exact hashing provides deterministic termination without fuzzy progress policy.

### Fuse eligible vertical serial chains in the compiler

Status: Fusion remains implemented with these narrow predicates. Its usefulness on real task graphs and its net performance benefit were not established separately; the [later review](impl/fanout-audit-progress.md#f25--fusions-utility-is-unmeasured-under-strict-predicates) retains that measurement question.

Decision: After initial graph and tier derivation, the compiler iteratively fuses only unique predecessor/successor chains with matching kind, tier, profile context, coverage-normalized resource closure, and compatible validation. A later node must explicitly read an earlier write after change. Source order, exact-entry deduplication, authority union, dependencies, and `sourcePlanIds` are preserved; deterministic fused IDs derive from ordered source node IDs. Branches, joins, final-validation edges, incompatible contexts, and runtime fusion are excluded.

Reason: One setup/model/normalization/validation/apply cycle is cheaper than artificial vertical serial boundaries, while deterministic compiler ownership keeps runtime and packet authority unchanged.

### Keep profiler and tmux changes compatibility-only

Decision: Evidence Receipts, exact cohorts, comparisons, and node alignment include exact profile identity, and existing inspector fields surface reconciliation and exact-no-progress dispositions. Scenario schedules use the post-confirmation Event boundary; total run duration may exceed the Event span because profile validation precedes `run-started`, but it may not be shorter. No profiler page, route, export, dashboard, or benchmark framework is added. Interactive benchmark runs create a fresh visible pane in `doubleword:fanout-canary`; tmux remains an operator/runbook boundary and never becomes product authority.

Reason: The current profiler already has the required evidence seams, and pane control is operational evidence collection rather than Fanout behavior.

## 2026-07-13

### Make the event log the only run-state authority

Status: The event-derived state model remains. Versions below are historical; the [current audit/publication contract](ARCHITECTURE.md#audit-and-presentation) also distinguishes post-apply bookkeeping failure and lock retention from ordinary report regeneration. Replay cannot execute work or mutate Git.

Decision: `fanout-core` owns the closed nine-event `fanout.execution-event` v1 union, strict pure lifecycle reducer, execution-run projection v2, and deterministic projection-only report renderer. `fanout-pi` serializes event commits, atomically replaces the complete compact log before derived views, halts after a derived publication failure, and exposes audit-only replay that can regenerate projection/report files but has no execution, budget, lock, or Git mutation capability.

Reason: One gapless causal history makes stale views repairable and keeps live recording, replay, and reports convergent. Whole-log replacement deliberately favors the smallest crash-safe process model over segments or recovery orchestration; the coordinated cutover now routes production callers through this recorder.

### Admit repository authority through one canonical core module

Decision: `fanout-core` owns literal `RepoPath` parsing, explicit file/directory resources, same-source directional authorization, connected ownership, typed read timing, monotonic typed forbidden writes, and exact UTF-8 Git-path admission. Advisory forbidden notes never affect policy.

Reason: Planning and Git-observed changes need one identity-preserving resource contract. The coordinated cutover now uses this module as the sole executable resource authority; no legacy packet/runtime resource fields remain admissible.

### Execute approved validation as direct argv

Decision: `fanout-core` strictly admits executable/argument validation manifests with canonical optional cwd and literal environment overrides. The Pi adapter preflights and rechecks launchability, runs exact argv without an implicit shell, preserves order and duplicates, and records typed fail-fast outcomes including explicit unexecuted commands.

Reason: Deterministic argument boundaries and honest local-program trust replace misleading shell-string safety parsing. The coordinated cutover now makes this runner the production validation path.

### Bind artifacts and repository transitions to exact identity

Decision: Use strict `{ path, sha256, byteLength }` artifact identities, same-directory atomic replacement, pointer-last planning publication, temporary-index full Git-visible trees, and one binary-patch accepted-state transition shape. Patch verification and replay rederive exact paths and trees, consume verified bytes through Git stdin, and leave post-apply ambiguity untouched with the canonical execution lock retained for manual reconciliation.

Reason: Exact bytes and tree chains reject stale or substituted authority without mutating the user's index or adding content-addressed storage and automatic recovery. The coordinated cutover routes all production planning, replay, validation, and apply callers through these primitives.

### Compile one canonical work contract per DAG node

Decision: `fanout-core` owns `fanout.work-contract` v1, with ordered source-linked goals and criteria, typed modify/create/delete/move changes and anchors, typed reads and forbidden writes, direct-argv commands, the fixed six-tool worker profile, and source-tagged advisory notes. Typed change endpoints are the sole stored write authority; graph edges, final-node ordering, warnings, Markdown, Mermaid, launch summaries, and Pi worker prompts derive from admitted contracts and packet-global context.

Reason: One strict contract prevents flattened worker fields, string policy, duplicate command lists, and persisted graph copies from disagreeing. The coordinated cutover now embeds this contract directly in every executable packet v5 node.

### Route correlated attempts through fixed node-global budgets

Decision: `fanout-core` owns provider-agnostic closed stage facts, immutable pre-side-effect attempt allocation, fixed original/retry/fallback/two-validation-repair/two-integration-repair pools, monotonic node attempt identities, correlation by attempt/turn/response/poll/tool-call identity, typed validation/integration recovery evidence, and `fanout.attempt-outcome` v1. Generic providers require correlated Pi turn/tool usage plus local worker timing; instrumented providers additionally require exact terminal response, per-response TTFT, poll, usage, and pricing evidence. Only typed transient facts can retry or fall back, terminal outcomes persist the controller's actual action and allocation transition, and reports derive totals from complete or explicitly partial observed records rather than persisting summed TTFT authority.

Reason: One provider-independent core policy prevents diagnostics, stream text, record order, helper nesting, or provider-specific code from resetting recovery or changing routing. The coordinated runtime now uses this policy for every launch.

## 2026-06-25

### Keep the normal Pi agent loop first

Decision: Start with Pi-native provider integration and prompt/template workflows. Avoid a custom orchestration loop unless benchmarks show the normal loop fails with async latency.

Reason: Pi already handles sessions, tools, prompts, and provider streaming. Extra orchestration adds risk.

### Stub before live endpoints

Decision: Build realtime and async stubs before using live Doubleword endpoints.

Reason: Async latency and live cost make iteration slow; stubs let us validate provider shape, observability, and UX cheaply.

### Observability is part of MVP

Decision: The first working implementation must record timings, TTFT, token usage, cost, polling, tool timings, and errors.

Reason: The project is about proving latency/cost tradeoffs. Without traces, we cannot compare realtime vs async.

### Async tier is polling-first, not streaming-first

Decision: Treat tier 2 as submit-and-poll unless live testing proves streaming is available.

Reason: Doubleword docs describe async Responses with `service_tier: "flex"`, `background: true`, and retrieval by response ID.

### Planning prompt before strict DAG

Status: Historical sequencing decision. The [compiler](#compiler-owns-execution-dag-construction) and bounded executor were subsequently implemented; prompt-first experimentation remains the rationale for delaying machinery until a concrete need existed.

Decision: Keep the DAG idea, but do not build a DAG executor initially. Use planning prompts to ask what must be investigated and what can be parallelized.

Reason: A strict DAG can make the system brittle. Prompt-first planning gives flexibility with less code.

### Predictive coding starts as prompting

Decision: Predictive coding begins as prompts that encourage broad investigation, parallelizable tool calls, and research-plan-execute behavior. Indexing is deferred.

Reason: Prompting may capture much of the benefit without building a repo index.

### Subagents deferred

Status: Historical initial scope. [Isolated Pi subprocess workers](#run-fanout-workers-with-curated-subprocess-context) now implement bounded packet execution. In-extension subagents remain deferred; these are different integration choices.

Decision: Do not build subagents initially.

Reason: Normal Pi does not parallelize multiple provider calls in one session. Subagents may be needed later, but provider stubs and observability should come first.

### Model profiles/fusion deferred

Decision: Defer model routing profiles such as cheap investigator, deep researcher, patcher, and reviewer.

Reason: Useful later, but not needed to validate provider mechanics and async latency.

### Batch tier deferred for active workflows

Decision: Do not make batch a normal interactive provider initially. Treat it as future benchmark/eval infrastructure.

Reason: Batch latency does not fit one active Pi turn. It is better for trace replay, evals, and bulk jobs.

### Use this repo for code and resources

Status: Artifact placement was superseded by [Pi-owned storage](#store-fanout-artifacts-outside-the-repo-by-default). Current publication contents follow the [research-preview decision](#prepare-a-public-research-preview-with-curated-evidence).

Decision: Keep code, docs, fixtures, and sampled traces in this directory.

Reason: The workspace should be self-contained for extension development and benchmarking.

### Stub providers use custom streamSimple

Decision: Register `doubleword-stub` with custom `streamSimple` implementations instead of proxying a live-compatible API shape immediately.

Reason: The custom stream path validates Pi provider mechanics, event ordering, async polling simulation, and observability before any live Doubleword endpoint assumptions.

### Observability writes are best-effort

Decision: JSONL observability writes must not throw through provider streaming.

Reason: Logging failures should not mask provider errors, aborts, or successful stub responses.

### Planning workflow shipped as a prompt template first

Decision: Phase 3 initially started with a planning prompt template instead of extension-enforced plan mode or a custom executor. This was later superseded by `/fanout-plan` execution-packet planning.

Reason: Prompt templates were Pi-native and cheap to test. The prompt proved useful non-mutating exploration and clarification behavior before the workflow moved into packet/DAG preparation.

### Normal execution gets batching discipline through the system prompt

Decision: Inject a lightweight think-ahead batching instruction with `before_agent_start` for every normal Pi run.

Reason: This keeps the normal Pi loop while nudging each turn to batch independent reads, greps, inspections, checks, and disjoint-file edits or writes. Dependent, overlapping, and same-file mutations remain separate.

### Turn count and tool batch size are logged now

Decision: Record `agent_start`, `agent_end`, `turn_start`, and `turn_end` JSONL events, including total turns per agent run and tool calls per turn.

Reason: Phase 6 needs these metrics to judge whether prompt-only batching reduces expensive provider turns enough before building orchestration.

### Phase 4 stays offline but live-shaped

Decision: Expose `glm-5-2` and `deepseek-v4-flash` as realtime stub model IDs with Doubleword pricing metadata before wiring live endpoints.

Reason: This validates Pi model registration, model selection, usage accounting, cost estimates, and observability without API keys, live cost, or endpoint-shape assumptions.

### Live async uses direct Responses polling first

Decision: Add async mode to the opt-in `doubleword` provider. It submits Responses API requests with `service_tier: "flex"` and `background: true`, then polls `/responses/{id}` directly.

Reason: Direct polling preserves queue/status/poll observability and avoids adding Autobatcher or custom orchestration before benchmarks justify it.

### Live realtime uses Responses SSE

Decision: Realtime mode requests `stream: true` and maps Responses SSE text deltas into Pi stream events. Async/flex remains polling because the official Doubleword async docs describe background results as retrieve-by-ID/polling, not response-ID streaming.

Reason: This gives interactive TTFT for the tier that documents streaming-compatible integrations while avoiding an invented async stream contract.

### Phase 6 starts as trace summarization

Decision: Start stub/trace benchmarking with an offline JSONL summarizer over existing observability events, not a trace replay engine or dataset downloader.

Reason: The first benchmark question is whether the current Pi-native loop batches enough work and what async latency/cost looks like. Existing events can answer that before adding replay/orchestration code.

### Normalize raw Pi session traces in the same benchmark entrypoint

Decision: Extend `scripts/benchmark-traces.mjs` to auto-detect raw Pi session JSONL and summarize it alongside extension `observability.jsonl` files.

Reason: Real datasets such as `badlogicgames/pi-mono` are Pi sessions, not Doubleword observability logs. One benchmark command avoids throwaway conversion scripts while still deferring full replay infrastructure.

### Model pricing is tier-specific

Decision: Price `glm-5-2` realtime/tier 1 at $1.40/$4.40 per MTok in/out and tier 2/flex at $1.05/$3.30; price `deepseek-v4-flash` realtime/tier 1 at $0.14/$0.28 and tier 2/flex at $0.10/$0.20.

Reason: Tier 2 comparisons should show the latency/cost tradeoff instead of reusing realtime prices.

### Keep DAG executor deferred after trace-DAG check

Status: Historical conclusion about faithful replay of serial traces. Later [Planned Parallel RPE](#narrow-tier2-workflow-direction-to-planned-parallel-rpe) changed the work decomposition, leading to the implemented compiler and executor; the failed routing premise is not a current executor deferral.

Decision: Do not build a DAG executor from the B0 execution evidence.

Reason: D1 found no off-critical assistant/model turns in the faithful trace DAG. The only trace-backed fan-out is local tool batching, while tier 2 remains useful only for background or batch work outside the active loop.

### Design optimistic DAG workflow before implementation

Decision: Treat optimistic DAG as an opt-in workflow design and benchmark problem before building a strict executor.

Reason: The useful product shape is not faithful replay. It is tier1 planning/synthesis with tier2 background branches, clear deadlines, budget caps, and portfolio-mode concurrency. Benchmarks must separate DAG-only effects from Doubleword tier savings.

### Require semantic trace review for DAG tier claims

Decision: Do not use mechanical first/middle/last trace heuristics as evidence for optimistic DAG savings.

Reason: Manual subagent review showed the heuristic overstated tier2 eligibility. Future DAG/tier claims must account for every JSONL line and mark branches tier2-eligible only when they are semantically off the active path or safe to miss a deadline.

### Split workflow optimization from provider savings

Decision: Treat normal interactive optimization as tier1 semantic batching, and treat Doubleword tier2 as a background execution cost lever.

Reason: Manual semantic review found only ~1.5% tier2 savings in normal interactive traces, but roughly ~25% possible savings from fewer turns/context. Research-plan-execute traces showed ~22% tier2 cost savings only when execution is moved to background, with much longer completion time.

### Use versioned hybrid workflow JSONL fixtures

Decision: Add a local `doubleword.hybrid-workflow` JSONL schema with workflow metadata rows and node rows before implementing policy simulation.

Reason: Parser, graph, provenance, and metadata validation need deterministic fixtures. Keeping the schema explicit lets later simulator workers compare policies without changing existing observability or Pi session trace formats.

### Simulate hybrid policies offline before runtime orchestration

Decision: Implement tier1/tier2 policy comparison as a deterministic offline benchmark simulator with per-node schedules, not as a live DAG executor.

Reason: The mission needs evidence about active TAT, background completion, budgets, deadlines, concurrency, fallback, and speculative waste before changing the Pi runtime loop. Synthetic fixture policy results must remain labeled as synthetic rather than observed trace feasibility.

### Harden speculative and linear infeasibility semantics

Decision: Speculative portfolio winners are selected by completion time and invalid, failed, stale, or conflicting faster branches are rejected and counted as waste before accepting the next valid branch. Linear mandatory critical-path infeasibility is detected from active-boundary graph structure instead of a literal scenario id.

Reason: Portfolio evidence must not accept the fastest invalid branch or hide rejected branch cost/status. Structural infeasibility should keep working when fixture names change.

### Scope hybrid target evidence to synthetic fixtures

Decision: Treat the current <=3x active TAT passes as synthetic fixture-policy evidence unless a workflow source is observed or explicitly trace-derived. Mixed benchmark reports must keep `observability`, `pi-session`, and synthetic `hybrid-workflow` source labels visible, and docs must not describe synthetic passes as observed trace feasibility.

Reason: The mixed run proves parser, simulator, schedule, active/background, and target-accounting semantics across existing and synthetic inputs. It does not prove that existing Pi execution evidence has the same eligible workflow shape, so overclaiming would hide the difference between workflow feasibility and observed execution evidence.

### Use active acceptance boundaries for target comparisons

Status: Historical synthetic-policy metric. Current coding comparisons use [full task accounting](study/METHODOLOGY.md#declare-a-new-comparison), and profiler scenarios use their [post-confirmation execution boundary](#keep-counterfactuals-fixed-behavior-and-post-confirmation). The older active-TAT target must not be substituted for either.

Decision: Hybrid target comparisons use the same fixture-declared active boundary for the tier1 baseline and optimized policies. Background work may be excluded from active TAT only when metadata marks it optional, non-user-blocking, background, or after a next-actionable boundary; mandatory tier2 output needs tier1 review, validation, synthesis, or acceptance before success is claimed.

Reason: The user-facing target is active TAT, not full background completion. Keeping boundary metadata explicit prevents policies from changing the deliverable, hiding mandatory tier2 latency, or omitting review cost while claiming a target pass.

### Narrow tier2 workflow direction to Planned Parallel RPE

Decision: Treat RPE background execution and sharded RPE as the primary useful tier2 directions. Keep generic tier2 DAG routing and default speculative duplicate implementation deferred.

Reason: Manual multi-turn Pi trace review found weak tier2 savings for generic interactive DAG routing, while one-turn synthetic fixture passes only prove simulator semantics. Duplicate implementations often repeat research, contend for files, create merge/review overhead, and waste tier2 budget unless independence and cancellation are explicit.

### Require prefix trace evaluation before runtime parallel RPE

Decision: Before implementing runtime Planned Parallel RPE, run a retrospective prefix-based evaluation over `pi-mono` traces to test whether GPT-5.5 can predict safe independent work units from partial context.

Reason: Planned Parallel RPE depends on safe decomposition before the full trace is known. The evaluation should compare prefix-time predictions against full trace suffixes for file ownership conflicts, dependencies, validation needs, cancellation cases, and review requirements. This will produce trace-derived evidence, separate from synthetic simulator evidence and separate from future live runtime TAT claims.

### Keep safe-work-unit evaluation artifact-driven and offline

Decision: The safe-work-unit evaluator consumes local Pi traces plus structured prediction JSONL artifacts. It does not call GPT-5.5, Doubleword, or any provider while scoring.

Reason: The evaluation is meant to measure planner reliability from prefix-visible context against suffix retrospective evidence. Keeping prediction capture outside the evaluator makes smoke tests deterministic, preserves offline validation even when provider credentials are present, and prevents reports from being mistaken for runtime TAT evidence.

### Define Planned Parallel RPE safety boundaries

Status: Historical workflow proposal, not an inventory of implemented capabilities. The [current architecture](ARCHITECTURE.md) defines bounded subprocess execution and controller validation; parallel reviewers and speculative pre-confirm cancellation in this proposal are not promised runtime features.

Decision: Planned Parallel RPE requires a tier1 planner, conflict-aware scheduler, isolated background executors, parallel reviewers, cancellation for speculative pre-confirm work, file ownership constraints, and final tier1 review/synthesis before acceptance.

Reason: Tier2 execution is useful only when latency is hidden behind an explicit next-actionable boundary and outputs cannot corrupt the active worktree. Isolation, ownership, cancellation, and review make cost savings auditable without implying live runtime TAT has improved yet.

## 2026-06-26

### Route Planned Parallel RPE by accepted DAG critical path and user wait budget

Status: Historical routing model. The ten-minute multiplier is an assumption from that evaluation, not a current provider guarantee or implemented adaptive routing rule. The [study model](STUDY.md#modeled-feasibility-overlap-versus-overhead) distinguishes DAG depth, sequential requests and configured concurrency.

Decision: Planned Parallel RPE scheduling should use accepted safe-unit DAG critical path and the user's background wait budget, not a hard raw-depth cutoff or prefix-time cutoff. Conservative routing estimates tier2 execution wait as `accepted_dag_depth * 10m` until live tier2 measurements prove a tighter bound.

Reason: Full `pi-mono` TAT bucket evaluation showed long decomposable traces can compress remaining realtime execution into shallow tier2 DAGs, while short traces lose to tier2 latency. DAG depth is only meaningful relative to remaining work, width, cost, and the user's acceptable background wait.

### Prefix time is not a hard RPE routing guard

Decision: Do not reject a Planned Parallel RPE job solely because the planning prefix is late in the original trace.

Reason: If no execution remains, there is simply no job to launch. If execution remains, routing should be decided by safe units, acyclic dependencies, file ownership, validation contracts, cost, and user wait budget.

### Scheduler must reject cycles and ownership conflicts before tier2 launch

Decision: Runtime RPE scheduling must reject cyclic dependency graphs and overlapping owned files or mutable resources unless explicit serialization is applied.

Reason: A retrospective prediction produced a cyclic code-shard graph that the evaluator scored as safe-after-dependency at the unit level. Runtime scheduling needs graph-level validation before launching background executors.

### Finish evidence cleanup before runtime/plugin restructuring

Decision: Before merging this experiment branch or starting plugin restructuring/runtime RPE work, package the evidence into reproducible fixtures and protocol docs.

Reason: The current branch contains useful trace-derived direction. Merging should preserve the experiment as a reusable evidence base with tracked prediction artifacts, protocol docs, and validation rather than as an implicit conversation-dependent result.

## 2026-07-05

### Doubleword provider owns model reasoning and tier metadata

Status: Superseded on 2026-07-16 by [the Fanout adapter ownership decision](#keep-fanout-capability-metadata-in-the-fanout-adapter).

Decision: Fill missing Doubleword `/v1/models` metadata in the provider by marking generation models reasoning-capable, OCR/embedding models non-reasoning, mapping Pi thinking levels to top-level `reasoning_effort`, and attaching realtime/async/batch Fanout tier metadata. Preserve live catalog metadata if Doubleword adds it later.

Reason: Pi needs `reasoning` and `thinkingLevelMap` for `Shift+Tab` thinking control, while Fanout consumers need tier capability metadata without coupling Fanout planning logic to Doubleword model-name rules.

## 2026-06-30

### Publish standalone Doubleword provider extension package

Decision: Publish the standalone Doubleword provider extension as `@snehalyelmati/pi-doubleword-provider`, independent from Fanout release order.

Reason: The provider has a clear standalone extension-package boundary: it registers the live `doubleword` provider for Pi, while dev-only stubs remain outside the packed npm package. Publishing it separately lets users install Doubleword support without Fanout.

### Split Fanout into user research, execution packet, and execution

Decision: Make Fanout a three-phase workflow: user-owned research/planning, `/fanout-plan` execution-packet preparation, and `/fanout-execute` execution of the active accepted packet.

Reason: Keeping research/planning outside Fanout lets users use their own workflow and gives the executor better inputs. The exact packet-v5 boundary lets Fanout validate typed work contracts, derived DAG authority, immutable runtime policy, and validation manifests before any worker mutates files.

### Keep `/fanout-plan` non-mutating

Decision: `/fanout-plan` may inspect repository context and prepare artifacts, but it must not edit project files or run destructive commands while building the execution packet.

Reason: Phase 2 exists so users can review the plan, DAG, estimates, ownership, validation, and risks before any worker changes the repo.

### Validate the DAG during packet preparation

Decision: Packet preparation first creates fanout-agnostic work units with ownership, dependencies, validation, and acceptance criteria; then it builds the execution DAG, validates cycles/conflicts/unresolved decisions during planning, and only then optimizes worker and tier choices.

Reason: Separating work-unit planning, DAG validation, and execution optimization keeps Fanout core independent from Pi, Doubleword, and the eventual worker implementation while still catching unsafe packets before execution.

### Keep planning behavior inside packet preparation

Decision: Fanout-agnostic packet planning should explore first, ask only for non-discoverable intent/tradeoffs, stay non-mutating, and produce a decision-complete active packet. Remove the old planning prompt instead of maintaining a second planning surface.

Reason: The useful behavior belongs inside `/fanout-plan` packet preparation. Keeping a separate planning prompt would split planning semantics and create a stale path outside the packet/DAG/execution flow.

### Execute the active packet by default

Decision: `/fanout-execute` executes the active accepted packet instead of requiring a packet path argument.

Reason: The normal workflow is plan, review, then execute the current packet. Avoiding an argument keeps the command simple; explicit packet selection can be added later only if multiple active packets become a real need.

### Store the active packet as a pointer

Decision: Fanout stores `active-packet.json` as a pointer to the latest executable ready packet instead of duplicating the full packet.

Reason: The packet artifact remains the single source of truth, while `/fanout-execute` still has a stable default lookup path.

### Store Fanout artifacts outside the repo by default

Decision: `/fanout-plan` writes packet artifacts under Pi-owned storage, defaulting to `~/.pi/agent/fanout/<project-id>/`, with `FANOUT_ARTIFACT_DIR` as an override.

Reason: Execution packets are agent artifacts, not source changes. Keeping them out of the repo avoids accidental commits while preserving user-reviewable files across sessions.

### Require decision-complete planning before packet finalization

Decision: `/fanout-plan` should explore first, then ask one user question at a time with `ask_user_question` for non-discoverable intent/tradeoffs, and only write/update the active packet once the plan is decision-complete.

Reason: Blocked packets are poor UX for normal file-change planning. The packet should represent accepted execution intent; unresolved intent should remain an interactive planning question.

### Reuse existing worker infrastructure before custom orchestration

Status: Superseded on 2026-07-09 by the isolated subprocess decision below.

Decision: `/fanout-execute` should start with native Pi subagents or an existing popular subagent package. Build custom worker orchestration only if isolation, queueing, cancellation, or visibility cannot be handled by existing infrastructure.

Reason: Worker frameworks are expensive to build and maintain. The execution packet should prove the scheduler contract before Fanout adds its own orchestration loop.

### Prefer direct async endpoints before Autobatcher

Decision: Use direct Doubleword async endpoints for the first `/fanout-execute` implementation. Add Doubleword Autobatcher only if it materially improves queueing, retries, cancellation, failure handling, or throughput.

Reason: Direct endpoints are the smallest integration that can validate packet execution and metrics. Autobatcher should be justified by observed execution needs, not assumed up front.

## 2026-07-07

### Benchmark Fanout DAG prompts before executor work

Decision: Use artifact-driven prompt-DAG benchmark loops before changing `/fanout-plan` DAG wording or building `/fanout-execute` orchestration. Each scoring loop uses a fresh shell-launched Pi process, GPT-5.5 medium when supported, multiple prompt variants, known plus heldout tasks, generator/evaluator subagents, and ignored artifacts under `runs/fanout-dag-prompt-experiments/`.

Reason: The current bottleneck is prompt quality for safe parallel DAGs, not executor mechanics. Fresh-process loops reduce session contamination, heldout tasks reduce overfitting, and persisted artifacts make prompt changes auditable.

### Graduate prompt candidates only under strict P0 thresholds

Decision: A prompt-DAG candidate graduates only when average score is greater than 4.90, minimum task score is greater than 4.85, and evaluator artifacts show no task-specific hardcoding, ownership blocker, or repeated false serialization of tests/docs/fixtures behind implementation.

Reason: The benchmark is cheap and prompt-only, so the threshold should be high. Passing P0 is still only a prompt-quality signal; the prompt must be revalidated under `/fanout-execute` smoke and execution benchmarks before becoming a runtime default.

### Promote durable prompt benchmark summaries, not raw runs

Historical decision: keep raw prompt-DAG generator/evaluator artifacts ignored under `runs/` and promote durable results into tracked benchmark notes. The September 16 publication policy supersedes copying full recorded prompt text: publish scores, strategy summaries and generic experiment templates only; preserve recorded prompt bodies locally.

Reason: Raw artifacts are useful for local audit but too noisy to commit. Tracked summaries preserve benchmark results and procedures; public materials do not reproduce historical prompt payloads.

## 2026-07-08

### Split `/fanout-plan` into explicit implementation and detail prompts

Status: Historical model-call structure, superseded by the [2026-09-06 combined-planning decision](#optimize-sequential-provider-requests-with-combined-planning-and-prepared-workers). One model investigation now submits both plan and details; their separate persisted authority and provenance remain. The packet generation described below was superseded on 2026-07-14 and by later cutovers; its rationale is retained as history.

Decision: Keep one `/fanout-plan` command, but run two explicit prompts plus a deterministic compiler. The controller envelopes Phase A as plan v2 and Phase B as details v3, binds their exact identities, and compiles packet v5 nodes containing one work-contract v1 each. `fanout-core` groups typed change resources, derives dependencies from typed `post-change-required` reads, assigns tiers, and stores authoritative integrated validation only in the final-validation contract.

Reason: Implementation planning, repo grounding, and execution compilation are different jobs. The intermediate artifacts make failures debuggable, keep Phase B from inventing scope or DAG shape, and let code enforce ownership/dependency rules consistently.

### Compiler owns execution DAG construction

Status: Compiler ownership and repair boundaries remain. The [September audit](#apply-the-approved-fanout-audit-cutover) refined the mandatory split pass below into guidance that weighs useful parallelism against setup/context overhead, and permits exact source-attributed baseline reads without exhaustive Phase A membership. [Combined planning](#optimize-sequential-provider-requests-with-combined-planning-and-prepared-workers) subsequently joined the model investigations while preserving logical plan/grounding authority.

Decision: Phase A decides what/why and maximum typed scope; Phase B supplies typed changes, anchors, reads, forbidden writes, and direct-argv validation; the compiler owns grouping, DAG derivation, and tier assignment. Phase A boundaries follow independent authorability, scoped validation, and repair authority rather than file categories or standalone-release usefulness: a work item is a worker ownership and repair boundary and may rely on eventual completion of other accepted plan items. Production and behavioral-test writes belong to one item when focused validation can reasonably fail in a way that requires repairing production code across the proposed boundary; a dependency edge is not a substitute for shared repair authority. A split pass then separates every remaining independently authorable and repairable change with disjoint write authority and sufficient scoped validation. Split items declare genuine typed reads honestly and never pad reads to trigger fusion. Phase B uses `baseline-context` whenever planning-base contents are sufficient and reserves `post-change-required` for a specific accepted upstream change whose reason explains why the baseline is insufficient; convenience, precautionary, redundant, and transitive dependencies are rejected. Every Phase A write remains covered by same-source Phase B changes. A cross-node Phase A read must receive typed Phase B timing; after one unsuccessful Phase B repair, the compiler may insert a typed `post-change-required` read with `timingSource: "sequential-fallback"`, which derives both the conservative edge and its warning. No prose, formatted diagnostic, persisted graph, or worker handoff copy controls scheduling.

Reason: Prompted DAG construction was too easy to overfit or over-serialize. File-category splitting produced a test-only repair boundary that could detect but not repair its production defect, while treating each item as a standalone release falsely serialized independently owned types and documentation. Worker-boundary authorability, sufficient scoped validation, independent repairability, deterministic grouping, and typed read-dependency rules keep authority honest without weakening compiler fusion predicates.

### Advance `/fanout-plan` from artifacts, not prompt markers

Decision: `/fanout-plan` phase handoff is driven by pending run state and expected artifacts. Prompt markers remain diagnostic only. After compilation, the chat report is the deterministic `execution-plan.md` rendered from the packet, not an LLM-authored final report.

Reason: Live Phase B produced `implementation-details.json` but skipped compilation when the prompt-marker handoff state was absent. The artifacts are the durable source of truth, so the adapter should validate and compile from them directly.

## 2026-06-29

### Add live realtime as a key-gated provider

Decision: Register `doubleword` as an opt-in live provider using the Responses API with `service_tier: "priority"`, while keeping `doubleword-stub` for default checks.

Reason: Tier 1 should be testable through Pi without replacing the offline stub path or requiring live credentials in normal validation.

### Keep batch as smoke/probe, not interactive Pi provider

Decision: Validate tier 3 with a key-gated batch create/retrieve/cancel smoke script instead of registering it as a Pi streaming provider.

Reason: Batch jobs return files over long windows and do not fit Pi's interactive `streamSimple` response contract.

### Map Doubleword reasoning to Pi thinking blocks

Decision: Convert Responses `reasoning` items to Pi `thinking` content and only emit message `output_text` as assistant text.

Reason: Pi has first-class thinking blocks. Mixing reasoning summaries into user-visible text corrupts normal answers while losing trace structure.

### Use full Doubleword model IDs for live providers

Decision: Live providers expose Doubleword's full model IDs, such as `deepseek-ai/DeepSeek-V4-Flash`, while stubs may keep short local aliases.

Reason: Live `/responses` rejected short aliases; `/models` returns provider-qualified IDs.

### Split Fanout from Doubleword provider support

Decision: Structure the repo as a minimal monorepo with `doubleword-provider`, `fanout-core`, and `fanout-pi`.

Reason: Doubleword provider support answers “how do I call this model/tier?”, while Fanout answers “how do I split, schedule, validate, and review work safely?”. Keeping them separate lets users install the provider alone, use Fanout without Doubleword, and add non-Pi adapters later only when needed.

### Keep Fanout package count minimal

Status: The limit expanded to four concrete workspaces when the [local profiler](#add-one-private-bun-profiler-package) acquired its own filesystem/HTTP boundary. A generic adapter framework and extra CLI package remain deferred.

Decision: Do not add a CLI package, generic adapter framework, or separate repos yet.

Reason: Pi is the only concrete adapter today. Three packages are enough to preserve boundaries without adding release and build overhead.

### Cache Doubleword model discovery from the provider

Decision: Discover live Doubleword models from `/v1/models` when an API key is available, cache the catalog locally, and fall back to the cached catalog or the minimal GLM/DeepSeek list when discovery is unavailable.

Reason: Pi custom providers need models registered during extension startup. Provider discovery keeps the model list current without making startup depend on live network availability.

### Decouple Doubleword execution tier from model names

Decision: Register only `doubleword` and `doubleword-stub` providers whose model IDs stay stable while `Alt+T` or `/doubleword-mode` toggles `realtime` vs `async` execution. Show the status-line toggle only when the selected provider supports multiple tiers.

Reason: Tier is an execution policy, not a model identity. Keeping the toggle conditional avoids clutter for single-tier providers, and not registering tier-named aliases avoids duplicate model-list entries.

### Define Doubleword async cancellation and timeout semantics

Decision: Live async uses a 10 minute wall-clock timeout, sends `max_output_tokens` capped at 16k by default, retries transient poll failures, performs one final GET before timeout failure, and best-effort cancels background responses on timeout or user abort.

Reason: Async Responses jobs can outlive the Pi turn. Local abort must stop immediately, timeout should not discard a just-completed result, and remote cancel should avoid orphaned background work without masking the original abort or timeout.

## 2026-07-09

### Require complete metrics for accepted Fanout workers

Status: Superseded by the [September measurement decision](#apply-the-approved-fanout-audit-cutover) and [current attempt policy](adr/0005-route-attempts-from-typed-facts-and-fixed-budgets.md). Repository acceptance requires observed assignment identity and passing gates, permits valid partial measurements, and rejects invalid supplied evidence; complete comparison totals remain unavailable when measurements are missing.

Decision: `/fanout-execute` must reject accepted LLM worker results that lack provider, model, tier, token, cost, pricing source, TTFT, poll, tool, and worker-duration metrics. Failed or rejected workers may keep partial diagnostic metrics, but accepted workers cannot use null placeholders or guessed token estimates.

Reason: Phase 3 exists to compare workflow and provider-tier tradeoffs. Accepting patches without complete metrics would make the execution evidence unusable.

### Run Fanout workers with curated subprocess context

Decision: Phase 3 workers run as non-interactive Pi subprocesses in isolated git worktrees with curated Fanout prompts and no automatically loaded context files. The main session owns planning, approval, and user interaction; the worker prompt receives packet-approved context plus applicable repo-local `AGENTS.md`/`CLAUDE.md` instructions explicitly selected from root/ancestor directories for owned and read-only paths. Workers must not ask for confirmation or broaden scope. Automatically discovered Pi extensions are a separate trusted runtime boundary, as recorded below. This supersedes the earlier preference for native Pi subagents or a third-party worker package.

Reason: The Phase 3 contract needs a fresh git worktree per attempt, attempt-scoped stdout/stderr/session/observability artifacts, mandatory metrics, and exact subprocess lifecycle classification. The available main-session loop does not expose those boundaries as one native subagent primitive. Automatic context discovery may also load global or unrelated instructions containing main-session rules such as planning and waiting for approval; explicit repo-path-based selection preserves applicable project constraints without inheriting that broader interactive context.

### Allow only typed bounded execution recovery

Status: Typed recovery and fixed budgets remain. Later decisions refined the blanket rejected-candidate seeding exclusion below: unauthorized candidates are discarded before a clean retry, while verified candidates rejected by validation may seed the next repair under the [cumulative-continuity decision](#preserve-rejected-repair-candidates-cumulatively). Rejected bytes never enter the accepted ledger on that basis alone.

Decision: `/fanout-execute` may run bounded tier1 recovery for two typed cases: validation-failure repair and integration-conflict repair. Retry/fallback handles retryable tier2 worker/provider failures. An original candidate rejected as `unauthorized-change` may also consume the node's existing clean retry: the controller discards the whole candidate and launches the same assignment and unchanged work contract in a fresh reconstruction of the latest accepted ledger. A repeated unauthorized change, an exhausted retry pool, and every `forbidden-change` fail without another launch. Generic repair agents, scope expansion, ownership expansion, partial patch application, rejected-candidate seeding, and arbitrary retries remain out of scope.

Reason: Valid worker output can still fail local validation or conflict with already-applied parallel patches, while a worker can complete useful work but exceed explicit ownership. One clean rerun can recover scope obedience without trusting or trimming unauthorized bytes. Typed bounded recovery preserves safety while avoiding an open-ended repair loop.

### Anchor execution artifacts to the loaded packet path

Decision: The execution recorder derives `<packet-artifact-dir>` from the admitted packet path and writes `executions/<run-id>/` there; packet v5 contains no competing artifact-directory authority.

Reason: The validated pointer identifies the packet source of truth. Reusing an independently supplied artifact path would let packet content redirect audit writes away from that source.

### Require a clean active worktree without claiming stale-HEAD detection

Status: Superseded on 2026-07-14 by packet v5 exact planning commit/full-tree/platform admission.

Decision: `/fanout-execute` admits pointer v2 and packet v5 before side effects, then preflight requires execution artifacts outside the repo, an exact planning commit/full Git-visible tree/platform match, safe typed resources and direct validation commands, and an available worker capability.

Reason: Exact planning identity makes integrated patches attributable and rejects both dirty and clean-but-stale checkouts without inferring freshness from timestamps.

### Rebuild accepted integration state in fresh detached worktrees

Decision: Every worker, retry, fallback, and repair attempt gets a fresh detached worktree at the exact planning commit. The controller rebuilds accepted state only by replaying the ordered ledger's digest/length-bound binary patch artifacts. Every transition must match its recorded base tree, result tree, changed paths, and patch statistics. Reconstruction does not create baseline commits or admit owned-file snapshots as authority. Fanout disables repository Git hooks and configured filesystem-monitor commands during managed worktree creation, patch capture, and execution preflight.

Reason: A detached worktree at the planning commit omits accepted uncommitted changes in the active worktree. Exact causal patch replay reconstructs that state without introducing a second commit/snapshot authority, while preserving attempt isolation and downstream visibility. Disabling hooks and filesystem monitors prevents repository-configured commands from adding unrecorded state to the boundary.

### Serialize active-worktree patch application

Status: Lock location and stale-lock handling were refined by the canonical git-worktree lock decision below; serialized apply remains. Admission and preflight ordering now follows the [current execution contract](ARCHITECTURE.md#execution), including cheap invalid-base checks before dynamic work, rather than the historical blanket “before preflight” order below.

Decision: `/fanout-execute` acquires the exclusive canonical git-worktree lock described below before preflight. Within that run, parallel workers may execute concurrently, but each active-worktree `git apply --check` and matching `git apply` runs inside one serialized apply gate.

Reason: The check and apply must observe the same integrated state. The project lock prevents separate Pi sessions from integrating divergent packet runs into the same worktree, while the in-run gate prevents parallel nodes from interleaving their checks and applies.

### Use Pi JSON usage as the worker pricing source

Status: Historical accounting/admission details. [Reviewed pricing snapshots](#synchronize-exact-doubleword-pricing-into-reviewed-snapshots) and the [September measurement decision](#apply-the-approved-fanout-audit-cutover) supersede mandatory instrumentation completeness and the old pricing-source rules. Exact assignment, correlation and supplied-evidence validation remain required; missing totals are unavailable.

Decision: Worker tokens and estimated cost come from Pi JSON assistant `message_end` usage. Generic providers are recorded with pricing source `pi-json-usage`; Doubleword workers additionally require matching `provider_end` events whose provider-supplied input, output, total, and cost values equal the Pi message values and whose pricing provenance is `doubleword-model-metadata`. Doubleword fallback word-count estimates and synthetic stub usage cannot be accepted. Tier2 poll metrics require matching `async_poll` records or matching provider completion records that explicitly report zero polls. TTFT uses provider `provider_ttft` timing when available and otherwise the parent's measured time to first assistant output.

Reason: Pi JSON provides the provider-agnostic usage shape, while Doubleword observability distinguishes API-reported tokens from compatibility estimates and identifies the price table. The measured TTFT fallback is a local clock fact; no token or timing values are inferred to fill gaps.

### Define no-op, partial-failure, and final-validation semantics

Status: Current after the 2026-07-14 fresh-reconstruction cutover.

Decision: A work unit with zero owned files may succeed with an empty patch; a mutating unit may not. Any failed or skipped DAG node maps the run to `failed` rather than a separate partial status. The packet's final-validation node is coordinated as a controller gate: it replays the exact accepted ledger into a fresh reconstruction and runs the ordered final-validation commands there. Only exact evidence from that reconstruction, plus any separately reconstructed and ownership-checked bounded repair candidate, may authorize overall success and verified active apply.

Reason: The compiler emits a read-only final-validation unit, while mutating units must produce reviewable changes. One failed terminal status keeps reporting unambiguous, and fresh reconstruction prevents validation side effects or ignored residue in the active checkout from becoming success authority.

### Keep automatic Pi extension discovery for workers

Decision: Worker subprocesses explicitly load the Fanout extension, keep Pi's automatic extension discovery enabled, and pass `--approve` so trusted project-local Pi resources can load without an interactive trust prompt. `--no-context-files` disables Pi's automatic `AGENTS.md`/`CLAUDE.md` context loading; the parent separately selects and injects the applicable repo-local instruction files into the worker prompt. Enabled extensions and their hooks/tools are trusted runtime code, not packet-approved prompt context.

Reason: Packet-assigned providers and models may be registered by installed or project extensions, so `--no-extensions` would make valid worker assignments unavailable. This expands the worker trust boundary and must remain explicit; worktree isolation and patch ownership gates do not sandbox extension side effects.

### Lock by canonical git-worktree identity

Decision: Normal and dry execution acquire `fanout-execution.lock` under the canonical absolute git directory for the active worktree, falling back to the project artifact root only when git-directory resolution is unavailable. The owner removes its lock on normal return. An existing lock is authoritative and is never deleted automatically based on PID or an inferred stale state.

Reason: Canonical git-directory identity makes sessions launched from different subdirectories share the same worktree lock, while distinct linked worktrees can proceed independently. Automatic stale deletion risks PID reuse and concurrent mutation; recovery requires the user to verify that no execution is active before removing the reported lock path.

### Keep Phase 3 attempt budgets fixed

Status: The fixed attempt budgets remain current; the Tier 1 control-model fallback was superseded on 2026-07-10 by [the realtime `tier2Fallback` model-role decision](#separate-the-tier-2-fallback-model-role-from-tier-1).

Decision: `/fanout-execute` consumes concurrency, fail-fast, and fallback permission only from the admitted packet-v5 `runtimePolicy`; current settings cannot change an accepted packet. The MVP policy fixes tier1 and tier2 to one original attempt plus one clean rerun, permits one realtime fallback after retryable tier2 exhaustion when the work unit declares it, and permits at most two validation-repair and two integration-repair attempts. Provider availability is not preflighted and a node failure never globally reroutes remaining tier2 nodes.

Reason: Fixed per-node budgets keep scheduling, cost accounting, and recovery deterministic while the first execution path is validated. Provider/model launch errors remain typed subprocess outcomes rather than a reason to mutate the accepted packet's assignments.

### Route every worker launch through canonical attempt evidence

Status: Canonical attempts and typed routing remain. Packet adaptation was removed by the hardened cutover; generations and measurement semantics changed again in the [September audit](#apply-the-approved-fanout-audit-cutover). The [current publication order](ARCHITECTURE.md#audit-and-presentation) records accepted transitions after verified active apply and retains the lock if that bookkeeping fails.

Decision: The packet-v5 executor launches every node from its embedded canonical work contract, allocates original, retry, fallback, validation-repair, and integration-repair launches through the core fixed-budget state machine, and publishes one typed terminal outcome before allocating a successor. Only a committed accept outcome may enter the accepted ledger. Ownership and dependencies derive only from typed contracts. Retryability comes from process or provider facts correlated to the attempt; human-readable stderr is diagnostic only. Accepted metric outcomes preserve observed Pi turn, provider response, poll, and tool-call identities, with parent first-output timing separate from provider response TTFT.

Reason: Launch counters, prose path extraction, and diagnostic substring routing create competing authorities for budgets, ownership, and recovery. Canonical allocation, work-contract, recovery, metric-correlation, and terminal-outcome records make the exact patch and evidence chain reviewable.

### Render execution reports from audit state

Decision: Terminal `summary.md` is rendered deterministically from execution-run projection v2. It reports mode, phase, causal terminal outcome, per-node status/attempt counts, token/cost/timing totals, aggregate accepted patch statistics, accepted-ledger attempt/tree transitions, final-validation disposition, and stable links to `events.jsonl`, `execution-run.json`, and `summary.md`. It does not invent changed-file lists or direct final-validation evidence links that projection v2 does not contain. No generic stage-event counts or LLM synthesis reconstruct execution policy.

Reason: The user-facing report must agree with `events.jsonl` and the derived projection. Projection-derived reporting makes failures and wasted attempts inspectable without introducing another model-authored interpretation layer or a competing evidence index.

### Require node validation to preserve the captured patch

Decision: After node validation commands finish, `/fanout-execute` verifies that the isolated worktree diff still exactly matches the captured patch and that its detached `HEAD` did not move. Any validator-created, reverted, deleted, or committed change rejects the attempt before active-worktree apply.

Reason: A validation command can have side effects. Applying the pre-validation patch after testing a different tree would make the validation evidence false, even when the command exited successfully.

### Keep Git-observed paths lossless at the ownership boundary

Decision: Every artifact and runtime boundary admits repository paths through the canonical typed file/directory resource parser. Git-reported names are decoded and validated without trimming whitespace, converting separators, or inferring type; any lossy identity fails closed. Executable commands use only the direct-argv shape of executable, ordered arguments, optional canonical cwd, and literal environment overrides. Forbidden-write authority is typed and monotonic; prose and legacy directory strings have no executable role.

Reason: On POSIX, backslashes and leading/trailing spaces are valid filename bytes. Lossy normalization could make an undeclared root file appear to be an owned descendant while `git apply` still targets the original filename.

## 2026-07-11

### Review generated execution packets semantically

Decision: Review generated plans against required behavior, ownership, dependencies, safety boundaries, and authoritative validation rather than textual equality with benchmark examples. Safe, non-mutating, task-traceable additions are acceptable. Command wrappers are operational conveniences, not correctness requirements. Rendered summaries may omit detail only when the omission is clearly labeled and the authoritative packet remains unambiguous.

Reason: Model-grounded plans can express the same safe execution contract with harmless command or presentation differences. Treating those differences as failures overfits the benchmark, while unlabeled contradictions still make review unreliable.

### Label dry-run execution summaries explicitly

Status: Superseded on 2026-07-14 by the unified projection-v2 execution report.

Decision: Render every terminal `summary.md` as `Fanout Execution Report`. Dry runs remain explicit through `Mode: dry-run`, the `dry-run-completed` outcome, and final-validation disposition `not-run (dry-run)`; workers remain pending because no attempt is allocated.

Reason: Explicit typed fields distinguish preflight-only completion from live completion while keeping one deterministic report schema and title.

## 2026-07-10

### Treat Phase A as the resolved objective source

Decision: `/fanout-plan` preserves the invocation text for traceability, but Phase A plan v2 owns the resolved objective after reading referenced context. Phase B details v3 binds the exact accepted plan identity and does not repeat the objective. The adapter validates Phase A against its controller-owned artifact destination rather than the invocation string.

Reason: File references and shorthand invocations are inputs to planning, not necessarily the final execution objective. Exact invocation equality rejected correct, more specific plans; repeating the objective in details would create duplicate authority.

### Keep main-session Fanout telemetry outside target repositories

Decision: The Fanout adapter routes its common session and bundled Doubleword telemetry to Pi-owned project artifact storage unless `DOUBLEWORD_OBSERVABILITY_FILE` explicitly overrides it. Common adapter events use `sessionRunId`, bundled provider events retain the legacy field name `runId`, and both values identify the same Pi session; planning events add `planRunId`. Execution audit schemas remain unchanged.

Reason: Repository-local startup telemetry dirtied target worktrees and then failed Fanout's own clean-worktree preflight. Separate identifiers keep session and planning scope unambiguous.

### Configure tier2 only with currently usable models

Decision: `/fanout-config` lists tier2 models only when `fanout.async`, `fanout.background`, and `fanout.authReady` are all true. Tier1 remains unrestricted, and unavailable tier2 configuration does not add a planning confirmation step.

Reason: Reporting configuration success for an unusable model hid deterministic realtime `tier2Fallback` routing and made the selected routing policy misleading.

### Separate the Tier 2 fallback model role from Tier 1

Decision: Keep two execution tiers but store three concrete model roles in execution packet v5: Tier 1 realtime control plane, Tier 2 async workers, and Tier 2 fallback realtime execution. The fallback role inherits Tier 1 unless `fanout.execution.tier2Fallback` selects another registry model. Tier2-unavailable compilation and exhausted retryable Tier 2 attempts use the fallback role; Tier 1 control work and typed recovery continue using Tier 1. Older packets require replanning and are not migrated.

Reason: A strong control-plane model should not force every realtime execution fallback to use the same expensive model. A packet-level concrete fallback keeps execution deterministic without adding a third tier, per-node profiles, or runtime replanning.

### Keep Tier 1 synchronized with Pi

Decision: Tier 1 always uses Pi's current model and thinking level. `/fanout-config tier1` changes that Pi state through `setModel()` and `setThinkingLevel()` rather than persisting an independent `fanout.tiers.tier1` override. Legacy overrides are ignored and removed when Tier 1 is next configured. Fanout reads supported thinking levels from Pi instead of maintaining its own interpretation of provider maps.

Reason: One model source of truth prevents the interactive session and Tier 1 control plane from drifting, while Pi's registry already owns provider models, capability maps, clamping, authentication, and model-change events.

### Allow users to disable Tier 2 routing

Decision: Tier 2 remains enabled by default when its configured model is usable, but `/fanout-config tier2` may explicitly set `fanout.tiers.tier2.enabled` to `false`. Newly planned packets then assign eligible workers to the concrete realtime `tier2Fallback` role. Selecting a Tier 2 model re-enables async routing; existing accepted packets keep their concrete assignments.

Reason: Users need a simple way to run the control plane and worker plane with two realtime models without editing JSON manually or weakening packet determinism.
