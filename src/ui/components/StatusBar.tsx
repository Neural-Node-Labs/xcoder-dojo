// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:31:32.753Z | xcoder:subtask code-st-1de5aa
/**
 * P-11 Status bar. Persistent chrome, view-only badges.
 *
 * The audit-log location is always one click away (S-11 disclosure).
 */

import type { StatusBarModel } from '../../contracts';

export interface StatusBarProps {
  status: StatusBarModel | null;
  onOpenAudit: () => void;
  onOpenSettings: () => void;
  onFocusRun: () => void;
  onFocusAgent: () => void;
}

function badgeClass(state: string): string {
  if (['succeeded', 'done', 'configured'].includes(state)) return 'badge badge-ok';
  if (['failed', 'error', 'turn-limit', 'request-cap'].includes(state)) return 'badge badge-bad';
  if (['running', 'thinking', 'awaiting-tool', 'answering', 'starting', 'stopping'].includes(state)) return 'badge badge-busy';
  return 'badge badge-idle';
}

export function StatusBar({ status, onOpenAudit, onOpenSettings, onFocusRun, onFocusAgent }: StatusBarProps): JSX.Element {
  if (!status) {
    return (
      <footer className="status-bar">
        <span className="status-path">no workspace</span>
      </footer>
    );
  }
  return (
    <footer className="status-bar">
      <span className="status-path" title={status.workspacePathDisplay ?? undefined}>
        {status.workspacePathDisplay ?? 'no workspace open'}
      </span>
      <span className="status-spacer" />
      {status.selection ? (
        <span className="status-item" title={status.selection.relPath}>
          {status.selection.relPath} <span className="muted">({status.selection.language})</span>
        </span>
      ) : null}
      <button type="button" className="status-btn" onClick={onFocusRun}>
        <span className={badgeClass(status.run.state)}>{status.run.state}</span>
        <span>{status.run.label}</span>
      </button>
      <button type="button" className="status-btn" onClick={onFocusAgent}>
        <span className={badgeClass(status.agent.state)}>{status.agent.state}</span>
        <span>JARVIS</span>
      </button>
      <button type="button" className="status-btn" onClick={onOpenSettings}>
        <span className={badgeClass(status.model.state)}>{status.model.state}</span>
        <span>{status.model.label}</span>
      </button>
      <button type="button" className="status-btn" onClick={onOpenAudit} title={status.audit.logDir}>
        audit: {status.audit.retentionDays}d retention
      </button>
    </footer>
  );
}
