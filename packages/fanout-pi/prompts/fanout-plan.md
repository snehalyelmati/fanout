---
description: Prepare a decision-complete Fanout execution packet
argument-hint: "<objective>"
---

Prepare a Fanout execution packet for this objective:

$ARGUMENTS

Runtime context:

- `/fanout-plan` is command-backed. Use the adapter-authored **Resolved preflight context** appended below as source of truth.
- Do not re-resolve deterministic runtime facts that are already in preflight: artifact paths, project id, tier/model/thinking choices, tier2 availability, node tier policy, or packet helper commands.
- `packetHelper` commands run `scripts/fanout-packet-artifacts.mjs` with the resolved artifact root.
- If you need an artifact directory, run `packetHelper.printRunDir` from preflight.
- If you need the active pointer path, use `activePointerPath` from preflight or run `packetHelper.printActivePath`.

Hard rules:

- Planning only. Do not edit project files, patch, format, migrate, codegen, or run destructive commands against project files.
- The only writes allowed are Fanout artifacts under the adapter-provided artifact directory.
- First perform one targeted non-mutating exploration pass unless no repo/environment exists.
- Batch independent reads, greps, git inspection, and checks in the same turn when possible.
- Do not ask questions that can be answered from files, docs, configs, tests, or git history.
- If user intent/tradeoffs are still unclear, use `ask_user_question` and ask exactly one question at a time.
- Every question must include a recommended answer.
- Do not emit or finalize a packet until the plan is decision-complete.
- If the user declines to decide or cancels, stop without writing/updating an active packet.
- Separate user-provided context from repo-discovered facts.
- Validate the DAG during planning before marking a packet executable.

Plan phase:

1. Intake objective, constraints, user notes, assumptions, risks, and open questions.
2. Explore repo context read-only.
3. Ask one recommended question at a time for unresolved non-discoverable intent/tradeoffs.
4. Draft fanout-agnostic work units with kind, owned files/resources, read-only files, dependencies, validation commands, rollback notes, and acceptance criteria.
5. Build the execution DAG from work units, adding validation/review/synthesis nodes only when needed.
6. Use the preflight `resolvedTierPlan` exactly for packet `tierPlan`.
7. Assign per-node tier using preflight `nodeKindTierPolicy`; if tier2 is unavailable, assign tier2 candidates to tier1 fallback.
8. Validate the DAG for cycles, missing dependencies, ownership conflicts, missing validation, unclear acceptance criteria, unresolved required decisions, unsafe commands, stale assumptions, impossible parallelism, tier-policy violations, and budget/deadline violations.
9. Optimize parallel groups, critical path, active/background work, cost, time, risks, and stop rules.
10. Write artifacts and run the packet validator.

Artifact contract:

1. Choose a run id such as `YYYYMMDD-HHMMSS-short-objective`.
2. Resolve artifact paths with the helper commands from preflight:
   - `packetHelper.printRunDir`
   - `packetHelper.printActivePath`
3. Write `<artifact-dir>/execution-packet.json` using schema `fanout.execution-packet`, version `2`.
4. Run the validator/artifact writer using `packetHelper.validatePacket`, replacing `<artifact-dir>`.
5. The script writes `execution-plan.md`, `execution-dag.mmd`, and updates the active pointer only for executable ready packets.
6. If validation fails, fix the packet and rerun the validator. Do not ask the user about validator-fixable packet mistakes.

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
