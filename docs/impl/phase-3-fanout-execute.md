# Phase 3: hardened `/fanout-execute`

## Status

The coordinated caller cutover is implemented and passes the complete keyless A1–A20 matrix. It is an offline release candidate, not an approved live release: the macOS p-map canary and repository-owner approval remain external gates.

## Executable generation

`/fanout-execute` admits only active pointer v2 referencing the exact digest, byte length, and artifact-relative path of execution packet v6. Packet v6 embeds work-contract v2 nodes and binds plan v2/details v4 source identities, the planning commit/full Git-visible tree, and planning platform. Runtime authority is event v3 carrying Attempt Outcome v3; `execution-run.json` is projection v4; final-validation evidence v1 is referenced by the event log; and disposable `fanout.execution-report` presentation data is v1 and contains only derived Markdown. Event v2/projection v3 and earlier evidence is legacy descriptive data with no current replay path.

Legacy, mixed, or per-node-divergent normalization manifests fail during pointer/packet admission, before lock creation, execution-directory creation, worker launch, or repository mutation. No runtime component migrates, guesses, repairs, or partially accepts old artifacts. The recovery instruction is to rerun `/fanout-plan`.

## Runtime flow

1. Read the pointer bytes once, validate the closed pointer shape, resolve the packet under the project artifact root, read packet bytes once, and verify digest plus byte length before parsing packet v6.
2. Reject artifact storage inside the active worktree, then acquire the canonical Git-worktree execution lock after exact artifact admission. Only the lock owner creates the execution directory and event storage.
3. Record `run-started` with the packet's immutable concurrency/fail-fast/fallback policy and strict preflight evidence. Preflight compares exact planning commit, full Git-visible tree, platform, worker capability, and every direct executable/argv normalization and validation manifest.
4. Dry run terminates explicitly after passed preflight. Live mode records an explicit confirmation decision before any attempt allocation.
5. Derive the scheduler graph from embedded contracts. Every worker/retry/fallback/repair launch consumes a fixed typed budget allocation and every allocation receives exactly one typed terminal outcome.
6. Run workers in fresh detached reconstructions with curated file capabilities. After a successful edit, run each packet-declared candidate normalizer once in order and audit its result and repository identity. Then capture the normalized binary patch, enforce typed ownership/forbidden resources, run the original controller-owned validation, reverify the unchanged patch, and apply verified bytes through Git stdin under exact pre/post tree checks. Nonzero normalizer exits do not consume model-repair budget; hard launch, interruption, or identity failures fail closed before patch capture.
7. Append every accepted transition to the causal ledger. Final validation reconstructs that ledger in a new worktree. A typed program failure may consume at most two Tier 1 repair attempts under derived upstream authority; an accepted repair advances both ledger and final-validation expected-tree authority.
8. Record one gapless lifecycle in `events.jsonl` using exactly the nine event-v3 transition types; retries and repairs can make a run longer than nine records. Attempt outcomes carry exact Turn/Response/Tool intervals and cache usage. Atomically regenerate projection v4 after every appended event and write deterministic `summary.md` only once the projection is terminal. Derived publication failure stops subsequent effects; audit replay reads only the authoritative log.
9. Finish with an explicit causal outcome: completed, dry-run-completed, failed, or aborted.

Residual host trust is explicit: installed extensions/providers, validation programs, ignored files, external paths, network, and processes execute with user permissions and are not a container boundary.

## Named offline acceptance matrix

| ID | Runnable check | Contract proved |
| --- | --- | --- |
| A1 | `smoke-repository-resources.mjs` | Phase A file authority cannot widen to a Phase B directory |
| A2 | `smoke-repository-resources.mjs` | every boundary rejects the same malformed repository resources |
| A3 | `smoke-repository-resources.mjs` | prose punctuation and marker-like filenames cannot alter typed forbidden-write policy |
| A4 | `smoke-artifact-identity.mjs`, `smoke-fanout-packet.mjs`, `smoke-final-validation.mjs` | mutated plan, details, packet, patch, or evidence bytes lose authority |
| A5 | `smoke-artifact-identity.mjs`, `smoke-fanout-packet.mjs` | publication failure before pointer publication exposes no stale, partial, or torn active pointer |
| A6 | `smoke-validation-runner.mjs` | shell-like text, globs, and `SHELL` changes preserve direct executable/argv identity |
| A7 | `smoke-worker-pipeline.mjs` | unavailable tools and edit/write escapes fail before mutation |
| A8 | `smoke-artifact-identity.mjs`, `smoke-worker-pipeline.mjs` | validator patch replacement and altered/reordered accepted patches fail without active mutation |
| A9 | `smoke-repository-resources.mjs` | invalid UTF-8 paths, symlinks, gitlinks, and rename endpoints are exact or rejected |
| A10 | `smoke-attempt-outcomes.mjs` | retry-looking arbitrary output cannot influence typed routing |
| A11 | `smoke-attempt-outcomes.mjs` | reversed, duplicate, mismatched, or cross-attempt evidence cannot fabricate accepted metrics |
| A12 | `smoke-attempt-outcomes.mjs` | nested validation and integration repair share fixed node-global two-launch pools |
| A13 | `smoke-execution-events.mjs` | event/projection/report publication failures preserve a complete authoritative log and audit-only replay |
| A14 | `smoke-execution-events.mjs` | dry-run mode, terminal outcome, and final-validation disposition remain explicit |
| A15 | `smoke-planning-boundary.mjs` | later provider requests exclude planning and execution report-entry content |
| A16 | `smoke-final-validation.mjs` | persistent validation mutation or active drift fails without candidate apply or reset |
| A17 | `smoke-final-validation.mjs` | ignored repair residue and widened upstream authority cannot make a repair candidate acceptable |
| A18 | `smoke-fanout-packet.mjs`, `smoke-fanout-execute.mjs` | legacy or mixed generations fail before lock/mutation while historical bytes remain unchanged |
| A19 | `smoke-worker-pipeline.mjs` | automatic extension/provider discovery coexists with exactly the fixed six model-callable tools |
| A20 | `smoke-worker-pipeline.mjs`, `smoke-final-validation.mjs` | ignored-file, external-path, network, and process effects are tested and documented as outside containment |

All named scripts run through:

```bash
rtk npm run check
```

Standalone package validation is separate:

```bash
rtk npm run test:doubleword-provider
```

## Audit artifacts

Each execution directory contains authoritative `events.jsonl`, derived `execution-run.json`, deterministic `summary.md`, per-attempt evidence, accepted patch artifacts, and final-validation rounds. Presentation entries link to these artifacts but do not become execution authority.

## Release gates

Do not claim live readiness, latency, cost, routing, or provider behavior from offline checks. Release requires an explicitly authorized macOS p-map canary using the immutable candidate, inspection of its event/projection/patch/final-validation evidence, and repository-owner approval of the same commit.
