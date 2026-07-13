# Pi report-to-context boundary

**Status:** implementation-ready research decision

**Installed runtime examined:** `@earendil-works/pi-coding-agent` 0.80.6 (package dated 2026-07-09)

**Scope:** Fanout's Pi adapter only; Fanout core remains Pi-independent.

## Executive answer

Fanout execution and planning reports must use Pi's **custom session entry** channel, not its custom-message channel. On Pi 0.80.6, the supported durable TUI-only pair is `pi.appendEntry(customType, data)` plus `pi.registerEntryRenderer(customType, renderer)`: the entry is persisted and rendered in the interactive transcript, while `buildSessionContext()` deliberately projects a `custom` entry to zero model messages. By contrast, `pi.sendMessage()` creates a `custom_message`; `triggerTurn: false` controls whether a turn starts, not whether the message becomes later LLM context.

This capability was added in Pi 0.80.4. Fanout must runtime-check **both** `appendEntry` and `registerEntryRenderer`; use them only when both are callable. It must never fall back to `sendMessage`, `sendUserMessage`, a tool result, or `before_agent_start` for report display. If the safe pair is absent or appending throws, the adapter must fail closed: keep the derived report artifact on disk, emit the existing observability error, and give only a concise artifact-path notification where `ctx.hasUI` is true. TUI may additionally offer a transient `ctx.ui.custom()` view; RPC may use `ctx.ui.notify()` or a string-array `setWidget()` request. JSON and print have no built-in report UI; they rely on artifacts and Pi's normal protocol/output rather than message injection.

## Evidence table

| Claim | Primary evidence | Consequence |
|---|---|---|
| `sendMessage` is model context. | Installed `docs/extensions.md`, section **`pi.sendMessage(message, options?)`** (local lines 1378-1399), says custom messages participate in LLM context and directs durable TUI-only content to `appendEntry`/`registerEntryRenderer`. `docs/session-format.md`, **CustomEntry**, **CustomMessageEntry**, and **Context Building** (local lines 250-271 and 307-326), says `custom_message` is converted to `CustomMessage` while `custom` produces no context message. Runtime `dist/core/session-manager.js`, symbols `sessionEntryToContextMessages()` and `buildSessionContext()`, explicitly maps `custom_message` to `createCustomMessage`. [v0.80.6 source](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/session-manager.ts) | Fanout's present `sendMessage(..., { triggerTurn: false })` is polluted context even though it does not trigger inference immediately. |
| `appendEntry` is durable but context-free. | Installed `docs/extensions.md`, **`pi.appendEntry(customType, data?)`** (local lines 1429-1435), and `docs/session-format.md`, **CustomEntry** (local lines 250-256), state that custom entries persist but do not participate in LLM context. Runtime `dist/core/session-manager.d.ts`, interfaces `CustomEntry`/`CustomMessageEntry`, and `dist/core/session-manager.js::sessionEntryToContextMessages()` return no messages for `custom`. | This is the primary report boundary. Persistence in session JSONL is acceptable; persistence as later model context is not. |
| Entry renderers are interactive-transcript renderers for custom entries. | Installed `docs/extensions.md`, **`pi.registerEntryRenderer`** (local lines 1555-1573), and `examples/extensions/entry-renderer.ts` (entire 41-line example). Runtime declarations `dist/core/extensions/types.d.ts::ExtensionAPI.registerEntryRenderer`; registration implementation `dist/core/extensions/loader.js::createExtensionAPI`; rendering component `dist/modes/interactive/components/custom-entry.js::CustomEntryComponent`. [v0.80.6 example](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/examples/extensions/entry-renderer.ts) | Register one renderer per Fanout report type at extension initialization; append data after each report is finalized. |
| Entry-renderer failures do not become context. | Installed runtime `dist/modes/interactive/components/custom-entry.js::CustomEntryComponent.rebuild()` catches renderer exceptions and renders an error box. | A renderer bug may impair display but cannot justify a context-bearing fallback. |
| The safe surface exists beginning in 0.80.4. | Installed `CHANGELOG.md`, 0.80.4 **Added**: “extension entry renderers for persisted display-only session entries … without being sent to the model context” (local lines 27-45). [v0.80.4 changelog](https://github.com/earendil-works/pi/blob/v0.80.4/packages/coding-agent/CHANGELOG.md) and [entry-renderer implementation commit](https://github.com/earendil-works/pi/commit/ba10b60b512fed0c511cc639733611f9ad8d12cf) | Treat `<0.80.4` as lacking the complete supported pair unless feature detection proves otherwise; feature detection, not version-string trust, is authoritative. |
| UI behavior differs by mode. | Installed `docs/extensions.md`, **ExtensionContext** (`ctx.mode`, `ctx.hasUI`) and **Mode Behavior** (local lines 2657-2666): TUI full UI; RPC UI protocol with `custom()` returning `undefined`; JSON UI no-ops; print cannot prompt. Runtime `dist/core/extensions/runner.js::noOpUIContext`, `dist/modes/rpc/rpc-mode.js::createExtensionUIContext`, and `dist/modes/print-mode.js::runPrintMode` match the docs. [v0.80.6 RPC source](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/modes/rpc/rpc-mode.ts) | Context-free display must be selected by mode; no message injection fallback in headless modes. |
| RPC can expose persisted entries to clients but does not TUI-render them. | Installed `docs/rpc.md`, **get_entries** (local lines 664-692), returns all entry types; runtime `dist/modes/rpc/rpc-mode.js`, `get_entries` command, returns `sessionManager.getEntries()`. RPC UI implementation emits `extension_ui_request` for `notify` and string-array `setWidget`, while `custom()` returns `undefined`. | A client may discover a Fanout custom entry through `get_entries`; active display requires an RPC UI request and client support. Renderer registration itself has no RPC visual effect. |
| Transient TUI surfaces do not enter session context. | Installed `docs/tui.md`, **Using Components** and patterns for status/widgets; installed `docs/extensions.md`, **Custom UI**. Runtime interactive UI methods manipulate TUI containers; they do not call session append methods. | `ctx.ui.custom`, `notify`, status, and widgets are safe for transient summaries/pointers, but are not durable transcript substitutes. |
| Current Fanout uses the unsafe report channel twice. | `packages/fanout-pi/src/index.ts`, symbols `displayFanoutPlanReport` and `displayFanoutExecutionReport`, dynamically read `pi.sendMessage` and send full report content with `display: true`, `deliverAs: "followUp"`, `triggerTurn: false`. Call sites are the completed planning path and `/fanout-execute` completion path. | Both report helpers require the same adapter fix; fixing only the planning report leaves the sibling execution report polluted. |
| `/fanout-plan` has a separate prompt-transcript problem. | [Fix `/fanout-plan` chat pollution](https://github.com/snehalyelmati/fanout/issues/6) identifies the full internal Phase A prompt/preflight sent through `sendUserMessage`; local `packages/fanout-pi/src/index.ts` also sends full Phase B and repair prompts the same way. Pi's `before_agent_start.systemPrompt` is the supported one-turn model-instruction surface. | Internal prompts must remain model-visible for their turn but need not be persisted as full visible user messages. This is complementary to, not solved by, the report-entry boundary. |
| Existing checks encode the unsafe report behavior. | `scripts/smoke-planning.mjs`, source assertions require `displayFanoutPlanReport`, `customType: "fanout-plan"`, and `triggerTurn: false`. `packages/fanout-pi/src/index.ts` history in `.git/logs/HEAD` records “Wire fanout-plan into Pi” at commit `e96aed3f…`; current history contains no later report-boundary fix. | Implementation must update the smoke assertion from custom-message mechanics to the safe adapter contract and add behavioral context-projection coverage. |

## Installed-runtime observations (0.80.6)

1. **Public API and implementation agree.** `package.json` reports version `0.80.6`. `dist/core/extensions/types.d.ts::ExtensionAPI` includes both `registerEntryRenderer` and `appendEntry`; `dist/core/extensions/loader.js::createExtensionAPI` delegates them to an entry-renderer map and the bound runtime action respectively.
2. **Context projection is structural, not renderer-dependent.** `dist/core/session-manager.js::sessionEntryToContextMessages()` maps `message`, `custom_message`, branch summary, and compaction entries, then returns `[]` for everything else, including `custom`. `buildSessionContext()` flat-maps that function. A renderer's presence, absence, or exception cannot cause entry data to enter LLM context.
3. **Custom messages remain durable context.** `dist/core/agent-session.js::_handleAgentEvent` persists a finalized custom-role message with `appendCustomMessageEntry`; later context construction maps it back to a custom model message. `display: true` is only a display choice, and `triggerTurn: false` is only scheduling.
4. **Interactive restoration renders entries.** The interactive runtime imports `sessionEntryToContextMessages` separately from `CustomEntryComponent`; the latter is selected for custom session entries through the registered renderer. This preserves the distinction between transcript reconstruction and model-context construction.
5. **RPC is a host protocol, not a TUI.** `ctx.hasUI` is true, but `custom()` is explicitly unsupported. Notifications and string widgets become `extension_ui_request` records. Persisted custom entries are obtainable with `get_entries`; registered renderers are not serialized or executed by RPC clients.
6. **JSON/print bind the no-op UI.** `runPrintMode` binds extensions without a UI context; JSON writes normal agent/session protocol events (including the installed runtime's `entry_appended` event), while text print writes only the final assistant text. Injecting a custom message to make a report appear would alter context/protocol semantics and is forbidden.
7. **A direct installed-runtime projection probe confirms the contract.** Running `buildSessionContext()` over one `custom` entry containing `PRIVATE_REPORT` and one `custom_message` containing `CONTEXT_REPORT` on 0.80.6 produced one `custom` role message containing only `CONTEXT_REPORT`; `customEntryLeaked` was `false` and `customMessageIncluded` was `true`.

No destructive or live-provider probe was needed: the installed declarations, example, executable projection function, and direct local projection probe are concordant.

## Compatibility and failure matrix

| Runtime/mode | Safe pair available and append succeeds | Pair missing (including Pi ≤0.80.3) | Registration or append throws | Required result |
|---|---|---|---|---|
| TUI | Register renderer once; `appendEntry` full report data; transcript renders durably. Optional transient notification points to artifacts. | Do not append partially and never call `sendMessage`; `ctx.ui.notify` a concise “report saved” artifact path. Optional guarded `ctx.ui.custom` can show a transient report if available. | Catch; record display error; notify artifact path. Renderer exceptions are handled by Pi's error component. | **No report text may become model context.** |
| RPC | `appendEntry` for durable, context-free session data; optionally `notify` a concise summary/path or `setWidget` string lines. Client can fetch `get_entries`. | Notify summary/path only if RPC UI is present; otherwise artifacts only. | Catch, emit observability error, then notify summary/path if possible. | Do not assume registered entry renderer displays in RPC. |
| JSON | `appendEntry` may persist if the session is persisted and 0.80.6 emits it as a normal `entry_appended` JSON event; there is no renderer/UI. Do not write ad-hoc stdout. | Artifacts only. | Record error to Fanout observability if possible; artifacts only. | Preserve JSON event-stream framing; any entry is carried only by Pi's normal event stream. |
| Print (`-p`) | `appendEntry` may persist if enabled, but no supported report display; normal final assistant output only. | Artifacts only. | Record error if possible; artifacts only. | Preserve single-shot stdout contract. |
| Any mode, only one method callable | Treat the safe capability as unavailable. | Same. | Same. | Both methods are required; no half-capability path. |
| Any mode, `sendMessage` available | Irrelevant. | Irrelevant. | Irrelevant. | It MUST NOT be used as fallback, regardless of `triggerTurn`, delivery mode, or `display`. |

### Why not use only transient UI?

`ctx.ui.notify`, status, widgets, and `custom()` are context-free, but they have weaker lifetime and mode semantics. `notify`/status are brief; widgets are mutable current-state surfaces rather than transcript records; `custom()` is TUI-only and temporarily owns/replaces UI. They are appropriate for progress, concise outcomes, and artifact pointers. The append-entry/entry-renderer pair is the supported durable transcript API.

## Minimal normative adapter contract

The Pi adapter, and only the Pi adapter, owns this policy.

1. **Capability registration**
   - The adapter **MUST** feature-detect `typeof pi.appendEntry === "function"` and `typeof pi.registerEntryRenderer === "function"`.
   - It **MUST** regard safe durable report display as available only when both checks pass.
   - When available, it **MUST** register renderers during extension initialization for stable, namespaced custom types (at minimum planning and execution reports).
   - It **SHOULD** avoid a package-version parser: runtime capability is authoritative across forks/backports. Pi 0.80.4 is the documented minimum known version.

2. **Report data and rendering**
   - When the safe pair is available, after the derived report artifact is successfully written, the adapter **MUST** call `appendEntry(customType, data)` with structured metadata and either the report text or a bounded display payload plus report artifact path.
   - The renderer **MUST** render only `entry.data`; it **MUST NOT** invoke model APIs or message APIs.
   - Report custom types **SHOULD** remain separate (`fanout-plan-report`, `fanout-execution-report`) so schemas and renderers can evolve independently.
   - The entry data **SHOULD** include a small schema/version discriminator, run ID, status/type, artifact/report path, and display content. The entry is never authority: the planning report is derived from the accepted packet, and the execution report is derived from the validated projection whose event log remains run-state authority.

3. **Prohibited context channels**
   - Report display **MUST NOT** call `pi.sendMessage`, `pi.sendUserMessage`, inject `before_agent_start.message`, return a tool result, or otherwise create `message`/`custom_message` session entries.
   - `display`, `deliverAs`, and `triggerTurn` options **MUST NOT** be treated as context-exclusion controls; none is one.
   - The adapter **MUST NOT** add a context-filter hook to compensate for creating polluted messages. Avoiding the message is simpler and robust across compaction, export, fork, and extension ordering.

4. **Mode behavior**
   - In TUI, the adapter **SHOULD** use the durable entry renderer and **MAY** use context-free transient UI for progress or a short artifact pointer.
   - In RPC, it **MAY** append the entry and **MAY** issue `notify`/string `setWidget`; it **MUST NOT** claim renderer-based display. RPC hosts decide whether to display UI requests or inspect `get_entries`.
   - In JSON and print, it **MUST NOT** write ad-hoc report text to stdout or inject a message. A JSON-mode `entry_appended` record emitted by Pi after `appendEntry` is allowed normal protocol output; print mode remains silent. The derived report artifact remains available in both modes.

5. **Fail-closed behavior**
   - Missing safe APIs, a registration error, an append error, malformed report data, or an unsupported mode **MUST NOT** select a context-bearing fallback.
   - The adapter **MUST** preserve successful Fanout work and artifact creation even when display fails.
   - It **MUST** record a typed report-display observability error with report kind/run ID/path when possible.
   - Where `ctx.hasUI` is true, it **SHOULD** notify a concise status and report artifact path; otherwise it **SHOULD** remain silent.

6. **Architecture**
   - Fanout core **MUST** continue returning report/result data and artifact paths without importing Pi types or deciding UI behavior.
   - The contract requires no sandboxing and proposes none.

## Reconciliation with [Fix `/fanout-plan` chat pollution](https://github.com/snehalyelmati/fanout/issues/6)

That issue concerns a different channel: the command sends the entire internal Phase A prompt and preflight JSON through `sendUserMessage`, so model input that should be internal is persisted as a large visible user message. The same mechanism sends full Phase B and repair prompts. Those prompts intentionally instruct the model for one turn, unlike final reports, so `appendEntry` is not their replacement.

Implement the issue's one-turn injection approach: retain a pending typed phase prompt in extension state, send only a short visible user trigger, append the full internal prompt to `before_agent_start.systemPrompt` for the matching turn, and clear it after consumption. Do not use `before_agent_start.message`, because that creates a persistent context message. Preserve queued/follow-up behavior, batching/runtime system instructions, and phase attribution; replace prompt-substring correlation with the pending typed phase state rather than depending on the short visible trigger text.

The report boundary is complementary. Replace both `displayFanoutPlanReport` and `displayFanoutExecutionReport` with the shared context-free entry adapter described above. Thus implementation has two explicit rules:

1. **Internal planning prompts:** one-turn model-visible system instructions plus a short visible user trigger.
2. **Final planning/execution reports:** durable `custom` entries, never model messages.

Neither rule may use `display`, delivery mode, `triggerTurn`, truncation, or later context filtering as a substitute for choosing the correct channel.

## Residual risks and remaining unknowns

- **Older-version exactness:** 0.80.4 is the first installed changelog version explicitly adding entry renderers. Whether a downstream fork backported only one method is unknown; checking both functions handles this safely.
- **RPC host presentation:** Pi emits UI requests, but a particular RPC client may ignore `notify`/`setWidget`. The report still exists as an artifact and, when appended, in `get_entries`; Fanout cannot guarantee host rendering.
- **Session growth:** full Markdown reports in custom entries enlarge session JSONL even though they consume no model context. If measured size becomes material, store a bounded summary plus artifact path. Do not optimize preemptively.
- **Export/share rendering:** this research confirms interactive rendering and RPC entry retrieval, not whether Pi HTML export runs custom entry renderers. Treat export rendering as unsupported until separately proven.
- **Leaf semantics:** appending a custom entry advances the session leaf. Pi's own API design intends this for durable state/display entries, but tree-navigation UX should be covered by a focused integration test.

## Validation implications

Implementation acceptance should add the smallest checks that prove the boundary rather than only source strings:

1. **Installed-runtime projection probe:** retain the executed 0.80.6 check as a regression: build context from one `custom` entry and one `custom_message`, then assert the resulting messages include only the custom message. Observed result: roles `['custom']`, `customEntryLeaked: false`, `customMessageIncluded: true`.
2. **Adapter unit/smoke check:** fake Pi with both safe APIs; assert renderer registration and `appendEntry` occur and `sendMessage` does not. Assert report kind, run ID, path, and content/schema are retained.
3. **Fail-closed matrix checks:** fake Pi with neither API, each API individually, and throwing registration/append; assert no `sendMessage`/`sendUserMessage`, artifacts remain authoritative, and error notification/logging is concise.
4. **Mode checks:** TUI/RPC can request safe display; JSON/print produce no report text on stdout. RPC persisted entry is visible through `get_entries` when persistence is enabled.
5. **Existing smoke update:** replace `scripts/smoke-planning.mjs` assertions for `customType: "fanout-plan"` plus `triggerTurn: false` with safe entry-adapter assertions. Add equivalent execution-report coverage because the current execution smoke tests artifacts but not Pi display transport.
6. **Regression criterion:** after a report is appended, a subsequent provider request's message list must not contain the report text or report custom type.

No code, tracker, roadmap, design-decision, benchmark, or test file is changed by this ticket. The decision is ready for a narrowly scoped Pi-adapter implementation.
