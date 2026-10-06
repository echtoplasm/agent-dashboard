/**
 * Reading the audit log.
 *
 * Writing happens through `repositories.audit.insertAuditEntry` inside each
 * service's own transaction, so this service only reads.
 */
import type { AuditLogPage, AuditLogQuery } from '@agent-dashboard/shared';
import type { DataAccess } from '../../db/data-access.js';

/** Audit log queries. */
export interface AuditService {
  /** Returns one page of entries, newest first. */
  listAuditEntries(query: AuditLogQuery): Promise<AuditLogPage>;
}

/**
 * Creates the audit service.
 *
 * @param dataAccess - Repository access.
 * @returns The service.
 */
export function createAuditService(dataAccess: DataAccess): AuditService {
  return {
    listAuditEntries: (query) => dataAccess.repositories.audit.listAuditEntries(query),
  };
}
