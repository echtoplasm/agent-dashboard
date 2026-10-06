/**
 * Creates `audit_log`, the append-only record of who did what and when.
 *
 * Entries can be inserted and read but never changed: a trigger rejects every
 * UPDATE, DELETE and TRUNCATE, whichever role attempts it, and the app role
 * only has SELECT and INSERT. See D-005 in docs/decisions.md.
 *
 * `actor_user_id` is null for actions the system takes on its own.
 * `target_id` is text so entries can point at rows with non-UUID keys.
 */
import type { Knex } from 'knex';
import { attachImmutableRowTriggers, grantTablePrivilegesToApp } from '../migration-helpers.js';

/** Dotted `<subject>.<verb>` names, such as `agent_run.launched`. */
const AUDIT_ACTION_PATTERN = '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$';

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit_log', (table) => {
    table.specificType('id', 'bigint GENERATED ALWAYS AS IDENTITY').primary();
    table.uuid('actor_user_id').nullable().references('id').inTable('users');
    table
      .text('action')
      .notNullable()
      .checkRegex(AUDIT_ACTION_PATTERN, 'audit_log_action_format_check');
    table.text('target_type').nullable();
    table.text('target_id').nullable();
    table.jsonb('metadata').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.specificType('ip_address', 'inet').nullable();
    table.text('user_agent').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("jsonb_typeof(metadata) = 'object'", [], 'audit_log_metadata_object_check');
    table.index('created_at');
    table.index(['target_type', 'target_id']);
    table.index('actor_user_id');
  });
  await attachImmutableRowTriggers(knex, 'audit_log', { isDeleteAllowed: false });
  await grantTablePrivilegesToApp(knex, 'audit_log', ['SELECT', 'INSERT']);
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('audit_log');
}
