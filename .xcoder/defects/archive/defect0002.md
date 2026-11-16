<!-- xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:06:00.263Z | xcoder:subtask test-st-bf6f22 -->
# defect0002 — Markdown preview handed `javascript:` URLs to the renderer

- **Defect ID:** defect0002
- **Discovered by:** tester (subtask `test-st-bf6f22`)
- **Severity:** high
- **Status:** fixed in this subtask

## Observed behaviour

The sanitiser stripped raw HTML and remote images, but a Markdown link with a
script scheme survived intact. Parsing

```md
click [me](javascript:alert(1))
```

produced a link span with `href: 'javascript:alert(1)'`, and `MarkdownView`
rendered it as `<a href="javascript:alert(1)">me</a>`. Any `data:`,
`vbscript:` or mixed-case variant behaved the same way.

## Expected behaviour

The design (T-07, UI-02) says the parser "never returns HTML" so the renderer
"has nothing dangerous to insert". A script-scheme href defeats that: the AST
is data, but the `href` attribute is an executable sink. The UI also renders
model- and workspace-derived text, so this is the classic
"raw model output into an interpreter" path (bylaw PRM-08).

Expected: unsafe schemes are neutralised - the link label survives as inert
text and no executable URL reaches the DOM. `http:`, `https:`, `mailto:`, and
root-relative/fragment links remain valid, with `http(s)` still flagged
`external: true` so the renderer can add `rel="noopener noreferrer"`.

## Reproduction steps

1. `npm install` in `xcoder-dojo/`.
2. Run `npx vitest run --config vitest.config.ts src/backend/__tests__/markdown.test.ts`.
3. Before the fix, failed:
   - `link scheme policy > does not hand a javascript: URL to the renderer`
     -> `expected the link to be neutralised: expected { kind: 'link', text: 'me' } to be undefined`

## Root cause hypothesis

In `inline()` (`src/backend/markdown.ts`) the link branch accepted any
non-empty destination:

```ts
const href = link[2].trim();
const external = /^https?:\/\//i.test(href);
spans.push({ kind: 'link', text: link[1], href, external });
```

The `external` flag only decides presentation; nothing validated the scheme.
Sanitising was implemented for HTML and images but this third sink was
overlooked because it looked like "a link" rather than "an href".

Fix: add an allowlist-based `isSafeHref` (`http`, `https`, `mailto`, or no
scheme at all) and, for anything else, emit the link text as a plain text
span. Allowlisting a small set is safer than blocklisting `javascript:`,
because the blocklist always misses a case.

## Affected files

- `xcoder-dojo/src/backend/markdown.ts` (fixed)
- `xcoder-dojo/src/backend/__tests__/markdown.test.ts` (regression coverage)
- `xcoder-dojo/src/ui/__tests__/render.test.ts` (render-level regression coverage)

## Verification

`npx vitest run --config vitest.config.ts src/backend/__tests__/markdown.test.ts src/ui/__tests__/render.test.ts`
-> 38 tests passed, including the new `neutralises a javascript: link` render assertion.
