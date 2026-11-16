// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:04:44.093Z | xcoder:subtask test-st-bf6f22
/**
 * Entry-point contract tests.
 *
 * src/main.tsx has no runtime-testable exports (it mounts on import) and is a
 * file rather than a directory, so its guarantees are asserted at the source
 * and document level - which is where they can actually regress: one bridge
 * instance, mounted inside the provider, with a restrictive Content-Security
 * Policy in the shipped HTML.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();

async function read(...segments: string[]): Promise<string> {
  return readFile(resolve(root, ...segments), 'utf8');
}

function cspOf(html: string): string {
  return (/content="([^"]*default-src[^"]*)"/i.exec(html)?.[1] ?? '').toLowerCase();
}

describe('index.html', () => {
  it('declares a Content-Security-Policy that denies inline script and object embedding', async () => {
    const html = await read('index.html');
    const csp = cspOf(html);
    expect(csp, 'expected a CSP meta tag').not.toBe('');
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]) {
      expect(csp, `missing ${directive}`).toContain(directive);
    }
  });

  it('does not allow unsafe-eval or a wildcard script source', async () => {
    const csp = cspOf(await read('index.html'));
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('script-src *');
  });

  it('does not permit remote images, so markdown cannot phone home', async () => {
    const csp = cspOf(await read('index.html'));
    expect(csp).toContain('img-src');
    expect(csp).not.toContain('img-src *');
    expect(csp).not.toContain('img-src https:');
  });

  it('mounts the app on a root element', async () => {
    const html = await read('index.html');
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/src/main.tsx"');
  });
});

describe('main.tsx', () => {
  it('constructs exactly one bridge', async () => {
    const source = await read('src', 'main.tsx');
    expect(source.match(/createDemoBridge\(/g)).toHaveLength(1);
  });

  it('mounts the shell inside the provider with that bridge', async () => {
    const source = await read('src', 'main.tsx');
    expect(source).toContain('<AppProvider bridge={bridge}>');
    expect(source).toContain('<App />');
  });

  it('fails loudly instead of silently doing nothing when the root is missing', async () => {
    const source = await read('src', 'main.tsx');
    expect(source).toMatch(/if \(!container\)/);
    expect(source).toMatch(/throw new Error/);
  });
});

describe('package scripts', () => {
  it('exposes the commands the SDLC gate runs', async () => {
    const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBeTruthy();
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.scripts.test).toBeTruthy();
    expect(pkg.scripts.regression).toBeTruthy();
  });

  it('keeps the dependency surface small: react and react-dom only', async () => {
    const pkg = JSON.parse(await read('package.json')) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['react', 'react-dom']);
  });
});
