/**
 * Audit log contracts.
 */
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common.js';

/**
 * Every action the API records. Names follow `<subject>.<verb>`, matching the
 * `audit_log_action_format_check` constraint.
 */
export const AUDIT_ACTIONS = [
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.logged_out',
  'auth.password_changed',
  'user.created',
  'user.updated',
  'user.password_reset',
  'provider.updated',
  'sandbox_profile.created',
  'sandbox_profile.updated',
  'sandbox_profile.archived',
  'agent.created',
  'agent.updated',
  'agent.archived',
  'skill.created',
  'skill.updated',
  'skill.archived',
  'skill_version.published',
  'agent_skill.assigned',
  'agent_skill.unassigned',
] as const;

/** A recorded action name. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Kinds of thing an audit entry can point at. */
export const AUDIT_TARGET_TYPES = [
  'user',
  'provider',
  'sandbox_profile',
  'agent',
  'skill',
  'skill_version',
] as const;

/** A kind of audit target. */
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** An audit log entry as returned by the API. */
export const AuditEntrySchema = z.object({
  id: z.number().int(),
  actorUserId: UuidSchema.nullable(),
  /** Username of the actor at read time, or null for system actions. */
  actorUsername: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});

/** An audit log entry. */
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Default and maximum page size for the audit log. */
export const AUDIT_PAGE_SIZE = { DEFAULT: 50, MAX: 200 } as const;

/** Query parameters of `GET /api/audit-log`. Pages go backwards in time. */
export const AuditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE.MAX).default(AUDIT_PAGE_SIZE.DEFAULT),
  /** Return entries with ids lower than this (the previous page's `nextCursor`). */
  before: z.coerce.number().int().positive().optional(),
  targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
  targetId: z.string().max(100).optional(),
  actorUserId: UuidSchema.optional(),
});

/** Query parameters of `GET /api/audit-log`. */
export type AuditLogQuery = z.output<typeof AuditLogQuerySchema>;

/** One page of the audit log. */
export const AuditLogPageSchema = z.object({
  items: z.array(AuditEntrySchema),
  /** Pass as `before` to fetch the next (older) page; null on the last page. */
  nextCursor: z.number().int().nullable(),
});

/** One page of the audit log. */
export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;
