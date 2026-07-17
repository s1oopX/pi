export function createBackendMutationQueue() {
	let generation = 0;
	let queue = Promise.resolve();

	return {
		invalidate() {
			generation += 1;
		},

		serialize(operation) {
			const operationGeneration = generation;
			const run = () => {
				if (operationGeneration !== generation) {
					throw new Error("Pi backend changed before the command could run");
				}
				return operation();
			};
			const result = queue.then(run, run);
			queue = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
	};
}
