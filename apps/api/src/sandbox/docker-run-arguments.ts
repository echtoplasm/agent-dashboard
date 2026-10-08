/**
 * Builds the `docker run` command line for a run's sandbox.
 *
 * Kept separate from process handling so every security-relevant flag can be
 * checked in a plain unit test. The hardening is described in D-022 in
 * docs/decisions.md:
 *
 * - runs as the API's own non-root uid, so files in the workspace stay owned
 *   by the API's account
 * - read-only root filesystem, every capability dropped, no privilege
 *   escalation, a process limit, CPU and memory limits, and swap disabled
 * - only the run's workspace and HOME are writable; skills are read-only
 * - attached to the internal sandbox network, whose only exit is the egress
 *   proxy
 * - secrets are passed with `--env NAME` (no value), so Docker reads them from
 *   the CLI process's environment and they never appear in a process list
 */
import type { SandboxMount, SandboxSpec } from './sandbox-provider.js';

/** Labels that mark a container as one of ours. */
export const SANDBOX_LABELS = {
  MANAGED: 'agent-dashboard.managed',
  RUN_ID: 'agent-dashboard.run-id',
} as const;

/** Where the run's workspace and HOME appear inside the sandbox. */
export const SANDBOX_PATHS = {
  WORKSPACE: '/workspace',
  HOME: '/home/agent',
  TMP: '/tmp',
} as const;

const MILLICORES_PER_CPU = 1_000;

/** Prefix for sandbox container names, followed by the run id. */
const CONTAINER_NAME_PREFIX = 'agent-run-';

/** Host-level settings that apply to every sandbox. */
export interface DockerSandboxSettings {
  /** Docker network the sandbox joins; internal, so it has no route out. */
  networkName: string;
  /** URL of the egress proxy, as seen from the sandbox network. */
  egressProxyUrl: string;
  /** `uid:gid` the sandbox runs as. Never root. */
  user: string;
  /** Most processes the sandbox may run at once. */
  pidsLimit: number;
  /** Size of the in-memory `/tmp`, in megabytes. */
  tmpSizeMb: number;
}

/** Thrown when a host path can't be expressed safely as a mount. */
export class UnsafeMountPathError extends Error {
  constructor(path: string) {
    super(`Refusing to mount a path containing a comma or newline: ${path}`);
    this.name = 'UnsafeMountPathError';
  }
}

/**
 * Builds the container name for a run.
 *
 * @param runId - The run's id.
 * @returns e.g. `agent-run-01a11c8e-...`.
 */
export function buildSandboxContainerName(runId: string): string {
  return `${CONTAINER_NAME_PREFIX}${runId}`;
}

/** Formats a millicore limit for `--cpus`, e.g. 1500 → `1.5`. */
function formatCpuLimit(cpuLimitMillicores: number): string {
  return String(cpuLimitMillicores / MILLICORES_PER_CPU);
}

/**
 * Formats one `--mount` value.
 *
 * `--mount` is a comma-separated list, so a comma in a path could inject
 * extra options; such paths are refused.
 *
 * @throws {UnsafeMountPathError} If either path contains a comma or newline.
 */
function formatBindMount(mount: SandboxMount): string {
  for (const path of [mount.hostPath, mount.containerPath]) {
    if (/[,\n]/.test(path)) {
      throw new UnsafeMountPathError(path);
    }
  }
  const readOnlyOption = mount.isReadOnly ? ',readonly' : '';
  return `type=bind,source=${mount.hostPath},target=${mount.containerPath}${readOnlyOption}`;
}

/** Proxy variables, set in both cases because tools disagree on which they read. */
function buildProxyEnvironment(egressProxyUrl: string): Record<string, string> {
  return {
    HTTPS_PROXY: egressProxyUrl,
    https_proxy: egressProxyUrl,
    HTTP_PROXY: egressProxyUrl,
    http_proxy: egressProxyUrl,
    NO_PROXY: '',
    no_proxy: '',
  };
}

function buildEnvironmentArguments(spec: SandboxSpec, settings: DockerSandboxSettings): string[] {
  const plainEnvironment = {
    ...buildProxyEnvironment(settings.egressProxyUrl),
    ...spec.environment,
  };
  return [
    ...Object.entries(plainEnvironment).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    // Name only: Docker copies the value from the docker CLI's own environment.
    ...Object.keys(spec.secretEnvironment).flatMap((name) => ['--env', name]),
  ];
}

function buildMountArguments(spec: SandboxSpec): string[] {
  const mounts: SandboxMount[] = [
    { hostPath: spec.homeDirectory, containerPath: SANDBOX_PATHS.HOME, isReadOnly: false },
    {
      hostPath: spec.workspaceDirectory,
      containerPath: SANDBOX_PATHS.WORKSPACE,
      isReadOnly: false,
    },
    ...spec.readOnlyMounts.map((mount) => ({ ...mount, isReadOnly: true })),
  ];
  return mounts.flatMap((mount) => ['--mount', formatBindMount(mount)]);
}

/**
 * Builds the full argument list for `docker run`.
 *
 * @param spec - What to run and with which limits.
 * @param settings - Host-level sandbox settings.
 * @returns Arguments to pass to the `docker` binary.
 * @throws {UnsafeMountPathError} If a mount path contains a comma or newline.
 *
 * @example
 * ```ts
 * spawn('docker', buildDockerRunArguments(spec, settings), { env: { ...spec.secretEnvironment } });
 * ```
 */
export function buildDockerRunArguments(
  spec: SandboxSpec,
  settings: DockerSandboxSettings,
): string[] {
  const memoryLimit = `${spec.memoryLimitMb}m`;
  return [
    'run',
    '--rm',
    '--interactive',
    '--init',
    '--name',
    buildSandboxContainerName(spec.runId),
    '--label',
    `${SANDBOX_LABELS.MANAGED}=true`,
    '--label',
    `${SANDBOX_LABELS.RUN_ID}=${spec.runId}`,
    '--user',
    settings.user,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(settings.pidsLimit),
    '--cpus',
    formatCpuLimit(spec.cpuLimitMillicores),
    '--memory',
    memoryLimit,
    // Equal to --memory, so the sandbox gets no swap on top of its limit.
    '--memory-swap',
    memoryLimit,
    '--network',
    settings.networkName,
    '--tmpfs',
    `${SANDBOX_PATHS.TMP}:rw,nosuid,nodev,size=${settings.tmpSizeMb}m`,
    ...buildMountArguments(spec),
    '--workdir',
    SANDBOX_PATHS.WORKSPACE,
    ...buildEnvironmentArguments(spec, settings),
    spec.containerImage,
    ...spec.command,
  ];
}
