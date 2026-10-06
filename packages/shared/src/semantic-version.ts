/**
 * Parsing and ordering of semantic versions (`MAJOR.MINOR.PATCH[-PRERELEASE]`).
 *
 * Skill versions must increase over time, so the API needs to compare them.
 * Build metadata (`+build`) is not supported, matching the database CHECK.
 */
import { z } from 'zod';

/** Same pattern as the `skill_versions_version_format_check` constraint. */
const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/;

const NUMERIC_IDENTIFIER_PATTERN = /^[0-9]+$/;

/** Validates a semantic version string such as `1.2.0` or `2.0.0-beta.1`. */
export const SemanticVersionSchema = z
  .string()
  .regex(SEMANTIC_VERSION_PATTERN, 'Must be a semantic version such as 1.0.0');

/** The parts of a semantic version. */
export interface ParsedSemanticVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers; empty for a release version. */
  prereleaseIdentifiers: string[];
}

/** Thrown when a string is not a valid semantic version. */
export class InvalidSemanticVersionError extends Error {
  constructor(version: string) {
    super(`"${version}" is not a valid semantic version`);
    this.name = 'InvalidSemanticVersionError';
  }
}

/**
 * Splits a semantic version string into its parts.
 *
 * @param version - e.g. `1.4.0-rc.2`.
 * @returns The parsed version.
 * @throws {InvalidSemanticVersionError} If the string is not a semantic version.
 */
export function parseSemanticVersion(version: string): ParsedSemanticVersion {
  const match = SEMANTIC_VERSION_PATTERN.exec(version);
  if (match === null) {
    throw new InvalidSemanticVersionError(version);
  }
  const [, major = '', minor = '', patch = '', prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prereleaseIdentifiers: prerelease === undefined ? [] : prerelease.split('.'),
  };
}

/** Orders two pre-release identifiers: numeric ones numerically, and below text ones. */
function comparePrereleaseIdentifiers(left: string, right: string): number {
  const isLeftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(left);
  const isRightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(right);
  if (isLeftNumeric && isRightNumeric) {
    return Number(left) - Number(right);
  }
  if (isLeftNumeric !== isRightNumeric) {
    return isLeftNumeric ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Orders pre-release lists; a release (empty list) sorts after any pre-release. */
function comparePrereleases(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return right.length - left.length;
  }
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = comparePrereleaseIdentifiers(left[index] ?? '', right[index] ?? '');
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

/**
 * Compares two semantic versions using semver precedence rules.
 *
 * @param left - First version.
 * @param right - Second version.
 * @returns A negative number if `left` is lower, positive if higher, 0 if equal.
 * @throws {InvalidSemanticVersionError} If either string is not a semantic version.
 *
 * @example
 * ```ts
 * compareSemanticVersions('1.0.0-beta', '1.0.0'); // < 0
 * compareSemanticVersions('1.10.0', '1.9.0');     // > 0
 * ```
 */
export function compareSemanticVersions(left: string, right: string): number {
  const parsedLeft = parseSemanticVersion(left);
  const parsedRight = parseSemanticVersion(right);
  return (
    parsedLeft.major - parsedRight.major ||
    parsedLeft.minor - parsedRight.minor ||
    parsedLeft.patch - parsedRight.patch ||
    comparePrereleases(parsedLeft.prereleaseIdentifiers, parsedRight.prereleaseIdentifiers)
  );
}
