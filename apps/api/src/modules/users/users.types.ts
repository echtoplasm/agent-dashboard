/**
 * Internal types for the users module.
 */
import type { User, UserRole } from '@agent-dashboard/shared';

/**
 * A user as stored, including the password hash. Never leaves the API:
 * services convert it to `User` before returning.
 */
export interface UserRecord extends User {
  passwordHash: string | null;
}

/** Fields needed to insert a user. */
export interface NewUser {
  username: string;
  email: string | null;
  role: UserRole;
  passwordHash: string;
}

/** Columns a user update may change. */
export interface UserChanges {
  email?: string | null | undefined;
  role?: UserRole | undefined;
  isActive?: boolean | undefined;
  passwordHash?: string | undefined;
  lastLoginAt?: Date | undefined;
}
