// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:29:14.386Z | xcoder:subtask code-st-1de5aa
/**
 * Backend-owned mutable state.
 *
 * The secret is held here and there is deliberately no getter that returns it:
 * `secretState()` yields only booleans and timestamps.
 */

import type {
  AgentLimits,
  ApprovalRequest,
  LlmSettingsView,
  RecentWorkspace,
  SessionSummary,
  ThemeName,
  ToolCallRecord,
  TranscriptEntry,
} from '../contracts';

export const DEFAULT_LIMITS: AgentLimits = {
  maxTurns: 5,
  maxInputChars: 4_000,
  requestCapPerHour: 40,
};

const ALLOWED_THEMES: readonly ThemeName[] = ['dojo-dark', 'dojo-hud', 'dojo-light'];
export { ALLOWED_THEMES };

export interface SessionRecord {
  sessionId: string;
  title: string;
  updatedAtMs: number;
  entries: TranscriptEntry[];
  toolCalls: ToolCallRecord[];
}

export class Store {
  modelId = 'dojo-local-7b';
  provider = 'local-stub';
  theme: ThemeName = 'dojo-dark';
  delegationCliLabel = 'xcoder-agent-cli';
  auditRetentionDays = 30;
  limits: AgentLimits = { ...DEFAULT_LIMITS };
  maxFileReadBytes = 200_000;

  private apiKey: string | null = null;
  private apiKeyUpdatedAtMs: number | null = null;

  readonly recents: RecentWorkspace[] = [];
  readonly sessions = new Map<string, SessionRecord>();
  readonly approvals = new Map<string, ApprovalRequest>();
  readonly resolvedApprovals = new Map<string, 'approved' | 'denied' | 'expired'>();

  hasApiKey(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  secretState(): { hasApiKey: boolean; updatedAtMs: number | null } {
    return { hasApiKey: this.hasApiKey(), updatedAtMs: this.apiKeyUpdatedAtMs };
  }

  /** Accepts a key; never returns it. */
  setApiKey(key: string, nowMs: number): void {
    this.apiKey = key;
    this.apiKeyUpdatedAtMs = nowMs;
  }

  clearApiKey(nowMs: number): void {
    this.apiKey = null;
    this.apiKeyUpdatedAtMs = nowMs;
  }

  modelState(): 'configured' | 'missing' | 'error' {
    return this.hasApiKey() ? 'configured' : 'missing';
  }

  view(): LlmSettingsView {
    return {
      modelId: this.modelId,
      modelLabel: `${this.provider} / ${this.modelId}`,
      provider: this.provider,
      hasApiKey: this.hasApiKey(),
      limits: { ...this.limits },
      delegationCliLabel: this.delegationCliLabel,
      theme: this.theme,
      auditRetentionDays: this.auditRetentionDays,
      modelState: this.modelState(),
      maxFileReadBytes: this.maxFileReadBytes,
    };
  }

  rememberRecent(rootDisplayPath: string, label: string, nowMs: number): void {
    const idx = this.recents.findIndex((r) => r.rootDisplayPath === rootDisplayPath);
    if (idx >= 0) this.recents.splice(idx, 1);
    this.recents.unshift({ rootDisplayPath, label, lastOpenedAtMs: nowMs });
    if (this.recents.length > 10) this.recents.length = 10;
  }

  sessionSummaries(): SessionSummary[] {
    return [...this.sessions.values()]
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        updatedAtMs: s.updatedAtMs,
        entryCount: s.entries.length,
      }))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  ensureSession(sessionId: string, nowMs: number): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const record: SessionRecord = {
      sessionId,
      title: 'New session',
      updatedAtMs: nowMs,
      entries: [],
      toolCalls: [],
    };
    this.sessions.set(sessionId, record);
    return record;
  }
}
