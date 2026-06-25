# Hybrid Target Evidence

Date: 2026-06-25

This note records the reproducible evidence for the hybrid tier1/tier2 active TAT target. It intentionally scopes the target passes to synthetic workflow fixtures. The same command also includes existing observability and Pi session fixtures so source labels can be checked in one report.

## Reproduce

```bash
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
```

Generated artifacts:

```text
runs/mission-hybrid-benchmark/summary.json
runs/mission-hybrid-benchmark/summary.md
```

## Source labels

The run includes four input files:

| Input | Format label | Evidence scope |
| --- | --- | --- |
| `datasets/fixtures/hybrid-workflows.jsonl` | `hybrid-workflow` | synthetic workflow assumptions |
| `datasets/fixtures/hybrid-workflows-out-of-order.jsonl` | `hybrid-workflow` | synthetic parser/scheduler fixture |
| `datasets/fixtures/phase6-observability.jsonl` | `observability` | observed local observability fixture |
| `datasets/fixtures/pi-session-trace.jsonl` | `pi-session` | observed Pi-session-shaped fixture |

The target-pass rows below come from `hybrid-workflow` traces with `sourceType: "synthetic"`. They are not claims that observed Pi traces can meet the target.

## Target pass evidence

A valid target pass for this mission must be non-baseline, use tier2 at least once, and satisfy `activeTatRatio <= 3` while keeping background completion visible.

| Fixture | Policy | Active boundary | Active TAT | Background completion | Ratio | Tier2 calls | Status |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `hybrid-wide-fanout` | `critical_path_slack` | `synthesis` | 1500 ms | 7500 ms | 1.000 | 3 | pass |
| `hybrid-serial-rpe` | `rpe_background` | `plan` | 1800 ms | 9800 ms | 1.000 | 1 | pass |
| `hybrid-sharded-rpe` | `sharded_rpe` | `plan` | 1600 ms | 8100 ms | 1.000 | 2 | pass |
| `hybrid-branch-race` | `speculative_portfolio` | `accept-winner` | 5800 ms | 9700 ms | 1.526 | 2 | pass |
| `hybrid-invalid-fastest-branch` | `speculative_portfolio` | `accept-winner` | 6100 ms | 7600 ms | 1.649 | 3 | pass |

The generated `summary.json` includes per-node schedules for each row, including dependencies, phase, assigned tier, start and end times, active/background classification, acceptance status, late status, and rejected nodes.

## Infeasible evidence

Linear mandatory critical-path work is not counted as a tier2 success even when the numeric ratio is under 3. It is structurally ineligible because mandatory tier2 execution remains on the active user acceptance path.

| Fixture | Policy | Active TAT | Background completion | Ratio | Tier2 calls | Status | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `hybrid-linear-critical-path` | `all_tier2_blocking` | 11000 ms | 11000 ms | 2.750 | 1 | infeasible | mandatory tier2 work is on the active linear critical path |
| `hybrid-structural-linear-mandatory` | `all_tier2_blocking` | 9800 ms | 9800 ms | 2.722 | 1 | infeasible | mandatory tier2 work is on the active linear critical path |

## Active and background caveats

- Active TAT is measured to the same declared boundary for tier1 baseline and optimized policies.
- Background exclusion requires explicit fixture metadata: optional, non-user-blocking, background, or a next-actionable boundary.
- Background completion remains reported and can be much larger than active TAT.
- Mandatory tier2 output needs tier1 review, validation, synthesis, or acceptance evidence before a pass is claimed.
- Synthetic passes demonstrate simulator semantics and workflow-shape feasibility under fixture assumptions only.
