import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyArtifactBytes} from '../../packages/fanout-core/src/artifact-identity.ts';
import {compileExecutionPacket} from '../../packages/fanout-core/src/fanout-compiler.ts';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseValidationCommand} from '../../packages/fanout-core/src/validation-command.ts';
import {publishWorkerValidationManifest, runWorkerValidation} from '../../packages/fanout-pi/src/worker-validation.ts';
import {runValidationCommands} from '../../packages/fanout-pi/src/validation-runner.ts';
import {assertRegressionContract, regressionCommand} from './verify-p-map-abort-signal-packet.mjs';

const source = readFileSync(new URL('./p-map-promised-source-value-check.mjs', import.meta.url), 'utf8');
assert.deepEqual(parseValidationCommand(regressionCommand).args, ['--input-type=module', '--eval', source.split('\n').map(line => line.trim()).join(' ').trim()]);
const contract = {
	changes: ['index.js', 'test.js'].map(path => ({kind: 'modify', target: {resource: {kind: 'file', path}}})),
	validationCommands: [regressionCommand],
};
assert.equal(assertRegressionContract([{id: 'runtime-and-behavioral-tests', kind: 'implementation', workContract: contract}]), 'runtime-and-behavioral-tests');
assert.throws(() => assertRegressionContract([{id: 'final', kind: 'final-validation', workContract: contract}]), /runtime owner/);
assert.throws(() => assertRegressionContract([{id: 'runtime', kind: 'implementation', workContract: {...contract, validationCommands: []}}]), /frozen promised-source-value/);
const bundle = new URL('../../docs/benchmarks/p-map-abort-signal/prepared/', import.meta.url);
const packetPath = fileURLToPath(new URL('execution-packet.json', bundle));
const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
const provenance = JSON.parse(readFileSync(new URL('provenance.json', bundle), 'utf8'));
verifyArtifactBytes(provenance.packet, readFileSync(packetPath));
verifyArtifactBytes(provenance.task, readFileSync(new URL('../TASK.md', bundle)));
verifyArtifactBytes(provenance.previousTask, readFileSync(new URL('../history/TASK-before-2026-09-27.md', bundle)));
const artifacts = {};
for (const [key, identity] of Object.entries({...packet.sourceArtifacts, profile: packet.profile})) {
	const bytes = readFileSync(new URL(identity.path, bundle));
	verifyArtifactBytes(identity, bytes);
	artifacts[key] = JSON.parse(bytes);
}
const compiled = compileExecutionPacket({
	implementationPlan: artifacts.plan, implementationDetails: artifacts.details,
	planIdentity: packet.sourceArtifacts.plan, detailsIdentity: packet.sourceArtifacts.details,
	profile: artifacts.profile, tierPlan: packet.tierPlan, runtimePolicy: packet.runtimePolicy,
	sequentialReadFallback: packet.compilationPolicy.sequentialReadFallback, createdAt: packet.createdAt,
});
assert.ok(compiled.ok, JSON.stringify(compiled.errors));
assert.deepEqual(compiled.packet, packet);
const verifier = fileURLToPath(new URL('./verify-p-map-abort-signal-packet.mjs', import.meta.url));
const positive = spawnSync(process.execPath, [verifier, packetPath], {encoding: 'utf8'});
assert.equal(positive.status, 0, positive.stderr);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'p-map-abort-signal-')));
try {
	const missingGate = structuredClone(packet);
	missingGate.nodes.find(node => node.id === 'runtime-and-behavioral-tests').workContract.validationCommands.shift();
	const negativePath = join(root, 'missing-gate.json');
	writeFileSync(negativePath, JSON.stringify(missingGate));
	const negative = spawnSync(process.execPath, [verifier, negativePath], {encoding: 'utf8'});
	assert.notEqual(negative.status, 0);
	assert.match(negative.stderr, /frozen promised-source-value/);
	for (const broken of [true, false]) {
		const worktreeRoot = join(root, broken ? 'broken' : 'control');
		const attemptRoot = join(root, broken ? 'broken-attempt' : 'control-attempt');
		mkdirSync(worktreeRoot);
		mkdirSync(attemptRoot);
		writeFileSync(join(worktreeRoot, 'package.json'), '{"type":"module"}');
		writeFileSync(join(worktreeRoot, 'index.js'), `
export function pMapIterable(input, mapper, {signal}) {
  const source = input[Symbol.iterator]();
  let started = false;
  return {[Symbol.asyncIterator]() { return {
    next() {
      if (started) return Promise.resolve({done: true});
      started = true;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { source.return(); reject(signal.reason); }, {once: true});
        Promise.resolve(source.next().value).then(value => { ${broken ? 'mapper(value);' : ''} });
      });
    },
  }; }};
}
`);
		const expected = {runId: 'offline', nodeId: 'runtime', attemptId: broken ? 'broken' : 'control'};
		const identity = publishWorkerValidationManifest(attemptRoot, {
			...expected, worktreeRoot, platform: process.platform, commands: contract.validationCommands,
			advisoryValidationMode: 'fail-fast', writeResources: [], forbiddenWrites: [], timeoutMs: 5000,
		});
		const advisory = await runWorkerValidation({attemptRoot, worktreeRoot, identity, expected}, 'offline-call', undefined, worktreeRoot);
		const authoritative = await runValidationCommands(contract.validationCommands, {checkoutRoot: worktreeRoot, expectedPlatform: process.platform, timeoutMs: 5000, inheritedEnv: process.env});
		for (const result of [advisory.details.result, authoritative]) {
			assert.equal(result.status, broken ? 'failed' : 'passed');
			assert.equal(result.commands[0].outcome, broken ? 'nonzero' : 'passed');
			assert.match(result.commands[0][broken ? 'stderr' : 'stdout'], broken ? /no mapper may start after abort/ : /promised-source-value-abort: passed/);
		}
		assert.ok(advisory.details.evidence);
	}
	console.log('p-map abort-signal setup: frozen command, placement, advisory and authoritative failure/pass controls passed');
} finally {
	rmSync(root, {recursive: true, force: true});
}
