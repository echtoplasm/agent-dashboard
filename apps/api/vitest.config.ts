/**
 * Vitest configuration for the API.
 *
 * Two projects keep fast unit tests separate from integration tests that need
 * the Postgres test database. Integration tests share one database, so their
 * files run one at a time.
 */
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const SOURCE_CONDITIONS = ['source', ...defaultServerConditions];
const INTEGRATION_TEST_PATTERN = 'src/**/*.integration.test.ts';

export default defineConfig({
  resolve: { conditions: SOURCE_CONDITIONS },
  ssr: { resolve: { conditions: SOURCE_CONDITIONS } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [INTEGRATION_TEST_PATTERN],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [INTEGRATION_TEST_PATTERN],
          setupFiles: ['test/integration-setup.ts'],
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
