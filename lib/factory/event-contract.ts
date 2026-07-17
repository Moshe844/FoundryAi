import type { FactoryExecutionEvent } from "@/lib/factory/types";

const lifecycleKinds = new Set<FactoryExecutionEvent["kind"]>([
  "command", "build", "file", "edit", "folder", "inspection", "preview", "fix",
]);

/** A running operation and its terminal result are one durable fact. */
export function matchingRunningEventId(
  timeline: FactoryExecutionEvent[],
  event: Pick<FactoryExecutionEvent, "kind" | "command" | "filePath">,
): string | undefined {
  if (!lifecycleKinds.has(event.kind)) return undefined;
  return [...timeline].reverse().find((candidate) => {
    if (candidate.status !== "running" || candidate.kind !== event.kind) return false;
    if (event.command || candidate.command) return candidate.command === event.command;
    if (event.filePath || candidate.filePath) return candidate.filePath === event.filePath;
    return true;
  })?.id;
}

/** Mutates a live timeline while preserving one identity per operation. */
export function upsertExecutionEvent(timeline: FactoryExecutionEvent[], event: FactoryExecutionEvent): void {
  const index = timeline.findIndex((candidate) => candidate.id === event.id);
  if (index === -1) timeline.push(event);
  else if (event.transient && event.status === "running") {
    // A long-lived activity identity (for example provider wait) stays one row but returns to the
    // live edge when newer command/file evidence has appeared since its previous update.
    timeline.splice(index, 1);
    timeline.push(event);
  }
  else timeline.splice(index, 1, event);
}

/** Reconciles streamed state with persisted state using the same identity contract. */
export function mergeExecutionTimelines(existing: FactoryExecutionEvent[], incoming: FactoryExecutionEvent[]): FactoryExecutionEvent[] {
  const merged = [...existing];
  for (const event of incoming) upsertExecutionEvent(merged, event);
  return merged;
}

type CompactProblem = { key: string; display: string; count: number };

function normalizedProblem(problem: string): { key: string; display: string } | undefined {
  const cleaned = problem.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  const responsive = cleaned.match(/^Responsive layout:\s+(?:desktop|mobile)\s+([^:]+):\s+(.+?)[.]*$/i);
  if (responsive) {
    const route = responsive[1].trim();
    const issue = responsive[2].trim().replace(/[.]+$/, "");
    const isRouteSpecific = /^(?:route returned|layout check failed)/i.test(issue);
    return {
      key: `responsive:${isRouteSpecific ? `${route.toLowerCase()}:` : ""}${issue.toLowerCase()}`,
      display: isRouteSpecific ? `Responsive layout: ${route}: ${issue}.` : `Responsive layout: ${issue}.`,
    };
  }
  return { key: cleaned.toLowerCase(), display: cleaned };
}

/** Collapses route/viewport samples into concise unique findings with occurrence counts. */
export function compactValidationProblems(problems: string[], limit = 12): string[] {
  const records = new Map<string, CompactProblem>();
  for (const problem of problems) {
    const normalized = normalizedProblem(problem);
    if (!normalized) continue;
    const previous = records.get(normalized.key);
    if (previous) previous.count += 1;
    else records.set(normalized.key, { ...normalized, count: 1 });
  }
  const all = [...records.values()];
  const visible = all.slice(0, limit).map((record) =>
    record.count > 1 ? `${record.display} Observed in ${record.count} checks.` : record.display,
  );
  if (all.length > limit) visible.push(`${all.length - limit} additional unique finding(s) are retained in validation evidence.`);
  return visible;
}

/** Compacts old persisted failure prose without rewriting historical evidence. */
export function compactEvidenceText(text: string, maxCharacters = 2_400): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;
  const markers = /(?=(?:Console:|Page error:|Failed local request:|Responsive layout:|Screenshot:))/g;
  const pieces = cleaned.split(markers).map((piece) => piece.trim()).filter(Boolean);
  const compacted = pieces.length > 1 ? compactValidationProblems(pieces).join(" ") : cleaned;
  if (compacted.length <= maxCharacters) return compacted;
  return `${compacted.slice(0, Math.max(0, maxCharacters - 55)).trimEnd()}… Additional recorded evidence is hidden from this summary.`;
}
