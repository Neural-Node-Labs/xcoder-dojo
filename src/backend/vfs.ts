// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:28:35.322Z | xcoder:subtask code-st-1de5aa
/**
 * An in-memory workspace filesystem.
 *
 * The real product reads the disk in Electron main. This demo keeps the same
 * boundary discipline: the UI never touches a path directly, it asks the
 * backend, and the backend enforces the sandbox (see sandbox.ts).
 */

import type { SupportedLanguage } from '../contracts';

export interface VfsEntry {
  /** POSIX, root-relative. Empty string is the workspace root. */
  relPath: string;
  kind: 'file' | 'dir';
  content?: string;
  mtimeMs: number;
}

export interface Vfs {
  readonly entries: Map<string, VfsEntry>;
}

export function createVfs(nowMs: number): Vfs {
  const vfs: Vfs = { entries: new Map() };
  const put = (relPath: string, kind: 'file' | 'dir', content?: string): void => {
    vfs.entries.set(relPath, {
      relPath,
      kind,
      content,
      mtimeMs: nowMs - Math.floor(Math.random() * 86_400_000),
    });
  };

  put('', 'dir');

  for (const dir of ['src', 'src/components', 'src/contracts', 'src/backend', 'docs', 'test']) {
    put(dir, 'dir');
  }

  put('README.md', 'file', [
    '# Xcoder Dojo',
    '',
    'A TypeScript UI IDE with an embedded agent (JARVIS).',
    '',
    '## Layout',
    '',
    '- `src/contracts` - every type that crosses a page boundary.',
    '- `src/backend` - the privileged layer. All validation and sandboxing.',
    '- `src/ui` - the pages P-00 through P-12.',
    '',
    '## Safety',
    '',
    'The agent can only call the 11 allowlisted read tools. Writes and',
    'delegation launches require an explicit human approval.',
    '',
    '> Markdown preview renders a sanitized AST: raw HTML and remote images',
    '> are blocked and counted, never rendered.',
    '',
    '```ts',
    'const bridge = createDemoBridge();',
    '```',
    '',
    'See also [the tool list](docs/tools.md).',
  ].join('\n'));

  put('docs/tools.md', 'file', [
    '# Allowlisted tools',
    '',
    '| Tool | Side effect | Notes |',
    '| --- | --- | --- |',
    '| list_dir | read | one directory per call |',
    '| glob | read | path pattern, bounded result count |',
    '| grep | read | content search, bounded matches |',
    '| read_file | read | capped, truncation is reported |',
    '| read_outline | read | structural skeleton |',
    '| git_status / git_diff / git_log | read | never write to the repo |',
    '',
    'Any other tool name is refused as tool-not-allowlisted and never',
    'dispatched.',
    '',
    '<script>alert(1)</script>',
    '',
    'That script tag above must appear as plain text in the preview.',
  ].join('\n'));

  put('src/contracts/errors.ts', 'file', [
    'export type AppErrorCode =',
    "  | 'path-escape'",
    "  | 'credential-file'",
    "  | 'invalid-input';",
    '',
    'export interface AppError {',
    '  code: AppErrorCode;',
    '  message: string;',
    '}',
    '',
  ].join('\n'));

  put('src/components/StatusBar.tsx', 'file', [
    "import type { StatusBarModel } from '../contracts';",
    '',
    'export function StatusBar({ model }: { model: StatusBarModel }) {',
    '  return <footer>{model.workspacePathDisplay ?? "no workspace"}</footer>;',
    '}',
    '',
  ].join('\n'));

  put('src/backend/sandbox.ts', 'file', [
    'export function isInsideRoot(relPath: string): boolean {',
    "  return !relPath.startsWith('..') && !relPath.startsWith('/');",
    '}',
    '',
  ].join('\n'));

  put('test/example.test.ts', 'file', '// placeholder test file\nexport const ok = true;\n');

  put('package.json', 'file', [
    '{',
    '  "name": "seeded-demo",',
    '  "version": "0.0.0",',
    '  "scripts": { "test": "vitest run" }',
    '}',
  ].join('\n'));

  // Credential-shaped and generated nodes exist "on disk" but are never listed.
  put('.env', 'file', 'SOME_API_KEY=sk-not-a-real-key\n');
  put('.git', 'dir');
  put('.git/config', 'file', '[core]\n');
  put('node_modules', 'dir');
  put('node_modules/left-pad/index.js', 'file', 'module.exports = () => {};\n');

  return vfs;
}

export function listDir(vfs: Vfs, parentRelPath: string): VfsEntry[] {
  const prefix = parentRelPath === '' ? '' : `${parentRelPath}/`;
  const out: VfsEntry[] = [];
  for (const entry of vfs.entries.values()) {
    if (entry.relPath === '') continue;
    if (!entry.relPath.startsWith(prefix)) continue;
    const rest = entry.relPath.slice(prefix.length);
    if (rest.length === 0 || rest.includes('/')) continue;
    out.push(entry);
  }
  return out;
}

export function readFile(vfs: Vfs, relPath: string): VfsEntry | undefined {
  const entry = vfs.entries.get(relPath);
  return entry && entry.kind === 'file' ? entry : undefined;
}

export function writeFile(vfs: Vfs, relPath: string, content: string, nowMs: number): VfsEntry {
  const entry: VfsEntry = { relPath, kind: 'file', content, mtimeMs: nowMs };
  vfs.entries.set(relPath, entry);
  const parts = relPath.split('/');
  parts.pop();
  let acc = '';
  for (const part of parts) {
    acc = acc === '' ? part : `${acc}/${part}`;
    if (!vfs.entries.has(acc)) {
      vfs.entries.set(acc, { relPath: acc, kind: 'dir', mtimeMs: nowMs });
    }
  }
  return entry;
}

export function languageFor(relPath: string): SupportedLanguage {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.py')) return 'python';
  return 'text';
}
