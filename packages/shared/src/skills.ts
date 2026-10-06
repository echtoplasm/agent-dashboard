/**
 * Skill, skill version and agent skill assignment contracts.
 */
import { z } from 'zod';
import {
  DescriptionSchema,
  DisplayNameSchema,
  IsoDateTimeSchema,
  UuidSchema,
  createListResponseSchema,
} from './common.js';
import { SkillFileListSchema } from './skill-files.js';
import { SkillPermissionsManifestSchema } from './skill-permissions-manifest.js';
import { SemanticVersionSchema } from './semantic-version.js';

/** Lowercase kebab-case, e.g. `run-unit-tests`. Matches the database CHECK. */
export const SkillSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single dashes')
  .max(64);

/** A skill as returned by the API. */
export const SkillSchema = z.object({
  id: UuidSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  supportedProviderIds: z.array(UuidSchema),
  /** Highest published version, or null if none has been published yet. */
  latestVersion: z.string().nullable(),
  createdBy: UuidSchema.nullable(),
  archivedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** A skill as returned by the API. */
export type Skill = z.infer<typeof SkillSchema>;

/** List of skills. */
export const SkillListResponseSchema = createListResponseSchema(SkillSchema);

const SupportedProviderIdsSchema = z
  .array(UuidSchema)
  .min(1, 'A skill must support at least one provider')
  .refine((ids) => new Set(ids).size === ids.length, 'Provider ids must be unique');

/** Body of `POST /api/skills`. */
export const CreateSkillRequestSchema = z.strictObject({
  slug: SkillSlugSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema.default(''),
  supportedProviderIds: SupportedProviderIdsSchema,
});

/** Body of `POST /api/skills`, after defaults are applied. */
export type CreateSkillRequest = z.output<typeof CreateSkillRequestSchema>;

/** Body of `PATCH /api/skills/:id`. The slug is permanent. */
export const UpdateSkillRequestSchema = z
  .strictObject({
    name: DisplayNameSchema,
    description: DescriptionSchema,
    supportedProviderIds: SupportedProviderIdsSchema,
  })
  .partial();

/** Body of `PATCH /api/skills/:id`. */
export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>;

/** A skill version without its file contents, as listed under a skill. */
export const SkillVersionSummarySchema = z.object({
  id: UuidSchema,
  skillId: UuidSchema,
  version: z.string(),
  contentHash: z.string(),
  permissionsManifest: SkillPermissionsManifestSchema,
  changelog: z.string(),
  publishedBy: UuidSchema.nullable(),
  publishedAt: IsoDateTimeSchema,
});

/** A skill version without its file contents. */
export type SkillVersionSummary = z.infer<typeof SkillVersionSummarySchema>;

/** List of a skill's versions, newest first. */
export const SkillVersionListResponseSchema = createListResponseSchema(SkillVersionSummarySchema);

/** A skill version including every file's path and content. */
export const SkillVersionDetailSchema = SkillVersionSummarySchema.extend({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});

/** A skill version including its files. */
export type SkillVersionDetail = z.infer<typeof SkillVersionDetailSchema>;

/** Body of `POST /api/skills/:id/versions`, which publishes an immutable version. */
export const PublishSkillVersionRequestSchema = z.strictObject({
  version: SemanticVersionSchema,
  changelog: DescriptionSchema.default(''),
  permissionsManifest: SkillPermissionsManifestSchema,
  files: SkillFileListSchema,
});

/** Body of `POST /api/skills/:id/versions`, as sent by a client. */
export type PublishSkillVersionRequest = z.input<typeof PublishSkillVersionRequestSchema>;

/** An entry in an agent's loadout: which version of a skill it has. */
export const AgentSkillAssignmentSchema = z.object({
  agentId: UuidSchema,
  skillId: UuidSchema,
  skillSlug: z.string(),
  skillName: z.string(),
  skillVersionId: UuidSchema,
  version: z.string(),
  assignedBy: UuidSchema.nullable(),
  assignedAt: IsoDateTimeSchema,
});

/** An entry in an agent's loadout. */
export type AgentSkillAssignment = z.infer<typeof AgentSkillAssignmentSchema>;

/** An agent's loadout. */
export const AgentSkillAssignmentListResponseSchema = createListResponseSchema(
  AgentSkillAssignmentSchema,
);

/** Body of `PUT /api/agents/:id/skills/:skillId`. */
export const AssignSkillRequestSchema = z.strictObject({ skillVersionId: UuidSchema });

/** Body of `PUT /api/agents/:id/skills/:skillId`. */
export type AssignSkillRequest = z.infer<typeof AssignSkillRequestSchema>;

/** Route params for `/api/agents/:id/skills/:skillId`. */
export const AgentSkillParamsSchema = z.object({ id: UuidSchema, skillId: UuidSchema });
