import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AcceptedPatch } from "../../fanout-core/src/artifact-identity.ts";
import { correlateAttemptMetrics, type CorrelatedAttemptMetrics } from "../../fanout-core/src/attempt-metrics.ts";
import type { StageFact } from "../../fanout-core/src/execution-attempt.ts";
import type { WorkerMetrics } from "../../fanout-core/src/worker-metrics.ts";
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
	metrics?: WorkerMetrics;
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
	for (const name of ["candidate-normalization.json", "validation.json", "ownership-check.json", "apply-check.json"]) if (artifactFile(join(attempt.attemptDir, name))) refs.push(name);
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

export function correlatedWorkerMetrics(attemptId: string, metrics: Pick<WorkerMetrics, "provider" | "model" | "tier" | "workerDurationMs">, stdoutPath: string, observabilityPath: string, workerFirstOutputMs: number | undefined): CorrelatedAttemptMetrics {
	const stdout = readJsonLines(stdoutPath);
	const observability = readJsonLines(observabilityPath);
	const messages = stdout.filter((record) => record.type === "message_end" && record.message?.role === "assistant");
	const turnEnds = observability.filter((record) => record.event === "turn_end" && Number.isSafeInteger(record.turnIndex));
	const instrumented = metrics.provider === "doubleword" || metrics.provider === "doubleword-stub";
	const turns = messages.map((record, index) => {
		const turnIndex = turnEnds[index]?.turnIndex;
		const turnId = `${attemptId}/turn-${String(turnIndex ?? `missing-${index + 1}`)}`;
		const usage = record.message?.usage ?? {};
		const providerEnds = instrumented ? observability.filter((event) => event.event === "provider_end" && event.provider === metrics.provider && event.model === metrics.model && event.turnIndex === turnIndex) : [];
		const toolCallIds = Array.isArray(record.message?.content)
			? record.message.content.flatMap((item: Record<string, unknown>) => item?.type === "toolCall" && typeof item.id === "string" ? [item.id] : [])
			: [];
		return {
			attemptId,
			turnId,
			terminal: "completed",
			provider: record.message?.provider,
			model: record.message?.model,
			tier: metrics.tier,
			inputTokens: usage.input,
			outputTokens: usage.output,
			totalTokens: usage.totalTokens,
			costUsd: usage.cost?.total,
			pricingSource: instrumented ? providerEnds[0]?.pricingSource : "pi-json-usage",
			responseIds: providerEnds.flatMap((event) => typeof event.responseId === "string" ? [event.responseId] : []),
			toolCallIds,
		};
	});
	const responses = instrumented ? observability.flatMap((event) => {
		if (event.event !== "provider_end" || event.provider !== metrics.provider || event.model !== metrics.model || !Number.isSafeInteger(event.turnIndex) || typeof event.responseId !== "string" || !event.responseId) return [];
		const turnId = `${attemptId}/turn-${event.turnIndex}`;
		const ttft = observability.find((candidate) => candidate.event === "provider_ttft" && candidate.provider === event.provider && candidate.model === event.model && candidate.turnIndex === event.turnIndex && candidate.responseId === event.responseId);
		const polls = observability.filter((candidate) => candidate.event === "async_poll" && candidate.provider === event.provider && candidate.model === event.model && candidate.turnIndex === event.turnIndex && candidate.responseId === event.responseId && Number.isSafeInteger(candidate.pollIndex));
		return [{
			attemptId,
			turnId,
			responseId: event.responseId,
			provider: event.provider,
			model: event.model,
			terminal: "completed",
			ttftMs: ttft?.ttftMs,
			pollIds: polls.map((poll) => `${event.responseId}/poll-${poll.pollIndex}`),
			inputTokens: event.usage?.input,
			outputTokens: event.usage?.output,
			totalTokens: event.usage?.totalTokens,
			costUsd: event.usage?.cost?.total,
			pricingSource: event.pricingSource,
		}];
	}) : [];
	const polls = instrumented ? observability.flatMap((event) => {
		if (event.event !== "async_poll" || event.provider !== metrics.provider || event.model !== metrics.model || !Number.isSafeInteger(event.turnIndex) || typeof event.responseId !== "string" || !event.responseId || !Number.isSafeInteger(event.pollIndex)) return [];
		return [{ attemptId, turnId: `${attemptId}/turn-${event.turnIndex}`, responseId: event.responseId, pollId: `${event.responseId}/poll-${event.pollIndex}`, status: event.status === "completed" || event.status === "complete" ? "completed" : event.status === "queued" ? "queued" : "in-progress", durationMs: event.durationMs }];
	}) : [];
	const tools = observability.flatMap((event) => {
		if (event.event !== "tool_end" || !Number.isSafeInteger(event.turnIndex) || typeof event.toolCallId !== "string" || !event.toolCallId) return [];
		return [{ attemptId, turnId: `${attemptId}/turn-${event.turnIndex}`, toolCallId: event.toolCallId, terminal: "completed", durationMs: event.durationMs }];
	});
	const evidence = {
		attemptId,
		compatibility: instrumented ? "instrumented" : "generic",
		turns,
		responses,
		polls,
		tools,
		...(workerFirstOutputMs === undefined ? {} : { workerFirstOutputMs }),
		workerDurationMs: metrics.workerDurationMs,
	};
	const correlated = correlateAttemptMetrics(evidence);
	return correlated.metrics ?? correlated.partialMetrics;
}

function readJsonLines(path: string): Record<string, any>[] {
	try {
		return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
			try { return [JSON.parse(line)]; } catch { return []; }
		});
	} catch {
		return [];
	}
}
