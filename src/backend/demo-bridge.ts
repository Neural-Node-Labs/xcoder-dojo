// xcoder:version 7 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:16:14.187Z | xcoder:subtask test-st-bf6f22
/**
 * The in-browser implementation of DojoBridge.
 *
 * Everything the UI can do goes through here. In Electron this object would
 * live in the main process behind contextBridge; in the demo it runs in the
 * renderer but keeps the same contract: validate here, enforce here, and never
 * hand back a secret.
 */

import {
  ActionError,
  bridgeErr,
  bridgeOk,
  isRecord,
  requireNumber,
  requireString,
  type AgentModel,
  type AgentRequestState,
  type AgentSendRequest,
  type ApprovalRequest,
  type ApprovalResponseRequest,
  type BridgeEvent,
  type BridgeListener,
  type BridgeResult,
  type CommandSpec,
  type ConsoleChunk,
  type DelegationRun,
  type DojoBridge,
  type FileReadResult,
  type ListChildrenRequest,
  type LlmSettingsPatch,
  type MarkdownPreviewModel,
  type RecentWorkspace,
  type RunSession,
  type SaveRequest,
  type SaveResult,
  type StatusBarModel,
  type ToolCallRecord,
  type TranscriptEntry,
  type TreeNodePage,
  type WorkspaceInfo,
} from '../contracts';
import { AuditLog } from './audit';
import { parseMarkdown } from './markdown';
import { isVisibleName, normalizeRelPath, normalizeWritePath } from './sandbox';
import { Store } from './store';
import { createVfs, languageFor, listDir, readFile, writeFile, type Vfs } from './vfs';
import { dispatchTool } from './tools';
import { runAgentTurn } from './agent-engine';

interface ApprovalTicket {
  approvalId: string;
  kind: 'file-write' | 'delegation-launch';
  summary: string;
  detailLines: readonly string[];
  requestedAtMs: number;
  expiresAtMs: number;
  resolve: (decision: 'approved' | 'denied' | 'expired') => void;
  /**
   * Handle for the expiry timer. Tracked so every resolution path can clear it;
   * otherwise a resolved approval leaves a 120s timer holding the event loop
   * open and a Node process (e.g. the smoke test) never exits.
   */
  timer?: ReturnType<typeof setTimeout>;
}

const APPROVAL_TTL_MS = 120_000;
const LAUNCH_TTL_MS = 90_000;

export interface DemoBridgeOptions {
  now?: () => number;
  autoConfigureModel?: boolean;
}

export function createDemoBridge(options: DemoBridgeOptions = {}): DojoBridge {
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<BridgeListener>();
  const store = new Store();
  const audit = new AuditLog(store.auditRetentionDays);
  const vfs: Vfs = createVfs(now());
  const logDir = '.xcoder/logs/audit';

  let seq = 0;
  const nextId = (prefix: string): string => {
    seq += 1;
    return `${prefix}-${seq.toString(36)}`;
  };

  const emit = (event: BridgeEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const auditEvent = (
    type: Parameters<AuditLog['append']>[0]['type'],
    outcome: 'ok' | 'refused' | 'denied' | 'failed',
    summary: string,
    actor: 'user' | 'agent' | 'system' = 'system',
    extra: { targetRelPath?: string; toolName?: ToolCallRecord['toolName'] } = {},
  ): void => {
    const view = audit.append(
      {
        type,
        actor,
        outcome,
        redactedSummary: summary,
        ...(extra.targetRelPath ? { targetRelPath: extra.targetRelPath } : {}),
        ...(extra.toolName ? { toolName: extra.toolName as never } : {}),
      },
      now(),
    );
    emit({ type: 'audit', event: view });
  };

  /* ------------------------------------------------------------ workspace */

  let workspace: WorkspaceInfo | null = null;
  let sessionId = '';
  let transcript: TranscriptEntry[] = [];
  let toolCalls: Record<string, ToolCallRecord> = {};
  let requestState: AgentRequestState = 'idle';
  let activeRequestId: string | null = null;
  let turnCount = 0;
  let turnCap = store.limits.maxTurns;
  let requestCapRemaining = store.limits.requestCapPerHour;
  let runSession: RunSession | null = null;
  let runTimer: ReturnType<typeof setTimeout> | null = null;
  let delegationRun: DelegationRun | null = null;
  let delegationTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingApprovals = new Map<string, ApprovalTicket>();
  let approvalQueue: ApprovalRequest[] = [];

  if (options.autoConfigureModel) store.setApiKey('sk-demo-not-a-real-key', now());

  const openWorkspace = (rootDisplayPath: string): WorkspaceInfo => {
    const label = rootDisplayPath.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace';
    const info: WorkspaceInfo = {
      workspaceId: nextId('ws'),
      rootLabel: label,
      rootDisplayPath,
      openedAtMs: now(),
    };
    workspace = info;
    sessionId = nextId('session');
    transcript = [];
    toolCalls = {};
    requestState = 'idle';
    turnCount = 0;
    requestCapRemaining = store.limits.requestCapPerHour;
    store.ensureSession(sessionId, now());
    store.rememberRecent(rootDisplayPath, label, now());
    auditEvent('workspace-open', 'ok', `Opened workspace ${label}`, 'user');
    return info;
  };

  const agentModel = (): AgentModel => ({
    sessionId,
    transcript,
    toolCallsById: toolCalls,
    request: { requestId: activeRequestId, state: requestState, turnCount, turnCap },
    modelState: store.modelState(),
    input: { draftText: '', maxChars: store.limits.maxInputChars },
    requestCapRemaining,
  });

  const statusModel = (): StatusBarModel => ({
    workspacePathDisplay: workspace ? workspace.rootDisplayPath : null,
    run: { state: runSession?.state ?? 'idle', label: runSession?.label ?? 'No run' },
    agent: { state: requestState, label: requestState === 'idle' ? 'JARVIS idle' : `JARVIS ${requestState}` },
    model: {
      state: store.modelState(),
      label: store.modelState() === 'configured' ? 'Model ready' : 'Model not configured',
    },
    audit: { logDir, retentionDays: store.auditRetentionDays },
    selection: null,
  });

  const pushStatus = (): void => emit({ type: 'status-changed', status: statusModel() });

  /* ---------------------------------------------------------- approvals */

  const requestApproval = async (
    kind: 'file-write' | 'delegation-launch',
    summary: string,
    detailLines: string[],
  ): Promise<'approved' | 'denied' | 'expired'> => {
    const approvalId = nextId('appr');
    const request: ApprovalRequest = {
      approvalId,
      kind,
      summary,
      detailLines,
      requestedAtMs: now(),
      expiresAtMs: now() + APPROVAL_TTL_MS,
    };
    auditEvent('approval-request', 'ok', `Approval requested: ${summary}`, 'system');
    approvalQueue = [...approvalQueue, request];
    return new Promise((resolve) => {
      const ticket: ApprovalTicket = { ...request, resolve };
      pendingApprovals.set(approvalId, ticket);
      emit({ type: 'approval-requested', request });
      const timer = setTimeout(() => {
        const live = pendingApprovals.get(approvalId);
        if (!live) return;
        pendingApprovals.delete(approvalId);
        approvalQueue = approvalQueue.filter((r) => r.approvalId !== approvalId);
        emit({ type: 'approval-resolved', approvalId, decision: 'expired' });
        auditEvent('approval-decision', 'denied', `Approval expired: ${summary}`, 'system');
        resolve('expired');
      }, APPROVAL_TTL_MS);
      ticket.timer = timer;
      // A lone timestamp-based expiry timer must never be the only reason the
      // event loop stays alive (Node keeps the process up for it).
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as unknown as { unref: () => void }).unref();
      }
    });
  };

  /* --------------------------------------------------------------- runs */

  const targets = (): CommandSpec[] => [
    {
      targetId: 'typecheck',
      label: 'typecheck',
      description: 'tsc --noEmit',
      argv: ['npm', 'run', 'typecheck'],
      envKeys: [],
      simulated: true,
    },
    {
      targetId: 'build',
      label: 'build',
      description: 'tsc --noEmit && vite build',
      argv: ['npm', 'run', 'build'],
      envKeys: [],
      simulated: true,
    },
    {
      targetId: 'test',
      label: 'test',
      description: 'run the unit tests',
      argv: ['npm', 'test'],
      envKeys: [],
      simulated: true,
    },
  ];

  const pushRunChunk = (chunk: ConsoleChunk): void => {
    if (!runSession) return;
    runSession = { ...runSession, chunks: [...runSession.chunks, chunk] };
    emit({ type: 'run', event: { type: 'run-chunk', runId: runSession.runId, chunk } });
  };

  const stopRun = (): void => {
    if (runTimer) {
      clearTimeout(runTimer);
      runTimer = null;
    }
    if (!runSession || (runSession.state !== 'running' && runSession.state !== 'starting')) return;
    runSession = { ...runSession, state: 'stopped', endedAtMs: now(), exitCode: null };
    pushRunChunk({ chunkId: nextId('chunk'), stream: 'system', text: 'Run stopped by user.', atMs: now() });
    emit({ type: 'run', event: { type: 'run-ended', runId: runSession.runId, state: 'stopped', exitCode: null } });
    auditEvent('run-stop', 'ok', `Stopped run ${runSession.label}`, 'user');
    pushStatus();
  };

  const startRun = (targetId: string): RunSession => {
    if (runSession && (runSession.state === 'running' || runSession.state === 'starting')) {
      throw new ActionError('run-busy', 'A run is already in flight. Stop it before starting another.');
    }
    const target = targets().find((t) => t.targetId === targetId);
    if (!target) throw new ActionError('invalid-input', `Unknown run target: ${targetId}`);

    const session: RunSession = {
      runId: nextId('run'),
      targetId: target.targetId,
      label: target.label,
      argv: target.argv,
      state: 'running',
      simulated: true,
      startedAtMs: now(),
      endedAtMs: null,
      exitCode: null,
      chunks: [],
    };
    runSession = session;
    emit({ type: 'run', event: { type: 'run-started', session } });
    auditEvent('run-start', 'ok', `Started ${target.label}: ${target.argv.join(' ')}`, 'user');
    pushStatus();

    const script: Array<{ stream: ConsoleChunk['stream']; text: string }> = [
      { stream: 'system', text: `$ ${target.argv.join(' ')}` },
      { stream: 'stdout', text: `> ${target.description}` },
      { stream: 'stdout', text: 'compiling src/contracts, src/backend, src/ui ...' },
      { stream: 'stdout', text: 'no type errors' },
      { stream: 'system', text: 'process exited with code 0' },
    ];
    let index = 0;
    const tick = (): void => {
      if (!runSession || runSession.state !== 'running') return;
      if (index >= script.length) {
        runSession = { ...runSession, state: 'succeeded', endedAtMs: now(), exitCode: 0 };
        emit({ type: 'run', event: { type: 'run-ended', runId: runSession.runId, state: 'succeeded', exitCode: 0 } });
        auditEvent('run-stop', 'ok', `Run ${runSession.label} succeeded`, 'system');
        pushStatus();
        return;
      }
      const step = script[index];
      index += 1;
      pushRunChunk({ chunkId: nextId('chunk'), stream: step.stream, text: step.text, atMs: now() });
      runTimer = setTimeout(tick, 260);
    };
    runTimer = setTimeout(tick, 120);
    return session;
  };

  /* ---------------------------------------------------------- delegation */

  const stopDelegation = (): void => {
    if (delegationTimer) {
      clearTimeout(delegationTimer);
      delegationTimer = null;
    }
    if (!delegationRun || (delegationRun.state !== 'running' && delegationRun.state !== 'launching')) return;
    delegationRun = { ...delegationRun, state: 'stopped', endedAtMs: now(), exitCode: null };
    emit({ type: 'delegation', event: { type: 'delegation-ended', runId: delegationRun.runId, state: 'stopped', exitCode: null } });
    auditEvent('delegation-stop', 'ok', 'Delegation stopped by user', 'user');
  };

  const launchDelegation = async (goal: string): Promise<DelegationRun> => {
    if (delegationRun && (delegationRun.state === 'running' || delegationRun.state === 'launching')) {
      throw new ActionError('delegation-busy', 'A delegation is already running.');
    }
    const decision = await requestApproval('delegation-launch', `Launch ${store.delegationCliLabel}`, [
      `Goal: ${goal}`,
      `CLI: ${store.delegationCliLabel}`,
      'This starts an external process with the workspace as its working directory.',
    ]);
    if (decision !== 'approved') {
      delegatedDenied(decision);
      throw new ActionError(
        decision === 'expired' ? 'approval-expired' : 'approval-denied',
        decision === 'expired' ? 'The approval request expired.' : 'The delegation was denied.',
      );
    }
    const run: DelegationRun = {
      runId: nextId('deleg'),
      goal,
      cliLabel: store.delegationCliLabel,
      state: 'running',
      startedAtMs: now(),
      endedAtMs: null,
      exitCode: null,
      chunks: [],
      simulated: true,
    };
    delegationRun = run;
    emit({ type: 'delegation', event: { type: 'delegation-started', run } });
    auditEvent('delegation-start', 'ok', `Launched ${store.delegationCliLabel}: ${goal}`, 'user');

    const script = [
      `$ ${store.delegationCliLabel} --goal "${goal}"`,
      'planning: split goal into 3 steps',
      'step 1/3: inspect workspace',
      'step 2/3: apply change',
      'step 3/3: verify',
      'done',
    ];
    let index = 0;
    const tick = (): void => {
      if (!delegationRun || delegationRun.state !== 'running') return;
      if (index >= script.length) {
        delegationRun = { ...delegationRun, state: 'succeeded', endedAtMs: now(), exitCode: 0 };
        emit({ type: 'delegation', event: { type: 'delegation-ended', runId: delegationRun.runId, state: 'succeeded', exitCode: 0 } });
        auditEvent('delegation-stop', 'ok', 'Delegation succeeded', 'system');
        return;
      }
      const text = script[index];
      index += 1;
      const chunk = { chunkId: nextId('dchunk'), stream: 'stdout' as const, text, atMs: now() };
      delegationRun = { ...delegationRun, chunks: [...delegationRun.chunks, chunk] };
      emit({ type: 'delegation', event: { type: 'delegation-chunk', runId: delegationRun.runId, chunk } });
      delegationTimer = setTimeout(tick, 400);
    };
    delegationTimer = setTimeout(tick, 200);
    return run;
  };

  const delegatedDenied = (decision: 'denied' | 'expired'): void => {
    auditEvent('delegation-start', 'denied', `Delegation ${decision}`, 'user');
  };

  /* --------------------------------------------------------------- agent */

  const scheduleAgent = (prompt: string): string => {
    const events: Array<{ event: import('../contracts').AgentEvent; delayMs: number }> = [];
    const requestId = runAgentTurn({
      vfs,
      prompt,
      sessionId,
      maxTurns: store.limits.maxTurns,
      nowMs: now,
      nextId,
      emit: (event, delayMs) => {
        events.push({ event, delayMs });
      },
    });
    requestState = 'thinking';
    activeRequestId = requestId;
    turnCap = store.limits.maxTurns;
    pushStatus();

    let offset = 0;
    for (const { event, delayMs } of events) {
      offset += delayMs;
      setTimeout(() => applyAgentEvent(event), offset);
    }
    return requestId;
  };

  const applyAgentEvent = (event: import('../contracts').AgentEvent): void => {
    switch (event.type) {
      case 'request-started':
        requestState = 'thinking';
        break;
      case 'entry-started':
        transcript = [...transcript, event.entry];
        break;
      case 'delta':
        transcript = transcript.map((entry) =>
          entry.entryId === event.entryId ? { ...entry, text: entry.text + event.text } : entry,
        );
        requestState = 'answering';
        break;
      case 'tool-call':
      case 'tool-call-updated': {
        const record = event.record;
        toolCalls = { ...toolCalls, [record.toolCallId]: record };
        if (event.type === 'tool-call') requestState = 'awaiting-tool';
        const target = transcript.find((e) => e.streaming && e.role === 'assistant');
        if (target && !target.toolCallIds.includes(record.toolCallId)) {
          transcript = transcript.map((e) =>
            e.entryId === target.entryId ? { ...e, toolCallIds: [...e.toolCallIds, record.toolCallId] } : e,
          );
        }
        if (event.type === 'tool-call-updated') {
          auditEvent(
            record.outcome === 'ok' ? 'tool-call' : 'tool-refusal',
            record.outcome === 'ok' ? 'ok' : 'refused',
            `${record.toolName}: ${record.resultSummary ?? record.outcome}`,
            'agent',
            { toolName: record.toolName },
          );
        }
        break;
      }
      case 'entry-completed':
        transcript = transcript.map((entry) =>
          entry.entryId === event.entryId ? { ...entry, streaming: false } : entry,
        );
        break;
      case 'turn-progress':
        turnCount = event.turnCount;
        turnCap = event.turnCap;
        break;
      case 'request-ended': {
        requestState = event.state;
        activeRequestId = null;
        const record = store.ensureSession(sessionId, now());
        record.entries = [...transcript];
        record.toolCalls = Object.values(toolCalls);
        record.updatedAtMs = now();
        const firstUser = transcript.find((e) => e.role === 'user');
        record.title = firstUser ? firstUser.text.slice(0, 60) : 'Session';
        auditEvent('agent-response', 'ok', `Agent request ended: ${event.state}`, 'agent');
        pushStatus();
        break;
      }
      default:
        break;
    }
    emit({ type: 'agent', event });
  };

  /* -------------------------------------------------------------- bridge */

  const guard = async <T>(fn: () => Promise<T> | T): Promise<BridgeResult<T>> => {
    try {
      return bridgeOk(await fn());
    } catch (err) {
      if (err instanceof ActionError) return bridgeErr(err.code, err.message, err.remediation);
      const message = err instanceof Error ? err.message : 'unexpected error';
      return bridgeErr('internal', message);
    }
  };

  const requireWorkspace = (): WorkspaceInfo => {
    if (!workspace) throw new ActionError('no-workspace', 'Open a workspace first.');
    return workspace;
  };

  const buildModel = (relPath: string): MarkdownPreviewModel => {
    const entry = readFile(vfs, relPath);
    if (!entry) throw new ActionError('missing', `No such file: ${relPath}`);
    return parseMarkdown(relPath, entry.content ?? '');
  };

  return {
    workspace: {
      current: () => guard(() => workspace),
      recents: () => guard<readonly RecentWorkspace[]>(() => store.recents),
      open: (rootDisplayPath) =>
        guard(() => {
          if (rootDisplayPath === null || rootDisplayPath.trim().length === 0) {
            throw new ActionError('invalid-input', 'A workspace path is required.');
          }
          return openWorkspace(rootDisplayPath.trim());
        }),
      close: () =>
        guard(() => {
          if (workspace) auditEvent('workspace-close', 'ok', `Closed ${workspace.rootLabel}`, 'user');
          workspace = null;
          pushStatus();
          return null;
        }),
    },

    tree: {
      listChildren: (request: ListChildrenRequest) =>
        guard<TreeNodePage>(() => {
          requireWorkspace();
          const parent = request.parentRelPath === null ? '' : normalizeRelPath(request.parentRelPath);
          const all = listDir(vfs, parent)
            .filter((e) => isVisibleName(e.relPath.split('/').pop() ?? ''))
            .sort((a, b) => {
              if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
              return (a.relPath.split('/').pop() ?? '').localeCompare(b.relPath.split('/').pop() ?? '');
            });
          const limit = Math.min(Math.max(request.limit ?? 200, 1), 500);
          const offset = request.cursor ? Number.parseInt(request.cursor, 10) || 0 : 0;
          const slice = all.slice(offset, offset + limit);
          const entries = slice.map((e) => {
            const name = e.relPath.split('/').pop() ?? e.relPath;
            const isDir = e.kind === 'dir';
            const node = {
              nodeId: `n-${e.relPath.replace(/[^a-z0-9]/gi, '-')}`,
              relPath: e.relPath,
              name,
              kind: e.kind,
              hasChildren: isDir && listDir(vfs, e.relPath).length > 0,
            } as const;
            if (isDir) return node;
            return {
              ...node,
              language: languageFor(e.relPath),
              sizeBytes: (e.content ?? '').length,
              mtimeMs: e.mtimeMs,
            };
          });
          const nextOffset = offset + slice.length;
          return {
            parentRelPath: request.parentRelPath,
            entries,
            nextCursor: nextOffset < all.length ? String(nextOffset) : null,
            truncated: all.length > 1500,
            scannedFiles: all.length,
          };
        }),
    },

    files: {
      read: (relPath: string) =>
        guard<FileReadResult>(() => {
          requireWorkspace();
          const rel = normalizeRelPath(relPath);
          const entry = readFile(vfs, rel);
          if (!entry) throw new ActionError('missing', `No such file: ${rel}`);
          const content = entry.content ?? '';
          const language = languageFor(rel);
          if (language === 'binary') throw new ActionError('binary-file', `${rel} is a binary file.`);
          const truncated = content.length > store.maxFileReadBytes;
          return {
            relPath: rel,
            content: truncated ? content.slice(0, store.maxFileReadBytes) : content,
            encoding: 'utf-8',
            eol: content.includes('\r\n') ? 'crlf' : 'lf',
            language,
            sizeBytes: content.length,
            truncated,
            savedSha: `sha-${content.length}-${content.charCodeAt(0) || 0}`,
          };
        }),
      save: (request: SaveRequest) =>
        guard<SaveResult>(() => {
          requireWorkspace();
          const rel = normalizeWritePath(request.relPath);
          if (typeof request.content !== 'string') throw new ActionError('invalid-input', 'content must be a string');
          const entry = writeFile(vfs, rel, request.content, now());
          const result: SaveResult = {
            ok: true,
            relPath: rel,
            bytesWritten: request.content.length,
            encoding: 'utf-8',
            eol: request.content.includes('\r\n') ? 'crlf' : 'lf',
            savedSha: `sha-${entry.content?.length ?? 0}-${entry.content?.charCodeAt(0) || 0}`,
            savedAtMs: now(),
          };
          auditEvent('file-save', 'ok', `Saved ${rel}`, 'user', { targetRelPath: rel });
          return result;
        }),
      agentWrite: (relPath: string, content: string) =>
        guard<SaveResult>(async () => {
          requireWorkspace();
          const rel = normalizeWritePath(relPath);
          const decision = await requestApproval('file-write', `Write ${rel}`, [
            `File: ${rel}`,
            `New size: ${content.length} characters`,
            'The agent proposed this change; nothing is written until you approve.',
          ]);
          if (decision !== 'approved') {
            auditEvent('file-save', 'denied', `Agent write denied: ${rel}`, 'agent', { targetRelPath: rel });
            throw new ActionError(
              decision === 'expired' ? 'approval-expired' : 'approval-denied',
              decision === 'expired' ? 'The approval request expired.' : 'The write was denied.',
            );
          }
          const entry = writeFile(vfs, rel, content, now());
          auditEvent('file-save', 'ok', `Agent wrote ${rel}`, 'agent', { targetRelPath: rel });
          return {
            ok: true,
            relPath: rel,
            bytesWritten: content.length,
            encoding: 'utf-8',
            eol: content.includes('\r\n') ? 'crlf' : 'lf',
            savedSha: `sha-${entry.content?.length ?? 0}-${entry.content?.charCodeAt(0) || 0}`,
            savedAtMs: now(),
          };
        }),
      markdown: (relPath: string) => guard<MarkdownPreviewModel>(() => {
        requireWorkspace();
        return buildModel(normalizeRelPath(relPath));
      }),
    },

    run: {
      targets: () => guard<readonly CommandSpec[]>(() => targets()),
      session: () => guard(() => runSession),
      start: (request) =>
        guard<RunSession>(() => {
          requireWorkspace();
          if (!isRecord(request) || typeof request.targetId !== 'string') {
            throw new ActionError('invalid-input', 'targetId is required');
          }
          return startRun(request.targetId);
        }),
      stop: () => guard(() => {
        stopRun();
        return null;
      }),
    },

    agent: {
      state: () => guard(() => agentModel()),
      send: (request: AgentSendRequest) =>
        guard<{ requestId: string }>(() => {
          requireWorkspace();
          if (!isRecord(request)) throw new ActionError('invalid-input', 'request body is required');
          const text = requireString(request.text, 'text', store.limits.maxInputChars).trim();
          if (text.length === 0) throw new ActionError('invalid-input', 'Message is empty.');
          if (requestCapRemaining <= 0) {
            throw new ActionError('request-cap', 'The hourly request cap is reached.');
          }
          if (store.modelState() !== 'configured') {
            throw new ActionError('model-not-configured', 'Configure a model before sending.');
          }
          requestCapRemaining -= 1;
          transcript = [
            ...transcript,
            {
              entryId: nextId('ent'),
              role: 'user',
              origin: 'human',
              text,
              atMs: now(),
              streaming: false,
              toolCallIds: [],
            },
          ];
          auditEvent('agent-request', 'ok', `User request (${text.length} chars)`, 'user');
          const requestId = scheduleAgent(text);
          return { requestId };
        }),
      stop: () => guard(() => {
        requestState = 'stopped';
        activeRequestId = null;
        auditEvent('agent-response', 'ok', 'Agent stopped by user', 'user');
        pushStatus();
        return null;
      }),
      retryLast: () =>
        guard<{ requestId: string }>(() => {
          requireWorkspace();
          const lastUser = [...transcript].reverse().find((e) => e.role === 'user');
          if (!lastUser) throw new ActionError('invalid-input', 'There is nothing to retry.');
          return { requestId: scheduleAgent(lastUser.text) };
        }),
      clearConversation: () =>
        guard(() => {
          transcript = [];
          toolCalls = {};
          requestState = 'idle';
          turnCount = 0;
          pushStatus();
          return null;
        }),
    },

    session: {
      list: () => guard(() => store.sessionSummaries()),
      load: (sessionIdArg: string) =>
        guard(() => {
          const record = store.sessions.get(sessionIdArg);
          if (!record) throw new ActionError('missing', 'No such session.');
          return {
            sessionId: record.sessionId,
            title: record.title,
            entries: record.entries,
            toolCalls: record.toolCalls,
          };
        }),
      clear: (sessionIdArg: string) =>
        guard(() => {
          store.sessions.delete(sessionIdArg);
          if (sessionIdArg === sessionId) transcript = [];
          auditEvent('settings-change', 'ok', `Cleared session ${sessionIdArg}`, 'user');
          return null;
        }),
      clearAll: () =>
        guard(() => {
          store.sessions.clear();
          transcript = [];
          auditEvent('settings-change', 'ok', 'Cleared all sessions', 'user');
          return null;
        }),
    },

    delegation: {
      current: () => guard(() => delegationRun),
      launch: (request) =>
        guard<DelegationRun>(() => {
          requireWorkspace();
          if (!isRecord(request)) throw new ActionError('invalid-input', 'request body is required');
          const goal = requireString(request.goal, 'goal', 2_000).trim();
          if (goal.length === 0) throw new ActionError('invalid-input', 'Goal is empty.');
          return launchDelegation(goal);
        }),
      stop: () => guard(() => {
        stopDelegation();
        return null;
      }),
    },

    approval: {
      pending: () => guard<ApprovalRequest | null>(() => approvalQueue[0] ?? null),
      respond: (request: ApprovalResponseRequest) =>
        guard(() => {
          if (!isRecord(request)) throw new ActionError('invalid-input', 'request body is required');
          const approvalId = requireString(request.approvalId, 'approvalId', 128);
          const decision = request.decision === 'approved' ? 'approved' : 'denied';
          const ticket = pendingApprovals.get(approvalId);
          if (!ticket) throw new ActionError('approval-expired', 'That approval request is no longer valid.');
          if (ticket.timer) clearTimeout(ticket.timer);
          pendingApprovals.delete(approvalId);
          approvalQueue = approvalQueue.filter((r) => r.approvalId !== approvalId);
          emit({ type: 'approval-resolved', approvalId, decision });
          auditEvent('approval-decision', decision === 'approved' ? 'ok' : 'denied', `${decision}: ${ticket.summary}`, 'user');
          ticket.resolve(decision);
          return decision;
        }),
    },

    settings: {
      get: () => guard(() => store.view()),
      patch: (patch: LlmSettingsPatch) =>
        guard(() => {
          if (!patch || typeof patch !== 'object') {
            throw new ActionError('invalid-input', 'patch body is required');
          }
          const body: LlmSettingsPatch = patch;
          if (body.theme) store.theme = body.theme;
          if (typeof body.delegationCliLabel === 'string') store.delegationCliLabel = body.delegationCliLabel;
          if (typeof body.auditRetentionDays === 'number') store.auditRetentionDays = Math.min(Math.max(body.auditRetentionDays, 1), 365);
          if (body.limits) {
            const limits = body.limits;
            if (typeof limits.maxTurns === 'number') store.limits.maxTurns = Math.min(Math.max(Math.floor(limits.maxTurns), 1), 20);
            if (typeof limits.maxInputChars === 'number') store.limits.maxInputChars = Math.min(Math.max(Math.floor(limits.maxInputChars), 200), 20_000);
            if (typeof limits.requestCapPerHour === 'number') store.limits.requestCapPerHour = Math.min(Math.max(Math.floor(limits.requestCapPerHour), 1), 500);
          }
          const view = store.view();
          emit({ type: 'settings-changed', view });
          auditEvent('settings-change', 'ok', `Settings updated: theme=${view.theme}`, 'user');
          pushStatus();
          return view;
        }),
      setApiKey: (input) =>
        guard(() => {
          if (!isRecord(input)) throw new ActionError('invalid-input', 'api key body is required');
          const key = requireString(input.apiKey, 'apiKey', 512).trim();
          if (key.length < 8) throw new ActionError('invalid-input', 'That does not look like an API key.');
          store.setApiKey(key, now());
          auditEvent('secret-set', 'ok', 'API key set (value never logged)', 'user');
          emit({ type: 'settings-changed', view: store.view() });
          pushStatus();
          return store.secretState();
        }),
      clearApiKey: () =>
        guard(() => {
          store.clearApiKey(now());
          auditEvent('secret-cleared', 'ok', 'API key cleared', 'user');
          emit({ type: 'settings-changed', view: store.view() });
          pushStatus();
          return store.secretState();
        }),
    },

    audit: {
      page: (request) => guard(() => audit.page(request ?? {})),
      location: () => guard(() => ({ logDir, retentionDays: store.auditRetentionDays })),
    },

    status: {
      get: () => guard(() => statusModel()),
    },

    subscribe: (listener: BridgeListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
