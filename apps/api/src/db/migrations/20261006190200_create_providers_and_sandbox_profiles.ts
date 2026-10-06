/**
 * Creates `agent_providers` and `sandbox_profiles`, the two lookup tables an
 * agent is configured against.
 *
 * `agent_providers` lists the CLIs that can run agents. The slug only has a
 * format check, not a fixed list, so adding a provider means a new adapter and
 * a new row, with no schema change.
 *
 * `sandbox_profiles` sets the upper limit on what any run using the profile
 * may do. Its network, filesystem and command columns mirror the sections of
 * a skill's permissions manifest, so a manifest can be checked against the
 * profile field by field. Everything defaults to the most restrictive value.
 */
import type { Knex } from 'knex';
import {
  addArchivedAtColumn,
  addTimestampColumns,
  addUuidPrimaryKey,
  attachUpdatedAtTrigger,
  createActiveRowUniqueIndex,
  grantTablePrivilegesToApp,
} from '../migration-helpers.js';

/** Lowercase snake_case identifiers such as `claude_code`. */
const PROVIDER_SLUG_PATTERN = '^[a-z][a-z0-9_]*$';

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agent_providers', (table) => {
    addUuidPrimaryKey(table, knex);
    table
      .text('slug')
      .notNullable()
      .unique()
      .checkRegex(PROVIDER_SLUG_PATTERN, 'agent_providers_slug_format_check');
    table.text('display_name').notNullable();
    table.text('cli_command').notNullable();
    table.jsonb('default_args').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    // Where the provider looks for skills inside the sandbox. Null until it
    // has been verified against the installed CLI.
    table.text('skills_directory').nullable();
    table.boolean('is_enabled').notNullable().defaultTo(true);
    addTimestampColumns(table, knex);
    table.check(
      "jsonb_typeof(default_args) = 'array'",
      [],
      'agent_providers_default_args_array_check',
    );
  });
  await attachUpdatedAtTrigger(knex, 'agent_providers');
  // Providers are seeded. Admins may toggle or adjust them but never add or remove.
  await grantTablePrivilegesToApp(knex, 'agent_providers', ['SELECT', 'UPDATE']);

  await knex.schema.createTable('sandbox_profiles', (table) => {
    addUuidPrimaryKey(table, knex);
    table.text('name').notNullable();
    table.text('description').notNullable().defaultTo('');
    table.text('container_image').notNullable();
    table.integer('cpu_limit_millicores').notNullable().checkPositive();
    table.integer('memory_limit_mb').notNullable().checkPositive();
    table.integer('max_run_duration_seconds').notNullable().checkPositive();
    table.boolean('is_network_allowed').notNullable().defaultTo(false);
    table.jsonb('allowed_network_hosts').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb('writable_paths').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb('allowed_commands').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    addArchivedAtColumn(table);
    addTimestampColumns(table, knex);
    table.check(
      "jsonb_typeof(allowed_network_hosts) = 'array' AND jsonb_typeof(writable_paths) = 'array' AND jsonb_typeof(allowed_commands) = 'array'",
      [],
      'sandbox_profiles_permission_lists_array_check',
    );
    table.check(
      "is_network_allowed OR allowed_network_hosts = '[]'::jsonb",
      [],
      'sandbox_profiles_hosts_require_network_check',
    );
  });
  await createActiveRowUniqueIndex(knex, 'sandbox_profiles', 'name');
  await attachUpdatedAtTrigger(knex, 'sandbox_profiles');
  await grantTablePrivilegesToApp(knex, 'sandbox_profiles', ['SELECT', 'INSERT', 'UPDATE']);
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('sandbox_profiles');
  await knex.schema.dropTable('agent_providers');
}
