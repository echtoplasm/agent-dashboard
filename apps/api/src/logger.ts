/**
 * Structured application logger.
 *
 * Built on pino with redaction configured centrally, so credentials and
 * session tokens are masked no matter which module logs them.
 */
import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import type { LogLevel } from './config/env.js';

export type { Logger } from 'pino';

/**
 * Paths whose values are replaced with `[REDACTED]` in every log line.
 *
 * Covers request headers that carry credentials and any field named like a
 * secret, one level deep, wherever it appears.
 */
export const REDACTED_LOG_PATHS = [
  'request.headers.authorization',
  'request.headers.cookie',
  'response.headers["set-cookie"]',
  'password',
  'passwordHash',
  'apiKey',
  'token',
  'databaseUrl',
  'migrationDatabaseUrl',
  '*.password',
  '*.passwordHash',
  '*.apiKey',
  '*.token',
  '*.databaseUrl',
  '*.migrationDatabaseUrl',
];

const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Creates the root logger for the process.
 *
 * @param logLevel - Minimum level to emit; `silent` disables logging (useful in tests).
 * @param destination - Where to write log lines. Defaults to stdout.
 * @returns A pino logger with secret redaction enabled.
 */
export function createLogger(logLevel: LogLevel, destination?: DestinationStream): Logger {
  const options = {
    level: logLevel,
    redact: { paths: REDACTED_LOG_PATHS, censor: REDACTION_PLACEHOLDER },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
