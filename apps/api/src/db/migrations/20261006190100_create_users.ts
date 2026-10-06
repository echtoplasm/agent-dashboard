/**
 * Creates `users`, the people who can sign in to the dashboard.
 *
 * Usernames and emails are unique regardless of case. `password_hash` is
 * nullable until authentication arrives in Phase 2. Users are deactivated
 * (`is_active = false`) rather than deleted, because runs and audit entries
 * reference them; the app role therefore has no DELETE grant.
 *
 * The role values are written out here rather than imported from
 * `@agent-dashboard/shared`, so this migration keeps meaning the same thing
 * if that list changes later. A test checks the two stay in sync.
 */
import type { Knex } from 'knex';
import {
  addTimestampColumns,
  addUuidPrimaryKey,
  attachUpdatedAtTrigger,
  grantTablePrivilegesToApp,
} from '../migration-helpers.js';

const USER_ROLES_AT_CREATION = ['admin', 'operator', 'viewer'];

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    addUuidPrimaryKey(table, knex);
    table.text('username').notNullable();
    table.text('email').nullable();
    table.text('password_hash').nullable();
    table
      .text('role')
      .notNullable()
      .defaultTo('viewer')
      .checkIn(USER_ROLES_AT_CREATION, 'users_role_check');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('last_login_at', { useTz: true }).nullable();
    addTimestampColumns(table, knex);
  });

  await knex.raw('CREATE UNIQUE INDEX users_username_lower_unique ON users (lower(username))');
  await knex.raw(
    'CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email)) WHERE email IS NOT NULL',
  );
  await attachUpdatedAtTrigger(knex, 'users');
  await grantTablePrivilegesToApp(knex, 'users', ['SELECT', 'INSERT', 'UPDATE']);
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('users');
}
