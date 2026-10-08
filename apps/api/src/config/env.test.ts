/**
 * Tests for environment configuration loading.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadApiConfig, loadMigrationConfig } from './env.js';

const VALID_DATABASE_URL =
  'postgres://agent_dashboard_app:s3cret-value@127.0.0.1:5434/agent_dashboard';

describe('loadApiConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    const apiConfig = loadApiConfig({ DATABASE_URL: VALID_DATABASE_URL });

    expect(apiConfig).toEqual({
      nodeEnvironment: 'development',
      apiPort: 3000,
      logLevel: 'info',
      databaseUrl: VALID_DATABASE_URL,
      appOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
      trustProxyHops: 0,
      skillStorageDirectory: expect.stringMatching(/\/data\/skills$/) as string,
      isSecureCookie: false,
      runDataDirectory: expect.stringMatching(/\/data\/runs$/) as string,
      maxConcurrentRuns: 2,
      sandbox: {
        networkName: 'agent-dashboard-sandbox',
        egressProxyUrl: 'http://egress-proxy:3128',
        dockerCommand: 'docker',
      },
      providerApiKeys: { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined },
    });
  });

  it('reads provider API keys and treats an empty key as unset', () => {
    const apiConfig = loadApiConfig({
      DATABASE_URL: VALID_DATABASE_URL,
      ANTHROPIC_API_KEY: 'sk-ant-example',
      OPENAI_API_KEY: '',
    });

    expect(apiConfig.providerApiKeys).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-example',
      OPENAI_API_KEY: undefined,
    });
  });

  it('bounds MAX_CONCURRENT_RUNS', () => {
    expect(() =>
      loadApiConfig({ DATABASE_URL: VALID_DATABASE_URL, MAX_CONCURRENT_RUNS: '0' }),
    ).toThrow(/MAX_CONCURRENT_RUNS/);
  });

  it('rejects a sandbox network name that could be read as a flag', () => {
    expect(() =>
      loadApiConfig({ DATABASE_URL: VALID_DATABASE_URL, SANDBOX_NETWORK: '--privileged' }),
    ).toThrow(/SANDBOX_NETWORK/);
  });

  it('parses a comma-separated list of app origins', () => {
    const apiConfig = loadApiConfig({
      DATABASE_URL: VALID_DATABASE_URL,
      APP_ORIGINS: 'https://dashboard.lab.example, http://10.0.0.5:8080',
    });

    expect(apiConfig.appOrigins).toEqual(['https://dashboard.lab.example', 'http://10.0.0.5:8080']);
  });

  it('rejects an app origin that includes a path', () => {
    expect(() =>
      loadApiConfig({ DATABASE_URL: VALID_DATABASE_URL, APP_ORIGINS: 'https://x.example/app' }),
    ).toThrow(/APP_ORIGINS/);
  });

  it('requires APP_ORIGINS in production and marks cookies secure', () => {
    expect(() =>
      loadApiConfig({ DATABASE_URL: VALID_DATABASE_URL, NODE_ENV: 'production' }),
    ).toThrow(/APP_ORIGINS/);

    const apiConfig = loadApiConfig({
      DATABASE_URL: VALID_DATABASE_URL,
      NODE_ENV: 'production',
      APP_ORIGINS: 'https://dashboard.lab.example',
    });
    expect(apiConfig.isSecureCookie).toBe(true);
  });

  it('requires an absolute skill storage directory', () => {
    expect(() =>
      loadApiConfig({ DATABASE_URL: VALID_DATABASE_URL, SKILL_STORAGE_DIR: 'data/skills' }),
    ).toThrow(/SKILL_STORAGE_DIR/);
  });

  it('coerces API_PORT from a string', () => {
    const apiConfig = loadApiConfig({ DATABASE_URL: VALID_DATABASE_URL, API_PORT: '8080' });

    expect(apiConfig.apiPort).toBe(8080);
  });

  it('throws a ConfigError naming the missing variable', () => {
    expect(() => loadApiConfig({})).toThrow(ConfigError);
    expect(() => loadApiConfig({})).toThrow(/DATABASE_URL/);
  });

  it('reports every invalid variable at once', () => {
    try {
      loadApiConfig({ DATABASE_URL: 'not a url', API_PORT: '70000', LOG_LEVEL: 'loud' });
      expect.unreachable('loadApiConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toHaveLength(3);
    }
  });

  it('rejects non-postgres connection URLs', () => {
    expect(() => loadApiConfig({ DATABASE_URL: 'mysql://user@localhost/db' })).toThrow(ConfigError);
  });

  it('never includes variable values in the error message', () => {
    const secretPassword = 'super-secret-password';

    try {
      loadApiConfig({ DATABASE_URL: `mysql://user:${secretPassword}@localhost/db` });
      expect.unreachable('loadApiConfig should have thrown');
    } catch (error) {
      expect((error as ConfigError).message).not.toContain(secretPassword);
    }
  });
});

describe('loadMigrationConfig', () => {
  it('reads MIGRATION_DATABASE_URL', () => {
    const migrationConfig = loadMigrationConfig({
      MIGRATION_DATABASE_URL: VALID_DATABASE_URL,
      NODE_ENV: 'test',
    });

    expect(migrationConfig).toEqual({
      nodeEnvironment: 'test',
      migrationDatabaseUrl: VALID_DATABASE_URL,
    });
  });

  it('does not accept DATABASE_URL in place of MIGRATION_DATABASE_URL', () => {
    expect(() => loadMigrationConfig({ DATABASE_URL: VALID_DATABASE_URL })).toThrow(
      /MIGRATION_DATABASE_URL/,
    );
  });
});
