/**
 * Tests for the skill permissions manifest schema.
 */
import { describe, expect, it } from 'vitest';
import { SkillPermissionsManifestSchema } from './skill-permissions-manifest.js';

describe('SkillPermissionsManifestSchema', () => {
  it('fills an empty manifest with the most restrictive defaults', () => {
    const manifest = SkillPermissionsManifestSchema.parse({ manifestVersion: 1 });

    expect(manifest).toEqual({
      manifestVersion: 1,
      network: { isAllowed: false, allowedHosts: [] },
      filesystem: { writablePaths: [] },
      commands: { allowedCommands: [] },
    });
  });

  it('accepts a manifest that requests network, writes and commands', () => {
    const manifest = SkillPermissionsManifestSchema.parse({
      manifestVersion: 1,
      network: { isAllowed: true, allowedHosts: ['registry.npmjs.org', '*.github.com'] },
      filesystem: { writablePaths: ['build', 'reports/coverage'] },
      commands: { allowedCommands: ['npm', 'git'] },
    });

    expect(manifest.network.allowedHosts).toEqual(['registry.npmjs.org', '*.github.com']);
  });

  it('rejects unknown keys so skills cannot request unenforced permissions', () => {
    const result = SkillPermissionsManifestSchema.safeParse({
      manifestVersion: 1,
      isRootAllowed: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unsupported manifest version', () => {
    const result = SkillPermissionsManifestSchema.safeParse({ manifestVersion: 2 });

    expect(result.success).toBe(false);
  });

  it('rejects allowed hosts when network access is off', () => {
    const result = SkillPermissionsManifestSchema.safeParse({
      manifestVersion: 1,
      network: { isAllowed: false, allowedHosts: ['example.com'] },
    });

    expect(result.success).toBe(false);
  });

  it.each(['/etc', '../outside', 'build/../../escape', ''])(
    'rejects writable path %j that could escape the workspace',
    (writablePath) => {
      const result = SkillPermissionsManifestSchema.safeParse({
        manifestVersion: 1,
        filesystem: { writablePaths: [writablePath] },
      });

      expect(result.success).toBe(false);
    },
  );

  it.each(['/usr/bin/curl', 'rm -rf', './script.sh'])(
    'rejects command %j that is not a bare command name',
    (command) => {
      const result = SkillPermissionsManifestSchema.safeParse({
        manifestVersion: 1,
        commands: { allowedCommands: [command] },
      });

      expect(result.success).toBe(false);
    },
  );

  it.each(['Example.com', 'http://example.com', 'example', 'exa mple.com'])(
    'rejects host %j that is not a lowercase hostname',
    (host) => {
      const result = SkillPermissionsManifestSchema.safeParse({
        manifestVersion: 1,
        network: { isAllowed: true, allowedHosts: [host] },
      });

      expect(result.success).toBe(false);
    },
  );
});
