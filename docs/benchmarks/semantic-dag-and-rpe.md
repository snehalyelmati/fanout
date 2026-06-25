# Semantic DAG and RPE Findings

Date: 2026-06-25

Purpose: consolidate the manual subagent trace reviews after the mechanical optimistic-DAG estimate proved too coarse.

Pricing used throughout:

| Model | Tier 1 input | Tier 1 output | Tier 2 input | Tier 2 output |
| --- | ---: | ---: | ---: | ---: |
| `glm-5-2` | $1.40 / MTok | $4.40 / MTok | $1.05 / MTok | $3.30 / MTok |

Tier 2 timing assumption: 5-10 minutes per assistant/model turn, midpoint 7.5 minutes.

## Method correction

The first optimistic estimate used a structural heuristic: keep first/last assistant turn per user segment on tier 1 and route middle turns to tier 2. That was useful only as a rough upper-bound thought experiment. It is not accurate enough for product decisions.

Current standard:

- a subagent must read the assigned JSONL trace line-by-line;
- every JSONL line must be accounted for in notes;
- phase or DAG boundaries must be semantic, based on the context the agent actually had at that point;
- tier 2 eligibility requires a branch to be off the user-visible critical path or safe to miss a deadline;
- if a trace is too large or unclear, mark it infeasible instead of guessing.

## Experiment A: semantic optimistic DAG over 10 traces

Question: if subagents manually identify feasible DAG branches, how much can Doubleword tier 2 save in normal interactive agent traces?

Sample: 10 manually reviewed traces: one initial trace plus 9 additional traces. Supporting generated artifacts live under `runs/manual-dag-9-more/`; the first reviewed trace was `2026-01-16T11-27-41-663Z_7e5bb6ee-e3ca-4da8-86e5-079051bd15cf.jsonl`.

| Metric | 9 additional traces | 10-trace total |
| --- | ---: | ---: |
| Baseline tier 1 cost | $20.1272 | $20.7282 |
| Semantic tier 2 savings | $0.2938 | $0.3068 |
| Semantic tier 2 savings pct | 1.46% | 1.48% |
| Separate DAG/prompt-efficiency estimate | ~$5.0410 | ~$5.1419 |
| DAG/prompt-efficiency pct | ~25.0% | ~24.8% |

Readout:

- Semantic tier 2 savings are tiny in normal interactive traces.
- Most assistant/model turns gate the next tool call, edit, validation, commit, push, or user answer.
- The larger savings are from doing less work: better batching, avoiding redundant checks, trimming huge tool outputs, fixing root causes once, and reducing symptom/debug loops.
- These DAG/prompt-efficiency estimates are separate from Doubleword savings and should be benchmarked as a tier1-only workflow improvement.

## Experiment B: research-plan-execute routing over 5 traces

Question: for traces with a clean research-plan-execute split, what happens if research+plan stays tier 1 and execution is routed to tier 2?

Selection criteria:

- the user initially asks for analysis/proposal only, or there is an explicit planning phase;
- execution starts only after a semantic boundary, usually user approval;
- subagents manually identify research, plan, execute, and other/user-wait turns line-by-line.

Supporting generated artifacts live under `runs/rpe-tier2-5/`.

| Trace | Shape | Execute turns | Tier1 baseline | R+P tier1 + execute tier2 | Savings | Baseline provider time | Hybrid provider completion |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `10-50-40_13d61130` | issue #764 analysis → truncate/fix/commit loops | 21 | $2.4825 | $2.1352 | $0.3473 / 14.0% | 4.7m | 108.6m-3.6h |
| `11-27-41_7e5bb6ee` | issue #774 analysis → implement/commit/close | 14 | $0.6010 | $0.4811 | $0.1199 / 20.0% | 2.1m | 71.0m-2.3h |
| `19-35-54_90c2c1e4` | issue #784 research/docker plan → long implementation/test | 102 | $17.4756 | $13.3270 | $4.1486 / 23.7% | 11.6m | 8.5h-17.0h |
| `20-55-34_e18dee76` | issue #776 analysis → implement/commit/comment | 9 | $0.5259 | $0.4098 | $0.1161 / 22.1% | 78.7s | 45.7m-90.7m |
| `21-53-12_1375d9e7` | issue #792 analysis → implement/docs/commit | 22 | $2.0820 | $1.7228 | $0.3592 / 17.3% | 3.8m | 111.9m-3.7h |
| **total, sequential** |  | **168** | **$23.1670** | **$18.0758** | **$5.0912 / 22.0%** | **23.5m** | **14.2h-28.2h** |

Readout:

- Research-plan-execute is the first shape where tier 2 savings are material: about 22% on this 5-trace sample.
- Blocking on tier 2 execution is not interactive: the same work grows from 23.5 minutes provider time to 14-28 hours sequential completion.
- The useful product shape is background execution after a tier1 research/plan handoff, especially in a portfolio of independent tasks.
- Active user time can stay close to tier1 planning time if the user launches several approved execute jobs and reviews results later.

## Consolidated conclusions

1. **Realtime/tier1 remains the speed baseline.** Tier 2 does not make interactive loops faster.
2. **Normal interactive semantic DAG routing has weak Doubleword savings.** The manually reviewed 10-trace sample found only ~1.5% semantic tier2 savings.
3. **DAG/prompt efficiency is valuable but provider-independent.** About ~25% cost reduction appears plausible from fewer model turns and smaller context, but that should be counted as tier1 workflow improvement, not Doubleword tier savings.
4. **RPE background execution is promising for cost.** Research+plan on tier1 and execute on tier2 saved ~22% in the 5-trace RPE sample.
5. **RPE is only usable asynchronously.** Blocking completion is hours, so product UX must be portfolio/background: plan now, execute in background, review later.

## Product implication

Do not build a generic DAG executor to route arbitrary middle turns to tier2.

Prefer two narrower workflows:

1. **Tier1 semantic batching workflow**: improve planning prompts and tool batching to reduce turns, redundant checks, and context bloat while staying realtime.
2. **RPE background execution workflow**: tier1 research/plan produces an approved execution packet; tier2 executes in background with checkpoints, budgets, and final tier1 review/synthesis.
