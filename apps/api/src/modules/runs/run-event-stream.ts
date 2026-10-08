/**
 * Server-Sent Events stream of one run's events.
 *
 * A client connects with an optional `Last-Event-ID` (the browser sends it
 * automatically when it reconnects) or `?after=<sequenceNumber>`. The
 * stream:
 *
 * 1. subscribes to live events first and buffers them,
 * 2. replays stored events after the cursor, page by page,
 * 3. flushes the buffer, skipping anything already sent, then forwards live
 *    events as they arrive.
 *
 * Subscribing before replaying means an event stored during the replay is
 * never missed; tracking the last sequence number sent means none is sent
 * twice. The stream ends with an `end` event once the run reaches a
 * terminal status. A comment line every 15 seconds keeps proxies from
 * closing an idle connection.
 */
import type { Request, Response } from 'express';
import {
  RUN_EVENT_PAGE_SIZE,
  RUN_STREAM_EVENT_NAMES,
  isTerminalRunStatus,
} from '@agent-dashboard/shared';
import type { RunEvent } from '@agent-dashboard/shared';
import type { Logger } from '../../logger.js';
import type { RunsService } from './runs.service.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const LAST_EVENT_ID_HEADER = 'last-event-id';
const NO_EVENTS_SENT = -1;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Stops nginx from buffering the stream when it is used as a reverse proxy.
  'X-Accel-Buffering': 'no',
} as const;

/**
 * Reads the replay cursor from `Last-Event-ID` or `?after=`.
 *
 * @param request - The SSE request.
 * @returns The sequence number of the last event the client already has, or -1.
 */
export function readStreamCursor(request: Request): number {
  const rawCursor = request.get(LAST_EVENT_ID_HEADER) ?? request.query.after;
  const cursor = typeof rawCursor === 'string' ? Number(rawCursor) : Number.NaN;
  return Number.isSafeInteger(cursor) && cursor >= NO_EVENTS_SENT ? cursor : NO_EVENTS_SENT;
}

function formatServerSentEvent(eventName: string, data: unknown, id?: number): string {
  const idLine = id === undefined ? '' : `id: ${id}\n`;
  return `${idLine}event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isTerminalStatusEvent(event: RunEvent): boolean {
  return event.type === 'run.status' && isTerminalRunStatus(event.payload.status);
}

/**
 * Streams a run's events to the client until the run ends or the client
 * disconnects.
 *
 * @param runId - The run to stream. Must exist (checked by the caller).
 * @param request - The HTTP request.
 * @param response - The HTTP response, not yet started.
 * @param dependencies - The runs service and a logger.
 */
export async function streamRunEvents(
  runId: string,
  request: Request,
  response: Response,
  dependencies: { runsService: RunsService; logger: Logger },
): Promise<void> {
  const { runsService, logger } = dependencies;
  let lastSentSequenceNumber = readStreamCursor(request);
  let isReplaying = true;
  let isClosed = false;
  const bufferedLiveEvents: RunEvent[] = [];

  const heartbeat = setInterval(() => {
    response.write(': keep-alive\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  // A function, not a direct read: the flag changes while the replay awaits.
  const isStreamOpen = (): boolean => !isClosed;

  function close(): void {
    if (isClosed) {
      return;
    }
    isClosed = true;
    clearInterval(heartbeat);
    unsubscribe();
    response.end();
  }

  function finishStream(): void {
    response.write(formatServerSentEvent(RUN_STREAM_EVENT_NAMES.END, {}));
    close();
  }

  function sendEvent(event: RunEvent): void {
    if (isClosed || event.sequenceNumber <= lastSentSequenceNumber) {
      return;
    }
    response.write(
      formatServerSentEvent(RUN_STREAM_EVENT_NAMES.RUN_EVENT, event, event.sequenceNumber),
    );
    lastSentSequenceNumber = event.sequenceNumber;
    if (isTerminalStatusEvent(event)) {
      finishStream();
    }
  }

  const unsubscribe = runsService.subscribeToRunEvents(runId, (event) => {
    if (isReplaying) {
      bufferedLiveEvents.push(event);
    } else {
      sendEvent(event);
    }
  });
  request.on('close', close);

  response.writeHead(200, SSE_HEADERS);
  response.flushHeaders();

  try {
    let hasMorePages = true;
    while (hasMorePages && isStreamOpen()) {
      const page = await runsService.listRunEvents(runId, {
        after: lastSentSequenceNumber,
        limit: RUN_EVENT_PAGE_SIZE.MAX,
      });
      page.items.forEach(sendEvent);
      hasMorePages = page.nextCursor !== null;
    }
    isReplaying = false;
    bufferedLiveEvents.splice(0).forEach(sendEvent);

    // A run can be terminal without a terminal status event (a run cancelled
    // while orphaned by a crash), so check the row as well.
    const run = await runsService.getRun(runId);
    if (isTerminalRunStatus(run.status)) {
      finishStream();
    }
  } catch (error) {
    logger.error({ err: error, runId }, 'run event stream failed');
    close();
  }
}
