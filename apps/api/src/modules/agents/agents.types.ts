/**
 * Internal types for the agents module.
 */
import type { Agent } from '@agent-dashboard/shared';

/** Every editable field of an agent. */
export type AgentFields = Pick<
  Agent,
  | 'name'
  | 'description'
  | 'providerId'
  | 'sandboxProfileId'
  | 'model'
  | 'maxCostPerRunMicroUsd'
  | 'maxCostPerMonthMicroUsd'
>;
