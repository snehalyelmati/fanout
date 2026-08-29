import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { supportedThinkingLevels, TIER2_DEFAULT } from "./fanout-runtime-context.ts";

type ModelRole = "tier1" | "tier2" | "tier2Fallback";
type TierSummary = { provider?: unknown; model?: unknown; thinking?: unknown; source?: unknown; status?: unknown; reason?: unknown };
type ResolvedTierPlan = { tier1?: TierSummary; tier2?: TierSummary; tier2Fallback?: TierSummary };
type SetCurrentModel = (model: Record<string, unknown>, thinking: string) => Promise<boolean>;

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
	setCurrentModel?: SetCurrentModel,
	projectSettingsPath?: string,
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

		let roleSettingsPath: string;
		try {
			roleSettingsPath = effectiveSettingsPath(settingsPath, projectSettingsPath, role);
		} catch (error) {
			notifySettingsError(ctx, projectSettingsPath ?? settingsPath, error);
			return;
		}
		const saved = await configureRole(role, ctx, roleSettingsPath, active, current, registryModels, setCurrentModel, roleSettingsPath === projectSettingsPath);
		if (saved === SETTINGS_ERROR) return;
		if (!saved) continue;
		current[role] = saved;
		if (role === "tier1" && current.tier2Fallback.source === "tier1 inheritance") {
			current.tier2Fallback = { ...saved, source: "tier1 inheritance", reason: "realtime fallback for tier2 execution; inherits tier1" };
		}
	}
}

async function selectRoutingRole(ctx: any, current: Required<ResolvedTierPlan>): Promise<ModelRole | undefined> {
	const items = (["tier1", "tier2", "tier2Fallback"] as ModelRole[]).map((role) => ({
		value: role,
		label: roleLabel(role, current[role]),
		detail: roleDetail(role, current[role]),
		description: ROLE_DESCRIPTIONS[role],
	}));
	if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
		const choice = await ctx.ui.select("Select a model role to configure · Esc to close", items.map((item) => item.label));
		return items.find((item) => item.label === choice)?.value;
	}

	const [{ DynamicBorder }, { Container, Text, matchesKey, wrapTextWithAnsi }] = await Promise.all([
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-tui"),
	]);
	const result = await ctx.ui.custom((tui: any, theme: any, keybindings: any, done: (value: ModelRole | null) => void) => {
		let selectedIndex = 0;
		const list = {
			render(width: number) {
				const lines: string[] = [];
				for (let index = 0; index < items.length; index++) {
					const item = items[index];
					const selected = index === selectedIndex;
					lines.push((selected ? theme.fg("accent", "→ ") : "  ") + (selected ? theme.fg("accent", theme.bold(displayRole(item.value))) : displayRole(item.value)));
					for (const line of wrapTextWithAnsi(selected ? theme.fg("text", item.detail) : theme.fg("muted", item.detail), Math.max(1, width - 4))) lines.push(`    ${line}`);
					for (const line of wrapTextWithAnsi(selected ? theme.fg("text", item.description) : theme.fg("dim", item.description), Math.max(1, width - 4))) lines.push(`    ${line}`);
					if (index < items.length - 1) lines.push("");
				}
				return lines;
			},
			invalidate() {},
			handleInput(data: string) {
				if (keybindings.matches(data, "tui.select.up") || matchesKey(data, "k")) selectedIndex = selectedIndex === 0 ? items.length - 1 : selectedIndex - 1;
				else if (keybindings.matches(data, "tui.select.down") || matchesKey(data, "j")) selectedIndex = selectedIndex === items.length - 1 ? 0 : selectedIndex + 1;
				else if (keybindings.matches(data, "tui.select.confirm")) done(items[selectedIndex].value);
				else if (keybindings.matches(data, "tui.select.cancel")) done(null);
			},
		};
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Fanout model routing")), 1, 0));
		container.addChild(new Text("Fanout uses two execution tiers. Tier 2 fallback is a separate realtime model role, not a third tier.", 1, 1));
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓/j/k navigate · Enter configure · Esc close"), 1, 0));
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

async function selectOption(ctx: any, title: string, choices: string[]): Promise<string | undefined> {
	if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") return ctx.ui.select(title, choices);
	const [{ DynamicBorder }, { Container, SelectList, Text, matchesKey }] = await Promise.all([
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-tui"),
	]);
	return await ctx.ui.custom((tui: any, theme: any, _keybindings: any, done: (value: string | undefined) => void) => {
		const items = choices.map((choice) => ({ value: choice, label: choice }));
		const list = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		});
		list.onSelect = (item: { value: string }) => done(item.value);
		list.onCancel = () => done(undefined);
		const move = (offset: number) => {
			const selected = list.getSelectedItem();
			const index = Math.max(0, items.findIndex((item) => item.value === selected?.value));
			list.setSelectedIndex((index + offset + items.length) % items.length);
		};
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓/j/k navigate · Enter select · Esc back"), 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "k")) move(-1);
				else if (matchesKey(data, "j")) move(1);
				else list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

async function configureRole(
	role: ModelRole,
	ctx: any,
	settingsPath: string,
	active: ReturnType<typeof modelInfo>,
	current: Required<ResolvedTierPlan>,
	configuredModels?: Array<Record<string, unknown>>,
	setCurrentModel?: SetCurrentModel,
	projectOverride = false,
): Promise<TierSummary | undefined | typeof SETTINGS_ERROR> {
	const allModels = configuredModels ?? ctx.modelRegistry.getAll() as Array<Record<string, unknown>>;
	const models = allModels.filter(hasModelId).filter((model) => role !== "tier2" || tier2Available(model));
	if (models.length === 0 && role !== "tier2Fallback" && role !== "tier2") {
		ctx.ui.notify(`No registry models available to configure ${displayRole(role)}.`, "warning");
		return undefined;
	}
	if (models.length === 0 && role === "tier2") {
		ctx.ui.notify("No available tier2 models. A tier2 model must advertise fanout.async, fanout.background, and fanout.authReady.", "warning");
	}

	const providers = uniqueStrings(models.map((model) => stringField(model.provider)).filter((provider) => provider !== "unknown")).sort();
	if (providers.length === 0 && role !== "tier2Fallback" && role !== "tier2") {
		ctx.ui.notify(`No providers available to configure ${displayRole(role)}.`, "warning");
		return undefined;
	}
	const preferredProvider = role === "tier2" && providers.includes("doubleword") ? "doubleword" : providers.includes(active.provider) ? active.provider : providers[0];
	const orderedProviders = preferredProvider === undefined ? [] : [preferredProvider, ...providers.filter((provider) => provider !== preferredProvider)];
	const providerChoices = orderedProviders.map((provider) => ({
		value: provider,
		label: `${provider} · ${models.filter((model) => stringField(model.provider) === provider).length} model(s)`,
	}));
	if (role === "tier2") providerChoices.unshift({ value: "disable-tier2", label: "Disable Tier 2 — use realtime fallback" });
	if (role === "tier2Fallback") providerChoices.unshift({ value: "inherit-tier1", label: "Use Tier 1" });
	const providerChoice = await selectOption(ctx, `${displayRole(role)} provider · Esc to go back`, providerChoices.map((choice) => choice.label));
	const provider = providerChoices.find((choice) => choice.label === providerChoice)?.value;
	if (!provider) return undefined;
	if (provider === "disable-tier2") {
		try {
			disableTier2(settingsPath);
		} catch (error) {
			notifySettingsError(ctx, settingsPath, error);
			return SETTINGS_ERROR;
		}
		ctx.ui.notify("Tier 2 disabled. Eligible workers will use the realtime Tier 2 fallback in newly planned packets.", "info");
		return { ...current.tier2, status: "unavailable", reason: "tier2 disabled in fanout.tiers.tier2.enabled" };
	}
	if (provider === "inherit-tier1") {
		try {
			inheritTier1Fallback(settingsPath, projectOverride);
		} catch (error) {
			notifySettingsError(ctx, settingsPath, error);
			return SETTINGS_ERROR;
		}
		ctx.ui.notify("Tier 2 fallback now inherits Tier 1.", "info");
		return { ...current.tier1, source: "tier1 inheritance", status: "available", reason: "realtime fallback for tier2 execution; inherits tier1" };
	}

	const providerModels = models.filter((model) => stringField(model.provider) === provider);
	const modelChoices = providerModels.map((model) => ({ value: modelId(model)!, label: modelLabel(model) }));
	const preferredModel = role === "tier2" && provider === TIER2_DEFAULT.provider ? TIER2_DEFAULT.model : provider === active.provider ? active.model : undefined;
	modelChoices.sort((left, right) => left.value === preferredModel ? -1 : right.value === preferredModel ? 1 : left.value.localeCompare(right.value));
	const modelChoice = await selectOption(ctx, `${displayRole(role)} model · Esc to go back`, modelChoices.map((choice) => choice.label));
	const model = modelChoices.find((choice) => choice.label === modelChoice)?.value;
	if (!model) return undefined;

	const selectedModel = providerModels.find((candidate) => modelId(candidate) === model);
	const thinkingChoices = thinkingOptions(selectedModel);
	const preferredThinking = role === "tier2" && thinkingChoices.includes("medium") ? "medium" : thinkingChoices[0];
	const thinking = await selectOption(ctx, `${displayRole(role)} thinking · Esc to go back`, [preferredThinking, ...thinkingChoices.filter((item) => item !== preferredThinking)]);
	if (!thinking || !selectedModel) return undefined;

	if (role === "tier1") {
		try {
			if (existsSync(settingsPath)) readSettings(settingsPath);
		} catch (error) {
			notifySettingsError(ctx, settingsPath, error);
			return SETTINGS_ERROR;
		}
		let changed = false;
		try {
			changed = setCurrentModel ? await setCurrentModel(selectedModel, thinking) : false;
		} catch (error) {
			ctx.ui.notify(`Could not switch the current Pi model to ${provider}/${model}: ${error instanceof Error ? error.message : String(error)}`, "error");
			return undefined;
		}
		if (!changed) {
			ctx.ui.notify(`Could not switch the current Pi model to ${provider}/${model}. Check model authentication.`, "error");
			return undefined;
		}
		const saved = { provider, model, thinking, source: "current Pi active model", status: "available", reason: "realtime control plane" };
		try {
			clearTier1Setting(settingsPath);
		} catch (error) {
			ctx.ui.notify(`Current Pi model and Tier 1 changed to ${provider}/${model} (${thinking}), but the legacy setting could not be removed from ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`, "warning");
			return saved;
		}
		ctx.ui.notify(`Current Pi model and Tier 1 set to ${provider}/${model} (${thinking})`, "info");
		return saved;
	}

	try {
		writeFanoutRoleSetting(settingsPath, role, {
			provider,
			model,
			thinking,
			enabled: role === "tier2" ? true : undefined,
			reason: role === "tier2" ? "async background worker model" : "realtime fallback for tier2 execution",
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
		source: role === "tier2Fallback" ? "fanout.execution.tier2Fallback" : "fanout.tiers.tier2",
		status: "available",
		reason: role === "tier2" ? "parallel async worker nodes" : "realtime fallback for tier2 execution",
	};
}

function roleLabel(role: ModelRole, summary: TierSummary): string {
	return `${displayRole(role)} · ${roleDetail(role, summary)}`;
}

function roleDetail(role: ModelRole, summary: TierSummary): string {
	if (role === "tier2Fallback" && summary.source === "tier1 inheritance") return "Use Tier 1";
	if (role === "tier2" && typeof summary.reason === "string" && summary.reason.includes("tier2 disabled")) return "Disabled";
	const availability = role === "tier2" ? ` · ${stringField(summary.status)}` : "";
	return `${stringField(summary.provider)}/${stringField(summary.model)} · ${stringField(summary.thinking)}${availability}`;
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

function effectiveSettingsPath(globalPath: string, projectPath: string | undefined, role: ModelRole): string {
	if (!projectPath || !existsSync(projectPath)) return globalPath;
	const settings = readSettings(projectPath);
	const container = role === "tier2Fallback" ? settings.fanout?.execution : settings.fanout?.tiers;
	const key = role === "tier2Fallback" ? "tier2Fallback" : role;
	return isPlainObject(container) && Object.prototype.hasOwnProperty.call(container, key) ? projectPath : globalPath;
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

function clearTier1Setting(settingsPath: string): void {
	if (!existsSync(settingsPath)) return;
	const settings = readSettings(settingsPath);
	if (!settings.fanout?.tiers || !("tier1" in settings.fanout.tiers)) return;
	delete settings.fanout.tiers.tier1;
	writeSettings(settingsPath, settings);
}

function disableTier2(settingsPath: string): void {
	const settings = readSettings(settingsPath);
	settings.fanout ??= {};
	settings.fanout.tiers ??= {};
	const tier2 = settings.fanout.tiers.tier2;
	if (tier2 !== undefined && !isPlainObject(tier2)) throw new Error("fanout.tiers.tier2 must be a JSON object");
	settings.fanout.tiers.tier2 = { ...tier2, enabled: false };
	writeSettings(settingsPath, settings);
}

function inheritTier1Fallback(settingsPath: string, projectOverride: boolean): void {
	const settings = readSettings(settingsPath);
	if (projectOverride) {
		settings.fanout ??= {};
		settings.fanout.execution ??= {};
		settings.fanout.execution.tier2Fallback = { inherit: "tier1" };
	} else if (settings.fanout?.execution) {
		delete settings.fanout.execution.tier2Fallback;
	}
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
	return supportedThinkingLevels(model);
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
