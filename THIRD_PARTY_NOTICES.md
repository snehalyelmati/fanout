# Third-party notices

The root MIT license applies to Fanout's original code and documentation. It does not replace the licenses of dependencies, upstream benchmark repositories or external datasets. Preserve their license and copyright notices when redistributing them.

## Dependencies

Source installation obtains dependencies through the package manager; their notices remain in the installed packages. The development snapshot inspected for this preview includes:

| Dependency | License |
| --- | --- |
| `@earendil-works/pi-ai`, `pi-coding-agent`, `pi-tui` | MIT |
| `@juicesharp/rpiv-ask-user-question` | MIT |
| `typebox` | MIT |
| `typescript` | Apache-2.0 |
| `@types/node` | MIT |

Transitive dependencies retain their own notices as well. This table is a navigation aid, not a complete license inventory of every future dependency resolution. The figure-generation environment is separate from the JavaScript runtime; its packages retain their upstream notices.

## Benchmarks and datasets

p-map, qs, Execa and Pi are third-party projects used as benchmark subjects. This release describes tasks and publishes selected scalar findings; it does not relicense or bundle those projects' implementations or recorded sessions. Obtain any required upstream source or external datasets separately under their own terms. Source identities and reproducibility limits are documented in the [methodology](docs/study/METHODOLOGY.md).

Test fixtures retained in the public tree are synthetic contract/policy inputs or curated prediction records, not a license grant for upstream source or transcripts. Recorded session fixtures and an event-filled historical prototype have been removed from the current tree. Third-party licenses and notices continue to apply to upstream material.
