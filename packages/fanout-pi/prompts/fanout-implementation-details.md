---
description: Ground a Fanout implementation plan in repo edit details
argument-hint: "<objective>"
---

Ground the validated Phase A implementation plan for this objective:

$ARGUMENTS

Runtime context:

- This is Phase B of `/fanout-plan`.
- Use the adapter-authored **Phase B input** appended below as source of truth.
- Read `implementation-plan.json` from `implementationPlanPath` before writing details.
- Write exactly one ready artifact: `implementation-details.json` at `implementationDetailsPath`.
- Phase B locates **where to edit and the exact edit intent**.
- Treat Phase A behavior/contracts and acceptance criteria as the frozen authoring contract for classifying sibling reads.
- The deterministic compiler, not Phase B, creates dependencies, parallel groups, tier assignments, and `execution-packet.json`.

Hard rules:

- Planning only. Do not edit project files, patch, format, migrate, codegen, or run destructive commands against project files.
- The only writes allowed are Fanout artifacts under the adapter-provided artifact directory.
- The Phase A implementation plan is the source of truth.
- Copy `objective` exactly from `implementation-plan.json`; do not paraphrase or restore the invocation text.
- Do not invent contracts, APIs, product scope, tests, docs, or behavior not traceable to Phase A.
- Do not decide execution dependencies, tiers, worker ownership, or parallelism.
- Do not write packet fields or execution graph fields.
- If Phase A is missing, stale, ambiguous, or has open decisions, stop and ask the user to rerun `/fanout-plan`.

Phase B flow:

1. **Load Phase A**
   - Read `implementation-plan.json`.
   - Confirm schema `fanout.implementation-plan`, version `1`, status `ready`, objective, artifactDir, and non-empty implementation items.

2. **Inspect anchors read-only**
   - Inspect only the files needed to ground Phase A items.
   - For existing files, capture stable anchors: `anchorText`, `symbolName`, `section`, and/or `lineRangeHint`.
   - For new files, capture intended sections and content shape.
   - Prefer one details item per independently editable file/resource.
   - Reuse the same `sourcePlanIds` across multiple details items when one Phase A item touches multiple independent files/resources.
   - Bundle multiple files/resources in one details item only when they must be authored together as one ownership unit.
   - Classify each read dependency as:
     - `baseline-context`: safe to read before any sibling edits, including work authorable from the contract.
     - `post-change-required`: only when this item truly must see another item-owned changed file before this edit is safe.
   - When a Phase A `filesToRead` entry overlaps a planned owned resource, re-declare that read in `readDependencies` as `baseline-context` or `post-change-required`.
   - If execution ordering is truly required, express it only as a concrete `post-change-required` file read.
   - Do not serialize tests, docs, fixtures, or package scripts behind implementation unless they are not authorable from the contract and require a named upstream changed file or decision.
   - Every `post-change-required` reason must name the exact upstream artifact, file, or decision needed.
   - The appended `requiredReadClassifications` rows are a checklist. For each row, add a matching `readDependencies` entry to the relevant details item and choose `baseline-context` or `post-change-required`.

3. **Write implementation details**
   - Write `<artifact-dir>/implementation-details.json` at `implementationDetailsPath`.
   - Use schema `fanout.implementation-details`, version `1`, status `ready`.
   - Every details item must trace to one or more Phase A ids.
   - Every Phase A `filesToChange` entry must be covered by at least one same-id details item writable resource.
   - Every existing-file edit needs at least one anchor field.
   - Keep forbidden changes explicit. Wrap every repository path in backticks, and retain a trailing `/` for directories (for example: "Do not change `src/generated/`.").

Implementation details JSON fields:

- schema: `fanout.implementation-details`
- version: `1`
- status: `ready`
- objective
- artifactDir
- sourcePlanPath
- items: array of:
  - sourcePlanIds: string[]
  - ownedResources: string[]
  - existingFileEdits: array of:
    - file
    - symbolName
    - section
    - anchorText
    - lineRangeHint
    - editIntent
  - newFiles: array of:
    - path
    - intendedSections: string[]
    - contentIntent
  - readDependencies: array of:
    - file
    - classification: `baseline-context` or `post-change-required`
    - reason
  - forbiddenChanges: string[]
  - validationCommands: string[]

Final Phase B response:

- If details cannot be grounded, state the blocking reason and do not write artifacts.
- If grounded, write `implementation-details.json` and return only:
  1. `Implementation details written; validating…`
  2. `Artifacts: <artifact-dir>`
  3. One short bullet list of grounded files/resources.
