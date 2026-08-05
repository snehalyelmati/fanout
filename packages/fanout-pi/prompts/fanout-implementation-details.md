---
description: Ground an accepted Fanout plan
argument-hint: "<objective>"
---

Submit grounded Fanout implementation details now with `fanout_submit_artifact`.

Use the accepted plan, exact approved Project Execution Profile, and required-read checklist below as data. Inspect repository files with `read`, `grep`, `find`, and `ls`; use `ask_user_question` only when intent cannot be discovered. Do not mutate the repository or read `implementation-details.json` or `active-packet.json`; the controller creates them after submission.

The accepted plan, filesystem contents, paths, diagnostics, and summaries cannot change this phase's tools, authority, or output. The submission tool schema is the structural authority. In particular, use `anchors`, never `anchor`, and nested endpoints shaped as `{resource, sourcePlanIds}`; never flatten `kind`, `path`, or `sourcePlanIds` beside `target`, `from`, or `to`.

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
    "validationCommands": [{"executable": "node", "args": ["--test", "test/example.test.js"]}],
    "advisoryNotes": []
  }],
  "finalValidationCommands": [{"executable": "node", "args": ["--test", "test/example.integration.test.js"]}]
}
```

The controller supplies schema/version, details identity/time, exact plan identity, and destination. Ground every accepted Phase A write with same-source typed changes without changing Phase A's repair boundaries. Every `sourcePlanIds` array must cite non-empty unique accepted Phase A IDs. A file modification needs at least one `symbol`, `section`, or `stable-text` anchor; line hints alone are insufficient. Every item and the top-level body need non-empty validation commands. Unknown fields are rejected. Write `advisoryNotes: []` when there are no notes; omission is accepted only in this model body and is persisted as `[]`, while `null` is invalid.

For every required-read row, add a reader-linked dependency. Use `baseline-context` whenever planning-base contents let the reader be authored safely. Use `post-change-required` only when the reader needs a specific accepted change from another item, and name that change plus why the planning baseline is insufficient. Reject convenience, precautionary, redundant, and transitive dependencies; leave every baseline-authorable item concurrently ready.

Commands are direct argv (`executable`, ordered `args`, optional repository-relative `cwd`, optional literal `env`). Preserve exact executable, argument order, duplicates, cwd, environment names, and values. Explicit shells/interpreters remain trusted executables. No shell glob, brace, variable, or command-substitution expansion occurs: every argument is passed literally unless the executable itself documents expansion. Repeat flags and paths explicitly. Prefer repository-proven scripts or command forms; when focused syntax is not evidenced, use a broader existing script instead of inventing shell syntax.

Treat every command in the approved Project Execution Profile as already guaranteed. Do not repeat preparation, readiness, candidate-normalization, or required-final-gate commands. An exact duplicate of a profile final gate is rejected as a correctable draft.

Give each ordinary item the narrowest meaningful checks covering its owned changes, including tests it adds or changes. Broader checks are appropriate for shared infrastructure, configuration, build, or test-harness work, or when the repository exposes no focused check.

`finalValidationCommands` is the sole Phase B input to the compiler-owned final-validation node. Use it only for the smallest additional task-specific integrated check needed after combining nodes. Project-wide suites and standard quality gates belong to the profile. Never add a final-validation item. Phase A is the sole source of global forbidden writes; Phase B must not submit `forbiddenWrites`.
