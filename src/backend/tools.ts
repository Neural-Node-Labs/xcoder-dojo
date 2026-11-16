// xcoder:version 5 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:05:27.929Z | xcoder:subtask test-st-bf6f22
/**
 * Execution of the 11 allowlisted read tools.
 *
 * `dispatchTool` is the ONLY entry point and it checks the allowlist before
 * doing any work. A fabricated tool name never reaches an implementation
 * (design P-05, PRM-04).
 */

import type { ToolCallOutcome } from '../contracts';
import { isAllowlistedTool } from '../contracts';
import { listDir, readFile, type Vfs, type VfsEntry } from './vfs';
import { isVisibleName, normalizeRelPath } from './sandbox';

export interface ToolInvocation {
  toolName: string;
  args: Readonly<Record<string, string | number | boolean>>;
}

export interface ToolExecution {
  outcome: ToolCallOutcome;
  summary: string;
  truncated: boolean;
}

const MAX_SUMMARY = 180;
const MAX_LIST = 50;
const MAX_GREP = 25;
const MAX_READ_CHARS = 4_000;

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_SUMMARY ? `${collapsed.slice(0, MAX_SUMMARY)}...` : collapsed;
}

function argString(inv: ToolInvocation, key: string, fallback: string): string {
  const value = inv.args[key];
  return typeof value === 'string' ? value : fallback;
}

/** A path is agent-visible only if every segment is a normal workspace name. */
function isVisibleRelPath(relPath: string): boolean {
  return relPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .every((segment) => isVisibleName(segment));
}

function sortedEntries(vfs: Vfs, parent: string): VfsEntry[] {
  return listDir(vfs, parent).filter((e) => isVisibleRelPath(e.relPath)).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function classifyRefusal(message: string): ToolCallOutcome {
  const lower = message.toLowerCase();
  if (lower.includes('credential')) return 'refused-credential';
  if (lower.includes('excluded')) return 'refused-excluded';
  if (lower.includes('path') || lower.includes('dotfile') || lower.includes('absolute')) return 'refused-sandbox';
  return 'error';
}

export function dispatchTool(vfs: Vfs, inv: ToolInvocation): ToolExecution {
  if (!isAllowlistedTool(inv.toolName)) {
    return {
      outcome: 'denied-allowlist',
      summary: `Tool "${oneLine(inv.toolName)}" is not in the allowlist and was not dispatched.`,
      truncated: false,
    };
  }

  try {
    switch (inv.toolName) {
      case 'list_dir': {
        const raw = argString(inv, 'relPath', '.');
        const parent = raw === '.' || raw === '' ? '' : normalizeRelPath(raw);
        const entries = sortedEntries(vfs, parent);
        const shown = entries.slice(0, MAX_LIST);
        const names = shown.map((e) => `${e.relPath.split('/').pop()}${e.kind === 'dir' ? '/' : ''}`).join(', ');
        return {
          outcome: 'ok',
          summary: oneLine(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${parent || '.'}: ${names || '(empty)'}`),
          truncated: entries.length > shown.length,
        };
      }

      case 'glob': {
        const pattern = argString(inv, 'pattern', '**/*');
        const re = globToRegExp(pattern);
        const matches = [...vfs.entries.values()]
          .filter((e) => e.kind === 'file' && isVisibleRelPath(e.relPath) && re.test(e.relPath))
          .map((e) => e.relPath)
          .sort();
        const shown = matches.slice(0, MAX_LIST);
        return {
          outcome: 'ok',
          summary: oneLine(`${matches.length} match${matches.length === 1 ? '' : 'es'} for ${pattern}: ${shown.join(', ') || '(none)'}`),
          truncated: matches.length > shown.length,
        };
      }

      case 'grep': {
        const needle = argString(inv, 'pattern', '');
        if (needle.length === 0) {
          return { outcome: 'schema-invalid', summary: 'grep requires a non-empty pattern.', truncated: false };
        }
        let re: RegExp;
        try {
          re = new RegExp(needle, 'i');
        } catch {
          return { outcome: 'schema-invalid', summary: 'grep pattern is not a valid regular expression.', truncated: false };
        }
        const hits: string[] = [];
        for (const entry of vfs.entries.values()) {
          if (entry.kind !== 'file' || typeof entry.content !== 'string') continue;
          if (!isVisibleRelPath(entry.relPath)) continue;
          const lines = entry.content.split('\n');
          for (let n = 0; n < lines.length; n += 1) {
            if (re.test(lines[n])) {
              hits.push(`${entry.relPath}:${n + 1}`);
              if (hits.length > MAX_GREP) break;
            }
          }
          if (hits.length > MAX_GREP) break;
        }
        const truncated = hits.length > MAX_GREP;
        const shown = hits.slice(0, MAX_GREP);
        return {
          outcome: 'ok',
          summary: oneLine(`${shown.length}${truncated ? '+' : ''} match(es) for /${needle}/: ${shown.join(', ') || '(none)'}`),
          truncated,
        };
      }

      case 'read_file':
      case 'read_file_lines':
      case 'read_outline': {
        const rel = normalizeRelPath(argString(inv, 'relPath', argString(inv, 'path', '')));
        const entry = readFile(vfs, rel);
        if (!entry) {
          return { outcome: 'error', summary: `No such file: ${rel}`, truncated: false };
        }
        const content = entry.content ?? '';
        const truncated = content.length > MAX_READ_CHARS;
        if (inv.toolName === 'read_outline') {
          const outline = content
            .split('\n')
            .filter((line) => /^(export\s+)?(async\s+)?(function|class|interface|type|const|let)\b/.test(line.trim()))
            .slice(0, 20)
            .map((line) => line.trim());
          return { outcome: 'ok', summary: oneLine(`${rel}: ${outline.join(' | ') || '(no declarations)'}`), truncated };
        }
        const body = truncated ? content.slice(0, MAX_READ_CHARS) : content;
        const firstLine = body.split('\n')[0] ?? '';
        return {
          outcome: 'ok',
          summary: oneLine(`${rel} (${content.length} chars, ${content.split('\n').length} lines): ${firstLine}`),
          truncated,
        };
      }

      case 'read_multiple_files': {
        const rawPaths = argString(inv, 'paths', '');
        const paths = rawPaths.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
        if (paths.length === 0) {
          return { outcome: 'schema-invalid', summary: 'read_multiple_files requires comma-separated paths.', truncated: false };
        }
        const found: string[] = [];
        for (const p of paths.slice(0, 8)) {
          try {
            const rel = normalizeRelPath(p);
            const entry = readFile(vfs, rel);
            found.push(entry ? `${rel} (${(entry.content ?? '').length} chars)` : `${rel} (missing)`);
          } catch {
            found.push(`${p} (refused)`);
          }
        }
        return { outcome: 'ok', summary: oneLine(found.join('; ')), truncated: paths.length > 8 };
      }

      case 'validate_file': {
        const rel = normalizeRelPath(argString(inv, 'relPath', argString(inv, 'path', '')));
        const entry = readFile(vfs, rel);
        if (!entry) {
          return { outcome: 'error', summary: `No such file: ${rel}`, truncated: false };
        }
        const content = entry.content ?? '';
        const problems: string[] = [];
        const opens = (content.match(/{/g) ?? []).length;
        const closes = (content.match(/}/g) ?? []).length;
        if (opens !== closes) problems.push(`unbalanced braces (${opens} open, ${closes} close)`);
        return {
          outcome: 'ok',
          summary: oneLine(problems.length === 0 ? `${rel}: no structural problems found.` : `${rel}: ${problems.join('; ')}`),
          truncated: false,
        };
      }

      case 'git_status':
        return { outcome: 'ok', summary: 'git_status: clean working tree (demo repository).', truncated: false };
      case 'git_diff':
        return { outcome: 'ok', summary: 'git_diff: no unstaged changes (demo repository).', truncated: false };
      case 'git_log':
        return { outcome: 'ok', summary: 'git_log: a1b2c3 initial commit; d4e5f6 wire the bridge.', truncated: false };
      default:
        return { outcome: 'denied-allowlist', summary: 'Tool not dispatched.', truncated: false };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tool failed';
    return { outcome: classifyRefusal(message), summary: oneLine(message), truncated: false };
  }
}
