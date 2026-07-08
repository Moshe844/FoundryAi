import type { ReasoningRequest } from "@/lib/ai/context";

export type PresentationKind =
  | "troubleshooting"
  | "implementation"
  | "comparison"
  | "investigation"
  | "instruction"
  | "direct-answer";

export type PresentationStrategy = {
  kind: PresentationKind;
  sectionShape: string[];
  rendererRequirements: string[];
  tone: string;
  density: string;
};

export function buildPresentationStrategy(request: ReasoningRequest): PresentationStrategy {
  if (request.troubleshooting.active) {
    return {
      kind: "troubleshooting",
      sectionShape: ["Problem", "Why it happens", "Fix", "Verify"],
      rendererRequirements: [
        "Render commands as copyable command blocks.",
        "Render paths, URLs, env vars, placeholders, and copy values as semantic copy UI.",
        "Render logs as log excerpts and keep prose outside fences.",
      ],
      tone: "calm, direct, evidence-backed",
      density: "short sections, no wall of text",
    };
  }

  if (request.desiredOutcome === "code") {
    return {
      kind: "implementation",
      sectionShape: ["What changed", "Files", "Verify"],
      rendererRequirements: ["Render code as source blocks or file patches.", "Render commands as copyable command blocks."],
      tone: "senior engineer, concise",
      density: "implementation-focused with only necessary explanation",
    };
  }

  if (request.comparisonEvidence.length) {
    return {
      kind: "comparison",
      sectionShape: ["Recommendation", "Differences", "Impact", "Verify"],
      rendererRequirements: ["Render compared values and paths as semantic values.", "Use tables only when comparison density justifies them."],
      tone: "decisive and practical",
      density: "scannable comparison",
    };
  }

  if (request.attachments.length || request.conversationContext.currentRequest.hasNewEvidence) {
    return {
      kind: "investigation",
      sectionShape: ["Finding", "Evidence", "Next action"],
      rendererRequirements: ["Render evidence excerpts by type.", "Avoid unsupported claims about unreadable media."],
      tone: "careful and explicit about evidence",
      density: "focused on current evidence",
    };
  }

  if (/\b(how|steps|guide|setup|install|configure|fix)\b/i.test(request.userMessage)) {
    return {
      kind: "instruction",
      sectionShape: ["Recommended path", "Steps", "Verify"],
      rendererRequirements: ["Render every command/config/path as a semantic copyable component."],
      tone: "mentor-like, not robotic",
      density: "complete enough to act",
    };
  }

  return {
    kind: "direct-answer",
    sectionShape: ["Answer", "Next step when useful"],
    rendererRequirements: ["Use semantic rendering for technical values when present."],
    tone: "natural and direct",
    density: "brief",
  };
}

export function formatPresentationStrategy(strategy: PresentationStrategy) {
  return [
    "Presentation engine strategy:",
    `- Kind: ${strategy.kind}`,
    `- Sections: ${strategy.sectionShape.join(" / ")}`,
    `- Tone: ${strategy.tone}`,
    `- Density: ${strategy.density}`,
    "Renderer requirements:",
    strategy.rendererRequirements.map((item) => `- ${item}`).join("\n"),
  ].join("\n");
}
