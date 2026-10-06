/**
 * Creates Knex database clients.
 *
 * Every Knex instance in the app is built here so the type parsers and pool
 * settings are applied consistently. Only repositories should use the
 * returned client.
 */
import knex from 'knex';
import type { Knex } from 'knex';
import { registerPostgresTypeParsers } from './postgres-type-parsers.js';

const MIN_POOL_CONNECTIONS = 0;
const MAX_POOL_CONNECTIONS = 10;

/**
 * Builds the base Knex configuration for a Postgres connection URL.
 *
 * Shared by the runtime client and the migration CLI so both talk to the
 * database the same way.
 *
 * @param connectionUrl - A `postgres://` URL including credentials.
 * @returns Knex configuration without migration or seed settings.
 */
export function buildKnexConnectionConfig(connectionUrl: string): Knex.Config {
  return {
    client: 'pg',
    connection: connectionUrl,
    pool: { min: MIN_POOL_CONNECTIONS, max: MAX_POOL_CONNECTIONS },
  };
}

/**
 * Creates a Knex client, registering the custom Postgres type parsers first.
 *
 * Connections are opened lazily, so this does not fail if the database is
 * down. Call `destroy()` on the result during shutdown.
 *
 * @param knexConfig - Usually from `buildKnexConnectionConfig`, optionally
 *   extended with migration and seed settings.
 * @returns A ready-to-use Knex instance.
 *
 * @example
 * ```ts
 * const database = createDatabaseClient(buildKnexConnectionConfig(apiConfig.databaseUrl));
 * ```
 */
export function createDatabaseClient(knexConfig: Knex.Config): Knex {
  registerPostgresTypeParsers();
  return knex(knexConfig);
}
