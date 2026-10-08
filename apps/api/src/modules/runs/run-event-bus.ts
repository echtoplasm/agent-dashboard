/**
 * In-process publish/subscribe for stored run events.
 *
 * The run manager publishes each event right after it is stored; SSE
 * connections subscribe to the run they are streaming. This only works
 * within one API process, which matches the single-instance deployment
 * (D-025). Scaling out would need Postgres LISTEN/NOTIFY or similar here.
 */
import { EventEmitter } from 'node:events';
import type { RunEvent } from '@agent-dashboard/shared';

/** Receives events for one run. */
export type RunEventListener = (event: RunEvent) => void;

/** Fan-out of stored run events to live subscribers. */
export interface RunEventBus {
  publish(event: RunEvent): void;
  /**
   * Subscribes to one run's events.
   *
   * @returns A function that unsubscribes.
   */
  subscribe(runId: string, listener: RunEventListener): () => void;
}

/**
 * Creates an event bus.
 *
 * @returns The bus.
 */
export function createRunEventBus(): RunEventBus {
  const emitter = new EventEmitter();
  // One listener per open stream; there is no meaningful limit to warn about.
  emitter.setMaxListeners(0);
  return {
    publish(event) {
      emitter.emit(event.runId, event);
    },
    subscribe(runId, listener) {
      emitter.on(runId, listener);
      return () => {
        emitter.off(runId, listener);
      };
    },
  };
}
