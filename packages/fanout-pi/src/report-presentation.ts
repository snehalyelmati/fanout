import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const FANOUT_PLAN_REPORT_ENTRY = "fanout.plan-report.v1";
export const FANOUT_EXECUTION_REPORT_ENTRY = "fanout.execution-report.v1";

export interface FanoutReportData {
	schema: "fanout.report-entry";
	version: 1;
	kind: "planning" | "execution";
	runId: string;
	status: string;
	reportPath: string;
	content: string;
	details: Record<string, unknown>;
}

export function registerFanoutReportPresentation(pi: Partial<Pick<ExtensionAPI, "appendEntry" | "registerEntryRenderer">>): boolean {
	if (typeof pi.appendEntry !== "function" || typeof pi.registerEntryRenderer !== "function") return false;
	try {
		const renderer = (entry: { data?: FanoutReportData }) => ({ render: () => (entry.data?.content ?? "Fanout report unavailable").split("\n"), invalidate() {} });
		pi.registerEntryRenderer(FANOUT_PLAN_REPORT_ENTRY, renderer);
		pi.registerEntryRenderer(FANOUT_EXECUTION_REPORT_ENTRY, renderer);
		return true;
	} catch {
		return false;
	}
}

export function appendFanoutReport(
	pi: Partial<Pick<ExtensionAPI, "appendEntry">>,
	enabled: boolean,
	input: Omit<FanoutReportData, "schema" | "version" | "content">,
): void {
	if (!enabled || typeof pi.appendEntry !== "function") throw new Error("context-free Fanout report presentation is unavailable");
	const data: FanoutReportData = { schema: "fanout.report-entry", version: 1, ...input, content: readFileSync(input.reportPath, "utf8") };
	pi.appendEntry(input.kind === "planning" ? FANOUT_PLAN_REPORT_ENTRY : FANOUT_EXECUTION_REPORT_ENTRY, data);
}
