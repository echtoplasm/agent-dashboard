/**
 * Route guards: send signed-out users to the sign-in page, and show a
 * notice instead of pages a role cannot use.
 */
import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { User } from '@agent-dashboard/shared';
import { useAuth, useCurrentUser } from './AuthContext.js';

/** Where the sign-in page should return to, passed in navigation state. */
export interface ReturnLocationState {
  returnTo?: string;
}

/**
 * Renders child routes only for signed-in users.
 *
 * @returns The child routes, a loading message, or a redirect to `/login`.
 */
export function RequireAuth(): ReactElement {
  const { currentUser, isCheckingSession } = useAuth();
  const location = useLocation();

  if (isCheckingSession) {
    return <p className="page-status">Checking your session…</p>;
  }
  if (currentUser === null) {
    const returnState: ReturnLocationState = { returnTo: location.pathname };
    return <Navigate to="/login" replace state={returnState} />;
  }
  return <Outlet />;
}

/**
 * Renders child routes only when `isAllowed` accepts the signed-in user.
 *
 * @param props.isAllowed - A permission check from `permissions.ts`.
 * @returns The child routes or a "not permitted" notice.
 */
export function RequirePermission({
  isAllowed,
}: {
  isAllowed: (user: User) => boolean;
}): ReactElement {
  const currentUser = useCurrentUser();
  if (!isAllowed(currentUser)) {
    return (
      <section className="panel">
        <h1>Not permitted</h1>
        <p>Your role ({currentUser.role}) cannot open this page.</p>
      </section>
    );
  }
  return <Outlet />;
}
