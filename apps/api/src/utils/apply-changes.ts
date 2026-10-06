/**
 * Merges a partial update into a full object.
 */

/**
 * Returns `current` with every field that `changes` actually provides
 * replaced. Fields that are absent or `undefined` in `changes` keep their
 * current value; explicit `null` is applied, so it can clear a value.
 *
 * A plain spread (`{ ...current, ...changes }`) would copy `undefined` over
 * existing values when a partial request schema yields `field: undefined`.
 *
 * @param current - The full current object.
 * @param changes - A partial update, e.g. a parsed PATCH body.
 * @returns A new object with the changes applied.
 *
 * @example
 * ```ts
 * applyChanges({ name: 'a', model: 'x' }, { model: undefined }); // { name: 'a', model: 'x' }
 * applyChanges({ name: 'a', model: 'x' }, { model: null });      // { name: 'a', model: null }
 * ```
 */
export function applyChanges<Fields extends object>(
  current: Fields,
  changes: { [Key in keyof Fields]?: Fields[Key] | undefined },
): Fields {
  const result = { ...current };
  for (const key of Object.keys(changes) as (keyof Fields)[]) {
    const value = changes[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
