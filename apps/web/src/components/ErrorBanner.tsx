/**
 * Shows an API error, including any per-field problems.
 */
import type { ReactElement } from 'react';
import type { ApiError } from '../api/api-client.js';

/**
 * Renders an error message with its field problems as a list.
 *
 * @param props.error - The error to show; nothing renders when undefined.
 * @returns The banner, or null.
 */
export function ErrorBanner({ error }: { error: ApiError | undefined }): ReactElement | null {
  if (error === undefined) {
    return null;
  }
  return (
    <div className="error-banner" role="alert">
      <p>{error.message}</p>
      {error.fieldProblems.length > 0 && (
        <ul>
          {error.fieldProblems.map((problem) => (
            <li key={`${problem.path}:${problem.message}`}>
              {problem.path !== '' && <code>{problem.path}</code>} {problem.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
