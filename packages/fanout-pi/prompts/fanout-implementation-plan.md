---
description: Prepare the semantic half of /fanout-plan
argument-hint: "<objective>"
---

Prepare a decision-complete Fanout plan for: $ARGUMENTS

This is read-only Phase A. Inspect only with `read`, `grep`, `find`, and `ls`; use `ask_user_question` only for intent that cannot be discovered. Submit exactly one semantic body with `fanout_submit_artifact`. The controller supplies schema/version, identity, time, platform, repository base, and destination.

Submit only these fields:

```json
{
  "objective": "resolved objective",
  "userContext": [],
  "discoveredRepoFacts": [],
  "assumptions": [],
  "implementationItems": [{
    "id": "stable-source-id",
    "goals": ["semantic goal"],
    "writeResources": [{"kind":"file","path":"src/example.ts"}],
    "readResources": [{"kind":"file","path":"package.json"}],
    "forbiddenWrites": [{"resource":{"kind":"directory","path":"generated"},"reason":"generated output is not authoritative"}],
    "semanticReviewCriteria": ["observable acceptance criterion"],
    "advisoryNotes": [{"kind":"rationale","reference":"stable-source-id","text":"reason, risk, constraint, or validation intent"}]
  }]
}
```

Resources are explicit file/directory objects and must use literal canonical repository-relative paths. Phase A defines maximum authority. Semantic dependencies that are not typed reads belong in advisory notes. Do not submit status, paths, timestamps, graph fields, commands, anchors, routing, or packet fields. Do not mutate the repository.

Do not add a `final-validation` implementation item. Phase B `finalValidationCommands` are the sole input for the compiler-owned final-validation node.
