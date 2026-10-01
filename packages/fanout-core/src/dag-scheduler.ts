import { validateExecutionPacket, type FanoutExecutionPacket, type FanoutPacketNode } from "./execution-packet.ts";

export interface DagNodeResult { ok: boolean; error?: string; attemptId?: string; }
export interface DagNodeState { id: string; status: "pending" | "running" | "succeeded" | "failed" | "skipped"; result?: DagNodeResult; error?: string; upstreamNodeId?: string; failFastCause?: { nodeId: string; attemptId: string }; }
export interface DagRunResult { ok: boolean; status: "succeeded" | "failed"; nodes: DagNodeState[]; }
export interface RunDagOptions {
	maxConcurrency: number;
	failFast?: boolean;
	runNode(node: FanoutPacketNode, signal: AbortSignal): DagNodeResult | Promise<DagNodeResult>;
	onNodeCompleted?(state: DagNodeState): void | Promise<void>;
}

export async function runDag(packet: FanoutExecutionPacket, options: RunDagOptions): Promise<DagRunResult> {
	if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) throw new Error("maxConcurrency must be a positive integer");
	const admitted = validateExecutionPacket(packet);
	if (!admitted.packet || !admitted.graph) throw new Error(admitted.errors.map((issue) => issue.message).join("; "));
	const graph = admitted.graph;
	const nodes = admitted.packet.nodes.filter((node) => node.kind !== "final-validation");
	const dependencies = new Map(nodes.map((node) => [node.id, graph.edges.filter(([, to]) => to === node.id).map(([from]) => from).filter((id) => nodes.some((node) => node.id === id))]));
	const states = new Map(nodes.map((node) => [node.id, { id: node.id, status: "pending" as const } as DagNodeState]));
	const running = new Map<string, Promise<{ id: string; result: DagNodeResult }>>();
	const halt = new AbortController();
	let stopped: { nodeId: string; attemptId: string } | undefined;

	const complete = async (state: DagNodeState) => { await options.onNodeCompleted?.({ ...state }); };
	const skipDependents = async (upstreamNodeId: string) => {
		const queue = [upstreamNodeId];
		for (let i = 0; i < queue.length; i++) for (const node of nodes) {
			const state = states.get(node.id)!;
			if (state.status !== "pending" || !(dependencies.get(node.id) ?? []).includes(queue[i])) continue;
			state.status = "skipped"; state.upstreamNodeId = queue[i]; state.error = `dependency ${queue[i]} failed or was skipped`; queue.push(node.id); await complete(state);
		}
	};
	try { while (true) {
		for (const node of nodes) {
			if (running.size >= options.maxConcurrency || stopped) break;
			const state = states.get(node.id)!;
			if (state.status !== "pending" || !(dependencies.get(node.id) ?? []).every((id) => states.get(id)?.status === "succeeded")) continue;
			state.status = "running";
			running.set(node.id, Promise.resolve(options.runNode(node, halt.signal)).then((result) => ({ id: node.id, result })).catch((error) => ({ id: node.id, result: { ok: false, error: message(error) } })));
		}
		if (!running.size) break;
		const done = await Promise.race(running.values()); running.delete(done.id);
		const state = states.get(done.id)!; state.result = done.result; state.status = done.result.ok ? "succeeded" : "failed"; state.error = done.result.error;
		await complete(state);
		if (!done.result.ok) { await skipDependents(done.id); if (options.failFast && !stopped) { if (!done.result.attemptId) throw new Error("fail-fast failure omitted its causal attempt"); stopped = { nodeId: done.id, attemptId: done.result.attemptId }; } }
	} } catch (error) {
		halt.abort(error);
		await Promise.allSettled(running.values());
		throw error;
	}
	if (stopped) for (const state of states.values()) if (state.status === "pending") { state.status = "skipped"; state.failFastCause = stopped; state.error = "fail-fast stopped scheduling"; await complete(state); }
	const ordered = nodes.map((node) => states.get(node.id)!);
	return { ok: ordered.every((node) => node.status === "succeeded"), status: ordered.every((node) => node.status === "succeeded") ? "succeeded" : "failed", nodes: ordered };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
