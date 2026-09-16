import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, resolve} from 'node:path';
import {runProcess} from '../../packages/fanout-pi/src/fanout-git.ts';
import {fullGitVisibleTree} from '../../packages/fanout-pi/src/repository-identity.ts';

const BASELINE = 'c3c261e2189f94d1a09724e8f03d5345af518017';
const MAX_CORRECTIONS = 2;
const WATCHDOG_MS = 20 * 60 * 1000;
const COMMAND_MS = 120 * 1000;
const SDK = '@earendil-works/pi-coding-agent';
const processStarted = Date.now();
const sourceRoot = resolve(import.meta.dirname, '../..');
const gitText = (cwd, arguments_) => execFileSync('git', arguments_, {cwd, encoding: 'utf8'}).trim();
const environment = {
	nodeVersion: process.version,
	npmVersion: execFileSync('npm', ['--version'], {encoding: 'utf8'}).trim(),
	piSdkVersion: JSON.parse(readFileSync(resolve(sourceRoot, 'node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8')).version,
	platform: process.platform,
	arch: process.arch,
	sourceRevision: gitText(sourceRoot, ['rev-parse', 'HEAD']),
	sourceTree: fullGitVisibleTree(sourceRoot),
};

const root = resolve(process.argv[2] ?? '');
const runName = process.argv[3] ?? '';
if (!process.argv[2] || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runName) || basename(runName) !== runName) {
	throw new Error('usage: node p-map-raw-canary-v2.mjs <root> <runName>');
}

const target = resolve(root, runName);
if (dirname(target) !== root || !existsSync(target) || !statSync(target).isDirectory() || dirname(realpathSync(target)) !== realpathSync(root)) {
	throw new Error('run target must be an existing direct child of root');
}

const paths = {
	task: resolve(root, 'TASK.md'),
	checker: resolve(root, 'evaluation/p-map-acceptance-v2.mjs'),
	settings: resolve(root, 'agent/settings.json'),
	auth: resolve(root, 'agent/auth.json'),
	protocol: resolve(root, 'protocol.json'),
	events: resolve(root, `${runName}-events.jsonl`),
	result: resolve(root, `${runName}-result.json`),
	patch: resolve(root, `${runName}-candidate.patch`),
};
for (const path of [paths.task, paths.checker, paths.settings, paths.auth, paths.protocol]) {
	if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`missing required input file: ${path}`);
}
if ([paths.events, paths.result, paths.patch].some(existsSync)) throw new Error('run artifacts already exist');

const protocol = JSON.parse(readFileSync(paths.protocol, 'utf8'));
const requiredProtocol = {
	schemaVersion: 2,
	baselineCommit: BASELINE,
	model: {provider: 'openai-codex', id: 'gpt-5.6-sol', thinkingLevel: 'medium'},
	maxCorrectionPrompts: MAX_CORRECTIONS,
	overallTimeoutMs: WATCHDOG_MS,
	commandTimeoutMs: COMMAND_MS,
	environment,
};
if (protocol.schemaVersion !== requiredProtocol.schemaVersion
	|| protocol.baselineCommit !== requiredProtocol.baselineCommit
	|| protocol.model?.provider !== requiredProtocol.model.provider
	|| protocol.model?.id !== requiredProtocol.model.id
	|| protocol.model?.thinkingLevel !== requiredProtocol.model.thinkingLevel
	|| protocol.maxCorrectionPrompts !== requiredProtocol.maxCorrectionPrompts
	|| protocol.overallTimeoutMs !== requiredProtocol.overallTimeoutMs
	|| protocol.commandTimeoutMs !== requiredProtocol.commandTimeoutMs
	|| Object.entries(environment).some(([key, value]) => protocol.environment?.[key] !== value)
	|| typeof protocol.hashes?.['TASK.md'] !== 'string'
	|| typeof protocol.hashes?.['evaluation/p-map-acceptance-v2.mjs'] !== 'string') {
	throw new Error(`protocol must match ${JSON.stringify(requiredProtocol)} and include task/checker SHA-256 hashes`);
}

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const initialInputIdentity = {protocolSha256: sha256(paths.protocol), settingsSha256: sha256(paths.settings)};
const runGit = arguments_ => gitText(target, arguments_);
const integrity = ({clean = false} = {}) => {
	const actual = {
		head: runGit(['rev-parse', 'HEAD']),
		taskSha256: sha256(paths.task),
		checkerSha256: sha256(paths.checker),
		protocolSha256: sha256(paths.protocol),
		settingsSha256: sha256(paths.settings),
	};
	if (actual.head !== BASELINE) throw new Error(`candidate HEAD is ${actual.head}, expected ${BASELINE}`);
	if (actual.taskSha256 !== protocol.hashes['TASK.md']) throw new Error('TASK.md hash mismatch');
	if (actual.checkerSha256 !== protocol.hashes['evaluation/p-map-acceptance-v2.mjs']) throw new Error('checker hash mismatch');
	if (actual.protocolSha256 !== initialInputIdentity.protocolSha256) throw new Error('protocol.json changed during run');
	if (actual.settingsSha256 !== initialInputIdentity.settingsSha256) throw new Error('agent/settings.json changed during run');
	if (clean) {
		actual.status = runGit(['status', '--porcelain=v1', '--untracked-files=all']);
		if (actual.status) throw new Error(`candidate is not clean:\n${actual.status}`);
	}
	return actual;
};

let e2eStarted;
let deadline;
let session;
let timedOut = false;
let watchdog;
const overallController = new AbortController();
const rounds = [];
const usage = {requestCount: 0, tokens: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}, tokenCountsComplete: true, estimatedCostUsd: 0};
const tokenFields = {input: 'input', output: 'output', cacheRead: 'cacheRead', cacheWrite: 'cacheWrite', total: 'totalTokens'};
const tokenKnown = Object.fromEntries(Object.keys(tokenFields).map(key => [key, true]));
let costKnown = true;
const record = (type, data = {}) => appendFileSync(paths.events, `${JSON.stringify({timestamp: new Date().toISOString(), type, ...data})}\n`);
const remaining = () => deadline - Date.now();

async function runCommand(id, command, arguments_) {
	if (remaining() <= 0 || overallController.signal.aborted) throw new Error('overall watchdog expired before gate command');
	const observed = await runProcess(command, arguments_, {cwd: target, timeoutMs: Math.min(COMMAND_MS, remaining()), signal: overallController.signal});
	const result = {...observed, id, command: [command, ...arguments_], status: observed.exitCode ?? 1};
	record('gate_command', result);
	if (overallController.signal.aborted) throw new Error('overall watchdog expired during gate command');
	return result;
}

async function runGates(index) {
	const candidateTree = fullGitVisibleTree(target);
	const round = {index, candidateTree, integrityChecks: [{point: 'before-npm-test', value: integrity()}], commands: [], passed: false};
	rounds.push(round);
	for (const [id, command, arguments_] of [
		['npm-test', 'npm', ['test']],
		['diff-check', 'git', ['diff', '--check']],
		['acceptance', process.execPath, [paths.checker, target]],
	]) {
		round.commands.push(await runCommand(id, command, arguments_));
		try {
			round.integrityChecks.push({point: `after-${id}`, value: integrity()});
			const afterTree = fullGitVisibleTree(target);
			if (afterTree !== candidateTree) throw new Error(`candidate tree changed from ${candidateTree} to ${afterTree}`);
		} catch (caught) {
			round.harnessError = String(caught?.stack ?? caught);
			record('gate_round', round);
			throw new Error(`immutable benchmark input changed during ${id}`, {cause: caught});
		}
	}
	round.passed = round.commands.every(command => command.status === 0 && !command.timedOut && !command.spawnError);
	record('gate_round', round);
	return round;
}

const tail = text => text.length > 6000 ? text.slice(-6000) : text;
const correctionPrompt = round => `Independent required gates failed after your final reply. Fix the candidate, then give a final reply. Do not commit. The external checker and TASK.md are immutable.\n\n${round.commands.filter(command => command.status !== 0 || command.timedOut).map(command => `${command.id} (status ${command.status}${command.timedOut ? ', timed out' : ''})\nstdout:\n${tail(command.stdout)}\nstderr:\n${tail(command.stderr)}`).join('\n\n')}`;
const lastAssistant = () => [...session.messages].reverse().find(message => message.role === 'assistant');
const assistantSummary = () => {
	const message = lastAssistant();
	return {stopReason: message?.stopReason ?? 'missing', text: message?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''};
};

let outcome = 'error';
let error;
let correctionCount = 0;
let initialIntegrity;
try {
	initialIntegrity = integrity({clean: true});
	process.env.PI_CODING_AGENT_DIR = resolve(root, 'agent');
	const {createAgentSession, DefaultResourceLoader, SettingsManager} = await import(SDK);
	const settingsManager = SettingsManager.create(target, resolve(root, 'agent'));
	const resourceLoader = new DefaultResourceLoader({cwd: target, agentDir: resolve(root, 'agent'), settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true});
	await resourceLoader.reload();
	({session} = await createAgentSession({cwd: target, agentDir: resolve(root, 'agent'), settingsManager, resourceLoader, thinkingLevel: 'medium'}));
	if (session.model?.provider !== 'openai-codex' || session.model.id !== 'gpt-5.6-sol' || session.thinkingLevel !== 'medium') {
		throw new Error(`unexpected model profile ${session.model?.provider}/${session.model?.id}/${session.thinkingLevel}`);
	}
	session.subscribe(event => {
		record('sdk_event', {event});
		if (event.type !== 'message_end' || event.message?.role !== 'assistant') return;
		const observed = event.message.usage;
		usage.requestCount++;
		for (const [key, source] of Object.entries(tokenFields)) {
			if (Number.isFinite(observed?.[source]) && observed[source] >= 0) usage.tokens[key] += observed[source];
			else tokenKnown[key] = false;
		}
		if (Number.isFinite(observed?.cost?.total) && observed.cost.total >= 0) usage.estimatedCostUsd += observed.cost.total;
		else costKnown = false;
	});

	e2eStarted = Date.now();
	deadline = e2eStarted + WATCHDOG_MS;
	record('benchmark_start', {schemaVersion: 2, runName, target, baselineCommit: BASELINE, model: requiredProtocol.model, initialIntegrity});
	watchdog = setTimeout(() => {
		timedOut = true;
		record('benchmark_timeout', {wallTimeMs: Date.now() - e2eStarted});
		overallController.abort(new Error('overall watchdog expired'));
		void session?.abort().catch(abortError => record('abort_error', {error: String(abortError)}));
	}, WATCHDOG_MS);

	const task = readFileSync(paths.task, 'utf8');
	const objective = `Implement the following approved task. Proceed through implementation and validation without pausing for another plan approval. Do not commit. The required independent gates are run externally after every final reply; TASK.md and the checker are immutable. Before finishing, run:\nnode ${paths.checker} ${target}\nnpm test\ngit diff --check\n\n${task}`;
	for (let roundIndex = 0; roundIndex <= MAX_CORRECTIONS; roundIndex++) {
		if (timedOut || remaining() <= 0) throw new Error('overall watchdog expired');
		if (roundIndex > 0) correctionCount++;
		await session.prompt(roundIndex === 0 ? objective : correctionPrompt(rounds.at(-1)));
		const assistant = assistantSummary();
		record('final_reply', {roundIndex, assistant});
		if (assistant.stopReason !== 'stop') throw new Error(`model reply ended with ${assistant.stopReason}`);
		const round = await runGates(roundIndex);
		if (timedOut) throw new Error('overall watchdog expired');
		if (round.passed) {
			outcome = 'succeeded';
			break;
		}
		if (roundIndex === MAX_CORRECTIONS) outcome = 'failed';
	}
} catch (caught) {
	error = String(caught?.stack ?? caught);
	record('benchmark_error', {error});
} finally {
	clearTimeout(watchdog);
	if (session?.isStreaming) await session.abort().catch(() => {});
	session?.dispose();
}

const finishedAt = Date.now();
if (!costKnown || usage.requestCount === 0) usage.estimatedCostUsd = null;
for (const key of Object.keys(usage.tokens)) if (!tokenKnown[key]) usage.tokens[key] = null;
usage.tokenCountsComplete = Object.values(tokenKnown).every(Boolean);
let finalIntegrity;
let finalCandidate;
try {
	finalIntegrity = integrity();
} catch (caught) {
	if (outcome === 'succeeded') outcome = 'error';
	error ??= String(caught?.stack ?? caught);
}
try {
	const patch = execFileSync('git', ['diff', '--binary', '--full-index', '--no-ext-diff', BASELINE, '--'], {cwd: target, maxBuffer: 256 * 1024 * 1024});
	writeFileSync(paths.patch, patch);
	finalCandidate = {
		tree: fullGitVisibleTree(target),
		patch: {path: basename(paths.patch), sha256: createHash('sha256').update(patch).digest('hex'), byteLength: patch.byteLength},
		untrackedPaths: runGit(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean),
	};
} catch (caught) {
	if (outcome === 'succeeded') outcome = 'error';
	error ??= String(caught?.stack ?? caught);
}
const result = {
	schema: 'p-map-raw-canary-result',
	version: 2,
	outcome,
	baselineCommit: BASELINE,
	model: requiredProtocol.model,
	correctionCount,
	rounds,
	wallTimeMs: e2eStarted ? finishedAt - e2eStarted : 0,
	humanWaitMs: 0,
	excludedInitializationMs: (e2eStarted ?? finishedAt) - processStarted,
	modelUsage: usage,
	observedAssistantResponseCount: usage.requestCount,
	criticalPathRequestDepth: usage.requestCount,
	requestCountSource: 'terminal SDK assistant messages; provider-internal retries unavailable',
	timedOut,
	initialIntegrity,
	finalIntegrity,
	finalCandidate,
	inputs: initialInputIdentity,
	environment,
	driverSha256: sha256(import.meta.filename),
	error,
	comparisonScope: 'Ordinary Pi correction mechanics versus Fanout fixed budgets; this is not a claim that both use the same execution engine.',
};
writeFileSync(paths.result, `${JSON.stringify(result, undefined, 2)}\n`);
record('benchmark_end', {outcome, wallTimeMs: result.wallTimeMs});
process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
if (outcome !== 'succeeded') process.exitCode = 1;
