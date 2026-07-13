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
/fanout-execute [--dry-run]  # revalidate and execute the active accepted packet
```

`/fanout-plan` explores first, asks one user question at a time when intent is not discoverable, resolves three model roles across two execution tiers, and publishes a reviewable closed-generation packet. The controller binds plan v2 and details v3 to the exact planning commit/tree/platform and source bytes; `fanout-core` compiles embedded work-contract v1 nodes into packet v5; `fanout-pi` atomically publishes packet-derived views and pointer v2 last. Tier 1 is the realtime control plane, Tier 2 provides async workers, and `tier2Fallback` is a realtime execution fallback rather than a third tier. The fallback inherits Tier 1 unless configured independently. Artifacts are stored in Pi-owned storage by default.

Use `FANOUT_ARTIFACT_DIR=/custom/path` to override the default `~/.pi/agent/fanout/...` storage for a process, or set `fanout.artifactDir` in Pi settings for a persistent default. `/fanout-config` shows the resolved artifact root and current Tier 1, Tier 2, and Tier 2 fallback roles before opening provider → model → thinking selectors. Tier 2 choices are eligible only when registry metadata has `fanout.async`, `fanout.background`, and `fanout.authReady` all set to `true`; realtime Tier 1 and fallback choices are unrestricted. **Disable Tier 2** routes eligible workers in newly planned packets through the realtime fallback, while selecting a Tier 2 model re-enables async routing. An explicit fallback is stored at `fanout.execution.tier2Fallback`; **Use Tier 1** deletes a global fallback override or writes a project inheritance marker so a global fallback cannot reappear through settings merging. Planning presents deterministic `execution-plan.md` content (objective, embedded work contracts, derived graph order/groups/path, and source context); `execution-dag.mmd` contains the separate Mermaid graph, and packet v5 remains the machine authority.

`/fanout-execute` accepts no packet path. It admits only pointer v2 bound by exact digest/length/path to packet v5 and rejects legacy, future, mixed, or substituted authority before lock creation or mutation. Preflight then requires the exact planning commit/full Git-visible tree/platform, direct validation executables, worker capability, and artifact storage outside the repo before asking for confirmation. Concurrency, fail-fast, and fallback policy come from the immutable packet rather than current settings. Normal and dry runs take one exclusive `fanout-execution.lock` under the canonical git directory, so separate sessions cannot execute against the same worktree concurrently. Fanout removes its lock on normal return but never guesses that an existing lock is stale. `--dry-run` stops after preflight, writes an explicit event-v1/projection-v2 audit, and launches no workers or provider calls. Older artifacts must be replanned; there is no migration bridge.

Approved work units run with two concurrent nodes by default in fresh detached reconstructions. Pi receives a curated Fanout prompt containing the packet context plus applicable repo-local `AGENTS.md`/`CLAUDE.md` files. Automatic extension discovery remains enabled and `--approve` trusts project-local Pi resources; enabled extensions are part of the trusted worker runtime. Worker patches must have complete correlated metrics, stay within typed authority, pass direct-argv validation, and preserve exact patch/tree identity before verified Git-stdin apply. After the DAG succeeds, Fanout validates the exact accepted ledger in another fresh reconstruction. Only typed program failures may consume bounded final-repair attempts; each candidate must pass another reconstruction before active apply. `events.jsonl` is the sole run-state authority and projection/report files derive from it.

Execution artifacts live under the admitted packet's containing artifact directory. Attempt directories retain the artifacts reached by that attempt:

```text
<packet-dir>/executions/<execution-run-id>/
  events.jsonl
  execution-run.json
  summary.md
  final-validation/rounds/*.json        # exact validation evidence
  workers/<node-artifact-id>/attempts/<attempt-artifact-id>/
    session/
    prompt.md
    stdout.log
    stderr.log
    observability.jsonl
    patch.bin                         # exact binary patch artifact when capture succeeds
    ownership-check.json
    validation.json
    apply-check.json
    result.json                       # process, metrics, patch identity/paths/stats, and failure data
```

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
