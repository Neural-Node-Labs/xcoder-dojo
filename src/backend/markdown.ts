// xcoder:version 5 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:05:33.644Z | xcoder:subtask test-st-bf6f22
/**
 * A deliberately small, sanitizing Markdown parser.
 *
 * It never returns HTML. Raw HTML blocks are stripped and counted; images are
 * replaced with a blocked-image span and counted. The renderer therefore has
 * nothing dangerous to insert (design T-07, UI-02).
 */

import type { MarkdownBlock, MarkdownPreviewModel, MarkdownSpan } from '../contracts';

const HTML_BLOCK = /^\s*<[a-zA-Z!/][^>]*>/;
const HTML_INLINE = /<\/?[a-zA-Z][^>]*>/g;
const IMAGE_MD = /!\[([^\]]*)\]\(([^)]*)\)/g;

interface Counters {
  blockedImages: number;
  strippedHtmlBlocks: number;
}

/**
 * Allow only schemes that cannot execute script when clicked. Relative links
 * and http(s) are fine; javascript:/data:/vbscript: and friends are not.
 */
function isSafeHref(href: string): boolean {
  if (href.length === 0) return false;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(href);
  if (!scheme) return true; // relative link or fragment
  const name = scheme[1].toLowerCase();
  return name === 'http' || name === 'https' || name === 'mailto';
}

function inline(text: string, counters: Counters): MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  // Inline HTML is stripped before anything else, so a tag can never survive
  // into a span as literal markup-looking text (design T-07).
  const withoutHtml = text.replace(HTML_INLINE, () => {
    counters.strippedHtmlBlocks += 1;
    return '';
  });
  const replaced = withoutHtml.replace(IMAGE_MD, (_m, alt: string) => {
    counters.blockedImages += 1;
    spans.push({ kind: 'blocked-image', alt });
    return '';
  });

  const tokens = replaced.split(/(`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]*\]\([^)]*\))/g);
  let buffer = '';

  const flush = (): void => {
    if (buffer.length > 0) {
      spans.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  for (const token of tokens) {
    if (token.length === 0) continue;
    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      flush();
      spans.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      flush();
      spans.push({ kind: 'strong', text: token.slice(2, -2) });
    } else if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      flush();
      spans.push({ kind: 'em', text: token.slice(1, -1) });
    } else {
      const link = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
      if (link) {
        flush();
        const href = link[2].trim();
        if (isSafeHref(href)) {
          const external = /^https?:\/\//i.test(href);
          spans.push({ kind: 'link', text: link[1], href, external });
        } else {
          // Unsafe scheme (javascript:, data:, vbscript:, ...): keep the label
          // as inert text rather than handing an executable URL to the renderer.
          spans.push({ kind: 'text', text: link[1] });
        }
      } else {
        buffer += token;
      }
    }
  }
  flush();
  return spans;
}

export function parseMarkdown(relPath: string, source: string): MarkdownPreviewModel {
  const counters: Counters = { blockedImages: 0, strippedHtmlBlocks: 0 };
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  let i = 0;
  let inFence = false;
  let fenceLang: string | null = null;
  let fenceLines: string[] = [];
  let paraLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let quoteLines: string[] = [];

  const flushPara = (): void => {
    if (paraLines.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: inline(paraLines.join(' '), counters) });
    paraLines = [];
  };
  const flushList = (): void => {
    if (listItems.length === 0) return;
    blocks.push({ kind: 'list', ordered: listOrdered, items: listItems.map((item) => inline(item, counters)) });
    listItems = [];
  };
  const flushQuote = (): void => {
    if (quoteLines.length === 0) return;
    blocks.push({ kind: 'quote', spans: inline(quoteLines.join(' '), counters) });
    quoteLines = [];
  };
  const flushAll = (): void => {
    flushPara();
    flushList();
    flushQuote();
  };

  while (i < lines.length) {
    const line = lines[i];

    if (inFence) {
      if (/^\s*```/.test(line)) {
        blocks.push({ kind: 'code', language: fenceLang, text: fenceLines.join('\n') });
        inFence = false;
        fenceLang = null;
        fenceLines = [];
      } else {
        fenceLines.push(line);
      }
      i += 1;
      continue;
    }

    const fenceOpen = /^\s*```(\S*)\s*$/.exec(line);
    if (fenceOpen) {
      flushAll();
      inFence = true;
      fenceLang = fenceOpen[1].length > 0 ? fenceOpen[1] : null;
      fenceLines = [];
      i += 1;
      continue;
    }

    if (HTML_BLOCK.test(line)) {
      counters.strippedHtmlBlocks += 1;
      flushAll();
      i += 1;
      while (i < lines.length && lines[i].trim().length > 0 && !/^\s*<\/[a-zA-Z]/.test(lines[i])) {
        i += 1;
      }
      if (i < lines.length && /^\s*<\/[a-zA-Z]/.test(lines[i])) i += 1;
      continue;
    }

    if (line.trim().length === 0) {
      flushAll();
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: 'heading', level, spans: inline(heading[2], counters) });
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushAll();
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      flushList();
      quoteLines.push(quote[1]);
      i += 1;
      continue;
    }

    const ulItem = /^\s*[-*+]\s+(.*)$/.exec(line);
    const olItem = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ulItem || olItem) {
      flushPara();
      flushQuote();
      const ordered = Boolean(olItem);
      if (listItems.length > 0 && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listItems.push((ulItem ?? olItem)?.[1] ?? '');
      i += 1;
      continue;
    }

    flushList();
    flushQuote();
    paraLines.push(line.trim());
    i += 1;
  }

  if (inFence) {
    blocks.push({ kind: 'code', language: fenceLang, text: fenceLines.join('\n') });
  }
  flushAll();

  return { relPath, blocks, blockedImages: counters.blockedImages, strippedHtmlBlocks: counters.strippedHtmlBlocks };
}
