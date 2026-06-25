# `badlogicgames/pi-mono` sample trace details

This supports the running benchmark doc: [`../BENCHMARKS.md`](../BENCHMARKS.md).

Dataset: <https://huggingface.co/datasets/badlogicgames/pi-mono>

The sample contains three raw Pi session JSONL files. These external files live under ignored `datasets/traces/pi-mono-sample/` when fetched locally; do not commit them.

## Trace inventory

| Label | File | Session id | Messages | User segments | Assistant turns | Tool calls |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| tiny-tools | `2026-01-16T03-18-40-694Z_89afd3da-1fa3-45f9-87ad-a023f92372ee.jsonl` | `89afd3da-1fa3-45f9-87ad-a023f92372ee` | 6 | 1 | 2 | 3 |
| medium-pr-review-merge | `2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl` | `105b45a9-be31-4997-95c3-c95ab814daf8` | 49 | 2 | 22 | 25 |
| large-issue-732 | `2026-01-16T02-37-34-075Z_4293a326-81ca-4327-b450-85275e1ca645.jsonl` | `4293a326-81ca-4327-b450-85275e1ca645` | 320 | 19 | 157 | 144 |

## First user request snippets

| Label | First user text |
| --- | --- |
| tiny-tools | `ok, do some stuff` |
| medium-pr-review-merge | `You are given one or more GitHub PR URLs: https://github.com/badlogic/pi-mono/pull/765 ...` |
| large-issue-732 | `Analyze GitHub issue(s): https://github.com/badlogic/pi-mono/issues/732 ...` |

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

## Timing caveat

Raw Pi session traces do not contain Doubleword provider spans. For these traces, benchmark timing uses message timestamp gaps as a proxy:

```text
assistant response proxy = assistant message timestamp - previous message timestamp
```

Use this for relative workflow comparisons, not as exact provider latency.
