/**
 * Internal types for the runs module.
 */
import type {
  RunEventData,
  RunStatus,
  SkillPermissionsManifest,
  UsageEventPayload,
} from '@agent-dashboard/shared';

/** Fields recorded when a run is created. */
export interface NewRun {
  agentId: string;
  providerId: string;
  triggeredBy: string | null;
  prompt: string;
  model: string | null;
}

/** A skill version as needed to launch a run: identity, integrity and location. */
export interface LaunchSkillVersion {
  skillVersionId: string;
  skillId: string;
  skillSlug: string;
  skillName: string;
  version: string;
  contentHash: string;
  /** Relative to `SKILL_STORAGE_DIR`. */
  storagePath: string;
  supportedProviderIds: string[];
  permissionsManifest: SkillPermissionsManifest;
}

/** An event about to be stored. */
export interface NewRunEvent {
  runId: string;
  sequenceNumber: number;
  data: RunEventData;
  rawPayload: unknown;
  occurredAt: string | null;
}

/** How a run ended. */
export interface RunCompletion {
  status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled' | 'timed_out'>;
  exitCode: number | null;
  errorMessage: string | null;
}

/** Usage to add to a run's totals. */
export type RunUsageDelta = UsageEventPayload;
