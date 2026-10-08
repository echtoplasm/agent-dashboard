/**
 * Tests for the skills:import command line.
 */
import { describe, expect, it } from 'vitest';
import { parseImportSkillArguments } from './import-skill-arguments.js';

describe('parseImportSkillArguments', () => {
  it('reads the folder, skill, version and changelog', () => {
    expect(
      parseImportSkillArguments([
        './greeter',
        '--skill',
        'greeter',
        '--version',
        '1.2.0',
        '--changelog',
        'Kinder',
      ]),
    ).toEqual({
      folderPath: './greeter',
      skillSlug: 'greeter',
      version: '1.2.0',
      changelog: 'Kinder',
    });
  });

  it.each([
    [['--skill', 'greeter', '--version', '1.0.0'], /exactly one folder/],
    [['./a', './b', '--skill', 'greeter', '--version', '1.0.0'], /exactly one folder/],
    [['./a', '--version', '1.0.0'], /--skill/],
    [['./a', '--skill', 'greeter', '--version', 'latest'], /semantic version/],
  ])('rejects %j with usage', (argv, message) => {
    expect(() => parseImportSkillArguments(argv)).toThrow(message);
    expect(() => parseImportSkillArguments(argv)).toThrow(/Usage:/);
  });
});
