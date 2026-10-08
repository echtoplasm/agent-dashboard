/**
 * Business rules for launching, cancelling and reading runs.
 *
 * Launching is privileged and audited. A launch is refused unless:
 *
 * - the agent is active, its provider is enabled and has an adapter, and its
 *   sandbox profile is not archived
 * - the provider's API key is configured on the server
 * - the agent's loadout still satisfies the loadout rules (D-021)
 * - every assigned skill version's files still match their content hash
 * - fewer than `MAX_CONCURRENT_RUNS` runs are active
 *
 * The checks, the run row, its pinned skill versions and the audit entry
 * are written in one transaction holding the launch lock, so two launches
 * can't both take the last free slot. Execution then starts in the
 * background; the response returns the queued run straight away.
 */
import type {
  AgentUsage,
  LaunchRunRequest,
  RunDetail,
  RunEvent,
  RunEventListQuery,
  RunEventPage,
  RunListPage,
  RunListQuery,
  WorkspaceListing,
} from '@agent-dashboard/shared';
import { isTerminalRunStatus } from '@agent-dashboard/shared';
import type { ReadStream } from 'node:fs';
import { findAgentAdapter } from '../../adapters/adapter-registry.js';
import type { AgentAdapter } from '../../adapters/agent-adapter.js';
import type { DataAccess, Repositories } from '../../db/data-access.js';
import {
  ConflictError,
  NotFoundError,
  RunCapacityError,
  ServiceUnavailableError,
} from '../../errors/app-errors.js';
import { assertLoadoutFits } from '../assignments/loadout-rules.js';
import type { AuditContext } from '../audit/audit.types.js';
import type { SkillStorage } from '../skills/skill-storage.js';
import {
  WorkspaceFileUnavailableError,
  listWorkspaceFiles,
  openWorkspaceFile,
} from './run-directories.js';
import type { RunLaunch, RunManager } from './run-manager.js';
import type { RunEventListener } from './run-event-bus.js';
import type { LaunchSkillVersion } from './runs.types.js';

/** Run operations. */
export interface RunsService {
  /** @throws {NotFoundError | ConflictError | RunCapacityError | ServiceUnavailableError} */
  launchRun(input: LaunchRunRequest, context: AuditContext): Promise<RunDetail>;
  /** @throws {NotFoundError | ConflictError} If the run has already finished. */
  cancelRun(runId: string, context: AuditContext): Promise<RunDetail>;
  listRuns(query: RunListQuery): Promise<RunListPage>;
  /** @throws {NotFoundError} */
  getRun(runId: string): Promise<RunDetail>;
  /** @throws {NotFoundError} */
  listRunEvents(runId: string, query: RunEventListQuery): Promise<RunEventPage>;
  /** Subscribes to a run's live events. */
  subscribeToRunEvents(runId: string, listener: RunEventListener): () => void;
  /** @throws {NotFoundError} */
  getAgentUsage(agentId: string): Promise<AgentUsage>;
  /** @throws {NotFoundError} */
  listWorkspaceFiles(runId: string): Promise<WorkspaceListing>;
  /** @throws {NotFoundError} If the run or file does not exist or can't be served. */
  openWorkspaceFile(
    runId: string,
    path: string,
  ): Promise<{ stream: ReadStream; sizeBytes: number }>;
}

/** Settings the runs service needs. */
export interface RunsServiceSettings {
  maxConcurrentRuns: number;
  /** Provider API keys by environment variable name, e.g. `ANTHROPIC_API_KEY`. */
  providerApiKeys: Readonly<Record<string, string | undefined>>;
}

/** Dependencies of the runs service. */
export interface RunsServiceDependencies {
  dataAccess: DataAccess;
  runManager: RunManager;
  skillStorage: SkillStorage;
  settings: RunsServiceSettings;
}

/** Everything a launch needs, gathered and checked inside the launch transaction. */
interface CheckedLaunch {
  launch: Omit<RunLaunch, 'runId'>;
  agentName: string;
  skillVersions: LaunchSkillVersion[];
}

async function findRun(repositories: Repositories, runId: string): Promise<RunDetail> {
  const run = await repositories.runs.findRunDetail(runId);
  if (run === undefined) {
    throw new NotFoundError('Run not found');
  }
  return run;
}

/**
 * Creates the runs service.
 *
 * @param dependencies - Data access, run manager, skill storage and settings.
 * @returns The service.
 */
export function createRunsService(dependencies: RunsServiceDependencies): RunsService {
  const { dataAccess, runManager, skillStorage, settings } = dependencies;

  function readApiKey(adapter: AgentAdapter): string {
    const apiKey = settings.providerApiKeys[adapter.apiKeyEnvironmentVariable];
    if (apiKey === undefined || apiKey === '') {
      throw new ServiceUnavailableError(
        `${adapter.apiKeyEnvironmentVariable} is not configured on the API server`,
      );
    }
    return apiKey;
  }

  /**
   * Re-reads every skill version's files and checks their hash, so a
   * version tampered with on disk is never mounted into a sandbox.
   */
  async function verifySkillVersions(skillVersions: readonly LaunchSkillVersion[]): Promise<void> {
    for (const skillVersion of skillVersions) {
      await skillStorage.readVersionFiles(skillVersion.storagePath, skillVersion.contentHash);
    }
  }

  async function checkLaunch(
    repositories: Repositories,
    input: LaunchRunRequest,
  ): Promise<CheckedLaunch> {
    const agent = await repositories.agents.findAgentById(input.agentId);
    if (agent === undefined) {
      throw new NotFoundError('Agent not found');
    }
    if (agent.archivedAt !== null) {
      throw new ConflictError('Archived agents cannot be launched');
    }
    const provider = await repositories.providers.findProviderById(agent.providerId);
    if (!provider?.isEnabled) {
      throw new ConflictError("The agent's provider is disabled");
    }
    const adapter = findAgentAdapter(provider.slug);
    if (adapter === undefined) {
      throw new ConflictError(`Provider "${provider.displayName}" has no adapter in this build`);
    }
    const sandboxProfile = await repositories.sandboxProfiles.findSandboxProfileById(
      agent.sandboxProfileId,
    );
    if (sandboxProfile?.archivedAt !== null) {
      throw new ConflictError("The agent's sandbox profile is archived");
    }
    const apiKey = readApiKey(adapter);
    await assertLoadoutFits(repositories, agent, sandboxProfile);
    const skillVersions = await repositories.assignments.listLaunchSkillVersions(agent.id);
    await verifySkillVersions(skillVersions);

    return {
      agentName: agent.name,
      skillVersions,
      launch: {
        providerId: provider.id,
        model: agent.model,
        prompt: input.prompt,
        adapter,
        invocation: adapter.buildInvocation({ model: agent.model, apiKey }),
        sandboxProfile,
        skillMounts: skillVersions.map((skillVersion) => ({
          skillSlug: skillVersion.skillSlug,
          hostPath: skillStorage.resolveVersionDirectory(skillVersion.storagePath),
        })),
      },
    };
  }

  async function assertCapacityAvailable(repositories: Repositories): Promise<void> {
    await repositories.runs.lockRunLaunches();
    const activeRunCount = await repositories.runs.countActiveRuns();
    if (activeRunCount >= settings.maxConcurrentRuns) {
      throw new RunCapacityError(settings.maxConcurrentRuns);
    }
  }

  return {
    async launchRun(input, context) {
      const { runId, checkedLaunch } = await dataAccess.runInTransaction(async (repositories) => {
        await assertCapacityAvailable(repositories);
        const checked = await checkLaunch(repositories, input);
        const newRunId = await repositories.runs.insertRun({
          agentId: input.agentId,
          providerId: checked.launch.providerId,
          triggeredBy: context.actorUserId,
          prompt: input.prompt,
          model: checked.launch.model,
        });
        await repositories.runs.insertRunSkillVersions(
          newRunId,
          checked.skillVersions.map((skillVersion) => skillVersion.skillVersionId),
        );
        await repositories.audit.insertAuditEntry(context, {
          action: 'run.launched',
          targetType: 'run',
          targetId: newRunId,
          metadata: {
            agentId: input.agentId,
            agentName: checked.agentName,
            model: checked.launch.model,
            promptLength: input.prompt.length,
            skillVersions: checked.skillVersions.map(
              (skillVersion) => `${skillVersion.skillSlug}@${skillVersion.version}`,
            ),
          },
        });
        return { runId: newRunId, checkedLaunch: checked };
      });
      runManager.startRun({ runId, ...checkedLaunch.launch });
      return findRun(dataAccess.repositories, runId);
    },

    async cancelRun(runId, context) {
      const run = await findRun(dataAccess.repositories, runId);
      if (isTerminalRunStatus(run.status)) {
        throw new ConflictError('The run has already finished');
      }
      await dataAccess.runInTransaction(async (repositories) => {
        await repositories.audit.insertAuditEntry(context, {
          action: 'run.cancelled',
          targetType: 'run',
          targetId: runId,
          metadata: { agentId: run.agentId, statusAtCancel: run.status },
        });
        // Not executing in this process (e.g. orphaned by a crash): end it directly.
        if (!runManager.requestCancellation(runId)) {
          await repositories.runs.completeRun(runId, {
            status: 'cancelled',
            exitCode: null,
            errorMessage: 'Cancelled by a user',
          });
        }
      });
      return findRun(dataAccess.repositories, runId);
    },

    listRuns: (query) => dataAccess.repositories.runs.listRuns(query),

    getRun: (runId) => findRun(dataAccess.repositories, runId),

    async listRunEvents(runId, query) {
      await findRun(dataAccess.repositories, runId);
      const items: RunEvent[] = await dataAccess.repositories.runs.listRunEvents(
        runId,
        query.after,
        query.limit,
      );
      return {
        items,
        nextCursor: items.length === query.limit ? (items.at(-1)?.sequenceNumber ?? null) : null,
      };
    },

    subscribeToRunEvents: (runId, listener) => runManager.subscribeToRunEvents(runId, listener),

    async getAgentUsage(agentId) {
      const agent = await dataAccess.repositories.agents.findAgentById(agentId);
      if (agent === undefined) {
        throw new NotFoundError('Agent not found');
      }
      return dataAccess.repositories.runs.getAgentUsage(agentId);
    },

    async listWorkspaceFiles(runId) {
      await findRun(dataAccess.repositories, runId);
      return listWorkspaceFiles(runManager.getWorkspaceDirectory(runId));
    },

    async openWorkspaceFile(runId, path) {
      await findRun(dataAccess.repositories, runId);
      try {
        return await openWorkspaceFile(runManager.getWorkspaceDirectory(runId), path);
      } catch (error) {
        if (error instanceof WorkspaceFileUnavailableError) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    },
  };
}
