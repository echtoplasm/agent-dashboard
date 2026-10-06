/**
 * Internal types for the sandbox profiles module.
 */
import type { SandboxProfile } from '@agent-dashboard/shared';

/** Every editable field of a sandbox profile. */
export type SandboxProfileFields = Omit<
  SandboxProfile,
  'id' | 'archivedAt' | 'createdAt' | 'updatedAt'
>;
