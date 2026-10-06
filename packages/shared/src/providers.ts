/**
 * Agent provider identifiers.
 *
 * A provider is a backend CLI that can run an agent (Claude Code, Codex).
 * Adding a provider means adding its slug here and writing one adapter.
 */
import { z } from 'zod';

/** Slugs of every supported agent provider, as stored in `agent_providers.slug`. */
export const PROVIDER_SLUGS = ['claude_code', 'codex'] as const;

/** Validates a provider slug. */
export const ProviderSlugSchema = z.enum(PROVIDER_SLUGS);

/** A supported agent provider slug. */
export type ProviderSlug = z.infer<typeof ProviderSlugSchema>;
