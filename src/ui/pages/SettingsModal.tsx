// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:29.339Z | xcoder:subtask code-st-1de5aa
/**
 * P-08 Settings, tabbed into P-08a Model & Limits, P-08b Data/Secrets/Audit
 * and P-08c Appearance.
 *
 * The API key input is write-only: it is sent once and the view only ever
 * reports `hasApiKey`. There is no control anywhere that reveals the key.
 */

import { useEffect, useState } from 'react';
import type { ThemeName } from '../../contracts';
import { useAppActions, useAppState } from '../store';

type Tab = 'model' | 'data' | 'appearance';

export function SettingsModal(): JSX.Element | null {
  const state = useAppState();
  const actions = useAppActions();
  const [tab, setTab] = useState<Tab>('model');
  const [keyDraft, setKeyDraft] = useState('');

  const settings = state.settings;
  const overlay = state.overlay;

  useEffect(() => {
    if (overlay !== 'settings') setKeyDraft('');
  }, [overlay]);

  if (overlay !== 'settings' || !settings) return null;

  const close = (): void => actions.setOverlay(null);

  return (
    <div className="modal-backdrop" role="presentation" onClick={close}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close settings">
            &times;
          </button>
        </header>

        <nav className="tab-strip modal-tabs">
          {([
            ['model', 'Model & Limits'],
            ['data', 'Data, Secrets & Audit'],
            ['appearance', 'Appearance'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tab ${tab === id ? 'tab-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'model' ? (
          <section className="settings-body">
            <div className="field">
              <label htmlFor="model-id">Model</label>
              <div className="field-value">
                <code>{settings.modelLabel}</code>
                <span className={`badge ${settings.modelState === 'configured' ? 'badge-ok' : 'badge-bad'}`}>
                  {settings.modelState}
                </span>
              </div>
            </div>
            <div className="field">
              <label>Turn budget</label>
              <input
                type="number"
                min={1}
                max={20}
                value={settings.limits.maxTurns}
                onChange={(e) => void actions.patchSettings({ limits: { maxTurns: Number(e.target.value) } })}
              />
              <span className="muted small">Maximum tool turns per request.</span>
            </div>
            <div className="field">
              <label>Max input characters</label>
              <input
                type="number"
                min={200}
                max={20000}
                step={100}
                value={settings.limits.maxInputChars}
                onChange={(e) => void actions.patchSettings({ limits: { maxInputChars: Number(e.target.value) } })}
              />
              <span className="muted small">Disclosed to the user, not silently truncated.</span>
            </div>
            <div className="field">
              <label>Requests per hour</label>
              <input
                type="number"
                min={1}
                max={500}
                value={settings.limits.requestCapPerHour}
                onChange={(e) => void actions.patchSettings({ limits: { requestCapPerHour: Number(e.target.value) } })}
              />
              <span className="muted small">Per-user request quota.</span>
            </div>
          </section>
        ) : null}

        {tab === 'data' ? (
          <section className="settings-body">
            <div className="field">
              <label>API key</label>
              <div className="field-value">
                <span className={`badge ${settings.hasApiKey ? 'badge-ok' : 'badge-idle'}`}>
                  {settings.hasApiKey ? 'configured' : 'not set'}
                </span>
                <span className="muted small">The key is write-only; it is never displayed back.</span>
              </div>
              <div className="key-row">
                <input
                  type="password"
                  value={keyDraft}
                  autoComplete="off"
                  placeholder="Paste a new API key"
                  onChange={(e) => setKeyDraft(e.target.value)}
                  aria-label="API key"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={keyDraft.trim().length < 8}
                  onClick={() => {
                    void actions.setApiKey(keyDraft.trim());
                    setKeyDraft('');
                  }}
                >
                  Save key
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!settings.hasApiKey}
                  onClick={() => void actions.clearApiKey()}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="field">
              <label>Audit retention</label>
              <input
                type="number"
                min={1}
                max={365}
                value={settings.auditRetentionDays}
                onChange={(e) => void actions.patchSettings({ auditRetentionDays: Number(e.target.value) })}
              />
              <span className="muted small">Days. Logs are appended in redacted form only.</span>
            </div>
            <div className="field">
              <label>Delegation CLI</label>
              <input
                type="text"
                value={settings.delegationCliLabel}
                onChange={(e) => void actions.patchSettings({ delegationCliLabel: e.target.value })}
              />
              <span className="muted small">Launching it always requires approval.</span>
            </div>
          </section>
        ) : null}

        {tab === 'appearance' ? (
          <section className="settings-body">
            <div className="field">
              <label>Theme</label>
              <div className="theme-row">
                {(['dojo-dark', 'dojo-hud', 'dojo-light'] as ThemeName[]).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    className={`btn ${settings.theme === theme ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => void actions.patchSettings({ theme })}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            </div>
            <p className="muted small">Theme changes apply immediately and are persisted in settings.</p>
          </section>
        ) : null}

        <footer className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={close}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
