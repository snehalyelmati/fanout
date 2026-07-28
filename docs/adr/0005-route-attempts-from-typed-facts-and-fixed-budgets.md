---
status: accepted
---

# Route attempts from typed facts and fixed budgets

Each worker launch is preallocated as one attempt with a closed kind, correlated evidence, one terminal stage fact, one controller action, and one monotonic budget transition. Routing never parses assistant text, stdout, stderr, tool output, or error wording; unknown or contradictory facts fail closed.

Retry, realtime fallback, validation repair, and integration repair use fixed node-global pools that are consumed before launch and never reset inside nested helpers. This gives bounded cost and replayable causality, while deliberately refusing automatic recovery when a provider cannot supply a typed failure fact.

Before a repair successor is allocated, core hashes the exact candidate identity together with the typed failure state, excluding only attempt IDs, timestamps, durations, and attempt-local artifact paths while retaining artifact length and digest. Evidence records candidate equality, failure equality, and a `changed` or `exact-no-progress` disposition. Repeating the same pair terminates as exact no-progress and leaves the remaining repair budget unused. A changed candidate or typed failure continues normally; there is no fuzzy, cyclic, or best-of-N progress policy.

Final-validation repair uses the effective ordered validation contract that actually failed: packet final commands followed by the packet-bound profile's required final gates. The same combined manifest governs failure evidence, the repair prompt, and candidate revalidation; packet and profile command authority are not silently dropped or reordered.

The Pi adapter may include the immediately preceding worker's optional `Worker summary` in a node validation-repair prompt. It is diagnostic prompt context stored in the existing attempt result, not a typed routing fact, recovery field, repair-state input, budget transition, validation result, or acceptance signal. Missing or malformed summaries are ignored, and assistant text still cannot choose whether repair launches.

Acceptance also requires complete correlated evidence for the attempt's provider compatibility class. Every accepted attempt has usage, pricing, turn, tool, and local worker-timing evidence. Generic providers use worker-first-output timing and have no provider response or poll records; instrumented Doubleword attempts additionally require correlated response TTFT and polling evidence. Failed attempts retain whatever partial evidence was actually observed, but partial metrics cannot support acceptance. The Pi adapter supplies provider-specific instrumentation without coupling Fanout core to Doubleword.

Sources: [#14](https://github.com/snehalyelmati/fanout/issues/14), [#21](https://github.com/snehalyelmati/fanout/issues/21), and [#26](https://github.com/snehalyelmati/fanout/issues/26).
