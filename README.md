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

`/fanout-plan` explores first, asks one user question at a time when intent is not discoverable, drafts fanout-agnostic work units, resolves three model roles across two execution tiers, builds and validates the DAG during planning, then emits the active reviewable execution packet. Tier 1 is the realtime control plane, Tier 2 provides async workers, and `tier2Fallback` is a realtime execution fallback rather than a third tier. The fallback inherits Tier 1 unless configured independently. The packet validator/artifact helper stores artifacts in Pi-owned storage by default:

```text
rtk node --disable-warning=ExperimentalWarning scripts/fanout-packet-artifacts.mjs --print-run-dir <run-id>
rtk node --disable-warning=ExperimentalWarning scripts/fanout-packet-artifacts.mjs <artifact-dir>/execution-packet.json --out <artifact-dir> --active <active-pointer-path>
```

Use `FANOUT_ARTIFACT_DIR=/custom/path` to override the default `~/.pi/agent/fanout/...` storage for a process, or set `fanout.artifactDir` in Pi settings for a persistent default. `/fanout-config` shows the resolved artifact root and configures tier models with provider → model → thinking selectors. The plan report shows a compact artifact directory, tier/model plan, boxed ASCII DAG, files touched, and two-column metrics.

`/fanout-execute` accepts no packet path. It loads the active pointer, validates the packet and DAG again, requires a clean active git worktree with a committed `HEAD`, checks that execution artifacts stay outside the repo, and asks for confirmation before launching workers. Normal and dry runs take one exclusive `fanout-execution.lock` under the canonical git directory, so separate sessions cannot execute against the same worktree concurrently. Fanout removes the lock on a normal return but never guesses that an existing lock is stale; after an interrupted process, remove the reported lock path only after verifying that no execution still owns it. `--dry-run` stops after loading and preflight, writes an execution audit run, and does not ask for confirmation, launch workers, or mutate worktree files. Execution packet schema v4 requires a concrete `tier2Fallback` model summary; older packets must be replanned. Schema v4 still does not record the repository HEAD used during planning, so the clean-worktree check is not a stale-HEAD guarantee.

Approved work units run with two concurrent nodes by default in fresh detached git worktrees. Pi receives a curated Fanout prompt containing the packet context plus applicable repo-local `AGENTS.md`/`CLAUDE.md` files from the root and ancestor directories of owned/read-only paths. `--no-context-files` prevents Pi from independently loading other context, but automatic extension discovery remains enabled and `--approve` trusts project-local Pi resources for the non-interactive run; enabled extensions are therefore part of the trusted worker runtime, not packet context. Worker patches must have complete, provenance-checked metrics, stay within owned files, pass their validation commands, and pass a serialized `git apply --check`/`git apply` gate before reaching the active worktree. Generic providers use `pi-json-usage` pricing provenance. Doubleword workers additionally require provider-reported usage with the exact pricing source `doubleword-model-metadata`; synthetic `doubleword-stub` usage cannot be accepted. After the DAG succeeds, Fanout runs the packet's deterministic final validation plan in the active worktree and returns a snapshot-derived audit summary with attempt/retry/rejection counts, accepted changed files, totals, validation status, and artifact links.

Execution artifacts live beside the loaded packet, regardless of the packet's `artifactDir` field. Attempt directories retain the artifacts reached by that attempt:

```text
<packet-dir>/executions/<execution-run-id>/
  events.jsonl
  execution-run.json
  summary.md
  final-validation.json                 # when final validation is reached
  workers/<node-id>/attempts/<attempt-id>/
    worktree/
    session/
    prompt.md
    stdout.log
    stderr.log
    observability.jsonl
    patch.diff
    changed-files.json
    patch-stat.json
    ownership-check.json
    validation.json
    apply-check.json
    result.json
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
