/**
 * One skill: its details, edit and archive controls, published versions,
 * and the publish form.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import type { Provider, Skill } from '@agent-dashboard/shared';
import {
  archiveSkill,
  deleteSkill,
  getSkill,
  listSkillVersions,
  updateSkill,
} from '../../api/endpoints.js';
import { useCurrentUser } from '../../auth/AuthContext.js';
import { canManageRegistry, isAdmin } from '../../auth/permissions.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { ResourceView } from '../../components/ResourceView.js';
import { DeleteResourceButton } from '../../components/DeleteResourceButton.js';
import { ArchivedPill } from '../../components/StatusPill.js';
import { useApiResource, useAsyncAction } from '../../hooks/useApiResource.js';
import { findNameById, useRegistryLookups } from '../../hooks/useRegistryLookups.js';
import { PublishVersionForm } from './PublishVersionForm.js';
import { SkillForm } from './SkillForm.js';

/**
 * Renders the skill detail page for the `:skillId` route parameter.
 *
 * @returns The page.
 */
export function SkillDetailPage(): ReactElement {
  const { skillId = '' } = useParams();
  const skill = useApiResource(() => getSkill(skillId), `skill:${skillId}`);
  const lookups = useRegistryLookups();

  return (
    <ResourceView resource={skill}>
      {(loadedSkill) => (
        <ResourceView resource={lookups}>
          {({ providers }) => (
            <SkillDetails skill={loadedSkill} providers={providers} onChanged={skill.reload} />
          )}
        </ResourceView>
      )}
    </ResourceView>
  );
}

function SkillDetails({
  skill,
  providers,
  onChanged,
}: {
  skill: Skill;
  providers: Provider[];
  onChanged: () => void;
}): ReactElement {
  const currentUser = useCurrentUser();
  const [isEditing, setIsEditing] = useState(false);
  const versions = useApiResource(() => listSkillVersions(skill.id), `versions:${skill.id}`);
  const updateAction = useAsyncAction();
  const archiveAction = useAsyncAction();
  const isEditable = canManageRegistry(currentUser) && skill.archivedAt === null;
  // Only a skill that never published a version can be deleted (D-026).
  const isDeletable = isAdmin(currentUser) && skill.latestVersion === null;

  function handleVersionPublished(): void {
    versions.reload();
    onChanged();
  }

  return (
    <>
      <div className="page-header">
        <h1>
          {skill.name} <ArchivedPill archivedAt={skill.archivedAt} />
        </h1>
        {!isEditing && (isEditable || isDeletable) && (
          <div className="form-actions">
            {isEditable && (
              <>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => {
                    setIsEditing(true);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  disabled={archiveAction.isRunning}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Archive ${skill.name}? It can no longer be assigned or updated.`,
                      )
                    ) {
                      void archiveAction.run(() => archiveSkill(skill.id)).then(onChanged);
                    }
                  }}
                >
                  Archive
                </button>
              </>
            )}
            {isDeletable && (
              <DeleteResourceButton
                resourceName={skill.name}
                onDelete={() => deleteSkill(skill.id)}
                redirectTo="/skills"
              />
            )}
          </div>
        )}
      </div>
      <ErrorBanner error={archiveAction.error} />

      <section className="panel">
        {isEditing ? (
          <SkillForm
            initialSkill={skill}
            providers={providers}
            submitLabel="Save changes"
            isSubmitting={updateAction.isRunning}
            submitError={updateAction.error}
            onSubmit={({ name, description, supportedProviderIds }) => {
              void updateAction
                .run(() => updateSkill(skill.id, { name, description, supportedProviderIds }))
                .then((isSaved) => {
                  if (isSaved) {
                    setIsEditing(false);
                    onChanged();
                  }
                });
            }}
            onCancel={() => {
              setIsEditing(false);
              updateAction.clearError();
            }}
          />
        ) : (
          <dl className="details">
            <dt>Slug</dt>
            <dd>
              <code>{skill.slug}</code>
            </dd>
            <dt>Description</dt>
            <dd>{skill.description === '' ? '—' : skill.description}</dd>
            <dt>Providers</dt>
            <dd>
              {skill.supportedProviderIds
                .map((providerId) =>
                  findNameById(providers, providerId, (provider) => provider.displayName),
                )
                .join(', ')}
            </dd>
            <dt>Latest version</dt>
            <dd>{skill.latestVersion ?? 'None published'}</dd>
          </dl>
        )}
      </section>

      <section className="panel table-wrapper">
        <h2>Versions</h2>
        <ResourceView resource={versions}>
          {(versionList) =>
            versionList.length === 0 ? (
              <p className="muted">No versions published yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Published</th>
                    <th>Network</th>
                    <th>Changelog</th>
                  </tr>
                </thead>
                <tbody>
                  {versionList.map((version) => (
                    <tr key={version.id}>
                      <td>
                        <Link to={`/skills/${skill.id}/versions/${version.id}`}>
                          {version.version}
                        </Link>
                      </td>
                      <td>{new Date(version.publishedAt).toLocaleString()}</td>
                      <td>
                        {version.permissionsManifest.network.isAllowed
                          ? version.permissionsManifest.network.allowedHosts.join(', ') || 'Allowed'
                          : 'None'}
                      </td>
                      <td>{version.changelog}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </ResourceView>
      </section>

      {isEditable && (
        <section className="panel">
          <h2>Publish a new version</h2>
          <PublishVersionForm
            skillId={skill.id}
            latestVersion={skill.latestVersion}
            onPublished={handleVersionPublished}
          />
        </section>
      )}
    </>
  );
}
