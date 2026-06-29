# Roadmap

## Objective

Build Fanout as an agent-agnostic optimization layer, plus a standalone Doubleword provider and a Pi adapter:

- `doubleword-provider`: how to call Doubleword models and tiers.
- `fanout-core`: how to split, schedule, validate, and review work safely.
- `fanout-pi`: Pi adapter/install target that can use both.

The Doubleword provider adapts to these inference tiers:

- **Realtime**: interactive, standard OpenAI-compatible usage.
- **Async / tier 2**: minutes-scale TTFT via Responses API polling, lower cost.
- **Batch / tier 3**: long-running JSONL batch jobs, lowest cost.

Fanout should preserve developer velocity where possible by using async only where latency can be hidden or amortized.

## Principles

- Stay Pi-native first; avoid a new agent loop unless necessary.
- Keep Doubleword provider support independent from Fanout.
- Keep Fanout core independent from Pi and Doubleword.
- Stub before live endpoints.
- Observability first.
- Use planning prompts before custom orchestration.
- Separate workflow gains from provider-tier savings in every benchmark.
- Keep expensive/deep workflow ideas deferred until benchmarks justify them.

## Phase 0: Project docs and planning

- Create project docs and working rules.
- Track scope in this roadmap.
- Track decisions in `docs/DESIGN_DECISIONS.md`.
- Keep the repo as one minimal monorepo with `doubleword-provider`, `fanout-core`, and `fanout-pi`.

## Deferred: Pi package marketplace release

Status: deferred for now.

Release process when packaging resumes:

1. Choose the package boundary and npm name, for example `@snehalyelmati/pi-doubleword-provider` for a standalone provider package.
2. Validate the exact install path locally with `pi -e` or `pi install`.
3. Set npm metadata: public package, useful `description`, `README.md`, and `keywords` including `pi-package`.
4. Add/verify the `pi` manifest, for example `"pi": { "extensions": ["./src/index.ts"] }`.
5. Dry-run the npm package with `npm pack --dry-run` and confirm only needed files ship.
6. Publish with `npm publish --access public`.
7. Verify `pi install npm:<package>` and confirm the package appears in the Pi package gallery.

## Phase 1: Provider stubs

Status: provider stubs live in `doubleword-provider`, with `fanout-pi` registering them for Pi.

Build provider stubs without hitting Doubleword live endpoints.

### Realtime stub

- Immediate fake response.
- Optional fixture-backed responses.
- Optional fake streaming if needed for UI tests.

### Async stub

- Simulate submit → queued/in-progress → complete.
- Configurable TTFT / poll delay.
- Fake response IDs.
- Fixture-backed final text/tool-call responses.

## Phase 2: Observability test environment

Status: initial JSONL hooks are in place for provider, TTFT, async polling, usage/cost, errors/abort, tool timings, agent turn count, and tool batch size per turn. A tiny observability smoke asserts core JSONL events/fields; Phase 6 now has an initial offline trace summarizer, while full trace replay/dataset benchmarks remain deferred.

Capture per-run JSONL spans for:

- run/session IDs
- provider tier
- model/provider name
- provider submit time
- time to first token/event (TTFT)
- total provider time
- poll count and poll duration
- tool execution timings
- turn and agent timings
- agent turn count and per-turn tool batch size
- token usage
- cost estimate
- errors/abort state

Suggested output locations:

```text
runs/<run-id>/observability.jsonl
runs/<run-id>/plan.md
runs/<run-id>/jobs/*.json
```

## Phase 3: Pi-native planning workflow

Status: initial `/dw-plan` prompt template, always-on batching discipline, and smoke checks are in place.

Start with prompt/template workflow, not a custom DAG executor.

Planning prompt behavior:

- Plan only: no edits, patches, codegen, migrations, or mutating commands.
- Investigate before asking when facts are discoverable from the repo/environment.
- Identify what must be read, grepped, tested, or clarified.
- Batch independent reads, greps, git inspection, and checks in the same model turn when possible.
- Inject a lighter always-on batching discipline into normal execution so each turn looks ahead before using tools.
- Ask as many questions as needed until the ask is clear and execution has no material doubts.
- Produce a concise `<proposed_plan>` before execution when decision-complete; otherwise ask the next needed questions.

This is the first version of “predictive coding”: prompt the model to predict useful investigations and parallelizable work. Indexing is deferred.

## Phase 4: Live-shaped realtime Doubleword stubs

Status: `doubleword-stub` exposes the first live-shaped model IDs and pricing metadata. An opt-in `doubleword` live provider now calls the Responses API with `service_tier: "priority"`, discovers live models from `/v1/models`, and caches that catalog; normal validation remains offline and keyless.

- Register Doubleword realtime-shaped stub models for `glm-5-2` ($1.40/$4.40 per MTok in/out) and `deepseek-v4-flash` ($0.14/$0.28 per MTok in/out).
- Use pricing metadata from `https://doubleword.ai/pricing` for stub cost estimates and known live model tier costs; unknown discovered models remain available with zero-cost placeholders until pricing is added.
- Keep the stub path available for tests; no live API key or network required.
- Verify model IDs, fixture streaming, usage reporting, and pricing metadata.
- Register opt-in live realtime models under `doubleword` from provider discovery/cache, falling back to the minimal GLM/DeepSeek list when discovery is unavailable.
- Keep live smoke opt-in with `DOUBLEWORD_API_KEY`; no live network in default checks.

## Phase 5: Live async Doubleword provider

Status: opt-in async mode for `doubleword` is wired for discovered/cached live models, Responses API background polling, 16k default output cap, wall-clock timeout, transient poll retry, final GET on timeout, and best-effort remote cancellation. `doubleword` and `doubleword-stub` keep model IDs stable and use a status-line toggle for realtime vs async when the selected provider supports multiple tiers. Normal validation remains offline and keyless.

- Register live-shaped async-capable models under `doubleword` from provider discovery/cache, falling back to the minimal GLM/DeepSeek list when discovery is unavailable.
- Use Responses API at `https://api.doubleword.ai/v1` with `service_tier: "flex"`, `background: true`, and `max_output_tokens` defaulting to 16k (`DOUBLEWORD_MAX_OUTPUT_TOKENS` overrides).
- Poll `GET /v1/responses/{id}` while status is `queued` or `in_progress`, retry transient poll failures, and enforce a 10 minute wall-clock timeout (`DOUBLEWORD_LIVE_ASYNC_TIMEOUT_MS` overrides).
- On timeout, perform one final GET; if still incomplete, best-effort cancel `POST /v1/responses/{id}/cancel`. On user abort, stop the local stream promptly and fire-and-forget the remote cancel.
- Translate completed Responses output into Pi assistant events after completion: reasoning items become `thinking` blocks, final `output_text` becomes text; no streaming before completion is assumed.
- Track response ID, status transitions, requested/actual service tier, poll time, usage, timeout, cancellation, retries, and errors.
- Keep live smoke opt-in with `DOUBLEWORD_API_KEY`; no live network in default checks.

Key limitation to validate live: async responses may not stream; Pi may only receive content/tool calls after completion. Tool-call translation remains pending.

## Phase 6: Stub/trace benchmarks

Status: initial offline trace summarizer, smoke fixtures, deterministic hybrid policy simulation, and target evidence docs are in place. It reads local `observability.jsonl` files, raw Pi session JSONL traces, and versioned synthetic hybrid workflow JSONL fixtures, then produces `runs/phase6/summary.json` plus `summary.md`; no live calls or replay engine. Manual semantic subagent reviews now supersede the coarse optimistic-DAG heuristic. Hybrid fixture reports now include policy matrices with active TAT, background completion, target status, per-node schedules, budget/deadline/fallback/speculative evidence, and tier2 concurrency caps. The mixed fixture command demonstrates synthetic non-baseline tier2 passes for eligible workflow shapes and marks linear mandatory active critical paths infeasible. Results are tracked in `docs/BENCHMARKS.md`, [`docs/benchmarks/semantic-dag-and-rpe.md`](benchmarks/semantic-dag-and-rpe.md), and [`docs/benchmarks/hybrid-target-evidence.md`](benchmarks/hybrid-target-evidence.md).

Run:

```bash
rtk npm run benchmark:traces -- datasets/fixtures/phase6-observability.jsonl
rtk npm run benchmark:traces -- datasets/fixtures/pi-session-trace.jsonl --model glm-5-2
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
# after placing ignored external samples under datasets/traces/pi-mono-sample:
rtk npm run benchmark:traces -- datasets/traces/pi-mono-sample --model glm-5-2
rtk npm run smoke:benchmarks
```

Candidate datasets:

- `badlogicgames/pi-mono` — Pi-native session traces.
- `grfwings/pi-session-traces` — Pi-native traces.
- `trace-commons/agent-traces` — mixed agent traces, includes Pi/Claude/Codex/etc.
- `pagarsky/agent-trace` — telemetry-oriented tool-use traces.
- `NJU-LINK/CodeTraceBench` — labeled trajectory diagnosis benchmark.
- `nebius/SWE-agent-trajectories` — SWE-agent trajectories.
- `nebius/SWE-rebench-openhands-trajectories` — OpenHands trajectories.
- `nvidia/Open-SWE-Traces` and `nvidia/SWE-Zero-openhands-trajectories` — large SWE trace sets.

Store local samples under:

```text
datasets/traces/
datasets/fixtures/
```

Current benchmark questions answered by the summarizer and `docs/BENCHMARKS.md`:

- How many model turns does the workflow need? Use `agent_end.turnCount` and `turn_*` events.
- How many local tool calls are batched into each turn? Use `turn_end.toolCallCount`.
- Does async TTFT multiply wall-clock time or get amortized? Use async provider duration, TTFT, poll count, and poll duration totals.
- What is cost vs realtime? Use provider usage/cost totals plus the `glm-5-2` tier comparison table.
- Does planning-first reduce retries and wasted turns? Compare summaries from plain runs vs `/dw-plan` runs.
- Which synthetic hybrid workflow policies meet the 3x active TAT target? Use hybrid policy results, active/background schedules, and target statuses.
- Which workflow classes are ineligible? Linear mandatory critical-path fixtures are reported as infeasible instead of as tier2 feasibility passes.
- Which evidence is observed versus synthetic? Mixed reports preserve `observability`, `pi-session`, and synthetic `hybrid-workflow` source labels.

Deferred until the summaries prove they are needed: external dataset downloader, trace replay engine, strict DAG executor, subagents, and indexing.

## Phase 7: Planned Parallel RPE prototypes

Status: design docs, offline safe-work-unit evaluator, full `pi-mono` TAT bucket code-shard evaluation, and trace-derived wait estimates are in place. Runtime prototype remains deferred until the execution packet and scheduler policy are defined.

Trace-backed direction:

- Generic interactive DAG tier2 routing is weak: manual semantic review found only ~1.5% tier2 savings in 10 traces.
- One-turn synthetic hybrid fixtures prove simulator accounting, but they are insufficient evidence for realistic multi-turn Pi traces.
- Tier1 semantic batching is valuable: manual estimates show ~25% savings from fewer turns/context, independent of Doubleword.
- Research-plan-execute background routing is promising: 5 RPE traces saved ~22% when research+plan stayed tier1 and execute moved to tier2, but sequential completion became 14-28h.
- Full `pi-mono` TAT bucket code-shard evaluation found 49 predicted code-edit units across 15 traces, with 31 safe independent, 16 safe-after-dependency, 2 unsafe, safety precision 1, and tier2 execution waits of 5-40m by accepted DAG depth.
- Speculative duplicate implementations are usually wasteful unless the scheduler proves independence, file ownership, budget, and cancellation constraints up front.

Design target: two narrower opt-in workflows, documented in [`docs/OPTIMISTIC_DAG_WORKFLOW.md`](OPTIMISTIC_DAG_WORKFLOW.md):

1. `semantic-batching-tier1`: realtime/tier1 workflow that reduces turns, redundant checks, and context bloat.
2. `planned-parallel-rpe`: tier1 planner, conflict-aware scheduler, isolated tier2 background executors, parallel reviewers, cancellation for speculative pre-confirm work, file ownership constraints, and tier1 final review/synthesis.

Next work:

- Define the RPE execution packet: accepted plan, owned/read-only files, dependencies, constraints, validation contract, budget, user wait budget, stop rules, cancellation rules, and expected handoff.
- Define scheduler policy: reject cycles and ownership conflicts, compute accepted safe-unit DAG critical path, estimate `tier2_exec_wait_worst_case = DAG_depth * 10m`, and launch only when it fits the user wait budget.
- Add observability fields for active planning time, background completion time, late outputs, retries, cancellation, rejected speculative work, review latency, acceptance failures, accepted DAG depth, and estimated/actual tier2 wait.
- Prototype RPE background execution and sharded RPE now that prefix-evaluation evidence supports safe decomposition for some code-edit traces, but keep it opt-in and background-only.
- Keep strict/generic DAG execution and default duplicate implementations deferred until trace-derived evidence shows real off-critical model branches outside RPE.

## Phase 8: Live endpoint benchmarks

After stubs, traces, and RPE routing policies:

- Run small live realtime baseline with `rtk npm run smoke:live:realtime`.
- Run same tasks through live async with `rtk npm run smoke:live:async`.
- Probe batch creation/cancel with `DOUBLEWORD_LIVE_BATCH=1 rtk npm run smoke:live:batch`.
- Compare wall-clock time, TTFT, total time, tool count, token usage, and cost.
- Keep live tests opt-in and API-key gated.

## Deferred ideas

Only build these if the simpler system fails benchmarks:

- Strict DAG executor for explicit parallel investigation/execution.
- Broad subagent orchestration beyond the optimistic DAG prototype.
- Model profiles/fusion: cheap investigator, deep researcher, reviewer, patcher, etc.
- Predictive repo indexing and speculative context gathering.
- Batch-tier orchestration for normal workflows.
- Batch eval/replay workflow beyond basic benchmarks.

## Open questions

- Exact Doubleword async TTFT and SLA per model/account.
- Whether async Responses supports tool calls in the needed format.
- Whether live async exposes useful usage metadata on retrieval.
- Whether any tier supports true streaming before completion.
- Whether Doubleword's Responses cancel endpoint has any provider-specific caveats beyond OpenAI-compatible background response cancellation.
- Which Doubleword models should be exposed first.
