/**
 * Creates `agents`, a configured combination of provider, sandbox profile,
 * model and budget that runs are launched from.
 *
 * Budgets are optional integer micro-USD amounts (see D-008 in
 * docs/decisions.md); null means no limit. Agents are archived instead of
 * deleted so past runs keep their reference. Only active agents need unique
 * names.
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

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agents', (table) => {
    addUuidPrimaryKey(table, knex);
    table.text('name').notNullable();
    table.text('description').notNullable().defaultTo('');
    table.uuid('provider_id').notNullable().references('id').inTable('agent_providers');
    table.uuid('sandbox_profile_id').notNullable().references('id').inTable('sandbox_profiles');
    // Null means "use the provider's default model".
    table.text('model').nullable();
    table.jsonb('extra_args').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.bigInteger('max_cost_per_run_micro_usd').nullable().checkPositive();
    table.bigInteger('max_cost_per_month_micro_usd').nullable().checkPositive();
    table.uuid('created_by').nullable().references('id').inTable('users');
    addArchivedAtColumn(table);
    addTimestampColumns(table, knex);
    table.check("jsonb_typeof(extra_args) = 'array'", [], 'agents_extra_args_array_check');

    table.index('provider_id');
    table.index('sandbox_profile_id');
  });
  await createActiveRowUniqueIndex(knex, 'agents', 'name');
  await attachUpdatedAtTrigger(knex, 'agents');
  await grantTablePrivilegesToApp(knex, 'agents', ['SELECT', 'INSERT', 'UPDATE']);
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('agents');
}
