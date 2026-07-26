import { startProfilerCli } from "../packages/fanout-profiler/src/cli.ts";
import { fanoutRuntimeContext } from "../packages/fanout-pi/src/fanout-runtime-context.ts";

const context = fanoutRuntimeContext(process.cwd(), undefined, undefined);
startProfilerCli(Bun.argv.slice(2), { storageRoot: context.artifactRoot, preferredProjectId: context.projectId });
