import type { AcceptedStateTransition, ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import type { AttemptAllocation, AttemptOutcome } from "../../fanout-core/src/execution-attempt.ts";
import type { ExecutionEventName } from "../../fanout-core/src/execution-event.ts";
import type { ExecutionRunProjection } from "../../fanout-core/src/execution-projection.ts";
import { createExecutionEventRecorder, type ExecutionEventRecorderOptions } from "./execution-event-store.ts";
import type { RuntimeAttemptRecorder } from "./fanout-node-executor.ts";

export class RuntimeEventRecorder implements RuntimeAttemptRecorder {
	readonly store;
	#tail: Promise<Readonly<ExecutionRunProjection>> | undefined;
	constructor(runDir: string, runId: string, options: Pick<ExecutionEventRecorderOptions, "now" | "replace"> = {}) { this.store = createExecutionEventRecorder({ runDir, runId, ...options }); }
	record(name: ExecutionEventName, payload: Record<string, unknown>): Promise<Readonly<ExecutionRunProjection>> {
		const result = this.store.record(name, payload);
		this.#tail = result;
		return result;
	}
	async recordAttemptAllocated(allocation: AttemptAllocation): Promise<void> { await this.record("attempt-allocated", { allocation }); }
	async recordAttemptCompleted(outcome: AttemptOutcome, acceptedTransition?: AcceptedStateTransition): Promise<void> { await this.record("attempt-completed", { outcome, ...(acceptedTransition ? { acceptedTransition } : {}) }); }
	async flush(): Promise<void> { await this.#tail; }
	projection(): Readonly<ExecutionRunProjection> { const projection = this.store.projection(); if (!projection) throw new Error("execution run has not started"); return projection; }
	get paths() { return { runDir: this.store.runDir, eventsPath: this.store.eventsPath, snapshotPath: this.store.projectionPath, summaryPath: this.store.reportPath }; }
}

export function commandIdentity(command: { executable: string; args: string[]; cwd?: string; env?: Record<string, string> }): string {
	return JSON.stringify(command);
}

export type FinalEvidenceIdentity = ArtifactIdentity;
