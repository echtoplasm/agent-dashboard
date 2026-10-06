/**
 * Internal types for the skills module.
 */
import type { Skill, SkillPermissionsManifest, SkillVersionSummary } from '@agent-dashboard/shared';

/**
 * A skill as stored, with every published version string. The service picks
 * the highest one as `latestVersion`, since semver order can't be computed
 * with a plain SQL sort.
 */
export interface SkillRecord extends Omit<Skill, 'latestVersion'> {
  publishedVersions: string[];
}

/** A skill version as stored, including where its files live. */
export interface SkillVersionRecord extends SkillVersionSummary {
  /** Relative to `SKILL_STORAGE_DIR`, e.g. `<skillId>/1.2.0`. Never returned by the API. */
  storagePath: string;
}

/** Fields needed to record a published version. */
export interface NewSkillVersion {
  skillId: string;
  version: string;
  contentHash: string;
  storagePath: string;
  permissionsManifest: SkillPermissionsManifest;
  changelog: string;
  publishedBy: string | null;
}
