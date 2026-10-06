/**
 * Agent provider identifiers and API contracts.
 *
 * A provider is a backend CLI that can run an agent (Claude Code, Codex).
 * Adding a provider means adding its slug here and writing one adapter.
 */
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema, createListResponseSchema } from './common.js';

/** Slugs of every supported agent provider, as stored in `agent_providers.slug`. */
export const PROVIDER_SLUGS = ['claude_code', 'codex'] as const;

/** Validates a provider slug. */
export const ProviderSlugSchema = z.enum(PROVIDER_SLUGS);

/** A supported agent provider slug. */
export type ProviderSlug = z.infer<typeof ProviderSlugSchema>;

/** A provider as returned by the API. */
export const ProviderSchema = z.object({
  id: UuidSchema,
  slug: ProviderSlugSchema,
  displayName: z.string(),
  cliCommand: z.string(),
  defaultArgs: z.array(z.string()),
  skillsDirectory: z.string().nullable(),
  isEnabled: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** A provider as returned by the API. */
export type Provider = z.infer<typeof ProviderSchema>;

/** List of providers. */
export const ProviderListResponseSchema = createListResponseSchema(ProviderSchema);

/** Body of `PATCH /api/providers/:id`. Providers are seeded; admins can only toggle them. */
export const UpdateProviderRequestSchema = z.strictObject({ isEnabled: z.boolean() });

/** Body of `PATCH /api/providers/:id`. */
export type UpdateProviderRequest = z.infer<typeof UpdateProviderRequestSchema>;
