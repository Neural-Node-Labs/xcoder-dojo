<!-- xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:43:06.044Z | xcoder:subtask code-st-1de5aa -->
# Xcoder Dojo

A TypeScript UI IDE with an embedded agent (JARVIS), implementing the page
specification in `.xcoder/backlog/design-st-2c7624.md`. It is a fresh,
self-contained build — nothing is imported from the PyQt6 reference in
`../xcoder-ai-dojo/`.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build
npm run typecheck  # tsc --noEmit
npm test           # runtime smoke suite, 40 assertions
```

## Layers

```
src/contracts/   every type that crosses a page boundary
src/backend/     the privileged layer: sandbox, tools, audit, bridge
src/ui/          the pages P-00 .. P-12
```

The UI never touches a path or a process directly. It calls `DojoBridge`, which
validates and enforces in the backend. In Electron this object would sit behind
`contextBridge` in the main process; here it runs in the renderer but keeps the
same contract.

## Pages implemented

| Page | Component |
| --- | --- |
| P-00 App Shell | `ui/App.tsx` |
| P-01 Welcome | `ui/pages/WelcomePage.tsx` |
| P-02 / P-02a Explorer | `ui/components/Explorer.tsx` |
| P-03 / a / b / c Editor | `ui/pages/EditorPage.tsx`, `SyntaxEditor.tsx`, `MarkdownView.tsx` |
| P-04 / P-04a Run Console | `ui/pages/RunConsolePage.tsx` |
| P-05 / a / b / c Agent Panel | `ui/pages/AgentPanel.tsx`, `TranscriptView.tsx`, `components/ToolCard.tsx` |
| P-06 Delegation | `ui/pages/DelegationPage.tsx` |
| P-07 Approval Sheet | `ui/pages/ApprovalSheet.tsx` |
| P-08 / a / b / c Settings | `ui/pages/SettingsModal.tsx` |
| P-09 History | `ui/pages/HistoryModal.tsx` |
| P-10 Audit Log | `ui/pages/AuditModal.tsx` |
| P-11 Status Bar | `ui/components/StatusBar.tsx` |
| P-12 Error Center | `ui/components/ErrorCenter.tsx` |

## Safety properties (and where they are enforced)

These are enforced in code, not in a prompt, and each has a smoke assertion:

- **Path sandbox** (`backend/sandbox.ts`) — absolute paths, `..`, backslashes,
  NULs, dotfiles, generated dirs and credential-shaped names are refused. The
  tree is a projection of that decision, so excluded nodes are never listed.
- **Closed tool allowlist** (`backend/tools.ts`) — `dispatchTool` checks the
  allowlist as its first statement. A fabricated tool name returns
  `denied-allowlist` and never reaches an implementation.
- **Sanitized markdown** (`backend/markdown.ts`) — returns an AST, never HTML.
  Block and inline HTML are stripped, images become `blocked-image` spans. The
  renderer has no `dangerouslySetInnerHTML` and no `<img>`.
- **Approval gate** (`backend/demo-bridge.ts`) — exactly two actions require
  approval: `file-write` and `delegation-launch`. Requests expire, and an
  unknown or stale `approvalId` is refused as `approval-expired`.
- **Single-flight console** — a second concurrent run is refused as `run-busy`,
  so there is always exactly one auditable execution and one Stop target.
- **Write-only secret** (`backend/store.ts`) — there is no getter that returns
  the API key. Views expose `hasApiKey: boolean` and nothing else.
- **Redacted audit log** (`backend/audit.ts`) — summaries are redacted at write
  time and the log is append-only with a retention cap.
- **Untrusted agent output** (`ui/pages/TranscriptView.tsx`) — model text renders
  escaped with an "AI-generated" label; tool cards are built from backend
  records, never parsed out of model text, so an injection cannot forge UI.

The local model stub (`backend/agent-engine.ts`) is deterministic and can only
*request* tools. It reports injection attempts it finds in workspace content
instead of obeying them.

## Demo data

The workspace is an in-memory virtual filesystem (`backend/vfs.ts`) seeded with
realistic files. It deliberately contains `.env`, `.git/` and `node_modules/` so
the exclusion behaviour is observable: those exist in the store but never appear
in the tree.
