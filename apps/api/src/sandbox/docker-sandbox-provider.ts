/**
 * Runs sandboxes as Docker containers on the API host, by calling the
 * `docker` CLI.
 *
 * Using the CLI instead of a Docker API client library adds no dependency
 * and keeps the exact flags visible (see `docker-run-arguments.ts`). The
 * `docker run` process stays attached, so its stdout and stderr are the
 * container's, and its exit code is the command's.
 *
 * The docker CLI is spawned with a minimal environment: only what it needs
 * to find the daemon, plus the run's secrets so `--env NAME` can pick them
 * up. Nothing else from the API's environment (such as `DATABASE_URL`) can
 * reach a sandbox.
 *
 * Anyone who can talk to the Docker daemon is effectively root on the host,
 * so the API's account must be trusted accordingly (see D-022).
 */
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import {
  SANDBOX_LABELS,
  buildDockerRunArguments,
  buildSandboxContainerName,
} from './docker-run-arguments.js';
import type { DockerSandboxSettings } from './docker-run-arguments.js';
import { SandboxStartError } from './sandbox-provider.js';
import type {
  RunningSandbox,
  SandboxExit,
  SandboxProvider,
  SandboxSpec,
} from './sandbox-provider.js';

const runExecFile = promisify(execFile);

/** Environment variables the docker CLI may need to reach the daemon. */
const DOCKER_CLIENT_ENVIRONMENT_VARIABLES = [
  'PATH',
  'HOME',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'XDG_RUNTIME_DIR',
] as const;

/** Seconds `docker stop` waits after SIGTERM before it kills the container. */
const STOP_GRACE_SECONDS = 10;

/** Extra time for `docker stop` itself before the CLI process is killed. */
const STOP_COMMAND_TIMEOUT_MS = (STOP_GRACE_SECONDS + 20) * 1_000;

/** Time allowed for short Docker management commands. */
const MANAGEMENT_COMMAND_TIMEOUT_MS = 30_000;

/** Settings for the Docker provider. */
export interface DockerSandboxProviderSettings extends DockerSandboxSettings {
  /** The docker binary, usually `docker`. */
  dockerCommand: string;
  /** The API's environment, from which the docker client variables are copied. */
  hostEnvironment: Record<string, string | undefined>;
}

/** Picks the variables the docker CLI needs out of the API's environment. */
function buildDockerClientEnvironment(
  hostEnvironment: Record<string, string | undefined>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of DOCKER_CLIENT_ENVIRONMENT_VARIABLES) {
    const value = hostEnvironment[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

/** Yields a stream's lines. */
function readLines(stream: Readable): AsyncIterable<string> {
  return createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
}

/**
 * Creates the Docker sandbox provider.
 *
 * @param settings - Network, user, limits and the docker binary.
 * @returns The provider.
 */
export function createDockerSandboxProvider(
  settings: DockerSandboxProviderSettings,
): SandboxProvider {
  const dockerClientEnvironment = buildDockerClientEnvironment(settings.hostEnvironment);

  async function runDockerCommand(args: string[], timeoutMs: number): Promise<string> {
    const { stdout } = await runExecFile(settings.dockerCommand, args, {
      env: dockerClientEnvironment,
      timeout: timeoutMs,
    });
    return stdout;
  }

  async function stopContainer(containerName: string): Promise<void> {
    try {
      await runDockerCommand(
        ['stop', '--time', String(STOP_GRACE_SECONDS), containerName],
        STOP_COMMAND_TIMEOUT_MS,
      );
    } catch {
      // Already gone, or the daemon refused; fall back to a forced removal.
      await runDockerCommand(['rm', '--force', containerName], MANAGEMENT_COMMAND_TIMEOUT_MS).catch(
        () => undefined,
      );
    }
  }

  return {
    async startSandbox(spec: SandboxSpec): Promise<RunningSandbox> {
      const containerName = buildSandboxContainerName(spec.runId);
      const dockerProcess = spawn(settings.dockerCommand, buildDockerRunArguments(spec, settings), {
        env: { ...dockerClientEnvironment, ...spec.secretEnvironment },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      await new Promise<void>((resolve, reject) => {
        dockerProcess.once('spawn', resolve);
        dockerProcess.once('error', (error) => {
          reject(
            new SandboxStartError(`Could not run ${settings.dockerCommand}`, { cause: error }),
          );
        });
      });

      const exited = new Promise<SandboxExit>((resolve) => {
        dockerProcess.once('close', (exitCode) => {
          resolve({ exitCode });
        });
      });

      // The CLI may exit before reading stdin (for example on a bad image);
      // that is reported through the exit code, not as a write error.
      dockerProcess.stdin.on('error', () => undefined);
      dockerProcess.stdin.end(spec.stdin);

      return {
        sandboxId: containerName,
        stdoutLines: readLines(dockerProcess.stdout),
        stderrLines: readLines(dockerProcess.stderr),
        exited,
        stop: () => stopContainer(containerName),
      };
    },

    async removeOrphanedSandboxes(): Promise<string[]> {
      const output = await runDockerCommand(
        ['ps', '--all', '--quiet', '--filter', `label=${SANDBOX_LABELS.MANAGED}=true`],
        MANAGEMENT_COMMAND_TIMEOUT_MS,
      );
      const containerIds = output.split('\n').filter((containerId) => containerId !== '');
      if (containerIds.length > 0) {
        await runDockerCommand(['rm', '--force', ...containerIds], MANAGEMENT_COMMAND_TIMEOUT_MS);
      }
      return containerIds;
    },
  };
}
