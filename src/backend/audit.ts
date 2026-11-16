// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:29:09.232Z | xcoder:subtask code-st-1de5aa
/**
 * Append-only, redacted audit log (design P-10, S-11, CORE-08).
 *
 * Summaries are redacted at write time, not read time, so un-redacted content
 * never exists in the store to leak later.
 */

import type { AuditEventType, AuditEventView, AuditPage, AuditPageRequest } from '../contracts';

const SECRET_SHAPED = /(sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_-]?key|token|password)\s*[=:]\s*\S+)/gi;

export function redact(text: string): string {
  return text.replace(SECRET_SHAPED, '[redacted]');
}

export interface AuditAppend {
  type: AuditEventType;
  actor: 'user' | 'agent' | 'system';
  outcome: 'ok' | 'refused' | 'denied' | 'failed';
  redactedSummary: string;
  targetRelPath?: string;
  toolName?: AuditEventView['toolName'];
}

export class AuditLog {
  private readonly events: AuditEventView[] = [];
  private seq = 0;
  readonly retentionDays: number;

  constructor(retentionDays: number) {
    this.retentionDays = retentionDays;
  }

  append(entry: AuditAppend, nowMs: number): AuditEventView {
    this.seq += 1;
    const view: AuditEventView = {
      eventId: `evt-${this.seq.toString(36)}`,
      atMs: nowMs,
      type: entry.type,
      actor: entry.actor,
      outcome: entry.outcome,
      redactedSummary: redact(entry.redactedSummary),
    };
    if (entry.targetRelPath) view.targetRelPath = entry.targetRelPath;
    if (entry.toolName) view.toolName = entry.toolName;
    this.events.push(view);

    // Retention cap: drop anything older than the window.
    const cutoff = nowMs - this.retentionDays * 86_400_000;
    while (this.events.length > 0 && this.events[0].atMs < cutoff) {
      this.events.shift();
    }
    return view;
  }

  page(request: AuditPageRequest): AuditPage {
    const limit = Math.min(Math.max(request.limit ?? 40, 1), 200);
    const offset = request.cursor ? Number.parseInt(request.cursor, 10) || 0 : 0;
    const filtered = this.events
      .filter((e) => (request.type ? e.type === request.type : true))
      .filter((e) => (request.sinceMs ? e.atMs >= request.sinceMs : true))
      .slice()
      .reverse();
    const slice = filtered.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return {
      events: slice,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
      retentionDays: this.retentionDays,
    };
  }

  all(): readonly AuditEventView[] {
    return this.events;
  }
}
