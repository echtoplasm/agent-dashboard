/**
 * HTTP routes for the health check.
 *
 * `GET /api/health` is the only endpoint that does not require
 * authentication, so load balancers and uptime monitors can call it. It
 * reveals nothing beyond up/down status.
 */
import { Router } from 'express';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import type { HealthService } from './health.service.js';

/**
 * Creates the health router.
 *
 * Responds 200 when healthy and 503 when degraded, so monitors can rely on
 * the status code alone.
 *
 * @param healthService - Produces the health report.
 * @returns A router to mount at `/api/health`.
 */
export function createHealthRouter(healthService: HealthService): Router {
  const router = Router();

  router.get('/', async (_request, response) => {
    const healthReport = await healthService.getHealthReport();
    const statusCode =
      healthReport.status === 'ok' ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;
    response.status(statusCode).json(healthReport);
  });

  return router;
}
