import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureFanoutTier } from "../packages/fanout-pi/src/fanout-config.ts";

const dir = mkdtempSync(join(tmpdir(), "fanout-config-"));
const qualified = {
  provider: "doubleword",
  id: "zai-org/GLM-5.2-FP8",
  reasoning: true,
  thinkingLevelMap: { off: "off", low: "low", medium: "medium", high: null, xhigh: null },
  fanout: { async: true, background: true, authReady: true },
};
const models = [
  { provider: "other", reasoning: false },
  { provider: "other", id: "other-model", reasoning: false },
  { provider: "doubleword", id: "unavailable-model", reasoning: true, fanout: { async: true, background: false, authReady: true } },
  qualified,
];
const resolved = {
  tier1: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "minimal", status: "available" },
  tier2: { provider: "doubleword", model: "old-model", thinking: "low", status: "unavailable" },
  tier2Fallback: { provider: "openai-codex", model: "gpt-5.6-sol", thinking: "minimal", source: "tier1 inheritance", status: "available" },
};

const configSource = readFileSync("packages/fanout-pi/src/fanout-config.ts", "utf8");
for (const phrase of ["SelectList", "Fanout model routing", "not a third tier", "Realtime control plane", "Realtime execution fallback", "↑↓ navigate · Enter configure · Esc close"]) {
  if (!configSource.includes(phrase)) throw new Error(`descriptive routing selector is missing: ${phrase}`);
}

try {
  await testCurrentDisplay();
  await testQualifiedTier2Save();
  await testNoQualifiedModels();
  await testCancelDoesNotWrite();
  await testTier1Unrestricted();
  await testExplicitFallback();
  await testFallbackInheritance();
  await testFallbackInheritanceWithoutModels();
  await testMalformedSettingsArePreserved();
  await testInvalidSettingsShapesArePreserved();
  await testUnreadableSettingsPathIsPreserved();
  await testDescriptiveTuiEscape();
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
  assert(tier2?.provider === "doubleword" && tier2.model === "zai-org/GLM-5.2-FP8" && tier2.thinking === "medium" && tier2.enabled === "auto", `bad tier2 settings: ${JSON.stringify(settings)}`);
  const provider = calls.find((call) => call.title?.includes("provider"));
  const model = calls.find((call) => call.title?.includes("model"));
  const thinking = calls.find((call) => call.title?.includes("thinking"));
  const main = calls.find((call) => call.title?.startsWith("Select a model role"));
  assert(provider.options.length === 1 && provider.options[0].startsWith("doubleword ·"), `unqualified provider was listed: ${JSON.stringify(provider)}`);
  assert(model.options.length === 1 && model.options[0].includes("reasoning: yes") && model.options[0].includes("thinking: off/low/medium") && model.options[0].includes("tier2: available"), `model metadata missing or unqualified model listed: ${JSON.stringify(model)}`);
  assert(thinking.title.endsWith("Esc to go back") && thinking.options.includes("medium") && !thinking.options.includes("high"), `bad thinking selector: ${JSON.stringify(thinking)}`);
  assert(main.options.includes("Tier 2 · doubleword/zai-org/GLM-5.2-FP8 · medium · available"), `saved value did not refresh main menu: ${JSON.stringify(main)}`);
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
      return options[0];
    }
    return undefined;
  });
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath, undefined, resolved);
  assert(providerSelected && !existsSync(settingsPath), "cancelled submenu wrote partial settings");
}

async function testTier1Unrestricted() {
  const settingsPath = join(dir, "tier1.json");
  const calls = [];
  const ctx = makeContext(models, (title, options) => {
    calls.push({ title, options });
    if (title.includes("provider")) return options.find((option) => option.startsWith("other ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("other-model ·"));
    if (title.includes("thinking")) return "off";
    return undefined;
  }, calls);
  await configureFanoutTier("tier1", ctx, undefined, "auto", settingsPath, undefined, resolved);
  const tier1 = JSON.parse(readFileSync(settingsPath, "utf8")).fanout.tiers.tier1;
  const provider = calls.find((call) => call.title?.includes("provider"));
  const model = calls.find((call) => call.title?.includes("model"));
  assert(tier1.provider === "other" && tier1.model === "other-model", `tier1 filtering was incorrectly restricted: ${JSON.stringify(tier1)}`);
  assert(provider.options.includes("other · 1 model(s)") && model.options.length === 1 && !model.options.some((option) => option.startsWith("unknown ·")), `registry entry without model id was listed: ${JSON.stringify(calls)}`);
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
    if (title.includes("provider")) return options.find((option) => option.startsWith("other ·"));
    if (title.includes("model")) return options.find((option) => option.startsWith("other-model ·"));
    if (title.includes("thinking")) return "off";
    return undefined;
  }, calls);
  await configureFanoutTier(role, ctx, undefined, "auto", settingsPath, undefined, resolved);
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
        const component = factory({ requestRender() {} }, theme, {}, (value) => { result = value; closed = value === null; });
        rendered = component.render(120).join("\n");
        component.handleInput("\x1b");
        return result;
      },
    },
    modelRegistry: { getAll: () => models },
  };
  await configureFanoutTier("", ctx, undefined, "auto", settingsPath, undefined, resolved);
  for (const phrase of ["Realtime control plane", "Async worker plane", "Realtime execution fallback"]) assert(rendered.includes(phrase), `TUI did not render role description: ${phrase}\n${rendered}`);
  assert(closed && !existsSync(settingsPath), "Escape did not close the TUI without writing");
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
