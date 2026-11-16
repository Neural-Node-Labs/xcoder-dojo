// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:27:43.816Z | xcoder:subtask code-st-1de5aa
/**
 * Page models for the workspace-facing surfaces: P-00 shell, P-01 welcome,
 * P-02 explorer, P-03 editor, P-03b markdown preview.
 */

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'python'
  | 'text'
  | 'binary';

/* ---------------------------------------------------------------- workspace */

export interface WorkspaceInfo {
  workspaceId: string;
  rootLabel: string;
  rootDisplayPath: string;
  openedAtMs: number;
}

export interface RecentWorkspace {
  rootDisplayPath: string;
  label: string;
  lastOpenedAtMs: number;
}

export interface WelcomeModel {
  recents: readonly RecentWorkspace[];
  modelState: 'configured' | 'missing' | 'error';
  modelLabel: string | null;
}

/* --------------------------------------------------------------- file tree */

export interface FileNode {
  nodeId: string;
  relPath: string;
  name: string;
  kind: 'file' | 'dir';
  hasChildren: boolean;
  language?: SupportedLanguage;
  sizeBytes?: number;
  mtimeMs?: number;
}

export interface ListChildrenRequest {
  parentRelPath: string | null;
  cursor?: string;
  limit?: number;
}

export interface TreeNodePage {
  parentRelPath: string | null;
  entries: readonly FileNode[];
  nextCursor: string | null;
  truncated: boolean;
  scannedFiles: number;
}

export interface ExplorerModel {
  workspaceRootLabel: string;
  nodesByParent: Readonly<Record<string, TreeNodePage>>;
  expandedRelPaths: readonly string[];
  selection: { relPath: string; kind: 'file' | 'dir' } | null;
  filter: { text: string; applied: boolean };
  loadingParents: readonly string[];
}

export type NodeContextAction = 'open' | 'reveal' | 'copyRelativePath' | 'refresh' | 'run';

export interface NodeContextMenuModel {
  relPath: string;
  kind: 'file' | 'dir';
  items: readonly {
    action: NodeContextAction;
    enabled: boolean;
    disabledReason?: string;
  }[];
}

/* ------------------------------------------------------------------ editor */

export type FileOpenErrorCode =
  | 'binary-file'
  | 'not-utf8'
  | 'file-too-large'
  | 'outside-workspace'
  | 'denied-credential'
  | 'missing';

export interface FileReadResult {
  relPath: string;
  content: string;
  encoding: 'utf-8' | 'utf-8-bom';
  eol: 'lf' | 'crlf';
  language: SupportedLanguage;
  sizeBytes: number;
  truncated: boolean;
  savedSha: string;
}

export interface EditorTabState {
  tabId: string;
  relPath: string;
  kind: 'text' | 'markdown' | 'error';
  language: SupportedLanguage;
  encoding: 'utf-8' | 'utf-8-bom';
  eol: 'lf' | 'crlf';
  dirty: boolean;
  readOnly: boolean;
  truncated: boolean;
  errorCode?: FileOpenErrorCode;
  savedSha: string | null;
}

export interface SaveRequest {
  tabId: string;
  relPath: string;
  content: string;
  baseSha: string;
  writeNewFile: boolean;
}

export interface SaveResult {
  ok: boolean;
  relPath: string;
  bytesWritten: number;
  encoding: 'utf-8' | 'utf-8-bom';
  eol: 'lf' | 'crlf';
  savedSha: string;
  savedAtMs: number;
  error?: import('./errors').AppError;
}

export interface EditorModel {
  tabs: readonly EditorTabState[];
  activeTabId: string | null;
  splitPreview: { open: boolean; tabId: string | null };
  saveInFlight: readonly string[];
}

/* ------------------------------------------------------------ markdown AST */

export type MarkdownSpan =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string; external: boolean }
  | { kind: 'blocked-image'; alt: string };

export type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; spans: readonly MarkdownSpan[] }
  | { kind: 'paragraph'; spans: readonly MarkdownSpan[] }
  | { kind: 'code'; language: string | null; text: string }
  | { kind: 'list'; ordered: boolean; items: readonly (readonly MarkdownSpan[])[] }
  | { kind: 'quote'; spans: readonly MarkdownSpan[] }
  | { kind: 'rule' };

export interface MarkdownPreviewModel {
  relPath: string;
  blocks: readonly MarkdownBlock[];
  blockedImages: number;
  strippedHtmlBlocks: number;
}
