/**
 * The rules an agent's loadout must always satisfy:
 *
 * 1. Every assigned skill supports the agent's provider.
 * 2. Every assigned version's permissions manifest fits within the agent's
 *    sandbox profile (see `findPermissionCeilingViolations`).
 *
 * They are checked when a skill is assigned, and again whenever a change
 * elsewhere could break an existing loadout: changing an agent's provider
 * or profile, narrowing a profile, or removing a provider from a skill.
 */
import type { FieldProblem, PermissionCeiling } from '@agent-dashboard/shared';
import { findPermissionCeilingViolations } from '@agent-dashboard/shared';
import type { Repositories } from '../../db/data-access.js';
import { ConflictError } from '../../errors/app-errors.js';
import type { LoadoutEntry } from './assignments.types.js';

/**
 * Lists every way one loadout entry breaks the rules for an agent.
 *
 * @param entry - The assigned skill version.
 * @param providerId - The agent's provider.
 * @param ceiling - The agent's sandbox profile permissions.
 * @returns Problems, each prefixed with the skill name and version; empty when the entry fits.
 */
export function findLoadoutEntryProblems(
  entry: LoadoutEntry,
  providerId: string,
  ceiling: PermissionCeiling,
): FieldProblem[] {
  const label = `${entry.skillName} ${entry.version}`;
  const problems: FieldProblem[] = [];
  if (!entry.supportedProviderIds.includes(providerId)) {
    problems.push({ path: 'providerId', message: `${label} does not support this provider` });
  }
  for (const violation of findPermissionCeilingViolations(entry.permissionsManifest, ceiling)) {
    problems.push({ path: violation.path, message: `${label}: ${violation.message}` });
  }
  return problems;
}

/**
 * Checks that an agent's whole loadout still fits a (possibly new) provider
 * and sandbox profile.
 *
 * @param repositories - Repositories in the current transaction.
 * @param agent - The agent's id plus the provider and profile to check against.
 * @param ceiling - The sandbox profile's permissions to check against.
 * @throws {ConflictError} Listing every problem, if any assigned skill no longer fits.
 */
export async function assertLoadoutFits(
  repositories: Repositories,
  agent: { id: string; name: string; providerId: string },
  ceiling: PermissionCeiling,
): Promise<void> {
  const entries = await repositories.assignments.listLoadoutEntries(agent.id);
  const problems = entries.flatMap((entry) =>
    findLoadoutEntryProblems(entry, agent.providerId, ceiling),
  );
  if (problems.length > 0) {
    throw new ConflictError(
      `This change would break skills assigned to agent "${agent.name}"; unassign or update them first`,
      problems,
    );
  }
}
