import { relative } from "node:path";
import type { AcceptedPatch, ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import type { AttemptOutcome, StageFact } from "../../fanout-core/src/execution-attempt.ts";
import type { FanoutExecutionPacket, FanoutWorkUnit } from "../../fanout-core/src/execution-packet.ts";
import { deriveFinalRepairWorkContract, type FinalValidationResult, type FinalControllerResult } from "../../fanout-core/src/final-validation.ts";
import type { AcceptedLedgerProvenance, AttemptRecoveryContext, FinalValidationRecoveryContext } from "../../fanout-core/src/recovery-evidence.ts";
import type { ValidationCommand } from "../../fanout-core/src/validation-command.ts";
import type { ProjectExecutionProfile } from "../../fanout-core/src/project-execution-profile.ts";
import { checkFinalRepairOwnership, ownershipViolationFactCode } from "./fanout-git.ts";
import { runFinalValidation } from "./final-validation.ts";
import { prepareProjectWorktree } from "./project-execution-profile.ts";
import type { PlanningBase } from "./repository-identity.ts";
import type { WorkerAttempt } from "./worker-attempt-execution.ts";

export function finalValidationCommands(packet: FanoutExecutionPacket, profile: ProjectExecutionProfile, fallback: readonly ValidationCommand[]): ValidationCommand[] {
	const finalUnit = packet.nodes.find((unit) => unit.kind === "final-validation");
	return [...(finalUnit ? finalUnit.workContract.validationCommands : fallback), ...profile.requiredFinalGates.map((entry) => entry.command)];
}

export async function runExecutorFinalValidation(options: {
	packet: FanoutExecutionPacket;
	packetIdentity: ArtifactIdentity;
	profile: ProjectExecutionProfile;
	profileIdentity: ArtifactIdentity;
	repoRoot: string;
	runDir: string;
	planningBase: PlanningBase;
	acceptedLedger: readonly AcceptedLedgerProvenance[];
	commands: readonly ValidationCommand[];
	timeoutMs: number;
	repairAvailable: (nodeId: string) => boolean;
	launchRepair: (unit: FanoutWorkUnit, recovery: FinalValidationRecoveryContext, source: { attemptId?: string; evidence?: ArtifactIdentity }, seed?: WorkerAttempt) => Promise<WorkerAttempt>;
	completeTerminal: (attempt: WorkerAttempt) => Promise<WorkerAttempt>;
	terminalOutcome: (attempt: WorkerAttempt) => AttemptOutcome;
	applyRepair: (unit: FanoutWorkUnit, attempt: WorkerAttempt, result: FinalValidationResult) => Promise<{ ok: boolean; attemptId: string }>;
	retainMutationLock: () => void;
}): Promise<FinalControllerResult> {
	const initialTree = options.acceptedLedger.at(-1)?.patch.resultTree ?? options.planningBase.tree;
	const finalUnit = options.packet.nodes.find((unit) => unit.kind === "final-validation");
	const finalContract = finalUnit?.workContract;
	const authoritativeCommands = finalValidationCommands(options.packet, options.profile, finalContract?.validationCommands ?? options.commands);
	const upstreamUnits = options.packet.nodes.filter((unit) => unit.kind !== "final-validation");
	const effectiveFinalContract = finalContract ? { ...finalContract, validationCommands: authoritativeCommands } : undefined;
	const repairContract = finalContract ? deriveFinalRepairWorkContract(upstreamUnits.map((unit) => unit.workContract), finalContract, authoritativeCommands) : undefined;
	const repairUnit = finalUnit && repairContract ? { ...finalUnit, kind: "implement" as const, workContract: repairContract } : undefined;
	return await runFinalValidation<WorkerAttempt>({
		repoRoot: options.repoRoot,
		runDir: options.runDir,
		planningBase: options.planningBase,
		ledger: options.acceptedLedger.map(({ patch }) => ({ patch })),
		commands: authoritativeCommands,
		expectedValidationTree: initialTree,
		expectedActiveTree: initialTree,
		timeoutMs: options.timeoutMs,
		prepareWorktree: async (worktreePath) => {
			const worktreeRelative = relative(options.runDir, worktreePath).split("\\").join("/");
			const prepared = await prepareProjectWorktree(options.profile, options.profileIdentity, {
				worktreePath,
				artifactRoot: options.runDir,
				evidencePath: `${worktreeRelative.slice(0, -"/worktree".length)}/preparation.json`,
				scopeId: worktreeRelative,
				timeoutMs: options.timeoutMs,
			});
			if (prepared.evidence.status !== "passed") throw new Error(prepared.evidence.error ?? "project worktree preparation failed");
			return prepared.artifact;
		},
		...(repairUnit && repairContract && effectiveFinalContract ? { repair: {
			packetIdentity: options.packetIdentity,
			workContract: repairContract,
			finalValidationContract: effectiveFinalContract,
			upstreamWorkContracts: upstreamUnits.map((unit) => ({ nodeId: unit.id, workContract: unit.workContract })),
			acceptedLedger: options.acceptedLedger,
			available: () => options.repairAvailable(repairUnit.id),
			launch: async (recovery, source, seed) => {
				const attempt = await options.launchRepair(repairUnit, recovery, source, seed);
				return { attemptId: attempt.attemptId, ...(attempt.ok && attempt.patch && attempt.worktreePath ? { candidate: attempt } : {}), continue: !attempt.ok && options.terminalOutcome(attempt).action === "validation-repair" };
			},
			transition: (attempt) => ({ patch: attempt.patch as AcceptedPatch }),
			authorize: async (attempt) => {
				if (!attempt.patch) return false;
				const ownership = checkFinalRepairOwnership(repairContract, attempt.patch, attempt.attemptDir);
				if (ownership.ok) return true;
				await options.completeTerminal({ ...attempt, ok: false, error: ownership.violations.map((value) => `${value.file}: ${value.reason}`).join("; "), failureKind: "ownership", terminalFact: { stage: "worker-gate", code: ownershipViolationFactCode(ownership.violations) } });
				return false;
			},
			reject: async (attempt, result, recovery, fact) => {
				const completed = await options.completeTerminal({
					...attempt,
					ok: false,
					error: result.evidence.failure?.kind === "hard" ? result.evidence.failure.detail : "final validation program failed",
					failureKind: "validation",
					terminalFact: fact,
					...(recovery && options.repairAvailable(attempt.allocation.nodeId) ? { recovery: recovery as AttemptRecoveryContext } : {}),
				});
				return options.terminalOutcome(completed).action === "validation-repair";
			},
			apply: async (attempt, result) => options.applyRepair(repairUnit, attempt, result),
			retainMutationLock: options.retainMutationLock,
		} } : {}),
	});
}
