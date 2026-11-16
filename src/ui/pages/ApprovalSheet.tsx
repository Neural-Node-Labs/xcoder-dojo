// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:19.213Z | xcoder:subtask code-st-1de5aa
/**
 * P-07 Approval Sheet.
 *
 * The modal gate for exactly two actions: file-write and delegation-launch
 * (design T-03). It never enables anything else. The request carries an expiry,
 * and the backend refuses an approval that arrives late.
 */

import { useEffect, useState } from 'react';
import type { ApprovalRequest } from '../../contracts';
import { useAppActions } from '../store';

function remainingMs(request: ApprovalRequest): number {
  return Math.max(0, request.expiresAtMs - Date.now());
}

export function ApprovalSheet({ request }: { request: ApprovalRequest }): JSX.Element {
  const actions = useAppActions();
  const [remaining, setRemaining] = useState(() => remainingMs(request));

  useEffect(() => {
    const timer = setInterval(() => setRemaining(remainingMs(request)), 250);
    return () => clearInterval(timer);
  }, [request]);

  const expired = remaining <= 0;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal approval-sheet" role="dialog" aria-modal="true" aria-label="Approval required">
        <header className="modal-head">
          <h2>Approval required</h2>
          <span className={`chip ${expired ? 'chip-bad' : 'chip-warn'}`}>
            {expired ? 'expired' : `${seconds}s left`}
          </span>
        </header>

        <div className="approval-kind">
          <code>{request.kind}</code>
          <strong>{request.summary}</strong>
        </div>

        <ul className="approval-detail">
          {request.detailLines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>

        <p className="muted small">
          This is the only confirmation gate in the app. Nothing has happened yet; approving runs the
          action once, and denying is final for this request.
        </p>

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void actions.respondApproval('denied')}
          >
            Deny
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={expired}
            onClick={() => void actions.respondApproval('approved')}
          >
            Approve once
          </button>
        </div>
      </div>
    </div>
  );
}
