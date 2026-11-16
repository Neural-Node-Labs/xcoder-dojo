// xcoder:version 4 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:31:57.868Z | xcoder:subtask code-st-1de5aa
/**
 * P-03b Markdown preview.
 *
 * Renders the sanitized AST only. There is no dangerouslySetInnerHTML and no
 * <img>: images come back from the backend as `blocked-image` spans and are
 * shown as a labelled placeholder (design T-07).
 */

import type { MarkdownBlock, MarkdownPreviewModel, MarkdownSpan } from '../../contracts';

function Span({ span }: { span: MarkdownSpan }): JSX.Element | null {
  switch (span.kind) {
    case 'text':
      return <>{span.text}</>;
    case 'code':
      return <code className="md-code">{span.text}</code>;
    case 'strong':
      return <strong>{span.text}</strong>;
    case 'em':
      return <em>{span.text}</em>;
    case 'link':
      return (
        <a
          className={span.external ? 'md-link md-link-external' : 'md-link'}
          href={span.href}
          target={span.external ? '_blank' : undefined}
          rel="noopener noreferrer"
          title={span.external ? 'External link' : undefined}
        >
          {span.text}
          {span.external ? ' \u2197' : ''}
        </a>
      );
    case 'blocked-image':
      return (
        <span className="md-blocked-image" title="Remote images are blocked">
          image blocked: {span.alt || '(no alt text)'}
        </span>
      );
    default:
      return null;
  }
}

function Spans({ spans }: { spans: readonly MarkdownSpan[] }): JSX.Element {
  return (
    <>
      {spans.map((span, index) => (
        <Span key={index} span={span} />
      ))}
    </>
  );
}

function Block({ block }: { block: MarkdownBlock }): JSX.Element | null {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1';
      return (
        <Tag className="md-heading">
          <Spans spans={block.spans} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="md-p">
          <Spans spans={block.spans} />
        </p>
      );
    case 'code':
      return (
        <pre className="md-pre">
          <code>{block.text}</code>
        </pre>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className="md-list">
          {block.items.map((item, index) => (
            <li key={index}>
              <Spans spans={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className="md-quote">
          <Spans spans={block.spans} />
        </blockquote>
      );
    case 'rule':
      return <hr className="md-rule" />;
    default:
      return null;
  }
}

export function MarkdownView({ model }: { model: MarkdownPreviewModel }): JSX.Element {
  const htmlNote = model.strippedHtmlBlocks > 0 ? ` \u00b7 ${model.strippedHtmlBlocks} HTML block(s) stripped` : '';
  const imgNote = model.blockedImages > 0 ? ` \u00b7 ${model.blockedImages} image(s) blocked` : '';
  return (
    <div className="markdown-view">
      <div className="md-banner">
        Sanitized preview &mdash; raw HTML is never rendered
        {htmlNote}
        {imgNote}
      </div>
      <article className="md-body">
        {model.blocks.map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </article>
    </div>
  );
}
