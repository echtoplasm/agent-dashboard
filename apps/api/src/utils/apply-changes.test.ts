/**
 * Tests for merging partial updates.
 */
import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply-changes.js';

describe('applyChanges', () => {
  const current = { name: 'agent', model: 'model-a' as string | null, budget: 5 };

  it('replaces provided fields', () => {
    expect(applyChanges(current, { budget: 10 })).toEqual({ ...current, budget: 10 });
  });

  it('keeps fields that are undefined in the changes', () => {
    expect(applyChanges(current, { name: undefined })).toEqual(current);
  });

  it('applies explicit nulls', () => {
    expect(applyChanges(current, { model: null }).model).toBeNull();
  });

  it('does not mutate the original', () => {
    applyChanges(current, { budget: 99 });

    expect(current.budget).toBe(5);
  });
});
