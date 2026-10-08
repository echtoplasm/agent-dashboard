/**
 * The interface between the run manager and whatever isolates a run.
 *
 * Phase 3 has one implementation, Docker on the API host. A Proxmox LXC
 * provider can implement the same interface later without the run manager
 * changing.
 */

/** A host directory made visible inside the sandbox. */
export interface SandboxMount {
  /** Absolute path on the host. */
  hostPath: string;
  /** Absolute path inside the sandbox. */
  containerPath: string;
  isReadOnly: boolean;
}

/** Everything needed to start one run's sandbox. */
export interface SandboxSpec {
  runId: string;
  containerImage: string;
  /** Command and arguments to run inside the sandbox. */
  command: string[];
  /** Non-secret environment variables. */
  environment: Record<string, string>;
  /** Secret environment variables, which must never appear on a command line. */
  secretEnvironment: Record<string, string>;
  /** Written to the command's stdin, which is then closed. */
  stdin: string;
  cpuLimitMillicores: number;
  memoryLimitMb: number;
  /** Writable host directory mounted as the run's working directory. */
  workspaceDirectory: string;
  /** Writable host directory mounted as HOME, deleted after the run. */
  homeDirectory: string;
  /** Read-only mounts such as skill versions, nested inside HOME. */
  readOnlyMounts: SandboxMount[];
}

/** How a sandbox's command ended. */
export interface SandboxExit {
  /** The exit code, or null if it was killed by a signal. */
  exitCode: number | null;
}

/** A started sandbox. */
export interface RunningSandbox {
  /** Identifier of the sandbox, e.g. the container name. */
  sandboxId: string;
  /** The command's stdout, line by line. Must be consumed. */
  stdoutLines: AsyncIterable<string>;
  /** The command's stderr, line by line. Must be consumed. */
  stderrLines: AsyncIterable<string>;
  /** Settles when the sandbox has exited. Never rejects. */
  exited: Promise<SandboxExit>;
  /** Asks the sandbox to stop, then forces it after a grace period. */
  stop(): Promise<void>;
}

/** Thrown when a sandbox cannot be started at all. */
export class SandboxStartError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SandboxStartError';
  }
}

/** Something that can run a command in isolation. */
export interface SandboxProvider {
  /**
   * Starts a sandbox for a run.
   *
   * @throws {SandboxStartError} If the sandbox could not be started.
   */
  startSandbox(spec: SandboxSpec): Promise<RunningSandbox>;
  /**
   * Removes sandboxes left behind by an earlier API process, for example
   * after a crash.
   *
   * @returns The ids of the sandboxes removed.
   */
  removeOrphanedSandboxes(): Promise<string[]>;
}
