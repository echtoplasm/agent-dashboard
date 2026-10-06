/**
 * Builds the service health report.
 *
 * The report says whether the API can reach its dependencies. It never
 * includes error details, because the endpoint is unauthenticated.
 */
import type { HealthResponse } from '@agent-dashboard/shared';
import type { Logger } from '../../logger.js';
import type { HealthRepository } from './health.repository.js';

/** Dependencies of the health service, injectable for tests. */
export interface HealthServiceDependencies {
  healthRepository: HealthRepository;
  logger: Logger;
  /** Seconds since the process started. Defaults to `process.uptime`. */
  getUptimeSeconds?: () => number;
  /** Current time. Defaults to `new Date()`. */
  getCurrentTime?: () => Date;
}

/** Produces health reports. */
export interface HealthService {
  /**
   * Checks each dependency and reports overall status.
   *
   * @returns `ok` when every dependency is up, otherwise `degraded`.
   */
  getHealthReport(): Promise<HealthResponse>;
}

/**
 * Creates the health service.
 *
 * @param dependencies - Repository, logger and optional clock overrides.
 * @returns The service.
 */
export function createHealthService(dependencies: HealthServiceDependencies): HealthService {
  const {
    healthRepository,
    logger,
    getUptimeSeconds = () => process.uptime(),
    getCurrentTime = () => new Date(),
  } = dependencies;

  async function isDatabaseReachable(): Promise<boolean> {
    try {
      await healthRepository.pingDatabase();
      return true;
    } catch (error) {
      logger.warn({ err: error }, 'health check: database unreachable');
      return false;
    }
  }

  return {
    async getHealthReport(): Promise<HealthResponse> {
      const isDatabaseUp = await isDatabaseReachable();
      return {
        status: isDatabaseUp ? 'ok' : 'degraded',
        checks: { database: isDatabaseUp ? 'up' : 'down' },
        uptimeSeconds: Math.floor(getUptimeSeconds()),
        checkedAt: getCurrentTime().toISOString(),
      };
    },
  };
}
