// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:02:45.785Z | xcoder:subtask test-st-bf6f22
/**
 * In-memory workspace filesystem tests.
 *
 * The VFS is the demo stand-in for the real disk. Its job is to hold entries
 * and to be honest about what exists: hidden, credential and generated nodes
 * are physically present (the "disk") so that the visibility layer has
 * something real to hide.
 */

import { describe, expect, it } from 'vitest';
import { createVfs, languageFor, listDir, readFile, writeFile } from '../vfs';

const NOW = 1_700_000_000_000;

describe('seeded workspace', () => {
  it('has a root directory entry at the empty path', () => {
    const vfs = createVfs(NOW);
    expect(vfs.entries.get('')).toMatchObject({ relPath: '', kind: 'dir' });
  });

  it.each(['src', 'src/components', 'src/contracts', 'src/backend', 'docs', 'test'])('contains directory %s', (dir) => {
    expect(vfsEntry(dir, 'dir')).toBe(true);
  });

  it.each(['README.md', 'docs/tools.md', 'package.json', 'test/example.test.ts'])('contains file %s', (file) => {
    expect(vfsEntry(file, 'file')).toBe(true);
  });

  it('seeds credential and generated nodes so the visibility layer is load-bearing', () => {
    const vfs = createVfs(NOW);
    expect(vfs.entries.has('.env')).toBe(true);
    expect(vfs.entries.has('.git/config')).toBe(true);
    expect(vfs.entries.has('node_modules/left-pad/index.js')).toBe(true);
  });

  it('gives every entry a timestamp no later than the supplied clock', () => {
    const vfs = createVfs(NOW);
    for (const entry of vfs.entries.values()) {
      expect(entry.mtimeMs).toBeLessThanOrEqual(NOW);
    }
  });
});

function vfsEntry(relPath: string, kind: 'file' | 'dir'): boolean {
  const vfs = createVfs(NOW);
  const entry = vfs.entries.get(relPath);
  return entry?.kind === kind;
}

describe('listDir', () => {
  it('lists only direct children of the requested directory', () => {
    const vfs = createVfs(NOW);
    const children = listDir(vfs, 'src').map((e) => e.relPath).sort();
    expect(children).toEqual(['src/backend', 'src/components', 'src/contracts']);
  });

  it('lists the root without the root entry itself', () => {
    const vfs = createVfs(NOW);
    const children = listDir(vfs, '').map((e) => e.relPath);
    expect(children).not.toContain('');
    expect(children).toContain('README.md');
  });

  it('returns an empty list for a directory with no children', () => {
    const vfs = createVfs(NOW);
    expect(listDir(vfs, 'docs')).toHaveLength(1);
    expect(listDir(vfs, 'src/contracts/nothing-here')).toEqual([]);
  });
});

 describe('readFile', () => {
  it('returns file content', () => {
    const vfs = createVfs(NOW);
    expect(readFile(vfs, 'README.md')?.content).toContain('# Xcoder Dojo');
  });

  it('returns undefined for directories, absent paths and traversal-ish keys', () => {
    const vfs = createVfs(NOW);
    expect(readFile(vfs, 'src')).toBeUndefined();
    expect(readFile(vfs, 'nope.txt')).toBeUndefined();
    expect(readFile(vfs, '../README.md')).toBeUndefined();
  });
});

describe('writeFile', () => {
  it('creates the file and records the write time', () => {
    const vfs = createVfs(NOW);
    const entry = writeFile(vfs, 'src/new.ts', 'export const x = 1;', NOW + 5);
    expect(entry).toMatchObject({ relPath: 'src/new.ts', kind: 'file', mtimeMs: NOW + 5 });
    expect(readFile(vfs, 'src/new.ts')?.content).toBe('export const x = 1;');
  });

  it('creates any missing parent directories', () => {
    const vfs = createVfs(NOW);
    writeFile(vfs, 'a/b/c/d.txt', 'hi', NOW);
    for (const dir of ['a', 'a/b', 'a/b/c']) {
      expect(vfs.entries.get(dir)?.kind).toBe('dir');
    }
  });

  it('overwrites existing content in place', () => {
    const vfs = createVfs(NOW);
    writeFile(vfs, 'README.md', 'replaced', NOW + 1);
    expect(readFile(vfs, 'README.md')?.content).toBe('replaced');
  });
});

describe('languageFor', () => {
  it.each([
    ['src/main.tsx', 'typescript'],
    ['src/a.ts', 'typescript'],
    ['a.js', 'javascript'],
    ['a.jsx', 'javascript'],
    ['a.mjs', 'javascript'],
    ['package.json', 'json'],
    ['README.md', 'markdown'],
    ['a.markdown', 'markdown'],
    ['styles.css', 'css'],
    ['index.html', 'html'],
    ['a.htm', 'html'],
    ['script.py', 'python'],
    ['notes.txt', 'text'],
    ['LICENSE', 'text'],
  ])('maps %s to %s', (relPath, language) => {
    expect(languageFor(relPath)).toBe(language);
  });

  it('is case-insensitive about the extension', () => {
    expect(languageFor('SRC/MAIN.TSX')).toBe('typescript');
    expect(languageFor('README.MD')).toBe('markdown');
  });
});
