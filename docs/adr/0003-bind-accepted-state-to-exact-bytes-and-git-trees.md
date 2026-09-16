---
status: accepted
---

# Bind accepted state to exact bytes and Git trees

Artifact identity is exact path, byte length, and SHA-256; repository identity is the exact planning commit plus a full Git-visible tree. Every accepted change is one binary patch bound to its changed paths, base tree, and result tree, and the accepted ledger is an ordered chain of those transitions.

Worker, repair, and final-validation worktrees reconstruct the planning base and apply the accepted transition chain through Git stdin. Final validation runs in a fresh reconstruction, not the active checkout, and only a freshly reconstructed passing repair candidate may reach active. Fanout deliberately does not auto-rebase, reset drift, roll back a failed final run, or guess recovery after a mid-apply crash; ambiguous state keeps its lock and requires manual reconciliation.

Rejected candidate bytes seed the immediately following disposable repair worktree, including across process-only launch failures. Each repair is cumulative: the next model sees the exact prior rejected tree, while only a passing candidate is recaptured relative to the current accepted tree and may enter the ledger.

When a candidate is stale only because intervening accepted transitions changed exact disjoint paths, the controller deterministically reconstructs the latest tip, overlays the candidate, reruns profile normalization, ownership checks, and validation, then compare-and-swap applies the recaptured transition. Ledger advancement is the sole retry condition. Unavailable base, path overlap, invalid overlay, normalization failure, ownership failure, or combined-validation failure routes through typed integration repair; preparation and repository infrastructure failures fail closed without consuming repair budget. There is no same-file, semantic, fuzzy, or three-way reconciliation.

Sources: [#12](https://github.com/snehalyelmati/fanout/issues/12), [#18](https://github.com/snehalyelmati/fanout/issues/18), [#24](https://github.com/snehalyelmati/fanout/issues/24), and [#30](https://github.com/snehalyelmati/fanout/issues/30).
