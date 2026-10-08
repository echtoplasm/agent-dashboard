/**
 * Process entry point: loads config, connects to the database, recovers runs
 * interrupted by a previous process, starts the HTTP server, and shuts
 * everything down cleanly on SIGINT or SIGTERM.
 */
import type { Server } from 'node:http';
import type { Knex } from 'knex';
import { createApp } from './app.js';
import { ConfigError, loadApiConfig } from './config/env.js';
import type { ApiConfig } from './config/env.js';
import { createDataAccess } from './db/data-access.js';
import { buildKnexConnectionConfig, createDatabaseClient } from './db/knex.js';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import { createRunEventBus } from './modules/runs/run-event-bus.js';
import { createRunManager } from './modules/runs/run-manager.js';
import type { RunManager } from './modules/runs/run-manager.js';
import { createDockerSandboxProvider } from './sandbox/docker-sandbox-provider.js';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
const FAILURE_EXIT_CODE = 1;
const ROOT_USER_ID = 0;

/** Sandbox limits that apply to every run regardless of profile. */
const SANDBOX_PIDS_LIMIT = 512;
const SANDBOX_TMP_SIZE_MB = 512;

/**
 * Open SSE streams never finish on their own, so after this long the
 * remaining connections are closed instead of waited for.
 */
const CONNECTION_DRAIN_TIMEOUT_MS = 5_000;

/**
 * Returns the `uid:gid` sandboxes run as: the API's own account, so files
 * written to workspaces stay owned by it.
 *
 * @throws {ConfigError} If the API runs as root, which would make every sandbox root.
 */
function readSandboxUser(): string {
  const userId = process.getuid?.() ?? ROOT_USER_ID;
  const groupId = process.getgid?.() ?? ROOT_USER_ID;
  if (userId === ROOT_USER_ID) {
    throw new ConfigError(['The API must not run as root: sandboxes run as the API user']);
  }
  return `${userId}:${groupId}`;
}

function createRunManagerFromConfig(
  apiConfig: ApiConfig,
  database: Knex,
  logger: Logger,
): RunManager {
  return createRunManager({
    dataAccess: createDataAccess(database),
    eventBus: createRunEventBus(),
    logger,
    runDataDirectory: apiConfig.runDataDirectory,
    sandboxProvider: createDockerSandboxProvider({
      dockerCommand: apiConfig.sandbox.dockerCommand,
      hostEnvironment: process.env,
      networkName: apiConfig.sandbox.networkName,
      egressProxyUrl: apiConfig.sandbox.egressProxyUrl,
      user: readSandboxUser(),
      pidsLimit: SANDBOX_PIDS_LIMIT,
      tmpSizeMb: SANDBOX_TMP_SIZE_MB,
    }),
  });
}

/**
 * Stops active runs, stops accepting connections, waits briefly for
 * in-flight requests, then closes the database pool.
 */
async function shutDown(
  server: Server,
  database: Knex,
  runManager: RunManager,
  logger: Logger,
): Promise<void> {
  await runManager.stopAllRuns();
  const drainTimer = setTimeout(() => {
    server.closeAllConnections();
  }, CONNECTION_DRAIN_TIMEOUT_MS);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    server.closeIdleConnections();
  });
  clearTimeout(drainTimer);
  await database.destroy();
  logger.info('shutdown complete');
}

async function startServer(): Promise<void> {
  const apiConfig = loadApiConfig(process.env);
  const logger = createLogger(apiConfig.logLevel);
  const database = createDatabaseClient(buildKnexConnectionConfig(apiConfig.databaseUrl));
  const runManager = createRunManagerFromConfig(apiConfig, database, logger);
  await runManager.recoverInterruptedRuns();

  const app = createApp({
    database,
    logger,
    runManager,
    settings: {
      appOrigins: apiConfig.appOrigins,
      trustProxyHops: apiConfig.trustProxyHops,
      isSecureCookie: apiConfig.isSecureCookie,
      skillStorageDirectory: apiConfig.skillStorageDirectory,
      runs: {
        maxConcurrentRuns: apiConfig.maxConcurrentRuns,
        providerApiKeys: apiConfig.providerApiKeys,
      },
    },
  });

  const server = app.listen(apiConfig.apiPort, () => {
    logger.info(
      { port: apiConfig.apiPort, nodeEnvironment: apiConfig.nodeEnvironment },
      'api listening',
    );
  });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutting down');
      shutDown(server, database, runManager, logger).catch((error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exitCode = FAILURE_EXIT_CODE;
      });
    });
  }
}

startServer().catch((error: unknown) => {
  // The logger may not exist yet (bad LOG_LEVEL), so write startup errors directly.
  const message = error instanceof ConfigError ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
});
