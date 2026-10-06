/**
 * Loads data from the API for a component and tracks loading and errors.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/api-client.js';

/** The state of a loaded resource. */
export interface ApiResource<Data> {
  data: Data | undefined;
  error: ApiError | undefined;
  isLoading: boolean;
  /** Loads again, e.g. after a change. */
  reload: () => void;
}

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(0, 'invalid_response', 'Something went wrong');
}

/**
 * Calls `load` when the component mounts and whenever `resourceKey` changes.
 *
 * Responses that arrive after the key has changed (or the component has
 * unmounted) are ignored, so a slow earlier request can't overwrite newer data.
 *
 * @param load - Fetches the data, e.g. `() => getAgent(agentId)`.
 * @param resourceKey - Identifies what is loaded; a new key triggers a new load.
 * @returns The data, error, loading flag and a reload function.
 *
 * @example
 * ```tsx
 * const agent = useApiResource(() => getAgent(agentId), agentId);
 * ```
 */
export function useApiResource<Data>(
  load: () => Promise<Data>,
  resourceKey: string,
): ApiResource<Data> {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<ApiError>();
  const [isLoading, setIsLoading] = useState(true);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    load()
      .then((loadedData) => {
        if (isCurrent) {
          setData(loadedData);
          setError(undefined);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(toApiError(loadError));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });
    return () => {
      isCurrent = false;
    };
    // `load` is deliberately not a dependency: it is a new function on every
    // render, and `resourceKey` already says when the data must be reloaded.
  }, [resourceKey, reloadCount]);

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  return { data, error, isLoading, reload };
}

/** The state of a form submission or button action. */
export interface AsyncAction {
  isRunning: boolean;
  error: ApiError | undefined;
  /** Runs `action`, recording any error. Returns true if it succeeded. */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  clearError: () => void;
}

/**
 * Tracks one user-triggered action, such as submitting a form.
 *
 * @returns Running flag, last error and a `run` function.
 */
export function useAsyncAction(): AsyncAction {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<ApiError>();

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setIsRunning(true);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (actionError) {
      setError(toApiError(actionError));
      return false;
    } finally {
      setIsRunning(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(undefined);
  }, []);

  return { isRunning, error, run, clearError };
}
