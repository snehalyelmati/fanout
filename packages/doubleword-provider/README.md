# Pi Doubleword Provider

Pi extension for the Doubleword realtime and async model provider.

![Doubleword models in Pi](./assets/model-picker.png)

[Doubleword](https://doubleword.ai) provides model inference with multiple execution tiers. This extension registers the live `doubleword` provider, discovers available models from Doubleword when an API key is present, and lets you toggle realtime vs async execution from inside Pi.

## Why Doubleword?

Doubleword's APIs are OpenAI-compatible and let you trade latency for lower cost:

- **Realtime / priority**: immediate responses for interactive coding.
- **Async / flex**: reduced pricing with background polling; Doubleword docs say submitted async work starts within about a minute.
- **Batch**: lowest pricing for bulk jobs with a 24h SLA.

Example published prices per 1M input/output tokens:

| Model | Realtime | Async | Batch |
| --- | --- | --- | --- |
| DeepSeek V4 Flash | $0.14 / $0.28 | $0.10 / $0.20 | $0.07 / $0.14 |
| GLM 5.2 | $1.40 / $4.40 | $1.05 / $3.30 | $0.70 / $2.20 |

This provider exposes realtime and async in Pi; batch is better suited for offline evals and bulk jobs.

## Install

```bash
pi install npm:@snehalyelmati/pi-doubleword-provider
```

## Quick start

```bash
export DOUBLEWORD_API_KEY=...
pi --model doubleword/deepseek-ai/DeepSeek-V4-Flash
```

Use `Alt+T` or `/doubleword-mode` to toggle realtime vs async execution for Doubleword models.

For supported Doubleword generation models, press `Shift+Tab` to choose thinking depth. The provider sends that choice to Doubleword as `reasoning_effort`: off disables reasoning, while higher levels ask the model to spend more effort.

## Configuration

Required for live models:

```text
DOUBLEWORD_API_KEY                 live API key
```

Optional overrides:

```text
DOUBLEWORD_BASE_URL                override API base URL
DOUBLEWORD_MODEL_CACHE_FILE        override cached /models catalog path
DOUBLEWORD_MAX_OUTPUT_TOKENS       override default 16384 output cap
DOUBLEWORD_LIVE_ASYNC_TIMEOUT_MS   override default 600000 async timeout
DOUBLEWORD_LIVE_ASYNC_POLL_MS      override default 2000 poll interval
DOUBLEWORD_CANCEL_TIMEOUT_MS       override default 10000 cancel request timeout
DOUBLEWORD_EXECUTION_MODE          realtime or async; defaults to realtime
```

## Capabilities

- Registers the live `doubleword` provider in Pi.
- Discovers models from Doubleword `/models` and caches the catalog locally.
- Falls back to a small known model list when discovery is unavailable.
- Supports realtime priority execution and async/flex background polling.
- Marks registered Doubleword models with Fanout tier metadata for realtime, async, and batch.
- Sends top-level Doubleword `reasoning_effort` for generation models; OCR/embedding models are marked non-reasoning.
- Converts Doubleword reasoning output into Pi thinking blocks.
- Supports Responses function-call tool use.
- Reports usage/cost metadata when returned by the provider.
- Best-effort cancels async background responses on timeout or user abort.

## Development

The repo contains a `doubleword-stub` provider for local smoke tests. It is enabled only by development entrypoints, not by the published standalone provider package.

From the repo root:

```bash
pi -e . --model doubleword-stub/deepseek-v4-flash
```

## Limitations

- Live use requires a Doubleword API key.
- Async responses are delivered after polling completes; token streaming before completion is not assumed.
