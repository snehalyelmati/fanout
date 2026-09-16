import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSessionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  appendFanoutReport,
  FANOUT_EXECUTION_REPORT_ENTRY,
  FANOUT_PLAN_REPORT_ENTRY,
  registerFanoutReportPresentation,
} from "../packages/fanout-pi/src/report-presentation.ts";

export async function testPlanningPresentation(root) {
  testReportPresentation(root);
  await testA15ProviderContext(root);
}

function testReportPresentation(root) {
  const reportPath = join(root, "report.md");
  writeFileSync(reportPath, "PRIVATE_REPORT\n");
  const registrations = [];
  const entries = [];
  const safe = {
    registerEntryRenderer: (type, renderer) => registrations.push({ type, renderer }),
    appendEntry: (type, data) => entries.push({ type, data }),
    sendMessage: () => { throw new Error("context-bearing fallback used"); },
    sendUserMessage: () => { throw new Error("context-bearing fallback used"); },
  };
  assert(registerFanoutReportPresentation(safe), "safe report capabilities were rejected");
  assert(registrations.map((entry) => entry.type).join(",") === `${FANOUT_PLAN_REPORT_ENTRY},${FANOUT_EXECUTION_REPORT_ENTRY}`, "versioned report renderers were not registered");
  appendFanoutReport(safe, true, { kind: "planning", reportPath });
  appendFanoutReport(safe, true, { kind: "execution", reportPath });
  assert(entries.length === 2 && entries.every((entry) => entry.data.content === "PRIVATE_REPORT\n"), "report entries did not retain artifact-derived data");
  assert(JSON.stringify(entries.map((entry) => [entry.type, entry.data.schema, Object.keys(entry.data).sort()])) === JSON.stringify([[FANOUT_PLAN_REPORT_ENTRY, "fanout.planning-report", ["content", "schema", "version"]], [FANOUT_EXECUTION_REPORT_ENTRY, "fanout.execution-report", ["content", "schema", "version"]]]), "report entries were not the two closed presentation-only v1 schemas");
  assert(registrations[0].renderer({ data: entries[0].data }).render(80).join("\n").includes("PRIVATE_REPORT"), "renderer did not use entry.data");
  const narrowLines = registrations[0].renderer({ data: { ...entries[0].data, content: `Objective: ${"abort scheduling cleanup ".repeat(20)}` } }).render(40);
  assert(narrowLines.length > 1 && narrowLines.every((line) => visibleWidth(line) <= 40), "planning report renderer exceeded Pi's render width");
  for (const { width, content } of [{ width: 0, content: "zero" }, { width: 1, content: "✅" }]) {
    const lines = registrations[0].renderer({ data: { ...entries[0].data, content } }).render(width);
    assert(lines.every((line) => visibleWidth(line) <= width), `planning report renderer exceeded edge width ${width}`);
  }
  for (const invalid of [
    undefined,
    { schema: FANOUT_PLAN_REPORT_ENTRY, version: 1 },
    { schema: FANOUT_PLAN_REPORT_ENTRY, version: 2, content: "future" },
    { schema: FANOUT_PLAN_REPORT_ENTRY, version: 1, content: "mixed", legacyPath: reportPath },
    { schema: FANOUT_EXECUTION_REPORT_ENTRY, version: 1, content: "cross-type" },
  ]) expectThrows(() => registrations[0].renderer({ data: invalid }), /Fanout report/, "planning renderer admitted non-v1 report data");
  expectThrows(() => registrations[1].renderer({ data: entries[0].data }), /Fanout report schema/, "execution renderer admitted planning report data");

  assert(!registerFanoutReportPresentation({}), "missing report capabilities did not fail closed");
  assert(!registerFanoutReportPresentation({ appendEntry() {} }), "partial report capabilities did not fail closed");
  assert(!registerFanoutReportPresentation({ appendEntry() {}, registerEntryRenderer() { throw new Error("registration failed"); } }), "throwing renderer registration did not fail closed");
  expectThrows(() => appendFanoutReport({ appendEntry() { throw new Error("append failed"); } }, true, { kind: "planning", reportPath }), /append failed/, "throwing report append");
  expectThrows(() => appendFanoutReport(safe, false, { kind: "planning", reportPath }), /unavailable/, "disabled report presentation");
}

async function testA15ProviderContext(root) {
  for (const mode of ["tui", "rpc", "json", "print"]) {
    const appended = [];
    const pi = { registerEntryRenderer() {}, appendEntry: (customType, data) => appended.push({ customType, data }) };
    assert(registerFanoutReportPresentation(pi), `report presentation unavailable in ${mode} mode`);
    for (const kind of ["planning", "execution"]) {
      const reportPath = join(root, `${mode}-${kind}-report.md`);
      writeFileSync(reportPath, `PRIVATE_${mode.toUpperCase()}_${kind.toUpperCase()}_REPORT\n`);
      appendFanoutReport(pi, true, { kind, reportPath });
    }
    const reportEntries = appended.map((entry, index) => ({ type: "custom", id: `report-${mode}-${index}`, parentId: index ? `report-${mode}-${index - 1}` : null, timestamp: "2026-07-13T00:00:00.000Z", ...entry }));
    const serialized = JSON.stringify({ messages: buildSessionContext(reportEntries).messages });
    assert(!serialized.includes(`PRIVATE_${mode.toUpperCase()}`) && !serialized.includes(FANOUT_PLAN_REPORT_ENTRY) && !serialized.includes(FANOUT_EXECUTION_REPORT_ENTRY), `A15 failed in ${mode} mode`);
  }
}

function expectThrows(fn, pattern, label) {
  try { fn(); } catch (error) { if (pattern.test(String(error))) return; throw error; }
  throw new Error(`${label} did not throw`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
