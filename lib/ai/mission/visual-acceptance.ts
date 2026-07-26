import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import { routingContext } from "@/lib/ai/routing/request-context";

/**
 * Checking the rendered result against a design the user attached.
 *
 * When someone attaches a screenshot or mockup, that image *is* the acceptance criterion — and until
 * now it was only ever an input. It reached the executor as vision context to build from, and nothing
 * afterwards asked whether the thing that got built actually matched it.
 *
 * This is deliberately not a pixel diff. A mockup and a real page differ in size, fonts, copy and
 * spacing even when the implementation is exactly right, so pixelmatch would report a near-total
 * difference on correct work and a mission would fail for being correct. What the user means by "make
 * it look like this" is a question about structure, layout, and visual intent, so it is answered by
 * looking at both images.
 *
 * The bias is toward accepting. A mismatch must be specific enough to act on; a vague sense that
 * something differs is exactly how a false failure gets reported over finished work.
 */

export type VisualVerdict = {
  status: "satisfied" | "mismatched" | "unchecked";
  /** Concrete, actionable differences. Only ever populated for a "mismatched" verdict. */
  mismatches: string[];
  summary: string;
  source: "model" | "unavailable";
  usage?: RuntimeUsageRecord;
};

export type ReferenceImage = { fileName: string; dataUrl: string; mediaType: string };

const COMPARE_TOOL: NeutralTool = {
  name: "report_visual_comparison",
  description: "Report whether the rendered page satisfies the design the user attached.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      satisfied: { type: "boolean", description: "True when the rendered page delivers what the reference specifies." },
      mismatches: {
        type: "array",
        maxItems: 8,
        items: { type: "string" },
        description: "Specific, actionable differences: something the reference shows that the render is missing, or shows differently. Empty when satisfied.",
      },
      summary: { type: "string", description: "One sentence on how the render compares to the reference." },
      comparable: { type: "boolean", description: "False when the reference is not a design for this page and no comparison is meaningful." },
    },
    required: ["satisfied", "mismatches", "summary", "comparable"],
  },
};

const COMPARE_SYSTEM_PROMPT = [
  "You are shown a reference image the user attached to a software request, then a screenshot of the page their project actually renders.",
  "Decide whether the rendered page delivers what the reference specifies.",
  "Judge structure and intent: which sections exist, how they are arranged, the visual hierarchy, and whether the content the reference shows is present.",
  "Do not judge pixel-level fidelity. Different fonts, exact spacing, placeholder copy, image content, and viewport width are not mismatches — a correct implementation never matches a mockup pixel for pixel.",
  "Report a mismatch only when it is specific and actionable: a section the reference shows that the render lacks, an element in a clearly different position, or a structural difference someone could go and fix.",
  "If the only thing you can say is that they look somewhat different, that is not a mismatch. Report satisfied.",
  "Set comparable false when the reference is not a design for this page at all — a logo, a photo to embed, a diagram, or a screenshot of an unrelated tool. A file used as an asset is not an acceptance criterion.",
  "A false failure over finished work is worse than a missed detail. When genuinely unsure, report satisfied.",
].join("\n");

export async function verifyAgainstReference(input: {
  reference: ReferenceImage;
  rendered: { dataUrl: string; mediaType: string };
  request: string;
  apiKey?: string;
  tier?: ModelTier;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
}): Promise<VisualVerdict> {
  if (!input.apiKey) {
    return { status: "unchecked", mismatches: [], summary: "No provider was available to compare the rendered page with the attached design.", source: "unavailable" };
  }

  try {
    const provider: ProviderId = input.provider ?? "openai";
    // Comparing two images is a judgment about what is on screen, not a reasoning problem. The balanced
    // tier is used because the fast tier's vision is the weakest link in an acceptance decision.
    const tier = input.tier ?? "builder";
    const { model, effort } = resolveModelForTier(tier, { provider });

    const result = await callManagedModel(
      {
        provider,
        model,
        effort: effort ?? "low",
        system: [COMPARE_SYSTEM_PROMPT, "Always call report_visual_comparison with your answer. Do not respond with plain text."].join("\n"),
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `The user's request:\n${input.request}\n\nFirst image: the reference the user attached (${input.reference.fileName}). Second image: what the project currently renders.` },
            { type: "image", dataUrl: input.reference.dataUrl, mediaType: input.reference.mediaType, fileName: input.reference.fileName },
            { type: "image", dataUrl: input.rendered.dataUrl, mediaType: input.rendered.mediaType, fileName: "rendered-page.png" },
          ],
        }],
        tools: [COMPARE_TOOL],
        toolChoice: "auto",
        maxOutputTokens: 700,
        routing: routingContext(input.request, "verify", tier, input.workspaceId),
      },
      { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 2 },
    );

    const call = result.toolCalls.find((item) => item.name === "report_visual_comparison");
    const parsed = call?.arguments ? safeJsonParse(call.arguments) : undefined;
    if (!parsed) {
      return { status: "unchecked", mismatches: [], summary: "The visual comparison returned no usable answer.", source: "unavailable", usage: result.usage };
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";

    // An image that is not a design for this page is an asset, not an acceptance criterion. Treating a
    // logo the user asked to embed as a spec the page must resemble would fail every correct build.
    if (parsed.comparable === false) {
      return { status: "unchecked", mismatches: [], summary: summary || `${input.reference.fileName} is not a design for this page, so it was not used as an acceptance criterion.`, source: "model", usage: result.usage };
    }

    const mismatches = Array.isArray(parsed.mismatches)
      ? parsed.mismatches.map((item) => String(item).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8)
      : [];

    // A mismatch has to be nameable to be actionable. "Not satisfied" with nothing concrete behind it is
    // the shape of a false failure, so it is not allowed to fail the check.
    if (parsed.satisfied === false && mismatches.length) {
      return { status: "mismatched", mismatches, summary: summary || `The rendered page does not match ${input.reference.fileName}.`, source: "model", usage: result.usage };
    }

    return {
      status: "satisfied",
      mismatches: [],
      summary: summary || `The rendered page is consistent with ${input.reference.fileName}.`,
      source: "model",
      usage: result.usage,
    };
  } catch {
    return { status: "unchecked", mismatches: [], summary: "The rendered page could not be compared with the attached design.", source: "unavailable" };
  }
}

/**
 * Compare against every attached reference, stopping at the first real mismatch.
 *
 * Stopping early is deliberate: one concrete, fixable difference is a better repair instruction than a
 * list gathered from several images, and each additional comparison is another paid vision call.
 */
export async function verifyAgainstReferences(input: {
  references: ReferenceImage[];
  rendered: { dataUrl: string; mediaType: string };
  request: string;
  apiKey?: string;
  tier?: ModelTier;
  provider?: ProviderId;
  workspaceId?: string;
  userId?: string;
}): Promise<VisualVerdict> {
  if (!input.references.length) {
    return { status: "unchecked", mismatches: [], summary: "No reference design was attached.", source: "unavailable" };
  }

  let lastChecked: VisualVerdict | undefined;
  for (const reference of input.references.slice(0, 3)) {
    const verdict = await verifyAgainstReference({ ...input, reference });
    if (verdict.status === "mismatched") return verdict;
    if (verdict.status === "satisfied") lastChecked = verdict;
  }

  return lastChecked ?? { status: "unchecked", mismatches: [], summary: "None of the attached images was a design this page could be checked against.", source: "model" };
}

/** The repair instruction a mismatch turns into. Naming the differences is what makes it actionable. */
export function visualRepairInstruction(verdict: VisualVerdict): string {
  if (verdict.status !== "mismatched") return "";
  return `The rendered page does not yet match the design the user attached. Fix these specific differences: ${verdict.mismatches.join("; ")}.`;
}

type ParsedComparison = { satisfied?: unknown; mismatches?: unknown[]; summary?: unknown; comparable?: unknown };

function safeJsonParse(value: string): ParsedComparison | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
