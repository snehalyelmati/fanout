# Project Instructions

This repo is for a Pi extension that can use Doubleword as an LLM provider.

## Working rules

- Keep the normal Pi agent loop unless a concrete limitation forces a custom workflow.
- Build stubs before live Doubleword endpoints.
- Make observability part of the first working version: timings, TTFT, token usage, cost, poll time, and tool timings.
- Prefer prompt/template workflows before custom orchestrators.
- Treat these product/runtime features as deferred until evidence says otherwise: DAG executor, in-extension subagents, model profiles, predictive index, and batch orchestration.
- Do not commit secrets or real API keys. Use environment variables for credentials.
- Keep `docs/ROADMAP.md` updated when scope/order changes.
- Keep `docs/DESIGN_DECISIONS.md` updated when design decisions are made or reversed.
- Keep `docs/BENCHMARKS.md` updated whenever benchmark datasets, pricing, routing policies, workflow experiments, or baseline cost/time metrics change; put detailed supporting notes under `docs/benchmarks/` when useful.
