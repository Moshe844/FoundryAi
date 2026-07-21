export type AcceptanceWorkflowStep =
  | { action: "goto"; path: string }
  | { action: "fill"; selector: string; value: string }
  | { action: "click"; selector: string }
  | { action: "check"; selector: string }
  | { action: "select"; selector: string; value: string };

export type AcceptanceWorkflowAssertion =
  | { kind: "url-matches"; value: string }
  | { kind: "text-visible"; value: string }
  | { kind: "selector-visible"; selector: string }
  | { kind: "selector-count"; selector: string; count: number };

export type AcceptanceWorkflow = {
  id: string;
  requirement: string;
  startPath: string;
  steps: AcceptanceWorkflowStep[];
  assertions: AcceptanceWorkflowAssertion[];
};

export type AcceptanceWorkflowManifest = { version: 1; workflows: AcceptanceWorkflow[] };

const safeSelector = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 500;
const safeText = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 1_000;

/** Parse the project-authored executable acceptance contract without allowing code execution. */
export function parseAcceptanceWorkflowManifest(input: string): AcceptanceWorkflowManifest | undefined {
  try {
    const parsed = JSON.parse(input) as Partial<AcceptanceWorkflowManifest>;
    if (parsed.version !== 1 || !Array.isArray(parsed.workflows) || !parsed.workflows.length || parsed.workflows.length > 25) return undefined;
    const workflows: AcceptanceWorkflow[] = [];
    for (const raw of parsed.workflows as Array<Partial<AcceptanceWorkflow>>) {
      if (!safeText(raw.id) || !safeText(raw.requirement) || typeof raw.startPath !== "string" || !raw.startPath.startsWith("/") || !Array.isArray(raw.steps) || !Array.isArray(raw.assertions) || !raw.assertions.length) return undefined;
      if (raw.steps.length > 40 || raw.assertions.length > 20) return undefined;
      for (const step of raw.steps) {
        if (!step || typeof step !== "object" || !["goto", "fill", "click", "check", "select"].includes((step as { action?: string }).action ?? "")) return undefined;
        if ((step.action === "goto" && (typeof step.path !== "string" || !step.path.startsWith("/")))
          || (step.action !== "goto" && !safeSelector(step.selector))
          || ((step.action === "fill" || step.action === "select") && typeof step.value !== "string")) return undefined;
      }
      for (const assertion of raw.assertions) {
        if (!assertion || typeof assertion !== "object" || !["url-matches", "text-visible", "selector-visible", "selector-count"].includes((assertion as { kind?: string }).kind ?? "")) return undefined;
        if ((assertion.kind === "url-matches" || assertion.kind === "text-visible") && !safeText(assertion.value)) return undefined;
        if ((assertion.kind === "selector-visible" || assertion.kind === "selector-count") && !safeSelector(assertion.selector)) return undefined;
        if (assertion.kind === "selector-count" && (!Number.isInteger(assertion.count) || assertion.count < 0 || assertion.count > 10_000)) return undefined;
      }
      workflows.push(raw as AcceptanceWorkflow);
    }
    return { version: 1, workflows };
  } catch {
    return undefined;
  }
}

export function acceptanceWorkflowTemplate() {
  return `Create .foundry/acceptance.json when a requested web behavior has no built-in deterministic driver. Use JSON only: {"version":1,"workflows":[{"id":"stable-id","requirement":"exact user-visible outcome","startPath":"/route","steps":[{"action":"fill","selector":"[data-testid='name']","value":"${"${uniqueText}"}"},{"action":"click","selector":"[data-testid='save']"}],"assertions":[{"kind":"text-visible","value":"${"${uniqueText}"}"}]}]}. Supported steps: goto(path), fill(selector,value), click(selector), check(selector), select(selector,value). Supported assertions: url-matches(value), text-visible(value), selector-visible(selector), selector-count(selector,count). Values may use ${"${uniqueText}"}, ${"${uniqueEmail}"}, and ${"${strongPassword}"}. Every selector must be stable and belong to the product UI.`;
}
