/**
 * Publishes a new version of a skill from a local folder.
 *
 * Reads the folder (without following symlinks), prepares it with the same
 * rules as the web folder picker (`prepareSkillFolderImport`), checks it
 * with the shared schemas, and publishes it through the skills service, so
 * every server-side rule applies: the skill must exist and not be archived,
 * the version must be higher than every published one, and the files are
 * hashed and stored read-only. The `skill_version.published` audit entry
 * has no actor, like any system action.
 *
 * @example
 * ```sh
 * npm run skills:import -- ./skills/run-tests --skill run-tests --version 1.1.0 --changelog "Use vitest"
 * ```
 */
import { resolve } from 'node:path';
import {
  PublishSkillVersionRequestSchema,
  SKILL_PERMISSIONS_FILE_NAME,
  prepareSkillFolderImport,
} from '@agent-dashboard/shared';
import type { PublishSkillVersionRequest } from '@agent-dashboard/shared';
import { loadApiConfig } from '../config/env.js';
import { createDataAccess } from '../db/data-access.js';
import { buildKnexConnectionConfig, createDatabaseClient } from '../db/knex.js';
import { toFieldProblems } from '../http/request-validation.js';
import { SYSTEM_AUDIT_CONTEXT } from '../modules/audit/audit.types.js';
import { createSkillStorage } from '../modules/skills/skill-storage.js';
import { createSkillsService } from '../modules/skills/skills.service.js';
import { CliInputError } from './cli-input-error.js';
import { IMPORT_SKILL_USAGE, parseImportSkillArguments } from './import-skill-arguments.js';
import type { ImportSkillArguments } from './import-skill-arguments.js';
import { readSkillFolder } from './read-skill-folder.js';

const FAILURE_EXIT_CODE = 1;

/** The most restrictive manifest, used when the folder has no permissions.json. */
const DEFAULT_MANIFEST = { manifestVersion: 1 };

function parseManifestText(manifestText: string | null): unknown {
  if (manifestText === null) {
    return DEFAULT_MANIFEST;
  }
  try {
    return JSON.parse(manifestText);
  } catch {
    throw new CliInputError(
      `${SKILL_PERMISSIONS_FILE_NAME} is not valid JSON.`,
      IMPORT_SKILL_USAGE,
    );
  }
}

/**
 * Reads and checks the folder, printing anything that was left out.
 *
 * @throws {CliInputError} Listing every problem, if the folder can't be published.
 */
async function buildPublishRequest(
  cliArguments: ImportSkillArguments,
): Promise<PublishSkillVersionRequest> {
  const { files: localFiles, unreadEntries } = await readSkillFolder(
    resolve(cliArguments.folderPath),
  );
  const folderImport = prepareSkillFolderImport(localFiles);
  for (const entry of [...unreadEntries, ...folderImport.skippedFiles]) {
    process.stdout.write(`Skipped ${entry.path} (${entry.reason})\n`);
  }
  const requestResult = PublishSkillVersionRequestSchema.safeParse({
    version: cliArguments.version,
    changelog: cliArguments.changelog,
    permissionsManifest: parseManifestText(folderImport.manifestText),
    files: folderImport.files,
  });
  if (!requestResult.success) {
    const problems = toFieldProblems(requestResult.error).map(
      (problem) => `  - ${problem.path}: ${problem.message}`,
    );
    throw new CliInputError(
      `The folder can't be published:\n${problems.join('\n')}`,
      IMPORT_SKILL_USAGE,
    );
  }
  return requestResult.data;
}

async function main(argv: string[]): Promise<void> {
  const cliArguments = parseImportSkillArguments(argv);
  const publishRequest = await buildPublishRequest(cliArguments);
  const apiConfig = loadApiConfig(process.env);
  const database = createDatabaseClient(buildKnexConnectionConfig(apiConfig.databaseUrl));
  try {
    const dataAccess = createDataAccess(database);
    const skillsService = createSkillsService({
      dataAccess,
      skillStorage: createSkillStorage(apiConfig.skillStorageDirectory),
    });
    const activeSkills = await skillsService.listSkills({ isIncludingArchived: false });
    const skill = activeSkills.find((candidate) => candidate.slug === cliArguments.skillSlug);
    if (skill === undefined) {
      throw new CliInputError(
        `No active skill has the slug "${cliArguments.skillSlug}".`,
        IMPORT_SKILL_USAGE,
      );
    }
    const publishedVersion = await skillsService.publishVersion(
      skill.id,
      publishRequest,
      SYSTEM_AUDIT_CONTEXT,
    );
    process.stdout.write(
      `Published ${skill.slug}@${publishedVersion.version} (${publishRequest.files.length} files, content hash ${publishedVersion.contentHash}).\n`,
    );
  } finally {
    await database.destroy();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
});
