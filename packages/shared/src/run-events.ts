/**
 * Normalized run events.
 *
 * Every provider adapter turns its CLI's output into these events, so the
 * rest of the app (storage, SSE, the run view) never deals with a
 * provider-specific format. The provider's original JSON is stored next to
 * each event as `rawPayload` for debugging, after secrets are removed.
 *
 * Adding an event type means adding a payload schema here and a member to
 * `RunEventDataSchema`. The type names match the database's
 * `run_events_event_type_format_check`.
 */
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common.js';
import { CostSourceSchema, RunStatusSchema } from './runs.js';

/** Longest tool output kept in a normalized event, in characters. */
export const MAX_TOOL_OUTPUT_LENGTH = 16_000;

/** Longest text kept in any other normalized string field, in characters. */
export const MAX_EVENT_TEXT_LENGTH = 100_000;

/** The run moved to a new lifecycle state. Emitted by the API, not the provider. */
export const RunStatusEventPayloadSchema = z.object({
  status: RunStatusSchema,
  message: z.string().nullable(),
});

/** The CLI started its session. */
export const SessionStartedEventPayloadSchema = z.object({
  providerSessionId: z.string().nullable(),
  model: z.string().nullable(),
  /** Tools the CLI made available, where it reports them. */
  tools: z.array(z.string()),
  /** Skills the CLI discovered, where it reports them. */
  skills: z.array(z.string()),
});

/** Text or reasoning the model produced. */
export const AssistantTextEventPayloadSchema = z.object({
  text: z.string(),
  /** Set when the text came from a subagent started by this tool call. */
  parentToolCallId: z.string().nullable(),
});

/** The agent invoked a tool (a shell command, a file edit, a search...). */
export const ToolCallEventPayloadSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  parentToolCallId: z.string().nullable(),
});

/** A tool call finished. */
export const ToolResultEventPayloadSchema = z.object({
  toolCallId: z.string(),
  isError: z.boolean(),
  /** Output, cut to `MAX_TOOL_OUTPUT_LENGTH` characters. */
  output: z.string(),
  isOutputTruncated: z.boolean(),
  exitCode: z.number().int().nullable(),
});

/**
 * Token usage the provider reported. Each event adds to the run's totals;
 * cost is included only when the provider reports it.
 */
export const UsageEventPayloadSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  costMicroUsd: z.number().int().nonnegative().nullable(),
  costSource: CostSourceSchema.nullable(),
});

/** The provider reported rate-limit pressure. */
export const RateLimitEventPayloadSchema = z.object({
  status: z.string(),
  limitType: z.string().nullable(),
  /** Fraction of the limit used, from 0 to 1, if reported. */
  utilization: z.number().nullable(),
  resetsAt: IsoDateTimeSchema.nullable(),
});

/** Something went wrong. Fatal errors end the run. */
export const ErrorEventPayloadSchema = z.object({
  message: z.string(),
  isFatal: z.boolean(),
});

/** Informational output, such as an API retry or a line the CLI wrote to stderr. */
export const NoticeEventPayloadSchema = z.object({
  message: z.string(),
  source: z.enum(['provider', 'stderr', 'sandbox']),
});

/** The CLI's final verdict on the run. */
export const RunResultEventPayloadSchema = z.object({
  isError: z.boolean(),
  /** The final answer or error text, if the provider gives one. */
  summary: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  turnCount: z.number().int().nullable(),
});

/** A provider event the adapter does not translate. Its raw JSON is kept. */
export const ProviderOtherEventPayloadSchema = z.object({
  providerEventType: z.string(),
});

/**
 * A normalized event without storage fields: the `type` and its payload.
 * Adapters produce these.
 */
export const RunEventDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.status'), payload: RunStatusEventPayloadSchema }),
  z.object({ type: z.literal('session.started'), payload: SessionStartedEventPayloadSchema }),
  z.object({ type: z.literal('assistant.text'), payload: AssistantTextEventPayloadSchema }),
  z.object({ type: z.literal('assistant.thinking'), payload: AssistantTextEventPayloadSchema }),
  z.object({ type: z.literal('tool.call'), payload: ToolCallEventPayloadSchema }),
  z.object({ type: z.literal('tool.result'), payload: ToolResultEventPayloadSchema }),
  z.object({ type: z.literal('usage'), payload: UsageEventPayloadSchema }),
  z.object({ type: z.literal('rate_limit'), payload: RateLimitEventPayloadSchema }),
  z.object({ type: z.literal('error'), payload: ErrorEventPayloadSchema }),
  z.object({ type: z.literal('notice'), payload: NoticeEventPayloadSchema }),
  z.object({ type: z.literal('run.result'), payload: RunResultEventPayloadSchema }),
  z.object({ type: z.literal('provider.other'), payload: ProviderOtherEventPayloadSchema }),
]);

/** A normalized event's type and payload. */
export type RunEventData = z.infer<typeof RunEventDataSchema>;

/** Every normalized event type. */
export type RunEventType = RunEventData['type'];

/** Narrows `RunEventData` to one event type. */
export type RunEventDataOfType<EventType extends RunEventType> = Extract<
  RunEventData,
  { type: EventType }
>;

/** Storage fields every stored event carries. */
const StoredRunEventFieldsSchema = z.object({
  runId: UuidSchema,
  /** Position in the run's stream, starting at 0. Used as the SSE event id. */
  sequenceNumber: z.number().int().nonnegative(),
  /** When the provider says the event happened, if it says so. */
  occurredAt: IsoDateTimeSchema.nullable(),
  receivedAt: IsoDateTimeSchema,
});

/** A stored run event as returned by the API and streamed over SSE. */
export const RunEventSchema = z.intersection(StoredRunEventFieldsSchema, RunEventDataSchema);

/** A stored run event. */
export type RunEvent = z.infer<typeof RunEventSchema>;

/** Default and maximum page size for run events. */
export const RUN_EVENT_PAGE_SIZE = { DEFAULT: 500, MAX: 2_000 } as const;

/** Query parameters of `GET /api/runs/:id/events`. Pages go forwards in time. */
export const RunEventListQuerySchema = z.object({
  /** Return events with a higher sequence number than this. */
  after: z.coerce.number().int().min(-1).default(-1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RUN_EVENT_PAGE_SIZE.MAX)
    .default(RUN_EVENT_PAGE_SIZE.DEFAULT),
});

/** Query parameters of `GET /api/runs/:id/events`. */
export type RunEventListQuery = z.output<typeof RunEventListQuerySchema>;

/** One page of run events, oldest first. */
export const RunEventPageSchema = z.object({
  items: z.array(RunEventSchema),
  /** Pass as `after` to fetch the next page; null when there are no more events yet. */
  nextCursor: z.number().int().nullable(),
});

/** One page of run events. */
export type RunEventPage = z.infer<typeof RunEventPageSchema>;

/** SSE event names sent by `GET /api/runs/:id/stream`. */
export const RUN_STREAM_EVENT_NAMES = {
  /** A `RunEvent`, with the sequence number as the SSE id. */
  RUN_EVENT: 'run-event',
  /** The run has reached a terminal status; the server closes the stream. */
  END: 'end',
} as const;

/**
 * Shortens text to a maximum length.
 *
 * @param text - Any string.
 * @param maxLength - Characters to keep.
 * @returns The text, possibly shortened, and whether it was.
 */
export function truncateText(
  text: string,
  maxLength: number,
): { text: string; isTruncated: boolean } {
  return text.length > maxLength
    ? { text: text.slice(0, maxLength), isTruncated: true }
    : { text, isTruncated: false };
}
