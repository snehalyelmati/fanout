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
3. Keep the standalone Doubleword provider extension package published independently from Fanout.
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

Fanout workflow:

```text
/fanout-plan [objective]     # prepare and validate a non-mutating execution packet
/fanout-execute              # planned Phase 3: execute the active accepted packet
```

`/fanout-plan` explores first, asks one user question at a time when intent is not discoverable, drafts fanout-agnostic work units, resolves tier1/tier2 model choices, builds and validates the DAG during planning, then emits the active reviewable execution packet. The packet validator/artifact helper stores artifacts in Pi-owned storage by default:

```text
rtk node --disable-warning=ExperimentalWarning scripts/fanout-packet-artifacts.mjs --print-run-dir <run-id>
rtk node --disable-warning=ExperimentalWarning scripts/fanout-packet-artifacts.mjs <artifact-dir>/execution-packet.json --out <artifact-dir> --active <active-pointer-path>
```

Use `FANOUT_ARTIFACT_DIR=/custom/path` to override the default `~/.pi/agent/fanout/...` storage for a process, or set `fanout.artifactDir` in Pi settings for a persistent default. `/fanout-config` shows the resolved artifact root and configures tier models with provider → model → thinking selectors. The plan report shows a compact artifact directory, tier/model plan, boxed ASCII DAG, files touched, and two-column metrics. In Phase 3, `/fanout-execute` will revalidate freshness and worktree safety before running workers.

`doubleword-stub` exposes `glm-5-2` and `deepseek-v4-flash` with offline cost estimates. Realtime/tier 1 prices are GLM $1.40/$4.40 and DeepSeek $0.14/$0.28 per MTok in/out; tier 2/flex prices are GLM $1.05/$3.30 and DeepSeek $0.10/$0.20.
Live `doubleword` discovers models from Doubleword `/models` when `DOUBLEWORD_API_KEY` is set, caches the catalog locally, and falls back to the minimal GLM/DeepSeek list when discovery is unavailable. Use `Alt+T` or `/doubleword-mode` to toggle realtime vs async for `doubleword` and `doubleword-stub`. Async uses Responses `background: true` polling with a 10 minute wall-clock timeout, one final GET before timeout failure, best-effort remote cancel, transient poll retry, and a default `max_output_tokens` cap of 16k.
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

Packaging status:

The standalone Doubleword provider extension is published as a Pi package:

```text
pi install npm:@snehalyelmati/pi-doubleword-provider
```

Pi package page: <https://pi.dev/packages/@snehalyelmati/pi-doubleword-provider>

Docs:

- [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md)
- [`docs/OPTIMISTIC_DAG_WORKFLOW.md`](docs/OPTIMISTIC_DAG_WORKFLOW.md)
- [`docs/benchmarks/semantic-dag-and-rpe.md`](docs/benchmarks/semantic-dag-and-rpe.md)
- [`docs/benchmarks/hybrid-target-evidence.md`](docs/benchmarks/hybrid-target-evidence.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md)
