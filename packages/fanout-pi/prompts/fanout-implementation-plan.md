---
description: Prepare the implementation plan half of /fanout-plan
argument-hint: "<objective>"
---

Prepare a Fanout implementation plan for this objective:

$ARGUMENTS

Runtime context:

- This is Phase A of `/fanout-plan`.
- Use the adapter-authored **Resolved preflight context** and **Resolved artifact targets** appended below as source of truth.
- Write exactly one ready artifact when decision-complete: `implementation-plan.json` at `implementationPlanPath`.
- Do not prepare an execution packet in this phase.
- Do not optimize a DAG, assign tiers, or split for parallel width in this phase.

Hard rules:

- Planning only. Do not edit project files, patch, format, migrate, codegen, or run destructive commands against project files.
- The only writes allowed are Fanout artifacts under the adapter-provided artifact directory.
- Do not ask questions that can be answered from files, docs, configs, tests, or git history.
- Ambiguity gate: if the objective is broad or lacks exact files/sections/outcomes, use `ask_user_question` before writing the implementation plan.
- Broad objectives like `Improve the docs`, `Clean up the code`, `Refactor the provider`, or `Update docs` are not decision-complete unless they name exact files/sections/outcomes.
- If user intent/tradeoffs are still unclear, use `ask_user_question` and ask exactly one question at a time, with a recommended answer.
- If the user declines to decide or cancels, stop without writing/updating artifacts.
- Separate user-provided context from repo-discovered facts.

Phase A flow:

1. **Clarify or stop**
   - Intake objective, constraints, user notes, assumptions, risks, and open questions.
   - Apply the ambiguity gate before drafting implementation items.

2. **Explore read-only**
   - First perform one targeted non-mutating exploration pass unless no repo/environment exists.
   - Batch independent reads, greps, git inspection, and checks in the same turn when possible.
   - Inspect only enough to identify required implementation changes, contracts, validation surface, and risks.

3. **Prepare the implementation plan**
   - Identify what must change and why.
   - Name files/resources likely to change and files/resources needed only as context.
   - Identify public APIs, schemas, commands, tests, docs, fixtures, errors, and validation commands affected by the work.
   - Identify implementation dependencies as semantic dependencies, not execution-worker edges.
   - Keep the plan implementation-focused; do not optimize parallel execution here.

4. **Write the implementation artifact**
   - Write `<artifact-dir>/implementation-plan.json` at `implementationPlanPath`.
   - Use schema `fanout.implementation-plan`, version `1`, status `ready`.
   - Do not write `execution-packet.json` in this phase.

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
  1. `Implementation plan ready ✅`
  2. `Artifacts: <artifact-dir>`
  3. One short bullet list of implementation items.
