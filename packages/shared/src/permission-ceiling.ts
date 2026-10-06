/**
 * Checks a skill's permissions manifest against a sandbox profile's ceiling.
 *
 * A skill may never be granted more than the sandbox profile allows. The API
 * checks this when a skill is assigned to an agent and whenever a change to
 * the agent, profile or skill could break an existing assignment. The sandbox
 * enforces it again at runtime (Phase 4).
 */
import type { FieldProblem } from './api-errors.js';
import type { SkillPermissionsManifest } from './skill-permissions-manifest.js';

/** The permission fields of a sandbox profile. */
export interface PermissionCeiling {
  isNetworkAllowed: boolean;
  allowedNetworkHosts: readonly string[];
  writablePaths: readonly string[];
  allowedCommands: readonly string[];
}

const WILDCARD_PREFIX = '*.';

/**
 * Reports whether a profile host entry permits a requested host.
 *
 * `*.github.com` covers `api.github.com` and `*.api.github.com`, but not
 * `github.com` itself.
 *
 * @param allowedHost - A host entry from the profile.
 * @param requestedHost - A host the manifest asks for.
 * @returns `true` if the request is covered.
 */
export function isHostCovered(allowedHost: string, requestedHost: string): boolean {
  if (allowedHost === requestedHost) {
    return true;
  }
  if (!allowedHost.startsWith(WILDCARD_PREFIX)) {
    return false;
  }
  const allowedSuffix = allowedHost.slice(WILDCARD_PREFIX.length - 1);
  return requestedHost.endsWith(allowedSuffix);
}

/**
 * Reports whether a profile path entry permits writing to a requested path:
 * the same directory or anything beneath it.
 *
 * @param allowedPath - A writable path from the profile.
 * @param requestedPath - A writable path the manifest asks for.
 * @returns `true` if the request is covered.
 */
export function isPathCovered(allowedPath: string, requestedPath: string): boolean {
  const normalizedAllowed = allowedPath.replace(/\/+$/, '');
  const normalizedRequested = requestedPath.replace(/\/+$/, '');
  return (
    normalizedRequested === normalizedAllowed ||
    normalizedRequested.startsWith(`${normalizedAllowed}/`)
  );
}

/**
 * Lists every way a manifest exceeds a profile's ceiling.
 *
 * @param manifest - The skill version's validated permissions manifest.
 * @param ceiling - The sandbox profile's permission fields.
 * @returns One problem per excess permission; empty when the manifest fits.
 *
 * @example
 * ```ts
 * findPermissionCeilingViolations(manifest, profile)
 * // [{ path: 'network.allowedHosts', message: 'Host "evil.example" is not allowed by the sandbox profile' }]
 * ```
 */
export function findPermissionCeilingViolations(
  manifest: SkillPermissionsManifest,
  ceiling: PermissionCeiling,
): FieldProblem[] {
  const violations: FieldProblem[] = [];

  if (manifest.network.isAllowed && !ceiling.isNetworkAllowed) {
    violations.push({
      path: 'network.isAllowed',
      message: 'The skill needs network access but the sandbox profile disallows it',
    });
  }
  for (const requestedHost of manifest.network.allowedHosts) {
    const isCovered = ceiling.allowedNetworkHosts.some((allowedHost) =>
      isHostCovered(allowedHost, requestedHost),
    );
    if (!isCovered) {
      violations.push({
        path: 'network.allowedHosts',
        message: `Host "${requestedHost}" is not allowed by the sandbox profile`,
      });
    }
  }

  for (const requestedPath of manifest.filesystem.writablePaths) {
    const isCovered = ceiling.writablePaths.some((allowedPath) =>
      isPathCovered(allowedPath, requestedPath),
    );
    if (!isCovered) {
      violations.push({
        path: 'filesystem.writablePaths',
        message: `Writing to "${requestedPath}" is not allowed by the sandbox profile`,
      });
    }
  }

  for (const requestedCommand of manifest.commands.allowedCommands) {
    if (!ceiling.allowedCommands.includes(requestedCommand)) {
      violations.push({
        path: 'commands.allowedCommands',
        message: `Command "${requestedCommand}" is not allowed by the sandbox profile`,
      });
    }
  }

  return violations;
}
