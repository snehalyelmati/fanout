import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const FANOUT_PLAN_REPORT_ENTRY = "fanout.planning-report";
export const FANOUT_EXECUTION_REPORT_ENTRY = "fanout.execution-report";

export interface FanoutReportData {
	schema: typeof FANOUT_PLAN_REPORT_ENTRY | typeof FANOUT_EXECUTION_REPORT_ENTRY;
	version: 1;
	content: string;
}

export function registerFanoutReportPresentation(pi: Partial<Pick<ExtensionAPI, "appendEntry" | "registerEntryRenderer">>): boolean {
	if (typeof pi.appendEntry !== "function" || typeof pi.registerEntryRenderer !== "function") return false;
	try {
		pi.registerEntryRenderer(FANOUT_PLAN_REPORT_ENTRY, reportRenderer(FANOUT_PLAN_REPORT_ENTRY));
		pi.registerEntryRenderer(FANOUT_EXECUTION_REPORT_ENTRY, reportRenderer(FANOUT_EXECUTION_REPORT_ENTRY));
		return true;
	} catch {
		return false;
	}
}

export function appendFanoutReport(
	pi: Partial<Pick<ExtensionAPI, "appendEntry">>,
	enabled: boolean,
	input: { kind: "planning" | "execution"; reportPath: string },
): void {
	if (!enabled || typeof pi.appendEntry !== "function") throw new Error("context-free Fanout report presentation is unavailable");
	const schema = input.kind === "planning" ? FANOUT_PLAN_REPORT_ENTRY : FANOUT_EXECUTION_REPORT_ENTRY;
	const data: FanoutReportData = { schema, version: 1, content: readFileSync(input.reportPath, "utf8") };
	pi.appendEntry(schema, data);
}

function reportRenderer(schema: FanoutReportData["schema"]) {
	return (entry: { data?: unknown }) => {
		const data = parseFanoutReportData(entry.data, schema);
		return { render: (width: number) => width <= 0 ? [""] : wrapTextWithAnsi(data.content, width).map((line) => truncateToWidth(line, width, "")), invalidate() {} };
	};
}

function parseFanoutReportData(value: unknown, schema: FanoutReportData["schema"]): FanoutReportData {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Fanout report data must be an object");
	const fields = Object.keys(value).sort();
	if (fields.join(",") !== "content,schema,version") throw new TypeError("Fanout report data has unknown or missing fields");
	const data = value as Record<string, unknown>;
	if (data.schema !== schema) throw new TypeError(`Fanout report schema must be ${schema}`);
	if (data.version !== 1) throw new TypeError("Fanout report version must be 1");
	if (typeof data.content !== "string") throw new TypeError("Fanout report content must be a string");
	return { schema, version: 1, content: data.content };
}
