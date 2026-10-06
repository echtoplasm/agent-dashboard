/**
 * Custom result parsers for Postgres column types.
 *
 * By default `pg` returns `bigint` (int8) values as strings because they can
 * exceed JavaScript's safe integer range. Our int8 columns (token counts,
 * micro-USD costs, bigserial ids) stay far below that range, so we parse them
 * as numbers and fail loudly if a value ever doesn't fit. See D-007 in
 * docs/decisions.md.
 */
import pg from 'pg';

/**
 * Thrown when an int8 value from Postgres is too large to represent exactly
 * as a JavaScript number.
 */
export class UnsafeIntegerError extends Error {
  constructor(rawValue: string) {
    super(`Postgres int8 value ${rawValue} exceeds Number.MAX_SAFE_INTEGER`);
    this.name = 'UnsafeIntegerError';
  }
}

/**
 * Parses a Postgres int8 text value into a number, refusing to lose precision.
 *
 * @param rawValue - The int8 value as Postgres sends it.
 * @returns The value as an exact JavaScript number.
 * @throws {UnsafeIntegerError} If the value is outside the safe integer range.
 */
export function parseSafeInt8(rawValue: string): number {
  const parsedValue = Number(rawValue);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new UnsafeIntegerError(rawValue);
  }
  return parsedValue;
}

/**
 * Registers the custom type parsers on the global `pg` driver.
 *
 * `pg` keeps parsers in process-wide state, so this applies to every
 * connection pool. Calling it more than once is harmless.
 */
export function registerPostgresTypeParsers(): void {
  pg.types.setTypeParser(pg.types.builtins.INT8, parseSafeInt8);
}
