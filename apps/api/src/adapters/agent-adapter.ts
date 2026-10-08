/**
 * The provider-agnostic interface every agent CLI adapter implements.
 *
 * An adapter knows three things about its CLI: how to invoke it headlessly
 * inside the sandbox image, which credential it needs, and how to turn its
 * output into normalized `RunEventData`. Everything else (sandboxing,
 * storage, streaming, cost totals) is shared, so adding a provider means
 * writing one adapter and registering it in `adapter-registry.ts`.
 */
import type { ProviderSlug, RunEventData } from '@agent-dashboard/shared';

/** What an adapter needs to build a run's command line. */
export interface AgentInvocationInput {
  /** Model to request, or null for the CLI's default. */
  model: string | null;
  /** The provider's API key, injected only into the sandbox's environment. */
  apiKey: string;
}

/**
 * How to start the CLI for one run.
 *
 * The prompt is always written to the CLI's stdin rather than passed as an
 * argument, so it never appears in a process list and is not limited by the
 * maximum argument length.
 */
export interface AgentInvocation {
  /** The command and its arguments, run inside the sandbox. */
  command: string[];
  /** Non-secret environment variables for the CLI. */
  environment: Record<string, string>;
  /**
   * Secret environment variables (API keys). The sandbox passes these by
   * name only, so their values never appear on a command line, and the run
   * manager redacts them from every event.
   */
  secretEnvironment: Record<string, string>;
}

/** One event produced from the CLI's output. */
export interface ParsedProviderEvent {
  event: RunEventData;
  /** The provider's original JSON for this event, or null for synthesized events. */
  rawPayload: unknown;
  /** When the provider says it happened, as an ISO string, if it says. */
  occurredAt: string | null;
}

/**
 * Turns a CLI's output into normalized events. One parser per run, because
 * some providers need state across lines (for example, pairing a tool's
 * start and finish).
 */
export interface AgentOutputParser {
  /**
   * Parses one line of the CLI's stdout.
   *
   * @param line - A full line, without its trailing newline.
   * @returns Zero or more events. Lines that are not JSON become notices.
   */
  parseStdoutLine(line: string): ParsedProviderEvent[];
  /**
   * Called once after the CLI exits, so the parser can emit anything it was
   * holding, such as a final result for providers that don't send one.
   */
  finish(): ParsedProviderEvent[];
}

/** One agent CLI. */
export interface AgentAdapter {
  providerSlug: ProviderSlug;
  /** Name of the environment variable the API reads this provider's key from. */
  apiKeyEnvironmentVariable: string;
  /** Absolute directory inside the sandbox where the CLI discovers skills. */
  skillsDirectory: string;
  /** Builds the command line and environment for one run. */
  buildInvocation(input: AgentInvocationInput): AgentInvocation;
  /** Creates a parser for one run's output. */
  createOutputParser(): AgentOutputParser;
}
