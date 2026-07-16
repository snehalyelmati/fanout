import { relative, resolve, sep } from "node:path";
import { artifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { ACTIVE_PACKET_SCHEMA, ACTIVE_PACKET_VERSION } from "../../fanout-core/src/active-packet.ts";
import { renderWorkContractMarkdown, renderWorkContractMermaid } from "../../fanout-core/src/work-contract-views.ts";
import { executionPacketBytes, type FanoutExecutionPacket } from "../../fanout-core/src/execution-packet.ts";
import { publishPlanningArtifacts } from "./artifact-store.ts";

export function publishExecutionPacket(packet: FanoutExecutionPacket, projectArtifactRoot: string, artifactDir: string, activePointerPath: string) {
	const root = resolve(projectArtifactRoot);
	const run = relative(root, resolve(artifactDir)).split(sep).join("/");
	if (!run || run.startsWith("../")) throw new Error("packet run directory escapes the project artifact root");
	const packetRelative = `${run}/execution-packet.json`;
	const planRelative = `${run}/execution-plan.md`;
	const dagRelative = `${run}/execution-dag.mmd`;
	const pointerRelative = relative(root, resolve(activePointerPath)).split(sep).join("/");
	const packetBytes = executionPacketBytes(packet);
	const context = { objective: packet.objective, userContext: packet.userContext, discoveredRepoFacts: packet.discoveredRepoFacts, assumptions: packet.assumptions };
	const planBytes = Buffer.from(renderWorkContractMarkdown(context, packet.nodes));
	const dagBytes = Buffer.from(renderWorkContractMermaid(packet.nodes));
	const packetIdentity = artifactIdentity(packetRelative, packetBytes);
	const pointer = { schema: ACTIVE_PACKET_SCHEMA, version: ACTIVE_PACKET_VERSION, publishedAt: new Date().toISOString(), packet: packetIdentity };
	publishPlanningArtifacts(root, pointerRelative, [
		{ path: packetRelative, bytes: packetBytes },
		{ path: planRelative, bytes: planBytes },
		{ path: dagRelative, bytes: dagBytes },
	], Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`));
	return {
		packetPath: resolve(root, packetRelative),
		planPath: resolve(root, planRelative),
		dagPath: resolve(root, dagRelative),
		activePointerPath: resolve(root, pointerRelative),
	};
}
