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

Status: initial JSONL hooks are in place for provider, TTFT, async polling, usage/cost, errors/abort, tool timings, agent turn count, and tool batch size per turn. A tiny observability smoke asserts core JSONL events/fields; trace benchmarks remain pending.

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

- Register Doubleword realtime-shaped stub models for `glm-5-2` ($1.05/$3.30 per MTok in/out) and `deepseek-v4-flash` ($0.10/$0.20 per MTok in/out).
- Use pricing metadata from `https://doubleword.ai/pricing` for stub cost estimates.
- Keep the stub path available for tests; no live API key or network required.
- Verify model IDs, fixture streaming, usage reporting, and pricing metadata.
- Defer OpenAI-compatible live endpoint registration until after stub/trace confidence.

## Phase 5: Live async Doubleword provider

- Implement custom polling provider path if required.
- Use Responses API with `service_tier: "flex"` and background polling.
- Translate completed responses into Pi assistant events.
- Handle no-streaming UX clearly.
- Track response ID, queue time, poll time, usage, and errors.

Key limitation to validate: async responses may not stream; Pi may only receive content/tool calls after completion.

## Phase 6: Stub/trace benchmarks

Use local traces before live cost.

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

Benchmark questions:

- How many model turns does the workflow need? Use `agent_end.turnCount` and `turn_*` events.
- How many local tool calls are batched into each turn? Use `turn_end.toolCallCount`.
- Does async TTFT multiply wall-clock time or get amortized?
- What is cost vs realtime?
- Does planning-first reduce retries and wasted turns?

## Phase 7: Live endpoint benchmarks

After stubs and traces:

- Run small live realtime baseline.
- Run same tasks through live async.
- Compare wall-clock time, TTFT, total time, tool count, token usage, and cost.
- Keep live tests opt-in and API-key gated.

## Deferred ideas

Only build these if the simpler system fails benchmarks:

- DAG executor for explicit parallel investigation/execution.
- Subagents / multiple concurrent provider calls.
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
