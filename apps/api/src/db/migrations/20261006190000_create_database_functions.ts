/**
 * Creates the trigger functions that later migrations attach to tables.
 *
 * - `set_updated_at()` keeps `updated_at` current without relying on callers.
 * - `reject_modification()` raises an error for any UPDATE, DELETE or TRUNCATE
 *   it is attached to. It backs the immutability of `skill_versions`,
 *   `run_events` and the append-only `audit_log`.
 *
 * Both functions pin `search_path` so a role that can create objects in
 * another schema cannot hijack the names they use.
 */
import type { Knex } from 'knex';

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$
  `);

  await knex.raw(`
    CREATE FUNCTION reject_modification() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
    BEGIN
      RAISE EXCEPTION '% on table "%" is not allowed: rows are immutable', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
    END;
    $$
  `);
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP FUNCTION reject_modification()');
  await knex.raw('DROP FUNCTION set_updated_at()');
}
