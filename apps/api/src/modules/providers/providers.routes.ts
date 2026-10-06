/**
 * HTTP routes for agent providers.
 *
 * - `GET /api/providers`: everyone.
 * - `PATCH /api/providers/:id`: admins; toggles `isEnabled`.
 */
import { Router } from 'express';
import { IdParamsSchema, UpdateProviderRequestSchema } from '@agent-dashboard/shared';
import { buildAuditContext } from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import type { ProvidersService } from './providers.service.js';

/**
 * Creates the providers router. Mount behind `requireAuthentication`.
 *
 * @param providersService - Provider operations.
 * @returns A router to mount at `/api/providers`.
 */
export function createProvidersRouter(providersService: ProvidersService): Router {
  const router = Router();

  router.get('/', async (_request, response) => {
    response.json({ items: await providersService.listProviders() });
  });

  router.patch('/:id', requireRole(ROLE_GROUPS.ADMINS), async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const changes = parseRequestPart(UpdateProviderRequestSchema, request.body);
    response.json(await providersService.updateProvider(id, changes, buildAuditContext(request)));
  });

  return router;
}
