/**
 * On-disk storage for published skill versions.
 *
 * Each version lives at `<root>/<skillId>/<version>/` and is read-only once
 * written. Publishing first writes files to `<root>/.staging/<random>/`,
 * then renames that directory into place. A rename is atomic on one
 * filesystem, so readers never see a half-written version.
 *
 * Every path is resolved and checked to stay inside its parent directory,
 * even though the API schema already rejects `..` and absolute paths
 * (defense in depth). When a version is read, its content hash is
 * recomputed and compared with the stored one, so tampering on disk is
 * detected. See D-020 in docs/decisions.md.
 */
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { SkillFile } from '@agent-dashboard/shared';

const STAGING_DIRECTORY_NAME = '.staging';
const READ_ONLY_FILE_MODE = 0o444;
const READ_ONLY_DIRECTORY_MODE = 0o555;
const WRITABLE_DIRECTORY_MODE = 0o755;
const PATH_SEPARATOR_FOR_HASHING = '/';

/** Thrown when a path would resolve outside the directory it belongs in. */
export class UnsafeStoragePathError extends Error {
  constructor(path: string) {
    super(`Refusing to use storage path outside its root: ${path}`);
    this.name = 'UnsafeStoragePathError';
  }
}

/** Thrown when a stored version's files no longer match its content hash. */
export class SkillIntegrityError extends Error {
  constructor(storagePath: string) {
    super(`Skill files at ${storagePath} do not match their recorded content hash`);
    this.name = 'SkillIntegrityError';
  }
}

/** Thrown when a version directory already exists on disk. */
export class SkillVersionExistsOnDiskError extends Error {
  constructor(storagePath: string) {
    super(`Skill version directory already exists: ${storagePath}`);
    this.name = 'SkillVersionExistsOnDiskError';
  }
}

/** Files written to a staging directory, waiting to be moved into place. */
export interface StagedSkillFiles {
  stagingDirectory: string;
}

/**
 * Computes the content hash of a skill version.
 *
 * The hash covers each file's path and the SHA-256 of its content, in path
 * order, so it is the same however the files were ordered in the upload.
 *
 * @param files - The version's files.
 * @returns Lowercase hex SHA-256 digest.
 */
export function computeSkillContentHash(files: readonly SkillFile[]): string {
  const sortedFiles = [...files].sort((left, right) => (left.path < right.path ? -1 : 1));
  const manifestHash = createHash('sha256');
  for (const file of sortedFiles) {
    const fileHash = createHash('sha256').update(file.content, 'utf8').digest('hex');
    manifestHash.update(`${file.path}\0${fileHash}\n`);
  }
  return manifestHash.digest('hex');
}

/**
 * Resolves `relativePath` under `baseDirectory`, refusing anything that escapes it.
 *
 * @throws {UnsafeStoragePathError} If the result is outside `baseDirectory`.
 */
function resolveInside(baseDirectory: string, relativePath: string): string {
  const resolvedPath = resolve(baseDirectory, relativePath);
  if (!resolvedPath.startsWith(`${baseDirectory}${sep}`)) {
    throw new UnsafeStoragePathError(relativePath);
  }
  return resolvedPath;
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

async function listDirectoriesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return [
    directory,
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(entry.parentPath, entry.name)),
  ];
}

async function setTreeMode(
  directory: string,
  modes: { fileMode: number; directoryMode: number },
): Promise<void> {
  for (const filePath of await listFilesRecursively(directory)) {
    await chmod(filePath, modes.fileMode);
  }
  // Deepest directories first, so a parent never loses write access before its children.
  const directories = (await listDirectoriesRecursively(directory)).reverse();
  for (const directoryPath of directories) {
    await chmod(directoryPath, modes.directoryMode);
  }
}

async function doesPathExist(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** File operations for skill versions. */
export interface SkillStorage {
  /** Writes files to a fresh staging directory. */
  stageFiles(files: readonly SkillFile[]): Promise<StagedSkillFiles>;
  /**
   * Moves staged files to their permanent location and makes them read-only.
   *
   * @throws {SkillVersionExistsOnDiskError} If the location is already taken.
   */
  moveIntoPlace(stagedFiles: StagedSkillFiles, storagePath: string): Promise<void>;
  /** Deletes a staging directory if it still exists. */
  discardStaged(stagedFiles: StagedSkillFiles): Promise<void>;
  /** Deletes a version's permanent directory. Only for undoing a failed publish. */
  removeVersionFiles(storagePath: string): Promise<void>;
  /**
   * Reads every file of a stored version and verifies the content hash.
   *
   * @throws {SkillIntegrityError} If the files don't match `expectedContentHash`.
   */
  readVersionFiles(storagePath: string, expectedContentHash: string): Promise<SkillFile[]>;
  /**
   * Returns the absolute directory of a stored version, for mounting it
   * read-only into a sandbox.
   *
   * @throws {UnsafeStoragePathError} If the path would leave the storage root.
   */
  resolveVersionDirectory(storagePath: string): string;
}

/**
 * Creates skill storage rooted at a directory.
 *
 * @param rootDirectory - Absolute path, from `SKILL_STORAGE_DIR`.
 * @returns The storage operations.
 */
export function createSkillStorage(rootDirectory: string): SkillStorage {
  const root = resolve(rootDirectory);
  const stagingRoot = join(root, STAGING_DIRECTORY_NAME);

  return {
    async stageFiles(files) {
      const stagingDirectory = join(stagingRoot, randomUUID());
      await mkdir(stagingDirectory, { recursive: true });
      for (const file of files) {
        const filePath = resolveInside(stagingDirectory, file.path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, file.content, { encoding: 'utf8', flag: 'wx' });
      }
      return { stagingDirectory };
    },

    async moveIntoPlace(stagedFiles, storagePath) {
      const versionDirectory = resolveInside(root, storagePath);
      if (await doesPathExist(versionDirectory)) {
        throw new SkillVersionExistsOnDiskError(storagePath);
      }
      await mkdir(dirname(versionDirectory), { recursive: true });
      await rename(stagedFiles.stagingDirectory, versionDirectory);
      await setTreeMode(versionDirectory, {
        fileMode: READ_ONLY_FILE_MODE,
        directoryMode: READ_ONLY_DIRECTORY_MODE,
      });
    },

    async discardStaged(stagedFiles) {
      await rm(stagedFiles.stagingDirectory, { recursive: true, force: true });
    },

    async removeVersionFiles(storagePath) {
      const versionDirectory = resolveInside(root, storagePath);
      if (!(await doesPathExist(versionDirectory))) {
        return;
      }
      await setTreeMode(versionDirectory, {
        fileMode: READ_ONLY_FILE_MODE,
        directoryMode: WRITABLE_DIRECTORY_MODE,
      });
      await rm(versionDirectory, { recursive: true, force: true });
    },

    resolveVersionDirectory: (storagePath) => resolveInside(root, storagePath),

    async readVersionFiles(storagePath, expectedContentHash) {
      const versionDirectory = resolveInside(root, storagePath);
      const files: SkillFile[] = [];
      for (const filePath of await listFilesRecursively(versionDirectory)) {
        files.push({
          path: relative(versionDirectory, filePath).split(sep).join(PATH_SEPARATOR_FOR_HASHING),
          content: await readFile(filePath, 'utf8'),
        });
      }
      if (computeSkillContentHash(files) !== expectedContentHash) {
        throw new SkillIntegrityError(storagePath);
      }
      return files.sort((left, right) => (left.path < right.path ? -1 : 1));
    },
  };
}
