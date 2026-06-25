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

## D2 — Optimistic DAG benchmark matrix, planned

Design notes: [`docs/OPTIMISTIC_DAG_WORKFLOW.md`](OPTIMISTIC_DAG_WORKFLOW.md).

Purpose: understand whether an optimistic DAG workflow is worth building and isolate where savings come from.

Required comparison matrix:

| Scenario | What it isolates | Success signal |
| --- | --- | --- |
| `sequential-tier1` | Current fastest active loop baseline | Baseline active time and cost |
| `optimistic-dag-tier1` | DAG/workflow speedup or overhead without Doubleword discount | Same or lower active time than sequential tier1 |
| `optimistic-dag-tier1+tier2` | Doubleword cost savings and latency penalty on the same DAG | Lower cost with active time close to `optimistic-dag-tier1` |
| `all-tier2` | Cost floor | Non-interactive reference only |

Reporting requirements:

- Use more samples than B0, split by task type.
- Report active developer time separately from background completion time.
- Report cost deltas from DAG shape separately from Doubleword tier routing.
- Track branch count, tier2-eligible token share, barrier count/depth, and late/unused branch outputs.
- Include portfolio-mode estimates: N independent optimistic DAG tasks launched concurrently under a shared budget/concurrency cap.

## Running experiment ledger

Add one row per meaningful workflow or routing change.

| ID | Date | Change | Dataset | Model/routing | Cost | Turnaround | Notes |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| B0 | 2026-06-25 | Baseline sequential Pi loop | 3 `badlogicgames/pi-mono` traces | GLM realtime/tier 1 only | $23.0533 | 17.5m | Current baseline |
| B0-all-tier2 | 2026-06-25 | Same turns, all tier 2 SLA simulation | same | GLM tier 2 all turns | $17.2899 | 23.4h | Not usable interactively |
| D1 | 2026-06-25 | Faithful trace-DAG routing check | same | GLM tier1+tier2 combo | $23.0533 | 17.5m | No off-critical model turns; DAG not justified yet |

## Candidate improvements to test next

1. **Expand sample confidence**
   - Run D1/D2 metrics over more local samples.
   - Split by review-only, implementation, merge/release, issue triage, docs, and debugging.

2. **Separate DAG savings from Doubleword savings**
   - Add `optimistic-dag-tier1` before claiming any Doubleword effect.
   - Treat realtime/tier1 as the fastest endpoint baseline; tier2 should be counted as cost savings with latency risk.

3. **Optimize the 1.8h optimistic estimate**
   - Route fewer branches to tier2: only high-token, low-urgency work.
   - Add branch deadlines and synthesize with ready outputs instead of blocking on every branch.
   - Avoid serial tier2 barriers.

4. **Portfolio-mode concurrency**
   - Estimate multiple independent 1.8h optimistic DAG runs launched together.
   - Report user active time, background completion time, total cost, and concurrency/budget caps.

5. **Route by task type, not by call duration**
   - Current trace shows no calls naturally long enough to justify tier 2 while blocking.
   - Try policies like tier 1 for patching/tool loops, tier 2 for review/eval/report generation.

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
