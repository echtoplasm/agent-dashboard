/**
 * The app shell for signed-in pages: navigation, the user menu, and the page.
 */
import type { ReactElement } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/AuthContext.js';
import { canReadAuditLog, isAdmin } from '../auth/permissions.js';

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link nav-link--active' : 'nav-link';
}

/**
 * Renders the header and the current page.
 *
 * @returns The layout.
 */
export function Layout(): ReactElement {
  const currentUser = useCurrentUser();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut(): Promise<void> {
    await signOut();
    await navigate('/login');
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="app-title">
          Agent Dashboard
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/agents" className={navLinkClassName}>
            Agents
          </NavLink>
          <NavLink to="/skills" className={navLinkClassName}>
            Skills
          </NavLink>
          <NavLink to="/sandbox-profiles" className={navLinkClassName}>
            Sandbox profiles
          </NavLink>
          {canReadAuditLog(currentUser) && (
            <NavLink to="/audit-log" className={navLinkClassName}>
              Audit log
            </NavLink>
          )}
          {isAdmin(currentUser) && (
            <NavLink to="/users" className={navLinkClassName}>
              Users
            </NavLink>
          )}
        </nav>
        <div className="user-menu">
          <NavLink to="/account" className={navLinkClassName}>
            {currentUser.username} <span className="muted">({currentUser.role})</span>
          </NavLink>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
