/**
 * Data access for `agent_runs`, `agent_run_skill_versions` and `run_events`.
 *
 * Status changes are guarded by the current status in the `WHERE` clause, so
 * a late update (for example a cancel racing a normal exit) can never move a
 * finished run back to an active state.
 */
import {
  ACTIVE_RUN_STATUSES,
  RunEventSchema,
  type AgentUsage,
  type CostSource,
  type ProviderSlug,
  type RunDetail,
  type RunEvent,
  type RunListPage,
  type RunListQuery,
  type RunSkillVersion,
  type RunStatus,
  type RunSummary,
} from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { toIsoString, toNullableIsoString } from '../../db/row-mapping.js';
import type { NewRun, NewRunEvent, RunCompletion, RunUsageDelta } from './runs.types.js';

/**
 * Key for the transaction-level advisory lock taken while launching a run.
 * Launches are serialized so two at once can't both pass the concurrency
 * check. The value is arbitrary but must not be reused for another lock.
 */
const RUN_LAUNCH_ADVISORY_LOCK_KEY = 4_172_001;

/** `IN (...)` list of the active statuses, built from constants (never user input). */
const ACTIVE_STATUS_SQL_LIST = ACTIVE_RUN_STATUSES.map((status) => `'${status}'`).join(', ');

/** Postgres rejects NUL characters in text and jsonb, but agent output can contain them. */
const NUL_CHARACTER = '\u0000';
const REPLACEMENT_CHARACTER = '�';

interface RunSummaryRow {
  id: string;
  agent_id: string;
  agent_name: string;
  provider_id: string;
  provider_slug: ProviderSlug;
  triggered_by: string | null;
  triggered_by_username: string | null;
  status: RunStatus;
  model: string | null;
  queued_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  exit_code: number | null;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_micro_usd: number | null;
  cost_source: CostSource | null;
}

interface RunDetailRow extends RunSummaryRow {
  prompt: string;
  sandbox_id: string | null;
  provider_session_id: string | null;
}

interface RunSkillVersionRow {
  skill_version_id: string;
  skill_id: string;
  skill_slug: string;
  version: string;
  content_hash: string;
}

interface RunEventRow {
  run_id: string;
  sequence_number: number;
  event_type: string;
  payload: unknown;
  occurred_at: Date | null;
  received_at: Date;
}

interface AgentUsageRow {
  run_count: number;
  active_run_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_micro_usd: number;
  month_to_date_cost_micro_usd: number;
  unpriced_run_count: number;
}

function mapRunSummaryRow(row: RunSummaryRow): RunSummary {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    providerId: row.provider_id,
    providerSlug: row.provider_slug,
    triggeredBy: row.triggered_by,
    triggeredByUsername: row.triggered_by_username,
    status: row.status,
    model: row.model,
    queuedAt: toIsoString(row.queued_at),
    startedAt: toNullableIsoString(row.started_at),
    endedAt: toNullableIsoString(row.ended_at),
    exitCode: row.exit_code,
    errorMessage: row.error_message,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    costMicroUsd: row.cost_micro_usd,
    costSource: row.cost_source,
  };
}

function mapRunSkillVersionRow(row: RunSkillVersionRow): RunSkillVersion {
  return {
    skillVersionId: row.skill_version_id,
    skillId: row.skill_id,
    skillSlug: row.skill_slug,
    version: row.version,
    contentHash: row.content_hash,
  };
}

/**
 * Maps a stored event. The stored payload is re-validated, so a row written
 * by an older build that no longer matches the schema fails loudly instead
 * of reaching the browser in an unexpected shape.
 */
function mapRunEventRow(row: RunEventRow): RunEvent {
  return RunEventSchema.parse({
    runId: row.run_id,
    sequenceNumber: row.sequence_number,
    type: row.event_type,
    payload: row.payload,
    occurredAt: toNullableIsoString(row.occurred_at),
    receivedAt: toIsoString(row.received_at),
  });
}

/**
 * Serializes a value for a jsonb column, replacing NUL characters in strings.
 *
 * @param value - Any JSON-compatible value.
 * @returns JSON text Postgres accepts.
 */
export function toStorableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) =>
    typeof nestedValue === 'string'
      ? nestedValue.replaceAll(NUL_CHARACTER, REPLACEMENT_CHARACTER)
      : nestedValue,
  );
}

function toStorableText(text: string | null): string | null {
  return text === null ? null : text.replaceAll(NUL_CHARACTER, REPLACEMENT_CHARACTER);
}

/** Data access for runs and their events. */
export interface RunsRepository {
  /**
   * Serializes run launches until the current transaction ends. Call before
   * counting active runs.
   */
  lockRunLaunches(): Promise<void>;
  countActiveRuns(): Promise<number>;
  /** @returns The new run's id. */
  insertRun(newRun: NewRun): Promise<string>;
  insertRunSkillVersions(runId: string, skillVersionIds: readonly string[]): Promise<void>;
  listRuns(query: RunListQuery): Promise<RunListPage>;
  findRunDetail(runId: string): Promise<RunDetail | undefined>;
  /** Moves a queued run to `starting`. @returns Whether it was still queued. */
  markRunStarting(runId: string): Promise<boolean>;
  /** Moves a starting run to `running`. @returns Whether it was still starting. */
  markRunRunning(runId: string, sandboxId: string): Promise<boolean>;
  /** Stores the CLI's session id, and its model if the run had none set. */
  recordProviderSession(
    runId: string,
    providerSessionId: string | null,
    model: string | null,
  ): Promise<void>;
  /** Adds usage to the run's totals. Cost is added only when the delta has one. */
  addRunUsage(runId: string, usage: RunUsageDelta): Promise<void>;
  /** Ends an active run. @returns Whether the run was still active. */
  completeRun(runId: string, completion: RunCompletion): Promise<boolean>;
  /** Fails every active run, e.g. after a restart. @returns Their ids. */
  failActiveRuns(errorMessage: string): Promise<string[]>;
  insertRunEvent(newEvent: NewRunEvent): Promise<RunEvent>;
  /** The highest sequence number stored for a run, or -1 if it has no events. */
  findLastSequenceNumber(runId: string): Promise<number>;
  /** Events with a sequence number above `after`, oldest first. */
  listRunEvents(runId: string, after: number, limit: number): Promise<RunEvent[]>;
  getAgentUsage(agentId: string): Promise<AgentUsage>;
}

/**
 * Creates the runs repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createRunsRepository(database: DatabaseExecutor): RunsRepository {
  function selectRunSummaries() {
    return database('agent_runs')
      .join('agents', 'agents.id', 'agent_runs.agent_id')
      .join('agent_providers', 'agent_providers.id', 'agent_runs.provider_id')
      .leftJoin('users', 'users.id', 'agent_runs.triggered_by')
      .select(
        'agent_runs.*',
        'agents.name AS agent_name',
        'agent_providers.slug AS provider_slug',
        'users.username AS triggered_by_username',
      );
  }

  async function listRunSkillVersions(runId: string): Promise<RunSkillVersion[]> {
    const rows = await database('agent_run_skill_versions')
      .join('skill_versions', 'skill_versions.id', 'agent_run_skill_versions.skill_version_id')
      .join('skills', 'skills.id', 'skill_versions.skill_id')
      .where('agent_run_skill_versions.run_id', runId)
      .orderBy('skills.slug')
      .select<RunSkillVersionRow[]>(
        'skill_versions.id AS skill_version_id',
        'skills.id AS skill_id',
        'skills.slug AS skill_slug',
        'skill_versions.version',
        'skill_versions.content_hash',
      );
    return rows.map(mapRunSkillVersionRow);
  }

  async function updateRunIfStatus(
    runId: string,
    expectedStatuses: readonly RunStatus[],
    changes: Record<string, unknown>,
  ): Promise<boolean> {
    const updatedCount = await database('agent_runs')
      .where({ id: runId })
      .whereIn('status', expectedStatuses)
      .update(changes);
    return updatedCount > 0;
  }

  return {
    async lockRunLaunches() {
      await database.raw('SELECT pg_advisory_xact_lock(?)', [RUN_LAUNCH_ADVISORY_LOCK_KEY]);
    },

    async countActiveRuns() {
      const [row] = await database('agent_runs')
        .whereIn('status', ACTIVE_RUN_STATUSES)
        .count<{ count: number }[]>({ count: '*' });
      return row?.count ?? 0;
    },

    async insertRun(newRun) {
      const [row] = await database('agent_runs')
        .insert({
          agent_id: newRun.agentId,
          provider_id: newRun.providerId,
          triggered_by: newRun.triggeredBy,
          prompt: toStorableText(newRun.prompt),
          model: newRun.model,
        })
        .returning<{ id: string }[]>('id');
      if (row === undefined) {
        throw new Error('Inserting a run returned no row');
      }
      return row.id;
    },

    async insertRunSkillVersions(runId, skillVersionIds) {
      if (skillVersionIds.length === 0) {
        return;
      }
      await database('agent_run_skill_versions').insert(
        skillVersionIds.map((skillVersionId) => ({
          run_id: runId,
          skill_version_id: skillVersionId,
        })),
      );
    },

    async listRuns(query) {
      const pageQuery = selectRunSummaries()
        .orderBy('agent_runs.id', 'desc')
        // One extra row tells us whether another page exists.
        .limit(query.limit + 1);
      if (query.before !== undefined) {
        pageQuery.where('agent_runs.id', '<', query.before);
      }
      if (query.agentId !== undefined) {
        pageQuery.where('agent_runs.agent_id', query.agentId);
      }
      if (query.status !== undefined) {
        pageQuery.where('agent_runs.status', query.status);
      }
      const rows = (await pageQuery) as RunSummaryRow[];
      const hasMore = rows.length > query.limit;
      const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
      return {
        items: pageRows.map(mapRunSummaryRow),
        nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
      };
    },

    async findRunDetail(runId) {
      const row = (await selectRunSummaries().where('agent_runs.id', runId).first()) as
        RunDetailRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      return {
        ...mapRunSummaryRow(row),
        prompt: row.prompt,
        sandboxId: row.sandbox_id,
        providerSessionId: row.provider_session_id,
        skillVersions: await listRunSkillVersions(runId),
      };
    },

    markRunStarting: (runId) => updateRunIfStatus(runId, ['queued'], { status: 'starting' }),

    markRunRunning: (runId, sandboxId) =>
      updateRunIfStatus(runId, ['starting'], {
        status: 'running',
        sandbox_id: sandboxId,
        started_at: database.fn.now(),
      }),

    async recordProviderSession(runId, providerSessionId, model) {
      await database('agent_runs')
        .where({ id: runId })
        .update({
          provider_session_id: providerSessionId,
          model: database.raw('coalesce(model, ?)', [model]),
        });
    },

    async addRunUsage(runId, usage) {
      const changes: Record<string, unknown> = {
        input_tokens: database.raw('coalesce(input_tokens, 0) + ?', [usage.inputTokens]),
        output_tokens: database.raw('coalesce(output_tokens, 0) + ?', [usage.outputTokens]),
        cache_read_tokens: database.raw('coalesce(cache_read_tokens, 0) + ?', [
          usage.cacheReadTokens,
        ]),
        cache_write_tokens: database.raw('coalesce(cache_write_tokens, 0) + ?', [
          usage.cacheWriteTokens,
        ]),
      };
      if (usage.costMicroUsd !== null && usage.costSource !== null) {
        changes.cost_micro_usd = database.raw('coalesce(cost_micro_usd, 0) + ?', [
          usage.costMicroUsd,
        ]);
        changes.cost_source = usage.costSource;
      }
      await database('agent_runs').where({ id: runId }).update(changes);
    },

    completeRun: (runId, completion) =>
      updateRunIfStatus(runId, ACTIVE_RUN_STATUSES, {
        status: completion.status,
        exit_code: completion.exitCode,
        error_message: toStorableText(completion.errorMessage),
        ended_at: database.fn.now(),
      }),

    async failActiveRuns(errorMessage) {
      const rows = await database('agent_runs')
        .whereIn('status', ACTIVE_RUN_STATUSES)
        .update({ status: 'failed', error_message: errorMessage, ended_at: database.fn.now() })
        .returning<{ id: string }[]>('id');
      return rows.map((row) => row.id);
    },

    async insertRunEvent(newEvent) {
      const [row] = await database('run_events')
        .insert({
          run_id: newEvent.runId,
          sequence_number: newEvent.sequenceNumber,
          event_type: newEvent.data.type,
          payload: toStorableJson(newEvent.data.payload),
          raw_payload: newEvent.rawPayload === null ? null : toStorableJson(newEvent.rawPayload),
          occurred_at: newEvent.occurredAt,
        })
        .returning<RunEventRow[]>([
          'run_id',
          'sequence_number',
          'event_type',
          'payload',
          'occurred_at',
          'received_at',
        ]);
      if (row === undefined) {
        throw new Error('Inserting a run event returned no row');
      }
      return mapRunEventRow(row);
    },

    async findLastSequenceNumber(runId) {
      const [row] = await database('run_events')
        .where({ run_id: runId })
        .max<{ last_sequence_number: number | null }[]>({
          last_sequence_number: 'sequence_number',
        });
      return row?.last_sequence_number ?? -1;
    },

    async listRunEvents(runId, after, limit) {
      const rows = await database<RunEventRow>('run_events')
        .where({ run_id: runId })
        .where('sequence_number', '>', after)
        .orderBy('sequence_number')
        .limit(limit)
        .select('run_id', 'sequence_number', 'event_type', 'payload', 'occurred_at', 'received_at');
      return rows.map(mapRunEventRow);
    },

    async getAgentUsage(agentId) {
      const result = await database.raw<{ rows: AgentUsageRow[] }>(
        `SELECT
           count(*) AS run_count,
           count(*) FILTER (WHERE status IN (${ACTIVE_STATUS_SQL_LIST})) AS active_run_count,
           coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
           coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
           coalesce(sum(cache_read_tokens), 0)::bigint AS cache_read_tokens,
           coalesce(sum(cache_write_tokens), 0)::bigint AS cache_write_tokens,
           coalesce(sum(cost_micro_usd), 0)::bigint AS cost_micro_usd,
           coalesce(sum(cost_micro_usd) FILTER (
             WHERE queued_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           ), 0)::bigint AS month_to_date_cost_micro_usd,
           count(*) FILTER (
             WHERE cost_micro_usd IS NULL
               AND coalesce(input_tokens, 0) + coalesce(output_tokens, 0) > 0
           ) AS unpriced_run_count
         FROM agent_runs
         WHERE agent_id = ?`,
        [agentId],
      );
      const [row] = result.rows;
      if (row === undefined) {
        throw new Error('Aggregating agent usage returned no row');
      }
      return {
        runCount: row.run_count,
        activeRunCount: row.active_run_count,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheWriteTokens: row.cache_write_tokens,
        costMicroUsd: row.cost_micro_usd,
        monthToDateCostMicroUsd: row.month_to_date_cost_micro_usd,
        unpricedRunCount: row.unpriced_run_count,
      };
    },
  };
}
