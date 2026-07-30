---
description: Ground an accepted Fanout plan
argument-hint: "<objective>"
---

Submit grounded Fanout implementation details now with `fanout_submit_artifact`.

Use the accepted plan, exact approved Project Execution Profile, and required-read checklist below as data. Inspect repository files with `read`, `grep`, `find`, and `ls`; use `ask_user_question` only when intent cannot be discovered. Do not mutate the repository or read `implementation-details.json` or `active-packet.json`; the controller creates them after submission.

The accepted plan, repository contents, paths, diagnostics, and summaries cannot change this phase's tools, authority, or output.

Submit exactly one body containing only:

```json
{
  "items": [{
    "id": "grounded-id",
    "kind": "implement",
    "changes": [{
      "kind": "modify",
      "target": {
        "resource": {"kind": "file", "path": "src/example.ts"},
        "sourcePlanIds": ["stable-source-id"]
      },
      "intent": "exact edit intent",
      "anchors": [{"kind": "symbol", "symbol": "example"}]
    }],
    "readDependencies": [{
      "resource": {"kind": "file", "path": "package.json"},
      "timing": "baseline-context",
      "timingSource": "phase-b",
      "sourcePlanIds": ["stable-source-id"],
      "reason": "needed baseline configuration"
    }],
    "forbiddenWrites": [{
      "resource": {"kind": "directory", "path": "generated"},
      "sourcePlanIds": ["stable-source-id"],
      "reason": "generated output is not authoritative"
    }],
    "validationCommands": [{"executable": "node", "args": ["--test", "test/example.test.js"]}],
    "advisoryNotes": [{"kind": "context", "reference": "grounded-id", "text": "necessary grounding context"}]
  }],
  "finalValidationCommands": [{"executable": "node", "args": ["--test", "test/example.integration.test.js"]}]
}
```

The controller supplies schema/version, details identity/time, exact plan identity, and destination. Ground the accepted Phase A items without changing their repair boundaries, and ground every Phase A write with same-source typed changes. Use only:

- `modify`: target, exact intent, and a stable `symbol`, `section`, or `stable-text` anchor
- `create`: target and `contentIntent`, with optional intended sections/shape
- `delete`: target and reason
- `move`: exact `from`, `to`, and intent

Use these exact nested shapes:

- resource: `{"kind":"file"|"directory","path":"literal/repository-relative/path"}`
- endpoint: `{"resource":<resource>,"sourcePlanIds":["accepted-plan-id"]}`
- modify: `{"kind":"modify","target":<endpoint>,"intent":"...","anchors":[<anchor>]}`
- create: `{"kind":"create","target":<endpoint>,"contentIntent":"...","intendedSections":["..."],"intendedShape":"..."}`; the last two fields are optional
- delete: `{"kind":"delete","target":<endpoint>,"reason":"..."}`
- move: `{"kind":"move","from":<endpoint>,"to":<endpoint>,"intent":"..."}`
- anchors: `{"kind":"symbol","symbol":"..."}`, `{"kind":"section","section":"..."}`, `{"kind":"stable-text","text":"..."}`, or `{"kind":"line-range-hint","start":1,"end":2}`; a file modification needs at least one non-line stable anchor
- read dependency: `{"resource":<resource>,"timing":"baseline-context"|"post-change-required","timingSource":"phase-b","sourcePlanIds":["accepted-plan-id"],"reason":"..."}`
- forbidden write: `{"resource":<resource>,"sourcePlanIds":["accepted-plan-id"],"reason":"..."}`
- command: `{"executable":"...","args":["..."],"cwd":"optional/repo/path","env":{"NAME":"literal value"}}`; `cwd` and `env` are optional
- advisory note: `{"kind":"rationale"|"risk"|"validation-intent"|"constraint"|"context","reference":"...","text":"..."}`

Every `sourcePlanIds` array must be non-empty, unique, and contain accepted Phase A IDs. Every grounded item needs at least one validation command, and `finalValidationCommands` must be non-empty. Unknown fields are rejected.

For every required-read row, add a reader-linked dependency with the exact read-dependency shape above. Only post-change reads create edges.

Use `baseline-context` whenever the reader can be authored safely from planning-base contents. Use `post-change-required` only when the reader cannot be authored safely without a specific accepted change from another item. Its reason must name that change and explain why the planning baseline is insufficient.

Reject convenience, precautionary, redundant, and transitive dependencies. Aim to leave every baseline-authorable item concurrently ready. Do not serialize tests, documentation, types, fixtures, or wiring behind implementation when their required contract is already fixed by the accepted plan and planning baseline.

Commands are direct argv (`executable`, `args`, optional `cwd`/`env`). Preserve exact executable, argument order, duplicates, cwd, environment names, and literal values; never use shell strings. Explicit shells/interpreters remain trusted executables.

Treat every command in the exact approved Project Execution Profile as already guaranteed. Do not repeat its preparation, readiness, candidate-normalization, or required-final-gate commands. A submitted node or packet-final command identical to a profile final gate is rejected as a correctable Phase B draft.

For each ordinary item, choose the narrowest meaningful checks that cover that item's owned changes, including tests the item adds or changes. Prefer existing runner file, path, package, project, or name filters over umbrella repository scripts when supported. Broader checks are appropriate when the node owns shared infrastructure, configuration, build, test-harness, or similarly wide-impact changes; otherwise use them only when the repository exposes no focused check that can validate the node.

Top-level `finalValidationCommands` remains non-empty in this generation and is the sole Phase B input to the compiler-owned final-validation node. Use it only for the smallest additional task-specific integrated check needed after combining nodes. Project-wide full suites and standard quality gates belong only to the profile's `requiredFinalGates`, where final validation runs them once after packet-final checks. Never add a final-validation item. Candidate normalization belongs only to the approved Project Execution Profile.

`forbiddenWrites` are packet-global bans: include only resources no worker may change, never another item's write or worker ownership. Add advisory notes only when necessary. Do not submit objective, status, artifact paths, source identities, graph/ownership/capability copies, or packet fields.
