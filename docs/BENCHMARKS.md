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

Current result: the prior plan-v2/details-v3/packet-v5 generation passed locally, but the live canary reopened deterministic-glue scope in issue #32. The coordinated replacement is plan v2, details v4, packet v6, pointer v2, work-contract v2, attempt outcome v2, final evidence v1, event v2, and projection v3. Its added proof covers one explicit candidate-normalization manifest, run-once pre-capture execution, nonzero continuation into authoritative validation, hard-failure routing without model-repair budget, audit identities/results, and ownership rejection of normalizer-created unauthorized changes. Do not treat the replacement as locally green until the full `rtk npm run check` result is recorded after implementation.

Supersession note (2026-07-20): this remains historical contract evidence for Attempt outcome v2/event v2/projection v3. Attempt Outcome v3/Event v3/Projection v4 is now the only current replayable generation and records exact Worker Turn, Provider Response, named Tool Invocation, and cache evidence. The complete keyless root contract/replay/worker matrix passes through `rtk npm run check`; this is validation evidence, not a new live latency, cost, or release-readiness claim.

Current-generation note (2026-07-28): profile v1, plan v3, details v5, work contract v3, packet v7, Attempt Outcome v4, final evidence v2, Event v4, and Projection v5 supersede that executable generation. Focused offline evidence covers cumulative repair seeds, isolated profile preparation, exact path-disjoint reconciliation, exact no-progress termination, vertical serial-chain fusion, profile-aware profiler compatibility, cleanup timing before the terminal event, and optional advisory Worker-summary continuity across node validation repairs without a schema change. Older execution evidence is descriptive Legacy data; there is no migration. The Worker-summary prompt change creates a new immutable candidate, so the next live sequence must restart at the canary; no live result is attributed before that run.

The attempt-outcome check passes A10–A12 offline: prose-like output cannot affect typed routing, accepted generic and instrumented metrics require exact correlated identities, failed attempts retain observed partial cost, and nested validation/integration repair cannot exceed either fixed two-launch pool. This remains contract evidence only.

The companion execution-event check passes A13–A14 offline: serialized commits remain gapless, projection/report publication failures leave a complete authoritative log, audit replay regenerates only derived views, corrupt logs fail closed, live/dry-run outcomes remain explicit, and accepted final repair rolls projection authority to the newly validated tree. Reports have a byte-stable projection-only contract.

Caveat: worker usage and cost in this smoke are synthetic fake-provider fixtures. P2 now has controlled real-Pi diagnostic evidence below; P4 live tier-routing measurements remain pending.

## P2 — Manual p-map AbortSignal E2E

Date prepared: 2026-07-10; release-candidate update: 2026-07-14

Status: the 2026-07-27 implementation addresses the prerequisite and Points 1–4 from the reliability investigation. Its controlled sequence completed the canary and repetitions 1–2, then stopped when repetition 3 exhausted the fused runtime/test node's two validation repairs. The release-confidence gate therefore remains open. The later profiler compatibility fix and 2026-07-28 Worker-summary prompt change require the next sequence to restart at the canary. No live outcome is yet attributed to the Worker-summary candidate, and no reliability rate or universal SLO is inferred.

Runbook: [`docs/benchmarks/p-map-abort-signal-manual-e2e.md`](benchmarks/p-map-abort-signal-manual-e2e.md)

Live tracker: [`docs/benchmarks/p-map-abort-signal-canary-tracker.md`](benchmarks/p-map-abort-signal-canary-tracker.md)

Reliability/latency investigation: [`docs/benchmarks/fanout-optimization-progress.md`](benchmarks/fanout-optimization-progress.md)

Purpose: exercise `/fanout-config` → `/fanout-plan` → `/fanout-execute --dry-run` → `/fanout-execute` manually against a fixed `sindresorhus/p-map` task before building a benchmark harness or routing variations. The run prioritizes correctness, UX, recovery, artifact quality, and observability. It uses local baseline `c3c261e2189f94d1a09724e8f03d5345af518017` and the decision-complete `pMapIterable` AbortSignal benchmark under `/Users/snehalyelmati/Documents/p-map-abort-signal`.

The user operates Pi and authorizes every live or cost-incurring step. Preserve failed artifacts, diagnose the owning component before edits, and record results only after comparing Fanout reports with the nested repository Git state and independent `npm test` output. The 2026-07-27 sequence ran from clean independent 51-test baselines with Tier 1 `openai-codex/gpt-5.6-sol` medium, async Tier 2 disabled, and `openai-codex/gpt-5.6-terra` medium as the realtime worker fallback; the Pi process had the Doubleword credential removed. Across the three completed identical runs, wall time had median 306.291s and range 278.563–408.114s, tokens median 502,710 and range 348,095–617,895, and estimated cost median `$0.624695` and range `$0.547498`–`$0.843834`. See the tracker for phase, critical-path, overlap, repair, pane, cleanup, tree, and failed-run evidence.

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
- **Observed execution evidence**: manual multi-turn `pi-mono` reviews show generic interactive tier2 DAG routing is weak, with about 1.5% semantic tier2 savings in the reviewed sample.
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
| P1-fallback-role | 2026-07-10 | Introduced separate Tier 2 fallback model role in the then-current packet v4 | fake-provider execution smoke | Tier 1 control plane + Tier 2 async + independent realtime fallback | synthetic | synthetic | Historical schema evidence; the role persists in packet v5. No live cost/TAT claim. |
| P1-hardened-cutover | 2026-07-14 | Cut planning and execution to plan v2/details v3/packet v5/pointer v2 with event-v1/projection-v2 runtime, exact patch-ledger replay, and typed bounded recovery | complete keyless A1-A20 smoke matrix with fake/stub workers | immutable packet tier policy; public dry-run/live seams | synthetic; no provider-cost claim | synthetic; no live TAT claim | Offline implementation evidence only. The explicitly authorized macOS p-map canary and repository-owner approval remain release gates. |
| P1-normalization-canary | 2026-07-14 | Packet-declared, language-agnostic candidate normalization with details v4/work-contract v2/packet v6 and event-v2/projection-v3 audit evidence | live `p-map` AbortSignal canary, Attempt 14 | Sol control/final review; Terra workers; async Tier 2 disabled | `$1.1384025` estimated | 465.391s | Full DAG completed: 6 attempts, 655,081 tokens, five accepted files (+327/-30), all normalizers exited 0, and final `npm test` passed 56 tests. Post-E2E review fixes are separately validated at 59 tests and are not attributed to the immutable canary tree. |
| P2-profile-v1-controlled | 2026-07-27 | Profile v1, packet v7, vertical fusion, cumulative repair seeds, and current Event v4 evidence | one live canary plus three byte-identical `p-map` repetitions | Sol medium control; Tier 2 disabled; Terra medium fallback workers | completed-run median `$0.624695`, range `$0.547498`–`$0.843834` | completed-run median 306.291s, range 278.563–408.114s | Canary and repetitions 1–2 completed; repetition 3 stopped on bounded worker validation-repair exhaustion. This is diagnostic evidence, not release acceptance or a reliability-rate claim. |

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

## P3 — Offline profiler fixed-behavior concurrency and Provider Profile scenarios

The profiler's public scenario query calculates observed, sequential, custom positive-safe-integer, and unlimited Fanout-concurrency schedules over admitted Event v4/Projection v5 evidence bound to exact profile identity. Independent Tier 1 and Tier 2 mappings may retain observed calls or apply fixed/cold-warm TTFT, FIFO provider capacity, explicit warmth/reset assumptions, output-token generation speed, and displayed input/output/cache-read/cache-write per-million rates. Missing usage keeps cost Partial or Unavailable. The packet DAG, recorded Attempt and repair chains, tier assignments, Worker Turns, Provider Responses, Tool Invocations, outcomes, validations, patches, and Accepted Ledger order stay fixed. Results expose Fanout/provider capacity and acceptance-gate waits, TTFT, generation, cost, uncovered time, the completion chain, recorded-prefix or dry-run limits, and one Evidence Receipt. They are deterministic workflow experiments under fixed assumptions, not provider forecasts, quality claims, routing recommendations, or measured performance baselines.

Validation:

```bash
rtk bun test packages/fanout-profiler/src/scenario.test.ts
rtk npm run check
```

The focused table covers observed-boundary reproduction and rejection, sequential/custom/unlimited Fanout capacity, deterministic allocation and provider FIFO ties, dependency and repair preservation, ledger-order acceptance, fixed and cold/warm timing, reset controls, cache-aware cost evidence, incomplete prefixes, and dry runs. No benchmark dataset, fixed price input, routing policy, cost baseline, or measured latency result changed in this slice.

## P4 — Offline profiler representative local performance

Run separately from normal validation:

```bash
rtk npm run benchmark:profiler
```

The generated temporary storage root contains exactly 50 project directories. Three are admitted projects: one contains 100 Workflow Lineages, 500 Execution Runs, 100,000 Event Log rows, and one 134,217,728-byte (128 MiB) supporting log, while two contain lightweight execution evidence. The other 47 directories contain runtime context only and must not enter the project registry. Two completed current runs contribute 400 fully admitted Event v4 rows bound to one exact profile and support the workspace, exact same-packet comparison, and observed-scenario measurements. The other 498 runs contribute 99,600 recognized Event v2 envelope rows, exercising Legacy discovery without pretending old evidence is current or replayable. The supporting log contains 1,048,576 complete 128-byte JSONL rows. Catalog load accounting must report zero supporting-evidence content bytes before the benchmark requests the capped first 500 rows, and the immutable snapshot must not contain the row payload.

Local targets from issue #46 are under 5,000 ms for initial storage-root discovery/catalog load or refresh, under 250 ms for workspace/comparison/scenario queries, and under 500 ms for a capped evidence page. The profile-bound compatibility run on 2026-07-27 used Bun 1.3.14 on macOS arm64 with an Apple M1 Pro:

| Measurement | Result | Target |
| --- | ---: | ---: |
| Fixture generation (reported separately) | 196.24 ms | n/a |
| Initial storage-root discovery and catalog | 1,680.69 ms | <5,000 ms |
| Storage-root rescan and selected-project refresh | 1,628.47 ms | <5,000 ms |
| Workspace query | 5.94 ms | <250 ms |
| Exact comparison query | 6.11 ms | <250 ms |
| Observed scenario query | 6.63 ms | <250 ms |
| 500-row evidence page | 1.92 ms | <500 ms |

These are one local wall-clock observation, not a CI guarantee, provider benchmark, or claim that 99,600 Legacy rows cost the same as replaying 99,600 current events. The benchmark contains no timing assertions. Normal checks instead prove structurally that a 128 MiB supporting log is represented only by metadata until selected, is not retained in the immutable snapshot, and cannot return more than 500 rows per page.

## Hardened execution baseline

1. **Measure the admitted packet-v7 scheduler policy**
   - Execution authority is the exact profile-v1/packet-v7/work-contract-v3 tuple with typed resources, derived dependencies, direct-argv validation, immutable runtime policy, fixed attempt budgets, and causal events.
   - Future routing experiments must preserve that authority and compare measured critical-path time, accepted metrics, and cost without adding prose stop-rule or budget fields.

2. **Improve tier1 workflow efficiency**
   - Better batching, complete root-cause inspection, fewer redundant checks, and less tool-output bloat.
   - Measure this as `semantic-batching-tier1`, not as Doubleword savings.

3. **Evaluate the implemented background execution path**
   - Tier 1 planning publishes the accepted packet; eligible Tier 2 nodes execute under packet-owned concurrency and fixed budgets.
   - Controller-owned validation, exact accepted transitions, and fresh final reconstruction remain acceptance authority.

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
