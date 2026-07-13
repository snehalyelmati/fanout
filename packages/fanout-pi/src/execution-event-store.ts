import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	EXECUTION_EVENT_SCHEMA,
	EXECUTION_EVENT_VERSION,
	parseExecutionEvent,
	type ExecutionEvent,
	type ExecutionEventName,
} from "../../fanout-core/src/execution-event.ts";
import { reduceExecutionEvent, replayExecutionEvents, type ExecutionRunProjection } from "../../fanout-core/src/execution-projection.ts";
import { renderExecutionReport } from "../../fanout-core/src/execution-report.ts";

export type PublicationKind = "events" | "projection" | "report";
export type AtomicReplace = (path: string, bytes: string, kind: PublicationKind) => void;

export interface ExecutionEventRecorderOptions {
	runDir: string;
	runId: string;
	now?: () => Date;
	replace?: AtomicReplace;
}

export class ExecutionEventRecorder {
	readonly runDir: string;
	readonly eventsPath: string;
	readonly projectionPath: string;
	readonly reportPath: string;

	readonly #now: () => Date;
	readonly #replace: AtomicReplace;
	readonly #runId: string;
	#events: ExecutionEvent[] = [];
	#projection: ExecutionRunProjection | undefined;
	#tail: Promise<void> = Promise.resolve();
	#halted: Error | undefined;

	constructor(options: ExecutionEventRecorderOptions) {
		this.runDir = resolve(options.runDir);
		this.eventsPath = join(this.runDir, "events.jsonl");
		this.projectionPath = join(this.runDir, "execution-run.json");
		this.reportPath = join(this.runDir, "summary.md");
		this.#now = options.now ?? (() => new Date());
		this.#replace = options.replace ?? replaceAtomically;
		this.#runId = requiredIdentity(options.runId, "runId");
		mkdirSync(dirname(this.runDir), { recursive: true });
		mkdirSync(this.runDir);
	}

	record(event: ExecutionEventName, payload: Record<string, unknown>): Promise<Readonly<ExecutionRunProjection>> {
		let result: ExecutionRunProjection | undefined;
		const candidatePayload = structuredClone(payload);
		const commit = this.#tail.then(() => {
			if (this.#halted) throw new Error(`execution recorder stopped after derived publication failure: ${this.#halted.message}`);
			result = this.#commit(event, candidatePayload);
		});
		this.#tail = commit.catch(() => undefined);
		return commit.then(() => structuredClone(result as ExecutionRunProjection));
	}

	projection(): Readonly<ExecutionRunProjection> | undefined {
		return this.#projection ? structuredClone(this.#projection) : undefined;
	}

	#commit(name: ExecutionEventName, payload: Record<string, unknown>): ExecutionRunProjection {
		const event = parseExecutionEvent({
			schema: EXECUTION_EVENT_SCHEMA,
			version: EXECUTION_EVENT_VERSION,
			runId: this.#runId,
			sequence: this.#events.length + 1,
			occurredAt: timestamp(this.#now()),
			event: name,
			payload,
		});
		const projection = reduceExecutionEvent(this.#projection, event);
		const events = [...this.#events, event];
		// ponytail: compact whole-log replacement is O(n²) over a run; use immutable segments only if measured event volume makes that material.
		try {
			this.#replace(this.eventsPath, serializeLog(events), "events");
		} catch (error) {
			this.#halted = error instanceof Error ? error : new Error(String(error));
			throw this.#halted;
		}
		this.#events = events;
		this.#projection = projection;
		try {
			this.#replace(this.projectionPath, serializeJson(projection), "projection");
			if (projection.terminalOutcome) this.#replace(this.reportPath, renderExecutionReport(projection), "report");
		} catch (error) {
			this.#halted = error instanceof Error ? error : new Error(String(error));
			throw this.#halted;
		}
		return projection;
	}
}

export function createExecutionEventRecorder(options: ExecutionEventRecorderOptions): ExecutionEventRecorder {
	return new ExecutionEventRecorder(options);
}

export function replayExecutionArtifacts(runDir: string, replace: AtomicReplace = replaceAtomically): ExecutionRunProjection {
	const root = resolve(runDir);
	const events = parseEventLog(readFileSync(join(root, "events.jsonl"), "utf8"));
	const projection = replayExecutionEvents(events);
	replace(join(root, "execution-run.json"), serializeJson(projection), "projection");
	replace(join(root, "summary.md"), renderExecutionReport(projection), "report");
	return projection;
}

export function parseEventLog(bytes: string): ExecutionEvent[] {
	if (!bytes || !bytes.endsWith("\n")) throw new TypeError("events.jsonl must be non-empty and newline framed");
	const lines = bytes.slice(0, -1).split("\n");
	return lines.map((line, index) => {
		if (!line) throw new TypeError(`events.jsonl line ${index + 1} is empty`);
		try {
			return parseExecutionEvent(JSON.parse(line));
		} catch (error) {
			throw new TypeError(`invalid events.jsonl line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}

function replaceAtomically(path: string, bytes: string): void {
	const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, bytes, { encoding: "utf8", flag: "wx" });
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

function serializeLog(events: ExecutionEvent[]): string {
	return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function serializeJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function timestamp(value: Date): string {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("execution recorder clock returned an invalid Date");
	return value.toISOString();
}

function requiredIdentity(value: unknown, path: string): string {
	if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError(`${path} must be a non-empty identity`);
	return value;
}
