/**
 * An agent's assigned skills, with controls to assign, change and remove them.
 *
 * Only skills that support the agent's provider are offered. The API still
 * checks each skill's permissions against the sandbox profile, and any
 * violations it reports are listed under the form.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import { Link } from 'react-router';
import type { Agent } from '@agent-dashboard/shared';
import {
  assignSkill,
  listAssignments,
  listSkillVersions,
  listSkills,
  unassignSkill,
} from '../../api/endpoints.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { ResourceView } from '../../components/ResourceView.js';
import { useApiResource, useAsyncAction } from '../../hooks/useApiResource.js';

/**
 * Renders the loadout panel.
 *
 * @param props.agent - The agent whose loadout is shown.
 * @param props.isEditable - Whether the user may change the loadout.
 * @returns The panel.
 */
export function LoadoutPanel({
  agent,
  isEditable,
}: {
  agent: Agent;
  isEditable: boolean;
}): ReactElement {
  const assignments = useApiResource(() => listAssignments(agent.id), `loadout:${agent.id}`);
  const unassignAction = useAsyncAction();

  return (
    <section className="panel">
      <h2>Skills</h2>
      <ResourceView resource={assignments}>
        {(assignmentList) =>
          assignmentList.length === 0 ? (
            <p className="muted">No skills assigned.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Version</th>
                  <th>Assigned</th>
                  {isEditable && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {assignmentList.map((assignment) => (
                  <tr key={assignment.skillId}>
                    <td>
                      <Link to={`/skills/${assignment.skillId}`}>{assignment.skillName}</Link>
                    </td>
                    <td>
                      <Link
                        to={`/skills/${assignment.skillId}/versions/${assignment.skillVersionId}`}
                      >
                        {assignment.version}
                      </Link>
                    </td>
                    <td>{new Date(assignment.assignedAt).toLocaleString()}</td>
                    {isEditable && (
                      <td>
                        <button
                          type="button"
                          className="button button--danger button--small"
                          disabled={unassignAction.isRunning}
                          onClick={() => {
                            void unassignAction
                              .run(() => unassignSkill(agent.id, assignment.skillId))
                              .then(assignments.reload);
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </ResourceView>
      <ErrorBanner error={unassignAction.error} />
      {isEditable && <AssignSkillForm agent={agent} onAssigned={assignments.reload} />}
    </section>
  );
}

/**
 * Picks a skill and version and assigns it.
 *
 * @param props.agent - The agent to assign to.
 * @param props.onAssigned - Called after a successful assignment.
 * @returns The form.
 */
function AssignSkillForm({
  agent,
  onAssigned,
}: {
  agent: Agent;
  onAssigned: () => void;
}): ReactElement {
  const [skillId, setSkillId] = useState('');
  const [skillVersionId, setSkillVersionId] = useState('');
  const skills = useApiResource(() => listSkills(), 'skills:active');
  const versions = useApiResource(
    () => (skillId === '' ? Promise.resolve([]) : listSkillVersions(skillId)),
    `versions:${skillId}`,
  );
  const assignAction = useAsyncAction();

  const compatibleSkills = (skills.data ?? []).filter(
    (skill) =>
      skill.latestVersion !== null && skill.supportedProviderIds.includes(agent.providerId),
  );

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    void assignAction
      .run(() => assignSkill(agent.id, skillId, skillVersionId))
      .then((isAssigned) => {
        if (isAssigned) {
          setSkillId('');
          setSkillVersionId('');
          onAssigned();
        }
      });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <h3>Assign a skill</h3>
      <div className="form-row">
        <label className="field">
          <span>Skill</span>
          <select
            value={skillId}
            onChange={(event) => {
              setSkillId(event.target.value);
              setSkillVersionId('');
              assignAction.clearError();
            }}
            required
          >
            <option value="">Choose a skill…</option>
            {compatibleSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Version</span>
          <select
            value={skillVersionId}
            onChange={(event) => {
              setSkillVersionId(event.target.value);
            }}
            disabled={skillId === ''}
            required
          >
            <option value="">Choose a version…</option>
            {(versions.data ?? []).map((version) => (
              <option key={version.id} value={version.id}>
                {version.version}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBanner error={assignAction.error} />
      <div className="form-actions">
        <button
          type="submit"
          className="button"
          disabled={assignAction.isRunning || skillVersionId === ''}
        >
          Assign
        </button>
      </div>
    </form>
  );
}
