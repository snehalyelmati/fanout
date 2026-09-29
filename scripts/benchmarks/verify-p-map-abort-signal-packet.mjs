import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateExecutionPacket} from '../../packages/fanout-core/src/execution-packet.ts';
import {contractWriteResources} from '../../packages/fanout-core/src/work-contract.ts';

export const regressionCommand = JSON.parse(readFileSync(new URL('../../docs/benchmarks/p-map-abort-signal/validation-command.json', import.meta.url), 'utf8'));

export function assertRegressionContract(nodes) {
	const owners = nodes.filter(node => node.kind !== 'final-validation' && contractWriteResources(node.workContract).some(resource => resource.kind === 'file' && resource.path === 'index.js'));
	assert.equal(owners.length, 1, 'expected exactly one runtime owner');
	const owner = owners[0];
	assert.ok(contractWriteResources(owner.workContract).some(resource => resource.kind === 'file' && resource.path === 'test.js'), 'runtime and behavioral tests must share ownership');
	assert.deepEqual(owner.workContract.validationCommands[0], regressionCommand, 'runtime worker must run the frozen promised-source-value command first');
	return owner.id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.ok(process.argv[2], 'usage: node scripts/benchmarks/verify-p-map-abort-signal-packet.mjs <packet.json>');
	const result = validateExecutionPacket(JSON.parse(readFileSync(process.argv[2], 'utf8')));
	assert.ok(result.ok && result.executable, JSON.stringify(result.errors));
	assert.equal(result.packet.planningBase.headCommit, 'c3c261e2189f94d1a09724e8f03d5345af518017');
	assert.equal(result.packet.planningBase.tree, '8a2aeffb7e9e378c05dcb0cec8503b1fb530143f');
	assert.equal(result.packet.profile.sha256, '2b0248d9a4f65fa271ad05eeb15ca67ed0ec158bfe36450e9a96ab39a072bb8a');
	assert.equal(result.packet.profile.byteLength, 1374);
	console.log(`Promised-source-value command frozen in ${assertRegressionContract(result.packet.nodes)}; normal dry-run/profile checks still required.`);
}
