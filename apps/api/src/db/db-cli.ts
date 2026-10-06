/**
 * Command-line entry point for migrations and seeds.
 *
 * Wraps Knex's programmatic API instead of the stock `knex` CLI so TypeScript
 * migrations run through the same `tsx` loader and validated config as the
 * rest of the app.
 *
 * @example
 * ```sh
 * npm run db:migrate
 * npm run db:rollback -- --all
 * npm run db:make-migration -- create_widgets
 * npm run db:seed
 * ```
 */
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import { buildMigrationKnexConfig } from '../../knexfile.js';
import { loadMigrationConfig } from '../config/env.js';
import { createDatabaseClient } from './knex.js';

const MIGRATION_STUB_PATH = fileURLToPath(new URL('./migration.stub', import.meta.url));
const ROLLBACK_ALL_FLAG = '--all';
const FAILURE_EXIT_CODE = 1;

const DB_COMMANDS = ['migrate:latest', 'migrate:rollback', 'migrate:make', 'seed:run'] as const;
type DbCommand = (typeof DB_COMMANDS)[number];

/** Thrown when the CLI is called with an unknown command or missing argument. */
class DbCliUsageError extends Error {
  constructor(message: string) {
    super(`${message}\nUsage: db-cli <${DB_COMMANDS.join('|')}> [args]`);
    this.name = 'DbCliUsageError';
  }
}

function isDbCommand(value: string | undefined): value is DbCommand {
  return (DB_COMMANDS as readonly (string | undefined)[]).includes(value);
}

function printLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function migrateToLatest(database: Knex): Promise<void> {
  const [batchNumber, appliedFiles] = (await database.migrate.latest()) as [number, string[]];
  printLine(
    appliedFiles.length === 0
      ? 'Already up to date.'
      : `Batch ${batchNumber} applied:\n  ${appliedFiles.join('\n  ')}`,
  );
}

async function rollbackMigrations(database: Knex, isRollingBackAll: boolean): Promise<void> {
  const [batchNumber, revertedFiles] = (await database.migrate.rollback(
    undefined,
    isRollingBackAll,
  )) as [number, string[]];
  printLine(
    revertedFiles.length === 0
      ? 'Nothing to roll back.'
      : `Batch ${batchNumber} rolled back:\n  ${revertedFiles.join('\n  ')}`,
  );
}

async function makeMigration(database: Knex, migrationName: string | undefined): Promise<void> {
  if (migrationName === undefined) {
    throw new DbCliUsageError('migrate:make requires a migration name.');
  }
  const createdPath = await database.migrate.make(migrationName, { stub: MIGRATION_STUB_PATH });
  printLine(`Created ${createdPath}`);
}

async function runSeeds(database: Knex): Promise<void> {
  const [seedFiles] = await database.seed.run();
  printLine(`Ran ${seedFiles.length} seed file(s):\n  ${seedFiles.join('\n  ')}`);
}

async function runDbCommand(database: Knex, command: DbCommand, args: string[]): Promise<void> {
  switch (command) {
    case 'migrate:latest':
      return migrateToLatest(database);
    case 'migrate:rollback':
      return rollbackMigrations(database, args.includes(ROLLBACK_ALL_FLAG));
    case 'migrate:make':
      return makeMigration(database, args[0]);
    case 'seed:run':
      return runSeeds(database);
  }
}

/**
 * Parses CLI arguments, runs the requested command and closes the pool.
 *
 * @param argv - Arguments after the script path.
 */
async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (!isDbCommand(command)) {
    throw new DbCliUsageError(`Unknown command: ${command ?? '(none)'}`);
  }

  const migrationConfig = loadMigrationConfig(process.env);
  const database = createDatabaseClient(buildMigrationKnexConfig(migrationConfig));

  try {
    await runDbCommand(database, command, args);
  } finally {
    await database.destroy();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
});
