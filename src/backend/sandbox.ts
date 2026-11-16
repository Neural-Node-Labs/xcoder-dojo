// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:28:44.230Z | xcoder:subtask code-st-1de5aa
/**
 * Path sandbox. Every relPath entering the backend passes through here.
 *
 * Rules (design P-02 security notes, S-06):
 *  - relative, POSIX separators only
 *  - no absolute paths, no '..', no backslashes, no NULs
 *  - dotfiles and generated directories are never visible
 *  - credential-shaped names are refused even if they slip past the filter
 */

import { ActionError } from '../contracts';

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.xcoder']);
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_(rsa|ed25519|ecdsa)$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^credentials(\.json)?$/i,
  /^secrets?\./i,
];

export function isCredentialName(name: string): boolean {
  return CREDENTIAL_PATTERNS.some((re) => re.test(name));
}

export function isExcludedDirName(name: string): boolean {
  return EXCLUDED_DIRS.has(name);
}

export function isVisibleName(name: string): boolean {
  if (name.startsWith('.')) return false;
  if (isExcludedDirName(name)) return false;
  if (isCredentialName(name)) return false;
  return true;
}

/**
 * Normalise and validate a root-relative path.
 * Throws ActionError('path-escape' | 'credential-file' | 'excluded-dir').
 */
export function normalizeRelPath(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ActionError('invalid-input', 'path must be a string');
  }
  if (raw.length > 1024) {
    throw new ActionError('invalid-input', 'path exceeds 1024 characters');
  }
  if (raw.includes('\\')) {
    throw new ActionError('path-escape', 'backslash separators are not accepted');
  }
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    throw new ActionError('path-escape', 'absolute paths are not accepted');
  }
  if (raw.includes(String.fromCharCode(0))) {
    throw new ActionError('path-escape', 'control characters are not accepted');
  }
  const trimmed = raw.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const segments = trimmed.length === 0 ? [] : trimmed.split('/');
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new ActionError('path-escape', 'path traversal is not accepted');
    }
    if (segment.length === 0) {
      throw new ActionError('invalid-input', 'path contains an empty segment');
    }
    if (isCredentialName(segment)) {
      throw new ActionError('credential-file', 'credential-shaped paths are never accessible');
    }
    if (isExcludedDirName(segment)) {
      throw new ActionError('excluded-dir', 'generated and VCS directories are excluded');
    }
    if (segment.startsWith('.')) {
      throw new ActionError('path-escape', 'dotfiles are not listed or readable');
    }
  }
  return segments.join('/');
}

/** Same rules, and the target must name a file rather than the root. */
export function normalizeWritePath(raw: unknown): string {
  const relPath = normalizeRelPath(raw);
  if (relPath === '') {
    throw new ActionError('invalid-input', 'write target must be a file path');
  }
  return relPath;
}
