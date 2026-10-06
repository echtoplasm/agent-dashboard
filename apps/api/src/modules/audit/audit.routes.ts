/**
 * HTTP route for reading the audit log. Operators and admins only.
 *
 * - `GET /api/audit-log?limit=&before=&targetType=&targetId=&actorUserId=`
 *
 * There are no write routes: entries are only ever created by services, in
 * the same transaction as the change they record.
 */
import { Router } from 'express';
import { AuditLogQuerySchema } from '@agent-dashboard/shared';
import { parseRequestPart } from '../../http/request-validation.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import type { AuditService } from './audit.service.js';

/**
 * Creates the audit log router. Mount behind `requireAuthentication`.
 *
 * @param auditService - Audit log queries.
 * @returns A router to mount at `/api/audit-log`.
 */
export function createAuditRouter(auditService: AuditService): Router {
  const router = Router();
  router.use(requireRole(ROLE_GROUPS.OPERATORS));

  router.get('/', async (request, response) => {
    const query = parseRequestPart(AuditLogQuerySchema, request.query);
    response.json(await auditService.listAuditEntries(query));
  });

  return router;
}
