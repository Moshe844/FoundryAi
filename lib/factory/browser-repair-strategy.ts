/**
 * Browser evidence can describe either a local defect in an implemented screen or proof that the
 * product slice itself does not exist. Those are different jobs.
 *
 * Missing routes and workflows must never enter the targeted replace-in-file lane. That lane cannot
 * create the coordinated screens, state, and tests the evidence is asking for.
 */
export type BrowserRepairStrategy = "targeted-source-repair" | "coordinated-product-slice";

const MISSING_PRODUCT_SURFACE = [
  /\bHTTP response:\s*404\b/i,
  /\bno reachable route\b/i,
  /\bmissing (?:or failing )?capability\b/i,
  /\bworkflow could not be located\b/i,
  /\brequested page elements:\s*0\//i,
  /\bno element matched for:\s*(?:navigation|a form|a search control)\b/i,
  /\bdid not contain enough meaningful visible application content\b/i,
  /\b(?:login|sign[- ]?up|registration|checkout|catalog|cart)\b[^.\n]{0,100}\b(?:was not completed|did not provide|could not be located|is missing)\b/i,
];

export function browserRepairStrategy(evidence: string): BrowserRepairStrategy {
  return MISSING_PRODUCT_SURFACE.some((pattern) => pattern.test(evidence))
    ? "coordinated-product-slice"
    : "targeted-source-repair";
}

