/**
 * HTTP routes for sandbox profiles.
 *
 * - `GET /api/sandbox-profiles?includeArchived=true`, `GET /api/sandbox-profiles/:id`: everyone.
 * - `POST /api/sandbox-profiles`, `PATCH /api/sandbox-profiles/:id`,
 *   `POST /api/sandbox-profiles/:id/archive`: admins.
 */
import { Router } from 'express';
import {
  CreateSandboxProfileRequestSchema,
  IdParamsSchema,
  IncludeArchivedQuerySchema,
  UpdateSandboxProfileRequestSchema,
} from '@agent-dashboard/shared';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import { buildAuditContext } from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import type { SandboxProfilesService } from './sandbox-profiles.service.js';

/**
 * Creates the sandbox profiles router. Mount behind `requireAuthentication`.
 *
 * @param sandboxProfilesService - Sandbox profile operations.
 * @returns A router to mount at `/api/sandbox-profiles`.
 */
export function createSandboxProfilesRouter(
  sandboxProfilesService: SandboxProfilesService,
): Router {
  const router = Router();
  const requireAdmin = requireRole(ROLE_GROUPS.ADMINS);

  router.get('/', async (request, response) => {
    const { includeArchived: isIncludingArchived } = parseRequestPart(
      IncludeArchivedQuerySchema,
      request.query,
    );
    const items = await sandboxProfilesService.listSandboxProfiles({ isIncludingArchived });
    response.json({ items });
  });

  router.get('/:id', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await sandboxProfilesService.getSandboxProfile(id));
  });

  router.post('/', requireAdmin, async (request, response) => {
    const input = parseRequestPart(CreateSandboxProfileRequestSchema, request.body);
    const createdProfile = await sandboxProfilesService.createSandboxProfile(
      input,
      buildAuditContext(request),
    );
    response.status(HTTP_STATUS.CREATED).json(createdProfile);
  });

  router.patch('/:id', requireAdmin, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const changes = parseRequestPart(UpdateSandboxProfileRequestSchema, request.body);
    response.json(
      await sandboxProfilesService.updateSandboxProfile(id, changes, buildAuditContext(request)),
    );
  });

  router.post('/:id/archive', requireAdmin, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(
      await sandboxProfilesService.archiveSandboxProfile(id, buildAuditContext(request)),
    );
  });

  return router;
}
