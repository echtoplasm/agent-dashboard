/**
 * The JSON body every API error response uses.
 */
import { z } from 'zod';

/** Machine-readable error codes in `error.code`. */
export const API_ERROR_CODES = [
  'validation_failed',
  'malformed_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'capacity_reached',
  'unsupported_media_type',
  'internal_error',
  'service_unavailable',
] as const;

/** One of the machine-readable error codes. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** A single problem with a request field. */
export const FieldProblemSchema = z.object({
  /** Dotted path to the field, e.g. `files.0.path`. */
  path: z.string(),
  message: z.string(),
});

/** A single problem with a request field. */
export type FieldProblem = z.infer<typeof FieldProblemSchema>;

/** Validates an error response body. */
export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    fieldProblems: z.array(FieldProblemSchema).optional(),
  }),
});

/** An error response body. */
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
