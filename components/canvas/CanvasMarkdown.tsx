"use client";

import type { ReactNode } from "react";

/**
 * Small, dependency-free Markdown renderer for model voice/answer text. React owns every node, so
 * model output is escaped by default; no raw HTML or dangerouslySetInnerHTML crosses the canvas.
 */
export function CanvasMarkdown({ value, live = false }: { value: string; live?: boolean }) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```([\w.+-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${index}`} className="overflow-x-auto rounded-md border border-overlay/10 bg-shade/35 p-3 font-mono text-[12.5px] leading-5 text-foundry-ink">
          <code data-language={fence[1] || undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const children = inlineMarkdown(heading[2], `heading-${index}`);
      blocks.push(level === 2 ? <h2 key={`h-${index}`}>{children}</h2> : level === 3 ? <h3 key={`h-${index}`}>{children}</h3> : <h4 key={`h-${index}`}>{children}</h4>);
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(<li key={`ul-${index}`}>{inlineMarkdown(lines[index].replace(/^\s*[-*+]\s+/, ""), `ul-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-block-${index}`}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(<li key={`ol-${index}`}>{inlineMarkdown(lines[index].replace(/^\s*\d+[.)]\s+/, ""), `ol-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-block-${index}`}>{items}</ol>);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={`quote-${index}`}><p>{inlineMarkdown(quote.join(" "), `quote-${index}`)}</p></blockquote>);
      continue;
    }

    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) paragraph.push(lines[index++].trim());
    blocks.push(<p key={`p-${index}`}>{inlineMarkdown(paragraph.join(" "), `p-${index}`)}</p>);
  }

  return <div className="foundry-markdown max-w-[78ch] text-[15px] leading-[1.65] text-foundry-ink" aria-live={live ? "polite" : undefined}>{blocks}</div>;
}

function startsBlock(line: string) {
  return /^\s*(?:```|#{2,4}\s|[-*+]\s+|\d+[.)]\s+|>\s?|---+\s*$|___+\s*$)/.test(line);
}

function inlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const tokens = value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|_[^_\n]+_)/g).filter(Boolean);
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={key}>{inlineMarkdown(token.slice(2, -2), `${key}-strong`)}</strong>;
    if (token.startsWith("`") && token.endsWith("`")) return <code key={key}>{token.slice(1, -1)}</code>;
    if (token.startsWith("_") && token.endsWith("_")) return <em key={key}>{inlineMarkdown(token.slice(1, -1), `${key}-em`)}</em>;
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && /^https?:\/\//i.test(link[2])) return <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return token;
  });
}
