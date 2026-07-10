import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { configureFanoutTier } from "../packages/fanout-pi/src/fanout-config.ts";

const dir = mkdtempSync(join(tmpdir(), "fanout-config-"));
const qualified = {
  provider: "doubleword",
  id: "zai-org/GLM-5.2-FP8",
  reasoning: true,
  thinkingLevelMap: { off: "off", minimal: null, low: "low", medium: "medium", high: null, xhigh: null },
  fanout: { async: true, background: true, authReady: true },
};
const partialThinking = {
  provider: "openai-codex",
  id: "gpt-5.6-sol",
  reasoning: true,
  thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
};
const models = [
  { provider: "other", reasoning: false },
  { provider: "other", id: "other-model", reasoning: false },
  { provider: "doubleword", id: "unavailable-model", reasoning: true, fanout: { async: true, background: false, authReady: true } },
  qualified,
  partialThinking,
];
const resolved = {
  tier1: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "minimal", status: "available" },
  tier2: { provider: "doubleword", model: "old-model", thinking: "low", status: "unavailable" },
  tier2Fallback: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "minimal", source: "tier1 inheritance", status: "available" },
};

const configSource = readFileSync("packages/fanout-pi/src/fanout-config.ts", "utf8");
for (const phrase of ["SelectList", "Fanout model routing", "not a third tier", "Realtime control plane", "Realtime execution fallback", "↑↓/j/k navigate · Enter configure · Esc close", "↑↓/j/k navigate · Enter select · Esc back"]) {
  if (!configSource.includes(phrase)) throw new Error(`descriptive routing selector is missing: ${phrase}`);
}

try {
  await testCurrentDisplay();
  await testQualifiedTier2Save();
  await testDisableTier2();
  await testDisableTier2WithoutModels();
  await testProjectTier2Override();
  await testUnrelatedProjectSettingsUseGlobalRole();
  await testProjectFallbackInheritanceMarker();
  await testMalformedProjectSettingsArePreserved();
  await testNoQualifiedModels();
  await testCancelDoesNotWrite();
  await testTier1PassThrough();
  await testTier1SwitchFailurePreservesSettings();
  await testTier1CleanupFailureReportsChangedModel();
  await testPiThinkingLevels();
  await testGenericAsyncProvider();
  await testExplicitFallback();
  await testFallbackInheritance();
  await testFallbackInheritanceWithoutModels();
  await testMalformedSettingsArePreserved();
  await testInvalidSettingsShapesArePreserved();
  await testUnreadableSettingsPathIsPreserved();
  await testDescriptiveTuiEscape();
  await testMainTuiJkSelection();
  await testTuiJkNavigation();
  await testTuiSubmenuEscape();
  console.log("fanout config smoke passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

async function testCurrentDisplay() {
  const calls = [];
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    return undefined;
  });
  await configureFanoutTier("", ctx, undefined, "auto", join(dir, "display.json"), join(dir, "artifacts"), resolved);
  const main = calls[0];
  assert(main.title === "Select a model role to configure · Esc to close", `bad main guidance: ${JSON.stringify(main)}`);
  assert(main.options.some((option) => option === "Tier 1 · openai-codex/gpt-5.6-sol · minimal"), `missing tier1 current value: ${JSON.stringify(main)}`);
  assert(main.options.some((option) => option === "Tier 2 · doubleword/old-model · low · unavailable"), `missing tier2 current value: ${JSON.stringify(main)}`);
  assert(main.options.includes("Tier 2 fallback · Use Tier 1"), `missing inherited fallback role: ${JSON.stringify(main)}`);
}

async function testQualifiedTier2Save() {
  const settingsPath = join(dir, "qualified.json");
  writeFileSync(settingsPath, JSON.stringify({ fanout: { tiers: { tier2: { enabled: false } } } }));
  const calls = [];
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    if (title.includes("provider")) return options.find((option) => option.startsWith("doubleword ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("zai-org/GLM-5.2-FP8 ·"));
    if (title.includes("thinking")) return "medium";
    return undefined;
  }, calls);
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, join(dir, "artifacts"), resolved);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const tier2 = settings.fanout?.tiers?.tier2;
  assert(tier2?.provider === "doubleword" && tier2.model === "zai-org/GLM-5.2-FP8" && tier2.thinking === "medium" && tier2.enabled === true, `bad tier2 settings: ${JSON.stringify(settings)}`);
  const provider = calls.find((call) => call.title?.includes("provider"));
  const model = calls.find((call) => call.title?.includes("model"));
  const thinking = calls.find((call) => call.title?.includes("thinking"));
  const main = calls.find((call) => call.title?.startsWith("Select a model role"));
  assert(provider.options.length === 2 && provider.options[0] === "Disable Tier 2 — use realtime fallback" && provider.options[1].startsWith("doubleword ·"), `unqualified provider was listed: ${JSON.stringify(provider)}`);
  assert(model.options.length === 1 && model.options[0].includes("reasoning: yes") && model.options[0].includes("thinking: off/low/medium") && model.options[0].includes("tier2: available"), `model metadata missing or unqualified model listed: ${JSON.stringify(model)}`);
  assert(thinking.title.endsWith("Esc to go back") && thinking.options.includes("medium") && !thinking.options.includes("high"), `bad thinking selector: ${JSON.stringify(thinking)}`);
  assert(main.options.includes("Tier 2 · doubleword/zai-org/GLM-5.2-FP8 · medium · available"), `saved value did not refresh main menu: ${JSON.stringify(main)}`);
}

async function testDisableTier2() {
  const settingsPath = join(dir, "disabled.json");
  writeFileSync(settingsPath, JSON.stringify({ theme: "dark", fanout: { tiers: { tier2: { provider: "doubleword", model: "worker", thinking: "low", enabled: true } } } }));
  const calls = [];
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    if (title.includes("provider")) return "Disable Tier 2 — use realtime fallback";
    return undefined;
  }, calls);
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, undefined, resolved);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const tier2 = settings.fanout?.tiers?.tier2;
  assert(settings.theme === "dark" && tier2?.provider === "doubleword" && tier2.model === "worker" && tier2.thinking === "low" && tier2.enabled === false, `disabling tier2 did not preserve settings: ${JSON.stringify(settings)}`);
  assert(calls.some((call) => call.type === "info" && call.message.includes("Eligible workers will use the realtime Tier 2 fallback")), `missing disabled routing notice: ${JSON.stringify(calls)}`);
  const main = calls.find((call) => call.title?.startsWith("Select a model role"));
  assert(main?.options.includes("Tier 2 · Disabled"), `disabled tier2 did not refresh main screen: ${JSON.stringify(main)}`);
}

async function testDisableTier2WithoutModels() {
  const settingsPath = join(dir, "disabled-empty.json");
  const calls = [];
  const ctx = makeContext([], (title) => title.includes("provider") ? "Disable Tier 2 — use realtime fallback" : undefined, calls);
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, undefined, resolved, []);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert(settings.fanout?.tiers?.tier2?.enabled === false, `tier2 could not be disabled without models: ${JSON.stringify(settings)}`);
  assert(calls.some((call) => call.type === "warning" && call.message.includes("No available tier2 models")), `missing no-model warning: ${JSON.stringify(calls)}`);
}

async function testProjectTier2Override() {
  const globalPath = join(dir, "layered-global.json");
  const projectPath = join(dir, "project", ".pi", "settings.json");
  mkdirSync(join(dir, "project", ".pi"), { recursive: true });
  writeFileSync(globalPath, JSON.stringify({ fanout: { tiers: { tier2: { provider: "doubleword", model: "global-worker", enabled: true } } } }));
  writeFileSync(projectPath, JSON.stringify({ fanout: { tiers: { tier2: { provider: "doubleword", model: "project-worker", thinking: "low", enabled: true } } } }));

  const disableCtx = makeContext(models, (title) => title.includes("provider") ? "Disable Tier 2 — use realtime fallback" : undefined);
  await configureFanoutTier("tier2", disableCtx, undefined, "auto", globalPath, undefined, resolved, models, undefined, projectPath);
  const disabledGlobal = JSON.parse(readFileSync(globalPath, "utf8")).fanout.tiers.tier2;
  const disabledProject = JSON.parse(readFileSync(projectPath, "utf8")).fanout.tiers.tier2;
  assert(disabledGlobal.enabled === true && disabledGlobal.model === "global-worker", `project disable changed global tier2: ${JSON.stringify(disabledGlobal)}`);
  assert(disabledProject.enabled === false && disabledProject.model === "project-worker" && disabledProject.thinking === "low", `project tier2 override was not disabled: ${JSON.stringify(disabledProject)}`);

  const enableCtx = makeContext(models, (title, options) => {
    if (title.includes("provider")) return options.find((option) => option.startsWith("doubleword ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("zai-org/GLM-5.2-FP8 ·"));
    if (title.includes("thinking")) return "medium";
    return undefined;
  });
  await configureFanoutTier("tier2", enableCtx, undefined, "auto", globalPath, undefined, resolved, models, undefined, projectPath);
  const enabledGlobal = JSON.parse(readFileSync(globalPath, "utf8")).fanout.tiers.tier2;
  const enabledProject = JSON.parse(readFileSync(projectPath, "utf8")).fanout.tiers.tier2;
  assert(enabledGlobal.enabled === true && enabledGlobal.model === "global-worker", `project re-enable changed global tier2: ${JSON.stringify(enabledGlobal)}`);
  assert(enabledProject.enabled === true && enabledProject.model === "zai-org/GLM-5.2-FP8" && enabledProject.thinking === "medium", `project tier2 override was not re-enabled: ${JSON.stringify(enabledProject)}`);
}

async function testUnrelatedProjectSettingsUseGlobalRole() {
  const globalPath = join(dir, "unrelated-project-global.json");
  const projectPath = join(dir, "unrelated-project.json");
  const project = JSON.stringify({ theme: "dark", fanout: { execution: { maxConcurrency: 3 } } });
  writeFileSync(globalPath, JSON.stringify({ theme: "light" }));
  writeFileSync(projectPath, project);
  const ctx = makeContext(models, (title) => title.includes("provider") ? "Disable Tier 2 — use realtime fallback" : undefined);
  await configureFanoutTier("tier2", ctx, undefined, "auto", globalPath, undefined, resolved, models, undefined, projectPath);
  const global = JSON.parse(readFileSync(globalPath, "utf8"));
  assert(global.theme === "light" && global.fanout?.tiers?.tier2?.enabled === false, `role without a project override was not written globally: ${JSON.stringify(global)}`);
  assert(readFileSync(projectPath, "utf8") === project, "unrelated project settings were changed");
}

async function testProjectFallbackInheritanceMarker() {
  const globalPath = join(dir, "fallback-layered-global.json");
  const projectPath = join(dir, "fallback-layered-project.json");
  const globalFallback = { provider: "other", model: "other-model", thinking: "off" };
  writeFileSync(globalPath, JSON.stringify({ fanout: { execution: { tier2Fallback: globalFallback } } }));
  writeFileSync(projectPath, JSON.stringify({ fanout: { execution: { maxConcurrency: 4, tier2Fallback: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "minimal" } } } }));
  const calls = [];
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    return title.includes("provider") ? "Use Tier 1" : undefined;
  }, calls);
  const explicitResolved = { ...resolved, tier2Fallback: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "minimal", source: "fanout.execution.tier2Fallback", status: "available" } };
  await configureFanoutTier("fallback", ctx, undefined, "auto", globalPath, undefined, explicitResolved, models, undefined, projectPath);
  const global = JSON.parse(readFileSync(globalPath, "utf8"));
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  assert(JSON.stringify(global.fanout.execution.tier2Fallback) === JSON.stringify(globalFallback), `project fallback reset changed global fallback: ${JSON.stringify(global)}`);
  assert(project.fanout.execution.maxConcurrency === 4 && JSON.stringify(project.fanout.execution.tier2Fallback) === JSON.stringify({ inherit: "tier1" }), `project fallback reset did not persist inheritance marker: ${JSON.stringify(project)}`);
  const main = calls.find((call) => call.title?.startsWith("Select a model role"));
  assert(main?.options.includes("Tier 2 fallback · Use Tier 1"), `project fallback reset did not refresh UI truthfully: ${JSON.stringify(main)}`);
}

async function testMalformedProjectSettingsArePreserved() {
  const globalPath = join(dir, "malformed-project-global.json");
  const projectPath = join(dir, "malformed-project.json");
  const global = JSON.stringify({ fanout: { tiers: { tier2: { enabled: true } } } });
  const malformed = `{"fanout":`;
  writeFileSync(globalPath, global);
  writeFileSync(projectPath, malformed);
  const calls = [];
  await configureFanoutTier("tier2", makeContext(models, () => undefined, calls), undefined, "auto", globalPath, undefined, resolved, models, undefined, projectPath);
  assert(readFileSync(globalPath, "utf8") === global && readFileSync(projectPath, "utf8") === malformed, "malformed project settings were changed");
  assert(calls.some((call) => call.type === "error" && call.message.includes(projectPath) && call.message.includes("were not changed")), `malformed project settings error was not actionable: ${JSON.stringify(calls)}`);
}

async function testNoQualifiedModels() {
  const settingsPath = join(dir, "none.json");
  const calls = [];
  const ctx = makeContext(models.filter((model) => model !== qualified), (title, options) => {
    calls.push({ title, options });
    return undefined;
  }, calls);
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, undefined, resolved);
  assert(!existsSync(settingsPath), "tier2 settings were written without a qualified model");
  assert(calls.some((call) => call.type === "warning" && call.message.includes("fanout.async")), `missing actionable no-model warning: ${JSON.stringify(calls)}`);
}

async function testCancelDoesNotWrite() {
  const settingsPath = join(dir, "cancel.json");
  let providerSelected = false;
  const ctx = makeContext(models, (title, options) => {
    if (title.includes("provider")) {
      providerSelected = true;
      return options.find((option) => option.startsWith("doubleword ·"));
    }
    return undefined;
  });
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, undefined, resolved);
  assert(providerSelected && !existsSync(settingsPath), "cancelled submenu wrote partial settings");
}

async function testTier1PassThrough() {
  const settingsPath = join(dir, "tier1.json");
  writeFileSync(settingsPath, JSON.stringify({ theme: "dark", fanout: { tiers: { tier1: { provider: "old", model: "old" }, tier2: { provider: "doubleword", model: "worker" } } } }));
  const calls = [];
  let selected;
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    if (title.includes("provider")) return options.find((option) => option.startsWith("other ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("other-model ·"));
    if (title.includes("thinking")) return "off";
    return undefined;
  }, calls);
  await configureFanoutTier("tier1", ctx, undefined, "auto", settingsPath, undefined, resolved, models, async (model, thinking) => {
    selected = { model, thinking };
    return true;
  });
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const provider = calls.find((call) => call.title?.includes("provider"));
  const model = calls.find((call) => call.title?.includes("model"));
  const main = calls.find((call) => call.title?.startsWith("Select a model role"));
  assert(selected?.model?.id === "other-model" && selected.thinking === "off", `tier1 did not pass through to Pi: ${JSON.stringify(selected)}`);
  assert(settings.theme === "dark" && settings.fanout.tiers.tier1 === undefined && settings.fanout.tiers.tier2.model === "worker", `tier1 override was not removed safely: ${JSON.stringify(settings)}`);
  assert(provider.options.includes("other · 1 model(s)") && model.options.length === 1 && !model.options.some((option) => option.startsWith("unknown ·")), `registry entry without model id was listed: ${JSON.stringify(calls)}`);
  assert(main.options.includes("Tier 1 · other/other-model · off") && main.options.includes("Tier 2 fallback · Use Tier 1"), `tier1 or inherited fallback did not refresh: ${JSON.stringify(main)}`);
}

async function testTier1SwitchFailurePreservesSettings() {
  for (const testCase of [
    { name: "false", change: async () => false, expectedError: "Check model authentication" },
    { name: "throw", change: async () => { throw new Error("switch exploded"); }, expectedError: "switch exploded" },
  ]) {
    const settingsPath = join(dir, `tier1-${testCase.name}.json`);
    const original = JSON.stringify({ fanout: { tiers: { tier1: { provider: "old", model: "old" }, tier2: { provider: "doubleword", model: "worker" } } } });
    writeFileSync(settingsPath, original);
    const calls = [];
    const ctx = makeContext(models, (title, options) => {
      if (title.includes("provider")) return options.find((option) => option.startsWith("other ·"));
      if (title.includes("model")) return options.find((option) => option.startsWith("other-model ·"));
      if (title.includes("thinking")) return "off";
      return undefined;
    }, calls);
    await configureFanoutTier("tier1", ctx, undefined, "auto", settingsPath, undefined, resolved, models, testCase.change);
    assert(readFileSync(settingsPath, "utf8") === original, `${testCase.name} tier1 switch failure changed settings`);
    assert(calls.some((call) => call.type === "error" && call.message.includes(testCase.expectedError)), `${testCase.name} tier1 switch failure was not actionable: ${JSON.stringify(calls)}`);
    assert(!calls.some((call) => call.type === "info" && call.message.includes("Current Pi model")), `${testCase.name} tier1 switch emitted false success`);
  }
}

async function testTier1CleanupFailureReportsChangedModel() {
  const settingsPath = join(dir, "tier1-cleanup-failure.json");
  writeFileSync(settingsPath, JSON.stringify({ fanout: { tiers: { tier1: { provider: "old", model: "old" } } } }));
  const calls = [];
  let selected;
  const ctx = makeContext(models, (title, options) => {
    if (title.includes("provider")) return options.find((option) => option.startsWith("other ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("other-model ·"));
    if (title.includes("thinking")) return "off";
    return undefined;
  }, calls);
  await configureFanoutTier("tier1", ctx, undefined, "auto", settingsPath, undefined, resolved, models, async (model, thinking) => {
    selected = { model, thinking };
    rmSync(settingsPath);
    mkdirSync(settingsPath);
    return true;
  });
  assert(selected?.model?.id === "other-model" && selected.thinking === "off", `tier1 model did not change before cleanup failure: ${JSON.stringify(selected)}`);
  assert(calls.some((call) => call.type === "warning" && call.message.includes("Tier 1 changed") && call.message.includes("legacy setting could not be removed")), `tier1 cleanup failure did not report partial success: ${JSON.stringify(calls)}`);
  assert(!calls.some((call) => call.type === "error" && call.message.includes("were not changed")), `tier1 cleanup failure falsely reported no change: ${JSON.stringify(calls)}`);
  rmSync(settingsPath, { recursive: true });
}

async function testPiThinkingLevels() {
  const settingsPath = join(dir, "pi-thinking.json");
  const calls = [];
  let selected;
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    if (title.includes("provider")) return options.find((option) => option.startsWith("openai-codex ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("gpt-5.6-sol ·"));
    if (title.includes("thinking")) return "max";
    return undefined;
  }, calls);
  await configureFanoutTier("tier1", ctx, undefined, "auto", settingsPath, undefined, resolved, models, async (model, thinking) => {
    selected = { model, thinking };
    return true;
  });
  const levels = calls.find((call) => call.title?.includes("thinking"))?.options;
  assert(JSON.stringify(levels) === JSON.stringify(["off", "minimal", "low", "medium", "high", "xhigh", "max"]), `Pi thinking levels were not preserved: ${JSON.stringify(levels)}`);
  assert(selected?.model?.id === "gpt-5.6-sol" && selected.thinking === "max", `max thinking was not passed through: ${JSON.stringify(selected)}`);
  assert(!existsSync(settingsPath), "tier1 pass-through created an empty settings file");
}

async function testGenericAsyncProvider() {
  const settingsPath = join(dir, "generic-async.json");
  const generic = { provider: "generic-async", id: "worker", reasoning: false, fanout: { async: true, background: true, authReady: true } };
  const calls = [];
  const ctx = makeContext([...models, generic], (title, options) => {
    calls.push({ title, options });
    if (title.includes("provider")) return options.find((option) => option.startsWith("generic-async ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("worker ·"));
    if (title.includes("thinking")) return "off";
    return undefined;
  }, calls);
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, undefined, resolved, [...models, generic]);
  const tier2 = JSON.parse(readFileSync(settingsPath, "utf8")).fanout.tiers.tier2;
  assert(tier2.provider === "generic-async" && tier2.model === "worker" && tier2.thinking === "off", `generic async provider was not configurable: ${JSON.stringify(tier2)}`);
}

async function testExplicitFallback() {
  const settingsPath = join(dir, "fallback-explicit.json");
  const calls = [];
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    if (title.includes("provider")) return options.find((option) => option.startsWith("other ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("other-model ·"));
    if (title.includes("thinking")) return "off";
    return undefined;
  }, calls);
  await configureFanoutTier("fallback", ctx, undefined, "auto", settingsPath, undefined, resolved);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const fallback = settings.fanout?.execution?.tier2Fallback;
  assert(fallback?.provider === "other" && fallback.model === "other-model" && fallback.thinking === "off", `explicit fallback was not saved outside tiers: ${JSON.stringify(settings)}`);
  assert(!settings.fanout?.tiers?.tier2Fallback, `fallback was incorrectly stored as a third tier: ${JSON.stringify(settings)}`);
  const provider = calls.find((call) => call.title?.includes("provider"));
  assert(provider.options.some((option) => option === "Use Tier 1") && provider.options.some((option) => option.startsWith("other ·")), `fallback model choices were restricted: ${JSON.stringify(provider)}`);
  const main = calls.find((call) => call.title?.startsWith("Select a model role"));
  assert(main.options.includes("Tier 2 fallback · other/other-model · off"), `explicit fallback did not refresh main screen: ${JSON.stringify(main)}`);
}

async function testFallbackInheritance() {
  const settingsPath = join(dir, "fallback-inherit.json");
  writeFileSync(settingsPath, JSON.stringify({ fanout: { execution: { maxConcurrency: 4, tier2Fallback: { provider: "other", model: "other-model", thinking: "off" } } } }));
  const calls = [];
  const explicitResolved = { ...resolved, tier2Fallback: { provider: "other", model: "other-model", thinking: "off", source: "fanout.execution.tier2Fallback", status: "available" } };
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    if (title.includes("provider")) return "Use Tier 1";
    return undefined;
  }, calls);
  await configureFanoutTier("tier2-fallback", ctx, undefined, "auto", settingsPath, undefined, explicitResolved);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert(settings.fanout.execution.maxConcurrency === 4 && settings.fanout.execution.tier2Fallback === undefined, `Use Tier 1 did not remove only the fallback override: ${JSON.stringify(settings)}`);
  const main = calls.find((call) => call.title?.startsWith("Select a model role"));
  assert(main.options.includes("Tier 2 fallback · Use Tier 1"), `inherited fallback did not refresh main screen: ${JSON.stringify(main)}`);
}

async function testFallbackInheritanceWithoutModels() {
  const settingsPath = join(dir, "fallback-inherit-empty.json");
  writeFileSync(settingsPath, JSON.stringify({ fanout: { execution: { maxConcurrency: 3, tier2Fallback: { provider: "other", model: "other-model" } } } }));
  const ctx = makeContext([], (title) => title.includes("provider") ? "Use Tier 1" : undefined);
  await configureFanoutTier("fallback", ctx, undefined, "auto", settingsPath, undefined, resolved);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert(settings.fanout.execution.maxConcurrency === 3 && settings.fanout.execution.tier2Fallback === undefined, `empty registry blocked fallback inheritance: ${JSON.stringify(settings)}`);
}

async function testMalformedSettingsArePreserved() {
  const settingsPath = join(dir, "malformed.json");
  const malformed = `{"theme":"dark",\n`;
  writeFileSync(settingsPath, malformed);
  const calls = await configureForSettingsFailure("tier1", settingsPath);
  assert(readFileSync(settingsPath, "utf8") === malformed, "malformed settings were replaced");
  assertSettingsFailure(calls, settingsPath);
}

async function testInvalidSettingsShapesArePreserved() {
  const cases = [
    { name: "root-array", role: "tier1", value: [1, 2] },
    { name: "fanout-array", role: "tier1", value: { fanout: [] } },
    { name: "tiers-null", role: "tier1", value: { fanout: { tiers: null } } },
    { name: "execution-primitive", role: "fallback", value: { fanout: { execution: 1 } } },
    { name: "invalid-execution-while-configuring-tier1", role: "tier1", value: { fanout: { execution: [] } } },
    { name: "invalid-tiers-while-clearing-fallback", role: "fallback", value: { fanout: { tiers: [] } } },
    { name: "invalid-tier2-while-disabling", role: "tier2-disable", value: { fanout: { tiers: { tier2: [] } } } },
  ];
  for (const testCase of cases) {
    const settingsPath = join(dir, `${testCase.name}.json`);
    const original = JSON.stringify(testCase.value);
    writeFileSync(settingsPath, original);
    const calls = await configureForSettingsFailure(testCase.role, settingsPath);
    assert(readFileSync(settingsPath, "utf8") === original, `${testCase.name} settings were replaced`);
    assertSettingsFailure(calls, settingsPath);
  }
}

async function testUnreadableSettingsPathIsPreserved() {
  const settingsPath = join(dir, "settings-directory");
  mkdirSync(settingsPath);
  writeFileSync(join(settingsPath, "marker"), "keep");
  const calls = await configureForSettingsFailure("tier1", settingsPath);
  assert(readFileSync(join(settingsPath, "marker"), "utf8") === "keep", "non-readable settings path was replaced");
  assertSettingsFailure(calls, settingsPath);
}

async function configureForSettingsFailure(role, settingsPath) {
  const calls = [];
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    if (role === "fallback" && title.includes("provider")) return "Use Tier 1";
    if (role === "tier2-disable" && title.includes("provider")) return "Disable Tier 2 — use realtime fallback";
    if (title.includes("provider")) return options.find((option) => option.startsWith("other ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("other-model ·"));
    if (title.includes("thinking")) return "off";
    return undefined;
  }, calls);
  await configureFanoutTier(role === "tier2-disable" ? "tier2" : role, ctx, undefined, "auto", settingsPath, undefined, resolved);
  return calls;
}

function assertSettingsFailure(calls, settingsPath) {
  const errors = calls.filter((call) => call.type === "error");
  assert(errors.length === 1 && errors[0].message.includes("were not changed") && errors[0].message.includes(settingsPath), `settings error was not actionable: ${JSON.stringify(calls)}`);
  assert(!calls.some((call) => call.title?.startsWith("Select a model role")), `settings error did not abort command: ${JSON.stringify(calls)}`);
  assert(!calls.some((call) => call.type === "info" && / set to |now inherits/.test(call.message)), `settings error emitted false success: ${JSON.stringify(calls)}`);
}

async function testDescriptiveTuiEscape() {
  const settingsPath = join(dir, "tui-escape.json");
  let rendered = "";
  let closed = false;
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const ctx = {
    mode: "tui",
    ui: {
      notify() {},
      async custom(factory) {
        let result;
        const component = factory({ requestRender() {} }, theme, tuiKeybindings(), (value) => { result = value; closed = value === null; });
        rendered = component.render(70).join("\n");
        component.handleInput("\x1b");
        return result;
      },
    },
    modelRegistry: { getAll: () => models },
  };
  await configureFanoutTier("", ctx, undefined, "auto", settingsPath, undefined, resolved);
  for (const phrase of ["openai-codex/gpt-5.6-sol · minimal", "Realtime control plane", "Async worker plane", "Realtime execution fallback", "↑↓/j/k navigate · Enter configure · Esc close"]) assert(rendered.includes(phrase), `TUI did not render multiline role detail: ${phrase}\n${rendered}`);
  const renderedLines = rendered.split("\n");
  assert(renderedLines.length > 10, `role selector was not multiline:\n${rendered}`);
  for (const heading of ["  Tier 2", "  Tier 2 fallback"]) {
    const index = renderedLines.indexOf(heading);
    assert(index > 0 && renderedLines[index - 1] === "", `role block was not separated before ${heading.trim()}:\n${rendered}`);
  }
  assert(renderedLines.every((line) => visibleWidth(line) <= 70), `role selector exceeded its render width:\n${rendered}`);
  assert(closed && !existsSync(settingsPath), "Escape did not close the TUI without writing");
}

async function testMainTuiJkSelection() {
  const settingsPath = join(dir, "tui-main-jk.json");
  const rendered = [];
  let dialog = 0;
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const ctx = {
    mode: "tui",
    ui: {
      notify() {},
      async custom(factory) {
        dialog++;
        let result;
        const component = factory({ requestRender() {} }, theme, tuiKeybindings(), (value) => { result = value; });
        rendered.push(component.render(80).join("\n"));
        if (dialog === 1) {
          component.handleInput("k");
          component.handleInput("\r");
        } else component.handleInput("\x1b");
        return result;
      },
    },
    modelRegistry: { getAll: () => models },
  };
  await configureFanoutTier("", ctx, undefined, "auto", settingsPath, undefined, resolved, models);
  assert(dialog === 3 && rendered[1]?.includes("Tier 2 fallback provider"), `k did not wrap to Tier 2 fallback from the routing screen: ${JSON.stringify(rendered)}`);
  assert(!existsSync(settingsPath), "cancel after main j navigation wrote settings");
}

async function testTuiJkNavigation() {
  const settingsPath = join(dir, "tui-jk.json");
  const genericModels = ["worker-a", "worker-b"].map((id) => ({
    provider: "generic-async",
    id,
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    fanout: { async: true, background: true, authReady: true },
  }));
  const registryModels = [qualified, ...genericModels];
  const rendered = [];
  let dialog = 0;
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const ctx = {
    mode: "tui",
    ui: {
      notify() {},
      async custom(factory) {
        dialog++;
        let result;
        const component = factory({ requestRender() {} }, theme, tuiKeybindings(), (value) => { result = value; });
        rendered.push(component.render(80).join("\n"));
        if (dialog === 1) {
          component.handleInput("k");
          component.handleInput("\x1b[B");
          component.handleInput("\x1b[A");
        } else if (dialog === 2) {
          component.handleInput("j");
        } else if (dialog === 3) {
          component.handleInput("k");
          component.handleInput("\x1b[A");
        }
        else {
          component.handleInput("j");
          component.handleInput("k");
          component.handleInput("\x1b");
          return result;
        }
        component.handleInput("\r");
        return result;
      },
    },
    modelRegistry: { getAll: () => registryModels },
  };
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, undefined, resolved, registryModels);
  const tier2 = JSON.parse(readFileSync(settingsPath, "utf8")).fanout.tiers.tier2;
  assert(tier2.provider === "generic-async" && tier2.model === "worker-b" && tier2.thinking === "xhigh", `j/k/arrow navigation did not select the expected model and thinking: ${JSON.stringify(tier2)}`);
  assert(rendered.slice(0, 3).every((text) => text.includes("↑↓/j/k navigate · Enter select · Esc back")), `submenu j/k guidance was missing: ${JSON.stringify(rendered)}`);
  assert(rendered[3]?.includes("↑↓/j/k navigate · Enter configure · Esc close"), `routing j/k guidance was missing: ${JSON.stringify(rendered)}`);
}

async function testTuiSubmenuEscape() {
  for (const cancelAt of [1, 2, 3]) {
    const settingsPath = join(dir, `tui-cancel-${cancelAt}.json`);
    let dialog = 0;
    const theme = { fg: (_color, text) => text, bold: (text) => text };
    const ctx = {
      mode: "tui",
      ui: {
        notify() {},
        async custom(factory) {
          dialog++;
          let result;
          const component = factory({ requestRender() {} }, theme, tuiKeybindings(), (value) => { result = value; });
          if (dialog === cancelAt || dialog === cancelAt + 1) component.handleInput("\x1b");
          else {
            if (dialog === 1) component.handleInput("j");
            component.handleInput("\r");
          }
          return result;
        },
      },
      modelRegistry: { getAll: () => [qualified] },
    };
    await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, undefined, resolved, [qualified]);
    assert(dialog === cancelAt + 1 && !existsSync(settingsPath), `Escape at submenu ${cancelAt} did not cancel safely`);
  }
}

function tuiKeybindings() {
  return {
    matches(data, action) {
      return (action === "tui.select.up" && data === "\x1b[A") ||
        (action === "tui.select.down" && data === "\x1b[B") ||
        (action === "tui.select.confirm" && data === "\r") ||
        (action === "tui.select.cancel" && data === "\x1b");
    },
  };
}

function makeContext(registryModels, choose, calls = []) {
  return {
    ui: {
      async select(title, options) {
        return choose(title, options);
      },
      notify(message, type) {
        calls.push({ message, type });
      },
    },
    modelRegistry: { getAll: () => registryModels },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
