---
status: accepted
---

# Make events authoritative and reports context-free

The gapless execution event log is the sole run-state authority. A strict pure reducer produces the replaceable execution projection, and deterministic reports render only from that projection. Audit replay can regenerate projections and reports but cannot launch work, spend budgets, mutate Git, remove locks, or invent a terminal outcome.

Planning and execution reports use Pi custom entries that are excluded from later model context. If that safe presentation channel is unavailable, Fanout preserves the artifact and fails closed instead of falling back to a context-bearing message. This separates durable audit state, human presentation, and future model input at the cost of retaining a small Pi-specific presentation adapter.

Sources: [#15](https://github.com/snehalyelmati/fanout/issues/15), [#16](https://github.com/snehalyelmati/fanout/issues/16), [#27](https://github.com/snehalyelmati/fanout/issues/27), and [#28](https://github.com/snehalyelmati/fanout/issues/28).
