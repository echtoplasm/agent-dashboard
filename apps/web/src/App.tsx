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
import { RequireAuth } from './auth/RequireAuth.js';
import { Layout } from './components/Layout.js';
import { AccountPage } from './pages/AccountPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { OverviewPage } from './pages/OverviewPage.js';

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
