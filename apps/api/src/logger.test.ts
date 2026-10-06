/**
 * Tests that the logger masks secrets before they are written.
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';

/** Builds a real application logger that writes into an array. */
function createCapturingLogger(): { logger: Logger; writtenLines: string[] } {
  const writtenLines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      writtenLines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger('info', destination), writtenLines };
}

describe('createLogger redaction', () => {
  it('masks credential headers on logged requests', () => {
    const { logger, writtenLines } = createCapturingLogger();

    logger.info({ request: { headers: { authorization: 'Bearer abc123', cookie: 'sid=xyz' } } });

    expect(writtenLines.join('')).not.toMatch(/abc123|sid=xyz/);
    expect(writtenLines.join('')).toContain('[REDACTED]');
  });

  it('masks secret-named fields at the top level and one level deep', () => {
    const { logger, writtenLines } = createCapturingLogger();

    logger.info({ apiKey: 'sk-top', provider: { apiKey: 'sk-nested', name: 'codex' } });

    const output = writtenLines.join('');
    expect(output).not.toMatch(/sk-top|sk-nested/);
    expect(output).toContain('codex');
  });
});
