// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:48.671Z | xcoder:subtask code-st-1de5aa
/**
 * P-00 App Shell.
 *
 * Persistent chrome: title bar, left dock (Explorer), center (Welcome or
 * Editor), bottom dock (Run Console), right dock (Agent or Delegation), status
 * bar, plus the overlay slot and the approval gate. Workspace, run and agent
 * state survive navigation because overlays never unmount the shell (T-09).
 */

import { useState } from 'react';
import { useAppActions, useAppState } from './store';
import { Explorer } from './components/Explorer';
import { StatusBar } from './components/StatusBar';
import { ErrorCenter } from './components/ErrorCenter';
import { WelcomePage } from './pages/WelcomePage';
import { EditorPage } from './pages/EditorPage';
import { RunConsolePage } from './pages/RunConsolePage';
import { AgentPanel } from './pages/AgentPanel';
import { DelegationPage } from './pages/DelegationPage';
import { ApprovalSheet } from './pages/ApprovalSheet';
import { SettingsModal } from './pages/SettingsModal';
import { HistoryModal } from './pages/HistoryModal';
import { AuditModal } from './pages/AuditModal';

export function App(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [rightDock, setRightDock] = useState<'agent' | 'delegation'>('agent');
  const themeClass = `theme-${state.settings?.theme ?? 'dojo-dark'}`;
  const delegationActive = state.delegation !== null;
  const showDelegation = rightDock === 'delegation' && delegationActive;

  return (
    <div className={`app-shell ${themeClass}`}>
      <header className="title-bar">
        <span className="brand">Xcoder&nbsp;Dojo</span>
        <span className="title-sep">/</span>
        <span className="title-path" title={state.workspace?.rootDisplayPath ?? undefined}>
          {state.workspace?.rootDisplayPath ?? 'no workspace'}
        </span>
        <span className="title-spacer" />
        {delegationActive ? (
          <span className="dock-switch">
            <button
              type="button"
              className={`chip chip-btn ${rightDock === 'agent' ? 'chip-active' : ''}`}
              onClick={() => setRightDock('agent')}
            >
              JARVIS
            </button>
            <button
              type="button"
              className={`chip chip-btn ${rightDock === 'delegation' ? 'chip-active' : ''}`}
              onClick={() => setRightDock('delegation')}
            >
              Delegation
            </button>
          </span>
        ) : null}
        <button type="button" className="icon-btn" title="Audit log" onClick={() => actions.setOverlay('audit')}>
          &#128220;
        </button>
        <button type="button" className="icon-btn" title="Settings" onClick={() => actions.setOverlay('settings')}>
          &#9881;
        </button>
        {state.workspace ? (
          <button type="button" className="btn btn-ghost" onClick={() => void actions.closeWorkspace()}>
            Close workspace
          </button>
        ) : null}
      </header>

      <div className="shell-body">
        {state.workspace ? <Explorer /> : null}

        <main className="center-column">
          {state.workspace ? <EditorPage /> : <WelcomePage />}
        </main>

        {state.workspace ? (
          showDelegation ? (
            <DelegationPage />
          ) : (
            <AgentPanel />
          )
        ) : null}
      </div>

      {state.workspace ? <RunConsolePage /> : null}

      <StatusBar
        status={state.status}
        onOpenAudit={() => actions.setOverlay('audit')}
        onOpenSettings={() => actions.setOverlay('settings')}
        onFocusRun={() => undefined}
        onFocusAgent={() => setRightDock('agent')}
      />

      <ErrorCenter toasts={state.toasts} onDismiss={actions.dismissToast} />

      {state.overlay === 'settings' ? <SettingsModal /> : null}
      {state.overlay === 'history' ? <HistoryModal /> : null}
      {state.overlay === 'audit' ? <AuditModal /> : null}
      {state.approval ? <ApprovalSheet request={state.approval} /> : null}
    </div>
  );
}
