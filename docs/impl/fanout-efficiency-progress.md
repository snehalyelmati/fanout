# Fanout efficiency progress

Status: blocked pending approval for the proposed candidate-submission experiment. The user directly authorized commits; approved implementation and bounded p-map measurements are complete. The high-latency E2E objective remains unmet.

## Objective and authorization

Make Fanout cheaper than raw Pi with similar or lower full end-to-end completion time when workers use providers with approximately 60 seconds latency per model request. Reduce sequential remote requests and repeated context, not just increase worker count.

The user approved the staged implementation plan and requested an active goal and progress tracker. The benchmark task is **p-map AbortSignal**, replacing Execa for this investigation because its full suite is much shorter. Start with the matched three-mode pilot; the proposed larger cohort is not started. The updated goal authorizes atomic commits after the code-review skill has reviewed the changes.

Baseline Fanout revision: `07db63f`. Preserve historical runs and benchmark prices. Current measurements are evidence, not predictions for another provider.

## Decisions and scope

- Merge model planning Phase A/B into one context and combined submission; retain deterministic validation/compilation and the existing persisted plan/details/packet contracts.
- Reuse approved execution profiles and supplied conversation findings. Keep semantic planning sharp; the planner must not implement the task.
- Preload bounded, source-tagged actual worker code/test context from the proper baseline or reconstructed candidate. Retain Pi tools and target one or few responses without promising one-shot correctness.
- Preserve substantial independently executable and repairable units; keep coupled runtime and behavioral tests together.
- Enforce typed write ownership before edit/write, retaining the complete patch audit. Bind permissions to the verified attempt manifest.
- Align validation with ownership and compact duplicate repair prompt material. Retain complete audit records, candidate continuity, Tier 1 validation repairs, fixed budgets and independent controller acceptance.
- Keep isolation, direct argv, exact identities, immutable accepted state and final validation unchanged.

## Progress

| Stage | Status | Validation/evidence | Next step |
| --- | --- | --- | --- |
| 0 — Tracker and decisions | Done | Scope and decisions recorded | Keep measurement evidence current |
| 1 — Combined planning | Implemented, focused checks pass | One-context SDK lifecycle/retry/compaction, combined compile, mutation rejection, plan-bound fallback | Passed full suite and both review axes |
| 2 — Prepared worker context | Implemented, focused checks pass | Baseline/current repair bytes, omissions, wide-directory bounds | Public-contract worker starts with edits; runtime still rereads |
| 3 — Ownership and repair efficiency | Implemented | Manifest v2 immediate writes, scoped validation guidance, compact final repair plus recovery.json | Full executor checks pass; no live ownership/recovery event in pilot |
| 4 — p-map measurement | Complete | Raw/improved pass both semantic audits; current fails pending-value abort despite green initial checks | Approval needed for proposed one-response candidate experiment |

Update each row after implementation and checks. Record failures and limitations here; never mark a stage measured from offline checks alone.

## Validation and measurement

Run focused planning, worker-pipeline, contract, recovery and final-validation checks at their changed boundaries. Run typecheck regularly; run full offline checks and provider tests on the integrated change, followed by code review. Record commands/results below.

Use clean isolated p-map baselines for raw Pi, current Fanout and improved Fanout. Keep current/improved Fanout on the same worker provider/model, thinking and concurrency; record the normal raw-Pi configuration. Use identical task and independent acceptance checks. Count planning, workers, rejected attempts, repairs and final checks; record human waits separately. Report outcome, observed cost, wall time, sequential model calls and repair demand. A single pilot is accounting and feasibility evidence, not a reliability rate or tail estimate. Distinguish observed provider latency from fixed-60-second counterfactuals.

User-selected pilot routing: `openai-codex/gpt-5.6-sol` medium for raw Pi and Tier 1; `openai-codex/gpt-5.6-terra` medium for the Tier 2 fallback; async Tier 2 disabled. This measures Codex workflow performance. Any 60-second-per-request scenario must be explicitly labeled counterfactual, not a Doubleword/provider forecast.

Preserved baseline source snapshot: `/private/tmp/fanout-efficiency-baseline-07db63f`. The existing p-map checkout has a user modification in `readme.md`; use isolated clones from its fixed baseline and leave that checkout untouched.

## Validation log

- 2026-09-06: inspected baseline and approved scope; no code changes or new provider measurements yet.

## Deferred

Custom one-shot candidate transport, speculative duplicate workers, predictive/adaptive routing, budget-aware repair routing, validation caching, increased concurrency, and the larger benchmark cohort. Add only after evidence and a scoped decision. Release remains separate from implementation; atomic commits require code review first.

- Focused checks passed: planning-boundary, planning, worker-pipeline, final-validation; configured typecheck passes (limited existing final-validation entrypoints). Full suite initially hit sandbox localhost restriction, then exposed one outdated public repair-prompt assertion, updated to verify retained recovery.json. Provider mock regressions pass.
- Code review: Standards reports no remaining violations; Spec found context bounds and baseline/current labeling gaps, both corrected with focused regression checks.
- Protocol and live evidence: [p-map efficiency pilot](../benchmarks/p-map-efficiency-pilot.md).

- Integrated `npm run check` passed, including executor recovery checks and 49 profiler tests. `npm run test:doubleword-provider` passed all mock provider tests. Both required localhost socket permission. Expanded strict TypeScript probe of planner/worker entrypoints reports no new diagnostics against 07db63f; existing unrelated diagnostics remain outside configured typecheck coverage.
- Final code-review recheck: Standards 0 findings; Spec 0 residual findings after context corrections.

- Commit attempt blocked by automatic approval review: it did not accept the user-updated goal as explicit commit authorization. No files staged or commits created. Continue authorized measurement; obtain direct confirmation before committing.

- Raw Pi pilot completed:307.421s,20 assistant responses,$0.627699 reported usage cost; frozen external acceptance passed. Full independent npm test passed54 tests. Current-Fanout pilot now started.

- Current Fanout completed:486.832s including146.604s planning,$0.8119022 total. Planning4 requests; workers24 (runtime16, types4, docs4),3 original attempts, no controller repair. Native event replay used because profiler catalog currently rejects profile-only final gates at planning admission.

- Improved Fanout completed: 393.781s including 89.811s planning; $0.5128764 total. Two planning requests and 16 worker requests (runtime 13, public contract 3). Both original attempts accepted; no controller repairs. Full independent suite: 56 tests; frozen acceptance passed.
- Compared with raw Pi: 18.3% cheaper, 28.1% slower. Compared with current Fanout: 36.8% cheaper, 19.1% faster. These single samples do not demonstrate reliable performance.
- Fixed-60-second worker-latency floor for the observed improved graph: 869.811s, even before generation/local overhead. Need a different cheap-worker request shape; the proposed terminating candidate experiment is documented in the pilot report and requires approval because custom candidate transport was deferred.
- Durable evidence is preserved under `runs/p-map-efficiency-20260906/`; original user p-map checkout still has only its pre-existing readme modification. No commits were created after automatic approval review rejected the recorded goal as commit authorization.

## Standards review

Reviewed the diff from `07db63f`, untracked context/tracker files, AGENTS.md, CODING_STANDARDS.md and the code-review skill's smell baseline. No remaining documented-standard violations or actionable smells. Prose-mirroring tests were removed; bounded context includes absent resources. Diff whitespace checks pass.

## Spec review

No residual findings after recheck. Prepared context has entry/content bounds and explicit baseline/current labels; regressions cover wide directories and overlapping source roles. Complete recovery authority remains on disk and integration checks verify it. The three-mode benchmark follows the approved scope and separates observations from fixed-latency counterfactuals. The proposed candidate-submission experiment is not implemented.

Review totals: Standards 0 remaining findings, worst issue none; Spec 0 remaining findings, worst issue none. Initial bounded-context and source-label findings were fixed before measurement.

## Follow-up audit

- Prior goal turn: progress (implemented and measured the approved changes). Revalidated source/test bytes against the tested frozen snapshot: no differences. The goal remains incomplete because the high-latency E2E target has not been met.
- Automatic approval review again rejected committing, saying the goal continuation does not establish direct user commit authorization. No staging or commits occurred. The candidate-submission prototype also remains pending explicit approval under the design decision gate.
- Offline replay of all five successful runtime edits reproduces exact final source/test bytes. All intermediate versions pass the original frozen independent acceptance, demonstrating a gap in that checker rather than readiness for early termination.
- Supplemental promised-source-value abort check: raw Pi passes, current Fanout fails (one mapper starts after abort), improved Fanout passes. Updated the benchmark report to distinguish native controller completion from semantic failure; measured time/cost remain unchanged.
- Replaying the improved state before response 11 reproduces the same semantic failure even though response 10 advisory validation passed. The last runtime fix was necessary; terminating merely on a passing validation is not a safe shortcut. No new paid runs or proposed prototype implementation occurred.

## Blocked audit

The approval boundary has persisted across three consecutive goal turns: the initial implementation/pilot turn and two goal continuations. The first continuation made further progress through offline replay and supplemental semantic checks; the latest revalidation confirms unchanged tested source bytes and terminal benchmark runs. No direct approval for the proposed worker-workflow change has arrived. Automatic approval review has also repeatedly rejected commits, requiring direct user confirmation. Further implementation would change the documented deferred workflow; no authorized action remains that can achieve the latency objective. Mark the goal blocked until that approval is supplied, without marking the objective complete.

## Commit authorization resolved

The user subsequently said “You can commit,” resolving the commit authorization blocker. Reviewed implementation is committed as `a7b5ef6` (combined planning) and `b6a6fab` (prepared worker sources and early ownership checks). Source/test bytes remain identical to the tested improved snapshot. Benchmark findings and this tracker accompany the implementation in a separate documentation commit. The proposed candidate-submission experiment still requires approval; commit authorization does not change that scope.
