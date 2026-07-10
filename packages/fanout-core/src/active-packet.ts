import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
	ACTIVE_PACKET_SCHEMA,
	formatPacketValidationResult,
	readExecutionPacket,
	validateExecutionPacket,
	type FanoutExecutionPacket,
	type PacketValidationResult,
} from "./execution-packet.ts";

export { ACTIVE_PACKET_SCHEMA };
export const ACTIVE_PACKET_VERSION = 1;

export interface ActivePacketPointer {
	schema: typeof ACTIVE_PACKET_SCHEMA;
	version: typeof ACTIVE_PACKET_VERSION;
	updatedAt: string;
	packetPath: string;
}

export interface ActivePacketPointerValidationResult {
	ok: boolean;
	errors: string[];
	pointer?: ActivePacketPointer;
}

export interface LoadedActiveExecutionPacket {
	activePointerPath: string;
	projectArtifactRoot: string;
	pointer: ActivePacketPointer;
	packetPath: string;
	artifactDir: string;
	packet: FanoutExecutionPacket;
	pointerValidation: ActivePacketPointerValidationResult;
	validation: PacketValidationResult;
}

export function validateActivePacketPointer(value: unknown): ActivePacketPointerValidationResult {
	if (!isRecord(value)) return { ok: false, errors: ["active packet pointer must be an object"] };

	const errors: string[] = [];
	if (value.schema !== ACTIVE_PACKET_SCHEMA) errors.push(`schema must be ${ACTIVE_PACKET_SCHEMA}`);
	if (value.version !== ACTIVE_PACKET_VERSION) errors.push(`version must be ${ACTIVE_PACKET_VERSION}`);
	if (!nonEmptyString(value.updatedAt)) errors.push("updatedAt must be a non-empty string");
	if (!nonEmptyString(value.packetPath)) errors.push("packetPath must be a non-empty string");

	return errors.length === 0 ? { ok: true, errors, pointer: value as unknown as ActivePacketPointer } : { ok: false, errors };
}

export function readActivePacketPointer(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

export function loadActiveExecutionPacket(activePointerPath: string, projectArtifactRoot: string): LoadedActiveExecutionPacket {
	const resolvedPointerPath = resolve(activePointerPath);
	const resolvedArtifactRoot = resolve(projectArtifactRoot);
	let pointerValue: unknown;
	try {
		pointerValue = readActivePacketPointer(resolvedPointerPath);
	} catch (error) {
		throw new Error(`failed to read active packet pointer ${resolvedPointerPath}: ${errorMessage(error)}`);
	}

	const pointerValidation = validateActivePacketPointer(pointerValue);
	if (!pointerValidation.ok || !pointerValidation.pointer) {
		throw new Error(`invalid active packet pointer ${resolvedPointerPath}: ${pointerValidation.errors.join("; ")}`);
	}

	const packetPath = resolve(resolvedArtifactRoot, pointerValidation.pointer.packetPath.trim());
	if (!isContainedPath(packetPath, resolvedArtifactRoot)) {
		throw new Error(`active packet path must stay under project artifact root ${resolvedArtifactRoot}: ${packetPath}`);
	}
	let canonicalPacketPath = packetPath;
	try {
		const realArtifactRoot = realpathSync(resolvedArtifactRoot);
		const realPacketPath = realpathSync(packetPath);
		if (!isContainedPath(realPacketPath, realArtifactRoot)) {
			throw new Error(`active packet path must stay under project artifact root ${realArtifactRoot}: ${realPacketPath}`);
		}
		canonicalPacketPath = realPacketPath;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("active packet path must stay under")) throw error;
		throw new Error(`failed to resolve active execution packet ${packetPath}: ${errorMessage(error)}`);
	}

	let packetValue: unknown;
	try {
		packetValue = readExecutionPacket(canonicalPacketPath);
	} catch (error) {
		throw new Error(`failed to read active execution packet ${canonicalPacketPath}: ${errorMessage(error)}`);
	}

	const validation = validateExecutionPacket(packetValue);
	if (!validation.executable) {
		throw new Error(`active execution packet is not executable: ${canonicalPacketPath}\n${formatPacketValidationResult(validation).trim()}`);
	}

	return {
		activePointerPath: resolvedPointerPath,
		projectArtifactRoot: resolvedArtifactRoot,
		pointer: pointerValidation.pointer,
		packetPath: canonicalPacketPath,
		artifactDir: dirname(canonicalPacketPath),
		packet: packetValue as FanoutExecutionPacket,
		pointerValidation,
		validation,
	};
}

function isContainedPath(path: string, root: string): boolean {
	const relativePath = relative(root, path);
	return relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
