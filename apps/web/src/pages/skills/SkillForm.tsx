/**
 * Create and edit form for a skill's identity and supported providers.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import type { CreateSkillRequest, Provider, Skill } from '@agent-dashboard/shared';
import type { ApiError } from '../../api/api-client.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { FormField } from '../../components/FormField.js';

/** Props for `SkillForm`. */
export interface SkillFormProps {
  /** The skill being edited; omit to create one. The slug can't change after creation. */
  initialSkill?: Skill;
  providers: Provider[];
  submitLabel: string;
  isSubmitting: boolean;
  submitError: ApiError | undefined;
  onSubmit: (values: CreateSkillRequest) => void;
  onCancel?: () => void;
}

/**
 * Renders the skill form.
 *
 * @param props - See `SkillFormProps`.
 * @returns The form.
 */
export function SkillForm(props: SkillFormProps): ReactElement {
  const { initialSkill, providers } = props;
  const [slug, setSlug] = useState(initialSkill?.slug ?? '');
  const [name, setName] = useState(initialSkill?.name ?? '');
  const [description, setDescription] = useState(initialSkill?.description ?? '');
  const [supportedProviderIds, setSupportedProviderIds] = useState<string[]>(
    initialSkill?.supportedProviderIds ?? providers.map((provider) => provider.id),
  );

  function toggleProvider(providerId: string, isChecked: boolean): void {
    setSupportedProviderIds((current) =>
      isChecked ? [...current, providerId] : current.filter((id) => id !== providerId),
    );
  }

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    props.onSubmit({
      slug: slug.trim(),
      name: name.trim(),
      description: description.trim(),
      supportedProviderIds,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-row">
        <FormField label="Slug" hint="Permanent. Lowercase letters, digits and dashes.">
          <input
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
            placeholder="run-unit-tests"
            disabled={initialSkill !== undefined}
            required
          />
        </FormField>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            required
          />
        </label>
      </div>
      <label className="field">
        <span>Description</span>
        <input
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </label>
      <fieldset className="field">
        <span>Supported providers</span>
        <div className="checkbox-row">
          {providers.map((provider) => (
            <label key={provider.id} className="checkbox">
              <input
                type="checkbox"
                checked={supportedProviderIds.includes(provider.id)}
                onChange={(event) => {
                  toggleProvider(provider.id, event.target.checked);
                }}
              />
              {provider.displayName}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorBanner error={props.submitError} />
      <div className="form-actions">
        <button type="submit" className="button" disabled={props.isSubmitting}>
          {props.submitLabel}
        </button>
        {props.onCancel !== undefined && (
          <button type="button" className="button button--quiet" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
