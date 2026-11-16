// xcoder:version 3 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:32:16.398Z | xcoder:subtask code-st-1de5aa
/**
 * P-02 Workspace Explorer. Lazy, per-directory, server-projected tree.
 *
 * Nodes excluded by the backend simply do not exist here, so the filter is a
 * text filter over *loaded* nodes, never a client-side security boundary
 * (design T-05).
 */

import { useMemo } from 'react';
import type { FileNode, TreeNodePage } from '../../contracts';
import { useAppActions, useAppState } from '../store';

function matchesFilter(node: FileNode, filterText: string): boolean {
  if (filterText.length === 0) return true;
  return node.relPath.toLowerCase().includes(filterText.toLowerCase());
}

/** Renders a subtree, resolving each directory's own page from the store. */
function Subtree({ parentRelPath, depth }: { parentRelPath: string | null; depth: number }): JSX.Element {
  const state = useAppState();
  const key = parentRelPath ?? '';
  const page = state.explorer.nodesByParent[key];
  const loading = state.explorer.loadingParents.includes(key);
  const filterText = state.explorer.filterText;

  const visible = useMemo(() => {
    if (!page) return [];
    return page.entries.filter((n) => matchesFilter(n, filterText));
  }, [page, filterText]);

  if (!page) {
    return <div className="tree-note">{loading ? 'loading...' : 'not loaded'}</div>;
  }
  return (
    <>
      {visible.map((node) => (
        <TreeBranch key={node.relPath} node={node} depth={depth} />
      ))}
      {page.nextCursor ? <div className="tree-note">more entries available</div> : null}
    </>
  );
}

function TreeBranch({ node, depth }: { node: FileNode; depth: number }): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const childKey = node.relPath;
  const childPage = state.explorer.nodesByParent[childKey];
  const expanded = state.explorer.expandedRelPaths.includes(childKey);
  const loading = state.explorer.loadingParents.includes(childKey);
  const isDir = node.kind === 'dir';

  const onToggle = (): void => {
    if (!isDir) {
      void actions.openFile(node.relPath);
      return;
    }
    if (expanded) actions.collapseDir(node.relPath);
    else void actions.expandDir(node.relPath);
  };

  return (
    <div>
      <button
        type="button"
        className={`tree-row ${isDir ? 'tree-dir' : 'tree-file'} ${state.explorer.selection?.relPath === node.relPath ? 'selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={onToggle}
        title={node.relPath}
      >
        <span className="tree-caret">{isDir ? (expanded ? '\u25be' : '\u25b8') : ' '}</span>
        <span className="tree-name">{node.name}</span>
        {loading ? <span className="tree-spinner">...</span> : null}
        {!isDir && node.language ? <span className="tree-lang">{node.language}</span> : null}
      </button>
      {isDir && expanded ? <Subtree parentRelPath={node.relPath} depth={depth + 1} /> : null}
      {isDir && expanded && childPage && childPage.nextCursor ? (
        <div className="tree-note" style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}>
          more entries available
        </div>
      ) : null}
    </div>
  );
}

export function Explorer(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  return (
    <aside className="dock dock-left">
      <header className="dock-head">
        <span>Explorer</span>
        <button type="button" className="icon-btn" title="Refresh root" onClick={() => void actions.expandDir(null)}>
          &#x21bb;
        </button>
      </header>
      <div className="explorer-root">
        <span className="tree-name root-label">{state.explorer.workspaceRootLabel || 'workspace'}</span>
      </div>
      <input
        className="filter-input"
        placeholder="Filter loaded files"
        value={state.explorer.filterText}
        onChange={(e) => actions.setFilter(e.target.value)}
        aria-label="Filter workspace tree"
      />
      <div className="tree-scroll">
        <Subtree parentRelPath={null} depth={0} />
      </div>
      <div className="dock-foot muted">
        Excluded: dotfiles, generated dirs and credential-shaped names (server-side).
      </div>
    </aside>
  );
}
