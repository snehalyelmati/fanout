# TAT bucket code-shard evaluation

Date: 2026-06-26

Purpose: test whether Planned Parallel RPE can turn longer realtime execution loops into shallow code-edit DAGs with bounded tier2 background wait.

Evidence scope: retrospective trace-derived planner reliability and wait estimation. This is not live Doubleword runtime evidence.

## Dataset and command

Full `badlogicgames/pi-mono` JSONL traces were downloaded under ignored local storage:

```text
datasets/traces/pi-mono-full/
```

Selection: 3 traces per baseline realtime TAT bucket, chosen from the full dataset by assistant-turn timestamp-gap proxy.

Prediction artifact and report:

```text
runs/safe-work-unit-eval/tat-bucket-code-shards-predictions.jsonl
runs/safe-work-unit-eval/tat-bucket-code-shards/summary.md
```

Evaluator command:

```bash
rtk npm run eval:safe-work-units -- \
  datasets/traces/pi-mono-full \
  --predictions runs/safe-work-unit-eval/tat-bucket-code-shards-predictions.jsonl \
  --out runs/safe-work-unit-eval/tat-bucket-code-shards
```

## Evaluator result

| Metric | Value |
| --- | ---: |
| Traces | 15 |
| Total code-edit units | 49 |
| Safe independent | 31 |
| Safe after dependency | 16 |
| Unsafe | 2 |
| Inconclusive | 0 |
| Safety precision | 1 |
| Recall | 0.969 |
| Dependency accuracy | 0.941 |

## Wait model

Use the conservative tier2 SLA as the scheduling quantum:

```text
tier2_node_wait = 10m worst-case
tier2_exec_wait_worst_case = accepted_DAG_depth * 10m
```

The table also shows a 5-10m range for readability because prior simulations used 5-10m per tier2 turn, but routing should use the 10m worst-case unless live evidence improves it.

## Results

| Bucket | Trace | Baseline TAT | Tier1 prefix | Remaining realtime | Accepted code units | Unsafe rejected | DAG depth | Tier2 exec wait |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| <5m | `56e2ecab` | 3.7m | 2.7m | 1.1m | 2 | 0 | 2 | 10-20m |
| <5m | `a86d0690` | 4.5m | 1.1m | 3.4m | 4 | 0 | 2 | 10-20m |
| <5m | `05f0d2ff` | 4.6m | 3.9m | 40.8s | 2 | 0 | 1 | 5-10m |
| 5-10m | `511d8267` | 8.2m | 2.2m | 6.0m | 3 | 0 | 3 | 15-30m |
| 5-10m | `586576ce` | 8.3m | 3.5m | 4.8m | 3 | 0 | 3 | 15-30m |
| 5-10m | `17d76aab` | 9.9m | 1.3m | 8.6m | 2 | 0 | 1 | 5-10m |
| 10-15m | `445038fc` | 11.3m | 1.7m | 9.6m | 3 | 1 | 1 | 5-10m |
| 10-15m | `90c2c1e4` | 11.6m | 1.6m | 10.1m | 3 | 1 | 2 | 10-20m |
| 10-15m | `b28f67de` | 14.4m | 1.4m | 13.0m | 3 | 0 | 2 | 10-20m |
| 15-30m | `4293a326` | 15.0m | 3.3m | 11.7m | 4 | 0 | 1 | 5-10m |
| 15-30m | `80e589d0` | 21.3m | 28.0s | 20.8m | 4 | 0 | 2 | 10-20m |
| 15-30m | `6673f4c8` | 24.7m | 2.1m | 22.6m | 3 | 0 | 1 | 5-10m |
| 30-45m | `d63fd46e` | 30.2m | 16.7m | 13.5m | 4 | 0 | 3 | 15-30m |
| 30-45m | `8a80d176` | 32.8m | 32.4m | 24.4s | 3 | 0 | 1 | 5-10m |
| 30-45m | `9084660c` | 33.0m | 24.4m | 8.5m | 4 | 0 | 4 | 20-40m |

## Readout

- Short traces usually lose: tier2's 5-10m minimum dominates sub-5m and many 5-10m workflows.
- Longer decomposable traces can win or stay comparable: several 15-30m traces have shallow code DAGs with 5-20m estimated tier2 wait.
- Compression comes from critical-path depth, not raw unit count. Four independent units at depth 1 are better than four serial units at depth 4.
- Prefix time is not a hard routing guard. If no execution remains, there is no job to launch; if execution remains and the user accepts background completion, route by wait budget and safety.
- The scheduler should report `remaining_realtime_estimate`, `tier2_exec_wait_worst_case`, accepted DAG depth, accepted unit count, rejected units, and cost estimate instead of making a binary claim that tier2 is faster.

## Routing implication

Prefer tier2 Planned Parallel RPE when:

```text
accepted_code_units > 0
DAG is acyclic
no ownership conflicts
tier2_exec_wait_worst_case <= user_wait_budget
```

Then present the background wait explicitly:

```text
Plan ready now. Estimated background execution: up to N minutes. Continue?
```

Do not claim realtime execution. This is bounded background RPE: tier1 plan now, tier2 execution later, tier1 review/synthesis before acceptance.
