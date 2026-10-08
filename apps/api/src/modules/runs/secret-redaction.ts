/**
 * Removes secrets from text before it is stored or streamed.
 *
 * Agent output can contain secrets: a CLI may echo its API key in an error
 * (the OpenAI API does exactly that for an invalid key), and an agent can
 * print environment variables or read credential files. Every stdout and
 * stderr line is passed through a redactor before it is parsed, so neither
 * the normalized event nor the raw payload ever holds the secret.
 *
 * Two layers:
 *
 * 1. The exact values injected into this run's sandbox, which catches them
 *    whatever their format.
 * 2. Patterns for common credential formats, which catches secrets the
 *    agent found on its own. These are best effort, not a guarantee.
 */

/** What a redacted secret is replaced with. */
export const REDACTION_MARKER = '[REDACTED]';

/** Exact secrets shorter than this are not redacted, to avoid mangling ordinary text. */
const MIN_EXACT_SECRET_LENGTH = 8;

/** Well-known credential formats. */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Anthropic and OpenAI API keys (including project and admin keys).
  /\bsk-(?:ant-|proj-|admin-|svcacct-)?[A-Za-z0-9_-]{20,}/g,
  // GitHub tokens.
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  // Slack tokens.
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  // Bearer tokens in headers.
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi,
  // PEM private keys.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** Replaces a pattern match, keeping a captured prefix such as `Bearer `. */
function replaceMatch(_match: string, prefix: unknown): string {
  return typeof prefix === 'string' && /^Bearer\s+$/i.test(prefix)
    ? `${prefix}${REDACTION_MARKER}`
    : REDACTION_MARKER;
}

/** A function that removes secrets from a string. */
export type SecretRedactor = (text: string) => string;

/**
 * Creates a redactor for one run.
 *
 * @param exactSecrets - Values injected into the run, such as its API key.
 * @returns A function that returns its input with secrets replaced by `[REDACTED]`.
 *
 * @example
 * ```ts
 * const redact = createSecretRedactor([apiKey]);
 * redact(`Incorrect API key provided: ${apiKey}`); // 'Incorrect API key provided: [REDACTED]'
 * ```
 */
export function createSecretRedactor(exactSecrets: readonly string[]): SecretRedactor {
  // Longest first, so a secret that contains another is replaced whole.
  const secretsToReplace = exactSecrets
    .filter((secret) => secret.length >= MIN_EXACT_SECRET_LENGTH)
    .sort((left, right) => right.length - left.length);

  return (text) => {
    let redactedText = text;
    for (const secret of secretsToReplace) {
      redactedText = redactedText.replaceAll(secret, REDACTION_MARKER);
    }
    for (const pattern of SECRET_PATTERNS) {
      redactedText = redactedText.replace(pattern, replaceMatch);
    }
    return redactedText;
  };
}
