import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RequirementLedger } from "@/lib/ai/mission/requirement-ledger";

/**
 * Durable storage for the Requirement Ledger.
 *
 * The ledger has to outlive the execution window it was created in. A specification too large for one
 * pass gets divided into stages, and the guarantee that no requirement disappears between those
 * stages only holds if the ledger survives a restart — the user must never have to resend the
 * original specification because Foundry lost track of it.
 */

const ledgersRoot = path.join(process.cwd(), ".foundry-data", "requirement-ledgers");

function ledgerPathFor(missionId: string) {
  const cleanId = missionId.replace(/[^a-zA-Z0-9-]/g, "_") || "mission";
  return path.join(ledgersRoot, `${cleanId}.json`);
}

export async function saveRequirementLedger(ledger: RequirementLedger): Promise<void> {
  const filePath = ledgerPathFor(ledger.missionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  // Write-then-rename: a crash mid-write must not leave a half-written ledger, because a truncated
  // ledger reads back as fewer requirements than the user actually asked for.
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(ledger, null, 2), "utf8");
  await rename(temporaryPath, filePath);
}

export async function loadRequirementLedger(missionId: string): Promise<RequirementLedger | undefined> {
  const filePath = ledgerPathFor(missionId);
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<RequirementLedger>;
    if (!parsed.missionId || !Array.isArray(parsed.requirements)) return undefined;
    return {
      missionId: parsed.missionId,
      requirements: parsed.requirements,
      revision: Number.isFinite(parsed.revision) ? Number(parsed.revision) : 0,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}
