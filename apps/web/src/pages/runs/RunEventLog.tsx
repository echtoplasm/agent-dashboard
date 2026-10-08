/**
 * The live log of a run: model output, tool calls with their results,
 * stderr, usage and status changes, in the order they happened.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { RunEvent } from '@agent-dashboard/shared';
import { RunStatusPill } from '../../components/RunStatusPill.js';
import { formatMicroUsd } from '../../lib/money.js';
import { formatDuration, formatTokenCount } from '../../lib/run-formatting.js';
import { buildRunLogItems, summarizeToolInput } from './run-log-items.js';
import type { RunLogItem, ToolLogItem } from './run-log-items.js';

/** Pixels from the bottom within which the log keeps following new events. */
const FOLLOW_THRESHOLD_PX = 80;

function ToolEntry({ item }: { item: ToolLogItem }): ReactElement {
  const { call, result } = item;
  const outcomeLabel = result === null ? 'running…' : result.isError ? 'failed' : 'done';
  const outcomeClass =
    result === null ? 'muted' : result.isError ? 'run-log__bad' : 'run-log__good';
  return (
    <details className="run-log__tool">
      <summary>
        <code className="run-log__tool-name">{call.toolName}</code>{' '}
        <code className="run-log__tool-summary">{summarizeToolInput(call.input)}</code>{' '}
        <span className={outcomeClass}>
          {outcomeLabel}
          {result?.exitCode !== null &&
            result?.exitCode !== undefined &&
            ` (exit ${result.exitCode})`}
        </span>
      </summary>
      <h4>Input</h4>
      <pre>{JSON.stringify(call.input, null, 2)}</pre>
      {result !== null && (
        <>
          <h4>Output{result.isOutputTruncated && ' (truncated)'}</h4>
          <pre>{result.output === '' ? '(no output)' : result.output}</pre>
        </>
      )}
    </details>
  );
}

function EventEntry({ event }: { event: RunEvent }): ReactElement | null {
  switch (event.type) {
    case 'run.status':
      return (
        <p className="run-log__status">
          <RunStatusPill status={event.payload.status} />
          {event.payload.message !== null && <span> {event.payload.message}</span>}
        </p>
      );
    case 'session.started':
      return (
        <p className="run-log__meta">
          Session started{event.payload.model !== null && ` · ${event.payload.model}`}
          {event.payload.skills.length > 0 && ` · skills: ${event.payload.skills.join(', ')}`}
        </p>
      );
    case 'assistant.text':
      return <div className="run-log__text">{event.payload.text}</div>;
    case 'assistant.thinking':
      return (
        <details className="run-log__thinking">
          <summary>Reasoning</summary>
          <div className="run-log__text">{event.payload.text}</div>
        </details>
      );
    case 'usage':
      return (
        <p className="run-log__meta">
          Usage: {formatTokenCount(event.payload.inputTokens)} in ·{' '}
          {formatTokenCount(event.payload.outputTokens)} out ·{' '}
          {formatTokenCount(event.payload.cacheReadTokens)} cache read
          {event.payload.costMicroUsd !== null &&
            ` · ${event.payload.costSource === 'estimated' ? '~' : ''}${formatMicroUsd(event.payload.costMicroUsd)}`}
        </p>
      );
    case 'rate_limit':
      return (
        <p className="run-log__meta">
          Rate limit {event.payload.status}
          {event.payload.limitType !== null && ` (${event.payload.limitType})`}
          {event.payload.utilization !== null &&
            ` · ${Math.round(event.payload.utilization * 100)}% used`}
        </p>
      );
    case 'error':
      return (
        <p className="run-log__error">
          {event.payload.isFatal ? 'Error: ' : 'Warning: '}
          {event.payload.message}
        </p>
      );
    case 'notice':
      return <p className="run-log__meta">{event.payload.message}</p>;
    case 'run.result':
      return (
        <div
          className={
            event.payload.isError ? 'run-log__result run-log__result--bad' : 'run-log__result'
          }
        >
          <strong>{event.payload.isError ? 'Finished with an error' : 'Result'}</strong>
          {event.payload.durationMs !== null && (
            <span className="muted"> · {formatDuration(event.payload.durationMs)}</span>
          )}
          {event.payload.summary !== null && (
            <div className="run-log__text">{event.payload.summary}</div>
          )}
        </div>
      );
    case 'tool.call':
    case 'tool.result':
      return null;
    case 'provider.other':
      return (
        <p className="run-log__meta">
          <code>{event.payload.providerEventType}</code>
        </p>
      );
  }
}

function LogItem({ item }: { item: RunLogItem }): ReactElement | null {
  switch (item.kind) {
    case 'tool':
      return <ToolEntry item={item} />;
    case 'stderr':
      return <pre className="run-log__stderr">{item.lines.join('\n')}</pre>;
    case 'event':
      return <EventEntry event={item.event} />;
  }
}

/**
 * Renders a run's log and keeps it scrolled to the newest entry while the
 * reader is at the bottom.
 *
 * @param props.events - The run's events in order.
 * @returns The log.
 */
export function RunEventLog({ events }: { events: RunEvent[] }): ReactElement {
  const [isShowingProviderEvents, setIsShowingProviderEvents] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  // Whether the reader is at the bottom; updated on scroll, read after new events.
  const isFollowingRef = useRef(true);
  const items = buildRunLogItems(events, { isShowingProviderEvents });

  useEffect(() => {
    const logElement = logRef.current;
    if (logElement !== null && isFollowingRef.current) {
      logElement.scrollTop = logElement.scrollHeight;
    }
  }, [events.length]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Output</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={isShowingProviderEvents}
            onChange={(changeEvent) => {
              setIsShowingProviderEvents(changeEvent.target.checked);
            }}
          />{' '}
          Show untranslated provider events
        </label>
      </div>
      <div
        className="run-log"
        ref={logRef}
        aria-live="polite"
        onScroll={(scrollEvent) => {
          const logElement = scrollEvent.currentTarget;
          isFollowingRef.current =
            logElement.scrollHeight - logElement.scrollTop - logElement.clientHeight <
            FOLLOW_THRESHOLD_PX;
        }}
      >
        {items.length === 0 ? (
          <p className="muted">Waiting for output…</p>
        ) : (
          items.map((item) => <LogItem key={item.key} item={item} />)
        )}
      </div>
    </section>
  );
}
