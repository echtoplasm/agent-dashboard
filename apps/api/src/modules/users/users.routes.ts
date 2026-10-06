/**
 * HTTP routes for user administration. Admins only.
 *
 * - `GET /api/users`
 * - `POST /api/users`
 * - `PATCH /api/users/:id`
 * - `POST /api/users/:id/password`: admin password reset.
 */
import { Router } from 'express';
import {
  CreateUserRequestSchema,
  IdParamsSchema,
  ResetPasswordRequestSchema,
  UpdateUserRequestSchema,
} from '@agent-dashboard/shared';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import { buildAuditContext } from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import type { UsersService } from './users.service.js';

/**
 * Creates the users router. Mount behind `requireAuthentication`.
 *
 * @param usersService - User account operations.
 * @returns A router to mount at `/api/users`.
 */
export function createUsersRouter(usersService: UsersService): Router {
  const router = Router();
  router.use(requireRole(ROLE_GROUPS.ADMINS));

  router.get('/', async (_request, response) => {
    response.json({ items: await usersService.listUsers() });
  });

  router.post('/', async (request, response) => {
    const input = parseRequestPart(CreateUserRequestSchema, request.body);
    const createdUser = await usersService.createUser(input, buildAuditContext(request));
    response.status(HTTP_STATUS.CREATED).json(createdUser);
  });

  router.patch('/:id', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const changes = parseRequestPart(UpdateUserRequestSchema, request.body);
    response.json(await usersService.updateUser(id, changes, buildAuditContext(request)));
  });

  router.post('/:id/password', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const { newPassword } = parseRequestPart(ResetPasswordRequestSchema, request.body);
    await usersService.resetPassword(id, newPassword, buildAuditContext(request));
    response.status(HTTP_STATUS.NO_CONTENT).end();
  });

  return router;
}
