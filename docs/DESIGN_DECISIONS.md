# Design Decisions

This file records design decisions made during development. Keep new entries dated and concise.

## 2026-07-13

### Admit repository authority through one canonical core module

Decision: `fanout-core` owns literal `RepoPath` parsing, explicit file/directory resources, same-source directional authorization, connected ownership, typed read timing, monotonic typed forbidden writes, and exact UTF-8 Git-path admission. Advisory forbidden notes never affect policy.

Reason: Planning and Git-observed changes need one identity-preserving resource contract. This preparatory hardening slice is directly tested but does not create a second executable authority; later coordinated slices replace legacy packet and runtime fields.

### Execute approved validation as direct argv

Decision: `fanout-core` strictly admits executable/argument validation manifests with canonical optional cwd and literal environment overrides. The Pi adapter preflights and rechecks launchability, runs exact argv without an implicit shell, preserves order and duplicates, and records typed fail-fast outcomes including explicit unexecuted commands.

Reason: Deterministic argument boundaries and honest local-program trust replace misleading shell-string safety parsing. This preparatory runner is directly tested while production callers remain on the legacy path until the coordinated schema cutover.

### Bind artifacts and repository transitions to exact identity

Decision: Use strict `{ path, sha256, byteLength }` artifact identities, same-directory atomic replacement, pointer-last planning publication, temporary-index full Git-visible trees, and one binary-patch accepted-state transition shape. Patch verification and replay rederive exact paths and trees, consume verified bytes through Git stdin, and leave post-apply ambiguity untouched for manual reconciliation.

Reason: Exact bytes and tree chains reject stale or substituted authority without mutating the user's index or adding content-addressed storage and automatic recovery. These preparatory primitives are directly tested; legacy callers remain unchanged until the coordinated cutover.

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

Reason: This keeps the normal Pi loop while nudging each turn to batch independent reads, greps, inspections, and checks before adding any custom orchestration.

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

Decision: Do not build a DAG executor from the B0 trace evidence.

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

Reason: The mixed run proves parser, simulator, schedule, active/background, and target-accounting semantics across existing and synthetic inputs. It does not prove that existing Pi traces have the same eligible workflow shape, so overclaiming would hide the difference between workflow feasibility and observed-trace evidence.

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

Decision: Fill missing Doubleword `/v1/models` metadata in the provider by marking generation models reasoning-capable, OCR/embedding models non-reasoning, mapping Pi thinking levels to top-level `reasoning_effort`, and attaching realtime/async/batch Fanout tier metadata. Preserve live catalog metadata if Doubleword adds it later.

Reason: Pi needs `reasoning` and `thinkingLevelMap` for `Shift+Tab` thinking control, while Fanout consumers need tier capability metadata without coupling Fanout planning logic to Doubleword model-name rules.

## 2026-06-30

### Publish standalone Doubleword provider extension package

Decision: Publish the standalone Doubleword provider extension as `@snehalyelmati/pi-doubleword-provider`, independent from Fanout release order.

Reason: The provider has a clear standalone extension-package boundary: it registers the live `doubleword` provider for Pi, while dev-only stubs remain outside the packed npm package. Publishing it separately lets users install Doubleword support without Fanout.

### Split Fanout into user research, execution packet, and execution

Decision: Make Fanout a three-phase workflow: user-owned research/planning, `/fanout-plan` execution-packet preparation, and `/fanout-execute` execution of the active accepted packet.

Reason: Keeping research/planning outside Fanout lets users use their own workflow and gives the executor better inputs. The packet boundary lets Fanout validate a fanout-agnostic plan, optimized DAG, ownership, estimates, and stop rules before any worker mutates files.

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

Status: The two-phase planning decision remains current; its schema-v3 output was superseded on 2026-07-10 by [the schema-v4 `tier2Fallback` decision](#separate-the-tier-2-fallback-model-role-from-tier-1).

Decision: Keep one `/fanout-plan` command, but run two explicit prompts plus a deterministic compiler: Phase A writes `implementation-plan.json`; Phase B reads it and writes schema-v2 `implementation-details.json`; `fanout-core` validates, groups owned resources, derives dependencies from concrete `post-change-required` reads, computes parallel groups/tiers, and emits execution packet schema v3 with per-unit `workerPacket` handoff context. Details v2 separates per-item isolated validation commands from required top-level final integrated validation commands.

Reason: Implementation planning, repo grounding, and execution compilation are different jobs. The intermediate artifacts make failures debuggable, keep Phase B from inventing scope or DAG shape, and let code enforce ownership/dependency rules consistently.

### Compiler owns execution DAG construction

Decision: Phase A decides what/why, Phase B locates anchors/edit intent, and the compiler owns DAG/parallelism/tier assignment. Work units are file/resource ownership shards; Phase B should prefer one details item per independently editable file/resource and reuse Phase A ids across split items, except an explicit task-declared ownership bundle remains one ownership unit even when its files could otherwise be sharded. Every Phase A `filesToChange` entry must be covered by same-id Phase B writable resources so required scope cannot be dropped during grounding. Phase A ids and dependencies are traceability/planning context, while only Phase B `post-change-required` file reads create cross-worker execution edges. An explicitly task-declared validation dependency with a concrete upstream Phase A file read is a narrow exception: Phase B must classify that read as `post-change-required`, and the compiler rejects a missing or `baseline-context` classification. This validates the declared dependency without making ordinary Phase A semantic dependencies scheduling edges. If any other Phase A `filesToRead` entry overlaps a sibling-owned file/resource, Phase B must classify that read as `baseline-context` or `post-change-required`; otherwise the compiler rejects the packet as ambiguous by default. The Pi adapter precomputes those Phase A overlap rows for the Phase B prompt, but never infers the classification. The Pi adapter may run one Phase B repair pass and, if repair still misses a classification, choose conservative sequential fallback that treats unclassified overlaps as implicit `post-change-required` with a warning. `/fanout-plan` no longer creates a default contract node; same-owned-resource changes merge into one worker packet unless the compiler rejects ambiguity.

Reason: Prompted DAG construction was too easy to overfit or over-serialize. Deterministic grouping and read-dependency rules are smaller, safer, and easier to smoke-test before `/fanout-execute` exists.

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

Decision: The execution recorder derives `<packet-artifact-dir>` from `dirname(packetPath)` and ignores the packet's `artifactDir` field when choosing where to write `executions/<run-id>/`.

Reason: The validated pointer identifies the packet source of truth. Reusing an independently supplied artifact path would let packet content redirect audit writes away from that source.

### Require a clean active worktree without claiming stale-HEAD detection

Decision: `/fanout-execute` preflight requires a clean active git worktree, execution artifacts outside the repo, safe packet paths, and an available worker command. Execution packet schema v4 does not record a planned commit or tree, so Phase 3 does not claim to detect a clean checkout whose HEAD changed after planning.

Reason: A clean baseline makes integrated patches attributable and prevents accidental mixing with user edits. Strong freshness validation requires a future packet schema field rather than an inference from timestamps.

### Rebuild accepted integration state in fresh detached worktrees

Decision: Every worker, retry, fallback, and repair attempt gets a fresh detached worktree. An ordered integration ledger rebuilds accepted state there and commits it only as a local baseline before the current attempt runs. Fanout disables repository Git hooks and configured filesystem-monitor commands during managed worktree creation, staging, baseline commits, intent-to-add patch capture, and execution preflight. Normal results replay their accepted patch; a conflict-repair result records final snapshots of its owned changed files so later worktrees reproduce the state against which that repair was made.

Reason: `git worktree add ... HEAD` does not include uncommitted changes already applied to the active worktree, and a repaired patch may be based on a newer conflicting file state rather than bare `HEAD`. The ordered ledger plus detached baseline commit gives patch capture an exact diff boundary while preserving attempt isolation and downstream visibility. Disabling hooks and filesystem monitors prevents repository-configured commands from adding unrecorded state to that boundary.

### Serialize active-worktree patch application

Status: Lock location and stale-lock handling refined on 2026-07-10 by the canonical git-worktree lock decision below; the serialized in-run apply gate remains current.

Decision: `/fanout-execute` acquires the exclusive canonical git-worktree lock described below before preflight. Within that run, parallel workers may execute concurrently, but each active-worktree `git apply --check` and matching `git apply` runs inside one serialized apply gate.

Reason: The check and apply must observe the same integrated state. The project lock prevents separate Pi sessions from integrating divergent packet runs into the same worktree, while the in-run gate prevents parallel nodes from interleaving their checks and applies.

### Use Pi JSON usage as the worker pricing source

Decision: Worker tokens and estimated cost come from Pi JSON assistant `message_end` usage. Generic providers are recorded with pricing source `pi-json-usage`; Doubleword workers additionally require matching `provider_end` events whose provider-supplied input, output, total, and cost values equal the Pi message values and whose pricing provenance is `doubleword-model-metadata`. Doubleword fallback word-count estimates and synthetic stub usage cannot be accepted. Tier2 poll metrics require matching `async_poll` records or matching provider completion records that explicitly report zero polls. TTFT uses provider `provider_ttft` timing when available and otherwise the parent's measured time to first assistant output.

Reason: Pi JSON provides the provider-agnostic usage shape, while Doubleword observability distinguishes API-reported tokens from compatibility estimates and identifies the price table. The measured TTFT fallback is a local clock fact; no token or timing values are inferred to fill gaps.

### Define no-op, partial-failure, and final-validation semantics

Decision: A work unit with zero owned files may succeed with an empty patch; a mutating unit may not. Any failed or skipped DAG node maps the run to `failed` rather than a separate partial status. The final-validation worker remains a DAG node, but the deterministic `finalValidationPlan` rerun in the active worktree is authoritative for overall execution success.

Reason: The compiler already emits read-only final-validation units, while mutating units must produce reviewable changes. One failed terminal status keeps reporting unambiguous, and the controller-run validation observes the exact integrated tree returned to the user.

### Keep automatic Pi extension discovery for workers

Decision: Worker subprocesses explicitly load the Fanout extension, keep Pi's automatic extension discovery enabled, and pass `--approve` so trusted project-local Pi resources can load without an interactive trust prompt. `--no-context-files` disables Pi's automatic `AGENTS.md`/`CLAUDE.md` context loading; the parent separately selects and injects the applicable repo-local instruction files into the worker prompt. Enabled extensions and their hooks/tools are trusted runtime code, not packet-approved prompt context.

Reason: Packet-assigned providers and models may be registered by installed or project extensions, so `--no-extensions` would make valid worker assignments unavailable. This expands the worker trust boundary and must remain explicit; worktree isolation and patch ownership gates do not sandbox extension side effects.

### Lock by canonical git-worktree identity

Decision: Normal and dry execution acquire `fanout-execution.lock` under the canonical absolute git directory for the active worktree, falling back to the project artifact root only when git-directory resolution is unavailable. The owner removes its lock on normal return. An existing lock is authoritative and is never deleted automatically based on PID or an inferred stale state.

Reason: Canonical git-directory identity makes sessions launched from different subdirectories share the same worktree lock, while distinct linked worktrees can proceed independently. Automatic stale deletion risks PID reuse and concurrent mutation; recovery requires the user to verify that no execution is active before removing the reported lock path.

### Keep Phase 3 attempt budgets fixed

Status: The fixed attempt budgets remain current; the Tier 1 control-model fallback was superseded on 2026-07-10 by [the realtime `tier2Fallback` model-role decision](#separate-the-tier-2-fallback-model-role-from-tier-1).

Decision: `fanout.execution.maxConcurrency` is the only user execution setting consumed by `/fanout-execute`. The MVP policy fixes tier1 and tier2 to one original attempt plus one clean rerun, permits one tier1 fallback after retryable tier2 exhaustion when the work unit declares it, and permits at most two validation-repair and two integration-repair attempts. Provider availability is not preflighted and a node failure never globally reroutes remaining tier2 nodes.

Reason: Fixed per-node budgets keep scheduling, cost accounting, and recovery deterministic while the first execution path is validated. Provider/model launch errors remain typed subprocess outcomes rather than a reason to mutate the accepted packet's assignments.

### Render execution reports from audit state

Decision: `summary.md` is rendered deterministically from `execution-run.json`: canonical event counts supply attempt/retry/fallback/rejection counts, accepted patch stats supply changed-file names, and run-level final-validation stats supply the authoritative validation outcome and link. No LLM synthesis rewrites execution results.

Reason: The user-facing report must agree with `events.jsonl`, the snapshot totals, accepted patches, and `final-validation.json`. Snapshot-derived reporting makes failures and wasted attempts inspectable without introducing another model-authored interpretation layer.

### Require node validation to preserve the captured patch

Decision: After node validation commands finish, `/fanout-execute` verifies that the isolated worktree diff still exactly matches the captured patch and that its detached `HEAD` did not move. Any validator-created, reverted, deleted, or committed change rejects the attempt before active-worktree apply.

Reason: A validation command can have side effects. Applying the pre-validation patch after testing a different tree would make the validation evidence false, even when the command exited successfully.

### Keep Git-observed paths lossless at the ownership boundary

Decision: Packet resource paths may be normalized into repository-relative form, but filenames reported by Git are validated without trimming whitespace or converting backslashes. An observed filename is rejected if normalization would change its identity. All machine-readable artifact path fields use bare repository-relative paths, and executable command fields use literal shell commands without Markdown quoting. Markdown backticks are reserved for repository paths embedded in human-readable `forbiddenChanges` prose, which retains trailing `/` directory intent; execution also recognizes common unquoted legacy directory forms so those constraints remain enforceable at the ownership gate. Phase A validation fields describe required coverage only and are never executed; Phase B supplies the literal executable validation commands.

Reason: On POSIX, backslashes and leading/trailing spaces are valid filename bytes. Lossy normalization could make an undeclared root file appear to be an owned descendant while `git apply` still targets the original filename.

## 2026-07-11

### Review generated execution packets semantically

Decision: Review generated plans against required behavior, ownership, dependencies, safety boundaries, and authoritative validation rather than textual equality with benchmark examples. Safe, non-mutating, task-traceable additions are acceptable. Command wrappers are operational conveniences, not correctness requirements. Rendered summaries may omit detail only when the omission is clearly labeled and the authoritative packet remains unambiguous.

Reason: Model-grounded plans can express the same safe execution contract with harmless command or presentation differences. Treating those differences as failures overfits the benchmark, while unlabeled contradictions still make review unreliable.

### Label dry-run execution summaries explicitly

Decision: Keep execution-run schema v1 unchanged, but render dry-run `summary.md` artifacts as `Fanout Dry Run Summary` and state that workers and final validation were intentionally not run. Live execution summaries retain their existing format.

Reason: A dry run may succeed while every node remains pending and final validation is absent. An explicit label prevents that preflight result from being mistaken for a completed live execution without duplicating packet data or changing the run schema.

## 2026-07-10

### Treat Phase A as the resolved objective source

Decision: `/fanout-plan` preserves the invocation text for traceability, but Phase A owns the resolved objective after reading referenced context. Phase B must copy that objective exactly, while the adapter validates Phase A against its artifact directory rather than the invocation string.

Reason: File references and shorthand invocations are inputs to planning, not necessarily the final execution objective. Exact invocation equality rejected correct, more specific plans.

### Keep main-session Fanout telemetry outside target repositories

Decision: The Fanout adapter routes its common session and bundled Doubleword telemetry to Pi-owned project artifact storage unless `DOUBLEWORD_OBSERVABILITY_FILE` explicitly overrides it. Common adapter events use `sessionRunId`, bundled provider events retain the legacy field name `runId`, and both values identify the same Pi session; planning events add `planRunId`. Execution audit schemas remain unchanged.

Reason: Repository-local startup telemetry dirtied target worktrees and then failed Fanout's own clean-worktree preflight. Separate identifiers keep session and planning scope unambiguous.

### Configure tier2 only with currently usable models

Decision: `/fanout-config` lists tier2 models only when `fanout.async`, `fanout.background`, and `fanout.authReady` are all true. Tier1 remains unrestricted, and unavailable tier2 configuration does not add a planning confirmation step.

Reason: Reporting configuration success for an unusable model hid deterministic realtime `tier2Fallback` routing and made the selected routing policy misleading.

### Separate the Tier 2 fallback model role from Tier 1

Decision: Keep two execution tiers but store three concrete model roles in execution packet schema v4: Tier 1 realtime control plane, Tier 2 async workers, and Tier 2 fallback realtime execution. The fallback role inherits Tier 1 unless `fanout.execution.tier2Fallback` selects another registry model. Tier2-unavailable compilation and exhausted retryable Tier 2 attempts use the fallback role; Tier 1 control work and typed recovery continue using Tier 1. Schema v3 packets require replanning and are not migrated.

Reason: A strong control-plane model should not force every realtime execution fallback to use the same expensive model. A packet-level concrete fallback keeps execution deterministic without adding a third tier, per-node profiles, or runtime replanning.

### Keep Tier 1 synchronized with Pi

Decision: Tier 1 always uses Pi's current model and thinking level. `/fanout-config tier1` changes that Pi state through `setModel()` and `setThinkingLevel()` rather than persisting an independent `fanout.tiers.tier1` override. Legacy overrides are ignored and removed when Tier 1 is next configured. Fanout reads supported thinking levels from Pi instead of maintaining its own interpretation of provider maps.

Reason: One model source of truth prevents the interactive session and Tier 1 control plane from drifting, while Pi's registry already owns provider models, capability maps, clamping, authentication, and model-change events.

### Allow users to disable Tier 2 routing

Decision: Tier 2 remains enabled by default when its configured model is usable, but `/fanout-config tier2` may explicitly set `fanout.tiers.tier2.enabled` to `false`. Newly planned packets then assign eligible workers to the concrete realtime `tier2Fallback` role. Selecting a Tier 2 model re-enables async routing; existing accepted packets keep their concrete assignments.

Reason: Users need a simple way to run the control plane and worker plane with two realtime models without editing JSON manually or weakening packet determinism.
