import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { AcceptedPatch } from "../../fanout-core/src/artifact-identity.ts";
import { correlateAttemptMetrics, type MetricIssue, type CorrelatedAttemptMetrics } from "../../fanout-core/src/attempt-metrics.ts";
import { canonicalTimestamp } from "../../fanout-core/src/contract-value.ts";
import type { AttemptAllocation, StageFact } from "../../fanout-core/src/execution-attempt.ts";
import { DOUBLEWORD_PRICING_PROVENANCE, DOUBLEWORD_TIER_PRICING } from "../../doubleword-provider/src/pricing.ts";
import type {
	AcceptedLedgerProvenance,
	ApplyFailureEvidence,
	IntegrationRecoveryContext,
	ValidationRecoveryContext,
} from "../../fanout-core/src/recovery-evidence.ts";
import type { WorkContract } from "../../fanout-core/src/work-contract.ts";
import type { ProcessResult } from "./fanout-git.ts";
import type { ValidationRunResult } from "./validation-runner.ts";

interface PatchAttemptEvidence {
	attemptId: string;
	attemptDir: string;
	patch?: AcceptedPatch;
	excludedEvidenceRefs?: readonly string[];
}

export function validationFailureEvidence(
	contract: WorkContract,
	attempt: PatchAttemptEvidence,
	result: ValidationRunResult,
): { fact: StageFact; recovery?: ValidationRecoveryContext } {
	if (!attempt.patch) throw new Error(`attempt ${attempt.attemptId} has no rejected patch`);
	const commands = contract.validationCommands.map((command, index) => {
		const evidence = result.commands[index];
		if (!evidence) return { index, command, status: "unexecuted" as const, exitCode: null, signal: null, timeoutMs: null, stdout: "", stderr: "", durationMs: 0 };
		const status = evidence.outcome === "spawn" ? "spawn-failure" as const : evidence.outcome === "aborted" ? "signal" as const : evidence.outcome;
		return {
			index,
			command,
			status,
			exitCode: status === "passed" || status === "nonzero" ? evidence.exitCode : null,
			signal: status === "signal" ? evidence.signal : null,
			timeoutMs: status === "timeout" ? Math.max(1, Math.ceil(evidence.durationMs)) : null,
			stdout: evidence.stdout,
			stderr: [evidence.stderr, evidence.spawnError].filter(Boolean).join("\n"),
			durationMs: evidence.durationMs,
		};
	});
	const failedCommandIndexes = result.commands.flatMap((command, index) => command.outcome !== "passed" && command.outcome !== "unexecuted" ? [index] : []);
	const failed = result.commands.find((command) => command.outcome !== "passed" && command.outcome !== "unexecuted");
	const code = failed?.outcome === "timeout" ? "timeout" : failed?.outcome === "spawn" ? "spawn-failure" : failed?.outcome === "signal" ? "signal" : failed?.outcome === "aborted" ? "abort" : "program-failure";
	const recovery: ValidationRecoveryContext = {
			kind: "validation",
			sourceAttemptId: attempt.attemptId,
			workContract: contract,
			commands,
			rejectedPatch: attempt.patch,
			reconstructedTree: attempt.patch.resultTree,
	};
	return {
		fact: { stage: "validation", code, failedCommandIndexes },
		...(code === "spawn-failure" || code === "abort" ? {} : { recovery }),
	};
}

export function integrationFailureEvidence(
	contract: WorkContract,
	attempt: PatchAttemptEvidence,
	applyFailure: ApplyFailureEvidence,
	acceptedLedger: readonly AcceptedLedgerProvenance[],
	reconstructedTree: AcceptedPatch["resultTree"],
): IntegrationRecoveryContext {
	if (!attempt.patch) throw new Error(`attempt ${attempt.attemptId} has no rejected patch`);
	return {
		kind: "integration",
		sourceAttemptId: attempt.attemptId,
		workContract: contract,
		applyFailure,
		rejectedPatch: attempt.patch,
		acceptedLedger: acceptedLedger.map(({ sourceAttemptId, patch }) => ({ sourceAttemptId, patch })),
		reconstructedTree,
	};
}

export function attemptEvidenceRefs(runDir: string, attempt: PatchAttemptEvidence): string[] {
	const prefix = relative(runDir, attempt.attemptDir).split("\\").join("/");
	const excluded = new Set(attempt.excludedEvidenceRefs ?? []);
	const refs = artifactFile(join(attempt.attemptDir, "result.json")) ? ["result.json"] : [];
	if (artifactFile(join(attempt.attemptDir, "observability.jsonl"))) refs.push("observability.jsonl");
	if (attempt.patch) refs.push(attempt.patch.artifact.path);
	for (const name of ["preparation.json", "candidate-normalization.json", "validation.json", "ownership-check.json", "apply-check.json", "reconciliation.json", "worker-validation-manifest.json"]) if (artifactFile(join(attempt.attemptDir, name))) refs.push(name);
	const workerValidationDir = join(attempt.attemptDir, "worker-validation");
	if (existsSync(workerValidationDir) && lstatSync(workerValidationDir).isDirectory()) for (const name of readdirSync(workerValidationDir).sort()) if (artifactFile(join(workerValidationDir, name))) refs.push(`${prefix}/worker-validation/${name}`);
	return [...new Set(refs.filter((reference) => !excluded.has(reference)).map((reference) => reference.includes("/") ? reference : `${prefix}/${reference}`))];
}

function artifactFile(path: string): boolean { return existsSync(path) && lstatSync(path).isFile(); }

interface ProviderIdentity {
	runId: string;
	provider: string;
	model: string;
}

export function retryableProcessFailure(result: Pick<ProcessResult, "timedOut" | "spawnError" | "signal">, observabilityPath: string, identity: ProviderIdentity): boolean {
	if (result.timedOut || result.spawnError || result.signal) return true;
	const fact = providerFailureFact(observabilityPath, identity);
	return fact?.stage === "provider" && ["rate-limit", "retryable-service", "network"].includes(fact.code);
}

export function processStageFact(result: Pick<ProcessResult, "exitCode" | "signal" | "timedOut" | "spawnError" | "durationMs">, observabilityPath: string, identity: ProviderIdentity): StageFact {
	const provider = providerFailureFact(observabilityPath, identity);
	if (provider) return provider;
	if (result.timedOut) return { stage: "process", code: "timeout", timeoutMs: Math.max(1, Math.ceil(result.durationMs)), durationMs: result.durationMs };
	if (result.spawnError) return { stage: "process", code: "spawn-failed", durationMs: result.durationMs };
	if (result.signal) return { stage: "process", code: "signal", signal: result.signal, durationMs: result.durationMs };
	return { stage: "process", code: result.exitCode === 0 ? "completed" : "nonzero", ...(result.exitCode === null ? {} : { exitCode: result.exitCode }), durationMs: result.durationMs };
}

function providerFailureFact(path: string, identity: ProviderIdentity): StageFact | undefined {
	try {
		for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).reverse()) {
			const event = JSON.parse(line);
			if (event?.event !== "provider_error" || !["rate-limit", "retryable-service", "network", "authentication", "quota", "invalid-request", "invalid-model", "abort", "protocol"].includes(event.failureCode)) continue;
			if (event.runId !== identity.runId || event.provider !== identity.provider || event.model !== identity.model) continue;
			if (!Number.isSafeInteger(event.turnIndex) || typeof event.responseId !== "string" || !event.responseId) continue;
			return {
				stage: "provider",
				code: event.failureCode,
				...(Number.isSafeInteger(event.httpStatus) ? { httpStatus: event.httpStatus } : {}),
				...(typeof event.networkCode === "string" && event.networkCode ? { networkCode: event.networkCode } : {}),
				...(typeof event.providerCode === "string" && event.providerCode ? { providerCode: event.providerCode } : {}),
			};
		}
	} catch {
		// Missing or malformed provider evidence is not retry authority.
	}
	return undefined;
}

export function emptyAttemptMetrics(attemptId: string): CorrelatedAttemptMetrics {
	return correlateAttemptMetrics({ attemptId, compatibility: "generic", turns: [], responses: [], polls: [], tools: [] }).partialMetrics;
}

export interface WorkerMeasurementOptions {
	allocation: AttemptAllocation;
	providerRunId: string;
	stdoutPath: string;
	observabilityPath: string;
	workerDurationMs: number;
	workerFirstOutputMs?: number;
	attemptEnvelope?: { startedAt: string; finishedAt: string };
}

export function correlatedWorkerMetrics(options: WorkerMeasurementOptions): CorrelatedAttemptMetrics {
	const { allocation, providerRunId } = options;
	const { attemptId, assignment } = allocation;
	const issues: MetricIssue[] = [];
	const stdout = readJsonLines(options.stdoutPath, issues);
	const observability = readJsonLines(options.observabilityPath, issues);
	const instrumented = assignment.provider === "doubleword" || assignment.provider === "doubleword-stub";
	const messages = stdout.filter((record) => record.type === "message_end" && record.message?.role === "assistant");
	const turnEnds = observability.filter((record) => record.event === "turn_end");
	const issue = (code: MetricIssue["code"], path: string, message: string) => issues.push({ code, path, message });
	const metricEvents = new Set(["turn_start", "turn_end", "assistant_ttft", "provider_start", "provider_end", "provider_ttft", "async_poll", "tool_start", "tool_end"]);
	const suppliedIdentities = new Set<string>();
	for (const [index, event] of [...observability, ...messages.map((record) => record.message)].entries()) {
		if (event.role !== "assistant" && !metricEvents.has(event.event)) continue;
		const path = `worker.records[${index}]`;
		if (metricEvents.has(event.event)) {
			if (event.ts === undefined) issue("missing-timing", `${path}.ts`, "measurement timestamp is unavailable");
			else {
				try {
					const timestamp = canonicalTimestamp(event.ts, `${path}.ts`);
					if (options.attemptEnvelope && (Date.parse(timestamp) < Date.parse(options.attemptEnvelope.startedAt) || Date.parse(timestamp) > Date.parse(options.attemptEnvelope.finishedAt))) issue("correlation-mismatch", `${path}.ts`, "supplied measurement timestamp is outside its Attempt envelope");
				} catch { issue("malformed-input", `${path}.ts`, "supplied measurement timestamp must be canonical"); }
			}
			if (event.turnIndex === undefined) issue("missing-identity", `${path}.turnIndex`, "supplied measurement requires its turn identity");
			const identity = JSON.stringify([event.event, event.turnIndex, event.responseId, event.toolCallId, event.pollIndex]);
			if (suppliedIdentities.has(identity)) issue("duplicate-identity", path, "measurement identity is supplied more than once");
			suppliedIdentities.add(identity);
			for (const field of ["responseId", "toolCallId"]) if (event[field] !== undefined && (typeof event[field] !== "string" || !event[field] || event[field] !== event[field].trim())) issue("missing-identity", `${path}.${field}`, "supplied measurement identity must be a nonempty string");
			const required = event.event.startsWith("tool_") ? ["toolCallId"] : ["provider_end", "provider_ttft", "async_poll"].includes(event.event) ? ["responseId"] : [];
			for (const field of required) if (typeof event[field] !== "string" || !event[field] || event[field] !== event[field].trim()) issue("missing-identity", `${path}.${field}`, "supplied measurement requires its record identity");
			const terminal = event.event === "turn_start" || event.event === "assistant_ttft" ? "turn_end" : event.event === "provider_start" || event.event === "provider_ttft" ? "provider_end" : event.event === "tool_start" ? "tool_end" : undefined;
			if (terminal && !observability.some((candidate) => candidate.event === terminal && candidate.turnIndex === event.turnIndex && (event.toolCallId === undefined || candidate.toolCallId === event.toolCallId) && (event.responseId === undefined || candidate.responseId === event.responseId))) issue("missing-measurement", path, "supplied measurement has no matching terminal record");
		}
		for (const [field, expected] of Object.entries({ runId: providerRunId, sessionRunId: providerRunId, attemptId, nodeId: allocation.nodeId })) if (event[field] !== undefined && event[field] !== expected) issue("correlation-mismatch", `${path}.${field}`, `${field} belongs to a different allocation`);
		for (const field of ["provider", "model"] as const) if (event[field] !== undefined && event[field] !== assignment[field]) issue("provider-evidence-mismatch", `${path}.${field}`, `${field} contradicts assigned ${assignment[field]}`);
		if (event.tier !== undefined && event.tier !== (instrumented ? assignment.tier === "tier2" ? "async" : "realtime" : assignment.tier)) issue("provider-evidence-mismatch", `${path}.tier`, "provider tier contradicts controller launch mode");
		if (event.turnIndex !== undefined && (!Number.isSafeInteger(event.turnIndex) || event.turnIndex < 0)) issue("invalid-number", `${path}.turnIndex`, "turnIndex must be a non-negative safe integer");
		for (const field of ["durationMs", "ttftMs", "pollCount", "pollIndex"]) if (event[field] !== undefined && (typeof event[field] !== "number" || !Number.isFinite(event[field]) || event[field] < 0 || field.startsWith("poll") && !Number.isSafeInteger(event[field]))) issue("invalid-number", `${path}.${field}`, `${field} must be finite and non-negative`);
	}
	const turnKey = (index: number) => turnEnds[index]?.turnIndex ?? `assistant-${index}`;
	const providerEnds = observability.filter((event) => event.event === "provider_end");
	const responses = providerEnds.map((event, index) => {
		const path = `worker.provider_end[${index}]`;
		const turnId = `${attemptId}/turn-${event.turnIndex}`;
		const ttft = observability.find((candidate) => candidate.event === "provider_ttft" && candidate.turnIndex === event.turnIndex && candidate.responseId === event.responseId);
		const start = observability.find((candidate) => candidate.event === "provider_start" && candidate.turnIndex === event.turnIndex);
		const responsePolls = observability.filter((candidate) => candidate.event === "async_poll" && candidate.turnIndex === event.turnIndex && candidate.responseId === event.responseId);
		if (event.pollCount !== undefined && Number.isSafeInteger(event.pollCount) && event.pollCount !== responsePolls.length) issue("correlation-mismatch", `${path}.pollCount`, "provider pollCount contradicts supplied poll records");
		if (instrumented && assignment.tier === "tier2" && event.pollCount === undefined) issue("missing-poll", `${path}.pollCount`, "provider poll count is unavailable");
		const measured = usageMetrics(event.usage, path, issues);
		let verifiedUsage = true;
		let verifiedPricing = true;
		if (instrumented) {
			for (const [field, expected] of Object.entries({ usageSource: "provider", usageInputField: "input_tokens", usageOutputField: "output_tokens" })) {
				if (event[field] === undefined) { issue("missing-measurement", `${path}.${field}`, `${field} is unavailable`); verifiedUsage = false; }
				else if (event[field] !== expected) { issue("provider-evidence-mismatch", `${path}.${field}`, `${field} must be ${expected}`); verifiedUsage = false; }
			}
			for (const [field, expected] of Object.entries({ pricingSource: "doubleword-model-metadata", pricingSourceUrl: DOUBLEWORD_PRICING_PROVENANCE.sourceUrl, pricingRetrievedAt: DOUBLEWORD_PRICING_PROVENANCE.retrievedAt, pricingSnapshotSha256: DOUBLEWORD_PRICING_PROVENANCE.snapshotSha256 })) {
				if (event[field] === undefined) { issue("missing-measurement", `${path}.${field}`, `${field} is unavailable`); verifiedPricing = false; }
				else if (event[field] !== expected) { issue("pricing-mismatch", `${path}.${field}`, `${field} does not match trusted pricing`); verifiedPricing = false; }
			}
			const rates = DOUBLEWORD_TIER_PRICING[assignment.model]?.[assignment.tier === "tier2" ? "async" : "realtime"];
			if (!rates) { issue("missing-measurement", `${path}.pricing`, "model has no trusted pricing snapshot"); verifiedPricing = false; }
			else if (event.usage && event.usage.cost && ["input", "output", "cacheRead", "cacheWrite"].every((field) => Number.isSafeInteger(event.usage[field]) && event.usage[field] >= 0)) {
				const expected = { input: rates.input / 1_000_000 * event.usage.input, output: rates.output / 1_000_000 * event.usage.output, cacheRead: rates.cacheRead / 1_000_000 * event.usage.cacheRead, cacheWrite: 0, total: 0 };
				expected.total = expected.input + expected.output + expected.cacheRead;
				for (const [field, cost] of Object.entries(expected)) if (event.usage.cost[field] !== undefined && event.usage.cost[field] !== cost) { issue("pricing-mismatch", `${path}.usage.cost.${field}`, "cost contradicts trusted model/tier rates"); verifiedPricing = false; }
			}
		}
		const assistantIndex = messages.findIndex((_message, index) => turnKey(index) === event.turnIndex);
		const assistantUsage = assistantIndex < 0 ? undefined : usageMetrics(messages[assistantIndex].message.usage, `worker.assistant[${assistantIndex}]`, issues);
		for (const field of Object.keys(measured)) if (assistantUsage?.[field] !== undefined && assistantUsage[field] !== measured[field]) issue("usage-mismatch", `${path}.${field}`, "provider usage contradicts observed assistant usage");
		return {
			attemptId, turnId, responseId: event.responseId, provider: event.provider, model: event.model, terminal: "completed",
			...timedInterval(start?.ts, ttft?.ts, event.ts, "requestedAt", "firstTokenAt", "finishedAt"),
			pollIds: responsePolls.map((poll) => `${event.responseId}/poll-${poll.pollIndex}`),
			...(verifiedUsage ? measured : {}),
			costUsd: verifiedUsage && verifiedPricing ? measured.costUsd : undefined,
			pricingSource: verifiedPricing ? event.pricingSource : undefined,
		};
	});
	const turns = messages.map((record, index) => {
		const turnIndex = turnKey(index);
		const turnId = `${attemptId}/turn-${turnIndex}`;
		const turnStart = observability.find((event) => event.event === "turn_start" && event.turnIndex === turnIndex);
		const firstOutput = observability.find((event) => event.event === "assistant_ttft" && event.turnIndex === turnIndex);
		const measured = usageMetrics(record.message.usage, `worker.assistant[${index}]`, issues);
		const children = responses.filter((response) => response.turnId === turnId);
		const admittedUsage: Record<string, number | undefined> = {};
		for (const [field, value] of Object.entries(measured)) if (!instrumented || children.length && children.every((child) => child[field] !== undefined)) admittedUsage[field] = value;
		return {
			attemptId, turnId, terminal: "completed", provider: record.message.provider, model: record.message.model, tier: assignment.tier, tierSource: "controller-launch",
			...timedInterval(turnStart?.ts, firstOutput?.ts, turnEnds[index]?.ts, "requestedAt", "firstOutputAt", "finishedAt"),
			...admittedUsage,
			pricingSource: instrumented ? children[0]?.pricingSource : "pi-json-usage",
			responseIds: children.map((response) => response.responseId),
			toolCallIds: Array.isArray(record.message.content) ? record.message.content.filter((item: Record<string, unknown>) => item?.type === "toolCall").map((item: Record<string, unknown>) => item.id) : [],
		};
	});
	const polls = observability.filter((event) => event.event === "async_poll").map((event) => ({
		attemptId, turnId: `${attemptId}/turn-${event.turnIndex}`, responseId: event.responseId, pollId: `${event.responseId}/poll-${event.pollIndex}`,
		status: event.status === "complete" ? "completed" : event.status === "in_progress" ? "in-progress" : event.status,
		durationMs: event.durationMs,
	}));
	const tools = observability.filter((event) => event.event === "tool_end").map((event) => {
		const start = observability.find((candidate) => candidate.event === "tool_start" && candidate.turnIndex === event.turnIndex && candidate.toolCallId === event.toolCallId);
		return { attemptId, turnId: `${attemptId}/turn-${event.turnIndex}`, toolCallId: event.toolCallId, name: event.toolName ?? start?.toolName, terminal: "completed", ...timedInterval(start?.ts, undefined, event.ts, "startedAt", undefined, "finishedAt") };
	});
	return correlateAttemptMetrics({ attemptId, compatibility: instrumented ? "instrumented" : "generic", turns, responses, polls, tools, workerFirstOutputMs: options.workerFirstOutputMs, workerDurationMs: options.workerDurationMs }, issues, options.attemptEnvelope).partialMetrics;
}

function usageMetrics(usage: unknown, path: string, issues: MetricIssue[]): Record<string, number | undefined> {
	if (usage === undefined) return {};
	if (!usage || typeof usage !== "object" || Array.isArray(usage)) { issues.push({ code: "malformed-input", path: `${path}.usage`, message: "usage must be an object" }); return {}; }
	const record = usage as Record<string, unknown>;
	if (record.cost !== undefined && (!record.cost || typeof record.cost !== "object" || Array.isArray(record.cost))) issues.push({ code: "malformed-input", path: `${path}.usage.cost`, message: "usage cost must be an object" });
	const cost = record.cost as Record<string, unknown> | undefined;
	const result: Record<string, number | undefined> = {};
	for (const [field, value] of Object.entries({ inputTokens: record.input, outputTokens: record.output, cacheReadTokens: record.cacheRead, cacheWriteTokens: record.cacheWrite, totalTokens: record.totalTokens, costUsd: cost?.total })) {
		if (value === undefined) continue;
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || field !== "costUsd" && !Number.isSafeInteger(value)) issues.push({ code: "invalid-number", path: `${path}.${field}`, message: "usage must be finite and non-negative" });
		else result[field] = value;
	}
	for (const [field, value] of Object.entries(cost ?? {})) if (typeof value !== "number" || !Number.isFinite(value) || value < 0) issues.push({ code: "invalid-number", path: `${path}.usage.cost.${field}`, message: "cost must be finite and non-negative" });
	if (result.totalTokens !== undefined && result.inputTokens !== undefined && result.outputTokens !== undefined && result.totalTokens < result.inputTokens + result.outputTokens) issues.push({ code: "usage-mismatch", path, message: "total usage excludes input or output tokens" });
	return result;
}

function timedInterval(start: unknown, first: unknown, finish: unknown, startField: string, firstField: string | undefined, finishField: string): Record<string, unknown> {
	return {
		...(start === undefined ? {} : { [startField]: start }),
		...(firstField && first !== undefined ? { [firstField]: first } : {}),
		...(finish === undefined ? {} : { [finishField]: finish }),
		...(typeof start === "string" && typeof finish === "string" ? { durationMs: Date.parse(finish) - Date.parse(start) } : {}),
	};
}

function readJsonLines(path: string, issues: MetricIssue[]): Record<string, any>[] {
	let content: string;
	try { content = readFileSync(path, "utf8"); }
	catch (error) { issues.push({ code: "missing-measurement", path, message: `measurement file unavailable: ${String(error)}` }); return []; }
	return content.split(/\r?\n/).flatMap((line, index) => {
		if (!line.trim()) return [];
		try { const record = JSON.parse(line); if (record && typeof record === "object" && !Array.isArray(record)) return [record]; }
		catch { /* Preserve supplied malformed records as invalid evidence. */ }
		issues.push({ code: "malformed-input", path: `${path}:${index + 1}`, message: "measurement record must be a JSON object" });
		return [];
	});
}
