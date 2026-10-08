/**
 * Prepares the schema for launching runs (Phase 3).
 *
 * - `agent_runs.cost_source` records whether a run's cost was reported by
 *   the provider or estimated from token counts. It is set exactly when
 *   `cost_micro_usd` is.
 * - `model_prices` holds admin-maintained per-million-token prices, used to
 *   estimate cost for providers that only report tokens (Codex). Prices are
 *   integer micro-USD like every other amount (D-008).
 * - The app role gains DELETE on `agents`, `skills` and their dependent
 *   rows, so admins can remove an agent that never ran or a skill that never
 *   had a version published. Anything referenced by run history still can't
 *   be deleted: the foreign keys from `agent_runs`, `skill_versions` and
 *   `agent_run_skill_versions` refuse it.
 * - Provider rows get the base arguments and skills directories the
 *   adapters actually use, verified against Claude Code 2.1.291 and
 *   codex-cli 0.160.1 inside the sandbox image. These columns describe the
 *   adapters for the UI; the adapters themselves own the command line.
 *
 * Cost source values are written out rather than imported from
 * `@agent-dashboard/shared` (see the `create_users` migration for why).
 */
import type { Knex } from 'knex';
import { APP_DATABASE_ROLE } from '../database-roles.js';
import {
  addTimestampColumns,
  addUuidPrimaryKey,
  attachUpdatedAtTrigger,
  grantTablePrivilegesToApp,
} from '../migration-helpers.js';

const COST_SOURCES_AT_CREATION = ['provider_reported', 'estimated'];

const PRICE_COLUMNS = [
  'input_micro_usd_per_million_tokens',
  'cached_input_micro_usd_per_million_tokens',
  'output_micro_usd_per_million_tokens',
] as const;

const PROVIDER_SETTINGS = {
  claude_code: {
    defaultArgs: [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--permission-mode',
      'bypassPermissions',
    ],
    skillsDirectory: '/home/agent/.claude/skills',
  },
  codex: {
    defaultArgs: [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--dangerously-bypass-approvals-and-sandbox',
    ],
    skillsDirectory: '/home/agent/.codex/skills',
  },
} as const;

/** Phase 1 provider settings, restored on rollback. */
const ORIGINAL_DEFAULT_ARGS = {
  claude_code: ['--print', '--output-format', 'stream-json', '--verbose'],
  codex: ['exec', '--json'],
} as const;

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agent_runs', (table) => {
    table
      .text('cost_source')
      .nullable()
      .checkIn(COST_SOURCES_AT_CREATION, 'agent_runs_cost_source_check');
    table.check(
      '(cost_source IS NULL) = (cost_micro_usd IS NULL)',
      [],
      'agent_runs_cost_source_with_cost_check',
    );
  });

  await knex.schema.createTable('model_prices', (table) => {
    addUuidPrimaryKey(table, knex);
    table.uuid('provider_id').notNullable().references('id').inTable('agent_providers');
    table.text('model').notNullable();
    for (const priceColumn of PRICE_COLUMNS) {
      table.bigInteger(priceColumn).notNullable();
      table.check('?? >= 0', [priceColumn], `model_prices_${priceColumn}_non_negative_check`);
    }
    addTimestampColumns(table, knex);
    table.unique(['provider_id', 'model']);
  });
  await attachUpdatedAtTrigger(knex, 'model_prices');
  await grantTablePrivilegesToApp(knex, 'model_prices', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);

  await grantTablePrivilegesToApp(knex, 'agents', ['DELETE']);
  await grantTablePrivilegesToApp(knex, 'skills', ['DELETE']);

  for (const [slug, settings] of Object.entries(PROVIDER_SETTINGS)) {
    await knex('agent_providers')
      .where({ slug })
      .update({
        default_args: JSON.stringify(settings.defaultArgs),
        skills_directory: settings.skillsDirectory,
      });
  }
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  for (const [slug, defaultArgs] of Object.entries(ORIGINAL_DEFAULT_ARGS)) {
    await knex('agent_providers')
      .where({ slug })
      .update({ default_args: JSON.stringify(defaultArgs), skills_directory: null });
  }
  await knex.raw('REVOKE DELETE ON skills, agents FROM ??', [APP_DATABASE_ROLE]);
  await knex.schema.dropTable('model_prices');
  await knex.schema.alterTable('agent_runs', (table) => {
    table.dropChecks(['agent_runs_cost_source_with_cost_check', 'agent_runs_cost_source_check']);
    table.dropColumn('cost_source');
  });
}
