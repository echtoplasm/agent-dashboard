/**
 * Assigning skill versions to agents.
 *
 * Assigning a skill sets which version of it the agent has; assigning again
 * with another version replaces it. A skill can only be assigned if it
 * supports the agent's provider and its permissions manifest fits within the
 * agent's sandbox profile. Violations come back as a 409 listing each excess
 * permission.
 */
import type { AgentSkillAssignment } from '@agent-dashboard/shared';
import type { DataAccess, Repositories } from '../../db/data-access.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/app-errors.js';
import type { AuditContext } from '../audit/audit.types.js';
import { findLoadoutEntryProblems } from './loadout-rules.js';

/** Assignment operations. */
export interface AssignmentsService {
  /** @throws {NotFoundError} If the agent does not exist. */
  listAssignments(agentId: string): Promise<AgentSkillAssignment[]>;
  /** @throws {NotFoundError | ValidationError | ConflictError} */
  assignSkill(
    agentId: string,
    skillId: string,
    skillVersionId: string,
    context: AuditContext,
  ): Promise<AgentSkillAssignment>;
  /** @throws {NotFoundError} If the agent or assignment does not exist. */
  unassignSkill(agentId: string, skillId: string, context: AuditContext): Promise<void>;
}

async function findEditableAgent(repositories: Repositories, agentId: string) {
  const agent = await repositories.agents.findAgentById(agentId);
  if (agent === undefined) {
    throw new NotFoundError('Agent not found');
  }
  if (agent.archivedAt !== null) {
    throw new ConflictError('Archived agents cannot be changed');
  }
  return agent;
}

/**
 * Creates the assignments service.
 *
 * @param dataAccess - Repositories and the transaction runner.
 * @returns The service.
 */
export function createAssignmentsService(dataAccess: DataAccess): AssignmentsService {
  return {
    async listAssignments(agentId) {
      const agent = await dataAccess.repositories.agents.findAgentById(agentId);
      if (agent === undefined) {
        throw new NotFoundError('Agent not found');
      }
      return dataAccess.repositories.assignments.listAssignmentsForAgent(agentId);
    },

    async assignSkill(agentId, skillId, skillVersionId, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        const agent = await findEditableAgent(repositories, agentId);
        const skill = await repositories.skills.findSkillById(skillId);
        if (skill === undefined) {
          throw new NotFoundError('Skill not found');
        }
        if (skill.archivedAt !== null) {
          throw new ConflictError('Archived skills cannot be assigned');
        }
        const skillVersion = await repositories.skillVersions.findVersionById(skillVersionId);
        if (skillVersion?.skillId !== skillId) {
          throw new ValidationError([
            { path: 'skillVersionId', message: 'Not a version of this skill' },
          ]);
        }
        const profile = await repositories.sandboxProfiles.findSandboxProfileById(
          agent.sandboxProfileId,
        );
        if (profile === undefined) {
          throw new NotFoundError('Sandbox profile not found');
        }

        const problems = findLoadoutEntryProblems(
          {
            skillId,
            skillName: skill.name,
            version: skillVersion.version,
            supportedProviderIds: skill.supportedProviderIds,
            permissionsManifest: skillVersion.permissionsManifest,
          },
          agent.providerId,
          profile,
        );
        if (problems.length > 0) {
          throw new ConflictError(
            `${skill.name} ${skillVersion.version} cannot be assigned to this agent`,
            problems,
          );
        }

        const previousAssignment = await repositories.assignments.findAssignment(agentId, skillId);
        await repositories.assignments.upsertAssignment({
          agentId,
          skillId,
          skillVersionId,
          assignedBy: context.actorUserId,
        });
        await repositories.audit.insertAuditEntry(context, {
          action: 'agent_skill.assigned',
          targetType: 'agent',
          targetId: agentId,
          metadata: {
            skillId,
            skillVersionId,
            version: skillVersion.version,
            previousSkillVersionId: previousAssignment?.skillVersionId ?? null,
          },
        });

        const assignment = await repositories.assignments.findAssignment(agentId, skillId);
        if (assignment === undefined) {
          throw new Error('Assignment was not saved');
        }
        return assignment;
      });
    },

    async unassignSkill(agentId, skillId, context) {
      await dataAccess.runInTransaction(async (repositories) => {
        await findEditableAgent(repositories, agentId);
        const isRemoved = await repositories.assignments.deleteAssignment(agentId, skillId);
        if (!isRemoved) {
          throw new NotFoundError('This agent does not have that skill');
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'agent_skill.unassigned',
          targetType: 'agent',
          targetId: agentId,
          metadata: { skillId },
        });
      });
    },
  };
}
