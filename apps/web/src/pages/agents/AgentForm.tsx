/**
 * Create and edit form for agents.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import type { Agent, CreateAgentRequest, Provider, SandboxProfile } from '@agent-dashboard/shared';
import type { ApiError } from '../../api/api-client.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { FormField } from '../../components/FormField.js';
import { microUsdToDollarInput, parseDollarsToMicroUsd } from '../../lib/money.js';

/** Props for `AgentForm`. */
export interface AgentFormProps {
  /** The agent being edited; omit to create a new one. */
  initialAgent?: Agent;
  providers: Provider[];
  sandboxProfiles: SandboxProfile[];
  submitLabel: string;
  isSubmitting: boolean;
  submitError: ApiError | undefined;
  onSubmit: (values: CreateAgentRequest) => void;
  onCancel?: () => void;
}

/**
 * Renders the agent form. Only enabled providers and active profiles can be
 * picked, plus whatever the agent already uses.
 *
 * @param props - See `AgentFormProps`.
 * @returns The form.
 */
export function AgentForm(props: AgentFormProps): ReactElement {
  const { initialAgent, providers, sandboxProfiles } = props;
  const [name, setName] = useState(initialAgent?.name ?? '');
  const [description, setDescription] = useState(initialAgent?.description ?? '');
  const [providerId, setProviderId] = useState(
    initialAgent?.providerId ?? providers.find((provider) => provider.isEnabled)?.id ?? '',
  );
  const [sandboxProfileId, setSandboxProfileId] = useState(
    initialAgent?.sandboxProfileId ?? sandboxProfiles[0]?.id ?? '',
  );
  const [model, setModel] = useState(initialAgent?.model ?? '');
  const [perRunBudget, setPerRunBudget] = useState(
    microUsdToDollarInput(initialAgent?.maxCostPerRunMicroUsd ?? null),
  );
  const [perMonthBudget, setPerMonthBudget] = useState(
    microUsdToDollarInput(initialAgent?.maxCostPerMonthMicroUsd ?? null),
  );
  const [budgetProblem, setBudgetProblem] = useState<string>();

  const selectableProviders = providers.filter(
    (provider) => provider.isEnabled || provider.id === initialAgent?.providerId,
  );
  const selectableProfiles = sandboxProfiles.filter(
    (profile) => profile.archivedAt === null || profile.id === initialAgent?.sandboxProfileId,
  );

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    const maxCostPerRunMicroUsd = parseDollarsToMicroUsd(perRunBudget);
    const maxCostPerMonthMicroUsd = parseDollarsToMicroUsd(perMonthBudget);
    if (maxCostPerRunMicroUsd === undefined || maxCostPerMonthMicroUsd === undefined) {
      setBudgetProblem('Budgets must be dollar amounts like 2.50, or blank for no limit');
      return;
    }
    setBudgetProblem(undefined);
    props.onSubmit({
      name: name.trim(),
      description: description.trim(),
      providerId,
      sandboxProfileId,
      model: model.trim() === '' ? null : model.trim(),
      maxCostPerRunMicroUsd,
      maxCostPerMonthMicroUsd,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-row">
        <FormField label="Name" hint="Lowercase letters, digits and dashes.">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="docs-writer"
            required
          />
        </FormField>
        <label className="field">
          <span>Model (optional)</span>
          <input
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
            placeholder="Provider default"
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
      <div className="form-row">
        <label className="field">
          <span>Provider</span>
          <select
            value={providerId}
            onChange={(event) => {
              setProviderId(event.target.value);
            }}
            required
          >
            {selectableProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
                {provider.isEnabled ? '' : ' (disabled)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sandbox profile</span>
          <select
            value={sandboxProfileId}
            onChange={(event) => {
              setSandboxProfileId(event.target.value);
            }}
            required
          >
            {selectableProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span>Budget per run (USD)</span>
          <input
            inputMode="decimal"
            value={perRunBudget}
            onChange={(event) => {
              setPerRunBudget(event.target.value);
            }}
            placeholder="No limit"
          />
        </label>
        <label className="field">
          <span>Budget per month (USD)</span>
          <input
            inputMode="decimal"
            value={perMonthBudget}
            onChange={(event) => {
              setPerMonthBudget(event.target.value);
            }}
            placeholder="No limit"
          />
        </label>
      </div>
      {budgetProblem !== undefined && <p className="error-banner">{budgetProblem}</p>}
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
