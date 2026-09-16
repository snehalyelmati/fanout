import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const protocol = 'p-map-iterable-abort-acceptance';
const version = 2;
const baseline = 'c3c261e2189f94d1a09724e8f03d5345af518017';
const evaluationMode = process.argv[2] === '--evaluate';
const target = resolve(process.argv[evaluationMode ? 3 : 2] ?? process.cwd());
const operationTimeoutMilliseconds = 2000;
const watchdogTimeoutMilliseconds = 10_000;
const outerTimeoutMilliseconds = 12_000;
const allowedPaths = new Set(['index.js', 'index.d.ts', 'index.test-d.ts', 'test.js', 'readme.md']);
const deferred = () => Promise.withResolvers();
const tick = () => new Promise(resolve => setImmediate(resolve));
async function bounded(promise, label, milliseconds = operationTimeoutMilliseconds) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function trackedController() {
	const controller = new AbortController();
	const listeners = new Map();
	const add = controller.signal.addEventListener.bind(controller.signal);
	const remove = controller.signal.removeEventListener.bind(controller.signal);
	controller.signal.addEventListener = (type, ...arguments_) => {
		if (type !== 'abort') {
			return add(type, ...arguments_);
		}
		const [listener, options] = arguments_;
		if (listeners.has(listener)) {
			return add(type, listeners.get(listener), options);
		}
		const once = typeof options === 'object' && options?.once;
		const wrapped = once ? event => {
			listeners.delete(listener);
			return typeof listener === 'function' ? listener.call(controller.signal, event) : listener.handleEvent(event);
		} : listener;
		listeners.set(listener, wrapped);
		return add(type, wrapped, options);
	};
	controller.signal.removeEventListener = (type, ...arguments_) => {
		if (type !== 'abort') {
			return remove(type, ...arguments_);
		}
		const [listener, options] = arguments_;
		const wrapped = listeners.get(listener) ?? listener;
		listeners.delete(listener);
		return remove(type, wrapped, options);
	};
	return {controller, listenerCount: () => listeners.size};
}

async function rejectsWith(promise, reason, label) {
	await assert.rejects(bounded(promise, label), error => error === reason, 'expected exact abort reason');
}

function assertCounters(actual, expected) {
	try {
		assert.deepStrictEqual(actual, expected);
	} catch (error) {
		error.counters = actual;
		throw error;
	}
}

async function stoppedAfterAbort(iterator, reason, label) {
	let result;
	try {
		result = await bounded(iterator.next(), label);
	} catch (error) {
		assert.strictEqual(error, reason, 'iterator failed with a different reason after abort');
		return 'same-reason-rejection';
	}
	assert.equal(result.done, true, 'iterator yielded after abort');
	return 'done';
}

const cases = [
	['already-aborted', async pMapIterable => {
		const {controller, listenerCount} = trackedController();
		const reason = {case: 'already-aborted'};
		let pulls = 0;
		let mapperStarts = 0;
		controller.abort(reason);
		const input = {[Symbol.iterator]: () => ({next() { pulls++; return {value: 1, done: false}; }})};
		const iterator = pMapIterable(input, () => ++mapperStarts, {signal: controller.signal, concurrency: 1, backpressure: 1})[Symbol.asyncIterator]();
		await rejectsWith(iterator.next(), reason, 'already-aborted rejection');
		const counters = {pulls, mapperStarts, listeners: listenerCount()};
		assertCounters(counters, {pulls: 0, mapperStarts: 0, listeners: 0});
		return counters;
	}],
	['pending-mapper-abort-cleanup', async pMapIterable => {
		const {controller, listenerCount} = trackedController();
		const reason = {case: 'pending-mapper-abort-cleanup'};
		const gate = deferred();
		const started = deferred();
		let pulls = 0;
		let mapperStarts = 0;
		let closes = 0;
		const input = {[Symbol.iterator]: () => ({next() { pulls++; return {value: 1, done: false}; }, return() { closes++; return {done: true}; }})};
		const iterator = pMapIterable(input, () => { mapperStarts++; started.resolve(); return gate.promise; }, {signal: controller.signal, concurrency: 1, backpressure: 1})[Symbol.asyncIterator]();
		const pending = iterator.next();
		await bounded(started.promise, 'mapper start');
		controller.abort(reason);
		await rejectsWith(pending, reason, 'pending mapper rejection');
		gate.resolve(42);
		await tick();
		const postAbort = await stoppedAfterAbort(iterator, reason, 'pending mapper post-abort state');
		const counters = {pulls, mapperStarts, closes, listeners: listenerCount()};
		assertCounters(counters, {pulls: 1, mapperStarts: 1, closes: 1, listeners: 0});
		return {...counters, postAbort};
	}],
	['pending-source-abort', async pMapIterable => {
		const {controller, listenerCount} = trackedController();
		const reason = {case: 'pending-source-abort'};
		const gate = deferred();
		const started = deferred();
		let pulls = 0;
		let mapperStarts = 0;
		let closes = 0;
		const input = {[Symbol.asyncIterator]: () => ({next() { pulls++; started.resolve(); return gate.promise; }, return() { closes++; return Promise.resolve({done: true}); }})};
		const iterator = pMapIterable(input, () => ++mapperStarts, {signal: controller.signal, concurrency: 1, backpressure: 1})[Symbol.asyncIterator]();
		const pending = iterator.next();
		await bounded(started.promise, 'source pull');
		controller.abort(reason);
		await rejectsWith(pending, reason, 'pending source rejection');
		gate.resolve({value: 1, done: false});
		await tick();
		const postAbort = await stoppedAfterAbort(iterator, reason, 'pending source post-abort state');
		const counters = {pulls, mapperStarts, closes, listeners: listenerCount()};
		assertCounters(counters, {pulls: 1, mapperStarts: 0, closes: 1, listeners: 0});
		return {...counters, postAbort};
	}],
	['terminal-listener-cleanup', async pMapIterable => {
		const counters = {normal: 0, sourceError: 0, mapperError: 0, earlyReturn: 0};
		for (const kind of Object.keys(counters)) {
			const {controller, listenerCount} = trackedController();
			const reason = new Error(kind);
			const input = kind === 'sourceError' ? {[Symbol.iterator]: () => ({next() { throw reason; }})} : [1, 2];
			const iterator = pMapIterable(input, value => { if (kind === 'mapperError') throw reason; return value * 2; }, {signal: controller.signal, concurrency: 1, backpressure: 1})[Symbol.asyncIterator]();
			if (kind.endsWith('Error')) {
				await rejectsWith(iterator.next(), reason, `${kind} rejection`);
			} else if (kind === 'earlyReturn') {
				assert.deepStrictEqual(await bounded(iterator.next(), 'early value'), {value: 2, done: false});
				await bounded(iterator.return(), 'early return');
			} else {
				const values = [];
				for await (const value of {[Symbol.asyncIterator]: () => iterator}) values.push(value);
				assert.deepStrictEqual(values, [2, 4]);
			}
			counters[kind] = listenerCount();
		}
		assertCounters(counters, {normal: 0, sourceError: 0, mapperError: 0, earlyReturn: 0});
		return counters;
	}],
	['promised-source-value-abort', async pMapIterable => {
		const {controller, listenerCount} = trackedController();
		const reason = {case: 'promised-source-value-abort'};
		const value = deferred();
		const waiting = deferred();
		let pulls = 0;
		let mapperStarts = 0;
		let closes = 0;
		const input = {[Symbol.iterator]: () => ({next() { pulls++; return {done: false, value: {then(resolve) { waiting.resolve(); value.promise.then(resolve); }}}; }, return() { closes++; return {done: true}; }})};
		const iterator = pMapIterable(input, () => ++mapperStarts, {signal: controller.signal, concurrency: 1, backpressure: 1})[Symbol.asyncIterator]();
		const pending = iterator.next();
		await bounded(waiting.promise, 'promised source value wait');
		controller.abort(reason);
		await rejectsWith(pending, reason, 'promised source value rejection');
		value.resolve(1);
		await tick();
		const postAbort = await stoppedAfterAbort(iterator, reason, 'promised source value post-abort state');
		const counters = {pulls, mapperStarts, closes, listeners: listenerCount()};
		assertCounters(counters, {pulls: 1, mapperStarts: 0, closes: 1, listeners: 0});
		return {...counters, postAbort};
	}],
];
const expectedCaseIds = [...cases.map(([id]) => id), 'changed-path-scope'];

function changedPathCase() {
	const lines = (arguments_ => execFileSync('git', arguments_, {cwd: target, encoding: 'utf8'}).trim().split('\n').filter(Boolean));
	const changed = lines(['diff', '--name-only', baseline, '--']);
	const untracked = lines(['ls-files', '--others', '--exclude-standard']);
	const unexpected = [...changed, ...untracked].filter(path => !allowedPaths.has(path));
	if (unexpected.length > 0) {
		const error = new Error(`unexpected changed paths: ${unexpected.join(', ')}`);
		error.counters = {baseline, changed, untracked, unexpected};
		throw error;
	}
	return {baseline, changed, untracked, unexpected};
}

async function run(results) {
	let pMapIterable;
	try {
		({pMapIterable} = await import(pathToFileURL(resolve(target, 'index.js'))));
		if (typeof pMapIterable !== 'function') throw new TypeError('index.js does not export pMapIterable');
	} catch (error) {
		results.push({id: 'load-candidate', status: 'fail', error: String(error)});
		return;
	}

	for (const [id, check] of cases) {
		try {
			results.push({id, status: 'pass', counters: await check(pMapIterable)});
		} catch (error) {
			results.push({id, status: 'fail', counters: error.counters, error: String(error)});
		}
	}

	try {
		results.push({id: 'changed-path-scope', status: 'pass', counters: changedPathCase()});
	} catch (error) {
		results.push({id: 'changed-path-scope', status: 'fail', counters: error.counters, error: String(error)});
	}
}

function finish(results) {
	const output = {protocol, version, baseline, target, passed: results.every(result => result.status === 'pass'), cases: results};
	writeFileSync(1, `${JSON.stringify(output, undefined, 2)}\n`);
	process.exit(output.passed ? 0 : 1);
}

function killGroup(child) {
	try {
		process.kill(-child.pid, 'SIGKILL');
	} catch {
		child.kill('SIGKILL');
	}
}

async function supervise() {
	const child = spawn(process.execPath, [resolve(process.argv[1]), '--evaluate', target], {detached: true, stdio: ['ignore', 'pipe', 'pipe']});
	let stdout = '';
	let stderr = '';
	let timedOut = false;
	child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
	child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
	const timer = setTimeout(() => {
		timedOut = true;
		killGroup(child);
	}, outerTimeoutMilliseconds);
	const {code, error} = await new Promise(resolve => {
		let error;
		child.on('error', value => { error = value; });
		child.on('close', code => resolve({code, error}));
	});
	clearTimeout(timer);
	killGroup(child);
	if (timedOut) {
		finish([{id: 'watchdog', status: 'fail', error: `evaluation process timed out after ${outerTimeoutMilliseconds}ms`}]);
	}
	let output;
	try {
		output = JSON.parse(stdout);
		assert.equal(output.protocol, protocol);
		assert.equal(output.version, version);
		assert.equal(output.baseline, baseline);
		assert.equal(output.target, target);
		assert.ok(Array.isArray(output.cases) && output.cases.length > 0);
		if (code === 0) {
			assert.equal(output.passed, true);
			assert.deepStrictEqual(output.cases.map(({id}) => id).sort(), [...expectedCaseIds].sort());
			assert.ok(output.cases.every(({status}) => status === 'pass'));
		} else {
			assert.equal(output.passed, false);
			assert.ok(output.cases.some(({status}) => status === 'fail'));
		}
	} catch (parseError) {
		finish([{id: 'evaluator-process', status: 'fail', error: String(error ?? parseError), stderr}]);
	}
	writeFileSync(1, stdout);
	process.exit(code === 0 ? 0 : 1);
}

if (evaluationMode) {
	const results = [];
	const watchdog = setTimeout(() => {
		results.push({id: 'watchdog', status: 'fail', error: `acceptance run timed out after ${watchdogTimeoutMilliseconds}ms`});
		finish(results);
	}, watchdogTimeoutMilliseconds);
	await run(results);
	clearTimeout(watchdog);
	finish(results);
} else {
	await supervise();
}
