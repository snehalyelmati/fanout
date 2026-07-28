# Phase 3: hardened `/fanout-execute`

## Status

The coordinated caller cutover is implemented with focused offline coverage. It is not an approved live release: one controlled p-map canary, three identical repetitions, evidence inspection, and repository-owner approval remain external gates.

## Executable generation

`/fanout-execute` admits only active pointer v2 referencing packet v7, whose exact top-level profile identity must match active Project Execution Profile v1. Packet v7 embeds work-contract v3 nodes and binds plan v3/details v5, planning identity, and platform. Runtime authority is event v4 carrying Attempt Outcome v4; `execution-run.json` is projection v5; final-validation evidence is v2; presentation data remains v1. Older authority requires replanning and older execution evidence is descriptive Legacy data.

Legacy, mixed, profile-mismatched, or shared-path configurations fail before model allocation. No runtime component migrates or partially accepts old artifacts.

## Runtime flow

1. Verify the active packet pointer, packet bytes, and packet-bound profile bytes exactly before repository mutation. An orthogonal active-profile refresh does not invalidate the packet.
2. Reject artifact storage inside the active worktree, then acquire the canonical Git-worktree execution lock after exact artifact admission. Only the lock owner creates the execution directory and event storage.
3. Validate the profile in a disposable clean worktree, then record `run-started` with exact profile/validation identities and strict preflight evidence. Environment failure consumes no worker or repair budget.
4. Dry run terminates explicitly after passed preflight. Live mode records an explicit confirmation decision before any attempt allocation.
5. Derive the scheduler graph from embedded contracts. Every worker/retry/fallback/repair launch consumes a fixed typed budget allocation and every allocation receives exactly one typed terminal outcome.
6. Independently prepare every worker/repair worktree through the profile, run profile normalization after edits, then capture, enforce authority, run packet task validation, reverify, and exact-apply.
7. Before integration repair, reconcile only exact path-disjoint stale candidates through latest-ledger reconstruction, overlay, normalization, recapture, ownership, validation, and compare-and-swap. Retry only after ledger advancement.
8. Preserve the immediately preceding rejected repair candidate as the next exact seed. Stop a repair chain when exact candidate identity and typed failure state repeat, leaving unused budget untouched.
9. Extract the final numbered `Worker summary` from the existing assistant output, store it in the attempt result, and include it only in the immediately following node validation-repair prompt. It remains optional diagnostic context outside routing, recovery, repair state, budgets, validation, acceptance, and replay.
10. Final validation runs packet final commands followed by profile-required final gates in an independently prepared worktree. Record event v4/projection v5; cleanup runs and is timed before the causal terminal event.

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
| A21 | `smoke-final-validation.mjs` | final repairs see the exact immediately preceding rejected candidate and invalid seeds launch no model |
| A22 | `smoke-fanout-execute.mjs` | exact path-disjoint stale candidates reconcile without a model; overlap routes through integration repair |
| A23 | `smoke-attempt-outcomes.mjs` | exact repeated candidate/failure state stops and cannot fabricate progress |
| A24 | `smoke-fanout-compiler.mjs`, `smoke-fanout-execute.mjs` | eligible vertical chains fuse deterministically and execute through one cycle |
| A25 | `smoke-worker-pipeline.mjs`, `smoke-work-contract.mjs`, `smoke-fanout-execute.mjs` | final assistant summary extraction is deterministic, repair prompts are safely serialized, and Repair 2 receives only Repair 1's summary without changing authoritative outcomes |

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
