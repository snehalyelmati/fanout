---
description: Prepare the solve/plan half of /fanout-plan
argument-hint: "<objective>"
---

Prepare a Fanout implementation plan for this objective:

$ARGUMENTS

Runtime context:

- This is Phase A of `/fanout-plan`.
- Use the adapter-authored **Resolved preflight context** and **Resolved artifact targets** appended below as source of truth.
- Write exactly one ready artifact when decision-complete: `implementation-plan.json` at `implementationPlanPath`.
- Phase A decides **what must change and why**.
- Use contract-first planning: freeze shared authoring facts in behavior/contracts and acceptance criteria so sibling work can be authored from the contract where safe.
- Do not locate anchors, assign workers, choose tiers, optimize parallelism, or write execution artifacts.

Hard rules:

- Planning only. Do not edit project files, patch, format, migrate, codegen, or run destructive commands against project files.
- The only writes allowed are Fanout artifacts under the adapter-provided artifact directory.
- Do not ask questions that can be answered from files, docs, configs, tests, or git history.
- Ambiguity gate: if the objective is broad or lacks exact outcomes, use `ask_user_question` before writing the implementation plan.
- Broad objectives like `Improve the docs`, `Clean up the code`, `Refactor the provider`, or `Update docs` are not decision-complete unless they name exact files/sections/outcomes.
- If user intent/tradeoffs are still unclear, use `ask_user_question` and ask exactly one question at a time, with a recommended answer.
- If the user declines to decide or cancels, stop without writing/updating artifacts.
- Separate user-provided context from repo-discovered facts.
- Write `objective` as the resolved task objective after reading referenced files and context; it may be more specific than the invocation text.

Phase A flow:

1. **Clarify or stop**
   - Intake objective, constraints, user notes, assumptions, risks, and open questions.
   - Apply the ambiguity gate before drafting implementation items.

2. **Explore read-only**
   - First perform one targeted non-mutating exploration pass unless no repo/environment exists.
   - Batch independent reads, greps, git inspection, and checks in the same turn when possible.
   - Inspect only enough to identify behavior/contracts, likely modules, APIs/exports, validation surface, and risks.

3. **Prepare the implementation plan**
   - Identify the problem understanding, approach, required behavior/contracts, and public APIs/exports.
   - Name files/modules likely to change and files/resources needed only as context.
   - Identify validation intent, acceptance criteria, risks, and forbidden scope.
   - Identify implementation dependencies as semantic dependencies between plan items.
   - Dependencies are planning constraints and traceability labels, not execution DAG edges.
   - A dependency means the item cannot be authored safely without a specific upstream output, file, or decision.
   - Do not add dependencies for final verification, ordering preference, or because tests, docs, fixtures, or package scripts should match code later.
   - Prefer separate tests, docs, fixtures, and package-script items when file ownership permits and they are authorable from the contract.
   - Keep the plan implementation-focused; leave exact edit anchors and execution grouping for Phase B/compiler.

4. **Write the implementation artifact**
   - Write `<artifact-dir>/implementation-plan.json` at `implementationPlanPath`.
   - Use schema `fanout.implementation-plan`, version `1`, status `ready`.
   - Do not write any other artifact in this phase.

Implementation plan JSON fields:

- schema: `fanout.implementation-plan`
- version: `1`
- status: `ready`
- objective
- createdAt
- artifactDir
- userContext: string[]
- discoveredRepoFacts: string[]
- assumptions: string[]
- implementationItems: array of:
  - id
  - goal
  - rationale
  - filesToChange: string[]
  - filesToRead: string[]
  - dependencies: string[] of other implementation item ids
  - validation: string[]
  - acceptanceCriteria: string[]
  - risks: string[]
- validationPlan: string[]
- risks: string[]

Final Phase A response:

- If more user input is required, ask the next single question instead of producing a report.
- If decision-complete, write `implementation-plan.json` and return only:
  1. `Implementation plan written; validating…`
  2. `Artifacts: <artifact-dir>`
  3. One short bullet list of implementation items.
