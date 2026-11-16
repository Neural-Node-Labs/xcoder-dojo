// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:27:54.975Z | xcoder:subtask code-st-1de5aa
/**
 * Page models for execution surfaces: P-04 run console and P-05 agent panel.
 */

import type { AppError, AppErrorCode } from './errors';

/* -------------------------------------------------------------- run console */

export type RunState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'rejected-busy';

export interface CommandSpec {
  targetId: string;
  label: string;
  description: string;
  argv: readonly string[];
  envKeys: readonly string[];
  /** True when the demo executor synthesises output instead of spawning. */
  simulated: boolean;
}

export interface RunStartRequest {
  targetId: string;
}

export interface ConsoleChunk {
  chunkId: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  atMs: number;
}

export interface RunSession {
  runId: string;
  targetId: string;
  label: string;
  argv: readonly string[];
  state: RunState;
  simulated: boolean;
  startedAtMs: number;
  endedAtMs: number | null;
  exitCode: number | null;
  chunks: readonly ConsoleChunk[];
}

export type RunEvent =
  | { type: 'run-started'; session: RunSession }
  | { type: 'run-chunk'; runId: string; chunk: ConsoleChunk }
  | { type: 'run-ended'; runId: string; state: RunState; exitCode: number | null };

/* ------------------------------------------------------------------- agent */

export type AgentRequestState =
  | 'idle'
  | 'thinking'
  | 'awaiting-tool'
  | 'answering'
  | 'stopping'
  | 'done'
  | 'stopped'
  | 'turn-limit'
  | 'request-cap'
  | 'failed';

export type AllowlistedToolName =
  | 'list_dir'
  | 'glob'
  | 'grep'
  | 'read_file'
  | 'read_multiple_files'
  | 'read_file_lines'
  | 'read_outline'
  | 'validate_file'
  | 'git_status'
  | 'git_diff'
  | 'git_log';

export const ALLOWLISTED_TOOLS: readonly AllowlistedToolName[] = [
  'list_dir',
  'glob',
  'grep',
  'read_file',
  'read_multiple_files',
  'read_file_lines',
  'read_outline',
  'validate_file',
  'git_status',
  'git_diff',
  'git_log',
];

export function isAllowlistedTool(name: unknown): name is AllowlistedToolName {
  return typeof name === 'string' && (ALLOWLISTED_TOOLS as readonly string[]).includes(name);
}

export type ToolCallOutcome =
  | 'pending'
  | 'ok'
  | 'refused-sandbox'
  | 'refused-credential'
  | 'refused-excluded'
  | 'denied-allowlist'
  | 'denied-approval'
  | 'schema-invalid'
  | 'error';

export type ToolArgsSummary = Readonly<Record<string, string | number | boolean>>;

export interface ToolCallRecord {
  toolCallId: string;
  /** The raw requested name; may be a fabricated name when denied. */
  toolName: AllowlistedToolName | string;
  argsSummary: ToolArgsSummary;
  argsRedacted: boolean;
  outcome: ToolCallOutcome;
  durationMs: number | null;
  resultSummary: string | null;
  resultTruncated: boolean;
}

export interface TranscriptEntry {
  entryId: string;
  role: 'user' | 'assistant' | 'system';
  origin: 'human' | 'model' | 'workspace-data';
  text: string;
  atMs: number;
  streaming: boolean;
  toolCallIds: readonly string[];
  rejectionNotice?: { code: AppErrorCode; message: string };
}

export interface AgentSendRequest {
  text: string;
  sessionId: string;
  workspaceId: string;
}

export type AgentEvent =
  | { type: 'request-started'; requestId: string }
  | { type: 'entry-started'; requestId: string; entry: TranscriptEntry }
  | { type: 'delta'; requestId: string; entryId: string; text: string }
  | { type: 'tool-call'; requestId: string; record: ToolCallRecord }
  | { type: 'tool-call-updated'; requestId: string; record: ToolCallRecord }
  | { type: 'entry-completed'; requestId: string; entryId: string }
  | { type: 'request-ended'; requestId: string; state: AgentRequestState; reason?: AppError }
  | { type: 'turn-progress'; requestId: string; turnCount: number; turnCap: number };

export interface AgentModel {
  sessionId: string;
  transcript: readonly TranscriptEntry[];
  toolCallsById: Readonly<Record<string, ToolCallRecord>>;
  request: {
    requestId: string | null;
    state: AgentRequestState;
    turnCount: number;
    turnCap: number;
  };
  modelState: 'configured' | 'missing' | 'error';
  input: { draftText: string; maxChars: number };
  requestCapRemaining: number;
}
