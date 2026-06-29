import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

export const RUN_ID = process.env.DOUBLEWORD_RUN_ID ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;

let cwd = process.cwd();

export function setObservabilityCwd(nextCwd: string): void {
	cwd = nextCwd;
}

export function durationMs(start: number): number {
	return Math.round((performance.now() - start) * 1000) / 1000;
}

export function writeJsonl(event: string, data: Record<string, unknown> = {}, baseCwd = cwd): void {
	try {
		const file = process.env.DOUBLEWORD_OBSERVABILITY_FILE ?? join(baseCwd, "runs", RUN_ID, "observability.jsonl");
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), runId: RUN_ID, event, ...data })}\n`, "utf8");
	} catch {
		// Observability must not break provider streaming.
	}
}
