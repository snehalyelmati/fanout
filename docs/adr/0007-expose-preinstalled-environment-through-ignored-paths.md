---
status: accepted
---

# Prepare isolated worktrees through an approved execution profile

This ADR supersedes its original shared-path decision. Disposable profile-validation, worker, repair, reconciliation, and final-validation worktrees run the approved Project Execution Profile's ordered direct-argv preparation and readiness commands independently after exact reconstruction and before paid model allocation.

Preparation and readiness must preserve `HEAD`, the index relation, and the Git-visible tree. Purpose, expected mutation, network, and lifecycle-script disclosures are approval evidence; user approval is the authority boundary. Profile validation uses a disposable clean worktree, distinguishes environment readiness from task correctness, and atomically publishes only a passing replacement. `FANOUT_WORKTREE_SHARED_PATHS` fails closed. Fanout adds no copied, COW, cached, symlinked, or language-specific dependency mechanism.

Sources: [#8](https://github.com/snehalyelmati/fanout/issues/8), [#21](https://github.com/snehalyelmati/fanout/issues/21), [#30](https://github.com/snehalyelmati/fanout/issues/30), and [#32](https://github.com/snehalyelmati/fanout/issues/32).
