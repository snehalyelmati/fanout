---
status: accepted
---

# Route attempts from typed facts and fixed budgets

Each worker launch is preallocated as one attempt with a closed kind, correlated evidence, one terminal stage fact, one controller action, and one monotonic budget transition. Routing never parses assistant text, stdout, stderr, tool output, or error wording; unknown or contradictory facts fail closed.

Retry, realtime fallback, validation repair, and integration repair use fixed node-global pools that are consumed before launch and never reset inside nested helpers. This gives bounded cost and replayable causality, while deliberately refusing automatic recovery when a provider cannot supply a typed failure fact.

Acceptance also requires complete correlated evidence for the attempt's provider compatibility class. Every accepted attempt has usage, pricing, turn, tool, and local worker-timing evidence. Generic providers use worker-first-output timing and have no provider response or poll records; instrumented Doubleword attempts additionally require correlated response TTFT and polling evidence. Failed attempts retain whatever partial evidence was actually observed, but partial metrics cannot support acceptance. The Pi adapter supplies provider-specific instrumentation without coupling Fanout core to Doubleword.

Sources: [#14](https://github.com/snehalyelmati/fanout/issues/14), [#21](https://github.com/snehalyelmati/fanout/issues/21), and [#26](https://github.com/snehalyelmati/fanout/issues/26).
