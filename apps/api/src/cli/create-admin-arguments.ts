/**
 * Parses the `users:create-admin` command line.
 *
 * The username can be given as `--username alice` or as a bare `alice`. The
 * bare form matters because `npm run users:create-admin --username alice`
 * (without `--` before the flag) makes npm swallow `--username` as its own
 * setting and pass only `alice` through.
 */
import { parseArgs } from 'node:util';
import { UsernameSchema } from '@agent-dashboard/shared';

/** Shown with every input error, so the fix is on screen. */
export const CREATE_ADMIN_USAGE = [
  'Usage:',
  '  npm run users:create-admin -- --username <name> [--email <address>] [--password-stdin]',
  '  npm run users:create-admin -- <name>',
  '',
  'Note the "--" after the script name: without it, npm keeps flags like --username for itself.',
].join('\n');

/** Thrown for bad command-line input; the message is shown as-is. */
export class CliInputError extends Error {
  constructor(message: string) {
    super(`${message}\n\n${CREATE_ADMIN_USAGE}`);
    this.name = 'CliInputError';
  }
}

/** The parsed command line. */
export interface CreateAdminArguments {
  username: string;
  email: string | null;
  isReadingPasswordFromStandardInput: boolean;
}

function readUsername(flagUsername: string | undefined, positionals: string[]): unknown {
  if (positionals.length > 1) {
    throw new CliInputError(`Expected one username, got: ${positionals.join(' ')}`);
  }
  const [positionalUsername] = positionals;
  if (flagUsername !== undefined && positionalUsername !== undefined) {
    throw new CliInputError('Give the username once, either as --username or on its own.');
  }
  return flagUsername ?? positionalUsername;
}

/**
 * Parses the arguments after the script name.
 *
 * @param argv - e.g. `['--username', 'alice']` or `['alice']`.
 * @returns The username, email and password source.
 * @throws {CliInputError} With usage text, for unknown flags or a missing or invalid username.
 */
export function parseCreateAdminArguments(argv: string[]): CreateAdminArguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        username: { type: 'string' },
        email: { type: 'string' },
        'password-stdin': { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    throw new CliInputError(error instanceof Error ? error.message : String(error));
  }
  const usernameResult = UsernameSchema.safeParse(
    readUsername(parsed.values.username, parsed.positionals),
  );
  if (!usernameResult.success) {
    throw new CliInputError('A username is required: 3 to 64 letters, digits, ".", "_" or "-".');
  }
  return {
    username: usernameResult.data,
    email: parsed.values.email ?? null,
    isReadingPasswordFromStandardInput: parsed.values['password-stdin'],
  };
}
