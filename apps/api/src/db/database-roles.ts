/**
 * Names of the Postgres roles created by
 * `infra/postgres/init/01-create-roles-and-databases.sh`.
 *
 * Migrations grant table privileges to the app role by name. See D-005 in
 * docs/decisions.md for why the app and owner roles are separate.
 */

/** Owns the schema and runs migrations. */
export const OWNER_DATABASE_ROLE = 'agent_dashboard_owner';

/** Used by the API at runtime, with only the privileges migrations grant. */
export const APP_DATABASE_ROLE = 'agent_dashboard_app';
