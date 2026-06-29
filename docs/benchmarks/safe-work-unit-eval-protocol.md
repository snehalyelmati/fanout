# Safe work unit evaluation protocol

Purpose: define the prediction and scoring contract used by the offline Planned Parallel RPE safe-work-unit evaluator.

Evidence scope: retrospective trace-derived planner reliability. This protocol does not prove live runtime TAT, production safety, or executable correctness.

## Definition

A **safe work unit** is a proposed background RPE task that can be executed without corrupting the active worktree or blocking the next required user-facing response, because its file/resource surface, dependencies, validation, review, and cancellation rules are explicit.

Verdicts:

| Verdict | Meaning |
| --- | --- |
| `safe_independent` | The unit has prefix-visible file/resource surface, no detected conflicts, validation, review, and no dependency on another proposed unit. |
| `safe_after_dependency` | The unit may be safe only after one or more declared dependency units complete, or because overlapping ownership is explicitly serialized. |
| `unsafe` | The unit has hidden suffix dependencies, missing validation/review, active-boundary contradictions, stale speculative risk, unserialized ownership overlap, dangling dependencies, dependency cycles, or depends on unsafe work. |
| `inconclusive` | The unit does not declare enough file/resource surface to score. |

## Prediction input

Production protocol: the harness or tier1 planner supplies `prefixBoundary` first, then the predictor receives only:

- the evaluator/schema contract;
- the selected trace prefix through that supplied `prefixBoundary`;
- any files or text already visible in that prefix.

The predictor must not choose the boundary after reading the suffix and must not use suffix evidence when proposing or labeling units. The offline evaluator uses the suffix only after prediction to score hidden dependencies and conflicts.

The current 15-trace TAT bucket artifact is weaker retrospective evidence: boundaries were selected during analysis of existing full traces, then predictions were scored against suffixes. Treat it as useful for evaluator/scheduler shaping, not as proof that a live planner can pick equally good boundaries from prefix-only context.

## Prediction row schema

Each JSONL row is one prediction object:

```json
{
  "schema": "doubleword.safe-work-unit-prediction",
  "version": 1,
  "predictionId": "trace-id:boundary-or-name",
  "traceId": "trace-session-id",
  "prefixBoundary": { "line": 123, "messageId": "optional-non-empty-message-id" },
  "proposedUnits": []
}
```

Each unit requires:

```json
{
  "unitId": "stable-id",
  "title": "human-readable task",
  "ownedFiles": ["files this unit may edit"],
  "readOnlyFiles": ["files this unit relies on but must not edit"],
  "mutableResources": ["non-file shared resources"],
  "dependencies": ["unit ids that must complete first"],
  "validationRequirements": ["commands/checks/evidence required"],
  "reviewRequirements": ["tier1 review/synthesis requirements"],
  "cancellationRules": ["when output is stale or must stop"],
  "activeBoundaryClaim": {
    "status": "active or background",
    "requiredForNextActionableResponse": false,
    "boundary": "why this is or is not user-blocking"
  },
  "speculative": false,
  "label": { "expectedVerdict": "safe_independent" }
}
```

`speculative` is optional and defaults to `false` when omitted. `label.expectedVerdict` is optional. When present, metrics compare the evaluator verdict to the predictor label. Predictor-provided labels are weaker than independent human labels and should not be treated as ground truth.

## Code-edit-only mode

For code-shard RPE experiments, every proposed unit must own at least one source, config, generated, workflow, or test file. Do not propose docs-only notes or summaries in code-edit-only mode.

Docs/research mode may propose documentation, review, or summary units, but those are not evidence that implementation can be sharded.

## Prompt template used for the 15-trace TAT bucket experiment

```text
Prediction-only; do not edit files.
Generate exactly one JSONL prediction row for the safe-work-unit evaluator.
Read scripts/eval-safe-work-units.mjs and trace <trace-path>.
Return no prose or markdown fence: one JSON object line.
Use schema doubleword.safe-work-unit-prediction version 1.
Use the supplied prefixBoundary from the harness/planner.
Propose 2-5 CODE EDIT shards only: each owns source/config/test files, not docs/notes/summaries.
Include ownedFiles, readOnlyFiles, mutableResources, dependencies, validationRequirements,
reviewRequirements, cancellationRules, activeBoundaryClaim, and label.expectedVerdict.
Label safe only if prefix evidence supports independent execution without hidden suffix dependencies.
```

## Evaluator scoring rules

The evaluator:

- validates schema fields and optional `prefixBoundary.messageId`;
- splits each trace into prefix and suffix by JSONL line;
- extracts path-like strings and command-like strings from prefix/suffix text;
- marks hidden read-only inputs unsafe when they appear only in suffix evidence;
- requires validation and tier1 review for units that own files;
- marks background work unsafe if it is also required for the next actionable response;
- requires cancellation rules for speculative work;
- marks unknown file/resource surface inconclusive;
- rejects dangling dependencies and dependency cycles;
- rejects overlapping owned files or mutable resources unless serialized by dependencies;
- reports accepted DAG depth and width for schedulability.

## Runtime scheduler implications

A runtime scheduler should launch tier2 work only after the evaluator/planner equivalent produces:

```text
accepted_code_units > 0
DAG is acyclic
no ownership or mutable-resource conflicts without serialization
validation contract present
review contract present
tier2_exec_wait_worst_case = accepted_DAG_depth * 10m <= user_wait_budget
```

Tier2 output remains untrusted until tier1 review/synthesis accepts it.

## Limitations

- Path extraction is heuristic and string-based.
- The evaluator cannot prove semantic independence.
- Labels in current artifacts are predictor-provided.
- The 15-trace artifact used retrospective/full-trace boundary selection, so it is weaker than a live prefix-only planner evaluation.
- Full `pi-mono` traces are external and ignored locally under `datasets/traces/`.
- Live Doubleword tier2 TAT is not measured by this protocol.
