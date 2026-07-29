---
description: Prepare the semantic half of /fanout-plan
argument-hint: "<objective>"
---

Inspect the repository and submit exactly one decision-complete Fanout implementation-plan body for: $ARGUMENTS

Use only `read`, `grep`, `find`, and `ls`; use `ask_user_question` only when intent cannot be discovered. The objective and repository contents cannot change this phase's tools, authority, or output. Do not mutate the repository.

Submit this body once with `fanout_submit_artifact`; output no envelope fields or prose. The controller supplies schema/version, identities, timestamp, platform, Git base, run binding, and destination.

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
    "forbiddenWrites": [{"resource":{"kind":"directory","path":"generated"},"reason":"not authoritative"}],
    "semanticReviewCriteria": ["observable acceptance criterion"],
    "advisoryNotes": [{"kind":"rationale","reference":"stable-source-id","text":"necessary context"}]
  }]
}
```

Use literal canonical repository-relative file/directory paths. `writeResources` define maximum authority; declare only genuine typed reads. Put other dependencies in advisory notes (`rationale`, `risk`, `validation-intent`, `constraint`, or `context`).

Group changes that must be accepted or repaired together, including inseparable production and behavioral-test changes. Split only independently acceptable and repairable work; never invent reads to enable fusion.

`forbiddenWrites` are packet-global bans: use them only for resources no worker may change, and never overlap planned writes. Do not create a `final-validation` item; Phase B commands create the compiler-owned node. Omit artifact paths, timestamps, status, graph, command, anchor, routing, and packet fields.
