/**
 * Tests for cost estimation.
 */
import { describe, expect, it } from 'vitest';
import { estimateCostMicroUsd } from './model-prices.js';

const RATES = {
  inputMicroUsdPerMillionTokens: 1_250_000,
  cachedInputMicroUsdPerMillionTokens: 125_000,
  outputMicroUsdPerMillionTokens: 10_000_000,
};

describe('estimateCostMicroUsd', () => {
  it('prices uncached input, cached input and output separately', () => {
    const cost = estimateCostMicroUsd(
      { inputTokens: 4_297, cacheReadTokens: 37_120, outputTokens: 108 },
      RATES,
    );
    // 4297 × 1.25 + 37120 × 0.125 + 108 × 10 = 5371.25 + 4640 + 1080
    expect(cost).toBe(11_091);
  });

  it('is zero for no usage', () => {
    expect(
      estimateCostMicroUsd({ inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, RATES),
    ).toBe(0);
  });
});
