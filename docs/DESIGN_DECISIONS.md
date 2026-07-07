# Design Decisions

This file records design decisions made during development. Keep new entries dated and concise.

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
