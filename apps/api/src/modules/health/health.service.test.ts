/**
 * Unit tests for the health service, using a stub repository and fixed clock.
 */
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../logger.js';
import type { HealthRepository } from './health.repository.js';
import { createHealthService } from './health.service.js';

const FIXED_TIME = new Date('2026-10-06T12:00:00.000Z');
const silentLogger = createLogger('silent');

function createServiceWithRepository(healthRepository: HealthRepository) {
  return createHealthService({
    healthRepository,
    logger: silentLogger,
    getUptimeSeconds: () => 42.9,
    getCurrentTime: () => FIXED_TIME,
  });
}

describe('createHealthService', () => {
  it('reports ok when the database answers', async () => {
    const healthService = createServiceWithRepository({ pingDatabase: () => Promise.resolve() });

    expect(await healthService.getHealthReport()).toEqual({
      status: 'ok',
      checks: { database: 'up' },
      uptimeSeconds: 42,
      checkedAt: '2026-10-06T12:00:00.000Z',
    });
  });

  it('reports degraded without leaking the error when the database is down', async () => {
    const healthService = createServiceWithRepository({
      pingDatabase: () => Promise.reject(new Error('password authentication failed for user x')),
    });

    const healthReport = await healthService.getHealthReport();

    expect(healthReport.status).toBe('degraded');
    expect(healthReport.checks.database).toBe('down');
    expect(JSON.stringify(healthReport)).not.toContain('password');
  });
});
