// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:22.560Z | xcoder:subtask code-st-1de5aa
/**
 * P-06 Delegation Run View. Right-dock takeover for the external agent CLI.
 *
 * Launch is approval-gated (P-07). The panel is read-only output plus a Stop
 * control, because delegation is the one action that starts an external
 * process.
 */

import { useEffect, useRef } from 'react';
import { useAppActions, useAppState } from '../store';

const ACTIVE = new Set(['launching', 'running', 'stopping']);

export function DelegationPage(): JSX.Element | null {
  const state = useAppState();
  const actions = useAppActions();
  const logRef = useRef<HTMLDivElement>(null);
  const run = state.delegation;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.chunks.length]);

  if (!run) return null;
  const isActive = ACTIVE.has(run.state);

  return (
    <aside className="dock dock-right delegation-panel">
      <header className="dock-head">
        <span>Delegation</span>
        <span className={`badge ${run.state === 'succeeded' ? 'badge-ok' : run.state === 'failed' ? 'badge-bad' : isActive ? 'badge-busy' : 'badge-idle'}`}>
          {run.state}
        </span>
        <span className="dock-head-spacer" />
        <button type="button" className="btn btn-danger" disabled={!isActive} onClick={() => void actions.stopDelegation()}>
          Stop
        </button>
      </header>

      <div className="delegation-meta">
        <div>
          <span className="muted small">goal</span>
          <p>{run.goal}</p>
        </div>
        <div>
          <span className="muted small">cli</span>
          <code>{run.cliLabel}</code>
        </div>
        {run.simulated ? <span className="chip chip-warn">simulated run</span> : null}
      </div>

      <div className="console-log" ref={logRef}>
        {run.chunks.map((chunk) => (
          <div key={chunk.chunkId} className={`console-line console-${chunk.stream}`}>
            <span className="console-stream">{chunk.stream}</span>
            <span className="console-text">{chunk.text}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
