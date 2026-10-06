/**
 * Tests for dollar and micro-USD conversion.
 */
import { describe, expect, it } from 'vitest';
import { formatMicroUsd, microUsdToDollarInput, parseDollarsToMicroUsd } from './money.js';

describe('parseDollarsToMicroUsd', () => {
  it.each([
    ['2.5', 2_500_000],
    ['0.1', 100_000],
    ['0.000001', 1],
    ['10', 10_000_000],
    ['  3.25  ', 3_250_000],
  ])('parses %j exactly', (dollarText, expectedMicroUsd) => {
    expect(parseDollarsToMicroUsd(dollarText)).toBe(expectedMicroUsd);
  });

  it('treats blank input as no limit', () => {
    expect(parseDollarsToMicroUsd('   ')).toBeNull();
  });

  it.each(['-1', 'abc', '1.0000001', '$5', '1e3'])('rejects %j', (dollarText) => {
    expect(parseDollarsToMicroUsd(dollarText)).toBeUndefined();
  });
});

describe('formatMicroUsd', () => {
  it('formats dollars with at least two decimals', () => {
    expect(formatMicroUsd(2_500_000)).toBe('$2.50');
  });

  it('keeps sub-cent precision', () => {
    expect(formatMicroUsd(125)).toBe('$0.000125');
  });

  it('shows null as no limit', () => {
    expect(formatMicroUsd(null)).toBe('No limit');
  });
});

describe('microUsdToDollarInput', () => {
  it('round-trips through the parser', () => {
    expect(parseDollarsToMicroUsd(microUsdToDollarInput(2_500_000))).toBe(2_500_000);
  });

  it('turns null into an empty input', () => {
    expect(microUsdToDollarInput(null)).toBe('');
  });
});
