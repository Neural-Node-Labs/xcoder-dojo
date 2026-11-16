// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:16:56.690Z | xcoder:subtask test-st-bf6f22
/**
 * Entry-point (src/main.tsx) contract tests.
 *
 * main.tsx is the one place allowed to construct the privileged bridge and
 * mount React. The intent encoded here, taken from the design:
 *   1. there is exactly ONE bridge, created at the entry point (components
 *      must never open their own privileged channel);
 *   2. the entry refuses to boot without a `#root` container instead of
 *      silently rendering nowhere;
 *   3. it mounts under StrictMode and inside AppProvider so no page can
 *      render outside the bridge context.
 *
 * The entry has top-level side effects (createRoot + render), so it is
 * asserted at the source-invariant level rather than by importing it, which
 * would require a real DOM and leave an open React root behind.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entryPath = fileURLToPath(new URL('../../main.tsx', import.meta.url));
const source = readFileSync(entryPath, 'utf8');

/** Strip comments so a comment mentioning a symbol never satisfies an assertion. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('src/main.tsx entry contract', () => {
  it('creates exactly one demo bridge', () => {
    const constructions = code.match(/createDemoBridge\s*\(/g) ?? [];
    expect(constructions).toHaveLength(1);
  });

  it('auto-configures the model for the demo session', () => {
    expect(code).toMatch(/createDemoBridge\(\s*\{[^}]*autoConfigureModel:\s*true/);
  });

  it('mounts into the #root container', () => {
    expect(code).toContain("getElementById('root')");
  });

  it('refuses to boot when the root container is missing', () => {
    expect(code).toMatch(/if\s*\(\s*!container\s*\)/);
    expect(code).toMatch(/throw new Error\(/);
  });

  it('renders App inside AppProvider with the bridge', () => {
    expect(code).toContain('<AppProvider');
    expect(code).toMatch(/bridge=\{bridge\}/);
    expect(code).toContain('<App />');
  });

  it('mounts under StrictMode', () => {
    expect(code).toContain('<StrictMode>');
  });

  it('constructs the bridge before mounting', () => {
    const constructionIndex = code.indexOf('createDemoBridge(');
    const renderIndex = code.indexOf('.render(');
    expect(constructionIndex).toBeGreaterThanOrEqual(0);
    expect(renderIndex).toBeGreaterThan(constructionIndex);
  });
});
