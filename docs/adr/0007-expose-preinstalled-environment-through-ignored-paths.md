---
status: accepted
---

# Expose preinstalled environment through ignored repository paths

Disposable worker and final-validation worktrees may need preinstalled repository-local dependencies that are intentionally absent from Git. Fanout accepts an externally configured list of unique canonical top-level paths only when each path already exists and Git ignores it. Preflight and launch confirmation expose that list, and reconstruction links each approved path into the disposable worktree after replaying accepted patches.

The mechanism is deliberately language- and runtime-agnostic: Fanout core does not recognize dependency directories, package managers, or installers. This avoids network-dependent reinstalls and runtime-specific reconstruction code, while keeping the linked contents outside Git-visible repository identity and containment claims. A collision with reconstructed content or a path that is missing, nested, duplicated, or Git-visible fails closed.

Sources: [#8](https://github.com/snehalyelmati/fanout/issues/8), [#21](https://github.com/snehalyelmati/fanout/issues/21), [#30](https://github.com/snehalyelmati/fanout/issues/30), and [#32](https://github.com/snehalyelmati/fanout/issues/32).
