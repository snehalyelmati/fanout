---
description: Convert a Fanout implementation plan into an execution packet
argument-hint: "<objective>"
---

Convert the validated ready Phase A implementation plan into a Fanout execution packet for this objective:

$ARGUMENTS

Runtime context:

- This is Phase B of `/fanout-plan`.
- Use the adapter-authored **Resolved preflight context** and **Resolved artifact targets** appended below as source of truth.
- Read `implementation-plan.json` from `implementationPlanPath` before drafting work units.
- Do not re-resolve deterministic runtime facts already in preflight: artifact paths, project id, tier/model/thinking choices, tier2 availability, node tier policy, or packet helper commands.
- `packetHelper` commands run `scripts/fanout-packet-artifacts.mjs` with the resolved artifact root.
- If you need the active pointer path, use `activePointerPath` from preflight or run `packetHelper.printActivePath`.

Hard rules:

- Planning only. Do not edit project files, patch, format, migrate, codegen, or run destructive commands against project files.
- The only writes allowed are Fanout artifacts under the adapter-provided artifact directory.
- The Phase A implementation plan is the implementation source of truth.
- Do not invent implementation scope, files, goals, tests, docs, or behavior that is not traceable to a Phase A implementation item or discovered repo fact in the plan.
- If the implementation plan is missing, stale, ambiguous, or has open decisions, stop and ask the user to rerun `/fanout-plan` instead of writing a packet.
- Every work unit must trace back to one or more Phase A implementation item ids in its steps or acceptance criteria.
- Use this exact traceability convention in each work unit's steps or acceptance criteria: `Traces to Phase A items: <ids>`.
- Do not add custom packet fields; traceability can live in steps/acceptance criteria.

Phase B flow:

1. **Load Phase A**
   - Read `implementation-plan.json`.
   - Confirm schema `fanout.implementation-plan`, version `1`, status `ready`, objective, and non-empty implementation items.

2. **Freeze the contract node**
   - Start the DAG with one short read-only inspection/contract node.
   - It freezes only shared facts already named or implied by Phase A: public APIs/command names, file/resource ownership, schemas/fields, expected errors or decisions, fixture/test/doc targets, and validation artifacts.

3. **Fan out from the contract**
   - Draft fanout-agnostic work units with kind, owned files/resources, read-only files, dependencies, validation commands, rollback notes, and acceptance criteria.
   - Before listing parallel groups, prove that no two nodes in the same group own the same writable file/resource.
   - If a node reads a file/resource owned by a sibling, add a dependency edge or remove that read.
   - Put every work unit that can be authored from the contract in the first parallel group.
   - Keep each work unit to one independently authorable implementation change, not just one file set.
   - Consider splitting helper modules, command wiring, UI/report rendering, metrics/observability, worker-launch stubs, smoke tests, and docs when they can be authored from the contract.
   - Do not split tightly coupled same-file edits or tests that need finalized behavior not captured by the contract.
   - After drafting parallel groups, run a split pass: any node with multiple owned files/resources or more than three sequential steps should be split unless it names an atomicity reason.
   - If splitting would create same-file ownership conflict or read/write sibling overlap, keep it together and say why in rollback notes or acceptance criteria.

4. **Add only proven edges**
   - Add a dependency edge only when the downstream node cannot be authored safely without a specific upstream artifact, file, or decision.
   - Reject convenience edges and redundant transitive edges.
   - Do not create broad reconciliation sink nodes that serialize all work. Final execution may include a narrow integration-fix node after validation/review, but it must have explicit owned files, acceptance criteria, and validation commands.

5. **Add final validation/review**
   - Every ready packet must end with one final validation/review node.
   - Add extra synthesis nodes only when the task truly needs synthesis beyond validation/review.
   - State the critical path using fan-in notation, e.g. `contract -> max(P1..Pn) -> final-validation`.

6. **Resolve tiers**
   - Use the preflight `resolvedTierPlan` exactly for packet `tierPlan`.
   - Assign per-node tier using preflight `nodeKindTierPolicy`; if tier2 is unavailable, assign tier2 candidates to tier1 fallback.

7. **Validate the DAG**
   - Validate cycles, missing dependencies, ownership conflicts, read/write sibling overlap, missing validation, unclear acceptance criteria, unresolved required decisions, unsafe commands, stale assumptions, impossible parallelism, tier-policy violations, and budget/deadline violations.
   - Optimize by removing false edges and splitting independent work, not by adding broad reconciliation nodes.
   - Fix validator-fixable packet mistakes internally.

8. **Write artifacts**
   - Write `<artifact-dir>/execution-packet.json` using schema `fanout.execution-packet`, version `2`.
   - Run the validator/artifact writer using `packetHelper.validatePacket`, replacing `<artifact-dir>`.
   - The script writes `execution-plan.md`, `execution-dag.mmd`, and updates the active pointer only for executable ready packets.

Packet JSON fields:

- schema: `fanout.execution-packet`
- version: `2`
- status: `ready`
- objective
- createdAt
- artifactDir
- tierPlan: tier1/tier2 provider, model, thinking, source, status, reason, fallback when applicable
- userContext
- discoveredRepoFacts
- assumptions
- blockers: `[]`; ask/stop instead of writing artifacts
- workUnits: id, kind, goal, dependencies, ownedFiles, readOnlyFiles, steps, validationCommands, acceptanceCriteria, rollbackNotes, tier, active
- estimates: activeWait, backgroundCompletion, cost, criticalPath, parallelGroups
- stopRules
- risks
- finalValidationPlan

Final report format:

- If more user input is required, ask the next single question instead of producing a report.
- If decision-complete, write artifacts and then return these sections only:
  1. `Fanout plan ready ✅` plus one `Artifacts: <artifact-dir>` line.
  2. `Tier/model plan` with tier1/tier2 model, thinking, status, reason, and fallback.
  3. `Execution flow` with boxed ASCII DAG nodes. Each node must include id/title, concise goal, tier/model shorthand, and owned files.
  4. `Files` with planned writes and read-only context.
  5. `Metrics` as two columns.
  6. `Next` explaining that the user should review the plan now; `/fanout-execute` will consume the active packet when Phase 3 is available.

Boxed node style:

```text
+-------------------------------+
| [2] Update validator          |
| goal : add DAG/safety checks  |
| tier : tier2 async            |
| owns : fanout-core/...        |
+-------------------------------+
```

Two-column metrics style:

```text
Work units            5        DAG depth              4
Max parallel width    2        Planned write files    3
Tier1 nodes           2        Tier2 nodes            3
Active wait           ~5-10m   Status                 ready
```
