// xcoder:version 3 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:31:41.266Z | xcoder:subtask code-st-1de5aa
/**
 * P-12 Error Center. Toasts render the closed AppError vocabulary; the detail
 * sheet reveals remediation. Raw stack traces and provider payloads never reach
 * this component.
 */

import { useState } from 'react';
import type { Toast } from '../store';

export interface ErrorCenterProps {
  toasts: Toast[];
  onDismiss: (toastId: string) => void;
}

export function ErrorCenter({ toasts, onDismiss }: ErrorCenterProps): JSX.Element | null {
  const [openId, setOpenId] = useState<string | null>(null);
  if (toasts.length === 0) return null;
  const open = toasts.find((t) => t.toastId === openId) ?? null;

  return (
    <div className="error-center">
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.toastId} className={`toast toast-${toast.error.code}`} role="alert">
            <div className="toast-head">
              <code className="toast-code">{toast.error.code}</code>
              <button type="button" className="icon-btn" onClick={() => onDismiss(toast.toastId)} aria-label="Dismiss">
                &times;
              </button>
            </div>
            <div className="toast-msg">{toast.error.message}</div>
            <button type="button" className="link-btn" onClick={() => setOpenId(toast.toastId)}>
              details
            </button>
          </div>
        ))}
      </div>
      {open ? (
        <div className="detail-sheet" role="dialog" aria-label="Error detail">
          <header>
            <code>{open.error.code}</code>
            <button type="button" className="icon-btn" onClick={() => setOpenId(null)} aria-label="Close">
              &times;
            </button>
          </header>
          <p>{open.error.message}</p>
          {open.remediation ? <p className="muted">Remediation: {open.remediation}</p> : null}
          {open.error.detailRef ? <p className="muted">Reference: {open.error.detailRef}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
