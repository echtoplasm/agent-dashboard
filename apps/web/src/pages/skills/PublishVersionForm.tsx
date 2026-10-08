/**
 * Form for publishing a new immutable skill version.
 *
 * Files can be typed in or loaded from a local folder. A loaded folder is
 * prepared with the same rules as the `skills:import` CLI
 * (`prepareSkillFolderImport`): hidden and binary files are skipped and
 * listed, and a root `permissions.json` fills the manifest. Files and the
 * manifest are checked with the same shared schemas the API uses before
 * anything is sent, so most mistakes are caught without a round trip.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import {
  SKILL_ENTRY_FILE_NAME,
  SKILL_PERMISSIONS_FILE_NAME,
  SkillFileListSchema,
  SkillPermissionsManifestSchema,
  prepareSkillFolderImport,
} from '@agent-dashboard/shared';
import type {
  FieldProblem,
  PublishSkillVersionRequest,
  SkillFolderImport,
} from '@agent-dashboard/shared';
import { ApiError } from '../../api/api-client.js';
import { publishSkillVersion } from '../../api/endpoints.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { FormField } from '../../components/FormField.js';
import { useAsyncAction } from '../../hooks/useApiResource.js';

const DEFAULT_SKILL_MARKDOWN = `---
name: my-skill
description: What this skill does and when to use it.
---

Instructions for the agent go here.
`;

const DEFAULT_MANIFEST_TEXT = JSON.stringify({ manifestVersion: 1 }, null, 2);
const JSON_INDENT_SPACES = 2;

interface ExtraFile {
  key: number;
  path: string;
  content: string;
}

/**
 * Reads the files a folder picker returned.
 *
 * @param fileList - From `<input type="file" webkitdirectory>`.
 * @returns The prepared import.
 */
async function readPickedFolder(fileList: FileList): Promise<SkillFolderImport> {
  const localFiles = await Promise.all(
    Array.from(fileList, async (file) => ({
      // Browsers report picked folders as `folder-name/path/in/folder`.
      relativePath: file.webkitRelativePath === '' ? file.name : file.webkitRelativePath,
      content: await file.text(),
    })),
  );
  return prepareSkillFolderImport(localFiles);
}

/**
 * Lets an `<input type="file">` pick a whole folder. `webkitdirectory` is
 * supported by every current browser but missing from React's types.
 */
function enableFolderPicking(input: HTMLInputElement | null): void {
  input?.setAttribute('webkitdirectory', '');
}

function toProblems(issues: { path: PropertyKey[]; message: string }[], prefix: string) {
  return issues.map((issue): FieldProblem => ({
    path: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

/**
 * Renders the publish form.
 *
 * @param props.skillId - The skill to publish a version of.
 * @param props.latestVersion - Shown as a hint; the new version must be higher.
 * @param props.onPublished - Called after a successful publish.
 * @returns The form.
 */
export function PublishVersionForm({
  skillId,
  latestVersion,
  onPublished,
}: {
  skillId: string;
  latestVersion: string | null;
  onPublished: () => void;
}): ReactElement {
  const [version, setVersion] = useState('');
  const [changelog, setChangelog] = useState('');
  const [skillMarkdown, setSkillMarkdown] = useState(DEFAULT_SKILL_MARKDOWN);
  const [manifestText, setManifestText] = useState(DEFAULT_MANIFEST_TEXT);
  const [extraFiles, setExtraFiles] = useState<ExtraFile[]>([]);
  const [nextFileKey, setNextFileKey] = useState(0);
  const [folderImportSummary, setFolderImportSummary] = useState<string>();
  const publishAction = useAsyncAction();

  async function loadFolder(fileList: FileList | null): Promise<void> {
    if (fileList === null || fileList.length === 0) {
      return;
    }
    const folderImport = await readPickedFolder(fileList);
    const entryFile = folderImport.files.find((file) => file.path === SKILL_ENTRY_FILE_NAME);
    const otherFiles = folderImport.files.filter((file) => file !== entryFile);
    if (entryFile !== undefined) {
      setSkillMarkdown(entryFile.content);
    }
    if (folderImport.manifestText !== null) {
      setManifestText(folderImport.manifestText);
    }
    setExtraFiles(otherFiles.map((file, index) => ({ key: nextFileKey + index, ...file })));
    setNextFileKey((key) => key + otherFiles.length);
    const skippedNote = folderImport.skippedFiles
      .map((skippedFile) => `${skippedFile.path} (${skippedFile.reason})`)
      .join(', ');
    setFolderImportSummary(
      [
        `Loaded ${folderImport.files.length} file(s)`,
        entryFile === undefined ? `no ${SKILL_ENTRY_FILE_NAME} found` : undefined,
        folderImport.manifestText === null
          ? undefined
          : `manifest from ${SKILL_PERMISSIONS_FILE_NAME}`,
        skippedNote === '' ? undefined : `skipped ${skippedNote}`,
      ]
        .filter((part) => part !== undefined)
        .join('; '),
    );
  }

  function updateExtraFile(key: number, changes: Partial<ExtraFile>): void {
    setExtraFiles((files) =>
      files.map((file) => (file.key === key ? { ...file, ...changes } : file)),
    );
  }

  /**
   * Validates the form with the shared schemas.
   *
   * @returns The request to send.
   * @throws {ApiError} Shaped like the server's validation errors, for display.
   */
  function buildRequest(): PublishSkillVersionRequest {
    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(manifestText);
    } catch {
      throw new ApiError(0, 'validation_failed', 'The permissions manifest is not valid JSON');
    }
    const manifestResult = SkillPermissionsManifestSchema.safeParse(parsedManifest);
    const files = [
      { path: SKILL_ENTRY_FILE_NAME, content: skillMarkdown },
      ...extraFiles.map(({ path, content }) => ({ path: path.trim(), content })),
    ];
    const filesResult = SkillFileListSchema.safeParse(files);
    if (!manifestResult.success || !filesResult.success) {
      const problems = [
        ...(manifestResult.error
          ? toProblems(manifestResult.error.issues, 'permissionsManifest')
          : []),
        ...(filesResult.error ? toProblems(filesResult.error.issues, 'files') : []),
      ];
      throw new ApiError(0, 'validation_failed', 'Fix these problems before publishing', problems);
    }
    return {
      version: version.trim(),
      changelog: changelog.trim(),
      permissionsManifest: manifestResult.data,
      files: filesResult.data,
    };
  }

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    void publishAction
      .run(() => publishSkillVersion(skillId, buildRequest()))
      .then((isPublished) => {
        if (isPublished) {
          setVersion('');
          setChangelog('');
          onPublished();
        }
      });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-row">
        <FormField label="Version" hint="Semantic version. Published versions can never change.">
          <input
            value={version}
            onChange={(event) => {
              setVersion(event.target.value);
            }}
            placeholder={latestVersion === null ? '1.0.0' : `Higher than ${latestVersion}`}
            required
          />
        </FormField>
        <label className="field">
          <span>Changelog</span>
          <input
            value={changelog}
            onChange={(event) => {
              setChangelog(event.target.value);
            }}
          />
        </label>
      </div>
      <FormField
        label="Load from folder"
        hint={
          folderImportSummary ??
          `Optional. Fills in ${SKILL_ENTRY_FILE_NAME}, the other files and, from a root ${SKILL_PERMISSIONS_FILE_NAME}, the manifest.`
        }
      >
        <input
          type="file"
          ref={enableFolderPicking}
          onChange={(event) => {
            void loadFolder(event.target.files);
          }}
        />
      </FormField>
      <FormField
        label={SKILL_ENTRY_FILE_NAME}
        hint="Must start with frontmatter containing name and description."
      >
        <textarea
          value={skillMarkdown}
          onChange={(event) => {
            setSkillMarkdown(event.target.value);
          }}
          rows={10}
        />
      </FormField>

      {extraFiles.map((file) => (
        <fieldset key={file.key} className="file-block form">
          <div className="form-row">
            <label className="field">
              <span>File path</span>
              <input
                value={file.path}
                onChange={(event) => {
                  updateExtraFile(file.key, { path: event.target.value });
                }}
                placeholder="scripts/check.sh"
                required
              />
            </label>
          </div>
          <label className="field">
            <span>Content</span>
            <textarea
              value={file.content}
              onChange={(event) => {
                updateExtraFile(file.key, { content: event.target.value });
              }}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => {
                setExtraFiles((files) => files.filter((candidate) => candidate.key !== file.key));
              }}
            >
              Remove file
            </button>
          </div>
        </fieldset>
      ))}
      <div className="form-actions">
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setExtraFiles((files) => [...files, { key: nextFileKey, path: '', content: '' }]);
            setNextFileKey((key) => key + 1);
          }}
        >
          Add file
        </button>
      </div>

      <FormField
        label="Permissions manifest (JSON)"
        hint={
          <>
            Omitted sections default to no network, no extra writable paths and no extra commands.
            Example:{' '}
            <code>
              {JSON.stringify(
                {
                  manifestVersion: 1,
                  network: { isAllowed: true, allowedHosts: ['registry.npmjs.org'] },
                },
                null,
                JSON_INDENT_SPACES,
              )}
            </code>
          </>
        }
      >
        <textarea
          value={manifestText}
          onChange={(event) => {
            setManifestText(event.target.value);
          }}
          rows={6}
        />
      </FormField>

      <ErrorBanner error={publishAction.error} />
      <div className="form-actions">
        <button type="submit" className="button" disabled={publishAction.isRunning}>
          Publish version
        </button>
      </div>
    </form>
  );
}
