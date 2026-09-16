# `badlogicgames/pi-mono` sample trace details

This supports the running benchmark doc: [`../BENCHMARKS.md`](../BENCHMARKS.md).

Dataset: <https://huggingface.co/datasets/badlogicgames/pi-mono>

The original sample contains three raw Pi session JSONL files. These external files live under ignored `datasets/traces/pi-mono-sample/` when fetched locally; do not commit them.

An earlier revision accidentally tracked one complete sample session. The public tree no longer includes it. The counts below are historical summaries from the original external data; rerunning those measurements requires obtaining the dataset separately. The repository smoke check uses generated synthetic input and does not reproduce these observed results.

Later experiments also downloaded the full `badlogicgames/pi-mono` dataset under ignored local storage `datasets/traces/pi-mono-full/` for TAT bucket code-shard evaluation. See [`tat-bucket-code-shards.md`](tat-bucket-code-shards.md).

## Trace inventory

| Label | File | Session id | Messages | User segments | Assistant turns | Tool calls |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| tiny-tools | `2026-01-16T03-18-40-694Z_89afd3da-1fa3-45f9-87ad-a023f92372ee.jsonl` | `89afd3da-1fa3-45f9-87ad-a023f92372ee` | 6 | 1 | 2 | 3 |
| medium-pr-review-merge | `2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl` | `105b45a9-be31-4997-95c3-c95ab814daf8` | 49 | 2 | 22 | 25 |
| large-issue-732 | `2026-01-16T02-37-34-075Z_4293a326-81ca-4327-b450-85275e1ca645.jsonl` | `4293a326-81ca-4327-b450-85275e1ca645` | 320 | 19 | 157 | 144 |

## Task descriptions

| Label | Task type |
| --- | --- |
| tiny-tools | Short tool-use session |
| medium-pr-review-merge | Pull request review and merge |
| large-issue-732 | Issue analysis |

## Assistant turns between user messages

| Label | Assistant turns per user segment | Tool calls per user segment |
| --- | --- | --- |
| tiny-tools | `[2]` | `[3]` |
| medium-pr-review-merge | `[12, 10]` | `[16, 9]` |
| large-issue-732 | `[15, 2, 2, 1, 0, 67, 3, 5, 3, 1, 1, 16, 7, 18, 6, 1, 5, 2, 2]` | `[16, 2, 1, 0, 0, 66, 2, 4, 2, 0, 0, 15, 6, 18, 6, 0, 4, 1, 1]` |

Aggregate histogram of assistant turns between user messages:

```text
{0: 1, 1: 4, 2: 5, 3: 2, 5: 2, 6: 1, 7: 1, 10: 1, 12: 1, 15: 1, 16: 1, 18: 1, 67: 1}
```

## Tool batching

Most assistant turns issued a single tool call. A few turns batched two or three tool calls.

```text
0 tool calls: 19 assistant turns
1 tool call : 153 assistant turns
2 tool calls: 8 assistant turns
3 tool calls: 1 assistant turn
```

Tool result ordering matched the assistant tool-call batches in this sample: tool-result messages immediately followed the assistant turn that requested them.

## Full dataset follow-up

The full local dataset was used to select 15 traces: three each from `<5m`, `5-10m`, `10-15m`, `15-30m`, and `30-45m` realtime TAT buckets. The code-shard evaluation found that short traces usually lose to tier2 latency, while longer decomposable traces can compress remaining realtime work into shallow tier2 background DAGs.

## Timing caveat

Raw Pi session traces do not contain Doubleword provider spans. For these traces, benchmark timing uses message timestamp gaps as a proxy:

```text
assistant response proxy = assistant message timestamp - previous message timestamp
```

Use this for relative workflow comparisons, not as exact provider latency.
