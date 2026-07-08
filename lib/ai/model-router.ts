import type { ReasoningRequest } from "@/lib/ai/context";

export type ModelProfile = "fast" | "standard" | "advanced" | "autonomous";

export type ModelDecision = {
  profile: ModelProfile;
  model: string;
  reason: string;
};

type ModelConfig = Record<ModelProfile, string>;

const defaultModelConfig: ModelConfig = {
  fast: "gpt-5-mini",
  standard: "gpt-5",
  advanced: "gpt-5",
  autonomous: "gpt-5",
};

const fallbackOrder: Record<ModelProfile, ModelProfile[]> = {
  fast: ["standard", "advanced", "autonomous"],
  standard: ["fast", "advanced", "autonomous"],
  advanced: ["standard", "autonomous", "fast"],
  autonomous: ["advanced", "standard", "fast"],
};

const profilePricingUsdPerMillion: Record<ModelProfile, { input: number; output: number }> = {
  fast: { input: 0.25, output: 2 },
  standard: { input: 1.25, output: 10 },
  advanced: { input: 1.25, output: 10 },
  autonomous: { input: 1.25, output: 10 },
};

export function modelForReasoningRequest(request: ReasoningRequest): ModelDecision {
  const profile = profileForReasoningRequest(request);
  return modelDecision(profile, "reasoning request");
}

export function modelForRuntimePayload(payload: unknown, requestedModel = ""): ModelDecision {
  const profile = profileForRuntimePayload(payload, requestedModel);
  return modelDecision(profile, "runtime payload");
}

export function modelForProfile(profile: ModelProfile): ModelDecision {
  return modelDecision(profile, "explicit profile");
}

export function modelForRepairTask(task: "command" | "troubleshooting" | "evidence" | "snippet" | "contract" | "verification"): ModelDecision {
  if (task === "command" || task === "verification") return modelDecision("fast", `${task} repair`);
  if (task === "troubleshooting" || task === "evidence" || task === "snippet") return modelDecision("standard", `${task} repair`);
  return modelDecision("standard", `${task} repair`);
}

export function fallbackModelForModel(model: string) {
  const profile = profileForModel(model);
  const fallback = fallbackOrder[profile].find((candidate) => modelForProfile(candidate).model !== model);
  return fallback ? modelForProfile(fallback) : undefined;
}

export function pricingForModel(model: string) {
  const profile = profileForModel(model);
  return profilePricingUsdPerMillion[profile];
}

export function profileForModel(model: string): ModelProfile {
  const config = getModelConfig();
  const found = (Object.keys(config) as ModelProfile[]).find((profile) => config[profile] === model);
  return found ?? "fast";
}

export function getModelConfig(): ModelConfig {
  return {
    fast: process.env.FOUNDRY_MODEL_FAST ?? process.env.OPENAI_FAST_MODEL ?? defaultModelConfig.fast,
    standard: process.env.FOUNDRY_MODEL_STANDARD ?? process.env.OPENAI_MODEL ?? defaultModelConfig.standard,
    advanced: process.env.FOUNDRY_MODEL_ADVANCED ?? process.env.OPENAI_MODEL ?? defaultModelConfig.advanced,
    autonomous: process.env.FOUNDRY_MODEL_AUTONOMOUS ?? process.env.OPENAI_MODEL ?? defaultModelConfig.autonomous,
  };
}

function modelDecision(profile: ModelProfile, reason: string): ModelDecision {
  return {
    profile,
    model: getModelConfig()[profile],
    reason,
  };
}

function profileForReasoningRequest(request: ReasoningRequest): ModelProfile {
  const text = [
    request.userMessage,
    request.missionTitle,
    request.desiredOutcome,
    request.attachments.map((attachment) => `${attachment.fileName} ${attachment.evidenceKind} ${attachment.fileType}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const readableAttachments = request.attachments.filter((attachment) => attachment.uploadStatus === "readable").length;
  const hasImages = request.attachments.some((attachment) => attachment.uploadStatus === "image");

  if (/\b(autonomous|execute plan|run the plan|self-review|verify everything|long-running|multi-step execution)\b/i.test(text)) {
    return "autonomous";
  }

  if (
    request.troubleshooting.active ||
    readableAttachments >= 2 ||
    hasImages ||
    /\b(android|gradle|build failed|root cause|investigation|compare files|uploaded logs?|screenshots?|payment investigation|multi-file|correlat(?:e|ion)|large log)\b/i.test(text)
  ) {
    return "advanced";
  }

  if (request.desiredOutcome === "code" || /\b(refactor|architecture|explain code|compare two snippets|documentation|api explanation|moderate debugging)\b/i.test(text)) {
    return "standard";
  }

  if (/\b(what is|define|flush dns|ping|restart windows|cmd|powershell|simple|basic syntax|small rewrite|show .*command)\b/i.test(text)) {
    return "fast";
  }

  return "standard";
}

function profileForRuntimePayload(payload: unknown, requestedModel: string): ModelProfile {
  const requestedProfile = requestedModel ? profileForModel(requestedModel) : undefined;
  const text = JSON.stringify(payload).toLowerCase();

  if (/\b(autonomous|execute plan|self-review|long-running|tool orchestration)\b/i.test(text)) return strongest(requestedProfile, "autonomous");
  if (/\b(uploaded logs?|screenshots?|multi-file|android|gradle|build failed|root cause|investigation|large comparison|payment)\b/i.test(text)) {
    return strongest(requestedProfile, "advanced");
  }
  if (/\b(refactor|architecture|explain code|compare|documentation|api explanation)\b/i.test(text)) return strongest(requestedProfile, "standard");
  if (text.length < 12000 && /\b(simple answer|short answer|what is|how do i|verify|next step|command)\b/i.test(text)) return "fast";

  return requestedProfile ?? "standard";
}

function strongest(left: ModelProfile | undefined, right: ModelProfile): ModelProfile {
  const rank: Record<ModelProfile, number> = {
    fast: 1,
    standard: 2,
    advanced: 3,
    autonomous: 4,
  };
  if (!left) return right;
  return rank[left] >= rank[right] ? left : right;
}
