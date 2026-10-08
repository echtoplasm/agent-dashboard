/**
 * Tests for run display formatting.
 */
import { describe, expect, it } from 'vitest';
import {
  describeRunDuration,
  formatDuration,
  formatRunCost,
  formatTokenCount,
} from './run-formatting.js';

describe('formatDuration', () => {
  it.each([
    [850, '850ms'],
    [42_000, '42s'],
    [185_000, '3m 05s'],
    [3_720_000, '1h 02m'],
  ])('formats %d ms as %s', (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});

describe('describeRunDuration', () => {
  it('measures from start to end', () => {
    expect(
      describeRunDuration({
        startedAt: '2026-10-08T10:00:00.000Z',
        endedAt: '2026-10-08T10:01:30.000Z',
      }),
    ).toBe('1m 30s');
  });

  it('measures an active run up to now', () => {
    expect(
      describeRunDuration(
        { startedAt: '2026-10-08T10:00:00.000Z', endedAt: null },
        new Date('2026-10-08T10:00:12.000Z'),
      ),
    ).toBe('12s');
  });

  it('shows a dash for a run that never started', () => {
    expect(describeRunDuration({ startedAt: null, endedAt: null })).toBe('—');
  });
});

describe('formatRunCost', () => {
  it('marks estimated costs', () => {
    expect(formatRunCost({ costMicroUsd: 11_091, costSource: 'estimated' })).toBe(
      '~$0.011091 (estimated)',
    );
  });

  it('shows reported costs plainly', () => {
    expect(formatRunCost({ costMicroUsd: 12_500, costSource: 'provider_reported' })).toBe(
      '$0.0125',
    );
  });

  it('shows a dash when the cost is unknown', () => {
    expect(formatRunCost({ costMicroUsd: null, costSource: null })).toBe('—');
  });
});

describe('formatTokenCount', () => {
  it('adds separators', () => {
    expect(formatTokenCount(41_417)).toBe('41,417');
    expect(formatTokenCount(null)).toBe('—');
  });
});
