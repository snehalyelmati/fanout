# Phase 2B: hardened `/fanout-plan`

## Status

The coordinated schema cutover is implemented and passes the repository's keyless checks. The live macOS p-map canary and repository-owner approval remain external release gates; this document does not record either gate as passed.

## One executable generation

| Artifact | Schema | Version |
| --- | --- | ---: |
| Planning result | `fanout.implementation-plan` | 2 |
| Grounded details | `fanout.implementation-details` | 3 |
| Execution packet | `fanout.execution-packet` | 5 |
| Active pointer | `fanout.active-packet` | 2 |
| Embedded work contract | `fanout.work-contract` | 1 |
| Planning presentation data | `fanout.planning-report` | 1 |

These versions are a closed generation. Producers emit only these versions and consumers reject legacy, future, mixed-generation, and unknown-field input. There is no migration or compatibility bridge; rerun `/fanout-plan` to replace an obsolete pointer or packet.

## Authority flow

1. The controller captures the exact planning commit, full Git-visible tree, platform, and plan run identity before Phase A.
2. Phase A's model submits only the plan body. The controller supplies schema, version, ID, timestamp, planning host, and planning base.
3. Phase B's model submits only grounded details. The controller supplies schema, version, ID, timestamp, and the exact digest/length/path identity of the once-read Phase A bytes.
4. Details use typed `create`, `modify`, `delete`, and `move` intents; typed repository resources; classified reads; typed forbidden resources; and direct executable/argv validation manifests. Prose and shell strings are not executable authority.
5. `fanout-core` strictly validates both controller envelopes, compiles canonical work contracts, assigns tiers, captures immutable runtime policy, derives dependencies from typed contracts, appends the final-validation controller node, and produces packet v5.
6. `fanout-pi` atomically publishes immutable plan, details, packet, and packet-derived Markdown/Mermaid views. It publishes pointer v2 last. A failed plan invalidates the old pointer instead of preserving stale executable authority.

The packet contains exact source-artifact identities, planning identity, objective/context, tier plan, and ordered nodes with embedded work contracts. It does not duplicate flattened ownership, validation, dependency, or worker-prompt fields. Human views are deterministic projections and are never read as execution input.

## Capability boundary

Planning turns expose read-only repository tools, `ask_user_question`, and the controller-bound artifact submission tool. Artifact destinations and envelope fields are controller-owned. Model output cannot override schema identities, timestamps, source identities, planning identity, platform, or packet fields.

## Package boundaries

- `fanout-core` owns schemas, validation, compilation, graph derivation, and deterministic views. It imports neither Pi nor Doubleword.
- `fanout-pi` owns Pi commands, capability profiles, artifact publication, and runtime wiring.
- `doubleword-provider` remains independently testable and has no Fanout dependency.

## Offline validation

From the repository root:

```bash
rtk npm run check
rtk npm run test:doubleword-provider
rtk git diff --check
```

The compiler and packet smokes additionally prove exact v2/v3/v5/v2 admission, mixed-generation rejection, deterministic derived graph/views, pointer-last identity binding, and package independence.

## Release gates

Offline success is necessary but not sufficient for release. The immutable candidate still requires:

1. an explicitly authorized, non-fabricated macOS p-map live canary with inspected artifacts; and
2. repository-owner approval of that exact candidate.
