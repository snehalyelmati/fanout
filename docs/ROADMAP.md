# Roadmap

## Objective

Build a Pi extension that supports Doubleword as a provider while adapting to its inference tiers:

- **Realtime**: interactive, standard OpenAI-compatible usage.
- **Async / tier 2**: minutes-scale TTFT via Responses API polling, lower cost.
- **Batch / tier 3**: long-running JSONL batch jobs, lowest cost.

The workflow should preserve developer velocity where possible by using async only where latency can be hidden or amortized.

## Principles

- Stay Pi-native first; avoid a new agent loop unless necessary.
- Stub before live endpoints.
- Observability first.
- Use planning prompts before custom orchestration.
- Separate workflow gains from provider-tier savings in every benchmark.
- Keep expensive/deep workflow ideas deferred until benchmarks justify them.

## Phase 0: Project docs and planning

- Create project docs and working rules.
- Track scope in this roadmap.
- Track decisions in `docs/DESIGN_DECISIONS.md`.

## Phase 1: Provider stubs

Status: initial Pi extension skeleton complete with realtime and async stub providers.

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

Status: realtime stubs expose the first live-shaped model IDs and pricing metadata; live endpoints remain deferred.

- Register Doubleword realtime-shaped stub models for `glm-5-2` ($1.40/$4.40 per MTok in/out) and `deepseek-v4-flash` ($0.14/$0.28 per MTok in/out).
- Use pricing metadata from `https://doubleword.ai/pricing` for stub cost estimates.
- Keep the stub path available for tests; no live API key or network required.
- Verify model IDs, fixture streaming, usage reporting, and pricing metadata.
- Defer OpenAI-compatible live endpoint registration until after stub/trace confidence.

## Phase 5: Live async Doubleword provider

Status: opt-in `doubleword-async` provider path is wired for Responses API background polling; normal validation remains offline and keyless.

- Register live-shaped async models for `glm-5-2` (tier 2/flex $1.05/$3.30 per MTok in/out) and `deepseek-v4-flash` (tier 2/flex $0.10/$0.20 per MTok in/out) under `doubleword-async`.
- Use Responses API at `https://api.doubleword.ai/v1` with `service_tier: "flex"` and `background: true`.
- Poll `GET /v1/responses/{id}` while status is `queued` or `in_progress`.
- Translate completed text responses into Pi assistant events after completion; no streaming before completion is assumed.
- Track response ID, status transitions, requested/actual service tier, poll time, usage, and errors.
- Keep live smoke opt-in with `DOUBLEWORD_API_KEY`; no live network in default checks.

Key limitation to validate live: async responses may not stream; Pi may only receive content/tool calls after completion. Tool-call translation remains pending until live Responses output shape is confirmed.

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

Status: design docs and the first offline safe-work-unit prefix evaluator are in place; runtime prototype remains deferred until more trace-derived planner reliability evidence exists.

Trace-backed direction:

- Generic interactive DAG tier2 routing is weak: manual semantic review found only ~1.5% tier2 savings in 10 traces.
- One-turn synthetic hybrid fixtures prove simulator accounting, but they are insufficient evidence for realistic multi-turn Pi traces.
- Tier1 semantic batching is valuable: manual estimates show ~25% savings from fewer turns/context, independent of Doubleword.
- Research-plan-execute background routing is promising: 5 RPE traces saved ~22% when research+plan stayed tier1 and execute moved to tier2, but sequential completion became 14-28h.
- Speculative duplicate implementations are usually wasteful unless the scheduler proves independence, file ownership, budget, and cancellation constraints up front.

Design target: two narrower opt-in workflows, documented in [`docs/OPTIMISTIC_DAG_WORKFLOW.md`](OPTIMISTIC_DAG_WORKFLOW.md):

1. `semantic-batching-tier1`: realtime/tier1 workflow that reduces turns, redundant checks, and context bloat.
2. `planned-parallel-rpe`: tier1 planner, conflict-aware scheduler, isolated tier2 background executors, parallel reviewers, cancellation for speculative pre-confirm work, file ownership constraints, and tier1 final review/synthesis.

Next work:

- Expand the retrospective prefix-based `pi-mono` trace evaluation with externally captured prediction artifacts. The local evaluator command is `rtk npm run eval:safe-work-units -- datasets/traces/pi-mono-sample --predictions datasets/fixtures/safe-work-unit-predictions.jsonl --out runs/safe-work-unit-eval`.
- Define the RPE execution packet: accepted plan, owned/read-only files, constraints, validation contract, budget, stop rules, cancellation rules, and expected handoff.
- Add observability fields for active planning time, background completion time, late outputs, retries, cancellation, rejected speculative work, review latency, and acceptance failures.
- Prototype RPE background execution and sharded RPE only if prefix-evaluation evidence supports safe decomposition.
- Keep strict/generic DAG execution and default duplicate implementations deferred until trace-derived evidence shows real off-critical model branches outside RPE.

## Phase 8: Live endpoint benchmarks

After stubs, traces, and RPE routing policies:

- Run small live realtime baseline.
- Run same tasks through live async.
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
- Cancellation behavior for async Responses.
- Which Doubleword models should be exposed first.
