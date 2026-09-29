import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const watchdog = setTimeout(() => {
	console.error('promised-source-value-abort: timed out waiting for source or prompt rejection');
	process.exit(1);
}, 2000);
try {
	const {pMapIterable} = await import(pathToFileURL(resolve(process.cwd(), 'index.js')));
	const controller = new AbortController();
	const reason = {case: 'promised-source-value-abort'};
	const value = Promise.withResolvers();
	const waiting = Promise.withResolvers();
	let pulls = 0;
	let mapperStarts = 0;
	let closes = 0;
	const input = {[Symbol.iterator]: () => ({
		next() {
			pulls++;
			return {done: false, value: {then(resolve) { waiting.resolve(); value.promise.then(resolve); }}};
		},
		return() { closes++; return {done: true}; },
	})};
	const iterator = pMapIterable(input, () => ++mapperStarts, {
		signal: controller.signal, concurrency: 1, backpressure: 1,
	})[Symbol.asyncIterator]();
	const pending = iterator.next();
	await waiting.promise;
	controller.abort(reason);
	await assert.rejects(pending, error => error === reason, 'pending consumer must reject with the exact abort reason before the input value resolves');
	value.resolve(1);
	await new Promise(resolve => setImmediate(resolve));
	await iterator.next().then(result => assert.equal(result.done, true, 'must not yield after abort'), error => assert.equal(error, reason));
	assert.deepEqual({pulls, mapperStarts, closes}, {pulls: 1, mapperStarts: 0, closes: 1}, 'no mapper may start after abort while awaiting a promised source value');
	console.log('promised-source-value-abort: passed');
} catch (error) {
	console.error('promised-source-value-abort:', error);
	process.exitCode = 1;
} finally {
	clearTimeout(watchdog);
}
