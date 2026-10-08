/**
 * Reads a local skill folder from disk for `skills:import`.
 *
 * Symlinks are not followed, so a folder can't pull in files from
 * elsewhere on the machine (such as a credentials file) by linking to them.
 */
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { SKILL_FILE_LIMITS } from '@agent-dashboard/shared';
import type { LocalSkillFile } from '@agent-dashboard/shared';

/** Directories never worth descending into. */
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules']);

/** Files bigger than this are reported but not read; the publish limit is far lower. */
const MAX_READ_BYTES = SKILL_FILE_LIMITS.MAX_FILE_BYTES * 4;

/** Something found in the folder that was not read. */
export interface UnreadEntry {
  path: string;
  reason: 'symlink' | 'too large';
}

/**
 * Reads every regular file under a folder.
 *
 * @param folderPath - The skill folder.
 * @returns Files with paths relative to the folder, and entries that were not read.
 * @throws If the folder can't be read.
 */
export async function readSkillFolder(
  folderPath: string,
): Promise<{ files: LocalSkillFile[]; unreadEntries: UnreadEntry[] }> {
  const files: LocalSkillFile[] = [];
  const unreadEntries: UnreadEntry[] = [];
  const pendingDirectories = [folderPath];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop() ?? folderPath;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      const relativePath = relative(folderPath, entryPath);
      if (entry.isSymbolicLink()) {
        unreadEntries.push({ path: relativePath, reason: 'symlink' });
      } else if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          pendingDirectories.push(entryPath);
        }
      } else if (entry.isFile()) {
        if ((await lstat(entryPath)).size > MAX_READ_BYTES) {
          unreadEntries.push({ path: relativePath, reason: 'too large' });
        } else {
          files.push({ relativePath, content: await readFile(entryPath, 'utf8') });
        }
      }
    }
  }
  return { files, unreadEntries };
}
