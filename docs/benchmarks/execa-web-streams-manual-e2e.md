# Execa Web Streams manual Fanout E2E

Status: prepared; no Fanout plan, dry run, live execution, or benchmark result exists yet.

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
