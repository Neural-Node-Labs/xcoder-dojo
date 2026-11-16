// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:28:15.049Z | xcoder:subtask code-st-1de5aa
/**
 * DojoBridge - the entire privileged surface exposed to the UI.
 *
 * There is no ipcRenderer passthrough: every method is explicitly named,
 * validated in the backend and returns a BridgeResult. Nothing here can read
 * back an API key.
 */

import type { BridgeResult, AppError } from './errors';
import type {
  ListChildrenRequest,
  TreeNodePage,
  WorkspaceInfo,
  RecentWorkspace,
  FileReadResult,
  SaveRequest,
  SaveResult,
  MarkdownPreviewModel,
} from './models-workspace';
import type {
  AgentEvent,
  AgentModel,
  AgentSendRequest,
  CommandSpec,
  RunEvent,
  RunSession,
  RunStartRequest,
} from './models-execution';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResponseRequest,
  DelegationEvent,
  DelegationLaunchRequest,
  DelegationRun,
} from './models-delegation';
import type {
  ApiKeyInput,
  AuditEventView,
  AuditLocation,
  AuditPage,
  AuditPageRequest,
  ErrorToast,
  LlmSettingsPatch,
  LlmSettingsView,
  SecretState,
  SessionDetail,
  SessionSummary,
  StatusBarModel,
} from './models-settings';

export type BridgeEvent =
  | { type: 'agent'; event: AgentEvent }
  | { type: 'run'; event: RunEvent }
  | { type: 'delegation'; event: DelegationEvent }
  | { type: 'approval-requested'; request: ApprovalRequest }
  | { type: 'approval-resolved'; approvalId: string; decision: ApprovalDecision }
  | { type: 'audit'; event: AuditEventView }
  | { type: 'settings-changed'; view: LlmSettingsView }
  | { type: 'status-changed'; status: StatusBarModel }
  | { type: 'error'; toast: ErrorToast };

export type BridgeListener = (event: BridgeEvent) => void;

export interface WorkspaceApi {
  current(): Promise<BridgeResult<WorkspaceInfo | null>>;
  recents(): Promise<BridgeResult<readonly RecentWorkspace[]>>;
  open(rootDisplayPath: string | null): Promise<BridgeResult<WorkspaceInfo>>;
  close(): Promise<BridgeResult<null>>;
}

export interface TreeApi {
  listChildren(request: ListChildrenRequest): Promise<BridgeResult<TreeNodePage>>;
}

export interface FilesApi {
  read(relPath: string): Promise<BridgeResult<FileReadResult>>;
  save(request: SaveRequest): Promise<BridgeResult<SaveResult>>;
  /** Approval-gated write requested on the agent's behalf (kind: file-write). */
  agentWrite(relPath: string, content: string): Promise<BridgeResult<SaveResult>>;
  markdown(relPath: string): Promise<BridgeResult<MarkdownPreviewModel>>;
}

export interface RunApi {
  targets(): Promise<BridgeResult<readonly CommandSpec[]>>;
  session(): Promise<BridgeResult<RunSession | null>>;
  start(request: RunStartRequest): Promise<BridgeResult<RunSession>>;
  stop(): Promise<BridgeResult<null>>;
}

export interface AgentApi {
  state(): Promise<BridgeResult<AgentModel>>;
  send(request: AgentSendRequest): Promise<BridgeResult<{ requestId: string }>>;
  stop(): Promise<BridgeResult<null>>;
  retryLast(): Promise<BridgeResult<{ requestId: string }>>;
  clearConversation(): Promise<BridgeResult<null>>;
}

export interface SessionApi {
  list(): Promise<BridgeResult<readonly SessionSummary[]>>;
  load(sessionId: string): Promise<BridgeResult<SessionDetail>>;
  clear(sessionId: string): Promise<BridgeResult<null>>;
  clearAll(): Promise<BridgeResult<null>>;
}

export interface DelegationApi {
  current(): Promise<BridgeResult<DelegationRun | null>>;
  launch(request: DelegationLaunchRequest): Promise<BridgeResult<DelegationRun>>;
  stop(): Promise<BridgeResult<null>>;
}

export interface ApprovalApi {
  pending(): Promise<BridgeResult<ApprovalRequest | null>>;
  respond(request: ApprovalResponseRequest): Promise<BridgeResult<ApprovalDecision>>;
}

export interface SettingsApi {
  get(): Promise<BridgeResult<LlmSettingsView>>;
  patch(patch: LlmSettingsPatch): Promise<BridgeResult<LlmSettingsView>>;
  setApiKey(input: ApiKeyInput): Promise<BridgeResult<SecretState>>;
  clearApiKey(): Promise<BridgeResult<SecretState>>;
}

export interface AuditApi {
  page(request: AuditPageRequest): Promise<BridgeResult<AuditPage>>;
  location(): Promise<BridgeResult<AuditLocation>>;
}

export interface StatusApi {
  get(): Promise<BridgeResult<StatusBarModel>>;
}

export interface DojoBridge {
  readonly workspace: WorkspaceApi;
  readonly tree: TreeApi;
  readonly files: FilesApi;
  readonly run: RunApi;
  readonly agent: AgentApi;
  readonly session: SessionApi;
  readonly delegation: DelegationApi;
  readonly approval: ApprovalApi;
  readonly settings: SettingsApi;
  readonly audit: AuditApi;
  readonly status: StatusApi;
  subscribe(listener: BridgeListener): () => void;
}

export type { AppError };
