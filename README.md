# Fanout

Monorepo workspace for three related packages:

- `doubleword-provider`: [Doubleword](https://doubleword.ai) model/provider integration.
- `fanout-core`: agent-agnostic work splitting, scheduling, validation, and review policy.
- `fanout-pi`: Pi adapter and install target that wires Fanout plus the Doubleword provider into Pi.

Current package layout:

```text
packages/
  doubleword-provider/
  fanout-core/
  fanout-pi/
```

Current focus:

1. Keep Doubleword provider support usable on its own.
2. Keep Fanout optimization agent-agnostic.
3. Keep `fanout-pi` as the Pi adapter/install target.
4. Benchmark with traces, stubs, and local hybrid workflow fixtures before live orchestration.

The current benchmark layer includes a local/offline hybrid workflow simulator for comparing tier1 and tier2 routing policies. It reads committed JSONL fixtures, simulates active user-facing turnaround time separately from background completion, and reports target evidence for critical-path scheduling, RPE background execution, sharded RPE, speculative portfolio execution, and budget-constrained routing. Synthetic fixture passes are simulator evidence only, not observed trace feasibility claims.

Phase 6 offline trace summary:

```text
rtk npm run benchmark:traces -- datasets/fixtures/phase6-observability.jsonl
rtk npm run benchmark:traces -- datasets/fixtures/pi-session-trace.jsonl --model glm-5-2
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
rtk npm run smoke:benchmarks
```

The benchmark summarizer accepts this extension's `observability.jsonl` files, raw Pi session JSONL traces, and versioned `doubleword.hybrid-workflow` fixtures. Put ignored external samples under `datasets/traces/`, then run the same command on that directory. Generated reports are written to the requested `--out` directory, for example `runs/mission-hybrid-benchmark/summary.json` and `runs/mission-hybrid-benchmark/summary.md`.

Planning prompt:

```text
/dw-plan <task>
```

Realtime stubs expose `glm-5-2` and `deepseek-v4-flash` with offline cost estimates. Realtime/tier 1 prices are GLM $1.40/$4.40 and DeepSeek $0.14/$0.28 per MTok in/out; tier 2/flex prices are GLM $1.05/$3.30 and DeepSeek $0.10/$0.20.
Live `doubleword-realtime` and `doubleword-async` discover models from Doubleword `/models` when `DOUBLEWORD_API_KEY` is set, cache the catalog locally, and fall back to the minimal GLM/DeepSeek list when discovery is unavailable. Async uses Responses `background: true` polling with a 10 minute wall-clock timeout, one final GET before timeout failure, best-effort remote cancel, transient poll retry, and a default `max_output_tokens` cap of 16k.
Normal runs also get lightweight think-ahead batching instructions.

Useful provider environment variables:

```text
DOUBLEWORD_API_KEY                 live API key
DOUBLEWORD_BASE_URL                override API base URL
DOUBLEWORD_MODEL_CACHE_FILE        override cached /models catalog path
DOUBLEWORD_MAX_OUTPUT_TOKENS       override default 16384 output cap
DOUBLEWORD_LIVE_ASYNC_TIMEOUT_MS   override default 600000 async timeout
DOUBLEWORD_LIVE_ASYNC_POLL_MS      override default 2000 poll interval
DOUBLEWORD_CANCEL_TIMEOUT_MS       override default 10000 cancel request timeout
```

Install target shape:

```text
pi install git:github.com/org/fanout
pi install git:github.com/org/fanout/packages/doubleword-provider
```

Use the repo root for Fanout so the Pi adapter can load its sibling packages. Use the `doubleword-provider` package directly when users only want the provider.

Docs:

- [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md)
- [`docs/OPTIMISTIC_DAG_WORKFLOW.md`](docs/OPTIMISTIC_DAG_WORKFLOW.md)
- [`docs/benchmarks/semantic-dag-and-rpe.md`](docs/benchmarks/semantic-dag-and-rpe.md)
- [`docs/benchmarks/hybrid-target-evidence.md`](docs/benchmarks/hybrid-target-evidence.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md)
