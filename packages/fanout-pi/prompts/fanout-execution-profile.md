---
description: Propose the isolated project preparation and validation commands Fanout needs
---

Build a Project Execution Profile for: $ARGUMENTS

Inspect the repository before proposing commands. Do not edit repository files and do not run installation or validation commands.

Submit exactly one object with `fanout_submit_artifact`. The controller supplies schema/version, profile identity, time, and destination. Include:

- `preparation`: commands needed in each isolated worktree before workers or validation.
- `readiness`: cheap checks proving preparation succeeded.
- `candidateNormalization`: deterministic formatter/fixer commands run before patch capture.
- `requiredFinalGates`: project-wide final validation commands.

Each entry must contain:

- `command`: a direct-argv command object (`executable`, `args`, optional repo-relative `cwd`, optional explicit `env`).
- `purpose`: why the command is required.
- `expectedMutations`: `none`, `ignored-only`, or `candidate-owned`. Use `candidate-owned` only for a candidate normalizer that may rewrite the candidate's tracked files; this disclosure grants no write authority beyond the work contract.
- `networkAccess`: whether it may use the network.
- `lifecycleScripts`: whether it may execute dependency lifecycle scripts.

Use the repository's existing commands and package manager. Keep lists minimal and ordered. Do not use shell strings, shared dependency symlinks, caches, or speculative fallbacks.
