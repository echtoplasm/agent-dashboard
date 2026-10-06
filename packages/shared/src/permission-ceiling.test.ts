/**
 * Tests for checking a skill manifest against a sandbox profile ceiling.
 */
import { describe, expect, it } from 'vitest';
import {
  findPermissionCeilingViolations,
  isHostCovered,
  isPathCovered,
} from './permission-ceiling.js';
import type { PermissionCeiling } from './permission-ceiling.js';
import { SkillPermissionsManifestSchema } from './skill-permissions-manifest.js';

const LOCKED_DOWN_CEILING: PermissionCeiling = {
  isNetworkAllowed: false,
  allowedNetworkHosts: [],
  writablePaths: [],
  allowedCommands: [],
};

const PERMISSIVE_CEILING: PermissionCeiling = {
  isNetworkAllowed: true,
  allowedNetworkHosts: ['registry.npmjs.org', '*.github.com'],
  writablePaths: ['build'],
  allowedCommands: ['npm', 'git'],
};

describe('isHostCovered', () => {
  it.each([
    ['registry.npmjs.org', 'registry.npmjs.org', true],
    ['*.github.com', 'api.github.com', true],
    ['*.github.com', '*.api.github.com', true],
    ['*.github.com', 'github.com', false],
    ['*.github.com', 'evilgithub.com', false],
    ['api.github.com', '*.github.com', false],
  ])('%s covers %s: %s', (allowedHost, requestedHost, isExpected) => {
    expect(isHostCovered(allowedHost, requestedHost)).toBe(isExpected);
  });
});

describe('isPathCovered', () => {
  it.each([
    ['build', 'build', true],
    ['build', 'build/output', true],
    ['build/', 'build/output', true],
    ['build', 'builds', false],
    ['build/output', 'build', false],
  ])('%s covers %s: %s', (allowedPath, requestedPath, isExpected) => {
    expect(isPathCovered(allowedPath, requestedPath)).toBe(isExpected);
  });
});

describe('findPermissionCeilingViolations', () => {
  it('accepts an empty manifest under the locked-down ceiling', () => {
    const manifest = SkillPermissionsManifestSchema.parse({ manifestVersion: 1 });

    expect(findPermissionCeilingViolations(manifest, LOCKED_DOWN_CEILING)).toEqual([]);
  });

  it('accepts a manifest that fits within the ceiling', () => {
    const manifest = SkillPermissionsManifestSchema.parse({
      manifestVersion: 1,
      network: { isAllowed: true, allowedHosts: ['api.github.com'] },
      filesystem: { writablePaths: ['build/reports'] },
      commands: { allowedCommands: ['npm'] },
    });

    expect(findPermissionCeilingViolations(manifest, PERMISSIVE_CEILING)).toEqual([]);
  });

  it('reports each excess permission separately', () => {
    const manifest = SkillPermissionsManifestSchema.parse({
      manifestVersion: 1,
      network: { isAllowed: true, allowedHosts: ['evil.example'] },
      filesystem: { writablePaths: ['src'] },
      commands: { allowedCommands: ['curl'] },
    });

    const violations = findPermissionCeilingViolations(manifest, LOCKED_DOWN_CEILING);

    expect(violations.map((violation) => violation.path)).toEqual([
      'network.isAllowed',
      'network.allowedHosts',
      'filesystem.writablePaths',
      'commands.allowedCommands',
    ]);
  });
});
