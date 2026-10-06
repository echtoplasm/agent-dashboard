/**
 * Landing page after sign-in: API health and shortcuts into the registry.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { HealthPanel } from '../components/HealthPanel.js';

/**
 * Renders the overview.
 *
 * @returns The page.
 */
export function OverviewPage(): ReactElement {
  return (
    <>
      <h1>Overview</h1>
      <HealthPanel />
      <section className="panel">
        <h2>Registry</h2>
        <ul className="link-list">
          <li>
            <Link to="/agents">Agents</Link>: configured agents and their skill loadouts
          </li>
          <li>
            <Link to="/skills">Skills</Link>: reusable, versioned instructions for agents
          </li>
          <li>
            <Link to="/sandbox-profiles">Sandbox profiles</Link>: what runs are allowed to do
          </li>
        </ul>
      </section>
    </>
  );
}
