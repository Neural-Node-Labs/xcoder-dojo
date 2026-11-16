// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:03:05.954Z | xcoder:subtask test-st-bf6f22
/**
 * Markdown sanitiser tests.
 *
 * Intent (design T-07, UI-02): the parser returns an AST, never HTML. Raw HTML
 * and remote images must be *stripped and counted*, so the renderer has
 * nothing dangerous to insert. Code fences are literal text and must keep
 * their contents verbatim - sanitising code samples would be a bug.
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown';
import type { MarkdownBlock, MarkdownSpan } from '../../contracts';

function blocksOf(source: string): MarkdownBlock[] {
  return [...parseMarkdown('doc.md', source).blocks];
}

function spansOf(source: string): MarkdownSpan[] {
  const block = parseMarkdown('doc.md', source).blocks.find((b) => b.kind === 'paragraph');
  return block && block.kind === 'paragraph' ? [...block.spans] : [];
}

function allSpanText(blocks: readonly MarkdownBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote') {
      for (const span of block.spans) parts.push('text' in span ? span.text : '');
    }
    if (block.kind === 'list') {
      for (const item of block.items) for (const span of item) parts.push('text' in span ? span.text : '');
    }
  }
  return parts.join('\n');
}

describe('structure', () => {
  it('returns an empty block list for empty input', () => {
    const model = parseMarkdown('empty.md', '');
    expect(model.blocks).toEqual([]);
    expect(model.blockedImages).toBe(0);
    expect(model.strippedHtmlBlocks).toBe(0);
    expect(model.relPath).toBe('empty.md');
  });

  it('parses headings at every level', () => {
    const blocks = blocksOf('# One\n\n###### Six\n');
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 6 });
  });

  it('treats seven hashes as a paragraph, not a heading', () => {
    const blocks = blocksOf('####### Not a heading\n');
    expect(blocks[0].kind).toBe('paragraph');
  });

  it('parses a horizontal rule', () => {
    expect(blocksOf('a\n\n---\n\nb')[1]).toEqual({ kind: 'rule' });
  });

  it('parses unordered and ordered lists separately', () => {
    const blocks = blocksOf('- one\n- two\n\n1. first\n2. second\n');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('parses block quotes', () => {
    const blocks = blocksOf('> quoted line\n');
    expect(blocks[0]).toMatchObject({ kind: 'quote' });
  });

  it('normalises CRLF line endings', () => {
    const lf = blocksOf('# Title\n\nbody\n');
    const crlf = blocksOf('# Title\r\n\r\nbody\r\n');
    expect(crlf).toEqual(lf);
  });
});

describe('inline spans', () => {
  it('produces text, code, strong and em spans', () => {
    const spans = spansOf('plain `code` **bold** *italic*\n');
    expect(spans.map((s) => s.kind)).toEqual(['text', 'code', 'text', 'strong', 'text', 'em']);
    expect(spans.find((s) => s.kind === 'code')).toMatchObject({ text: 'code' });
    expect(spans.find((s) => s.kind === 'strong')).toMatchObject({ text: 'bold' });
  });

  it('flags absolute http(s) links as external and relative links as internal', () => {
    const external = spansOf('see [docs](https://example.com/x)\n').find((s) => s.kind === 'link');
    const internal = spansOf('see [tools](docs/tools.md)\n').find((s) => s.kind === 'link');
    expect(external).toMatchObject({ text: 'docs', href: 'https://example.com/x', external: true });
    expect(internal).toMatchObject({ text: 'tools', href: 'docs/tools.md', external: false });
  });
});

describe('sanitising', () => {
  it('strips a raw HTML block and counts it', () => {
    const model = parseMarkdown('x.md', '<div class="x">hi</div>\n\nafter\n');
    expect(model.strippedHtmlBlocks).toBeGreaterThanOrEqual(1);
    expect(allSpanText(model.blocks)).not.toContain('<div');
    expect(JSON.stringify(model.blocks)).not.toContain('<div');
  });

  it('strips inline HTML inside a paragraph and counts it', () => {
    const model = parseMarkdown('x.md', 'before <b>bold</b> after\n');
    expect(model.strippedHtmlBlocks).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(model.blocks)).not.toContain('<b>');
  });

  it('never emits a script tag in any span', () => {
    const model = parseMarkdown('x.md', '<script>alert(1)</script>\n');
    expect(JSON.stringify(model.blocks)).not.toContain('<script');
  });

  it('blocks remote images and counts them', () => {
    const model = parseMarkdown('x.md', 'Look: ![alt text](https://evil.example/pixel.png) done\n');
    expect(model.blockedImages).toBe(1);
    const spans = model.blocks[0].kind === 'paragraph' ? model.blocks[0].spans : [];
    const blocked = spans.find((s) => s.kind === 'blocked-image');
    expect(blocked).toMatchObject({ kind: 'blocked-image', alt: 'alt text' });
    expect(JSON.stringify(model.blocks)).not.toContain('https://evil.example');
  });

  it('counts each blocked image separately', () => {
    const model = parseMarkdown('x.md', '![a](http://x/1.png) and ![b](http://x/2.png)\n');
    expect(model.blockedImages).toBe(2);
  });

  it('preserves HTML-looking text inside a code fence', () => {
    const model = parseMarkdown('x.md', '```html\n<script>alert(1)</script>\n```\n');
    const code = model.blocks[0];
    expect(code).toMatchObject({ kind: 'code', language: 'html' });
    if (code.kind === 'code') expect(code.text).toContain('<script>alert(1)</script>');
    expect(model.strippedHtmlBlocks).toBe(0);
  });

  it('keeps the language of a fenced block and defaults to null', () => {
    const withLang = parseMarkdown('x.md', '```ts\nconst a = 1;\n```\n').blocks[0];
    const noLang = parseMarkdown('x.md', '```\nplain\n```\n').blocks[0];
    expect(withLang).toMatchObject({ kind: 'code', language: 'ts' });
    expect(noLang).toMatchObject({ kind: 'code', language: null });
  });
});

describe('link scheme policy', () => {
  it('does not hand a javascript: URL to the renderer', () => {
    const model = parseMarkdown('x.md', 'click [me](javascript:alert(1))\n');
    const link = model.blocks[0].kind === 'paragraph' ? model.blocks[0].spans.find((s) => s.kind === 'link') : undefined;
    expect(link, 'expected the link to be neutralised').toBeUndefined();
  });
});
