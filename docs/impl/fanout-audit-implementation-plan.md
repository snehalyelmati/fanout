# Fanout audit implementation handoff

Inspected: the 38-entry audit register; repository instructions, architecture, design decisions and ADRs; planning/compiler/execution/recovery/profiler producers and consumers; existing smoke scripts and package manifests; workspace/global Pi APIs; Git state at the baseline below. Four fresh read-only delegates prepared the implementation reconnaissance, and the parent cross-checked submission, metrics, final-repair, replay and presentation boundaries.

**Status: approved for implementation on 2026-09-05.** The user approved B0–B6 and section 3, dev-only installation, native subagents in this orchestrator task, removal of the obsolete core worker-metrics package export, and atomic commits after completed changes are reviewed. See the [register](fanout-audit-progress.md#implementation-validation-record--2026-09-05) for actual results. Live providers, benchmarks, user-operated E2E and release remain separately gated. The original handoff/review history below is retained as history.

## 1. Objective, baseline and reading order

Audit Fanout from user objective through planning, compilation, execution, acceptance, recovery and reporting. Fix proven correctness defects and approved strictness/efficiency problems without creating another orchestrator or weakening repository authority. The [progress register](fanout-audit-progress.md) is the detailed policy/evidence source: **32 implementation directions, four Retained choices, two Deferred items; all 38 dispositions resolved.** Retention/deferral is not a fix.

- Repository: `/Users/snehalyelmati/Documents/doubleword-pi`.
- Audit/review baseline: `0e1f260835c5fc1429118ff4aeaf636416477715`; HEAD still matched it during handoff preparation.
- Expected handoff diff: modified `docs/ROADMAP.md`; new/untracked `docs/impl/fanout-audit-progress.md` and this file. Preserve these files and any subsequent user changes. Do not stage/commit just to make review tools see them.
- Source abbreviations below: `core/` = `packages/fanout-core/src/`, `pi/` = `packages/fanout-pi/src/`, `profiler/` = `packages/fanout-profiler/src/`, `prompts/` = `packages/fanout-pi/prompts/`. Brace lists identify exact filenames, not permission for directory-wide refactoring.
- Read repository/global `AGENTS.md`, [coding standards](../../CODING_STANDARDS.md), the entire register and this handoff first. Then read [architecture](../ARCHITECTURE.md), [design decisions](../DESIGN_DECISIONS.md), [Phase 2B](phase-2b-fanout-plan.md), [Phase 3](phase-3-fanout-execute.md), and relevant [ADRs](../adr/0002-use-one-strict-execution-authority.md).
- Approved register decisions supersede the specific older policies they explicitly revise; unamended project decisions still apply. This proposal does not silently approve additional changes. Source line numbers in the register refer to the audit baseline.

The motivating failure was `read-not-authorized: file:package.json is not authorized by source runtime-web-streams (grounded[0].readDependencies[14])`. The original handoff suggested exhaustive Phase A read repair; **F01 explicitly supersedes that remedy for baseline-context reads**. Do not implement the obsolete remedy instead of the approved policy.

Reconnaissance reproduced split runtime/test ownership, incomplete per-owner read classification, create+modify admission, rejected empty additional final gates, and rejected literal bracketed filenames with in-memory probes. These were diagnosis, not post-fix tests. Historical [speed/reliability results](../benchmarks/fanout-speed-reliability.md) are not current-head validation or proof of performance gains.

## 2. Decisions followed and non-negotiable boundaries

- Preserve exact packet/profile/artifact bytes and identities, planning commit/full Git-visible tree, typed write ownership/global bans, literal direct argv, controller-authoritative validation, fresh reconstruction, fixed recovery budgets and exact-no-progress detection.
- Preserve ambiguity lock retention; never automatically commit, stash, reset, discard, rebase or roll back user changes. F08 rejects even unrelated staged/unstaged/non-ignored untracked changes before paid planning. A separate clean worktree excludes those uncommitted changes; dirty snapshot support is not authorized.
- Declared reads are scheduling/provenance, **not confidentiality**. `workerToolBlockReason()` restricts writes, not arbitrary reads. Pi extensions, approved commands and local tools remain trusted; worktrees do not provide a host/network/process sandbox.
- F09 retains standing approval for exact bound-profile validation on invocation, including dry-run. Disclose command/network/external effects; live confirmation gates workers and active apply. Do not convert dry-run into static-only mode.
- Keep the normal Pi loop, two planning phases, independent Doubleword provider, and provider-agnostic core. No DAG/product redesign, predictive scheduler, automatic command repair, general cache, benchmark framework or new runtime mode.
- F36 means the smallest deterministic regression attached to each relevant fix plus minimal typechecking. It does not create a test project. Separate E2E runs remain integration gates after logical fix sets, including this audit.

**Decisions followed:** the approved register and section 3 cutover. **Proposed changes to prior decisions:** none beyond those approved revisions. **Deferred/skipped:** section 6 and separate live/E2E/release gates. Atomic commits are expressly authorized after review.

## 3. Approved implementation choices

### A. One coordinated generation cutover

| Authority | Audit baseline | Approved generation | Reason |
| --- | --- | --- | --- |
| Implementation Plan | 3 | 4 | Revised Phase A read-scope/item-boundary semantics |
| Implementation Details | 6 | 7 | Closed ordinary kinds and empty additional final-command list |
| Work Contract | 4 | 5 | Context-bound empty final commands and corrected admission semantics |
| Execution Packet | 9 | 10 | Binds the new planning/contracts generation |
| Attempt Outcome | 5 | 6 | Acceptance/measurement separation and truthful dispositions |
| Execution Event | 5 | 6 | New outcomes, fail-fast causes and all-round duration semantics |
| Execution Projection | 6 | 7 | Replay-derived availability, causes and totals |
| Project Execution Profile / active profile pointer | 1 / 1 | unchanged | Exact standing authority unchanged |
| Active packet pointer / final-validation evidence | 2 / 2 | unchanged | Pointer identity and per-round serialized shape unchanged |
| Worker manifest / presentation entry | 1 / 1 | unchanged | Existing shapes suffice |

Old packets must fail before lock/mutation and instruct the user to rerun `/fanout-plan`. Profiles v1 may be reused by exact identity. Older outcomes/events/projections remain descriptive **Legacy**, not current replay inputs; keep their source files inspectable. No migration, adapter or historical-byte rewriting. Current-generation replay must still reconstruct the same projection and terminal causes without executing work. Update producers, parsers, fixtures, profiler and current-state docs together before claiming the cutover complete.

### B. Pi and development tooling

Workspace coding-agent/agent-core/pi-ai were **0.83.0**; the installed CLI/global coding-agent was **0.84.4**. Both inspected runtimes expose `agent_settled` and `tool_result` middleware. The event's documented introduction is earlier, but the approved compatibility floor is **coding-agent >=0.83.0** in root and adapter peer declarations to avoid claiming an uninspected earlier runtime. No shim or runtime upgrade is authorized by this document. Recheck actual installed versions in the fresh session and validate the actual SDK, not only a fake ExtensionAPI.

At handoff no local TypeScript compiler, tsconfig or lockfile existed. Approved root dev-only TypeScript 5.9.x and Node 24.x types, `tsconfig.typecheck.json`, and `npm run typecheck`. Use NodeNext, `noEmit`, `allowImportingTsExtensions`, `strict`, and `skipLibCheck`; roots are `core/final-validation.ts` and `pi/final-validation.ts`, with their imported project closure checked normally. Do not use global Pi as type authority, hide project diagnostics, add a lockfile, run unrelated install scripts or upgrade other packages. Installation/registry access was explicitly approved for these tools. Report pre-existing unrelated errors; stop for scope approval if they prevent the gate rather than weakening the configuration.

### C. Profile-only final validation and bounded repair

F05 allows `finalValidationCommands: []` only with at least one exact profile final gate; reject zero combined gates. Packet final contracts may contain zero focused commands, but ordinary mutating contracts still require validation. Authoritative final evidence remains nonempty: packet commands followed by profile gates, in exact order.

Propose allowing an empty focused list only in the controller-derived final-repair context, verified against the combined failed manifest, upstream contracts and exact recovery evidence. Do not globally weaken `validateWorkContract`. The repair prompt receives the failed combined profile-gate evidence; its advisory worker manifest does not duplicate profile gates. If `fanout_validate` has no focused commands, report that explicitly instead of meaningful “0/0 passed”; controller revalidation still runs the entire combined manifest. Cover construction, recovery parsing, worker admission, candidate normalization and successful/failed controller reruns together in B4.

### D. One measurement interpretation, no hidden completeness exception

Propose one canonical identity-bound measurement result with complete/partial/invalid classification, typed issues and retained evidence; derive aggregates from it rather than persisting a second independently admitted metrics model. Unknown scalar totals are unavailable (`null` in projections/views), not zero. Retain observed partial spend without presenting it as a complete total.

F04 applies to Doubleword too: **absence of measurement/provenance fields alone must not restore the old completeness acceptance gate** when positive assignment identity and every non-measurement gate are satisfied. Missing provider/model/tier assignment identity still fails. Preserve strict treatment of supplied malformed records, foreign/cross-attempt identity, contradictions, invalid numbers and pricing mismatches. Never promote alias/estimated usage or unverified pricing into trusted measurements; core stays provider-agnostic and the adapter retains provider-specific provenance checks. Distinguish absence from contradiction in regression cases; if a concrete case cannot be classified under these rules, surface it before coding rather than inventing a provider exception. Provider transport failures remain failures; F04 does not authorize changing standalone Doubleword response parsing.

Proposed assignment provenance (part of implementation approval, not an assumption that requested identity is observed):
- **Provider/model:** require nonempty, consistent `provider` and `model` from actual assistant `message_end` records in the exclusively captured stdout of the allocated worker subprocess; compare them to its immutable allocation. No assistant record, missing identity or mismatching identity fails acceptance. Delete the current fallback from missing observed provider/model to configured values in `worker-attempt-execution.ts`.
- **Attempt binding:** use the controller's preallocated attempt, its exclusive stdout/observability paths and manifest run/node/attempt binding. Supplied metric-bearing run/attempt/response identities must agree with that scope; don't borrow records from another attempt to fill gaps.
- **Tier:** Fanout tier is controller-owned routing, bound by the immutable allocation and actual launcher argv/environment (`DOUBLEWORD_EXECUTION_MODE` for Doubleword), not inferred from model names or token prices. Record this as controller-bound tier provenance, not independently observed external service-tier proof. Any supplied provider tier observation must match the launch mode; absent provider completion/pricing/usage instrumentation alone produces partial measurement, not loss of otherwise valid launch/assistant identity. This distinction permits generic providers without requiring Doubleword-shaped records.

Regressions must distinguish valid assistant identity with absent Doubleword measurement provenance (partial), missing assistant provider/model (invalid despite configured defaults), contradictory provider tier (invalid), and a valid fallback attempt bound to its own allocation. Never label requested values as provider observations.

Profiler comparison/scenario arithmetic must refuse unsupported calculations on partial evidence instead of producing zero, NaN, fabricated intervals or comparable benchmark claims. No new performance claim follows from accepting a repository-correct candidate with partial measurements.

### E. Final controller completion is distinct from a command round

Propose a separate controller-result type rather than overloading the existing per-round `FinalValidationResult`. Event v6 `final-validation-completed` carries:

| Field | Proposed meaning |
| --- | --- |
| `status` | Overall final-controller `passed` or `failed`, including required repair apply/publication |
| `lastRound` | Latest executed round's immutable `{evidence, status, commandCount, durationMs, expectedTree, beforeTree, afterTree}`, or `null` if that latest round could not be published; never substitute an older round as the latest |
| `totalCommandDurationMs` | Sum over all actually executed command rounds; `null` if a failed capture/publication leaves the total unverifiable, never a fabricated zero |
| `failure` | Required only for overall failure: `{kind: "round"}`, `{kind: "attempt", attemptId}`, or `{kind: "controller", code, detail}` with code `publication-failure` or `internal-failure` |

`lastRound.status` describes the referenced evidence bytes, not the controller result. A round-kind failure requires a failed last round; a null last round requires a controller failure, not a fabricated validation outcome. A failed repair launch/ownership/apply cites the exact completed failed attempt; replace boolean-only hook results where they discard this cause. The reducer checks that attempt reference and keeps the single run-finish cause linked to this final-completion event. Successful completion requires a passing last round, no failure, and any required candidate apply/accepted-evidence publication completed against the accepted ledger.

If candidate commands pass but apply fails, preserve the passing round unchanged, emit overall failure with the typed attempt cause, retain all-round totals, and never return `initialResult` as a replacement. If active apply succeeds but accepted-repair evidence publication fails, preserve the already-published accepted attempt/transition, reference the original passing round, and record controller publication failure; do not rewrite that attempt as failed or invent an accepted-evidence identity. Set the executor's manual-reconciliation latch before unwinding any post-mutation bookkeeping/publication failure, including failures outside `#applyLocked`; no rollback or automatic lock release. If the Event store itself is unavailable, preserve its last durable prefix and immutable artifacts, report failure to the caller, retain an ambiguous-mutation lock, and never fabricate a terminal event.

On success, the referenced terminal evidence may be the separately published `-accepted.json` variant; its original passing round remains untouched. A safely rejected pre-mutation apply with proven unchanged active state keeps existing normal cleanup behavior. Tests cover failed apply after passing validation, accepted-evidence publication failure after mutation, Event-publication failure, exact round identities/totals, and lock disposition. These are approved Event/Projection/controller changes; per-round evidence stays v2.

## 4. Ordered implementation slices and file ownership

These slices form one coordinated audit change set, not independently releasable mixed generations. Run focused checks per slice; integrate linked producers/consumers before full checks and the audit E2E gate. F05 spans B1/B4, F08 spans B2/B3, and F36 applies throughout. An intermediate compiler-only or evidence-only diff is not end-to-end verified.

The parent owns integration, shared files, schema constants, root manifests, shared smoke fixtures and docs. Approved runtime adaptation: use native subagents from this orchestrator task because `delegate` is unavailable. Implementation ownership stays disjoint; fresh independent Standards and Spec reviewers assess the integrated change. Only delegate non-overlapping files concurrently; serialize handoffs for shared files. Delegates return changes/checks/blockers; they cannot expand scope or approve policy. Read affected callers before edits; prefer existing modules and cohesive changes, not a mechanical repository-wide refactor. Additional necessary source files/extractions require a scoped amendment before writes.

### B0 — Establish the focused validation seam (F36)

Files: root `package.json`; new `tsconfig.typecheck.json`. After installation approval, introduce the proposed no-emit check and record baseline diagnostics before F30 correction. Do not make this a separate test framework or require unrelated cleanup. Root `npm run check` remains the full existing offline gate; run `typecheck` explicitly alongside it.

### B1 — Compiler authority and draft structures

| IDs | Implementation / acceptance target |
| --- | --- |
| F01 | Admit source-attributed canonical repo-local baseline reads discovered in Phase B; keep post-change additions within approved Phase A scope. Missing `package.json` context succeeds; unauthorized writes and malformed/external resources still fail. |
| F03 | Reuse one canonical ordinary-kind set for submission and packet admission. Unsupported kinds fail before publication; `final-validation` stays compiler-owned. |
| F05 | Admit profile-backed empty additional final commands; ordinary node validation and nonempty combined final gates remain mandatory. Finish repair-side coverage in B4. |
| F06 | Remove only glob-looking-literal rejection after tracing consumers; no expansion or identity normalization. Round-trip `app/[slug]/page.tsx` through planning, Git capture, ownership and apply while preserving traversal, `.git`, encoding and symlink protections. |
| F11 | Group grounded rows by change-endpoint Phase A ownership as well as existing write overlap. Read-only source citations never merge workers. One runtime/test repair unit remains one worker; independent units remain parallel; existing mixed-kind restrictions remain correctable draft errors. |
| F12 | Classify every required reader/owner relationship. A narrow read of owner A cannot discharge owner B; broad classifications must actually cover each relevant owner. Baseline creates no edge, post-change creates exact owner edges, mixed timing remains explicit. |
| F13 | Compare exact `(kind,path)` before/after existence requirements. Reject contradictory create/modify/delete/move intents; retain repeated compatible modifications, valid moves and same-path file/directory replacement. |
| F14 | Reuse consistent owner/read derivation. Reject unsupported model-submitted self post-change reads, not reads made internal by valid grouping/fusion. Direct resource and full packet paths must agree; preserve cycles/edge checks and F25 fusion predicates. |
| F38 | Compare omitted `env` with `{}` only for draft duplicate detection. Preserve persisted objects, historical hashes, nonempty env values and ordered argv; report duplicates without deleting commands. |

Files: `core/{planning-artifact-schema,repository-resource,work-contract,work-contract-compiler,work-contract-graph,fanout-compiler,execution-packet}.ts`. B4 owns later coordinated edits to `core/{final-validation,recovery-evidence}.ts`; do not widen ordinary validation in B1 as a shortcut.
Tests: `scripts/smoke-{repository-resources,artifact-identity,work-contract,fanout-compiler,fanout-packet}.mjs`. Update generation literals in consuming fixtures only as their owning slice integrates.

### B2 — Planning submission, context and lifecycle

| IDs | Implementation / acceptance target |
| --- | --- |
| F02 | Construct exact provisional details bytes/identity and compile before writing accepted details or setting accepted submission. Return correctable errors in the same submission loop. Retain the compiled result bound to those bytes; verify accepted plan/details/profile identity before publication rather than compiling twice needlessly. Drift stays terminal; a valid lone submission terminates exactly once. |
| F07 | Bare invocation uses the current compaction-aware user/assistant conversation, including Pi's compacted context, excluding tool results/report/custom entries and tool-call blocks. Drop newly empty assistant messages to avoid orphan calls. Explicit objective remains self-contained; later phases stay artifact-grounded. |
| F08 | Introduce a planning-only clean-base admission using full repository state. Do not change generic `capturePlanningBase`, which patch/identity flows use for dirty snapshots. Reject staged/unstaged/non-ignored untracked changes before paid planning; leave user files untouched. |
| F16 | Replace mandatory split-everything guidance with qualitative setup/context/validation-overhead awareness; preserve ownership/repairability. No thresholds or filename rules; effectiveness on tiny/substantial tasks remains a later E2E/measurement question. |
| F18 | Frame profile discovery around stable repository-wide preparation/readiness/normalization/final gates; task checks remain in packets. No profile-scope field. |
| F27 | Advance phases at `agent_settled`, not `agent_end`; keep restrictions and prompt protection through retry/compaction/continuations. Restore the exact prior tools on success, failure, cancellation, session reset and shutdown without double advancement. |
| F37 | Render existing typed fallback warnings and reasons in derived planning Markdown with possible parallelism impact. Rendering cannot change dependencies, packet bytes or model context. |

Keep the existing bounded conservative read fallback, but move its correction opportunity into ordinary submission: a first all-`planned-read-not-grounded` rejection arms the existing bounded fallback for a subsequent draft; unrelated errors do not authorize fallback. Remove the bespoke accepted-details repair prompt/extra turn. A fallback may add only the already-permitted exact owner classifications and must remain visible; it cannot authorize new post-change scope.

Files: `pi/{planning-capabilities,fanout-planning-controller,fanout-plan-orchestration,repository-identity,index}.ts`, `core/work-contract-views.ts`, `prompts/{fanout-implementation-plan,fanout-implementation-details,fanout-execution-profile}.md`; root and `packages/fanout-pi/package.json` for the proposed peer floor.
Tests: `scripts/smoke-{planning,planning-boundary,work-contract,artifact-identity}.mjs`, `scripts/planning-boundary-fixtures.mjs`. Use real Pi SDK/in-memory session/settings and a test-local scripted stream for deterministic tool-call, retry, compaction, queued-follow-up and cancellation branches; do not alter production stubs or contact providers. Local fake event callbacks alone do not prove settled lifecycle behavior.

### B3 — Execution ordering, Pi errors and small simplifications

| IDs | Implementation / acceptance target |
| --- | --- |
| F08 | Reject known-invalid commit/tree/platform before dynamic profile preparation. Keep the later independent post-profile drift preflight; do not reuse state across commands. |
| F09 | Keep standing profile approval and disclose dry-run/pre-confirmation command and possible external/network effects. Decline launches no workers/active apply, but does not retroactively promise zero profile commands. |
| F21 | Reuse `normalization.after` and `setup.afterReadiness` at the two immediately adjacent successful capture sites in profile validation/preparation. No general cache, cross-command reuse or shared prepared worktree. Failure evidence/order and later drift checks stay equivalent. |
| F23 | Allow bounded case/horizontal-whitespace variation in the optional summary heading. Keep final-message extraction and immediate-predecessor repair context; never search older messages or promote summary text to authority. |
| F24 | Remove unused `ExecuteFanoutOptions.activeProfilePointerPath` and its caller argument. Packet-bound profile identity wins after refresh; update in-repo callers. The package is private; acknowledge the source-level excess-property impact on unsupported deep imports. |
| F28 | Register scoped `fanout_validate` `tool_result` middleware returning `{isError: true}` for failed validation/tamper/publication results while preserving content/details. Hook exceptions are not reliable error signaling. Verify actual Pi-normalized messages/events for pass and each failure class. |
| F34 | Show canonical admitted packet path, full SHA-256 and byte length beside existing routing/write/command disclosure. No second authority or newly resolved active-profile lookup. |

Files: `pi/{fanout-execute,index,project-execution-profile,fanout-worker-contract,worker-validation}.ts`. Parent serializes overlap with B2/B4.
Tests: `scripts/smoke-{fanout-execute,worker-pipeline}.mjs`: spy preparation markers for cheap rejection/dry-run/decline; real Pi tool normalization with persisted evidence and preserved diagnostics; summary variations and earlier-message spoofing.

### B4 — Canonical evidence, final repair and replay semantics

| IDs | Implementation / acceptance target |
| --- | --- |
| F04, F20 | Replace competing `importWorkerMetrics`/correlation admission with one pipeline under section 3D. Preserve positive observed assignment, typed errors and partial fields. Add accepted-partial versus wrong-assignment/malformed/foreign/pricing-contradiction cases, including Doubleword. Missing measurement fields cannot prevent normalization, ownership and controller-validation gates from running. |
| F19 | Stop publishing new `attempt-outcome.json`; events remain authoritative. Move all current readers/browsing to event outcomes or existing diagnostic files. Historical duplicates stay non-authoritative and untouched; event-publication failure cannot expose false authoritative completion. |
| F29 | Use run-local monotonically unique executed-round IDs, e.g. `000-initial`, `001-repair-<digest12>`, `002-repair-<same-digest12>`. Narrow no-clobber publication protects round directories/JSON/accepted variants; replaceable pointers/views remain replaceable. Repeated digests retain original preparation/recovery bytes and identities. |
| F30 | Move static `preparation: ArtifactIdentity` from command evidence to round evidence, matching current runtime bytes. Final evidence stays v2. Run the focused typecheck; do not change serialization just to satisfy a wrong interface. |
| F31 | Stop new launches and drain running workers. Distinguish true dependency skips from independent fail-fast-policy skips bound to the first triggering failed node/attempt; preserve truthful transitive causes and terminal replay. Do not reuse user-abort or add cancellation machinery. |
| F32 | Keep terminal-round command duration and derive total controller command time across all executed rounds, including failures/exhaustion. Exclude setup/model/advisory time and distinguish Event-derived wall span. Retain exact round references; never return an earlier round as though it were the latest terminal evidence. A passed candidate whose active apply fails is still a failed run, not a passed final result. |
| F33 | Preserve immediate post-tree-mismatch hard stop/lock retention with its typed stage fact. Use ordinary hard failure rather than `budget-exhausted` when budget remains; exhaustion and exact-no-progress stay distinct. |

Complete section 3C's profile-only repair path in this slice. All-round command totals should be a separately named event/projection field (proposed `totalCommandDurationMs`), not a silent reinterpretation of terminal evidence `durationMs`. Evidence generation stays v2; the enclosing Event/Projection cutover carries aggregate/cause changes.

Files: `core/{attempt-metrics,execution-attempt,execution-event,execution-projection,execution-report,execution-run,dag-scheduler,final-validation,recovery-evidence,work-contract}.ts`; migrate in-repo callers/re-exports and remove obsolete `core/worker-metrics.ts` only with the duplicate admission path retired. `pi/{attempt-evidence,worker-attempt-execution,fanout-node-executor,fanout-worker-contract,final-validation,final-validation-adapter,fanout-execute,worker-validation,artifact-store}.ts`.
Tests: `scripts/smoke-{attempt-outcomes,execution-events,worker-pipeline,final-validation,fanout-execute}.mjs`. Include no-clobber/repeated-patch, failed-after-passing-candidate apply, all-round sums, profile-only repair, ordinary zero-validation rejection, fixed budgets/no-progress, independent-running/pending nodes and true dependents. Preserve whole-log replacement in `pi/execution-event-store.ts` (F26).

### B5 — Update profiler consumers without a UI redesign

Scope: downstream F04/F19/F20/F29/F31/F32/F33 and the generation cutover, not new profiler features or benchmark claims. Preserve complete-run comparisons; partial measurements suppress unsupported deltas/scenarios and remain inspectable. Missing timestamps cannot become inferred zero-length intervals. Existing formatting already supports unavailable values. Show dependency versus policy causes and correct final command-time versus wall-time labels; retain Legacy classification/source browsing and historical round filenames.

Files: `profiler/{catalog,workspace,comparison,diagnostics,scenario,provider-profile}.ts`; existing `profiler/{catalog,cli,workspace,comparison,diagnostics,scenario}.test.ts`. Update generation-bound synthetic fixtures in `scripts/benchmark-profiler.mjs` without running the benchmark or rewriting recorded performance results. No visual/layout change is planned; additional renderer changes need a scoped amendment if actual consumer tests require them.

### B6 — Reconcile current-state documentation (F35)

Files: `AGENTS.md`, `README.md`, `docs/{ARCHITECTURE,DESIGN_DECISIONS,ROADMAP,BENCHMARKS,OPTIMISTIC_DAG_WORKFLOW,TIER_MODEL_RESOLUTION,phase3_notes}.md`; `docs/impl/{phase-2b-fanout-plan,phase-3-fanout-execute,fanout-audit-progress,fanout-audit-implementation-plan}.md`; `docs/adr/{0002-use-one-strict-execution-authority,0004-make-events-authoritative-and-reports-context-free,0005-route-attempts-from-typed-facts-and-fixed-budgets}.md`; `docs/benchmarks/{fanout-execution-benchmark-procedure,fanout-canary-run-protocol}.md`.

Document all four packages including profiler, the actually implemented cutover, approved policy reversals and current limitations. In ADR 0005 replace the superseded complete-metrics acceptance rule and distinguish the combined authoritative final manifest from focused worker advisory commands. Correct the common canary protocol's misleading “dry-run is inert” language under F09 without altering historical run records. Repair relative links and label historical versions/results explicitly; no mass search/replace of historical numbers. Keep exact release/E2E gates and do not mark prospective changes implemented before their tests/reviews.

## 5. Concrete validation and completion gates

**Baseline/returning-session reconnaissance:** recheck HEAD, worktree diff, installed SDK/CLI/tool versions and scripts before execution. This is drift detection after a session boundary, not authorization to rerun the audit or reopen settled policies. Before changing persistence/serialization/cross-module boundaries, add the focused behavioral regression first. Existing tautological/phrase-only assertions are not substitutes for behavior. The original handoff ran no code tests; current implementation results are recorded in the register.

After implementation approval, use the existing commands as applicable to each slice:

```sh
node --disable-warning=ExperimentalWarning scripts/smoke-repository-resources.mjs
node --disable-warning=ExperimentalWarning scripts/smoke-artifact-identity.mjs
npm run smoke:work-contract
npm run smoke:fanout-compiler
npm run smoke:fanout-packet
npm run smoke:planning
npm run smoke:planning-boundary
npm run smoke:worker-pipeline
npm run smoke:attempt-outcomes
npm run smoke:execution-events
npm run smoke:final-validation
npm run smoke:fanout-execute
npm run test:profiler
npm run typecheck
npm run check
git diff --check
```

`typecheck` was added by the approved B0 implementation. Root `check` already covers the listed core smokes, configuration and provider metadata/cache tests plus profiler tests; focused runs are for diagnosis, not a claim that duplicate runs add coverage. `check-models.mjs` uses installed Pi and a temporary offline cache. Keep tests keyless and stubbed. Standalone provider transport is outside scope; run `npm run test:doubleword-provider` only if provider/shared behavior is affected, after reading its mock-only scripts. No pricing synchronization, live smoke, manual canary or benchmark command is included here.

For every implemented finding, the register must record changed files, runnable regression and actual result, any baseline failure, integration result, and separate Standards/Spec disposition. Follow its status rules: `Implemented` is not `Verified`; record pending E2E/release separately. Do not manufacture pass results for unrun or blocked commands. Unexpected contract needs, unrelated type blockers or safety deviations stop the affected slice for explicit approval.

### Independent code-review gates

Use the `code-review` skill, adapted as already approved: two independent fresh native subagent reviewers, one Standards and one Spec; no nested reviewers or review orchestration loops. Standards reads global/repo instructions, coding standards and the skill's smell baseline; Spec reads this plan only after implementation approval plus the register's approved acceptance criteria. No issue-tracker scaffold, remote issue or commit is needed.

```sh
git diff 0e1f260835c5fc1429118ff4aeaf636416477715 --
git ls-files --others --exclude-standard
git log 0e1f260835c5fc1429118ff4aeaf636416477715..HEAD --oneline
```

Explicitly read every relevant untracked file; a tracked diff omits the handoff/register. Preserve separate findings/counts for Standards and Spec, fix only approved-scope issues, and record which corrections received parent validation versus independent re-review. A review of this document is not a review of future code.

### Separate E2E and release gate

The user runs E2E after logical fix sets and specifically wants a separate run after implementing this audit. Use [the common canary protocol](../benchmarks/fanout-canary-run-protocol.md) and the separately selected task runbook; [p-map](../benchmarks/p-map-abort-signal-manual-e2e.md) is the existing release reference, not an automatically selected new run. Existing release rules require owner approval and evidence for the same immutable committed candidate. The approved implementation commits do not satisfy that separate release gate; preserve the handoff files and user changes.

Before live work, obtain explicit task/routing/cost authorization and an approved clean immutable candidate; do not treat an implementation approval as live authorization. Capture exact source/task/profile/packet/baseline identities, run one canary before any separately requested repetitions, stop on failure/drift, and restart the canary after any correction. Keep failed evidence. Report authority, controller final validation, cleanup and outcome before costs/timings. Do not redundantly rerun an already evidenced full final suite unless requested or its evidence is suspect. Offline SDK/integration smokes do not satisfy the user-operated E2E, release or profiler browser-walkthrough gates.

## 6. Retained/deferred items and triggers

| ID | Approved disposition | Trigger / prohibition |
| --- | --- | --- |
| F10 | Retained: immutable direct argv and repository-grounded command guidance | Prefer an existing broader script over invented syntax. Correct drafts/replan bad manifests; executable discovery cannot prove argv. Revisit only after repeated grounding failures. No shell expansion, generic syntax validator or new pre-freeze execution. |
| F15 | Retained: two planning phases | Separately authorized equivalent-task cost/time/acceptance comparison against normal Pi before phase merging or alternative workflow. |
| F17 | Deferred: broader efficiency/reliability/async claims and runtime changes based on them | Varied tasks, independent acceptance and complete cost/failure accounting; no automated evaluation framework or paid comparison now. |
| F22 | Deferred: command-resolution reuse | Material measured resolution overhead first; no persistent cache. |
| F25 | Retained: safe fusion predicates | Measured frequency/cycles saved before expansion or deletion. F11/F14 correctness fixes remain in scope; do not weaken predicates to force utilization. |
| F26 | Retained: atomic whole-log replacement | Material event-volume/publication-latency evidence before append recovery/database redesign. Preserve its documented quadratic ceiling. |

## 7. Original documentation-only starting prompt (historical; superseded by approval above)

```text
Work in /Users/snehalyelmati/Documents/doubleword-pi.
Read AGENTS.md, CODING_STANDARDS.md, docs/impl/fanout-audit-progress.md,
and docs/impl/fanout-audit-implementation-plan.md completely.
Audit baseline: 0e1f260835c5fc1429118ff4aeaf636416477715.
All 38 policy dispositions are resolved; do not rerun the audit or reopen them
without new evidence. Preserve the existing docs and any subsequent user edits.
The prior session prepared documentation ONLY. Implementation, compatibility
cutover, dependency installation, commits and live runs were NOT authorized.
Recheck Git/runtime drift, surface any concrete incompatibility, then ask me to
approve the scoped implementation proposal (including section 3 choices) before
editing code/config/tests. Once approved, follow B0-B6 with single-writer shared
files, fresh foreground delegate agents, focused regressions and independent
Standards/Spec reviews. Keep the register current with actual results. Stop before
the separately authorized audit E2E/release gate; never auto-commit or clean my work.
```

## 8. Handoff validation record (historical document review only)

- Initial checks passed: all 38 IDs mapped, register counts 32/4/2, relative links and scoped source/test brace-list paths resolved, and tracked/untracked whitespace checks passed. The first draft had 239 lines. No source/config/test writes, installation or runtime/E2E test occurred.
- **Independent Standards review:** one reported hard finding about review-status ambiguity and one heuristic repeated-status smell. Clarified the initial register review versus this handoff review, centralized result recording here, and removed 32 redundant per-approval implementation-status suffixes; the register's central defaults remain authoritative.
- **Independent Spec review:** three findings (high: post-validation apply/publication result contract; medium: positive assignment provenance; low: review-status ambiguity). Added explicit proposed controller/Event fields, failure/round/lock semantics in section 3E and observation-versus-launch identity sources/tests in section 3D; clarified status as above.
- Corrections received parent source cross-checks and document validation, **not a second independent review**. Initial reviewer counts remain Standards 1 hard + 1 smell / Spec 3; they are not a claim of zero independent findings or approval of future code. Section 3 additions remain implementation proposals awaiting user approval. Final parent document checks passed: all 38 dispositions and exact 32/4/2 counts, scoped paths, relative links, npm command names (with proposed `typecheck` explicitly absent), whitespace, unchanged HEAD, empty index and a docs-only diff. No implementation/runtime/release verification is implied.
