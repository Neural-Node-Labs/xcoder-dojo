// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:03:28.493Z | xcoder:subtask test-st-bf6f22
/**
 * Audit log tests.
 *
 * Intent (design P-10, S-11, CORE-08): the log is append-only, redacted at
 * write time (not read time), and bounded by a retention window. A secret must
 * never be recoverable from the log - including through paging or filtering.
 */

import { describe, expect, it } from 'vitest';
import { AuditLog, redact } from '../audit';
import type { AuditAppend } from '../audit';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function entry(overrides: Partial<AuditAppend> = {}): AuditAppend {
  return {
    type: 'file-save',
    actor: 'user',
    outcome: 'ok',
    redactedSummary: 'Saved src/a.ts',
    ...overrides,
  };
}

describe('redact', () => {
  it.each([
    'using key sk-abcdefghijklmnop',
    'Authorization: Bearer abcdefghijklmnop',
    'api_key=supersecretvalue',
    'apikey: supersecretvalue',
    'token=abc123def456',
    'password=hunter2hunter2',
  ])('removes the secret-shaped fragment in %j', (text) => {
    const out = redact(text);
    expect(out).toContain('[redacted]');
    expect(out).not.toMatch(/sk-abcdefghijklmnop|abcdefghijklmnop|supersecretvalue|abc123def456|hunter2hunter2/);
  });

  it('leaves ordinary sentences untouched', () => {
    const text = 'Saved src/app.ts and started typecheck';
    expect(redact(text)).toBe(text);
  });

  it('redacts every occurrence, not just the first', () => {
    const out = redact('sk-aaaaaaaa then sk-bbbbbbbb');
    expect(out.match(/\[redacted\]/g)).toHaveLength(2);
  });
});

describe('AuditLog.append', () => {
  it('assigns sequential ids and records the timestamp', () => {
    const log = new AuditLog(30);
    const first = log.append(entry(), NOW);
    const second = log.append(entry({ type: 'run-start' }), NOW + 1);
    expect(first.eventId).toBe('evt-1');
    expect(second.eventId).toBe('evt-2');
    expect(second.atMs).toBe(NOW + 1);
  });

  it('redacts the summary before storing it', () => {
    const log = new AuditLog(30);
    log.append(entry({ redactedSummary: 'set key sk-abcdefghijklmnop' }), NOW);
    expect(log.all()[0].redactedSummary).toBe('set key [redacted]');
  });

  it('carries optional target and tool fields only when provided', () => {
    const log = new AuditLog(30);
    const bare = log.append(entry(), NOW);
    const rich = log.append(entry({ targetRelPath: 'src/a.ts', toolName: 'read_file' }), NOW);
    expect(bare).not.toHaveProperty('targetRelPath');
    expect(bare).not.toHaveProperty('toolName');
    expect(rich.targetRelPath).toBe('src/a.ts');
    expect(rich.toolName).toBe('read_file');
  });

  it('drops events older than the retention window on append', () => {
    const log = new AuditLog(30);
    log.append(entry(), NOW - 31 * DAY);
    log.append(entry(), NOW);
    expect(log.all()).toHaveLength(1);
    expect(log.all()[0].atMs).toBe(NOW);
  });
});

describe('AuditLog.page', () => {
  it('returns newest first', () => {
    const log = new AuditLog(30);
    log.append(entry({ redactedSummary: 'one' }), NOW);
    log.append(entry({ redactedSummary: 'two' }), NOW + 1);
    const page = log.page({});
    expect(page.events.map((e) => e.redactedSummary)).toEqual(['two', 'one']);
  });

  it('paginates with a cursor and reports the retention window', () => {
    const log = new AuditLog(7);
    for (let i = 0; i < 5; i += 1) log.append(entry({ redactedSummary: `e${i}` }), NOW + i);
    const first = log.page({ limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).toBe('2');
    expect(first.retentionDays).toBe(7);
    const second = log.page({ limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.events.map((e) => e.redactedSummary)).toEqual(['e2', 'e1']);
  });

  it('bounds the page size so a caller cannot ask for everything', () => {
    const log = new AuditLog(30);
    for (let i = 0; i < 10; i += 1) log.append(entry(), NOW + i);
    expect(log.page({ limit: 10_000 }).events).toHaveLength(10);
    expect(log.page({ limit: 0 }).events.length).toBe(1);
  });

  it('filters by event type', () => {
    const log = new AuditLog(30);
    log.append(entry({ type: 'run-start' }), NOW);
    log.append(entry({ type: 'file-save' }), NOW + 1);
    expect(log.page({ type: 'run-start' }).events).toHaveLength(1);
  });

  it('filters by sinceMs', () => {
    const log = new AuditLog(30);
    log.append(entry({ redactedSummary: 'old' }), NOW);
    log.append(entry({ redactedSummary: 'new' }), NOW + 1_000);
    const page = log.page({ sinceMs: NOW + 500 });
    expect(page.events.map((e) => e.redactedSummary)).toEqual(['new']);
  });
});
