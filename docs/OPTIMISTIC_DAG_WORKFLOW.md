# Planned Parallel RPE Workflow

Status: design target, not implemented.

Goal: keep the active developer loop near realtime/tier1 speed while using Doubleword tier2 only where latency can be hidden. Realtime/tier1 remains the speed baseline; tier2 is for cost reduction on background work. The current direction is **planned parallel RPE**, not a generic tier2 DAG router.

Latest benchmark detail: [`docs/benchmarks/semantic-dag-and-rpe.md`](benchmarks/semantic-dag-and-rpe.md).

## What the traces now say

Manual subagent reviews corrected the earlier mechanical optimistic-DAG estimate. The one-turn synthetic fixture results prove simulator semantics and target accounting, but they are not enough to prove realistic multi-turn Pi trace feasibility. Real traces include repeated tool feedback, edits, validation, commits, retries, and user-visible decisions that collapse many apparent branches back onto the active path.

| Workflow shape | Finding | Product implication |
| --- | --- | --- |
| Normal interactive DAG | ~1.5% semantic tier2 savings across 10 manually reviewed traces | Not worth a generic tier2 DAG router |
| Tier1 DAG/prompt efficiency | ~25% possible savings from fewer turns/context in the same 10 traces | Improve planning, batching, and context hygiene first |
| Research-plan-execute | ~22% savings when execution moves to tier2 across 5 RPE traces | Promising only as background/portfolio execution |
| One-turn synthetic parallel fixtures | Some eligible shapes pass the <=3x active TAT target in the simulator | Useful for invariants, not proof that GPT can pick safe units in full Pi traces |

## Revised tier2 direction

Generic tier2 DAG routing and duplicate speculative implementations are weak defaults for realistic multi-turn Pi traces:

- a faithful trace DAG usually leaves assistant/model calls on the active critical path;
- mechanical middle-turn routing overstates what was safely independent at the time;
- launching duplicate implementations wastes tier2 cost when both branches edit the same files, repeat the same investigation, or require the same tier1 review bottleneck;
- speculative duplicate work also creates merge and validation overhead, so it should be reserved for explicitly independent tasks with hard caps, not used as a default accelerator.

The useful tier2 paths are narrower:

1. **RPE background execution**: tier1 produces the research, plan, execution packet, and acceptance contract; tier2 executes after the user-visible planning boundary.
2. **Sharded RPE**: tier1 plans independent work units; tier2 runs those independent shards in isolated contexts, then tier1 reviews results.

These paths are cost and throughput directions. They do not yet imply live runtime TAT has improved.

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

## Planned Parallel RPE architecture

Planned Parallel RPE is an opt-in workflow for tasks that have safe independent execution units.

```text
user task
  -> tier1 planner researches, defines the active boundary, and proposes work units
  -> conflict-aware scheduler checks file ownership, dependencies, budgets, and cancellation rules
  -> isolated tier2 background executors run approved units in separate worktrees or equivalent sandboxes
  -> parallel reviewers inspect executor handoffs and validation artifacts
  -> tier1 synthesis accepts, rejects, merges, or asks for repair
```

Required safety constraints:

- **Tier1 planner** owns task decomposition, acceptance criteria, and the decision about which work is safe to parallelize.
- **Conflict-aware scheduler** must reject or serialize units that touch overlapping files, share mutable state, depend on the same uncommitted change, or need the same validation resource.
- **Isolated background executors** must not edit the main worktree directly. Use separate worktrees or an equivalent isolation boundary with explicit handoff artifacts.
- **Parallel reviewers** can inspect background outputs concurrently, but final acceptance and merge decisions remain tier1/realtime.
- **Cancellation for speculative pre-confirm work** is required. If any pre-confirm research or draft execution becomes stale, conflicts with confirmed ownership, exceeds budget, or loses the race to a better plan, it is canceled and counted as waste.
- **File ownership constraints** are first-class: each planned unit declares owned files, read-only files, generated artifacts, validators, and lock conflicts before execution starts.
- **No hidden active-path latency**: active TAT ends only at an explicit next-actionable boundary. Background completion, late results, review latency, rejected work, and speculative waste remain separately reported.

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

## Proposed prefix-based trace evaluation

Before implementing runtime scheduling, evaluate whether GPT-5.5 can retrospectively predict safe independent work units from `pi-mono` traces:

1. For each multi-turn trace, reveal only a prefix ending at a plausible planning point.
2. Ask GPT-5.5 to propose safe RPE work units, declared file ownership, dependencies, active boundary, cancellation rules, and review requirements using only the prefix context.
3. Compare those predictions against the full trace suffix.
4. Score whether proposed units would have stayed independent, avoided overlapping edits, preserved mandatory validation, and avoided user-blocking dependencies.
5. Label outcomes as observed trace-derived evaluation, separate from synthetic simulator fixtures and separate from future live runtime results.

This evaluation should answer whether safe-work-unit prediction is reliable enough to justify Planned Parallel RPE implementation. Until then, synthetic one-turn fixture passes remain simulator evidence only.

## Best practices

- Report **active user time** separately from **background completion time**.
- Cap tier2 concurrency and total dollars before launching a portfolio batch.
- Use worktrees for independent background executions that may edit files.
- Use deadlines: synthesize with ready results; late tier2 output becomes follow-up.
- Treat tier2 outputs as untrusted until a tier1 review/synthesis validates them.
- Keep a small execution packet: task, accepted plan, files, constraints, validation contract, budget, stop rules.

Example: several approved RPE tasks can run concurrently in tier2. The user spends tier1 time reviewing plans up front, then later reviews completed outputs in a batch. Provider cost drops, but wall-clock completion is intentionally background.

## Next implementation steps

1. Run the prefix-based `pi-mono` trace evaluation for safe work-unit prediction.
2. If the evaluation is strong enough, prototype the RPE execution packet, scheduler, file ownership contract, and background job lifecycle.
3. Add benchmark reporting for active time, completion time, tier2 turns, late outputs, cancellation, rejected work, review latency, and acceptance failures.
4. Keep generic DAG execution and default duplicate implementation deferred unless trace-derived evidence shows safe off-critical model branches outside RPE.
