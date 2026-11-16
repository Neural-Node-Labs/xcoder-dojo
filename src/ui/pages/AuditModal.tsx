// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:44.264Z | xcoder:subtask code-st-1de5aa
/**
 * P-10 Audit Log Viewer.
 *
 * Strictly read-only and cursor-paginated. The backend stores pre-redacted
 * summaries; this view has no edit or delete control because there is no such
 * action to call (design P-10).
 */

import { useCallback, useEffect, useState } from 'react';
import type { AuditEventType, AuditEventView, AuditPage } from '../../contracts';
import { useAppActions, useAppState } from '../store';

const TYPES: readonly (AuditEventType | 'all')[] = [
  'all',
  'workspace-open',
  'file-save',
  'run-start',
  'run-stop',
  'agent-request',
  'agent-response',
  'tool-call',
  'tool-refusal',
  'delegation-start',
  'approval-request',
  'approval-decision',
  'settings-change',
  'secret-set',
  'secret-cleared',
  'error',
];

export function AuditModal(): JSX.Element | null {
  const state = useAppState();
  const actions = useAppActions();
  const [page, setPage] = useState<AuditPage | null>(null);
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [type, setType] = useState<AuditEventType | 'all'>('all');
  const [detail, setDetail] = useState<AuditEventView | null>(null);

  const load = useCallback(
    async (cursor?: string, replace = false): Promise<void> => {
      const request = {
        limit: 40,
        ...(cursor ? { cursor } : {}),
        ...(type !== 'all' ? { type } : {}),
      };
      const result = await state.bridge.audit.page(request);
      if (!result.ok) return;
      setPage(result.value);
      setEvents((prev) => (replace ? [...result.value.events] : [...prev, ...result.value.events]));
    },
    [state.bridge, type],
  );

  useEffect(() => {
    if (state.overlay !== 'audit') return;
    void load(undefined, true);
  }, [state.overlay, load]);

  if (state.overlay !== 'audit') return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => actions.setOverlay(null)}>
      <div
        className="modal audit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Audit log"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Audit Log</h2>
          <span className="muted small">{page ? `${page.retentionDays}-day retention` : ''}</span>
          <button type="button" className="icon-btn" onClick={() => actions.setOverlay(null)} aria-label="Close">
            &times;
          </button>
        </header>

        <div className="audit-toolbar">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AuditEventType | 'all')}
            aria-label="Filter by event type"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span className="muted small">Append-only. Redacted at write time.</span>
        </div>

        <div className="audit-table">
          <div className="audit-row audit-header">
            <span>time</span>
            <span>type</span>
            <span>actor</span>
            <span>outcome</span>
            <span>summary</span>
          </div>
          {events.length === 0 ? (
            <p className="muted">No audit events recorded yet.</p>
          ) : (
            events.map((event) => (
              <button
                key={event.eventId}
                type="button"
                className="audit-row audit-event"
                onClick={() => setDetail(event)}
              >
                <span>{new Date(event.atMs).toLocaleTimeString()}</span>
                <span>{event.type}</span>
                <span>{event.actor}</span>
                <span className={`audit-outcome audit-${event.outcome}`}>{event.outcome}</span>
                <span className="audit-summary">{event.redactedSummary}</span>
              </button>
            ))
          )}
        </div>

        {page?.nextCursor ? (
          <button type="button" className="btn btn-ghost" onClick={() => void load(page.nextCursor ?? undefined)}>
            Load more
          </button>
        ) : null}

        {detail ? (
          <div className="detail-sheet">
            <header>
              <code>{detail.type}</code>
              <button type="button" className="icon-btn" onClick={() => setDetail(null)} aria-label="Close detail">
                &times;
              </button>
            </header>
            <p>{detail.redactedSummary}</p>
            <dl>
              <dt>event</dt>
              <dd>{detail.eventId}</dd>
              <dt>actor</dt>
              <dd>{detail.actor}</dd>
              <dt>outcome</dt>
              <dd>{detail.outcome}</dd>
              {detail.targetRelPath ? (
                <>
                  <dt>target</dt>
                  <dd>{detail.targetRelPath}</dd>
                </>
              ) : null}
              {detail.toolName ? (
                <>
                  <dt>tool</dt>
                  <dd>{detail.toolName}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}
