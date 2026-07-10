import { formatPacketValidationResult, validateExecutionPacket, type FanoutExecutionPacket, type FanoutWorkUnit } from "./execution-packet.ts";
import type { ExecutionEventName, ExecutionNodeStatus } from "./execution-run.ts";

export interface DagNodeResult {
	ok: boolean;
	error?: string;
}

export interface DagRecorder {
	appendEvent(event: ExecutionEventName, data?: Record<string, unknown>): void | Promise<void>;
}

export interface RunDagOptions {
	maxConcurrency: number;
	failFast?: boolean;
	runNode(workUnit: FanoutWorkUnit): DagNodeResult | Promise<DagNodeResult>;
	recorder: DagRecorder;
}

export interface DagNodeState {
	id: string;
	status: ExecutionNodeStatus;
	result?: DagNodeResult;
	error?: string;
}

export interface DagRunResult {
	ok: boolean;
	status: "succeeded" | "failed";
	nodes: DagNodeState[];
}

export async function runDag(packet: FanoutExecutionPacket, options: RunDagOptions): Promise<DagRunResult> {
	if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) throw new Error("maxConcurrency must be a positive integer");
	const validation = validateExecutionPacket(packet);
	if (!validation.executable) throw new Error(formatPacketValidationResult(validation));

	const units = packet.workUnits;
	const states = new Map<string, DagNodeState>(units.map((unit) => [unit.id, { id: unit.id, status: "pending" }]));
	const running = new Map<string, Promise<{ id: string; result: DagNodeResult }>>();
	let failFastTriggered = false;

	const appendEvent = (event: ExecutionEventName, data?: Record<string, unknown>) => options.recorder.appendEvent(event, data);
	const markReady = async () => {
		for (const unit of units) {
			const state = states.get(unit.id)!;
			if (state.status !== "pending") continue;
			if (!unit.dependencies.every((dependency) => states.get(dependency)?.status === "succeeded")) continue;
			state.status = "ready";
			await appendEvent("node_ready", { nodeId: unit.id });
		}
	};
	const skipDependents = async (failedId: string) => {
		const queue = [failedId];
		for (let index = 0; index < queue.length; index++) {
			const dependencyId = queue[index];
			for (const unit of units) {
				const state = states.get(unit.id)!;
				if ((state.status !== "pending" && state.status !== "ready") || !unit.dependencies.includes(dependencyId)) continue;
				state.status = "skipped";
				state.error = `dependency ${dependencyId} failed or was skipped`;
				queue.push(unit.id);
				await appendEvent("node_skipped", { nodeId: unit.id, reason: "dependency_failed", dependencyId });
			}
		}
	};
	const skipRemaining = async () => {
		for (const unit of units) {
			const state = states.get(unit.id)!;
			if (state.status !== "pending" && state.status !== "ready") continue;
			state.status = "skipped";
			state.error = "fail-fast stopped scheduling after a node failure";
			await appendEvent("node_skipped", { nodeId: unit.id, reason: "fail_fast" });
		}
	};
	const startNode = async (unit: FanoutWorkUnit) => {
		const state = states.get(unit.id)!;
		state.status = "running";
		await appendEvent("node_started", { nodeId: unit.id });
		const promise = (async () => {
			try {
				const result = await options.runNode(unit);
				return { id: unit.id, result: validNodeResult(result) ? result : { ok: false, error: "runNode returned an invalid result" } };
			} catch (error) {
				return { id: unit.id, result: { ok: false, error: errorMessage(error) } };
			}
		})();
		running.set(unit.id, promise);
	};

	try {
		while (true) {
			if (!failFastTriggered) await markReady();
			for (const unit of units) {
				if (running.size >= options.maxConcurrency) break;
				if (states.get(unit.id)?.status === "ready") await startNode(unit);
			}

			if (running.size === 0) break;
			const completed = await Promise.race(running.values());
			running.delete(completed.id);
			const state = states.get(completed.id)!;
			state.result = completed.result;
			if (completed.result.ok) {
				state.status = "succeeded";
				await appendEvent("node_succeeded", { nodeId: completed.id });
			} else {
				state.status = "failed";
				state.error = completed.result.error || "node execution failed";
				await appendEvent("node_failed", { nodeId: completed.id, error: state.error });
				await skipDependents(completed.id);
				if (options.failFast && !failFastTriggered) {
					failFastTriggered = true;
					await skipRemaining();
				}
			}
		}
	} catch (error) {
		await Promise.allSettled(running.values());
		throw error;
	}

	const nodes = units.map((unit) => ({ ...states.get(unit.id)! }));
	const ok = nodes.every((node) => node.status === "succeeded");
	await appendEvent("scheduler_finished", {
		status: ok ? "succeeded" : "failed",
		succeeded: nodes.filter((node) => node.status === "succeeded").length,
		failed: nodes.filter((node) => node.status === "failed").length,
		skipped: nodes.filter((node) => node.status === "skipped").length,
	});
	return { ok, status: ok ? "succeeded" : "failed", nodes };
}

function validNodeResult(value: unknown): value is DagNodeResult {
	if (typeof value !== "object" || value === null) return false;
	const result = value as { ok?: unknown; error?: unknown };
	return typeof result.ok === "boolean" && (result.error === undefined || typeof result.error === "string");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
