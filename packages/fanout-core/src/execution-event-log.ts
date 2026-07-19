import { canonicalTimestamp, contractIdentity, contractRecord, positiveSafeInteger } from "./contract-value.ts";
import { EXECUTION_EVENT_SCHEMA, parseExecutionEvent, type ExecutionEvent } from "./execution-event.ts";
import { reduceExecutionEvent, type ExecutionRunProjection } from "./execution-projection.ts";

export type ExecutionEventLogAdmissionErrorCode =
	| "invalid-input"
	| "empty-log"
	| "incomplete-frame"
	| "blank-row"
	| "malformed-json"
	| "invalid-event"
	| "invalid-log";

export class ExecutionEventLogAdmissionError extends TypeError {
	readonly code: ExecutionEventLogAdmissionErrorCode;
	readonly line: number | undefined;

	constructor(code: ExecutionEventLogAdmissionErrorCode, message: string, line?: number) {
		super(message);
		this.name = "ExecutionEventLogAdmissionError";
		this.code = code;
		this.line = line;
	}
}

export interface ExecutionEventLogEnvelope {
	readonly schema: typeof EXECUTION_EVENT_SCHEMA;
	readonly version: number;
	readonly runId: string;
	readonly startedAt: string;
	readonly updatedAt: string;
	readonly eventCount: number;
}

export function parseExecutionEventLog(bytes: string): ExecutionEvent[] {
	let projection: ExecutionRunProjection | undefined;
	return parseRows(bytes).map(({ value, line }) => {
		let event: ExecutionEvent;
		try {
			event = parseExecutionEvent(value);
		} catch (error) {
			throw new ExecutionEventLogAdmissionError("invalid-event", `execution Event Log line ${line} is invalid: ${message(error)}`, line);
		}
		try {
			projection = reduceExecutionEvent(projection, event);
		} catch (error) {
			throw new ExecutionEventLogAdmissionError("invalid-log", `execution Event Log line ${line} breaks replay: ${message(error)}`, line);
		}
		return event;
	});
}

export function inspectExecutionEventLogEnvelope(bytes: string): ExecutionEventLogEnvelope {
	const rows = parseRows(bytes);
	let version: number | undefined;
	let runId: string | undefined;
	let startedAt = "";
	let updatedAt = "";
	for (const { value, line } of rows) {
		let rowVersion: number;
		let rowRunId: string;
		let sequence: number;
		let event: string;
		let occurredAt: string;
		try {
			if (!contractRecord(value) || value.schema !== EXECUTION_EVENT_SCHEMA) throw new TypeError("schema is invalid");
			rowVersion = positiveSafeInteger(value.version, "version");
			rowRunId = contractIdentity(value.runId, "runId");
			sequence = positiveSafeInteger(value.sequence, "sequence");
			event = contractIdentity(value.event, "event");
			occurredAt = canonicalTimestamp(value.occurredAt, "occurredAt");
		} catch {
			throw new ExecutionEventLogAdmissionError("invalid-event", `execution Event Log line ${line} has an invalid event envelope`, line);
		}
		if (line === 1 && (sequence !== 1 || event !== "run-started")) throw new ExecutionEventLogAdmissionError("invalid-log", "execution Event Log must begin with run-started at sequence 1", line);
		if (sequence !== line) throw new ExecutionEventLogAdmissionError("invalid-log", `execution Event Log line ${line} breaks the gapless sequence`, line);
		if (version !== undefined && rowVersion !== version) throw new ExecutionEventLogAdmissionError("invalid-log", `execution Event Log line ${line} mixes artifact generations`, line);
		if (runId !== undefined && rowRunId !== runId) throw new ExecutionEventLogAdmissionError("invalid-log", `execution Event Log line ${line} mixes run identities`, line);
		version ??= rowVersion;
		runId ??= rowRunId;
		if (line === 1) startedAt = occurredAt;
		updatedAt = occurredAt;
	}
	return Object.freeze({ schema: EXECUTION_EVENT_SCHEMA, version: version!, runId: runId!, startedAt, updatedAt, eventCount: rows.length });
}

function parseRows(bytes: string): Array<{ value: unknown; line: number }> {
	if (typeof bytes !== "string") throw new ExecutionEventLogAdmissionError("invalid-input", "execution Event Log bytes must be a string");
	if (!bytes) throw new ExecutionEventLogAdmissionError("empty-log", "execution Event Log must be non-empty");
	if (!bytes.endsWith("\n")) throw new ExecutionEventLogAdmissionError("incomplete-frame", "execution Event Log must end with a newline");

	return bytes.slice(0, -1).split("\n").map((row, index) => {
		const line = index + 1;
		if (!row.trim()) throw new ExecutionEventLogAdmissionError("blank-row", `execution Event Log line ${line} is blank`, line);
		let value: unknown;
		try {
			value = JSON.parse(row);
		} catch (error) {
			throw new ExecutionEventLogAdmissionError("malformed-json", `execution Event Log line ${line} is malformed JSON: ${message(error)}`, line);
		}
		return { value, line };
	});
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
