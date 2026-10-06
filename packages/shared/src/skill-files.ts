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
