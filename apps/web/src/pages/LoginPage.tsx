/**
 * The sign-in page. After signing in, returns to the page the user was
 * trying to open, or the overview.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import type { ReturnLocationState } from '../auth/RequireAuth.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { useAsyncAction } from '../hooks/useApiResource.js';

const DEFAULT_RETURN_PATH = '/';

/**
 * Renders the sign-in form.
 *
 * @returns The page.
 */
export function LoginPage(): ReactElement {
  const { currentUser, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const signInAction = useAsyncAction();

  const returnTo = (location.state as ReturnLocationState | null)?.returnTo ?? DEFAULT_RETURN_PATH;
  if (currentUser !== null) {
    return <Navigate to={returnTo} replace />;
  }

  async function handleSubmit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const isSignedIn = await signInAction.run(() => signIn({ username, password }));
    if (isSignedIn) {
      await navigate(returnTo, { replace: true });
    } else {
      setPassword('');
    }
  }

  return (
    <main className="login-page">
      <form className="panel login-form" onSubmit={(event) => void handleSubmit(event)}>
        <h1>Agent Dashboard</h1>
        <label className="field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            required
          />
        </label>
        <ErrorBanner error={signInAction.error} />
        <button type="submit" className="button" disabled={signInAction.isRunning}>
          {signInAction.isRunning ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
