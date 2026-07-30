# Execa Web Streams manual Fanout E2E

Status: the first controlled canary completed on 2026-07-29; no repetitions have been run.

This is the next transfer/complexity benchmark after the controlled p-map task. It follows the common safety, execution, evidence, failure, and reporting protocol in [`fanout-execution-benchmark-procedure.md`](fanout-execution-benchmark-procedure.md) and the operator workflow in [`p-map-abort-signal-manual-e2e.md`](p-map-abort-signal-manual-e2e.md). This document records only Execa-specific inputs and gates.

## Objective

Implement Web Stream conversion methods for asynchronous Execa subprocesses from the realistic issue-style task brief. Exercise repository discovery, cross-module runtime behavior, public types, pipeline forwarding, early-error handling, documentation, and final integration without exposing the historical upstream implementation to workers.

This task is not directly comparable with p-map for speed or cost because the repository, task, validation suite, and change surface differ. Use p-map as the existing control and Execa as transfer/complexity evidence.

## Fixed setup

| Item | Value |
| --- | --- |
| Task | Add `readableStream()`, `writableStream()`, and `transformStream()` |
| Task brief | `/Users/snehalyelmati/Documents/execa-web-streams/TASK.md` |
| Repository | `/Users/snehalyelmati/Documents/execa-web-streams/repo` |
| Upstream SHA | `c31c94c2c65e1aaf1b4d3295eaf927b910a2dc46` |
| Upstream tree | `01ca61578861dda1e7f191bc44febe5525be3922` |
| Reproducible local baseline | `6e9ed1185adca485097d299da263a38d74ee636b` |
| Local baseline tree | `475de97e8bce060242e1ce9025d10e7f763735bd` |
| Baseline difference | committed `package-lock.json` only |
| Runtime | Node `v26.5.0`, npm `11.17.0` |
| Install | `rtk npm ci --ignore-scripts --no-audit --no-fund` |
| Baseline validation | `rtk npm test`; 5,096 unit tests plus lint, `tsd`, and `tsc` |

The repository is a shallow single-history checkout with no remote, so the historical solution is not available through local Git history. `node_modules` is ignored and must not be shared into Fanout worktrees.

## Preflight

Run from the repository and require exact clean baseline identity:

```bash
cd /Users/snehalyelmati/Documents/execa-web-streams/repo
rtk git status --short --branch
rtk git rev-parse HEAD
rtk git rev-parse HEAD^{tree}
rtk npm ci --ignore-scripts --no-audit --no-fund
rtk npm test
```

Keep install and validation as separate commands. Stop if the tree is dirty, identity differs, or any baseline gate fails.

## Plan and profile

Launch Pi from a fresh visible pane rooted at the exact clean baseline, using the current local Fanout extension. The user must explicitly authorize every live or cost-incurring step.

Prepare the profile and packet with:

```text
/fanout-plan --refresh-profile Read ../TASK.md and implement that feature request exactly.
```

The profile should use isolated direct-argv preparation, no shared paths, offline-capable readiness, deterministic XO candidate normalization, and full `npm test` final validation. A practical preparation command is `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund`; do not add lifecycle scripts or dependency changes.

Ordinary planning must derive the work from repository evidence and the task brief without a decomposition override. A clarification is acceptable only for a genuine unresolved product choice.

## Review gate

Reject a materially incorrect packet. The semantic repair boundaries should be equivalent to:

```text
runtime-and-behavioral-tests ──┐
types-and-type-tests ──────────┤
documentation ─────────────────┤
                               └──> final validation
```

Required properties:

- runtime implementation and behavioral AVA coverage remain one independently acceptable and repairable unit;
- public types and `tsd` coverage remain together;
- documentation is independently writable;
- baseline-context reads do not falsely serialize disjoint work;
- `.pipe()` exposes only the read-side Web Stream method;
- early spawn errors preserve the original subprocess failure;
- no synchronous API, dependency, configuration, or file outside `TASK.md`'s allowlist changes;
- final validation runs the complete `npm test` suite.

The exact upstream patch is not packet authority and must not be fetched or supplied to workers.

## Execution and evidence

Run `/fanout-execute --dry-run` first and confirm zero workers, provider calls, tokens, accepted transitions, or repository changes. The user may then explicitly authorize one live canary with `/fanout-execute`.

Do not schedule repetitions until the canary, independent repository checks, artifacts, and cleanup all pass. Stop on the first failure or any source, task, packet, profile, routing, concurrency, or platform change.

After execution, independently run:

```bash
rtk git status --short
rtk git diff --name-only
rtk git diff --check
rtk npm test
rtk git worktree list --porcelain
rtk ps -axo pid,etime,command
```

Inspect the authoritative Event v4 log, Projection v5, summary, attempt evidence, final validation, accepted tree, cleanup, provider/model/tier identities, tokens, cost, TTFT, tool time, and wall time. Preserve failed artifacts and classify the owning component before proposing changes.

## 2026-07-29 canary result

The canary ran directly in the primary clean checkout, as explicitly authorized, from Fanout commit `b1cc84d6513de1551b617b01ba947103498921fb`. Pi ran in retained tmux pane `%267` under `doubleword:fanout-canary`. The frozen planning artifacts were:

- plan SHA-256 `5fd92ec0e3527953cb45faad1b4aeeb682f3e733c3c00b983ec197fe2d703fba`, 17,842 bytes;
- details SHA-256 `38687d76f07cbecd165d95b3247ad46f5eff0ef2da008b105382241cfa7d462e`, 17,685 bytes;
- packet SHA-256 `ba69f67e86443a2735aa1a9654945a3ebec4acbfc337bbe72028b6b1b2131103`, 58,073 bytes;
- profile SHA-256 `50c9bec27ac95da0453bc11092e5a1b40830540175c10f82461fc72c7916acf1`, 1,701 bytes.

Dry run `2026-07-29T18-34-56-001Z-b5556ab8` passed with zero workers, attempts, tokens, accepted transitions, or repository changes. Live run `2026-07-29T18-35-56-724Z-06e1182a` then completed with Event v4 / Projection v5 evidence and passed final validation.

The immutable packet made four ordinary nodes concurrently ready with maximum concurrency two: joint runtime/AVA behavior, joint types/`tsd`, API documentation, and guide documentation. The three smaller nodes passed on their original attempts. The joint runtime node's original candidate timed out at the fixture's 240-second AVA limit; validation repair 1 still failed its focused program gate, and validation repair 2 passed. The initial integrated `npm test` then found three XO violations across the combined result. One project final-validation repair corrected the two affected test files, after which both ordered full `npm test` gates passed. No integration repair, reconciliation, exact-no-progress termination, budget exhaustion, serial-chain fusion, or attempt fallback occurred.

Worker-summary continuity held only across the immediate runtime validation-repair chain: repair 1 received the original summary and repair 2 received repair 1's summary. The project final-validation repair received no predecessor summary. Summaries remained absent from Attempt Outcome, Event, Projection, and recovery authority.

The final checkout changed exactly the 14 task-allowed paths and hashed to accepted tree `c3ad52480adfb65a9bda2b63f609b7133aaef7b7`. The ledger reported 16 cumulative file touches, +373/-30, because the final repair re-touched two test files. Independent `npm test` passed; an initial operator rerun inside the Codex sandbox was invalid because XO could not write its ignored cache, and the permission-correct rerun passed. `git diff --check` passed. No current-run process, extra worktree, or execution lock remained.

The authoritative run duration was 1,240.055s, with 1,403,298 tokens, estimated cost `$1.8652415`, 420.670s summed worker time, and 3.972s summed tool time. The profiler admitted the current artifacts with exact profile identity and derived a 1,193.167s observed completion boundary, 231.712s overlap across ordinary node envelopes, a 596.734s final-validation span, 65.718s aggregate TTFT, and 316.537s aggregate generation time. Ordinary workers used the configured Terra medium realtime fallback because async Tier 2 was unavailable; validation repairs used Sol medium. There were no Tier 2 provider calls.

Post-canary inspection found that Phase B had not received the profile commands: `implementation-details.json` supplied `npm test` as packet-final validation while the exact approved profile already required `npm test`, and the effective initial and repaired final rounds therefore ran that full suite twice. The type node also used the repository-wide `npm run type` script rather than a focused invocation for its owned type tests. The 2026-07-30 protocol correction passes the exact profile into Phase B, asks for the narrowest meaningful node checks, reserves packet-final commands for additional task-specific integration, and rejects an exact profile-gate duplicate as a correctable draft while preserving normal resubmission. Existing canary metrics remain unchanged; any measured improvement requires a newly authorized clean run.

This is one canary, not a reliability cohort. No median, range, reliability rate, cross-task speed comparison, or universal SLO is reported. Repetitions require separate user authorization and byte-identical packet/profile/pointer bytes from a clean baseline.

## Reporting

Record Execa results in [`../BENCHMARKS.md`](../BENCHMARKS.md) only after observed artifacts and independent validation exist. Report correctness and reliability before speed or cost. Keep p-map and Execa cohorts separate; do not combine their medians, ranges, or success claims.

## Fresh-chat handoff

```text
Runbook: docs/benchmarks/execa-web-streams-manual-e2e.md
Task: /Users/snehalyelmati/Documents/execa-web-streams/TASK.md
Repo: /Users/snehalyelmati/Documents/execa-web-streams/repo
Baseline: 6e9ed1185adca485097d299da263a38d74ee636b
Mode: manual transfer/complexity E2E; one canary before any repetitions
Constraint: do not initiate live or cost-incurring calls without explicit authorization
```
