import type { AnswerPlan } from "@/lib/ai/answer-planning";
import type { ReasoningRequest } from "@/lib/ai/context";
import { strategyForEvidenceKind, type EvidenceStrategy, type EvidenceStrategyKind } from "@/lib/ai/evidence-strategies";

export type FoundryV2Header =
  | "Core Principle"
  | "Think Before Speaking"
  | "Live Engineering State"
  | "Context Manager"
  | "Evidence Intelligence"
  | "Investigation Engine"
  | "Intent Resolution"
  | "Instruction Intelligence"
  | "Verification Engine"
  | "Presentation Engine"
  | "Renderer"
  | "UX Philosophy"
  | "Product Roadmap"
  | "Local Workspace Connector"
  | "Conversation"
  | "Engineering Mindset"
  | "Quality Bar";

export type FoundryV2ArchitectureState = {
  principle: string;
  thinkingChecklist: string[];
  liveStateContract: string[];
  contextPolicy: string[];
  evidenceStrategies: EvidenceStrategy[];
  investigationPolicy: string[];
  intentPolicy: string[];
  instructionPolicy: string[];
  verificationGates: string[];
  presentationPolicy: string[];
  rendererContract: string[];
  uxPolicy: string[];
  productRoadmap: string[];
  localWorkspaceConnector: string[];
  conversationPolicy: string[];
  engineeringMindset: string;
  qualityBar: string;
  coverage: Record<FoundryV2Header, "implemented">;
};

export const foundryV2Headers: FoundryV2Header[] = [
  "Core Principle",
  "Think Before Speaking",
  "Live Engineering State",
  "Context Manager",
  "Evidence Intelligence",
  "Investigation Engine",
  "Intent Resolution",
  "Instruction Intelligence",
  "Verification Engine",
  "Presentation Engine",
  "Renderer",
  "UX Philosophy",
  "Product Roadmap",
  "Local Workspace Connector",
  "Conversation",
  "Engineering Mindset",
  "Quality Bar",
];

export function buildFoundryV2ArchitectureState(request: ReasoningRequest, answerPlan: AnswerPlan): FoundryV2ArchitectureState {
  const evidenceKinds = new Set<EvidenceStrategyKind>(
    request.attachments.map((attachment) => attachment.evidenceKind),
  );
  if (request.troubleshooting.latestEvidenceKind !== "none") evidenceKinds.add(request.troubleshooting.latestEvidenceKind);
  if (!evidenceKinds.size) evidenceKinds.add("none");

  return {
    principle: "Foundry acts as an engineering teammate: understand the work, advance it safely, and answer like a senior engineer sitting with the user.",
    thinkingChecklist: [
      `Actual goal: ${request.engineeringState.currentGoal || request.conversationContext.workflowState.goal || request.userMessage}`,
      `Work stage: ${request.troubleshooting.active ? "investigation" : request.desiredOutcome === "code" ? "implementation" : request.conversationContext.currentWorkItem.stage}`,
      `Latest evidence: ${latestEvidenceLabel(request)}`,
      `Current blocker: ${request.engineeringState.currentBlocker}`,
      `Fastest safe path: ${request.engineeringState.recommendedNextAction}`,
    ],
    liveStateContract: [
      "Use engineeringState, troubleshooting, projectState, and workMemory as the authoritative state.",
      "Do not rebuild the answer from raw conversation alone.",
      "Resolved issues stay resolved unless the latest evidence proves they returned.",
      "The current blocker is singular unless the evidence proves multiple independent blockers.",
    ],
    contextPolicy: [
      "The model receives a reasoning packet, not the whole conversation.",
      "Selected evidence, current state, relevant prior decisions, and current request are enough context.",
      "Archived history should influence only through compressed memory and selected prior context.",
    ],
    evidenceStrategies: Array.from(evidenceKinds).map(strategyForEvidenceKind),
    investigationPolicy: [
      "Investigations continue; they do not restart on follow-up messages.",
      "When new evidence arrives, compare it against previous evidence.",
      "Surface what resolved, what changed, what is new, and what is still active only when it affects the next action.",
    ],
    intentPolicy: [
      `Resolved intent: ${answerPlan.intent.mostLikelyInterpretation}`,
      `Reference target: ${answerPlan.intent.referenceType} (${answerPlan.intent.referenceConfidence})`,
      "Answer the most likely intent first; cover safe alternatives briefly only when they change the action.",
      "Ask only when the missing detail materially changes the next step.",
    ],
    instructionPolicy: [
      "Instructions need recommended approach, relevant alternatives, why, prerequisites, exact steps, commands/configuration, verification, common mistakes, and recovery when useful.",
      "Scale detail to risk and complexity; do not dump distant future steps into urgent debugging.",
      "Never introduce a command without a copyable command block.",
    ],
    verificationGates: [
      "Latest evidence was used.",
      "Resolved issues were not treated as active.",
      "Commands, code, config, logs, and diffs are not mixed with prose.",
      "Generated snippets are structurally complete for the promised scope.",
      "The answer does not ask for evidence already present.",
      "The answer does not repeat old advice as the only path after it failed.",
      "URLs are sanitized and copyable values are rendered semantically.",
    ],
    presentationPolicy: [
      "Presentation adapts to task type: troubleshooting, code, architecture, comparison, investigation, setup, migration, or file review.",
      "Use natural sections only when they improve clarity.",
      "For troubleshooting, prefer Problem / Why it happens / Fix / Verify when it fits.",
    ],
    rendererContract: [
      "Commands render as command blocks.",
      "Source code renders as source blocks.",
      "Config renders as config blocks.",
      "Logs render as log excerpts.",
      "Diffs render as patch blocks.",
      "Paths, env vars, URLs, placeholders, and important copy values render as semantic copy UI.",
      "Explanation never belongs inside code/config/command/log fences.",
    ],
    uxPolicy: [
      "Use readable 15-16px text, centered content, clean spacing, and calm hierarchy.",
      "Avoid robotic status cards and scary critical styling unless the situation is critical.",
      "The response should feel prepared, not generated.",
    ],
    productRoadmap: [
      "Phase 1: AI Software Factory dashboard and guided project-start flow.",
      "Phase 2: Project planning and file generation.",
      "Phase 3: Local folder and project connection.",
      "Phase 4: Local agent or desktop connector.",
      "Phase 5: Optional editor integrations for VS Code, Visual Studio, and Android Studio.",
      "Phase 6: GitHub and deployment integrations.",
      "Phase 7: Autonomous build, debug, and deploy loop.",
    ],
    localWorkspaceConnector: [
      "Foundry must not depend only on uploaded files forever; the long-term product works against real local projects and real development environments.",
      "Future local access should come through a desktop app, local agent, or secure connector running on the user's machine.",
      "The connector should support selected local project folders, VS Code, Visual Studio, Android Studio, Notepad++, terminal output, dev server logs, build logs, file changes, running processes, and local preview URLs.",
      "Capabilities include detecting the open project, reading files, watching file changes, running safe commands with approval, capturing logs, detecting local dev server ports, showing previews, applying code changes, restarting dev servers, and comparing before/after errors.",
      "Security is explicit grant only: ask before accessing folders, running commands, or editing files; never scan the whole machine automatically.",
      "Show exactly what Foundry changed, protect local secrets, and never upload unnecessary files.",
      "Phase 1 UI and state should preserve a path for local workspace connection even when the connector itself is not implemented yet.",
    ],
    conversationPolicy: [
      "Resolve references such as this, that, option B, previous screenshot, second log, and the file above from state.",
      "Remember prior work through workMemory and selected context.",
      "Continue from completed work instead of restarting instructions.",
    ],
    engineeringMindset: "Act as if this is your own project: pick the safest useful next move and explain it plainly.",
    qualityBar: "Before finalizing, the answer should be good enough that a principal engineer would recognize it as the right explanation and next action.",
    coverage: foundryV2Headers.reduce(
      (coverage, header) => ({
        ...coverage,
        [header]: "implemented" as const,
      }),
      {} as Record<FoundryV2Header, "implemented">,
    ),
  };
}

export function formatFoundryV2ArchitectureState(state: FoundryV2ArchitectureState) {
  return [
    "Foundry v2 core architecture:",
    `Core principle: ${state.principle}`,
    "Think before speaking:",
    formatList(state.thinkingChecklist),
    "Live engineering state contract:",
    formatList(state.liveStateContract),
    "Context manager policy:",
    formatList(state.contextPolicy),
    "Evidence intelligence strategies:",
    state.evidenceStrategies
      .map(
        (strategy) =>
          `- ${strategy.kind}: parser=${strategy.parser}; reasoning=${strategy.reasoningStrategy}; presentation=${strategy.presentationStrategy}; verification=${strategy.verificationFocus}`,
      )
      .join("\n"),
    "Investigation engine policy:",
    formatList(state.investigationPolicy),
    "Intent resolution policy:",
    formatList(state.intentPolicy),
    "Instruction intelligence policy:",
    formatList(state.instructionPolicy),
    "Verification engine gates:",
    formatList(state.verificationGates),
    "Presentation engine policy:",
    formatList(state.presentationPolicy),
    "Renderer contract:",
    formatList(state.rendererContract),
    "UX philosophy:",
    formatList(state.uxPolicy),
    "Product roadmap:",
    formatList(state.productRoadmap),
    "Local Workspace Connector:",
    formatList(state.localWorkspaceConnector),
    "Conversation policy:",
    formatList(state.conversationPolicy),
    `Engineering mindset: ${state.engineeringMindset}`,
    `Quality bar: ${state.qualityBar}`,
  ].join("\n");
}

function latestEvidenceLabel(request: ReasoningRequest) {
  if (request.troubleshooting.latestEvidenceName && request.troubleshooting.latestEvidenceName !== "none") {
    return `${request.troubleshooting.latestEvidenceName} (${request.troubleshooting.latestEvidenceKind})`;
  }
  const latest = request.engineeringState.evidenceNewThisTurn[0] ?? request.engineeringState.evidenceReviewed.at(-1);
  return latest ? `${latest.fileName} (${latest.evidenceKind}, ${latest.status})` : "current request";
}

function formatList(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}
