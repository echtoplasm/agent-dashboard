/**
 * Renders the loading, error or loaded state of an `ApiResource`.
 */
import type { ReactElement, ReactNode } from 'react';
import type { ApiResource } from '../hooks/useApiResource.js';
import { ErrorBanner } from './ErrorBanner.js';

/**
 * Shows a loading message, an error, or the children built from the data.
 *
 * @param props.resource - The resource from `useApiResource`.
 * @param props.children - Renders the loaded data.
 * @returns The appropriate view.
 */
export function ResourceView<Data>({
  resource,
  children,
}: {
  resource: ApiResource<Data>;
  children: (data: Data) => ReactNode;
}): ReactElement {
  if (resource.error !== undefined) {
    return <ErrorBanner error={resource.error} />;
  }
  if (resource.data === undefined) {
    return <p className="page-status">Loading…</p>;
  }
  return <>{children(resource.data)}</>;
}
