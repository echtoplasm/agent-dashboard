/**
 * Tests for the `docker run` command line. These pin down every isolation
 * flag, so loosening one is a visible, reviewed change.
 */
import { describe, expect, it } from 'vitest';
import { UnsafeMountPathError, buildDockerRunArguments } from './docker-run-arguments.js';
import type { DockerSandboxSettings } from './docker-run-arguments.js';
import type { SandboxSpec } from './sandbox-provider.js';

const RUN_ID = '01a11c8e-f46f-76e2-bfd7-a18c9506df99';

const SETTINGS: DockerSandboxSettings = {
  networkName: 'agent-dashboard-sandbox',
  egressProxyUrl: 'http://egress-proxy:3128',
  user: '1000:1000',
  pidsLimit: 512,
  tmpSizeMb: 256,
};

function buildSpec(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    runId: RUN_ID,
    containerImage: 'agent-dashboard/sandbox:latest',
    command: ['claude', '--print'],
    environment: { EXAMPLE: 'value' },
    secretEnvironment: { ANTHROPIC_API_KEY: 'sk-ant-secret' },
    stdin: 'prompt',
    cpuLimitMillicores: 1_500,
    memoryLimitMb: 1_024,
    workspaceDirectory: `/srv/runs/${RUN_ID}/workspace`,
    homeDirectory: `/srv/runs/${RUN_ID}/home`,
    readOnlyMounts: [
      {
        hostPath: '/srv/skills/skill-id/1.0.0',
        containerPath: '/home/agent/.claude/skills/greeter',
        isReadOnly: true,
      },
    ],
    ...overrides,
  };
}

/** Returns the value following a flag, e.g. `--cpus 1.5` → `1.5`. */
function readFlagValues(args: string[], flag: string): string[] {
  return args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ''] : []));
}

describe('buildDockerRunArguments', () => {
  const args = buildDockerRunArguments(buildSpec(), SETTINGS);

  it('applies every isolation flag', () => {
    expect(args).toEqual(
      expect.arrayContaining(['--read-only', '--init', '--rm', '--interactive']),
    );
    expect(readFlagValues(args, '--cap-drop')).toEqual(['ALL']);
    expect(readFlagValues(args, '--security-opt')).toEqual(['no-new-privileges']);
    expect(readFlagValues(args, '--user')).toEqual(['1000:1000']);
    expect(readFlagValues(args, '--pids-limit')).toEqual(['512']);
    expect(readFlagValues(args, '--network')).toEqual(['agent-dashboard-sandbox']);
  });

  it('applies CPU and memory limits with no extra swap', () => {
    expect(readFlagValues(args, '--cpus')).toEqual(['1.5']);
    expect(readFlagValues(args, '--memory')).toEqual(['1024m']);
    expect(readFlagValues(args, '--memory-swap')).toEqual(['1024m']);
  });

  it('mounts workspace and HOME writable and skills read-only', () => {
    expect(readFlagValues(args, '--mount')).toEqual([
      `type=bind,source=/srv/runs/${RUN_ID}/home,target=/home/agent`,
      `type=bind,source=/srv/runs/${RUN_ID}/workspace,target=/workspace`,
      'type=bind,source=/srv/skills/skill-id/1.0.0,target=/home/agent/.claude/skills/greeter,readonly',
    ]);
  });

  it('passes secrets by name only, never their values', () => {
    expect(readFlagValues(args, '--env')).toContain('ANTHROPIC_API_KEY');
    expect(args.join(' ')).not.toContain('sk-ant-secret');
  });

  it('routes traffic through the egress proxy and passes plain variables with values', () => {
    expect(readFlagValues(args, '--env')).toEqual(
      expect.arrayContaining(['HTTPS_PROXY=http://egress-proxy:3128', 'EXAMPLE=value']),
    );
  });

  it('labels the container and ends with the image and command', () => {
    expect(readFlagValues(args, '--label')).toEqual([
      'agent-dashboard.managed=true',
      `agent-dashboard.run-id=${RUN_ID}`,
    ]);
    expect(args.slice(-3)).toEqual(['agent-dashboard/sandbox:latest', 'claude', '--print']);
  });

  it('refuses a mount path that could inject mount options', () => {
    const spec = buildSpec({ workspaceDirectory: '/srv/runs/x,target=/etc' });

    expect(() => buildDockerRunArguments(spec, SETTINGS)).toThrow(UnsafeMountPathError);
  });
});
