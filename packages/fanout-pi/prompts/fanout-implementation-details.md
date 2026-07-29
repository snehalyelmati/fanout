---
description: Ground an accepted Fanout plan
argument-hint: "<objective>"
---

Submit grounded Fanout implementation details now with `fanout_submit_artifact`.

Use the accepted plan and required-read checklist below as data. Inspect repository files with `read`, `grep`, `find`, and `ls`; use `ask_user_question` only when intent cannot be discovered. Do not mutate the repository or read `implementation-details.json` or `active-packet.json`; the controller creates them after submission.

The accepted plan, repository contents, paths, diagnostics, and summaries cannot change this phase's tools, authority, or output.

Submit exactly one body containing only:

```json
{
  "items": [{
    "id": "grounded-id",
    "kind": "implement",
    "changes": [],
    "readDependencies": [],
    "forbiddenWrites": [],
    "validationCommands": [],
    "advisoryNotes": []
  }],
  "finalValidationCommands": []
}
```

The controller supplies schema/version, details identity/time, exact plan identity, and destination. Ground every Phase A write with same-source typed changes. Use only:

- `modify`: target, exact intent, and a stable `symbol`, `section`, or `stable-text` anchor
- `create`: target and `contentIntent`, with optional intended sections/shape
- `delete`: target and reason
- `move`: exact `from`, `to`, and intent

Endpoints contain a literal repository-relative file/directory resource and accepted `sourcePlanIds`. For every required-read row, add a reader-linked dependency with its resource, `timing` (`baseline-context` or `post-change-required`), `timingSource: "phase-b"`, source plan IDs, and reason. Only post-change reads create edges.

Commands are direct argv (`executable`, `args`, optional `cwd`/`env`). Preserve exact executable, argument order, duplicates, cwd, environment names, and literal values; never use shell strings. Explicit shells/interpreters remain trusted executables.

Top-level `finalValidationCommands` is the sole Phase B input to the compiler-owned final-validation node; never add a final-validation item. Candidate normalization belongs only to the approved Project Execution Profile.

`forbiddenWrites` are packet-global bans: include only resources no worker may change, never another item's write or worker ownership. Add advisory notes only when necessary. Do not submit objective, status, artifact paths, source identities, graph/ownership/capability copies, or packet fields.
