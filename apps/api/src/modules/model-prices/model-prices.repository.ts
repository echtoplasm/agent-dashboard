/**
 * Data access for `model_prices`.
 */
import type { ModelPrice, SetModelPriceRequest } from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { toIsoString } from '../../db/row-mapping.js';

interface ModelPriceRow {
  id: string;
  provider_id: string;
  model: string;
  input_micro_usd_per_million_tokens: number;
  cached_input_micro_usd_per_million_tokens: number;
  output_micro_usd_per_million_tokens: number;
  created_at: Date;
  updated_at: Date;
}

function mapModelPriceRow(row: ModelPriceRow): ModelPrice {
  return {
    id: row.id,
    providerId: row.provider_id,
    model: row.model,
    inputMicroUsdPerMillionTokens: row.input_micro_usd_per_million_tokens,
    cachedInputMicroUsdPerMillionTokens: row.cached_input_micro_usd_per_million_tokens,
    outputMicroUsdPerMillionTokens: row.output_micro_usd_per_million_tokens,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

/** Data access for model prices. */
export interface ModelPricesRepository {
  listModelPrices(): Promise<ModelPrice[]>;
  findModelPrice(providerId: string, model: string): Promise<ModelPrice | undefined>;
  /** Creates the price, or replaces the existing price of the same provider and model. */
  upsertModelPrice(price: SetModelPriceRequest): Promise<ModelPrice>;
  /** @returns The deleted price, if it existed. */
  deleteModelPrice(modelPriceId: string): Promise<ModelPrice | undefined>;
}

/**
 * Creates the model prices repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createModelPricesRepository(database: DatabaseExecutor): ModelPricesRepository {
  return {
    async listModelPrices() {
      const rows = await database<ModelPriceRow>('model_prices').orderBy(['provider_id', 'model']);
      return rows.map(mapModelPriceRow);
    },

    async findModelPrice(providerId, model) {
      const row = await database<ModelPriceRow>('model_prices')
        .where({ provider_id: providerId, model })
        .first();
      return row === undefined ? undefined : mapModelPriceRow(row);
    },

    async upsertModelPrice(price) {
      const prices = {
        input_micro_usd_per_million_tokens: price.inputMicroUsdPerMillionTokens,
        cached_input_micro_usd_per_million_tokens: price.cachedInputMicroUsdPerMillionTokens,
        output_micro_usd_per_million_tokens: price.outputMicroUsdPerMillionTokens,
      };
      const [row] = await database<ModelPriceRow>('model_prices')
        .insert({ provider_id: price.providerId, model: price.model, ...prices })
        .onConflict(['provider_id', 'model'])
        .merge(prices)
        .returning('*');
      if (row === undefined) {
        throw new Error('Upserting a model price returned no row');
      }
      return mapModelPriceRow(row);
    },

    async deleteModelPrice(modelPriceId) {
      const [row] = await database<ModelPriceRow>('model_prices')
        .where({ id: modelPriceId })
        .delete()
        .returning('*');
      return row === undefined ? undefined : mapModelPriceRow(row);
    },
  };
}
