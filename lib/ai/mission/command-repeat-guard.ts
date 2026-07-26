import { commandPermissionIdentity } from "@/lib/ai/mission/project-access";
import { normalizeVerificationEvidence } from "@/lib/factory/recovery-policy";

/**
 * Stops a mission re-running a command that already failed, unchanged.
 *
 * Repeated *writes* were already guarded, but commands were not: nothing prevented an executor from
 * issuing the same build, install, or test again after it failed, getting the identical error, and
 * spending the mission's budget discovering the same thing several times. The rule this enforces is the
 * one the reliability contract states directly — never repeat the same command without new evidence or
 * a meaningfully different strategy.
 *
 * What counts as new evidence is deliberately concrete: a source change. If the project has been
 * edited since the failed attempt, running the command again is a genuine new check and is allowed. If
 * nothing has changed, the outcome cannot have changed either, and the caller is told to fix the cause
 * or choose a different approach instead.
 */

export type FailedCommandRecord = {
  /** The failure's stable identity, so a different error on the same command reads as new information. */
  fingerprint: string;
  /** How many files the mission had changed when this attempt was made. */
  mutationsAtAttempt: number;
  attempts: number;
  /** A short excerpt of what it actually said, for the guidance handed back to the caller. */
  diagnostic: string;
};

/** Repeat state for one mission. Commands differing only by flag order or quoting are the same command. */
export type CommandRepeatState = Map<string, FailedCommandRecord>;

export function createCommandRepeatState(): CommandRepeatState {
  return new Map();
}

export function commandRepeatKey(command: string, cwd = ""): string {
  // Reuses the permission layer's notion of command identity so the guard cannot disagree with it
  // about what "the same command" means.
  return `${commandPermissionIdentity(command)}::${cwd.replace(/\\/g, "/").replace(/\/+$/, "")}`;
}

export function commandFailureFingerprint(stdout = "", stderr = ""): string {
  // normalizeVerificationEvidence already strips ports, timestamps, uuids and durations — the volatile
  // parts that make two identical failures look different. Reused rather than re-derived here.
  return normalizeVerificationEvidence(`${stderr}\n${stdout}`).slice(0, 2_000);
}

export type CommandRepeatVerdict =
  | { allow: true; reason: string }
  | { allow: false; reason: string; guidance: string };

export function evaluateCommandRepeat(input: {
  previous?: FailedCommandRecord;
  /** Files the mission has changed so far. */
  mutationsNow: number;
}): CommandRepeatVerdict {
  const { previous } = input;
  if (!previous) return { allow: true, reason: "This command has not failed in this mission." };

  if (input.mutationsNow > previous.mutationsAtAttempt) {
    return {
      allow: true,
      reason: `The project changed since this command last failed (${input.mutationsNow - previous.mutationsAtAttempt} file(s) edited), so this is a new check rather than a repeat.`,
    };
  }

  return {
    allow: false,
    reason: `This command already failed in this mission and nothing has changed since, so the result cannot differ.`,
    guidance: [
      `You already ran this command and it failed. No file has been edited since, so running it again will produce the same failure.`,
      previous.diagnostic ? `It failed with: ${previous.diagnostic}` : "",
      `Do one of these instead: fix the cause in the source and then re-run it, run a different command that gives you information you do not have yet, or report the blocker with the error above if it is not something you can repair.`,
    ].filter(Boolean).join(" "),
  };
}

/** Record a failed attempt so a later identical attempt can be recognised. */
export function recordFailedCommand(
  state: CommandRepeatState,
  input: { command: string; cwd?: string; stdout?: string; stderr?: string; mutationsNow: number },
): FailedCommandRecord {
  const key = commandRepeatKey(input.command, input.cwd);
  const fingerprint = commandFailureFingerprint(input.stdout, input.stderr);
  const previous = state.get(key);
  const record: FailedCommandRecord = {
    fingerprint,
    mutationsAtAttempt: input.mutationsNow,
    // A different error from the same command is new information, so the attempt count restarts.
    attempts: previous && previous.fingerprint === fingerprint ? previous.attempts + 1 : 1,
    diagnostic: firstDiagnosticLines(input.stderr, input.stdout),
  };
  state.set(key, record);
  return record;
}

/** Clear a command's failure record once it succeeds, so a later legitimate re-run is never blocked. */
export function clearFailedCommand(state: CommandRepeatState, command: string, cwd?: string) {
  state.delete(commandRepeatKey(command, cwd));
}

function firstDiagnosticLines(stderr = "", stdout = ""): string {
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 3).join(" | ").slice(0, 400);
}
