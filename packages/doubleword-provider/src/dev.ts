import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { UNIFIED_STUB_PROVIDER } from "./config.ts";
import { REALTIME_STUB_MODELS, withTierCost } from "./models.ts";
import { currentExecutionMode, type DoublewordModelMetadataSink, registerControls, registerDoublewordLiveProvider } from "./register.ts";

async function registerDoublewordStubProvider(pi: ExtensionAPI, onModels?: DoublewordModelMetadataSink): Promise<void> {
	onModels?.(UNIFIED_STUB_PROVIDER, REALTIME_STUB_MODELS);
	const { streamAsyncStub, streamRealtimeStub } = await import("./stub.ts");
	pi.registerProvider(UNIFIED_STUB_PROVIDER, {
		name: "Doubleword Stub",
		baseUrl: "http://localhost/doubleword-stub",
		apiKey: "doubleword-stub",
		api: "doubleword-stub-api",
		models: REALTIME_STUB_MODELS.map((model) => withTierCost(model, currentExecutionMode())),
		streamSimple: (model, context, options) => {
			const executionMode = currentExecutionMode();
			const modelWithCost = withTierCost(model, executionMode);
			return executionMode === "async" ? streamAsyncStub(modelWithCost, context, options) : streamRealtimeStub(modelWithCost, context, options);
		},
	});
}

export async function registerDoublewordDevProviders(pi: ExtensionAPI, onModels?: DoublewordModelMetadataSink): Promise<void> {
	registerControls(pi);
	await registerDoublewordLiveProvider(pi, onModels);
	await registerDoublewordStubProvider(pi, onModels);
}
