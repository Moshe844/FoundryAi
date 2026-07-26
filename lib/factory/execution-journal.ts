import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FactoryExecutionEvent, FactoryJournalEntry } from "@/lib/factory/types";

/**
 * The Execution Journal.
 *
 * Foundry's durable record of what it did and why. It already backed undo — every file write is stored
 * with its before-content so a change can be reverted — but a mission's *reasoning* was only ever in the
 * live timeline, which dies with the request. That is why "why did you change that file?" had nowhere to
 * be answered from, and why a final summary had to be reconstructed by a model from whatever context
 * happened to survive rather than read off the record.
 *
 * This module owns journal storage and the questions the journal exists to answer. Every query returns
 * only what was actually recorded: when the journal has nothing to say about a file, callers get an
 * empty result and must say so, never a plausible reconstruction.
 */

const journalsRoot = path.join(process.cwd(), ".foundry-data", "journals");

function journalPathFor(projectId: string) {
  const cleanId = projectId.replace(/[^a-zA-Z0-9-]/g, "_") || "project";
  return path.join(journalsRoot, cleanId, "journal.ndjson");
}

/**
 * Whether an event belongs in the durable record.
 *
 * `internal` marks an event as never-render, which is a presentation decision — it was also silently
 * acting as never-remember, so the model route chosen for a stage, a recovery strategy switch, and
 * requirement accounting all reached the user's screen as nothing and the journal as nothing. Rendering
 * and durability are separated here: anything carrying a rationale or a decision-grade tier is kept
 * regardless, while ordinary internal bookkeeping (exploratory reads, checklist sync) still stays out.
 */
export function shouldJournalEvent(event: FactoryExecutionEvent): boolean {
  if (event.transient) return false;
  if (!event.internal) return true;
  return Boolean(event.rationale || event.narrative || event.tier === "decision" || event.tier === "finding" || event.tier === "flag");
}

export async function appendJournalEntry(projectId: string, event: FactoryExecutionEvent, missionId?: string) {
  const entry: FactoryJournalEntry = {
    id: `journal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    projectId,
    missionId,
    timestamp: event.timestamp,
    event,
    beforeContent: event.beforeContent,
  };
  const filePath = journalPathFor(projectId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readJournal(projectId: string): Promise<FactoryJournalEntry[]> {
  const filePath = journalPathFor(projectId);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as FactoryJournalEntry;
      } catch {
        // One unreadable line must not blind Foundry to the rest of its own history.
        return null;
      }
    })
    .filter((entry): entry is FactoryJournalEntry => entry !== null);
}

export async function writeJournal(projectId: string, entries: FactoryJournalEntry[]) {
  const filePath = journalPathFor(projectId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, entries.length ? `${body}\n` : "", "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Questions the journal answers
// ─────────────────────────────────────────────────────────────────────────────

export type RecordedFileChange = {
  at: string;
  missionId?: string;
  /** The event kind as recorded — "file" for a creation, "edit" for a change to an existing file. */
  kind: FactoryExecutionEvent["kind"];
  /** The human title Foundry wrote at the time, for example "Updated app/page.tsx". */
  title: string;
  /** Why the change was made, when the acting stage recorded a reason. */
  rationale?: string;
  reverted: boolean;
};

/**
 * Every recorded change to one file, oldest first.
 *
 * This is what answers "why did you change that file?" — a question that must be answered from the
 * record and must never start a new build to go and find out.
 */
export async function explainFileChanges(projectId: string, filePath: string): Promise<RecordedFileChange[]> {
  const entries = await readJournal(projectId);
  const target = normalizePath(filePath);
  if (!target) return [];

  return entries
    .filter((entry) => {
      const recorded = normalizePath(entry.event.filePath ?? entry.event.fileName ?? "");
      if (!recorded) return false;
      // The same file is referred to by absolute path in one stage and project-relative in another, so
      // match on either being a path-segment suffix of the other rather than on exact string equality.
      return recorded === target || recorded.endsWith(`/${target}`) || target.endsWith(`/${recorded}`);
    })
    .map((entry) => ({
      at: entry.timestamp,
      missionId: entry.missionId,
      kind: entry.event.kind,
      title: entry.event.title,
      rationale: entry.event.rationale ?? entry.event.narrative?.rationale,
      reverted: Boolean(entry.reverted),
    }));
}

export type RecordedDecision = {
  at: string;
  missionId?: string;
  kind: FactoryExecutionEvent["kind"];
  title: string;
  rationale: string;
  evidence: string[];
  filePath?: string;
};

export type JournalScope = {
  /** Restrict to one execution. */
  missionId?: string;
  /**
   * Restrict to a set of executions. A specification worked across several windows has evidence under
   * each of their ids, and a resumed mission has to see all of it — reading only the current execution
   * would report work that plainly happened as never attempted.
   */
  missionIds?: string[];
};

function inScope(entry: { missionId?: string }, scope?: JournalScope): boolean {
  if (scope?.missionId) return entry.missionId === scope.missionId;
  if (scope?.missionIds?.length) return Boolean(entry.missionId && scope.missionIds.includes(entry.missionId));
  return true;
}

/** The reasoned choices on the record, optionally narrowed to one or more executions. */
export async function recordedDecisions(projectId: string, options?: JournalScope & { limit?: number }): Promise<RecordedDecision[]> {
  const entries = await readJournal(projectId);
  const decisions = entries
    .filter((entry) => inScope(entry, options))
    .flatMap<RecordedDecision>((entry) => {
      const rationale = (entry.event.rationale ?? entry.event.narrative?.rationale ?? "").trim();
      if (!rationale) return [];
      return [{
        at: entry.timestamp,
        missionId: entry.missionId,
        kind: entry.event.kind,
        title: entry.event.title,
        rationale,
        evidence: entry.event.narrative?.evidence ?? [],
        filePath: entry.event.filePath,
      }];
    });

  return options?.limit ? decisions.slice(-options.limit) : decisions;
}

/** The most recent mission recorded for this project, for resolving "the last run" without guessing. */
export async function latestJournaledMissionId(projectId: string): Promise<string | undefined> {
  const entries = await readJournal(projectId);
  return [...entries].reverse().find((entry) => entry.missionId)?.missionId;
}

export type JournalDigest = {
  missionId?: string;
  filesChanged: Array<{ filePath: string; title: string; rationale?: string }>;
  decisions: RecordedDecision[];
  commands: Array<{ command: string; exitCode?: number | null }>;
  blockers: string[];
  /** True when the journal holds nothing for this scope, so a caller must not narrate a mission. */
  empty: boolean;
};

/**
 * A compact, factual digest for grounding a final summary.
 *
 * The routing spec asks the summary stage to run on a cost-efficient model grounded entirely in the
 * Execution Journal. That only works if there is a bounded, already-filtered view of the record to hand
 * it — feeding a summarizer the raw journal is both expensive and an invitation to embellish.
 */
export async function journalDigest(projectId: string, options?: JournalScope): Promise<JournalDigest> {
  const entries = (await readJournal(projectId)).filter((entry) => inScope(entry, options));

  const filesChanged = new Map<string, { filePath: string; title: string; rationale?: string }>();
  const commands: Array<{ command: string; exitCode?: number | null }> = [];
  const blockers: string[] = [];

  for (const entry of entries) {
    const { event } = entry;
    if (event.filePath && (event.kind === "file" || event.kind === "edit") && event.status === "completed" && !entry.reverted) {
      // Latest write wins: the digest reports the file's final state in this mission, not each pass.
      filesChanged.set(normalizePath(event.filePath), {
        filePath: event.filePath,
        title: event.title,
        rationale: event.rationale ?? event.narrative?.rationale,
      });
    }
    if (event.command) commands.push({ command: event.command, exitCode: event.exitCode });
    if (event.kind === "blocked" || event.status === "error") {
      const blocker = event.output?.trim() || event.title.trim();
      if (blocker) blockers.push(blocker);
    }
  }

  const decisions = await recordedDecisions(projectId, options);
  return {
    missionId: options?.missionId,
    filesChanged: [...filesChanged.values()],
    decisions,
    commands,
    blockers: [...new Set(blockers)],
    empty: entries.length === 0,
  };
}

/** The digest as grounding text for a summary stage. Facts only — no interpretation is added here. */
export function formatJournalDigest(digest: JournalDigest): string {
  if (digest.empty) return "Execution journal: no entries recorded for this scope.";

  const sections = [
    `Files changed (${digest.filesChanged.length}):\n${digest.filesChanged.map((file) => `- ${file.filePath}: ${file.title}${file.rationale ? ` — ${file.rationale}` : ""}`).join("\n") || "- none"}`,
    `Recorded decisions:\n${digest.decisions.map((decision) => `- ${decision.title}: ${decision.rationale}`).join("\n") || "- none"}`,
    `Commands:\n${digest.commands.map((command) => `- ${command.command} → exit ${command.exitCode ?? "unknown"}`).join("\n") || "- none"}`,
    `Blockers recorded:\n${digest.blockers.map((blocker) => `- ${blocker}`).join("\n") || "- none"}`,
  ];
  return `Execution journal${digest.missionId ? ` for mission ${digest.missionId}` : ""}:\n\n${sections.join("\n\n")}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}
