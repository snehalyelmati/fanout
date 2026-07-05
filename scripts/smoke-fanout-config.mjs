import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureFanoutTier } from "../packages/fanout-pi/src/fanout-config.ts";

const dir = mkdtempSync(join(tmpdir(), "fanout-config-"));
const settingsPath = join(dir, "settings.json");
const calls = [];
const answers = ["doubleword", "zai-org/GLM-5.2-FP8", "medium"];
const ctx = {
  ui: {
    async select(title, options) {
      calls.push({ title, options });
      return answers.shift();
    },
    async confirm() {
      throw new Error("tier2 config should not ask for tier1 confirmation");
    },
    notify(message, type) {
      calls.push({ message, type });
    },
  },
  modelRegistry: {
    getAll() {
      return [
        { provider: "other", id: "other-model", reasoning: false },
        { provider: "doubleword", id: "deepseek-ai/DeepSeek-V4-Flash", reasoning: false },
        { provider: "doubleword", id: "zai-org/GLM-5.2-FP8", reasoning: true, thinkingLevelMap: { off: "off", low: "low", medium: "medium", high: null, xhigh: null } },
      ];
    },
  },
};

try {
  await configureFanoutTier("tier2", ctx, undefined, "auto", settingsPath);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const tier2 = settings.fanout?.tiers?.tier2;
  if (tier2?.provider !== "doubleword" || tier2.model !== "zai-org/GLM-5.2-FP8" || tier2.thinking !== "medium" || tier2.enabled !== "auto") {
    throw new Error(`bad tier2 settings: ${JSON.stringify(settings)}`);
  }
  const [provider, model, thinking] = calls;
  if (provider.title !== "Fanout tier2 provider" || !provider.options.includes("doubleword")) throw new Error(`bad provider selector: ${JSON.stringify(provider)}`);
  if (model.title !== "Fanout tier2 model" || !model.options.includes("zai-org/GLM-5.2-FP8") || model.options.includes("other-model")) throw new Error(`bad model selector: ${JSON.stringify(model)}`);
  if (thinking.title !== "Fanout tier2 thinking" || thinking.options.includes("high") || !thinking.options.includes("medium")) throw new Error(`bad thinking selector: ${JSON.stringify(thinking)}`);
  console.log("fanout config smoke passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
