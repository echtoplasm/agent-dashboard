/**
 * Helpers for adapter tests: replay a recorded CLI output fixture through a
 * parser.
 */
import { readFileSync } from 'node:fs';
import { RunEventDataSchema } from '@agent-dashboard/shared';
import type { RunEventData } from '@agent-dashboard/shared';
import type { AgentOutputParser, ParsedProviderEvent } from './agent-adapter.js';

const FIXTURES_DIRECTORY = new URL('./fixtures/', import.meta.url);

/**
 * Feeds every line of a fixture to a parser, then calls `finish`.
 *
 * Each event is also validated against the shared schema, so a parser that
 * produces an invalid payload fails the test.
 *
 * @param parser - A fresh parser.
 * @param fixtureName - File name under `fixtures/`.
 * @returns Every parsed event, in order.
 */
export function replayFixture(
  parser: AgentOutputParser,
  fixtureName: string,
): ParsedProviderEvent[] {
  const lines = readFileSync(new URL(fixtureName, FIXTURES_DIRECTORY), 'utf8')
    .split('\n')
    .filter((line) => line !== '');
  const parsedEvents = [
    ...lines.flatMap((line) => parser.parseStdoutLine(line)),
    ...parser.finish(),
  ];
  for (const parsedEvent of parsedEvents) {
    RunEventDataSchema.parse(parsedEvent.event);
  }
  return parsedEvents;
}

/**
 * Returns the normalized events without their raw payloads.
 *
 * @param parsedEvents - Parser output.
 * @returns Just the events.
 */
export function toEventData(parsedEvents: ParsedProviderEvent[]): RunEventData[] {
  return parsedEvents.map((parsedEvent) => parsedEvent.event);
}
