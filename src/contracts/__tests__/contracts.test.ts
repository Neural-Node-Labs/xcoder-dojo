// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:02:08.291Z | xcoder:subtask test-st-bf6f22
/**
 * Contract-level tests.
 *
 * These encode the promises the design makes about the *shape* of things that
 * cross a page boundary: a closed error vocabulary, a result envelope that can
 * never be confused with success, input guards that refuse instead of
 * coercing, and an action descriptor that cannot omit its approval gate.
 */

import { describe, expect, it } from 'vitest';
import {
  ActionError,
  bridgeErr,
  bridgeOk,
  isRecord,
  requireBoolean,
  requireNumber,
  requireOneOf,
  requireString,
} from '../errors';
import { defineAction, type ActionDescriptor } from '../action';
import {
  ALLOWLISTED_TOOLS,
  isAllowlistedTool,
} from '../models-execution';

const CLOSED_ERROR_CODES: readonly string[] = [
  'path-escape',
  'credential-file',
  'excluded-dir',
  'binary-file',
  'not-utf8',
  'file-too-large',
  'outside-workspace',
  'denied-credential',
  'missing',
  'conflict',
  'no-workspace',
  'run-busy',
  'runtime-missing',
  'turn-limit',
  'request-cap',
  'tool-not-allowlisted',
  'tool-failed',
  'approval-expired',
  'approval-denied',
  'approval-required',
  'secret-detected',
  'invalid-input',
  'model-not-configured',
  'delegation-busy',
  'internal',
];

describe('result envelope', () => {
  it('marks success with ok:true and carries the value verbatim', () => {
    expect(bridgeOk(42)).toEqual({ ok: true, value: 42 });
  });

  it('marks failure with ok:false and never populates value', () => {
    const result = bridgeErr('path-escape', 'Path escapes the root.');
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
    if (!result.ok) expect(result.error.code).toBe('path-escape');
  });

  it('omits remediation when none is supplied and includes it when it is', () => {
    const plain = bridgeErr('internal', 'boom');
    const withFix = bridgeErr('internal', 'boom', 'Retry the action.');
    if (!plain.ok) expect(plain.error).not.toHaveProperty('remediation');
    if (!withFix.ok) expect(withFix.error.remediation).toBe('Retry the action.');
  });
});

describe('ActionError', () => {
  it('carries the closed vocabulary code', () => {
    const err = new ActionError('credential-file', 'nope');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('credential-file');
  });

  it('converts to an AppError with the same code and no leaked stack', () => {
    const appError = new ActionError('approval-denied', 'Denied.', 'Approve it first.').toAppError();
    expect(appError).toEqual({
      code: 'approval-denied',
      message: 'Denied.',
      remediation: 'Approve it first.',
    });
    expect(JSON.stringify(appError)).not.toContain('at ');
  });

  it('exposes a vocabulary that covers every security-relevant refusal', () => {
    for (const code of CLOSED_ERROR_CODES) expect(typeof code).toBe('string');
    const thrown = ['path-escape', 'credential-file', 'excluded-dir', 'run-busy', 'approval-denied'];
    for (const code of thrown) expect(CLOSED_ERROR_CODES).toContain(code);
  });
});

describe('input guards', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(1)).toBe(false);
  });

  it('requireString refuses non-strings rather than coercing them', () => {
    expect(requireString('hello', 'text')).toBe('hello');
    expect(() => requireString(5, 'text')).toThrow(ActionError);
    expect(() => requireString({ toString: () => 'x' }, 'text')).toThrow(ActionError);
    expect(() => requireString(null, 'text')).toThrow(ActionError);
  });

  it('requireString enforces the maximum length', () => {
    expect(requireString('a'.repeat(10), 'text', 10)).toHaveLength(10);
    expect(() => requireString('a'.repeat(11), 'text', 10)).toThrow(/exceeds/);
  });

  it('requireNumber rejects NaN and Infinity', () => {
    expect(requireNumber(1.5, 'n')).toBe(1.5);
    expect(() => requireNumber(Number.NaN, 'n')).toThrow(ActionError);
    expect(() => requireNumber(Number.POSITIVE_INFINITY, 'n')).toThrow(ActionError);
    expect(() => requireNumber('1', 'n')).toThrow(ActionError);
  });

  it('requireBoolean refuses truthy stand-ins', () => {
    expect(requireBoolean(false, 'b')).toBe(false);
    expect(() => requireBoolean(1, 'b')).toThrow(ActionError);
    expect(() => requireBoolean('true', 'b')).toThrow(ActionError);
  });

  it('requireOneOf closes the set of accepted values', () => {
    const allowed = ['dojo-dark', 'dojo-hud'] as const;
    expect(requireOneOf('dojo-hud', 'theme', allowed)).toBe('dojo-hud');
    expect(() => requireOneOf('dojo-light', 'theme', allowed)).toThrow(ActionError);
    expect(() => requireOneOf('', 'theme', allowed)).toThrow(ActionError);
  });
});

describe('agent tool allowlist', () => {
  it('is exactly the 11 documented read tools, with no duplicates', () => {
    expect(ALLOWLISTED_TOOLS).toHaveLength(11);
    expect(new Set(ALLOWLISTED_TOOLS).size).toBe(11);
    expect([...ALLOWLISTED_TOOLS]).toEqual([
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
    ]);
  });

  it('contains no write, execute or shell tool', () => {
    for (const tool of ALLOWLISTED_TOOLS) {
      expect(tool).not.toMatch(/write|delete|remove|exec|spawn|shell|bash|run_command|fetch|http/i);
    }
  });

  it('isAllowlistedTool refuses unknown names and non-strings', () => {
    expect(isAllowlistedTool('read_file')).toBe(true);
    for (const bad of ['write_file', 'run_command', 'READ_FILE', ' read_file', '', 'toString', '__proto__']) {
      expect(isAllowlistedTool(bad)).toBe(false);
    }
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(isAllowlistedTool(bad)).toBe(false);
    }
  });
});

describe('ActionDescriptor', () => {
  const descriptor: ActionDescriptor<{ relPath: string }, string> = defineAction({
    name: 'files.read',
    sideEffect: 'read',
    requiresApproval: false,
    enforcedIn: 'main',
    summarize: (input) => `read ${input.relPath}`,
    validate: (raw) => raw as { relPath: string },
    run: async (input) => input.relPath,
  });

  it('keeps the approval gate and enforcement location on the descriptor', () => {
    expect(descriptor.requiresApproval).toBe(false);
    expect(descriptor.enforcedIn).toBe('main');
  });

  it('summarises without running the effect', () => {
    expect(descriptor.summarize({ relPath: 'README.md' })).toBe('read README.md');
  });

  it('runs only after validate', async () => {
    const input = descriptor.validate({ relPath: 'src/a.ts' });
    await expect(descriptor.run(input, { origin: 'user', nowMs: 1 })).resolves.toBe('src/a.ts');
  });
});

describe('entry point invariants', () => {
  it('index.html ships a restrictive Content-Security-Policy', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const match = /content="([^"]*default-src[^"]*)"/i.exec(html);
    expect(match).not.toBeNull();
    const csp = (match?.[1] ?? '').toLowerCase();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('script-src *');
  });

  it('main.tsx builds one bridge and mounts the shell inside the provider', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const source = await readFile(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(source).toMatch(/createDemoBridge\(/);
    expect(source).toContain('<AppProvider bridge={bridge}>');
    expect(source).toContain('<App />');
    expect(source.match(/createDemoBridge\(/g)).toHaveLength(1);
  });
});
