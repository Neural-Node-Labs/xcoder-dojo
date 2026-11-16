// xcoder:version 3 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:32:43.018Z | xcoder:subtask code-st-1de5aa
/**
 * P-04 Run Console, single-flight.
 *
 * One run at a time, one auditable execution contract, one Stop target
 * (design T-01). A start while running is refused by the backend as `run-busy`
 * and surfaced as a toast; the button is merely disabled here as a courtesy.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppActions, useAppState } from '../store';

const ACTIVE_STATES = new Set(['starting', 'running', 'stopping']);

export function RunConsolePage(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr' | 'system'>('all');
  const logRef = useRef<HTMLDivElement>(null);

  const session = state.run.session;
  const isActive = session ? ACTIVE_STATES.has(session.state) : false;
  const target = state.run.targets.find((t) => t.targetId === selectedTarget) ?? state.run.targets[0];

  const chunks = useMemo(() => {
    if (!session) return [];
    return streamFilter === 'all' ? session.chunks : session.chunks.filter((c) => c.stream === streamFilter);
  }, [session, streamFilter]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chunks.length]);

  const onStart = (): void => {
    if (!target) return;
    void actions.startRun(target.targetId);
  };

  return (
    <section className="dock dock-bottom">
      <header className="dock-head">
        <span>Run Console</span>
        {session ? (
          <span className={`badge ${session.state === 'succeeded' ? 'badge-ok' : session.state === 'failed' ? 'badge-bad' : isActive ? 'badge-busy' : 'badge-idle'}`}>
            {session.state}
          </span>
        ) : (
          <span className="badge badge-idle">idle</span>
        )}
        <span className="dock-head-spacer" />
        <span className="run-target-picker">
          <label htmlFor="run-target" className="muted small">
            Target
          </label>
          <select
            id="run-target"
            value={target?.targetId ?? ''}
            onChange={(e) => setSelectedTarget(e.target.value)}
            disabled={isActive}
          >
            {state.run.targets.map((t) => (
              <option key={t.targetId} value={t.targetId}>
                {t.label}
              </option>
            ))}
          </select>
        </span>
        <button type="button" className="btn btn-primary" onClick={onStart} disabled={isActive || !target || !state.workspace}>
          Run
        </button>
        <button type="button" className="btn btn-danger" onClick={() => void actions.stopRun()} disabled={!isActive}>
          Stop
        </button>
      </header>

      {target ? (
        <div className="cmd-spec">
          <code>{target.argv.join(' ')}</code>
          <span className="muted small">
            argv array, no shell interpolation
            {target.envKeys.length > 0 ? ` / env: ${target.envKeys.join(', ')}` : ' / no env keys'}
          </span>
        </div>
      ) : null}

      <div className="console-toolbar">
        {(['all', 'stdout', 'stderr', 'system'] as const).map((stream) => (
          <button
            key={stream}
            type="button"
            className={`chip chip-btn ${streamFilter === stream ? 'chip-active' : ''}`}
            onClick={() => setStreamFilter(stream)}
          >
            {stream}
          </button>
        ))}
        <span className="muted small">
          {session ? `${session.chunks.length} chunks` : 'no run yet'}
          {session?.exitCode !== null && session?.exitCode !== undefined ? ` / exit ${session.exitCode}` : ''}
        </span>
      </div>

      <div className="console-log" ref={logRef}>
        {chunks.length === 0 ? (
          <p className="muted">No output. Press Run to start {target?.label ?? 'a target'}.</p>
        ) : (
          chunks.map((chunk) => (
            <div key={chunk.chunkId} className={`console-line console-${chunk.stream}`}>
              <span className="console-stream">{chunk.stream}</span>
              <span className="console-text">{chunk.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
