/**
 * HTTP routes for agents.
 *
 * - `GET /api/agents?includeArchived=true`, `GET /api/agents/:id`: everyone.
 * - `POST /api/agents`, `PATCH /api/agents/:id`, `POST /api/agents/:id/archive`: operators.
 */
import { Router } from 'express';
import {
  CreateAgentRequestSchema,
  IdParamsSchema,
  IncludeArchivedQuerySchema,
  UpdateAgentRequestSchema,
} from '@agent-dashboard/shared';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import { buildAuditContext } from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import type { AgentsService } from './agents.service.js';

/**
 * Creates the agents router. Mount behind `requireAuthentication`.
 *
 * Assignment routes (`/api/agents/:id/skills`) live in the skills module.
 *
 * @param agentsService - Agent operations.
 * @returns A router to mount at `/api/agents`.
 */
export function createAgentsRouter(agentsService: AgentsService): Router {
  const router = Router();
  const requireOperator = requireRole(ROLE_GROUPS.OPERATORS);

  router.get('/', async (request, response) => {
    const { includeArchived: isIncludingArchived } = parseRequestPart(
      IncludeArchivedQuerySchema,
      request.query,
    );
    response.json({ items: await agentsService.listAgents({ isIncludingArchived }) });
  });

  router.get('/:id', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await agentsService.getAgent(id));
  });

  router.post('/', requireOperator, async (request, response) => {
    const input = parseRequestPart(CreateAgentRequestSchema, request.body);
    const createdAgent = await agentsService.createAgent(input, buildAuditContext(request));
    response.status(HTTP_STATUS.CREATED).json(createdAgent);
  });

  router.patch('/:id', requireOperator, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const changes = parseRequestPart(UpdateAgentRequestSchema, request.body);
    response.json(await agentsService.updateAgent(id, changes, buildAuditContext(request)));
  });

  router.post('/:id/archive', requireOperator, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await agentsService.archiveAgent(id, buildAuditContext(request)));
  });

  return router;
}
