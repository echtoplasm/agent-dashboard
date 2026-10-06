/**
 * The signed-in user's own account: details and password change.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '@agent-dashboard/shared';
import { changePassword } from '../api/endpoints.js';
import { useCurrentUser } from '../auth/AuthContext.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { useAsyncAction } from '../hooks/useApiResource.js';

/**
 * Renders account details and the change-password form.
 *
 * @returns The page.
 */
export function AccountPage(): ReactElement {
  const currentUser = useCurrentUser();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [hasChangedPassword, setHasChangedPassword] = useState(false);
  const changePasswordAction = useAsyncAction();

  async function handleSubmit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    setHasChangedPassword(false);
    const isChanged = await changePasswordAction.run(() =>
      changePassword({ currentPassword, newPassword }),
    );
    setCurrentPassword('');
    setNewPassword('');
    setHasChangedPassword(isChanged);
  }

  return (
    <>
      <h1>Your account</h1>
      <section className="panel">
        <dl className="details">
          <dt>Username</dt>
          <dd>{currentUser.username}</dd>
          <dt>Role</dt>
          <dd>{currentUser.role}</dd>
          <dt>Email</dt>
          <dd>{currentUser.email ?? '—'}</dd>
        </dl>
      </section>

      <form className="panel form" onSubmit={(event) => void handleSubmit(event)}>
        <h2>Change password</h2>
        <p className="muted">Your other sessions will be signed out.</p>
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
            required
          />
        </label>
        <label className="field">
          <span>New password (at least {MIN_PASSWORD_LENGTH} characters)</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
            }}
            required
          />
        </label>
        <ErrorBanner error={changePasswordAction.error} />
        {hasChangedPassword && <p className="success-message">Password changed.</p>}
        <button type="submit" className="button" disabled={changePasswordAction.isRunning}>
          Change password
        </button>
      </form>
    </>
  );
}
