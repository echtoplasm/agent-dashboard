/**
 * Turns a run's event stream into the items the run log shows.
 *
 * Tool calls are paired with their results by id, consecutive stderr lines
 * are grouped into one block, and provider events the adapter didn't
 * translate are hidden unless asked for. Kept free of React so the
 * grouping rules can be unit tested.
 */
import type { RunEvent, RunEventDataOfType } from '@agent-dashboard/shared';

/** Longest one-line summary of a tool's input. */
const MAX_TOOL_SUMMARY_LENGTH = 120;

/** A tool call and, once it arrives, its result. */
export interface ToolLogItem {
  kind: 'tool';
  key: string;
  call: RunEventDataOfType<'tool.call'>['payload'];
  result: RunEventDataOfType<'tool.result'>['payload'] | null;
}

/** Consecutive stderr lines shown as one block. */
export interface StderrLogItem {
  kind: 'stderr';
  key: string;
  lines: string[];
}

/** Any other event, shown on its own. */
export interface EventLogItem {
  kind: 'event';
  key: string;
  event: RunEvent;
}

/** One entry in the run log. */
export type RunLogItem = ToolLogItem | StderrLogItem | EventLogItem;

/** Options for building the log. */
export interface RunLogOptions {
  /** Include `provider.other` events. */
  isShowingProviderEvents: boolean;
}

function isStderrNotice(event: RunEvent): event is RunEvent & RunEventDataOfType<'notice'> {
  return event.type === 'notice' && event.payload.source === 'stderr';
}

/**
 * Builds the run log from events in sequence order.
 *
 * @param events - The run's events.
 * @param options - What to include.
 * @returns Log items in display order.
 */
export function buildRunLogItems(
  events: readonly RunEvent[],
  options: RunLogOptions,
): RunLogItem[] {
  const items: RunLogItem[] = [];
  const toolItemsById = new Map<string, ToolLogItem>();

  for (const event of events) {
    const key = String(event.sequenceNumber);
    const previousItem = items.at(-1);
    if (event.type === 'tool.call') {
      const toolItem: ToolLogItem = { kind: 'tool', key, call: event.payload, result: null };
      toolItemsById.set(event.payload.toolCallId, toolItem);
      items.push(toolItem);
    } else if (event.type === 'tool.result') {
      const toolItem = toolItemsById.get(event.payload.toolCallId);
      if (toolItem === undefined) {
        items.push({ kind: 'event', key, event });
      } else {
        toolItem.result = event.payload;
      }
    } else if (isStderrNotice(event)) {
      if (previousItem?.kind === 'stderr') {
        previousItem.lines.push(event.payload.message);
      } else {
        items.push({ kind: 'stderr', key, lines: [event.payload.message] });
      }
    } else if (event.type !== 'provider.other' || options.isShowingProviderEvents) {
      items.push({ kind: 'event', key, event });
    }
  }
  return items;
}

function readStringField(input: unknown, fieldName: string): string | undefined {
  if (typeof input !== 'object' || input === null || !(fieldName in input)) {
    return undefined;
  }
  const value: unknown = (input as Record<string, unknown>)[fieldName];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Summarizes a tool's input on one line: the command, file path or query
 * when there is one, otherwise compact JSON.
 *
 * @param input - The tool call's input.
 * @returns A short summary.
 */
export function summarizeToolInput(input: unknown): string {
  const summary =
    readStringField(input, 'command') ??
    readStringField(input, 'file_path') ??
    readStringField(input, 'path') ??
    readStringField(input, 'pattern') ??
    readStringField(input, 'query') ??
    JSON.stringify(input);
  return summary.length > MAX_TOOL_SUMMARY_LENGTH
    ? `${summary.slice(0, MAX_TOOL_SUMMARY_LENGTH)}…`
    : summary;
}
