/**
 * HTTP routes for skills and skill versions.
 *
 * Skills router, mounted at `/api/skills`:
 * - `GET /`, `GET /:id`, `GET /:id/versions`: everyone.
 * - `POST /`, `PATCH /:id`, `POST /:id/archive`, `POST /:id/versions`: operators.
 *
 * Skill versions router, mounted at `/api/skill-versions`:
 * - `GET /:id`: everyone; includes file contents.
 */
import { Router } from 'express';
import {
  CreateSkillRequestSchema,
  IdParamsSchema,
  IncludeArchivedQuerySchema,
  PublishSkillVersionRequestSchema,
  UpdateSkillRequestSchema,
} from '@agent-dashboard/shared';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import { buildAuditContext } from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import type { SkillsService } from './skills.service.js';

/**
 * Creates the skills router. Mount behind `requireAuthentication`.
 *
 * @param skillsService - Skill operations.
 * @returns A router to mount at `/api/skills`.
 */
export function createSkillsRouter(skillsService: SkillsService): Router {
  const router = Router();
  const requireOperator = requireRole(ROLE_GROUPS.OPERATORS);

  router.get('/', async (request, response) => {
    const { includeArchived: isIncludingArchived } = parseRequestPart(
      IncludeArchivedQuerySchema,
      request.query,
    );
    response.json({ items: await skillsService.listSkills({ isIncludingArchived }) });
  });

  router.get('/:id', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await skillsService.getSkill(id));
  });

  router.get('/:id/versions', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json({ items: await skillsService.listVersions(id) });
  });

  router.post('/', requireOperator, async (request, response) => {
    const input = parseRequestPart(CreateSkillRequestSchema, request.body);
    const createdSkill = await skillsService.createSkill(input, buildAuditContext(request));
    response.status(HTTP_STATUS.CREATED).json(createdSkill);
  });

  router.patch('/:id', requireOperator, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const changes = parseRequestPart(UpdateSkillRequestSchema, request.body);
    response.json(await skillsService.updateSkill(id, changes, buildAuditContext(request)));
  });

  router.post('/:id/archive', requireOperator, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await skillsService.archiveSkill(id, buildAuditContext(request)));
  });

  router.post('/:id/versions', requireOperator, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const input = parseRequestPart(PublishSkillVersionRequestSchema, request.body);
    const publishedVersion = await skillsService.publishVersion(
      id,
      input,
      buildAuditContext(request),
    );
    response.status(HTTP_STATUS.CREATED).json(publishedVersion);
  });

  return router;
}

/**
 * Creates the skill versions router. Mount behind `requireAuthentication`.
 *
 * @param skillsService - Skill operations.
 * @returns A router to mount at `/api/skill-versions`.
 */
export function createSkillVersionsRouter(skillsService: SkillsService): Router {
  const router = Router();

  router.get('/:id', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await skillsService.getVersionDetail(id));
  });

  return router;
}
