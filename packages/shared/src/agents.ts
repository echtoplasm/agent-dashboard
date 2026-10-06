/**
 * Agent contracts.
 *
 * An agent is a configured combination of provider, sandbox profile, model
 * and budget that runs are launched from.
 */
import { z } from 'zod';
import {
  DescriptionSchema,
  IsoDateTimeSchema,
  MicroUsdSchema,
  UuidSchema,
  createListResponseSchema,
} from './common.js';

/** Lowercase kebab-case, 3 to 64 characters, e.g. `docs-writer`. */
export const AgentNameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Use lowercase letters, digits and single dashes (e.g. docs-writer)',
  )
  .min(3)
  .max(64);

/** A provider-specific model identifier, e.g. `claude-opus-5-5`. */
export const ModelNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:/-]{1,100}$/, 'Must be a model identifier');

/** A budget in micro-USD. Null means no limit. Zero is not allowed: archive the agent instead. */
const BudgetSchema = MicroUsdSchema.positive().nullable();

/** An agent as returned by the API. */
export const AgentSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  description: z.string(),
  providerId: UuidSchema,
  sandboxProfileId: UuidSchema,
  model: z.string().nullable(),
  maxCostPerRunMicroUsd: z.number().int().nullable(),
  maxCostPerMonthMicroUsd: z.number().int().nullable(),
  createdBy: UuidSchema.nullable(),
  archivedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** An agent as returned by the API. */
export type Agent = z.infer<typeof AgentSchema>;

/** List of agents. */
export const AgentListResponseSchema = createListResponseSchema(AgentSchema);

const AgentFieldsSchema = z.strictObject({
  name: AgentNameSchema,
  description: DescriptionSchema,
  providerId: UuidSchema,
  sandboxProfileId: UuidSchema,
  model: ModelNameSchema.nullable(),
  maxCostPerRunMicroUsd: BudgetSchema,
  maxCostPerMonthMicroUsd: BudgetSchema,
});

/**
 * Body of `POST /api/agents`.
 *
 * Extra CLI arguments are deliberately not accepted yet: which flags are safe
 * to pass depends on the provider adapters built in Phase 3.
 */
export const CreateAgentRequestSchema = AgentFieldsSchema.extend({
  description: DescriptionSchema.default(''),
  model: ModelNameSchema.nullable().default(null),
  maxCostPerRunMicroUsd: BudgetSchema.default(null),
  maxCostPerMonthMicroUsd: BudgetSchema.default(null),
});

/** Body of `POST /api/agents`, after defaults are applied. */
export type CreateAgentRequest = z.output<typeof CreateAgentRequestSchema>;

/** Body of `PATCH /api/agents/:id`. */
export const UpdateAgentRequestSchema = AgentFieldsSchema.partial();

/** Body of `PATCH /api/agents/:id`. */
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;
