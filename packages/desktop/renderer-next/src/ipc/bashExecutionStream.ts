/**
 * In-renderer fan-out for streamed direct-bash output.
 *
 * The backend emits `bash_execution_update` events carrying the `bash`
 * command's request id; consumers (e.g. the workbench terminal) subscribe by
 * that id before sending the command.
 */

type BashDeltaListener = (delta: string) => void;

const listeners = new Map<string, Set<BashDeltaListener>>();

export function subscribeBashExecution(id: string, listener: BashDeltaListener): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

export function emitBashExecutionDelta(id: string, delta: string): void {
  const set = listeners.get(id);
  if (!set) return;
  for (const listener of set) listener(delta);
}

export function createBashExecutionId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `bash_${random}`;
}
