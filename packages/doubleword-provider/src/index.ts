import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDoublewordProviders } from "./register.ts";
import { setDoublewordActiveTurnIndex, setDoublewordRunId } from "./observability.ts";

export { registerDoublewordProviders, setDoublewordActiveTurnIndex, setDoublewordRunId };

export default async function (pi: ExtensionAPI): Promise<void> {
	await registerDoublewordProviders(pi);
}
