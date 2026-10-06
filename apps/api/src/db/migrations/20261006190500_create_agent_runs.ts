/**
 * Creates the run history tables: `agent_runs`, `agent_run_skill_versions`
 * and `run_events`.
 *
 * - `agent_runs` is one execution of an agent. `provider_id` and `model` are
 *   copied from the agent when the run is created, so editing the agent
 *   later doesn't change the history. Token counts and cost are null until
 *   the provider reports them.
 * - `agent_run_skill_versions` records the exact skill versions a run was
 *   launched with, so a change in behaviour can be traced to a skill change.
 *   The app role can only insert and read it.
 * - `run_events` is the ordered event stream of a run. `payload` holds the
 *   normalized event and `raw_payload` the provider's original JSON, with
 *   secrets removed before insert. Events are immutable once written.
 *
 * `run_events.id` is a `bigint` identity column rather than `bigserial`, so
 * inserting needs no separate sequence privilege.
 *
 * Run status values are written out rather than imported from
 * `@agent-dashboard/shared` (see the `create_users` migration for why).
 */
import type { Knex } from 'knex';
import {
  addUuidPrimaryKey,
  attachImmutableRowTriggers,
  attachUpdatedAtTrigger,
  grantTablePrivilegesToApp,
} from '../migration-helpers.js';

const RUN_STATUSES_AT_CREATION = [
  'queued',
  'starting',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
];

/** Lowercase dotted or snake_case event names, such as `assistant_message`. */
const EVENT_TYPE_PATTERN = '^[a-z][a-z0-9_.]*$';

/** Usage columns that are null until reported and never negative (zero is valid). */
const USAGE_COLUMNS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cost_micro_usd',
] as const;

/** Applies the change. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agent_runs', (table) => {
    addUuidPrimaryKey(table, knex);
    table.uuid('agent_id').notNullable().references('id').inTable('agents');
    table.uuid('provider_id').notNullable().references('id').inTable('agent_providers');
    table.uuid('triggered_by').nullable().references('id').inTable('users');
    table.text('prompt').notNullable();
    table
      .text('status')
      .notNullable()
      .defaultTo('queued')
      .checkIn(RUN_STATUSES_AT_CREATION, 'agent_runs_status_check');
    table.text('model').nullable();
    table.text('sandbox_id').nullable();
    table.text('provider_session_id').nullable();
    table.timestamp('queued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('started_at', { useTz: true }).nullable();
    table.timestamp('ended_at', { useTz: true }).nullable();
    table.integer('exit_code').nullable();
    table.text('error_message').nullable();
    for (const usageColumn of USAGE_COLUMNS) {
      table.bigInteger(usageColumn).nullable();
      table.check('?? >= 0', [usageColumn], `agent_runs_${usageColumn}_non_negative_check`);
    }
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check('started_at >= queued_at', [], 'agent_runs_started_after_queued_check');
    table.check('ended_at >= started_at', [], 'agent_runs_ended_after_started_check');
    table.index(['agent_id', 'queued_at']);
  });
  // Speeds up "how many runs are active right now" for MAX_CONCURRENT_RUNS.
  await knex.raw(
    "CREATE INDEX agent_runs_active_status_index ON agent_runs (status) WHERE status IN ('queued', 'starting', 'running')",
  );
  await attachUpdatedAtTrigger(knex, 'agent_runs');
  await grantTablePrivilegesToApp(knex, 'agent_runs', ['SELECT', 'INSERT', 'UPDATE']);

  await knex.schema.createTable('agent_run_skill_versions', (table) => {
    table.uuid('run_id').notNullable().references('id').inTable('agent_runs');
    table.uuid('skill_version_id').notNullable().references('id').inTable('skill_versions');
    table.primary(['run_id', 'skill_version_id']);
    table.index('skill_version_id');
  });
  await grantTablePrivilegesToApp(knex, 'agent_run_skill_versions', ['SELECT', 'INSERT']);

  await knex.schema.createTable('run_events', (table) => {
    table.specificType('id', 'bigint GENERATED ALWAYS AS IDENTITY').primary();
    table.uuid('run_id').notNullable().references('id').inTable('agent_runs');
    table.integer('sequence_number').notNullable();
    table
      .text('event_type')
      .notNullable()
      .checkRegex(EVENT_TYPE_PATTERN, 'run_events_event_type_format_check');
    table.jsonb('payload').notNullable();
    table.jsonb('raw_payload').nullable();
    // When the provider says the event happened, if it says so.
    table.timestamp('occurred_at', { useTz: true }).nullable();
    table.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check('sequence_number >= 0', [], 'run_events_sequence_number_check');
    table.unique(['run_id', 'sequence_number']);
  });
  await attachImmutableRowTriggers(knex, 'run_events', { isDeleteAllowed: true });
  await grantTablePrivilegesToApp(knex, 'run_events', ['SELECT', 'INSERT']);
}

/** Reverts the change. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('run_events');
  await knex.schema.dropTable('agent_run_skill_versions');
  await knex.schema.dropTable('agent_runs');
}
