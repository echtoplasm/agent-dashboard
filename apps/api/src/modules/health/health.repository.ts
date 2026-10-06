/**
 * Database access for the health check.
 */
import type { Knex } from 'knex';

/** How long the database ping may take before the database counts as down. */
const DATABASE_PING_TIMEOUT_MS = 2_000;

/** Data access needed by the health service. */
export interface HealthRepository {
  /**
   * Runs a trivial query to confirm the database accepts connections.
   *
   * @throws If the database is unreachable or does not answer in time.
   */
  pingDatabase(): Promise<void>;
}

/**
 * Creates the health repository.
 *
 * @param database - Knex client connected as the app role.
 * @returns The repository.
 */
export function createHealthRepository(database: Knex): HealthRepository {
  return {
    async pingDatabase(): Promise<void> {
      await database.raw('SELECT 1').timeout(DATABASE_PING_TIMEOUT_MS, { cancel: true });
    },
  };
}
