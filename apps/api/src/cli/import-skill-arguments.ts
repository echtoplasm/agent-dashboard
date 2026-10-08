/**
 * Parses the `skills:import` command line.
 */
import { parseArgs } from 'node:util';
import { SemanticVersionSchema, SkillSlugSchema } from '@agent-dashboard/shared';
import { CliInputError } from './cli-input-error.js';

/** Shown with every input error. */
export const IMPORT_SKILL_USAGE = [
  'Usage:',
  '  npm run skills:import -- <folder> --skill <slug> --version <semver> [--changelog <text>]',
  '',
  'The folder must contain SKILL.md. A permissions.json at its root becomes the',
  'permissions manifest; without one, the skill gets no extra permissions.',
  'The skill must already exist; create it in the web app first.',
].join('\n');

/** The parsed command line. */
export interface ImportSkillArguments {
  folderPath: string;
  skillSlug: string;
  version: string;
  changelog: string;
}

/**
 * Parses the arguments after the script name.
 *
 * @param argv - e.g. `['./my-skill', '--skill', 'my-skill', '--version', '1.0.0']`.
 * @returns The folder, skill, version and changelog.
 * @throws {CliInputError} With usage text, for anything missing or invalid.
 */
export function parseImportSkillArguments(argv: string[]): ImportSkillArguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        skill: { type: 'string' },
        version: { type: 'string' },
        changelog: { type: 'string', default: '' },
      },
    });
  } catch (error) {
    throw new CliInputError(
      error instanceof Error ? error.message : String(error),
      IMPORT_SKILL_USAGE,
    );
  }
  const [folderPath, ...extraPositionals] = parsed.positionals;
  if (folderPath === undefined || extraPositionals.length > 0) {
    throw new CliInputError('Give exactly one folder to import.', IMPORT_SKILL_USAGE);
  }
  const slugResult = SkillSlugSchema.safeParse(parsed.values.skill);
  if (!slugResult.success) {
    throw new CliInputError(
      '--skill must be an existing skill slug, e.g. run-tests.',
      IMPORT_SKILL_USAGE,
    );
  }
  const versionResult = SemanticVersionSchema.safeParse(parsed.values.version);
  if (!versionResult.success) {
    throw new CliInputError(
      '--version must be a semantic version, e.g. 1.2.0.',
      IMPORT_SKILL_USAGE,
    );
  }
  return {
    folderPath,
    skillSlug: slugResult.data,
    version: versionResult.data,
    changelog: parsed.values.changelog,
  };
}
