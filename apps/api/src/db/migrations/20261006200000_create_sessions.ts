/**
 * Creates `sessions`, the server-side record of each signed-in browser.
 *
 * The browser holds a random token in an HttpOnly cookie. The database holds
 * only the token's SHA-256 digest as the primary key, so a read-only leak
 * of this table (a backup, a SQL injection) does not hand out live sessions.
 *
 * A session ends at `idle_expires_at` (pushed forward as it is used) or at
 * `absolute_expires_at`, whichever is sooner. Deleting a user's rows signs
 * them out everywhere, which happens on deactivation and password changes.
 */
import type { Knex } from 'knex';
import { grantTablePrivilegesToApp } from '../migration-helpers.js';

/** Lowercase hex SHA-256 digest. */
const SHA256_HEX_PATTERN = '^[0-9a-f]{64}$';

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sessions', (table) => {
    table
      .text('token_hash')
      .primary()
      .checkRegex(SHA256_HEX_PATTERN, 'sessions_token_hash_format_check');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('idle_expires_at', { useTz: true }).notNullable();
    table.timestamp('absolute_expires_at', { useTz: true }).notNullable();
    table.specificType('ip_address', 'inet').nullable();
    table.text('user_agent').nullable();

    table.index('user_id');
    table.index('absolute_expires_at');
  });
  await grantTablePrivilegesToApp(knex, 'sessions', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('sessions');
}
