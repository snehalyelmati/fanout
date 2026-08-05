# Phase 2B: hardened `/fanout-plan`

## Status

The coordinated schema cutover is implemented and passes the repository's keyless checks. The live macOS p-map canary and repository-owner approval remain external release gates; this document does not record either gate as passed.

## One executable generation

| Artifact | Schema | Version |
| --- | --- | ---: |
| Project Execution Profile | `fanout.project-execution-profile` | 1 |
| Active profile pointer | `fanout.active-project-execution-profile` | 1 |
| Planning result | `fanout.implementation-plan` | 3 |
| Grounded details | `fanout.implementation-details` | 6 |
| Execution packet | `fanout.execution-packet` | 8 |
| Active pointer | `fanout.active-packet` | 2 |
| Embedded work contract | `fanout.work-contract` | 3 |
| Planning presentation data | `fanout.planning-report` | 1 |

These versions are a closed generation. Producers emit only these versions and consumers reject legacy, future, mixed-generation, and unknown-field input. There is no migration or compatibility bridge; rerun `/fanout-plan` to replace an obsolete pointer or packet.

## Authority flow

1. The controller resolves the exact active profile identity, planning commit, full Git-visible tree, platform, and plan run identity before Phase A. `/fanout-plan --refresh-profile` gathers and validates a replacement in a disposable clean worktree before atomically publishing it; failure preserves the previous profile.
2. Phase A's model submits only the plan body. The controller supplies schema, version, ID, timestamp, planning host, and planning base. Item boundaries follow independent acceptability and repairability rather than file categories: inseparable production and behavioral-test writes share one item, while split items declare only genuine typed reads and never pad reads for fusion.
3. Phase B's model submits only grounded details. The controller supplies schema, version, ID, timestamp, and the exact digest/length/path identity of the once-read Phase A bytes. Omitted model-body advisory arrays canonicalize to `[]`; persisted details require the field and reject `null`.
4. Details use typed `create`, `modify`, `delete`, and `move` intents; typed repository resources; classified reads; and direct executable/argv task-validation manifests. Phase A is the sole source of global forbidden writes. The profile separately owns preparation, readiness, normalization, and required final gates.
5. `fanout-core` structurally admits both envelopes through canonical TypeBox schemas, applies contextual semantic checks, assigns tiers, derives dependencies, propagates all Phase A bans to ordinary and final Work Contracts, fuses eligible unique vertical serial chains, appends final validation, and produces packet v9 with work-contract v4 nodes bound to the exact profile identity.
6. `fanout-pi` atomically publishes immutable plan, details, packet, and packet-derived Markdown/Mermaid views. It publishes pointer v2 last. A failed plan invalidates the old pointer instead of preserving stale executable authority.

The packet contains exact source and profile identities, planning identity, objective/context, tier plan, and ordered nodes with embedded work contracts. It does not duplicate profile commands, flattened ownership, dependency, or worker-prompt fields.

## Capability boundary

Planning turns expose Pi's read/search/list filesystem tools, `ask_user_question`, and a phase-specific controller-bound artifact submission tool. A successful lone submission is terminating; a submission batched with another tool is rejected before execution, and validation errors leave the phase open for correction. A provider-context adapter retains only the current phase suffix plus controller-built explicit inputs, except that implicit-objective runs also retain their initiating user request. The session file and TUI transcript remain unchanged. Filesystem reads use Pi's ordinary permissions without an additional Fanout repository-containment gate; artifact destinations and envelope fields remain controller-owned, and edit, write, and shell tools remain unavailable.

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

The planning, compiler, contract, and packet smokes prove profile-v1/plan-v3/details-v6/packet-v9/pointer-v2/work-contract-v4 admission, phase-specific schemas, lone terminating submission with mixed-batch rejection, initiating-request context retention, ordinary Pi filesystem access during planning, failed-refresh preservation, exact profile binding, work-contract-v3/packet-v8 Legacy rejection, deterministic fusion/graph/views, Phase A ban propagation, pointer-last publication, packet/profile independence, and package independence.

## Release gates

Offline success is necessary but not sufficient for release. The immutable candidate still requires:

1. an explicitly authorized, non-fabricated macOS p-map live canary with inspected artifacts; and
2. repository-owner approval of that exact candidate.
