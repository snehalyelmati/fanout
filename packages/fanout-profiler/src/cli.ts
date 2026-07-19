import { realpathSync, statSync } from "node:fs";
import { startProfilerServer } from "./server";

const usage = "Usage: npm run profiler -- --artifact-root <directory> [--port <1-65535>]";

function fail(message: string): never {
	console.error(`fanout-profiler: ${message}\n${usage}`);
	process.exit(1);
}

function parseArguments(args: string[]): { artifactRoot: string; port: number } {
	let artifactRoot: string | undefined;
	let port = 4173;
	let hasPort = false;
	for (let index = 0; index < args.length; index += 2) {
		const option = args[index];
		const value = args[index + 1];
		if (!value) fail(`${option ?? "--artifact-root"} requires a value`);
		if (option === "--artifact-root" && artifactRoot === undefined) artifactRoot = value;
		else if (option === "--port" && !hasPort) {
			if (!/^[1-9]\d*$/.test(value) || Number(value) > 65_535) fail("--port must be an integer from 1 to 65535");
			port = Number(value);
			hasPort = true;
		} else fail(`unexpected or repeated option ${option}`);
	}
	if (!artifactRoot) fail("--artifact-root is required");
	try {
		const resolved = realpathSync(artifactRoot);
		if (!statSync(resolved).isDirectory()) fail("--artifact-root must name a directory");
		return { artifactRoot: resolved, port };
	} catch {
		fail("--artifact-root must name an existing readable directory");
	}
}

const options = parseArguments(Bun.argv.slice(2));
const server = startProfilerServer(options.artifactRoot, options.port);
console.log(`http://${server.hostname}:${server.port}`);
