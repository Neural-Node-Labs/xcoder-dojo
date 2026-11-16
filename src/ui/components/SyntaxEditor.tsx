// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:31:27.362Z | xcoder:subtask code-st-1de5aa
/**
 * P-03a Text editor pane.
 *
 * A dependency-free editor: a line-number gutter plus a textarea whose text is
 * tokenized for display. Highlighting is cosmetic; correctness (encoding/EOL
 * fidelity, truncation, read-only) is surfaced around it.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { EditorTabState } from '../../contracts';

const KEYWORDS = new Set([
  'import', 'export', 'from', 'const', 'let', 'var', 'function', 'class', 'interface',
  'type', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue',
  'new', 'await', 'async', 'default', 'extends', 'implements', 'public', 'private',
  'readonly', 'true', 'false', 'null', 'undefined', 'throw', 'try', 'catch', 'finally',
  'as', 'in', 'of', 'typeof', 'instanceof', 'this', 'super', 'void', 'enum', 'declare',
  'def', 'self', 'None', 'True', 'False', 'elif', 'lambda', 'with', 'yield',
]);

interface Token {
  text: string;
  cls: string;
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|\s+|[^\sA-Za-z0-9_$])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const text = m[0];
    let cls = '';
    if (/^(\/\/|#|\/\*)/.test(text)) cls = 'tok-comment';
    else if (/^["'`]/.test(text)) cls = 'tok-string';
    else if (/^\d/.test(text)) cls = 'tok-number';
    else if (KEYWORDS.has(text)) cls = 'tok-keyword';
    else if (/^[A-Z]/.test(text)) cls = 'tok-type';
    else if (/^(function|class)$/.test(tokens[tokens.length - 1]?.text ?? '')) cls = 'tok-type';
    tokens.push({ text, cls });
  }
  return tokens;
}

function Line({ text, index }: { text: string; index: number }): JSX.Element {
  const tokens = useMemo(() => tokenizeLine(text), [text]);
  return (
    <div className="code-line">
      <span className="gutter-num">{index + 1}</span>
      <span className="code-content">
        {tokens.length === 0 ? '\u00a0' : tokens.map((t, i) => (t.cls ? <span key={i} className={t.cls}>{t.text}</span> : <span key={i}>{t.text}</span>))}
      </span>
    </div>
  );
}

export interface SyntaxEditorProps {
  tab: EditorTabState;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function SyntaxEditor({ tab, value, onChange, onSave }: SyntaxEditorProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lines = useMemo(() => value.split('\n'), [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave]);

  return (
    <div className="syntax-editor">
      <div className="editor-meta">
        <span className="chip">{tab.language}</span>
        <span className="chip">{tab.encoding}</span>
        <span className="chip">{tab.eol.toUpperCase()}</span>
        {tab.readOnly ? <span className="chip chip-warn">read-only: truncated read</span> : null}
        {tab.dirty ? <span className="chip chip-dirty">unsaved</span> : null}
      </div>
      <div className="editor-pane" ref={scrollRef}>
        <div className="code-lines" aria-hidden="true">
          {lines.map((line, index) => (
            <Line key={index} text={line} index={index} />
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          value={value}
          readOnly={tab.readOnly}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Editor for ${tab.relPath}`}
        />
      </div>
    </div>
  );
}
