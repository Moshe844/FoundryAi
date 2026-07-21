import { decideCommandPermission } from "@/lib/ai/mission/command-permissions";
import type {
  ExecutionMissionVerification,
  FactoryEngineeringReport,
  FactoryExecutionEvent,
  FactoryLifecyclePhase,
  FactoryLifecyclePhaseId,
  FactoryOperationalEvidence,
  FactoryProjectResult,
} from "@/lib/factory/types";

type CommandRole = "build" | "test" | "publish" | "monitor" | "other";

type PhaseEvidence = {
  evidence: string[];
  eventIds: string[];
  failed: boolean;
};

const PHASE_LABELS: Record<FactoryLifecyclePhaseId, string> = {
  understand: "Understand",
  plan: "Plan",
  analyze: "Analyze",
  implement: "Implement",
  verify: "Verify",
  build: "Build",
  test: "Run tests",
  launch: "Launch application",
  "browser-validate": "Live browser validation",
  repair: "Repair problems",
  publish: "Publish",
  monitor: "Monitor",
  report: "Engineering report",
};

const TERMINAL_BLOCKED = new Set<FactoryProjectResult["status"]>([
  "failed",
  "unsupported",
  "stopped",
  "awaiting-approval",
  "needs-clarification",
  "awaiting-mock-approval",
]);

export function finalizeFactoryProjectResult(result: FactoryProjectResult, request: string): FactoryProjectResult {
  const guarded = enforceCreationCompletionContract(result);
  const report = buildEngineeringReport(guarded, request);
  return {
    ...guarded,
    lifecycle: buildMissionLifecycle(guarded, report),
    engineeringReport: report,
  };
}

/** A generated project crosses the public completion boundary only with current executable proof. */
export function enforceCreationCompletionContract(result: FactoryProjectResult): FactoryProjectResult {
  if (result.sourceMode !== "new-project" || result.status !== "passed") return result;
  const latest = latestVerification(result.verification ?? []);
  const failedChecks = latest.filter((item) => item.result === "fail");
  const unprovenBehaviorChecks = latest.filter((item) => item.check_type === "preview" && item.result === "skipped");
  const unsettled = (result.checklist ?? []).filter((item) => !["completed", "skipped"].includes(item.status));
  const buildWasRequired = (result.commands ?? []).some((command) => commandRole(command.command) === "build");
  const buildPassed = !buildWasRequired || latest.some((item) => item.check_type === "build" && item.result === "pass") || result.artifact?.buildStatus === "verified";
  const launchProven = result.previewState === "ready" || Boolean(result.artifact?.buildStatus === "verified");
  const verificationProven = latest.some((item) => item.result === "pass");
  const missing = [
    unsettled.length ? `${unsettled.length} objective item${unsettled.length === 1 ? " is" : "s are"} unfinished` : "",
    failedChecks.length ? `${failedChecks.length} latest verification check${failedChecks.length === 1 ? " is" : "s are"} failing` : "",
    unprovenBehaviorChecks.length ? "requested runtime behavior is still unproven" : "",
    !buildPassed ? "the required production build has not passed" : "",
    !launchProven ? "no ready preview or verified runnable artifact exists" : "",
    !verificationProven ? "no current executable verification passed" : "",
  ].filter(Boolean);
  if (!missing.length) return result;
  const blocker = `Foundry cannot mark this created project complete: ${missing.join("; ")}. Continue the same mission from its recorded evidence until the completion contract passes.`;
  return {
    ...result,
    status: "needs-clarification",
    blocker,
    clarificationQuestions: [{ question: "Foundry has preserved the incomplete project and its verification evidence. Continue autonomous repair until every completion gate passes?", options: ["Continue recovery", "Pause here"] }],
    sessionSummary: result.sessionSummary
      ? { ...result.sessionSummary, outcome: "The project remains in autonomous recovery because its completion contract has not passed.", flags: unique([...result.sessionSummary.flags, blocker]) }
      : { outcome: "The project remains in autonomous recovery because its completion contract has not passed.", changes: [], preserved: ["Generated files and recorded verification evidence"], flags: [blocker] },
  };
}

export function buildEngineeringReport(result: FactoryProjectResult, request: string): FactoryEngineeringReport {
  const normalizedRequest = request.trim() || result.objective?.trim() || result.projectName;
  const verification = latestVerification(result.verification ?? []);
  const changedFiles = unique(
    result.files
      .filter((file) => file.status === "created" || file.status === "edited")
      .map((file) => file.path)
      .filter((file) => !isFoundryControlFile(file)),
  );
  const commands = result.commands ?? [];
  const publishRequested = publicationRequested(normalizedRequest);
  const publishCommands = commands.filter((command) => commandRole(command.command) === "publish");
  const monitorRequested = monitoringRequested(normalizedRequest) || publishRequested;
  const monitorCommands = commands.filter((command) => commandRole(command.command) === "monitor");
  const browserChecks = verification.filter((item) => item.check_type === "preview");
  const browserApplicable = result.previewPlatform === "web" || browserChecks.length > 0;
  const publication = operationalEvidence(publishRequested, publishCommands.map(commandEvidence), result.status === "awaiting-approval", publishCommands.some((command) => command.exitCode !== 0));
  const monitoring = operationalEvidence(
    monitorRequested,
    monitorCommands.map(commandEvidence),
    result.status === "awaiting-approval" && publishRequested,
    monitorCommands.some((command) => command.exitCode !== 0),
  );
  const browserValidation = browserOperationalEvidence(result, browserApplicable, browserChecks);
  const completion = completionMilestones(result, verification, changedFiles, publication, monitoring, browserValidation);
  const remainingIssues = remainingIssuesFor(result, verification, publication, monitoring, browserValidation);
  const findings = visibleTimeline(result).filter((event) => event.tier === "finding");
  const rootCauseCandidate = findings.at(-1)?.rationale?.trim() || findings.at(-1)?.output?.trim();
  const issueRequested = /\b(fix|debug|repair|broken|failure|error|issue|bug|crash|wrong)\b/i.test(normalizedRequest) || result.status === "failed";

  return {
    request: normalizedRequest,
    outcome: reportOutcome(result, completion.highest),
    issue: issueRequested ? firstNonEmpty(result.blocker, normalizedRequest) : undefined,
    rootCause: issueRequested ? rootCauseCandidate : undefined,
    actionsTaken: actionsTakenFor(result),
    filesChanged: changedFiles,
    commandsExecuted: commands.map((command) => ({ command: command.command, exitCode: command.exitCode, durationMs: command.durationMs })),
    verification,
    browserValidation,
    publication,
    monitoring,
    remainingIssues,
    recommendations: recommendationsFor(result, remainingIssues, normalizedRequest),
    completion,
    generatedAt: new Date().toISOString(),
  };
}

export function buildMissionLifecycle(result: FactoryProjectResult, report = buildEngineeringReport(result, result.objective ?? result.projectName)): FactoryLifecyclePhase[] {
  const events = visibleTimeline(result);
  const verification = report.verification;
  const publishRequested = report.publication.requested;
  const monitorRequested = report.monitoring.requested;
  const implementationExpected = report.filesChanged.length > 0 || mutatingRequest(report.request);

  const understand = eventEvidence(events, (event) => event.kind === "inspection" || event.kind === "folder" || (event.kind === "planning" && /read|understand|goal|request|architecture/i.test(event.title)));
  const plan = eventEvidence(events, (event) => event.kind === "planning");
  const analyze = eventEvidence(events, (event) => event.kind === "inspection" || event.tier === "finding" || (event.kind === "planning" && /architecture|stack|strategy|structure/i.test(event.title)));
  const implement = eventEvidence(events, (event) =>
    (event.kind === "file" || event.kind === "edit")
    && !isFoundryControlFile(event.filePath || event.fileName || ""),
  );
  implement.evidence.push(...report.filesChanged.map((file) => `Changed ${file}`));
  const verify = verificationEvidence(verification);
  const build = verificationEvidence(verification.filter((item) => item.check_type === "build" || item.check_type === "typecheck" || item.check_type === "lint"));
  const test = verificationEvidence(verification.filter((item) => item.check_type === "test"));
  const launch = eventEvidence(events, (event) => event.kind === "preview");
  if (result.previewState === "ready" && result.previewUrl) {
    launch.evidence.push(`Preview ready: ${result.previewUrl}`);
    // Earlier startup or browser failures are useful repair evidence, but they cannot make the
    // launch phase red after the owned preview reached its final ready state.
    launch.failed = false;
  }
  if (result.artifact) launch.evidence.push(`Built artifact: ${result.artifact.name}`);
  const browser = verificationEvidence(verification.filter((item) => item.check_type === "preview"));
  const repair = eventEvidence(events, (event) => event.kind === "fix");
  const publish = commandPhaseEvidence(result, "publish");
  const monitor = commandPhaseEvidence(result, "monitor");

  const buildlessStatic = isBuildlessStaticProject(result);
  if (buildlessStatic) {
    build.evidence.push("No compilation step is required for static HTML/CSS/JavaScript; the source files are the runnable browser artifact.");
    build.failed = false;
  }
  const testSkippedReason = buildlessStatic && report.browserValidation.status === "verified"
    ? "No automated test suite is configured; the rendered behavior was exercised by live browser validation."
    : "No test command was detected or executed.";

  return [
    phase(result, "understand", understand, true, "No project-understanding evidence was recorded."),
    phase(result, "plan", plan, true, "No planning evidence was recorded."),
    phase(result, "analyze", analyze, true, "No separate analysis evidence was recorded."),
    phase(result, "implement", implement, implementationExpected, "The mission did not require a project mutation."),
    phase(result, "verify", verify, implementationExpected || verification.length > 0, "No executable verification applied to this mission."),
    phase(result, "build", build, build.evidence.length > 0, "No build check was detected or executed."),
    phase(result, "test", test, test.evidence.length > 0, testSkippedReason),
    phase(result, "launch", launch, Boolean(result.previewUrl || result.artifact), "This project produced no launchable preview or artifact."),
    phase(result, "browser-validate", browser, report.browserValidation.requested, "Browser validation was not applicable to this mission."),
    phase(result, "repair", repair, repair.evidence.length > 0, "No repair pass was needed."),
    phase(result, "publish", publish, publishRequested, "Publishing was not requested."),
    phase(result, "monitor", monitor, monitorRequested, "Monitoring was not requested."),
    {
      id: "report",
      label: PHASE_LABELS.report,
      status: "completed",
      evidence: ["Engineering report derived from the mission's recorded files, commands, checks, and timeline."],
      eventIds: [],
    },
  ];
}

function phase(result: FactoryProjectResult, id: FactoryLifecyclePhaseId, evidence: PhaseEvidence, applicable: boolean, skippedReason: string): FactoryLifecyclePhase {
  const cleanEvidence = unique(evidence.evidence.filter(Boolean));
  if (!applicable) return { id, label: PHASE_LABELS[id], status: "skipped", evidence: cleanEvidence, eventIds: unique(evidence.eventIds), reason: skippedReason };
  if (evidence.failed) return { id, label: PHASE_LABELS[id], status: "failed", evidence: cleanEvidence, eventIds: unique(evidence.eventIds) };
  if (cleanEvidence.length) return { id, label: PHASE_LABELS[id], status: "completed", evidence: cleanEvidence, eventIds: unique(evidence.eventIds) };
  if (TERMINAL_BLOCKED.has(result.status)) return { id, label: PHASE_LABELS[id], status: "blocked", evidence: [], eventIds: [], reason: result.blocker || "The mission stopped before this phase produced evidence." };
  return { id, label: PHASE_LABELS[id], status: "skipped", evidence: [], eventIds: [], reason: skippedReason };
}

function eventEvidence(events: FactoryExecutionEvent[], predicate: (event: FactoryExecutionEvent) => boolean): PhaseEvidence {
  const matching = events.filter(predicate).filter((event) => event.status !== "running");
  return {
    evidence: matching.map((event) => event.rationale?.trim() || event.output?.trim() || event.title.trim()).filter(Boolean),
    eventIds: matching.map((event) => event.id),
    failed: matching.some((event) => event.status === "error"),
  };
}

function verificationEvidence(items: ExecutionMissionVerification[]): PhaseEvidence {
  const executed = items.filter((item) => item.result !== "skipped");
  return {
    evidence: executed.map((item) => item.evidence),
    eventIds: [],
    failed: executed.some((item) => item.result === "fail"),
  };
}

function commandPhaseEvidence(result: FactoryProjectResult, role: CommandRole): PhaseEvidence {
  const commands = result.commands.filter((command) => commandRole(command.command) === role);
  return {
    evidence: commands.map(commandEvidence),
    eventIds: visibleTimeline(result).filter((event) => event.command && commandRole(event.command) === role).map((event) => event.id),
    failed: commands.some((command) => command.exitCode !== 0),
  };
}

function commandRole(command: string): CommandRole {
  const permission = decideCommandPermission(command);
  if (permission.category === "deploy" || /\b(?:deploy|publish|release|ship)\b/i.test(command)) return "publish";
  if (/\b(?:health(?:check)?|uptime|readiness|liveness|smoke|probe)\b/i.test(command)) return "monitor";
  if (/\b(?:test|pytest|jest|vitest|mocha|rspec|phpunit)\b/i.test(command) || /\bgo\s+test\b|\bcargo\s+test\b/i.test(command)) return "test";
  if (/\b(?:build|compile|assemble|package|archive)\b/i.test(command)) return "build";
  return "other";
}

function operationalEvidence(requested: boolean, evidence: string[], waitingApproval: boolean, failed: boolean): FactoryOperationalEvidence {
  if (!requested) return { requested: false, status: "not-requested", evidence: [] };
  if (waitingApproval && !evidence.length) return { requested: true, status: "waiting-approval", evidence: [] };
  if (failed) return { requested: true, status: "failed", evidence };
  if (evidence.length) return { requested: true, status: "verified", evidence };
  return { requested: true, status: "unverified", evidence: [] };
}

function browserOperationalEvidence(result: FactoryProjectResult, applicable: boolean, checks: ExecutionMissionVerification[]): FactoryEngineeringReport["browserValidation"] {
  if (!applicable) return { requested: false, status: "not-requested", evidence: [], previewUrl: result.previewUrl };
  const evidence = checks.map((item) => item.evidence);
  if (checks.some((item) => item.result === "fail")) return { requested: true, status: "failed", evidence, previewUrl: result.previewUrl };
  if (checks.some((item) => item.result === "pass")) return { requested: true, status: "verified", evidence, previewUrl: result.previewUrl };
  return { requested: true, status: "unverified", evidence, previewUrl: result.previewUrl };
}

function completionMilestones(
  result: FactoryProjectResult,
  verification: ExecutionMissionVerification[],
  changedFiles: string[],
  publication: FactoryOperationalEvidence,
  monitoring: FactoryOperationalEvidence,
  browser: FactoryOperationalEvidence,
): FactoryEngineeringReport["completion"] {
  const passed = (kind: ExecutionMissionVerification["check_type"]) => verification.some((item) => item.check_type === kind && item.result === "pass");
  const failed = verification.some((item) => item.result === "fail");
  const saved = changedFiles.length > 0 || passed("file-read");
  const built = passed("build") || Boolean(result.artifact?.buildStatus === "verified");
  const tested = passed("test");
  const verified = result.status === "passed" && !failed && verification.some((item) => item.result === "pass");
  const browserValidated = verified && browser.status === "verified";
  const productionReady = verified && publication.status === "verified" && monitoring.status === "verified";
  const highest = productionReady ? "production-ready" : browserValidated ? "browser-validated" : verified ? "verified" : tested ? "tested" : built ? "built" : saved ? "saved" : "not-saved";
  return { highest, saved, built, tested, verified, browserValidated, productionReady };
}

function remainingIssuesFor(
  result: FactoryProjectResult,
  verification: ExecutionMissionVerification[],
  publication: FactoryOperationalEvidence,
  monitoring: FactoryOperationalEvidence,
  browser: FactoryOperationalEvidence,
): string[] {
  const incomplete = (result.checklist ?? [])
    .filter((item) => item.status === "pending" || item.status === "running" || item.status === "blocked" || item.status === "needs-approval")
    .map((item) => item.evidence || `${item.label} is ${item.status.replace(/-/g, " ")}.`);
  const flags = result.sessionSummary?.flags ?? [];
  const failed = verification.filter((item) => item.result === "fail").map((item) => item.evidence);
  const operational = [publication, monitoring, browser]
    .filter((item) => item.requested && item.status !== "verified")
    .flatMap((item) => item.evidence);
  return unique([result.blocker ?? "", ...incomplete, ...flags, ...failed, ...operational].filter(Boolean));
}

function recommendationsFor(result: FactoryProjectResult, remaining: string[], request: string): string[] {
  const recommendations: string[] = [];
  for (const requirement of result.environment?.requirements ?? []) {
    if (requirement.status === "missing" && requirement.reason) recommendations.push(requirement.reason);
    else if (requirement.status === "missing") recommendations.push(`${requirement.label} is required for ${requirement.purpose}.`);
  }
  if (result.status === "awaiting-approval") recommendations.push("Review the pending protected action to continue this mission.");
  if (result.status === "needs-clarification") recommendations.push("Answer the outstanding project decision to resume the same mission.");
  if (result.status === "passed" && (result.previewPlatform === "android" || result.previewPlatform === "mobile")) {
    if (result.previewEmulator === "android") recommendations.push("Launch the verified APK on the Android emulator, then exercise every primary screen, navigation path, form, offline/restart path, and permission prompt shown in the product brief.");
    else recommendations.push(result.previewReason || "Install the built mobile artifact on a compatible emulator or device and run the primary user flows.");
    if (/\b(?:sdk|device|terminal|scanner|camera|bluetooth|ble|nfc|usb|serial|printer|rfid|payment hardware)\b/i.test(request)) {
      recommendations.push("After emulator validation, connect the named physical device and sandbox/test account. Verify permissions, SDK initialization, disconnect/reconnect recovery, and one safe provider-side action before claiming hardware or production certification.");
    }
  }
  if (result.status === "passed" && result.previewPlatform === "desktop") recommendations.push("Launch the built desktop application and exercise its primary workflows, restart persistence, operating-system permissions, and any connected local device behavior.");
  if (result.status === "passed" && result.previewPlatform === "api") recommendations.push("Use the API Playground to exercise success, validation failure, authorization failure, and retry/idempotency paths for every exposed operation.");
  if (remaining.length && !recommendations.length) recommendations.push("Continue the same mission from the recorded blocker; completed evidence will be preserved.");
  return unique(recommendations);
}

function actionsTakenFor(result: FactoryProjectResult): string[] {
  return unique(visibleTimeline(result)
    .filter((event) => (result.status === "passed" ? event.status === "completed" : event.status !== "running") && (event.tier === "decision" || ["file", "edit", "command", "build", "preview", "fix"].includes(event.kind)))
    .filter((event) => !isFoundryControlFile(event.filePath || event.fileName || ""))
    .map((event) => event.rationale?.trim() || event.title.trim())
    .filter(Boolean)).slice(-16);
}

function isBuildlessStaticProject(result: FactoryProjectResult): boolean {
  return /\bstatic\s+(?:html|site)|html\/css\/javascript/i.test(result.stack)
    && !(result.commands ?? []).some((command) => commandRole(command.command) === "build");
}

function reportOutcome(result: FactoryProjectResult, highest: FactoryEngineeringReport["completion"]["highest"]): string {
  const recorded = result.sessionSummary?.outcome?.trim() ?? "";
  const generic = /^(?:implemented|completed|updated|fixed|repaired)\s+(?:the\s+)?(?:requested|project)\b|^the (?:requested|verified) (?:project )?change/i.test(recorded);
  if (recorded && !generic) return recorded;
  const changed = result.files.filter((file) => file.status === "created" || file.status === "edited").map((file) => file.path).filter((file) => !isFoundryControlFile(file));
  const behavior = (result.sessionSummary?.changes ?? []).map((item) => item.trim()).filter(Boolean);
  if (result.status === "passed" && (changed.length || behavior.length)) {
    return [
      behavior.length ? `Behavior: ${behavior.join("; ")}` : "",
      changed.length ? `Changed ${changed.length} file${changed.length === 1 ? "" : "s"}: ${changed.join(", ")}.` : "",
      `Latest evidence reached the ${highest.replace(/-/g, " ")} milestone.`,
    ].filter(Boolean).join(" ");
  }
  if (result.status === "passed") return `Mission passed with evidence through the ${highest.replace(/-/g, " ")} milestone.`;
  if (result.blocker?.trim()) return result.blocker.trim();
  return `Mission ended with status ${result.status}.`;
}

function latestVerification(items: ExecutionMissionVerification[]): ExecutionMissionVerification[] {
  return [...items.reduce((latest, item) => latest.set(item.check_type, item), new Map<ExecutionMissionVerification["check_type"], ExecutionMissionVerification>()).values()];
}

function visibleTimeline(result: FactoryProjectResult): FactoryExecutionEvent[] {
  return (result.timeline ?? []).filter((event) => !event.internal && !event.transient);
}

function commandEvidence(command: FactoryProjectResult["commands"][number]): string {
  return `${command.command} -> exit ${command.exitCode ?? "unknown"}${command.durationMs ? ` (${command.durationMs}ms)` : ""}`;
}

function publicationRequested(request: string): boolean {
  return /\b(?:deploy|publish|release|ship(?:\s+it)?|production)\b/i.test(request);
}

function monitoringRequested(request: string): boolean {
  return /\b(?:monitor|observability|health\s*check|uptime|alert|telemetry|production\s+logs?)\b/i.test(request);
}

function mutatingRequest(request: string): boolean {
  return /\b(?:add|build|change|create|debug|delete|deploy|edit|fix|implement|improve|modernize|publish|refactor|remove|repair|replace|update)\b/i.test(request);
}

function isFoundryControlFile(file: string): boolean {
  return /(?:^|[\\/])foundry-brief\.md$/i.test(file);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
