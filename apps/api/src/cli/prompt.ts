/**
 * Terminal prompts for command-line tools.
 */
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';

/**
 * readline's internal output hook. It isn't in Node's public types, but it is
 * the standard way to stop a prompt echoing what the user types.
 */
interface MutableReadline extends Interface {
  _writeToOutput: (text: string) => void;
}

/**
 * Asks a question without echoing the answer, for passwords.
 *
 * @param question - Prompt text, e.g. `Password: `.
 * @returns What the user typed.
 */
export function promptHidden(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  }) as MutableReadline;

  let isPromptWritten = false;
  readline._writeToOutput = (text) => {
    // Let the prompt itself through once, then hide every keystroke.
    if (!isPromptWritten) {
      isPromptWritten = true;
      process.stdout.write(text);
    }
  };

  return new Promise((resolve) => {
    readline.question(question, (answer) => {
      readline.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/**
 * Reads all of standard input, for piping a password in from a secret store.
 *
 * @returns The input with one trailing newline removed.
 */
export async function readAllStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}
