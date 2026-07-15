---
status: accepted
---

# Bind accepted state to exact bytes and Git trees

Artifact identity is exact path, byte length, and SHA-256; repository identity is the exact planning commit plus a full Git-visible tree. Every accepted change is one binary patch bound to its changed paths, base tree, and result tree, and the accepted ledger is an ordered chain of those transitions.

Worker, repair, and final-validation worktrees reconstruct the planning base and apply the accepted transition chain through Git stdin. Final validation runs in a fresh reconstruction, not the active checkout, and only a freshly reconstructed passing repair candidate may reach active. Fanout deliberately does not auto-rebase, reset drift, roll back a failed final run, or guess recovery after a mid-apply crash; ambiguous state keeps its lock and requires manual reconciliation.

Rejected candidate bytes may seed only the next disposable validation-repair worktree. They never enter the accepted ledger or become active authority: the repair is recaptured relative to the current accepted tree and must pass the same ownership, validation, identity, and acceptance gates as any other candidate.

Sources: [#12](https://github.com/snehalyelmati/fanout/issues/12), [#18](https://github.com/snehalyelmati/fanout/issues/18), [#24](https://github.com/snehalyelmati/fanout/issues/24), and [#30](https://github.com/snehalyelmati/fanout/issues/30).
