/**
 * Tests for the create-admin command line.
 */
import { describe, expect, it } from 'vitest';
import { CliInputError } from './cli-input-error.js';
import { parseCreateAdminArguments } from './create-admin-arguments.js';

describe('parseCreateAdminArguments', () => {
  it('reads --username and --email', () => {
    expect(parseCreateAdminArguments(['--username', 'alice', '--email', 'a@example.com'])).toEqual({
      username: 'alice',
      email: 'a@example.com',
      isReadingPasswordFromStandardInput: false,
    });
  });

  it('accepts a bare username, which is what npm passes when it swallows --username', () => {
    expect(parseCreateAdminArguments(['zach']).username).toBe('zach');
  });

  it('shows usage when the username is missing', () => {
    expect(() => parseCreateAdminArguments([])).toThrow(CliInputError);
    expect(() => parseCreateAdminArguments([])).toThrow(/Usage:/);
  });

  it('refuses a username given twice', () => {
    expect(() => parseCreateAdminArguments(['--username', 'alice', 'bob'])).toThrow(/once/);
  });

  it('shows usage for an unknown flag', () => {
    expect(() => parseCreateAdminArguments(['--user', 'alice'])).toThrow(/Usage:/);
  });
});
