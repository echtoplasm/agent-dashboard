/**
 * Tests for reading a local skill folder.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSkillFolder } from './read-skill-folder.js';

let folderPath = '';

beforeAll(async () => {
  folderPath = await mkdtemp(join(tmpdir(), 'skill-folder-'));
  await mkdir(join(folderPath, 'scripts'));
  await mkdir(join(folderPath, '.git'));
  await writeFile(join(folderPath, 'SKILL.md'), '---\nname: x\ndescription: y\n---\n');
  await writeFile(join(folderPath, 'scripts', 'run.sh'), 'echo hi\n');
  await writeFile(join(folderPath, '.git', 'HEAD'), 'ref: main\n');
  await symlink('/etc/hostname', join(folderPath, 'linked.txt'));
});

afterAll(async () => {
  await rm(folderPath, { recursive: true, force: true });
});

describe('readSkillFolder', () => {
  it('reads regular files, skips .git and never follows symlinks', async () => {
    const { files, unreadEntries } = await readSkillFolder(folderPath);

    expect(files.map((file) => file.relativePath).sort()).toEqual(['SKILL.md', 'scripts/run.sh']);
    expect(unreadEntries).toEqual([{ path: 'linked.txt', reason: 'symlink' }]);
  });
});
