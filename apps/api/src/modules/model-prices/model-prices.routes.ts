/**
 * HTTP routes for model prices.
 *
 * - `GET /api/model-prices`: everyone.
 * - `PUT /api/model-prices`, `DELETE /api/model-prices/:id`: admins.
 */
import { Router } from 'express';
import { IdParamsSchema, SetModelPriceRequestSchema } from '@agent-dashboard/shared';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import { buildAuditContext } from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import type { ModelPricesService } from './model-prices.service.js';

/**
 * Creates the model prices router. Mount behind `requireAuthentication`.
 *
 * @param modelPricesService - Model price operations.
 * @returns A router to mount at `/api/model-prices`.
 */
export function createModelPricesRouter(modelPricesService: ModelPricesService): Router {
  const router = Router();
  const requireAdmin = requireRole(ROLE_GROUPS.ADMINS);

  router.get('/', async (_request, response) => {
    response.json({ items: await modelPricesService.listModelPrices() });
  });

  router.put('/', requireAdmin, async (request, response) => {
    const input = parseRequestPart(SetModelPriceRequestSchema, request.body);
    response.json(await modelPricesService.setModelPrice(input, buildAuditContext(request)));
  });

  router.delete('/:id', requireAdmin, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    await modelPricesService.deleteModelPrice(id, buildAuditContext(request));
    response.status(HTTP_STATUS.NO_CONTENT).end();
  });

  return router;
}
