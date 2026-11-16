// xcoder:version 3 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:38.644Z | xcoder:subtask code-st-1de5aa
/**
 * P-09 Conversation History.
 *
 * Read-only over stored sessions; the only mutation is deletion, and it is
 * confirmed twice for "clear all". Titles come from the first user turn and are
 * rendered escaped.
 */

import { useEffect, useState } from 'react';
import type { SessionDetail, SessionSummary } from '../../contracts';
import { useAppActions, useAppState } from '../store';
import { TranscriptView } from './TranscriptView';

export function HistoryModal(): JSX.Element | null {
  const state = useAppState();
  const actions = useAppActions();
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionDetail | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (state.overlay !== 'history') return;
    void (async () => {
      const result = await state.bridge.session.list();
      if (result.ok) setSessions(result.value);
    })();
  }, [state.overlay, state.bridge]);

  if (state.overlay !== 'history') return null;

  const load = async (sessionId: string): Promise<void> => {
    const result = await state.bridge.session.load(sessionId);
    if (result.ok) setSelected(result.value);
    else setMessage(result.error.message);
  };

  const clearOne = async (sessionId: string): Promise<void> => {
    const result = await state.bridge.session.clear(sessionId);
    if (result.ok) {
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      if (selected?.sessionId === sessionId) setSelected(null);
      setMessage('Session deleted.');
    } else {
      setMessage(result.error.message);
    }
  };

  const clearAll = async (): Promise<void> => {
    const first = window.confirm('Delete every stored session? This cannot be undone.');
    if (!first) return;
    const second = window.confirm('Confirm again: all conversation history will be permanently removed.');
    if (!second) return;
    const result = await state.bridge.session.clearAll();
    if (result.ok) {
      setSessions([]);
      setSelected(null);
      setMessage('All sessions deleted.');
    }
  };

  const visible = sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => actions.setOverlay(null)}>
      <div
        className="modal history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Conversation history"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Conversation History</h2>
          <button type="button" className="icon-btn" onClick={() => actions.setOverlay(null)} aria-label="Close">
            &times;
          </button>
        </header>
        <div className="history-toolbar">
          <input
            className="filter-input"
            placeholder="Search titles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search session titles"
          />
          <button type="button" className="btn btn-danger" disabled={sessions.length === 0} onClick={() => void clearAll()}>
            Clear all
          </button>
        </div>
        {message ? <div className="banner banner-info">{message}</div> : null}
        <div className="history-split">
          <ul className="history-list">
            {visible.length === 0 ? (
              <li className="muted">No stored sessions.</li>
            ) : (
              visible.map((session) => (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    className={`history-item ${selected?.sessionId === session.sessionId ? 'selected' : ''}`}
                    onClick={() => void load(session.sessionId)}
                  >
                    <span className="history-title">{session.title}</span>
                    <span className="muted small">{session.entryCount} entries</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Delete session"
                    onClick={() => void clearOne(session.sessionId)}
                  >
                    &times;
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="history-detail">
            {selected ? (
              <TranscriptView
                entries={selected.entries}
                toolCalls={Object.fromEntries(selected.toolCalls.map((t) => [t.toolCallId, t]))}
              />
            ) : (
              <p className="muted">Select a session to preview its transcript.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
