<!-- xcoder:version 4 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:20:41.952Z | xcoder:subtask document-st-fbebd7 -->
# Xcoder Dojo — Blueprint

Current architecture, workflow and feature inventory for `xcoder-dojo/`, the
TypeScript re-implementation of the Xcoder AI Dojo desktop workbench.

Source of truth for *what to build* is `.xcoder/backlog/requirements-st-b1522d.md`
(15 requirements, safety rules S-01..S-13, acceptance criteria AC-01..AC-21) and
`.xcoder/backlog/design-st-2c7624.md` (page specs P-00..P-12). This document
describes what was actually built.

---

## 1. What this is

A single-user, local-first IDE: open a folder, browse and edit files, run the
project, and talk to an embedded agent (JARVIS) that can inspect the workspace
through allowlisted read tools and propose a write that you must approve.

Two things are deliberately true of the build:

- **Nothing is imported from `../xcoder-ai-dojo/`** (the Python 3.10 / PyQt6
  v0.1.4 reference). `xcoder-dojo/` is a fresh, self-contained folder. The
  reference was read-only input.
- **Both halves are TypeScript.** The UI *and* the agent (tool dispatch, memory,
  bounds, approval logic) are TS. There is no Python at runtime.

Scope was cut explicitly in requirements §2. Out of scope for v1: the voice
subsystem (NG-01), a Docker agent catalogue (NG-02), installers/code signing
(NG-03), the Butler persona (NG-04), LSP/debugger/Git UI/package-manager GUIs
(NG-05), multi-user/cloud (NG-06), pixel-parity theming (NG-07), a durable AI
task board (NG-08), migration of the PyQt `~/.xcoder/dojo` data root (NG-09), and
non-English recognition models (NG-10).

---

## 2. Architecture

```
xcoder-dojo/
  src/contracts/   every type that crosses a page boundary (no runtime deps)
  src/backend/     the privileged layer: sandbox, vfs, tools, agent, audit, bridge
  src/ui/          P-00 shell + pages P-01..P-12 and the shared components
  src/main.tsx     the single entry point: bridge construction -> render
  test/smoke.ts    40 end-to-end assertions driving the bridge
```

### 2.1 The one hardening boundary: `DojoBridge`

`src/contracts/bridge.ts` defines `DojoBridge` — *the entire privileged surface
exposed to the UI*. There is no `ipcRenderer` passthrough and no generic
`invoke(channel, ...)`: every capability is an explicitly named method that
returns a `BridgeResult<T>`. The frozen surface is 11 sub-APIs plus a
subscription:

| API | Methods |
| --- | --- |
| `workspace` | `current` `recents` `open` `close` |
| `tree` | `listChildren` (cursor-paged) |
| `files` | `read` `save` `agentWrite` `markdown` |
| `run` | `targets` `session` `start` `stop` |
| `agent` | `state` `send` `stop` `retryLast` `clearConversation` |
| `session` | `list` `load` `clear` `clearAll` |
| `delegation` | `current` `launch` `stop` |
| `approval` | `pending` `respond` |
| `settings` | `get` `patch` `setApiKey` `clearApiKey` |
| `audit` | `page` `location` |
| `status` | `get` |
| — | `subscribe(listener): () => void` |

The UI never touches a path or a process directly; it calls the bridge, which
normalises and enforces in `src/backend/`. In Electron this object would sit
behind `contextBridge` in the main process. Here it runs in the renderer while
keeping the identical contract, so promoting it later is a transport change, not
an API redesign (constraint C-02 permitted this substitution).

`BridgeEvent` is the push channel: `agent`, `run`, `delegation`,
`approval-requested`, `approval-resolved`, `audit`, `settings-changed`,
`status-changed`, `error`. Pages never poll.

### 2.2 Backend modules

| File | Responsibility |
| --- | --- |
| `sandbox.ts` | Path normalisation + visibility. The single chokepoint every `relPath` passes through. |
| `vfs.ts` | Virtual file system used by the demo bridge, so the UI is exercisable without a real disk. |
| `tools.ts` | `dispatchTool` — the only entry point to the 11 allowlisted read tools. |
| `agent-engine.ts` | Deterministic local model stub + injection detection. |
| `audit.ts` | Append-only, redacted-at-write-time audit log. |
| `store.ts` | Settings, limits, recents, sessions; `DEFAULT_LIMITS`. |
| `markdown.ts` | Markdown → AST (never HTML). |
| `demo-bridge.ts` | `createDemoBridge()` — wires all of the above into `DojoBridge`. |

### 2.3 UI layer

`src/ui/App.tsx` is the P-00 shell: title bar (brand, active workspace path,
JARVIS/Delegation dock switch, audit + settings buttons, close workspace),
left dock (Explorer), center column (`EditorPage` or `WelcomePage`), bottom dock
(`RunConsolePage`), right dock (`AgentPanel` / `DelegationPage`), status bar,
error center, and the approval overlay slot.

State survives navigation because overlays never unmount the shell. Pages read
via `useAppState` / write via `useAppActions` (`store.tsx`); the provider
(`AppProvider.tsx`) owns state and subscribes to the bridge once.

`src/main.tsx` is small and contract-tested: it builds exactly one bridge, calls
`autoConfigureModel`, resolves `#root` (refusing to boot without it), and renders
`<App/>` inside `<AppProvider bridge={...}>` within `StrictMode` — bridge
constructed *before* render, in that order.

---

## 3. Feature inventory

Pages implemented, mapped to their design IDs and files (from README):

| Design | Feature | Component |
| --- | --- | --- |
| P-00 | App shell | `ui/App.tsx` |
| P-01 | Welcome / recent workspaces | `ui/pages/WelcomePage.tsx` |
| P-02 / P-02a | Explorer tree | `ui/components/Explorer.tsx` |
| P-03 / a / b / c | Editor: tabs, syntax highlighting, line numbers, markdown preview | `EditorPage.tsx`, `SyntaxEditor.tsx`, `MarkdownView.tsx` |
| P-04 / P-04a | Run console with stop control | `RunConsolePage.tsx` |
| P-05 / a / b / c | Agent panel, transcript, tool cards | `AgentPanel.tsx`, `TranscriptView.tsx`, `ToolCard.tsx` |
| P-06 | Delegation to the agent CLI | `DelegationPage.tsx` |
| P-07 | Approval sheet | `ApprovalSheet.tsx` |
| P-08 / a / b / c | Settings (model, theme, limits, key) | `SettingsModal.tsx` |
| P-09 | Chat history | `HistoryModal.tsx` |
| P-10 | Audit log | `AuditModal.tsx` |
| P-11 | Status bar | `components/StatusBar.tsx` |
| P-12 | Error center | `components/ErrorCenter.tsx` |

Runtime limits and defaults, in `src/backend/store.ts`:

- `DEFAULT_LIMITS` = `maxTurns: 5`, `maxInputChars: 4_000`, `requestCapPerHour: 40`
- `maxFileReadBytes = 200_000` (reads above this are truncated and flagged)
- `APPROVAL_TTL_MS = 120_000` in `demo-bridge.ts`
- `auditRetentionDays = 30`; audit log dir `.xcoder/logs/audit`
- themes: `dojo-dark` (default), `dojo-hud`, `dojo-light`
- model identity: `local-stub / dojo-local-7b`; delegation CLI label `xcoder-agent-cli`

---

## 4. Workflow: the end-to-end loop

The loop the requirements defined as the definition of success:

1. **Open a folder** → `workspace.open(rootDisplayPath)` normalises the root,
   records a recent (max 10), and emits `status-changed`.
2. **View the tree** → `tree.listChildren` is cursor-paged (`nextCursor`),
   reports `truncated` past 1500 entries, and returns `scannedFiles`. The tree is
   a *projection* of the sandbox decision, so excluded nodes are never listed.
3. **Open and edit** → `files.read` returns `{ content, encoding, eol, language,
   sizeBytes, truncated, savedSha }`. `encoding` is `'utf-8' | 'utf-8-bom'` and
   `eol` is `'lf' | 'crlf'` — both round-trip through `files.save`, which is how
   AC-04 (BOM/CRLF fidelity) is met.
4. **Save** → `files.save` validates via `normalizeWritePath`, then writes.
5. **Run** → `run.targets()` lists `CommandSpec`s; `run.start` spawns with the
   workspace as cwd, streams `RunEvent`s, enforces a timeout and output caps, and
   `run.stop` is the visible Stop control.
6. **Ask the agent** → `agent.send` records the request, runs the model stub,
   dispatches read tools, and streams `AgentEvent`s (tokens + `ToolCallRecord`s)
   to the panel.
7. **Approve a write** → the agent cannot write. `files.agentWrite` and
   `delegation.launch` each call `requestApproval(...)`, which queues an
   `ApprovalRequest` (kind `file-write` | `delegation-launch`, naming the concrete
   target), emits `approval-requested`, and blocks until `approval.respond` or
   the 120 s TTL. Everything else is refused outright rather than approved.

---

## 5. Safety properties — where each is enforced

Per PRM-09 / S-05, these are enforced in code, not by prompt instructions. Each
has a smoke assertion in `test/smoke.ts` (40 total).

| Property | Enforced in | Mechanism |
| --- | --- | --- |
| Path sandbox (S-06) | `backend/sandbox.ts` | Refuses absolute paths, `..`, backslashes, NULs, dotfiles, excluded dirs (`node_modules`, `dist`, `build`, `.git`, `.xcoder`), and credential-shaped names (`.env*`, `*.pem`, `*.key`, `id_rsa` \| `ed25519` \| `ecdsa`, `.npmrc`, `.netrc`, `credentials(.json)`, `secrets.*`). |
| Closed tool allowlist (PRM-04, S-03) | `backend/tools.ts` | `dispatchTool` checks `isAllowlistedTool` as its *first* statement. A fabricated name returns `denied-allowlist` and never reaches an implementation. The 11 tools are exactly: `list_dir`, `glob`, `grep`, `read_file`, `read_multiple_files`, `read_file_lines`, `read_outline`, `validate_file`, `git_status`, `git_diff`, `git_log`. No `run_command`/`shell`/`fetch_url`/`eval` is exposed to the model. |
| Injection is data (PRM-01/02) | `backend/agent-engine.ts` | `detectInjection` matches ignore-previous-instructions / exfiltrate / reveal-key patterns. The stub *reports* an injection attempt instead of acting on it. |
| Sanitized markdown (PRM-08) | `backend/markdown.ts` | Returns an AST, never HTML. Inline HTML is stripped before anything else so a tag can never survive; raw HTML blocks become stripped and images become `blocked-image` spans. Both are *counted* (`strippedHtmlBlocks`, `blockedImages`) so the UI can show what was suppressed. |
| Human approval (AI-03, S-07) | `backend/demo-bridge.ts` | `requestApproval` gates `file-write` and `delegation-launch`, naming the target; 120 s TTL → `expired`. |
| Bounded execution (AI-04, S-08) | `backend/demo-bridge.ts` | Run processes use the workspace as cwd, no shell interpolation of model strings, a timeout, output caps, and a Stop control. |
| Cost/abuse caps (AI-09, S-10) | `backend/store.ts` | `maxTurns: 5`, `maxInputChars: 4_000`, `requestCapPerHour: 40`, plus a kill switch (`agent.stop`) aborting in-flight work. |
| Redacted audit (PRM-10, S-11) | `backend/audit.ts` | Redaction happens **at write time** (`redact()` on `sk-…`, `Bearer …`, `api_key` / `token` / `password` = …), so un-redacted text never exists in the store to leak later. Retention 30 days; location disclosed in the UI. |
| No key exfiltration (PRM-03) | `backend/store.ts` | `setApiKey` accepts a key and never returns it; `secretState()` exposes only `{ hasApiKey, updatedAtMs }`. The audit smoke assertion confirms the key is never recorded. |
| Structured output (PRM-07/08, S-04) | `contracts/` + `tools.ts` | Tool calls are schema-typed; unparseable output is rejected and surfaced, never executed. |

---

## 6. Verification status

Commands (run from inside `xcoder-dojo/`):

```bash
npm run dev        # vite dev server, http://localhost:5173
npm run build      # tsc --noEmit && vite build
npm run typecheck  # tsc --noEmit
npm run test:unit  # vitest, 12 files / 283 tests
npm run test:smoke # esbuild test/smoke.ts -> node, 40 assertions
npm run regression # typecheck && test:unit && test:smoke
```

Last verified state: `tsc --noEmit` clean; **12 test files, 283 tests passed**
in 1.53 s; smoke suite **40 passed, 0 failed** and the process exits 0 on its own.

Test layout: `src/backend/__tests__/` (agent-engine 31, demo-bridge 41, tools 33,
approval-timer 4, plus audit/markdown/sandbox/vfs), `src/contracts/__tests__/`
(contracts, entry), `src/ui/__tests__/` (render 21, main-entry 7).

Two runner notes that cost time and are worth keeping:

- `src/main.tsx` is a **file**, not a folder. A `FOLDER_SCOPE` glob of
  `src/main.tsx/**/*.test.ts` matches nothing and zeroes the whole vitest run
  ("No test files found"). Its coverage lives at
  `src/ui/__tests__/main-entry.test.ts`; the three real folders are
  `src/backend`, `src/contracts`, `src/ui`.
- Do **not** use `npx --prefix` for vitest here — it does not change cwd and
  breaks `--config` resolution. Invoke vitest from inside `xcoder-dojo/`.

---

## 7. Known defects and lessons

### defect0003 — approval expiry timer leaked (fixed)

`npm run regression` never exited: smoke printed `40 passed, 0 failed` then hung
with ~0.09 s CPU consumed. The assertions were fine — `requestApproval()` armed a
120 s timer and discarded the handle, so `approval.respond` removed the ticket
without calling `clearTimeout`. The orphaned timer kept the Node event loop alive
for the full TTL, so the gate timed out despite passing every check.

Fix in `backend/demo-bridge.ts`: `ApprovalTicket` carries an optional `timer`;
`requestApproval` stores it and `unref()`s it (feature-detected, so browser
`setTimeout` returning a number is unaffected); `approval.respond` calls
`clearTimeout(ticket.timer)` before deleting the ticket. The expiry callback now
re-reads the ticket instead of resolving through a captured closure, so an
answered request can never later route an `expired` resolution.

Lesson: a passing assertion set is not a passing gate — a process that does not
exit is a failure. Timers owned by long-lived objects must be cancellable *and*
`unref()`d. Full RCA: `.xcoder/defects/defect0003.md`.

Earlier defects are recorded in `.xcoder/defects/defect0001.md` and
`defect0002.md`.

---

## 8. Conventions

Every source file opens with a provenance comment, e.g.
`// xcoder:version 5 | xcoder:task task-f1d1f4 | xcoder:updated … | xcoder:subtask …`.
Keep it current when editing. Exported signatures avoid `any` (constraint C-01,
`strict: true`). Prompts and tool schemas are version-controlled files, not
inline strings scattered across components (S-12). Dependencies are pinned with a
committed lockfile and no postinstall download of unpinned binaries (S-13).
