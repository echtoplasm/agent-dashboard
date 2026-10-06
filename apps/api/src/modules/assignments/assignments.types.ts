/**
 * Internal types for the assignments module.
 */
import type { SkillPermissionsManifest } from '@agent-dashboard/shared';

/** One assigned skill version, with what is needed to check it still fits the agent. */
export interface LoadoutEntry {
  skillId: string;
  skillName: string;
  version: string;
  supportedProviderIds: string[];
  permissionsManifest: SkillPermissionsManifest;
}
