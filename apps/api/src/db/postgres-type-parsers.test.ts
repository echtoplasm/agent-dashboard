/**
 * Tests for the Postgres int8 parser.
 */
import { describe, expect, it } from 'vitest';
import { parseSafeInt8, UnsafeIntegerError } from './postgres-type-parsers.js';

describe('parseSafeInt8', () => {
  it('parses int8 text into a number', () => {
    expect(parseSafeInt8('1234567890123')).toBe(1_234_567_890_123);
  });

  it('parses negative values', () => {
    expect(parseSafeInt8('-42')).toBe(-42);
  });

  it('accepts the largest safe integer', () => {
    expect(parseSafeInt8(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws instead of silently losing precision', () => {
    expect(() => parseSafeInt8('9223372036854775807')).toThrow(UnsafeIntegerError);
  });
});
