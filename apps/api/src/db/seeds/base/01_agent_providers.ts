/**
 * Seeds the supported agent providers. Runs in every environment.
 *
 * Inserts only providers that are missing, so re-running the seed never
 * overwrites changes an admin has made.
 *
 * Arguments and skills directories match what the adapters in
 * `src/adapters/` use, verified against Claude Code 2.1.291 and codex-cli
 * 0.160.1 inside the sandbox image. They describe the adapters for the UI;
 * the adapters own the actual command line. Keep them in step with the
 * `add_run_costs_model_prices_and_deletes` migration, which updates
 * existing databases.
 */
import type { Knex } from 'knex';

interface ProviderSeed {
  slug: string;
  display_name: string;
  cli_command: string;
  default_args: string[];
  skills_directory: string;
}

const PROVIDER_SEEDS: ProviderSeed[] = [
  {
    slug: 'claude_code',
    display_name: 'Claude Code',
    cli_command: 'claude',
    // stream-json emits one JSON event per line and requires --verbose in
    // print mode. Permission prompts are off because the container is the
    // security boundary (D-024).
    default_args: [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--permission-mode',
      'bypassPermissions',
    ],
    skills_directory: '/home/agent/.claude/skills',
  },
  {
    slug: 'codex',
    display_name: 'OpenAI Codex CLI',
    cli_command: 'codex',
    // `exec` is the non-interactive mode; --json prints events as JSONL.
    // Codex's own sandbox can't run inside Docker, so the container is the
    // boundary instead (D-024).
    default_args: [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--dangerously-bypass-approvals-and-sandbox',
    ],
    skills_directory: '/home/agent/.codex/skills',
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
