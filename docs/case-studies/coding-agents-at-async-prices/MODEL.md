# Model and sources

## Measured runs (p-map task)

p-map is a JavaScript library for running async work concurrently; the task adds `AbortSignal` support to `pMapIterable` with tests, types and docs ([task](../../benchmarks/p-map-abort-signal/TASK.md)). Active time = planning + execution; it excludes dry runs, confirmation or operator waits and setup.

| Run | Setup | Active time | Estimated cost | Run ID |
| --- | --- | ---: | ---: | --- |
| R1 | Raw Pi · GPT-5.6 Sol medium, realtime | 274.1s | $0.548 | `p-map-raw-v2-baseline-20260907/raw-01` |
| R2 | Raw Pi · Kimi K3 medium on Doubleword, realtime | 691.5s | $0.852 | `p-map-raw-kimi-k3-med-20260929/raw-01` |
| F1 | Fanout · Sol plans, Terra works (realtime) | 414.6s | $0.391 | `2026-09-20T16-55-25-785Z-f61c2e11` |
| F2 | Fanout · Kimi K3 plans, DeepSeek V4.1 Flash works (realtime) | 523.8s | $0.318 | `2026-09-28T14-38-24-221Z-9f4f3c01` |

All four passed acceptance v2. Evidence: [p-map run ledger](../../benchmarks/p-map-abort-signal-canary-tracker.md#run-ledger) and [benchmark index](../../BENCHMARKS.md). Prices: Doubleword snapshot retrieved 2026-09-20 ([pricing.ts](../../../packages/doubleword-provider/src/pricing.ts)); Sol $5 / $0.50 / $30 and Terra $2 / $0.20 / $12 per M input / cache-read / output tokens from Pi's model catalog.

The evidence scatter plots 78 p-map runs (72 Fanout, 6 raw Pi) with the same active-time boundary; plans reused across runs are charged to each point.

## Modeling rules (trace-based, offline)

Every modeled number holds the recorded work, tokens, tools and outcome of R2 or F2 fixed and changes one thing:

- **Async:** +60s queue wait before each affected request; generation time unchanged. Doubleword's documented async target is first token within a minute.
- **Planner (Tier 1) is always realtime.** Only workers move to async.
- **Fast continuations (hypothetical):** requests in a session are grouped (5, 10 or whole session); only the first of each group waits 60s. Priced at async rates unless stated.
- **Cache:** default keeps recorded cache reads. "Cold cache" reprices the cached prefix of the first request in each group (or every request) as uncached input. Doubleword documents best-effort implicit caching and explicit caching with a 5-minute sliding TTL; whether cache survives the async queue is undocumented.
- **Continuation price points:** async, midpoint between async and realtime, and full realtime rates for non-first requests in a group.
- **Shallower chains:** the critical worker's 19 sequential requests re-split into a depth of 10 with the same calls and tokens.
- **Less verbose output:** output tokens and post-first-token time scaled by 0.5 for planner and workers; first-token time unchanged. Correctness is not measured.
- **Width:** synchronized waves of equal units at concurrency 4; each unit is the F2 critical worker; fixed realtime planner; compared with raw Sol doing every unit in sequence. The 4× task in the walk adds the measured fixed wrap-up time (~11s).
- **Reliability:** per-unit repair probability p; a repair re-runs one unit on the critical path per affected wave and costs one more unit.

## Caveats

- One clean run per setup anchors the walk; spread is shown on the evidence slide, not a reliability rate.
- Doubleword's recorded first-token time can include hidden generation, so the model adds latency rather than replacing it.
- Fast continuations and an agent-session tier are proposals, not existing Doubleword features.
- Width results come from one narrow task and are conditional on tasks supplying that many independent parts.
