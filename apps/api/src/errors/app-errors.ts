/**
 * Error classes for failures the API reports to clients.
 *
 * Code throws these instead of writing HTTP responses itself. The central
 * error middleware turns them into a consistent JSON shape. Anything that is
 * not an `AppError` becomes a generic 500 so internal details never leak.
 */
import type { ApiErrorCode, FieldProblem } from '@agent-dashboard/shared';

export type { ApiErrorCode as ErrorCode, FieldProblem } from '@agent-dashboard/shared';

/** HTTP status codes used by the API. */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** Machine-readable error codes returned in the `error.code` field. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'validation_failed',
  MALFORMED_REQUEST: 'malformed_request',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  CAPACITY_REACHED: 'capacity_reached',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
} as const satisfies Record<string, ApiErrorCode>;

/**
 * Base class for errors whose message is safe to show to API clients.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  /** Optional per-field details, e.g. validation problems or permission violations. */
  readonly fieldProblems: FieldProblem[] | undefined;

  /**
   * @param message - Client-safe description of what went wrong.
   * @param statusCode - HTTP status to respond with.
   * @param code - Machine-readable error code.
   * @param fieldProblems - Optional per-field details.
   */
  constructor(
    message: string,
    statusCode: number,
    code: ApiErrorCode,
    fieldProblems?: FieldProblem[],
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.fieldProblems = fieldProblems;
  }
}

/** The request body, query or params failed validation. */
export class ValidationError extends AppError {
  /**
   * @param fieldProblems - One entry per invalid field.
   */
  constructor(fieldProblems: FieldProblem[]) {
    super(
      'Request validation failed',
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_FAILED,
      fieldProblems,
    );
  }
}

/** No valid session accompanied a request that needs one. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Sign in to continue') {
    super(message, HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED);
  }
}

/** The signed-in user's role does not allow this action. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that') {
    super(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN);
  }
}

/** The requested resource or route does not exist. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
  }
}

/**
 * The request is valid but clashes with current state: a duplicate name, an
 * archived resource, or a change that would break an existing assignment.
 */
export class ConflictError extends AppError {
  /**
   * @param message - What clashed.
   * @param fieldProblems - Optional details, e.g. permission ceiling violations.
   */
  constructor(message: string, fieldProblems?: FieldProblem[]) {
    super(message, HTTP_STATUS.CONFLICT, ERROR_CODES.CONFLICT, fieldProblems);
  }
}

/** A state-changing request was not sent as JSON. */
export class UnsupportedMediaTypeError extends AppError {
  constructor() {
    super(
      'Requests with a body must use Content-Type: application/json',
      HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
      ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    );
  }
}

/** The client sent too many requests in a short time. */
export class RateLimitedError extends AppError {
  constructor() {
    super(
      'Too many requests, try again later',
      HTTP_STATUS.TOO_MANY_REQUESTS,
      ERROR_CODES.RATE_LIMITED,
    );
  }
}

/**
 * Launching another run would exceed `MAX_CONCURRENT_RUNS`. Distinct from
 * rate limiting: it clears as soon as a run finishes, not after a time window.
 */
export class RunCapacityError extends AppError {
  /**
   * @param maxConcurrentRuns - The configured limit, included in the message.
   */
  constructor(maxConcurrentRuns: number) {
    super(
      `${maxConcurrentRuns} runs are already active, the most allowed at once; try again when one finishes`,
      HTTP_STATUS.TOO_MANY_REQUESTS,
      ERROR_CODES.CAPACITY_REACHED,
    );
  }
}

/** The server is missing configuration or a dependency needed for this request. */
export class ServiceUnavailableError extends AppError {
  /**
   * @param message - What is missing, safe to show to clients.
   */
  constructor(message: string) {
    super(message, HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.SERVICE_UNAVAILABLE);
  }
}
