# Fanout workflow and local profiler

For source installation, start with [Getting started](GETTING_STARTED.md). This guide describes the implemented runtime; research results and scope are in the [study](STUDY.md).

## Planning and execution

```text
/fanout-plan [objective]     # prepare and validate a non-mutating execution packet
/fanout-execute [--dry-run]  # revalidate and execute the active accepted packet
```

`/fanout-plan` explores first, asks one user question at a time when intent is not discoverable, resolves three model roles across two execution tiers, and publishes a reviewable closed-generation packet. The controller binds plan v4 and details v7 to the exact planning commit/tree/platform and source bytes; `fanout-core` compiles embedded work-contract v5 nodes into packet v10; `fanout-pi` atomically publishes packet-derived views and pointer v2 last. The exact approved repository execution profile owns preparation, readiness, candidate normalization and required final gates. Packet contracts carry focused task commands. Planning rejects dirty bases before model calls, compiles a combined plan/details submission before acceptance, and publishes at Pi settlement. Bare invocation retains compaction-aware conversation context. Tier 1 is the realtime control plane, Tier 2 provides async workers, and `tier2Fallback` is a realtime execution fallback rather than a third tier. The fallback inherits Tier 1 unless configured independently. Artifacts are stored in Pi-owned storage by default.

Use `FANOUT_ARTIFACT_DIR=/custom/path` to override the default `~/.pi/agent/fanout/...` storage for a process, or set `fanout.artifactDir` in Pi settings for a persistent default. Each project directory is named `<basename>-<hash>`, where `hash` is the first 12 hexadecimal characters of SHA-1 over the resolved absolute working-directory path; clones and worktrees therefore receive distinct identities. `/fanout-config` shows the resolved artifact root and current Tier 1, Tier 2, and Tier 2 fallback roles before opening provider → model → thinking selectors. Tier 2 choices are eligible only when registry metadata has `fanout.async`, `fanout.background`, and `fanout.authReady` all set to `true`; realtime Tier 1 and fallback choices are unrestricted. **Disable Tier 2** routes eligible workers in newly planned packets through the realtime fallback, while selecting a Tier 2 model re-enables async routing. An explicit fallback is stored at `fanout.execution.tier2Fallback`; **Use Tier 1** deletes a global fallback override or writes a project inheritance marker so a global fallback cannot reappear through settings merging. Planning presents deterministic `execution-plan.md` content (objective, embedded work contracts, derived graph order/groups/path, and source context); `execution-dag.mmd` contains the separate Mermaid graph, and packet v10 remains the machine authority.

`/fanout-execute` accepts no packet path. It admits only pointer v2 bound by exact digest/length/path to packet v10 and rejects legacy, future, mixed, substituted, or node-divergent authority before lock creation or mutation. Preflight then requires the exact planning commit/full Git-visible tree/platform, every direct normalization and validation executable, worker capability, and artifact storage outside the repo before asking for confirmation. Concurrency, fail-fast, and fallback policy come from the immutable packet rather than current settings. Normal and dry runs take one exclusive `fanout-execution.lock` under the canonical git directory, so separate sessions cannot execute against the same worktree concurrently. Fanout removes its lock on normal return but never guesses that an existing lock is stale. Invocation authorizes the exact bound profile commands, including possible network/external effects, before confirmation and in dry-run. `--dry-run` stops after preflight, writes an explicit event-v6/projection-v7 audit, and launches no workers or provider calls. Earlier Event/Projection generations are legacy descriptive evidence only; there is no migration or compatibility replay.

Approved work units run with two concurrent nodes by default in fresh detached reconstructions. Pi receives a curated Fanout prompt containing the packet context plus applicable repo-local `AGENTS.md`/`CLAUDE.md` files. Automatic extension discovery remains enabled and `--approve` trusts project-local Pi resources; enabled extensions are part of the trusted worker runtime. After a successful worker edit with positively observed assignment identity and valid complete or partial correlated measurements, Fanout runs each explicitly declared candidate normalizer once before patch capture, typed ownership, and the original validation commands. Nonzero normalizer exits remain audit evidence and do not enlarge model budgets; launch, interruption, or repository-identity faults fail closed. Worker patches must stay within typed authority, pass direct-argv validation, and preserve exact patch/tree identity before verified Git-stdin apply. After the DAG succeeds, Fanout validates the exact accepted ledger in another fresh reconstruction. Only typed program failures may consume bounded final-repair attempts; repair candidates use the same declared normalizer list and must pass another reconstruction before active apply. `events.jsonl` is the sole run-state authority and projection/report files derive from it.

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
    candidate-normalization.json      # declared commands, outputs, timings, and repository identities
    patch.bin                         # exact binary patch artifact when capture succeeds
    ownership-check.json
    validation.json
    apply-check.json
    result.json                       # process, metrics, patch identity/paths/stats, and failure data
```

## Offline profiler

```text
npm run profiler
npm run profiler -- --port 4173
npm run profiler -- --artifact-root /absolute/path/to/fanout-artifacts
```

Repository startup resolves the current working directory through Fanout's settings, fixes the resulting storage root for the process lifetime, lists child projects containing planning or execution evidence, and initially selects the current project when available. The top-right project picker changes the active catalog without exposing filesystem paths; its Refresh control rescans project membership and atomically refreshes the selected immutable snapshot. `--artifact-root` retains the prior single-project forensic mode. Every selected root must already exist and resolve canonically. The profiler binds only to `127.0.0.1`, prints its URL, and never opens a browser or changes source artifacts. Root-level refresh failure retains the prior project list and catalog. Current Event Logs remain authoritative and replay through `fanout-core`; older generations are descriptive Legacy evidence, projections and reports never override a valid Event Log, and supporting logs are represented by metadata until a capped evidence page is requested. A changed Source Reference returns `Changed since refresh` rather than mixing old catalog state with new bytes.

The normal repository check includes profiler unit and loopback HTTP smoke checks. The representative performance benchmark is intentionally separate:

```text
npm run benchmark:profiler
```

