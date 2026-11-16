// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:28:04.724Z | xcoder:subtask code-st-1de5aa
/**
 * Page models for P-08 settings, P-09 history, P-10 audit, P-11 status bar
 * and P-12 error center.
 */

import type { AppError } from './errors';
import type { AllowlistedToolName, AgentRequestState, RunState, TranscriptEntry, ToolCallRecord } from './models-execution';
import type { SupportedLanguage } from './models-workspace';

/* ---------------------------------------------------------------- settings */

export interface AgentLimits {
  maxTurns: number;
  maxInputChars: number;
  requestCapPerHour: number;
}

export type ThemeName = 'dojo-dark' | 'dojo-hud' | 'dojo-light';

export interface LlmSettingsView {
  modelId: string;
  modelLabel: string;
  provider: string;
  /** The API key itself is never part of any view. */
  hasApiKey: boolean;
  limits: AgentLimits;
  delegationCliLabel: string;
  theme: ThemeName;
  auditRetentionDays: number;
  modelState: 'configured' | 'missing' | 'error';
  maxFileReadBytes: number;
}

export interface LlmSettingsPatch {
  modelId?: string;
  theme?: ThemeName;
  delegationCliLabel?: string;
  auditRetentionDays?: number;
  limits?: Partial<AgentLimits>;
}

export interface ApiKeyInput {
  apiKey: string;
}

export interface SecretState {
  hasApiKey: boolean;
  updatedAtMs: number | null;
}

/* ----------------------------------------------------------------- history */

export interface SessionSummary {
  sessionId: string;
  title: string;
  updatedAtMs: number;
  entryCount: number;
}

export interface SessionDetail {
  sessionId: string;
  title: string;
  entries: readonly TranscriptEntry[];
  toolCalls: readonly ToolCallRecord[];
}

/* ------------------------------------------------------------------- audit */

export type AuditEventType =
  | 'workspace-open'
  | 'workspace-close'
  | 'file-save'
  | 'run-start'
  | 'run-stop'
  | 'agent-request'
  | 'agent-response'
  | 'tool-call'
  | 'tool-refusal'
  | 'delegation-start'
  | 'delegation-stop'
  | 'approval-request'
  | 'approval-decision'
  | 'settings-change'
  | 'secret-set'
  | 'secret-cleared'
  | 'error';

export interface AuditEventView {
  eventId: string;
  atMs: number;
  type: AuditEventType;
  actor: 'user' | 'agent' | 'system';
  targetRelPath?: string;
  toolName?: AllowlistedToolName;
  outcome: 'ok' | 'refused' | 'denied' | 'failed';
  /** Pre-redacted in main: no secrets, no PII, no file bodies. */
  redactedSummary: string;
}

export interface AuditPageRequest {
  cursor?: string;
  limit?: number;
  type?: AuditEventType;
  sinceMs?: number;
}

export interface AuditPage {
  events: readonly AuditEventView[];
  nextCursor: string | null;
  retentionDays: number;
}

export interface AuditLocation {
  logDir: string;
  retentionDays: number;
}

/* ------------------------------------------------------------------ status */

export interface StatusBarModel {
  workspacePathDisplay: string | null;
  run: { state: RunState; label: string };
  agent: { state: AgentRequestState; label: string };
  model: { state: 'configured' | 'missing' | 'error'; label: string };
  audit: { logDir: string; retentionDays: number };
  selection: { relPath: string; language: SupportedLanguage } | null;
}

/* ------------------------------------------------------------ error center */

export interface ErrorToast {
  toastId: string;
  error: AppError;
  atMs: number;
  dismissed: boolean;
}

export interface ErrorCenterModel {
  toasts: readonly ErrorToast[];
  detailOpenFor: string | null;
}
