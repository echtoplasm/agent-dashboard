/**
 * HTTP routes for runs.
 *
 * - `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/events`,
 *   `GET /api/runs/:id/stream` (SSE), `GET /api/runs/:id/workspace`,
 *   `GET /api/runs/:id/workspace/file?path=`: everyone.
 * - `POST /api/runs`, `POST /api/runs/:id/cancel`: operators. Both are audited.
 * - `GET /api/agents/:id/usage`: everyone (see `createAgentUsageRouter`).
 */
import { basename } from 'node:path';
import { Router } from 'express';
import {
  IdParamsSchema,
  LaunchRunRequestSchema,
  RunEventListQuerySchema,
  RunListQuerySchema,
  WorkspaceFileQuerySchema,
} from '@agent-dashboard/shared';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import { buildAuditContext } from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import type { Logger } from '../../logger.js';
import { ROLE_GROUPS, requireRole } from '../auth/auth.middleware.js';
import { streamRunEvents } from './run-event-stream.js';
import type { RunsService } from './runs.service.js';

/**
 * Builds a `Content-Disposition` header that downloads a file under its own
 * name. The name is percent-encoded, so quotes or newlines in a file name
 * the agent chose cannot break the header.
 */
function buildAttachmentDisposition(path: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`;
}

/**
 * Creates the runs router. Mount behind `requireAuthentication`.
 *
 * @param runsService - Run operations.
 * @param logger - For errors after an SSE stream has started.
 * @returns A router to mount at `/api/runs`.
 */
export function createRunsRouter(runsService: RunsService, logger: Logger): Router {
  const router = Router();
  const requireOperator = requireRole(ROLE_GROUPS.OPERATORS);

  router.get('/', async (request, response) => {
    const query = parseRequestPart(RunListQuerySchema, request.query);
    response.json(await runsService.listRuns(query));
  });

  router.post('/', requireOperator, async (request, response) => {
    const input = parseRequestPart(LaunchRunRequestSchema, request.body);
    const run = await runsService.launchRun(input, buildAuditContext(request));
    response.status(HTTP_STATUS.CREATED).json(run);
  });

  router.get('/:id', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await runsService.getRun(id));
  });

  router.get('/:id/events', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const query = parseRequestPart(RunEventListQuerySchema, request.query);
    response.json(await runsService.listRunEvents(id, query));
  });

  router.get('/:id/stream', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    // Answers 404 as JSON before the stream starts.
    await runsService.getRun(id);
    await streamRunEvents(id, request, response, { runsService, logger });
  });

  router.post('/:id/cancel', requireOperator, async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await runsService.cancelRun(id, buildAuditContext(request)));
  });

  router.get('/:id/workspace', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await runsService.listWorkspaceFiles(id));
  });

  router.get('/:id/workspace/file', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    const { path } = parseRequestPart(WorkspaceFileQuerySchema, request.query);
    const { stream, sizeBytes } = await runsService.openWorkspaceFile(id, path);
    response.writeHead(HTTP_STATUS.OK, {
      // Always a download, never rendered: the content was written by an agent.
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(sizeBytes),
      'Content-Disposition': buildAttachmentDisposition(path),
    });
    stream.on('error', (error) => {
      logger.error({ err: error, runId: id }, 'workspace file download failed');
      response.destroy();
    });
    stream.pipe(response);
  });

  return router;
}

/**
 * Creates the router for per-agent usage totals. Mount at `/api/agents`
 * behind `requireAuthentication`.
 *
 * @param runsService - Run operations.
 * @returns A router serving `GET /:id/usage`.
 */
export function createAgentUsageRouter(runsService: RunsService): Router {
  const router = Router();
  router.get('/:id/usage', async (request, response) => {
    const { id } = parseRequestPart(IdParamsSchema, request.params);
    response.json(await runsService.getAgentUsage(id));
  });
  return router;
}
