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

Decision: Register `doubleword-realtime-stub` and `doubleword-async-stub` with custom `streamSimple` implementations instead of proxying a live-compatible API shape immediately.

Reason: The custom stream path validates Pi provider mechanics, event ordering, async polling simulation, and observability before any live Doubleword endpoint assumptions.

### Observability writes are best-effort

Decision: JSONL observability writes must not throw through provider streaming.

Reason: Logging failures should not mask provider errors, aborts, or successful stub responses.

### Planning workflow ships as a prompt template first

Decision: Phase 3 starts with a `/dw-plan` prompt template instead of extension-enforced plan mode or a custom executor.

Reason: Prompt templates are Pi-native and cheap to test. The prompt can require non-mutating exploration, clarification until execution is clear, and a decision-complete proposed plan while deferring DAGs, subagents, indexing, and live provider routing.

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

Decision: Add an opt-in `doubleword-async` provider that submits Responses API requests with `service_tier: "flex"` and `background: true`, then polls `/responses/{id}` directly.

Reason: Direct polling preserves queue/status/poll observability and avoids adding Autobatcher or custom orchestration before benchmarks justify it.

### Phase 6 starts as trace summarization

Decision: Start stub/trace benchmarking with an offline JSONL summarizer over existing observability events, not a trace replay engine or dataset downloader.

Reason: The first benchmark question is whether the current Pi-native loop batches enough work and what async latency/cost looks like. Existing events can answer that before adding replay/orchestration code.

### Normalize raw Pi session traces in the same benchmark entrypoint

Decision: Extend `scripts/benchmark-traces.mjs` to auto-detect raw Pi session JSONL and summarize it alongside extension `observability.jsonl` files.

Reason: Real datasets such as `badlogicgames/pi-mono` are Pi sessions, not Doubleword observability logs. One benchmark command avoids throwaway conversion scripts while still deferring full replay infrastructure.

### Model pricing is tier-specific

Decision: Price `glm-5-2` realtime/tier 1 at $1.40/$4.40 per MTok in/out and tier 2/flex at $1.05/$3.30; price `deepseek-v4-flash` realtime/tier 1 at $0.14/$0.28 and tier 2/flex at $0.10/$0.20.

Reason: Tier 2 comparisons should show the latency/cost tradeoff instead of reusing realtime prices.
