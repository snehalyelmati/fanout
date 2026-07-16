---
status: accepted
---

# Normalize candidates before patch capture

One required, empty-able, repository-level direct-argv command list is copied into every work contract. After a successful worker or repair edit, the controller runs that list once in the disposable candidate worktree before patch capture, typed ownership checks, and the original validation. Nonzero results are audited and may retain partial deterministic fixes; launch, interruption, audit, or repository-identity failures fail closed without consuming model-repair budget.

This boundary keeps formatting and other deterministic repository fixers out of semantic repair retries without teaching Fanout about languages, package managers, tools, or stderr patterns. Initial integrated final validation itself does not run normalizers; a final-repair candidate does, under the already-derived upstream write authority, before final validation remains authoritative over that candidate.

The issue resolution also says normalizer scripts can inspect controller-owned attempt/node environment values. The current implementation supplies the controller process environment and declared command overrides, but not the worker subprocess's attempt/node variables; that source claim is not implemented.

Sources: [#8](https://github.com/snehalyelmati/fanout/issues/8), [#13](https://github.com/snehalyelmati/fanout/issues/13), [#17](https://github.com/snehalyelmati/fanout/issues/17), [#18](https://github.com/snehalyelmati/fanout/issues/18), [#19](https://github.com/snehalyelmati/fanout/issues/19), and [#32](https://github.com/snehalyelmati/fanout/issues/32).
