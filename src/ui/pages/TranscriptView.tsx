// xcoder:version 2 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:09.560Z | xcoder:subtask code-st-1de5aa
/**
 * The transcript list. Append-only: completed entries are immutable (T-08).
 * Every entry renders its untrusted origin so a reader can tell model output
 * from workspace data.
 */

import type { ToolCallRecord, TranscriptEntry } from '../../contracts';
import { ToolCard } from '../components/ToolCard';

export interface TranscriptViewProps {
  entries: readonly TranscriptEntry[];
  toolCalls: Record<string, ToolCallRecord>;
  emptyHint?: string;
}

function EntryView({ entry, toolCalls }: { entry: TranscriptEntry; toolCalls: Record<string, ToolCallRecord> }): JSX.Element {
  const isModel = entry.origin === 'model';
  return (
    <div className={`entry entry-${entry.role}`}>
      <div className="entry-head">
        <span className="entry-role">{entry.role === 'user' ? 'You' : entry.role === 'assistant' ? 'JARVIS' : 'System'}</span>
        {isModel ? (
          <span className="chip chip-ai" title="Model-generated; escaped, not trusted">
            AI-generated
          </span>
        ) : null}
        {entry.origin === 'workspace-data' ? <span className="chip chip-workspace">workspace data</span> : null}
        {entry.streaming ? <span className="muted small">streaming&hellip;</span> : null}
      </div>
      <div className="entry-text">{entry.text}</div>
      {entry.rejectionNotice ? (
        <div className="banner banner-warn">
          <code>{entry.rejectionNotice.code}</code> {entry.rejectionNotice.message}
        </div>
      ) : null}
      {entry.toolCallIds.length > 0 ? (
        <div className="tool-cards">
          {entry.toolCallIds.map((id) => (toolCalls[id] ? <ToolCard key={id} record={toolCalls[id]} /> : null))}
        </div>
      ) : null}
    </div>
  );
}

export function TranscriptView({ entries, toolCalls, emptyHint }: TranscriptViewProps): JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="empty-state inline">
        <p className="muted">
          {emptyHint ??
            'Ask JARVIS to list files, open a file, outline a module, search the workspace, or report git state. It can only use the 11 allowlisted read tools.'}
        </p>
      </div>
    );
  }
  return (
    <>
      {entries.map((entry) => (
        <EntryView key={entry.entryId} entry={entry} toolCalls={toolCalls} />
      ))}
    </>
  );
}
