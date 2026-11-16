// xcoder:version 2 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:31:52.025Z | xcoder:subtask code-st-1de5aa
/**
 * The renderer-side application store.
 *
 * It holds page models and talks to the backend only through DojoBridge.
 * Nothing here decides policy: a refused BridgeResult becomes a toast, and the
 * UI never assumes an action succeeded (UI-01).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AppError,
  ApprovalRequest,
  BridgeEvent,
  BridgeResult,
  CommandSpec,
  DelegationRun,
  DojoBridge,
  EditorTabState,
  ExplorerModel,
  LlmSettingsView,
  MarkdownPreviewModel,
  RecentWorkspace,
  RunSession,
  StatusBarModel,
  TreeNodePage,
  WorkspaceInfo,
} from '../contracts';
import {
  ActionsContext,
  StateContext,
  initialExplorer,
  type AppActions,
  type AppState,
  type OverlayName,
  type Toast,
} from './store';

let counter = 0;
const localId = (prefix: string): string => {
  counter += 1;
  return `${prefix}-${counter}`;
};

export interface AppProviderProps {
  bridge: DojoBridge;
  children: ReactNode;
}

export function AppProvider({ bridge, children }: AppProviderProps): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [recents, setRecents] = useState<readonly RecentWorkspace[]>([]);
  const [settings, setSettings] = useState<LlmSettingsView | null>(null);
  const [status, setStatus] = useState<StatusBarModel | null>(null);
  const [explorer, setExplorer] = useState(initialExplorer);
  const [tabs, setTabs] = useState<EditorTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<MarkdownPreviewModel | null>(null);
  const [runTargets, setRunTargets] = useState<readonly CommandSpec[]>([]);
  const [runSession, setRunSession] = useState<RunSession | null>(null);
  const [delegation, setDelegation] = useState<DelegationRun | null>(null);
  const [agent, setAgent] = useState<AppState['agent']>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState<OverlayName>(null);
  const toastSeq = useRef(0);

  const pushError = useCallback((error: AppError): void => {
    toastSeq.current += 1;
    setToasts((prev) => [
      ...prev.slice(-4),
      {
        toastId: `toast-${toastSeq.current}`,
        error,
        atMs: Date.now(),
        dismissed: false,
        ...(error.remediation ? { remediation: error.remediation } : {}),
      },
    ]);
  }, []);

  const unwrap = useCallback(
    async <T,>(p: Promise<BridgeResult<T>>): Promise<T | null> => {
      const result = await p;
      if (result.ok) return result.value;
      pushError(result.error);
      return null;
    },
    [pushError],
  );

  const refreshAgent = useCallback(async (): Promise<void> => {
    const model = await unwrap(bridge.agent.state());
    if (model) setAgent(model);
  }, [bridge, unwrap]);

  const refreshStatus = useCallback(async (): Promise<void> => {
    const s = await unwrap(bridge.status.get());
    if (s) setStatus(s);
  }, [bridge, unwrap]);

  const refreshSettings = useCallback(async (): Promise<void> => {
    const s = await unwrap(bridge.settings.get());
    if (s) setSettings(s);
  }, [bridge, unwrap]);

  useEffect(() => {
    void (async () => {
      setRecents((await unwrap(bridge.workspace.recents())) ?? []);
      setRunTargets((await unwrap(bridge.run.targets())) ?? []);
      await refreshSettings();
      await refreshStatus();
    })();
  }, [bridge, unwrap, refreshSettings, refreshStatus]);

  useEffect(() => {
    return bridge.subscribe((event: BridgeEvent) => {
      switch (event.type) {
        case 'agent':
          void refreshAgent();
          break;
        case 'run':
          if (event.event.type === 'run-started') setRunSession(event.event.session);
          if (event.event.type === 'run-chunk') {
            const chunk = event.event.chunk;
            const runId = event.event.runId;
            setRunSession((prev) =>
              prev && prev.runId === runId ? { ...prev, chunks: [...prev.chunks, chunk] } : prev,
            );
          }
          if (event.event.type === 'run-ended') {
            const { runId, state, exitCode } = event.event;
            setRunSession((prev) =>
              prev && prev.runId === runId ? { ...prev, state, exitCode, endedAtMs: Date.now() } : prev,
            );
            void refreshStatus();
          }
          break;
        case 'delegation':
          if (event.event.type === 'delegation-started') setDelegation(event.event.run);
          if (event.event.type === 'delegation-chunk') {
            const chunk = event.event.chunk;
            const runId = event.event.runId;
            setDelegation((prev) =>
              prev && prev.runId === runId ? { ...prev, chunks: [...prev.chunks, chunk] } : prev,
            );
          }
          if (event.event.type === 'delegation-ended') {
            const { runId, state, exitCode } = event.event;
            setDelegation((prev) =>
              prev && prev.runId === runId ? { ...prev, state, exitCode, endedAtMs: Date.now() } : prev,
            );
          }
          break;
        case 'approval-requested':
          setApproval(event.request);
          break;
        case 'approval-resolved':
          setApproval((prev) => (prev && prev.approvalId === event.approvalId ? null : prev));
          break;
        case 'settings-changed':
          setSettings(event.view);
          break;
        case 'status-changed':
          setStatus(event.status);
          break;
        case 'error':
          pushError(event.toast.error);
          break;
        default:
          break;
      }
    });
  }, [bridge, refreshAgent, refreshStatus, pushError]);

  const actions = useMemo<AppActions>(
    () => ({
      async openWorkspace(path) {
        setBusy(true);
        const info = await unwrap(bridge.workspace.open(path));
        setBusy(false);
        if (!info) return;
        setWorkspace(info);
        setExplorer({ ...initialExplorer, workspaceRootLabel: info.rootLabel });
        setTabs([]);
        setActiveTabId(null);
        setBuffers({});
        setPreview(null);
        setRunSession(null);
        setDelegation(null);
        const root = await unwrap(bridge.tree.listChildren({ parentRelPath: null }));
        if (root) {
          setExplorer((prev) => ({ ...prev, nodesByParent: { ...prev.nodesByParent, '': root } }));
        }
        setRecents((await unwrap(bridge.workspace.recents())) ?? []);
        await refreshAgent();
        await refreshStatus();
      },

      async closeWorkspace() {
        await unwrap(bridge.workspace.close());
        setWorkspace(null);
        setExplorer(initialExplorer);
        setTabs([]);
        setActiveTabId(null);
        setPreview(null);
        setAgent(null);
        await refreshStatus();
      },

      async expandDir(parent) {
        const key = parent ?? '';
        setExplorer((prev) =>
          prev.expandedRelPaths.includes(key) || key === ''
            ? prev
            : { ...prev, expandedRelPaths: [...prev.expandedRelPaths, key] },
        );
        setExplorer((prev) => ({ ...prev, loadingParents: [...prev.loadingParents, key] }));
        const page = await unwrap(bridge.tree.listChildren({ parentRelPath: parent }));
        setExplorer((prev) => ({
          ...prev,
          nodesByParent: page ? { ...prev.nodesByParent, [key]: page } : prev.nodesByParent,
          expandedRelPaths: parent ? [...new Set([...prev.expandedRelPaths, parent])] : prev.expandedRelPaths,
          loadingParents: prev.loadingParents.filter((p) => p !== key),
        }));
      },

      collapseDir(relPath) {
        setExplorer((prev) => ({
          ...prev,
          expandedRelPaths: prev.expandedRelPaths.filter((p) => p !== relPath),
        }));
      },

      setFilter(text) {
        setExplorer((prev) => ({
          ...prev,
          filterText: text,
          filter: { text, applied: text.length > 0 },
        }));
      },

      async openFile(relPath) {
        const file = await unwrap(bridge.files.read(relPath));
        if (!file) return;
        const existing = tabs.find((t) => t.relPath === relPath);
        if (existing) {
          setActiveTabId(existing.tabId);
          if (existing.kind === 'markdown') {
            const model = await unwrap(bridge.files.markdown(relPath));
            if (model) setPreview(model);
          }
          return;
        }
        const tabId = localId('tab');
        const isMarkdown = file.language === 'markdown';
        const tab: EditorTabState = {
          tabId,
          relPath: file.relPath,
          kind: isMarkdown ? 'markdown' : 'text',
          language: file.language,
          encoding: file.encoding,
          eol: file.eol,
          dirty: false,
          readOnly: file.truncated,
          truncated: file.truncated,
          savedSha: file.savedSha,
        };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tabId);
        setBuffers((prev) => ({ ...prev, [tabId]: file.content }));
        if (isMarkdown) {
          const model = await unwrap(bridge.files.markdown(relPath));
          if (model) setPreview(model);
        } else {
          setPreview(null);
        }
        setExplorer((prev) => ({ ...prev, selection: { relPath, kind: 'file' } }));
        await refreshStatus();
      },

      async closeTab(tabId) {
        setTabs((prev) => prev.filter((t) => t.tabId !== tabId));
        setBuffers((prev) => {
          const next = { ...prev };
          delete next[tabId];
          return next;
        });
        setActiveTabId((prev) => (prev === tabId ? null : prev));
      },

      activateTab(tabId) {
        setActiveTabId(tabId);
        const tab = tabs.find((t) => t.tabId === tabId);
        if (tab && tab.kind === 'markdown') {
          void (async () => {
            const model = await unwrap(bridge.files.markdown(tab.relPath));
            if (model) setPreview(model);
          })();
        } else {
          setPreview(null);
        }
      },

      editBuffer(tabId, value) {
        setBuffers((prev) => ({ ...prev, [tabId]: value }));
        setTabs((prev) => prev.map((t) => (t.tabId === tabId ? { ...t, dirty: true } : t)));
      },

      async saveTab(tabId) {
        const tab = tabs.find((t) => t.tabId === tabId);
        if (!tab) return;
        const content = buffers[tabId] ?? '';
        const result = await unwrap(
          bridge.files.save({
            tabId,
            relPath: tab.relPath,
            content,
            baseSha: tab.savedSha ?? '',
            writeNewFile: tab.savedSha === null,
          }),
        );
        if (!result) return;
        setTabs((prev) =>
          prev.map((t) => (t.tabId === tabId ? { ...t, dirty: false, savedSha: result.savedSha } : t)),
        );
        if (tab.kind === 'markdown') {
          const model = await unwrap(bridge.files.markdown(tab.relPath));
          if (model) setPreview(model);
        }
      },

      async startRun(targetId) {
        const session = await unwrap(bridge.run.start({ targetId }));
        if (session) setRunSession(session);
      },

      async stopRun() {
        await unwrap(bridge.run.stop());
      },

      async sendAgent(text) {
        const result = await unwrap(
          bridge.agent.send({
            text,
            sessionId: agent?.sessionId ?? '',
            workspaceId: workspace?.workspaceId ?? '',
          }),
        );
        if (result) await refreshAgent();
      },

      async stopAgent() {
        await unwrap(bridge.agent.stop());
        await refreshAgent();
      },

      async clearAgent() {
        await unwrap(bridge.agent.clearConversation());
        await refreshAgent();
      },

      async launchDelegation(goal) {
        const run = await unwrap(bridge.delegation.launch({ goal }));
        if (run) setDelegation(run);
      },

      async stopDelegation() {
        await unwrap(bridge.delegation.stop());
      },

      async respondApproval(decision) {
        if (!approval) return;
        await unwrap(bridge.approval.respond({ approvalId: approval.approvalId, decision }));
        setApproval(null);
      },

      async patchSettings(patch) {
        const view = await unwrap(bridge.settings.patch(patch));
        if (view) setSettings(view);
      },

      async setApiKey(key) {
        const state = await unwrap(bridge.settings.setApiKey({ apiKey: key }));
        if (state) await refreshSettings();
      },

      async clearApiKey() {
        await unwrap(bridge.settings.clearApiKey());
        await refreshSettings();
      },

      setOverlay(next) {
        setOverlay(next);
      },

      pushError(error) {
        pushError(error);
      },

      dismissToast(toastId) {
        setToasts((prev) => prev.filter((t) => t.toastId !== toastId));
      },
    }),
    [
      bridge,
      unwrap,
      refreshAgent,
      refreshSettings,
      refreshStatus,
      tabs,
      buffers,
      agent,
      workspace,
      approval,
      pushError,
    ],
  );

  const explorerState = useMemo(() => explorer, [explorer]);

  const state: AppState = {
    bridge,
    workspace,
    recents,
    settings,
    status,
    explorer: explorerState,
    editor: { tabs, activeTabId, buffers },
    preview,
    run: { targets: runTargets, session: runSession },
    delegation,
    agent,
    approval,
    toasts,
    busy,
    overlay,
  };

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

export type { ExplorerModel, TreeNodePage };
