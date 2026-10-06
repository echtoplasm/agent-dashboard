/**
 * Knex configuration for migrations and seeds.
 *
 * Always connects as the owner role (`MIGRATION_DATABASE_URL`), never as the
 * runtime app role. Migrations and seeds are TypeScript and are loaded through
 * `tsx`, which the `db:*` npm scripts use.
 */
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import { loadMigrationConfig } from './src/config/env.js';
import type { MigrationConfig } from './src/config/env.js';
import { buildKnexConnectionConfig } from './src/db/knex.js';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('./src/db/migrations', import.meta.url));
const BASE_SEEDS_DIRECTORY = fileURLToPath(new URL('./src/db/seeds/base', import.meta.url));
const DEVELOPMENT_SEEDS_DIRECTORY = fileURLToPath(
  new URL('./src/db/seeds/development', import.meta.url),
);
const TYPESCRIPT_EXTENSION = '.ts';

/**
 * Builds the Knex configuration used by the migration and seed CLI.
 *
 * Base seeds (providers, default sandbox profile) run everywhere. Sample data
 * seeds run only in development.
 *
 * @param migrationConfig - Validated migration settings.
 * @returns Knex configuration with migration and seed directories.
 */
export function buildMigrationKnexConfig(migrationConfig: MigrationConfig): Knex.Config {
  const isDevelopment = migrationConfig.nodeEnvironment === 'development';
  const seedDirectories = isDevelopment
    ? [BASE_SEEDS_DIRECTORY, DEVELOPMENT_SEEDS_DIRECTORY]
    : [BASE_SEEDS_DIRECTORY];

  return {
    ...buildKnexConnectionConfig(migrationConfig.migrationDatabaseUrl),
    migrations: {
      directory: MIGRATIONS_DIRECTORY,
      loadExtensions: [TYPESCRIPT_EXTENSION],
      extension: 'ts',
    },
    seeds: {
      directory: seedDirectories,
      // Run every base seed before any development seed, rather than sorting
      // all files together by name.
      sortDirsSeparately: true,
      loadExtensions: [TYPESCRIPT_EXTENSION],
      extension: 'ts',
    },
  };
}

/**
 * Default export for the stock `knex` CLI, which accepts a config factory.
 *
 * @returns Knex configuration built from `process.env`.
 * @throws {ConfigError} If `MIGRATION_DATABASE_URL` is missing or invalid.
 */
export default function createKnexfileConfig(): Knex.Config {
  return buildMigrationKnexConfig(loadMigrationConfig(process.env));
}
