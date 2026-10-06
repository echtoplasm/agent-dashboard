/**
 * Holds the signed-in user for the whole app.
 *
 * On load it asks the API who is signed in (the session cookie is HttpOnly,
 * so the browser can't tell on its own). Any request that comes back 401
 * clears the user, which sends route guards back to the sign-in page.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { LoginRequest, User } from '@agent-dashboard/shared';
import { setUnauthenticatedListener } from '../api/api-client.js';
import { fetchCurrentUser, login, logout } from '../api/endpoints.js';

/** What components can read and do through `useAuth`. */
export interface AuthState {
  /** Null when signed out. */
  currentUser: User | null;
  /** True until the first "who am I" check finishes. */
  isCheckingSession: boolean;
  /** @throws {ApiError} On bad credentials or rate limiting. */
  signIn: (credentials: LoginRequest) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Provides authentication state to its children.
 *
 * @param props.children - The app.
 * @returns The provider element.
 */
export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    setUnauthenticatedListener(() => {
      setCurrentUser(null);
    });
    fetchCurrentUser()
      .then(setCurrentUser)
      // Any failure (signed out, API down) leaves the user signed out; the
      // sign-in page then reports problems when they try again.
      .catch(() => undefined)
      .finally(() => {
        setIsCheckingSession(false);
      });
    return () => {
      setUnauthenticatedListener(undefined);
    };
  }, []);

  const signIn = useCallback(async (credentials: LoginRequest) => {
    setCurrentUser(await login(credentials));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setCurrentUser(null);
    }
  }, []);

  const authState = useMemo(
    () => ({ currentUser, isCheckingSession, signIn, signOut }),
    [currentUser, isCheckingSession, signIn, signOut],
  );
  return <AuthContext value={authState}>{children}</AuthContext>;
}

/**
 * Returns the authentication state.
 *
 * @returns The current user and sign-in/out functions.
 * @throws {Error} If used outside `AuthProvider`.
 */
export function useAuth(): AuthState {
  const authState = useContext(AuthContext);
  if (authState === undefined) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return authState;
}

/**
 * Returns the signed-in user. Only for components rendered behind `RequireAuth`.
 *
 * @returns The user.
 * @throws {Error} If nobody is signed in.
 */
export function useCurrentUser(): User {
  const { currentUser } = useAuth();
  if (currentUser === null) {
    throw new Error('useCurrentUser must be used behind RequireAuth');
  }
  return currentUser;
}
