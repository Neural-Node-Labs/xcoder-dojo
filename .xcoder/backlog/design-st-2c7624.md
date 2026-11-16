<!-- xcoder:version 17 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:24:04.983Z | xcoder:subtask design-st-2c7624 -->
# Design: xcoder-dojo — UI / Page Specification (TypeScript UI + Agent)

- Task: design-st-2c7624 (stage: design, role: business-analyst)
- Upstream: `.xcoder/backlog/requirements-st-b1522d.md` (21 ACs, security constraints S-01..S-13, non-goals NG-01..NG-10)
- Reference (read-only input): `xcoder-ai-dojo/` PyQt6 v0.1.4 — blueprint §3 (UX), §4 (module map)
- Target: new sibling folder `xcoder-dojo/` (greenfield — no TS scaffold exists in this workspace)
- This document covers navigation flows, page/subpage specs, per-page data requirements, display modes, UI action contracts, component interfaces and tradeoffs. It does not cover build pipeline, module layout or LLM wire format.

## 1. What "component" and "interface" mean here

- **Component = page or subpage** (`P-xx`): a user-visible surface with its own data requirements and action set. Pages are the unit of specification, not React components.
- **Interface = contract**, in three parts: (a) **page model** — exactly what the page renders, with nullability; (b) **action contract** — name, input, side-effect class, approval requirement, enforcing process; (c) **IPC bridge** — the only channel from a page to privileged work.
- **Tradeoffs** are collected in §15 and cross-referenced from the page that pays for them.

Two invariants hold on every page and are not restated per page:

1. **UI checks are UX only** [UI-01]. Every action is re-authorized and re-validated in the Electron main process. A hidden button is not a control.
2. **Model-derived and file-derived text is untrusted** [UI-02/03/13, PRM-01]. It renders as escaped text or sanitized Markdown; no raw HTML, no `dangerouslySetInnerHTML`, no remote images, no execution, and it is labelled AI-generated or workspace-derived.

## 2. Navigation flow

### 2.1 Page hierarchy

```
P-00 App Shell (persistent frame)
├─ P-01 Welcome / No-Workspace              center, shown while no workspace is open
├─ P-02 Workspace Explorer                  left dock, lazy tree
│    └─ P-02a Node Context Menu             transient overlay
├─ P-03 Editor Area                         center, tabbed
│    ├─ P-03a Text Editor Pane              CodeMirror 6: highlighting, line numbers
│    ├─ P-03b Markdown Preview Pane         split beside P-03a
│    └─ P-03c Unopenable File State         binary / non-UTF-8 / too large / outside root
├─ P-04 Run Console                         bottom dock, single-flight
│    └─ P-04a Run Target Picker             subpage when >1 target resolves
├─ P-05 Agent Panel (JARVIS)                right dock
│    ├─ P-05a Tool Call Card                inline list item
│    ├─ P-05b Turn-Limit Banner             inline terminal state
│    └─ P-05c Model-Not-Configured State    inline empty state
├─ P-06 Delegation Run View                 right dock takeover
├─ P-07 Approval Sheet                      modal overlay (file-write | delegation-launch)
├─ P-08 Settings                            modal, tabbed
│    ├─ P-08a Model & Limits
│    ├─ P-08b Data, Secrets & Audit
│    └─ P-08c Appearance
├─ P-09 Conversation History                drawer inside P-05
├─ P-10 Audit Log Viewer                    modal, cursor-paginated
├─ P-11 Status Bar                          persistent chrome on all pages
└─ P-12 Error Center                        toast stack + detail sheet
```

### 2.2 Transitions

| From | Trigger | To | Guard / failure |
| --- | --- | --- | --- |
| P-01 | `workspace.open` (OS dialog only) | P-00 + populated P-02 | Not a folder / unreadable / outside policy → P-12, stay on P-01 |
| P-02 | `file.open` | P-03 new tab | Unopenable → P-03c, never a blank editor |
| P-02 | right-click node | P-02a | — |
| P-03 | `file.save` (Ctrl+S) | P-03, dirty cleared | Write failure → P-12, tab stays dirty |
| P-03 | tab kind = markdown, toggle preview | P-03b split | Remote images / raw HTML skipped and annotated |
| P-03 | `run.start` (Ctrl+R) | P-04 | Console busy → `run-busy` report, no second process |
| P-03 | `run.start`, multiple targets | P-04a first | No resolvable target → explicit error, not a silent no-op |
| P-05 | user sends message | P-05 streaming + P-05a cards | No model → P-05c; rest of app stays usable |
| P-05a | model requests a delegation tool call | P-07 `delegation-launch` | Denied → card `denied`, nothing launches |
| P-07 approved | delegation | P-06 | CLI missing → P-06 `failed-cli-missing` + remediation |
| P-07 approved | file write | back to origin page | File changed since request → `approval-expired`, re-prompt |
| P-05 | `session.clear` | P-05 empty transcript | — |
| P-11 | click audit-log location | P-10 | Missing log → P-12 with path shown |
| any | unrecoverable main-process error | P-12 | Shell renders an error page, never a blank window |

Concurrency rules (mirroring the reference): one workspace per window, one active run, one active agent request. Opening another workspace requires closing the current one, with the unsaved-tabs prompt first.

## 3. Shared contracts

```ts
// src/shared/contracts/ids.ts — vocabulary shared by every page model.
export type PageId =
  | 'shell' | 'welcome' | 'explorer' | 'editor' | 'preview' | 'console'
  | 'agent' | 'delegation' | 'approval' | 'settings' | 'history' | 'audit' | 'status' | 'errors';
export type SupportedLanguage =
  | 'typescript' | 'javascript' | 'json' | 'markdown' | 'python' | 'html'
  | 'css' | 'shell' | 'powershell' | 'yaml' | 'sql' | 'plaintext';
```

```ts
// src/shared/contracts/errors.ts — the ONLY error shape any page renders.
export type AppErrorCode =
  | 'workspace-not-open' | 'path-escape' | 'credential-file' | 'excluded-dir'
  | 'binary-file' | 'not-utf8' | 'file-too-large' | 'write-failed' | 'save-conflict'
  | 'run-busy' | 'run-spawn-failed' | 'runtime-missing' | 'output-truncated'
  | 'model-not-configured' | 'model-error' | 'schema-invalid' | 'tool-not-allowlisted'
  | 'turn-limit' | 'request-cap-reached' | 'delegation-cli-missing'
  | 'workspace-changed' | 'approval-expired' | 'approval-denied' | 'secret-detected' | 'unknown';

export interface AppError {
  code: AppErrorCode;
  message: string;        // user-facing, pre-redacted in main — never a stack or provider string
  remediation?: string;   // e.g. "Install Node.js, or choose another run target"
  detailRef?: string;     // opaque id; full detail lives in the audit log, not in the toast
}

export type SideEffect = 'none' | 'read' | 'write' | 'execute' | 'secret';

export type ActionName =
  | 'workspace.open' | 'workspace.close'
  | 'tree.listChildren' | 'tree.revealPath' | 'tree.filter'
  | 'file.open' | 'file.save' | 'file.saveAll' | 'file.close' | 'file.revert'
  | 'run.resolveTargets' | 'run.start' | 'run.stop' | 'run.clearConsole'
  | 'agent.send' | 'agent.stop' | 'agent.retryLast'
  | 'session.list' | 'session.load' | 'session.clear'
  | 'delegation.launch' | 'delegation.stop'
  | 'approval.list' | 'approval.respond'
  | 'settings.get' | 'settings.update' | 'settings.setApiKey' | 'settings.clearApiKey'
  | 'audit.page' | 'audit.location';

/** Every action is declared once, in main. The renderer receives a typed facade only. */
export interface ActionDescriptor<In, Out> {
  readonly name: ActionName;
  readonly sideEffect: SideEffect;
  readonly requiresApproval: boolean;   // true => P-07 must interpose before run()
  readonly enforcedIn: 'main';          // never 'renderer' — see [UI-01]
  validate(input: unknown): In;         // throws AppError('schema-invalid')
  run(input: In): Promise<Out>;
}

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: AppError };
export type Unsubscribe = () => void;
```

```ts
// src/shared/contracts/bridge.ts — the ENTIRE privileged surface exposed by preload.
export interface DojoBridge {
  workspace: {
    openDialog(): Promise<BridgeResult<WorkspaceOpened>>;            // OS dialog lives in main
    openPath(path: string): Promise<BridgeResult<WorkspaceOpened>>;  // resolved + root-confined in main
    close(): Promise<BridgeResult<void>>;
    current(): Promise<BridgeResult<WorkspaceOpened | null>>;
  };
  tree: { listChildren(request: ListChildrenRequest): Promise<BridgeResult<TreeNodePage>> };
  files: {
    read(relPath: string): Promise<BridgeResult<FileReadResult>>;
    save(request: SaveRequest): Promise<BridgeResult<SaveResult>>;
  };
  run: {
    resolveTargets(relPath: string): Promise<BridgeResult<RunTarget[]>>;
    start(request: RunStartRequest): Promise<BridgeResult<RunSession>>;
    stop(runId: string): Promise<BridgeResult<RunSession>>;
    onEvent(handler: (event: RunEvent) => void): Unsubscribe;
  };
  agent: {
    send(request: AgentSendRequest): Promise<BridgeResult<{ requestId: string }>>;
    stop(requestId: string): Promise<BridgeResult<void>>;
    onEvent(handler: (event: AgentEvent) => void): Unsubscribe;
  };
  session: {
    list(): Promise<BridgeResult<SessionSummary[]>>;
    load(sessionId: string): Promise<BridgeResult<SessionDetail>>;
    clear(sessionId: string): Promise<BridgeResult<void>>;
  };
  delegation: {
    launch(request: DelegationLaunchRequest): Promise<BridgeResult<DelegationRun>>;
    stop(delegationId: string): Promise<BridgeResult<DelegationRun>>;
    onEvent(handler: (event: DelegationEvent) => void): Unsubscribe;
  };
  approval: {
    list(): Promise<BridgeResult<ApprovalRequest[]>>;
    respond(request: ApprovalResponseRequest): Promise<BridgeResult<ApprovalRequest>>;
    onRequest(handler: (request: ApprovalRequest) => void): Unsubscribe;
  };
  settings: {
    get(): Promise<BridgeResult<LlmSettingsView>>;
    update(patch: LlmSettingsPatch): Promise<BridgeResult<LlmSettingsView>>;
    setApiKey(input: ApiKeyInput): Promise<BridgeResult<LlmSettingsView>>;  // write-only
    clearApiKey(): Promise<BridgeResult<LlmSettingsView>>;
  };
  audit: {
    page(request: AuditPageRequest): Promise<BridgeResult<AuditPage>>;
    location(): Promise<BridgeResult<{ logDir: string; retentionDays: number }>>;
  };
  errors: { onError(handler: (error: AppError) => void): Unsubscribe };
}

export interface WorkspaceOpened { workspaceId: string; pathDisplay: string; name: string; }
```

Bridge rules, enforced in `preload` rather than by convention: no `ipcRenderer` passthrough; explicit channel allowlist; every payload schema-validated in main; every call returns a discriminated `BridgeResult`; the API key is never returnable — only `hasApiKey: boolean` [UI-07, S-02, AI-06].

## 4. P-00 App Shell

**Purpose:** the persistent frame that keeps workspace and command context explicit (a stated reference product principle). It is not a route; it owns layout and chrome.

**Regions:** title bar (app name `Xcoder Dojo`, workspace absolute path, dirty count) · left dock (P-02) · center (P-01 or P-03) · right dock (P-05/P-06) · bottom dock (P-04) · status bar (P-11) · overlay slot (P-07, P-08, P-10, P-12).

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| appVersion | main | string | shown in P-08c |
| workspace | `workspace.current` | `{id, pathDisplay, name} \| null` | null → P-01; path always visible |
| openTabCount / dirtyCount | editor store | number | drives the close/save prompt |
| rightDock / bottomDock | persisted UI state | mode + size | restored on start |
| modelState | `settings.get` | `'configured' \| 'missing' \| 'error'` | surfaced in P-11 |
| recentErrorCount | error bus | number | badge on P-12 |

```ts
export interface ShellModel {
  appVersion: string;
  workspace: { workspaceId: string; pathDisplay: string; name: string } | null;
  openTabCount: number;
  dirtyCount: number;
  rightDock: { mode: 'agent' | 'delegation' | 'collapsed'; width: number };
  bottomDock: { mode: 'console' | 'collapsed'; height: number };
  modelState: 'configured' | 'missing' | 'error';
}
export interface ShellActions {
  openWorkspace(): Promise<void>;   // workspace.open
  closeWorkspace(): Promise<void>;  // unsaved-tab prompt first
  toggleDock(dock: 'right' | 'bottom'): void;
  focusEditor(): void;
  openSettings(): void;
  openAuditLog(): void;
}
```

**Display modes:** view only (chrome). **States:** loading (skeleton docks while the workspace resolves), ready, degraded (model missing → non-blocking banner, not a modal), fatal (renderer failure → P-12 shell error page instead of a white window).

## 5. P-01 Welcome / No-Workspace

**Purpose:** the only page reachable with no workspace. It must never resemble a broken editor.

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| recentWorkspaces | main store | `RecentWorkspace[]` (max 10) | paths only, never file contents |
| modelState / modelLabel | `settings.get` | state, string \| null | label is provider + model — never a key or credentialed URL |

```ts
export interface WelcomeModel {
  recentWorkspaces: ReadonlyArray<{ pathDisplay: string; lastOpenedAtMs: number }>;
  modelState: 'configured' | 'missing' | 'error';
  modelLabel: string | null;
}
export interface WelcomeActions {
  chooseFolder(): Promise<void>;                  // workspace.open, OS dialog only
  openRecent(pathDisplay: string): Promise<void>; // main re-validates; stale -> P-12 + drop entry
  openSettings(): void;
}
```

**Display modes:** list (recents, sortable by recency, max 10, not paginated) + view (CTA). **Empty state:** no recents → choose-folder CTA with a one-line explanation. **Deliberate omission:** there is no free-text path field — see T-04.

## 6. P-02 Workspace Explorer

**Purpose:** lazy file tree confined to the opened root; the discovery surface for every file action.

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| children of one dir | `tree.listChildren` | `FileNode[]` | one directory per call — never a whole-tree walk |
| relPath | main | string | POSIX separators, always root-relative |
| kind / hasChildren | main | `'file' \| 'dir'`, boolean | chevron without a second call |
| language | main extension map | `SupportedLanguage` | cosmetic chip |
| sizeBytes / mtimeMs | main stat | number | sortable columns |
| truncated / scannedFiles | main | boolean / number | honestly exposes the 1500-file scan bound |
| excluded nodes | main | — | hidden, generated and credential-shaped nodes are **not listed at all** |

```ts
export interface FileNode {
  nodeId: string;   // stable hash of relPath
  relPath: string;
  name: string;
  kind: 'file' | 'dir';
  hasChildren: boolean;
  language?: SupportedLanguage;
  sizeBytes?: number;
  mtimeMs?: number;
}
export interface ListChildrenRequest { parentRelPath: string | null; cursor?: string; limit?: number; }
export interface TreeNodePage {
  parentRelPath: string | null;
  entries: FileNode[];
  nextCursor: string | null;   // null => no more children
  truncated: boolean;          // true => a scan bound was hit
  scannedFiles: number;        // vs. configured 1500 cap
}
export interface ExplorerModel {
  workspaceRootLabel: string;
  nodesByParent: Readonly<Record<string, TreeNodePage>>;
  expandedRelPaths: ReadonlyArray<string>;
  selection: { relPath: string; kind: 'file' | 'dir' } | null;
  filter: { text: string; applied: boolean };
  loadingParents: ReadonlyArray<string>;
}
export interface ExplorerActions {
  expand(relPath: string): Promise<void>;    // tree.listChildren
  collapse(relPath: string): void;
  refresh(relPath: string): Promise<void>;
  openFile(relPath: string): Promise<void>;  // file.open -> P-03
  revealInExplorer(relPath: string): Promise<void>;
  copyRelativePath(relPath: string): Promise<void>;
  filter(text: string): void;
}
export interface NodeContextMenuModel {   // P-02a
  relPath: string;
  kind: 'file' | 'dir';
  items: ReadonlyArray<{
    action: 'open' | 'reveal' | 'copyRelativePath' | 'refresh' | 'run';
    enabled: boolean;
    disabledReason?: string;
  }>;
}
```

**Display modes:** list (hierarchical, virtualized), sortable (name/size/mtime — client-side over loaded nodes), searchable (filter over loaded nodes), paginated/lazy (per-directory `nextCursor`), detail (selection metadata in P-11).

**States:** loading (per-node spinner; the tree stays interactive), empty dir, truncated dir (inline "first N of M" naming the bound), per-node error with retry, workspace-changed (stale nodes → banner + refresh) [AC-13 refusal path].

**Security:** absolute paths, `..`, dotfiles, generated dirs and credential-shaped names are never returned; a request for one returns `path-escape` / `credential-file` / `excluded-dir` from main [S-06]. The tree is a projection of a server-side decision, not a client-side filter — see T-05.

**AC coverage:** AC-02, AC-11 (refusal surfacing).

## 7. P-03 Editor Area (P-03a / P-03b / P-03c)

**Purpose:** tabbed editing with highlighting, line numbers, encoding/EOL fidelity, and a Markdown split preview.

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| tabs | renderer store, hydrated by `files.read` | `EditorTabState[]` | open order |
| encoding | main BOM sniff | `'utf-8' \| 'utf-8-bom'` | preserved on save |
| eol | main first-line detect | `'lf' \| 'crlf'` | preserved on save |
| dirty | renderer | boolean | drives the dot and close prompt |
| language | main | `SupportedLanguage` | CodeMirror mode |
| content | `files.read` | string | `truncated` when a read cap applies |
| errorCode | main | `FileOpenErrorCode` | P-03c only |
| savedSha | main | string | optimistic-concurrency token for save |

```ts
export type FileOpenErrorCode =
  | 'binary-file' | 'not-utf8' | 'file-too-large' | 'outside-workspace' | 'denied-credential' | 'missing';
export interface FileReadResult {
  relPath: string; content: string; encoding: 'utf-8' | 'utf-8-bom'; eol: 'lf' | 'crlf';
  language: SupportedLanguage; sizeBytes: number; truncated: boolean; savedSha: string;
}
export interface EditorTabState {
  tabId: string; relPath: string; kind: 'text' | 'markdown' | 'error';
  language: SupportedLanguage; encoding: 'utf-8' | 'utf-8-bom'; eol: 'lf' | 'crlf';
  dirty: boolean; readOnly: boolean; truncated: boolean;
  errorCode?: FileOpenErrorCode; savedSha: string | null;
}
export interface SaveRequest { tabId: string; relPath: string; content: string; baseSha: string; writeNewFile: boolean; }
export interface SaveResult {
  ok: boolean; relPath: string; bytesWritten: number;
  encoding: 'utf-8' | 'utf-8-bom'; eol: 'lf' | 'crlf';
  savedSha: string; savedAtMs: number; error?: AppError;
}
export interface EditorModel {
  tabs: ReadonlyArray<EditorTabState>;
  activeTabId: string | null;
  splitPreview: { open: boolean; tabId: string | null };
  saveInFlight: ReadonlyArray<string>;
}
export interface EditorActions {
  open(relPath: string): Promise<void>;      // file.open
  activate(tabId: string): void;
  close(tabId: string): Promise<void>;       // dirty -> save/discard prompt
  save(tabId: string): Promise<SaveResult>;  // file.save
  saveAll(): Promise<ReadonlyArray<SaveResult>>;
  revert(tabId: string): Promise<void>;      // discards buffer
  togglePreview(tabId: string): void;        // markdown only
  find(text: string): void;                  // in-editor, no IPC
}
// P-03b AST: sanitized BEFORE rendering. Raw-HTML and remote-image nodes are dropped,
// then counted in `blocked` so the omission is visible to the user (AC-20).
export type MarkdownSpan =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; text: string };   // http(s)/mailto only, opened after confirm
export type MarkdownBlock =
  | { kind: 'paragraph'; spans: ReadonlyArray<MarkdownSpan> }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; spans: ReadonlyArray<MarkdownSpan> }
  | { kind: 'list'; ordered: boolean; items: ReadonlyArray<ReadonlyArray<MarkdownSpan>> }
  | { kind: 'code'; language: string | null; text: string }
  | { kind: 'image'; relPath: string; alt: string };  // local images only
export interface MarkdownPreviewModel {      // P-03b
  tabId: string;
  blocks: ReadonlyArray<MarkdownBlock>;      // sanitized AST, no raw HTML nodes
  localImages: ReadonlyArray<{ relPath: string; resolved: boolean }>;
  blocked: { rawHtml: number; remoteImages: number };  // shown, not silent
}
```

**Display modes:** editable (buffer), view (tab strip, gutter, metadata strip), detail (per-tab language/encoding/EOL/dirty). No pagination: one buffer loads whole or the tab becomes P-03c.

**P-03a Text Editor Pane:** CodeMirror 6; syntax highlighting + line numbers for the supported language set; in-editor find/replace; no remote resource loading; content is always text, never rendered HTML [UI-02/03].

**P-03b Markdown Preview Pane:** debounced render of a **sanitized Markdown AST** (vetted sanitizer); local images only, resolved through a root-confined URL; embedded raw HTML and remote images are skipped and counted in a visible "blocked" note [AC-20].

**P-03c Unopenable File State:** renders the specific code with remediation ("This file is not UTF-8 text. It was not opened and nothing was modified."), keeps the tab closable, shows no partial buffer [AC-05].

**States:** clean, dirty, saving (buffer stays live; save idempotent by `baseSha`), conflict (`baseSha` mismatch → reload / overwrite-with-approval), read-only.

**Security:** save is `sideEffect:'write'` and passes P-07 when agent-initiated [S-07]; no path may resolve outside root; a `truncated` read is clearly marked so a partial buffer cannot be saved as if complete — see T-06.

**AC coverage:** AC-03, AC-04, AC-05, AC-20.

## 8. P-04 Run Console (P-04a Run Target Picker)

**Purpose:** the single execution surface — resolve a runnable target, execute it, stream stdout/stderr, report the exit code, and let the user stop it.

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| targets | `run.resolveTargets` | `RunTarget[]` | file kind, package script, or project manifest (mirrors the reference runtime matrix) |
| argv | main | `string[]` | **argv array, never a shell string** [S-08, PRM-08] |
| cwdRelPath | main | string | always inside the workspace |
| state | run events | `RunState` | `idle→starting→running→stopping→exited\|failed` |
| chunks | `run.onEvent` | `ConsoleChunk[]` | ring buffer with a per-run cap |
| exitCode / signal | main | `number \| null` / `string?` | surfaced explicitly, including non-zero |
| truncated | main | `{stdout, stderr}` | reports cap hit [AC-19] |

```ts
export type RunState = 'idle' | 'starting' | 'running' | 'stopping' | 'exited' | 'failed';
export interface CommandSpec { argv: ReadonlyArray<string>; cwdRelPath: string; envKeys: ReadonlyArray<string>; }
export interface RunTarget {
  targetId: string; label: string; kind: 'file' | 'script' | 'project';
  relPath: string; command: CommandSpec;
  source: 'file-extension' | 'package-script' | 'project-manifest' | 'user-override';
  requiresRuntime: string | null;   // "node" | "python" | "pwsh" — reported before start
}
export interface RunStartRequest { targetId: string; }   // target must already be resolved in main
export interface ConsoleChunk {
  runId: string; seq: number; stream: 'stdout' | 'stderr' | 'system'; text: string; atMs: number;
}
export interface RunSession {
  runId: string; targetId: string; state: RunState; startedAtMs: number;
  exitCode: number | null; signal?: string; truncated: { stdout: boolean; stderr: boolean };
}
export interface ConsoleModel {
  session: RunSession | null;
  chunks: ReadonlyArray<ConsoleChunk>;    // capped; oldest dropped first
  targets: ReadonlyArray<RunTarget>;
  selectedTargetId: string | null;
  pendingTargetFor: string | null;        // relPath awaiting picker choice
  streamFilter: 'all' | 'stdout' | 'stderr';
  findText: string;
}
export interface ConsoleActions {
  resolveTargets(relPath: string): Promise<ReadonlyArray<RunTarget>>;  // run.resolveTargets
  start(targetId: string): Promise<RunSession>;                        // run.start
  stop(): Promise<RunSession>;                                        // run.stop
  clearConsole(): void;                                               // client-side only
  copyOutput(): Promise<void>;                                        // redacted text
  setStreamFilter(filter: 'all' | 'stdout' | 'stderr'): void;
}
export type RunEvent =
  | { type: 'started'; session: RunSession }
  | { type: 'chunk'; chunk: ConsoleChunk }
  | { type: 'ended'; session: RunSession };
```

**Display modes:** view + append-only stream; list (chunks, virtualized, filterable by stream); time-ordered and immutable (no sort); searchable (buffered find); paginated only as a local ring-buffer window.

**States:** idle, starting, running, stopping (acknowledged, awaiting exit), exited-0, exited-non-zero (explicit "exit code N" bar), spawn-failed (`runtime-missing` → remediation naming the runtime), busy (`run-busy`: single-flight, no queue), output-truncated (explicit note).

**Security:** no shell interpolation; env is an allowlist of keys, not the parent environment; Stop terminates with a timeout escalation; copied output passes the redactor [S-08, S-11].

**AC coverage:** AC-06, AC-07, AC-08, AC-19.

## 9. P-05 Agent Panel (JARVIS)

**Purpose:** the conversational surface — the user asks, the agent inspects the workspace through allowlisted tools, and answers stream with visible tool-call cards.

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| transcript | `session.load` + `agent.onEvent` | `TranscriptEntry[]` | survives restart [AC-17] |
| modelState | `settings.get` | `'configured' \| 'missing' \| 'error'` | missing → P-05c; rest of app usable [AC-16] |
| requestState | agent events | `AgentRequestState` | drives Stop and the send affordance |
| toolCalls | agent events | `ToolCallRecord[]` | args summary, duration, outcome |
| turnCount / turnCap | agent events | number | drives P-05b |
| streamed text | `agent.onEvent` | append-only | labelled AI-generated [UI-13] |
| requestCapRemaining | agent events | number | cost-control surface [S-10] |

```ts
export type AgentRequestState =
  | 'idle' | 'thinking' | 'awaiting-tool' | 'answering' | 'stopping'
  | 'done' | 'stopped' | 'turn-limit' | 'request-cap' | 'failed';

export type AllowlistedToolName =
  | 'list_dir' | 'glob' | 'grep' | 'read_file' | 'read_multiple_files'
  | 'read_file_lines' | 'read_outline' | 'validate_file'
  | 'git_status' | 'git_diff' | 'git_log';

export type ToolCallOutcome =
  | 'pending' | 'ok' | 'refused-sandbox' | 'refused-credential' | 'refused-excluded'
  | 'denied-allowlist' | 'denied-approval' | 'schema-invalid' | 'error';

export interface ToolCallRecord {                    // P-05a
  toolCallId: string;
  toolName: AllowlistedToolName;                     // union of the 11 allowlisted tools
  argsSummary: Readonly<Record<string, string | number | boolean>>; // display-only, redacted
  argsRedacted: boolean;
  outcome: ToolCallOutcome;
  durationMs: number | null;
  resultSummary: string | null;                      // one line, escaped, never full file content
  resultTruncated: boolean;
}

export interface TranscriptEntry {
  entryId: string;
  role: 'user' | 'assistant' | 'system';
  origin: 'human' | 'model' | 'workspace-data';   // renderer labels model and workspace data
  text: string;                                   // escaped; markdown sanitized
  atMs: number;
  streaming: boolean;
  toolCallIds: ReadonlyArray<string>;
  rejectionNotice?: { code: AppErrorCode; message: string };  // e.g. fabricated tool name
}

export interface AgentSendRequest {
  text: string;               // length-limited in main before reaching a model [S-10]
  sessionId: string;
  workspaceId: string;
}

export type AgentEvent =
  | { type: 'request-started'; requestId: string }
  | { type: 'delta'; requestId: string; entryId: string; text: string }
  | { type: 'tool-call'; requestId: string; record: ToolCallRecord }
  | { type: 'tool-call-updated'; requestId: string; record: ToolCallRecord }
  | { type: 'entry-completed'; requestId: string; entryId: string }
  | { type: 'request-ended'; requestId: string; state: AgentRequestState; reason?: AppError }
  | { type: 'turn-progress'; requestId: string; turnCount: number; turnCap: number };

export interface AgentModel {
  sessionId: string;
  transcript: ReadonlyArray<TranscriptEntry>;
  toolCallsById: Readonly<Record<string, ToolCallRecord>>;
  request: { requestId: string | null; state: AgentRequestState; turnCount: number; turnCap: number };
  modelState: 'configured' | 'missing' | 'error';
  input: { draftText: string; maxChars: number };    // maxChars disclosed, not silent
  requestCapRemaining: number;
}
export interface AgentActions {
  send(text: string): Promise<{ requestId: string }>;   // agent.send
  stop(): Promise<void>;                                // agent.stop — kill switch [S-10]
  retryLast(): Promise<{ requestId: string }>;          // agent.retryLast
  clearConversation(): Promise<void>;                   // session.clear
  openHistory(): void;                                  // P-09
  copyEntry(entryId: string): Promise<void>;            // redacted text
}
```

**Display modes:** view + append-only transcript (immutable once complete); list (tool-call cards, collapsible, filterable by outcome); searchable (find within loaded transcript); paginated (older entries lazy-load from the session store via `session.load`). No editable history — the transcript is an auditable record, not a scratchpad (see T-08).

**P-05a Tool Call Card:** one row per call — tool name, redacted args, outcome chip, duration, one-line result summary and truncation marker. Refusals render as first-class outcomes (`refused-sandbox`, `denied-allowlist`) so the user watches the boundary work instead of seeing a generic failure [AC-11, AC-12].

**P-05b Turn-Limit Banner:** terminal state showing `turnCount/turnCap` with an explicit "stopped at turn limit" label — never presented as an answer [AC-10].

**P-05c Model-Not-Configured State:** inline empty state with a settings CTA; sending is disabled while editor, tree and console stay fully usable [AC-16].

**States:** idle, thinking, awaiting-tool, answering (streaming), stopping, done, stopped, turn-limit, request-cap, failed, schema-rejected (inline rejection notice on the offending turn).

**Security:** every tool result and file excerpt entering context is rendered and persisted as `origin:'workspace-data'` and delimited as untrusted; assistant text is labelled AI-generated; a tool name outside `AllowlistedToolName` is refused with `tool-not-allowlisted` and never dispatched [S-03/04, PRM-04/07/08]; API keys and full internal URLs are never rendered here [PRM-03].

**AC coverage:** AC-09, AC-10, AC-11, AC-12, AC-16, AC-17, AC-19.

## 10. P-06 Delegation Run View

**Purpose:** the takeover view for an external agent-CLI run — live streamed output, working Stop, and refusal to continue across a workspace change.

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| delegationId / cliLabel | `delegation.launch` | string | names the configured CLI explicitly |
| task | the approved tool-call args | string | immutable after launch |
| state | delegation events | `DelegationState` | drives Stop and completion |
| output | `delegation.onEvent` | `DelegationChunk[]` | capped, redacted |
| workspaceFingerprint | main | string | mismatch → `workspace-changed` refusal [AC-13] |
| exitCode | main | `number \| null` | reported |

```ts
export type DelegationState =
  | 'launching' | 'running' | 'stopping' | 'completed' | 'stopped'
  | 'failed-cli-missing' | 'failed-workspace-changed' | 'failed';
export interface DelegationLaunchRequest { toolCallId: string; approvalId: string; }  // both required
export interface DelegationChunk {
  delegationId: string; seq: number; stream: 'stdout' | 'stderr' | 'system'; text: string; atMs: number;
}
export interface DelegationRun {
  delegationId: string; cliLabel: string; task: string; state: DelegationState;
  startedAtMs: number; exitCode: number | null; truncated: boolean;
  workspaceFingerprint: string;
}
export type DelegationEvent =
  | { type: 'started'; run: DelegationRun }
  | { type: 'chunk'; delegationId: string; chunk: DelegationChunk }
  | { type: 'ended'; delegationId: string; run: DelegationRun };
export interface DelegationModel {
  run: DelegationRun | null;
  chunks: ReadonlyArray<DelegationChunk>;
  canStop: boolean;
  cliConfigured: boolean;
}
export interface DelegationActions {
  launch(request: DelegationLaunchRequest): Promise<DelegationRun>;  // delegation.launch
  stop(): Promise<DelegationRun>;                                   // delegation.stop
  backToAgent(): void;
  copyOutput(): Promise<void>;
}
```

**Display modes:** view + append-only stream; list (chunks, virtualized); searchable (buffered find); paginated (ring-buffer window). The task header is immutable — the launch task cannot be edited mid-run.

**States:** launching, running, stopping, completed (exit 0), stopped-by-user (reported as stopped, not failed), failed-cli-missing (remediation + settings CTA), failed-workspace-changed (explicit refusal message), truncated output.

**Security:** launch requires a consumed `approvalId` bound to the same `toolCallId` [S-07]; argv is constructed in main from the pinned CLI plus fixed flags, never from model text [PRM-08]; output is redacted before display and copy [S-11].

**AC coverage:** AC-13.

## 11. P-07 Approval Sheet (modal)

**Purpose:** the single human-in-the-loop gate for high-impact actions. Two kinds only: `file-write` and `delegation-launch`. Anything destructive or out-of-workspace is refused outright and never appears here for approval [S-07, AI-03].

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| approvalId | approval request | string | single-use, bound to the originating toolCallId |
| kind | request | `'file-write' \| 'delegation-launch'` | nothing else is approvable |
| concreteTarget | request | string | root-relative path, or CLI + task summary |
| diffSummary | main (file-write only) | `{added, removed, preview}` | sanitized preview, no secrets |
| expiresAtMs | request | number | expired → `approval-expired` |
| requestedBy | request | `'agent'` | user-initiated saves do not prompt |

```ts
export type ApprovalKind = 'file-write' | 'delegation-launch';
export type ApprovalDecision = 'approve-once' | 'deny';
export interface ApprovalRequest {
  approvalId: string;
  kind: ApprovalKind;
  toolCallId: string;
  concreteTarget: string;                 // MUST be shown verbatim in the sheet
  detail:
    | { kind: 'file-write'; relPath: string; bytes: number; diffSummary: { added: number; removed: number; preview: string } }
    | { kind: 'delegation-launch'; cliLabel: string; taskSummary: string };
  requestedAtMs: number;
  expiresAtMs: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}
export interface ApprovalResponseRequest { approvalId: string; decision: ApprovalDecision; }
export interface ApprovalModel { queue: ReadonlyArray<ApprovalRequest>; active: ApprovalRequest | null; }
export interface ApprovalActions {
  respond(request: ApprovalResponseRequest): Promise<ApprovalRequest>;  // approval.respond
  dismiss(): void;                                                     // treated as deny
}
```

**Display modes:** detail only (one request at a time; the queue is shown as a count).

**States:** pending, approved (sheet closes, originating card updates), denied (card shows `denied-approval`, audited), expired (target changed on disk → re-request, never auto-approve).

**Security:** the target is named concretely and verbatim — no "approve this action?" without a target [AC-15]; dismissal counts as deny; decisions are audited with request id and decision but never file contents; there is no "remember my choice" for either kind [CORE-05 fail closed, AI-03].

**AC coverage:** AC-15.

## 12. P-08 Settings (P-08a / P-08b / P-08c)

**Purpose:** configure the model, the limits, the secret and the cosmetics — and disclose where data lives.

**Data requirements**

| Field | Source | Type | Notes |
| --- | --- | --- | --- |
| provider / baseUrl / modelName | `settings.get` | string | base URL shown shortened, no embedded credentials |
| hasApiKey | `settings.get` | boolean | **the key itself is never returned** [UI-07, S-02] |
| limits | `settings.get` | `AgentLimits` | displayed and editable within bounds |
| dataRootDisplay / auditLogDir / retentionDays | `audit.location` | string / number | disclosed [AC-18, S-11] |
| delegationCliLabel | settings | string | AC-13 default CLI, user-overridable |
| appearance | settings | `'dark' \| 'light' \| 'system'` | no artwork-parity claim (NG-07) |

```ts
export interface AgentLimits {
  maxContextChars: number;
  maxOutputTokens: number;
  maxTurns: number;             // default 6
  maxRequestsPerSession: number;
}
export interface LlmSettingsView {
  provider: 'openai-compatible' | 'none';
  baseUrlLabel: string;
  modelName: string;
  hasApiKey: boolean;           // write-only secret; no read path exists
  limits: AgentLimits;
  delegationCliLabel: string;
  dataRootDisplay: string;
  auditLogDir: string;
  auditRetentionDays: number;
}
export interface LlmSettingsPatch {
  provider?: 'openai-compatible' | 'none';
  baseUrl?: string;             // validated http(s), no embedded credentials
  modelName?: string;
  limits?: Partial<AgentLimits>;
  delegationCliLabel?: string;
  appearance?: 'dark' | 'light' | 'system';
}
export interface ApiKeyInput { value: string; }   // write-only; autocomplete off; cleared on submit
export interface SettingsModel {
  view: LlmSettingsView; draft: LlmSettingsPatch; dirty: boolean; saving: boolean;
}
export interface SettingsActions {
  get(): Promise<LlmSettingsView>;                     // settings.get
  update(patch: LlmSettingsPatch): Promise<LlmSettingsView>;
  setApiKey(input: ApiKeyInput): Promise<LlmSettingsView>;
  clearApiKey(): Promise<LlmSettingsView>;
  testConnection(): Promise<{ ok: boolean; error?: AppError }>;
  openDataRoot(): Promise<void>;                       // OS reveal
  openAuditLog(): void;                                // -> P-10
}
```

**Display modes:** detail (form), editable except the key (write-only: `set` / `not set`).

**States:** unconfigured, configured, saving, per-field validation error, connection test failing (message, not a stack).

**Security:** the key goes only to the OS-protected store via main — never renderer, URL, logs or prompts [CORE-07, UI-07, CORE-01]; the field is autocomplete-off and cleared on submit and on close [UI-10]; limits are bounded in main so the renderer cannot raise them past policy [S-10].

**AC coverage:** AC-16, AC-18.

## 13. P-09 Conversation History

**Purpose:** browse, resume and clear persisted conversations [AC-17].

```ts
export interface SessionSummary {
  sessionId: string; title: string; updatedAtMs: number; entryCount: number;
  workspaceName: string | null;   // name only, not the full path
}
export interface SessionDetail { sessionId: string; entries: TranscriptEntry[]; nextCursor: string | null; }
export interface HistoryModel {
  sessions: ReadonlyArray<SessionSummary>; nextCursor: string | null;
  selectedSessionId: string | null; loading: boolean;
}
export interface HistoryActions {
  list(): Promise<SessionSummary[]>;           // session.list
  load(sessionId: string): Promise<SessionDetail>;
  resume(sessionId: string): Promise<void>;    // loads into P-05
  clear(sessionId: string): Promise<void>;     // irreversible, confirmed
  clearAll(): Promise<void>;                   // irreversible, confirmed twice
}
```

**Display modes:** list (sessions, sortable by updatedAt, searchable by title, cursor-paginated), detail (paged transcript preview), delete-only mutation.

**Security:** titles derive from the first user turn and render escaped; stored tool data is limited to the redacted summaries already visible in the transcript [S-11]; clearing removes the record, not just the view.

## 14. P-10 Audit Log Viewer, P-11 Status Bar, P-12 Error Center

### P-10 Audit Log Viewer (modal)

**Purpose:** read-only inspection of the redacted, retention-capped audit log whose location is disclosed in P-08b and P-11 [S-11, CORE-08].

```ts
export type AuditEventType =
  | 'workspace-open' | 'workspace-close' | 'file-save' | 'run-start' | 'run-stop'
  | 'agent-request' | 'agent-response' | 'tool-call' | 'tool-refusal'
  | 'delegation-start' | 'delegation-stop' | 'approval-request' | 'approval-decision'
  | 'settings-change' | 'secret-set' | 'secret-cleared' | 'error';
export interface AuditEventView {
  eventId: string; atMs: number; type: AuditEventType;
  actor: 'user' | 'agent' | 'system';
  targetRelPath?: string;
  toolName?: AllowlistedToolName;
  outcome: 'ok' | 'refused' | 'denied' | 'failed';
  redactedSummary: string;   // pre-redacted in main: no secrets, no PII, no file bodies
}
export interface AuditPageRequest { cursor?: string; limit?: number; type?: AuditEventType; sinceMs?: number; }
export interface AuditPage { events: AuditEventView[]; nextCursor: string | null; retentionDays: number; }
export interface AuditModel {
  events: ReadonlyArray<AuditEventView>; nextCursor: string | null;
  filterType: AuditEventType | null; retentionDays: number;
}
export interface AuditActions {
  page(request: AuditPageRequest): Promise<AuditPage>;   // audit.page
  location(): Promise<{ logDir: string; retentionDays: number }>;
  exportRedacted(): Promise<{ path: string }>;           // redacted copy only, user-chosen path
}
```

**Display modes:** list (cursor-paginated, sortable by time, filterable by type), detail (single-event drawer), strictly read-only.

**Security:** append-only from the app's side (no UI delete or edit); never renders un-redacted content; export is redacted-only.

### P-11 Status Bar

```ts
export interface StatusBarModel {
  workspacePathDisplay: string | null;   // always visible when a workspace is open
  run: { state: RunState; label: string };
  agent: { state: AgentRequestState; label: string };
  model: { state: 'configured' | 'missing' | 'error'; label: string };
  audit: { logDir: string; retentionDays: number };   // clickable -> P-10
  selection: { relPath: string; language: SupportedLanguage } | null;
}
export interface StatusBarActions {
  openAuditLog(): void;
  openRunConsole(): void;
  openAgentPanel(): void;
  openSettings(): void;
}
```

**Display modes:** view only; three-state badges; the audit-log location is always one click away [S-11 disclosure].

### P-12 Error Center

```ts
export interface ErrorToast { toastId: string; error: AppError; atMs: number; dismissed: boolean; }
export interface ErrorCenterModel { toasts: ReadonlyArray<ErrorToast>; detailOpenFor: string | null; }
export interface ErrorCenterActions {
  dismiss(toastId: string): void;
  openDetail(toastId: string): void;
  retry(toastId: string): Promise<void>;   // only for retryable codes
}
```

**Display modes:** list (toast stack, time-ordered; auto-dismiss only for informational codes), detail (sheet with remediation). **Rules:** errors never block the window except on fatal renderer failure; messages are pre-redacted; stacks and provider payloads live behind `detailRef` in the audit log, never in the toast.

## 15. Tradeoffs (explicit, with cost)

Each tradeoff names what was gained and what was given up so a reviewer can overturn it knowingly.

- **T-01 Single-flight console vs. concurrent runs** — *Chosen:* one run at a time; a second request returns `run-busy`, no queue. *Gained:* a simple, auditable execution contract with one Stop target and no scheduler state machine. *Cost:* a user cannot watch or queue two projects at once. *Why acceptable:* matches the reference's shared console and keeps AC-06/AC-07 verifiable; queueing is additive later.
- **T-02 Page-level spec instead of component-level** — *Chosen:* specify pages/subpages (`P-xx`) with page models, not every React component. *Gained:* contracts stay stable when components are refactored and the design survives framework churn. *Cost:* implementation freedom inside a page can drift from the intended UX unless the page's action contract is respected.
- **T-03 Approval only for two action classes** — *Chosen:* exactly `file-write` and `delegation-launch` prompt; everything else is a harmless read or is refused outright. *Gained:* no approval fatigue and no path to approving a dangerous action. *Cost:* a newly added high-impact action would silently have no gate — mitigated by making `requiresApproval` a required field on every `ActionDescriptor` so omission is a type error.
- **T-04 No free-text workspace path input** — *Chosen:* the workspace is opened only through the OS dialog or a re-validated recents entry. *Gained:* removes an unvalidated path-input surface with all its traversal and credential edge cases [S-06]. *Cost:* power users cannot paste a path. Accepted for v1.
- **T-05 Exclusions decided in main; the user filter applies only to loaded nodes** — *Chosen:* dotfiles, generated dirs and credential-shaped names are excluded in main and never sent; the text filter narrows already-loaded children. *Gained:* one authoritative sandbox implementation [PRM-09] that no client-side filter can bypass. *Cost:* filtering is not a whole-workspace search and a filtered tree can look incomplete — mitigated by naming the bounds in empty/truncated states.
- **T-06 Read caps visible rather than silent** — *Chosen:* hitting a char/line/file bound surfaces `truncated` plus counts. *Gained:* the user is never shown a partial file as if complete [AC-19]. *Cost:* more UI states, and a truncated buffer is deliberately not silently saveable as complete.
- **T-07 Markdown preview blocks HTML and remote images, visibly** — *Chosen:* sanitized AST only, local images only, with a visible blocked count. *Gained:* closes the main XSS / SSRF / tracking-image vectors in a preview pane [UI-02/03, AC-20]. *Cost:* some legitimate Markdown renders incompletely; the annotation keeps that honest instead of confusing.
- **T-08 Transcript is append-only, not editable** — *Chosen:* users can copy and clear, not edit prior turns. *Gained:* the transcript remains a trustworthy audit artifact. *Cost:* fixing a typo requires a new turn; no in-place editing or conversation branching.
- **T-09 Settings, History and Audit are overlays, not routes** — *Chosen:* they open as modal or drawer surfaces over the workbench. *Gained:* workspace, run and agent state stay mounted and never restart because of navigation; simpler state ownership. *Cost:* no deep-linking into a settings tab, and overlay stacking must be managed.
- **T-10 Agent output is escaped text plus main-generated cards** — *Chosen:* model text renders escaped with sanitized Markdown and an AI-generated label; tool cards are produced from structured events by main, not by the model. *Gained:* a prompt injection cannot forge a tool card or executable UI [UI-13, PRM-01/08]. *Cost:* richer presentational answers (embedded tables, widgets) are unsupported.

## 16. Action -> page -> enforcement matrix

| Action | Page(s) | Side effect | Approval | Validated/enforced in | Primary ACs |
| --- | --- | --- | --- | --- | --- |
| `workspace.open` | P-01, P-00 | read | no | main (OS dialog + root confinement) | AC-01, AC-02 |
| `workspace.close` | P-00 | none | no | main (unsaved prompt) | AC-03 |
| `tree.listChildren` | P-02 | read | no | main (sandbox + bounds) | AC-02, AC-11 |
| `file.open` | P-02, P-03 | read | no | main (encoding and kind detection) | AC-03, AC-05 |
| `file.save` | P-03 | write | **only if agent-initiated** | main (encoding/EOL, `baseSha`) | AC-04, AC-15 |
| `file.revert` | P-03 | write | no (user-initiated, discards buffer) | renderer + main | AC-03 |
| `run.resolveTargets` | P-04, P-04a | read | no | main (target allowlist) | AC-06, AC-08 |
| `run.start` | P-04 | execute | no (user-initiated) | main (argv, cwd, timeout, single-flight) | AC-06, AC-07, AC-08 |
| `run.stop` | P-04 | execute | no | main (terminate + escalation) | AC-07 |
| `agent.send` | P-05 | read + external | no | main (limits, tool allowlist, prompt assembly) | AC-09, AC-10, AC-19 |
| `agent.stop` | P-05 | none | no | main (abort in-flight) | AC-09 |
| `delegation.launch` | P-06 via P-07 | execute | **yes** | main (requires a consumed `approvalId`) | AC-13, AC-15 |
| `delegation.stop` | P-06 | execute | no | main | AC-13 |
| `approval.respond` | P-07 | none | n/a | main (single-use, expiry) | AC-15 |
| `settings.setApiKey` / `settings.clearApiKey` | P-08a/b | secret | no | main + OS key store (never returned) | AC-18 |
| `session.clear` | P-05, P-09 | write | no (explicit confirm) | main | AC-17 |
| `audit.page` / `audit.location` | P-10, P-11 | read | no | main (redaction, retention) | AC-18, S-11 |

The only actions carrying `requiresApproval: true` are the two that write files or launch execution on the agent's behalf; both are unreachable by a model without a matching, unexpired `approvalId`.

## 17. Component -> interface coverage (AC1 evidence)

| Component | Page ID | Interface(s) defined | Display modes |
| --- | --- | --- | --- |
| App Shell | P-00 | `ShellModel`, `ShellActions`, `DojoBridge` | view |
| Welcome | P-01 | `WelcomeModel`, `WelcomeActions` | list, view |
| Workspace Explorer | P-02 | `FileNode`, `TreeNodePage`, `ExplorerModel`, `ExplorerActions` | list, sortable, filter, lazy-page |
| Node Context Menu | P-02a | `NodeContextMenuModel` | detail |
| Editor Area | P-03 | `EditorTabState`, `EditorModel`, `EditorActions` | editable, detail |
| Text Editor Pane | P-03a | `FileReadResult`, `EditorActions` | editable |
| Markdown Preview | P-03b | `MarkdownPreviewModel` | view (read-only) |
| Unopenable File | P-03c | `FileOpenErrorCode`, `EditorTabState` | detail (error) |
| Run Console | P-04 | `RunTarget`, `RunSession`, `ConsoleModel`, `ConsoleActions` | view, list, filter, search |
| Run Target Picker | P-04a | `RunTarget`, `ConsoleActions.resolveTargets` | list (single select) |
| Agent Panel | P-05 | `TranscriptEntry`, `AgentModel`, `AgentActions`, `AgentEvent` | view, list, search, paged |
| Tool Call Card | P-05a | `ToolCallRecord`, `AllowlistedToolName` | detail |
| Turn-Limit Banner | P-05b | `AgentModel.request` | detail (terminal) |
| Model-Not-Configured | P-05c | `AgentModel.modelState`, `LlmSettingsView` | detail (empty) |
| Delegation Run View | P-06 | `DelegationRun`, `DelegationModel`, `DelegationActions` | view, list, search |
| Approval Sheet | P-07 | `ApprovalRequest`, `ApprovalModel`, `ApprovalActions` | detail |
| Settings | P-08 | `LlmSettingsView`, `LlmSettingsPatch`, `SettingsActions` | detail, editable |
| Model & Limits | P-08a | `AgentLimits`, `SettingsActions` | editable |
| Data, Secrets & Audit | P-08b | `ApiKeyInput`, `LlmSettingsView` | editable (key write-only) |
| Appearance | P-08c | `LlmSettingsPatch.appearance` | editable |
| Conversation History | P-09 | `SessionSummary`, `SessionDetail`, `HistoryActions` | list, sortable, searchable, paged |
| Audit Log Viewer | P-10 | `AuditEventView`, `AuditPage`, `AuditActions` | list, sortable, filterable, paged |
| Status Bar | P-11 | `StatusBarModel`, `StatusBarActions` | view |
| Error Center | P-12 | `AppError`, `ErrorCenterModel`, `ErrorCenterActions` | list, detail |

Every component above has at least one exported data interface and one action interface (or an explicitly inherited one). That table is the AC1 evidence.

## 18. AC traceability (UI level)

| AC | How this design satisfies it |
| --- | --- |
| AC-01 | P-00 title bar renders `Xcoder Dojo` plus the workspace path; P-11 mirrors it |
| AC-02 | P-02 lazy `listChildren` per directory; nothing above root is requestable |
| AC-03 | P-03 tabs with CodeMirror highlighting, line numbers, close and a dirty dot |
| AC-04 | P-03 save carries `encoding`/`eol` from `FileReadResult`; new files default UTF-8 |
| AC-05 | P-03c with `binary-file`/`not-utf8` and the "nothing modified" copy |
| AC-06 | P-04 saves the active file first, streams stdout/stderr, shows the exit code |
| AC-07 | P-04 single-flight, `stopping` state, stopped-reported exit path |
| AC-08 | P-04 `runtime-missing` and non-zero exit bars |
| AC-09 | P-05 `AgentEvent['tool-call']` renders P-05a with args, outcome and duration |
| AC-10 | P-05 `turn-progress` plus the P-05b terminal turn-limit banner |
| AC-11 | P-05a `refused-sandbox`/`refused-credential` outcomes; no content in the card |
| AC-12 | P-05 delimited `workspace-data` entries; `tool-not-allowlisted` rejection notice |
| AC-13 | P-06 streamed output, working Stop, `failed-workspace-changed` refusal |
| AC-14 | P-05a renders read-only git results; no stage/commit/push action exists in any interface |
| AC-15 | P-07 `concreteTarget` shown verbatim, decision audited, `approval-expired` re-prompt |
| AC-16 | P-05c with send disabled; P-01/02/03/04 unaffected |
| AC-17 | P-09 list/resume/clear over persisted sessions; transcript restored on start |
| AC-18 | P-08b exposes `hasApiKey` only; P-10 and P-11 disclose the log location |
| AC-19 | Every capped surface carries `truncated` plus counts (P-02, P-03, P-04, P-05a, P-06) |
| AC-20 | P-03b sanitized AST, local images only, visible blocked count |
| AC-21 | Not a UI concern; the interfaces above are the typed surface those unit tests assert against |

## 19. Open questions carried forward (with design defaults)

1. **Default delegation CLI** — modelled as a user-configurable `delegationCliLabel`; one concrete default is chosen at implementation. P-06 covers the unconfigured case with `failed-cli-missing`.
2. **Token-by-token streaming** — assumed yes. If the implementation buffers instead, `AgentEvent.delta` collapses into `entry-completed` and P-05 loses only the streaming affordance, not its contract.
3. **In-repo stub model server** — assumed under `xcoder-dojo/test/`; P-05 shows `modelState: 'error'` if it is unreachable.
4. **Terminal, SSH and HTTP panels** — out of scope (NG-05); P-04 is the only execution surface in this design.

## 20. Deliberate omissions from this document

Module/folder layout, build commands, Electron security configuration details, prompt text, tool JSON schemas (versioned elsewhere per S-12), and the model request/response wire format. Those belong to the architecture and implementation stages. This document fixes only what the user can see and what each surface may ask main to do.









