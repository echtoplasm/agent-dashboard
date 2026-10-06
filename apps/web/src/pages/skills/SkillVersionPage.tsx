/**
 * One published skill version: its permissions manifest and every file.
 */
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { getSkillVersion } from '../../api/endpoints.js';
import { ResourceView } from '../../components/ResourceView.js';
import { useApiResource } from '../../hooks/useApiResource.js';

const JSON_INDENT_SPACES = 2;

/**
 * Renders the version page for the `:skillId` and `:versionId` route parameters.
 *
 * @returns The page.
 */
export function SkillVersionPage(): ReactElement {
  const { skillId = '', versionId = '' } = useParams();
  const version = useApiResource(() => getSkillVersion(versionId), `skill-version:${versionId}`);

  return (
    <ResourceView resource={version}>
      {(loadedVersion) => (
        <>
          <div className="page-header">
            <h1>Version {loadedVersion.version}</h1>
            <Link to={`/skills/${skillId}`}>Back to skill</Link>
          </div>
          <section className="panel">
            <dl className="details">
              <dt>Published</dt>
              <dd>{new Date(loadedVersion.publishedAt).toLocaleString()}</dd>
              <dt>Content hash</dt>
              <dd>
                <code>{loadedVersion.contentHash}</code>
              </dd>
              <dt>Changelog</dt>
              <dd>{loadedVersion.changelog === '' ? '—' : loadedVersion.changelog}</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>Permissions manifest</h2>
            <pre>{JSON.stringify(loadedVersion.permissionsManifest, null, JSON_INDENT_SPACES)}</pre>
          </section>
          <section className="panel">
            <h2>Files</h2>
            {loadedVersion.files.map((file) => (
              <article key={file.path} className="file-block">
                <h3>
                  <code>{file.path}</code>
                </h3>
                <pre>{file.content}</pre>
              </article>
            ))}
          </section>
        </>
      )}
    </ResourceView>
  );
}
