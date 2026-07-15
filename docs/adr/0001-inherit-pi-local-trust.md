---
status: accepted
---

# Inherit Pi's local trust instead of claiming host containment

Fanout hardens deterministic repository integration but does not provide an OS, container, credential, network, filesystem, or process sandbox. Planning and worker turns receive curated model-callable tools, while providers, discovered extensions, repository instructions, approved commands, and their child processes remain trusted local inputs running with the user's permissions.

This keeps Fanout compatible with Pi provider and extension discovery and makes launch consent reviewable without pretending that typed commands or worktrees constrain arbitrary local programs. The cost is explicit residual risk: ignored files, external paths, credentials, services, network activity, and host processes are outside Fanout's containment claims.

Sources: [#8](https://github.com/snehalyelmati/fanout/issues/8), [#9](https://github.com/snehalyelmati/fanout/issues/9), [#10](https://github.com/snehalyelmati/fanout/issues/10), [#21](https://github.com/snehalyelmati/fanout/issues/21), [#28](https://github.com/snehalyelmati/fanout/issues/28), and [#29](https://github.com/snehalyelmati/fanout/issues/29).
