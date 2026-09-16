import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fullGitVisibleTree} from '../../packages/fanout-pi/src/repository-identity.ts';

const baseline = 'c3c261e2189f94d1a09724e8f03d5345af518017';
const target = resolve(process.argv[2] ?? process.cwd());
const timeoutMs = 120_000;
const git = args => execFileSync('git', args, {cwd: target, encoding: 'utf8'});
const identity = () => ({head: git(['rev-parse', 'HEAD']).trim(), tree: fullGitVisibleTree(target), status: git(['status', '--porcelain=v1', '--untracked-files=all'])});
const additions = path => git(['diff', '--unified=0', baseline, '--', path]).split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
const before = identity();
const temporary = mkdtempSync(join(tmpdir(), 'p-map-completion-'));
const cases = [];

try {
	let importPath = relative(temporary, join(target, 'index.js')).split(sep).join('/');
	if (!importPath.startsWith('.')) importPath = `./${importPath}`;
	writeFileSync(join(temporary, 'consumer.mts'), `import {pMapIterable} from ${JSON.stringify(importPath)};\nconst withSignal: AsyncIterable<number> = pMapIterable([1, 2], async value => value * 2, {signal: new AbortController().signal});\nconst withoutSignal: AsyncIterable<string> = pMapIterable(['a'], value => value);\ndeclare const declaredSignal: NonNullable<Parameters<typeof pMapIterable>[2]>['signal'];\nconst checkedSignal: AbortSignal | undefined = declaredSignal;\n// @ts-expect-error An arbitrary object is not an AbortSignal.\npMapIterable([1], value => value, {signal: {}});\nvoid withSignal; void withoutSignal; void checkedSignal;\n`);
	const compilerPackage = resolve(target, 'node_modules/@tsd/typescript/package.json');
	const compilerVersion = JSON.parse(readFileSync(compilerPackage, 'utf8')).version;
	const compiler = resolve(target, 'node_modules/@tsd/typescript/typescript/bin/tsc');
	const started = performance.now();
	const compiled = spawnSync(process.execPath, [compiler, '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM', join(temporary, 'consumer.mts')], {cwd: temporary, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL'});
	const typecheck = {exitCode: compiled.status, signal: compiled.signal, stdout: compiled.stdout ?? '', stderr: compiled.stderr ?? '', durationMs: performance.now() - started, timedOut: compiled.error?.code === 'ETIMEDOUT', spawnError: compiled.error?.message};
	cases.push({id: 'public-signal-types', status: compilerVersion === '5.2.2' && typecheck.exitCode === 0 && !typecheck.timedOut && !typecheck.spawnError ? 'pass' : 'fail', compiler: {package: '@tsd/typescript', version: compilerVersion, path: compiler}, command: [process.execPath, compiler, '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM', '<external-temp>/consumer.mts'], result: typecheck});

	const behavioralTestAdditions = additions('test.js');
	cases.push({id: 'behavioral-test-artifact', status: /pMapIterable/i.test(behavioralTestAdditions) && /abort/i.test(behavioralTestAdditions) ? 'pass' : 'fail', changed: behavioralTestAdditions.length > 0, requirement: 'added test.js text mentions pMapIterable and abort'});
	const typeTestAdditions = additions('index.test-d.ts');
	cases.push({id: 'type-test-artifact', status: /pMapIterable/i.test(typeTestAdditions) && /signal/i.test(typeTestAdditions) ? 'pass' : 'fail', changed: typeTestAdditions.length > 0, requirement: 'added index.test-d.ts text mentions pMapIterable and signal'});
	const documentationAdditions = additions('readme.md');
	cases.push({id: 'iterable-documentation-artifact', status: /pMapIterable/i.test(documentationAdditions) && /signal/i.test(documentationAdditions) && /abort/i.test(documentationAdditions) ? 'pass' : 'fail', changed: documentationAdditions.length > 0, requirement: 'added readme.md text ties pMapIterable to signal and abort behavior'});
} finally {
	rmSync(temporary, {recursive: true, force: true});
}

const after = identity();
const identityPreserved = JSON.stringify(before) === JSON.stringify(after);
const output = {artifactType: 'p-map-completion-check', version: 2, baseline, target, passed: identityPreserved && cases.every(entry => entry.status === 'pass'), identityPreserved, before, after, cases, limitations: ['Artifact checks establish relevant added text, not behavioral-test quality or documentation quality.', 'The external type consumer checks the public signal option, its declared upper bound, and no-signal compatibility, not every generic inference edge.', 'This checker assumes non-adversarial candidate code and is not an OS security sandbox.']};
writeFileSync(1, `${JSON.stringify(output, null, 2)}\n`);
process.exit(output.passed ? 0 : 1);
