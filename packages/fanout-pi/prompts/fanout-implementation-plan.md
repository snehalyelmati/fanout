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

The submission tool schema is the structural authority. Use literal canonical repository-relative file/directory paths. `writeResources` define maximum write authority; `readResources` declare known reads and approve the maximum post-change read scope. Phase B may discover additional canonical repository-local baseline-context reads with source attribution; reads describe provenance and scheduling, not a confidentiality boundary. Put other dependencies in advisory notes (`rationale`, `risk`, `validation-intent`, `constraint`, or `context`), and submit `advisoryNotes: []` when none apply.

Choose independently authorable and repairable work units that expose useful parallelism while accounting for worker setup, repeated context, and validation overhead.

For each proposed item, ask:

- Given the frozen plan, contract, and planning baseline, can one worker complete
  and validate this item without writing resources owned by another item?
- If yes, keep it separate when the useful independent work justifies the additional setup, context, and validation.
- If no, merge only the resources that must be changed or repaired together.

A work item is a worker ownership and repair boundary, not a standalone release.
It may rely on the eventual completion of other accepted plan items.

Keep production behavior together with behavioral tests when a failing test may
require repairing that production behavior. Otherwise, split disjoint work that
can be authored, validated for its own scope, and repaired independently.

If an item’s focused validation can reasonably fail in a way that requires
repairing production code owned by another item, merge those repair-coupled
resources. Do not use a dependency edge as a substitute for shared repair
authority.

Prefer parallel items whenever both resulting items retain sufficient validation
and disjoint write authority. Do not merge items merely because they contribute
to the same feature or would not be useful if released alone.

After preserving those boundaries, review granularity. Group small related changes when repeated setup, context, and validation would outweigh useful parallel work. Keep substantial independent work separate. Keep changes together when splitting would overlap write authority, when one side cannot be accepted or repaired independently, or when required behavior is not fixed by the accepted plan and planning baseline.

Do not split by file count, file category, or step count alone. Do not invent reads or dependencies to force fusion or serialization.

`forbiddenWrites` are packet-global bans: use them only for resources no worker may change, and never overlap planned writes. Do not create a `final-validation` item; Phase B commands create the compiler-owned node. Omit artifact paths, timestamps, status, graph, command, anchor, routing, and packet fields.
