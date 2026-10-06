/**
 * Viewing and toggling agent providers.
 *
 * Providers are seeded, not created through the API: each one needs an
 * adapter in code. Admins can only enable or disable them. Disabling a
 * provider stops new agents from using it; existing agents keep their
 * reference, and launching runs for them is refused in Phase 3.
 */
import type { Provider, UpdateProviderRequest } from '@agent-dashboard/shared';
import type { DataAccess } from '../../db/data-access.js';
import { NotFoundError } from '../../errors/app-errors.js';
import type { AuditContext } from '../audit/audit.types.js';

/** Provider operations. */
export interface ProvidersService {
  listProviders(): Promise<Provider[]>;
  /** @throws {NotFoundError} If the provider does not exist. */
  updateProvider(
    providerId: string,
    changes: UpdateProviderRequest,
    context: AuditContext,
  ): Promise<Provider>;
}

/**
 * Creates the providers service.
 *
 * @param dataAccess - Repositories and the transaction runner.
 * @returns The service.
 */
export function createProvidersService(dataAccess: DataAccess): ProvidersService {
  return {
    listProviders: () => dataAccess.repositories.providers.listProviders(),

    async updateProvider(providerId, changes, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        const updatedProvider = await repositories.providers.setProviderEnabled(
          providerId,
          changes.isEnabled,
        );
        if (updatedProvider === undefined) {
          throw new NotFoundError('Provider not found');
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'provider.updated',
          targetType: 'provider',
          targetId: providerId,
          metadata: { changes },
        });
        return updatedProvider;
      });
    },
  };
}
