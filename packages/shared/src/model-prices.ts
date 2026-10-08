/**
 * Model price contracts and cost estimation.
 *
 * Claude Code reports each run's cost itself. Codex only reports token
 * counts, so its cost is estimated from a price table that admins maintain,
 * because prices change and the app should not guess them. A model with no
 * price gets no cost, and usage totals say how many runs are unpriced.
 */
import { z } from 'zod';
import {
  IsoDateTimeSchema,
  MicroUsdSchema,
  UuidSchema,
  createListResponseSchema,
} from './common.js';
import { ModelNameSchema } from './agents.js';

/** Prices are quoted per this many tokens, as providers publish them. */
export const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** Per-million-token prices for one model, in micro-USD. */
const ModelPriceFieldsSchema = z.strictObject({
  inputMicroUsdPerMillionTokens: MicroUsdSchema,
  cachedInputMicroUsdPerMillionTokens: MicroUsdSchema,
  outputMicroUsdPerMillionTokens: MicroUsdSchema,
});

/** A model price as returned by the API. */
export const ModelPriceSchema = z.object({
  id: UuidSchema,
  providerId: UuidSchema,
  model: z.string(),
  inputMicroUsdPerMillionTokens: z.number().int(),
  cachedInputMicroUsdPerMillionTokens: z.number().int(),
  outputMicroUsdPerMillionTokens: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** A model price. */
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

/** List of model prices. */
export const ModelPriceListResponseSchema = createListResponseSchema(ModelPriceSchema);

/** Body of `PUT /api/model-prices`: creates or replaces the price of one model. */
export const SetModelPriceRequestSchema = ModelPriceFieldsSchema.extend({
  providerId: UuidSchema,
  model: ModelNameSchema,
});

/** Body of `PUT /api/model-prices`. */
export type SetModelPriceRequest = z.infer<typeof SetModelPriceRequestSchema>;

/** Token counts to price. */
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** The price fields used by {@link estimateCostMicroUsd}. */
export type ModelPriceRates = Pick<
  ModelPrice,
  | 'inputMicroUsdPerMillionTokens'
  | 'cachedInputMicroUsdPerMillionTokens'
  | 'outputMicroUsdPerMillionTokens'
>;

/**
 * Estimates the cost of some token usage.
 *
 * `inputTokens` must exclude cached tokens, which are priced separately.
 *
 * @param tokenCounts - Uncached input, cached input and output tokens.
 * @param rates - The model's prices.
 * @returns The cost in micro-USD, rounded to the nearest micro-dollar.
 *
 * @example
 * ```ts
 * // 1M input tokens at $1.25/M is 1_250_000 micro-USD.
 * estimateCostMicroUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }, rates);
 * ```
 */
export function estimateCostMicroUsd(tokenCounts: TokenCounts, rates: ModelPriceRates): number {
  const totalTokenPrice =
    tokenCounts.inputTokens * rates.inputMicroUsdPerMillionTokens +
    tokenCounts.cacheReadTokens * rates.cachedInputMicroUsdPerMillionTokens +
    tokenCounts.outputTokens * rates.outputMicroUsdPerMillionTokens;
  return Math.round(totalTokenPrice / TOKENS_PER_PRICE_UNIT);
}
