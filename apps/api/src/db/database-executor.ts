/**
 * The type repositories run their queries against.
 */
import type { Knex } from 'knex';

/**
 * Either the shared Knex client or an open transaction. Repositories accept
 * both, so the same repository code works inside and outside transactions.
 */
export type DatabaseExecutor = Knex | Knex.Transaction;
