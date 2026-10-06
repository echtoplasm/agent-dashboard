/**
 * Small schemas reused across the API contracts.
 */
import { z } from 'zod';

/** A row id. Every registry table uses UUIDs. */
export const UuidSchema = z.uuid();

/** A timestamp serialized as an ISO 8601 string with timezone offset. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * A money amount in micro-USD (millionths of a dollar), stored as an integer
 * to avoid floating-point rounding. See D-008 in docs/decisions.md.
 */
export const MicroUsdSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Number of micro-USD in one US dollar. */
export const MICRO_USD_PER_USD = 1_000_000;

/** A non-blank, trimmed, single-line display name. */
export const DisplayNameSchema = z.string().trim().min(1).max(100);

/** Free-form description text. */
export const DescriptionSchema = z.string().trim().max(2_000);

/** Route params for endpoints addressed by id, e.g. `/agents/:id`. */
export const IdParamsSchema = z.object({ id: UuidSchema });

/**
 * Wraps an item schema in the standard list response `{ items: [...] }`.
 *
 * @param itemSchema - Schema for one list item.
 * @returns Schema for the list response.
 */
export function createListResponseSchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
): z.ZodObject<{ items: z.ZodArray<ItemSchema> }> {
  return z.object({ items: z.array(itemSchema) });
}

/** Query parameter that includes archived rows in list endpoints. */
export const IncludeArchivedQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
