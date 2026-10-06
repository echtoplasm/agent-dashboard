/**
 * Error classes for failures the API reports to clients.
 *
 * Code throws these instead of writing HTTP responses itself. The central
 * error middleware turns them into a consistent JSON shape. Anything that is
 * not an `AppError` becomes a generic 500 so internal details never leak.
 */

/** HTTP status codes used by the error classes. */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** Machine-readable error codes returned in the `error.code` field. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'validation_failed',
  NOT_FOUND: 'not_found',
  MALFORMED_REQUEST: 'malformed_request',
  INTERNAL_ERROR: 'internal_error',
} as const;

/** One of the machine-readable error codes. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** A single problem with a request field. */
export interface FieldProblem {
  /** Dotted path to the field, e.g. `budget.maxCostPerRun`. */
  path: string;
  message: string;
}

/**
 * Base class for errors whose message is safe to show to API clients.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  /**
   * @param message - Client-safe description of what went wrong.
   * @param statusCode - HTTP status to respond with.
   * @param code - Machine-readable error code.
   */
  constructor(message: string, statusCode: number, code: ErrorCode) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** The requested resource or route does not exist. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
  }
}

/** The request body, query or params failed validation. */
export class ValidationError extends AppError {
  readonly fieldProblems: FieldProblem[];

  /**
   * @param fieldProblems - One entry per invalid field.
   */
  constructor(fieldProblems: FieldProblem[]) {
    super('Request validation failed', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_FAILED);
    this.fieldProblems = fieldProblems;
  }
}
