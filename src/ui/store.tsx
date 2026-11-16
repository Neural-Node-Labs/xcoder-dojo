// xcoder:version 2 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:31:54.371Z | xcoder:subtask code-st-1de5aa
/**
 * Renderer-side store types, contexts and hooks.
 *
 * The provider (AppProvider.tsx) owns the state; pages only ever read through
 * `useAppState` and write through `useAppActions`. No page talks to a path or a
 * process directly - every effect is a DojoBridge call.
 */

import { createContext, useContext } from 'react';
import type {
  AgentModel,
  AppError,
  ApprovalRequest,
  CommandSpec,
  DelegationRun,
  DojoBridge,
  EditorTabState,
  ErrorToast,
  ExplorerModel,
  LlmSettingsPatch,
  LlmSettingsView,
  MarkdownPreviewModel,
  RecentWorkspace,
  RunSession,
  StatusBarModel,
  TreeNodePage,
  WorkspaceInfo,
} from '../contracts';

export interface Toast extends ErrorToast {
  remediation?: string;
}

export interface ExplorerState extends ExplorerModel {
  /** Leaf nodes are tracked here so filter/search can run over loaded nodes. */
  filterText: string;
}

export interface RunStateSlice {
  targets: readonly CommandSpec[];
  session: RunSession | null;
}

export interface AppState {
  bridge: DojoBridge;
  workspace: WorkspaceInfo | null;
  recents: readonly RecentWorkspace[];
  settings: LlmSettingsView | null;
  status: StatusBarModel | null;
  explorer: ExplorerState;
  editor: {
    tabs: EditorTabState[];
    activeTabId: string | null;
    buffers: Record<string, string>;
  };
  preview: MarkdownPreviewModel | null;
  run: RunStateSlice;
  delegation: DelegationRun | null;
  agent: AgentModel | null;
  approval: ApprovalRequest | null;
  toasts: Toast[];
  busy: boolean;
  overlay: OverlayName;
}

export type OverlayName = null | 'settings' | 'history' | 'audit';

export interface AppActions {
  openWorkspace(path: string): Promise<void>;
  closeWorkspace(): Promise<void>;
  expandDir(parent: string | null, force?: boolean): Promise<void>;
  collapseDir(relPath: string): void;
  setFilter(text: string): void;
  openFile(relPath: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  activateTab(tabId: string): void;
  editBuffer(tabId: string, value: string): void;
  saveTab(tabId: string): Promise<void>;
  startRun(targetId: string): Promise<void>;
  stopRun(): Promise<void>;
  sendAgent(text: string): Promise<void>;
  stopAgent(): Promise<void>;
  clearAgent(): Promise<void>;
  launchDelegation(goal: string): Promise<void>;
  stopDelegation(): Promise<void>;
  respondApproval(decision: 'approved' | 'denied'): Promise<void>;
  patchSettings(patch: LlmSettingsPatch): Promise<void>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
  setOverlay(overlay: OverlayName): void;
  pushError(error: AppError): void;
  dismissToast(toastId: string): void;
}

export const StateContext = createContext<AppState | null>(null);
export const ActionsContext = createContext<AppActions | null>(null);

export function useAppState(): AppState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error('useAppState must be used inside <AppProvider>');
  return ctx;
}

export function useAppActions(): AppActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useAppActions must be used inside <AppProvider>');
  return ctx;
}

export const initialExplorer: ExplorerState = {
  workspaceRootLabel: '',
  nodesByParent: {},
  expandedRelPaths: [],
  selection: null,
  filter: { text: '', applied: false },
  loadingParents: [],
  filterText: '',
};

export type { TreeNodePage };
