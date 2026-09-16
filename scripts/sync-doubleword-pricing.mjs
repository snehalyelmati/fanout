import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CATALOG_URL = "https://docs.doubleword.ai/inference-api/models";
const DOCS_ORIGIN = new URL(CATALOG_URL).origin;
const INDEX_URL = `${DOCS_ORIGIN}/llms.txt`;
const OUTPUT_PATH = "packages/doubleword-provider/src/pricing.ts";
const TIER_NAMES = new Map([
  ["Realtime", "realtime"],
  ["Async", "async"],
  ["Batch (24h)", "batch"],
]);

export function modelPagePaths(markdown) {
  const headings = [...markdown.matchAll(/^### Models\s*$/gm)];
  if (!headings.length) throw new Error("Doubleword llms.txt contained no Models section");
  const sections = headings.map((heading) => {
    const remainder = markdown.slice(heading.index + heading[0].length);
    const nextHeading = remainder.search(/\n#{1,3}\s/);
    return (nextHeading < 0 ? remainder : remainder.slice(0, nextHeading)).split("\n").map((line) => line.trim()).filter(Boolean);
  });
  const candidates = sections.filter((lines) => lines.some((line) => line.includes("(/inference-api/models/")));
  if (candidates.length !== 1) throw new Error(`Doubleword llms.txt contained ${candidates.length} model-page sections; expected 1`);
  const paths = candidates[0].map((line) => {
    const match = /^- \[[^\]]+\]\((\/inference-api\/models\/[^()\s]+\.md)\)$/.exec(line);
    if (!match) throw new Error(`Doubleword llms.txt contained an unexpected Models entry: ${line}`);
    return match[1];
  });
  if (!paths.length) throw new Error("Doubleword llms.txt contained no model page links");
  if (new Set(paths).size !== paths.length) throw new Error("Doubleword llms.txt contained duplicate model page links");
  return paths;
}

export function parseModelPricing(markdown, pageUrl = "model page") {
  const modelMatch = /\[Playground\]\(https:\/\/app\.doubleword\.ai\/playground\?model=([^&)]+)&from=%2Fmodels\)/.exec(markdown);
  if (!modelMatch) throw new Error(`${pageUrl}: missing exact model ID in Playground URL`);
  const id = decodeURIComponent(modelMatch[1]);
  if (!id.includes("/") || id !== id.trim()) throw new Error(`${pageUrl}: invalid exact model ID ${JSON.stringify(id)}`);

  const pricingMatch = /(?:^|\n)## Pricing\s*\n([\s\S]*?)(?=\n## |$)/.exec(markdown);
  if (!pricingMatch) throw new Error(`${pageUrl}: missing Pricing section`);
  const lines = pricingMatch[1].split("\n").map((line) => line.trim()).filter(Boolean);
  const tableEnd = lines.findIndex((line) => !line.startsWith("|"));
  const table = tableEnd < 0 ? lines : lines.slice(0, tableEnd);
  const footnoteLines = tableEnd < 0 ? [] : lines.slice(tableEnd);
  const footnotes = new Set(footnoteLines.map((line) => {
    const match = /^\[\^([^\]]+)\]:\s+\S.*$/.exec(line);
    if (!match) throw new Error(`${pageUrl}: unexpected Pricing content ${JSON.stringify(line)}`);
    return match[1];
  }));
  if (footnotes.size !== footnoteLines.length) throw new Error(`${pageUrl}: duplicate pricing footnote`);

  const expectedHeader = ["Priority", "Input Tokens (per 1M)", "Cache Read Tokens (per 1M)", "Output Tokens (per 1M)"];
  const header = cells(table[0] ?? "");
  if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) throw new Error(`${pageUrl}: unexpected pricing columns ${JSON.stringify(header)}`);
  if (!/^\|(?:\s*-+\s*\|){4}$/.test(table[1] ?? "")) throw new Error(`${pageUrl}: malformed pricing separator`);

  const tiers = {};
  const referencedFootnotes = new Set();
  for (const line of table.slice(2)) {
    const row = cells(line);
    if (row.length !== 4) throw new Error(`${pageUrl}: malformed pricing row ${line}`);
    const reference = /\[\^([^\]]+)\]$/.exec(row[0]);
    if (reference) referencedFootnotes.add(reference[1]);
    const label = row[0].replace(/\[\^[^\]]+\]$/, "").trim();
    const tier = TIER_NAMES.get(label);
    if (!tier) throw new Error(`${pageUrl}: unexpected pricing tier ${JSON.stringify(row[0])}`);
    if (tiers[tier]) throw new Error(`${pageUrl}: duplicate ${tier} pricing row`);
    tiers[tier] = { input: price(row[1], pageUrl), cacheRead: price(row[2], pageUrl), output: price(row[3], pageUrl) };
  }
  if (!Object.keys(tiers).length) throw new Error(`${pageUrl}: pricing table contained no tiers`);
  if ([...referencedFootnotes].some((name) => !footnotes.has(name)) || [...footnotes].some((name) => !referencedFootnotes.has(name))) throw new Error(`${pageUrl}: pricing footnotes do not match table references`);
  return { id, tiers };
}

export function renderPricingSnapshot(entries, retrievedAt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt)) throw new Error(`invalid retrieval date ${JSON.stringify(retrievedAt)}`);
  const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
  if (!sorted.length || new Set(sorted.map((entry) => entry.id)).size !== sorted.length) throw new Error("pricing entries must be non-empty with unique exact model IDs");
  const pricing = Object.fromEntries(sorted.map((entry) => [entry.id, entry.tiers]));
  const snapshotSha256 = createHash("sha256").update(JSON.stringify(pricing)).digest("hex");
  return `// Generated by npm run sync:doubleword-pricing. Review before committing.\n\nexport type DoublewordPricingTier = "realtime" | "async" | "batch";\nexport type DoublewordTokenPrices = { input: number; cacheRead: number; output: number };\nexport type DoublewordTierPrices = Partial<Record<DoublewordPricingTier, DoublewordTokenPrices>>;\n\nexport const DOUBLEWORD_PRICING_PROVENANCE = ${JSON.stringify({ sourceUrl: CATALOG_URL, retrievedAt, snapshotSha256 }, null, "\t")} as const;\n\nexport const DOUBLEWORD_TIER_PRICING: Readonly<Record<string, Readonly<DoublewordTierPrices>>> = ${JSON.stringify(pricing, null, "\t")};\n`;
}

function cells(line) {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function price(value, pageUrl) {
  const match = /^\\?\$(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) throw new Error(`${pageUrl}: malformed price ${JSON.stringify(value)}`);
  return Number(match[1]);
}

async function fetchMarkdown(url) {
  const response = await fetch(url, { headers: { accept: "text/markdown,text/plain" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const paths = modelPagePaths(await fetchMarkdown(INDEX_URL));
  const entries = await Promise.all(paths.map(async (path) => parseModelPricing(await fetchMarkdown(new URL(path, DOCS_ORIGIN)), new URL(path, DOCS_ORIGIN).href)));
  const output = renderPricingSnapshot(entries, new Date().toISOString().slice(0, 10));
  writeFileSync(resolve(OUTPUT_PATH), output, "utf8");
  console.log(`wrote ${OUTPUT_PATH} (${entries.length} exact model IDs)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
