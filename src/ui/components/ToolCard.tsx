// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:07.764Z | xcoder:subtask code-st-1de5aa
/**
 * P-05a Tool Call Card.
 *
 * One row per backend-recorded tool call. The card is built from the
 * ToolCallRecord only - it is never parsed out of model text, so a prompt
 * injection cannot forge a card or an executable control (design T-10).
 */

import { useState } from 'react';
import type { ToolCallOutcome, ToolCallRecord } from '../../contracts';

export function outcomeChipClass(outcome: ToolCallOutcome): string {
  if (outcome === 'ok') return 'chip chip-ok';
  if (outcome === 'pending') return 'chip chip-busy';
  if (outcome.startsWith('refused') || outcome.startsWith('denied')) return 'chip chip-bad';
  return 'chip chip-warn';
}

export function ToolCard({ record }: { record: ToolCallRecord }): JSX.Element {
  const [open, setOpen] = useState(false);
  const args = Object.entries(record.argsSummary)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');

  return (
    <div className={`tool-card tool-${record.outcome}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((prev) => !prev)}>
        <span className="tool-name">{record.toolName}</span>
        <span className={outcomeChipClass(record.outcome)}>{record.outcome}</span>
        {record.durationMs !== null ? <span className="muted small">{record.durationMs}ms</span> : null}
        <span className="tool-caret">{open ? '\u25be' : '\u25b8'}</span>
      </button>
      {open ? (
        <div className="tool-body">
          <div className="tool-args">
            <span className="muted small">args{record.argsRedacted ? ' (redacted)' : ''}</span>
            <code>{args || '(none)'}</code>
          </div>
          {record.resultSummary ? (
            <div className="tool-result">
              <span className="muted small">result{record.resultTruncated ? ' (truncated)' : ''}</span>
              <p>{record.resultSummary}</p>
            </div>
          ) : null}
        </div>
      ) : record.resultSummary ? (
        <div className="tool-summary">{record.resultSummary}</div>
      ) : null}
    </div>
  );
}
