import assert from "node:assert/strict";
import test from "node:test";
import { createBackendMutationQueue } from "../src/backend-mutation-queue.js";

test("does not run queued mutations after the backend changes", async () => {
	const queue = createBackendMutationQueue();
	let releaseFirst;
	const first = queue.serialize(
		() => new Promise((resolve) => {
			releaseFirst = resolve;
		}),
	);
	await Promise.resolve();
	let staleMutationRan = false;
	const stale = queue.serialize(() => {
		staleMutationRan = true;
	});

	queue.invalidate();
	releaseFirst();
	await first;
	await assert.rejects(stale, /backend changed/);
	assert.equal(staleMutationRan, false);
});

test("runs new-generation mutations after stale queued work is rejected", async () => {
	const queue = createBackendMutationQueue();
	let releaseFirst;
	const first = queue.serialize(
		() => new Promise((resolve) => {
			releaseFirst = resolve;
		}),
	);
	await Promise.resolve();
	const stale = queue.serialize(() => {
		throw new Error("stale mutation ran");
	});

	queue.invalidate();
	let currentMutationRan = false;
	const current = queue.serialize(() => {
		currentMutationRan = true;
	});
	releaseFirst();

	await first;
	await assert.rejects(stale, /backend changed/);
	await current;
	assert.equal(currentMutationRan, true);
});
