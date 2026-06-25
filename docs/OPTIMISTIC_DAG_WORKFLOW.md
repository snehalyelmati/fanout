# Optimistic DAG Workflow

Status: design target, not implemented.

Goal: keep the active developer loop near realtime/tier1 speed while using Doubleword tier2 only where latency can be hidden. Realtime/tier1 remains the speed baseline; tier2 is for cost reduction on background work.

Latest benchmark detail: [`docs/benchmarks/semantic-dag-and-rpe.md`](benchmarks/semantic-dag-and-rpe.md).

## What the traces now say

Manual subagent reviews corrected the earlier mechanical optimistic-DAG estimate.

| Workflow shape | Finding | Product implication |
| --- | --- | --- |
| Normal interactive DAG | ~1.5% semantic tier2 savings across 10 manually reviewed traces | Not worth a generic tier2 DAG router |
| Tier1 DAG/prompt efficiency | ~25% possible savings from fewer turns/context in the same 10 traces | Improve planning, batching, and context hygiene first |
| Research-plan-execute | ~22% savings when execution moves to tier2 across 5 RPE traces | Promising only as background/portfolio execution |

## Two workflows, kept separate

### 1. Tier1 semantic batching workflow

Use realtime/tier1 throughout. The goal is fewer model turns and less context, not tier routing.

Best targets:

- batch independent reads, greps, and repo inspections;
- inspect all sibling call sites before editing;
- fix root causes once instead of symptom loops;
- avoid redundant checks when a later barrier covers the same evidence;
- trim huge tool outputs before they enter every later turn;
- keep final edits, validation, commit, push, and user-facing decisions realtime.

This is the safest near-term optimization because it improves both cost and time without tier2 latency.

### 2. RPE background execution workflow

Use tier1 for research+plan, then run approved execution on tier2 in the background.

```text
user task
  -> tier1 research and plan
  -> user approves execution packet
  -> tier2 background execution job(s)
  -> tier1 review/synthesis/apply/acceptance when results are ready
```

This is the first trace-backed place where Doubleword tier2 savings are material. In the 5-trace sample, it saved ~22% provider cost, but blocking completion grew from ~23.5 minutes to ~14-28 hours sequentially. So this must be async/background UX.

## Routing rules

Tier1:

- research needed for immediate plan quality;
- user-visible answers;
- edits that need tight tool feedback;
- validation barriers;
- commit/push/release/issue state changes;
- final synthesis and acceptance.

Tier2:

- approved execution packets where late completion is acceptable;
- background review/eval/report generation;
- post-success bookkeeping when not needed for the final user answer;
- independent portfolio tasks with separate worktrees and budget caps.

Do not route a turn to tier2 just because it is in the middle of a trace. It must be semantically off the active path or explicitly approved as background execution.

## Best practices

- Report **active user time** separately from **background completion time**.
- Cap tier2 concurrency and total dollars before launching a portfolio batch.
- Use worktrees for independent background executions that may edit files.
- Use deadlines: synthesize with ready results; late tier2 output becomes follow-up.
- Treat tier2 outputs as untrusted until a tier1 review/synthesis validates them.
- Keep a small execution packet: task, accepted plan, files, constraints, validation contract, budget, stop rules.

Example: several approved RPE tasks can run concurrently in tier2. The user spends tier1 time reviewing plans up front, then later reviews completed outputs in a batch. Provider cost drops, but wall-clock completion is intentionally background.

## Next implementation steps

1. Improve tier1 planning/batching prompts and context hygiene first.
2. Prototype an RPE execution packet format and background job lifecycle.
3. Add benchmark reporting for active time, completion time, tier2 turns, late outputs, and acceptance failures.
4. Keep generic DAG execution deferred until semantic reviews show real off-critical model branches outside RPE.
