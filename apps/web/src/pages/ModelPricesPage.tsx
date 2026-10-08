/**
 * Per-model token prices, used to estimate the cost of runs whose provider
 * reports tokens but not cost (Codex). Everyone can read them; admins edit.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import type { ModelPrice, Provider } from '@agent-dashboard/shared';
import {
  deleteModelPrice,
  listModelPrices,
  listProviders,
  setModelPrice,
} from '../api/endpoints.js';
import { useCurrentUser } from '../auth/AuthContext.js';
import { isAdmin } from '../auth/permissions.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { FormField } from '../components/FormField.js';
import { ResourceView } from '../components/ResourceView.js';
import { useApiResource, useAsyncAction } from '../hooks/useApiResource.js';
import { formatMicroUsd, parseDollarsToMicroUsd } from '../lib/money.js';

/** The three prices a model has, as typed into the form. */
const PRICE_FIELDS = [
  { key: 'inputMicroUsdPerMillionTokens', label: 'Input, $ per 1M tokens' },
  { key: 'cachedInputMicroUsdPerMillionTokens', label: 'Cached input, $ per 1M tokens' },
  { key: 'outputMicroUsdPerMillionTokens', label: 'Output, $ per 1M tokens' },
] as const;

type PriceFieldKey = (typeof PRICE_FIELDS)[number]['key'];

/**
 * Converts the typed dollar amounts to micro-USD.
 *
 * @param dollarInputs - The form's price inputs.
 * @returns The prices, or undefined if any is blank or not a dollar amount.
 */
function parsePriceInputs(
  dollarInputs: Record<PriceFieldKey, string>,
): Record<PriceFieldKey, number> | undefined {
  const prices: Partial<Record<PriceFieldKey, number>> = {};
  for (const field of PRICE_FIELDS) {
    const microUsd = parseDollarsToMicroUsd(dollarInputs[field.key]);
    if (microUsd === null || microUsd === undefined) {
      return undefined;
    }
    prices[field.key] = microUsd;
  }
  return prices as Record<PriceFieldKey, number>;
}

/**
 * Renders the model prices page.
 *
 * @returns The page.
 */
export function ModelPricesPage(): ReactElement {
  const currentUser = useCurrentUser();
  const prices = useApiResource(listModelPrices, 'model-prices');
  const providers = useApiResource(listProviders, 'providers');
  const deleteAction = useAsyncAction();
  const canEdit = isAdmin(currentUser);

  return (
    <>
      <h1>Model prices</h1>
      <p className="muted">
        Claude Code reports each run&apos;s cost itself. Codex reports only tokens, so its cost is
        estimated from these prices. Runs of a model with no price have no cost.
      </p>
      <ErrorBanner error={deleteAction.error} />
      <ResourceView resource={providers}>
        {(loadedProviders) => (
          <>
            {canEdit && <ModelPriceForm providers={loadedProviders} onSaved={prices.reload} />}
            <section className="panel">
              <ResourceView resource={prices}>
                {(loadedPrices) => (
                  <PriceTable
                    prices={loadedPrices}
                    providers={loadedProviders}
                    canEdit={canEdit}
                    isDeleting={deleteAction.isRunning}
                    onDelete={(price) => {
                      if (window.confirm(`Delete the price for ${price.model}?`)) {
                        void deleteAction.run(() => deleteModelPrice(price.id)).then(prices.reload);
                      }
                    }}
                  />
                )}
              </ResourceView>
            </section>
          </>
        )}
      </ResourceView>
    </>
  );
}

function PriceTable({
  prices,
  providers,
  canEdit,
  isDeleting,
  onDelete,
}: {
  prices: ModelPrice[];
  providers: Provider[];
  canEdit: boolean;
  isDeleting: boolean;
  onDelete: (price: ModelPrice) => void;
}): ReactElement {
  if (prices.length === 0) {
    return <p className="muted">No prices yet.</p>;
  }
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Model</th>
            {PRICE_FIELDS.map((field) => (
              <th key={field.key}>{field.label}</th>
            ))}
            {canEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {prices.map((price) => (
            <tr key={price.id}>
              <td>
                {providers.find((provider) => provider.id === price.providerId)?.displayName ??
                  'Unknown'}
              </td>
              <td>
                <code>{price.model}</code>
              </td>
              {PRICE_FIELDS.map((field) => (
                <td key={field.key}>{formatMicroUsd(price[field.key])}</td>
              ))}
              {canEdit && (
                <td>
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    disabled={isDeleting}
                    onClick={() => {
                      onDelete(price);
                    }}
                  >
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelPriceForm({
  providers,
  onSaved,
}: {
  providers: Provider[];
  onSaved: () => void;
}): ReactElement {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  const [model, setModel] = useState('');
  const [dollarInputs, setDollarInputs] = useState<Record<PriceFieldKey, string>>({
    inputMicroUsdPerMillionTokens: '',
    cachedInputMicroUsdPerMillionTokens: '',
    outputMicroUsdPerMillionTokens: '',
  });
  const [formProblem, setFormProblem] = useState<string>();
  const saveAction = useAsyncAction();

  function handleSubmit(submitEvent: SyntheticEvent): void {
    submitEvent.preventDefault();
    const prices = parsePriceInputs(dollarInputs);
    if (prices === undefined) {
      setFormProblem('Enter every price as a dollar amount, e.g. 1.25');
      return;
    }
    setFormProblem(undefined);
    void saveAction
      .run(() => setModelPrice({ providerId, model, ...prices }))
      .then((isSaved) => {
        if (isSaved) {
          setModel('');
          onSaved();
        }
      });
  }

  return (
    <section className="panel">
      <h2>Set a price</h2>
      <form className="form" onSubmit={handleSubmit}>
        <div className="form-row">
          <FormField label="Provider">
            <select
              value={providerId}
              onChange={(changeEvent) => {
                setProviderId(changeEvent.target.value);
              }}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Model" hint="Exactly as set on the agent, e.g. gpt-5.5-codex">
            <input
              value={model}
              required
              onChange={(changeEvent) => {
                setModel(changeEvent.target.value);
              }}
            />
          </FormField>
        </div>
        <div className="form-row">
          {PRICE_FIELDS.map((field) => (
            <FormField key={field.key} label={field.label}>
              <input
                inputMode="decimal"
                value={dollarInputs[field.key]}
                required
                onChange={(changeEvent) => {
                  setDollarInputs((current) => ({
                    ...current,
                    [field.key]: changeEvent.target.value,
                  }));
                }}
              />
            </FormField>
          ))}
        </div>
        {formProblem !== undefined && <p className="error-banner">{formProblem}</p>}
        <ErrorBanner error={saveAction.error} />
        <div className="form-actions">
          <button type="submit" className="button" disabled={saveAction.isRunning}>
            Save price
          </button>
        </div>
      </form>
    </section>
  );
}
