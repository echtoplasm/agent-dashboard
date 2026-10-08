/**
 * The error command-line tools throw for bad input.
 */

/** Thrown for bad command-line input; the message, with usage text, is shown as-is. */
export class CliInputError extends Error {
  /**
   * @param message - What was wrong.
   * @param usage - How to call the command correctly, appended to the message.
   */
  constructor(message: string, usage: string) {
    super(`${message}\n\n${usage}`);
    this.name = 'CliInputError';
  }
}
