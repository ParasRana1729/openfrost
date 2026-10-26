import type { ReactNode } from 'react';

/**
 * Minimal Markdown renderer for untrusted report content.
 *
 * Security stance: report content must never become raw HTML. There is no
 * `dangerouslySetInnerHTML`, no dependency, and every piece of text reaches
 * the DOM as a React child, which React always escapes. Anchors are emitted
 * only for URLs that parse as http(s); every other scheme or target stays
 * plain text. Supported surface is deliberately small: headings, paragraphs,
 * unordered/ordered lists, blockquotes, horizontal rules, GFM-style tables,
 * fenced code, and inline bold, code, and links.
 */

const FENCE = '```';
const MAX_QUOTE_DEPTH = 4;

function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** GFM table delimiter row: `| --- | :---: |` (pipes optional at the edges). */
function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!/^\|?[\s:|-]+\|?$/.test(trimmed) || !trimmed.includes('-')) {
    return false;
  }
  return trimmed.replace(/^\||\|$/g, '').trim().split('|').length >= 2;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Renders inline bold, code, and http(s)-only links; the rest stays text. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={nodes.length}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<code key={nodes.length}>{match[2]}</code>);
    } else {
      const href = safeHttpUrl(match[4] ?? '');
      if (href !== null) {
        nodes.push(
          <a
            key={nodes.length}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {match[3] ?? ''}
          </a>,
        );
      } else {
        // Unknown scheme or junk target: keep the whole token as text.
        nodes.push(match[0]);
      }
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function isBlockStart(line: string): boolean {
  return (
    line.trimStart().startsWith(FENCE) ||
    /^#{1,6}\s/.test(line) ||
    /^\s*[-*] /.test(line) ||
    /^\s*\d+\. /.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*-{3,}\s*$/.test(line)
  );
}

function renderBlocks(lines: readonly string[], depth: number): ReactNode[] {
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const key = blocks.length;

    if (line.trimStart().startsWith(FENCE)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const current = lines[i] ?? '';
        if (current.trimStart().startsWith(FENCE)) {
          break;
        }
        body.push(current);
        i += 1;
      }
      i += 1; // step past the closing fence (or end of input)
      blocks.push(
        <pre key={key}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={key}>{renderInline(heading[2] ?? '')}</Tag>);
      i += 1;
      continue;
    }

    if (/^\s*-{3,}\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      i += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) {
        quoted.push((lines[i] ?? '').replace(/^\s*> ?/, ''));
        i += 1;
      }
      // Depth is capped so pathological nesting cannot recurse unbounded.
      blocks.push(
        <blockquote key={key}>
          {depth >= MAX_QUOTE_DEPTH
            ? renderInline(quoted.join(' '))
            : renderBlocks(quoted, depth + 1)}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*] /, ''));
        i += 1;
      }
      blocks.push(
        <ul key={key}>
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // GFM table: a `|`-row followed by a delimiter row. Cells are split on
    // unescaped pipes and rendered inline; nothing here becomes HTML.
    if (line.includes('|') && isTableDelimiter(lines[i + 1] ?? '')) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (
        i < lines.length &&
        (lines[i] ?? '').includes('|') &&
        (lines[i] ?? '').trim().length > 0
      ) {
        rows.push(splitTableRow(lines[i] ?? ''));
        i += 1;
      }
      blocks.push(
        <div className="table-wrap" key={key}>
          <table>
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={index}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\. /.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\. /, ''));
        i += 1;
      }
      blocks.push(
        <ol key={key}>
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (
        current.trim() === '' ||
        isBlockStart(current) ||
        // A table start also interrupts a paragraph.
        (current.includes('|') && isTableDelimiter(lines[i + 1] ?? ''))
      ) {
        break;
      }
      paragraph.push(current);
      i += 1;
    }
    blocks.push(<p key={key}>{renderInline(paragraph.join(' '))}</p>);
  }
  return blocks;
}

export function MarkdownView({ markdown }: { markdown: string }) {
  return <div className="md">{renderBlocks(markdown.split(/\r?\n/), 0)}</div>;
}
