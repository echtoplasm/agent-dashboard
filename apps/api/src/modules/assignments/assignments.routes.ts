/**
 * HTTP routes for an agent's loadout, mounted at `/api/agents`.
 *
 * - `GET /:id/skills`: everyone.
 * - `PUT /:id/skills/:skillId` with `{ skillVersionId }`: operators; assigns or replaces.
 * - `DELETE /:id/skills/:skillId`: operators.
 */
import { Router } from 'express';
import {
  AgentSkillParamsSchema,
  AssignSkillRequestSchema,
  IdParamsSchema,
} from '@agent-dashboard/shared';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import { buildAuditContext } from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import type { AssignmentsService } from './assignments.service.js';

/**
 * Creates the assignments router. Mount at `/api/agents` behind `requireAuthentication`.
 *
 * @param assignmentsService - Assignment operations.
 * @returns The router.
 */
export function createAssignmentsRouter(assignmentsService: AssignmentsService): Router {
  const router = Router();
  const requireOperator = requireRole(ROLE_GROUPS.OPERATORS);

  router.get('/:id/skills', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json({ items: await assignmentsService.listAssignments(id) });
  });

  router.put('/:id/skills/:skillId', requireOperator, async (request, response) => {
    const { id, skillId } = parseRequestPart(AgentSkillParamsSchema, request.params);
    const { skillVersionId } = parseRequestPart(AssignSkillRequestSchema, request.body);
    response.json(
      await assignmentsService.assignSkill(id, skillId, skillVersionId, buildAuditContext(request)),
    );
  });

  router.delete('/:id/skills/:skillId', requireOperator, async (request, response) => {
    const { id, skillId } = parseRequestPart(AgentSkillParamsSchema, request.params);
    await assignmentsService.unassignSkill(id, skillId, buildAuditContext(request));
    response.status(HTTP_STATUS.NO_CONTENT).end();
  });

  return router;
}
