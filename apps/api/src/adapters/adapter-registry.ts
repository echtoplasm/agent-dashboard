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
 * @param providerSlug - The provider's slug.
 * @returns Its adapter.
 */
export function getAgentAdapter(providerSlug: ProviderSlug): AgentAdapter {
  return ADAPTERS_BY_PROVIDER_SLUG[providerSlug];
}
