/**
 * Lists skills and lets operators create new ones.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { createSkill, listSkills } from '../../api/endpoints.js';
import { useCurrentUser } from '../../auth/AuthContext.js';
import { canManageRegistry } from '../../auth/permissions.js';
import { ResourceView } from '../../components/ResourceView.js';
import { ArchivedPill } from '../../components/StatusPill.js';
import { useApiResource, useAsyncAction } from '../../hooks/useApiResource.js';
import { findNameById, useRegistryLookups } from '../../hooks/useRegistryLookups.js';
import { SkillForm } from './SkillForm.js';

/**
 * Renders the skills page.
 *
 * @returns The page.
 */
export function SkillsPage(): ReactElement {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [isShowingArchived, setIsShowingArchived] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const skills = useApiResource(
    () => listSkills(isShowingArchived),
    `skills:${String(isShowingArchived)}`,
  );
  const lookups = useRegistryLookups();
  const createAction = useAsyncAction();

  return (
    <>
      <div className="page-header">
        <h1>Skills</h1>
        <div className="form-actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={isShowingArchived}
              onChange={(event) => {
                setIsShowingArchived(event.target.checked);
              }}
            />
            Show archived
          </label>
          {canManageRegistry(currentUser) && !isCreating && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setIsCreating(true);
              }}
            >
              New skill
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <section className="panel">
          <h2>New skill</h2>
          <ResourceView resource={lookups}>
            {({ providers }) => (
              <SkillForm
                providers={providers}
                submitLabel="Create skill"
                isSubmitting={createAction.isRunning}
                submitError={createAction.error}
                onSubmit={(values) => {
                  void createAction.run(async () => {
                    const createdSkill = await createSkill(values);
                    await navigate(`/skills/${createdSkill.id}`);
                  });
                }}
                onCancel={() => {
                  setIsCreating(false);
                  createAction.clearError();
                }}
              />
            )}
          </ResourceView>
        </section>
      )}

      <section className="panel table-wrapper">
        <ResourceView resource={skills}>
          {(skillList) =>
            skillList.length === 0 ? (
              <p className="muted">No skills yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Latest version</th>
                    <th>Providers</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {skillList.map((skill) => (
                    <tr key={skill.id}>
                      <td>
                        <Link to={`/skills/${skill.id}`}>{skill.name}</Link>{' '}
                        <code className="muted">{skill.slug}</code>
                        {skill.description !== '' && (
                          <div className="muted">{skill.description}</div>
                        )}
                      </td>
                      <td>{skill.latestVersion ?? <span className="muted">None</span>}</td>
                      <td>
                        {skill.supportedProviderIds
                          .map((providerId) =>
                            findNameById(
                              lookups.data?.providers ?? [],
                              providerId,
                              (provider) => provider.displayName,
                            ),
                          )
                          .join(', ')}
                      </td>
                      <td>
                        <ArchivedPill archivedAt={skill.archivedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </ResourceView>
      </section>
    </>
  );
}
