/**
 * Sandbox profile contracts.
 *
 * A profile is the ceiling on what any run using it may do. Its permission
 * fields mirror the sections of a skill permissions manifest, so a manifest
 * can be checked against a profile field by field.
 */
import { z } from 'zod';
import {
  DescriptionSchema,
  DisplayNameSchema,
  IsoDateTimeSchema,
  UuidSchema,
  createListResponseSchema,
} from './common.js';
import {
  CommandNameSchema,
  HostnameSchema,
  WorkspacePathSchema,
} from './skill-permissions-manifest.js';

/** Resource limits accepted for a profile, sized for small homelab nodes. */
export const SANDBOX_LIMITS = {
  MIN_CPU_MILLICORES: 100,
  MAX_CPU_MILLICORES: 16_000,
  MIN_MEMORY_MB: 128,
  MAX_MEMORY_MB: 32_768,
  MIN_RUN_DURATION_SECONDS: 60,
  MAX_RUN_DURATION_SECONDS: 24 * 60 * 60,
} as const;

/** A container image reference such as `agent-dashboard/sandbox:latest`. */
const CONTAINER_IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$/;

/** A sandbox profile as returned by the API. */
export const SandboxProfileSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  description: z.string(),
  containerImage: z.string(),
  cpuLimitMillicores: z.number().int(),
  memoryLimitMb: z.number().int(),
  maxRunDurationSeconds: z.number().int(),
  isNetworkAllowed: z.boolean(),
  allowedNetworkHosts: z.array(z.string()),
  writablePaths: z.array(z.string()),
  allowedCommands: z.array(z.string()),
  archivedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** A sandbox profile as returned by the API. */
export type SandboxProfile = z.infer<typeof SandboxProfileSchema>;

/** List of sandbox profiles. */
export const SandboxProfileListResponseSchema = createListResponseSchema(SandboxProfileSchema);

const SandboxProfileFieldsSchema = z.strictObject({
  name: DisplayNameSchema,
  description: DescriptionSchema,
  containerImage: z.string().regex(CONTAINER_IMAGE_PATTERN, 'Must be a container image reference'),
  cpuLimitMillicores: z
    .number()
    .int()
    .min(SANDBOX_LIMITS.MIN_CPU_MILLICORES)
    .max(SANDBOX_LIMITS.MAX_CPU_MILLICORES),
  memoryLimitMb: z
    .number()
    .int()
    .min(SANDBOX_LIMITS.MIN_MEMORY_MB)
    .max(SANDBOX_LIMITS.MAX_MEMORY_MB),
  maxRunDurationSeconds: z
    .number()
    .int()
    .min(SANDBOX_LIMITS.MIN_RUN_DURATION_SECONDS)
    .max(SANDBOX_LIMITS.MAX_RUN_DURATION_SECONDS),
  isNetworkAllowed: z.boolean(),
  allowedNetworkHosts: z.array(HostnameSchema),
  writablePaths: z.array(WorkspacePathSchema),
  allowedCommands: z.array(CommandNameSchema),
});

/** Body of `POST /api/sandbox-profiles`. Permission lists default to empty. */
export const CreateSandboxProfileRequestSchema = SandboxProfileFieldsSchema.extend({
  description: DescriptionSchema.default(''),
  isNetworkAllowed: z.boolean().default(false),
  allowedNetworkHosts: z.array(HostnameSchema).default([]),
  writablePaths: z.array(WorkspacePathSchema).default([]),
  allowedCommands: z.array(CommandNameSchema).default([]),
});

/** Body of `POST /api/sandbox-profiles`, after defaults are applied. */
export type CreateSandboxProfileRequest = z.output<typeof CreateSandboxProfileRequestSchema>;

/**
 * Body of `PATCH /api/sandbox-profiles/:id`. The "hosts require network" rule
 * is checked by the API against the merged result, since either field may be
 * omitted.
 */
export const UpdateSandboxProfileRequestSchema = SandboxProfileFieldsSchema.partial();

/** Body of `PATCH /api/sandbox-profiles/:id`. */
export type UpdateSandboxProfileRequest = z.infer<typeof UpdateSandboxProfileRequestSchema>;
