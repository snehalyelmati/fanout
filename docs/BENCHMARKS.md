# Benchmark Metrics

This is the primary running document for Doubleword cost/time experiments. Update it whenever workflow changes, routing changes, pricing changes, or benchmark datasets change.

Benchmark procedure: [`docs/benchmarks/fanout-execution-benchmark-procedure.md`](benchmarks/fanout-execution-benchmark-procedure.md) defines the staged path from read-only Fanout DAG prompt experiments through `/fanout-execute` and TermBench-style execution benchmarks.

## P0 — Fanout prompt-DAG dry-run benchmark

Date: 2026-07-07

Purpose: tune `/fanout-plan` DAG prompt wording before `/fanout-execute` existed. This measures prompt-produced DAG quality only, not executable task success.

Tracked summaries:

- [`docs/benchmarks/fanout-dag-prompt-results.md`](benchmarks/fanout-dag-prompt-results.md)
- [`docs/benchmarks/fanout-dag-best-prompts.md`](benchmarks/fanout-dag-best-prompts.md)
- [`docs/benchmarks/fanout-dag-experiment-template.md`](benchmarks/fanout-dag-experiment-template.md)

Raw artifacts remain ignored under:

```text
runs/fanout-dag-prompt-experiments/loop-20260707-145016/
```

Current graduated prompt: `combined-general-conflict-proof`.

| Metric | Value |
| --- | ---: |
| Prompt variants in graduating loop | 5 |
| Tasks in graduating loop | 5 |
| Heldout tasks | 2 |
| Best average score | 4.916 / 5 |
| Best minimum task score | 4.88 / 5 |
| Stop condition | Passed |

Caveat: P0 uses generated DAGs and evaluator rubrics. Revalidate the winning prompt under P1/P2 execution benchmarks before treating it as an executable-runtime default.

## P1 — `/fanout-execute` packet smoke benchmark

Date: 2026-07-09

Purpose: validate deterministic Phase 3 controller mechanics with fake Pi subprocesses before controlled live-provider execution. This is runtime safety/contract evidence, not a model-quality, latency, or provider-cost baseline.

Command:

```bash
rtk npm run smoke:fanout-execute
```

Current result: passed locally. Coverage includes active-pointer and packet rejection, clean-worktree/artifact guardrails, canonical execution locking, confirmation and dry-run behavior, deterministic DAG concurrency/failure propagation, fresh worktrees, compiler-produced packets, mandatory metric provenance, patch/rename/directory ownership, validation stability, process-tree termination, retry/fallback, typed recovery, compensating rollback, downstream integrated state, and authoritative final validation. The 2026-07-10 schema-v4 update additionally proves a separate Tier 2 fallback model is used after retry exhaustion while Tier 1-only nodes and typed recovery retain the Tier 1 control-plane model.

Caveat: worker usage and cost in this smoke are synthetic fake-provider fixtures. P2 controlled real Pi workers and P4 live tier-routing measurements remain pending; no observed latency or cost claim is added here.

## P2 — Manual p-map AbortSignal E2E

Date prepared: 2026-07-10

Status: ready for the first complete manual product-debugging run; no live execution result has been recorded.

Runbook: [`docs/benchmarks/p-map-abort-signal-manual-e2e.md`](benchmarks/p-map-abort-signal-manual-e2e.md)

Purpose: exercise `/fanout-config` → `/fanout-plan` → `/fanout-execute --dry-run` → `/fanout-execute` manually against a fixed `sindresorhus/p-map` task before building a benchmark harness or routing variations. The run prioritizes correctness, UX, recovery, artifact quality, and observability. It uses local baseline `c3c261e2189f94d1a09724e8f03d5345af518017` and the decision-complete `pMapIterable` AbortSignal task brief under ignored `runs/` storage.

The user operates Pi and authorizes every live or cost-incurring step. Preserve failed artifacts, diagnose the owning component before edits, and record results only after comparing Fanout reports with the nested repository Git state and independent `npm test` output.

Deferred until this manual path is reliable: automated execution harnesses, policy/model variations, and provider-tier cost or latency comparisons. Add a running-experiment ledger row only after observed artifacts and metrics exist.

## Current baseline: B0 — Pi session traces, GLM 5.2 pricing

Date: 2026-06-25

Purpose: establish the baseline for the normal sequential Pi agent loop before optimizing workflow or deciding where tier 2 can be used without hurting usability.

Dataset: [`badlogicgames/pi-mono`](https://huggingface.co/datasets/badlogicgames/pi-mono), sampled raw Pi session JSONL traces.

Benchmark command:

```bash
rtk npm run benchmark:traces -- \
  datasets/traces/pi-mono-sample/2026-01-16T03-18-40-694Z_89afd3da-1fa3-45f9-87ad-a023f92372ee.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T02-37-34-075Z_4293a326-81ca-4327-b450-85275e1ca645.jsonl \
  --model glm-5-2
```

Generated summary: `runs/phase6/summary.md`.

### Pricing used

| Model | Realtime / tier 1 input | Realtime / tier 1 output | Tier 2 input | Tier 2 output |
| --- | ---: | ---: | ---: | ---: |
| `glm-5-2` | $1.40 / MTok | $4.40 / MTok | $1.05 / MTok | $3.30 / MTok |
| `deepseek-v4-flash` | $0.14 / MTok | $0.28 / MTok | $0.10 / MTok | $0.20 / MTok |

Tier 2 latency simulation: deterministic random 5–10 minutes per assistant/model turn.

### Sample traces

More trace details live in [`docs/benchmarks/pi-mono-sample.md`](benchmarks/pi-mono-sample.md).

| Label | Session id | User segments | Assistant turns | Tool calls | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| tiny-tools | `89afd3da-1fa3-45f9-87ad-a023f92372ee` | 1 | 2 | 3 | tiny tool-use loop |
| medium-pr-review-merge | `105b45a9-be31-4997-95c3-c95ab814daf8` | 2 | 22 | 25 | PR review/merge workflow |
| large-issue-732 | `4293a326-81ca-4327-b450-85275e1ca645` | 19 | 157 | 144 | long issue implementation workflow |
| **total** |  | **22** | **181** | **172** |  |

### Agent-loop shape

The sampled loop is sequential at the model-call level:

```text
user → assistant/tool call(s) → tool result(s) → assistant/tool call(s) → ... → assistant final text
```

Tool calls can be batched inside one assistant turn, but assistant turns are not parallel in these traces.

Assistant turns between user messages:

```text
{0: 1, 1: 4, 2: 5, 3: 2, 5: 2, 6: 1, 7: 1, 10: 1, 12: 1, 15: 1, 16: 1, 18: 1, 67: 1}
```

Tool calls per assistant turn:

```text
{0: 19, 1: 153, 2: 8, 3: 1}
```

### Assistant response-time baseline

Response time is a raw Pi-session timestamp-gap proxy: assistant message timestamp minus previous message timestamp. This includes model time plus any surrounding recorded delay, so use it as a comparative baseline, not exact provider TTFT.

| Metric | Value |
| --- | ---: |
| Assistant/model calls | 181 |
| Total tier 1 response time | 17.5m |
| Average call | 5.8s |
| Median call | 4.4s |
| P90 call | 8.5s |
| Max call | 41.3s |
| Calls over 60s | 0 |
| Calls over 5m | 0 |

### Baseline cost/time comparison

| Strategy | Cost | Turnaround |
| --- | ---: | ---: |
| Normal realtime GLM | $23.0533 | 17.5m |
| Doubleword tier 1 GLM | $23.0533 | 17.5m |
| Doubleword tier 2 GLM, all turns | $17.2899 | 23.4h |

Cost saved by all-tier-2: $5.7633, but turnaround grows from 17.5m to 23.4h.

### Naive hybrid routing

This chooses tier 2 turns by best dollar saved per added second, under an extra-turnaround budget. It is not a product policy yet; it shows the current tradeoff.

| Extra turnaround allowed | Tier 2 turns | Cost saved | Total turnaround |
| ---: | ---: | ---: | ---: |
| ~10m | 2 | $0.1003 | 27.5m |
| ~1h | 10 | $0.4956 | 73.1m |
| ~4h | 37 | $1.7587 | 4.3h |
| ~8h | 70 | $3.0064 | 8.3h |
| all tier 2 | 181 | $5.7633 | 23.4h |

### Baseline conclusion

Tier 2 does not improve active sequential turnaround on these traces. Every sampled tier 1 assistant call is faster than tier 2's 5-minute minimum SLA.

Tier 2 can still reduce cost if used for work that does not block the active loop, such as:

- background review or analysis after a tier 1 planning turn;
- speculative context gathering where stale/late results are acceptable;
- batch replay/eval jobs;
- parallel branches where the user is not waiting on every branch sequentially.

## D1 — Trace-DAG routing check

Date: 2026-06-25

Purpose: check whether turning the same B0 traces into a DAG creates enough off-critical-path model work to justify a DAG executor or tier1+tier2 routing.

Command:

```bash
rtk node scripts/dag-trace-analysis.mjs \
  datasets/traces/pi-mono-sample/2026-01-16T03-18-40-694Z_89afd3da-1fa3-45f9-87ad-a023f92372ee.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl \
  datasets/traces/pi-mono-sample/2026-01-16T02-37-34-075Z_4293a326-81ca-4327-b450-85275e1ca645.jsonl \
  --out runs/dag-analysis
```

Detailed notes: [`docs/benchmarks/dag-analysis.md`](benchmarks/dag-analysis.md).

| Strategy | Cost | Provider turnaround | Notes |
| --- | ---: | ---: | --- |
| Realtime endpoints / tier 1 all turns | $23.0533 | 17.5m | B0 baseline |
| Faithful trace DAG, tier1+tier2 combo | $23.0533 | 17.5m | 0 off-critical assistant turns |
| All tier 2, blocking | $17.2899 | 23.4h | Cost floor, not interactive |
| Optimistic segment DAG combo | $18.5364 | 110.9m | First/last segment turns tier 1, middle turns parallel tier 2 |

Conclusion: the trace-derived DAG is effectively linear at the model-call level. Tool-call fan-out exists but does not affect provider cost and is already cheap. A faithful DAG executor is not enough; the next work is an optimistic DAG workflow that deliberately creates background branches.

## D2 — Manual semantic DAG review

Design notes and detailed results: [`docs/benchmarks/semantic-dag-and-rpe.md`](benchmarks/semantic-dag-and-rpe.md).

Purpose: replace the coarse optimistic-DAG heuristic with subagent line-by-line semantic reviews.

Method:

- Subagents read each JSONL trace line-by-line.
- Every JSONL line is covered in notes.
- DAG branches are marked tier2-eligible only when semantically off the user-visible critical path or safe to miss a deadline.
- DAG/prompt-efficiency savings are tracked separately from Doubleword tier savings.

| Metric | 10-trace manual semantic total |
| --- | ---: |
| Baseline tier1 cost | $20.7282 |
| Semantic tier2 savings | $0.3068 |
| Semantic tier2 savings pct | 1.48% |
| Separate DAG/prompt-efficiency estimate | ~$5.1419 |
| DAG/prompt-efficiency pct | ~24.8% |

Conclusion: generic optimistic DAG tier2 routing is weak for normal interactive traces. Most model turns are critical-path. The larger opportunity is tier1 workflow efficiency: fewer model turns, less context bloat, better batching, and fewer symptom-fix loops.

## D3 — Research-plan-execute tier routing

Purpose: test a narrower workflow where research+plan stays tier1 and approved execution runs on tier2.

| Trace | Execute turns | Tier1 baseline | R+P tier1 + execute tier2 | Savings | Baseline provider time | Hybrid provider completion |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `10-50-40_13d61130` | 21 | $2.4825 | $2.1352 | $0.3473 / 14.0% | 4.7m | 108.6m-3.6h |
| `11-27-41_7e5bb6ee` | 14 | $0.6010 | $0.4811 | $0.1199 / 20.0% | 2.1m | 71.0m-2.3h |
| `19-35-54_90c2c1e4` | 102 | $17.4756 | $13.3270 | $4.1486 / 23.7% | 11.6m | 8.5h-17.0h |
| `20-55-34_e18dee76` | 9 | $0.5259 | $0.4098 | $0.1161 / 22.1% | 78.7s | 45.7m-90.7m |
| `21-53-12_1375d9e7` | 22 | $2.0820 | $1.7228 | $0.3592 / 17.3% | 3.8m | 111.9m-3.7h |
| **total, sequential** | **168** | **$23.1670** | **$18.0758** | **$5.0912 / 22.0%** | **23.5m** | **14.2h-28.2h** |

Conclusion: RPE is the first trace-backed shape where tier2 savings are material. It is not suitable for blocking interactive execution; it is a background/portfolio workflow.

## D4 - Hybrid workflow fixture schema

Date: 2026-06-25

Purpose: add a committed local JSONL fixture format for future tier1/tier2 workflow simulation while preserving existing observability and Pi session parsing.

Command:

```bash
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
```

Committed fixtures:

- `datasets/fixtures/hybrid-workflows.jsonl`
- `datasets/fixtures/hybrid-workflows-out-of-order.jsonl`

The hybrid format uses `schema: "doubleword.hybrid-workflow"`, `version: 1`, one `kind: "workflow"` metadata row per workflow, and `kind: "node"` rows for graph nodes. Workflow metadata includes scenario id, source type, target ratio, budget, deadline origin, concurrency cap, and active boundary. Node metadata preserves dependencies, phase, tier eligibility, active/background, mandatory/optional, durations, token cost inputs, deadlines, outcomes, groups, shards, branches, portfolio, conflict, stale, fallback, review, and validation links.

Scenario coverage in `hybrid-workflows.jsonl`:

| Scenario | Source type | Purpose |
| --- | --- | --- |
| `linear-critical-path` | synthetic | mandatory linear control |
| `wide-fanout` | synthetic | optional background fan-out |
| `serial-rpe` | synthetic | research-plan active boundary with background execution |
| `sharded-rpe` | synthetic | independent background execute shards |
| `speculative-branch-race` | synthetic | branch winner plus late loser metadata |
| `speculative-invalid-fastest-branch` | synthetic | fastest invalid speculative branch rejected before next valid winner |
| `renamed-mandatory-critical-path` | synthetic | graph-structural linear mandatory critical path with non-literal scenario id |
| `deadline-miss` | synthetic | optional late result |
| `budget-constrained-routing` | synthetic | budget metadata for routing policies |
| `conflict-stale-output` | synthetic | conflict and stale output metadata |
| `validation-failure-fallback` | synthetic | failed tier2 output with tier1 fallback and review |

These fixtures are synthetic assumptions, not observed trace feasibility evidence.

## D5 - Hybrid policy simulation engine

Date: 2026-06-25

Purpose: deterministically compare tier1/tier2 workflow policies over the committed hybrid fixture graph while keeping active user-facing TAT separate from background completion.

Command:

```bash
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
```

The simulator emits all required policies for every hybrid workflow: all tier1 baseline, all tier2 blocking, critical-path/slack, deadline synthesis, RPE background, sharded RPE, speculative portfolio, and budget-constrained routing. Each result includes per-node schedule evidence with tier assignment, dependency start/end times, active/background classification, accepted/late/failed state, cost, budget status, tier2 concurrency, and 3x target status.

Representative synthetic outcomes:

| Fixture | Policy | Active TAT | Background completion | Target status | Notes |
| --- | --- | ---: | ---: | --- | --- |
| `hybrid-linear-critical-path` | all tier2 blocking | 11.0s | 11.0s | infeasible | Mandatory tier2 work is on the active linear critical path. |
| `hybrid-wide-fanout` | critical-path/slack | 1.5s | 7.5s | pass | Optional research fan-out moves to tier2; one optional result is late. |
| `hybrid-serial-rpe` | RPE background | 1.8s | 9.8s | pass | Active response stops at the tier1 plan; execute completes in background. |
| `hybrid-sharded-rpe` | sharded RPE | 1.6s | 8.1s | pass | Two independent execute shards honor the tier2 concurrency cap. |
| `hybrid-branch-race` | speculative portfolio | 5.8s | 9.7s | pass | Fast valid branch wins, slow loser cost is counted as speculative waste. |
| `hybrid-invalid-fastest-branch` | speculative portfolio | 6.1s | 7.6s | pass | Failed fastest and stale slowest branches are rejected and counted as speculative waste; the next valid branch wins. |
| `hybrid-structural-linear-mandatory` | all tier2 blocking | 9.8s | 9.8s | infeasible | Mandatory tier2 work on a linear active critical path is detected structurally, not by scenario id. |
| `hybrid-budget-routing` | budget-constrained routing | 1.9s | 1.9s | fail | Cost exceeds the configured synthetic budget. |

These are fixture-policy results only. They prove simulator semantics and target accounting over synthetic assumptions; they do not claim observed real-trace feasibility.

## D7 - Hybrid target evidence workflow

Date: 2026-06-25

Purpose: run the mixed existing-plus-synthetic evidence workflow and record the honest 3x active TAT target status. The generated reports separate observed trace fixtures from synthetic workflow fixtures; all target passes below are synthetic fixture-policy evidence, not observed trace feasibility.

Command:

```bash
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
```

Generated evidence:

- `runs/mission-hybrid-benchmark/summary.json`
- `runs/mission-hybrid-benchmark/summary.md`

Run summary:

| Metric | Value |
| --- | ---: |
| Input files | 4 |
| Trace groups | 15 |
| Hybrid workflows | 12 |
| Hybrid policy results | 96 |
| Formats in one run | `hybrid-workflow`, `observability`, `pi-session` |
| Non-baseline pass results with tier2 calls and active ratio <= 3 | 49 |

Source labels in the generated JSON keep observed and synthetic evidence separate. `phase6-observability.jsonl` is summarized as `observability`, `pi-session-trace.jsonl` is summarized as `pi-session`, and the hybrid workflow fixtures are summarized as `hybrid-workflow` with `sourceType: "synthetic"` and `provenance.synthetic: true`.

Representative synthetic target passes:

| Fixture | Policy | Source | Active boundary | Active TAT | Background completion | Ratio | Tier2 calls | Target status | Caveat |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `hybrid-wide-fanout` | `critical_path_slack` | synthetic | `synthesis` | 1.5s | 7.5s | 1.000 | 3 | pass | Optional fan-out is explicit background work; one optional result is late and counted. |
| `hybrid-serial-rpe` | `rpe_background` | synthetic | `plan` | 1.8s | 9.8s | 1.000 | 1 | pass | Tier1 research and plan are the next actionable response; execute is deferred background work. |
| `hybrid-sharded-rpe` | `sharded_rpe` | synthetic | `plan` | 1.6s | 8.1s | 1.000 | 2 | pass | Independent execute shards run after the tier1 plan and honor the tier2 concurrency cap. |
| `hybrid-branch-race` | `speculative_portfolio` | synthetic | `accept-winner` | 5.8s | 9.7s | 1.526 | 2 | pass | Tier1 `accept-winner` reviews the winning tier2 branch; loser cost is counted as speculative waste. |
| `hybrid-invalid-fastest-branch` | `speculative_portfolio` | synthetic | `accept-winner` | 6.1s | 7.6s | 1.649 | 3 | pass | Tier1 `accept-winner` accepts `branch-valid-slower`; failed/stale branches are rejected and counted as waste. |

Representative infeasible synthetic classes:

| Fixture | Policy | Active TAT | Background completion | Ratio | Tier2 calls | Target status | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `hybrid-linear-critical-path` | `all_tier2_blocking` | 11.0s | 11.0s | 2.750 | 1 | infeasible | Mandatory tier2 work is on the active linear critical path. |
| `hybrid-structural-linear-mandatory` | `all_tier2_blocking` | 9.8s | 9.8s | 2.722 | 1 | infeasible | Mandatory tier2 work is on the active linear critical path, detected from graph structure rather than scenario id. |

Active/background interpretation:

- Active user-facing TAT is measured to each fixture's declared `activeBoundaryNodeId` plus mandatory active acceptance work.
- Work is excluded from active TAT only when fixture metadata marks it background, optional, non-user-blocking, or after a next-actionable boundary such as the RPE `plan`.
- Background completion still includes launched tier2 work, optional late results, and speculative losers.
- Passing policies that use mandatory tier2 output include a tier1 review, validation, synthesis, or acceptance node before claiming success. Examples include `accept-winner` reviewing portfolio branches and `repair-tier1`/`accept-fallback` validating failed tier2 output.

Detailed supporting notes: [`docs/benchmarks/hybrid-target-evidence.md`](benchmarks/hybrid-target-evidence.md).

## D8 - Planned Parallel RPE direction

Date: 2026-06-25

Purpose: record the post-mission workflow direction after comparing simulator evidence with observed multi-turn Pi trace reviews.

Evidence status:

- **Simulator evidence**: one-turn synthetic hybrid fixtures prove parser, scheduler, active/background accounting, target statuses, speculative waste, and infeasibility semantics.
- **Observed trace evidence**: manual multi-turn `pi-mono` reviews show generic interactive tier2 DAG routing is weak, with about 1.5% semantic tier2 savings in the reviewed sample.
- **Trace-backed RPE evidence**: five RPE-shaped traces show about 22% provider cost savings when research+plan stays tier1 and execution moves to tier2, but blocking completion grows to hours.
- **Future runtime work**: no live runtime TAT improvement is claimed yet. Planned Parallel RPE remains a design and evaluation direction.

Revised direction:

1. Do not build a generic tier2 DAG router for arbitrary middle turns.
2. Do not default to speculative duplicate feature implementations. They often repeat investigation, contend for the same files, create merge/review overhead, and waste tier2 budget unless independence is proven.
3. Focus tier2 work on **RPE background execution** and **sharded RPE**.
4. Use a **Planned Parallel RPE** workflow: tier1 planner, conflict-aware scheduler, isolated background executors, parallel reviewers, cancellation for speculative pre-confirm work, file ownership constraints, and final tier1 review/synthesis.

The next benchmark/evaluation step is retrospective and prefix-based:

```text
pi-mono trace prefix
  -> GPT-5.5 predicts safe work units, file ownership, dependencies, cancellation, review needs
  -> compare against full trace suffix
  -> score independence, conflict risk, validation preservation, and active-boundary correctness
```

This evaluation should decide whether GPT-5.5 can reliably identify safe independent work units from partial Pi trace context before any runtime scheduler or background executor is built.

## Running experiment ledger

Add one row per meaningful workflow or routing change.

| ID | Date | Change | Dataset | Model/routing | Cost | Turnaround | Notes |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| B0 | 2026-06-25 | Baseline sequential Pi loop | 3 `badlogicgames/pi-mono` traces | GLM realtime/tier 1 only | $23.0533 | 17.5m | Current baseline |
| B0-all-tier2 | 2026-06-25 | Same turns, all tier 2 SLA simulation | same | GLM tier 2 all turns | $17.2899 | 23.4h | Not usable interactively |
| D1 | 2026-06-25 | Faithful trace-DAG routing check | same | GLM tier1+tier2 combo | $23.0533 | 17.5m | No off-critical model turns; structural optimistic estimate later superseded |
| D2 | 2026-06-25 | Manual semantic DAG review | 10 Pi traces | GLM semantic tier1+tier2 | $20.4214 effective hybrid | same active path | Only 1.48% semantic tier2 savings; ~24.8% separate DAG/prompt-efficiency opportunity |
| D3 | 2026-06-25 | Research-plan-execute routing | 5 RPE Pi traces | GLM tier1 research+plan, tier2 execute | $18.0758 | 14.2h-28.2h sequential completion | Saves 22.0%; only viable async/background |
| D4 | 2026-06-25 | Hybrid workflow fixture schema | committed synthetic fixtures | parser only | n/a | n/a | Covers required workflow shapes and graph validation; no policy claims yet |
| D5 | 2026-06-25 | Hybrid policy simulation engine | committed synthetic fixtures | GLM tier1/tier2 policy matrix | per policy | active + background reported separately | Emits schedules, target statuses, concurrency/budget/deadline/fallback/speculative evidence |
| D6 | 2026-06-25 | Hybrid policy hardening | committed synthetic fixtures | speculative portfolio + structural infeasibility | per policy | active + background reported separately | Rejects invalid fastest speculative branches by completion time and detects linear mandatory infeasibility from graph structure |
| D7 | 2026-06-25 | Hybrid target evidence workflow | existing fixtures plus synthetic hybrid workflows | GLM tier1/tier2 policy matrix | per policy | active + background reported separately | Mixed run preserves observed/synthetic source labels; synthetic eligible workflows pass <=3x active TAT while linear mandatory classes are infeasible |
| D8 | 2026-06-25 | Planned Parallel RPE direction | simulator docs + manual Pi trace reviews | design/evaluation only | n/a | no runtime TAT claim | Generic tier2 DAG and duplicate implementations deferred; next step is prefix-based safe-work-unit evaluation |
| E1 | 2026-06-25 | Safe work unit prefix evaluation | Pi trace prefix + prediction artifact fixture | offline evaluator | safety precision primary | no runtime TAT claim | Reports safe independent, dependent, unsafe, and inconclusive verdicts from prefix context plus suffix evidence |
| E2 | 2026-06-26 | TAT bucket code-shard evaluation | 15 full `pi-mono` traces, 3 per TAT bucket | offline safe-unit evaluator + tier2 wait estimate | safety precision primary | 5-40m tier2 background by DAG depth | 49 code-edit units; long decomposable traces often compress remaining realtime loops to shallow tier2 DAGs |
| P1-fallback-role | 2026-07-10 | Separate Tier 2 fallback model role and packet schema v4 | fake-provider execution smoke | Tier 1 control plane + Tier 2 async + independent realtime fallback | synthetic | synthetic | Retry exhaustion uses the configured fallback model; Tier 1-only and typed-repair paths remain on Tier 1. No live cost/TAT claim. |

## E1 - Safe work unit prefix evaluation

Purpose: evaluate Planned Parallel RPE planner reliability from local trace prefixes before building runtime parallel execution. This is retrospective trace-derived evidence, not runtime TAT evidence.

Command:

```bash
rtk npm run eval:safe-work-units -- \
  datasets/traces/pi-mono-sample \
  --predictions datasets/fixtures/safe-work-unit-predictions.jsonl \
  --out runs/safe-work-unit-eval
```

The evaluator is offline and deterministic. It reads structured prediction artifacts rather than calling GPT-5.5, Doubleword, or any live provider. Reports separate prefix-visible context from suffix retrospective evidence and write `summary.json` plus `summary.md`.

Fixture coverage in `datasets/fixtures/safe-work-unit-predictions.jsonl`:

| Case | Expected verdict | Evidence checked |
| --- | --- | --- |
| independent docs note | `safe_independent` | Declared ownership, validation, review, cancellation, and no overlap. |
| shared package edits | `safe_after_dependency` | Overlapping owned file and mutable resource with explicit dependency. |
| hidden README dependency | `unsafe` | Read-only file appears only in suffix evidence. |
| missing checks/review | `unsafe` | Mutable source work omits validation and tier1 review. |
| wrong active boundary | `unsafe` | Background claim conflicts with next-actionable response requirement. |
| speculative stale work | `unsafe` | Speculative README edit omits cancellation and suffix touches the same file. |
| unknown surface | `inconclusive` | No declared file or mutable resource surface. |

Primary metric is safety precision. The labeled fixture reports safety precision `1`, unsafe false positives `0`, recall `1`, and all four verdict buckets. When labels are absent, recall is reported as unavailable instead of guessed.

## E2 - TAT bucket code-shard evaluation

Purpose: test whether code-edit safe work units can compress longer realtime execution loops into bounded tier2 background DAGs.

Detailed notes: [`docs/benchmarks/tat-bucket-code-shards.md`](benchmarks/tat-bucket-code-shards.md).

Command:

```bash
rtk npm run eval:safe-work-units -- \
  datasets/traces/pi-mono-full \
  --predictions datasets/fixtures/tat-bucket-code-shards-predictions.jsonl \
  --out runs/safe-work-unit-eval/tat-bucket-code-shards
```

Result summary:

| Metric | Value |
| --- | ---: |
| Evaluated prediction rows/traces | 15 |
| Code-edit units | 49 |
| Safe independent | 31 |
| Safe after dependency | 16 |
| Unsafe | 2 |
| Safety precision | 1 |
| Recall | 0.969 |
| Dependency accuracy | 0.941 |

Wait model: use tier2 SLA as the scheduling quantum. Conservative routing uses `tier2_exec_wait_worst_case = accepted_DAG_depth * 10m`; the table reports the prior 5-10m per-depth range for comparison.

| Bucket | Median DAG depth | Typical tier2 wait | Readout |
| --- | ---: | ---: | --- |
| <5m | 2 | 5-20m | Usually worse than realtime. |
| 5-10m | 3 | 5-30m | Mixed; only shallow DAGs are competitive. |
| 10-15m | 2 | 5-20m | Often comparable to remaining realtime. |
| 15-30m | 1 | 5-20m | Best observed fit for compression. |
| 30-45m | 3 | 5-40m | Depends on how late the planning boundary is and DAG depth. |

Conclusion: tier2 Planned Parallel RPE is not a generic realtime accelerator. It is useful when tier1 planning produces an acyclic, conflict-free code DAG and the user accepts bounded background execution. Prefix time is not a hard routing guard: if no execution remains, no job is launched; otherwise route by safety, user wait budget, DAG critical path, and cost.

The 15-trace prediction artifact is tracked at `datasets/fixtures/tat-bucket-code-shards-predictions.jsonl`; it acts as the selected trace manifest because each row includes the target `traceId` and `prefixBoundary`. The full command may load all local `badlogicgames/pi-mono` JSONL traces from `datasets/traces/pi-mono-full` (626 trace files in the downloaded sample), but only the 15 prediction rows are evaluated. The prediction protocol is documented in [`docs/benchmarks/safe-work-unit-eval-protocol.md`](benchmarks/safe-work-unit-eval-protocol.md).

## Candidate improvements to test next

1. **Define the RPE execution packet and scheduler policy**
   - Execution packet: accepted plan, owned/read-only files, dependencies, constraints, validation contract, budget, user wait budget, stop rules, cancellation rules, and expected handoff.
   - Scheduler policy: reject cycles and ownership conflicts, compute accepted safe-unit DAG critical path, estimate `tier2_exec_wait_worst_case = DAG_depth * 10m`, and launch only when it fits the user's background wait budget.

2. **Improve tier1 workflow efficiency**
   - Better batching, complete root-cause inspection, fewer redundant checks, and less tool-output bloat.
   - Measure this as `semantic-batching-tier1`, not as Doubleword savings.

3. **Prototype RPE background execution after the contract exists**
   - Tier1 research+plan creates an execution packet and validation contract.
   - Tier2 executes in background with budget/concurrency caps.
   - Tier1 reviews/synthesizes completed output before acceptance.

4. **Measure sharded RPE concurrency only after scheduler policy exists**
   - Estimate N independent RPE execute jobs launched together.
   - Report active planning time, background completion time, total cost, failures, late outputs, canceled speculative work, reviewer time, and file conflicts.

5. **Keep generic DAG tier2 routing deferred**
   - Manual semantic review found only ~1.5% tier2 savings in normal interactive traces.
   - Do not route critical edit/tool loops to tier2.
   - Do not use duplicate implementations unless the scheduler proves independent ownership and bounded waste.

## Reproduction notes

External traces are intentionally ignored under `datasets/traces/`; keep committed fixtures under `datasets/fixtures/`.

Fetch a trace manually if needed:

```bash
rtk mkdir -p datasets/traces/pi-mono-sample
rtk curl -L --fail \
  https://huggingface.co/datasets/badlogicgames/pi-mono/resolve/main/<trace-file>.jsonl \
  -o datasets/traces/pi-mono-sample/<trace-file>.jsonl
```

Validation command:

```bash
rtk npm run smoke:benchmarks
```
