/**
 * Small helpers shared by the provider adapters for reading untrusted JSON
 * output without `any`.
 *
 * CLI output is validated field by field: a value of the wrong type is
 * treated as missing rather than trusted, so a format change in a CLI
 * degrades to less detail instead of a crash.
 */
import {
  MAX_EVENT_TEXT_LENGTH,
  MAX_TOOL_OUTPUT_LENGTH,
  truncateText,
} from '@agent-dashboard/shared';
import type { ParsedProviderEvent } from './agent-adapter.js';

/** A parsed JSON object. */
export type JsonObject = Record<string, unknown>;

/**
 * Reports whether a value is a plain JSON object.
 *
 * @param value - Anything.
 * @returns `true` for non-null, non-array objects.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses one output line as a JSON object.
 *
 * @param line - A line of CLI output.
 * @returns The object, or undefined if the line is not a JSON object.
 */
export function parseJsonObjectLine(line: string): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isJsonObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a string field, or null if it is missing or not a string. */
export function readString(object: JsonObject, key: string): string | null {
  const value = object[key];
  return typeof value === 'string' ? value : null;
}

/** Reads a finite number field, or null. */
export function readNumber(object: JsonObject, key: string): number | null {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads a non-negative integer count, treating anything else as zero. */
export function readCount(object: JsonObject, key: string): number {
  const value = readNumber(object, key);
  return value !== null && value >= 0 ? Math.round(value) : 0;
}

/** Reads a nested object field, or undefined. */
export function readObject(object: JsonObject, key: string): JsonObject | undefined {
  const value = object[key];
  return isJsonObject(value) ? value : undefined;
}

/** Reads an array field, or an empty array. */
export function readArray(object: JsonObject, key: string): unknown[] {
  const value = object[key];
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** Reads an array of strings, skipping any entry that isn't a string. */
export function readStringArray(object: JsonObject, key: string): string[] {
  return readArray(object, key).filter((entry): entry is string => typeof entry === 'string');
}

/** Caps free text at the normalized event limit. */
export function limitText(text: string): string {
  return truncateText(text, MAX_EVENT_TEXT_LENGTH).text;
}

/**
 * Caps tool output and reports whether it was cut.
 *
 * @param output - Full tool output.
 * @returns The fields for a `tool.result` payload.
 */
export function limitToolOutput(output: string): { output: string; isOutputTruncated: boolean } {
  const { text, isTruncated } = truncateText(output, MAX_TOOL_OUTPUT_LENGTH);
  return { output: text, isOutputTruncated: isTruncated };
}

/**
 * Wraps a line that wasn't valid JSON as a notice, so nothing the CLI
 * prints is silently lost.
 *
 * @param line - The raw line.
 * @returns A `notice` event with no raw payload.
 */
export function createUnparseableLineEvent(line: string): ParsedProviderEvent {
  return {
    event: { type: 'notice', payload: { message: limitText(line), source: 'provider' } },
    rawPayload: null,
    occurredAt: null,
  };
}

/**
 * Wraps a provider event the adapter doesn't translate, keeping its raw JSON.
 *
 * @param providerEventType - The provider's own name for the event.
 * @param rawPayload - The original JSON.
 * @returns A `provider.other` event.
 */
export function createProviderOtherEvent(
  providerEventType: string,
  rawPayload: JsonObject,
): ParsedProviderEvent {
  return {
    event: { type: 'provider.other', payload: { providerEventType } },
    rawPayload,
    occurredAt: null,
  };
}

/**
 * Converts a Unix timestamp in seconds to an ISO string.
 *
 * @param epochSeconds - Seconds since 1970, or null.
 * @returns The ISO string, or null.
 */
export function toIsoFromEpochSeconds(epochSeconds: number | null): string | null {
  const MILLISECONDS_PER_SECOND = 1_000;
  return epochSeconds === null
    ? null
    : new Date(epochSeconds * MILLISECONDS_PER_SECOND).toISOString();
}
