# doubleword-pi

Pi extension research/workspace for using [Doubleword](https://doubleword.ai) as a provider.

Current focus:

1. Stub realtime and async Doubleword providers.
2. Add observability-first testing.
3. Keep workflows Pi-native: planning prompts first, custom orchestration later only if needed.
4. Benchmark with traces/stubs before live endpoints.

Phase 6 offline trace summary:

```text
rtk npm run benchmark:traces -- datasets/fixtures/phase6-observability.jsonl
rtk npm run benchmark:traces -- datasets/fixtures/pi-session-trace.jsonl --model glm-5-2
rtk npm run smoke:benchmarks
```

The benchmark summarizer accepts this extension's `observability.jsonl` files and raw Pi session JSONL traces. Put ignored external samples under `datasets/traces/`, then run the same command on that directory.

Planning prompt:

```text
/dw-plan <task>
```

Realtime stubs expose `glm-5-2` and `deepseek-v4-flash` with offline cost estimates. Realtime/tier 1 prices are GLM $1.40/$4.40 and DeepSeek $0.14/$0.28 per MTok in/out; tier 2/flex prices are GLM $1.05/$3.30 and DeepSeek $0.10/$0.20.
`doubleword-async` is an opt-in live Responses API polling provider gated by `DOUBLEWORD_API_KEY`.
Normal runs also get lightweight think-ahead batching instructions.

Docs:

- [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md)
- [`docs/OPTIMISTIC_DAG_WORKFLOW.md`](docs/OPTIMISTIC_DAG_WORKFLOW.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md)
