/**
 * Helpers repositories use to turn database rows into API-shaped objects.
 */

/**
 * Converts a `timestamptz` value (a `Date` from `pg`) to an ISO 8601 string.
 *
 * @param value - The column value.
 * @returns The ISO string.
 */
export function toIsoString(value: Date): string {
  return value.toISOString();
}

/**
 * Converts a nullable `timestamptz` value to an ISO 8601 string or null.
 *
 * @param value - The column value.
 * @returns The ISO string, or null.
 */
export function toNullableIsoString(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Postgres error code for a unique constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

/**
 * Reports whether an error from `pg` is a unique constraint violation.
 *
 * @param error - Anything thrown by a query.
 * @returns `true` for duplicate-key errors.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION_CODE
  );
}
