/**
 * Creates the skill registry: `skills`, `skill_supported_providers`,
 * `skill_versions` and `agent_skill_assignments`.
 *
 * - `skills` is the stable identity (slug, name). It is archived, never deleted.
 * - `skill_supported_providers` lists which providers can load a skill. It is
 *   a join table rather than an array column so foreign keys keep it honest.
 * - `skill_versions` are immutable once published: a trigger rejects every
 *   UPDATE and TRUNCATE, and the app role can only SELECT and INSERT. Editing
 *   a skill means publishing a new version. `content_hash` is the SHA-256 of
 *   the version's files, so tampering with stored content can be detected.
 * - `agent_skill_assignments` is an agent's loadout: at most one version of
 *   each skill per agent. It stores `skill_id` alongside `skill_version_id`
 *   with a two-column foreign key, so the database guarantees the version
 *   really belongs to that skill and the per-skill uniqueness holds.
 */
import type { Knex } from 'knex';
import {
  addArchivedAtColumn,
  addTimestampColumns,
  addUuidPrimaryKey,
  attachImmutableRowTriggers,
  attachUpdatedAtTrigger,
  createActiveRowUniqueIndex,
  grantTablePrivilegesToApp,
} from '../migration-helpers.js';

/** Lowercase kebab-case, such as `run-unit-tests`. */
const SKILL_SLUG_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';

/**
 * Semantic version with an optional pre-release tag, such as `1.2.0-beta.1`.
 *
 * Uses `{0,1}` rather than `?` because Knex treats `?` as a query binding
 * placeholder, even inside CHECK expressions.
 */
const SEMANTIC_VERSION_PATTERN =
  '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+){0,1}$';

/** Lowercase hex SHA-256 digest. */
const SHA256_HEX_PATTERN = '^[0-9a-f]{64}$';

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('skills', (table) => {
    addUuidPrimaryKey(table, knex);
    table.text('slug').notNullable().checkRegex(SKILL_SLUG_PATTERN, 'skills_slug_format_check');
    table.text('name').notNullable();
    table.text('description').notNullable().defaultTo('');
    table.uuid('created_by').nullable().references('id').inTable('users');
    addArchivedAtColumn(table);
    addTimestampColumns(table, knex);
  });
  await createActiveRowUniqueIndex(knex, 'skills', 'slug');
  await attachUpdatedAtTrigger(knex, 'skills');
  await grantTablePrivilegesToApp(knex, 'skills', ['SELECT', 'INSERT', 'UPDATE']);

  await knex.schema.createTable('skill_supported_providers', (table) => {
    table.uuid('skill_id').notNullable().references('id').inTable('skills').onDelete('CASCADE');
    table.uuid('provider_id').notNullable().references('id').inTable('agent_providers');
    table.primary(['skill_id', 'provider_id']);
    table.index('provider_id');
  });
  await grantTablePrivilegesToApp(knex, 'skill_supported_providers', [
    'SELECT',
    'INSERT',
    'DELETE',
  ]);

  await knex.schema.createTable('skill_versions', (table) => {
    addUuidPrimaryKey(table, knex);
    table.uuid('skill_id').notNullable().references('id').inTable('skills');
    table
      .text('version')
      .notNullable()
      .checkRegex(SEMANTIC_VERSION_PATTERN, 'skill_versions_version_format_check');
    table
      .text('content_hash')
      .notNullable()
      .checkRegex(SHA256_HEX_PATTERN, 'skill_versions_content_hash_format_check');
    table.text('storage_path').notNullable();
    table.jsonb('permissions_manifest').notNullable();
    table.text('changelog').notNullable().defaultTo('');
    table.uuid('published_by').nullable().references('id').inTable('users');
    table.timestamp('published_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check(
      "jsonb_typeof(permissions_manifest) = 'object'",
      [],
      'skill_versions_permissions_manifest_object_check',
    );

    table.unique(['skill_id', 'version']);
    // Target of the two-column foreign key from agent_skill_assignments.
    table.unique(['id', 'skill_id']);
  });
  // DELETE stays possible for the owner (e.g. removing seed data). The app role
  // gets no DELETE grant, so from the API versions are append-only.
  await attachImmutableRowTriggers(knex, 'skill_versions', { isDeleteAllowed: true });
  await grantTablePrivilegesToApp(knex, 'skill_versions', ['SELECT', 'INSERT']);

  await knex.schema.createTable('agent_skill_assignments', (table) => {
    addUuidPrimaryKey(table, knex);
    table.uuid('agent_id').notNullable().references('id').inTable('agents');
    table.uuid('skill_id').notNullable();
    table.uuid('skill_version_id').notNullable();
    table.uuid('assigned_by').nullable().references('id').inTable('users');
    table.timestamp('assigned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign(['skill_version_id', 'skill_id'])
      .references(['id', 'skill_id'])
      .inTable('skill_versions');
    table.unique(['agent_id', 'skill_id']);
    table.index('skill_version_id');
  });
  await grantTablePrivilegesToApp(knex, 'agent_skill_assignments', [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
  ]);
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('agent_skill_assignments');
  await knex.schema.dropTable('skill_versions');
  await knex.schema.dropTable('skill_supported_providers');
  await knex.schema.dropTable('skills');
}
