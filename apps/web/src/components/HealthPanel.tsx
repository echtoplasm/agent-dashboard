/**
 * Shows whether the API and its database are reachable, refreshing on a
 * fixed interval.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { fetchHealthStatus } from '../api/health.js';
import type { HealthCheckResult } from '../api/health.js';

const HEALTH_POLL_INTERVAL_MS = 10_000;

/** Display label and CSS modifier for each overall state. */
const STATUS_DISPLAY = {
  ok: { label: 'Healthy', tone: 'good' },
  degraded: { label: 'Degraded', tone: 'warn' },
  unreachable: { label: 'Unreachable', tone: 'bad' },
  loading: { label: 'Checking…', tone: 'neutral' },
} as const;

type DisplayState = keyof typeof STATUS_DISPLAY;

function getDisplayState(healthCheckResult: HealthCheckResult | null): DisplayState {
  if (healthCheckResult === null) {
    return 'loading';
  }
  if (healthCheckResult.kind === 'unreachable') {
    return 'unreachable';
  }
  return healthCheckResult.healthReport.status;
}

function formatCheckedAt(checkedAt: string): string {
  return new Date(checkedAt).toLocaleTimeString();
}

/**
 * Health status card for the API.
 *
 * @returns The rendered panel.
 */
export function HealthPanel(): ReactElement {
  const [healthCheckResult, setHealthCheckResult] = useState<HealthCheckResult | null>(null);

  const refreshHealth = useCallback(async () => {
    setHealthCheckResult(await fetchHealthStatus());
  }, []);

  useEffect(() => {
    void refreshHealth();
    const intervalId = window.setInterval(() => void refreshHealth(), HEALTH_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshHealth]);

  const displayState = getDisplayState(healthCheckResult);
  const { label, tone } = STATUS_DISPLAY[displayState];

  return (
    <section className="panel" aria-labelledby="health-heading">
      <header className="panel-header">
        <h2 id="health-heading">API health</h2>
        <span className={`status-badge status-badge--${tone}`} role="status">
          {label}
        </span>
      </header>

      {healthCheckResult?.kind === 'reported' && (
        <dl className="health-details">
          <dt>Database</dt>
          <dd>{healthCheckResult.healthReport.checks.database}</dd>
          <dt>Uptime</dt>
          <dd>{healthCheckResult.healthReport.uptimeSeconds}s</dd>
          <dt>Checked at</dt>
          <dd>{formatCheckedAt(healthCheckResult.healthReport.checkedAt)}</dd>
        </dl>
      )}
      {healthCheckResult?.kind === 'unreachable' && (
        <p className="health-error">{healthCheckResult.reason}</p>
      )}

      <button type="button" className="refresh-button" onClick={() => void refreshHealth()}>
        Refresh
      </button>
    </section>
  );
}
