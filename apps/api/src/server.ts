/**
 * Process entry point: loads config, connects to the database, starts the
 * HTTP server and shuts everything down cleanly on SIGINT or SIGTERM.
 */
import type { Server } from 'node:http';
import type { Knex } from 'knex';
import { createApp } from './app.js';
import { ConfigError, loadApiConfig } from './config/env.js';
import { buildKnexConnectionConfig, createDatabaseClient } from './db/knex.js';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
const FAILURE_EXIT_CODE = 1;

/**
 * Stops accepting connections, waits for in-flight requests, then closes the
 * database pool.
 */
async function shutDown(server: Server, database: Knex, logger: Logger): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  await database.destroy();
  logger.info('shutdown complete');
}

function startServer(): void {
  const apiConfig = loadApiConfig(process.env);
  const logger = createLogger(apiConfig.logLevel);
  const database = createDatabaseClient(buildKnexConnectionConfig(apiConfig.databaseUrl));
  const app = createApp({ database, logger });

  const server = app.listen(apiConfig.apiPort, () => {
    logger.info(
      { port: apiConfig.apiPort, nodeEnvironment: apiConfig.nodeEnvironment },
      'api listening',
    );
  });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutting down');
      shutDown(server, database, logger).catch((error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exitCode = FAILURE_EXIT_CODE;
      });
    });
  }
}

try {
  startServer();
} catch (error) {
  // The logger may not exist yet (bad LOG_LEVEL), so write config errors directly.
  const message = error instanceof ConfigError ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
}
