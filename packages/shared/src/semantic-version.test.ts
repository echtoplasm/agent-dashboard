/**
 * Tests for semantic version parsing and ordering.
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidSemanticVersionError,
  compareSemanticVersions,
  parseSemanticVersion,
} from './semantic-version.js';

describe('parseSemanticVersion', () => {
  it('parses a release version', () => {
    expect(parseSemanticVersion('1.20.3')).toEqual({
      major: 1,
      minor: 20,
      patch: 3,
      prereleaseIdentifiers: [],
    });
  });

  it('parses pre-release identifiers', () => {
    expect(parseSemanticVersion('2.0.0-rc.1').prereleaseIdentifiers).toEqual(['rc', '1']);
  });

  it.each(['1.0', 'v1.0.0', '01.0.0', '1.0.0+build'])('rejects %j', (version) => {
    expect(() => parseSemanticVersion(version)).toThrow(InvalidSemanticVersionError);
  });
});

describe('compareSemanticVersions', () => {
  it('orders versions by precedence, matching the semver spec example', () => {
    const versionsInOrder = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.9.0',
      '1.10.0',
      '2.0.0',
    ];

    const shuffled = [...versionsInOrder].reverse();
    expect(shuffled.sort(compareSemanticVersions)).toEqual(versionsInOrder);
  });

  it('treats identical versions as equal', () => {
    expect(compareSemanticVersions('1.2.3-rc.1', '1.2.3-rc.1')).toBe(0);
  });
});
