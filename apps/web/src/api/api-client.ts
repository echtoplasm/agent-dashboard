/**
 * Low-level HTTP client for the API.
 *
 * Every response body is validated against a Zod schema from the shared
 * package, so a contract mismatch fails loudly here instead of rendering
 * bad data. Errors come back as `ApiError` with the API's error code and
 * per-field problems, which forms display next to the right inputs.
 */
import { ApiErrorResponseSchema } from '@agent-dashboard/shared';
import type { ApiErrorCode, FieldProblem } from '@agent-dashboard/shared';
import type { z } from 'zod';

/**
 * Base URL for API requests. Empty means same origin (the Vite proxy in
 * development). Set `VITE_API_BASE_URL` when the app is served from
 * elsewhere, such as a future Tauri shell.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '';

const HTTP_NO_CONTENT = 204;

/** An error response from the API, or a failure to reach it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'network_error' | 'invalid_response';
  readonly fieldProblems: FieldProblem[];

  /**
   * @param status - HTTP status, or 0 when the API could not be reached.
   * @param code - The API's error code, or a client-side code.
   * @param message - Human-readable message, safe to show.
   * @param fieldProblems - Per-field details, if any.
   */
  constructor(
    status: number,
    code: ApiError['code'],
    message: string,
    fieldProblems: FieldProblem[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldProblems = fieldProblems;
  }

  /** True when the session is missing or expired. */
  get isUnauthenticated(): boolean {
    return this.code === 'unauthenticated';
  }
}

/** Options for one API request. */
export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialisable request body. */
  body?: unknown;
}

/** Notified whenever any request fails with 401, so the app can return to sign-in. */
let unauthenticatedListener: (() => void) | undefined;

/**
 * Registers the function to call when a request comes back 401.
 *
 * @param listener - Usually clears the signed-in user.
 */
export function setUnauthenticatedListener(listener: (() => void) | undefined): void {
  unauthenticatedListener = listener;
}

async function readErrorResponse(response: Response): Promise<ApiError> {
  const parsedBody = ApiErrorResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsedBody.success) {
    return new ApiError(response.status, 'invalid_response', `Request failed (${response.status})`);
  }
  const { code, message, fieldProblems } = parsedBody.data.error;
  return new ApiError(response.status, code, message, fieldProblems ?? []);
}

/**
 * Sends a request and validates the JSON response.
 *
 * Cookies are sent automatically (same origin). The browser adds the
 * `Origin` header the API's CSRF check needs.
 *
 * @param path - API path, e.g. `/api/agents`.
 * @param responseSchema - Schema for a successful response body; null for 204 responses.
 * @param options - Method and body.
 * @returns The parsed response body.
 * @throws {ApiError} On network failure, an error status, or a body that doesn't match the schema.
 */
export async function apiRequest<Schema extends z.ZodType>(
  path: string,
  responseSchema: Schema,
  options?: ApiRequestOptions,
): Promise<z.output<Schema>>;
export async function apiRequest(
  path: string,
  responseSchema: null,
  options?: ApiRequestOptions,
): Promise<void>;
export async function apiRequest(
  path: string,
  responseSchema: z.ZodType | null,
  options: ApiRequestOptions = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the API');
  }

  if (!response.ok) {
    const apiError = await readErrorResponse(response);
    if (apiError.isUnauthenticated) {
      unauthenticatedListener?.();
    }
    throw apiError;
  }
  if (responseSchema === null || response.status === HTTP_NO_CONTENT) {
    return undefined;
  }

  const parsedBody = responseSchema.safeParse(await response.json().catch(() => null));
  if (!parsedBody.success) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The API returned an unexpected response',
    );
  }
  return parsedBody.data;
}
