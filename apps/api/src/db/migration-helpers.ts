/**
 * Building blocks shared by migrations.
 *
 * Migrations that already ran import these, so changing what a helper does
 * would silently change history. Treat every helper as frozen: add a new
 * helper instead of modifying an existing one.
 */
import type { Knex } from 'knex';
import { APP_DATABASE_ROLE } from './database-roles.js';

/** Table privileges the app role can be granted. TRUNCATE is deliberately absent. */
export type AppTablePrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/** Name of the trigger function from the `create_database_functions` migration. */
const SET_UPDATED_AT_FUNCTION = 'set_updated_at';

/** Name of the trigger function from the `create_database_functions` migration. */
const REJECT_MODIFICATION_FUNCTION = 'reject_modification';

/**
 * Adds a `uuid` primary key named `id` that defaults to a time-ordered UUIDv7.
 *
 * @param table - The table being created.
 * @param knex - Knex instance, used for the raw default expression.
 */
export function addUuidPrimaryKey(table: Knex.CreateTableBuilder, knex: Knex): void {
  table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
}

/**
 * Adds `created_at` and `updated_at` columns, both defaulting to now.
 *
 * Pair with `attachUpdatedAtTrigger` so `updated_at` is maintained by the
 * database rather than by every caller.
 *
 * @param table - The table being created.
 * @param knex - Knex instance, used for the `now()` default.
 */
export function addTimestampColumns(table: Knex.CreateTableBuilder, knex: Knex): void {
  table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
}

/**
 * Adds a nullable `archived_at` column for soft deletion.
 *
 * Rows that other tables reference (agents, skills, sandbox profiles) are
 * archived instead of deleted so run history keeps its references.
 *
 * @param table - The table being created.
 */
export function addArchivedAtColumn(table: Knex.CreateTableBuilder): void {
  table.timestamp('archived_at', { useTz: true }).nullable();
}

/**
 * Creates a unique index that only covers rows that are not archived, so an
 * archived row's name or slug can be reused.
 *
 * @param knex - Knex instance.
 * @param tableName - Table with an `archived_at` column.
 * @param columnName - Column that must be unique among active rows.
 */
export async function createActiveRowUniqueIndex(
  knex: Knex,
  tableName: string,
  columnName: string,
): Promise<void> {
  await knex.raw('CREATE UNIQUE INDEX ?? ON ?? (??) WHERE archived_at IS NULL', [
    `${tableName}_${columnName}_active_unique`,
    tableName,
    columnName,
  ]);
}

/**
 * Keeps `updated_at` current on every UPDATE of the table.
 *
 * @param knex - Knex instance.
 * @param tableName - Table with an `updated_at` column.
 */
export async function attachUpdatedAtTrigger(knex: Knex, tableName: string): Promise<void> {
  await knex.raw(
    `CREATE TRIGGER ?? BEFORE UPDATE ON ?? FOR EACH ROW EXECUTE FUNCTION ${SET_UPDATED_AT_FUNCTION}()`,
    [`${tableName}_set_updated_at`, tableName],
  );
}

/**
 * Makes a table's rows immutable: UPDATE and TRUNCATE always fail, and DELETE
 * fails too unless `isDeleteAllowed` is set.
 *
 * These triggers apply to every role, including the owner. The app role also
 * lacks the privileges to disable them (see D-005 in docs/decisions.md).
 *
 * @param knex - Knex instance.
 * @param tableName - Table to protect.
 * @param options.isDeleteAllowed - Whether DELETE stays possible, for example
 *   so the owner can remove seed data. The app role still needs a DELETE grant.
 */
export async function attachImmutableRowTriggers(
  knex: Knex,
  tableName: string,
  options: { isDeleteAllowed: boolean },
): Promise<void> {
  const blockedRowOperations = options.isDeleteAllowed ? 'UPDATE' : 'UPDATE OR DELETE';
  await knex.raw(
    `CREATE TRIGGER ?? BEFORE ${blockedRowOperations} ON ?? FOR EACH ROW EXECUTE FUNCTION ${REJECT_MODIFICATION_FUNCTION}()`,
    [`${tableName}_reject_row_modification`, tableName],
  );
  await knex.raw(
    `CREATE TRIGGER ?? BEFORE TRUNCATE ON ?? FOR EACH STATEMENT EXECUTE FUNCTION ${REJECT_MODIFICATION_FUNCTION}()`,
    [`${tableName}_reject_truncate`, tableName],
  );
}

/**
 * Grants the runtime app role exactly the listed privileges on a table.
 *
 * @param knex - Knex instance.
 * @param tableName - Table to grant on.
 * @param privileges - Privileges the API needs. Keep this as small as possible.
 */
export async function grantTablePrivilegesToApp(
  knex: Knex,
  tableName: string,
  privileges: readonly AppTablePrivilege[],
): Promise<void> {
  await knex.raw(`GRANT ${privileges.join(', ')} ON ?? TO ??`, [tableName, APP_DATABASE_ROLE]);
}
