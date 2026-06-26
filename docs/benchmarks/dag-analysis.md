# Trace-DAG analysis

Date: 2026-06-25

Purpose: check whether a DAG executor would make Doubleword tier routing materially better on the same three `badlogicgames/pi-mono` baseline traces used for B0.

Status note: this structural/heuristic analysis is retained as a historical D1 artifact. It is superseded for product decisions by manual semantic subagent reviews in [`semantic-dag-and-rpe.md`](semantic-dag-and-rpe.md) and the planned code-shard evaluation in [`tat-bucket-code-shards.md`](tat-bucket-code-shards.md).

Command:

```bash
rtk node scripts/dag-trace-analysis.mjs \
  datasets/traces/pi-mono-sample/2026-01-16T03-18-40-694Z_89afd3da-1fa3-45f9-87ad-a023f92372ee.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T02-37-34-075Z_4293a326-81ca-4327-b450-85275e1ca645.jsonl \
  --out runs/dag-analysis
```

Generated artifacts:

- `runs/dag-analysis/summary.md`
- `runs/dag-analysis/tiny-tools-dag.md`
- `runs/dag-analysis/medium-pr-review-merge-dag.md`
- `runs/dag-analysis/large-issue-732-dag.md`

## Method

The script reads every JSONL line, builds message-level DAG nodes, and preserves trace causality:

- user nodes depend on the previous assistant when the user continues the session;
- assistant/model nodes depend on the prior user node or all tool results from the prior assistant tool batch;
- tool-result nodes depend on the assistant turn that issued the tool call;
- tool calls in one assistant turn are treated as fan-out, but assistant/model turns are only off-critical when the trace gives them no dependency on prior results.

Pricing uses the same GLM 5.2 tier rates as B0: tier 1/realtime $1.40 input and $4.40 output per MTok; tier 2 $1.05 input and $3.30 output per MTok. Tier 2 latency uses the same deterministic 5-10 minute per-turn SLA simulation as `benchmark-traces`.

## Result

| Scenario | Cost | Provider time | Delta vs realtime |
| --- | ---: | ---: | ---: |
| Realtime endpoints / tier1 all turns | $23.0533 | 17.5m | baseline |
| Faithful trace DAG, tier1+tier2 combo | $23.0533 | 17.5m | $0 / 0s |
| All tier2, blocking | $17.2899 | 23.4h | -$5.7633 / +23.1h |
| Optimistic segment DAG combo | $18.5364 | 110.9m | -$4.5169 / +93.4m |

Faithful trace-DAG result: all 181 assistant/model turns are on the critical path. The only trace-backed fan-out is local tool batching, which does not change provider cost and is already cheap relative to tier 2 latency.

The optimistic segment DAG is intentionally generous: first and last assistant turn in each user segment stay tier 1; every middle assistant turn runs as parallel tier 2. This was later judged too mechanical: it does not prove those middle turns were feasible background branches with the context available at the time.

Manual semantic review replaced this heuristic. The updated finding is:

```text
normal interactive semantic tier2 savings: ~1.5%
separate DAG/prompt-efficiency opportunity: ~25%
research-plan-execute tier2 savings: ~22%, but only as background execution
planned code-shard RPE: promising for long decomposable traces when safe-unit DAG depth is shallow
```

Important distinction: faithful replay DAGs preserve the original serial chat loop and therefore show little tier2 opportunity. Planned code-shard DAGs deliberately change the workflow after a tier1 planning boundary by launching isolated code-edit units with file ownership and dependency constraints.

## By trace

| Trace | Lines read | Segments | Turns | Tools | Faithful combo | Optimistic combo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| tiny-tools | 9 | 1 | 2 | 3 | $0.0179 / 16.7s | $0.0179 / 16.7s |
| medium-pr-review-merge | 54 | 2 | 22 | 25 | $1.3266 / 2.2m | $1.0481 / 19.4m |
| large-issue-732 | 325 | 19 | 157 | 144 | $21.7088 / 15.0m | $17.4703 / 91.2m |

## Conclusion

A faithful DAG executor is not justified by these traces. The useful design target is Planned Parallel RPE: tier1 planning deliberately creates safe background code-shard branches, a scheduler rejects cycles/conflicts, and tier2 execution is reported as bounded background wait. Do not route middle turns mechanically.
