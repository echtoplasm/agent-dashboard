/**
 * An admin-only button that permanently deletes something after
 * confirmation, then leaves its page.
 *
 * Deletion is for mistakes, such as an agent that never ran or a skill that
 * never published a version; anything with history is archived instead
 * (the API enforces this and explains a refusal).
 */
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { useAsyncAction } from '../hooks/useApiResource.js';
import { ErrorBanner } from './ErrorBanner.js';

/**
 * Renders the delete button and any error from the attempt.
 *
 * @param props.resourceName - Shown in the confirmation, e.g. `docs-writer`.
 * @param props.onDelete - Calls the API.
 * @param props.redirectTo - Where to go once deleted.
 * @returns The button.
 */
export function DeleteResourceButton({
  resourceName,
  onDelete,
  redirectTo,
}: {
  resourceName: string;
  onDelete: () => Promise<void>;
  redirectTo: string;
}): ReactElement {
  const deleteAction = useAsyncAction();
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        className="button button--danger"
        disabled={deleteAction.isRunning}
        onClick={() => {
          if (window.confirm(`Permanently delete ${resourceName}? This cannot be undone.`)) {
            void deleteAction.run(onDelete).then(async (isDeleted) => {
              if (isDeleted) {
                await navigate(redirectTo);
              }
            });
          }
        }}
      >
        Delete
      </button>
      <ErrorBanner error={deleteAction.error} />
    </>
  );
}
