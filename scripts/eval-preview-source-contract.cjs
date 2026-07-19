const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "lib/factory/runtime.ts"), "utf8");
const recoveryPolicy = fs.readFileSync(path.join(root, "lib/factory/recovery-policy.ts"), "utf8");
const connector = fs.readFileSync(path.join(root, "scripts/foundry-local-connector.cjs"), "utf8");
const previewRoute = fs.readFileSync(path.join(root, "app/api/factory/preview/route.ts"), "utf8");
const agentDownloadRoute = fs.readFileSync(path.join(root, "app/api/factory/agent/download/route.ts"), "utf8");
const missionCanvas = fs.readFileSync(path.join(root, "components/canvas/MissionCanvas.tsx"), "utf8");
const canvasAdapter = fs.readFileSync(path.join(root, "lib/canvas/adapter.ts"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "components/BuildDashboard.tsx"), "utf8");
const workspaceShell = fs.readFileSync(path.join(root, "components/WorkspaceShell.tsx"), "utf8");
const projectAccess = fs.readFileSync(path.join(root, "lib/ai/mission/project-access.ts"), "utf8");
const factoryTypes = fs.readFileSync(path.join(root, "lib/factory/types.ts"), "utf8");
const files = fs.readFileSync(path.join(root, "lib/files.ts"), "utf8");
const existingRoute = fs.readFileSync(path.join(root, "app/api/factory/existing/route.ts"), "utf8");
const createRoute = fs.readFileSync(path.join(root, "app/api/factory/create/route.ts"), "utf8");
const canvasComposer = fs.readFileSync(path.join(root, "components/canvas/CanvasComposer.tsx"), "utf8");
const missionExecutor = fs.readFileSync(path.join(root, "lib/ai/mission/executor.ts"), "utf8");
const browserInfrastructure = fs.readFileSync(path.join(root, "lib/verification/browser-infrastructure.ts"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  runtime.includes('type ProjectPreviewTarget =')
    && runtime.includes('{ kind: "workspace"; projectId: string; projectPath: string }')
    && runtime.includes('{ kind: "connector"; projectId: string; connector: LocalConnectorConfig }'),
  "Preview ownership is not represented by one source-agnostic target contract.",
);
assert(
  runtime.includes("previewTarget: connectorPreviewTarget(projectId, connector)"),
  "Connector missions do not carry their owned preview target into deterministic completion.",
);
assert(
  runtime.includes("await startProjectPreview(previewTarget, stackProfile.label")
    && runtime.includes("previewArtifactRoot(previewTarget!)"),
  "Deterministic browser completion bypasses the common preview start/artifact contract.",
);
assert(
  !runtime.includes("Deterministic preview startup is not available for this connector mode."),
  "The connector-only false failure is still reachable.",
);
assert(
  !/await startPreview\(/.test(runtime) && !/await startConnectorPreview\(/.test(runtime),
  "A project lifecycle still starts a source-specific preview outside the common contract.",
);
assert(
  runtime.includes('const command = "npm run build";')
    && runtime.includes("const built = await access.runCommand(command"),
  "Canonical preview builds still bypass the project-access contract.",
);
assert(
  runtime.includes('path.join(process.cwd(), ".foundry-data", "artifacts", safeProjectId)'),
  "Connector screenshots still require a fake server-side project path.",
);
assert(
  connector.includes('path.join(__dirname, "foundry-static-preview.cjs")')
    && connector.includes('const previewUrl = `http://127.0.0.1:${port}`')
    && connector.includes('state: "ready", previewUrl, port, ownershipToken'),
  "Static connector projects can still report ready without an owned HTTP preview URL.",
);
assert(
  agentDownloadRoute.includes('readFile(path.join(process.cwd(), "scripts", "foundry-static-preview.cjs"), "utf8")')
    && agentDownloadRoute.includes('readFile(path.join(process.cwd(), "scripts", "local-agent-validation.cjs"), "utf8")')
    && agentDownloadRoute.includes('readFile(path.join(process.cwd(), "scripts", "validate-windows-desktop-ui.ps1"), "utf8")')
    && agentDownloadRoute.includes('windowsBase64FileLines("foundry-static-preview.cjs"')
    && agentDownloadRoute.includes('windowsBase64FileLines("validate-windows-desktop-ui.ps1"')
    && agentDownloadRoute.includes("FOUNDRY_AGENT_PREVIEW_EOF"),
  "The downloadable Local Agent still omits runtime files required by owned previews or validation.",
);
assert(
  runtime.includes("findConnectorBuildArtifact")
    && runtime.includes('connectorArtifactTargets.set(projectId')
    && runtime.includes('platform === "android" || platform === "mobile" || platform === "report"')
    && connector.includes('url.pathname === "/artifact/find"')
    && connector.includes('url.pathname === "/artifact/download"'),
  "Platform projects can still be replaced by a fake web preview instead of exposing their real build artifact.",
);
assert(
  connector.includes('canBindPreviewHost(port, "127.0.0.1")')
    && connector.includes('canBindPreviewHost(port, "::1")')
    && connector.includes('activeListener("127.0.0.1")')
    && connector.includes('activeListener("::1")')
    && connector.includes('existing.previewUrl || `http://127.0.0.1:${existing.port}`'),
  "Preview ports and reused URLs are not isolated across IPv4/IPv6 loopback ownership.",
);
assert(
  runtime.includes("reported a ready web preview without an HTTP URL"),
  "The server does not reject invalid ready-without-URL responses from an outdated connector.",
);
assert(
  runtime.includes("canonicalConnectorPreviewUrl") && runtime.includes('url.hostname = "127.0.0.1"'),
  "Legacy connector localhost URLs can still resolve to an unrelated IPv6 preview.",
);
assert(
  runtime.includes("const exactFailedRetry")
    && runtime.includes("retryExecutionId === parentMission?.id")
    && runtime.includes("allowIncompleteMission: true")
    && runtime.includes("Existing implementation verified; no model call needed")
    && runtime.includes("Retry snapshot changed; executing the recorded request against current files")
    && !runtime.includes("Current implementation verified; retry did not rewrite it")
    && runtime.includes("retryRepairEvidence")
    && runtime.includes("one bounded repair pass")
    && runtime.includes("Boolean(preModelBrowserEvidence) || recoveringGeneratedWebProject"),
  "Retry does not verify cheaply first and route a remaining real failure into a bounded repair plus repeat verification.",
);
assert(
  workspaceShell.includes("standaloneMutationIntent")
    && workspaceShell.includes('currentStandaloneMutation && !isMutatingProjectIntent(resolvedIntent.currentIntent)')
    && workspaceShell.includes("a non-mutating model classification cannot turn it into a status answer")
    && workspaceShell.includes('continuity: "fresh_plan"')
    && workspaceShell.includes("retryExecutionId")
    && existingRoute.includes("body.retryExecutionId"),
  "A fresh standalone change can still be misreported as status, inherit an older failed task, or enter retry recovery without the dedicated Retry control.",
);
assert(
  runtime.includes("for (let repairAttempt = 1; !browserEvidence.verified")
    && runtime.includes("repair.changedFiles.length === 0) break")
    && runtime.includes("await stopProjectPreview(previewTarget!)")
    && runtime.includes("restarted its owned preview")
    && runtime.includes("real browser gate still has unresolved product defects"),
  "Residual browser failures can still stop after one partial repair, reuse a stale production preview, or report a stale build-only outcome.",
);
assert(
  runtime.includes("generatedPreviewTarget")
    && runtime.includes("generated-browser-repair-${repairAttempt}")
    && runtime.includes("Automatic repair made no further source change")
    && runtime.includes("repaired generated preview did not become ready")
    && runtime.includes("generated project’s browser-evidenced defects"),
  "Fresh generated projects still use a one-shot browser repair or recheck a stale production preview after source changes.",
);
assert(
  runtime.includes("access.searchFiles(query")
    && runtime.includes("verifiedBrowserRepairReadPaths(access, browserEvidence.evidence)")
    && runtime.includes("verifiedBrowserRepairReadPaths(capabilityAccess, browserEvidence.evidence)"),
  "Browser evidence is not resolved back to the owning source component before repair.",
);
assert(
  runtime.includes("failedHttpResponses")
    && runtime.includes("HTTP response: ${responseFailure}")
    && runtime.includes("node.closest('[hidden], [aria-hidden=\"true\"], [inert]')"),
  "Browser validation can still hide the failing HTTP URL or flag correctly hidden UI as visible.",
);
assert(
  browserInfrastructure.includes("isDisposableFrameworkAssetProblem")
    && runtime.includes("hasDisposableFrameworkAssetFailure(problems)")
    && runtime.includes("Refreshing a stale framework preview before repair")
    && runtime.includes('recovery: "framework-preview-generation"')
    && runtime.includes("!browserEvidence.infrastructureFailure")
    && runtime.includes("if (previewTarget) await stopProjectPreview(previewTarget)"),
  "Generated framework chunk churn can still trigger a paid source repair or race a production build against a live preview.",
);
assert(
  runtime.includes("buildOnlyRecoveryCanComplete({")
    && recoveryPolicy.includes("!input.hasPreModelBrowserEvidence"),
  "A passing production build can still short-circuit a retry that already has unresolved real-browser evidence.",
);
assert(
  missionExecutor.includes('candidateTools.filter((tool) => tool.name !== "validate_browser")')
    && missionExecutor.includes("Foundry has not supplied an owned browser URL")
    && missionExecutor.includes("const url = authorizedUrl")
    && runtime.includes("uiChangeNeedsBrowserVerification"),
  "An implementation model can still guess a localhost port instead of using Foundry's owned preview and browser gate.",
);
assert(
  /recoveryPreflight\?\.buildPassed[\s\S]{0,1200}alreadySatisfied:\s*true/.test(runtime),
  "A deterministically recovered generated project can still be failed solely because the retry turn did not rewrite a correct file.",
);
assert(
  runtime.includes("parentHasUnresolvedImplementation")
    && runtime.includes("parentHasOpenPlanItems")
    && recoveryPolicy.includes("!input.mutatingOutcomeRequired")
    && runtime.includes("const explicitlyContinuingIncompleteMission = isControlContinuation")
    && recoveryPolicy.includes("input.isControlContinuation && input.hasOpenPlanItems")
    && runtime.includes("const inheritedPlan = parentMission?.plan.map")
    && runtime.includes("recoveryPreflight?.commands.length && !recoveryPreflight.buildPassed"),
  "A green build can still erase an unfinished parent checklist, swallow a standalone mutation, or falsely claim all requested features are complete.",
);
assert(
  runtime.includes("workingSetWithCommandFailure")
    && runtime.includes("contractOwners")
    && runtime.includes("compilerRepairEvidence")
    && runtime.includes("compilerRepairReadPaths")
    && runtime.includes("boundedWorkingSetEvidence || compilerRepairEvidence || boundedCompilerRepair")
    && runtime.includes("preModelBrowserEvidence || boundedCompilerRepair"),
  "A source-scoped missing-export build failure can still spend repeated calls reading consumers instead of forcing the owning module repair first.",
);
assert(
  missionCanvas.includes("Fix verified issues")
    && canvasAdapter.includes('needsRepairAction(execution) ? "Needs repair"'),
  "A failed verification is still presented as a generic failed task with a generic retry action.",
);
assert(
  runtime.includes("advertisedCredentials")
    && runtime.includes("advertisedCredentials?.[1] || testEmail")
    && runtime.includes('name: /dashboard|overview|workspace|analytics/i'),
  "The deterministic auth retry does not use advertised demo credentials or can mistake the login heading for a dashboard.",
);
assert(
  runtime.includes("Retry project identity did not match")
    && runtime.includes("No model call, command, or file write was allowed."),
  "A retry is not hard-bound to its recorded project root.",
);
assert(
  previewRoute.includes("refreshPreviewForProject(body.projectId, localConnector)")
    && runtime.includes("connectorPreviews.set(projectId, localConnector)")
    && runtime.includes("await connectLocalConnectorRoot(connector, connector.rootLabel)")
    && runtime.includes("detectStackProfileAndEntriesForAccess(access)")
    && runtime.includes('return startProjectPreview(connectorPreviewTarget(projectId, localConnector), detected.profile.label)'),
  "Opening a connector folder still cannot register and start its preview before an AI mission runs.",
);
assert(
  projectAccess.includes("async function reconnectRoot()")
    && projectAccess.includes("/not connected yet/i.test(payload.error)")
    && projectAccess.includes("await reconnectRoot()")
    && projectAccess.includes("response = await send()"),
  "Connector project access does not recover its approved root after the Local Agent restarts.",
);
assert(
  dashboard.includes("localConnector={connectorInfo ?")
    && missionCanvas.includes('action: "refresh", localConnector: previewConnector')
    && missionCanvas.includes("if (missionStatus.isBusy && hasExecution) return")
    && missionCanvas.includes("previewLoading ? \"Starting preview...\""),
  "The open-project workspace does not immediately start and visibly expose its connector preview.",
);
assert(
  runtime.includes("requestsAttachedFilesAsProjectAssets")
    && runtime.includes("materializeAttachedProjectAssets")
    && runtime.includes('materializeAll || attachment.evidenceKind === "photo" || explicitAssetRequest')
    && runtime.includes("public/foundry-uploads")
    && runtime.includes("binary read-back verification failed")
    && runtime.includes("Do not regenerate substitutes."),
  "Attachments requested as real project assets are still only being shown to the model.",
);
assert(
  projectAccess.includes("writeBinary?(relativePath: string, base64: string)")
    && projectAccess.includes('return post<ProjectWriteResult>("/write-binary"')
    && connector.includes('url.pathname === "/write-binary"')
    && connector.includes("actual.equals(expected)"),
  "Binary attachment writes are not supported and read-back verified across server and connector projects.",
);
assert(
  !factoryTypes.includes("never written into the project"),
  "The public request contract still claims that implementation image attachments can never become project assets.",
);
assert(
  workspaceShell.includes("referencesAttachments")
    && workspaceShell.includes("parentMission?.source_requirements.some")
    && workspaceShell.includes("mission?.attachments ?? []")
    && workspaceShell.includes(".slice(-8)"),
  "Clarification, approval, or retry turns can still drop attachments from the mission they continue.",
);
assert(
  factoryTypes.includes("evidenceAttachments?: FactoryEvidenceAttachment[]")
    && workspaceShell.includes("evidenceAttachments: executionAttachments")
    && existingRoute.includes("body.evidenceAttachments ?? (body.evidenceImages ?? [])"),
  "Implementation requests do not carry a general attachment contract with stale-browser image compatibility.",
);
assert(
  dashboard.includes("instructionFiles: File[]")
    && dashboard.includes("instructionAttachmentInputRef")
    && dashboard.includes("event.clipboardData.items")
    && dashboard.includes("Attachments are read with the brief when the build starts")
    && workspaceShell.includes("runFactoryExecutionForMission(projectMission.missionId, brief, discovery, evidenceAttachments)")
    && createRoute.includes("body.evidenceAttachments ?? []")
    && runtime.includes("materializeAttachedProjectAssets(access, evidenceAttachments, brief, stackProfile.id, true)")
    && runtime.includes("User-provided readable attachments")
    && runtime.includes("evidenceImages,"),
  "Discovery attachments can still be preview-only instead of being stored, materialized, and read by greenfield execution.",
);
assert(
  files.includes("const [rawText, dataUrl] = await Promise.all")
    && runtime.includes("Attached readable evidence (authoritative user-provided content")
    && runtime.includes('attachment.uploadStatus === "readable"'),
  "TXT/JSON and other readable attachments are not preserved as evidence for implementation missions.",
);
assert(
  files.includes('uploadStatus: "binary"')
    && factoryTypes.includes('uploadStatus: "readable" | "image" | "binary"')
    && canvasComposer.includes('title="Attach files or images"')
    && !canvasComposer.includes('accept="image/*"')
    && workspaceShell.includes('attachment.uploadStatus === "binary"'),
  "The composer or execution bridge still rejects arbitrary binary file formats.",
);
assert(
  runtime.includes('"application/json": ".json"')
    && runtime.includes('"text/plain": ".txt"')
    && runtime.includes("unsupported or malformed attachment payload"),
  "The verified attachment materializer is still image-only instead of supporting text and JSON assets.",
);
assert(
  runtime.includes('process.env.ComSpec || "cmd.exe"')
    && runtime.includes("shell: false")
    && runtime.includes("windowsNpmPreviewArguments(previewArgs)")
    && runtime.includes("windowsNpmPreviewArguments(commandArgs)")
    && runtime.includes('["npm.cmd", ...args].join(" ")')
    && !runtime.includes('.map((part) => `"${part.replace(/"/g, "\\"\\"")}"`)')
    && connector.includes('process.env.ComSpec || "cmd.exe"')
    && connector.includes("shell: false")
    && missionExecutor.includes("This proposed edit is already present")
    && !missionExecutor.includes("alreadySatisfied = true;\n          (toolResult as Record<string, unknown>).continuation"),
  "Preview servers can still open visible shell windows or a partial no-op can falsely satisfy a multi-file mission.",
);
assert(
  runtime.includes("export async function launchDesktopPreview")
    && runtime.includes("executable = await findDesktopExecutable(projectPath)")
    && runtime.includes("__foundryDesktopPreviewTargets")
    && runtime.includes("persistDesktopPreviewTarget(projectId, projectPath, executable)")
    && runtime.includes("restoreDesktopPreviewTarget(projectId)")
    && runtime.includes("pathIsInside(managedRoot, resolvedRequestedPath)")
    && runtime.includes('child.once("error", reject)')
    && previewRoute.includes("await launchDesktopPreview(body.projectId, body.projectPath)"),
  "Desktop launch still depends on an in-memory preview cache or reports success before Windows accepts the executable.",
);

console.log("Preview source contract regression checks passed.");
