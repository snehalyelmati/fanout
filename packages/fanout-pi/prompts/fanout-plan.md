---
description: Prepare a decision-complete Fanout execution packet
argument-hint: "<objective>"
---

Prepare a Fanout execution packet for this objective:

$ARGUMENTS

Runtime context:

- `/fanout-plan` is command-backed. Use the adapter-authored **Resolved preflight context** appended below as source of truth.
- Do not re-resolve deterministic runtime facts already in preflight: artifact paths, project id, tier/model/thinking choices, tier2 availability, node tier policy, or packet helper commands.
- `packetHelper` commands run `scripts/fanout-packet-artifacts.mjs` with the resolved artifact root.
- If you need an artifact directory, run `packetHelper.printRunDir` from preflight.
- If you need the active pointer path, use `activePointerPath` from preflight or run `packetHelper.printActivePath`.

Hard rules:

- Planning only. Do not edit project files, patch, format, migrate, codegen, or run destructive commands against project files.
- The only writes allowed are Fanout artifacts under the adapter-provided artifact directory.
- Do not ask questions that can be answered from files, docs, configs, tests, or git history.
- Ambiguity gate: if the objective is broad or lacks exact files/sections/outcomes, use `ask_user_question` before drafting work units or writing artifacts.
- Broad objectives like `Improve the docs`, `Clean up the code`, `Refactor the provider`, or `Update docs` are not decision-complete unless they name exact files/sections/outcomes.
- Example: `Improve the docs` must ask which docs area/outcome first; `Add one sentence to README explaining ready-only packets` may proceed after repo exploration.
- If user intent/tradeoffs are still unclear, use `ask_user_question` and ask exactly one question at a time, with a recommended answer.
- Do not emit or finalize a packet until the plan is decision-complete. If the user declines to decide or cancels, stop without writing/updating an active packet.
- Separate user-provided context from repo-discovered facts.
- Do not add custom packet fields; edge proofs are planning rationale, not schema fields.

Planning flow:

1. **Clarify or stop**
   - Intake objective, constraints, user notes, assumptions, risks, and open questions.
   - Apply the ambiguity gate before drafting work units.

2. **Explore read-only**
   - First perform one targeted non-mutating exploration pass unless no repo/environment exists.
   - Batch independent reads, greps, git inspection, and checks in the same turn when possible.
   - Inspect only enough to freeze the shared contract and validation surface.

3. **Freeze the contract node**
   - Start the DAG with one short read-only inspection/contract node.
   - It freezes only shared facts needed by independent workers: public APIs/command names, file/resource ownership, schemas/fields, expected errors or decisions, fixture/test/doc targets, and validation artifacts.

4. **Fan out from the contract**
   - Draft fanout-agnostic work units with kind, owned files/resources, read-only files, dependencies, validation commands, rollback notes, and acceptance criteria.
   - Before listing parallel groups, prove that no two nodes in the same group own the same writable file/resource. If they do, merge them or serialize only the shared-file portion.
   - Put every work unit that can be authored from the contract in the first parallel group.
   - Keep each work unit to one independently authorable change, not just one file set. If a node has multiple sequential steps that could be assigned to separate workers from the frozen contract, split it.
   - Split helper modules, command wiring, UI/report rendering, metrics/observability, worker-launch stubs, smoke tests, and docs when they can be authored from the contract.
   - Do not split tightly coupled same-file edits or tests that need finalized behavior not captured by the contract.
   - Tests, fixtures, prompts, package scripts, and docs should start from the frozen contract when possible.

5. **Add only proven edges**
   - Add a dependency edge only when the downstream node cannot be authored safely without a specific upstream artifact, file, or decision; name that proof internally.
   - Reject convenience edges and redundant transitive edges.
   - Do not create broad reconciliation sink nodes that serialize all work. Final execution may include a narrow integration-fix node after validation/review, but it must have explicit owned files, acceptance criteria, and validation commands.

6. **Add final validation/review**
   - Every ready packet must end with one final validation/review node.
   - Add extra synthesis nodes only when the task truly needs synthesis beyond validation/review.
   - State the critical path using fan-in notation, e.g. `contract -> max(P1..Pn) -> final-validation`.

7. **Resolve tiers**
   - Use the preflight `resolvedTierPlan` exactly for packet `tierPlan`.
   - Assign per-node tier using preflight `nodeKindTierPolicy`; if tier2 is unavailable, assign tier2 candidates to tier1 fallback.

8. **Validate the DAG**
   - Validate cycles, missing dependencies, ownership conflicts, missing validation, unclear acceptance criteria, unresolved required decisions, unsafe commands, stale assumptions, impossible parallelism, tier-policy violations, and budget/deadline violations.
   - Optimize by removing false edges and splitting independent work, not by adding broad reconciliation nodes.
   - Fix validator-fixable packet mistakes internally.

9. **Write artifacts**
   - Choose a run id such as `YYYYMMDD-HHMMSS-short-objective`.
   - Resolve artifact paths with `packetHelper.printRunDir` and `packetHelper.printActivePath`.
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
