/**
 * User administration for admins: create users, change roles, deactivate
 * and reactivate accounts, and reset passwords.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import { MIN_PASSWORD_LENGTH, USER_ROLES, UserRoleSchema } from '@agent-dashboard/shared';
import type { User, UserRole } from '@agent-dashboard/shared';
import { createUser, listUsers, resetUserPassword, updateUser } from '../api/endpoints.js';
import { useCurrentUser } from '../auth/AuthContext.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { ResourceView } from '../components/ResourceView.js';
import { StatusPill } from '../components/StatusPill.js';
import { useApiResource, useAsyncAction } from '../hooks/useApiResource.js';

/**
 * Renders the users page.
 *
 * @returns The page.
 */
export function UsersPage(): ReactElement {
  const users = useApiResource(listUsers, 'users');
  const rowAction = useAsyncAction();

  return (
    <>
      <h1>Users</h1>
      <CreateUserForm onCreated={users.reload} />
      <ErrorBanner error={rowAction.error} />
      <section className="panel table-wrapper">
        <ResourceView resource={users}>
          {(userList) => (
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {userList.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isRunning={rowAction.isRunning}
                    onAction={(action) => {
                      void rowAction.run(action).then(users.reload);
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </ResourceView>
      </section>
    </>
  );
}

function UserRow({
  user,
  isRunning,
  onAction,
}: {
  user: User;
  isRunning: boolean;
  onAction: (action: () => Promise<unknown>) => void;
}): ReactElement {
  const currentUser = useCurrentUser();
  const isSelf = user.id === currentUser.id;
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  function handleResetPassword(event: SyntheticEvent): void {
    event.preventDefault();
    onAction(() => resetUserPassword(user.id, newPassword));
    setNewPassword('');
    setIsResettingPassword(false);
  }

  return (
    <tr>
      <td>
        {user.username}
        {user.email !== null && <div className="muted">{user.email}</div>}
      </td>
      <td>
        <select
          aria-label={`Role for ${user.username}`}
          value={user.role}
          disabled={isRunning || isSelf}
          onChange={(event) => {
            const role = UserRoleSchema.parse(event.target.value);
            onAction(() => updateUser(user.id, { role }));
          }}
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </td>
      <td>
        {user.isActive ? (
          <StatusPill label="Active" tone="good" />
        ) : (
          <StatusPill label="Deactivated" tone="neutral" />
        )}
      </td>
      <td>{user.lastLoginAt === null ? '—' : new Date(user.lastLoginAt).toLocaleString()}</td>
      <td>
        <div className="form-actions">
          {!isSelf && (
            <button
              type="button"
              className="button button--quiet button--small"
              disabled={isRunning}
              onClick={() => {
                onAction(() => updateUser(user.id, { isActive: !user.isActive }));
              }}
            >
              {user.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
          {!isResettingPassword && (
            <button
              type="button"
              className="button button--quiet button--small"
              disabled={isRunning}
              onClick={() => {
                setIsResettingPassword(true);
              }}
            >
              Reset password
            </button>
          )}
        </div>
        {isResettingPassword && (
          <form className="form-actions" onSubmit={handleResetPassword}>
            <input
              type="password"
              aria-label={`New password for ${user.username}`}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
              }}
              required
            />
            <button type="submit" className="button button--small" disabled={isRunning}>
              Set password
            </button>
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => {
                setNewPassword('');
                setIsResettingPassword(false);
              }}
            >
              Cancel
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }): ReactElement {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [password, setPassword] = useState('');
  const createAction = useAsyncAction();

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    void createAction
      .run(() =>
        createUser({
          username: username.trim(),
          email: email.trim() === '' ? null : email.trim(),
          role,
          password,
        }),
      )
      .then((isCreated) => {
        if (isCreated) {
          setUsername('');
          setEmail('');
          setPassword('');
          onCreated();
        }
      });
  }

  return (
    <form className="panel form" onSubmit={handleSubmit}>
      <h2>Add a user</h2>
      <div className="form-row">
        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            autoComplete="off"
            required
          />
        </label>
        <label className="field">
          <span>Email (optional)</span>
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select
            value={role}
            onChange={(event) => {
              setRole(UserRoleSchema.parse(event.target.value));
            }}
          >
            {USER_ROLES.map((roleOption) => (
              <option key={roleOption} value={roleOption}>
                {roleOption}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Initial password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            required
          />
        </label>
      </div>
      <ErrorBanner error={createAction.error} />
      <div className="form-actions">
        <button type="submit" className="button" disabled={createAction.isRunning}>
          Add user
        </button>
      </div>
    </form>
  );
}
