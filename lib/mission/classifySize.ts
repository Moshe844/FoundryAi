import type { MissionSize } from "@/lib/mission/reducer";

/**
 * Decides whether a mission gets the full phased-plan/checklist UI or a condensed single-line view.
 * Regex heuristic only for now — no LLM call, so it's free to run on every message including ones
 * (hard_stop/resolve_approval) that never reach classifyFollowUp's intent call. Deliberately
 * conservative: defaults to "medium" (full checklist) rather than under-classifying a real feature
 * request as tiny, since showing a checklist for a small task is a much smaller UX cost than hiding
 * plan tracking for a large one.
 */
export function classifyMissionSize(userRequest: string): MissionSize {
  const text = userRequest.trim().toLowerCase();
  if (!text) return "medium";

  if (isTinyRequest(text)) return "tiny";
  if (isSmallRequest(text)) return "small";
  if (isHugeRequest(text)) return "huge";
  if (isLargeRequest(text)) return "large";
  return "medium";
}

function isTinyRequest(text: string): boolean {
  if (text.length > 60) return false;
  return /\b(start|run|restart|stop|typo|rename|fix (the )?typo|update (the )?version|bump version)\b/.test(text) && !hasMultiFileSignal(text);
}

function isSmallRequest(text: string): boolean {
  if (text.length > 140) return false;
  const singleTweak = /\b(change|update|tweak|adjust|fix|move|rename|swap|remove|hide|show)\b/.test(text);
  return singleTweak && !hasMultiFileSignal(text) && !hasArchitectureSignal(text);
}

function isLargeRequest(text: string): boolean {
  return hasMultiFileSignal(text) || /\b(feature|page|flow|workflow|integrat|dashboard|refactor)\b/.test(text);
}

function isHugeRequest(text: string): boolean {
  return hasArchitectureSignal(text) || text.length > 400;
}

function hasMultiFileSignal(text: string): boolean {
  return /\b(pages|components|endpoints|screens|and also|as well as|multiple|several)\b/.test(text);
}

function hasArchitectureSignal(text: string): boolean {
  return /\b(migrate|convert (this|the) (app|project)|rewrite|new stack|from scratch|entire app|whole app|full rebuild|architecture)\b/.test(text);
}
