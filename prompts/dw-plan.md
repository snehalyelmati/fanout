---
description: Plan a Pi/Doubleword task before implementation
argument-hint: "<task>"
---

Plan this task before implementation:

$ARGUMENTS

Rules:

- Planning only. Do not edit, write, patch, format, migrate, codegen, or run mutating commands.
- First perform one targeted non-mutating exploration pass unless no repo/environment exists.
- Batch independent reads, greps, git inspection, and checks in the same turn when possible.
- Do not ask questions that can be answered from files, docs, configs, tests, or git history.
- Clarify until the ask is clear and there are no material doubts before execution.
- Ask as many questions as needed when ambiguity affects goal, scope, design, validation, or tradeoffs.
- Use 2–4 concrete options when helpful, with a recommended option.
- Separate discoverable facts from user intent/preferences:
  - Discoverable facts: inspect first.
  - User intent/preferences: ask until clear.
- Final output should contain a `<proposed_plan>` block when decision-complete.
- If not decision-complete, ask the next needed questions instead.

The final plan should include:

- Title
- Summary
- Key implementation changes
- Test/validation plan
- Assumptions/defaults
