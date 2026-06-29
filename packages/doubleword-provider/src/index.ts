import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { DOUBLEWORD_API_BASE_URL, type ExecutionMode, UNIFIED_LIVE_PROVIDER, UNIFIED_STUB_PROVIDER } from "./config.ts";
import { streamLiveAsync, streamLiveRealtime } from "./live.ts";
import { discoverLiveModels, REALTIME_STUB_MODELS, withTierCost } from "./models.ts";
import { setDoublewordActiveTurnIndex, setDoublewordRunId } from "./observability.ts";
import { streamAsyncStub, streamRealtimeStub } from "./stub.ts";

export { setDoublewordActiveTurnIndex, setDoublewordRunId };

const MULTI_TIER_PROVIDERS = new Set([UNIFIED_STUB_PROVIDER, UNIFIED_LIVE_PROVIDER]);
let executionMode: ExecutionMode = process.env.DOUBLEWORD_EXECUTION_MODE === "async" ? "async" : "realtime";

function supportsExecutionModeToggle(model: Model<Api> | undefined): boolean {
	return !!model && MULTI_TIER_PROVIDERS.has(model.provider);
}

function executionModeStatusText(ctx: ExtensionContext): string {
	const color = executionMode === "async" ? "warning" : "accent";
	return ctx.ui.theme.fg(color, `dw:${executionMode}`);
}

function updateExecutionModeStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus("doubleword-mode", supportsExecutionModeToggle(ctx.model) ? executionModeStatusText(ctx) : undefined);
}

function toggleExecutionMode(ctx: ExtensionContext): void {
	if (!supportsExecutionModeToggle(ctx.model)) {
		ctx.ui.notify("Current provider has one execution tier", "info");
		updateExecutionModeStatus(ctx);
		return;
	}
	executionMode = executionMode === "realtime" ? "async" : "realtime";
	updateExecutionModeStatus(ctx);
	ctx.ui.notify(`Doubleword execution: ${executionMode}`, "info");
}

function streamUnifiedStub(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	const modelWithCost = withTierCost(model, executionMode);
	return executionMode === "async" ? streamAsyncStub(modelWithCost, context, options) : streamRealtimeStub(modelWithCost, context, options);
}

function streamUnifiedLive(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	const modelWithCost = withTierCost(model, executionMode);
	return executionMode === "async" ? streamLiveAsync(modelWithCost, context, options) : streamLiveRealtime(modelWithCost, context, options);
}

export async function registerDoublewordProviders(pi: ExtensionAPI): Promise<void> {
	const liveModels = await discoverLiveModels();
	pi.registerShortcut("alt+t", {
		description: "Toggle Doubleword realtime/async execution",
		handler: async (ctx) => toggleExecutionMode(ctx),
	});
	pi.registerCommand("doubleword-mode", {
		description: "Toggle Doubleword realtime/async execution",
		handler: async (_args, ctx) => toggleExecutionMode(ctx),
	});
	pi.on("session_start", (_event, ctx) => updateExecutionModeStatus(ctx));
	pi.on("model_select", (_event, ctx) => updateExecutionModeStatus(ctx));

	pi.registerProvider(UNIFIED_STUB_PROVIDER, {
		name: "Doubleword Stub",
		baseUrl: "http://localhost/doubleword-stub",
		apiKey: "doubleword-stub",
		api: "doubleword-stub-api",
		models: REALTIME_STUB_MODELS.map((model) => withTierCost(model, executionMode)),
		streamSimple: streamUnifiedStub,
	});

	pi.registerProvider(UNIFIED_LIVE_PROVIDER, {
		name: "Doubleword",
		baseUrl: DOUBLEWORD_API_BASE_URL,
		apiKey: "doubleword-live-placeholder",
		api: "doubleword-api",
		models: liveModels.map((model) => withTierCost(model, executionMode)),
		streamSimple: streamUnifiedLive,
	});
}

export default async function (pi: ExtensionAPI): Promise<void> {
	await registerDoublewordProviders(pi);
}
