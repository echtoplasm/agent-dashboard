/**
 * Tests the Docker sandbox provider against a real Docker daemon.
 *
 * Skipped unless `RUN_DOCKER_TESTS=1`, because CI has no sandbox image or
 * egress network. Locally, build the image (`npm run sandbox:build`) and
 * start the egress proxy (`docker compose up -d egress-proxy`) first.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDockerSandboxProvider } from './docker-sandbox-provider.js';
import type { RunningSandbox, SandboxSpec } from './sandbox-provider.js';

const isDockerTestEnabled = process.env.RUN_DOCKER_TESTS === '1';
const DOCKER_TEST_TIMEOUT_MS = 60_000;

const provider = createDockerSandboxProvider({
  dockerCommand: 'docker',
  hostEnvironment: process.env,
  networkName: 'agent-dashboard-sandbox',
  egressProxyUrl: 'http://egress-proxy:3128',
  user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
  pidsLimit: 128,
  tmpSizeMb: 64,
});

async function collectLines(lines: AsyncIterable<string>): Promise<string[]> {
  const collected: string[] = [];
  for await (const line of lines) {
    collected.push(line);
  }
  return collected;
}

async function runToCompletion(sandbox: RunningSandbox) {
  const [stdout, stderr, exit] = await Promise.all([
    collectLines(sandbox.stdoutLines),
    collectLines(sandbox.stderrLines),
    sandbox.exited,
  ]);
  return { stdout, stderr, exitCode: exit.exitCode };
}

describe.skipIf(!isDockerTestEnabled)('Docker sandbox provider', () => {
  let rootDirectory = '';
  let skillDirectory = '';

  beforeAll(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'sandbox-test-'));
    skillDirectory = join(rootDirectory, 'skill');
    await mkdir(skillDirectory);
    await writeFile(join(skillDirectory, 'SKILL.md'), 'skill body');
  });

  afterAll(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  async function buildSpec(
    command: string[],
    overrides: Partial<SandboxSpec> = {},
  ): Promise<SandboxSpec> {
    const runId = randomUUID();
    const workspaceDirectory = join(rootDirectory, runId, 'workspace');
    const homeDirectory = join(rootDirectory, runId, 'home');
    await mkdir(workspaceDirectory, { recursive: true });
    await mkdir(join(homeDirectory, 'skills', 'greeter'), { recursive: true });
    return {
      runId,
      containerImage: 'agent-dashboard/sandbox:latest',
      command,
      environment: {},
      secretEnvironment: { TEST_SECRET: 'top-secret-value' },
      stdin: 'hello from stdin\n',
      cpuLimitMillicores: 500,
      memoryLimitMb: 256,
      workspaceDirectory,
      homeDirectory,
      readOnlyMounts: [
        { hostPath: skillDirectory, containerPath: '/home/agent/skills/greeter', isReadOnly: true },
      ],
      ...overrides,
    };
  }

  it(
    'streams stdout and stderr, passes stdin and secrets, and reports the exit code',
    async () => {
      const spec = await buildSpec([
        'bash',
        '-c',
        'read line; echo "got: $line"; echo "secret: $TEST_SECRET"; echo oops >&2; echo out > /workspace/result.txt; exit 3',
      ]);
      const result = await runToCompletion(await provider.startSandbox(spec));

      expect(result.stdout).toEqual(['got: hello from stdin', 'secret: top-secret-value']);
      expect(result.stderr).toEqual(['oops']);
      expect(result.exitCode).toBe(3);
      expect(await readFile(join(spec.workspaceDirectory, 'result.txt'), 'utf8')).toBe('out\n');
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    'keeps the root filesystem and skills read-only and blocks direct network access',
    async () => {
      const spec = await buildSpec([
        'bash',
        '-c',
        [
          'touch /usr/local/x 2>/dev/null && echo root-writable || echo root-read-only',
          'touch /home/agent/skills/greeter/x 2>/dev/null && echo skill-writable || echo skill-read-only',
          'id -u',
          `node -e "require('https').get('https://1.1.1.1',()=>console.log('net-open')).on('error',e=>console.log('net-'+e.code))"`,
        ].join('; '),
      ]);
      const result = await runToCompletion(await provider.startSandbox(spec));

      expect(result.stdout).toEqual([
        'root-read-only',
        'skill-read-only',
        String(process.getuid?.() ?? 1000),
        'net-ENETUNREACH',
      ]);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    'stops a running sandbox',
    async () => {
      const spec = await buildSpec(['sleep', '300']);
      const sandbox = await provider.startSandbox(spec);
      const resultPromise = runToCompletion(sandbox);
      await sandbox.stop();
      const result = await resultPromise;

      expect(result.exitCode).not.toBe(0);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );
});
