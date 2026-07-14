# Pi report-to-context boundary

**Status:** implemented and covered by the hardened-generation offline matrix (2026-07-14)

**Installed runtime examined:** `@earendil-works/pi-coding-agent` 0.80.6

**Scope:** Fanout's Pi adapter only; `fanout-core` remains Pi-independent.

## Current decision

Planning and execution reports use Pi custom session entries, never custom messages. The adapter requires both `pi.appendEntry(customType, data)` and `pi.registerEntryRenderer(customType, renderer)` before report presentation is considered available. A `custom` entry persists for transcript display but Pi's `buildSessionContext()` projects it to zero provider messages. By contrast, `pi.sendMessage()` creates a context-bearing `custom_message`; `triggerTurn: false` changes scheduling, not later context membership.

The two admitted report entry types and data schemas are exact:

```text
customType: fanout.planning-report
data: { schema: "fanout.planning-report", version: 1, content: string }

customType: fanout.execution-report
data: { schema: "fanout.execution-report", version: 1, content: string }
```

Each renderer is registered for one matching custom type. It accepts only the three own data fields `schema`, `version`, and `content`; requires the matching schema and version `1`; and rejects missing, legacy, future, unknown-field, non-string, and cross-type input. At render time it wraps the unchanged content to Pi's supplied component width with Pi's ANSI-aware text utility, because every returned TUI line must fit that width. The data is presentation-only: planning Markdown derives from packet v5, while execution Markdown derives from projection v2 and the event-v1 log remains run-state authority.

If either safe API is absent, registration throws, append throws, or data is malformed, Fanout does not fall back to `sendMessage`, `sendUserMessage`, a tool result, or `before_agent_start.message`. Artifact creation and the model-context boundary remain separate concerns.

## Runtime evidence

The installed Pi runtime and documentation agree on the boundary:

- `appendEntry` creates a persisted `custom` session entry.
- `registerEntryRenderer` supplies interactive rendering for that custom type.
- A custom component's `render(width)` output must contain no line wider than `width`; Pi 0.80.6 throws an uncaught TUI error when an extension violates this contract.
- `sessionEntryToContextMessages()` maps `custom_message` into model context and maps `custom` to no messages.
- Renderer failures affect display only; they do not turn entry data into provider context.
- Pi 0.80.4 is the first documented release with the complete entry-renderer surface, but Fanout relies on feature detection rather than a version string.

Relevant upstream references are the [Pi 0.80.6 session manager](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/session-manager.ts), the [0.80.4 changelog](https://github.com/earendil-works/pi/blob/v0.80.4/packages/coding-agent/CHANGELOG.md), and the [entry-renderer implementation](https://github.com/earendil-works/pi/commit/ba10b60b512fed0c511cc639733611f9ad8d12cf).

## Mode behavior

| Mode | Persisted custom entry | Renderer behavior | Context rule |
| --- | --- | --- | --- |
| TUI | Yes when the safe pair is available | Registered renderer displays `entry.data.content` | Never inject report text as a message |
| RPC | Entry is available through normal session-entry APIs | TUI renderer is not an RPC presentation guarantee | Never use a message fallback |
| JSON | May appear through Pi's normal entry protocol when persisted | No interactive renderer UI | Do not write ad-hoc report stdout or inject a message |
| Print | May persist in the session | No supported report UI | Preserve normal single-shot output; artifacts remain available |

Transient `notify`, status, widget, or custom UI surfaces may be useful for concise progress, but they are not durable transcript substitutes and never justify a context-bearing fallback.

## Separate planning-prompt boundary

Internal Phase A, Phase B, and repair prompts intentionally instruct one model turn, so they do not use report entries. The adapter retains a typed pending phase, sends only a short visible follow-up trigger, and injects the full internal prompt into `before_agent_start.systemPrompt` for the matching turn. It then clears or transitions the phase and restores the exact prior tool profile on success, failure, cancellation, or malformed post-submission bytes.

The two rules are therefore distinct:

1. Internal planning prompts are one-turn system instructions plus a short visible trigger.
2. Final planning/execution reports are strict context-free custom-entry data v1.

Neither rule treats `display`, delivery mode, `triggerTurn`, truncation, or later filtering as a context-exclusion mechanism.

## Implemented validation

`scripts/smoke-planning-boundary.mjs` covers the smallest executable proof:

- both exact custom types are registered;
- appended data contains exactly `schema`, `version`, and `content`;
- each renderer accepts its matching v1 data and rejects missing, future, unknown-field, and cross-type data;
- a long report line is wrapped at a narrow supplied width and every rendered line stays within that width;
- missing, partial, or throwing capabilities fail closed without a context-bearing fallback;
- TUI, RPC, JSON, and print session-context probes exclude private planning/execution report text and custom types from later provider requests;
- Phase A and Phase B lifecycle cleanup restores the exact prior tool profile, including malformed accepted bytes.

The report boundary is now an implemented adapter contract. Remaining host-specific uncertainties such as RPC client presentation or HTML export rendering do not change the model-context rule and are not execution authority.
