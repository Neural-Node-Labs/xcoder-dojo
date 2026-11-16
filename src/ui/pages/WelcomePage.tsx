// xcoder:version 4 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:32:28.280Z | xcoder:subtask code-st-1de5aa
/**
 * P-01 Welcome / No-Workspace.
 *
 * There is deliberately no free-text path field: the workspace is chosen via a
 * picker and re-validated by the backend (design T-04). The demo offers the
 * recents plus a "open demo workspace" action, which is what the picker would
 * return.
 */

import { useAppActions, useAppState } from '../store';

const DEMO_WORKSPACES = [
  '.\\xcoder-dojo-demo',
  'D:\\projects\\dojo-sandbox',
];

export function WelcomePage(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  return (
    <div className="welcome-page">
      <div className="welcome-card">
        <h1 className="welcome-title">Xcoder Dojo</h1>
        <p className="welcome-sub">A TypeScript IDE with an embedded agent. Open a workspace to begin.</p>

        <div className="welcome-actions">
          {DEMO_WORKSPACES.map((path) => (
            <button
              key={path}
              type="button"
              className="btn btn-primary"
              disabled={state.busy}
              onClick={() => void actions.openWorkspace(path)}
            >
              Choose folder&hellip; <span className="muted">{path.split(/[\\/]/).pop()}</span>
            </button>
          ))}
          <p className="muted small">
            The folder is chosen through the OS picker and re-validated by the backend. There is no
            free-text path field.
          </p>
        </div>

        <section className="recents">
          <h2>Recent workspaces</h2>
          {state.recents.length === 0 ? (
            <p className="muted">No recent workspaces yet.</p>
          ) : (
            <ul className="recent-list">
              {state.recents.map((recent) => (
                <li key={recent.rootDisplayPath}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void actions.openWorkspace(recent.rootDisplayPath)}
                  >
                    <strong>{recent.label}</strong>
                    <span className="muted">{recent.rootDisplayPath}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="model-state">
          <h2>Model</h2>
          {state.settings ? (
            state.settings.modelState === 'configured' ? (
              <p className="ok">{state.settings.modelLabel} &mdash; API key configured</p>
            ) : (
              <p className="warn">Model not configured. Set an API key in Settings before chatting.</p>
            )
          ) : (
            <p className="muted">Loading settings&hellip;</p>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => actions.setOverlay('settings')}>
            Open settings
          </button>
        </section>
      </div>
    </div>
  );
}
