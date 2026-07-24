/** Operations that Foundry already owns must bypass the implementation model entirely. */
export function isPreviewRestartRequest(task: string) {
  const normalized = task.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 220) return false;
  if (/\b(?:fix|change|edit|update|redesign|build|test|verify|debug|repair|implement)\b/i.test(normalized)) return false;
  const namesPreview = /\b(?:local\s+)?preview\b|\b(?:dev(?:elopment)?\s+)?server\b|\b(?:site|website|webpage|page|app|application)\b/i.test(normalized);
  const asksStart = /\b(?:restart|relaunch|reopen|start|run|bring (?:it|the preview) back)\b/i.test(normalized)
    || /\b(?:get|make)\b[^.!?\n]{0,45}\b(?:running|available|reachable|work(?:ing)?)\b|\bturn\b[^.!?\n]{0,30}\b(?:on|back on)\b/i.test(normalized)
    || /\b(?:stopped|isn't|is not|not)\s+(?:running|available|up)\b/i.test(normalized)
    || /\b(?:can(?:not|['’]t)|could(?: not|n['’]t)|won['’]t)\s+be\s+reached\b|\brefused\s+to\s+connect\b/i.test(normalized);
  return namesPreview && asksStart;
}
