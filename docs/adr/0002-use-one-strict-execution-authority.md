---
status: accepted
---

# Use one strict execution authority

Every executable node embeds one canonical work contract. Typed change endpoints are its sole write authority; typed reads derive DAG edges; typed forbidden writes constrain acceptance; direct executable/argument commands define normalization and validation; prompts, Markdown, graph renderings, and warnings are derived views only.

Commands preserve literal executable identity, argument order and duplication, working directory, and environment overrides. Fanout does not add an implicit shell, parse command strings, infer tools, or classify programs as safe. A shell or interpreter remains available only when the packet names it explicitly as the trusted executable.

Producers and consumers cut over together to one strict schema generation. The current generation is plan v2, details v4, packet v6, pointer v2, and work-contract v2. Legacy or mixed artifacts are rejected and must be replanned rather than migrated, because a compatibility bridge would preserve competing definitions of ownership, graph structure, commands, and routing.

Sources: [#11](https://github.com/snehalyelmati/fanout/issues/11), [#13](https://github.com/snehalyelmati/fanout/issues/13), [#17](https://github.com/snehalyelmati/fanout/issues/17), [#19](https://github.com/snehalyelmati/fanout/issues/19), [#22](https://github.com/snehalyelmati/fanout/issues/22), [#23](https://github.com/snehalyelmati/fanout/issues/23), [#25](https://github.com/snehalyelmati/fanout/issues/25), [#31](https://github.com/snehalyelmati/fanout/issues/31), and [#32](https://github.com/snehalyelmati/fanout/issues/32).
