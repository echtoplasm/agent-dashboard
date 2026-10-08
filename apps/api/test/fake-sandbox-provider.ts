/**
 * A scripted stand-in for the Docker sandbox, so run tests exercise the
 * whole launch → execute → store → stream path without Docker.
 */
import { SandboxStartError } from '../src/sandbox/sandbox-provider.js';
import type {
  RunningSandbox,
  SandboxExit,
  SandboxProvider,
  SandboxSpec,
} from '../src/sandbox/sandbox-provider.js';

/** What the next sandbox will do. */
export interface FakeSandboxScript {
  stdoutLines: string[];
  stderrLines?: string[];
  exitCode: number;
  /** Keep running after printing until `stop()` is called. */
  shouldWaitForStop?: boolean;
  /** Fail to start instead of running. */
  shouldFailToStart?: boolean;
}

/** Exit code reported for a stopped sandbox, as for SIGTERM. */
const STOPPED_EXIT_CODE = 143;

/** A sandbox provider that plays back scripts. */
export interface FakeSandboxProvider extends SandboxProvider {
  /** Specs of every sandbox started, in order. */
  startedSpecs: SandboxSpec[];
  /** Queues the script for the next started sandbox. */
  enqueueScript(script: FakeSandboxScript): void;
}

/** The script used when none is queued: a successful Claude Code run. */
export const DEFAULT_FAKE_SCRIPT: FakeSandboxScript = {
  stdoutLines: [
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'session-1',
      model: 'claude-opus-5-5',
      tools: ['Bash'],
      skills: [],
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'All done' }] },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'All done',
      total_cost_usd: 0.0125,
      duration_ms: 1200,
      num_turns: 1,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 50,
      },
    }),
  ],
  exitCode: 0,
};

async function* yieldLines(
  lines: readonly string[],
  untilStopped?: Promise<void>,
): AsyncGenerator<string> {
  for (const line of lines) {
    await Promise.resolve();
    yield line;
  }
  if (untilStopped !== undefined) {
    await untilStopped;
  }
}

/**
 * Creates a fake sandbox provider.
 *
 * @returns The provider.
 */
export function createFakeSandboxProvider(): FakeSandboxProvider {
  const scripts: FakeSandboxScript[] = [];
  const startedSpecs: SandboxSpec[] = [];

  return {
    startedSpecs,
    enqueueScript(script) {
      scripts.push(script);
    },
    startSandbox(spec): Promise<RunningSandbox> {
      const script = scripts.shift() ?? DEFAULT_FAKE_SCRIPT;
      if (script.shouldFailToStart === true) {
        return Promise.reject(new SandboxStartError('docker is not installed'));
      }
      startedSpecs.push(spec);
      let markStopped: () => void = () => undefined;
      const stopped = new Promise<void>((resolve) => {
        markStopped = resolve;
      });
      const untilStopped = script.shouldWaitForStop === true ? stopped : undefined;
      const stdoutLines = yieldLines(script.stdoutLines, untilStopped);
      const exited = (async (): Promise<SandboxExit> => {
        if (untilStopped !== undefined) {
          await untilStopped;
          return { exitCode: STOPPED_EXIT_CODE };
        }
        return { exitCode: script.exitCode };
      })();
      return Promise.resolve({
        sandboxId: `fake-${spec.runId}`,
        stdoutLines,
        stderrLines: yieldLines(script.stderrLines ?? []),
        exited,
        stop: () => {
          markStopped();
          return Promise.resolve();
        },
      });
    },
    removeOrphanedSandboxes: () => Promise.resolve([]),
  };
}
