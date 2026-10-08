/**
 * Host directories for runs, and safe access to the files agents leave in
 * their workspaces.
 *
 * Each run gets `<RUN_DATA_DIR>/<runId>/`:
 *
 * - `workspace/` is mounted at `/workspace` and kept after the run, so its
 *   files can be listed and downloaded.
 * - `home/` is mounted as HOME and deleted when the run ends. CLIs keep
 *   session state there, which may include details of the credentials they
 *   used. The empty skill mountpoints are created here first, so the
 *   read-only skill mounts don't leave root-owned directories in HOME.
 *
 * Workspace contents are written by the agent and therefore untrusted. An
 * agent can create a symlink to any host path (for example
 * `/workspace/x -> /etc/passwd`) and the API would follow it, so listing
 * and reading never follow symlinks and every resolved path is checked to
 * stay inside the workspace.
 */
import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { lstat, mkdir, opendir, realpath, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { MAX_WORKSPACE_FILES_LISTED } from '@agent-dashboard/shared';
import type { WorkspaceListing } from '@agent-dashboard/shared';

const WORKSPACE_DIRECTORY_NAME = 'workspace';
const HOME_DIRECTORY_NAME = 'home';
const PRIVATE_DIRECTORY_MODE = 0o700;

/** Largest workspace file the API will serve. */
export const MAX_WORKSPACE_FILE_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/** Thrown when a requested workspace file is missing, unsafe or not a regular file. */
export class WorkspaceFileUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'WorkspaceFileUnavailableError';
  }
}

/** Host paths for one run. */
export interface RunDirectories {
  runDirectory: string;
  workspaceDirectory: string;
  homeDirectory: string;
}

/**
 * Computes a run's host directories. Does not create them.
 *
 * @param runDataDirectory - Absolute `RUN_DATA_DIR`.
 * @param runId - The run's id (a UUID, so it is a safe path segment).
 * @returns The directories.
 */
export function getRunDirectories(runDataDirectory: string, runId: string): RunDirectories {
  const runDirectory = join(runDataDirectory, runId);
  return {
    runDirectory,
    workspaceDirectory: join(runDirectory, WORKSPACE_DIRECTORY_NAME),
    homeDirectory: join(runDirectory, HOME_DIRECTORY_NAME),
  };
}

/**
 * Creates a run's workspace and HOME, plus empty mountpoints inside HOME.
 *
 * @param directories - From `getRunDirectories`.
 * @param homeMountpoints - Paths relative to HOME to create, e.g. `.claude/skills/greeter`.
 */
export async function createRunDirectories(
  directories: RunDirectories,
  homeMountpoints: readonly string[],
): Promise<void> {
  await mkdir(directories.workspaceDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await mkdir(directories.homeDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  for (const mountpoint of homeMountpoints) {
    const mountpointPath = resolve(directories.homeDirectory, mountpoint);
    if (!mountpointPath.startsWith(`${directories.homeDirectory}${sep}`)) {
      throw new Error(`Refusing to create a mountpoint outside HOME: ${mountpoint}`);
    }
    await mkdir(mountpointPath, { recursive: true });
  }
}

/**
 * Deletes a run's HOME directory.
 *
 * @param directories - From `getRunDirectories`.
 */
export async function removeRunHome(directories: RunDirectories): Promise<void> {
  await rm(directories.homeDirectory, { recursive: true, force: true });
}

/**
 * Lists the regular files in a workspace, without following symlinks.
 *
 * @param workspaceDirectory - The run's workspace.
 * @returns Files sorted by path, up to `MAX_WORKSPACE_FILES_LISTED`. Missing
 *   workspaces (runs that never started) list as empty.
 */
export async function listWorkspaceFiles(workspaceDirectory: string): Promise<WorkspaceListing> {
  const items: WorkspaceListing['items'] = [];
  const pendingDirectories = [workspaceDirectory];
  let isTruncated = false;

  while (pendingDirectories.length > 0 && !isTruncated) {
    const directory = pendingDirectories.pop() ?? workspaceDirectory;
    let entries;
    try {
      entries = await opendir(directory);
    } catch {
      continue;
    }
    for await (const entry of entries) {
      const entryPath = join(directory, entry.name);
      // Dirent types come from lstat, so symlinks are neither files nor directories here.
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else if (entry.isFile()) {
        if (items.length >= MAX_WORKSPACE_FILES_LISTED) {
          isTruncated = true;
          break;
        }
        const stats = await lstat(entryPath);
        items.push({
          path: relative(workspaceDirectory, entryPath).split(sep).join('/'),
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }
    }
  }
  items.sort((left, right) => (left.path < right.path ? -1 : 1));
  return { items, isTruncated };
}

/** Rejects paths with empty, `.` or `..` segments, backslashes or NUL. */
function isPlainRelativePath(path: string): boolean {
  return path
    .split('/')
    .every(
      (segment) => segment !== '' && segment !== '.' && segment !== '..' && !/[\\\0]/.test(segment),
    );
}

/**
 * Opens a workspace file for download.
 *
 * Every segment of the path is checked with `lstat`, so a symlink anywhere
 * on the way is refused, and the real path must still be inside the
 * workspace.
 *
 * @param workspaceDirectory - The run's workspace.
 * @param relativePath - Path as returned by `listWorkspaceFiles`.
 * @returns A stream of the file and its size.
 * @throws {WorkspaceFileUnavailableError} If the path is unsafe, missing, not a regular file or too large.
 */
export async function openWorkspaceFile(
  workspaceDirectory: string,
  relativePath: string,
): Promise<{ stream: ReadStream; sizeBytes: number }> {
  if (!isPlainRelativePath(relativePath)) {
    throw new WorkspaceFileUnavailableError('Invalid path');
  }
  let currentPath = workspaceDirectory;
  let stats;
  try {
    for (const segment of relativePath.split('/')) {
      currentPath = join(currentPath, segment);
      stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new WorkspaceFileUnavailableError('Symbolic links are not served');
      }
    }
  } catch (error) {
    throw error instanceof WorkspaceFileUnavailableError
      ? error
      : new WorkspaceFileUnavailableError('File not found');
  }
  if (!stats?.isFile()) {
    throw new WorkspaceFileUnavailableError('Not a regular file');
  }
  if (stats.size > MAX_WORKSPACE_FILE_DOWNLOAD_BYTES) {
    throw new WorkspaceFileUnavailableError('File is too large to download');
  }
  const [realWorkspace, realFile] = await Promise.all([
    realpath(workspaceDirectory),
    realpath(currentPath),
  ]);
  if (!realFile.startsWith(`${realWorkspace}${sep}`)) {
    throw new WorkspaceFileUnavailableError('Invalid path');
  }
  return { stream: createReadStream(currentPath), sizeBytes: stats.size };
}
