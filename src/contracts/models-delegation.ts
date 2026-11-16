// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:27:57.124Z | xcoder:subtask code-st-1de5aa
/**
 * Page models for P-06 delegation run view and P-07 approval sheet.
 */

export type DelegationState =
  | 'idle'
  | 'launching'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'denied'
  | 'rejected-busy';

export interface DelegationLaunchRequest {
  goal: string;
}

export interface DelegationChunk {
  chunkId: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  atMs: number;
}

export interface DelegationRun {
  runId: string;
  goal: string;
  cliLabel: string;
  state: DelegationState;
  startedAtMs: number;
  endedAtMs: number | null;
  exitCode: number | null;
  chunks: readonly DelegationChunk[];
  simulated: boolean;
}

export type DelegationEvent =
  | { type: 'delegation-started'; run: DelegationRun }
  | { type: 'delegation-chunk'; runId: string; chunk: DelegationChunk }
  | { type: 'delegation-ended'; runId: string; state: DelegationState; exitCode: number | null };

/* ---------------------------------------------------------------- approval */

export type ApprovalKind = 'file-write' | 'delegation-launch';
export type ApprovalDecision = 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  approvalId: string;
  kind: ApprovalKind;
  /** Already redacted. */
  summary: string;
  detailLines: readonly string[];
  requestedAtMs: number;
  expiresAtMs: number;
}

export interface ApprovalResponseRequest {
  approvalId: string;
  decision: 'approved' | 'denied';
}
