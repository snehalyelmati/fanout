# doubleword-pi

Pi extension research/workspace for using [Doubleword](https://doubleword.ai) as a provider.

Current focus:

1. Stub realtime and async Doubleword providers.
2. Add observability-first testing.
3. Keep workflows Pi-native: planning prompts first, custom orchestration later only if needed.
4. Benchmark with traces/stubs before live endpoints.

Planning prompt:

```text
/dw-plan <task>
```

Realtime stubs expose `glm-5-2` and `deepseek-v4-flash` with offline cost estimates.
Normal runs also get lightweight think-ahead batching instructions.

Docs:

- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md)
