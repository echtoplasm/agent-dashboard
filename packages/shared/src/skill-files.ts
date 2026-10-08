/**
 * Rules for the files that make up a published skill version.
 *
 * Skills are uploaded as a JSON list of text files. These rules live in the
 * shared package so the web form can catch problems before uploading, and
 * the API enforces the same rules again on receipt.
 */
import { z } from 'zod';

/** Name of the required instructions file at the root of every skill. */
export const SKILL_ENTRY_FILE_NAME = 'SKILL.md';

/** Upload limits for one skill version. */
export const SKILL_FILE_LIMITS = {
  MAX_FILES: 50,
  MAX_FILE_BYTES: 256 * 1024,
  MAX_TOTAL_BYTES: 1024 * 1024,
  MAX_PATH_LENGTH: 200,
  MAX_PATH_DEPTH: 5,
} as const;

/**
 * One path segment: starts with a letter, digit or underscore, so hidden
 * files, `.` and `..` are all impossible.
 */
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const textEncoder = new TextEncoder();

/**
 * Returns the UTF-8 size of a string in bytes.
 *
 * @param text - Any string.
 * @returns Its encoded length.
 */
export function getUtf8ByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

/**
 * Reports whether a skill file path is safe to write under the skill's
 * storage directory: relative, forward slashes only, no hidden or parent
 * segments, and not too deep.
 *
 * @param path - e.g. `scripts/check.sh`.
 * @returns `true` if the path is acceptable.
 */
export function isSafeSkillFilePath(path: string): boolean {
  const segments = path.split('/');
  return (
    path.length <= SKILL_FILE_LIMITS.MAX_PATH_LENGTH &&
    segments.length <= SKILL_FILE_LIMITS.MAX_PATH_DEPTH &&
    segments.every((segment) => PATH_SEGMENT_PATTERN.test(segment))
  );
}

/** Validates one uploaded skill file. */
export const SkillFileSchema = z.strictObject({
  path: z.string().refine(isSafeSkillFilePath, {
    message:
      'Must be a relative path using "/" with segments of letters, digits, ".", "_" or "-" (no hidden files)',
  }),
  content: z
    .string()
    .refine((content) => getUtf8ByteLength(content) <= SKILL_FILE_LIMITS.MAX_FILE_BYTES, {
      message: `Each file must be at most ${SKILL_FILE_LIMITS.MAX_FILE_BYTES} bytes`,
    }),
});

/** One uploaded skill file. */
export type SkillFile = z.infer<typeof SkillFileSchema>;

/**
 * Checks the YAML frontmatter of a `SKILL.md` without a YAML parser: the
 * file must open with a `---` block containing non-empty `name:` and
 * `description:` lines. Each provider's full format is checked in Phase 3.
 *
 * @param markdown - Contents of `SKILL.md`.
 * @returns Human-readable problems; empty when the frontmatter looks valid.
 */
export function findSkillFrontmatterProblems(markdown: string): string[] {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return [`${SKILL_ENTRY_FILE_NAME} must start with a "---" frontmatter block`];
  }
  const closingLineIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closingLineIndex === -1) {
    return [`${SKILL_ENTRY_FILE_NAME} frontmatter is missing its closing "---" line`];
  }

  const frontmatterLines = lines.slice(1, closingLineIndex);
  const requiredKeys = ['name', 'description'];
  return requiredKeys
    .filter((key) => !frontmatterLines.some((line) => new RegExp(`^${key}:\\s*\\S`).test(line)))
    .map((key) => `${SKILL_ENTRY_FILE_NAME} frontmatter needs a non-empty "${key}:" line`);
}

/**
 * Validates the complete file list of a skill version: within limits, no
 * duplicate paths, and a `SKILL.md` at the root with valid frontmatter.
 */
export const SkillFileListSchema = z
  .array(SkillFileSchema)
  .min(1)
  .max(SKILL_FILE_LIMITS.MAX_FILES)
  .superRefine((files, context) => {
    const paths = files.map((file) => file.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: 'custom', message: 'File paths must be unique' });
    }

    const totalBytes = files.reduce((sum, file) => sum + getUtf8ByteLength(file.content), 0);
    if (totalBytes > SKILL_FILE_LIMITS.MAX_TOTAL_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `All files together must be at most ${SKILL_FILE_LIMITS.MAX_TOTAL_BYTES} bytes`,
      });
    }

    const entryFile = files.find((file) => file.path === SKILL_ENTRY_FILE_NAME);
    if (entryFile === undefined) {
      context.addIssue({ code: 'custom', message: `A root ${SKILL_ENTRY_FILE_NAME} is required` });
      return;
    }
    for (const problem of findSkillFrontmatterProblems(entryFile.content)) {
      context.addIssue({ code: 'custom', message: problem });
    }
  });

/**
 * Optional file at the root of a skill folder holding its permissions
 * manifest. When a folder is imported it becomes the manifest, not a skill file.
 */
export const SKILL_PERMISSIONS_FILE_NAME = 'permissions.json';

/** A file read from a local skill folder, before any checks. */
export interface LocalSkillFile {
  /** Path relative to the chosen folder, with `/` or `\` separators. */
  relativePath: string;
  content: string;
}

/** Why a local file was left out of an import. */
export type SkippedFileReason = 'hidden' | 'binary' | 'unsupported path';

/** The result of preparing a local folder for publishing. */
export interface SkillFolderImport {
  /** Files to publish, sorted by path. Still to be checked with `SkillFileListSchema`. */
  files: SkillFile[];
  /** Contents of a root `permissions.json`, or null if the folder has none. */
  manifestText: string | null;
  /** Files that were left out, and why. */
  skippedFiles: { path: string; reason: SkippedFileReason }[];
}

/**
 * Strips a shared top-level folder name when `SKILL.md` isn't already at the
 * root. Browsers report picked folders as `my-skill/SKILL.md`.
 */
function stripSharedTopFolder(paths: string[]): string[] {
  if (paths.includes(SKILL_ENTRY_FILE_NAME)) {
    return paths;
  }
  const topFolders = new Set(paths.map((path) => path.split('/')[0]));
  const isEveryPathNested = paths.every((path) => path.includes('/'));
  return topFolders.size === 1 && isEveryPathNested
    ? paths.map((path) => path.slice(path.indexOf('/') + 1))
    : paths;
}

function classifySkippedFile(path: string, content: string): SkippedFileReason | undefined {
  if (path.split('/').some((segment) => segment.startsWith('.'))) {
    return 'hidden';
  }
  if (content.includes('\u0000')) {
    return 'binary';
  }
  return isSafeSkillFilePath(path) ? undefined : 'unsupported path';
}

/**
 * Turns the files of a local skill folder into a publishable file list.
 *
 * Used by both the `skills:import` CLI and the web folder picker, so a
 * folder imports the same way from either. Hidden files (such as `.git/`
 * or `.DS_Store`) and binary files are skipped rather than failing the
 * whole import, and reported so nothing is dropped silently.
 *
 * @param localFiles - Every file found in the folder.
 * @returns Files to publish, the manifest text if present, and what was skipped.
 *
 * @example
 * ```ts
 * prepareSkillFolderImport([{ relativePath: 'my-skill/SKILL.md', content }]).files;
 * // [{ path: 'SKILL.md', content }]
 * ```
 */
export function prepareSkillFolderImport(localFiles: readonly LocalSkillFile[]): SkillFolderImport {
  const normalizedPaths = stripSharedTopFolder(
    localFiles.map((file) => file.relativePath.replaceAll('\\', '/').replace(/^\/+/, '')),
  );
  const result: SkillFolderImport = { files: [], manifestText: null, skippedFiles: [] };
  localFiles.forEach((file, index) => {
    const path = normalizedPaths[index] ?? file.relativePath;
    if (path === SKILL_PERMISSIONS_FILE_NAME) {
      result.manifestText = file.content;
      return;
    }
    const skippedReason = classifySkippedFile(path, file.content);
    if (skippedReason === undefined) {
      result.files.push({ path, content: file.content });
    } else {
      result.skippedFiles.push({ path, reason: skippedReason });
    }
  });
  result.files.sort((left, right) => (left.path < right.path ? -1 : 1));
  return result;
}
