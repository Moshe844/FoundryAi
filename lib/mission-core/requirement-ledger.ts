import type { MissionRecord, MissionRequirement } from "./model";

export function addRequirements(mission: MissionRecord, requirements: Array<{ id: string; text: string }>, now = new Date().toISOString()): MissionRecord {
  const existing = new Set(mission.requirements.map((requirement) => requirement.id));
  const additions: MissionRequirement[] = requirements
    .filter((requirement) => !existing.has(requirement.id))
    .map((requirement) => ({ ...requirement, status: "open", evidenceIds: [] }));
  return touch({ ...mission, requirements: [...mission.requirements, ...additions] }, now);
}

export function satisfyRequirement(mission: MissionRecord, requirementId: string, evidenceIds: string[], now = new Date().toISOString()): MissionRecord {
  let found = false;
  const requirements = mission.requirements.map((requirement) => {
    if (requirement.id !== requirementId) return requirement;
    found = true;
    return { ...requirement, status: "satisfied" as const, evidenceIds: unique([...requirement.evidenceIds, ...evidenceIds]) };
  });
  if (!found) throw new Error(`Unknown requirement: ${requirementId}`);
  return touch({ ...mission, requirements }, now);
}

export function blockRequirement(mission: MissionRecord, requirementId: string, now = new Date().toISOString()): MissionRecord {
  return setRequirementStatus(mission, requirementId, "blocked", now);
}

export function deferRequirement(mission: MissionRecord, requirementId: string, now = new Date().toISOString()): MissionRecord {
  return setRequirementStatus(mission, requirementId, "deferred", now);
}

export function openRequirements(mission: MissionRecord) {
  return mission.requirements.filter((requirement) => requirement.status === "open" || requirement.status === "blocked");
}

export function allRequirementsSatisfied(mission: MissionRecord) {
  return mission.requirements.length > 0 && mission.requirements.every((requirement) => requirement.status === "satisfied" || requirement.status === "deferred");
}

function setRequirementStatus(mission: MissionRecord, requirementId: string, status: MissionRequirement["status"], now: string): MissionRecord {
  let found = false;
  const requirements = mission.requirements.map((requirement) => {
    if (requirement.id !== requirementId) return requirement;
    found = true;
    return { ...requirement, status };
  });
  if (!found) throw new Error(`Unknown requirement: ${requirementId}`);
  return touch({ ...mission, requirements }, now);
}

function touch(mission: MissionRecord, now: string): MissionRecord {
  return { ...mission, revision: mission.revision + 1, updatedAt: now };
}

function unique(values: string[]) {
  return [...new Set(values)];
}
