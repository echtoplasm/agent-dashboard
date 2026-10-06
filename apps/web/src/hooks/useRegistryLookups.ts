/**
 * Loads providers and sandbox profiles, which several pages need to show
 * names for ids and to fill select boxes.
 */
import type { Provider, SandboxProfile } from '@agent-dashboard/shared';
import { listProviders, listSandboxProfiles } from '../api/endpoints.js';
import type { ApiResource } from './useApiResource.js';
import { useApiResource } from './useApiResource.js';

/** Providers and sandbox profiles, including archived profiles for name lookups. */
export interface RegistryLookups {
  providers: Provider[];
  sandboxProfiles: SandboxProfile[];
}

/**
 * Loads both lists in one resource.
 *
 * @returns The lookups resource.
 */
export function useRegistryLookups(): ApiResource<RegistryLookups> {
  return useApiResource(async () => {
    const [providers, sandboxProfiles] = await Promise.all([
      listProviders(),
      listSandboxProfiles(true),
    ]);
    return { providers, sandboxProfiles };
  }, 'registry-lookups');
}

/**
 * Finds a display name by id, falling back to the id itself.
 *
 * @param items - Rows with an id and a name-like field.
 * @param id - The id to look up.
 * @param getName - Picks the display name.
 * @returns The name, or the id when not found.
 */
export function findNameById<Item extends { id: string }>(
  items: Item[],
  id: string,
  getName: (item: Item) => string,
): string {
  const item = items.find((candidate) => candidate.id === id);
  return item === undefined ? id : getName(item);
}
