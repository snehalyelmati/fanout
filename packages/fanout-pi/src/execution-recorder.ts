import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	EXECUTION_EVENT_NAMES,
	EXECUTION_RUN_SCHEMA,
	EXECUTION_RUN_VERSION,
	validateWorkerMetrics,
	type ExecutionEventName,
	type ExecutionNodeSnapshot,
	type ExecutionNodeStatus,
	type ExecutionRunSnapshot,
	type ExecutionRunStatus,
	type ExecutionRunTotals,
	type PatchStats,
	type ValidationStats,
	type WorkerMetrics,
} from "../../fanout-core/src/execution-run.ts";

export interface ExecutionRecorderOptions {
	runId: string;
	packetPath: string;
	nodeIds: string[];
	now?: () => Date;
}

export interface ExecutionRecorderPaths {
	runDir: string;
	eventsPath: string;
	snapshotPath: string;
	summaryPath: string;
}

export interface AttemptMetricOptions {
	accepted?: boolean;
}

type FinishedExecutionRunStatus = Exclude<ExecutionRunStatus, "running">;

const EVENT_NAMES = new Set<string>(EXECUTION_EVENT_NAMES);
const NODE_EVENT_STATUS: Partial<Record<ExecutionEventName, ExecutionNodeStatus>> = {
	node_ready: "ready",
	node_started: "running",
	node_succeeded: "succeeded",
	node_failed: "failed",
	node_skipped: "skipped",
};
const ATTEMPT_TOTAL_FIELDS = ["inputTokens", "outputTokens", "totalTokens", "estimatedCostUsd", "workerDurationMs", "toolDurationMs", "pollDurationMs"] as const;
const WORKER_NUMBER_FIELDS = ["inputTokens", "outputTokens", "totalTokens", "estimatedCostUsd", "ttftMs", "pollCount", "pollDurationMs", "toolDurationMs", "workerDurationMs"] as const;
const PATCH_NUMBER_FIELDS = ["filesChanged", "insertions", "deletions", "applyDurationMs"] as const;

export class ExecutionRecorder {
	readonly runDir: string;
	readonly eventsPath: string;
	readonly snapshotPath: string;
	readonly summaryPath: string;

	readonly #now: () => Date;
	#state: ExecutionRunSnapshot;
	#attemptMetrics = new Map<string, Partial<WorkerMetrics>>();

	constructor(options: ExecutionRecorderOptions) {
		validateRunId(options.runId);
		validateNodeIds(options.nodeIds);
		this.#now = options.now ?? (() => new Date());

		const packetPath = resolve(options.packetPath);
		this.runDir = join(dirname(packetPath), "executions", options.runId);
		this.eventsPath = join(this.runDir, "events.jsonl");
		this.snapshotPath = join(this.runDir, "execution-run.json");
		this.summaryPath = join(this.runDir, "summary.md");

		const startedAt = this.#timestamp();
		this.#state = {
			schema: EXECUTION_RUN_SCHEMA,
			version: EXECUTION_RUN_VERSION,
			runId: options.runId,
			packetPath,
			artifactDir: this.runDir,
			startedAt,
			status: "running",
			nodes: options.nodeIds.map((id) => ({ id, status: "pending" })),
			totals: emptyTotals(),
			eventCounts: {},
		};

		mkdirSync(dirname(this.runDir), { recursive: true });
		mkdirSync(this.runDir);
		writeFileSync(this.eventsPath, "", { encoding: "utf8", flag: "wx" });
		writeFileSync(this.snapshotPath, serialize(this.#state), { encoding: "utf8", flag: "wx" });
	}

	get paths(): ExecutionRecorderPaths {
		return { runDir: this.runDir, eventsPath: this.eventsPath, snapshotPath: this.snapshotPath, summaryPath: this.summaryPath };
	}

	snapshot(): Readonly<ExecutionRunSnapshot> {
		return structuredClone(this.#state);
	}

	appendEvent(event: ExecutionEventName, data: Record<string, unknown> = {}): void {
		if (!EVENT_NAMES.has(event)) throw new Error(`Unknown execution event: ${event}`);
		const ts = this.#timestamp();
		const nodeStatus = NODE_EVENT_STATUS[event];
		let node: ExecutionNodeSnapshot | undefined;
		if (nodeStatus) {
			const nodeId = nonEmptyString(data.nodeId);
			if (!nodeId) throw new Error(`${event} requires data.nodeId`);
			node = this.#node(nodeId);
		}

		appendFileSync(this.eventsPath, `${JSON.stringify({ ...data, ts, runId: this.#state.runId, event })}\n`, "utf8");
		this.#state.eventCounts[event] = (this.#state.eventCounts[event] ?? 0) + 1;
		if (nodeStatus && node) {
			this.#applyNodeStatus(node, nodeStatus, ts, data);
		}
		this.#writeSnapshot();
	}

	setNodeStatus(nodeId: string, status: ExecutionNodeStatus, data: Record<string, unknown> = {}): void {
		this.#applyNodeStatus(this.#node(nodeId), status, this.#timestamp(), data);
		this.#writeSnapshot();
	}

	recordAttemptMetrics(nodeId: string, attemptId: string, metrics: Partial<WorkerMetrics> = {}, options: AttemptMetricOptions = {}): void {
		const node = this.#node(nodeId);
		if (!nonEmptyString(attemptId)) throw new Error("attemptId must be a non-empty string");
		validatePartialMetrics(metrics);

		const key = `${nodeId}\u0000${attemptId}`;
		const previous = this.#attemptMetrics.get(key) ?? {};
		const merged = { ...previous, ...metrics };
		for (const field of ATTEMPT_TOTAL_FIELDS) {
			const before = numericMetric(previous[field]);
			const after = numericMetric(merged[field]);
			this.#state.totals[field] += after - before;
		}
		this.#attemptMetrics.set(key, merged);

		if (options.accepted) {
			const validation = validateWorkerMetrics(merged);
			if (!validation.ok || !validation.metrics) throw new Error(`Cannot accept incomplete worker metrics for ${nodeId}/${attemptId}: ${validation.errors.join("; ")}`);
			node.worker = validation.metrics;
		}
		this.#writeSnapshot();
	}

	setPatchStats(nodeId: string, stats: PatchStats): void {
		validatePatchStats(stats);
		const node = this.#node(nodeId);
		const previous = node.patch;
		this.#state.totals.filesChanged += stats.filesChanged - (previous?.filesChanged ?? 0);
		this.#state.totals.insertions += stats.insertions - (previous?.insertions ?? 0);
		this.#state.totals.deletions += stats.deletions - (previous?.deletions ?? 0);
		this.#state.totals.patchApplyDurationMs += stats.applyDurationMs - (previous?.applyDurationMs ?? 0);
		node.patch = { ...stats };
		this.#writeSnapshot();
	}

	rollbackAppliedAttempt(nodeId: string): void {
		const node = this.#node(nodeId);
		if (node.patch) {
			this.#state.totals.filesChanged -= node.patch.filesChanged;
			this.#state.totals.insertions -= node.patch.insertions;
			this.#state.totals.deletions -= node.patch.deletions;
			this.#state.totals.patchApplyDurationMs -= node.patch.applyDurationMs;
			delete node.patch;
		}
		delete node.worker;
		this.#writeSnapshot();
	}

	setValidationStats(nodeId: string, stats: ValidationStats): void {
		validateValidationStats(stats);
		const node = this.#node(nodeId);
		node.validation = { ...stats };
		this.#state.totals.validationDurationMs += stats.durationMs;
		this.#writeSnapshot();
	}

	setFinalValidationStats(stats: ValidationStats): void {
		validateValidationStats(stats);
		this.#state.totals.validationDurationMs += stats.durationMs - (this.#state.finalValidation?.durationMs ?? 0);
		this.#state.finalValidation = { ...stats };
		this.#writeSnapshot();
	}

	finish(status: FinishedExecutionRunStatus, options: { dryRun?: boolean } = {}): Readonly<ExecutionRunSnapshot> {
		if (status !== "succeeded" && status !== "failed" && status !== "aborted") throw new Error("Finished execution status must be succeeded, failed, or aborted");
		if (this.#state.status !== "running") throw new Error(`Execution run ${this.#state.runId} already finished with status ${this.#state.status}`);
		const finishedAt = this.#timestamp();
		this.#state.status = status;
		this.#state.finishedAt = finishedAt;
		this.#state.totals.durationMs = elapsedMs(this.#state.startedAt, finishedAt);
		this.#writeSnapshot();
		writeFileSync(this.summaryPath, renderExecutionSummary(this.#state, options), { encoding: "utf8", flag: "wx" });
		return this.snapshot();
	}

	#node(nodeId: string): ExecutionNodeSnapshot {
		const node = this.#state.nodes.find((candidate) => candidate.id === nodeId);
		if (!node) throw new Error(`Unknown execution node: ${nodeId}`);
		return node;
	}

	#applyNodeStatus(node: ExecutionNodeSnapshot, status: ExecutionNodeStatus, ts: string, data: Record<string, unknown>): void {
		node.status = status;
		if (status === "running" && !node.startedAt) node.startedAt = ts;
		if (status === "succeeded" || status === "failed" || status === "skipped") {
			node.finishedAt = ts;
			node.durationMs = node.startedAt ? elapsedMs(node.startedAt, ts) : 0;
		}
		if (typeof data.error === "string" && data.error.trim()) node.error = data.error;
		else if ((status === "failed" || status === "skipped") && typeof data.reason === "string" && data.reason.trim()) node.error = data.reason;
	}

	#timestamp(): string {
		const value = this.#now();
		if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Execution recorder clock returned an invalid Date");
		return value.toISOString();
	}

	#writeSnapshot(): void {
		writeFileSync(this.snapshotPath, serialize(this.#state), "utf8");
	}
}

export function createExecutionRecorder(options: ExecutionRecorderOptions): ExecutionRecorder {
	return new ExecutionRecorder(options);
}

export function renderExecutionSummary(snapshot: ExecutionRunSnapshot, options: { dryRun?: boolean } = {}): string {
	const totals = snapshot.totals;
	const lines = [
		options.dryRun ? "# Fanout Dry Run Summary" : "# Fanout Execution Summary",
		"",
		...(options.dryRun ? ["- Mode: **dry run**; workers and final validation were not run"] : []),
		`- Status: **${markdownCell(snapshot.status)}**`,
		`- Run: \`${inlineCode(snapshot.runId)}\``,
		`- Packet: [${markdownCell(snapshot.packetPath.split("/").at(-1) ?? "execution-packet.json")}](<${snapshot.packetPath}>)`,
		`- Started: ${snapshot.startedAt}`,
		`- Finished: ${snapshot.finishedAt ?? "in progress"}`,
		"",
		"## Totals",
		"",
		"| Metric | Value |",
		"| --- | ---: |",
		`| Duration | ${formatMs(totals.durationMs)} |`,
		`| Tokens | ${totals.totalTokens} (${totals.inputTokens} in / ${totals.outputTokens} out) |`,
		`| Estimated cost | $${totals.estimatedCostUsd.toFixed(6)} |`,
		`| Worker time | ${formatMs(totals.workerDurationMs)} |`,
		`| Tool time | ${formatMs(totals.toolDurationMs)} |`,
		`| Poll time | ${formatMs(totals.pollDurationMs)} |`,
		`| Validation time | ${formatMs(totals.validationDurationMs)} |`,
		`| Patch apply time | ${formatMs(totals.patchApplyDurationMs)} |`,
		`| Patch | ${totals.filesChanged} files, +${totals.insertions}/-${totals.deletions} |`,
		"",
		"## Nodes",
		"",
		"| Node | Status | Duration | Worker | Tokens | Cost | Patch | Validation |",
		"| --- | --- | ---: | --- | ---: | ---: | --- | --- |",
		...snapshot.nodes.map(renderNodeRow),
	];
	lines.splice(lines.indexOf("## Nodes"), 0,
		"## Execution outcomes",
		"",
		`- Worker attempts: ${snapshot.eventCounts.worker_attempt_started ?? 0}`,
		`- Clean reruns: ${snapshot.eventCounts.worker_clean_rerun_scheduled ?? 0}`,
		`- Tier2 retries: ${snapshot.eventCounts.worker_retry_scheduled ?? 0}`,
		`- Realtime tier2Fallback attempts: ${snapshot.eventCounts.worker_fallback_started ?? 0}`,
		`- Rejected patches: ${snapshot.eventCounts.patch_rejected ?? 0}`,
		`- Final validation: ${snapshot.finalValidation ? `${snapshot.finalValidation.status}; ${snapshot.finalValidation.commandCount} commands; ${formatMs(snapshot.finalValidation.durationMs)}` : options.dryRun ? "not run (dry run)" : "not reached"}`,
		"",
	);

	const failures = snapshot.nodes.filter((node) => node.error);
	if (failures.length) lines.push("", "## Errors", "", ...failures.map((node) => `- **${markdownCell(node.id)}:** ${markdownCell(node.error ?? "unknown error")}`));
	const changedFiles = Array.from(new Set(snapshot.nodes.flatMap((node) => node.patch?.changedFiles ?? []))).sort();
	if (changedFiles.length) lines.push("", "## Changed files", "", ...changedFiles.map((file) => `- \`${inlineCode(file)}\``));
	lines.push(
		"",
		"## Artifacts",
		"",
		`- [events.jsonl](<${join(snapshot.artifactDir, "events.jsonl")}>)`,
		`- [execution-run.json](<${join(snapshot.artifactDir, "execution-run.json")}>)`,
		`- [summary.md](<${join(snapshot.artifactDir, "summary.md")}>)`,
		...(snapshot.finalValidation ? [`- [final-validation.json](<${join(snapshot.artifactDir, "final-validation.json")}>)`] : []),
		"",
	);
	return lines.join("\n");
}

function renderNodeRow(node: ExecutionNodeSnapshot): string {
	const worker = node.worker ? `${node.worker.provider}/${node.worker.model} (${node.worker.tier})` : "—";
	const tokens = node.worker ? String(node.worker.totalTokens) : "—";
	const cost = node.worker ? `$${node.worker.estimatedCostUsd.toFixed(6)}` : "—";
	const patch = node.patch ? `${node.patch.filesChanged} files, +${node.patch.insertions}/-${node.patch.deletions}` : "—";
	const validation = node.validation ? `${node.validation.status}; ${node.validation.commandCount} commands; ${formatMs(node.validation.durationMs)}` : "—";
	return `| ${markdownCell(node.id)} | ${node.status} | ${node.durationMs === undefined ? "—" : formatMs(node.durationMs)} | ${markdownCell(worker)} | ${tokens} | ${cost} | ${patch} | ${validation} |`;
}

function emptyTotals(): ExecutionRunTotals {
	return {
		durationMs: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		estimatedCostUsd: 0,
		workerDurationMs: 0,
		validationDurationMs: 0,
		toolDurationMs: 0,
		pollDurationMs: 0,
		patchApplyDurationMs: 0,
		filesChanged: 0,
		insertions: 0,
		deletions: 0,
	};
}

function validateRunId(runId: string): void {
	if (!nonEmptyString(runId) || runId === "." || runId === ".." || /[\\/]/.test(runId)) throw new Error("runId must be a non-empty path segment");
}

function validateNodeIds(nodeIds: string[]): void {
	const seen = new Set<string>();
	for (const nodeId of nodeIds) {
		if (!nonEmptyString(nodeId)) throw new Error("nodeIds must contain non-empty strings");
		if (seen.has(nodeId)) throw new Error(`Duplicate execution node: ${nodeId}`);
		seen.add(nodeId);
	}
}

function validatePartialMetrics(metrics: Partial<WorkerMetrics>): void {
	for (const field of WORKER_NUMBER_FIELDS) {
		const value = metrics[field];
		if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(`Worker metric ${field} must be a finite non-negative number`);
	}
}

function validatePatchStats(stats: PatchStats): void {
	for (const field of PATCH_NUMBER_FIELDS) {
		const value = stats[field];
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Patch stat ${field} must be a finite non-negative number`);
	}
	if (stats.changedFiles !== undefined && (!Array.isArray(stats.changedFiles) || stats.changedFiles.some((file) => typeof file !== "string" || !file.trim()))) throw new Error("Patch stat changedFiles must contain non-empty strings");
}

function validateValidationStats(stats: ValidationStats): void {
	if (!Number.isInteger(stats.commandCount) || stats.commandCount < 0) throw new Error("Validation commandCount must be a non-negative integer");
	if (!Number.isFinite(stats.durationMs) || stats.durationMs < 0) throw new Error("Validation durationMs must be a finite non-negative number");
	if (stats.status !== "passed" && stats.status !== "failed") throw new Error("Validation status must be passed or failed");
}

function numericMetric(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function elapsedMs(start: string, end: string): number {
	return Math.max(0, Date.parse(end) - Date.parse(start));
}

function serialize(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function formatMs(value: number): string {
	return `${Math.round(value * 1000) / 1000} ms`;
}

function markdownCell(value: string): string {
	return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function inlineCode(value: string): string {
	return value.replace(/`/g, "\\`");
}
