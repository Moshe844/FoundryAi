import { randomUUID } from "node:crypto";
import { callManagedModel, apiKeyForProvider } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import type { NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import type { FactoryUploadedFile } from "@/lib/factory/types";
import type { DirectMissionRequest, DirectOperationRequest } from "./direct-execution";
import { operationKinds, type OperationKind, type PlannedOperation } from "./model";

const PLAN_OPERATIONS_TOOL: NeutralTool = {
  name: "set_operation_plan",
  description: "Return a dependency-ordered, executable plan using only Foundry's typed project operations.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      operations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: [...operationKinds] },
            title: { type: "string" },
            target: { type: "string" },
            command: { type: "string" },
            content: { type: "string" },
            cwd: { type: "string" },
            dependsOn: { type: "array", items: { type: "string" } },
            requirementIds: { type: "array", items: { type: "string" } },
            risk: { type: "string", enum: ["safe", "development", "modification", "high_risk"] },
            maxAttempts: { type: "number" },
            browser: {
              type: "object",
              additionalProperties: false,
              properties: {
                url: { type: "string" },
                viewport: {
                  type: "object",
                  additionalProperties: false,
                  properties: { width: { type: "number" }, height: { type: "number" } },
                  required: ["width", "height"],
                },
              },
              required: ["url"],
            },
          },
          required: ["id", "kind", "title", "dependsOn", "requirementIds", "risk"],
        },
      },
      unsupportedReason: { type: "string" },
    },
    required: ["operations", "unsupportedReason"],
  },
};

export type TypedOperationPlanningRequest = {
  missionId?: string;
  projectId?: string;
  objective: string;
  projectSnapshot: string;
  localPath?: string;
  uploadedFiles?: FactoryUploadedFile[];
  provider?: ProviderId;
  tier?: ModelTier;
  workspaceId?: string;
  userId?: string;
  recoveryInstruction?: string;
  maxOutputTokens?: number;
};

export type TypedOperationPlanningResult = {
  request?: DirectMissionRequest;
  unsupportedReason?: string;
};

export async function planTypedOperations(input: TypedOperationPlanningRequest): Promise<TypedOperationPlanningResult> {
  const provider = input.provider ?? "openai";
  const apiKey = apiKeyForProvider(provider);
  if (!apiKey) throw new Error(`No API key is configured for ${provider}.`);
  const tier = input.tier ?? "architect";
  const { model, effort } = resolveModelForTier(tier, { provider });
  const result = await callManagedModel({
    provider,
    model,
    effort: effort ?? "medium",
    system: [
      "You are Foundry's typed operation planner. Convert the requested engineering outcome into an executable dependency graph.",
      "Use only these operations: read_file, write_file, delete_file, run_command, start_process, stop_process, browser_action, verify.",
      "Never use patch_file because this migration path deliberately requires complete read-modify-write operations with read-back verification.",
      "Every write_file must have a complete target path and full replacement content. Add a read_file dependency before editing an existing file.",
      "Commands must be exact shell commands and must depend on all source writes they validate.",
      "Do not invent file contents when the project snapshot is insufficient. Prefer safe read operations that gather the missing evidence before editing.",
      "Use safe risk for reads and verification, development for commands/processes, modification for writes, and high_risk for deletes.",
      "End implementation plans with concrete verification operations. User-facing web work should include browser_action only when a real URL can be established by a prior start_process operation.",
      "Operation ids must be unique kebab-case strings. dependsOn must reference earlier operation ids only.",
      input.recoveryInstruction ?? "Produce the safest complete executable plan within the available project evidence.",
      "Return only set_operation_plan.",
    ].join("\n"),
    messages: [{ role: "user", content: [{ type: "text", text: `Objective:\n${input.objective}\n\nCurrent project snapshot:\n${input.projectSnapshot || "(not available)"}` }] }],
    tools: [PLAN_OPERATIONS_TOOL],
    toolChoice: { name: "set_operation_plan" },
    maxOutputTokens: Math.max(3000, Math.min(input.maxOutputTokens ?? 12000, 12000)),
  }, { apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 1 });

  const call = result.toolCalls.find((item) => item.name === "set_operation_plan");
  const parsed = parsePlanArguments(call?.arguments);
  if (!parsed.operations.length) return { unsupportedReason: parsed.unsupportedReason || "The task could not be represented safely as typed operations." };
  const missionId = input.missionId || `mission-${randomUUID()}`;
  const operations = normalizeOperations(parsed.operations);
  if (!operations.length) return { unsupportedReason: parsed.unsupportedReason || "The planner returned no valid executable typed operations." };
  if (!operations.some((operation) => ["write_file", "delete_file", "run_command", "start_process", "stop_process"].includes(operation.kind))
    && /\b(?:build|complete|continue|finish|fix|implement|create|add|change|update|repair|refactor|deploy|publish)\b/i.test(input.objective)) {
    return { unsupportedReason: "The planner returned an inspection-only plan for a mutating engineering objective. Reading files cannot complete the requested change." };
  }
  return {
    request: {
      missionId,
      projectId: input.projectId,
      objective: input.objective,
      localPath: input.localPath,
      uploadedFiles: input.uploadedFiles,
      operations,
    },
  };
}

export function parsePlanArguments(raw?: string): { operations: unknown[]; unsupportedReason: string } {
  if (!raw) return { operations: [], unsupportedReason: "Planner returned no operation plan." };
  try {
    const value = JSON.parse(raw) as { operations?: unknown[]; unsupportedReason?: unknown };
    return {
      operations: Array.isArray(value.operations) ? value.operations : [],
      unsupportedReason: typeof value.unsupportedReason === "string" ? value.unsupportedReason.trim() : "",
    };
  } catch {
    return { operations: [], unsupportedReason: "Planner returned invalid operation JSON." };
  }
}

export function normalizeOperations(rawOperations: unknown[]): DirectOperationRequest[] {
  const allowed = new Set<OperationKind>(operationKinds);
  const seen = new Set<string>();
  const signatures = new Set<string>();
  const output: DirectOperationRequest[] = [];
  for (const raw of rawOperations) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? "").trim();
    const kind = String(item.kind ?? "") as OperationKind;
    const title = String(item.title ?? "").trim();
    if (!id || seen.has(id) || !allowed.has(kind) || kind === "patch_file" || !title) continue;
    const dependsOn = Array.isArray(item.dependsOn) ? item.dependsOn.map(String).filter((dependency) => seen.has(dependency)) : [];
    const target = typeof item.target === "string" && item.target.trim() ? item.target.trim() : undefined;
    const command = typeof item.command === "string" && item.command.trim() ? item.command.trim() : undefined;
    if (["write_file", "delete_file", "read_file"].includes(kind) && !target) continue;
    if (["run_command", "start_process", "stop_process"].includes(kind) && !command) continue;
    if (kind === "write_file" && typeof item.content !== "string") continue;
    const signature = JSON.stringify([kind, target ?? "", command?.replace(/\s+/g, " ").trim() ?? "", typeof item.content === "string" ? item.content : ""]);
    if (signatures.has(signature)) continue;
    const risk = (["safe", "development", "modification", "high_risk"] as const).includes(item.risk as PlannedOperation["risk"])
      ? item.risk as PlannedOperation["risk"]
      : undefined;
    const browser = item.browser && typeof item.browser === "object" ? item.browser as DirectOperationRequest["input"] extends { browser?: infer B } ? B : never : undefined;
    output.push({
      id,
      kind,
      title,
      target,
      command,
      input: {
        ...(typeof item.content === "string" ? { content: item.content } : {}),
        ...(typeof item.cwd === "string" ? { cwd: item.cwd } : {}),
        ...(browser ? { browser } : {}),
      },
      dependsOn,
      requirementIds: Array.isArray(item.requirementIds) ? item.requirementIds.map(String) : [],
      risk,
      maxAttempts: Number.isFinite(Number(item.maxAttempts)) ? Math.max(1, Math.min(Number(item.maxAttempts), 3)) : 1,
    });
    signatures.add(signature);
    seen.add(id);
  }
  return output;
}
