import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDoublewordProviders } from "./register.ts";
import { setDoublewordActiveTurnIndex, setDoublewordObservabilityFile, setDoublewordRunId } from "./observability.ts";

export { registerDoublewordProviders, setDoublewordActiveTurnIndex, setDoublewordObservabilityFile, setDoublewordRunId };

export default async function (pi: ExtensionAPI): Promise<void> {
	await registerDoublewordProviders(pi);
}
