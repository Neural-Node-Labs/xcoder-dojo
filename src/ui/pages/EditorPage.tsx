// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:32:34.015Z | xcoder:subtask code-st-1de5aa
/**
 * P-03 Editor Area (tabbed) with P-03a text pane, P-03b markdown preview and
 * P-03c unopenable-file state.
 *
 * Tabs are ordered by open time and never re-ordered; a truncated read is
 * explicitly read-only so no partial file can be presented as complete (T-06).
 */

import { MarkdownView } from '../components/MarkdownView';
import { SyntaxEditor } from '../components/SyntaxEditor';
import { useAppActions, useAppState } from '../store';

export function EditorPage(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const { tabs, activeTabId, buffers } = state.editor;
  const active = tabs.find((t) => t.tabId === activeTabId) ?? null;
  const value = active ? buffers[active.tabId] ?? '' : '';

  if (tabs.length === 0) {
    return (
      <section className="editor-area editor-empty">
        <div className="empty-state">
          <div className="empty-glyph">&#x3008;/&#x3009;</div>
          <h2>No file open</h2>
          <p className="muted">Pick a file in the Explorer, or ask JARVIS to open one.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="editor-area">
      <div className="tab-strip" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.tabId}
            className={`tab ${tab.tabId === activeTabId ? 'tab-active' : ''}`}
            role="tab"
            aria-selected={tab.tabId === activeTabId}
          >
            <button type="button" className="tab-label" onClick={() => actions.activateTab(tab.tabId)} title={tab.relPath}>
              {tab.relPath.split('/').pop()}
              {tab.dirty ? <span className="dirty-dot" title="unsaved">&#9679;</span> : null}
            </button>
            <button
              type="button"
              className="icon-btn tab-close"
              onClick={() => void actions.closeTab(tab.tabId)}
              aria-label={`Close ${tab.relPath}`}
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {active ? (
        <div className="editor-body">
          <div className="editor-toolbar">
            <span className="breadcrumb">{active.relPath}</span>
            <span className="toolbar-spacer" />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!active.dirty || active.readOnly}
              onClick={() => void actions.saveTab(active.tabId)}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void actions.closeTab(active.tabId)}
            >
              Close
            </button>
          </div>

          {active.truncated ? (
            <div className="banner banner-warn">
              This file exceeded the read cap and is shown truncated. It is read-only so a partial file
              cannot be saved over the original.
            </div>
          ) : null}

          <div className={`editor-split ${active.kind === 'markdown' && state.preview ? 'with-preview' : ''}`}>
            <SyntaxEditor
              tab={active}
              value={value}
              onChange={(next) => actions.editBuffer(active.tabId, next)}
              onSave={() => void actions.saveTab(active.tabId)}
            />
            {active.kind === 'markdown' && state.preview ? (
              <div className="preview-pane">
                <MarkdownView model={state.preview} />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <p className="muted">Select a tab.</p>
        </div>
      )}
    </section>
  );
}
