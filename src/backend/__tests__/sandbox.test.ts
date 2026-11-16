// xcoder:version 2 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:05:38.465Z | xcoder:subtask test-st-bf6f22
/**
 * Sandbox tests.
 *
 * Intent, from the design (P-02 security notes, S-06): a root-relative path may
 * only ever describe a normal file inside the workspace. Traversal, absolute
 * paths, Windows separators, control characters, dotfiles, generated
directories and credential-shaped names are refused at this single choke
 * point, because every backend path goes through it.
 */

import { describe, expect, it } from 'vitest';
import {
  isCredentialName,
  isExcludedDirName,
  isVisibleName,
  normalizeRelPath,
  normalizeWritePath,
} from '../sandbox';
import { ActionError } from '../../contracts';

describe('normalizeRelPath accepts ordinary workspace paths', () => {
  it.each([
    ['README.md', 'README.md'],
    ['src/main.tsx', 'src/main.tsx'],
    ['src/contracts/errors.ts', 'src/contracts/errors.ts'],
    ['./src/a.ts', 'src/a.ts'],
    ['src/deep/nested/file.txt', 'src/deep/nested/file.txt'],
    ['docs/with space.md', 'docs/with space.md'],
    ['src/trailing/', 'src/trailing'],
  ])('normalises %s -> %s', (input, expected) => {
    expect(normalizeRelPath(input)).toBe(expected);
  });

  it('normalises the root itself to the empty string', () => {
    expect(normalizeRelPath('')).toBe('');
    expect(normalizeRelPath('./')).toBe('');
  });

  it('refuses a bare dot segment as traversal rather than guessing intent', () => {
    // Callers that mean "the root" pass '' or a null parent; '.' is ambiguous
    // and is refused by the strict segment check.
    expect(() => normalizeRelPath('.')).toThrow(ActionError);
  });
});

describe('normalizeRelPath refuses escapes', () => {
  it.each([
    ['../etc/passwd', 'path-escape'],
    ['src/../../secret.txt', 'path-escape'],
    ['src/..', 'path-escape'],
    ['..', 'path-escape'],
    ['/etc/passwd', 'path-escape'],
    ['/absolute', 'path-escape'],
    ['C:/Windows/System32', 'path-escape'],
    ['c:relative', 'path-escape'],
    ['src\\main.ts', 'path-escape'],
    ['src\\..\\evil', 'path-escape'],
    ['.hidden', 'path-escape'],
    ['src/.env', 'credential-file'],
    ['.env', 'credential-file'],
    ['.env.local', 'credential-file'],
    ['keys/server.pem', 'credential-file'],
    ['certs/tls.key', 'credential-file'],
    ['id_rsa', 'credential-file'],
    ['id_ed25519', 'credential-file'],
    ['.npmrc', 'credential-file'],
    ['.netrc', 'credential-file'],
    ['credentials', 'credential-file'],
    ['credentials.json', 'credential-file'],
    ['secrets.yaml', 'credential-file'],
    ['node_modules/left-pad/index.js', 'excluded-dir'],
    ['dist/main.js', 'excluded-dir'],
    ['build/out.js', 'excluded-dir'],
    ['.git/config', 'excluded-dir'],
    ['.xcoder/state.json', 'excluded-dir'],
    ['src//main.ts', 'invalid-input'],
  ])('refuses %s with %s', (input, code) => {
    expect(() => normalizeRelPath(input)).toThrow(ActionError);
    try {
      normalizeRelPath(input);
    } catch (err) {
      expect((err as ActionError).code).toBe(code);
    }
  });

  it('refuses null bytes anywhere in the path', () => {
    expect(() => normalizeRelPath('src/a\u0000.ts')).toThrow(ActionError);
  });

  it('refuses non-string input rather than coercing it', () => {
    for (const bad of [null, undefined, 42, {}, ['a'], true]) {
      expect(() => normalizeRelPath(bad)).toThrow(ActionError);
    }
  });

  it('caps path length at 1024 characters', () => {
    expect(() => normalizeRelPath('a'.repeat(1024))).not.toThrow();
    expect(() => normalizeRelPath('a'.repeat(1025))).toThrow(ActionError);
  });
});

describe('normalizeWritePath additionally requires a file target', () => {
  it('accepts a file path', () => {
    expect(normalizeWritePath('src/new-file.ts')).toBe('src/new-file.ts');
  });

  it('refuses the bare root as a write target', () => {
    expect(() => normalizeWritePath('')).toThrow(ActionError);
    expect(() => normalizeWritePath('.')).toThrow(ActionError);
  });

  it('applies all read-path refusals', () => {
    expect(() => normalizeWritePath('../escape.ts')).toThrow(ActionError);
    expect(() => normalizeWritePath('.env')).toThrow(ActionError);
    expect(() => normalizeWritePath('dist/bundle.js')).toThrow(ActionError);
  });
});

describe('name classifiers', () => {
  it('recognises credential-shaped names by basename', () => {
    for (const name of ['.env', '.env.production', 'id_rsa', 'server.pem', 'tls.key', '.npmrc', '.netrc', 'credentials.json', 'secrets.yaml']) {
      expect(isCredentialName(name)).toBe(true);
    }
    for (const name of ['README.md', 'main.ts', 'environment.ts', 'keys.ts', 'my-secrets.ts']) {
      expect(isCredentialName(name)).toBe(false);
    }
  });

  it('recognises generated and VCS directories', () => {
    for (const name of ['node_modules', 'dist', 'build', '.git', '.xcoder']) {
      expect(isExcludedDirName(name)).toBe(true);
    }
    for (const name of ['src', 'docs', 'test', 'node_modules_notes']) {
      expect(isExcludedDirName(name)).toBe(false);
    }
  });

  it('isVisibleName hides dotfiles, generated dirs and credentials', () => {
    expect(isVisibleName('README.md')).toBe(true);
    expect(isVisibleName('src')).toBe(true);
    expect(isVisibleName('.env')).toBe(false);
    expect(isVisibleName('.git')).toBe(false);
    expect(isVisibleName('node_modules')).toBe(false);
    expect(isVisibleName('id_rsa')).toBe(false);
  });
});
