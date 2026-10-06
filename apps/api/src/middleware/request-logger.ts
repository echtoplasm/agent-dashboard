/**
 * Logs one line per completed HTTP request.
 *
 * Only the path is logged, never the query string, because query strings can
 * carry tokens. Headers are not logged at all.
 */
import type { RequestHandler } from 'express';
import type { Logger } from '../logger.js';

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const SERVER_ERROR_STATUS_THRESHOLD = 500;

/**
 * Creates middleware that logs method, path, status and duration when each
 * response finishes.
 *
 * @param logger - The application logger.
 * @returns Express middleware.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const startedAt = process.hrtime.bigint();
    // Read the path now: mounted routers rewrite `request.path` while routing.
    const requestPath = request.path;

    response.on('finish', () => {
      const durationMs = Number(
        (process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_MILLISECOND,
      );
      const requestSummary = {
        method: request.method,
        path: requestPath,
        statusCode: response.statusCode,
        durationMs,
      };
      const isServerError = response.statusCode >= SERVER_ERROR_STATUS_THRESHOLD;
      if (isServerError) {
        logger.error(requestSummary, 'request failed');
      } else {
        logger.info(requestSummary, 'request completed');
      }
    });

    next();
  };
}
