import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

let runId = process.env.DOUBLEWORD_RUN_ID ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
let activeTurnIndex: number | undefined;

export function setDoublewordActiveTurnIndex(turnIndex: number | undefined): void {
	activeTurnIndex = turnIndex;
}

export function getDoublewordActiveTurnIndex(): number | undefined {
	return activeTurnIndex;
}

export function setDoublewordRunId(nextRunId: string): void {
	runId = nextRunId;
}

export function durationMs(start: number): number {
	return Math.round((performance.now() - start) * 1000) / 1000;
}

export function writeJsonl(event: string, data: Record<string, unknown> = {}, baseCwd = process.cwd()): void {
	try {
		const file = process.env.DOUBLEWORD_OBSERVABILITY_FILE ?? join(baseCwd, "runs", runId, "observability.jsonl");
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), runId, event, ...data })}\n`, "utf8");
	} catch {
		// Observability must not break provider streaming.
	}
}
