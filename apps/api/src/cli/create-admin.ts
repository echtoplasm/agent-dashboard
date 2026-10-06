/**
 * Creates an admin user. Use it once to bootstrap a fresh install; after
 * that, admins manage users from the web app.
 *
 * Connects as the restricted app role (`DATABASE_URL`) and records a
 * `user.created` audit entry with no actor, like any system action.
 *
 * @example
 * ```sh
 * npm run users:create-admin -- --username alice
 * npm run users:create-admin -- --username alice --email alice@example.com
 * pass show dashboard/admin | npm run users:create-admin -- --username alice --password-stdin
 * ```
 */
import { parseArgs } from 'node:util';
import { PasswordSchema, UsernameSchema } from '@agent-dashboard/shared';
import { loadApiConfig } from '../config/env.js';
import { createDataAccess } from '../db/data-access.js';
import { buildKnexConnectionConfig, createDatabaseClient } from '../db/knex.js';
import { SYSTEM_AUDIT_CONTEXT } from '../modules/audit/audit.types.js';
import { createUsersService } from '../modules/users/users.service.js';
import { promptHidden, readAllStandardInput } from './prompt.js';

const FAILURE_EXIT_CODE = 1;

/** Thrown for bad command-line input; the message is shown as-is. */
class CliInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInputError';
  }
}

async function readPassword(isReadingFromStandardInput: boolean): Promise<string> {
  if (isReadingFromStandardInput) {
    return readAllStandardInput();
  }
  const password = await promptHidden('Password: ');
  const confirmation = await promptHidden('Confirm password: ');
  if (password !== confirmation) {
    throw new CliInputError('Passwords do not match.');
  }
  return password;
}

function parseCliArguments(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      username: { type: 'string' },
      email: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
    },
  });
  const usernameResult = UsernameSchema.safeParse(values.username);
  if (!usernameResult.success) {
    throw new CliInputError('--username is required: 3 to 64 letters, digits, ".", "_" or "-".');
  }
  return {
    username: usernameResult.data,
    email: values.email ?? null,
    isReadingPasswordFromStandardInput: values['password-stdin'],
  };
}

async function main(argv: string[]): Promise<void> {
  const cliArguments = parseCliArguments(argv);
  const passwordResult = PasswordSchema.safeParse(
    await readPassword(cliArguments.isReadingPasswordFromStandardInput),
  );
  if (!passwordResult.success) {
    throw new CliInputError('Password must be 12 to 256 characters.');
  }

  const apiConfig = loadApiConfig(process.env);
  const database = createDatabaseClient(buildKnexConnectionConfig(apiConfig.databaseUrl));
  try {
    const usersService = createUsersService(createDataAccess(database));
    const adminUser = await usersService.createUser(
      {
        username: cliArguments.username,
        email: cliArguments.email,
        role: 'admin',
        password: passwordResult.data,
      },
      SYSTEM_AUDIT_CONTEXT,
    );
    process.stdout.write(`Created admin "${adminUser.username}" (${adminUser.id}).\n`);
  } finally {
    await database.destroy();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
});
