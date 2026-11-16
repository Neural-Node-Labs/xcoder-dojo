// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:27:33.678Z | xcoder:subtask code-st-1de5aa
/**
 * Xcoder Dojo - closed error vocabulary and result envelope.
 *
 * Pages render AppError.code plus a pre-redacted message; they never see raw
 * stack traces or provider payloads.
 */

export type AppErrorCode =
  | 'path-escape'
  | 'credential-file'
  | 'excluded-dir'
  | 'binary-file'
  | 'not-utf8'
  | 'file-too-large'
  | 'outside-workspace'
  | 'denied-credential'
  | 'missing'
  | 'conflict'
  | 'no-workspace'
  | 'run-busy'
  | 'runtime-missing'
  | 'turn-limit'
  | 'request-cap'
  | 'tool-not-allowlisted'
  | 'tool-failed'
  | 'approval-expired'
  | 'approval-denied'
  | 'approval-required'
  | 'secret-detected'
  | 'invalid-input'
  | 'model-not-configured'
  | 'delegation-busy'
  | 'internal';

export interface AppError {
  code: AppErrorCode;
  /** Already redacted; safe to render as escaped text. */
  message: string;
  remediation?: string;
  detailRef?: string;
}

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export function bridgeOk<T>(value: T): BridgeResult<T> {
  return { ok: true, value };
}

export function bridgeErr<T = never>(
  code: AppErrorCode,
  message: string,
  remediation?: string,
): BridgeResult<T> {
  const error: AppError = { code, message };
  if (remediation) error.remediation = remediation;
  return { ok: false, error };
}

/** Thrown inside action implementations; the dispatcher turns it into a BridgeResult. */
export class ActionError extends Error {
  readonly code: AppErrorCode;
  readonly remediation?: string;

  constructor(code: AppErrorCode, message: string, remediation?: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    if (remediation) this.remediation = remediation;
  }

  toAppError(): AppError {
    const e: AppError = { code: this.code, message: this.message };
    if (this.remediation) e.remediation = this.remediation;
    return e;
  }
}

/* -------------------------------------------------------------- input guards */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireString(raw: unknown, field: string, maxLength = 200_000): string {
  if (typeof raw !== 'string') {
    throw new ActionError('invalid-input', `${field} must be a string`);
  }
  if (raw.length > maxLength) {
    throw new ActionError('invalid-input', `${field} exceeds the ${maxLength} character limit`);
  }
  return raw;
}

export function requireBoolean(raw: unknown, field: string): boolean {
  if (typeof raw !== 'boolean') {
    throw new ActionError('invalid-input', `${field} must be a boolean`);
  }
  return raw;
}

export function requireNumber(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new ActionError('invalid-input', `${field} must be a finite number`);
  }
  return raw;
}

export function requireOneOf<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    throw new ActionError('invalid-input', `${field} must be one of: ${allowed.join(', ')}`);
  }
  return raw as T;
}
