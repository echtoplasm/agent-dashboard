/**
 * User accounts, roles and authentication contracts.
 */
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema, createListResponseSchema } from './common.js';

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

/** Shortest password accepted. Length matters more than character rules. */
export const MIN_PASSWORD_LENGTH = 12;

/** Longest password accepted, which caps hashing cost per request. */
export const MAX_PASSWORD_LENGTH = 256;

/** Validates a new password. */
export const PasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

/** Letters, digits, dots, dashes and underscores; 3 to 64 characters. */
export const UsernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{3,64}$/, 'Use 3 to 64 letters, digits, dots, dashes or underscores');

/** A user as returned by the API. Never includes the password hash. */
export const UserSchema = z.object({
  id: UuidSchema,
  username: z.string(),
  email: z.email().nullable(),
  role: UserRoleSchema,
  isActive: z.boolean(),
  lastLoginAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** A user as returned by the API. */
export type User = z.infer<typeof UserSchema>;

/** List of users. */
export const UserListResponseSchema = createListResponseSchema(UserSchema);

/** Body of `POST /api/users`. */
export const CreateUserRequestSchema = z.strictObject({
  username: UsernameSchema,
  email: z.email().nullable().default(null),
  role: UserRoleSchema,
  password: PasswordSchema,
});

/** Body of `POST /api/users`. */
export type CreateUserRequest = z.input<typeof CreateUserRequestSchema>;

/** Body of `PATCH /api/users/:id`. Every field is optional. */
export const UpdateUserRequestSchema = z
  .strictObject({
    email: z.email().nullable(),
    role: UserRoleSchema,
    isActive: z.boolean(),
  })
  .partial();

/** Body of `PATCH /api/users/:id`. */
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

/** Body of `POST /api/users/:id/password`, an admin password reset. */
export const ResetPasswordRequestSchema = z.strictObject({ newPassword: PasswordSchema });

/** Body of `POST /api/auth/login`. */
export const LoginRequestSchema = z.strictObject({
  username: z.string().trim().min(1).max(64),
  // Not PasswordSchema: login must not reveal the password policy, and
  // accounts created before a policy change must still be able to log in.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** Body of `POST /api/auth/login`. */
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Body of `POST /api/auth/password`, a user changing their own password. */
export const ChangePasswordRequestSchema = z.strictObject({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: PasswordSchema,
});

/** Body of `POST /api/auth/password`. */
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/** Response of `GET /api/auth/me` and `POST /api/auth/login`. */
export const CurrentUserResponseSchema = z.object({ user: UserSchema });
