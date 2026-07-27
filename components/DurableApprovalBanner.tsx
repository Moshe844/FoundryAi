"use client";

import { useState } from "react";
import { useDurableMissionAuthority } from "@/components/DurableMissionAuthority";
import { projectDurableMission } from "@/lib/mission-core/browser-projection";
import type { ApprovalScope } from "@/lib/mission-core/model";

export function DurableApprovalBanner() {
  const { latestMission, decideApproval } = useDurableMissionAuthority();
  const projected = projectDurableMission(latestMission);
  const approval = projected?.pendingApproval;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!latestMission || !approval) return null;

  const decide = async (decision: "approve" | "deny", scope: ApprovalScope = "once") => {
    setSaving(true);
    setError("");
    try {
      await decideApproval({ missionId: latestMission.id, approvalId: approval.id, decision, scope });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the approval decision.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="fixed inset-x-4 top-16 z-[80] mx-auto max-w-4xl rounded-2xl border border-amber-400/30 bg-neutral-950/95 p-4 shadow-2xl backdrop-blur" aria-live="assertive" aria-label="Pending mission approval">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200">Approval required</p>
          <p className="mt-1 text-sm text-white">{approval.reason}</p>
          <p className="mt-1 truncate text-xs text-neutral-400">{approval.exactAction}</p>
          {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button disabled={saving} onClick={() => void decide("deny")} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Deny</button>
          <button disabled={saving} onClick={() => void decide("approve", "once")} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">Allow once</button>
          {approval.allowedScopes.includes("mission") ? <button disabled={saving} onClick={() => void decide("approve", "mission")} className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">Allow for mission</button> : null}
          {approval.allowedScopes.includes("project") ? <button disabled={saving} onClick={() => void decide("approve", "project")} className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">Allow for project</button> : null}
        </div>
      </div>
    </section>
  );
}
