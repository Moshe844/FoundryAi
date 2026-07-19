export type DesktopInteractionAction = { action: "click"; name: string; automationId: string };

/** Derive literal user-named desktop controls without app-, framework-, or project-specific rules.
 * The Local Agent resolves these names through the operating system accessibility tree. */
export function desktopInteractionActionsForTask(task: string): DesktopInteractionAction[] {
  const actions: DesktopInteractionAction[] = [];
  const seen = new Set<string>();
  const pattern = /\b(?:click(?:ing|ed)?|press(?:ing|ed)?|tap(?:ping|ped)?)(?:\s+on)?\s+(?:the\s+)?["']?([a-z0-9][a-z0-9 _-]{0,48}?)["']?(?:\s+(?:button|menu\s+item|tab|control))?(?=\s*(?:,|\.|;|!|\?|$|\b(?:and|then|when|the\s+(?:app|application|window))\b))/gi;
  for (const match of task.matchAll(pattern)) {
    const name = match[1]?.trim().replace(/\s+(?:button|menu\s+item|tab|control)$/i, "");
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    actions.push({ action: "click", name, automationId: "" });
  }
  return actions;
}
