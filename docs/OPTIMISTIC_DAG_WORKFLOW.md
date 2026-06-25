# Optimistic DAG Workflow

Status: design target, not implemented.

Goal: keep the active developer loop near realtime/tier1 speed while using Doubleword tier2 only for background branches where lateness is acceptable. Realtime/tier1 stays the speed baseline; Doubleword tier2 is for cost reduction, not latency reduction.

## What we are designing

The optimistic DAG workflow is not a faithful replay of existing traces. It is a redesigned workflow:

```text
user task
  -> tier1 planner / router
     -> local tools and cheap realtime decisions on the critical path
     -> tier2 background branches for reviews, research, summaries, evals, or alternatives
  -> tier1 synthesis / apply / validation
```

A tier2 branch should either finish before a planned barrier or be skipped/deferred. The user should not sit idle waiting for every branch unless they explicitly chose batch/offline mode.

## Metrics we need next

1. **More samples for confidence**
   - Run the DAG estimator over more local `datasets/traces/` samples, not just the three B0 traces.
   - Split results by task type: review-only, implementation, merge/release, issue triage, docs, and long-running debugging.
   - Report medians and P90s for turns per user segment, token share in middle turns, possible branch count, and branch barrier depth.

2. **Savings attribution**
   - `sequential-tier1`: current realtime baseline.
   - `optimistic-dag-tier1`: same optimistic DAG shape, but every model branch uses realtime/tier1. This isolates DAG speedup or overhead.
   - `optimistic-dag-tier1+tier2`: same DAG, but eligible background branches use tier2. Compare against `optimistic-dag-tier1` to isolate Doubleword cost savings and latency penalty.
   - `all-tier2`: cost floor only; not an interactive target.

3. **Active time vs completion time**
   - Active time: time until the user can keep working or accept a useful result.
   - Completion time: time until every background branch finishes.
   - Tier2 success requires active time to stay close to tier1, even if completion time is longer.

## Optimizing the current 1.8h estimate

The first optimistic estimate routed every middle assistant turn to tier2 and produced ~20% cost savings with ~1.8h completion time. That is too blunt. Optimize by routing less work, not more:

- Keep tiny turns tier1; a 5-10 minute tier2 delay is not worth pennies saved.
- Route only high-token, low-urgency branches to tier2.
- Use deadlines: synthesize with whatever tier2 results are ready by the barrier; late branches become follow-up notes.
- Avoid serial tier2 barriers. One wide batch is better than many dependent tier2 rounds.
- Compress branch context and outputs before dispatch.
- Share cached repo/task context across sibling branches.
- Keep edits, tests, merge commands, and final user-facing decisions tier1.

## Best practices

- Use optimistic DAG mode for portfolios of independent tasks, reviews, evals, and background planning.
- Avoid it for tight edit-tool-edit loops where every result changes the next command.
- Run independent tasks in parallel worktrees when they may edit files.
- Cap concurrency and dollars per portfolio batch before launch.
- Report both active developer time and background completion time.
- Treat tier2 outputs as advisory until a tier1 synthesis validates them.

Example: if one optimistic DAG task takes ~1.8h wall-clock for ~20% lower provider cost, running several independent tasks concurrently can keep developer time close to the same ~1.8-3h window while reducing total provider spend. This only works when tasks do not block each other and the user can review results in batches.

## Next implementation steps

1. Extend the benchmark matrix to include `optimistic-dag-tier1` so DAG effects and Doubleword effects are separated.
2. Run the matrix on more samples for confidence.
3. Add routing policies: minimum dollar savings, max tolerated barrier delay, branch deadline, and task-type eligibility.
4. Prototype as a prompt/template workflow first; build a stricter DAG executor only if the measured workflow needs it.
