/**
 * Read-only view of sandbox profiles and providers. Admins can enable or
 * disable providers here; profile editing is available through the API and
 * gets a form in a later phase.
 */
import type { ReactElement } from 'react';
import { setProviderEnabled } from '../api/endpoints.js';
import { useCurrentUser } from '../auth/AuthContext.js';
import { isAdmin } from '../auth/permissions.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { ResourceView } from '../components/ResourceView.js';
import { ArchivedPill, StatusPill } from '../components/StatusPill.js';
import { useAsyncAction } from '../hooks/useApiResource.js';
import { useRegistryLookups } from '../hooks/useRegistryLookups.js';

const MILLICORES_PER_CORE = 1000;
const SECONDS_PER_MINUTE = 60;

function formatList(values: string[]): string {
  return values.length === 0 ? 'None' : values.join(', ');
}

/**
 * Renders the sandbox profiles and providers page.
 *
 * @returns The page.
 */
export function SandboxProfilesPage(): ReactElement {
  const currentUser = useCurrentUser();
  const lookups = useRegistryLookups();
  const toggleAction = useAsyncAction();

  return (
    <>
      <h1>Sandbox profiles</h1>
      <p className="muted">
        A profile is the most a run may do. Skills can only be assigned to agents whose profile
        covers every permission the skill asks for.
      </p>
      <ResourceView resource={lookups}>
        {({ providers, sandboxProfiles }) => (
          <>
            <section className="panel table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Profile</th>
                    <th>Resources</th>
                    <th>Network</th>
                    <th>Writable paths</th>
                    <th>Commands</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sandboxProfiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>
                        <strong>{profile.name}</strong>
                        <div className="muted">{profile.description}</div>
                        <code className="muted">{profile.containerImage}</code>
                      </td>
                      <td>
                        {profile.cpuLimitMillicores / MILLICORES_PER_CORE} CPU,{' '}
                        {profile.memoryLimitMb} MB,{' '}
                        {profile.maxRunDurationSeconds / SECONDS_PER_MINUTE} min
                      </td>
                      <td>
                        {profile.isNetworkAllowed
                          ? formatList(profile.allowedNetworkHosts)
                          : 'Disabled'}
                      </td>
                      <td>{formatList(profile.writablePaths)}</td>
                      <td>{formatList(profile.allowedCommands)}</td>
                      <td>
                        <ArchivedPill archivedAt={profile.archivedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel table-wrapper">
              <h2>Providers</h2>
              <ErrorBanner error={toggleAction.error} />
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Command</th>
                    <th>Status</th>
                    {isAdmin(currentUser) && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {providers.map((provider) => (
                    <tr key={provider.id}>
                      <td>{provider.displayName}</td>
                      <td>
                        <code>{[provider.cliCommand, ...provider.defaultArgs].join(' ')}</code>
                      </td>
                      <td>
                        {provider.isEnabled ? (
                          <StatusPill label="Enabled" tone="good" />
                        ) : (
                          <StatusPill label="Disabled" tone="neutral" />
                        )}
                      </td>
                      {isAdmin(currentUser) && (
                        <td>
                          <button
                            type="button"
                            className="button button--quiet button--small"
                            disabled={toggleAction.isRunning}
                            onClick={() => {
                              void toggleAction
                                .run(() => setProviderEnabled(provider.id, !provider.isEnabled))
                                .then(lookups.reload);
                            }}
                          >
                            {provider.isEnabled ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </ResourceView>
    </>
  );
}
