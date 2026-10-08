/**
 * Business rules for model prices.
 *
 * Prices are only used to estimate the cost of runs whose provider reports
 * tokens but not cost. Changing a price never rewrites past runs: a run's
 * cost is fixed when its usage is reported.
 */
import type { ModelPrice, SetModelPriceRequest } from '@agent-dashboard/shared';
import type { DataAccess } from '../../db/data-access.js';
import { NotFoundError, ValidationError } from '../../errors/app-errors.js';
import type { AuditContext } from '../audit/audit.types.js';

/** Model price operations. */
export interface ModelPricesService {
  listModelPrices(): Promise<ModelPrice[]>;
  /** @throws {ValidationError} If the provider does not exist. */
  setModelPrice(input: SetModelPriceRequest, context: AuditContext): Promise<ModelPrice>;
  /** @throws {NotFoundError} */
  deleteModelPrice(modelPriceId: string, context: AuditContext): Promise<void>;
}

/**
 * Creates the model prices service.
 *
 * @param dataAccess - Repositories and the transaction runner.
 * @returns The service.
 */
export function createModelPricesService(dataAccess: DataAccess): ModelPricesService {
  return {
    listModelPrices: () => dataAccess.repositories.modelPrices.listModelPrices(),

    async setModelPrice(input, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        const provider = await repositories.providers.findProviderById(input.providerId);
        if (provider === undefined) {
          throw new ValidationError([{ path: 'providerId', message: 'Unknown provider' }]);
        }
        const modelPrice = await repositories.modelPrices.upsertModelPrice(input);
        await repositories.audit.insertAuditEntry(context, {
          action: 'model_price.set',
          targetType: 'model_price',
          targetId: modelPrice.id,
          metadata: { ...input },
        });
        return modelPrice;
      });
    },

    async deleteModelPrice(modelPriceId, context) {
      await dataAccess.runInTransaction(async (repositories) => {
        const deletedPrice = await repositories.modelPrices.deleteModelPrice(modelPriceId);
        if (deletedPrice === undefined) {
          throw new NotFoundError('Model price not found');
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'model_price.deleted',
          targetType: 'model_price',
          targetId: modelPriceId,
          metadata: { providerId: deletedPrice.providerId, model: deletedPrice.model },
        });
      });
    },
  };
}
