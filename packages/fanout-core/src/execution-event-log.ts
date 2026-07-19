import { parseExecutionEvent, type ExecutionEvent } from "./execution-event.ts";
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

export function parseExecutionEventLog(bytes: string): ExecutionEvent[] {
	if (typeof bytes !== "string") throw new ExecutionEventLogAdmissionError("invalid-input", "execution Event Log bytes must be a string");
	if (!bytes) throw new ExecutionEventLogAdmissionError("empty-log", "execution Event Log must be non-empty");
	if (!bytes.endsWith("\n")) throw new ExecutionEventLogAdmissionError("incomplete-frame", "execution Event Log must end with a newline");

	let projection: ExecutionRunProjection | undefined;
	return bytes.slice(0, -1).split("\n").map((row, index) => {
		const line = index + 1;
		if (!row.trim()) throw new ExecutionEventLogAdmissionError("blank-row", `execution Event Log line ${line} is blank`, line);
		let value: unknown;
		try {
			value = JSON.parse(row);
		} catch (error) {
			throw new ExecutionEventLogAdmissionError("malformed-json", `execution Event Log line ${line} is malformed JSON: ${message(error)}`, line);
		}
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

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
