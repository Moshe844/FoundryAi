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

/**
 * Where routing telemetry is written.
 *
 * Resolved per call rather than at module load so a test can redirect it. That matters: these are real
 * operational files — provider-calls.ndjson is what the spend ledger reconciles the day's actual cost
 * from — and a test suite that truncated them would quietly reset a user's spend accounting.
 */
function routingDataDir() {
  return process.env.FOUNDRY_ROUTING_DATA_DIR || path.join(process.cwd(), ".foundry-data", "routing");
}

const telemetryPath = () => path.join(routingDataDir(), "telemetry.ndjson");
const providerCallPath = () => path.join(routingDataDir(), "provider-calls.ndjson");
const stageOutcomePath = () => path.join(routingDataDir(), "stage-outcomes.ndjson");

export async function recordRoutingDecision(decision: RoutingDecision, profile: TaskProfile, input: { missionId?: string; stepId?: string }) {
  const legacyTier = legacyTierEstimate(profile);
  const direction = tierRank(decision.tier) < tierRank(legacyTier) ? "lower" : tierRank(decision.tier) > tierRank(legacyTier) ? "higher" : "same";
  const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), missionId: input.missionId, stepId: input.stepId, taskType: profile.taskType, tier: decision.tier, executionDepth: decision.executionDepth, provider: decision.provider, model: decision.model, reason: decision.reason, score: decision.score, assessment: { scope: profile.scope, difficulty: profile.difficulty, ambiguity: profile.ambiguity, risk: profile.risk, contextNeed: profile.contextNeed, confidence: profile.confidence }, shadow: { legacyTier, changed: legacyTier !== decision.tier, predictedCostDirection: direction } } satisfies RoutingTelemetryRecord;
  await mkdir(path.dirname(telemetryPath()), { recursive: true });
  await appendFile(telemetryPath(), `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * How a call turned out, as far as the dispatcher can tell at the moment it returns.
 *
 * A response that ignored a required tool is recorded separately from a provider error because they
 * mean different things about the model: one is unavailable, the other is unsuitable, and routing
 * should learn a different lesson from each.
 */
export type ProviderCallOutcome = "accepted" | "wrong-shape" | "provider-error";

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
  /** Wall-clock time for this provider attempt. */
  latencyMs?: number;
  outcome?: ProviderCallOutcome;
  /** 1 for the first candidate. Anything higher means a fallback was needed to get an answer. */
  attempt?: number;
}) {
  await mkdir(path.dirname(providerCallPath()), { recursive: true });
  await appendFile(providerCallPath(), `${JSON.stringify({
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...input,
    actualProvider: input.usage.provider, actualModel: input.usage.model,
    actualCostUsd: input.usage.estimatedCostUsd, inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens, cached: input.usage.cached,
    latencyMs: input.latencyMs ?? null, outcome: input.outcome ?? "accepted", attempt: input.attempt ?? 1,
  })}\n`, "utf8");
}

export type ProviderCallRecord = {
  createdAt?: string;
  missionId?: string;
  stage?: string;
  tier?: RoutingDecision["tier"];
  provider?: RoutingDecision["provider"];
  model?: string;
  actualCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number | null;
  outcome?: ProviderCallOutcome;
  attempt?: number;
};

/**
 * Whether a stage's work survived into the finished mission.
 *
 * Cost per call answers only half of what routing needs to know. A cheap call whose output was thrown
 * away and redone at a stronger tier cost more in total than the expensive call that would have worked
 * first time — and no per-call record can see that, because it is only knowable once the mission ends.
 * This is the record that closes that loop.
 */
export type StageOutcomeRecord = {
  id: string;
  createdAt: string;
  missionId: string;
  stage: string;
  tier: RoutingDecision["tier"];
  provider: RoutingDecision["provider"];
  model: string;
  /** True when this stage's output was part of what the mission finally delivered. */
  contributed: boolean;
  /** True when this stage had to be redone at a stronger tier before it could be used. */
  escalated: boolean;
  quality: "accepted" | "superseded" | "discarded" | "unknown";
  detail?: string;
};

export async function recordStageOutcome(input: Omit<StageOutcomeRecord, "id" | "createdAt">) {
  const record: StageOutcomeRecord = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...input };
  await mkdir(path.dirname(stageOutcomePath()), { recursive: true });
  await appendFile(stageOutcomePath(), `${JSON.stringify(record)}\n`, "utf8");
  return record;
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

export type ModelStageFeedback = {
  key: string;
  stage: string;
  provider: string;
  model: string;
  tier?: RoutingDecision["tier"];
  calls: number;
  /** Share of calls that produced what the caller asked for. */
  acceptanceRate: number;
  /** Share of calls that needed a fallback candidate before an answer was obtained. */
  fallbackRate: number;
  meanLatencyMs: number | null;
  meanCostUsd: number;
  /** Share of this stage's recorded outcomes whose work survived into the finished mission. */
  contributionRate: number | null;
};

/**
 * Observed behavior per model and stage.
 *
 * This is the feedback the routing contract asks for: not a dashboard, but the measured record of which
 * models actually deliver at which stage, what they cost, how long they take, and how often their work
 * had to be redone. `calls` is reported alongside every rate on purpose — a caller acting on a single
 * observation would be reacting to noise rather than evidence.
 */
export async function routingFeedbackSnapshot(): Promise<ModelStageFeedback[]> {
  const [calls, outcomes] = await Promise.all([readProviderCalls(), readStageOutcomes()]);

  const grouped = new Map<string, ProviderCallRecord[]>();
  for (const call of calls) {
    const key = `${call.stage ?? "unspecified"}::${call.provider ?? "unknown"}::${call.model ?? "unknown"}`;
    grouped.set(key, [...(grouped.get(key) ?? []), call]);
  }

  return [...grouped.entries()].map(([key, records]) => {
    const [stage, provider, model] = key.split("::");
    const latencies = records.map((record) => record.latencyMs).filter((value): value is number => typeof value === "number");
    const related = outcomes.filter((outcome) => outcome.stage === stage && outcome.provider === provider && outcome.model === model);
    return {
      key,
      stage,
      provider,
      model,
      tier: records.at(-1)?.tier,
      calls: records.length,
      acceptanceRate: ratio(records.filter((record) => (record.outcome ?? "accepted") === "accepted").length, records.length),
      fallbackRate: ratio(records.filter((record) => (record.attempt ?? 1) > 1).length, records.length),
      meanLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
      meanCostUsd: Number((records.reduce((sum, record) => sum + (record.actualCostUsd ?? 0), 0) / Math.max(1, records.length)).toFixed(6)),
      contributionRate: related.length ? ratio(related.filter((outcome) => outcome.contributed).length, related.length) : null,
    };
  }).sort((left, right) => right.calls - left.calls);
}

async function readTelemetry(): Promise<RoutingTelemetryRecord[]> {
  const raw = await readFile(telemetryPath(), "utf8").catch(() => "");
  return raw.split(/\r?\n/).filter(Boolean).slice(-10_000).flatMap((line) => { try { return [JSON.parse(line) as RoutingTelemetryRecord]; } catch { return []; } });
}

async function readProviderCalls(): Promise<ProviderCallRecord[]> {
  const raw = await readFile(providerCallPath(), "utf8").catch(() => "");
  return raw.split(/\r?\n/).filter(Boolean).slice(-10_000).flatMap((line) => { try { return [JSON.parse(line) as ProviderCallRecord]; } catch { return []; } });
}

async function readStageOutcomes(): Promise<StageOutcomeRecord[]> {
  const raw = await readFile(stageOutcomePath(), "utf8").catch(() => "");
  return raw.split(/\r?\n/).filter(Boolean).slice(-10_000).flatMap((line) => { try { return [JSON.parse(line) as StageOutcomeRecord]; } catch { return []; } });
}

function ratio(part: number, whole: number) {
  return whole ? Number((part / whole).toFixed(4)) : 0;
}

function legacyTierEstimate(profile: TaskProfile): RoutingDecision["tier"] {
  if (profile.failureHistory >= 2 && profile.risk >= 0.5) return "super-reasoning";
  if (profile.scope.projectWide) return "enterprise-architect";
  if (profile.scope.crossLayer || profile.risk >= 0.5) return "architect";
  return profile.intent === "inspect" && profile.scope.estimatedFiles <= 1 ? "fast" : "builder";
}
function tierRank(tier: RoutingDecision["tier"]) { return ["fast", "builder", "architect", "enterprise-architect", "super-reasoning"].indexOf(tier); }
function countBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, number>>((result, item) => { const value = key(item); result[value] = (result[value] ?? 0) + 1; return result; }, {}); }
