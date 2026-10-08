/**
 * Follows a run's events over Server-Sent Events.
 *
 * The API replays every stored event when the stream opens, then sends new
 * ones as they happen, so this hook needs no separate initial fetch. If the
 * connection drops, the browser's `EventSource` reconnects by itself and
 * sends `Last-Event-ID`, so the server resumes after the last event
 * received. Events are also de-duplicated by sequence number here, in case
 * a reconnect overlaps.
 */
import { useEffect, useState } from 'react';
import { RUN_STREAM_EVENT_NAMES, RunEventSchema } from '@agent-dashboard/shared';
import type { RunEvent } from '@agent-dashboard/shared';
import { buildRunStreamUrl } from '../api/endpoints.js';

/** The state of a run's event stream. */
export interface RunEventStream {
  /** Events received so far, in sequence order. */
  events: RunEvent[];
  /** True once the server has said the run is over and closed the stream. */
  isEnded: boolean;
  /** True while the connection is down and the browser is retrying. */
  isReconnecting: boolean;
}

/**
 * Appends an event unless it was already received.
 *
 * @param events - Events so far, in order.
 * @param event - A newly received event.
 * @returns The new list, or the same list if the event is a duplicate.
 */
export function appendRunEvent(events: RunEvent[], event: RunEvent): RunEvent[] {
  const lastEvent = events.at(-1);
  if (lastEvent !== undefined && event.sequenceNumber <= lastEvent.sequenceNumber) {
    return events;
  }
  return [...events, event];
}

/**
 * Subscribes to a run's events.
 *
 * @param runId - The run to follow.
 * @returns The events, and whether the stream has ended or is reconnecting.
 */
export function useRunEventStream(runId: string): RunEventStream {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [isEnded, setIsEnded] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    setEvents([]);
    setIsEnded(false);
    const eventSource = new EventSource(buildRunStreamUrl(runId), { withCredentials: true });

    eventSource.addEventListener(
      RUN_STREAM_EVENT_NAMES.RUN_EVENT,
      (message: MessageEvent<string>) => {
        const parsedEvent = RunEventSchema.safeParse(JSON.parse(message.data));
        if (parsedEvent.success) {
          setEvents((currentEvents) => appendRunEvent(currentEvents, parsedEvent.data));
        }
      },
    );
    eventSource.addEventListener(RUN_STREAM_EVENT_NAMES.END, () => {
      setIsEnded(true);
      eventSource.close();
    });
    eventSource.addEventListener('open', () => {
      setIsReconnecting(false);
    });
    eventSource.addEventListener('error', () => {
      setIsReconnecting(eventSource.readyState === EventSource.CONNECTING);
    });

    return () => {
      eventSource.close();
    };
  }, [runId]);

  return { events, isEnded, isReconnecting };
}
