# Run Fanout from source

Fanout is a research preview. The monorepo contains the Pi adapter, the independent Doubleword provider, the Pi-independent execution core, and a local evidence profiler. You do not need a Doubleword account to load the extension or run its offline stub.

## Install and check

Use Git, Node.js, npm, and Bun. Fanout and the standalone Doubleword provider require **Pi 0.87.0 or newer**; source development pins the Pi SDK and CLI packages to 0.87.0. The source setup was checked on macOS with Node.js 26.5, npm 11.17, and Bun 1.3.14. Network access is needed for the first dependency install. From a clean clone:

```sh
bun install --ignore-scripts --no-save
npm run typecheck
./node_modules/.bin/pi --offline --no-session --no-extensions \
  -e ./packages/fanout-pi/src/index.ts \
  --model doubleword-stub/deepseek-v4-flash -p "Say ready."
```

The repository does not currently freeze source installs with a committed dependency lock; record resolved versions for a new experiment. The historical study used its own pinned environments.

The last command makes no paid model call. It loads Fanout and the development-only `doubleword-stub` through the source entrypoint. A response such as `Doubleword stub response.` confirms that Pi loaded the extension. The installed Pi executable is local to this clone; no global Pi install or `rtk` wrapper is needed.

For the full offline smoke suite and standalone provider mock tests, run `npm run check` and `npm run test:doubleword-provider`. These tests use local loopback servers and make no paid model calls.

## Use the Pi adapter

Start Pi in the Git repository you want Fanout to work on, passing the absolute path to this clone's adapter:

```sh
/absolute/path/to/fanout/node_modules/.bin/pi --no-extensions \
  -e /absolute/path/to/fanout/packages/fanout-pi/src/index.ts
```

Select a configured model in Pi, then use `/fanout-config` to inspect or change the planner/worker/fallback roles. `/fanout-plan <objective>` explores a clean repository and prepares an execution packet for review; `/fanout-execute --dry-run` checks the accepted packet before a live execution. The plan command refuses a dirty Git base. Dry-run still executes the packet's declared preparation and validation commands, which can have external effects, so review the profile first. A live `/fanout-execute` asks for confirmation before workers or active patch application.

By default, Fanout writes artifacts under Pi's agent directory, outside the target repository. `FANOUT_ARTIFACT_DIR=/absolute/path` overrides that location for a process. Keep execution artifacts and raw traces out of public commits; the study publishes curated summaries instead.

## Inspect local evidence

The read-only profiler requires Bun and an existing Fanout artifact root:

```sh
npm run profiler
```

It prints a loopback URL. Use `npm run profiler -- --artifact-root /absolute/path` to inspect a particular artifact root. The profiler does not upload artifacts.

The standalone Doubleword provider is also published independently of Fanout:

```sh
pi install npm:@snehalyelmati/pi-doubleword-provider
```

To load its source without Fanout from this clone, run `./node_modules/.bin/pi --no-extensions -e ./packages/doubleword-provider/src/index.ts`. For live `doubleword` models, set `DOUBLEWORD_API_KEY` in your environment and follow the [provider guide](../packages/doubleword-provider/README.md). The published provider does not include the development stub.
