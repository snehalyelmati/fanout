import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export async function configureFanoutTier(args: string, ctx: any, currentModel: unknown, currentThinking: unknown, settingsPath: string, artifactRoot?: string): Promise<void> {
	if (artifactRoot) ctx.ui.notify(`Fanout artifacts: ${artifactRoot}`, "info");
	const tierChoice = args.trim() === "tier1" || args.trim() === "tier2" ? args.trim() : await ctx.ui.select("Configure Fanout tier", ["tier1", "tier2"]);
	if (tierChoice !== "tier1" && tierChoice !== "tier2") return;

	if (tierChoice === "tier1") {
		const useCurrent = await ctx.ui.confirm("Fanout tier1", "Use the current active Pi model as the tier1 realtime default?");
		if (useCurrent) {
			const info = modelInfo(currentModel);
			writeFanoutTierSetting(settingsPath, "tier1", { provider: info.provider, model: info.model, thinking: currentThinking ?? "auto", reason: "current active Pi realtime model" });
			ctx.ui.notify(`Fanout tier1 set to ${info.provider}/${info.model}`, "info");
			return;
		}
	}

	const models = ctx.modelRegistry.getAll() as Array<Record<string, unknown>>;
	const providers = uniqueStrings(models.map((model) => stringField(model.provider)).filter((provider) => provider !== "unknown")).sort();
	if (providers.length === 0) {
		ctx.ui.notify("No providers available to configure Fanout.", "warning");
		return;
	}

	const defaultProvider = tierChoice === "tier2" && providers.includes("doubleword") ? "doubleword" : providers[0];
	const provider = await ctx.ui.select(`Fanout ${tierChoice} provider`, [defaultProvider, ...providers.filter((item) => item !== defaultProvider)]);
	if (!provider) return;

	const providerModels = models.filter((model) => stringField(model.provider) === provider);
	const modelIds = providerModels.map((model) => stringField(model.id ?? model.model)).filter((model) => model !== "unknown").sort();
	if (modelIds.length === 0) {
		ctx.ui.notify(`No models found for provider ${provider}.`, "warning");
		return;
	}

	const defaultModel = tierChoice === "tier2" && provider === "doubleword" && modelIds.includes("zai-org/GLM-5.2-FP8") ? "zai-org/GLM-5.2-FP8" : modelIds[0];
	const model = await ctx.ui.select(`Fanout ${tierChoice} model`, [defaultModel, ...modelIds.filter((item) => item !== defaultModel)]);
	if (!model) return;

	const selectedModel = providerModels.find((candidate) => stringField(candidate.id ?? candidate.model) === model);
	const thinkingChoices = thinkingOptions(selectedModel);
	const defaultThinking = tierChoice === "tier2" && thinkingChoices.includes("medium") ? "medium" : thinkingChoices[0];
	const thinking = await ctx.ui.select(`Fanout ${tierChoice} thinking`, [defaultThinking, ...thinkingChoices.filter((item) => item !== defaultThinking)]);
	if (!thinking) return;

	writeFanoutTierSetting(settingsPath, tierChoice, {
		provider,
		model,
		thinking,
		enabled: tierChoice === "tier2" ? "auto" : undefined,
		reason: tierChoice === "tier2" ? "async background worker model" : "configured realtime control-plane model",
	});
	ctx.ui.notify(`Fanout ${tierChoice} set to ${provider}/${model} (${thinking})`, "info");
}

function writeFanoutTierSetting(settingsPath: string, tier: "tier1" | "tier2", value: Record<string, unknown>): void {
	let settings: Record<string, any> = {};
	try {
		if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	} catch {
		settings = {};
	}
	settings.fanout ??= {};
	settings.fanout.tiers ??= {};
	settings.fanout.tiers[tier] = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function thinkingOptions(model: Record<string, unknown> | undefined): string[] {
	if (!model || model.reasoning !== true) return ["off"];
	const map = model.thinkingLevelMap;
	if (typeof map === "object" && map !== null) {
		const supported = ["off", "minimal", "low", "medium", "high", "xhigh"].filter((level) => (map as Record<string, unknown>)[level] !== null && (map as Record<string, unknown>)[level] !== undefined);
		if (supported.length) return supported;
	}
	return ["off", "minimal", "low", "medium", "high", "xhigh"];
}

function modelInfo(model: unknown) {
	if (typeof model !== "object" || model === null) return { provider: "unknown", model: "unknown" };
	const record = model as Record<string, unknown>;
	return { provider: stringField(record.provider), model: stringField(record.id ?? record.model) };
}

function stringField(value: unknown): string {
	return typeof value === "string" && value.trim() ? value : "unknown";
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}
