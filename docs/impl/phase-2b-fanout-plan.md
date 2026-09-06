# Phase 2B: hardened `/fanout-plan`

## Status

The audit cutover is implemented; actual checks and independent review are recorded in the [audit register](fanout-audit-progress.md). The live macOS p-map canary and repository-owner approval remain external release gates; this document does not record either gate as passed.

## One executable generation

| Artifact | Schema | Version |
| --- | --- | ---: |
| Project Execution Profile | `fanout.project-execution-profile` | 1 |
| Active profile pointer | `fanout.active-project-execution-profile` | 1 |
| Planning result | `fanout.implementation-plan` | 4 |
| Grounded details | `fanout.implementation-details` | 7 |
| Execution packet | `fanout.execution-packet` | 10 |
| Active pointer | `fanout.active-packet` | 2 |
| Embedded work contract | `fanout.work-contract` | 5 |
| Planning presentation data | `fanout.planning-report` | 1 |

These versions are a closed generation. Producers emit only these versions and consumers reject legacy, future, mixed-generation, and unknown-field input. There is no migration or compatibility bridge; rerun `/fanout-plan` to replace an obsolete pointer or packet.

## Authority flow

1. The controller rejects a dirty planning checkout before paid planning and resolves the exact active profile identity, planning commit, full Git-visible tree, platform, and plan run identity before Phase A. `/fanout-plan --refresh-profile` gathers and validates a replacement in a disposable clean worktree before atomically publishing it; failure preserves the previous profile.
2. One implementation model context submits `{plan, details}` after one investigation. The controller supplies each persisted envelope's schema, version, ID, timestamp, planning host, and planning base. Item boundaries follow independent acceptability and repairability rather than file categories: inseparable production and behavioral-test writes share one item, while split items declare only genuine typed reads and never pad reads for fusion.
3. Grounded details compile against the plan bytes from the same submission before either artifact is published. Correctable errors stay in the current context. The controller supplies the exact digest/length/path identity of those plan bytes. Phase A/B remain logical provenance labels, not separate model investigations. Omitted model-body advisory arrays canonicalize to `[]`; persisted details require the field and reject `null`.
4. Details use typed `create`, `modify`, `delete`, and `move` intents; typed repository resources; classified reads; and direct executable/argv task-validation manifests. Phase A is the sole source of global forbidden writes. The profile separately owns preparation, readiness, normalization, and required final gates.
5. `fanout-core` structurally admits both envelopes through canonical TypeBox schemas, applies contextual semantic checks, assigns tiers, derives dependencies, propagates all Phase A bans to ordinary and final Work Contracts, fuses eligible unique vertical serial chains, appends final validation, and produces packet v10 with work-contract v5 nodes bound to the exact profile identity.
6. `fanout-pi` atomically publishes immutable plan, details, packet, and packet-derived Markdown/Mermaid views. It publishes pointer v2 last. A failed plan invalidates the old pointer instead of preserving stale executable authority.

The packet contains exact source and profile identities, planning identity, objective/context, tier plan, and ordered nodes with embedded work contracts. It does not duplicate profile commands, flattened ownership, dependency, or worker-prompt fields.

## Capability boundary

Planning turns expose Pi's read/search/list filesystem tools, `ask_user_question`, and a phase-specific controller-bound artifact submission tool. A successful lone submission is terminating; a submission batched with another tool is rejected before execution, and validation errors leave the phase open for correction. A provider-context adapter retains the current phase suffix plus controller-built inputs. Implicit objectives also retain the compaction-aware user/assistant conversation, excluding tool results, tool-call blocks, and report/custom entries. Phases advance at `agent_settled`; retries, compaction and queued continuations retain phase restrictions until settlement. The session file and TUI transcript remain unchanged. Filesystem reads use Pi's ordinary permissions without an additional Fanout repository-containment gate; artifact destinations and envelope fields remain controller-owned, and edit, write, and shell tools remain unavailable.

## Package boundaries

- `fanout-core` owns schemas, validation, compilation, graph derivation, and deterministic views. It imports neither Pi nor Doubleword.
- `fanout-pi` owns Pi commands, capability profiles, artifact publication, and runtime wiring.
- `doubleword-provider` remains independently testable and has no Fanout dependency.

## Offline validation

From the repository root:

```bash
npm run typecheck
npm run check
rtk npm run test:doubleword-provider
rtk git diff --check
```

The planning, compiler, contract, and packet smokes prove profile-v1/plan-v4/details-v7/packet-v10/pointer-v2/work-contract-v5 admission, combined plan/details and separate profile schemas, lone terminating submission with mixed-batch rejection, compaction-aware conversational context retention, ordinary Pi filesystem access during planning, failed-refresh preservation, exact profile binding, work-contract-v3/packet-v8 Legacy rejection, deterministic fusion/graph/views, Phase A ban propagation, pointer-last publication, packet/profile independence, and package independence.

## Release gates

Offline success is necessary but not sufficient for release. The immutable candidate still requires:

1. an explicitly authorized, non-fabricated macOS p-map live canary with inspected artifacts; and
2. repository-owner approval of that exact candidate.
