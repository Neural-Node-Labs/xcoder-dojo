<!-- xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:20:32.447Z | xcoder:subtask document-st-fbebd7 -->
# Changelog — xcoder-dojo

Change record for the TypeScript re-implementation of the Xcoder AI Dojo
workbench. Architecture and feature inventory live in `.xcoder/blueprint.md`.

---

## 0.1.0 — initial TypeScript build (task-f1d1f4)

### What changed

Created `xcoder-dojo/`, a new top-level, self-contained folder — nothing is
imported from the Python 3.10 / PyQt6 reference in `../xcoder-ai-dojo/` (v0.1.4).
Both the UI **and** the agent are TypeScript; no Python is required at runtime.

**Layers**

- `src/contracts/` — every type that crosses a page boundary. `bridge.ts` freezes
  `DojoBridge` as the entire privileged surface: 11 explicitly named sub-APIs
  (`workspace`, `tree`, `files`, `run`, `agent`, `session`, `delegation`,
  `approval`, `settings`, `audit`, `status`) plus `subscribe`. No `ipcRenderer`
  passthrough, no generic `invoke(channel, …)`.
- `src/backend/` — the privileged layer: `sandbox.ts` (path chokepoint), `vfs.ts`,
  `tools.ts` (allowlist dispatch), `agent-engine.ts` (deterministic model stub),
  `audit.ts`, `store.ts`, `markdown.ts`, and `demo-bridge.ts`
  (`createDemoBridge()`, which wires them into the bridge).
- `src/ui/` — P-00 shell plus pages P-01..P-12 and shared components.
- `test/smoke.ts` — 40 end-to-end assertions driving the bridge.

**Features** — the loop from the requirements runs end to end: open a folder →
lazy, cursor-paged tree → open/edit a file (`encoding: 'utf-8' | 'utf-8-bom'`,
`eol: 'lf' | 'crlf'`, both round-tripping through `files.save`) → run with a
visible Stop control → ask JARVIS, which inspects the workspace through
allowlisted read tools → approve the agent's proposed write.

### Why

The requirements (`.xcoder/backlog/requirements-st-b1522d.md`) defined success as
*the loop running against a real workspace, verified by driving the app* — not as
a folder existing. The design (`.xcoder/backlog/design-st-2c7624.md`) specified
pages P-00..P-12. Scope was cut deliberately to keep that loop honest: no voice
subsystem (NG-01), no Docker agent catalogue (NG-02), no installers (NG-03), no
Butler persona (NG-04), no LSP/debugger/Git UI (NG-05).

Security posture is enforced in code, not in a prompt (PRM-09 / S-05), because a
system-prompt instruction is not a security boundary:

- **Path sandbox** (`sandbox.ts`) refuses absolute paths, `..`, backslashes,
  NULs, dotfiles, `node_modules`/`dist`/`build`/`.git`/`.xcoder`, and
  credential-shaped names (`.env*`, `*.pem`, `*.key`, `id_rsa|ed25519|ecdsa`,
  `.npmrc`, `.netrc`, `credentials(.json)`, `secrets.*`).
- **Closed tool allowlist** — `dispatchTool` checks `isAllowlistedTool` as its
  *first* statement; the 11 tools are `list_dir`, `glob`, `grep`, `read_file`,
  `read_multiple_files`, `read_file_lines`, `read_outline`, `validate_file`,
  `git_status`, `git_diff`, `git_log`. No `run_command`/`shell`/`fetch_url`/`eval`
  reaches the model.
- **Human approval** for `file-write` and `delegation-launch`, naming the concrete
  target, with a 120 s TTL → `expired`.
- **Redaction at write time** in `audit.ts` (`sk-…`, `Bearer …`,
  `api_key|token|password = …`), so un-redacted text never exists in the store.
- **Key never readable** — `Store.setApiKey` accepts a key; `secretState()`
  exposes only `{ hasApiKey, updatedAtMs }`.

### Fixed during this task

**defect0003 (high) — approval expiry timer leaked, hanging any Node process
that used the bridge.** `npm run regression` never terminated: `test:smoke`
printed `40 passed, 0 failed` and then hung with ~0.09 s CPU. The assertions were
fine; `requestApproval()` in `demo-bridge.ts` armed a 120 s timer and discarded
the handle, so `approval.respond` removed the ticket without `clearTimeout`. The
orphan kept the event loop alive for the full TTL, so the gate timed out despite
every check passing.

Fix: `ApprovalTicket` now carries an optional `timer`; `requestApproval` stores
it and `unref()`s it (feature-detected, so browser `setTimeout` returning a number
is unaffected); `approval.respond` calls `clearTimeout(ticket.timer)` before
deleting the ticket. The expiry callback re-reads the ticket instead of resolving
through a captured closure, so an answered request can never later route an
`expired` resolution. RCA: `.xcoder/defects/defect0003.md`.

### Verification

From inside `xcoder-dojo/`:

```
npm run typecheck   # tsc --noEmit — clean
npm run test:unit   # 12 files, 283 tests passed (1.53 s)
npm run test:smoke  # 40 passed, 0 failed — process exits 0 on its own
npm run regression  # typecheck && test:unit && test:smoke
```

New coverage added with the fix: `src/backend/__tests__/approval-timer.test.ts`
(4 tests, fails against pre-fix code — asserted timer count stays at 1 after a
response) and `src/ui/__tests__/main-entry.test.ts` (7 tests).

### Rollback

`xcoder-dojo/` is additive — no existing workspace file was modified to create it,
so rollback is `Remove-Item -Recurse xcoder-dojo` (or delete the folder). To
revert only defect0003, restore the discarded-handle form of `requestApproval()`
in `src/backend/demo-bridge.ts`; do not do this — it re-breaks `npm run
regression`.

The docs this task touched are `.xcoder/blueprint.md` (created) and
`xcoder-dojo/CHANGELOG.md` (this file).

### Gotchas for the next person

- `src/main.tsx` is a **file**, not a folder. A `FOLDER_SCOPE` glob of
  `src/main.tsx/**/*.test.ts` matches nothing and zeroes the whole vitest run
  ("No test files found"). Its coverage lives at
  `src/ui/__tests__/main-entry.test.ts`; the real folders are `src/backend`,
  `src/contracts`, `src/ui`.
- Do **not** use `npx --prefix` for vitest — it does not change cwd and breaks
  `--config` resolution. Run it from inside `xcoder-dojo/`.
- A passing assertion set is not a passing gate. A process that will not exit is
  a failure; long-lived timers must be both cancellable and `unref()`d.
