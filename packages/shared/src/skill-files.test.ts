/**
 * Tests for skill file upload rules and the SKILL.md frontmatter check.
 */
import { describe, expect, it } from 'vitest';
import {
  prepareSkillFolderImport,
  SKILL_FILE_LIMITS,
  SkillFileListSchema,
  findSkillFrontmatterProblems,
  isSafeSkillFilePath,
} from './skill-files.js';

const VALID_SKILL_MARKDOWN = `---
name: run-tests
description: Runs the project's unit tests.
---

Run \`npm test\` and summarise failures.
`;

describe('isSafeSkillFilePath', () => {
  it.each(['SKILL.md', 'scripts/check.sh', 'reference/api_v2.md'])('accepts %j', (path) => {
    expect(isSafeSkillFilePath(path)).toBe(true);
  });

  it.each([
    '../escape.md',
    'scripts/../../etc/passwd',
    '/etc/passwd',
    '.env',
    'scripts/.hidden',
    'scripts\\windows.bat',
    'a/b/c/d/e/f.md',
    '',
    'dir//file.md',
  ])('rejects %j', (path) => {
    expect(isSafeSkillFilePath(path)).toBe(false);
  });
});

describe('findSkillFrontmatterProblems', () => {
  it('accepts frontmatter with name and description', () => {
    expect(findSkillFrontmatterProblems(VALID_SKILL_MARKDOWN)).toEqual([]);
  });

  it('accepts Windows line endings and a byte-order mark', () => {
    const markdown = `\uFEFF${VALID_SKILL_MARKDOWN.replaceAll('\n', '\r\n')}`;

    expect(findSkillFrontmatterProblems(markdown)).toEqual([]);
  });

  it('requires an opening frontmatter block', () => {
    expect(findSkillFrontmatterProblems('# Just a heading')).toHaveLength(1);
  });

  it('requires a closing frontmatter line', () => {
    expect(findSkillFrontmatterProblems('---\nname: x\ndescription: y\n')).toHaveLength(1);
  });

  it('reports each missing or empty key', () => {
    const problems = findSkillFrontmatterProblems('---\nname:\n---\n');

    expect(problems).toEqual([
      'SKILL.md frontmatter needs a non-empty "name:" line',
      'SKILL.md frontmatter needs a non-empty "description:" line',
    ]);
  });

  it('ignores keys that appear only after the frontmatter', () => {
    const markdown = '---\ntitle: x\n---\nname: y\ndescription: z\n';

    expect(findSkillFrontmatterProblems(markdown)).toHaveLength(2);
  });
});

describe('SkillFileListSchema', () => {
  it('accepts a valid skill', () => {
    const result = SkillFileListSchema.safeParse([
      { path: 'SKILL.md', content: VALID_SKILL_MARKDOWN },
      { path: 'scripts/run.sh', content: 'npm test\n' },
    ]);

    expect(result.success).toBe(true);
  });

  it('requires a root SKILL.md', () => {
    const result = SkillFileListSchema.safeParse([
      { path: 'docs/SKILL.md', content: VALID_SKILL_MARKDOWN },
    ]);

    expect(result.success).toBe(false);
  });

  it('rejects duplicate paths', () => {
    const result = SkillFileListSchema.safeParse([
      { path: 'SKILL.md', content: VALID_SKILL_MARKDOWN },
      { path: 'SKILL.md', content: VALID_SKILL_MARKDOWN },
    ]);

    expect(result.success).toBe(false);
  });

  it('rejects uploads larger than the total size limit', () => {
    const almostFullFile = 'x'.repeat(SKILL_FILE_LIMITS.MAX_FILE_BYTES);
    const files = [
      { path: 'SKILL.md', content: VALID_SKILL_MARKDOWN },
      ...Array.from({ length: 4 }, (_, index) => ({
        path: `data/part-${index}.txt`,
        content: almostFullFile,
      })),
    ];

    expect(SkillFileListSchema.safeParse(files).success).toBe(false);
  });

  it('counts multi-byte characters by their UTF-8 size', () => {
    const multiByteContent = '€'.repeat(SKILL_FILE_LIMITS.MAX_FILE_BYTES / 2);
    const result = SkillFileListSchema.safeParse([
      { path: 'SKILL.md', content: VALID_SKILL_MARKDOWN },
      { path: 'big.txt', content: multiByteContent },
    ]);

    expect(result.success).toBe(false);
  });
});

describe('prepareSkillFolderImport', () => {
  const skillMarkdown = '---\nname: x\ndescription: y\n---\n';

  it('strips the folder name a browser includes and sorts the files', () => {
    const result = prepareSkillFolderImport([
      { relativePath: 'my-skill/scripts/run.sh', content: 'echo hi' },
      { relativePath: 'my-skill/SKILL.md', content: skillMarkdown },
    ]);

    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'scripts/run.sh']);
  });

  it('takes a root permissions.json as the manifest instead of a file', () => {
    const result = prepareSkillFolderImport([
      { relativePath: 'SKILL.md', content: skillMarkdown },
      { relativePath: 'permissions.json', content: '{"manifestVersion":1}' },
    ]);

    expect(result.manifestText).toBe('{"manifestVersion":1}');
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md']);
  });

  it('skips hidden, binary and unsupported files and says why', () => {
    const result = prepareSkillFolderImport([
      { relativePath: 'SKILL.md', content: skillMarkdown },
      { relativePath: '.git/config', content: '[core]' },
      { relativePath: 'logo.png', content: 'PNG\u0000\u0001' },
      { relativePath: 'my notes.txt', content: 'spaces are not allowed' },
    ]);

    expect(result.skippedFiles).toEqual([
      { path: '.git/config', reason: 'hidden' },
      { path: 'logo.png', reason: 'binary' },
      { path: 'my notes.txt', reason: 'unsupported path' },
    ]);
  });

  it('normalizes Windows separators', () => {
    const result = prepareSkillFolderImport([
      { relativePath: 'SKILL.md', content: skillMarkdown },
      { relativePath: 'scripts\\run.sh', content: 'x' },
    ]);

    expect(result.files.map((file) => file.path)).toContain('scripts/run.sh');
  });
});
