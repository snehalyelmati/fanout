---
description: Prepare the solve/plan half of /fanout-plan
argument-hint: "<objective>"
---

Prepare a Fanout implementation plan for this objective:

$ARGUMENTS

Runtime context:

- This is Phase A of `/fanout-plan`.
- Use the adapter-authored **Resolved preflight context** and **Resolved artifact targets** appended below as source of truth.
- Submit exactly one ready `implementation-plan.json` artifact when decision-complete with `fanout_submit_artifact`.
- Phase A decides **what must change and why**.
- Use contract-first planning: freeze shared authoring facts in behavior/contracts and acceptance criteria so sibling work can be authored from the contract where safe.
- Do not locate anchors, assign workers, choose tiers, optimize parallelism, or write execution artifacts.

Hard rules:

- Planning only. Do not edit project files, patch, format, migrate, codegen, or run destructive commands against project files.
- `fanout_submit_artifact` is the only submission capability; the adapter selects the run and destination.
- Do not ask questions that can be answered from files, docs, configs, tests, or git history.
- Ambiguity gate: if the objective is broad or lacks exact outcomes, use `ask_user_question` before writing the implementation plan.
- Broad objectives like `Improve the docs`, `Clean up the code`, `Refactor the provider`, or `Update docs` are not decision-complete unless they name exact files/sections/outcomes.
- If user intent/tradeoffs are still unclear, use `ask_user_question` and ask exactly one question at a time, with a recommended answer.
- If the user declines to decide or cancels, stop without writing/updating artifacts.
- Separate user-provided context from repo-discovered facts.
- Write `objective` as the resolved task objective after reading referenced files and context; it may be more specific than the invocation text.
- Copy the adapter-provided `artifactDir` exactly, without Markdown formatting.
- In `filesToChange` and `filesToRead`, each JSON string value must be a bare repository-relative path. Do not use Markdown backticks, code fences, links, prose, globs, or explanatory text.

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
   - Identify validation intent, acceptance criteria, risks, and forbidden scope. `validation` describes per-item intent and `validationPlan` describes final integrated intent; Phase B supplies literal executable `validationCommands` and top-level `finalValidationCommands`.
   - Identify implementation dependencies as semantic dependencies between plan items.
   - Dependencies are planning constraints and traceability labels, not execution DAG edges.
   - A dependency means the item cannot be authored safely without a specific upstream output, file, or decision.
   - Preserve every explicit task-declared validation dependency. When the task says a test, docs, or check item must consume or follow a named upstream result, retain that item in `dependencies` and add the exact upstream file/resource to `filesToRead` when its changed state is needed.
   - Do not add dependencies for final verification, ordering preference, or because tests, docs, fixtures, or package scripts should match code later. This does not override an explicit task-declared validation dependency.
   - Preserve an explicit task-declared multi-file ownership bundle or node as one implementation item with its complete `filesToChange` set. Do not split it merely because its files could otherwise be authored independently.
   - Prefer separate tests, docs, fixtures, and package-script items when file ownership permits and they are authorable from the contract.
   - Keep the plan implementation-focused; leave exact edit anchors and execution grouping for Phase B/compiler.

4. **Submit the implementation artifact**
   - Call `fanout_submit_artifact` with the complete implementation-plan object in its `artifact` field.
   - Use schema `fanout.implementation-plan`, version `1`, status `ready`.
   - Do not submit any other artifact in this phase.

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
  - validation: string[] of validation intent
  - acceptanceCriteria: string[]
  - risks: string[]
- validationPlan: string[] of final validation intent
- risks: string[]

Final Phase A response:

- If more user input is required, ask the next single question instead of producing a report.
- If decision-complete, submit `implementation-plan.json` and return only:
  1. `Implementation plan written; validating…`
  2. `Artifacts: <artifact-dir>`
  3. One short bullet list of implementation items.
