# Fanout efficiency progress

Status: active under the broader [study protocol](../benchmarks/fanout-high-latency-study.md). Completed implementation and both p-map pilot pairs remain evidence; the cost/time/correctness target is not established across tasks. Independent acceptance v2, two ordinary-Pi baselines, the controlled prompt pair and the complete-edit-batch cohort are complete. The single whole-task batch trial was faster/cheaper than the frozen raw mean; the Fanout trial was slower/costlier and retains a harness-error outcome. Candidate batching remains experimental; polished presentation is deferred.

## Objective and authorization

Develop and evaluate orchestration for coding agents on high-TTFT, low-cost inference, targeting correct completion at lower full E2E user cost and similar or lower time than ordinary realtime Pi while preserving provider economics. Study both orchestration for today's per-request delay and complementary provider improvements. Use p-map plus a small varied fast-validating task set, retaining Execa for occasional stress runs. Reduce sequential requests and control overhead without moving the cheap worker's implementation reasoning into Tier 1. The full framework, matrices, metrics, simulations, provider hypotheses and deferred work live in the study protocol.

The initial staged implementation and p-map pilot were approved and completed. The user subsequently authorized canaries and atomic commits, transferred the expanded study direction from the side conversation, and replaced the prior blanket approval gates with the updated global AGENTS instructions. Continue here as the main task. Apply code-review before commits; keep core/provider boundaries and existing recovery authority. Broad canary permission does not turn speculative designs into proven architecture.

Stored goal: the user deleted the old blocked goal, and a new active goal was created on 2026-09-07 with the expanded orchestration/provider study objective. It includes stronger acceptance, varied tasks, fixed-model controlled experiments, actual async validation, evidence-class separation and deferred presentation. No token budget was requested. Its creation was verified through the goal tool; the previous blocked objective is no longer the active stored goal.

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
| 4 — Initial p-map measurement | Complete | Initial raw/improved pass both audits; current and both repeat candidates fail pending-value abort | Preserved historical evidence; not a reliable win |
| 5 — Study protocol, acceptance and raw baseline | Complete for initial two-trial cohort | Acceptance v2 checked offline; raw trials pass at 274.137s/$0.547710 and 324.892s/$0.697646, including required gates | Reuse the fixed raw reference; prompt comparison recorded in Stage 6 |
| 6 — Controlled prompt experiment | Complete; changed prompt not adopted | Both pass; existing 354.484s/$0.596145/12 runtime responses, changed 424.408s/$0.6720575/13 runtime responses | Attribute overhead and test candidate batching |
| 7 — Complete-edit-batch experiment | Complete; no adoption | Whole arm passed at 158.180s/`$0.3086735`; modified Fanout native gates passed at 490.575s/`$0.7992885`, but primary harness outcome is error | Preserve frozen evidence; fix reporting and prompt activation only in a new runner revision |
| 8 — Varied tasks and real async service | Planned | Repeat promising whole-task configuration, then fast-task and actual-async validation | Keep task selection, live results and provider hypotheses separate |

Update each row after implementation and checks. Record failures and limitations here; never mark a stage measured from offline checks alone.

## Validation and measurement

Run focused planning, worker-pipeline, contract, recovery and final-validation checks at their changed boundaries. Run typecheck regularly; run full offline checks and provider tests on the integrated change, followed by code review. Record commands/results below.

Use clean isolated p-map baselines for raw Pi, current Fanout and improved Fanout. Keep current/improved Fanout on the same worker provider/model, thinking and concurrency; record the normal raw-Pi configuration. Use identical task and independent acceptance checks. Count planning, workers, rejected attempts, repairs and final checks; record human waits separately. Report outcome, observed cost, wall time, sequential model calls and repair demand. A single pilot is accounting and feasibility evidence, not a reliability rate or tail estimate. Distinguish observed provider latency from fixed-60-second counterfactuals.

User-selected pilot routing: `openai-codex/gpt-5.6-sol` medium for raw Pi and Tier 1; `openai-codex/gpt-5.6-terra` medium for the Tier 2 fallback; async Tier 2 disabled. This measures Codex workflow performance. Any 60-second-per-request scenario must be explicitly labeled counterfactual, not a Doubleword/provider forecast.

Observed routing: planning/raw Pi used Sol medium; every ordinary Fanout worker in the initial and repeated runs used Terra medium immediately because async Tier 2 was disabled. Native allocations call this realtime assignment `tier1`; it is the configured Tier 2 fallback model, not a Sol worker or a reactive fallback after failure.

Preserved baseline source snapshot: `/private/tmp/fanout-efficiency-baseline-07db63f`. The existing p-map checkout has a user modification in `readme.md`; use isolated clones from its fixed baseline and leave that checkout untouched.

## Validation log

- 2026-09-06: inspected baseline and approved scope; no code changes or new provider measurements yet.

## Deferred

Custom one-shot candidate transport is an option after prompt evidence, not the next mandated architecture. Speculative duplicate workers, predictive/adaptive routing, budget-aware repair routing, validation caching, increased concurrency, broad model sweeps and Pi-with-subagents comparisons remain deferred. Varied tasks and actual async trials follow correctness and trace screening; a polished website/slides follows useful measurements. Release remains separate from implementation; atomic commits require code review first.

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

Historical note: the following audit describes the deleted original goal and superseded approval gates. It is not a current work blocker.

The approval boundary has persisted across three consecutive goal turns: the initial implementation/pilot turn and two goal continuations. The first continuation made further progress through offline replay and supplemental semantic checks; the latest revalidation confirms unchanged tested source bytes and terminal benchmark runs. No direct approval for the proposed worker-workflow change has arrived. Automatic approval review has also repeatedly rejected commits, requiring direct user confirmation. Further implementation would change the documented deferred workflow; no authorized action remains that can achieve the latency objective. Mark the goal blocked until that approval is supplied, without marking the objective complete.

## Commit authorization resolved

The user subsequently said “You can commit,” resolving the commit authorization blocker. Reviewed implementation is committed as `a7b5ef6` (combined planning) and `b6a6fab` (prepared worker sources and early ownership checks). Source/test bytes remain identical to the tested improved snapshot. Benchmark findings and this tracker accompany the implementation in a separate documentation commit. The proposed candidate-submission experiment still requires approval; commit authorization does not change that scope.

## Additional canary authorization

The user subsequently authorized canary runs. Revalidated the clean committed worktree, both benchmark source snapshots, the public p-map baseline and the exact Codex routing. Completed one fresh reverse-order pair: improved Fanout, then raw Pi. Both clean baselines passed all 51 tests. This tests variability in the existing implementation without changing worker behavior; the initial three-mode measurements remain intact.

- Improved repeat: 369.965s including 80.007s planning, $0.5307096 estimated token cost, two planning and 20 worker requests. Runtime consumed 17 requests and six advisory validations. Native execution completed without controller repairs; independent full suite passed 55 tests.
- Raw repeat: 255.175s, $0.514409, 12 requests; independent full suite passed 54 tests.
- Both passed initial acceptance but failed the same supplemental pending-value abort case. Neither failed candidate was repaired after measurement. The 45.0% time and 3.2% cost disadvantage for Fanout compares consumed resources, not successful completion.
- Both original and repeated Fanout runtime traces validate before completing behavioral tests. Stopping on the first green advisory check remains unsafe. Configured controller gates missed the semantic failure, so no repair budget was invoked.
- All run/audit processes exited. Evidence and SHA-256 receipts are preserved in `runs/p-map-efficiency-repeat-20260906-01/`; temporary credentials were removed. Human waits are zero; independent audits remain outside measured E2E with their own recorded durations.
- Further canaries are authorized. The candidate-submission design change remains pending; the user was asked to distinguish prototype implementation from running the existing workflow. No product code changed during this repeat.
- Documentation review against `6d10a08`: Standards 0 residual findings; Spec 0 residual findings after clarifying observed Terra worker routing. Verified all 93 original repeat evidence receipts, exact E2E timestamps, unchanged pinned inputs and source bytes. `git diff --check` passes; the original p-map checkout retains only its pre-existing readme change.

## Expanded study work — 2026-09-07

- Transferred the complete side-conversation framework into one [study protocol](../benchmarks/fanout-high-latency-study.md), covering five explanatory layers, all four workflow configurations and requested comparisons, varied task selection, provider economics, continuation/cache hypotheses, simulation limits and deferred presentation. Updated benchmark index, roadmap and adopted decisions without rewriting historical run evidence.
- Reread `/Users/snehalyelmati/.codex/AGENTS.md` from disk as requested. It calls for the main task to orchestrate useful subagents, defaults new agents to Sol medium, and requires cohesive changes and atomic commits. The former blanket approval gates are absent. New acceptance, raw-baseline-driver and task-shortlist work is delegated accordingly.
- Created and verified the new active stored goal after the user deleted the old blocked goal. Both orchestration and provider research are in its actual objective; current per-request high latency and proposed fast continuations are distinct.
- Acceptance v2 is implemented as `scripts/benchmarks/p-map-acceptance-v2.mjs`, protocol `p-map-iterable-abort-acceptance` version 2. It preserves post-abort no-yield checks and the 2s semantic hang deadline, handles native once-listener removal, adds the promised-value abort case, and checks scope against the pinned baseline even for a committed candidate. An inner 10s watchdog retains asynchronous failure evidence; a separate supervisor kills a blocked evaluation process group after 12s, including synchronous module loops. The external process runner retains its own command timeout.
- Offline matrix: original raw/improved pass; original current and both repeat candidates fail promised-value abort; clean baseline fails the missing abort behaviors. Default-cwd, committed-candidate scope, unexpected paths, active handles, watchdog and once-listener regressions were exercised. Final-source replay and hashes are recorded under `runs/p-map-acceptance-v2-20260907/`; these checks do not establish a new performance baseline.
- Implemented `scripts/benchmarks/p-map-raw-canary-v2.mjs`: required acceptance/full-suite checks and up to two predeclared correction prompts share one E2E clock. It freezes candidate identity across all gates, records configuration/environment and final patch provenance, and rejects mutations of benchmark inputs. This changes the benchmark protocol, not Fanout's production recovery limits. Verified live baseline results follow below.
- Provenance inspection found project SDK 0.83.0 and global Pi CLI 0.84.4. The new driver pins `piSdkVersion` explicitly; later Fanout comparisons must record the actual worker executable/version rather than infer all roles from a single CLI version string.
- Fast-task research produced provisional pi-mono parser, coupled API/caller and width/state candidates. Exact parent commits, independent acceptance and clean timing checks are outstanding; shared-repository/known-trace bias and missing natural width coverage are explicit selection gaps. Execa's inspected 240s timeout is not treated as the cause of its recorded successful 252–300s suites.

### Ordinary-Pi v2 baseline completed

- Committed reviewed helpers as `6dd0f04` and the study protocol as `438b42d`. `npm run typecheck` and full `npm run check` passed; local stub-server binding required the already-authorized sandbox escalation. Known-candidate acceptance replay and simulated repair, exhaustion and gate-mutation flows passed. Offline driver receipts are under `runs/p-map-raw-driver-v2-offline-20260907/`.
- Executed both predeclared fresh raw trials in order under the same frozen protocol: 274.137s/$0.547710/15 responses and 324.892s/$0.697646/19 responses. Both passed all six semantic/scope cases, 54 repository tests and whitespace validation with zero external correction prompts. Internal fixes and required gates are included in E2E; provisioned setup and driver/session initialization remain separately reported.
- Archived full provenance and both final candidates under `runs/p-map-raw-v2-baseline-20260907/`; temporary auth removed after completion. These two passes establish usable observations, not reliability or a Fanout win. Historical post-hoc-audit measurements keep their original accounting.
- Prepared and completed the existing-versus-changed Fanout worker-prompt pilot recorded below in ignored run artifacts. Acceptance v2 joins the native final gate; planning and all native repair work remain inside E2E. Both SDK and worker CLI are pinned to project version 0.83.0. No product prompt change was adopted.

- User steering: reuse the arithmetic mean of the comparable raw-Pi calibration cohort across Fanout iterations. Current v2 reference: 299.5145s/$0.622678 from two runs; keep older accounting cohorts separate and avoid repeated unchanged raw controls.

### Pilot initialization and cancellation follow-up

- The first prompt-pilot launch stopped before session creation or any task model request: Node 26 strip-only TypeScript loading rejected a parameter property in the directly imported provider extension. Preserved console/protocol receipt under `runs/p-map-prompt-v2-20260907/initialization-failure.json`; the cohort stopped, both candidates stayed clean and temporary auth was removed. A new pilot identity must verify full offline Pi extension initialization before another live launch.
- The user conditionally authorized straightforward cancellation for Pi execution itself, not the p-map AbortSignal task. Feasibility inspection found normal Pi agent cancellation already exists, but native Fanout extension execution needs cancellation through preparation, scheduling, final validation and repairs. Worker process-group cleanup is reusable; cancellation between attempts requires a new valid run-level causal event, event/projection contract changes and profiler compatibility. This exceeds a small plumbing fix, so no product cancellation change was made.

- Corrected runner revision 2 uses Pi’s normal `additionalExtensionPaths`/Jiti loader plus the unchanged profile publisher. Both arms passed full offline SDK/extension initialization, registered Fanout commands and published the profile with zero task model requests. New receipt: `runs/p-map-prompt-v2-20260907-r2/receipt.json`; fresh clones subsequently completed the pair below under a new runtime root.

### Prompt canary pair completed

- Both runner-r2 arms completed successfully with acceptance v2, native final gates, correct Sol/Terra assignments and zero controller repairs. Existing: 354.484s/$0.596145/17 total responses; changed: 424.408s/$0.6720575/19 total responses. Full repository suites passed 53/54 tests respectively. Full evidence and checksums are archived in `runs/p-map-prompt-v2-20260907-r2/evidence/`; temporary auth removed.
- The changed instruction moved runtime test edits before first validation and reduced validation calls from four to three, but reads rose from one to five and the critical worker used 13 responses instead of 12. This one pair does not isolate a causal effect from fresh-plan/candidate variation. Keep the product prompt unchanged; the experiment failed to establish a cost/time improvement.
- Native Pi reconnaissance found `AgentToolResult.terminate`, a supported graceful exit after tool execution. There is no exposed SDK/CLI max-response option. Any follow-up must deliberately submit complete work; unconditional first-green stopping remains unsafe. No termination or candidate-submission implementation has been adopted.

### Complete-edit-batch and task-selection follow-up

- Completed the frozen benchmark-only cohort under `runs/p-map-single-batch-v1-20260907/`; inputs remained unchanged, full evidence has `SHA256SUMS`, credentials were removed and no benchmark processes remain. The whole-task arm passed all final gates on tree `00fd84a91896fc9326e15d95b6d1ed234767c6da` in 158.180s at `$0.3086735`. One Terra response formed the initial batch; two correction rounds used five Sol responses. Its one observed sample was 47.19% faster and 50.43% cheaper than the frozen two-sample raw Sol mean. Raw and whole both lack Fanout normalization but differ in initial model, preloaded context, restricted tools and initial termination; Fanout adds planning and profile normalization. This is not a reliability or causal claim.
- The modified Fanout arm's native final evidence passed 54 tests, diff check and six acceptance cases on tree `dbb3093baf9b8b477211ebef37d8c8899d6e066b`. It consumed 490.575s/`$0.7992885`: two Sol planning responses, two one-response Terra originals, and one nine-response Sol validation repair. Its primary harness outcome remains error because the post-run assignment check queried `allocation.assignment.thinking`, which native allocation evidence does not contain. The separate `analysis/fanout-01-thinking-audit.json` confirms Sol-medium planning/repair and Terra-medium originals from effective tiers, runtime context and session events; exact worker argv was not persisted. `analysis/fanout-01-prompt-activation-audit.json` shows that the canonical batch branch was inactive: archived worker prompts kept normal validation/final-response instructions, while the extension's default batch system instruction and termination were active. The assembled provider system prompt was not persisted. Preserve the error and conflicting-instruction configuration, do not credit the inactive prompt change, and do not rerun or replace the frozen observation.
- Initial-worker depth batching worked, but this Fanout configuration remained slower and costlier. Prioritize a repeat of the promising whole-task configuration, then varied fast-validating tasks and actual async validation after correcting reporting and prompt activation in a new frozen runner revision. This cohort does not justify product adoption.
- The local derivation `runs/p-map-prompt-v2-20260907-r2/interval-counterfactual.json` for the completed prompt pair yields 319.553767s/376.596189s when critical-runtime turn-start-to-first-update observations are set to zero, and 379.553767s/436.596189s when the first is set to 60 seconds and the rest to zero, versus the 299.5145s raw mean. The local interval is not pure queue/TTFT; remaining critical runtime is about 154.7s/212.1s. Reconciliation plus final validation measured 17.178s + 16.283s and 18.438s + 16.392s; pre-execution measured 10.885s/10.690s. Overlapping tool-duration sums are not subtracted. There is no evidence for bypassing shared-worktree safety invariants; a no-audit/no-Fanout profile remains a separate later experiment.
- Externally verified pi issue 764 at exact base `c5cf74e032ec31b926c5acc5e21b017cf434f63e` and reference `588399594c36cf4ee5bb04d4ab9e8220adc66b5f` in the renamed `earendil-works/pi` repository. Its reference is usable for the explicit 56-column header-hint reproduction, not an unqualified all-width guarantee. Freeze and red/green-preflight the three-state renderer acceptance before selecting it; public traces create known-solution contamination.
- Provider documentation currently prices GLM-5.3-Flash async at `$0.11/$0.02/$0.38` and realtime at `$0.15/$0.03/$0.50` per million input/cached-input/output tokens. Responses caching is documented unsupported; async targets under one minute for individual requests with burst exceptions. The adapter observes polled completion availability, not streamed async TTFT.
