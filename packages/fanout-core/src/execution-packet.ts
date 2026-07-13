import { parseArtifactIdentity, parseGitCommitId, parseGitTreeId, type ArtifactIdentity, type GitCommitId, type GitTreeId } from "./artifact-identity.ts";
import { validateWorkContractNodes, type WorkContractGraph } from "./work-contract-graph.ts";
import { type WorkContract, type WorkContractIssue } from "./work-contract.ts";

export const EXECUTION_PACKET_SCHEMA = "fanout.execution-packet";
export const EXECUTION_PACKET_VERSION = 5;
export const ACTIVE_PACKET_SCHEMA = "fanout.active-packet";

export type TierName = "tier1" | "tier2";
export type TierStatus = "available" | "unavailable";
export type WorkActiveState = "active" | "background";
export type WorkUnitKind = "implement" | "test" | "docs" | "inspect" | "validate-shard" | "review-shard" | "final-validation";

export interface TierModelSummary {
	provider: string;
	model: string;
	thinking: string;
	source: string;
	status: TierStatus;
	reason: string;
}

export interface FanoutTierPlan {
	tier1: TierModelSummary;
	tier2: TierModelSummary & { fallback?: TierName };
	tier2Fallback: TierModelSummary;
}

export interface FanoutRuntimePolicy {
	maxConcurrency: number;
	failFast: boolean;
	fallbackAllowed: boolean;
}

export interface WorkUnitTierAssignment {
	preferred: TierName;
	assigned: TierName;
	fallback: TierName;
	provider: string;
	model: string;
	thinking: string;
	reason: string;
}

export interface FanoutPacketNode {
	id: string;
	kind: WorkUnitKind;
	tier: WorkUnitTierAssignment;
	active: WorkActiveState;
	workContract: WorkContract;
}

export type FanoutWorkUnit = FanoutPacketNode;

export interface FanoutExecutionPacket {
	schema: typeof EXECUTION_PACKET_SCHEMA;
	version: typeof EXECUTION_PACKET_VERSION;
	createdAt: string;
	sourceArtifacts: { plan: ArtifactIdentity; details: ArtifactIdentity };
	planningHost: { platform: NodeJS.Platform };
	planningBase: { headCommit: GitCommitId; tree: GitTreeId };
	objective: string;
	userContext: string[];
	discoveredRepoFacts: string[];
	assumptions: string[];
	tierPlan: FanoutTierPlan;
	runtimePolicy: FanoutRuntimePolicy;
	nodes: FanoutPacketNode[];
}

export interface PacketValidationResult {
	ok: boolean;
	executable: boolean;
	errors: WorkContractIssue[];
	warnings: WorkContractIssue[];
	packet?: FanoutExecutionPacket;
	graph?: WorkContractGraph;
}

export function executionPacketBytes(packet: FanoutExecutionPacket): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(packet, null, 2)}\n`);
}

export function deriveTierAssignment(preferred: TierName, plan: FanoutTierPlan): WorkUnitTierAssignment {
	const assigned: TierName = preferred === "tier2" && plan.tier2.status === "available" ? "tier2" : "tier1";
	const model = assigned === "tier2" ? plan.tier2 : preferred === "tier2" ? plan.tier2Fallback : plan.tier1;
	return { preferred, assigned, fallback: "tier1", provider: model.provider, model: model.model, thinking: model.thinking, reason: assigned === "tier2" ? "approved background worker" : preferred === "tier2" ? "tier2 unavailable; concrete realtime fallback" : "controller tier" };
}

export function derivePreferredTier(kind: WorkUnitKind): TierName {
	return kind === "final-validation" ? "tier1" : "tier2";
}

const PACKET_FIELDS = new Set(["schema", "version", "createdAt", "sourceArtifacts", "planningHost", "planningBase", "objective", "userContext", "discoveredRepoFacts", "assumptions", "tierPlan", "runtimePolicy", "nodes"]);
const NODE_FIELDS = new Set(["id", "kind", "tier", "active", "workContract"]);
const SUMMARY_FIELDS = new Set(["provider", "model", "thinking", "source", "status", "reason", "fallback"]);
const ASSIGNMENT_FIELDS = new Set(["preferred", "assigned", "fallback", "provider", "model", "thinking", "reason"]);
const VALID_KINDS = new Set<WorkUnitKind>(["implement", "test", "docs", "inspect", "validate-shard", "review-shard", "final-validation"]);

export function validateExecutionPacket(value: unknown): PacketValidationResult {
	const errors: WorkContractIssue[] = [];
	if (!record(value)) return failure("packet-not-object", "execution packet must be an object");
	unknown(value, PACKET_FIELDS, "", errors);
	if (value.schema !== EXECUTION_PACKET_SCHEMA) add(errors, "invalid-schema", `schema must be ${EXECUTION_PACKET_SCHEMA}; rerun /fanout-plan`, "schema");
	if (value.version !== EXECUTION_PACKET_VERSION) add(errors, "invalid-version", `version must be ${EXECUTION_PACKET_VERSION}; rerun /fanout-plan`, "version");
	if (!timestamp(value.createdAt)) add(errors, "invalid-created-at", "createdAt must be an ISO timestamp", "createdAt");
	let sourceArtifacts: FanoutExecutionPacket["sourceArtifacts"] | undefined;
	try {
		if (!exact(value.sourceArtifacts, ["plan", "details"])) throw new TypeError("sourceArtifacts must contain plan and details only");
		sourceArtifacts = { plan: parseArtifactIdentity(value.sourceArtifacts.plan), details: parseArtifactIdentity(value.sourceArtifacts.details) };
	} catch (error) { add(errors, "invalid-source-identity", message(error), "sourceArtifacts"); }
	let planningHost: FanoutExecutionPacket["planningHost"] | undefined;
	if (!exact(value.planningHost, ["platform"]) || !platform(value.planningHost.platform)) add(errors, "invalid-planning-host", "planningHost must contain a supported platform", "planningHost");
	else planningHost = { platform: value.planningHost.platform };
	let planningBase: FanoutExecutionPacket["planningBase"] | undefined;
	try {
		if (!exact(value.planningBase, ["headCommit", "tree"])) throw new TypeError("planningBase must contain headCommit and tree only");
		planningBase = { headCommit: parseGitCommitId(value.planningBase.headCommit), tree: parseGitTreeId(value.planningBase.tree) };
	} catch (error) { add(errors, "invalid-planning-base", message(error), "planningBase"); }
	const objective = text(value.objective, "objective", errors);
	const userContext = strings(value.userContext, "userContext", errors);
	const discoveredRepoFacts = strings(value.discoveredRepoFacts, "discoveredRepoFacts", errors);
	const assumptions = strings(value.assumptions, "assumptions", errors);
	const tierPlan = parseTierPlan(value.tierPlan, errors);
	const runtimePolicy = parseRuntimePolicy(value.runtimePolicy, errors);
	const nodes = parseNodes(value.nodes, errors);
	if (tierPlan) validateTierAssignments(nodes, tierPlan, errors);
	const validated = validateWorkContractNodes(nodes.map(({ id, kind, workContract }) => ({ id, kind, workContract })));
	errors.push(...validated.errors);
	if (nodes.filter((node) => node.kind === "final-validation").length !== 1) add(errors, "final-validation-count", "exactly one final-validation node is required", "nodes");
	if (errors.length || !sourceArtifacts || !planningHost || !planningBase || !tierPlan || !runtimePolicy || !validated.graph) return { ok: false, executable: false, errors, warnings: [] };
	const packet: FanoutExecutionPacket = { schema: EXECUTION_PACKET_SCHEMA, version: EXECUTION_PACKET_VERSION, createdAt: value.createdAt as string, sourceArtifacts, planningHost, planningBase, objective, userContext, discoveredRepoFacts, assumptions, tierPlan, runtimePolicy, nodes };
	return { ok: true, executable: true, errors: [], warnings: [], packet, graph: validated.graph };
}

export function deriveExecutionGraph(packet: FanoutExecutionPacket): WorkContractGraph {
	const result = validateWorkContractNodes(packet.nodes.map(({ id, kind, workContract }) => ({ id, kind, workContract })));
	if (!result.graph) throw new Error(result.errors.map((issue) => issue.message).join("; "));
	return result.graph;
}

export function formatPacketValidationResult(result: PacketValidationResult): string {
	const lines = [`valid=${result.ok}`, `executable=${result.executable}`];
	if (result.errors.length) lines.push("errors:", ...result.errors.map((issue) => `- ${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ""}`));
	return `${lines.join("\n")}\n`;
}

function parseNodes(value: unknown, errors: WorkContractIssue[]): FanoutPacketNode[] {
	if (!Array.isArray(value) || !value.length) { add(errors, "invalid-node-list", "nodes must be a non-empty array", "nodes"); return []; }
	return value.flatMap((item, index) => {
		const path = `nodes[${index}]`;
		if (!record(item)) { add(errors, "invalid-node", "node must be an object", path); return []; }
		unknown(item, NODE_FIELDS, path, errors);
		const id = text(item.id, `${path}.id`, errors, true);
		if (!VALID_KINDS.has(item.kind as WorkUnitKind)) add(errors, "invalid-kind", "node kind is unsupported", `${path}.kind`);
		if (item.active !== "active" && item.active !== "background") add(errors, "invalid-active", "active must be active or background", `${path}.active`);
		const tier = parseTierAssignment(item.tier, `${path}.tier`, errors);
		if (!record(item.workContract)) add(errors, "invalid-work-contract", "node workContract must be an object", `${path}.workContract`);
		return tier && record(item.workContract) ? [{ id, kind: item.kind as WorkUnitKind, tier, active: item.active as WorkActiveState, workContract: item.workContract as unknown as WorkContract }] : [];
	});
}

function parseTierPlan(value: unknown, errors: WorkContractIssue[]): FanoutTierPlan | undefined {
	if (!exact(value, ["tier1", "tier2", "tier2Fallback"])) { add(errors, "invalid-tier-plan", "tierPlan must contain tier1, tier2, and tier2Fallback only", "tierPlan"); return; }
	const tier1 = summary(value.tier1, "tierPlan.tier1", errors);
	const tier2 = summary(value.tier2, "tierPlan.tier2", errors, true);
	const tier2Fallback = summary(value.tier2Fallback, "tierPlan.tier2Fallback", errors);
	if (tier1?.status !== "available" || tier2Fallback?.status !== "available") add(errors, "unavailable-required-tier", "tier1 and tier2Fallback must be available", "tierPlan");
	if ((tier2?.status === "unavailable" && tier2.fallback !== "tier1") || (tier2?.status === "available" && tier2.fallback !== undefined)) add(errors, "invalid-tier-fallback-policy", "tier2 must name tier1 fallback exactly when unavailable", "tierPlan.tier2.fallback");
	return tier1 && tier2 && tier2Fallback ? { tier1, tier2, tier2Fallback } : undefined;
}

function parseRuntimePolicy(value: unknown, errors: WorkContractIssue[]): FanoutRuntimePolicy | undefined {
	if (!exact(value, ["maxConcurrency", "failFast", "fallbackAllowed"])) { add(errors, "invalid-runtime-policy", "runtimePolicy must contain maxConcurrency, failFast, and fallbackAllowed only", "runtimePolicy"); return; }
	if (!Number.isSafeInteger(value.maxConcurrency) || (value.maxConcurrency as number) < 1) add(errors, "invalid-runtime-policy", "maxConcurrency must be a positive safe integer", "runtimePolicy.maxConcurrency");
	if (typeof value.failFast !== "boolean" || typeof value.fallbackAllowed !== "boolean") add(errors, "invalid-runtime-policy", "failFast and fallbackAllowed must be booleans", "runtimePolicy");
	return { maxConcurrency: value.maxConcurrency as number, failFast: value.failFast as boolean, fallbackAllowed: value.fallbackAllowed as boolean };
}

function summary(value: unknown, path: string, errors: WorkContractIssue[], fallback = false): TierModelSummary & { fallback?: TierName } | undefined {
	if (!record(value)) { add(errors, "invalid-tier-summary", "tier summary must be an object", path); return; }
	unknown(value, SUMMARY_FIELDS, path, errors);
	const result = { provider: text(value.provider, `${path}.provider`, errors), model: text(value.model, `${path}.model`, errors), thinking: text(value.thinking, `${path}.thinking`, errors), source: text(value.source, `${path}.source`, errors), status: value.status as TierStatus, reason: text(value.reason, `${path}.reason`, errors) };
	if (value.status !== "available" && value.status !== "unavailable") add(errors, "invalid-tier-status", "tier status must be available or unavailable", `${path}.status`);
	if (value.fallback !== undefined && (!fallback || (value.fallback !== "tier1" && value.fallback !== "tier2"))) add(errors, "invalid-tier-fallback", "tier fallback is invalid", `${path}.fallback`);
	return { ...result, ...(value.fallback === undefined ? {} : { fallback: value.fallback as TierName }) };
}

function parseTierAssignment(value: unknown, path: string, errors: WorkContractIssue[]): WorkUnitTierAssignment | undefined {
	if (!record(value)) { add(errors, "invalid-tier-assignment", "tier assignment must be an object", path); return; }
	unknown(value, ASSIGNMENT_FIELDS, path, errors);
	for (const field of ["preferred", "assigned", "fallback"] as const) if (value[field] !== "tier1" && value[field] !== "tier2") add(errors, "invalid-tier-assignment", `${field} must be tier1 or tier2`, `${path}.${field}`);
	return { preferred: value.preferred as TierName, assigned: value.assigned as TierName, fallback: value.fallback as TierName, provider: text(value.provider, `${path}.provider`, errors), model: text(value.model, `${path}.model`, errors), thinking: text(value.thinking, `${path}.thinking`, errors), reason: text(value.reason, `${path}.reason`, errors) };
}

function validateTierAssignments(nodes: readonly FanoutPacketNode[], plan: FanoutTierPlan, errors: WorkContractIssue[]): void {
	for (const [index, node] of nodes.entries()) {
		const path = `nodes[${index}]`;
		if (node.tier.preferred !== "tier1" && node.tier.preferred !== "tier2") continue;
		const expected = deriveTierAssignment(derivePreferredTier(node.kind), plan);
		if (JSON.stringify(node.tier) !== JSON.stringify(expected)) add(errors, "tier-assignment-plan-mismatch", "node tier assignment does not match the admitted tier plan", `${path}.tier`);
		const expectedActive: WorkActiveState = expected.assigned === "tier2" ? "background" : "active";
		if (node.active !== expectedActive) add(errors, "tier-active-mismatch", `node active state must be ${expectedActive} for ${expected.assigned}`, `${path}.active`);
	}
}

function strings(value: unknown, path: string, errors: WorkContractIssue[]): string[] { if (!Array.isArray(value)) { add(errors, "invalid-string-list", `${path} must be an array`, path); return []; } return value.map((item, index) => text(item, `${path}[${index}]`, errors)); }
function text(value: unknown, path: string, errors: WorkContractIssue[], canonical = false): string { if (typeof value !== "string" || !value.trim() || /\p{Cc}/u.test(value) || canonical && value !== value.trim()) { add(errors, "invalid-text", `${path} must be non-empty without controls${canonical ? " and canonical" : ""}`, path); return "invalid"; } return value; }
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function platform(value: unknown): value is NodeJS.Platform { return typeof value === "string" && ["aix", "android", "darwin", "freebsd", "haiku", "linux", "openbsd", "sunos", "win32", "cygwin", "netbsd"].includes(value); }
function exact(value: unknown, fields: string[]): value is Record<string, unknown> { return record(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)); }
function unknown(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: WorkContractIssue[]): void { for (const field of Object.keys(value)) if (!allowed.has(field)) add(errors, "unknown-field", `unknown field ${field}`, path ? `${path}.${field}` : field); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function add(errors: WorkContractIssue[], code: string, message: string, path?: string): void { errors.push({ code, message, ...(path ? { path } : {}) }); }
function failure(code: string, message: string): PacketValidationResult { return { ok: false, executable: false, errors: [{ code, message }], warnings: [] }; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
