/**
 * The single place where errors become HTTP responses.
 *
 * Every route error ends up here. `AppError`s are returned with their own
 * status and message. Body-parser errors (malformed JSON, oversized bodies)
 * become 400-range responses. Everything else is logged and returned as a
 * generic 500, so stack traces and internal messages never reach the client.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import {
  AppError,
  ERROR_CODES,
  HTTP_STATUS,
  NotFoundError,
  ValidationError,
} from '../errors/app-errors.js';
import type { ErrorCode, FieldProblem } from '../errors/app-errors.js';
import type { Logger } from '../logger.js';

/** JSON body of every error response. */
export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    fieldProblems?: FieldProblem[];
  };
}

/**
 * Shape of the errors Express's body parsers throw. They carry an HTTP
 * status and an `expose` flag saying whether the message is client-safe.
 */
interface HttpClientError {
  status: number;
  expose: boolean;
  message: string;
}

const MIN_CLIENT_ERROR_STATUS = 400;
const MAX_CLIENT_ERROR_STATUS = 499;

function isHttpClientError(error: unknown): error is HttpClientError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as Partial<HttpClientError>;
  return (
    typeof candidate.status === 'number' &&
    candidate.status >= MIN_CLIENT_ERROR_STATUS &&
    candidate.status <= MAX_CLIENT_ERROR_STATUS &&
    candidate.expose === true
  );
}

function buildAppErrorBody(error: AppError): ErrorResponseBody {
  const body: ErrorResponseBody = { error: { code: error.code, message: error.message } };
  if (error instanceof ValidationError) {
    body.error.fieldProblems = error.fieldProblems;
  }
  return body;
}

/**
 * Creates the catch-all handler for requests that matched no route.
 *
 * @returns Middleware that forwards a `NotFoundError`.
 */
export function createNotFoundHandler(): RequestHandler {
  return (request, _response, next) => {
    next(new NotFoundError(`No route for ${request.method} ${request.path}`));
  };
}

/**
 * Creates the central error-handling middleware. Register it last.
 *
 * @param logger - Used to record unexpected errors with their stack trace.
 * @returns Express error middleware.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    if (error instanceof AppError) {
      response.status(error.statusCode).json(buildAppErrorBody(error));
      return;
    }

    if (isHttpClientError(error)) {
      const body: ErrorResponseBody = {
        error: { code: ERROR_CODES.MALFORMED_REQUEST, message: error.message },
      };
      response.status(error.status).json(body);
      return;
    }

    logger.error({ err: error, method: request.method, path: request.path }, 'unhandled error');
    const body: ErrorResponseBody = {
      error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error' },
    };
    response.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json(body);
  };
}
