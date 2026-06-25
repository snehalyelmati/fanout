# Benchmark Metrics

This is the primary running document for Doubleword cost/time experiments. Update it whenever workflow changes, routing changes, pricing changes, or benchmark datasets change.

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

## Running experiment ledger

Add one row per meaningful workflow or routing change.

| ID | Date | Change | Dataset | Model/routing | Cost | Turnaround | Notes |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| B0 | 2026-06-25 | Baseline sequential Pi loop | 3 `badlogicgames/pi-mono` traces | GLM realtime/tier 1 only | $23.0533 | 17.5m | Current baseline |
| B0-all-tier2 | 2026-06-25 | Same turns, all tier 2 SLA simulation | same | GLM tier 2 all turns | $17.2899 | 23.4h | Not usable interactively |
| D1 | 2026-06-25 | Faithful trace-DAG routing check | same | GLM tier1+tier2 combo | $23.0533 | 17.5m | No off-critical model turns; structural optimistic estimate later superseded |
| D2 | 2026-06-25 | Manual semantic DAG review | 10 Pi traces | GLM semantic tier1+tier2 | $20.4214 effective hybrid | same active path | Only 1.48% semantic tier2 savings; ~24.8% separate DAG/prompt-efficiency opportunity |
| D3 | 2026-06-25 | Research-plan-execute routing | 5 RPE Pi traces | GLM tier1 research+plan, tier2 execute | $18.0758 | 14.2h-28.2h sequential completion | Saves 22.0%; only viable async/background |

## Candidate improvements to test next

1. **Improve tier1 workflow efficiency first**
   - Better batching, complete root-cause inspection, fewer redundant checks, and less tool-output bloat.
   - Measure this as `semantic-batching-tier1`, not as Doubleword savings.

2. **Prototype RPE background execution**
   - Tier1 research+plan creates an execution packet and validation contract.
   - Tier2 executes in background with budget/concurrency caps.
   - Tier1 reviews/synthesizes completed output before acceptance.

3. **Measure portfolio-mode concurrency**
   - Estimate N independent RPE execute jobs launched together.
   - Report active planning time, background completion time, total cost, failures, and late outputs.

4. **Keep generic DAG tier2 routing deferred**
   - Manual semantic review found only ~1.5% tier2 savings in normal interactive traces.
   - Do not route critical edit/tool loops to tier2.

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
