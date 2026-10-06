/**
 * Seeds sample data for local development only: one skill with a published
 * version, and one agent that has that skill assigned.
 *
 * Runs after the base seeds and depends on the `claude_code` provider and the
 * `locked-down` profile they create. Skips anything that already exists, so
 * it is safe to re-run.
 */
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import type { SkillPermissionsManifestInput } from '@agent-dashboard/shared';
import { LOCKED_DOWN_PROFILE_NAME } from '../base/02_sandbox_profiles.js';

const SAMPLE_SKILL_SLUG = 'hello-world';
const SAMPLE_SKILL_VERSION = '1.0.0';
const SAMPLE_AGENT_NAME = 'sample-claude-agent';

const SAMPLE_SKILL_MARKDOWN = `---
name: hello-world
description: Greets the user. A placeholder skill for local development.
---

When asked to say hello, reply with a short, friendly greeting.
`;

const SAMPLE_PERMISSIONS_MANIFEST: SkillPermissionsManifestInput = { manifestVersion: 1 };

/** Thrown when a base seed this file depends on has not run. */
class MissingBaseSeedError extends Error {
  constructor(description: string) {
    super(`Development seed requires ${description}. Run the base seeds first.`);
    this.name = 'MissingBaseSeedError';
  }
}

async function findRequiredId(query: Knex.QueryBuilder, description: string): Promise<string> {
  const row = await query.first<{ id: string } | undefined>('id');
  if (row === undefined) {
    throw new MissingBaseSeedError(description);
  }
  return row.id;
}

async function findOrCreateSampleSkill(knex: Knex, providerId: string): Promise<string> {
  const existingSkill = await knex('skills')
    .where({ slug: SAMPLE_SKILL_SLUG })
    .whereNull('archived_at')
    .first<{ id: string } | undefined>('id');
  if (existingSkill !== undefined) {
    return existingSkill.id;
  }

  const [createdSkill] = await knex('skills')
    .insert({
      slug: SAMPLE_SKILL_SLUG,
      name: 'Hello World',
      description: 'A placeholder skill for local development.',
    })
    .returning<{ id: string }[]>('id');
  if (createdSkill === undefined) {
    throw new Error('Sample skill was not inserted');
  }
  await knex('skill_supported_providers').insert({
    skill_id: createdSkill.id,
    provider_id: providerId,
  });
  return createdSkill.id;
}

async function findOrCreateSampleSkillVersion(knex: Knex, skillId: string): Promise<string> {
  const [skillVersion] = await knex('skill_versions')
    .insert({
      skill_id: skillId,
      version: SAMPLE_SKILL_VERSION,
      content_hash: createHash('sha256').update(SAMPLE_SKILL_MARKDOWN).digest('hex'),
      storage_path: `skills/${SAMPLE_SKILL_SLUG}/${SAMPLE_SKILL_VERSION}`,
      permissions_manifest: SAMPLE_PERMISSIONS_MANIFEST,
      changelog: 'Initial version.',
    })
    .onConflict(['skill_id', 'version'])
    .ignore()
    .returning<{ id: string }[]>('id');
  if (skillVersion !== undefined) {
    return skillVersion.id;
  }
  return findRequiredId(
    knex('skill_versions').where({ skill_id: skillId, version: SAMPLE_SKILL_VERSION }),
    'the sample skill version',
  );
}

async function findOrCreateSampleAgent(
  knex: Knex,
  providerId: string,
  sandboxProfileId: string,
): Promise<string> {
  const existingAgent = await knex('agents')
    .where({ name: SAMPLE_AGENT_NAME })
    .whereNull('archived_at')
    .first<{ id: string } | undefined>('id');
  if (existingAgent !== undefined) {
    return existingAgent.id;
  }

  const [createdAgent] = await knex('agents')
    .insert({
      name: SAMPLE_AGENT_NAME,
      description: 'Claude Code agent with the hello-world skill, for local development.',
      provider_id: providerId,
      sandbox_profile_id: sandboxProfileId,
      max_cost_per_run_micro_usd: 1_000_000,
    })
    .returning<{ id: string }[]>('id');
  if (createdAgent === undefined) {
    throw new Error('Sample agent was not inserted');
  }
  return createdAgent.id;
}

/**
 * Creates the sample skill, version, agent and assignment if missing.
 *
 * @param knex - Owner-role Knex client.
 * @throws {MissingBaseSeedError} If the base seeds have not run.
 */
export async function seed(knex: Knex): Promise<void> {
  const claudeProviderId = await findRequiredId(
    knex('agent_providers').where({ slug: 'claude_code' }),
    'the claude_code provider',
  );
  const lockedDownProfileId = await findRequiredId(
    knex('sandbox_profiles').where({ name: LOCKED_DOWN_PROFILE_NAME }).whereNull('archived_at'),
    `the ${LOCKED_DOWN_PROFILE_NAME} sandbox profile`,
  );

  const skillId = await findOrCreateSampleSkill(knex, claudeProviderId);
  const skillVersionId = await findOrCreateSampleSkillVersion(knex, skillId);
  const agentId = await findOrCreateSampleAgent(knex, claudeProviderId, lockedDownProfileId);

  await knex('agent_skill_assignments')
    .insert({ agent_id: agentId, skill_id: skillId, skill_version_id: skillVersionId })
    .onConflict(['agent_id', 'skill_id'])
    .ignore();
}
