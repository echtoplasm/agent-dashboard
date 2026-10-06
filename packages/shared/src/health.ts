/**
 * Response contract for the `GET /api/health` endpoint.
 */
import { z } from 'zod';

/** Overall service status: `degraded` means a dependency is unavailable. */
export const HEALTH_STATUSES = ['ok', 'degraded'] as const;

/** Reachability of a single dependency such as the database. */
export const DEPENDENCY_STATUSES = ['up', 'down'] as const;

/** Validates the body returned by the health endpoint. */
export const HealthResponseSchema = z.strictObject({
  status: z.enum(HEALTH_STATUSES),
  checks: z.strictObject({
    database: z.enum(DEPENDENCY_STATUSES),
  }),
  uptimeSeconds: z.number().nonnegative(),
  checkedAt: z.iso.datetime(),
});

/** The body returned by the health endpoint. */
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
