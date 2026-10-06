/**
 * User roles for role-based access control.
 */
import { z } from 'zod';

/**
 * Roles a dashboard user can hold, from most to least privileged.
 *
 * - `admin`: manages users, providers and sandbox profiles.
 * - `operator`: manages agents and skills and launches runs.
 * - `viewer`: read-only access to agents, skills and run history.
 */
export const USER_ROLES = ['admin', 'operator', 'viewer'] as const;

/** Validates a user role. */
export const UserRoleSchema = z.enum(USER_ROLES);

/** A dashboard user's role. */
export type UserRole = z.infer<typeof UserRoleSchema>;
