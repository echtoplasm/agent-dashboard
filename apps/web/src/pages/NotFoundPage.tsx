/**
 * Shown for unknown paths.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router';

/**
 * Renders the not-found message.
 *
 * @returns The page.
 */
export function NotFoundPage(): ReactElement {
  return (
    <section className="panel">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to the overview</Link>
      </p>
    </section>
  );
}
