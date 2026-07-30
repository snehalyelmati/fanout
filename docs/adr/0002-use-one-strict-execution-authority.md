---
status: accepted
---

# Use one strict execution authority

Every executable node embeds one canonical work contract. Typed change endpoints are its sole write authority; typed reads derive DAG edges; typed forbidden writes constrain acceptance; task-specific direct executable/argument commands define node validation; prompts, Markdown, graph renderings, and warnings are derived views only. One separately approved Project Execution Profile owns isolated preparation, readiness checks, candidate normalization, and project-wide final gates.

Phase B receives that exact approved profile as context. Ordinary nodes use the narrowest meaningful checks for their owned changes, with broader scope retained for shared infrastructure, configuration, build, test-harness, and similarly wide-impact work. Packet-final commands add only task-specific integrated checks, and project-wide suites remain profile final gates. If a submitted node or packet-final command exactly duplicates a profile final gate, core artifact admission rejects that draft with its precise locations while the Pi controller preserves the planning session for corrected resubmission; neither layer silently changes submitted command authority.

Commands preserve literal executable identity, argument order and duplication, working directory, and environment overrides. Fanout does not add an implicit shell, parse command strings, infer tools, or classify programs as safe. A shell or interpreter remains available only when the packet names it explicitly as the trusted executable.

Producers and consumers cut over together to one strict schema generation. The current generation is profile v1, plan v3, details v5, packet v7, pointer v2, and work-contract v3. Packets bind the exact profile path, digest, length, and version. Legacy or mixed artifacts are rejected and must be replanned rather than migrated, because a compatibility bridge would preserve competing definitions of ownership, graph structure, commands, preparation, and routing.

Sources: [#11](https://github.com/snehalyelmati/fanout/issues/11), [#13](https://github.com/snehalyelmati/fanout/issues/13), [#17](https://github.com/snehalyelmati/fanout/issues/17), [#19](https://github.com/snehalyelmati/fanout/issues/19), [#22](https://github.com/snehalyelmati/fanout/issues/22), [#23](https://github.com/snehalyelmati/fanout/issues/23), [#25](https://github.com/snehalyelmati/fanout/issues/25), [#31](https://github.com/snehalyelmati/fanout/issues/31), and [#32](https://github.com/snehalyelmati/fanout/issues/32).
