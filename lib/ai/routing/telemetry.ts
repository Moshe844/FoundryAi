import type { RoutingDecision, TaskProfile } from "@/lib/ai/routing/types";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";

export type RoutingTelemetryRecord = {
  id: string;
  createdAt: string;
  missionId?: string;
  stepId?: string;
  taskType: string;
  tier: RoutingDecision["tier"];
  executionDepth: RoutingDecision["executionDepth"];
  provider: RoutingDecision["provider"];
  model: string;
  reason: string;
  score: number;
  assessment: Pick<TaskProfile, "scope" | "difficulty" | "ambiguity" | "risk" | "contextNeed" | "confidence">;
  shadow: { legacyTier: RoutingDecision["tier"]; changed: boolean; predictedCostDirection: "lower" | "same" | "higher" };
};

const telemetryPath = path.join(process.cwd(), ".foundry-data", "routing", "telemetry.ndjson");
const providerCallPath = path.join(process.cwd(), ".foundry-data", "routing", "provider-calls.ndjson");

export async function recordRoutingDecision(decision: RoutingDecision, profile: TaskProfile, input: { missionId?: string; stepId?: string }) {
  const legacyTier = legacyTierEstimate(profile);
  const direction = tierRank(decision.tier) < tierRank(legacyTier) ? "lower" : tierRank(decision.tier) > tierRank(legacyTier) ? "higher" : "same";
  const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), missionId: input.missionId, stepId: input.stepId, taskType: profile.taskType, tier: decision.tier, executionDepth: decision.executionDepth, provider: decision.provider, model: decision.model, reason: decision.reason, score: decision.score, assessment: { scope: profile.scope, difficulty: profile.difficulty, ambiguity: profile.ambiguity, risk: profile.risk, contextNeed: profile.contextNeed, confidence: profile.confidence }, shadow: { legacyTier, changed: legacyTier !== decision.tier, predictedCostDirection: direction } } satisfies RoutingTelemetryRecord;
  await mkdir(path.dirname(telemetryPath), { recursive: true });
  await appendFile(telemetryPath, `${JSON.stringify(record)}\n`, "utf8");
}

/** Audit of the provider/model that was actually invoked, distinct from the earlier routing proposal. */
export async function recordProviderCall(input: {
  requestId: string;
  missionId?: string;
  stage: string;
  tier: RoutingDecision["tier"];
  provider: RoutingDecision["provider"];
  model: string;
  reason: string;
  estimatedCostUsd: number;
  usage: RuntimeUsageRecord;
}) {
  await mkdir(path.dirname(providerCallPath), { recursive: true });
  await appendFile(providerCallPath, `${JSON.stringify({
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...input,
    actualProvider: input.usage.provider, actualModel: input.usage.model,
    actualCostUsd: input.usage.estimatedCostUsd, inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens, cached: input.usage.cached,
  })}\n`, "utf8");
}

export async function routingTelemetrySnapshot() {
  const records = await readTelemetry();
  const total = records.length;
  return {
    total,
    fastPercentage: total ? Number((records.filter((record) => record.tier === "fast").length / total * 100).toFixed(1)) : 0,
    shadowChanges: records.filter((record) => record.shadow.changed).length,
    predictedCheaper: records.filter((record) => record.shadow.predictedCostDirection === "lower").length,
    byTier: countBy(records, (record) => record.tier),
    byProvider: countBy(records, (record) => record.provider),
    byTaskType: countBy(records, (record) => record.taskType),
    recent: records.slice(-200).reverse(),
  };
}

async function readTelemetry(): Promise<RoutingTelemetryRecord[]> {
  const raw = await readFile(telemetryPath, "utf8").catch(() => "");
  return raw.split(/\r?\n/).filter(Boolean).slice(-10_000).flatMap((line) => { try { return [JSON.parse(line) as RoutingTelemetryRecord]; } catch { return []; } });
}

function legacyTierEstimate(profile: TaskProfile): RoutingDecision["tier"] {
  if (profile.failureHistory >= 2 && profile.risk >= 0.5) return "super-reasoning";
  if (profile.scope.projectWide) return "enterprise-architect";
  if (profile.scope.crossLayer || profile.risk >= 0.5) return "architect";
  return profile.intent === "inspect" && profile.scope.estimatedFiles <= 1 ? "fast" : "builder";
}
function tierRank(tier: RoutingDecision["tier"]) { return ["fast", "builder", "architect", "enterprise-architect", "super-reasoning"].indexOf(tier); }
function countBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, number>>((result, item) => { const value = key(item); result[value] = (result[value] ?? 0) + 1; return result; }, {}); }
