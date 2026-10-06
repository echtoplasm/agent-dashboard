/**
 * Seeds the default `locked-down` sandbox profile. Runs in every environment.
 *
 * The profile allows nothing beyond the run's own workspace: no network, no
 * extra writable paths, no extra commands. Agents start here, and anything
 * more permissive has to be a deliberate, audited choice. The container image
 * is built in Phase 3.
 */
import type { Knex } from 'knex';

export const LOCKED_DOWN_PROFILE_NAME = 'locked-down';

const LOCKED_DOWN_PROFILE = {
  name: LOCKED_DOWN_PROFILE_NAME,
  description: 'No network, no extra writes or commands. The default for new agents.',
  container_image: 'agent-dashboard/sandbox:latest',
  cpu_limit_millicores: 1000,
  memory_limit_mb: 1024,
  max_run_duration_seconds: 30 * 60,
  is_network_allowed: false,
};

/**
 * Inserts the locked-down profile if no active profile has that name.
 *
 * @param knex - Owner-role Knex client.
 */
export async function seed(knex: Knex): Promise<void> {
  const existingProfile = await knex('sandbox_profiles')
    .where({ name: LOCKED_DOWN_PROFILE_NAME })
    .whereNull('archived_at')
    .first<{ id: string } | undefined>('id');

  if (existingProfile === undefined) {
    await knex('sandbox_profiles').insert(LOCKED_DOWN_PROFILE);
  }
}
