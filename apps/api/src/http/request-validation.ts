/**
 * Validates parts of an HTTP request against Zod schemas at the route boundary.
 */
import type { FieldProblem } from '@agent-dashboard/shared';
import type { z } from 'zod';
import { ValidationError } from '../errors/app-errors.js';

/**
 * Converts Zod issues into the API's field problem format.
 *
 * @param error - A Zod validation error.
 * @returns One problem per issue, with a dotted path.
 */
export function toFieldProblems(error: z.ZodError): FieldProblem[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Parses a request body, params or query object.
 *
 * @param schema - The expected shape.
 * @param value - e.g. `request.body`.
 * @returns The parsed value with defaults and transforms applied.
 * @throws {ValidationError} Listing every invalid field.
 *
 * @example
 * ```ts
 * const input = parseRequestPart(CreateAgentRequestSchema, request.body);
 * ```
 */
export function parseRequestPart<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(toFieldProblems(result.error));
  }
  return result.data;
}
