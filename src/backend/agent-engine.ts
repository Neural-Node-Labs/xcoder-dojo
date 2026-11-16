// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:29:51.898Z | xcoder:subtask code-st-1de5aa
/**
 * The local model stub.
 *
 * It is deterministic so the UI can be exercised without a provider. Two
 * properties matter more than its intelligence:
 *
 *  1. It can only *ask* for tools; `dispatchTool` decides what runs, and the
 *     allowlist check happens there, not here.
 *  2. Instructions found inside workspace content are data, never commands
 *     (PRM-01/02). If it sees an injection attempt it reports it instead of
 *     acting on it.
 */

import type { AgentEvent, ToolArgsSummary, ToolCallRecord, TranscriptEntry } from '../contracts';
import { dispatchTool, type ToolInvocation } from './tools';
import { listDir, type Vfs } from './vfs';

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /disregard (the )?(system|previous) prompt/i,
  /exfiltrate/i,
  /reveal (your|the) (api key|secret|token)/i,
];

export function detectInjection(text: string): string | null {
  for (const re of INJECTION_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

interface ToolMatch {
  tool: string;
  args: Record<string, string | number | boolean>;
}

function pickTool(prompt: string, vfs: Vfs): ToolMatch | null {
  const p = prompt.toLowerCase();

  if (/^(list|ls|what files|what'?s in|show me the files)/.test(p)) {
    return { tool: 'list_dir', args: { relPath: '.' } };
  }
  if (/outline|structure|skeleton|signatures/.test(p)) {
    const rel = /([\w./-]+\.(?:ts|tsx|js))\b/.exec(prompt);
    return { tool: 'read_outline', args: { relPath: rel ? rel[1] : 'README.md' } };
  }
  const searchTerm = /(?:find|search for|grep for|where is)\s+["'`]?([a-z0-9_\-]{2,})["'`]?/.exec(prompt);
  if (searchTerm) {
    return { tool: 'grep', args: { pattern: searchTerm[1] } };
  }
  const quoted = /["'`]([^"'`]+\.[a-z0-9]{1,6})["'`]/.exec(prompt);
  if (quoted && /(open|read|show|look at|what'?s in|explain)/.test(p)) {
    return { tool: 'read_file', args: { relPath: quoted[1] } };
  }
  if (/git|commit|diff|status|log/.test(p)) {
    if (/log|history|commits/.test(p)) return { tool: 'git_log', args: {} };
    if (/diff|change/.test(p)) return { tool: 'git_diff', args: {} };
    return { tool: 'git_status', args: {} };
  }
  if (/\bfiles?\b|\bproject\b|\bworkspace\b/.test(p) && listDir(vfs, '').length > 0) {
    return { tool: 'list_dir', args: { relPath: '.' } };
  }
  return null;
}

function answerFor(prompt: string, toolSummary: string | null, injection: string | null): string {
  if (injection) {
    return [
      'I read content that tried to give me instructions. I did not follow it.',
      `The pattern I matched was: "${injection}".`,
      'Workspace content is data. Only the system prompt directs me, and I can',
      'only ask for the 11 allowlisted read tools.',
    ].join('\n');
  }
  const lines = [`Here is what I found for: ${prompt.trim().slice(0, 120)}`, ''];
  if (toolSummary) {
    lines.push(toolSummary);
  } else {
    lines.push('I could not map that to an allowlisted tool. I can list files, read');
    lines.push('a file, outline a module, search content, or report git state.');
  }
  return lines.join('\n');
}

export interface RunAgentOptions {
  vfs: Vfs;
  prompt: string;
  sessionId: string;
  maxTurns: number;
  nowMs: () => number;
  emit: (event: AgentEvent, delayMs: number) => void;
  nextId: (prefix: string) => string;
  onComplete?: (finalText: string) => void;
}

/**
 * Plans and schedules one agent turn. Returns the requestId. Each event is
 * handed to `emit` with a suggested delay so the caller can pace the stream.
 */
export function runAgentTurn(opts: RunAgentOptions): string {
  const requestId = opts.nextId('req');
  const entryId = opts.nextId('ent');
  const { prompt, vfs, maxTurns, emit, nowMs } = opts;

  const injection = detectInjection(prompt);
  const match = injection ? null : pickTool(prompt, vfs);

  emit({ type: 'request-started', requestId }, 0);

  const thinking: TranscriptEntry = {
    entryId,
    role: 'assistant',
    origin: 'model',
    text: '',
    atMs: nowMs(),
    streaming: true,
    toolCallIds: [],
  };
  emit({ type: 'entry-started', requestId, entry: thinking }, 80);

  let elapsed = 160;
  let turn = 1;
  let toolSummary: string | null = null;
  const toolCallId = opts.nextId('tool');

  if (match) {
    emit({ type: 'turn-progress', requestId, turnCount: turn, turnCap: maxTurns }, elapsed);

    const pending: ToolCallRecord = {
      toolCallId,
      toolName: match.tool,
      argsSummary: match.args as ToolArgsSummary,
      argsRedacted: false,
      outcome: 'pending',
      durationMs: null,
      resultSummary: null,
      resultTruncated: false,
    };
    emit({ type: 'tool-call', requestId, record: pending }, elapsed);

    elapsed += 220;
    const started = nowMs();
    const result = dispatchTool(vfs, { toolName: match.tool, args: match.args });
    const settled: ToolCallRecord = {
      ...pending,
      outcome: result.outcome,
      durationMs: Math.max(1, nowMs() - started),
      resultSummary: result.summary,
      resultTruncated: result.truncated,
    };
    emit({ type: 'tool-call-updated', requestId, record: settled }, elapsed);

    if (result.outcome === 'ok') {
      toolSummary = result.summary;
      turn += 1;
      if (turn <= maxTurns) {
        emit({ type: 'turn-progress', requestId, turnCount: turn, turnCap: maxTurns }, elapsed);
      }
    } else {
      toolSummary = `The tool call was refused (${result.outcome}): ${result.summary}`;
    }
  }

  const text = answerFor(prompt, toolSummary, injection);
  const pieces = text.match(/.{1,24}/g) ?? [text];
  for (const piece of pieces) {
    elapsed += 45;
    emit({ type: 'delta', requestId, entryId, text: piece }, elapsed);
  }

  elapsed += 60;
  emit({ type: 'entry-completed', requestId, entryId }, elapsed);
  elapsed += 40;
  emit({ type: 'request-ended', requestId, state: 'done' }, elapsed);

  opts.onComplete?.(text);
  return requestId;
}
