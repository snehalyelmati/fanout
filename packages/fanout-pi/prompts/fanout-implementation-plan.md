---
description: Prepare and ground a Fanout execution plan in one context
argument-hint: "<objective>"
---

Inspect the repository and submit exactly one combined plan and grounded details body for: $ARGUMENTS

Use only `read`, `grep`, `find`, and `ls`; use `ask_user_question` only when intent cannot be discovered. Do not mutate the repository. Reuse supplied user findings and evidence already read in this context. Investigate once: decide the work, ground its changes, and submit both halves together. Do not implement the feature or write a speculative solution in the plan.

Call `fanout_submit_artifact` alone with the following body. Its schema is the structural authority. The controller creates artifact paths, IDs, timestamps, platform, repository identities, source hashes, routing, and the execution DAG; do not generate these fields or read unpublished output artifacts.

```json
{
  "plan": {
    "objective": "resolved objective",
    "userContext": [],
    "discoveredRepoFacts": [],
    "assumptions": [],
    "implementationItems": [{
      "id": "stable-source-id",
      "goals": ["semantic goal"],
      "writeResources": [{"kind":"file","path":"src/example.ts"}],
      "readResources": [{"kind":"file","path":"package.json"}],
      "forbiddenWrites": [{"resource":{"kind":"directory","path":"generated"},"reason":"not authoritative"}],
      "semanticReviewCriteria": ["observable acceptance criterion"],
      "advisoryNotes": []
    }]
  },
  "details": {
    "items": [{
      "id": "grounded-id",
      "kind": "implement",
      "changes": [{
        "kind": "modify",
        "target": {"resource":{"kind":"file","path":"src/example.ts"},"sourcePlanIds":["stable-source-id"]},
        "intent": "specific change required by the goal",
        "anchors": [{"kind":"symbol","symbol":"example"}]
      }],
      "readDependencies": [{
        "resource": {"kind":"file","path":"package.json"},
        "timing": "baseline-context",
        "timingSource": "phase-b",
        "sourcePlanIds": ["stable-source-id"],
        "reason": "needed baseline configuration"
      }],
      "validationCommands": [{"executable":"node","args":["--test","test/example.test.js"]}],
      "advisoryNotes": []
    }],
    "finalValidationCommands": []
  }
}
```

The plan and details are logical semantic and grounding halves (historical provenance labels `phase-a` and `phase-b`); they are submitted and validated together. Correct any submission/compiler feedback in this same context. Successful submission ends planning; no follow-up response is needed.

Choose substantial independently authorable and repairable work units. Account for repeated context, setup, validation, and sequential model requests. Given the frozen behavior, interfaces and planning baseline, can a worker complete and validate its item without another worker's implementation? Keep useful independent work parallel. Group tiny related changes when setup and repeated context outweigh their useful work. Do not split by file category, file count, or individual coding step.

Keep production behavior together with behavioral tests when failures can require repairing that production behavior. A dependency edge is not a substitute for shared repair authority. Do not merge items merely because they contribute to the same feature or would not be a standalone release. Keep interfaces/behavior explicit without prescribing every edit.

Use canonical repository-relative literal file/directory paths. Plan `writeResources` bound the maximum change authority; ground every planned write with same-source typed changes. Every `sourcePlanIds` array cites non-empty unique plan IDs. Put packet-global bans only in plan `forbiddenWrites`, never overlapping any planned write. Details must not repeat bans. Use `advisoryNotes: []` when no necessary rationale, risk, validation-intent, constraint, or context applies; do not duplicate goals or repository facts. Details notes may be omitted and persist as `[]`; `null` is invalid.

Plan `readResources` list known context and bound post-change read authority. Details can add canonical repository-local baseline reads with source attribution. Include only useful sources: these paths also prepare worker context. For every reader/owner relationship, classify the actual read. Use `baseline-context` whenever the agreed behavior and baseline suffice; it creates no execution dependency. Use `post-change-required` only when a specific accepted upstream change is necessary, and explain why the baseline is insufficient. Cover each owner separately for broad reads. Do not invent precautionary, redundant, transitive or self dependencies. Keep baseline-authorable items concurrently ready.

Ground modifications with `anchors` containing a `symbol`, `section`, or `stable-text`; line hints alone are insufficient. Nested endpoints use `{resource, sourcePlanIds}`. Keep runtime and its coupled tests within the same plan item's ownership. The compiler creates final validation; never submit a `final-validation` item.

The exact approved Project Execution Profile below already supplies preparation, readiness, candidate normalization and required final gates. Do not repeat its commands. Ordinary items need non-empty, meaningful checks scoped to their owned changes, including behavioral/type tests they add and applicable scoped lint. Do not put repository-wide runtime lint on a docs-only node: its failures cannot be repaired there. Use repository-supported focused checks for documentation (for example scoped content/links or whitespace checks), rather than a check that only examines unrelated source. If useful validation is repair-coupled, group that work instead of creating an unrepairable unit. Broader checks are appropriate for genuinely shared infrastructure or configuration ownership.

`finalValidationCommands` contains only additional integrated task checks; use `[]` when profile final gates suffice. Complete project-wide acceptance remains controller-owned. An exact profile-gate duplicate is correctable submission feedback.

Commands are direct argv: executable, ordered args, optional repository-relative cwd and literal env. No shell glob, brace, variable, or command-substitution expansion occurs. Repeat flags and paths explicitly. Prefer repository-proven scripts or command forms. When focused syntax is unknown, inspect the repository's supported invocation rather than inventing shell syntax or assigning an unrelated broad check. Preserve argument order, duplicates and literal values.
