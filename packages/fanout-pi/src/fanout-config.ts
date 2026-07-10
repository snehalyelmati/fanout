import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type ModelRole = "tier1" | "tier2" | "tier2Fallback";
type TierSummary = { provider?: unknown; model?: unknown; thinking?: unknown; source?: unknown; status?: unknown; reason?: unknown };
type ResolvedTierPlan = { tier1?: TierSummary; tier2?: TierSummary; tier2Fallback?: TierSummary };

const ROLE_DESCRIPTIONS: Record<ModelRole, string> = {
	tier1: "Realtime control plane for planning, safety, review, synthesis, final decisions, and user interaction.",
	tier2: "Async worker plane for implementation, tests, docs, and other safe parallel execution.",
	tier2Fallback: "Realtime execution fallback; does not replace Tier 1 for control, review, synthesis, or final decisions.",
};
const SETTINGS_ERROR = Symbol("settings-error");

export async function configureFanoutTier(
	args: string,
	ctx: any,
	currentModel: unknown,
	currentThinking: unknown,
	settingsPath: string,
	artifactRoot?: string,
	resolvedTierPlan: ResolvedTierPlan = {},
	registryModels?: Array<Record<string, unknown>>,
): Promise<void> {
	if (artifactRoot) ctx.ui.notify(`Fanout artifacts: ${artifactRoot}`, "info");
	const active = modelInfo(currentModel);
	const current: Required<ResolvedTierPlan> = {
		tier1: resolvedTierPlan.tier1 ?? { provider: active.provider, model: active.model, thinking: currentThinking ?? "auto", status: "available" },
		tier2: resolvedTierPlan.tier2 ?? { provider: "not configured", model: "not configured", thinking: "auto", status: "unavailable" },
		tier2Fallback: resolvedTierPlan.tier2Fallback ?? { ...resolvedTierPlan.tier1, source: "tier1 inheritance", status: "available" },
	};
	let directRole = roleArgument(args);

	while (true) {
		const role = directRole ?? await selectRoutingRole(ctx, current);
		directRole = undefined;
		if (!role) return;

		const saved = await configureRole(role, ctx, settingsPath, active, current, registryModels);
		if (saved === SETTINGS_ERROR) return;
		if (saved) current[role] = saved;
	}
}

async function selectRoutingRole(ctx: any, current: Required<ResolvedTierPlan>): Promise<ModelRole | undefined> {
	const items = (["tier1", "tier2", "tier2Fallback"] as ModelRole[]).map((role) => ({
		value: role,
		label: roleLabel(role, current[role]),
		description: ROLE_DESCRIPTIONS[role],
	}));
	if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
		const choice = await ctx.ui.select("Select a model role to configure · Esc to close", items.map((item) => item.label));
		return items.find((item) => item.label === choice)?.value;
	}

	const [{ DynamicBorder }, { Container, SelectList, Text }] = await Promise.all([
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-tui"),
	]);
	const result = await ctx.ui.custom((tui: any, theme: any, _keybindings: any, done: (value: ModelRole | null) => void) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Fanout model routing")), 1, 0));
		container.addChild(new Text("Fanout uses two execution tiers. Tier 2 fallback is a separate realtime model role, not a third tier.", 1, 1));
		const list = new SelectList(items, items.length, {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		});
		list.onSelect = (item: { value: ModelRole }) => done(item.value);
		list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate · Enter configure · Esc close"), 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
	return result ?? undefined;
}

async function configureRole(
	role: ModelRole,
	ctx: any,
	settingsPath: string,
	active: ReturnType<typeof modelInfo>,
	current: Required<ResolvedTierPlan>,
	configuredModels?: Array<Record<string, unknown>>,
): Promise<TierSummary | undefined | typeof SETTINGS_ERROR> {
	const allModels = configuredModels ?? ctx.modelRegistry.getAll() as Array<Record<string, unknown>>;
	const models = allModels.filter(hasModelId).filter((model) => role !== "tier2" || tier2Available(model));
	if (models.length === 0 && role !== "tier2Fallback") {
		ctx.ui.notify(role === "tier2" ? "No available tier2 models. A tier2 model must advertise fanout.async, fanout.background, and fanout.authReady." : `No registry models available to configure ${displayRole(role)}.`, "warning");
		return undefined;
	}

	const providers = uniqueStrings(models.map((model) => stringField(model.provider)).filter((provider) => provider !== "unknown")).sort();
	if (providers.length === 0 && role !== "tier2Fallback") {
		ctx.ui.notify(`No providers available to configure ${displayRole(role)}.`, "warning");
		return undefined;
	}
	const preferredProvider = role === "tier2" && providers.includes("doubleword") ? "doubleword" : providers.includes(active.provider) ? active.provider : providers[0];
	const orderedProviders = preferredProvider === undefined ? [] : [preferredProvider, ...providers.filter((provider) => provider !== preferredProvider)];
	const providerChoices = orderedProviders.map((provider) => ({
		value: provider,
		label: `${provider} · ${models.filter((model) => stringField(model.provider) === provider).length} model(s)`,
	}));
	if (role === "tier2Fallback") providerChoices.unshift({ value: "inherit-tier1", label: "Use Tier 1" });
	const providerChoice = await ctx.ui.select(`${displayRole(role)} provider · Esc to go back`, providerChoices.map((choice) => choice.label));
	const provider = providerChoices.find((choice) => choice.label === providerChoice)?.value;
	if (!provider) return undefined;
	if (provider === "inherit-tier1") {
		try {
			clearTier2FallbackSetting(settingsPath);
		} catch (error) {
			notifySettingsError(ctx, settingsPath, error);
			return SETTINGS_ERROR;
		}
		ctx.ui.notify("Tier 2 fallback now inherits Tier 1.", "info");
		return { ...current.tier1, source: "tier1 inheritance", status: "available", reason: "realtime fallback for tier2 execution; inherits tier1" };
	}

	const providerModels = models.filter((model) => stringField(model.provider) === provider);
	const modelChoices = providerModels.map((model) => ({ value: modelId(model)!, label: modelLabel(model) }));
	const preferredModel = role === "tier2" && provider === "doubleword" ? "zai-org/GLM-5.2-FP8" : provider === active.provider ? active.model : undefined;
	modelChoices.sort((left, right) => left.value === preferredModel ? -1 : right.value === preferredModel ? 1 : left.value.localeCompare(right.value));
	const modelChoice = await ctx.ui.select(`${displayRole(role)} model · Esc to go back`, modelChoices.map((choice) => choice.label));
	const model = modelChoices.find((choice) => choice.label === modelChoice)?.value;
	if (!model) return undefined;

	const selectedModel = providerModels.find((candidate) => modelId(candidate) === model);
	const thinkingChoices = thinkingOptions(selectedModel);
	const preferredThinking = role === "tier2" && thinkingChoices.includes("medium") ? "medium" : thinkingChoices[0];
	const thinking = await ctx.ui.select(`${displayRole(role)} thinking · Esc to go back`, [preferredThinking, ...thinkingChoices.filter((item) => item !== preferredThinking)]);
	if (!thinking) return undefined;

	try {
		writeFanoutRoleSetting(settingsPath, role, {
			provider,
			model,
			thinking,
			enabled: role === "tier2" ? "auto" : undefined,
			reason: role === "tier1" ? "configured realtime control-plane model" : role === "tier2" ? "async background worker model" : "realtime fallback for tier2 execution",
		});
	} catch (error) {
		notifySettingsError(ctx, settingsPath, error);
		return SETTINGS_ERROR;
	}
	ctx.ui.notify(`${displayRole(role)} set to ${provider}/${model} (${thinking})`, "info");
	return {
		provider,
		model,
		thinking,
		source: role === "tier2Fallback" ? "fanout.execution.tier2Fallback" : `fanout.tiers.${role}`,
		status: "available",
		reason: role === "tier1" ? "realtime control plane" : role === "tier2" ? "parallel async worker nodes" : "realtime fallback for tier2 execution",
	};
}

function roleLabel(role: ModelRole, summary: TierSummary): string {
	if (role === "tier2Fallback" && summary.source === "tier1 inheritance") return "Tier 2 fallback · Use Tier 1";
	const availability = role === "tier2" ? ` · ${stringField(summary.status)}` : "";
	return `${displayRole(role)} · ${stringField(summary.provider)}/${stringField(summary.model)} · ${stringField(summary.thinking)}${availability}`;
}

function displayRole(role: ModelRole): string {
	return role === "tier1" ? "Tier 1" : role === "tier2" ? "Tier 2" : "Tier 2 fallback";
}

function roleArgument(value: string): ModelRole | undefined {
	const argument = value.trim().toLowerCase();
	if (argument === "tier1") return "tier1";
	if (argument === "tier2") return "tier2";
	if (["fallback", "tier2-fallback", "tier2fallback"].includes(argument)) return "tier2Fallback";
	return undefined;
}

function modelLabel(model: Record<string, unknown>): string {
	const id = modelId(model) ?? "unknown";
	const thinking = thinkingOptions(model).join("/");
	const reasoning = model.reasoning === true ? "yes" : "no";
	return `${id} · reasoning: ${reasoning} · thinking: ${thinking} · tier2: ${tier2Available(model) ? "available" : "unavailable"}`;
}

function tier2Available(model: Record<string, unknown>): boolean {
	const fanout = typeof model.fanout === "object" && model.fanout !== null ? model.fanout as Record<string, unknown> : {};
	return fanout.async === true && fanout.background === true && fanout.authReady === true;
}

function hasModelId(model: Record<string, unknown>): boolean {
	return modelId(model) !== undefined;
}

function modelId(model: Record<string, unknown>): string | undefined {
	for (const value of [model.id, model.model]) if (typeof value === "string" && value.trim()) return value;
	return undefined;
}

function writeFanoutRoleSetting(settingsPath: string, role: ModelRole, value: Record<string, unknown>): void {
	const container = role === "tier2Fallback" ? "execution" : "tiers";
	const settings = readSettings(settingsPath);
	settings.fanout ??= {};
	settings.fanout[container] ??= {};
	if (role === "tier2Fallback") settings.fanout.execution.tier2Fallback = clean(value);
	else settings.fanout.tiers[role] = clean(value);
	writeSettings(settingsPath, settings);
}

function clearTier2FallbackSetting(settingsPath: string): void {
	const settings = readSettings(settingsPath);
	if (settings.fanout?.execution) delete settings.fanout.execution.tier2Fallback;
	writeSettings(settingsPath, settings);
}

function readSettings(settingsPath: string): Record<string, any> {
	const settings: unknown = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
	if (!isPlainObject(settings)) throw new Error("settings root must be a JSON object");
	if (settings.fanout !== undefined && !isPlainObject(settings.fanout)) throw new Error("fanout must be a JSON object");
	for (const container of ["tiers", "execution"] as const) {
		if (settings.fanout?.[container] !== undefined && !isPlainObject(settings.fanout[container])) throw new Error(`fanout.${container} must be a JSON object`);
	}
	return settings;
}

function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function notifySettingsError(ctx: any, settingsPath: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	ctx.ui.notify(`Fanout settings were not changed because ${settingsPath} could not be updated safely: ${message}`, "error");
}

function writeSettings(settingsPath: string, settings: Record<string, unknown>): void {
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function clean(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
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
	return { provider: stringField(record.provider), model: modelId(record) ?? "unknown" };
}

function stringField(value: unknown): string {
	return typeof value === "string" && value.trim() ? value : "unknown";
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}
