/**
 * Vitest setup for integration tests.
 *
 * - Loads the repo-root `.env` when present. CI provides the variables
 *   directly, so a missing file is not an error.
 * - Registers the `tsx` loader. Knex loads migration and seed files with a
 *   native `import()`, which bypasses Vitest's own TypeScript transform.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

const ROOT_ENV_FILE_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

if (existsSync(ROOT_ENV_FILE_PATH)) {
  process.loadEnvFile(ROOT_ENV_FILE_PATH);
}

register();
