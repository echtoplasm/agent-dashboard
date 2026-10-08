/**
 * Executes launched runs: starts the sandbox, turns the CLI's output into
 * stored events, keeps usage totals, and records how the run ended.
 *
 * The runs service decides whether a run may launch and prepares everything
 * it needs (a `RunLaunch`); the manager only executes. Runs execute in the
 * background of the API process. If the process dies, the next start fails
 * the interrupted runs and removes their containers
 * (`recoverInterruptedRuns`).
 *
 * Events are written strictly one at a time per run, in order, and
 * published to live subscribers only after they are stored. An SSE client
 * that replays stored events and then follows live ones therefore never sees
 * a gap or a reordering.
 */
import { posix, relative } from 'node:path';
import { RunEventDataSchema, estimateCostMicroUsd } from '@agent-dashboard/shared';
import type {
  RunEventData,
  RunResultEventPayload,
  RunStatus,
  SandboxProfile,
  UsageEventPayload,
} from '@agent-dashboard/shared';
import type {
  AgentAdapter,
  AgentInvocation,
  ParsedProviderEvent,
} from '../../adapters/agent-adapter.js';
import type { DataAccess } from '../../db/data-access.js';
import type { Logger } from '../../logger.js';
import { SANDBOX_PATHS } from '../../sandbox/docker-run-arguments.js';
import type {
  RunningSandbox,
  SandboxMount,
  SandboxProvider,
} from '../../sandbox/sandbox-provider.js';
import { decideRunCompletion } from './run-completion.js';
import type { RunStopReason } from './run-completion.js';
import { createRunDirectories, getRunDirectories, removeRunHome } from './run-directories.js';
import type { RunDirectories } from './run-directories.js';
import type { RunEventBus, RunEventListener } from './run-event-bus.js';
import { createSecretRedactor } from './secret-redaction.js';
import type { SecretRedactor } from './secret-redaction.js';
import type { RunCompletion } from './runs.types.js';

/** Most stderr lines stored per run; the rest are counted, not kept. */
const MAX_STORED_STDERR_LINES = 500;

/** Lines of stderr kept to explain a sandbox that failed to start. */
const STDERR_TAIL_LENGTH = 20;

const MILLISECONDS_PER_SECOND = 1_000;

/** How long shutdown waits for runs to stop before giving up. */
const SHUTDOWN_WAIT_MS = 30_000;

/** Error message for runs found active when the API starts. */
export const INTERRUPTED_RUN_MESSAGE = 'The API restarted while this run was active';

/** A skill version to mount into the sandbox. */
export interface RunSkillMount {
  skillSlug: string;
  /** Absolute host directory of the verified skill version. */
  hostPath: string;
}

/** Everything the manager needs to execute one run. Built by the runs service. */
export interface RunLaunch {
  runId: string;
  providerId: string;
  /** The model the agent requested, or null for the CLI's default. */
  model: string | null;
  prompt: string;
  adapter: AgentAdapter;
  invocation: AgentInvocation;
  sandboxProfile: Pick<
    SandboxProfile,
    'containerImage' | 'cpuLimitMillicores' | 'memoryLimitMb' | 'maxRunDurationSeconds'
  >;
  skillMounts: RunSkillMount[];
}

/** Runs launches in sandboxes and tracks the ones in progress. */
export interface RunManager {
  /** Starts executing a run in the background. */
  startRun(launch: RunLaunch): void;
  /**
   * Asks an active run to stop.
   *
   * @returns Whether the run was active in this process.
   */
  requestCancellation(runId: string): boolean;
  /** Subscribes to a run's events as they are stored. */
  subscribeToRunEvents(runId: string, listener: RunEventListener): () => void;
  /** The host workspace directory of a run. */
  getWorkspaceDirectory(runId: string): string;
  /** Resolves when the run finishes; resolves at once if it isn't active. For tests and shutdown. */
  waitForRun(runId: string): Promise<void>;
  /** Fails runs left active by a previous process and removes their sandboxes. */
  recoverInterruptedRuns(): Promise<void>;
  /** Stops every active run, for API shutdown. */
  stopAllRuns(): Promise<void>;
}

/** Dependencies of the run manager. */
export interface RunManagerDependencies {
  dataAccess: DataAccess;
  sandboxProvider: SandboxProvider;
  eventBus: RunEventBus;
  logger: Logger;
  /** Absolute `RUN_DATA_DIR`. */
  runDataDirectory: string;
}

/** A run executing in this process. */
interface ActiveRun {
  launch: RunLaunch;
  sandbox: RunningSandbox | null;
  stopReason: RunStopReason | null;
  finished: Promise<void>;
}

/** What the output consumers learned, used to decide the final status. */
interface OutputSummary {
  runResult: RunResultEventPayload | null;
  lastFatalErrorMessage: string | null;
  stderrTail: string[];
}

/** What handling one parsed event needs to know about its run. */
interface ParsedEventContext {
  launch: RunLaunch;
  recorder: RunEventRecorder;
  summary: OutputSummary;
  /** The model to price usage with: the agent's, or the one the CLI reports. */
  modelHolder: { model: string | null };
}

/** The outcome fields of a run that ended before its sandbox produced output. */
const NO_SANDBOX_OUTPUT = {
  exitCode: null,
  runResult: null,
  lastFatalErrorMessage: null,
  stderrTail: [],
} as const;

/**
 * Records a run's events one at a time, in order, then publishes each one.
 */
interface RunEventRecorder {
  record(data: RunEventData, rawPayload: unknown, occurredAt: string | null): Promise<void>;
}

/**
 * Reports whether the API has asked a run to stop. A function rather than an
 * inline check, because the flag changes while the run awaits.
 */
function isStopRequested(activeRun: ActiveRun): boolean {
  return activeRun.stopReason !== null;
}

/**
 * Creates the run manager.
 *
 * @param dependencies - Database, sandbox, event bus, logger and run directory.
 * @returns The manager.
 */
export function createRunManager(dependencies: RunManagerDependencies): RunManager {
  const { dataAccess, sandboxProvider, eventBus, logger, runDataDirectory } = dependencies;
  const { runs: runsRepository, modelPrices: modelPricesRepository } = dataAccess.repositories;
  const activeRuns = new Map<string, ActiveRun>();

  function createEventRecorder(runId: string, firstSequenceNumber: number): RunEventRecorder {
    let nextSequenceNumber = firstSequenceNumber;
    let previousWrite: Promise<void> = Promise.resolve();
    return {
      record(data, rawPayload, occurredAt) {
        const write = previousWrite.then(async () => {
          const storedEvent = await runsRepository.insertRunEvent({
            runId,
            sequenceNumber: nextSequenceNumber,
            data,
            rawPayload,
            occurredAt,
          });
          nextSequenceNumber += 1;
          eventBus.publish(storedEvent);
        });
        // A failed write must not block later ones; the caller still sees the error.
        previousWrite = write.catch(() => undefined);
        return write;
      },
    };
  }

  async function recordStatus(
    recorder: RunEventRecorder,
    status: RunStatus,
    message: string | null,
  ): Promise<void> {
    await recorder.record({ type: 'run.status', payload: { status, message } }, null, null);
  }

  /** Adds an estimated cost to usage the provider reported without one. */
  async function priceUsage(
    usage: UsageEventPayload,
    providerId: string,
    model: string | null,
  ): Promise<UsageEventPayload> {
    if (usage.costMicroUsd !== null || model === null) {
      return usage;
    }
    const modelPrice = await modelPricesRepository.findModelPrice(providerId, model);
    return modelPrice === undefined
      ? usage
      : {
          ...usage,
          costMicroUsd: estimateCostMicroUsd(usage, modelPrice),
          costSource: 'estimated',
        };
  }

  function buildSkillMounts(launch: RunLaunch): {
    mounts: SandboxMount[];
    homeMountpoints: string[];
  } {
    const mounts = launch.skillMounts.map((skillMount) => ({
      hostPath: skillMount.hostPath,
      containerPath: posix.join(launch.adapter.skillsDirectory, skillMount.skillSlug),
      isReadOnly: true,
    }));
    return {
      mounts,
      homeMountpoints: mounts.map((mount) => relative(SANDBOX_PATHS.HOME, mount.containerPath)),
    };
  }

  async function startSandbox(
    launch: RunLaunch,
    directories: RunDirectories,
  ): Promise<RunningSandbox> {
    const { mounts, homeMountpoints } = buildSkillMounts(launch);
    await createRunDirectories(directories, homeMountpoints);
    return sandboxProvider.startSandbox({
      runId: launch.runId,
      containerImage: launch.sandboxProfile.containerImage,
      command: launch.invocation.command,
      environment: launch.invocation.environment,
      secretEnvironment: launch.invocation.secretEnvironment,
      stdin: launch.prompt,
      cpuLimitMillicores: launch.sandboxProfile.cpuLimitMillicores,
      memoryLimitMb: launch.sandboxProfile.memoryLimitMb,
      workspaceDirectory: directories.workspaceDirectory,
      homeDirectory: directories.homeDirectory,
      readOnlyMounts: mounts,
    });
  }

  /**
   * Stores one parsed event and applies its side effects on the run row.
   * An adapter bug that produces an invalid payload becomes a notice rather
   * than ending the run.
   */
  async function handleParsedEvent(
    parsedEvent: ParsedProviderEvent,
    context: ParsedEventContext,
  ): Promise<void> {
    const validation = RunEventDataSchema.safeParse(parsedEvent.event);
    if (!validation.success) {
      logger.warn(
        { runId: context.launch.runId, issues: validation.error.issues },
        'adapter produced an invalid event',
      );
      await context.recorder.record(
        {
          type: 'notice',
          payload: {
            message: 'The adapter produced an event it could not describe',
            source: 'sandbox',
          },
        },
        parsedEvent.rawPayload,
        parsedEvent.occurredAt,
      );
      return;
    }
    let event = validation.data;
    const { runId, providerId } = context.launch;
    switch (event.type) {
      case 'session.started':
        context.modelHolder.model ??= event.payload.model;
        await runsRepository.recordProviderSession(
          runId,
          event.payload.providerSessionId,
          event.payload.model,
        );
        break;
      case 'usage': {
        const pricedUsage = await priceUsage(event.payload, providerId, context.modelHolder.model);
        event = { type: 'usage', payload: pricedUsage };
        await runsRepository.addRunUsage(runId, pricedUsage);
        break;
      }
      case 'run.result':
        context.summary.runResult = event.payload;
        break;
      case 'error':
        if (event.payload.isFatal) {
          context.summary.lastFatalErrorMessage = event.payload.message;
        }
        break;
      default:
        break;
    }
    await context.recorder.record(event, parsedEvent.rawPayload, parsedEvent.occurredAt);
  }

  async function consumeStderr(
    sandbox: RunningSandbox,
    redact: SecretRedactor,
    recorder: RunEventRecorder,
    summary: OutputSummary,
  ): Promise<void> {
    let lineCount = 0;
    for await (const line of sandbox.stderrLines) {
      const cleanLine = redact(line);
      lineCount += 1;
      summary.stderrTail.push(cleanLine);
      if (summary.stderrTail.length > STDERR_TAIL_LENGTH) {
        summary.stderrTail.shift();
      }
      if (lineCount <= MAX_STORED_STDERR_LINES) {
        await recorder.record(
          { type: 'notice', payload: { message: cleanLine, source: 'stderr' } },
          null,
          null,
        );
      }
    }
    if (lineCount > MAX_STORED_STDERR_LINES) {
      const skippedCount = lineCount - MAX_STORED_STDERR_LINES;
      await recorder.record(
        {
          type: 'notice',
          payload: {
            message: `${skippedCount} more stderr lines were not stored`,
            source: 'sandbox',
          },
        },
        null,
        null,
      );
    }
  }

  /** Reads both output streams to the end, then lets the parser finish. */
  async function consumeSandboxOutput(
    launch: RunLaunch,
    sandbox: RunningSandbox,
    recorder: RunEventRecorder,
  ): Promise<OutputSummary> {
    const redact = createSecretRedactor(Object.values(launch.invocation.secretEnvironment));
    const parser = launch.adapter.createOutputParser();
    const summary: OutputSummary = { runResult: null, lastFatalErrorMessage: null, stderrTail: [] };
    const context: ParsedEventContext = {
      launch,
      recorder,
      summary,
      modelHolder: { model: launch.model },
    };

    const consumeStdout = async (): Promise<void> => {
      for await (const line of sandbox.stdoutLines) {
        for (const parsedEvent of parser.parseStdoutLine(redact(line))) {
          await handleParsedEvent(parsedEvent, context);
        }
      }
    };
    await Promise.all([consumeStdout(), consumeStderr(sandbox, redact, recorder, summary)]);
    for (const parsedEvent of parser.finish()) {
      await handleParsedEvent(parsedEvent, context);
    }
    return summary;
  }

  function startTimeoutTimer(activeRun: ActiveRun, sandbox: RunningSandbox): NodeJS.Timeout {
    const timeoutMs =
      activeRun.launch.sandboxProfile.maxRunDurationSeconds * MILLISECONDS_PER_SECOND;
    return setTimeout(() => {
      activeRun.stopReason ??= 'timed_out';
      sandbox.stop().catch((error: unknown) => {
        logger.error(
          { err: error, runId: activeRun.launch.runId },
          'stopping a timed-out sandbox failed',
        );
      });
    }, timeoutMs);
  }

  /** Runs the sandbox to completion and decides how the run ended. */
  async function runSandbox(
    activeRun: ActiveRun,
    recorder: RunEventRecorder,
    directories: RunDirectories,
  ): Promise<RunCompletion> {
    const { launch } = activeRun;
    const { maxRunDurationSeconds } = launch.sandboxProfile;
    if (activeRun.stopReason !== null) {
      // Cancelled between launch and start: there is nothing to stop.
      return decideRunCompletion({
        ...NO_SANDBOX_OUTPUT,
        stopReason: activeRun.stopReason,
        maxRunDurationSeconds,
      });
    }
    const sandbox = await startSandbox(launch, directories);
    activeRun.sandbox = sandbox;
    if (isStopRequested(activeRun)) {
      // Cancelled while the sandbox was starting.
      await sandbox.stop();
    }
    await runsRepository.markRunRunning(launch.runId, sandbox.sandboxId);
    await recordStatus(recorder, 'running', null);
    const timeoutTimer = startTimeoutTimer(activeRun, sandbox);
    try {
      const summary = await consumeSandboxOutput(launch, sandbox, recorder).catch(
        async (error: unknown) => {
          // Stop the sandbox so it doesn't block forever on output nobody reads.
          await sandbox.stop();
          throw error;
        },
      );
      const { exitCode } = await sandbox.exited;
      return decideRunCompletion({
        stopReason: activeRun.stopReason,
        exitCode,
        ...summary,
        maxRunDurationSeconds,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  async function executeRun(activeRun: ActiveRun): Promise<void> {
    const { runId } = activeRun.launch;
    const recorder = createEventRecorder(runId, 0);
    const directories = getRunDirectories(runDataDirectory, runId);
    let completion: RunCompletion;
    try {
      await runsRepository.markRunStarting(runId);
      await recordStatus(recorder, 'starting', null);
      completion = await runSandbox(activeRun, recorder, directories);
    } catch (error) {
      logger.error({ err: error, runId }, 'run failed to execute');
      completion = {
        status: 'failed',
        exitCode: null,
        errorMessage: 'The run could not be executed; see the API log',
      };
    }
    try {
      const isStillActive = await runsRepository.completeRun(runId, completion);
      if (isStillActive) {
        await recordStatus(recorder, completion.status, completion.errorMessage);
      }
    } catch (error) {
      logger.error({ err: error, runId }, 'recording the end of a run failed');
    }
    await removeRunHome(directories).catch((error: unknown) => {
      logger.error({ err: error, runId }, 'removing run home failed');
    });
    logger.info({ runId, status: completion.status }, 'run finished');
  }

  return {
    startRun(launch) {
      const activeRun: ActiveRun = {
        launch,
        sandbox: null,
        stopReason: null,
        finished: Promise.resolve(),
      };
      activeRuns.set(launch.runId, activeRun);
      activeRun.finished = executeRun(activeRun).finally(() => {
        activeRuns.delete(launch.runId);
      });
    },

    requestCancellation(runId) {
      const activeRun = activeRuns.get(runId);
      if (activeRun === undefined) {
        return false;
      }
      activeRun.stopReason ??= 'cancelled';
      activeRun.sandbox?.stop().catch((error: unknown) => {
        logger.error({ err: error, runId }, 'stopping a cancelled sandbox failed');
      });
      return true;
    },

    subscribeToRunEvents: (runId, listener) => eventBus.subscribe(runId, listener),

    getWorkspaceDirectory: (runId) => getRunDirectories(runDataDirectory, runId).workspaceDirectory,

    async waitForRun(runId) {
      await activeRuns.get(runId)?.finished;
    },

    async recoverInterruptedRuns() {
      try {
        const removedSandboxIds = await sandboxProvider.removeOrphanedSandboxes();
        if (removedSandboxIds.length > 0) {
          logger.warn(
            { count: removedSandboxIds.length },
            'removed sandboxes left by a previous API process',
          );
        }
      } catch (error) {
        logger.error({ err: error }, 'could not check for orphaned sandboxes');
      }
      const interruptedRunIds = await runsRepository.failActiveRuns(INTERRUPTED_RUN_MESSAGE);
      for (const runId of interruptedRunIds) {
        const lastSequenceNumber = await runsRepository.findLastSequenceNumber(runId);
        await recordStatus(
          createEventRecorder(runId, lastSequenceNumber + 1),
          'failed',
          INTERRUPTED_RUN_MESSAGE,
        );
        await removeRunHome(getRunDirectories(runDataDirectory, runId));
      }
      if (interruptedRunIds.length > 0) {
        logger.warn({ runIds: interruptedRunIds }, 'failed runs interrupted by a restart');
      }
    },

    async stopAllRuns() {
      for (const activeRun of activeRuns.values()) {
        activeRun.stopReason ??= 'shutdown';
        activeRun.sandbox?.stop().catch(() => undefined);
      }
      const allFinished = Promise.all(
        [...activeRuns.values()].map((activeRun) => activeRun.finished),
      );
      await Promise.race([
        allFinished,
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS)),
      ]);
    },
  };
}
