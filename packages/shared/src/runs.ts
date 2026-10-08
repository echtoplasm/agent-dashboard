/**
 * Agent run contracts: lifecycle values, the run resource and the API
 * requests that launch, list and cancel runs.
 *
 * The normalized events a run streams live in `run-events.ts`.
 */
import { z } from 'zod';
import { IsoDateTimeSchema, MicroUsdSchema, UuidSchema } from './common.js';
import { ProviderSlugSchema } from './providers.js';

/**
 * Every state an agent run can be in, in lifecycle order.
 *
 * `queued` → `starting` → `running` → one of the terminal states.
 */
export const RUN_STATUSES = [
  'queued',
  'starting',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
] as const;

/** Validates a run status. */
export const RunStatusSchema = z.enum(RUN_STATUSES);

/** The lifecycle state of an agent run. */
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Statuses after which a run will never change again. */
export const TERMINAL_RUN_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
] as const satisfies readonly RunStatus[];

/** Statuses of a run that has not finished yet. */
export const ACTIVE_RUN_STATUSES = [
  'queued',
  'starting',
  'running',
] as const satisfies readonly RunStatus[];

/**
 * Reports whether a run has finished and can no longer change state.
 *
 * @param runStatus - The run's current status.
 * @returns `true` for succeeded, failed, cancelled and timed-out runs.
 */
export function isTerminalRunStatus(runStatus: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(runStatus);
}

/**
 * Where a run's cost figure came from.
 *
 * - `provider_reported`: the CLI reported the cost itself (Claude Code).
 * - `estimated`: computed from token counts and the model price table,
 *   because the CLI only reports tokens (Codex).
 */
export const COST_SOURCES = ['provider_reported', 'estimated'] as const;

/** Validates a cost source. */
export const CostSourceSchema = z.enum(COST_SOURCES);

/** Where a run's cost figure came from. */
export type CostSource = z.infer<typeof CostSourceSchema>;

/** Longest prompt accepted when launching a run, in characters. */
export const MAX_RUN_PROMPT_LENGTH = 100_000;

/** Token counts and cost of a run. Null until the provider reports them. */
export const RunUsageSchema = z.object({
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  cacheReadTokens: z.number().int().nullable(),
  cacheWriteTokens: z.number().int().nullable(),
  costMicroUsd: z.number().int().nullable(),
  costSource: CostSourceSchema.nullable(),
});

/** Token counts and cost of a run. */
export type RunUsage = z.infer<typeof RunUsageSchema>;

/** A skill version a run was launched with. */
export const RunSkillVersionSchema = z.object({
  skillVersionId: UuidSchema,
  skillId: UuidSchema,
  skillSlug: z.string(),
  version: z.string(),
  contentHash: z.string(),
});

/** A skill version a run was launched with. */
export type RunSkillVersion = z.infer<typeof RunSkillVersionSchema>;

/** A run as it appears in lists. */
export const RunSummarySchema = RunUsageSchema.extend({
  id: UuidSchema,
  agentId: UuidSchema,
  agentName: z.string(),
  providerId: UuidSchema,
  providerSlug: ProviderSlugSchema,
  triggeredBy: UuidSchema.nullable(),
  /** Username of whoever launched the run, at read time. */
  triggeredByUsername: z.string().nullable(),
  status: RunStatusSchema,
  model: z.string().nullable(),
  queuedAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  endedAt: IsoDateTimeSchema.nullable(),
  exitCode: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
});

/** A run as it appears in lists. */
export type RunSummary = z.infer<typeof RunSummarySchema>;

/** A run with its prompt and the exact skill versions it ran with. */
export const RunDetailSchema = RunSummarySchema.extend({
  prompt: z.string(),
  sandboxId: z.string().nullable(),
  providerSessionId: z.string().nullable(),
  skillVersions: z.array(RunSkillVersionSchema),
});

/** A run with its prompt and skill versions. */
export type RunDetail = z.infer<typeof RunDetailSchema>;

/** Body of `POST /api/runs`. */
export const LaunchRunRequestSchema = z.strictObject({
  agentId: UuidSchema,
  prompt: z
    .string()
    .refine((prompt) => prompt.trim() !== '', 'Enter a prompt')
    .pipe(z.string().max(MAX_RUN_PROMPT_LENGTH)),
});

/** Body of `POST /api/runs`. */
export type LaunchRunRequest = z.infer<typeof LaunchRunRequestSchema>;

/** Default and maximum page size for run lists. */
export const RUN_PAGE_SIZE = { DEFAULT: 25, MAX: 100 } as const;

/** Query parameters of `GET /api/runs`. Pages go backwards in time. */
export const RunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(RUN_PAGE_SIZE.MAX).default(RUN_PAGE_SIZE.DEFAULT),
  /** Return runs older than this run id (the previous page's `nextCursor`). */
  before: UuidSchema.optional(),
  agentId: UuidSchema.optional(),
  status: RunStatusSchema.optional(),
});

/** Query parameters of `GET /api/runs`. */
export type RunListQuery = z.output<typeof RunListQuerySchema>;

/** One page of runs, newest first. */
export const RunListPageSchema = z.object({
  items: z.array(RunSummarySchema),
  /** Pass as `before` to fetch the next (older) page; null on the last page. */
  nextCursor: UuidSchema.nullable(),
});

/** One page of runs. */
export type RunListPage = z.infer<typeof RunListPageSchema>;

/** Totals across an agent's runs, from `GET /api/agents/:id/usage`. */
export const AgentUsageSchema = z.object({
  runCount: z.number().int(),
  activeRunCount: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costMicroUsd: MicroUsdSchema,
  /** Cost of runs queued since the start of the current UTC month. */
  monthToDateCostMicroUsd: MicroUsdSchema,
  /** Runs whose cost is unknown (no price for the model), so totals undercount. */
  unpricedRunCount: z.number().int(),
});

/** Totals across an agent's runs. */
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

/** A file left in a run's workspace. */
export const WorkspaceFileSchema = z.object({
  /** Path relative to the workspace root, with `/` separators. */
  path: z.string(),
  sizeBytes: z.number().int(),
  modifiedAt: IsoDateTimeSchema,
});

/** A file left in a run's workspace. */
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

/** Most files listed for one workspace. */
export const MAX_WORKSPACE_FILES_LISTED = 1_000;

/** Response of `GET /api/runs/:id/workspace`. */
export const WorkspaceListingSchema = z.object({
  items: z.array(WorkspaceFileSchema),
  /** True when the workspace has more files than were listed. */
  isTruncated: z.boolean(),
});

/** Response of `GET /api/runs/:id/workspace`. */
export type WorkspaceListing = z.infer<typeof WorkspaceListingSchema>;

/** Query of `GET /api/runs/:id/workspace/file`. */
export const WorkspaceFileQuerySchema = z.object({
  path: z.string().min(1).max(4_096),
});
