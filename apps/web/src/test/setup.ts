/**
 * Vitest setup for the web app: unmounts rendered components and restores
 * stubbed globals (such as `fetch`) after every test.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
