import type { ExecutionRunProjection } from "./execution-projection.ts";

export function renderExecutionReport(projection: ExecutionRunProjection): string {
	const outcome = projection.terminalOutcome?.outcome ?? "none";
	const final = projection.finalValidation;
	const dispositions = projection.attempts.map((attempt) => attempt.outcome?.disposition);
	const unusedRepairBudget = Object.values(projection.budgets).reduce((total, budget) => total + (2 - budget.validationRepair) + (2 - budget.integrationRepair), 0);
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
		...projection.nodes.map((node) => `| ${cell(node.id)} | ${node.status} | ${node.attemptIds.length} | ${cell(node.failFastCause ? `fail-fast: ${node.failFastCause.nodeId} / ${node.failFastCause.attemptId}` : node.causalAttemptId ?? node.causalUpstreamNodeId ?? "—")} |`),
		"",
		"## Totals",
		"",
		`- Attempts: ${projection.totals.attempts}`,
		`- Tokens: ${number(projection.totals.totalTokens)} (${number(projection.totals.inputTokens)} in / ${number(projection.totals.outputTokens)} out / ${number(projection.totals.cacheReadTokens)} cache read / ${number(projection.totals.cacheWriteTokens)} cache write)`,
		`- Estimated cost: ${projection.totals.estimatedCostUsd === null ? "unavailable" : `$${projection.totals.estimatedCostUsd.toFixed(6)}`}`,
		`- Observed cost (may be partial): $${projection.totals.observedCostUsd.toFixed(6)}`,
		`- Final controller command time (all rounds): ${number(projection.totals.finalValidationDurationMs)} ms`,
		`- Worker/tool/poll time: ${number(projection.totals.workerDurationMs)} / ${number(projection.totals.toolDurationMs)} / ${number(projection.totals.pollDurationMs)} ms`,
		`- Accepted patch: ${projection.totals.filesChanged} files, +${projection.totals.insertions}/-${projection.totals.deletions}`,
		`- Run duration: ${number(projection.totals.runDurationMs)} ms`,
		`- Cleanup duration: ${number(projection.terminalOutcome?.cleanupDurationMs ?? 0)} ms`,
		"",
		"## Repair control",
		"",
		`- Exact no-progress terminations: ${dispositions.filter((value) => value === "exact-no-progress").length}`,
		`- Budget-exhausted terminations: ${dispositions.filter((value) => value === "budget-exhausted").length}`,
		`- Changed repair states: ${dispositions.filter((value) => value === "changed").length}`,
		`- Unused repair attempts: ${unusedRepairBudget}`,
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

function number(value: number | null): string {
	if (value === null) return "unavailable";
	return String(Math.round(value * 1000) / 1000);
}

function cell(value: string): string {
	return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function code(value: string): string {
	return value.replace(/`/g, "\\`");
}
