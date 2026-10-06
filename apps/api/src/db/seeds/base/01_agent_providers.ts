/**
 * Seeds the supported agent providers. Runs in every environment.
 *
 * Inserts only providers that are missing, so re-running the seed never
 * overwrites changes an admin has made.
 *
 * Default arguments were checked against the installed CLIs' `--help`
 * (Claude Code 2.1.291, codex-cli 0.160.1). They only select headless,
 * machine-readable output. Sandbox, permission and auth flags are added per
 * run by each adapter in Phase 3. `skills_directory` stays null until each
 * provider's skill discovery has been verified.
 */
import type { Knex } from 'knex';

interface ProviderSeed {
  slug: string;
  display_name: string;
  cli_command: string;
  default_args: string[];
}

const PROVIDER_SEEDS: ProviderSeed[] = [
  {
    slug: 'claude_code',
    display_name: 'Claude Code',
    cli_command: 'claude',
    // stream-json emits one JSON event per line. Earlier Claude Code releases
    // required --verbose alongside it in print mode; confirm with a real run
    // in Phase 3 before relying on it.
    default_args: ['--print', '--output-format', 'stream-json', '--verbose'],
  },
  {
    slug: 'codex',
    display_name: 'OpenAI Codex CLI',
    cli_command: 'codex',
    // `exec` is the non-interactive mode; --json prints events as JSONL.
    default_args: ['exec', '--json'],
  },
];

/**
 * Inserts any provider that does not exist yet.
 *
 * @param knex - Owner-role Knex client.
 */
export async function seed(knex: Knex): Promise<void> {
  await knex('agent_providers')
    .insert(
      PROVIDER_SEEDS.map((providerSeed) => ({
        ...providerSeed,
        default_args: JSON.stringify(providerSeed.default_args),
      })),
    )
    .onConflict('slug')
    .ignore();
}
