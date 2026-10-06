/**
 * What the signed-in user's role allows in the UI.
 *
 * These only decide which controls to show. The API enforces the same rules
 * on every request (see D-019 in docs/decisions.md), so hiding a button is
 * never the only protection.
 */
import type { User } from '@agent-dashboard/shared';

/**
 * Whether the user can create and change agents, skills and assignments.
 *
 * @param user - The signed-in user.
 * @returns True for operators and admins.
 */
export function canManageRegistry(user: User): boolean {
  return user.role === 'admin' || user.role === 'operator';
}

/**
 * Whether the user can read the audit log.
 *
 * @param user - The signed-in user.
 * @returns True for operators and admins.
 */
export function canReadAuditLog(user: User): boolean {
  return canManageRegistry(user);
}

/**
 * Whether the user can manage users, providers and sandbox profiles.
 *
 * @param user - The signed-in user.
 * @returns True for admins.
 */
export function isAdmin(user: User): boolean {
  return user.role === 'admin';
}
