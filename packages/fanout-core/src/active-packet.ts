import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArtifactIdentity, type ArtifactIdentity } from "./artifact-identity.ts";
import { ACTIVE_PACKET_SCHEMA, EXECUTION_PACKET_VERSION, formatPacketValidationResult, validateExecutionPacket, type FanoutExecutionPacket, type PacketValidationResult } from "./execution-packet.ts";

export { ACTIVE_PACKET_SCHEMA };
export const ACTIVE_PACKET_VERSION = 2;

export interface ActivePacketPointer {
	schema: typeof ACTIVE_PACKET_SCHEMA;
	version: typeof ACTIVE_PACKET_VERSION;
	publishedAt: string;
	packet: ArtifactIdentity;
}

export interface LoadedActiveExecutionPacket {
	activePointerPath: string;
	projectArtifactRoot: string;
	pointer: ActivePacketPointer;
	packetPath: string;
	artifactDir: string;
	packet: FanoutExecutionPacket;
	validation: PacketValidationResult;
}

export function validateActivePacketPointer(value: unknown): { ok: boolean; errors: string[]; pointer?: ActivePacketPointer } {
	try {
		if (!record(value) || Object.keys(value).length !== 4 || !["schema", "version", "publishedAt", "packet"].every((field) => Object.hasOwn(value, field))) throw new TypeError("active pointer has unknown or missing fields");
		if (value.schema !== ACTIVE_PACKET_SCHEMA || value.version !== ACTIVE_PACKET_VERSION) throw new TypeError(`active pointer must be ${ACTIVE_PACKET_SCHEMA} v${ACTIVE_PACKET_VERSION}; rerun /fanout-plan`);
		if (typeof value.publishedAt !== "string" || !Number.isFinite(Date.parse(value.publishedAt))) throw new TypeError("publishedAt must be an ISO timestamp");
		return { ok: true, errors: [], pointer: { schema: ACTIVE_PACKET_SCHEMA, version: ACTIVE_PACKET_VERSION, publishedAt: value.publishedAt, packet: parseArtifactIdentity(value.packet) } };
	} catch (error) { return { ok: false, errors: [message(error)] }; }
}

export function loadActiveExecutionPacket(activePointerPath: string, projectArtifactRoot: string): LoadedActiveExecutionPacket {
	const pointerPath = resolve(activePointerPath);
	const root = realpathSync(resolve(projectArtifactRoot));
	let pointerValue: unknown;
	try { pointerValue = JSON.parse(readFileSync(pointerPath, "utf8")); }
	catch (error) { throw new Error(`failed to read active packet pointer ${pointerPath}: ${message(error)}`); }
	const admittedPointer = validateActivePacketPointer(pointerValue);
	if (!admittedPointer.pointer) throw new Error(`unsupported active packet pointer; rerun /fanout-plan: ${admittedPointer.errors.join("; ")}`);
	const packetPath = realpathSync(resolve(root, admittedPointer.pointer.packet.path));
	if (!contained(packetPath, root)) throw new Error("active packet identity escapes the project artifact root; rerun /fanout-plan");
	const bytes = readFileSync(packetPath);
	if (bytes.byteLength !== admittedPointer.pointer.packet.byteLength) throw new Error("active packet byte length changed; rerun /fanout-plan");
	if (createHash("sha256").update(bytes).digest("hex") !== admittedPointer.pointer.packet.sha256) throw new Error("active packet digest changed; rerun /fanout-plan");
	let value: unknown;
	try { value = JSON.parse(bytes.toString("utf8")); }
	catch (error) { throw new Error(`active packet is not valid JSON; rerun /fanout-plan: ${message(error)}`); }
	const validation = validateExecutionPacket(value);
	if (!validation.packet || value && record(value) && value.version !== EXECUTION_PACKET_VERSION) throw new Error(`active execution packet is unsupported; rerun /fanout-plan\n${formatPacketValidationResult(validation).trim()}`);
	return { activePointerPath: pointerPath, projectArtifactRoot: root, pointer: admittedPointer.pointer, packetPath, artifactDir: dirname(packetPath), packet: validation.packet, validation };
}

function contained(path: string, root: string): boolean { const value = relative(root, path); return value === "" || value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
