/**
 * Root component: authentication state and the route table.
 *
 * `/login` is public. Everything else sits behind `RequireAuth`, and
 * role-restricted pages also sit behind `RequirePermission`. The API checks
 * the same permissions on every request; the guards only keep users out of
 * pages they cannot use.
 */
import type { ReactElement } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthContext.js';
import { canReadAuditLog, isAdmin } from './auth/permissions.js';
import { RequireAuth, RequirePermission } from './auth/RequireAuth.js';
import { Layout } from './components/Layout.js';
import { AccountPage } from './pages/AccountPage.js';
import { AgentDetailPage } from './pages/agents/AgentDetailPage.js';
import { AgentsPage } from './pages/agents/AgentsPage.js';
import { AuditLogPage } from './pages/AuditLogPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { SandboxProfilesPage } from './pages/SandboxProfilesPage.js';
import { SkillDetailPage } from './pages/skills/SkillDetailPage.js';
import { SkillsPage } from './pages/skills/SkillsPage.js';
import { SkillVersionPage } from './pages/skills/SkillVersionPage.js';
import { UsersPage } from './pages/UsersPage.js';

/**
 * The route table, separate from the router so tests can use a `MemoryRouter`.
 *
 * @returns The routes.
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:agentId" element={<AgentDetailPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="skills/:skillId" element={<SkillDetailPage />} />
          <Route path="skills/:skillId/versions/:versionId" element={<SkillVersionPage />} />
          <Route path="sandbox-profiles" element={<SandboxProfilesPage />} />
          <Route element={<RequirePermission isAllowed={canReadAuditLog} />}>
            <Route path="audit-log" element={<AuditLogPage />} />
          </Route>
          <Route element={<RequirePermission isAllowed={isAdmin} />}>
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

/**
 * Application root.
 *
 * @returns The app.
 */
export function App(): ReactElement {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
