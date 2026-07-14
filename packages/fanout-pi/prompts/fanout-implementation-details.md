---
description: Ground an accepted Fanout plan
argument-hint: "<objective>"
---

Ground the verified Phase A plan for: $ARGUMENTS

This is read-only Phase B. Read the controller-provided accepted plan and inspect stable anchors. Submit exactly one grounding body with `fanout_submit_artifact`. The controller supplies schema/version, identity, time, exact plan identity, and destination.

Phase B is already active. `implementationDetailsPath` is the controller-owned output destination, not an input or prerequisite; it may be absent before the initial submission. `active-packet.json` is published only after this submission; do not read it. Use the accepted plan embedded in Phase B input, inspect repository files, and submit the grounding body now.

Do not add a `final-validation` item. `finalValidationCommands` is the sole input for the compiler-owned final-validation node.

Submit only:

```json
{
  "items": [{
    "id": "grounded-id",
    "kind": "implement",
    "changes": [{"kind":"modify","target":{"resource":{"kind":"file","path":"src/example.ts"},"sourcePlanIds":["stable-source-id"]},"intent":"exact edit intent","anchors":[{"kind":"symbol","symbol":"example"}]}],
    "readDependencies": [{"resource":{"kind":"file","path":"package.json"},"timing":"baseline-context","timingSource":"phase-b","sourcePlanIds":["stable-source-id"],"reason":"needed configuration"}],
    "forbiddenWrites": [],
    "validationCommands": [{"executable":"rtk","args":["npm","run","check"]}],
    "advisoryNotes": [{"kind":"context","reference":"grounded-id","text":"grounding context"}]
  }],
  "finalValidationCommands": [{"executable":"rtk","args":["npm","run","check"]}]
}
```

Use only typed `modify`, `create`, `delete`, or `move` changes; those endpoints are the sole write authority. A file modification needs a stable symbol, section, or text anchor. Classify typed reads as `baseline-context` or `post-change-required`; only the latter derives graph edges. Preserve command order, duplicates, cwd, and literal env exactly. Explicit shells/interpreters are trusted executables, not implicit parsing. Do not submit objective, status, paths, source identity, graph, ownership copies, shell strings, or packet fields. Do not mutate the repository.

`forbiddenWrites` are monotonic packet-global bans. Do not use them to express worker ownership or to forbid a resource another plan item is authorized to write; typed change endpoints already define worker ownership. List only resources that no worker may change.
