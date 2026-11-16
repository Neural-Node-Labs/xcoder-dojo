// xcoder:version 3 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:05:43.416Z | xcoder:subtask test-st-bf6f22
/**
 * UI rendering tests.
 *
 * Intent (design T-07, T-10, UI-01, UI-02): assistant text is untrusted and
 * must render as escaped text with a visible AI label; markdown is rendered
 * from the sanitised AST only; errors render the closed code vocabulary; and
 * the hooks refuse to be used outside their provider rather than silently
 * reading a null context.
 *
 * Rendered with react-dom/server so no DOM shim is required - and so any
 * accidental reliance on browser globals surfaces as a test failure.
 */

import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownView } from '../components/MarkdownView';
import { StatusBar } from '../components/StatusBar';
import { ErrorCenter } from '../components/ErrorCenter';
import { ToolCard, outcomeChipClass } from '../components/ToolCard';
import { TranscriptView } from '../pages/TranscriptView';
import { parseMarkdown } from '../../backend/markdown';
import { useAppActions, useAppState, initialExplorer } from '../store';
import type { StatusBarModel, ToolCallRecord, TranscriptEntry, MarkdownPreviewModel } from '../../contracts';

const status: StatusBarModel = {
  workspacePathDisplay: 'C:/projects/dojo',
  run: { state: 'idle', label: 'No run' },
  agent: { state: 'idle', label: 'JARVIS idle' },
  model: { state: 'configured', label: 'Model ready' },
  audit: { logDir: '.xcoder/logs/audit', retentionDays: 30 },
  selection: { relPath: 'src/main.tsx', language: 'typescript' },
};

const toolRecord: ToolCallRecord = {
  toolCallId: 'tool-1',
  toolName: 'read_file',
  argsSummary: { relPath: 'README.md' },
  argsRedacted: false,
  outcome: 'ok',
  durationMs: 12,
  resultSummary: 'README.md (1200 chars, 40 lines): # Xcoder Dojo',
  resultTruncated: false,
};

function entry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    entryId: 'ent-1',
    role: 'assistant',
    origin: 'model',
    text: 'hello',
    atMs: 0,
    streaming: false,
    toolCallIds: [],
    ...overrides,
  };
}

const noop = (): void => undefined;

describe('TranscriptView', () => {
  it('labels model output as AI-generated', () => {
    const html = renderToStaticMarkup(h(TranscriptView, { entries: [entry()], toolCalls: {} }));
    expect(html).toContain('AI-generated');
    expect(html).toContain('JARVIS');
  });

  it('labels workspace data so a reader can tell it apart from model output', () => {
    const html = renderToStaticMarkup(
      h(TranscriptView, { entries: [entry({ origin: 'workspace-data', role: 'system' })], toolCalls: {} }),
    );
    expect(html).toContain('workspace data');
    expect(html).not.toContain('AI-generated');
  });

  it('escapes HTML in assistant text instead of rendering it', () => {
    const html = renderToStaticMarkup(
      h(TranscriptView, { entries: [entry({ text: '<img src=x onerror=alert(1)>' })], toolCalls: {} }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('shows a streaming hint while an entry is in flight', () => {
    const html = renderToStaticMarkup(h(TranscriptView, { entries: [entry({ streaming: true })], toolCalls: {} }));
    expect(html).toContain('streaming');
  });

  it('renders a tool card only from the backend record', () => {
    const html = renderToStaticMarkup(
      h(TranscriptView, { entries: [entry({ toolCallIds: ['tool-1'] })], toolCalls: { 'tool-1': toolRecord } }),
    );
    expect(html).toContain('tool-card');
    expect(html).toContain('read_file');
  });

  it('renders an empty hint when there are no entries', () => {
    const html = renderToStaticMarkup(h(TranscriptView, { entries: [], toolCalls: {} }));
    expect(html).toContain('allowlisted');
  });

  it('renders a rejection notice from a refusal', () => {
    const html = renderToStaticMarkup(
      h(TranscriptView, {
        entries: [entry({ rejectionNotice: { code: 'turn-limit', message: 'Turn limit reached.' } })],
        toolCalls: {},
      }),
    );
    expect(html).toContain('turn-limit');
    expect(html).toContain('Turn limit reached.');
  });
});

describe('MarkdownView', () => {
  it('renders headings, code and links from the AST', () => {
    const model = parseMarkdown('x.md', '# Title\n\n`code` [docs](https://example.com)\n');
    const html = renderToStaticMarkup(h(MarkdownView, { model }));
    expect(html).toContain('<h1');
    expect(html).toContain('<code');
    expect(html).toContain('External link');
    expect(html).toContain('noopener noreferrer');
  });

  it('never emits raw HTML or an img tag', () => {
    const model = parseMarkdown('x.md', '<div class="injected">x</div>\n\n![a](https://evil/p.png)\n');
    const html = renderToStaticMarkup(h(MarkdownView, { model }));
    expect(html).not.toContain('class="injected"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('image blocked');
  });

  it('neutralises a javascript: link instead of emitting an executable href', () => {
    const model = parseMarkdown('x.md', 'click [me](javascript:alert(1))\n');
    const html = renderToStaticMarkup(h(MarkdownView, { model }));
    expect(html).not.toContain('javascript:');
    expect(html).toContain('me');
  });

  it('discloses how many HTML blocks and images were stripped', () => {
    const model: MarkdownPreviewModel = { relPath: 'x.md', blocks: [], blockedImages: 2, strippedHtmlBlocks: 3 };
    const html = renderToStaticMarkup(h(MarkdownView, { model }));
    expect(html).toContain('2 image(s) blocked');
    expect(html).toContain('3 HTML block(s) stripped');
    expect(html).toContain('raw HTML is never rendered');
  });
});

describe('StatusBar', () => {
  it('shows the workspace path, run, agent, model and audit retention', () => {
    const html = renderToStaticMarkup(
      h(StatusBar, { status, onOpenAudit: noop, onOpenSettings: noop, onFocusRun: noop, onFocusAgent: noop }),
    );
    expect(html).toContain('C:/projects/dojo');
    expect(html).toContain('src/main.tsx');
    expect(html).toContain('JARVIS');
    expect(html).toContain('Model ready');
    expect(html).toContain('30d retention');
    expect(html).toContain('.xcoder/logs/audit');
  });

  it('degrades to a no-workspace footer without any status model', () => {
    const html = renderToStaticMarkup(
      h(StatusBar, { status: null, onOpenAudit: noop, onOpenSettings: noop, onFocusRun: noop, onFocusAgent: noop }),
    );
    expect(html).toContain('no workspace');
  });

  it('colours busy states differently from failures', () => {
    const html = renderToStaticMarkup(
      h(StatusBar, {
        status: { ...status, agent: { state: 'thinking', label: 'JARVIS thinking' } },
        onOpenAudit: noop,
        onOpenSettings: noop,
        onFocusRun: noop,
        onFocusAgent: noop,
      }),
    );
    expect(html).toContain('badge-busy');
  });
});

describe('ErrorCenter', () => {
  it('renders nothing when there are no toasts', () => {
    expect(renderToStaticMarkup(h(ErrorCenter, { toasts: [], onDismiss: noop }))).toBe('');
  });

  it('renders the closed error code and redacted message as escaped text', () => {
    const html = renderToStaticMarkup(
      h(ErrorCenter, {
        toasts: [
          {
            toastId: 't1',
            error: { code: 'path-escape', message: 'Refused <script>alert(1)</script>' },
            atMs: 0,
            dismissed: false,
          },
        ],
        onDismiss: noop,
      }),
    );
    expect(html).toContain('path-escape');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('role="alert"');
  });
});

describe('ToolCard', () => {
  it('maps outcomes to chip classes', () => {
    expect(outcomeChipClass('ok')).toContain('chip-ok');
    expect(outcomeChipClass('pending')).toContain('chip-busy');
    expect(outcomeChipClass('refused-credential')).toContain('chip-bad');
    expect(outcomeChipClass('denied-allowlist')).toContain('chip-bad');
    expect(outcomeChipClass('schema-invalid')).toContain('chip-warn');
  });

  it('shows the tool name, outcome and duration from the record', () => {
    const html = renderToStaticMarkup(h(ToolCard, { record: toolRecord }));
    expect(html).toContain('read_file');
    expect(html).toContain('ok');
    expect(html).toContain('12ms');
  });
});

describe('renderer store hooks', () => {
  function Probe(): JSX.Element {
    const state = useAppState();
    return h('span', null, state.workspace?.rootLabel ?? 'none');
  }

  function ActionsProbe(): JSX.Element {
    const actions = useAppActions();
    return h('span', null, typeof actions.openWorkspace);
  }

  it('refuse to read state outside the provider', () => {
    expect(() => renderToStaticMarkup(h(Probe))).toThrow(/AppProvider/);
  });

  it('refuse to read actions outside the provider', () => {
    expect(() => renderToStaticMarkup(h(ActionsProbe))).toThrow(/AppProvider/);
  });

  it('expose an empty initial explorer model', () => {
    expect(initialExplorer.nodesByParent).toEqual({});
    expect(initialExplorer.expandedRelPaths).toEqual([]);
    expect(initialExplorer.filterText).toBe('');
  });
});
