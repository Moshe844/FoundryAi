import type { OutcomeType } from "@/lib/mission-engine";

export type ArtifactKind = "document" | "code" | "command" | "table" | "diagram" | "sketch" | "report";

export function artifactKindForOutcome(outcome: OutcomeType): ArtifactKind {
  if (outcome === "code" || outcome === "patch") return "code";
  if (outcome === "command") return "command";
  if (outcome === "diagram") return "diagram";
  if (outcome === "sketch" || outcome === "mockup") return "sketch";
  if (outcome === "fileAnalysis" || outcome === "report") return "report";
  return "document";
}

export function titleFromContent(content: string, fallback: string) {
  const firstHeading = content.match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (firstHeading) return cleanTitle(firstHeading);

  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return fallback;
  return cleanTitle(firstLine);
}

export function plainTextFromMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/gi, "").replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .trim();
}

export function downloadTextFile(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function markdownToHtml(markdown: string) {
  const escaped = escapeHtml(markdown);

  return escaped
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br />");
}

export function downloadMarkdown(filename: string, markdown: string) {
  downloadTextFile(filename, markdown, "text/markdown;charset=utf-8");
}

export function downloadTxt(filename: string, markdown: string) {
  downloadTextFile(filename, plainTextFromMarkdown(markdown));
}

export function downloadDocx(filename: string, markdown: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title></head><body>${markdownToHtml(markdown)}</body></html>`;
  downloadTextFile(filename, html, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

export function printMarkdown(title: string, markdown: string) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) return;

  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Inter, Segoe UI, Arial, sans-serif; line-height: 1.55; padding: 32px; color: #111; }
          code, pre { font-family: Consolas, monospace; background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
          h1, h2, h3 { line-height: 1.2; }
        </style>
      </head>
      <body>${markdownToHtml(markdown)}</body>
    </html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export async function copyText(content: string) {
  await navigator.clipboard.writeText(content);
}

export async function shareContent(title: string, text: string) {
  if (navigator.share) {
    await navigator.share({ title, text });
    return;
  }

  await copyText(text);
}

function cleanTitle(value: string) {
  const stripped = plainTextFromMarkdown(value).replace(/[^\w\s.-]/g, "").trim();
  if (stripped.length <= 80) return stripped || "Foundry Artifact";
  return `${stripped.slice(0, 77).trim()}...`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
