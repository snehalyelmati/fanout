import type { ExecutionRunProjection } from "./execution-projection.ts";

export function renderExecutionReport(projection: ExecutionRunProjection): string {
	const outcome = projection.terminalOutcome?.outcome ?? "none";
	const final = projection.finalValidation;
	const lines = [
		"# Fanout Execution Report",
		"",
		`- Run: \`${code(projection.runId)}\``,
		`- Mode: **${projection.mode}**`,
		`- Phase: **${projection.phase}**`,
		`- Outcome: **${outcome}**`,
		`- Final validation: **${final.disposition}${final.disposition === "not-run" ? ` (${final.reason})` : ""}**`,
		...(projection.terminalOutcome ? [] : ["- No terminal outcome was recorded; replay did not resume or classify the run."]),
		"",
		"## Nodes",
		"",
		"| Node | Status | Attempts | Cause |",
		"| --- | --- | ---: | --- |",
		...projection.nodes.map((node) => `| ${cell(node.id)} | ${node.status} | ${node.attemptIds.length} | ${cell(node.causalAttemptId ?? node.causalUpstreamNodeId ?? "—")} |`),
		"",
		"## Totals",
		"",
		`- Attempts: ${projection.totals.attempts}`,
		`- Tokens: ${projection.totals.totalTokens} (${projection.totals.inputTokens} in / ${projection.totals.outputTokens} out)`,
		`- Estimated cost: $${projection.totals.estimatedCostUsd.toFixed(6)}`,
		`- Worker/tool/poll time: ${number(projection.totals.workerDurationMs)} / ${number(projection.totals.toolDurationMs)} / ${number(projection.totals.pollDurationMs)} ms`,
		`- Accepted patch: ${projection.totals.filesChanged} files, +${projection.totals.insertions}/-${projection.totals.deletions}`,
		`- Run duration: ${number(projection.totals.runDurationMs)} ms`,
		"",
		"## Accepted ledger",
		"",
		...(projection.acceptedLedger.length ? projection.acceptedLedger.map((entry) => `- ${entry.eventSequence}: \`${code(entry.attemptId)}\` ${entry.transition.patch.baseTree} → ${entry.transition.patch.resultTree}`) : ["- None"]),
		"",
		"## Artifacts",
		"",
		"- [events.jsonl](<events.jsonl>)",
		"- [execution-run.json](<execution-run.json>)",
		"- [summary.md](<summary.md>)",
		"",
	];
	return lines.join("\n");
}

function number(value: number): string {
	return String(Math.round(value * 1000) / 1000);
}

function cell(value: string): string {
	return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function code(value: string): string {
	return value.replace(/`/g, "\\`");
}
