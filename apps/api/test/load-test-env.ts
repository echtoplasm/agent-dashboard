/**
 * Vitest setup for integration tests: loads the repo-root `.env` when present.
 *
 * CI provides the variables directly, so a missing file is not an error.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_ENV_FILE_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

if (existsSync(ROOT_ENV_FILE_PATH)) {
  process.loadEnvFile(ROOT_ENV_FILE_PATH);
}
