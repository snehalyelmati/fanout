import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { CString, dlopen, FFIType, ptr } from "bun:ffi";

export type SourceKind = "planning" | "execution" | "pointer" | "supporting-evidence";

export interface SourceReference {
	readonly id: string;
	readonly path: string;
	readonly kind: SourceKind;
	readonly byteLength: number;
	readonly modifiedAtMs: number;
	readonly sha256?: string;
}

export interface Fingerprint { dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string }
export interface RootIdentity { dev: string; ino: string }
export interface StoredReference { reference: SourceReference; fingerprint: Fingerprint }

const MAX_EVENT_HEADER_BYTES = 1024 * 1024;
const libc = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : process.platform === "linux" ? "libc.so.6" : (() => { throw new Error("fanout-profiler requires POSIX openat support"); })(), {
	openat: { args: [FFIType.i32, FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
	fdopendir: { args: [FFIType.i32], returns: FFIType.ptr },
	readdir: { args: [FFIType.ptr], returns: FFIType.ptr },
	closedir: { args: [FFIType.ptr], returns: FFIType.i32 },
});

export class ReferenceIssuer {
	readonly #root: string;
	readonly #generation: number;
	#sequence = 0;
	readonly #references = new Map<string, StoredReference>();
	readonly #contentBytesRead: Record<SourceKind, number> = { planning: 0, execution: 0, pointer: 0, "supporting-evidence": 0 };

	readonly #rootIdentity: RootIdentity;

	constructor(root: string, rootIdentity: RootIdentity, generation: number) { this.#root = root; this.#rootIdentity = rootIdentity; this.#generation = generation; }
	get references(): ReadonlyMap<string, StoredReference> { return this.#references; }
	get contentBytesRead(): Readonly<Record<SourceKind, number>> { return this.#contentBytesRead; }
	readdir(path = ""): string[] { return readdirContained(this.#root, this.#rootIdentity, path); }
	kind(path: string): "file" | "directory" {
		const fd = openContained(this.#root, this.#rootIdentity, path, "any");
		try {
			const stat = fstatSync(fd);
			if (stat.isFile()) return "file";
			if (stat.isDirectory()) return "directory";
			throw new Error(`${path} is not a regular file or directory`);
		} finally { closeSync(fd); }
	}

	read(path: string, kind: SourceKind, digest: boolean): { bytes: Buffer; reference: SourceReference } {
		const fd = openReadOnlyContained(this.#root, this.#rootIdentity, path);
		try {
			const before = fingerprint(fstatSync(fd, { bigint: true }));
			const bytes = readFileSync(fd);
			this.#contentBytesRead[kind] += bytes.byteLength;
			const stat = fstatSync(fd, { bigint: true });
			if (!sameFingerprint(before, fingerprint(stat))) throw new Error(`${path} changed during refresh`);
			if (!sourceMatches(this.#root, this.#rootIdentity, path, fingerprint(stat))) throw new Error(`${path} changed during refresh`);
			return { bytes, reference: this.#issue(path, kind, stat, digest ? createHash("sha256").update(bytes).digest("hex") : undefined) };
		} finally { closeSync(fd); }
	}

	readFirstLine(path: string, kind: SourceKind): { bytes: Buffer; reference: SourceReference } {
		const fd = openReadOnlyContained(this.#root, this.#rootIdentity, path);
		try {
			const before = fingerprint(fstatSync(fd, { bigint: true }));
			const bytes = firstLine(fd);
			this.#contentBytesRead[kind] += bytes.byteLength;
			const stat = fstatSync(fd, { bigint: true });
			if (!sameFingerprint(before, fingerprint(stat))) throw new Error(`${path} changed during refresh`);
			if (!sourceMatches(this.#root, this.#rootIdentity, path, fingerprint(stat))) throw new Error(`${path} changed during refresh`);
			return { bytes, reference: this.#issue(path, kind, stat) };
		} finally { closeSync(fd); }
	}

	reference(path: string, kind: SourceKind): SourceReference {
		const fd = openReadOnlyContained(this.#root, this.#rootIdentity, path);
		try {
			const stat = fstatSync(fd, { bigint: true });
			if (!sourceMatches(this.#root, this.#rootIdentity, path, fingerprint(stat))) throw new Error(`${path} changed during refresh`);
			return this.#issue(path, kind, stat);
		}
		finally { closeSync(fd); }
	}

	#issue(path: string, kind: SourceKind, stat: BigIntStats, sha256?: string): SourceReference {
		const id = `source-${this.#generation}-${++this.#sequence}`;
		const reference = Object.freeze({ id, path, kind, byteLength: Number(stat.size), modifiedAtMs: Number(stat.mtimeNs) / 1_000_000, ...(sha256 ? { sha256 } : {}) });
		this.#references.set(id, { reference, fingerprint: fingerprint(stat) });
		return reference;
	}
}

export function canonicalRoot(value: string): string {
	const root = realpathSync(resolve(value));
	assertRoot(root);
	return root;
}

export function rootIdentity(root: string): RootIdentity {
	const stat = lstatSync(root, { bigint: true });
	return { dev: String(stat.dev), ino: String(stat.ino) };
}

export function assertRoot(root: string, expected?: RootIdentity): void {
	const stat = lstatSync(root, { bigint: true });
	const actual = { dev: String(stat.dev), ino: String(stat.ino) };
	if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root || expected && (actual.dev !== expected.dev || actual.ino !== expected.ino)) throw new Error("artifact root must remain one canonical directory");
}

export function openReadOnlyContained(root: string, expectedRoot: RootIdentity, path: string): number {
	return openContained(root, expectedRoot, path, "file");
}
export function readdirContained(root: string, expectedRoot: RootIdentity, path: string): string[] {
	const fd = openContained(root, expectedRoot, path, "directory");
	const directory = libc.symbols.fdopendir(fd);
	if (!directory) { closeSync(fd); throw new Error(`${path || "artifact root"} could not be enumerated`); }
	try {
		const names: string[] = [];
		const nameOffset = process.platform === "darwin" ? 21 : 19;
		for (;;) {
			const entry = libc.symbols.readdir(directory);
			if (!entry) break;
			const name = new CString(entry, nameOffset).toString();
			if (name !== "." && name !== "..") names.push(name);
		}
		return names;
	} finally { libc.symbols.closedir(directory); }
}
function openContained(root: string, expectedRoot: RootIdentity, path: string, expectedKind: "file" | "directory" | "any"): number {
	const segments = relativeSegments(path, true);
	let parent = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_DIRECTORY);
	try {
		const rootStat = fstatSync(parent, { bigint: true });
		if (!rootStat.isDirectory() || String(rootStat.dev) !== expectedRoot.dev || String(rootStat.ino) !== expectedRoot.ino) throw new Error("artifact root changed before read-only open");
		for (const [index, segment] of segments.entries()) {
			const name = Buffer.from(`${segment}\0`);
			const directory = index < segments.length - 1 || expectedKind === "directory";
			const child = libc.symbols.openat(parent, ptr(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0));
			if (child < 0) throw new Error(`${path} is unavailable or contains a descendant symlink`);
			if (parent !== child) closeSync(parent);
			parent = child;
			const stat = fstatSync(parent, { bigint: true });
			if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`${path} has a non-directory ancestor`);
		}
		const resultStat = fstatSync(parent);
		if (expectedKind === "file" && !resultStat.isFile() || expectedKind === "directory" && !resultStat.isDirectory()) throw new Error(`${path || "artifact root"} has the wrong file type`);
		const result = parent;
		parent = -1;
		return result;
	} finally { if (parent >= 0) closeSync(parent); }
}
export function fingerprint(stat: BigIntStats): Fingerprint { return { dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) }; }
export function sameFingerprint(left: Fingerprint, right: Fingerprint): boolean { return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs; }
export function sourceMatches(root: string, rootIdentity: RootIdentity, path: string, expected: Fingerprint): boolean {
	let fd = -1;
	try { fd = openReadOnlyContained(root, rootIdentity, path); return sameFingerprint(expected, fingerprint(fstatSync(fd, { bigint: true }))); }
	catch { return false; }
	finally { if (fd >= 0) closeSync(fd); }
}

function firstLine(fd: number): Buffer {
	const chunks: Buffer[] = [];
	let total = 0;
	for (;;) {
		const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_EVENT_HEADER_BYTES - total));
		const count = readSync(fd, chunk, 0, chunk.length, total);
		if (!count) break;
		const bytes = chunk.subarray(0, count);
		const newline = bytes.indexOf(10);
		chunks.push(newline === -1 ? bytes : bytes.subarray(0, newline));
		total += newline === -1 ? count : newline + 1;
		if (newline !== -1) break;
		if (total === MAX_EVENT_HEADER_BYTES) throw new Error("Event Log first row exceeds the catalog admission bound");
	}
	const line = Buffer.concat(chunks);
	if (!line.length) throw new Error("Event Log is empty");
	return line;
}

function relativeSegments(path: string, allowRoot = false): string[] {
	if (allowRoot && path === "") return [];
	if (!path || path.includes("\\") || path.includes("\0") || isAbsolute(path)) throw new Error("source path is not canonical relative evidence");
	const segments = path.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("source path is not canonical relative evidence");
	return segments;
}
