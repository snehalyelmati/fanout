# Fanout execution benchmark procedure

Purpose: define the benchmark path from today's read-only Fanout DAG prompt experiments to future executable `/fanout-execute` benchmarks, including TermBench-style terminal task suites once execution exists.

Evidence scope: this procedure tracks workflow quality, runtime execution quality, and provider/model cost separately. A good prompt-DAG score is not proof of executable correctness; a good executable benchmark is not proof of provider-tier savings unless cost/time telemetry is captured.

## Benchmark stages

| Stage | When | What it measures | Primary artifacts |
| --- | --- | --- | --- |
| P0: prompt-DAG dry runs | Before `/fanout-execute` | Whether `/fanout-plan` prompts produce safe, parallel execution DAGs | `runs/fanout-dag-prompt-experiments/` |
| P1: packet smoke execution | `/fanout-execute` MVP | Active packet loading, guardrails, confirmation, stub launch, summaries | packet fixtures, smoke transcripts |
| P2: local repo task execution | `/fanout-execute` can launch workers | Real subagent execution on controlled repo tasks | execution packets, worker logs, validation output |
| P3: TermBench-style suites | Stable execution loop | End-to-end terminal task success, latency, retries, cost | suite results, traces, summaries |
| P4: tier-routing comparisons | Doubleword tier integration | Realtime vs async/batch cost/time tradeoff under Fanout | observability traces, cost reports |

## P0: prompt-DAG dry-run benchmark

Use this while `/fanout-execute` is not implemented or while improving `/fanout-plan` prompt wording.

Tracked durable summaries:

```text
docs/benchmarks/fanout-dag-prompt-results.md
docs/benchmarks/fanout-dag-best-prompts.md
docs/benchmarks/fanout-dag-experiment-template.md
```

Ignored working ledger and raw per-run artifacts:

```text
runs/fanout-dag-prompt-experiments/RESULTS.md
runs/fanout-dag-prompt-experiments/BEST_PROMPTS.md
runs/fanout-dag-prompt-experiments/TEMPLATE.md
runs/fanout-dag-prompt-experiments/<run-id>/experiment.md
runs/fanout-dag-prompt-experiments/<run-id>/generators/*.md
runs/fanout-dag-prompt-experiments/<run-id>/evaluators/*.md
runs/fanout-dag-prompt-experiments/<run-id>/synthesis.md
```

Raw run artifacts stay ignored under `runs/`. After a graduated or otherwise important run, promote durable summaries into the tracked docs above.

### Run protocol

- Use a new Pi process/session per experiment run.
- Use the same model/effort across generator and evaluator subagents for a run; current target is GPT-5.5 with medium effort when the runtime exposes it.
- Test multiple prompt variants against known tasks plus heldout tasks.
- Generate execution DAGs only, not full packets.
- Keep artifacts under `runs/fanout-dag-prompt-experiments/`.
- Update `RESULTS.md` with one row per variant.
- For important runs, update tracked durable summaries in `docs/benchmarks/fanout-dag-*.md` from the ignored working ledgers/templates.

### P0 process model and concurrency

Each loop has one parent coordinator and many child generator/evaluator subagents:

```text
shell-launched Pi process
  -> experiment orchestrator
      -> generator subagents
      -> evaluator subagents
      -> synthesis + RESULTS.md update
```

The coordinator must read `<run-id>/experiment.md` as the source of truth, then use `subagent({ action: "list" })` before launching children.

Launch shape:

```bash
pi --approve \
  --name "fanout-dag-loop-<run-id>" \
  --provider openai-codex \
  --model gpt-5.5 \
  --thinking medium \
  -p "Run this experiment file exactly: <absolute-path-to-experiment.md>"
```

Operational rules:

- Use a fresh shell-launched Pi process for every scoring loop; do not reuse an existing chat session.
- Target child concurrency: 6.
- If the subagent tool rejects a large batch, split into smaller batches and record the fallback in `synthesis.md`.
- If a session spawn cap is reached, direct completion is allowed only for remaining ignored experiment artifacts; disclose exactly which phase used direct completion.
- Child generators and evaluators should write only configured artifact paths under the run directory.
- Parent stdout/stderr goes to `<run-id>/pi-orchestrator.log` when launched in the background.
- Record the launcher PID in `<run-id>/pi-orchestrator.pid` for status checks.

Status checks:

```bash
ps -p "$(cat <run-id>/pi-orchestrator.pid)" -o pid=,stat=,etime=,command=
find <run-id>/generators -type f | wc -l
find <run-id>/evaluators -type f | wc -l
test -s <run-id>/synthesis.md
```

A complete 5-variant × 5-task P0 run should produce 25 generator artifacts, 25 evaluator artifacts, one `synthesis.md`, and appended `RESULTS.md` rows.

### P0 after-loop checklist

After each P0 loop:

- Confirm generator/evaluator artifact counts match the experiment matrix.
- Write `synthesis.md` with ranking, stop-condition result, caveats, and next mutations.
- Append one row per tested variant to `RESULTS.md`.
- Update `BEST_PROMPTS.md` with:
  - any candidate that passes the stop condition;
  - any near miss with average >= 4.85;
  - any prompt selected as a next-run mutation seed;
  - full prompt text, source run, average/min score, strengths, risks, and next mutation.
- Do not overwrite prior best prompts; append or mark them superseded.
- Record batching, spawn-cap, direct-completion, or model-effort caveats in `synthesis.md`.
- Run a final source-status check and record whether repo files outside ignored run artifacts changed.
- For graduated prompts or durable procedure changes, copy `RESULTS.md`, `BEST_PROMPTS.md`, and `TEMPLATE.md` to their tracked `docs/benchmarks/fanout-dag-*` counterparts before committing docs.

### P0 scoring rubric

Each evaluator scores 1-5:

- minimized critical path;
- max safe parallel width;
- edge correctness/proof;
- small sequential work per node;
- ownership conflicts;
- validation coverage;
- missing inspect/test/docs/review nodes;
- false serialization of docs/tests/fixtures behind code.

Stop condition for a prompt candidate:

```text
average > 4.90 across all benchmark tasks
minimum task score > 4.85
no task-specific hardcoding
no ownership blocker
no repeated false serialization of tests/docs/fixtures behind implementation
```

This is a prompt-quality gate only. It does not replace runtime benchmarks.

## P1: `/fanout-execute` packet smoke benchmark

Start after the MVP can load an active packet and run a stub worker launch.

Minimum task set:

- valid active packet, user confirms, stub launch summary is emitted;
- missing active pointer is rejected;
- invalid packet is rejected;
- stale packet is rejected;
- dirty/conflicting worktree is rejected or requires explicit confirmation;
- user declines confirmation;
- docs and metrics summary match the observed behavior.

Required metrics:

| Metric | Notes |
| --- | --- |
| active packet load time | Time from command start to packet validation result |
| confirmation wait | User/fixture confirmation duration, excluded from provider time when possible |
| worker launch count | Stub or real subagent count |
| guardrail rejection count | By error code |
| validation pass/fail | Per command/check |
| summary fields present | packet path, DAG depth/width, worker counts, errors, artifacts |
| tool timings | file reads, git/worktree checks, validation commands |

## P2: controlled local repo execution benchmark

Start when `/fanout-execute` can launch real workers or isolated write tasks.

Task selection rules:

- Use small, deterministic repo tasks with known validation commands.
- Include both parallel-friendly and deliberately serial tasks.
- Include docs/tests/fixtures tasks to check false serialization behavior.
- Keep task fixtures resettable.
- Do not include secrets or external services.

Required outcome fields:

```text
task_id
packet_id
prompt_variant
model/tier policy
DAG nodes / edges / depth / max width
workers launched
wall time
active wait time
background completion time
validation commands and exit codes
files changed
conflicts/retries
review findings
final success/failure
cost and token usage when available
```

## P3: TermBench-style terminal suite

Use after `/fanout-execute` can run end-to-end tasks reliably.

Goal: compare Fanout execution against the normal Pi loop on terminal-based coding tasks.

Suggested protocol:

1. Select a fixed task suite with clean setup/teardown.
2. Run baseline Pi sequential execution.
3. Run `/fanout-plan` + `/fanout-execute` with the same model policy.
4. Capture observability for every model call, subagent, tool call, validation command, and review step.
5. Score task success independently from cost/time.

Primary metrics:

| Category | Metrics |
| --- | --- |
| Success | task pass/fail, tests pass/fail, reviewer blockers, user-visible correctness |
| Time | wall time, active wait, background time, TTFT, model time, tool time, validation time |
| Parallelism | DAG depth, max width, workers launched, blocked nodes, critical path duration |
| Cost | input/output tokens, provider cost, tier used, retry cost |
| Reliability | retries, conflicts, stale outputs, failed workers, manual interventions |
| Quality | changed LOC, unnecessary file touches, docs/test coverage, post-review issues |

Report workflow savings separately from provider-tier savings:

```text
workflow_savings = baseline sequential time/cost - Fanout same-tier time/cost
provider_savings = Fanout same workflow tier1 cost - Fanout routed tier cost
```

## P4: tier-routing benchmark

Use only after Fanout execution is stable enough that routing measurements are not dominated by planner/executor bugs.

Compare at least:

- all realtime/tier1;
- selected background nodes on async/tier2;
- batch/tier3 only for non-interactive replay or portfolio jobs.

Always report:

- active wait impact;
- background completion time;
- cost saved;
- timeout/failure rate;
- whether slower-tier output was accepted, stale, or discarded.

## Result hygiene

- Keep raw run artifacts under ignored `runs/` paths.
- Promote only stable procedures and aggregate summaries into `docs/`.
- Update `docs/BENCHMARKS.md` when benchmark datasets, pricing, routing policies, workflow experiments, or baseline metrics change.
- Record known caveats next to the result, not in a separate backlog.
- Do not compare prompt-DAG scores directly to executable task success; they answer different questions.

## What not to build yet

- No custom DAG executor benchmark harness before `/fanout-execute` exists.
- No scoring database; markdown ledgers are enough until automation is needed.
- No provider-tier optimization claims without token/cost/timing traces.
- No task-specific prompt templates just to win the prompt-DAG benchmark.
