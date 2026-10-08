/**
 * Tests for secret redaction.
 */
import { describe, expect, it } from 'vitest';
import { REDACTION_MARKER, createSecretRedactor } from './secret-redaction.js';

describe('createSecretRedactor', () => {
  it('removes the exact injected secret wherever it appears', () => {
    const redact = createSecretRedactor(['my-custom-secret-value']);

    expect(redact('{"message":"Incorrect API key provided: my-custom-secret-value."}')).toBe(
      `{"message":"Incorrect API key provided: ${REDACTION_MARKER}."}`,
    );
  });

  it('ignores very short exact secrets to avoid mangling output', () => {
    expect(createSecretRedactor(['abc'])('abc def')).toBe('abc def');
  });

  // Credential-shaped samples are assembled at runtime so secret scanners
  // (gitleaks runs over the whole history in CI) don't flag the test file.
  it.each([
    ['an Anthropic key', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'],
    ['an OpenAI project key', 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'],
    ['a GitHub token', `ghp_${'a'.repeat(36)}`],
    ['a GitHub fine-grained token', `github_pat_${'b'.repeat(50)}`],
    ['an AWS access key id', `AKIA${'Q'.repeat(16)}`],
  ])('removes %s found in output', (_label, secret) => {
    const redact = createSecretRedactor([]);

    expect(redact(`export TOKEN=${secret}`)).toBe(`export TOKEN=${REDACTION_MARKER}`);
  });

  it('keeps the Bearer prefix but removes the token', () => {
    const redact = createSecretRedactor([]);

    expect(redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz.0123')).toBe(
      `Authorization: Bearer ${REDACTION_MARKER}`,
    );
  });

  it('removes PEM private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----';

    expect(createSecretRedactor([])(`key:\n${pem}\nafter`)).toBe(
      `key:\n${REDACTION_MARKER}\nafter`,
    );
  });

  it('leaves ordinary text alone', () => {
    const text = 'Ran npm test: 42 passed, sk-short is not a key';

    expect(createSecretRedactor(['unrelated-secret-123'])(text)).toBe(text);
  });
});
