/**
 * Gives services access to repositories without exposing Knex.
 *
 * Services read through `repositories` and wrap every change in
 * `runInTransaction`, which hands them repositories bound to one
 * transaction. A change and its audit entry are then always committed or
 * rolled back together.
 */
import type { Knex } from 'knex';
import { createAgentsRepository } from '../modules/agents/agents.repository.js';
import type { AgentsRepository } from '../modules/agents/agents.repository.js';
import { createSessionsRepository } from '../modules/auth/sessions.repository.js';
import type { SessionsRepository } from '../modules/auth/sessions.repository.js';
import { createAuditRepository } from '../modules/audit/audit.repository.js';
import type { AuditRepository } from '../modules/audit/audit.repository.js';
import { createProvidersRepository } from '../modules/providers/providers.repository.js';
import type { ProvidersRepository } from '../modules/providers/providers.repository.js';
import { createSandboxProfilesRepository } from '../modules/sandbox-profiles/sandbox-profiles.repository.js';
import type { SandboxProfilesRepository } from '../modules/sandbox-profiles/sandbox-profiles.repository.js';
import { createUsersRepository } from '../modules/users/users.repository.js';
import type { UsersRepository } from '../modules/users/users.repository.js';
import type { DatabaseExecutor } from './database-executor.js';

/** Every repository, bound to the same connection or transaction. */
export interface Repositories {
  users: UsersRepository;
  sessions: SessionsRepository;
  audit: AuditRepository;
  providers: ProvidersRepository;
  sandboxProfiles: SandboxProfilesRepository;
  agents: AgentsRepository;
}

/** Repository access plus transactions, as services see it. */
export interface DataAccess {
  /** Repositories on the shared pool, for reads outside a transaction. */
  repositories: Repositories;
  /**
   * Runs `work` in a transaction. It commits if `work` resolves and rolls
   * back if it throws.
   */
  runInTransaction<Result>(work: (repositories: Repositories) => Promise<Result>): Promise<Result>;
}

/**
 * Builds every repository against one executor.
 *
 * @param database - A Knex client or transaction.
 * @returns The repositories.
 */
export function createRepositories(database: DatabaseExecutor): Repositories {
  return {
    users: createUsersRepository(database),
    sessions: createSessionsRepository(database),
    audit: createAuditRepository(database),
    providers: createProvidersRepository(database),
    sandboxProfiles: createSandboxProfilesRepository(database),
    agents: createAgentsRepository(database),
  };
}

/**
 * Creates the data access object services depend on.
 *
 * @param database - Knex client connected as the app role.
 * @returns Repositories and a transaction runner.
 */
export function createDataAccess(database: Knex): DataAccess {
  return {
    repositories: createRepositories(database),
    runInTransaction: (work) =>
      database.transaction((transaction) => work(createRepositories(transaction))),
  };
}
