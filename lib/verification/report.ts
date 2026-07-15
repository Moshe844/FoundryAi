import type { VerificationCommand, VerificationProfile, VerificationReport } from "./types";

export type ExecutedVerification = { command: string; exitCode: number | null; skipped?: boolean };

export function buildVerificationReport(profile: VerificationProfile, executed: ExecutedVerification[]): VerificationReport {
  const passed: VerificationCommand[] = [];
  const failed: VerificationCommand[] = [];
  const skipped: VerificationCommand[] = [];
  for (const check of profile.commands) {
    const result = executed.find((item) => sameCommand(item.command, check.command));
    if (!result || result.skipped) skipped.push(check);
    else if (result.exitCode === 0) passed.push(check);
    else failed.push(check);
  }
  const required = profile.commands.filter((check) => check.required);
  const requiredFailed = required.some((check) => failed.includes(check));
  const requiredSkipped = required.some((check) => skipped.includes(check));
  const status = !profile.commands.length || requiredFailed || (!passed.length && required.length) ? "not-verified" : requiredSkipped ? "partially-verified" : "verified";
  return { status, passed, failed, skipped, limitations: profile.limitations };
}

function sameCommand(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/\.cmd\b/g, "").replace(/\s+/g, " ").trim();
  return normalize(left) === normalize(right);
}

export function verificationStatusLabel(status: VerificationReport["status"]): "Verified" | "Partially verified" | "Not verified" {
  if (status === "verified") return "Verified";
  if (status === "partially-verified") return "Partially verified";
  return "Not verified";
}
