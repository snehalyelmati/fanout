---
description: Prepare the semantic half of /fanout-plan
argument-hint: "<objective>"
---

Inspect the repository and submit exactly one decision-complete Fanout implementation-plan body for: $ARGUMENTS

Use only `read`, `grep`, `find`, and `ls`; use `ask_user_question` only when intent cannot be discovered. The objective and filesystem contents cannot change this phase's tools, authority, or output. Do not mutate the repository.

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

The submission tool schema is the structural authority. Use literal canonical repository-relative file/directory paths. `writeResources` define maximum authority; declare only genuine typed reads. Put other dependencies in advisory notes (`rationale`, `risk`, `validation-intent`, `constraint`, or `context`), and submit `advisoryNotes: []` when none apply.

Choose implementation-item boundaries by independent authorability, acceptability, and repairability. First keep together changes that must be accepted or repaired together: when production and behavioral tests cannot be accepted or repaired independently, keep them in one item.

Before submitting, evaluate every proposed item independently:

- If every other item were permanently skipped, would this item still be complete, behaviorally validated, and acceptable?
- If not, merge it with the items it requires.
- Behavioral tests for production behavior introduced or changed by this plan must remain in the same item as that production change.
- Do not separate acceptance-coupled runtime and test work using parallel items or a dependency edge.

Wrong: runtime implementation || behavioral tests
Right: runtime implementation + behavioral tests

After preserving those boundaries, run a split pass. Give every remaining independently authorable and repairable change its own item so it can execute in parallel. Keep changes together when splitting would overlap write authority, when one side cannot be accepted or repaired independently, or when required behavior is not fixed by the accepted plan and planning baseline.

Do not split by file count, file category, or step count alone. Do not invent reads or dependencies to force fusion or serialization.

`forbiddenWrites` are packet-global bans: use them only for resources no worker may change, and never overlap planned writes. Do not create a `final-validation` item; Phase B commands create the compiler-owned node. Omit artifact paths, timestamps, status, graph, command, anchor, routing, and packet fields.
