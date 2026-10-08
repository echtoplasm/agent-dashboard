/**
 * Tests for adapter lookup.
 */
import { PROVIDER_SLUGS } from '@agent-dashboard/shared';
import { describe, expect, it } from 'vitest';
import { findAgentAdapter } from './adapter-registry.js';

describe('findAgentAdapter', () => {
  it.each(PROVIDER_SLUGS)('has an adapter for %s', (providerSlug) => {
    expect(findAgentAdapter(providerSlug)?.providerSlug).toBe(providerSlug);
  });

  it('returns undefined for a provider this build cannot run', () => {
    expect(findAgentAdapter('test_provider')).toBeUndefined();
    expect(findAgentAdapter('toString')).toBeUndefined();
  });
});
