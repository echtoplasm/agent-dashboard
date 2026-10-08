/**
 * Looks up the adapter for a provider.
 *
 * This is the one place a new provider's adapter is registered. The record
 * is keyed by every `ProviderSlug`, so adding a slug in the shared package
 * without an adapter fails to compile.
 */
import type { ProviderSlug } from '@agent-dashboard/shared';
import type { AgentAdapter } from './agent-adapter.js';
import { claudeCodeAdapter } from './claude-code.adapter.js';
import { codexAdapter } from './codex.adapter.js';

const ADAPTERS_BY_PROVIDER_SLUG: Record<ProviderSlug, AgentAdapter> = {
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
};

/**
 * Returns the adapter for a provider.
 *
 * Takes a plain string because provider rows only have a format check in
 * the database (D-009), so a row may name a provider this build can't run.
 *
 * @param providerSlug - The provider's slug.
 * @returns Its adapter, or undefined if there is none.
 */
export function findAgentAdapter(providerSlug: string): AgentAdapter | undefined {
  return Object.hasOwn(ADAPTERS_BY_PROVIDER_SLUG, providerSlug)
    ? ADAPTERS_BY_PROVIDER_SLUG[providerSlug as ProviderSlug]
    : undefined;
}
