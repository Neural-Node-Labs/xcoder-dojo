<!-- xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:05:54.840Z | xcoder:subtask test-st-bf6f22 -->
# defect0001 — Agent read tools leak credential, dotfile and generated paths

- **Defect ID:** defect0001
- **Discovered by:** tester (subtask `test-st-bf6f22`)
- **Severity:** high
- **Status:** fixed in this subtask

## Observed behaviour

The agent's allowlisted read tools enumerated paths that the UI tree is
required to hide. With the seeded demo workspace:

- `list_dir` on the root returned `.git/`, `node_modules/` and `.env` in its
  summary, e.g. `8 entries in .: .git/, docs/, node_modules/, ...`.
- `glob` with pattern `**/*` returned `.env` and `.git/config`.
- `grep` for `SOME_API_KEY` returned a hit of `.env:1`, i.e. the agent could
  confirm the location and line number of a credential file.

`tree.listChildren` correctly filtered these entries, so the UI hid them while
the agent did not.

## Expected behaviour

`README.md` states: "The agent can only call the 11 allowlisted read tools",
and the design (P-02 security notes, S-06) states that dotfiles, generated
directories and credential-shaped names are *never visible*. The allowlist
restricts **which tools** may run; the sandbox must restrict **what they can
touch**. Hiding a path from the explorer while exposing it to the agent is a
security boundary with two different answers.

Specifically:

- `.env` must never appear in any tool summary, and its contents must never be
  readable or greppable (see `crypto-architect` bylaw PRM-09: policy enforced
  in code, not by the prompt).
- `node_modules/`, `dist/`, `build/`, `.git/` and `.xcoder/` must not be
  enumerable by the agent.

## Reproduction steps

1. `npm install` in `xcoder-dojo/`.
2. Run `npx vitest run --config vitest.config.ts src/backend/__tests__/tools.test.ts`.
3. Before the fix, three tests failed:
   - `list_dir > never lists credential-shaped or generated entries`
   - `glob > does not leak hidden or generated file paths`
   - `grep > never returns a hit inside a credential file`

Equivalent manual reproduction:

```ts
const vfs = createVfs(Date.now());
dispatchTool(vfs, { toolName: 'grep', args: { pattern: 'SOME_API_KEY' } });
// -> { outcome: 'ok', summary: '1 match(es) for /SOME_API_KEY/: .env:1' }
```

## Root cause hypothesis

`dispatchTool` in `src/backend/tools.ts` applies `normalizeRelPath` to the
*requested* path, which correctly refuses an explicit `.env` argument. But the
enumeration tools (`list_dir`, `glob`, `grep`) then iterate over
`vfs.entries` directly and never apply the `isVisibleName` filter that
`tree.listChildren` applies in `demo-bridge.ts`. The visibility rule lived in
only one of the two call sites, so it was a defence with a hole in the other.

Fix: add a single `isVisibleRelPath` helper in `tools.ts` that requires every
segment to satisfy `isVisibleName`, and apply it to `list_dir` results, `glob`
matches and `grep` files. The rule now has one definition and both call sites
use it.

## Affected files

- `xcoder-dojo/src/backend/tools.ts` (fixed)
- `xcoder-dojo/src/backend/__tests__/tools.test.ts` (regression coverage added)

## Verification

`npx vitest run --config vitest.config.ts src/backend/__tests__/tools.test.ts`
-> 33 tests passed, including the three previously failing leak assertions.
