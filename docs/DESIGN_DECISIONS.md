# Design Decisions

## 2026-07-30

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

Superseded for execution evidence by the 2026-07-19 v3/v3/v4 cutover; the planning, packet, pointer, work-contract, final-validation, and presentation generations below remain current.

Decision: The only executable planning/runtime generation is implementation plan v2, implementation details v4, execution packet v6, active pointer v2, embedded work contract v2, attempt outcome v2, final-validation evidence v1, execution event v2, execution projection v3, and disposable `fanout.planning-report`/`fanout.execution-report` presentation data v1. Models submit planning bodies; controllers bind envelopes, exact source bytes, planning commit/tree/platform, IDs, and timestamps. Packet nodes embed canonical contracts and derive their graph/views; the sole final-validation node uses the reserved exact ID `final-validation`, which ordinary nodes cannot claim. Concrete node tier assignments are derived from the closed node kind and packet tier plan, and admission re-derives them to reject downgraded, unavailable, or substituted routing tuples. Pointer/packet admission rejects legacy, future, mixed, substituted, and unknown-field artifacts before lock creation or mutation. There is no compatibility adapter or migration path; obsolete authority requires replanning.

Reason: A staged compatibility bridge would leave multiple executable authorities for ownership, dependencies, commands, budgets, repository identity, and reporting. A coordinated fail-closed cutover makes every artifact boundary reviewable and lets package-independent core checks prove the same generation that Pi executes.

### Validate and repair only fresh exact reconstructions

Decision: The final-validation node is a controller gate rather than an ordinary worker. The controller rebuilds the planning base plus accepted ledger in a fresh detached worktree, verifies planning commit, clean index relation, and full Git-visible trees for both validation and active checkouts before and after the complete ordered command sequence, and records versioned exact evidence whose parser causally binds each failure class to its command and boundary state. Only nonzero, timeout, and signal results may consume the final node's fixed two-launch validation-repair pool. Every repair prompt embeds the immutable packet identity, original final command contract, packet-ordered upstream work contracts, and admitted failed-round evidence, including both checkout identities and any rejected candidate transition. The executor verifies that packet identity against the exact canonical packet bytes, and prompt rendering requires the node's effective contract to equal the recovery contract. Repair authority is the union of upstream typed change endpoints under their typed forbidden writes; every candidate is ownership-checked by closed violation codes and replayed into another fresh reconstruction before verified stdin apply to active.

Reason: Running validation in active or adopting a repair worker's checkout would make validation side effects and ignored residue part of the returned repository without proof. Sequence-boundary checks allow intentional create-then-remove checks while persistent drift fails closed without reset, replay, or rollback. This remains repository integrity under trusted-local-program semantics, not containment of ignored files, external paths, network, processes, services, or mutate-then-restore behavior.

### Run workers through fixed file capabilities and exact accepted patches

Decision: Every worker attempt keeps Pi's trusted automatic extension/provider discovery, `--approve`, `--no-context-files`, curated repository instructions, and the inherited parent environment, while `--tools` exposes exactly `read`, `grep`, `find`, `ls`, `edit`, and `write`. The Fanout extension synchronously rejects unavailable tools and edit/write targets using absolute, traversal, `.git`, or existing symlink segments. The node executor rebuilds fresh worktrees from the planning base plus ordered accepted-state transitions, captures and reverifies binary patches by digest/length/paths/HEAD/trees, and applies verified bytes through Git stdin with exact pre/post trees. A rejected validation-repair seed is not an accepted transition: its verified bytes may be overlaid only into the latest disposable reconstruction, after which the repaired candidate is recaptured relative to the current accepted tree and must pass the ordinary exact transition boundary before active mutation. Active drift fails without repair or reset; failure after active mutation is a distinct bookkeeping hard fail and Fanout does not guess a rollback.

Reason: Model capability restriction must happen before tool execution, while repository integration authority must remain exact bytes and tree transitions rather than mutable patch paths, unadmitted overlays, stdout scanning, or error-text routing. The seed-only overlay preserves disjoint concurrent accepted work without granting repository integration authority to a rejected candidate. This is repository hardening under Pi's local trust model, not containment of trusted extensions, providers, validation programs, ignored files, external paths, network, or processes.

### Prepare disposable worktrees only through explicit ignored paths

Decision: Dependency and tool availability in disposable worker and final-validation worktrees uses one explicit preparation input, supplied through `FANOUT_WORKTREE_SHARED_PATHS` or the equivalent executor option. Every entry must be a unique top-level repository-relative path that already exists in the active checkout and is ignored by Git. Preflight validates the complete list and live confirmation displays it before any worker allocation. The preparation boundary links the selected paths into each fresh reconstruction after authoritative patch replay; generic reconstruction has no language-, runtime-, or package-manager-specific path.

Reason: Reinstalling dependencies in every detached worktree adds network and lifecycle authority, while hard-coding one ecosystem's dependency directory would couple Fanout to a runtime. Explicit ignored paths reuse the user's preinstalled local environment without entering the Git-visible planning tree, accepted patch, or result-tree identity. Their contents remain outside Fanout write containment and may be read or mutated by trusted local extensions and validation programs under the existing local-Pi trust model.

### Normalize candidates only through packet-declared commands

Decision: Implementation details v4 owns one required, empty-able, repository-level `candidateNormalizationCommands` direct-argv list, and the compiler copies it into every work-contract v2 node, including final validation. Packet v6 admission rejects any node whose ordered manifest differs from the first node's manifest. After any successful worker or repair edit, the controller runs each configured command once in order in that disposable candidate worktree before patch capture, typed ownership enforcement, and the existing validation commands. Nonzero results remain audited and do not stop later normalizers; original validation alone decides whether model repair is needed. Preflight, spawn, timeout, signal, user abort, audit-publication failure, or repository-identity drift remain typed controller facts and never cause fixer inference or budget expansion. `candidate-normalization.json` records the manifest, results, timings, output, and before/after identities when readable, explicitly records unavailable identity evidence, and the attempt links that evidence. Initial integrated final validation remains unchanged; final-repair candidates use the final contract's list under the existing derived write union.

Reason: Attempts 11 and 12 of the p-map canary independently reached four successful work nodes, then exhausted both final repairs on deterministic XO formatting before semantic tests could run. Reconstructing Attempt 11, running the repository's explicit fixer once, then running `npm test` passed all 55 tests. A small packet-declared normalization seam reserves bounded model judgment for remaining failures while keeping Fanout language/runtime agnostic, user-reviewable, fail-closed, and exact at ownership and accepted-transition seams. Environment escape hatches, stderr classifiers, implicit fixers, and configurable repair budgets would create unreviewed or prose-derived authority. See GitHub issue #32.

## 2026-07-13

### Enforce planning capabilities and context-free reports

Decision: `/fanout-plan` injects typed Phase A, Phase B, and repair instructions once through `before_agent_start.systemPrompt` behind short visible triggers. Each attributed turn exposes only Pi's `read`, `grep`, `find`, and `ls` tools, `ask_user_question`, and one controller-bound `fanout_submit_artifact` tool; a fail-closed tool-call gate backs the active profile, and the exact prior profile is restored at the turn boundary. Planning and execution reports use versioned `appendEntry` data with registered entry renderers and never fall back to a message channel.

Reason: Prompt text is semantic guidance, not a capability boundary, and custom messages remain later model context even when they do not trigger a turn. Controller-derived artifact destinations plus context-free report entries preserve deterministic authority without claiming host containment.

This file records design decisions made during development. Keep new entries dated and concise.

## 2026-07-27

### Cut planning and execution to Project Execution Profiles

Decision: The only executable generation is Project Execution Profile v1, implementation plan v3, implementation details v5, work contract v3, execution packet v7, active packet pointer v2, Attempt Outcome v4, final-validation evidence v2, execution event v4, and projection v5. Profiles own approved preparation, readiness, candidate normalization, and project-wide final gates; packets retain task scope, graph, task validation, routing, and model-work authority and bind the exact profile artifact identity. Packet final commands run before profile final gates, and final-repair recovery derives from that exact combined ordered command manifest. `/fanout-plan --refresh-profile` validates a replacement in a disposable clean worktree before atomically publishing it; failure preserves the previous profile. Older executable artifacts require replanning, while older events and projections remain descriptive Legacy evidence.

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

Decision: After initial graph and tier derivation, the compiler iteratively fuses only unique predecessor/successor chains with matching kind, tier, profile context, coverage-normalized resource closure, and compatible validation. A later node must explicitly read an earlier write after change. Source order, exact-entry deduplication, authority union, dependencies, and `sourcePlanIds` are preserved; deterministic fused IDs derive from ordered source node IDs. Branches, joins, final-validation edges, incompatible contexts, and runtime fusion are excluded.

Reason: One setup/model/normalization/validation/apply cycle is cheaper than artificial vertical serial boundaries, while deterministic compiler ownership keeps runtime and packet authority unchanged.

### Keep profiler and tmux changes compatibility-only

Decision: Evidence Receipts, exact cohorts, comparisons, and node alignment include exact profile identity, and existing inspector fields surface reconciliation and exact-no-progress dispositions. Scenario schedules use the post-confirmation Event boundary; total run duration may exceed the Event span because profile validation precedes `run-started`, but it may not be shorter. No profiler page, route, export, dashboard, or benchmark framework is added. Interactive benchmark runs create a fresh visible pane in `doubleword:fanout-canary`; tmux remains an operator/runbook boundary and never becomes product authority.

Reason: The current profiler already has the required evidence seams, and pane control is operational evidence collection rather than Fanout behavior.

## 2026-07-13

### Make the event log the only run-state authority

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

Decision: Keep the DAG idea, but do not build a DAG executor initially. Use planning prompts to ask what must be investigated and what can be parallelized.

Reason: A strict DAG can make the system brittle. Prompt-first planning gives flexibility with less code.

### Predictive coding starts as prompting

Decision: Predictive coding begins as prompts that encourage broad investigation, parallelizable tool calls, and research-plan-execute behavior. Indexing is deferred.

Reason: Prompting may capture much of the benefit without building a repo index.

### Subagents deferred

Decision: Do not build subagents initially.

Reason: Normal Pi does not parallelize multiple provider calls in one session. Subagents may be needed later, but provider stubs and observability should come first.

### Model profiles/fusion deferred

Decision: Defer model routing profiles such as cheap investigator, deep researcher, patcher, and reviewer.

Reason: Useful later, but not needed to validate provider mechanics and async latency.

### Batch tier deferred for active workflows

Decision: Do not make batch a normal interactive provider initially. Treat it as future benchmark/eval infrastructure.

Reason: Batch latency does not fit one active Pi turn. It is better for trace replay, evals, and bulk jobs.

### Use this repo for code and resources

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

Decision: Planned Parallel RPE requires a tier1 planner, conflict-aware scheduler, isolated background executors, parallel reviewers, cancellation for speculative pre-confirm work, file ownership constraints, and final tier1 review/synthesis before acceptance.

Reason: Tier2 execution is useful only when latency is hidden behind an explicit next-actionable boundary and outputs cannot corrupt the active worktree. Isolation, ownership, cancellation, and review make cost savings auditable without implying live runtime TAT has improved yet.

## 2026-06-26

### Route Planned Parallel RPE by accepted DAG critical path and user wait budget

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

Decision: Keep raw prompt-DAG generator/evaluator artifacts ignored under `runs/`, but promote durable summaries, best prompt text, and the experiment template into tracked `docs/benchmarks/fanout-dag-*.md` files.

Reason: Raw artifacts are useful for local audit but too noisy to commit. Tracked summaries preserve the benchmark result, reproducible procedure, and current prompt candidates for future clones and reviews.

## 2026-07-08

### Split `/fanout-plan` into explicit implementation and detail prompts

Status: The two-phase planning decision remains current; its legacy packet output was superseded on 2026-07-14 by the closed plan-v2/details-v3/packet-v5 generation.

Decision: Keep one `/fanout-plan` command, but run two explicit prompts plus a deterministic compiler. The controller envelopes Phase A as plan v2 and Phase B as details v3, binds their exact identities, and compiles packet v5 nodes containing one work-contract v1 each. `fanout-core` groups typed change resources, derives dependencies from typed `post-change-required` reads, assigns tiers, and stores authoritative integrated validation only in the final-validation contract.

Reason: Implementation planning, repo grounding, and execution compilation are different jobs. The intermediate artifacts make failures debuggable, keep Phase B from inventing scope or DAG shape, and let code enforce ownership/dependency rules consistently.

### Compiler owns execution DAG construction

Decision: Phase A decides what/why and maximum typed scope; Phase B supplies typed changes, anchors, reads, forbidden writes, and direct-argv validation; the compiler owns grouping, DAG derivation, and tier assignment. Phase A boundaries follow independent authorability, acceptability, and repairability rather than file categories: production and behavioral-test writes that cannot be accepted or repaired independently belong to one item, then a split pass separates every remaining independently authorable and repairable change. Split items declare genuine typed reads honestly and never pad reads to trigger fusion. Phase B uses `baseline-context` whenever planning-base contents are sufficient and reserves `post-change-required` for a specific accepted upstream change whose reason explains why the baseline is insufficient; convenience, precautionary, redundant, and transitive dependencies are rejected. Every Phase A write remains covered by same-source Phase B changes. A cross-node Phase A read must receive typed Phase B timing; after one unsuccessful Phase B repair, the compiler may insert a typed `post-change-required` read with `timingSource: "sequential-fallback"`, which derives both the conservative edge and its warning. No prose, formatted diagnostic, persisted graph, or worker handoff copy controls scheduling.

Reason: Prompted DAG construction was too easy to overfit or over-serialize. File-category splitting also produced a test-only repair boundary that could detect but not repair its production defect. Independent repairability plus deterministic grouping and read-dependency rules keeps authority honest without weakening compiler fusion predicates.

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

Decision: `/fanout-execute` must reject accepted LLM worker results that lack provider, model, tier, token, cost, pricing source, TTFT, poll, tool, and worker-duration metrics. Failed or rejected workers may keep partial diagnostic metrics, but accepted workers cannot use null placeholders or guessed token estimates.

Reason: Phase 3 exists to compare workflow and provider-tier tradeoffs. Accepting patches without complete metrics would make the execution evidence unusable.

### Run Fanout workers with curated subprocess context

Decision: Phase 3 workers run as non-interactive Pi subprocesses in isolated git worktrees with curated Fanout prompts and no automatically loaded context files. The main session owns planning, approval, and user interaction; the worker prompt receives packet-approved context plus applicable repo-local `AGENTS.md`/`CLAUDE.md` instructions explicitly selected from root/ancestor directories for owned and read-only paths. Workers must not ask for confirmation or broaden scope. Automatically discovered Pi extensions are a separate trusted runtime boundary, as recorded below. This supersedes the earlier preference for native Pi subagents or a third-party worker package.

Reason: The Phase 3 contract needs a fresh git worktree per attempt, attempt-scoped stdout/stderr/session/observability artifacts, mandatory metrics, and exact subprocess lifecycle classification. The available main-session loop does not expose those boundaries as one native subagent primitive. Automatic context discovery may also load global or unrelated instructions containing main-session rules such as planning and waiting for approval; explicit repo-path-based selection preserves applicable project constraints without inheriting that broader interactive context.

### Allow only typed bounded execution recovery

Decision: `/fanout-execute` may run bounded tier1 recovery for two typed cases: validation-failure repair and integration-conflict repair. Retry/fallback handles retryable tier2 worker/provider failures. Generic repair agents, scope expansion, ownership expansion, partial patch application, and arbitrary retries remain out of scope.

Reason: Valid worker output can still fail local validation or conflict with already-applied parallel patches. Typed bounded recovery preserves safety while avoiding an open-ended repair loop.

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

Status: Lock location and stale-lock handling refined on 2026-07-10 by the canonical git-worktree lock decision below; the serialized in-run apply gate remains current.

Decision: `/fanout-execute` acquires the exclusive canonical git-worktree lock described below before preflight. Within that run, parallel workers may execute concurrently, but each active-worktree `git apply --check` and matching `git apply` runs inside one serialized apply gate.

Reason: The check and apply must observe the same integrated state. The project lock prevents separate Pi sessions from integrating divergent packet runs into the same worktree, while the in-run gate prevents parallel nodes from interleaving their checks and applies.

### Use Pi JSON usage as the worker pricing source

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

Status: The attempt-evidence policy remains current; packet-v4 adaptation and the legacy bridge were removed by the 2026-07-14 coordinated cutover.

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
