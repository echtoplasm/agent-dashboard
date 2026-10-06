/**
 * Root component. In Phase 1 it only shows API health.
 */
import type { ReactElement } from 'react';
import { HealthPanel } from './HealthPanel.js';

/**
 * Application shell.
 *
 * @returns The rendered app.
 */
export function App(): ReactElement {
  return (
    <main className="app">
      <h1>Agent Dashboard</h1>
      <HealthPanel />
    </main>
  );
}
