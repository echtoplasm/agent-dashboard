/**
 * Data access for the append-only `audit_log` table.
 *
 * The app role can only insert and read audit rows; the database rejects
 * updates and deletes (see D-005 in docs/decisions.md).
 */
import type { AuditEntry, AuditLogPage, AuditLogQuery } from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { toIsoString } from '../../db/row-mapping.js';
import type { AuditContext, NewAuditEntry } from './audit.types.js';

/** Longest user agent stored, so a client cannot bloat the log. */
const MAX_USER_AGENT_LENGTH = 500;

interface AuditEntryRow {
  id: number;
  actor_user_id: string | null;
  actor_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

function mapAuditEntryRow(row: AuditEntryRow): AuditEntry {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: toIsoString(row.created_at),
  };
}

/** Data access for the audit log. */
export interface AuditRepository {
  /** Appends one entry. Call inside the same transaction as the change it records. */
  insertAuditEntry(context: AuditContext, entry: NewAuditEntry): Promise<void>;
  /** Returns one page of entries, newest first. */
  listAuditEntries(query: AuditLogQuery): Promise<AuditLogPage>;
}

/**
 * Creates the audit repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createAuditRepository(database: DatabaseExecutor): AuditRepository {
  return {
    async insertAuditEntry(context, entry) {
      await database('audit_log').insert({
        actor_user_id: context.actorUserId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        metadata: entry.metadata,
        ip_address: context.ipAddress,
        user_agent: context.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      });
    },

    async listAuditEntries(query) {
      const pageQuery = database('audit_log')
        .leftJoin('users', 'users.id', 'audit_log.actor_user_id')
        .select<AuditEntryRow[]>('audit_log.*', 'users.username AS actor_username')
        .orderBy('audit_log.id', 'desc')
        // One extra row tells us whether another page exists.
        .limit(query.limit + 1);

      if (query.before !== undefined) {
        pageQuery.where('audit_log.id', '<', query.before);
      }
      if (query.targetType !== undefined) {
        pageQuery.where('audit_log.target_type', query.targetType);
      }
      if (query.targetId !== undefined) {
        pageQuery.where('audit_log.target_id', query.targetId);
      }
      if (query.actorUserId !== undefined) {
        pageQuery.where('audit_log.actor_user_id', query.actorUserId);
      }

      const rows = await pageQuery;
      const hasMore = rows.length > query.limit;
      const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
      return {
        items: pageRows.map(mapAuditEntryRow),
        nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
      };
    },
  };
}
