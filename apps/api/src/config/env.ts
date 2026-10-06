/**
 * Loads and validates environment configuration.
 *
 * Configuration is parsed once at startup. Invalid or missing values stop the
 * process immediately with a message naming every problem, instead of
 * failing later on first use. Values are never echoed in error messages
 * because several of them contain credentials.
 */
import { z } from 'zod';

/** Runtime environments the API recognises. */
export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

/** Log levels accepted by pino. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const DEFAULT_API_PORT = 3000;
const MAX_TCP_PORT = 65_535;
const POSTGRES_URL_PROTOCOL = /^postgres(ql)?$/;

/** The process environment, or a stand-in object in tests. */
export type EnvironmentVariables = Record<string, string | undefined>;

/** Runtime environment name. */
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/** A pino log level. */
export type LogLevel = (typeof LOG_LEVELS)[number];

const PostgresUrlSchema = z.url({
  protocol: POSTGRES_URL_PROTOCOL,
  error: 'Must be a postgres:// connection URL',
});

const ApiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVIRONMENTS).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(MAX_TCP_PORT).default(DEFAULT_API_PORT),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: PostgresUrlSchema,
});

const MigrationEnvironmentSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVIRONMENTS).default('development'),
  MIGRATION_DATABASE_URL: PostgresUrlSchema,
});

/** Settings the API server needs at runtime. */
export interface ApiConfig {
  nodeEnvironment: NodeEnvironment;
  apiPort: number;
  logLevel: LogLevel;
  /** Connection URL for the restricted `agent_dashboard_app` role. */
  databaseUrl: string;
}

/** Settings the migration and seed CLI needs. */
export interface MigrationConfig {
  nodeEnvironment: NodeEnvironment;
  /** Connection URL for the `agent_dashboard_owner` role. */
  migrationDatabaseUrl: string;
}

/**
 * Thrown when environment configuration is missing or invalid.
 *
 * The message lists each offending variable and what is wrong with it, but
 * never the value itself.
 */
export class ConfigError extends Error {
  /** One human-readable line per invalid variable. */
  readonly problems: string[];

  /**
   * @param problems - One human-readable line per invalid variable.
   */
  constructor(problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Converts a Zod error into one line per problem, naming the variable but not
 * its value.
 */
function describeEnvironmentProblems(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

/**
 * Parses environment variables against a schema, throwing a `ConfigError` on failure.
 */
function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  environmentVariables: EnvironmentVariables,
): z.output<Schema> {
  const result = schema.safeParse(environmentVariables);
  if (!result.success) {
    throw new ConfigError(describeEnvironmentProblems(result.error));
  }
  return result.data;
}

/**
 * Builds the API server configuration from environment variables.
 *
 * @param environmentVariables - Usually `process.env`; injectable for tests.
 * @returns The validated configuration with defaults applied.
 * @throws {ConfigError} If a required variable is missing or any value is invalid.
 */
export function loadApiConfig(environmentVariables: EnvironmentVariables): ApiConfig {
  const environment = parseEnvironment(ApiEnvironmentSchema, environmentVariables);
  return {
    nodeEnvironment: environment.NODE_ENV,
    apiPort: environment.API_PORT,
    logLevel: environment.LOG_LEVEL,
    databaseUrl: environment.DATABASE_URL,
  };
}

/**
 * Builds the migration and seed configuration from environment variables.
 *
 * @param environmentVariables - Usually `process.env`; injectable for tests.
 * @returns The validated configuration with defaults applied.
 * @throws {ConfigError} If `MIGRATION_DATABASE_URL` is missing or any value is invalid.
 */
export function loadMigrationConfig(environmentVariables: EnvironmentVariables): MigrationConfig {
  const environment = parseEnvironment(MigrationEnvironmentSchema, environmentVariables);
  return {
    nodeEnvironment: environment.NODE_ENV,
    migrationDatabaseUrl: environment.MIGRATION_DATABASE_URL,
  };
}
