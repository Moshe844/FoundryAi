import type { ApprovalScope, MissionRecord } from "./model";

export type MissionSubscriptionOptions = {
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onError?: (error: Error) => void;
};

/**
 * Browser-side read model for durable mission state.
 *
 * Local workspace state may optimistically render streamed events, but a MissionRecord returned by
 * this client is authoritative. Consumers must ignore older revisions and replace mission lifecycle,
 * approvals, operation statuses, verification, and journal data with the newest server revision.
 */
export class DurableMissionClient {
  private readonly revisions = new Map<string, number>();

  async get(missionId: string, signal?: AbortSignal): Promise<MissionRecord> {
    const response = await fetch(`/api/missions/${encodeURIComponent(missionId)}`, {
      method: "GET",
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(await responseMessage(response, `Could not load mission ${missionId}.`));
    const mission = await response.json() as MissionRecord;
    this.revisions.set(mission.id, Math.max(this.revisions.get(mission.id) ?? -1, mission.revision));
    return mission;
  }

  async decideApproval(input: {
    missionId: string;
    approvalId: string;
    decision: "approve" | "deny";
    scope?: ApprovalScope;
    signal?: AbortSignal;
  }): Promise<MissionRecord> {
    const response = await fetch(`/api/missions/${encodeURIComponent(input.missionId)}/approval`, {
      method: "POST",
      cache: "no-store",
      signal: input.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: input.approvalId, decision: input.decision, scope: input.scope ?? "once" }),
    });
    if (!response.ok) throw new Error(await responseMessage(response, "Could not save the approval decision."));
    const mission = await response.json() as MissionRecord;
    this.revisions.set(mission.id, mission.revision);
    return mission;
  }

  subscribe(missionId: string, listener: (mission: MissionRecord) => void, options: MissionSubscriptionOptions = {}) {
    const interval = Math.max(500, Math.min(options.pollIntervalMs ?? 1_500, 30_000));
    const controller = new AbortController();
    const stop = () => controller.abort();
    options.signal?.addEventListener("abort", stop, { once: true });

    const poll = async () => {
      while (!controller.signal.aborted) {
        try {
          const mission = await this.get(missionId, controller.signal);
          const previous = this.revisions.get(missionId) ?? -1;
          if (mission.revision >= previous) {
            this.revisions.set(missionId, mission.revision);
            listener(mission);
          }
          if (isTerminal(mission.status)) return;
        } catch (error) {
          if (controller.signal.aborted) return;
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
        await delay(interval, controller.signal);
      }
    };
    void poll();
    return stop;
  }
}

export function shouldApplyDurableMission(current: MissionRecord | undefined, incoming: MissionRecord): boolean {
  return !current || current.id !== incoming.id || incoming.revision >= current.revision;
}

function isTerminal(status: MissionRecord["status"]) {
  return status === "completed" || status === "completed_with_warnings" || status === "failed" || status === "canceled";
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
