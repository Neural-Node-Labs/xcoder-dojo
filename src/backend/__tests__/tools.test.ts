// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:03:14.965Z | xcoder:subtask test-st-bf6f22
/**
 * Agent tool dispatch tests.
 *
 * Intent (README + design T-10, S-06, PRM-07): the agent may only use the 11
 * allowlisted *read* tools; anything else is refused before dispatch. Tool
 * arguments go through the same sandbox as the UI. Crucially, the agent must
 * not be able to read or even enumerate credential, dotfile or generated
 * paths - the allowlist restricts *which tools*, the sandbox restricts *what
 * they can touch*.
 */

import { describe, expect, it } from 'vitest';
import { dispatchTool, type ToolInvocation } from '../tools';
import { createVfs } from '../vfs';

const NOW = 1_700_000_000_000;
const vfs = createVfs(NOW);

function call(toolName: string, args: Record<string, string | number | boolean> = {}) {
  return dispatchTool(vfs, { toolName, args } as ToolInvocation);
}

describe('allowlist enforcement', () => {
  it.each(['write_file', 'run_command', 'delete_file', 'spawn', 'eval', 'fetch_url', 'rm -rf', 'toString', '__proto__', 'constructor'])('refuses %s before dispatch', (toolName) => {
    const result = call(toolName);
    expect(result.outcome).toBe('denied-allowlist');
    expect(result.summary).toContain('not in the allowlist');
  });

  it('does not echo arbitrary tool names unescaped into a summary', () => {
    const result = call('write_file\n[x](javascript:alert(1))');
    expect(result.summary).not.toContain('\n');
  });
});

describe('list_dir', () => {
  it('lists the seeded root', () => {
    const result = call('list_dir', { relPath: '.' });
    expect(result.outcome).toBe('ok');
    expect(result.summary).toContain('README.md');
    expect(result.summary).toContain('src/');
  });

  it('refuses a traversal argument instead of listing outside the root', () => {
    const result = call('list_dir', { relPath: '../..' });
    expect(['refused-sandbox', 'refused-credential', 'refused-excluded']).toContain(result.outcome);
  });

  it('refuses to descend into node_modules', () => {
    const result = call('list_dir', { relPath: 'node_modules' });
    expect(result.outcome).toBe('refused-excluded');
  });

  it('never lists credential-shaped or generated entries', () => {
    const root = call('list_dir', { relPath: '.' });
    expect(root.summary).not.toContain('.env');
    expect(root.summary).not.toContain('node_modules');
    expect(root.summary).not.toContain('.git');
  });
});

describe('read_file family', () => {
  it('reads a normal file and reports its size', () => {
    const result = call('read_file', { relPath: 'README.md' });
    expect(result.outcome).toBe('ok');
    expect(result.summary).toContain('README.md');
    expect(result.summary).toContain('chars');
  });

  it('reports a missing file as an error, not a crash', () => {
    expect(call('read_file', { relPath: 'nope.txt' }).outcome).toBe('error');
  });

  it('refuses to read the credential file', () => {
    const result = call('read_file', { relPath: '.env' });
    expect(result.outcome).toBe('refused-credential');
    expect(result.summary).not.toContain('sk-not-a-real-key');
  });

  it('refuses to read through node_modules', () => {
    const result = call('read_file', { relPath: 'node_modules/left-pad/index.js' });
    expect(result.outcome).toBe('refused-excluded');
  });

  it('refuses path traversal', () => {
    expect(call('read_file', { relPath: '../../../etc/passwd' }).outcome).toBe('refused-sandbox');
  });

  it('marks a long file as truncated instead of dumping it all', () => {
    const long = dispatchTool(
      { entries: new Map([['big.txt', { relPath: 'big.txt', kind: 'file', content: 'x'.repeat(9_000), mtimeMs: NOW }]]) },
      { toolName: 'read_file', args: { relPath: 'big.txt' } },
    );
    expect(long.outcome).toBe('ok');
    expect(long.truncated).toBe(true);
  });

  it('outlines only declarations', () => {
    const result = call('read_outline', { relPath: 'src/contracts/errors.ts' });
    expect(result.outcome).toBe('ok');
    expect(result.summary).toContain('export type AppErrorCode');
  });
});

describe('glob', () => {
  it('matches TypeScript sources with a ** pattern', () => {
    const result = call('glob', { pattern: 'src/**/*.ts' });
    expect(result.outcome).toBe('ok');
    expect(result.summary).toContain('src/contracts/errors.ts');
  });

  it('does not leak hidden or generated file paths', () => {
    const all = call('glob', { pattern: '**/*' });
    const everything = call('glob', { pattern: '**' });
    for (const summary of [all.summary, everything.summary]) {
      expect(summary).not.toContain('.env');
      expect(summary).not.toContain('node_modules');
      expect(summary).not.toContain('.git/');
    }
  });
});

describe('grep', () => {
  it('finds a term and reports file:line', () => {
    const result = call('grep', { pattern: 'Xcoder' });
    expect(result.outcome).toBe('ok');
    expect(result.summary).toMatch(/README\.md:1/);
  });

  it('refuses an empty pattern', () => {
    expect(call('grep', { pattern: '' }).outcome).toBe('schema-invalid');
  });

  it('refuses an invalid regular expression', () => {
    expect(call('grep', { pattern: '([' }).outcome).toBe('schema-invalid');
  });

  it('never returns a hit inside a credential file', () => {
    const result = call('grep', { pattern: 'SOME_API_KEY' });
    expect(result.summary).not.toContain('.env');
    expect(result.summary).not.toContain('SOME_API_KEY=sk');
  });
});

describe('read_multiple_files', () => {
  it('reports per-path results including refusals', () => {
    const result = call('read_multiple_files', { paths: 'README.md,.env,../x,package.json' });
    expect(result.outcome).toBe('ok');
    expect(result.summary).toContain('README.md');
    expect(result.summary).toContain('refused');
  });

  it('requires at least one path', () => {
    expect(call('read_multiple_files', { paths: '' }).outcome).toBe('schema-invalid');
  });
});

describe('git tools are read-only', () => {
  it.each(['git_status', 'git_diff', 'git_log'])('%s returns demo state without mutating', (tool) => {
    const result = call(tool);
    expect(result.outcome).toBe('ok');
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
