/**
 * Internal types for the audit module.
 */
import type { AuditAction, AuditTargetType } from '@agent-dashboard/shared';

/**
 * Who is acting and from where. Built once per request and passed to every
 * service call that changes state.
 */
export interface AuditContext {
  /** Null for actions with no signed-in user, such as a failed login or the CLI. */
  actorUserId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** An audit entry about to be written. */
export interface NewAuditEntry {
  action: AuditAction;
  targetType: AuditTargetType | null;
  targetId: string | null;
  /** Extra detail, e.g. which fields changed. Never put secrets here. */
  metadata: Record<string, unknown>;
}

/** An audit context for actions the system takes with no request behind them. */
export const SYSTEM_AUDIT_CONTEXT: AuditContext = {
  actorUserId: null,
  ipAddress: null,
  userAgent: null,
};
