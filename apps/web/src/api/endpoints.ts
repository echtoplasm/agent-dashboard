/**
 * One typed function per API endpoint the web app uses.
 *
 * Pages call these instead of building URLs and picking schemas themselves.
 */
import {
  AgentListResponseSchema,
  AgentSchema,
  AgentSkillAssignmentListResponseSchema,
  AgentSkillAssignmentSchema,
  AuditLogPageSchema,
  AgentUsageSchema,
  CurrentUserResponseSchema,
  ModelPriceListResponseSchema,
  ModelPriceSchema,
  ProviderListResponseSchema,
  ProviderSchema,
  RunDetailSchema,
  RunListPageSchema,
  SandboxProfileListResponseSchema,
  SkillListResponseSchema,
  SkillSchema,
  SkillVersionDetailSchema,
  SkillVersionListResponseSchema,
  SkillVersionSummarySchema,
  UserListResponseSchema,
  UserSchema,
  WorkspaceListingSchema,
} from '@agent-dashboard/shared';
import type {
  Agent,
  AgentSkillAssignment,
  AgentUsage,
  AuditLogPage,
  ChangePasswordRequest,
  CreateAgentRequest,
  CreateSkillRequest,
  CreateUserRequest,
  LaunchRunRequest,
  LoginRequest,
  ModelPrice,
  Provider,
  PublishSkillVersionRequest,
  RunDetail,
  RunListPage,
  RunStatus,
  SandboxProfile,
  SetModelPriceRequest,
  Skill,
  SkillVersionDetail,
  SkillVersionSummary,
  UpdateAgentRequest,
  UpdateSkillRequest,
  UpdateUserRequest,
  User,
  WorkspaceListing,
} from '@agent-dashboard/shared';
import { API_BASE_URL, apiRequest } from './api-client.js';

/** Query string for list endpoints that can include archived rows. */
function archivedQuery(isIncludingArchived: boolean): string {
  return isIncludingArchived ? '?includeArchived=true' : '';
}

// --- Auth ---------------------------------------------------------------

/** Signs in and returns the user. */
export async function login(credentials: LoginRequest): Promise<User> {
  const response = await apiRequest('/api/auth/login', CurrentUserResponseSchema, {
    method: 'POST',
    body: credentials,
  });
  return response.user;
}

/** Ends the current session. */
export function logout(): Promise<void> {
  return apiRequest('/api/auth/logout', null, { method: 'POST' });
}

/** Returns the signed-in user. */
export async function fetchCurrentUser(): Promise<User> {
  return (await apiRequest('/api/auth/me', CurrentUserResponseSchema)).user;
}

/** Changes the signed-in user's password. */
export function changePassword(request: ChangePasswordRequest): Promise<void> {
  return apiRequest('/api/auth/password', null, { method: 'POST', body: request });
}

// --- Users (admin) ----------------------------------------------------------

/** Lists every user. */
export async function listUsers(): Promise<User[]> {
  return (await apiRequest('/api/users', UserListResponseSchema)).items;
}

/** Creates a user. */
export function createUser(input: CreateUserRequest): Promise<User> {
  return apiRequest('/api/users', UserSchema, { method: 'POST', body: input });
}

/** Changes a user's role, email or active state. */
export function updateUser(userId: string, changes: UpdateUserRequest): Promise<User> {
  return apiRequest(`/api/users/${userId}`, UserSchema, { method: 'PATCH', body: changes });
}

/** Sets a new password for a user and signs them out everywhere. */
export function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  return apiRequest(`/api/users/${userId}/password`, null, {
    method: 'POST',
    body: { newPassword },
  });
}

// --- Providers and sandbox profiles -----------------------------------------

/** Lists providers. */
export async function listProviders(): Promise<Provider[]> {
  return (await apiRequest('/api/providers', ProviderListResponseSchema)).items;
}

/** Enables or disables a provider. */
export function setProviderEnabled(providerId: string, isEnabled: boolean): Promise<Provider> {
  return apiRequest(`/api/providers/${providerId}`, ProviderSchema, {
    method: 'PATCH',
    body: { isEnabled },
  });
}

/** Lists sandbox profiles. */
export async function listSandboxProfiles(isIncludingArchived = false): Promise<SandboxProfile[]> {
  return (
    await apiRequest(
      `/api/sandbox-profiles${archivedQuery(isIncludingArchived)}`,
      SandboxProfileListResponseSchema,
    )
  ).items;
}

// --- Agents ---------------------------------------------------------------

/** Lists agents. */
export async function listAgents(isIncludingArchived = false): Promise<Agent[]> {
  return (
    await apiRequest(`/api/agents${archivedQuery(isIncludingArchived)}`, AgentListResponseSchema)
  ).items;
}

/** Returns one agent. */
export function getAgent(agentId: string): Promise<Agent> {
  return apiRequest(`/api/agents/${agentId}`, AgentSchema);
}

/** Creates an agent. */
export function createAgent(input: CreateAgentRequest): Promise<Agent> {
  return apiRequest('/api/agents', AgentSchema, { method: 'POST', body: input });
}

/** Updates an agent. */
export function updateAgent(agentId: string, changes: UpdateAgentRequest): Promise<Agent> {
  return apiRequest(`/api/agents/${agentId}`, AgentSchema, { method: 'PATCH', body: changes });
}

/** Permanently deletes an agent that has never run (admins). */
export function deleteAgent(agentId: string): Promise<void> {
  return apiRequest(`/api/agents/${agentId}`, null, { method: 'DELETE' });
}

/** Archives an agent. */
export function archiveAgent(agentId: string): Promise<Agent> {
  return apiRequest(`/api/agents/${agentId}/archive`, AgentSchema, { method: 'POST' });
}

// --- Skills ---------------------------------------------------------------

/** Lists skills. */
export async function listSkills(isIncludingArchived = false): Promise<Skill[]> {
  return (
    await apiRequest(`/api/skills${archivedQuery(isIncludingArchived)}`, SkillListResponseSchema)
  ).items;
}

/** Returns one skill. */
export function getSkill(skillId: string): Promise<Skill> {
  return apiRequest(`/api/skills/${skillId}`, SkillSchema);
}

/** Creates a skill. */
export function createSkill(input: CreateSkillRequest): Promise<Skill> {
  return apiRequest('/api/skills', SkillSchema, { method: 'POST', body: input });
}

/** Updates a skill's name, description or providers. */
export function updateSkill(skillId: string, changes: UpdateSkillRequest): Promise<Skill> {
  return apiRequest(`/api/skills/${skillId}`, SkillSchema, { method: 'PATCH', body: changes });
}

/** Permanently deletes a skill with no published versions (admins). */
export function deleteSkill(skillId: string): Promise<void> {
  return apiRequest(`/api/skills/${skillId}`, null, { method: 'DELETE' });
}

/** Archives a skill. */
export function archiveSkill(skillId: string): Promise<Skill> {
  return apiRequest(`/api/skills/${skillId}/archive`, SkillSchema, { method: 'POST' });
}

/** Lists a skill's versions, newest first. */
export async function listSkillVersions(skillId: string): Promise<SkillVersionSummary[]> {
  return (await apiRequest(`/api/skills/${skillId}/versions`, SkillVersionListResponseSchema))
    .items;
}

/** Returns a version with its files. */
export function getSkillVersion(skillVersionId: string): Promise<SkillVersionDetail> {
  return apiRequest(`/api/skill-versions/${skillVersionId}`, SkillVersionDetailSchema);
}

/** Publishes a new immutable version. */
export function publishSkillVersion(
  skillId: string,
  input: PublishSkillVersionRequest,
): Promise<SkillVersionSummary> {
  return apiRequest(`/api/skills/${skillId}/versions`, SkillVersionSummarySchema, {
    method: 'POST',
    body: input,
  });
}

// --- Assignments ------------------------------------------------------------

/** Lists an agent's assigned skills. */
export async function listAssignments(agentId: string): Promise<AgentSkillAssignment[]> {
  return (await apiRequest(`/api/agents/${agentId}/skills`, AgentSkillAssignmentListResponseSchema))
    .items;
}

/** Assigns (or replaces) a skill version on an agent. */
export function assignSkill(
  agentId: string,
  skillId: string,
  skillVersionId: string,
): Promise<AgentSkillAssignment> {
  return apiRequest(`/api/agents/${agentId}/skills/${skillId}`, AgentSkillAssignmentSchema, {
    method: 'PUT',
    body: { skillVersionId },
  });
}

/** Removes a skill from an agent. */
export function unassignSkill(agentId: string, skillId: string): Promise<void> {
  return apiRequest(`/api/agents/${agentId}/skills/${skillId}`, null, { method: 'DELETE' });
}

// --- Audit log ------------------------------------------------------------

/** Returns one page of the audit log, newest first. */
export function listAuditLog(before?: number): Promise<AuditLogPage> {
  const query = before === undefined ? '' : `?before=${before}`;
  return apiRequest(`/api/audit-log${query}`, AuditLogPageSchema);
}

// --- Runs -------------------------------------------------------------------

/** Filters for the run list. */
export interface RunListFilters {
  agentId?: string;
  status?: RunStatus;
  limit?: number;
  /** The previous page's `nextCursor`. */
  before?: string;
}

/** Returns one page of runs, newest first. */
export function listRuns(filters: RunListFilters = {}): Promise<RunListPage> {
  const searchParams = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined) {
      searchParams.set(name, String(value));
    }
  }
  const query = searchParams.size === 0 ? '' : `?${searchParams.toString()}`;
  return apiRequest(`/api/runs${query}`, RunListPageSchema);
}

/** Returns a run with its prompt and skill versions. */
export function getRun(runId: string): Promise<RunDetail> {
  return apiRequest(`/api/runs/${runId}`, RunDetailSchema);
}

/** Launches a run. */
export function launchRun(input: LaunchRunRequest): Promise<RunDetail> {
  return apiRequest('/api/runs', RunDetailSchema, { method: 'POST', body: input });
}

/** Asks an active run to stop. */
export function cancelRun(runId: string): Promise<RunDetail> {
  return apiRequest(`/api/runs/${runId}/cancel`, RunDetailSchema, { method: 'POST' });
}

/** URL of a run's live event stream (Server-Sent Events). */
export function buildRunStreamUrl(runId: string): string {
  return `${API_BASE_URL}/api/runs/${runId}/stream`;
}

/** Lists the files a run left in its workspace. */
export function listWorkspaceFiles(runId: string): Promise<WorkspaceListing> {
  return apiRequest(`/api/runs/${runId}/workspace`, WorkspaceListingSchema);
}

/** URL that downloads one workspace file. */
export function buildWorkspaceFileUrl(runId: string, path: string): string {
  return `${API_BASE_URL}/api/runs/${runId}/workspace/file?path=${encodeURIComponent(path)}`;
}

/** Returns token and cost totals across an agent's runs. */
export function getAgentUsage(agentId: string): Promise<AgentUsage> {
  return apiRequest(`/api/agents/${agentId}/usage`, AgentUsageSchema);
}

// --- Model prices -----------------------------------------------------------

/** Lists model prices. */
export async function listModelPrices(): Promise<ModelPrice[]> {
  return (await apiRequest('/api/model-prices', ModelPriceListResponseSchema)).items;
}

/** Creates or replaces a model's price. */
export function setModelPrice(input: SetModelPriceRequest): Promise<ModelPrice> {
  return apiRequest('/api/model-prices', ModelPriceSchema, { method: 'PUT', body: input });
}

/** Deletes a model price. */
export function deleteModelPrice(modelPriceId: string): Promise<void> {
  return apiRequest(`/api/model-prices/${modelPriceId}`, null, { method: 'DELETE' });
}
