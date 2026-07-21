import { guessDomainSeed, type DiscoverySeed, type ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import type { DiscoveryRefinementContext, StackOption } from "@/lib/ai/project-discovery-llm";
import type { ModelMode, TierResolution } from "@/lib/ai/model-router";

export type { DiscoverySeed } from "@/lib/ai/project-discovery";

/**
 * Discovery Engine core — two mandatory stages, not "heuristic + optional override":
 *
 * Stage A: seedDiscovery() — pure, sync, ~0ms. Populates the DiscoveryRail instantly on card
 * click/keystroke, before any network call resolves.
 *
 * Stage B: runDiscoveryEngine() — the only entry point UI should call for the real analysis. Wraps
 * the existing /api/factory/discover route (unchanged in this step — see project-discovery-llm.ts for
 * the tool schema/prompt). Extracted out of UnderstandingStep's inline fetch so it's reusable from
 * both the new-project flow and the future migration entry flow (Import/Convert/Clone).
 */
export function seedDiscovery(prompt: string): DiscoverySeed {
  return guessDomainSeed(prompt);
}

export type DiscoveryEngineResult = {
  ok: boolean;
  provenance?: "model" | "brief";
  discovery?: ProjectDiscoveryResult;
  alternativeStacks?: string[];
  deploymentNote?: string;
  lede?: string;
  stackOptions?: StackOption[];
  error?: string;
  modelSelection?: TierResolution & { autoSelected: boolean; reason?: string };
};

export type { StackOption } from "@/lib/ai/project-discovery-llm";

export async function runDiscoveryEngine(
  heuristic: ProjectDiscoveryResult,
  context: DiscoveryRefinementContext,
  opts?: { signal?: AbortSignal; mode?: ModelMode }
): Promise<DiscoveryEngineResult> {
  try {
    const response = await fetch("/api/factory/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts?.signal,
      body: JSON.stringify({ context, heuristic, mode: opts?.mode }),
    });
    const result = (await response.json().catch(() => null)) as DiscoveryEngineResult | null;
    if (!result) return { ok: false, error: "Discovery refinement returned an unreadable response." };
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Discovery refinement failed." };
  }
}
