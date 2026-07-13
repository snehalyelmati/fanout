---
description: Ground an accepted Fanout plan
argument-hint: "<objective>"
---

Ground the verified Phase A plan for: $ARGUMENTS

This is read-only Phase B. Read the controller-provided accepted plan and inspect stable anchors. Submit exactly one grounding body with `fanout_submit_artifact`. The controller supplies schema/version, identity, time, exact plan identity, and destination.

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
