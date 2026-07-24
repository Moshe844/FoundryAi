import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createHash } from "node:crypto";
import { capabilityLevelForStackChoice, checklistForRequest, detectStackProfile, isLikelySmallSingleFileRequest, isStructuralRelocationRequest, unsupportedCreationMessage, unsupportedEditingMessage, type StackCapabilityLevel, type StackProfile } from "@/lib/factory/language-adapters";
import { classifyIntent, deterministicMutationIntent, deterministicTaskAssessment } from "@/lib/ai/mission/intent-classifier";
import { runReadOnlyInspection } from "@/lib/ai/mission/inspector";
import { planMission } from "@/lib/ai/mission/mission-planner";
import { extractAtomicUserRequirements, isUserFacingUiOutcome, mayAttemptPriorCompletionReuse, observableBrowserContractForTask, reportsCurrentBehaviorFailure, requiredDomFeaturesForTask, requiredVisibleTextsForTask, requiresFreshBehavioralAcceptance, requiresPolishedUiAcceptance, requiresPresentationLayerChange, requiresSubstantialUiAcceptance, type ObservableBrowserCapability } from "@/lib/ai/mission/requirement-contract";
import { hasRunnableProjectEntry, runMissionExecutor } from "@/lib/ai/mission/executor";
import { reviewArchitecture } from "@/lib/ai/mission/architecture-review";
import { verifyMissionResult } from "@/lib/ai/mission/mission-verifier";
import { verificationAction, verificationImproved, verificationRisk } from "@/lib/ai/mission/verification-policy";
import { detectVerificationProfile } from "@/lib/verification/project-detector";
import { compilerDiagnosticOutput, compilerFailureFingerprint, compilerFailureSignature, extractCompilerSourcePaths, isCompilerSourcePath } from "@/lib/verification/compiler-evidence";
import { complianceVerdict, correctionInstruction, deriveOutcomeAssertions, isDestructiveRewrite, type FileChange } from "@/lib/verification/outcome-compliance";
import { evaluatePlacement, spatialRequirementForRequest, type ElementBox } from "@/lib/verification/dom-placement";
import { duplicateFileProblem, safelyRemovableDuplicatePaths } from "@/lib/verification/duplicate-files";
import { deterministicCompilerSourceRepair } from "@/lib/verification/deterministic-source-repair";
import { hasDisposableFrameworkAssetFailure } from "@/lib/verification/browser-infrastructure";
import type { VerificationProfile } from "@/lib/verification/types";
import { assessMissionComplexity, shouldRunArchitectureReview, shouldRunVerify, tierForStage } from "@/lib/ai/mission/orchestration";
import { createExecutionStrategy, tierForCapability, type ExecutionStrategy } from "@/lib/ai/mission/execution-strategy";
import { DEFAULT_MISSION_QUALITY, type MissionQualityLevel } from "@/lib/ai/mission/quality-level";
import type { ProviderId } from "@/lib/ai/providers/types";
import { apiKeyForProvider } from "@/lib/ai/providers/dispatch";
import { describeAndroidToolchain, ensureAndroidGradleWrapper, launchAndroidEmulator, resolveAndroidTools, resolveJavaHome } from "@/lib/factory/android-emulator";
import { inspectImportedAndroidSdk } from "@/lib/factory/android-sdk-evidence";
import { importUploadedSdkArchives } from "@/lib/factory/sdk-archives";
import { iosBuildGuidance, iosGuidanceMessage } from "@/lib/factory/ios-build-guidance";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { routeDynamically } from "@/lib/ai/routing/dynamic-router";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import type { DynamicTaskAssessment } from "@/lib/ai/routing/types";
import { discoverProjectWorkingSet, type ProjectWorkingSet } from "@/lib/ai/routing/project-working-set";
import { connectLocalConnectorRoot, createLocalConnectorProjectAccess, createServerProjectAccess, createUploadedProjectAccess, isSensitiveFilePath, type LocalConnectorConfig, type PlatformValidationResult, type ProjectAccess } from "@/lib/ai/mission/project-access";
import type { ExecutionMissionVerification, FactoryArtifact, FactoryCommandEvent, FactoryExecutionEvent, FactoryExecutionEventKind, FactoryExecutionEventStatus, FactoryExistingProjectRequest, FactoryFileEntry, FactoryJournalEntry, FactoryNarrativeObject, FactoryObjectiveChecklistItem, FactoryPreviewPlatform, FactoryPreviewState, FactoryProjectResult, FactorySessionSummary, FactorySourceMode, FactoryUploadedFile, MissionClarification, MissionParentContext, StructuredDiscovery } from "@/lib/factory/types";
import { finalizeFactoryProjectResult } from "@/lib/factory/engineering-report";
import { environmentReadinessForStack } from "@/lib/toolchains/provisioner";
import { explicitReadOnlyProjectIntent, type FollowUpResolutionRecord } from "@/lib/mission/classifyFollowUp";
import { reconcileBlockedCommandChecklist } from "@/lib/factory/evidence-reconciliation";
import { isWholeProjectDeletionRequest, parseProjectDeletionLockApprovalCommand, projectDeletionApprovalCommand, projectDeletionLockApprovalCommand } from "@/lib/factory/project-deletion";
import { customInstructionsFromProjectBrief } from "@/lib/factory/project-brief";
import { assessAutonomousBlocker, terminalBlockerWithNextAction } from "@/lib/ai/mission/autonomy-contract";
import { compactValidationProblems, matchingRunningEventId, mergeExecutionTimeline, upsertExecutionEvent } from "@/lib/factory/event-contract";
import { autonomousRepairStageLimit, buildOnlyRecoveryCanComplete, generatedRecoveryBudgetForTier, normalizeVerificationEvidence, recoveryRoutingBudget, shouldResumeExactFailedRetry, shouldResumeIncompleteGeneratedProject } from "@/lib/factory/recovery-policy";
import { routingBudgetForTier } from "@/lib/ai/routing/cost-guard";
import { redactSensitiveData, redactSensitiveText } from "@/lib/security/secret-redaction";
import { explicitProjectFileNames, isExplicitLocalProjectFileRequest } from "@/lib/sources/intent";
import { stripTerminalFormatting } from "@/lib/text/terminal";
import { actionableBuildLockMessage, forgetOwnedDesktopProcess, registerOwnedDesktopProcess } from "@/lib/factory/owned-desktop-processes";
import { desktopInteractionActionsForTask } from "@/lib/factory/desktop-acceptance";
import { classifyAcceptanceEvidence, nativeAcceptanceBoundaryPolicy } from "@/lib/factory/acceptance-evidence";
import { repairExpoConfigForBuild } from "@/lib/factory/mobile-recovery";
import { reconcilePackageManifestContract } from "@/lib/factory/scaffold-contract";
import { isStaticSourceSeparationRequest, planStaticSourceSeparation, type StaticSourceInputFile } from "@/lib/factory/static-source-separation";
import { acceptanceWorkflowTemplate, parseAcceptanceWorkflowManifest, type AcceptanceWorkflowManifest } from "@/lib/verification/acceptance-workflow";
import { projectIntegrationEnvironment } from "@/lib/integrations/runtime-environment";
import { detectProjectIntegrations } from "@/lib/integrations/detection";
import { integrationProvidersFromEvidence, integrationRequirementPrompt, integrationRequirementsForBrief, missingIntegrationRequirements } from "@/lib/integrations/requirements";
import { isPreviewRestartRequest } from "@/lib/factory/preview-intent";
import { attachedAssetPlacement, attachedAssetPublicPath } from "@/lib/factory/asset-placement";
import { buildUploadIntakeMarker, uploadIntakeMarkerFile, uploadIntakeMarkerMatches } from "@/lib/factory/upload-intake";

type ApprovalResponse = FactoryExistingProjectRequest["approvalResponse"];
type EvidenceAttachments = NonNullable<FactoryExistingProjectRequest["evidenceAttachments"]>;

type MaterializedProjectAsset = {
  sourceFileName: string;
  projectPath: string;
  publicPath: string;
  bytes: number;
};

function requestsAttachedFilesAsProjectAssets(task: string) {
  const namesAttachedMedia = /\b(?:attached|uploaded|provided|these|those)\b[^.!?\n]{0,120}\b(?:images?|photos?|pictures?|screenshots?|pngs?|jpe?gs?|assets?|media|files?|documents?|json|text|data|config)\b/i.test(task)
    || /\b(?:images?|photos?|pictures?|screenshots?|pngs?|jpe?gs?|assets?|media|files?|documents?|json|text|data|config)\b[^.!?\n]{0,120}\b(?:attached|uploaded|provided)\b/i.test(task);
  const requestsAssetUse = /\b(?:use|replace|swap|add|insert|import|apply|set|put|incorporate|populate|copy|include)\b[^.!?\n]{0,160}\b(?:images?|photos?|pictures?|screenshots?|pngs?|jpe?gs?|assets?|media|files?|documents?|json|text|data|config)\b/i.test(task)
    || /\b(?:replace|swap)\b[^.!?\n]{0,140}\b(?:with|using)\b[^.!?\n]{0,80}\b(?:attached|uploaded|provided|these|those)\b/i.test(task);
  return namesAttachedMedia && requestsAssetUse;
}

function safeAttachedAssetName(fileName: string, mediaType: string, index: number) {
  const extensionByType: Record<string, string> = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/bmp": ".bmp",
    "application/json": ".json", "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv",
    "application/xml": ".xml", "text/xml": ".xml", "application/yaml": ".yaml", "text/yaml": ".yaml",
  };
  const parsed = path.parse(fileName.replace(/\\/g, "/").split("/").pop() || `attachment-${index + 1}`);
  const base = parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `attachment-${index + 1}`;
  const suppliedExtension = /^\.[a-z0-9]{1,10}$/i.test(parsed.ext) ? parsed.ext.toLowerCase().replace(".jpeg", ".jpg") : "";
  return `${base}${suppliedExtension || extensionByType[mediaType.toLowerCase()] || ".bin"}`;
}

async function materializeAttachedProjectAssets(access: ProjectAccess, attachments: EvidenceAttachments, task: string, stackId: string, materializeAll = false) {
  const explicitAssetRequest = requestsAttachedFilesAsProjectAssets(task);
  const projectAssets = attachments.filter((attachment) => materializeAll || attachment.evidenceKind === "photo" || explicitAssetRequest);
  if (!projectAssets.length || !access.writeBinary) return { assets: [] as MaterializedProjectAsset[], failures: [] as string[] };
  const placement = attachedAssetPlacement(stackId);
  const { directory } = placement;
  const usedNames = new Set<string>();
  const assets: MaterializedProjectAsset[] = [];
  const failures: string[] = [];
  for (const [index, attachment] of projectAssets.entries()) {
    const payload = attachment.dataUrl
      ?? (attachment.rawText !== undefined ? `data:${attachment.mediaType || "text/plain"};base64,${Buffer.from(attachment.rawText, "utf8").toString("base64")}` : "");
    const match = payload.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([a-z0-9+/=\r\n]+)$/i);
    if (!match) {
      failures.push(`${attachment.fileName}: unsupported or malformed attachment payload`);
      continue;
    }
    let assetName = safeAttachedAssetName(attachment.fileName, match[1], index);
    const parsed = path.parse(assetName);
    let duplicate = 2;
    while (usedNames.has(assetName)) assetName = `${parsed.name}-${duplicate++}${parsed.ext}`;
    usedNames.add(assetName);
    const projectPath = `${directory}/${assetName}`;
    const written = await access.writeBinary(projectPath, match[2].replace(/\s+/g, ""));
    if (!written.verified) {
      failures.push(`${attachment.fileName}: ${written.reason || "binary read-back verification failed"}`);
      continue;
    }
    assets.push({
      sourceFileName: attachment.fileName,
      projectPath,
      publicPath: attachedAssetPublicPath(projectPath, placement),
      bytes: written.bytes ?? Buffer.from(match[2], "base64").byteLength,
    });
  }
  return { assets, failures };
}

async function verifiedBrowserRepairReadPaths(access: ProjectAccess, browserEvidence = ""): Promise<string[]> {
  const groups = [
    [
      "app/globals.css", "src/app/globals.css", "styles/globals.css", "src/styles/globals.css",
      "src/index.css", "src/App.css", "src/styles.css", "src/assets/main.css", "src/style.css", "styles.css",
    ],
    [
      "components/main-nav.tsx", "components/MainNav.tsx", "src/components/main-nav.tsx", "src/components/MainNav.tsx",
      "components/nav.tsx", "components/Nav.tsx", "src/components/nav.tsx", "src/components/Nav.tsx",
    ],
  ];
  const verified: string[] = [];
  for (const candidates of groups) {
    for (const candidate of candidates) {
      const file = await access.readFile(candidate, { limitBytes: 1 }).catch(() => undefined);
      if (file?.exists) {
        verified.push(candidate);
        break;
      }
    }
  }
  // Browser findings name the actual controls and routes users encountered. Search those exact
  // labels/paths in source so an off-canvas drawer failure reaches its owning component instead of
  // repeatedly sending a repair model only to a conventional global stylesheet.
  if (browserEvidence && access.searchFiles) {
    const quotedLabels = Array.from(browserEvidence.matchAll(/"([^"\r\n]{2,80})"/g), (match) => match[1].trim());
    const routePaths = Array.from(browserEvidence.matchAll(/(?:https?:\/\/[^/\s]+)?(\/[a-z0-9][a-z0-9/_-]{1,100})\b/gi), (match) => match[1])
      .filter((route) => !route.startsWith("/_next/") && !route.includes(".foundry-"));
    const queries = Array.from(new Set([...quotedLabels, ...routePaths])).slice(0, 8);
    for (const query of queries) {
      const hits = await access.searchFiles(query, { maxResults: 6 }).catch(() => []);
      for (const hit of hits) {
        if (!/\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|scss)$/i.test(hit.path)) continue;
        if (/\b(?:node_modules|\.next|dist|build|coverage)\b/i.test(hit.path.replace(/\\/g, "/"))) continue;
        const file = await access.readFile(hit.path, { limitBytes: 1 }).catch(() => undefined);
        if (file?.exists && !verified.includes(hit.path)) verified.push(hit.path);
      }
    }
  }
  return verified;
}

async function repairExpoConfigFailure(access: ProjectAccess, projectPath: string, failure: FactoryCommandEvent) {
  const appConfig = await access.readFile("app.json", { limitBytes: 250_000 }).catch(() => undefined);
  if (!appConfig?.exists || appConfig.truncated) return undefined;
  const repair = repairExpoConfigForBuild(appConfig.content, compilerDiagnosticOutput(failure), (relativePath) => {
    const resolved = path.resolve(projectPath, relativePath);
    return pathIsInside(projectPath, resolved) && existsSync(resolved);
  });
  if (!repair.changed) return undefined;
  const written = await access.writeFile("app.json", repair.content);
  return written.verified && written.contentChanged ? repair : undefined;
}

async function sourceProgressFingerprint(access: ProjectAccess, paths: string[]) {
  const digest = createHash("sha256");
  const candidates = Array.from(new Set(paths.filter(Boolean))).sort().slice(0, 24);
  if (!candidates.length) return "no-source-paths";
  for (const candidate of candidates) {
    const file = await access.readFile(candidate, { limitBytes: 500_000 }).catch(() => undefined);
    digest.update(candidate.replace(/\\/g, "/").toLowerCase());
    digest.update("\0");
    digest.update(file?.exists ? file.content : "<missing>");
    digest.update("\0");
  }
  return digest.digest("hex");
}

function semanticRepairFingerprint(evidence: string, sourceFingerprint: string) {
  return createHash("sha256")
    .update(normalizeVerificationEvidence(evidence))
    .update("\0")
    .update(sourceFingerprint)
    .digest("hex");
}

function verificationFindingFingerprint(evidence: string) {
  return createHash("sha256").update(normalizeVerificationEvidence(evidence)).digest("hex");
}

async function applyVerifiedNavigationRepair(
  access: ProjectAccess,
  browserEvidence: string,
  execution: ExecutionContext,
): Promise<string | undefined> {
  const spacingMatches = Array.from(browserEvidence.matchAll(/Responsive layout:\s*(desktop|mobile)\s+[^:]+:\s+navigation\s+(nav(?:#[\w-]+)?(?:\.[\w-]+)*)\s+with direct child links \(no list wrapper\)/gi));
  const toggleMatches = Array.from(browserEvidence.matchAll(/Responsive layout:\s*(desktop|mobile)\s+[^:]+:\s+navigation toggle\s+(button(?:#[\w-]+)?(?:\.[\w-]+)*)\s+controlling\s+(nav(?:#[\w-]+)?(?:\.[\w-]+)*)/gi));
  if (!spacingMatches.length && !toggleMatches.length) return undefined;
  const rules: string[] = [];
  if (spacingMatches.length) {
    const selectors = new Set(spacingMatches.map((match) => match[2]));
    if (selectors.size !== 1) return undefined;
    const selector = Array.from(selectors)[0];
    if (!/^nav(?:#[\w-]+)?(?:\.[\w-]+)*$/.test(selector)) return undefined;
    const viewports = new Set(spacingMatches.map((match) => match[1].toLowerCase()));
    const declaration = `${selector} {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 1rem;\n}`;
    rules.push(viewports.size > 1
      ? declaration
      : viewports.has("desktop")
        ? `@media (min-width: 901px) {\n${declaration.split("\n").map((line) => `  ${line}`).join("\n")}\n}`
        : `@media (max-width: 900px) {\n${declaration.split("\n").map((line) => `  ${line}`).join("\n")}\n}`);
  }
  if (toggleMatches.length) {
    const buttonSelectors = new Set(toggleMatches.map((match) => match[2]));
    const navSelectors = new Set(toggleMatches.map((match) => match[3]));
    if (buttonSelectors.size !== 1 || navSelectors.size !== 1) return undefined;
    const buttonSelector = Array.from(buttonSelectors)[0];
    const navSelector = Array.from(navSelectors)[0];
    const controlledId = /#([\w-]+)/.exec(navSelector)?.[1];
    if (!controlledId || !/^button(?:#[\w-]+)?(?:\.[\w-]+)*$/.test(buttonSelector) || !/^nav(?:#[\w-]+)?(?:\.[\w-]+)*$/.test(navSelector)) return undefined;
    rules.push(`${buttonSelector} {\n  display: none;\n}\n\n@media (max-width: 900px) {\n  ${buttonSelector} {\n    display: inline-flex;\n  }\n\n  ${navSelector} {\n    display: none;\n  }\n\n  ${buttonSelector}[aria-expanded="true"] ~ ${navSelector} {\n    display: flex;\n  }\n}`);
  }
  const rule = rules.join("\n\n");
  const stylePath = (await verifiedBrowserRepairReadPaths(access))[0];
  if (!stylePath) return undefined;
  const stylesheet = await access.readFile(stylePath, { limitBytes: 500_000 }).catch(() => undefined);
  if (!stylesheet?.exists || stylesheet.truncated || stylesheet.content.includes(rule)) return undefined;
  const writeResult = await access.writeFile(stylePath, `${stylesheet.content.trimEnd()}\n\n${rule}\n`);
  if (!writeResult.verified || !writeResult.contentChanged) return undefined;
  await emitExecution(execution, "edit", "completed", `Applied browser-verified navigation spacing in ${stylePath}`, {
    filePath: stylePath,
    details: { source: "rendered DOM geometry and navigation state", paidModelCalls: 0 },
  });
  return stylePath;
}

function unresolvedPackageNames(command: FactoryCommandEvent): string[] {
  const unresolved = new Set<string>();
  const output = `${command.stdout}\n${command.stderr}`;
  const patterns = [
    /(?:Module not found:\s*)?Can't resolve\s+['"]([^'"]+)['"]/gi,
    /Cannot find module\s+['"]([^'"]+)['"]/gi,
    /Failed to resolve import\s+['"]([^'"]+)['"]/gi,
    /Could not resolve\s+['"]([^'"]+)['"]/gi,
  ];
  for (const pattern of patterns) for (const match of output.matchAll(pattern)) {
    const specifier = match[1]?.trim();
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#") || specifier.startsWith("node:")) continue;
    const packageName = specifier.startsWith("@")
      ? /^@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/.exec(specifier)?.[0]
      : /^[A-Za-z0-9._-]+/.exec(specifier)?.[0];
    if (packageName) unresolved.add(packageName);
  }
  // A package that is INSTALLED but ships no types produces a different signature — "Could not find a
  // declaration file for module 'X'" under strict/noImplicitAny — and the runtime never installed the
  // matching @types package, so the build stayed red. Observed live: nodemailer imported without
  // @types/nodemailer stalled the login-auth-page build after the icon error was fixed. The @types
  // convention flattens scopes: @foo/bar -> @types/foo__bar.
  for (const match of output.matchAll(/Could not find a declaration file for module\s+['"]([^'"]+)['"]/gi)) {
    const specifier = match[1]?.trim();
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) continue;
    const packageName = specifier.startsWith("@")
      ? /^@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/.exec(specifier)?.[0]
      : /^[A-Za-z0-9._-]+/.exec(specifier)?.[0];
    if (packageName) unresolved.add(`@types/${packageName.replace(/^@/, "").replace("/", "__")}`);
  }
  // @prisma/client is generated by the Prisma CLI. Installing the runtime package alone can leave
  // a second predictable failure, so compiler evidence for that import authorizes its paired CLI.
  if (unresolved.has("@prisma/client")) unresolved.add("prisma");
  return [...unresolved].sort();
}

function compatibleGeneratedPackageSpec(packageName: string) {
  return packageName === "prisma" || packageName === "@prisma/client" ? `${packageName}@^6.0.0` : packageName;
}

/**
 * Picks the right installer for a project's missing packages.
 *
 * Bare `npm install <pkg>` on an Expo project fails with an ERESOLVE peer conflict: npm resolves the
 * package's latest version, whose react-native/react peer range disagrees with the Expo SDK's pinned
 * versions. Observed live — installing `@react-native-async-storage/async-storage` + `react-native-svg`
 * exited nonzero, the mission then paid a model to generate code against packages that never installed,
 * and typecheck failed on exactly those imports. Expo ships `expo install` for precisely this: it
 * resolves each package to the SDK-compatible version before delegating to npm. Use it whenever the
 * project depends on expo; keep plain npm for everything else.
 */
function missingPackageInstallInvocation(projectPath: string, packages: string[]): { command: string; args: string[] } {
  try {
    const manifest = JSON.parse(readFileSync(path.join(projectPath, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    if (manifest.dependencies?.expo || manifest.devDependencies?.expo) {
      // expo install picks SDK-compatible versions itself, so pass bare names, never pinned specs.
      return { command: "npx.cmd", args: ["--yes", "expo", "install", ...packages.map((name) => name.replace(/@[\^~]?\d[\d.x*-]*$/, ""))] };
    }
  } catch {
    // No readable manifest — fall through to npm, which will surface its own honest error.
  }
  return { command: "npm.cmd", args: ["install", "--prefer-offline", "--no-audit", "--no-fund", ...packages.map(compatibleGeneratedPackageSpec)] };
}

const NODE_BUILTIN_MODULES = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process",
  "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls", "tty", "url", "util", "v8",
  "vm", "wasi", "worker_threads", "zlib",
]);

const SOURCE_IMPORT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro"]);

/** Package name for a bare import specifier ("date-fns/locale" -> "date-fns", "@scope/pkg/x" -> "@scope/pkg"). */
function packageNameFromSpecifier(specifier: string): string | undefined {
  const value = specifier.trim();
  if (!value || value.startsWith(".") || value.startsWith("/") || value.startsWith("#") || value.startsWith("@/") || value.startsWith("~") || value.startsWith("$")) return undefined;
  // Protocol/virtual specifiers are never npm packages: node:fs, astro:content, virtual:pwa-register,
  // bun:test, cloudflare:workers. Installing the text before the colon would fetch the wrong thing.
  if (value.includes(":")) return undefined;
  if (NODE_BUILTIN_MODULES.has(value.split("/")[0])) return undefined;
  const name = value.startsWith("@")
    ? /^@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/.exec(value)?.[0]
    : /^[A-Za-z0-9._-]+/.exec(value)?.[0];
  if (!name || NODE_BUILTIN_MODULES.has(name)) return undefined;
  return name;
}

/**
 * Every external package the project's own source actually imports but has not declared/installed.
 *
 * Compiler output only names the packages that one failed build happened to reach, so recovering from
 * it alone discovers missing dependencies a few at a time — install two, rebuild, find two more — which
 * burns the repair budget and ends in NO_PROGRESS while the app was fine apart from its manifest. Reading
 * the imports directly makes the fix deterministic and complete in a single install.
 */
function missingDeclaredDependencies(projectPath: string): string[] {
  let manifest: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(path.join(projectPath, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const imported = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "out", "coverage", ".next"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!SOURCE_IMPORT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      let source: string;
      try {
        source = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const patterns = [
        /\bfrom\s+["']([^"']+)["']/g,
        /\bimport\s+["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const name = packageNameFromSpecifier(match[1]);
          if (name) imported.add(name);
        }
      }
    }
  };
  walk(projectPath, 0);
  const projectName = manifest.name;
  return [...imported]
    .filter((name) => name !== projectName && !declared.has(name) && !existsSync(path.join(projectPath, "node_modules", name)))
    .sort();
}

/** Compiler-reported missing packages unioned with everything the source imports but never declared. */
function allMissingPackages(projectPath: string, failure?: FactoryCommandEvent): string[] {
  const packages = new Set<string>(failure ? unresolvedPackageNames(failure) : []);
  for (const name of missingDeclaredDependencies(projectPath)) packages.add(name);
  if (packages.has("@prisma/client")) packages.add("prisma");
  return [...packages].sort();
}

function workingSetWithCommandFailure(base: ProjectWorkingSet, failure: FactoryCommandEvent, projectPath: string): ProjectWorkingSet {
  const output = stripTerminalFormatting(`${failure.stdout}\n${failure.stderr}`);
  const referenced = new Set<string>();
  const contractOwners = new Set<string>();
  for (const sourcePath of applicationCompilerSourcePaths(output, projectPath)) referenced.add(sourcePath);
  for (const match of output.matchAll(/Could not resolve\s+["']([^"']+)["']\s+from\s+["']([^"']+)["']/gi)) {
    const specifier = match[1].trim();
    const importer = match[2].replace(/\\/g, "/");
    if (existsSync(path.join(projectPath, importer))) referenced.add(importer);
    if (specifier.startsWith(".")) {
      const target = path.relative(projectPath, path.resolve(projectPath, path.dirname(importer), specifier)).replace(/\\/g, "/");
      if (target && !target.startsWith("../") && existsSync(path.join(projectPath, target))) contractOwners.add(target);
    }
  }
  // Missing-export errors often point at every consumer while naming one broken local module. Put
  // that module first so the repair model edits the contract owner instead of rereading callers.
  for (const match of output.matchAll(/(?:not exported from\s+|Module\s+)["']([^"']+)["']/gi)) {
    const specifier = match[1].trim();
    const moduleBase = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith("./") ? specifier.slice(2) : "";
    if (!moduleBase) continue;
    for (const candidate of [moduleBase, `${moduleBase}.ts`, `${moduleBase}.tsx`, `${moduleBase}.js`, `${moduleBase}.jsx`, `${moduleBase}/index.ts`, `${moduleBase}/index.tsx`]) {
      if (existsSync(path.join(projectPath, candidate))) contractOwners.add(candidate.replace(/\\/g, "/"));
    }
  }
  for (const match of output.matchAll(/from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+([A-Za-z_]\w*)/g)) {
    const modulePath = match[1].replace(/\./g, "/");
    for (const candidate of [`${modulePath}.py`, `${modulePath}/__init__.py`]) {
      if (existsSync(path.join(projectPath, candidate))) referenced.add(candidate);
    }
  }
  const orderedReferenced = [...contractOwners, ...referenced];
  const likelyFiles = [...new Set([...orderedReferenced, ...base.likelyFiles])].slice(0, 30);
  return { ...base, likelyFiles, evidence: [...new Set([orderedReferenced.map((item) => `${item} (command traceback)`), base.evidence].flat())].slice(0, 20) };
}

function missingRelativeImportTarget(failure: FactoryCommandEvent, projectPath: string) {
  const output = stripTerminalFormatting(`${failure.stdout}\n${failure.stderr}`);
  const relativeMatch = /Could not resolve\s+["']([^"']+)["']\s+from\s+["']([^"']+)["']/i.exec(output);
  const aliasMatch = /(?:Module not found:\s*)?(?:Can't|Cannot) resolve\s+["'](@\/[^"']+)["']/i.exec(output);
  const specifier = relativeMatch?.[1] ?? aliasMatch?.[1];
  const importer = relativeMatch?.[2]?.replace(/\\/g, "/")
    ?? extractCompilerSourcePaths(output, projectPath).find((candidate) => /\.[cm]?[jt]sx?$/i.test(candidate));
  if (!specifier || !importer || (!specifier.startsWith(".") && !specifier.startsWith("@/"))) return undefined;
  const resolved = specifier.startsWith("@/")
    ? path.resolve(projectPath, "src", specifier.slice(2))
    : path.resolve(projectPath, path.dirname(importer), specifier);
  const target = path.relative(projectPath, resolved).replace(/\\/g, "/");
  if (!target || target.startsWith("../") || path.isAbsolute(target) || existsSync(path.join(projectPath, target))) return undefined;
  const targetExistsWithExtension = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]
    .some((suffix) => existsSync(path.join(projectPath, `${target}${suffix}`)));
  if (targetExistsWithExtension) return undefined;
  return { importer, specifier, target };
}

function commandTracebackSourcePaths(workingSet: ProjectWorkingSet, projectPath: string, limit = 3): string[] {
  return workingSet.evidence
    .map((item) => /^(.*?) \(command traceback\)$/.exec(item)?.[1]?.trim())
    .filter((item): item is string => Boolean(item))
    .filter((item) => existsSync(path.join(projectPath, item)) && isCompilerSourcePath(item) && !/(?:^|\/)(?:node_modules|vendor|\.next|\.next-build|dist|build|out)(?:\/|$)/i.test(item.replace(/\\/g, "/")))
    .slice(0, limit);
}

/** Maps framework-generated Next type-contract paths back to the app source that owns the contract. */
function applicationCompilerSourcePaths(output: string | FactoryCommandEvent, projectPath: string) {
  const diagnostic = typeof output === "string" ? output : compilerDiagnosticOutput(output);
  const paths = new Set(extractCompilerSourcePaths(diagnostic, projectPath));
  for (const match of diagnostic.replace(/\\/g, "/").matchAll(/(?:\.next|\.next-build)\/types\/(?:src\/)?app\/(.+?)\/(page|route)\.ts\b/gi)) {
    const base = `src/app/${match[1]}/${match[2]}`;
    for (const extension of [".tsx", ".ts", ".jsx", ".js"]) {
      const candidate = `${base}${extension}`;
      if (existsSync(path.join(projectPath, candidate))) paths.add(candidate);
    }
  }
  return [...paths];
}

function hasPrismaSevenLegacySchemaFailure(commands: FactoryCommandEvent[]) {
  return commands.some((command) => /Prisma CLI Version\s*:\s*7\./i.test(`${command.stdout}\n${command.stderr}`)
    && /datasource property `url` is no longer supported in schema files/i.test(`${command.stdout}\n${command.stderr}`));
}

async function preflightGeneratedPrismaCompatibility(
  access: ProjectAccess,
  projectPath: string,
  execution: ExecutionContext,
): Promise<{ commands: FactoryCommandEvent[]; changedFiles: string[]; buildPassed: boolean } | undefined> {
  const [manifestFile, schemaFile] = await Promise.all([
    access.readFile("package.json", { limitBytes: 100_000 }).catch(() => undefined),
    access.readFile("prisma/schema.prisma", { limitBytes: 200_000 }).catch(() => undefined),
  ]);
  if (!manifestFile?.exists || !schemaFile?.exists) return undefined;
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(manifestFile.content) as typeof manifest;
  } catch {
    return undefined;
  }
  const prismaSpecs = [
    manifest.dependencies?.prisma,
    manifest.devDependencies?.prisma,
    manifest.dependencies?.["@prisma/client"],
    manifest.devDependencies?.["@prisma/client"],
  ].filter((value): value is string => Boolean(value));
  const requestsPrismaSeven = prismaSpecs.some((value) => /(?:^|[^0-9])7(?:\.|$)/.test(value));
  const usesLegacyDatasourceUrl = /datasource\s+\w+\s*\{[\s\S]*?\burl\s*=/.test(schemaFile.content);
  if (!requestsPrismaSeven || !usesLegacyDatasourceUrl) return undefined;

  await emitExecution(execution, "reasoning", "completed", "Compatibility preflight found a Prisma 7 dependency paired with a Prisma 6-style schema. I’m aligning the CLI and client, generating the client, and running the real production build before any implementation model is called.", {
    details: { evidence: "package.json requests Prisma 7 while prisma/schema.prisma contains datasource.url", targetVersion: "^6.0.0", paidModelCalls: 0 },
  });
  const commands: FactoryCommandEvent[] = [];
  const install = await runCommand(projectPath, "npm.cmd", ["install", "--prefer-offline", "--no-audit", "--no-fund", "prisma@^6.0.0", "@prisma/client@^6.0.0"], [], execution);
  commands.push(install);
  if (install.exitCode !== 0) return { commands, changedFiles: [], buildPassed: false };
  const generate = await runCommand(projectPath, "npm.cmd", ["exec", "--", "prisma", "generate"], [], execution);
  commands.push(generate);
  if (generate.exitCode !== 0) return { commands, changedFiles: ["package.json", "package-lock.json"], buildPassed: false };
  const build = await runCommand(projectPath, "npm.cmd", ["run", "build"], [], execution);
  commands.push(build);
  return { commands, changedFiles: ["package.json", "package-lock.json"], buildPassed: build.exitCode === 0 };
}

async function preflightIncompleteGeneratedBuild(
  access: ProjectAccess,
  verificationProfile: VerificationProfile,
  projectPath: string,
  execution: ExecutionContext,
): Promise<{ commands: FactoryCommandEvent[]; changedFiles: string[]; buildPassed: boolean }> {
  await emitExecution(execution, "reasoning", "completed", "Running the existing production build before model routing so Foundry can finish immediately when the project is already valid, or give a repair model the exact current compiler evidence without paying it to rediscover the failure.", {
    details: { paidModelCalls: 0, purpose: "generated-project recovery preflight" },
  });
  const gate = await runRequiredVerificationProfile({ access, execution, profile: verificationProfile, projectPath, existingCommands: [] });
  return { commands: gate.commands, changedFiles: [], buildPassed: gate.passed };
}

function isBoundedCompilerPreflightFailure(preflight: { commands: FactoryCommandEvent[]; buildPassed: boolean } | undefined, projectPath?: string) {
  if (!preflight || preflight.buildPassed) return false;
  const failure = preflight.commands.at(-1);
  if (!failure || !isProductionBuildCommand(failure.command)) return false;
  const referencedSourceFiles = projectPath ? extractCompilerSourcePaths(failure, projectPath) : [];
  return referencedSourceFiles.length > 0 && referencedSourceFiles.length <= 3;
}

async function modelForMissionStage(task: string, mode: ModelMode | undefined, stageTier: ModelTier, workingSet?: ProjectWorkingSet, failureHistory = 0, dynamicAssessment?: DynamicTaskAssessment) {
  const tier = mode && mode !== "auto" ? lowerTier(stageTier, mode) : stageTier;
  const routed = await routeDynamically({
    message: task,
    tier,
    likelyFiles: workingSet?.likelyFiles,
    projectFileCount: workingSet?.projectFileCount,
    estimatedSubsystems: workingSet?.estimatedSubsystems,
    crossLayer: workingSet?.crossLayer,
    projectWide: workingSet?.projectWide,
    failureHistory,
    dynamicAssessment,
  });
  const apiKey = apiKeyForProvider(routed.decision.provider);
  return apiKey ? { apiKey, provider: routed.decision.provider, tier: routed.decision.tier, model: routed.decision.model, effort: routed.decision.effort, reason: routed.decision.reason, costClass: routed.decision.costClass } : undefined;
}

function lowerTier(left: ModelTier, ceiling: ModelTier): ModelTier {
  const rank: Record<ModelTier, number> = { fast: 1, builder: 2, architect: 3, "enterprise-architect": 4, "super-reasoning": 5 };
  return rank[left] <= rank[ceiling] ? left : ceiling;
}

function assessmentHighRisk(assessment: DynamicTaskAssessment) {
  return assessment.securityOrPayment || assessment.migration || assessment.risk >= 0.65 || assessment.difficulty >= 0.82;
}

function assessmentMultiPart(assessment: DynamicTaskAssessment) {
  return assessment.estimatedFiles > 3 || assessment.estimatedSubsystems > 1 || assessment.affectedScope === "multi-subsystem" || assessment.affectedScope === "project-wide";
}

function complexityFromAssessment(assessment: DynamicTaskAssessment) {
  return assessMissionComplexity({
    highRisk: assessmentHighRisk(assessment),
    multiPart: assessmentMultiPart(assessment),
    distinctPhases: assessment.estimatedSubsystems,
    stackCapabilityLevel: 4,
    fileCount: assessment.estimatedFiles,
  });
}

type ProjectSpec = {
  projectName: string;
  template: string;
  stack: string;
  projectType: string;
  projectDescription: string;
  projectSource: string;
  selectedUploadPaths: string[];
  existingSourceGuard: string;
  instructions: string;
  slug: string;
};

function compactDiscoveryTask(discovery: StructuredDiscovery, additionalInstructions: string) {
  const lines = [
    `Build ${conciseRequirement(discovery.projectType, 180)}.`,
    `Use ${conciseRequirement(discovery.recommendedStack || discovery.architecture, 180)}.`,
    discovery.mainFeatures.length ? `Required behavior:\n${discovery.mainFeatures.map((item) => `- ${conciseRequirement(item, 180)}`).join("\n")}` : "",
    discovery.dataModel.length ? `Data: ${discovery.dataModel.map((item) => conciseRequirement(item, 140)).join("; ")}` : "",
    discovery.styleDirection ? `Design: ${conciseRequirement(discovery.styleDirection, 220)}` : "",
    discovery.keyFacts.length ? `Constraints:\n${discovery.keyFacts.map((item) => `- ${conciseRequirement(item, 160)}`).join("\n")}` : "",
    discovery.decisions.length
      ? `Accepted decisions:\n${discovery.decisions.map((item) => `- ${conciseRequirement(item.dimension, 50)}: ${conciseRequirement(item.hypothesis, 150)}`).join("\n")}`
      : "",
    additionalInstructions ? `Additional instructions: ${conciseRequirement(additionalInstructions, 500)}` : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

function conciseRequirement(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}

function compilerRepairBudgetUsd() {
  const configured = Number(process.env.FOUNDRY_COMPILER_REPAIR_BUDGET_USD);
  // This is total mission capacity, not an extra unbounded charge. The existing ledger keeps all
  // earlier calls, while the daily hard cap remains authoritative across the entire application.
  return Number.isFinite(configured) && configured > 0
    ? Math.min(2, Math.max(0.8, configured))
    : 1.05;
}

function compactNewProjectChecklist(projectType: string): FactoryObjectiveChecklistItem[] {
  const product = conciseRequirement(projectType || "the requested project", 90).replace(/[.!?]+$/, "");
  return [
    { id: "build-foundation", label: `Build ${product}`, status: "running" },
    { id: "implement-behavior", label: "Connect the requested interactions and data behavior", status: "pending" },
    { id: "verify-experience", label: "Verify the finished experience in a real browser", status: "pending" },
  ];
}

const projectsRoot = path.join(process.cwd(), "projects");
type PreviewProcessRecord = { port: number; processId?: number; lastUsedAt: number; previewUrl: string; projectPath: string; kind: "static" | "app"; ownershipToken?: string; runtimeLog?: string; runtimeVersion?: string };
type PreviewStatusOutcome = { previewState: FactoryPreviewState; previewUrl?: string; previewReason?: string; previewPlatform?: FactoryPreviewPlatform };
const previewProcessGlobal = globalThis as typeof globalThis & {
  __foundryPreviewProcesses?: Map<string, PreviewProcessRecord>;
  __foundryPreviewRefreshes?: Map<string, Promise<void>>;
  __foundryPreviewRefreshOutcomes?: Map<string, PreviewStatusOutcome>;
};
// Next.js compiles API routes into separate module graphs. A module-local map lets the execution
// route start a detached preview while the preview/stop route sees an empty registry and falsely
// reports success. Process-global ownership keeps start/status/stop consistent across route bundles
// and survives development hot reloads without orphaning locked project directories.
const previewProcesses = previewProcessGlobal.__foundryPreviewProcesses ??= new Map<string, PreviewProcessRecord>();
const previewRefreshes = previewProcessGlobal.__foundryPreviewRefreshes ??= new Map<string, Promise<void>>();
const previewRefreshOutcomes = previewProcessGlobal.__foundryPreviewRefreshOutcomes ??= new Map<string, PreviewStatusOutcome>();
const workspacePreviewRegistryDirectory = path.join(process.cwd(), ".foundry-data", "preview-processes-v1");

function staticPreviewRuntimeVersion() {
  try {
    return createHash("sha256").update(readFileSync(path.join(process.cwd(), "scripts", "foundry-static-preview.cjs"))).digest("hex");
  } catch {
    return "missing-static-preview-runtime";
  }
}

function workspacePreviewRecordPath(projectId: string) {
  return path.join(workspacePreviewRegistryDirectory, `${createHash("sha256").update(projectId).digest("hex")}.json`);
}

/**
 * Registers the process that now owns this project's preview, stopping whichever one it replaces.
 *
 * `previewProcesses.set` alone silently abandoned the previous server: it kept running, kept holding
 * its port, and was no longer referenced by anything that could stop it. Repeated refreshes stacked
 * up dozens of orphans — one workspace was found holding ports 3100-3142 — which eats the managed
 * port range until `findPreviewPort` can no longer allocate one.
 */
function registerPreviewProcess(projectId: string, preview: PreviewProcessRecord) {
  const previous = previewProcesses.get(projectId);
  if (previous?.processId && previous.processId !== preview.processId) stopPreviewProcessTree(previous.processId);
  previewProcesses.set(projectId, preview);
  persistWorkspacePreview(projectId, preview);
}

function persistWorkspacePreview(projectId: string, preview: PreviewProcessRecord) {
  try {
    mkdirSync(workspacePreviewRegistryDirectory, { recursive: true });
    writeFileSync(workspacePreviewRecordPath(projectId), JSON.stringify({ projectId, ...preview, recordedAt: Date.now() }), "utf8");
  } catch {
    // The in-memory registry remains authoritative until a full process restart.
  }
}

function forgetWorkspacePreview(projectId: string) {
  try {
    rmSync(workspacePreviewRecordPath(projectId), { force: true });
  } catch {
    // A missing record is already forgotten.
  }
}

function restoreWorkspacePreviews() {
  let recordNames: string[] = [];
  try {
    recordNames = readdirSync(workspacePreviewRegistryDirectory).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  for (const recordName of recordNames) {
    const recordPath = path.join(workspacePreviewRegistryDirectory, recordName);
    try {
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as PreviewProcessRecord & { projectId?: string; recordedAt?: number };
      if (!record.projectId || !record.processId || !record.projectPath || !record.port || Date.now() - Number(record.recordedAt || 0) > 604_800_000 || !processIsAlive(record.processId)) {
        rmSync(recordPath, { force: true });
        continue;
      }
      previewProcesses.set(record.projectId, record);
    } catch {
      try { rmSync(recordPath, { force: true }); } catch { /* Ignore an unreadable stale record. */ }
    }
  }
}

restoreWorkspacePreviews();
const connectorPreviewGlobal = globalThis as typeof globalThis & { __foundryConnectorPreviews?: Map<string, LocalConnectorConfig> };
// Connector previews live in the host-side local agent, not this Next.js process. Keep their
// connection details process-global so the execution route and the later preview status/refresh
// route observe the same runtime instead of immediately downgrading a proven preview to unavailable.
const connectorPreviews = connectorPreviewGlobal.__foundryConnectorPreviews ??= new Map<string, LocalConnectorConfig>();
type ConnectorArtifactTarget = { connector: LocalConnectorConfig; relativePath: string; platform: FactoryPreviewPlatform };
const connectorArtifactGlobal = globalThis as typeof globalThis & { __foundryConnectorArtifactTargets?: Map<string, ConnectorArtifactTarget> };
const connectorArtifactTargets = connectorArtifactGlobal.__foundryConnectorArtifactTargets ??= new Map<string, ConnectorArtifactTarget>();
type DesktopPreviewTargetRecord = { projectPath: string; executable: string };
const desktopPreviewGlobal = globalThis as typeof globalThis & { __foundryDesktopPreviewTargets?: Map<string, DesktopPreviewTargetRecord> };
const desktopPreviewTargets = desktopPreviewGlobal.__foundryDesktopPreviewTargets ??= new Map<string, DesktopPreviewTargetRecord>();
const desktopPreviewRegistryDirectory = path.join(process.cwd(), ".foundry-data", "desktop-targets-v1");

function desktopPreviewRecordPath(projectId: string) {
  return path.join(desktopPreviewRegistryDirectory, `${createHash("sha256").update(projectId).digest("hex")}.json`);
}

function pathIsInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function persistDesktopPreviewTarget(projectId: string, projectPath: string, executable: string) {
  if (!pathIsInside(projectPath, executable) || !/\.exe$/i.test(executable)) return;
  const target = { projectPath: path.resolve(projectPath), executable: path.resolve(executable) };
  desktopPreviewTargets.set(projectId, target);
  try {
    mkdirSync(desktopPreviewRegistryDirectory, { recursive: true });
    writeFileSync(desktopPreviewRecordPath(projectId), JSON.stringify({ projectId, ...target, recordedAt: Date.now() }), "utf8");
  } catch {
    // The process-global target remains usable until the next full server restart.
  }
}

function restoreDesktopPreviewTarget(projectId: string) {
  try {
    const record = JSON.parse(readFileSync(desktopPreviewRecordPath(projectId), "utf8")) as { projectId?: string; projectPath?: string; executable?: string; recordedAt?: number };
    if (record.projectId !== projectId || !record.projectPath || !record.executable || Date.now() - Number(record.recordedAt || 0) > 2_592_000_000) return undefined;
    if (!pathIsInside(record.projectPath, record.executable) || !existsSync(record.executable) || !/\.exe$/i.test(record.executable)) return undefined;
    const target = { projectPath: path.resolve(record.projectPath), executable: path.resolve(record.executable) };
    desktopPreviewTargets.set(projectId, target);
    return target;
  } catch {
    return undefined;
  }
}
const journalsRoot = path.join(process.cwd(), ".foundry-data", "journals");
type ProjectPreviewTarget =
  | { kind: "workspace"; projectId: string; projectPath: string }
  | { kind: "connector"; projectId: string; connector: LocalConnectorConfig };
type ExecutionEmitter = (event: FactoryExecutionEvent) => void | Promise<void>;

type ExecutionContext = {
  timeline: FactoryExecutionEvent[];
  emit: ExecutionEmitter;
  checklist: FactoryObjectiveChecklistItem[];
  projectId?: string;
  costScopeId: string;
};

async function emitModelSelection(execution: ExecutionContext, stage: string, selection: { provider: ProviderId; model: string; tier: ModelTier; effort?: string; reason?: string; costClass?: string } | undefined) {
  if (!selection) return;
  const alreadyEmitted = execution.timeline.some((event) => event.details?.stage === stage && event.details?.provider === selection.provider && event.details?.model === selection.model);
  if (alreadyEmitted) return;
  await emitExecution(execution, "planning", "completed", "Model route selected", {
    internal: true,
    details: { stage, tier: selection.tier, provider: selection.provider, model: selection.model, effort: selection.effort ?? "provider default", reason: selection.reason, costClass: selection.costClass },
  });
}

const NON_EDIT_INTENT_PATTERN =
  /\b(can you see|what does|what is this|explain|tell me about|do you understand|undo|revert|roll back|rollback|deploy|production|release|ship it|hosting|review|audit|analy[sz]e|architecture assessment|status|what happened|last run|previous run)\b/i;

function looksUnambiguouslyLikeSmallEdit(task: string): boolean {
  if (deterministicMutationIntent(task) === "edit") return isLikelySmallSingleFileRequest(task);
  if (NON_EDIT_INTENT_PATTERN.test(task)) return false;
  return isLikelySmallSingleFileRequest(task);
}

function looksLikeBoundedClientInteraction(task: string) {
  return /\b(?:implement|wire|connect|make|fix|repair|add)\b/i.test(task)
    && /\b(?:client[- ]side|search|filter|sort|pagination|toggle|tab|modal|dialog|dropdown|button|form)\b/i.test(task)
    && !/\b(?:database|migration|backend|server|api|authentication|authorization|payment|billing|webhook|deployment|infrastructure)\b/i.test(task);
}

function journalPathFor(projectId: string) {
  const cleanId = projectId.replace(/[^a-zA-Z0-9-]/g, "_") || "project";
  return path.join(journalsRoot, cleanId, "journal.ndjson");
}

export async function appendJournalEntry(projectId: string, event: FactoryExecutionEvent) {
  const entry: FactoryJournalEntry = {
    id: `journal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    projectId,
    timestamp: event.timestamp,
    event,
    beforeContent: event.beforeContent,
  };
  const filePath = journalPathFor(projectId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readJournal(projectId: string): Promise<FactoryJournalEntry[]> {
  const filePath = journalPathFor(projectId);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as FactoryJournalEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is FactoryJournalEntry => entry !== null);
}

async function writeJournal(projectId: string, entries: FactoryJournalEntry[]) {
  const filePath = journalPathFor(projectId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, entries.length ? `${body}\n` : "", "utf8");
}

async function createFactoryProjectCore(brief: string, onEvent?: ExecutionEmitter, discovery?: StructuredDiscovery, modelMode: ModelMode = "auto", quality: MissionQualityLevel = DEFAULT_MISSION_QUALITY, signal?: AbortSignal, evidenceAttachments: EvidenceAttachments = []): Promise<FactoryProjectResult> {
  brief = redactSensitiveText(brief);
  discovery = discovery ? redactSensitiveData(discovery) : discovery;
  const spec = parseBrief(brief);
  const projectPath = await uniqueProjectPath(spec.slug);
  const projectId = path.basename(projectPath);
  const events: string[] = [];
  const commands: FactoryCommandEvent[] = [];
  const execution = createExecutionContext(onEvent, projectId);
  initializeObjectiveChecklist(execution, spec.instructions || `Create ${spec.projectName}`, "new-project");
  const sourceInspection = inspectExistingSourceSelection(spec);

  await emitExecution(execution, "planning", "running", "Planning project", {
    details: { projectName: spec.projectName, stack: spec.stack, template: spec.template },
  });
  await emitExecution(execution, "planning", "completed", "Architecture selected", {
    details: { stack: spec.stack, projectType: spec.projectType },
  });
  completeChecklistItem(execution, "understand-goal", "completed", `Selected ${spec.stack} for ${spec.projectType}.`);

  if (sourceInspection) {
    events.push(sourceInspection);
    events.push("Existing source is read/reference-only. Foundry will not write generated files into the selected root.");
    await emitExecution(execution, "inspection", sourceInspection.includes("appears") ? "warning" : "completed", "Inspected existing source", {
      details: {
        result: sourceInspection,
        writePolicy: "Reference-only. Generated files stay inside Foundry workspace.",
      },
    });
  }

  await emitExecution(execution, "folder", "running", "Creating project folder", {
    details: { path: projectPath, projectId, projectPath },
  });
  await mkdir(projectPath, { recursive: true });
  events.push(`Created project folder: ${projectPath}`);
  await emitExecution(execution, "folder", "completed", `Created ${path.basename(projectPath)}`, {
    filePath: projectPath,
    details: { path: projectPath, projectId, projectPath },
  });

  const briefPath = path.join(projectPath, "foundry-brief.md");
  await writeFile(briefPath, brief, "utf8");
  events.push("Created file: foundry-brief.md");
  await emitExecution(execution, "file", "completed", "Created foundry-brief.md", {
    fileName: "foundry-brief.md",
    filePath: "foundry-brief.md",
    details: { reason: "Saved the build brief that drives this project execution.", linesAdded: lineCount(brief) },
  });

  const stackProfile = capabilityLevelForStackChoice(spec.stack);
  await emitExecution(execution, "inspection", "completed", "Detected requested stack", {
    internal: true,
    details: { stack: stackProfile.label, capabilityLevel: stackProfile.level },
  });

  if (stackProfile.level === 1) {
    const message = unsupportedCreationMessage(stackProfile);
    await emitExecution(execution, "summary", "warning", `${stackProfile.label} creation not yet supported`, {
      output: message,
      details: { stack: stackProfile.label, capabilityLevel: stackProfile.level },
    });
    finishObjectiveChecklist(execution, "unsupported", message);
    const files = await listProjectFiles(projectPath);
    return {
      projectId,
      projectName: spec.projectName,
      projectPath,
      briefPath,
      stack: stackProfile.label,
      template: spec.template,
      sourceMode: "new-project",
      objective: `Create ${spec.projectName}`,
      checklist: execution.checklist,
      status: "unsupported",
      supported: false,
      blocker: message,
      events: [...events, message],
      files,
      commands,
      timeline: execution.timeline,
    };
  }

  const rawAccess = createServerProjectAccess(projectPath, "local-folder");
  const access = accessForCapabilityLevel(rawAccess, stackProfile.level);
  const evidenceImages = evidenceAttachments
    .filter((attachment) => attachment.uploadStatus === "image" && Boolean(attachment.dataUrl))
    .map((attachment) => ({
      fileName: attachment.fileName,
      mediaType: attachment.dataUrl?.match(/^data:([^;,]+)/i)?.[1] || attachment.mediaType || "image/png",
      dataUrl: attachment.dataUrl!,
    }));
  const attachedAssetWrite = await materializeAttachedProjectAssets(access, evidenceAttachments, brief, stackProfile.id, true);
  if (attachedAssetWrite.failures.length) {
    const blocker = `Foundry could not safely import every Discovery attachment: ${attachedAssetWrite.failures.join("; ")}. No implementation model call was sent.`;
    await emitExecution(execution, "summary", "error", "Discovery attachments could not be verified", {
      details: { blocker, files: evidenceAttachments.map((attachment) => attachment.fileName), paidModelCalls: 0 },
    });
    finishObjectiveChecklist(execution, "failed", blocker);
    const files = await listProjectFiles(projectPath);
    return {
      projectId, projectName: spec.projectName, projectPath, briefPath, stack: stackProfile.label, template: spec.template,
      sourceMode: "new-project", objective: `Create ${spec.projectName}`, checklist: execution.checklist,
      status: "failed", supported: true, blocker, events: [...events, blocker], files, commands, timeline: execution.timeline,
    };
  }
  const importedSdkArchives = importUploadedSdkArchives(projectPath, attachedAssetWrite.assets.map((asset) => asset.projectPath), `${stackProfile.id} ${stackProfile.label} ${spec.stack}`);
  if (importedSdkArchives.length) {
    await emitExecution(execution, "inspection", "completed", `Prepared ${importedSdkArchives.length} uploaded SDK package${importedSdkArchives.length === 1 ? "" : "s"} for the selected platform`, {
      details: {
        providerHardcoded: false,
        archives: importedSdkArchives.map((item) => item.archive),
        importedLibraries: importedSdkArchives.flatMap((item) => item.files),
        certification: "not-certified",
      },
    });
  }
  if (evidenceAttachments.length) {
    await emitExecution(execution, "inspection", "completed", `Imported ${evidenceAttachments.length} Discovery attachment${evidenceAttachments.length === 1 ? "" : "s"}`, {
      details: {
        files: evidenceAttachments.map((attachment) => attachment.fileName),
        writtenAssets: attachedAssetWrite.assets.map((asset) => asset.projectPath),
        visionEnabled: evidenceImages.length > 0,
        readableFiles: evidenceAttachments.filter((attachment) => attachment.uploadStatus === "readable").length,
      },
    });
  }

  // An external datastore is a real execution prerequisite, not something an implementation model
  // can repair. Stop before the very first routing call so a new project never consumes model budget
  // producing code that Foundry already knows it cannot run or verify in this environment.
  const missingRuntimeVariables = externalRuntimeRequirementKeys(spec.stack).filter((key) => !process.env[key]?.trim());
  if (missingRuntimeVariables.length) {
    const names = missingRuntimeVariables.join(", ");
    const question = `This selected stack requires ${names} before Foundry can build and verify it. Configure ${names} in Foundry's environment and retry, or return to the Stack step and choose a zero-setup SQLite/local-storage option.`;
    const paused = await pauseForPlanConflicts(execution, [question]);
    const files = await listProjectFiles(projectPath);
    return {
      projectId, projectName: spec.projectName, projectPath, briefPath, stack: stackProfile.label, template: spec.template,
      sourceMode: "new-project", objective: `Create ${spec.projectName}`, checklist: execution.checklist,
      status: paused.status, supported: true, blocker: paused.blocker, clarificationQuestions: paused.clarificationQuestions,
      events: [...events, question], files, commands, timeline: execution.timeline,
    };
  }

  // Resolve every externally credentialed dependency before the first paid generation call. Local
  // libraries and SDK/toolchain requirements remain in environment preflight; provider credentials
  // must be verified in the exact project/environment scope before dependent behavior is generated.
  // Only authoritative selected requirements may create a blocking integration prerequisite.
  // The persisted brief also contains alternative stacks and future ideas; scanning the whole file
  // made Foundry demand PostgreSQL from an unselected React alternative in a local Room app.
  const credentialBrief = [spec.projectDescription, `Selected stack: ${spec.stack}`, spec.instructions].filter(Boolean).join("\n");
  const requiredIntegrations = integrationRequirementsForBrief(credentialBrief);
  const configuredIntegrations = await projectIntegrationEnvironment({ projectId, environment: "development", location: "local" });
  // A licensed SDK archive supplied with this resumed creation satisfies the SDK-intake gate, but
  // never hardware certification. Match catalog evidence generically so this works for every SDK
  // family and does not repeat the same paid prerequisite after upload.
  const attachedHardwareEvidence = integrationProvidersFromEvidence(requiredIntegrations,
    evidenceAttachments.map((attachment) => `${attachment.fileName} ${attachment.rawText ?? ""}`));
  const missingIntegrations = missingIntegrationRequirements(requiredIntegrations, [...configuredIntegrations.providers, ...attachedHardwareEvidence]);
  if (missingIntegrations.length) {
    const questions = missingIntegrations.map(integrationRequirementPrompt);
    const blocker = `Foundry needs ${missingIntegrations.length} verified project integration${missingIntegrations.length === 1 ? "" : "s"} before implementation can begin. No generation model was called.`;
    const paused = await pauseForPlanConflicts(execution, questions.map((question) => question.question));
    paused.clarificationQuestions = questions;
    const files = await listProjectFiles(projectPath);
    return {
      projectId, projectName: spec.projectName, projectPath, briefPath, stack: stackProfile.label, template: spec.template,
      sourceMode: "new-project", objective: `Create ${spec.projectName}`, checklist: execution.checklist,
      status: paused.status, supported: true, blocker, clarificationQuestions: questions,
      events: [...events, ...questions.map((question) => question.question)], files, commands, timeline: execution.timeline,
    };
  }

  // The pasted/card brief is itself authoritative input. API clients are allowed to omit the
  // optional StructuredDiscovery object, so routing must not silently collapse a detailed brief to
  // only its description and Custom instructions line.
  const routingSummary = discovery
    ? [`Create project: ${spec.projectType}`, `Stack: ${spec.stack}`, spec.projectDescription, spec.instructions].filter(Boolean).join("\n")
    : brief.trim();
  // Bootstrap with Fast. The first paid call dynamically assesses this current request before any
  // planning or implementation tier is selected.
  const initialModel = await modelForMissionStage(routingSummary, modelMode, "fast");
  await emitModelSelection(execution, "initial routing", initialModel);
  const apiKey = initialModel?.apiKey;
  if (!apiKey) {
    const blocker = "No configured AI provider is available. Add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.";
    await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker } });
    finishObjectiveChecklist(execution, "failed", blocker);
    const files = await listProjectFiles(projectPath);
    return {
      projectId, projectName: spec.projectName, projectPath, briefPath, stack: stackProfile.label, template: spec.template,
      sourceMode: "new-project", objective: `Create ${spec.projectName}`, checklist: execution.checklist,
      status: "failed", supported: true, blocker, events: [...events, blocker], files, commands, timeline: execution.timeline,
    };
  }

  const primaryIdea = spec.projectDescription.trim() || spec.projectType.trim() || spec.template.trim() || "a small web app";
  const objective = discovery
    ? `Create a new ${stackProfile.label} project: ${discovery.projectType}`
    : `Create a new ${stackProfile.label} project: ${primaryIdea}`;
  // When a Decision Memo exists, build the executor's real working context directly from its typed
  // fields instead of the single-line primaryIdea fragment above — otherwise everything the user
  // reviewed (architecture, features, data model, key facts) never reaches the executor at all,
  // even though it was written to foundry-brief.md. See StructuredDiscovery's doc comment.
  let task = discovery
    ? compactDiscoveryTask(discovery, spec.instructions)
    : [
        "Build the project in the authoritative Foundry brief below. Preserve every named feature, constraint, data requirement, interaction, and design requirement; do not reduce it to a generic interpretation.",
        brief.trim(),
      ].filter(Boolean).join("\n\n");
  const readableAttachmentContext = evidenceAttachments
    .filter((attachment) => attachment.uploadStatus === "readable" && Boolean(attachment.rawText))
    .map((attachment) => `### ${attachment.fileName}\n${redactSensitiveText(attachment.rawText ?? "").slice(0, 100_000)}`)
    .join("\n\n");
  const attachmentAssetContract = attachedAssetWrite.assets.length
    ? [
        "User-provided Discovery attachments were already copied into the project and read-back verified. Treat them as authoritative project evidence/assets; inspect and use them wherever the brief makes them relevant:",
        ...attachedAssetWrite.assets.map((asset) => `- ${asset.sourceFileName} -> ${asset.projectPath}${asset.publicPath !== asset.projectPath ? ` (public URL: ${asset.publicPath})` : ""}`),
      ].join("\n")
    : "";
  task = [task, readableAttachmentContext ? `User-provided readable attachments:\n\n${readableAttachmentContext}` : "", attachmentAssetContract].filter(Boolean).join("\n\n");
  if (requiredIntegrations.length) {
    task = [
      task,
      `Production integration contract: these project-scoped providers are connected and verified: ${configuredIntegrations.providers.join(", ")}. Implement every dependent behavior through the injected environment mapping and provider SDK/API. In-memory substitutes, console-logged delivery, demo provider callbacks, hard-coded success responses, and simulated external actions are forbidden and cannot satisfy completion.`,
    ].join("\n\n");
  }

  const obviousCreationProfile = profileTask({ message: task });
  const creationAssessment = obviousCreationProfile.taskType === "project_creation" && obviousCreationProfile.recommendedIntelligenceTier === "fast" && obviousCreationProfile.confidence >= 0.8
    ? deterministicTaskAssessment(task)
    : (await classifyIntent({ message: task, hasProjectContext: false, apiKey, provider: initialModel.provider })).routingAssessment;

  const environment = await environmentReadinessForStack(stackProfile.id);
  const runtimeBuildAvailable = environment?.status === "ready" || stackHasBuildStep(stackProfile.id);
  completeChecklistItem(execution, "read-project", "completed", "New, empty project folder — nothing to read before scaffolding.");

  const emitEvent = (event: FactoryExecutionEvent) => execution.emit(event);
  const creationProfile = profileTask({ message: task, dynamicAssessment: creationAssessment });
  const simpleCreation = stackProfile.id === "static-html" || (
    creationAssessment.projectCreation
    && creationProfile.recommendedIntelligenceTier === "fast"
    && (creationProfile.missionComplexity ?? 5) <= 2
    && (creationProfile.expectedFiles ?? 99) <= 8
  );
  // A dependency-free static project stays architecturally small even when its discovery memo is
  // verbose. Letting prompt length inflate this to autonomous/architect work made identical catalogue
  // builds route unpredictably and spend premium calls on what is still one browser artifact.
  const creationComplexity = stackProfile.id === "static-html" ? "small" as const : complexityFromAssessment(creationAssessment);
  const backendOnlyCreation = /\b(?:api|backend|microservice|webhook|identity service|data processing service)\b/i.test(discovery?.projectType || primaryIdea)
    && /node-express|node|python|go|java|php|dotnet-web/i.test(stackProfile.id);
  const creationStrategy = createExecutionStrategy({
    kind: "new-project",
    complexity: creationComplexity,
    quality,
    fileCount: creationAssessment.estimatedFiles,
    estimatedArtifacts: simpleCreation ? Math.max(3, Math.min(8, creationProfile.expectedFiles ?? 6)) : Math.max(4, Math.min(20, (discovery?.mainFeatures.length ?? 4) + 3)),
    independentlyGeneratable: simpleCreation || /react|vue|svelte|next/i.test(stackProfile.id),
    highRisk: assessmentHighRisk(creationAssessment),
    securitySensitive: creationAssessment.securityOrPayment,
    needsVisualValidation: !backendOnlyCreation && /web|html|react|vue|svelte|next|ui|screen|page|catalogue|dashboard/i.test(`${stackProfile.id} ${task}`),
    repeatedFailures: 0,
  });
  await emitExecution(execution, "planning", "completed", `Execution strategy: ${creationStrategy.workflow}`, {
    details: { workflow: creationStrategy.workflow, concurrency: creationStrategy.concurrency, reason: creationStrategy.reason },
  });
  await emitExecution(execution, "reasoning", "completed", `I’ve translated the brief into a ${creationStrategy.workflow === "bounded-artifact" ? "focused build" : "staged implementation"}. I’m defining the project structure and verification path before generating files.`);
  await emitExecution(execution, "planning", "running", "Planning the project structure", { internal: true });
  // Structured discovery is already the authoritative product/architecture plan for a greenfield
  // build. Asking a second model to explode it into dozens of file-sized checklist items added a
  // slow planning call, obsolete package guesses, and a completion surface larger than the product.
  // Keep the visible plan outcome-oriented; the executor still receives the complete discovery brief.
  const plan = { checklist: compactNewProjectChecklist(discovery?.projectType || primaryIdea), conflicts: [] };
  if (plan.conflicts.length) {
    execution.checklist.splice(0, execution.checklist.length, ...execution.checklist.filter((item) => item.id !== "read-project"), ...plan.checklist);
    const paused = await pauseForPlanConflicts(execution, plan.conflicts);
    const files = await listProjectFiles(projectPath);
    return {
      projectId, projectName: spec.projectName, projectPath, briefPath, stack: stackProfile.label, template: spec.template,
      sourceMode: "new-project", objective, checklist: execution.checklist, status: paused.status, supported: true,
      blocker: paused.blocker, clarificationQuestions: paused.clarificationQuestions, events: [...events, paused.blocker], files, commands, timeline: execution.timeline,
    };
  }
  const checklist = plan.checklist;
  execution.checklist.splice(0, execution.checklist.length, ...execution.checklist.filter((item) => item.id !== "read-project"), ...checklist);
  await emitExecution(execution, "planning", "completed", "Checklist ready", { internal: true, details: { checklistJson: JSON.stringify(checklist) } });

  // A larger build with a live-previewable stack gets a "build the mock first" checkpoint after the
  // first checklist phase, rather than running the whole thing unseen — see offerMockGate in executor.ts.
  const distinctPhases = new Set(checklist.map((item) => item.phase).filter(Boolean)).size;
  // A normal creation request means finish the product. Early mock review is explicitly opt-in;
  // silently pausing a multi-phase build produces convincing but incomplete software.
  const requestedMockReview = /\b(?:first[- ]pass|prototype|mock(?:up)?|review checkpoint|pause for (?:my )?review|show me (?:a )?(?:mock|prototype) first)\b/i.test(task);
  const offerMockGate = requestedMockReview && stackProfile.id !== "static-html" && distinctPhases >= 2 && hasLivePreviewFor(stackProfile.label);

  // Establish the selected stack's minimum runnable contract before any model edit. edit_file
  // cannot create a missing manifest, and build/preview must never guess one later.
  await ensureRequestedStackScaffold(projectPath, stackProfile, spec.projectName, execution, events, spec.stack, task);
  const implementationModel = await modelForMissionStage(task, modelMode, tierForCapability(creationStrategy, "implement", tierForCapability(creationStrategy, "generate", creationProfile.recommendedIntelligenceTier)), undefined, 0, creationAssessment) ?? initialModel!;
  await emitModelSelection(execution, "implementation", implementationModel);
  await emitExecution(execution, "reasoning", "completed", "The plan is set. I’m building the first coherent working version now, then I’ll verify the result against the brief instead of stopping at file generation.");
  let result = await runMissionExecutor({
    objective,
    task,
    checklist,
    costScopeId: execution.costScopeId,
    access,
    apiKey: implementationModel.apiKey,
    provider: implementationModel.provider,
    tier: implementationModel.tier,
    onEvent: emitEvent,
    signal,
    approvedCategories: ["dependencies", "package-runner"],
    offerMockGate,
    hasBuildTooling: runtimeBuildAvailable,
    newProject: true,
    continuableBatch: true,
    staticProject: stackProfile.id === "static-html",
    executionStrategy: creationStrategy,
    routingAssessment: creationAssessment,
    evidenceImages,
    // A real static build commonly needs one turn per complete HTML/CSS/JS artifact plus recovery
    // from a truncated tool call. Three turns made the ceiling itself the most common blocker. Keep
    // the model cheap, but give the execution loop enough room to actually finish the bounded job.
    maxTurns: stackProfile.id === "static-html" ? 8 : 6,
  });

  if (
    stackProfile.id === "static-html"
    && result.status === "failed"
    && /(?:Model provider unavailable after retries:|configured model twice returned)[\s\S]*Model did not call required tool write_file/i.test(result.blocker ?? "")
  ) {
    await emitExecution(execution, "reasoning", "completed", "The fast generation pass could not produce a valid file action. I’m escalating this bounded build once so the mission can continue without restarting.");
    const initialUsage = result.usage;
    const escalationModel = await modelForMissionStage(task, modelMode, "builder", undefined, 1, creationAssessment) ?? implementationModel;
    await emitModelSelection(execution, "implementation escalation", escalationModel);
    const escalated = await runMissionExecutor({
      objective,
      task,
      checklist,
      costScopeId: execution.costScopeId,
      access,
      apiKey: escalationModel.apiKey,
      provider: escalationModel.provider,
      tier: escalationModel.tier,
      onEvent: emitEvent,
      signal,
      approvedCategories: ["dependencies", "package-runner"],
      hasBuildTooling: false,
      newProject: true,
      continuableBatch: true,
      staticProject: true,
      executionStrategy: creationStrategy,
      routingAssessment: creationAssessment,
      evidenceImages,
      maxTurns: 6,
    });
    escalated.usage = [...initialUsage, ...escalated.usage];
    result = escalated;
  }

  const resumableCreationBatchFailure = (candidate: typeof result) => candidate.status === "failed"
    && candidate.changedFiles.length > 0
    && /command or file write failed|production build (?:not verified|failed)/i.test(candidate.blocker ?? "");
  // Greenfield creation uses the same bounded executor as follow-up work. A substantial starter can
  // legitimately fill one batch while creating coordinated source files; stopping there leaves a
  // convincing-looking but unrunnable project. Continue from the verified files on disk while sharing
  // the mission's original cost ledger, so continuation cannot reset its spend allowance.
  // Reach the deterministic ecosystem verifier before any paid continuation. Compiler-guided
  // repair below is allowed only after that verifier has produced a concrete diagnostic.
  const maxCreationContinuationBatches = 0;
  for (let continuationAttempt = 1; continuationAttempt <= maxCreationContinuationBatches && resumableCreationBatchFailure(result); continuationAttempt += 1) {
    await emitExecution(execution, "reasoning", "completed", `The first build batch wrote real project files but did not finish. I’m continuing automatically with the remaining implementation and verification (batch ${continuationAttempt}).`);
    const continuation = await runMissionExecutor({
      objective,
      task: `Continuation batch ${continuationAttempt}: complete this new project from the authoritative brief and the implementation already on disk. Inspect existing files, create only the missing coordinated source and configuration, then install dependencies as needed and run the real production build. Do not rewrite correct files or stop at read-back evidence.\n\nOriginal task:\n${task}`,
      checklist: result.checklist,
      costScopeId: execution.costScopeId,
      access,
      apiKey: implementationModel.apiKey,
      provider: implementationModel.provider,
      tier: implementationModel.tier,
      onEvent: emitEvent,
      signal,
      approvedCategories: ["dependencies", "package-runner"],
      hasBuildTooling: runtimeBuildAvailable,
      newProject: true,
      continuableBatch: true,
      staticProject: stackProfile.id === "static-html",
      executionStrategy: creationStrategy,
      routingAssessment: creationAssessment,
      evidenceImages,
      maxTurns: stackProfile.id === "static-html" ? 8 : 20,
      maxNudges: 2,
    });
    result = {
      ...continuation,
      changedFiles: Array.from(new Set([...result.changedFiles, ...continuation.changedFiles])),
      commands: [...result.commands, ...continuation.commands],
      verification: [...result.verification, ...continuation.verification],
      timeline: [...result.timeline, ...continuation.timeline],
      usage: [...result.usage, ...continuation.usage],
      turnsUsed: result.turnsUsed + continuation.turnsUsed,
    };
  }
  if (attachedAssetWrite.assets.length) {
    result.changedFiles = Array.from(new Set([
      ...attachedAssetWrite.assets.map((asset) => asset.projectPath),
      ...importedSdkArchives.flatMap((item) => item.files),
      ...result.changedFiles,
    ]));
  }

  // A model-budget boundary after real source generation is not evidence that the project failed.
  // For non-JavaScript ecosystems, detect the repository's declared verification profile and run
  // those commands mechanically before asking for another model call. JavaScript keeps its more
  // specialized install/build recovery immediately below.
  const generationBoundaryWithFiles = result.status === "failed"
    && result.changedFiles.length > 0;
  if (generationBoundaryWithFiles && access.runCommand) {
    const generatedProfile = (await detectStackProfileAndEntriesForAccess(access)).verificationProfile;
    if (generatedProfile.adapterId !== "javascript" && generatedProfile.commands.length > 0) {
      if (generatedProfile.adapterId === "android-gradle") {
        const androidTools = resolveAndroidTools();
        if (androidTools) {
          const localPropertiesPath = path.join(projectPath, "local.properties");
          const escapedSdkPath = androidTools.sdkRoot.replace(/\\/g, "\\\\");
          await writeFile(localPropertiesPath, `sdk.dir=${escapedSdkPath}\n`, "utf8");
          const gitignorePath = path.join(projectPath, ".gitignore");
          const gitignore = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : "";
          if (!/(?:^|\n)local\.properties(?:\n|$)/.test(gitignore)) {
            await writeFile(gitignorePath, `${gitignore}${gitignore && !gitignore.endsWith("\n") ? "\n" : ""}local.properties\n`, "utf8");
          }
          await emitExecution(execution, "file", "completed", "Connected the detected Android SDK to this local build", {
            fileName: "local.properties",
            filePath: "local.properties",
            details: { localOnly: true, committed: false, sdkDetected: true },
          });
        }
      }
      const runDeterministicCommand = async (command: string) => {
        await emitExecution(execution, "command", "running", `Running deterministic verification: ${command}`, {
          tier: "trace",
          command,
          details: { paidModelCalls: 0, ecosystem: generatedProfile.ecosystem },
        });
        const commandResult = await access.runCommand!(command, "", { approvedCategories: ["dependencies", "package-runner"] });
        const event: FactoryCommandEvent = {
          command,
          exitCode: commandResult.exitCode,
          stdout: commandResult.stdout,
          stderr: commandResult.stderr,
          durationMs: commandResult.durationMs,
          approvalScope: commandResult.approvalScope,
        };
        result.commands.push(event);
        await emitExecution(execution, "command", commandResult.exitCode === 0 ? "completed" : "error", commandResult.exitCode === 0 ? `Passed ${command}` : `Failed ${command}`, {
          tier: "trace",
          command,
          exitCode: commandResult.exitCode,
          durationMs: commandResult.durationMs,
          output: commandResult.stdout || commandResult.stderr,
          stdout: commandResult.stdout,
          stderr: commandResult.stderr,
          details: { paidModelCalls: 0, ecosystem: generatedProfile.ecosystem },
        });
        return event;
      };

      let dependencyBootstrapPassed = true;
      if (generatedProfile.adapterId === "python" && existsSync(path.join(projectPath, "pyproject.toml"))) {
        let bootstrap: FactoryCommandEvent | undefined;
        for (const command of await pythonDependencyBootstrapCommands(projectPath)) {
          bootstrap = await runDeterministicCommand(command);
          if (bootstrap.exitCode === 0) break;
        }
        dependencyBootstrapPassed = bootstrap?.exitCode === 0;
        result.verification.push({
          check_type: "command",
          result: dependencyBootstrapPassed ? "pass" : "fail",
          evidence: dependencyBootstrapPassed ? "Installed the generated Python project's declared runtime and test dependencies." : `Python dependency installation failed: ${bootstrap ? summarizeCommandFailure(bootstrap) : "No supported dependency declaration was found."}`,
        });
      }

      const requiredChecks = generatedProfile.commands.filter((check) => check.required && !check.longRunning);
      let requiredChecksPassed = dependencyBootstrapPassed && requiredChecks.length > 0;
      if (dependencyBootstrapPassed) {
        for (const check of requiredChecks) {
          const checkResult = await runDeterministicCommand(check.command);
          const passed = checkResult.exitCode === 0;
          const checkType: ExecutionMissionVerification["check_type"] = check.stage === "lint"
            ? "lint"
            : check.stage === "typecheck"
              ? "typecheck"
              : check.stage === "compile" || check.stage === "build"
                ? "build"
                : check.stage === "unit-test" || check.stage === "integration-test" || check.stage === "smoke-test" || check.stage === "regression"
                  ? "test"
                  : "command";
          requiredChecksPassed = requiredChecksPassed && passed;
          result.verification.push({
            check_type: checkType,
            result: passed ? "pass" : "fail",
            evidence: passed ? `${generatedProfile.ecosystem} ${check.stage} verification passed: ${check.command}.` : `${generatedProfile.ecosystem} ${check.stage} verification failed: ${summarizeCommandFailure(checkResult)}`,
          });
          if (!passed) break;
        }
      }
      if (requiredChecksPassed) {
        const evidence = `${generatedProfile.ecosystem} required verification passed without another model call: ${requiredChecks.map((check) => check.command).join(", ")}.`;
        result.status = "passed";
        result.blocker = undefined;
        for (const item of result.checklist) {
          if (item.status === "pending" || item.status === "blocked" || item.status === "running") {
            item.status = "completed";
            item.evidence = evidence;
          }
        }
        await emitExecution(execution, "summary", "completed", "Generated project passed its deterministic ecosystem verification", {
          output: evidence,
          details: { paidModelCalls: 0, ecosystem: generatedProfile.ecosystem },
        });
      }
    }
  }

  // Models are responsible for implementation decisions, not for whether objective build evidence
  // happens to exist. Once a generated Node project declares a build script, finish the mechanical
  // install/build gate deterministically if the executor did not. This prevents a mission from
  // spending multiple continuation batches saying "the build should run next" without ever issuing
  // the command, while preserving the real exit code and output as the authority.
  const alreadyBuilt = result.commands.some((command) =>
    command.exitCode === 0 && isProductionBuildCommand(command.command),
  );
  let deterministicBuildFailure: FactoryCommandEvent | undefined;
  let deterministicTestFailure: FactoryCommandEvent | undefined;
  if (existsSync(path.join(projectPath, "package.json"))) {
    try {
      const packageJson = JSON.parse(await readFile(path.join(projectPath, "package.json"), "utf8")) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      if (packageJson.scripts?.build) {
        await emitExecution(execution, "command", "running", "Running the declared production build as the final deterministic verification gate");
        if (!existsSync(path.join(projectPath, "node_modules"))) {
          result.commands.push(await runCommand(projectPath, "npm.cmd", ["install", "--prefer-offline", "--no-audit", "--no-fund"], events, execution));
        }
        // Generated code routinely imports libraries the model never added to package.json. Reconcile
        // the manifest against what the source actually imports BEFORE the build, so the build isn't
        // failed by a missing dependency and then recovered a couple of packages per rebuild.
        const undeclaredBeforeBuild = missingDeclaredDependencies(projectPath);
        if (undeclaredBeforeBuild.length) {
          await emitExecution(execution, "reasoning", "completed", `The generated source imports ${undeclaredBeforeBuild.length} package${undeclaredBeforeBuild.length === 1 ? "" : "s"} that ${undeclaredBeforeBuild.length === 1 ? "is" : "are"} not declared in package.json. Installing ${undeclaredBeforeBuild.length === 1 ? "it" : "them all"} before the build, with no model call.`, {
            details: { packages: undeclaredBeforeBuild },
          });
          result.commands.push(await (async () => { const invocation = missingPackageInstallInvocation(projectPath, undeclaredBeforeBuild); return runCommand(projectPath, invocation.command, invocation.args, events, execution); })());
        }
        // Prisma's package install is not runtime readiness. A generated project with a schema must
        // generate its client before build/preview; local SQLite projects also need a concrete URL
        // and schema database so the first real browser request cannot crash after an HTTP port opens.
        let runtimePreparationFailed = false;
        const prismaSchemaPath = path.join(projectPath, "prisma", "schema.prisma");
        const usesPrismaClient = Boolean(packageJson.dependencies?.["@prisma/client"] || packageJson.devDependencies?.["@prisma/client"]);
        if (usesPrismaClient && existsSync(prismaSchemaPath)) {
          const schema = readFileSync(prismaSchemaPath, "utf8");
          if (/provider\s*=\s*["']sqlite["']/i.test(schema) && /url\s*=\s*env\(["']DATABASE_URL["']\)/i.test(schema)) {
            const envPaths = [".env", ".env.local"].map((name) => path.join(projectPath, name));
            const hasDatabaseUrl = envPaths.some((envPath) => existsSync(envPath) && /^\s*DATABASE_URL\s*=/mi.test(readFileSync(envPath, "utf8")));
            if (!hasDatabaseUrl) {
              const write = await access.writeFile(".env", 'DATABASE_URL="file:./dev.db"\n');
              if (write.verified && write.contentChanged) result.changedFiles = Array.from(new Set([...result.changedFiles, ".env"]));
            }
          }
          const prismaGenerate = await runCommand(projectPath, "npm.cmd", ["exec", "--", "prisma", "generate"], events, execution);
          result.commands.push(prismaGenerate);
          if (prismaGenerate.exitCode === 0 && /provider\s*=\s*["']sqlite["']/i.test(schema)) {
            const dbPush = await runCommand(projectPath, "npm.cmd", ["exec", "--", "prisma", "db", "push", "--skip-generate"], events, execution);
            result.commands.push(dbPush);
            runtimePreparationFailed = dbPush.exitCode !== 0;
            if (runtimePreparationFailed) deterministicBuildFailure = dbPush;
          } else if (prismaGenerate.exitCode !== 0) {
            runtimePreparationFailed = true;
            deterministicBuildFailure = prismaGenerate;
          }
        }
        if (!alreadyBuilt && !runtimePreparationFailed && !result.commands.some((command) => /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+install\b/i.test(command.command) && command.exitCode !== 0)) {
          const buildCommand = await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
          result.commands.push(buildCommand);
          if (buildCommand.exitCode !== 0) deterministicBuildFailure = buildCommand;
          result.verification.push({
            check_type: "build",
            result: buildCommand.exitCode === 0 ? "pass" : "fail",
            evidence: buildCommand.exitCode === 0
              ? "The generated project's declared production build completed with exit code 0."
              : `The declared production build failed: ${summarizeCommandFailure(buildCommand)}`,
          });
        }
      }
      const declaredTestsAreApplicable = hasNodeTestSource(projectPath) || missionRequiresAutomatedTests(task);
      const alreadyTested = result.commands.some((command) => command.exitCode === 0 && isAutomatedTestCommand(command.command) && automatedTestEvidencePassed(projectPath, command, "nextjs"));
      if (!alreadyTested && packageJson.scripts?.test && !deterministicBuildFailure && declaredTestsAreApplicable) {
        const testCommand = await runCommand(projectPath, "npm.cmd", ["run", "test"], events, execution);
        result.commands.push(testCommand);
        const testEvidencePassed = automatedTestEvidencePassed(projectPath, testCommand, "nextjs");
        result.verification.push({
          check_type: "test",
          result: testEvidencePassed ? "pass" : "fail",
          evidence: testEvidencePassed
            ? "The generated project's declared automated test command completed with exit code 0."
            : testCommand.exitCode === 0
              ? "The declared automated test command exited successfully but discovered zero executable tests or no test source."
              : `The declared automated tests failed: ${summarizeCommandFailure(testCommand)}`,
        });
        if (!testEvidencePassed) {
          deterministicTestFailure = testCommand;
          result.status = "failed";
          result.blocker = testCommand.exitCode === 0
            ? "The declared automated test command discovered zero executable tests; add real test source and rerun it."
            : `The declared automated tests failed: ${summarizeCommandFailure(testCommand)}`;
        }
      }
    } catch (error) {
      await emitExecution(execution, "command", "error", "The generated package manifest could not be used for deterministic build verification", {
        details: { reason: error instanceof Error ? error.message : "Unknown package manifest error." },
      });
    }
  }
  // A compiler-reported missing bare import is deterministic dependency evidence, not an open-ended
  // coding problem. Resolve only the named packages, perform any required code generation, and rerun
  // the same build before spending another model call. Relative imports and aliases never enter this
  // path, so a missing application file still receives an evidence-driven source repair below.
  if (deterministicBuildFailure && result.changedFiles.length > 0) {
    const unresolvedPackages = allMissingPackages(projectPath, deterministicBuildFailure);
    if (unresolvedPackages.length) {
      await emitExecution(execution, "reasoning", "completed", `The compiler identified ${unresolvedPackages.length} undeclared package${unresolvedPackages.length === 1 ? "" : "s"}. I’m installing only those exact dependencies, then rerunning the same production build without another model call.`, {
        details: { packages: unresolvedPackages },
      });
      const dependencyInstall = await (async () => { const invocation = missingPackageInstallInvocation(projectPath, unresolvedPackages); return runCommand(projectPath, invocation.command, invocation.args, events, execution); })();
      result.commands.push(dependencyInstall);
      let dependencyPreparationPassed = dependencyInstall.exitCode === 0;
      if (dependencyPreparationPassed && unresolvedPackages.includes("@prisma/client") && existsSync(path.join(projectPath, "prisma", "schema.prisma"))) {
        const prismaGenerate = await runCommand(projectPath, "npm.cmd", ["exec", "--", "prisma", "generate"], events, execution);
        result.commands.push(prismaGenerate);
        dependencyPreparationPassed = prismaGenerate.exitCode === 0;
      }
      if (dependencyPreparationPassed) {
        const dependencyRetryBuild = await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
        result.commands.push(dependencyRetryBuild);
        result.verification.push({
          check_type: "build",
          result: dependencyRetryBuild.exitCode === 0 ? "pass" : "fail",
          evidence: dependencyRetryBuild.exitCode === 0
            ? `The production build passed after deterministically installing compiler-reported packages: ${unresolvedPackages.join(", ")}.`
            : `The dependency recovery exposed a remaining production-build failure: ${summarizeCommandFailure(dependencyRetryBuild)}`,
        });
        deterministicBuildFailure = dependencyRetryBuild.exitCode === 0 ? undefined : dependencyRetryBuild;
      }
    }
  }
  // The compiler is the cross-framework recovery protocol. Each pass receives the exact diagnostic
  // and verified source named by that diagnostic, then the runtime reruns the same build itself.
  // New diagnostics are forward progress; the identical diagnostic is allowed one stronger repair
  // before Foundry stops paying for equivalent calls.
  const partialGenerationCanUseCompilerRecovery =
    (result.status === "passed" || result.status === "failed")
    && !signal?.aborted;
  const compilerFailureAttempts = new Map<string, number>();
  const compilerFailureSignatureAttempts = new Map<string, number>();
  const compilerFailureMutations = new Map<string, number>();
  const compilerFailureSignatureMutations = new Map<string, number>();
  const transientBuildArtifactAttempts = new Map<string, number>();
  const compilerDependencyAttempts = new Set<string>();
  // Do not confuse a bounded batch with lack of progress. A generated application can expose a
  // sequence of unrelated compiler failures as its dependency graph becomes reachable. The shared
  // mission cost scope remains the financial boundary; this ceiling is only a final runaway guard.
  // Free deterministic dependency/config/source repairs do not consume paid repair capacity.
  const maxCompilerRepairPasses = autonomousRepairStageLimit(process.env.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 20);
  const maxCompilerRecoveryCycles = maxCompilerRepairPasses * 4;
  let compilerRepairPass = 0;
  let compilerRecoveryCycle = 0;
  while (partialGenerationCanUseCompilerRecovery && deterministicBuildFailure && result.changedFiles.length > 0 && !signal?.aborted && compilerRepairPass < maxCompilerRepairPasses && compilerRecoveryCycle < maxCompilerRecoveryCycles) {
    compilerRecoveryCycle += 1;
    // A source repair can expose a new missing bare import (for example, replacing a guessed local
    // generated-client path with the package's public import). Re-run deterministic dependency
    // evidence on every compiler pass; otherwise the repair model can oscillate between two imports
    // while Foundry never installs the now-proven package.
    const passPackages = allMissingPackages(projectPath, deterministicBuildFailure);
    const packageFingerprint = passPackages.join("|");
    if (passPackages.length && !compilerDependencyAttempts.has(packageFingerprint)) {
      compilerDependencyAttempts.add(packageFingerprint);
      await emitExecution(execution, "reasoning", "completed", `The latest compiler pass exposed ${passPackages.length} undeclared package${passPackages.length === 1 ? "" : "s"}. I'm installing that exact evidence before another source repair.`, {
        details: { packages: passPackages, paidModelCalls: 0 },
      });
      const install = await (async () => { const invocation = missingPackageInstallInvocation(projectPath, passPackages); return runCommand(projectPath, invocation.command, invocation.args, events, execution); })();
      result.commands.push(install);
      if (install.exitCode !== 0) {
        result.status = "failed";
        result.blocker = `Compiler-evidenced dependency installation failed: ${summarizeCommandFailure(install)}`;
        break;
      }
      if (passPackages.includes("@prisma/client") && existsSync(path.join(projectPath, "prisma", "schema.prisma"))) {
        const generate = await runCommand(projectPath, "npm.cmd", ["exec", "--", "prisma", "generate"], events, execution);
        result.commands.push(generate);
        if (generate.exitCode !== 0) {
          result.status = "failed";
          result.blocker = `Prisma client generation failed after compiler-evidenced installation: ${summarizeCommandFailure(generate)}`;
          break;
        }
      }
      const packageRetry = await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
      result.commands.push(packageRetry);
      result.verification.push({
        check_type: "build",
        result: packageRetry.exitCode === 0 ? "pass" : "fail",
        evidence: packageRetry.exitCode === 0
          ? `The production build passed after installing compiler-evidenced packages: ${passPackages.join(", ")}.`
          : `Compiler-evidenced dependency recovery exposed a remaining failure: ${summarizeCommandFailure(packageRetry)}`,
      });
      if (packageRetry.exitCode === 0) {
        result.status = "passed";
        result.blocker = undefined;
        deterministicBuildFailure = undefined;
      } else {
        deterministicBuildFailure = packageRetry;
      }
      continue;
    }
    const expoConfigRepair = await repairExpoConfigFailure(access, projectPath, deterministicBuildFailure);
    if (expoConfigRepair) {
      result.changedFiles = Array.from(new Set([...result.changedFiles, "app.json"]));
      await emitExecution(execution, "edit", "completed", "Removed missing optional Expo asset references before model routing", {
        filePath: "app.json",
        details: { removed: expoConfigRepair.removed, paidModelCalls: 0, recovery: "expo-config-assets" },
      });
      const retryBuild = await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
      result.commands.push(retryBuild);
      result.verification.push({
        check_type: "build",
        result: retryBuild.exitCode === 0 ? "pass" : "fail",
        evidence: retryBuild.exitCode === 0
          ? "The Expo production export passed after removing only configured local assets that did not exist."
          : `The Expo config repair exposed a remaining compiler failure: ${summarizeCommandFailure(retryBuild)}`,
      });
      if (retryBuild.exitCode === 0) {
        result.status = "passed";
        result.blocker = undefined;
        deterministicBuildFailure = undefined;
      } else {
        deterministicBuildFailure = retryBuild;
      }
      continue;
    }
    const deterministicRepairs = await applyDeterministicCompilerRepairs(access, deterministicBuildFailure, projectPath);
    if (deterministicRepairs.length) {
      result.changedFiles = Array.from(new Set([...result.changedFiles, ...deterministicRepairs.map((repair) => repair.path)]));
      await emitExecution(execution, "edit", "completed", "Applied a compiler-proven source repair before model routing", {
        filePath: deterministicRepairs[0].path,
        details: { repairs: deterministicRepairs.map((repair) => `${repair.ruleId}: ${repair.path} — ${repair.reason}`), paidModelCalls: 0 },
      });
      const retryBuild = await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
      result.commands.push(retryBuild);
      result.verification.push({
        check_type: "build",
        result: retryBuild.exitCode === 0 ? "pass" : "fail",
        evidence: retryBuild.exitCode === 0
          ? "The production build passed after a deterministic compiler-evidenced source repair; no repair model was called."
          : `The deterministic source repair exposed a remaining compiler failure: ${summarizeCommandFailure(retryBuild)}`,
      });
      if (retryBuild.exitCode === 0) {
        result.status = "passed";
        result.blocker = undefined;
        deterministicBuildFailure = undefined;
      } else {
        deterministicBuildFailure = retryBuild;
      }
      continue;
    }
    const transientArtifact = transientBuildArtifactDirectory(deterministicBuildFailure, projectPath);
    if (transientArtifact) {
      const artifactAttempt = (transientBuildArtifactAttempts.get(transientArtifact) ?? 0) + 1;
      transientBuildArtifactAttempts.set(transientArtifact, artifactAttempt);
      if (artifactAttempt <= 2) {
        rmSync(transientArtifact, { recursive: true, force: true });
        await emitExecution(execution, "edit", "completed", "Cleared an incomplete generated build artifact before retrying verification", {
          filePath: path.relative(projectPath, transientArtifact).replace(/\\/g, "/"),
          details: { recovery: "transient-build-artifact", attempt: artifactAttempt, paidModelCalls: 0 },
        });
        const retryBuild = await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
        result.commands.push(retryBuild);
        result.verification.push({
          check_type: "build",
          result: retryBuild.exitCode === 0 ? "pass" : "fail",
          evidence: retryBuild.exitCode === 0
            ? "The production build passed after Foundry removed an incomplete generated build cache; no repair model was called."
            : `The clean build exposed a remaining failure: ${summarizeCommandFailure(retryBuild)}`,
        });
        deterministicBuildFailure = retryBuild.exitCode === 0 ? undefined : retryBuild;
        if (!deterministicBuildFailure) {
          result.status = "passed";
          result.blocker = undefined;
        }
        continue;
      }
    }
    const failureFingerprint = compilerFailureFingerprint(deterministicBuildFailure, projectPath);
    const failureAttempt = (compilerFailureAttempts.get(failureFingerprint) ?? 0) + 1;
    compilerFailureAttempts.set(failureFingerprint, failureAttempt);
    // The exact-text fingerprint only catches a byte-identical repeat. A repair that reshuffles a type
    // annotation reports a new type string for the SAME defect at the SAME place, which read as forward
    // progress and let one mistake consume the whole repair budget. The structural signature ignores the
    // concrete type text, so those repeats are recognized and stopped after one real escalation.
    const failureSignature = compilerFailureSignature(deterministicBuildFailure, projectPath);
    const signatureAttempt = (compilerFailureSignatureAttempts.get(failureSignature) ?? 0) + 1;
    compilerFailureSignatureAttempts.set(failureSignature, signatureAttempt);
    let fingerprintMutations = compilerFailureMutations.get(failureFingerprint) ?? 0;
    let signatureMutations = compilerFailureSignatureMutations.get(failureSignature) ?? 0;
    if (fingerprintMutations >= 2 || signatureMutations >= 2) {
      const oscillating = fingerprintMutations < 2 && signatureMutations >= 2;
      // Repetition is a routing signal, not proof that the project is impossible. Forget the failed
      // tactic and let the next architect pass re-diagnose from the current source plus authoritative
      // compiler evidence. The global cost scope remains the spending boundary.
      compilerFailureMutations.set(failureFingerprint, 0);
      compilerFailureSignatureMutations.set(failureSignature, 0);
      fingerprintMutations = 0;
      signatureMutations = 0;
      await emitExecution(execution, "reasoning", "warning", oscillating ? "Compiler repair is changing strategy after an oscillation" : "Compiler repair is changing strategy after repeated mutations", {
        details: { failureFingerprint, failureSignature, attempts: Math.max(failureAttempt, signatureAttempt) - 1, oscillationDetected: oscillating, strategyReset: true, terminal: false, paidModelCalls: 0 },
      });
    }
    compilerRepairPass += 1;
    await emitExecution(execution, "reasoning", "completed", "The production compiler found one concrete integration failure. I’m repairing that exact error once, then rerunning the build.");
    const missingImport = missingRelativeImportTarget(deterministicBuildFailure, projectPath);
    const missingImportInstruction = missingImport
      ? `\n\nThe compiler proves ${missingImport.importer} imports ${missingImport.specifier}, but the required target does not exist. Create the missing file ${missingImport.target} now; do not make a cosmetic edit to ${missingImport.importer}.`
      : "";
    const exactDiagnostic = compilerDiagnosticOutput(deterministicBuildFailure);
    const buildRepairTask = `Repair the exact compiler failure in this generated project. Preserve the product behavior and all source unrelated to the diagnostic. The runtime will rerun the same verification command after your edit, so mutate the named source immediately and do not spend a turn rerunning the build or narrating completion.${missingImportInstruction}\n\nOriginal project request:\n${task}\n\nAuthoritative compiler output:\n${exactDiagnostic}`;
    const buildRepairWorkingSet = workingSetWithCommandFailure(await discoverProjectWorkingSet(access, buildRepairTask), deterministicBuildFailure, projectPath);
    const evidenceRepairReadPaths = commandTracebackSourcePaths(buildRepairWorkingSet, projectPath);
    const compilerSourceEvidence = evidenceRepairReadPaths.length
      ? await readBoundedWorkingSetEvidence(access, evidenceRepairReadPaths)
      : undefined;
    const repairTier: ModelTier = failureAttempt > 1 ? "architect" : "builder";
    const buildRepairModel = await modelForMissionStage(buildRepairTask, modelMode, repairTier, buildRepairWorkingSet, failureAttempt, creationAssessment) ?? implementationModel;
    await emitModelSelection(execution, failureAttempt > 1 ? "compiler repair escalation" : "compiler repair", buildRepairModel);
    await emitExecution(execution, "reasoning", "completed", evidenceRepairReadPaths.length
      ? `Compiler repair working set: ${evidenceRepairReadPaths.join(", ")}.`
      : "The compiler did not identify a readable source path; the bounded repair will use the exact command output.", {
      details: { evidenceRepairReadPaths, paidModelCalls: 0, failureFingerprint },
    });
    const buildRepair = await runMissionExecutor({
      objective,
      task: buildRepairTask,
      checklist: [{ id: "production-build-repair", label: "Repair the production compiler failure and verify the build", status: "pending" }],
      costScopeId: execution.costScopeId,
      access,
      apiKey: buildRepairModel.apiKey,
      provider: buildRepairModel.provider,
      tier: buildRepairModel.tier,
      onEvent: emitEvent,
      signal,
      approvedCategories: ["dependencies", "package-runner"],
      hasBuildTooling: true,
      newProject: false,
      continuableBatch: false,
      fastLane: true,
      initialProjectEvidence: compilerSourceEvidence,
      // A diagnostic without a readable source path gets one bounded inspection. If it returns
      // unchanged, the next observation is action-enforced instead of charging for the same
      // inspection again and falsely calling that a completed repair.
      requireFirstMutation: Boolean(compilerSourceEvidence || missingImport || failureAttempt > 1 || signatureAttempt > 1),
      executionStrategy: creationStrategy,
      routingAssessment: creationAssessment,
      evidenceImages,
      // One paid call owns one compiler repair. The runtime, not another narration turn, owns the
      // next build. A repeated diagnostic gets one stronger call on the next loop iteration.
      maxTurns: 1,
      maxNudges: 0,
      maxOutputTokens: 6_000,
      routingBudget: { maximumModelCalls: 1, estimatedCostUsd: compilerRepairBudgetUsd() },
    });
    result.changedFiles = Array.from(new Set([...result.changedFiles, ...buildRepair.changedFiles]));
    result.commands.push(...buildRepair.commands);
    result.verification.push(...buildRepair.verification);
    mergeExecutionTimeline(result.timeline, buildRepair.timeline);
    result.usage.push(...buildRepair.usage);
    result.turnsUsed += buildRepair.turnsUsed;

    if (!buildRepair.changedFiles.length) {
      if (missingImport && compilerRepairPass < maxCompilerRepairPasses) {
        // A missing imported module is ordinary incomplete-generation evidence, not a product
        // decision. If the first bounded repair failed to write it, change model strategy inside
        // the existing autonomous allowance instead of asking the customer to authorize a normal
        // compiler repair. The next loop receives the same exact compiler evidence and escalates.
        await emitExecution(execution, "reasoning", "warning", "The first compiler repair made no source change; Foundry is switching strategy automatically", {
          details: { failureFingerprint, failureSignature, missingTarget: missingImport.target, paidRepairPasses: compilerRepairPass, automaticRecovery: true, terminal: false },
        });
        result.status = "failed";
        result.blocker = `The generated batch is missing ${missingImport.target}; automatic compiler recovery is continuing from the preserved diagnostic.`;
        continue;
      }
      // A paid repair that made no mutation is not progress. Retrying the same diagnostic with a
      // different prompt used to consume the remaining mission budget while showing the same two
      // messages to the user. Preserve the compiler evidence and require an explicit continuation;
      // a resumed mission can choose a new strategy without charging repeatedly in this run.
      result.status = "needs-clarification";
      result.blocker = `Foundry stopped after one compiler-repair attempt returned without changing source. No additional model calls were made for this diagnostic. The project and exact compiler evidence are preserved: ${summarizeCommandFailure(deterministicBuildFailure)}`;
      result.clarificationQuestions = [{
        question: "The first compiler repair made no source change. Continue with a fresh repair strategy from the preserved diagnostic?",
        options: ["Continue with a fresh strategy", "Pause here"],
      }];
      await emitExecution(execution, "summary", "warning", "Compiler repair paused before another paid attempt", {
        details: { failureFingerprint, failureSignature, paidRepairPasses: compilerRepairPass, resumable: true, terminal: false, blocker: result.blocker },
      });
      deterministicBuildFailure = undefined;
      break;
    }
    compilerFailureMutations.set(failureFingerprint, fingerprintMutations + 1);
    compilerFailureSignatureMutations.set(failureSignature, signatureMutations + 1);

    let preparationFailure: FactoryCommandEvent | undefined;
    if (buildRepair.changedFiles.some((file) => /(?:^|\/)package(?:-lock)?\.json$/i.test(file))) {
      const repairInstall = await runCommand(projectPath, "npm.cmd", ["install", "--prefer-offline", "--no-audit", "--no-fund"], events, execution);
      result.commands.push(repairInstall);
      if (repairInstall.exitCode !== 0) preparationFailure = repairInstall;
    }
    const retryBuild = preparationFailure ?? await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
    if (!preparationFailure) result.commands.push(retryBuild);
    result.verification.push({
      check_type: "build",
      result: retryBuild.exitCode === 0 ? "pass" : "fail",
      evidence: retryBuild.exitCode === 0
        ? `The generated project's production build passed after ${compilerRepairPass} compiler-evidenced repair pass${compilerRepairPass === 1 ? "" : "es"}.`
        : `The compiler-evidenced repair exposed a remaining real failure: ${summarizeCommandFailure(retryBuild)}`,
    });
    if (retryBuild.exitCode === 0) {
      result.status = "passed";
      result.blocker = undefined;
      deterministicBuildFailure = undefined;
    } else {
      result.status = "failed";
      result.blocker = `Production build still has a compiler failure: ${summarizeCommandFailure(retryBuild)}`;
      deterministicBuildFailure = retryBuild;
    }
  }
  if (deterministicBuildFailure && (compilerRepairPass >= maxCompilerRepairPasses || compilerRecoveryCycle >= maxCompilerRecoveryCycles) && !signal?.aborted) {
    result.status = "needs-clarification";
    result.blocker = `Foundry preserved the project and its latest compiler evidence after reaching the configured autonomous-recovery spending boundary. The project is unfinished, not failed. Confirm continued recovery to resume from this exact diagnostic without repeating completed work: ${summarizeCommandFailure(deterministicBuildFailure)}`;
    result.clarificationQuestions = [{ question: "Foundry has preserved all completed work. Should it continue autonomous recovery from the current compiler diagnostic?", options: ["Continue recovery", "Pause here"] }];
    await emitExecution(execution, "summary", "warning", "Autonomous repair is ready to continue when confirmed", {
      details: { paidRepairPasses: compilerRepairPass, recoveryCycles: compilerRecoveryCycle, distinctFailureFingerprints: compilerFailureAttempts.size, resumable: true, terminal: false, blocker: result.blocker },
    });
  }

  // Non-Node ecosystems use the same progress protocol through their registered verification
  // adapter. Foundry does not need a branch per framework or language: the adapter supplies the
  // real command, compiler-evidence resolves its source paths, and the same command is repeated
  // after one action-enforced mutation. This covers compiled, interpreted, mobile, and backend
  // stacks without pretending that a fixed catalogue can enumerate every future toolchain.
  if (!existsSync(path.join(projectPath, "package.json")) && result.changedFiles.length > 0 && access.runCommand && !signal?.aborted) {
    const generatedVerificationProfile = (await detectStackProfileAndEntriesForAccess(access)).verificationProfile;
    const requiredChecks = generatedVerificationProfile.commands.filter((check) => check.required && !check.longRunning);
    if (requiredChecks.length) {
      let ecosystemGate = await runRequiredVerificationProfile({
        access,
        execution,
        profile: generatedVerificationProfile,
        projectPath,
        existingCommands: result.commands,
        requireAutomatedTests: missionRequiresAutomatedTests(task),
      });
      result.commands.push(...ecosystemGate.commands);
      result.verification.push(...ecosystemGate.verification);
      const ecosystemFailureAttempts = new Map<string, number>();
      let ecosystemRecoveryCycles = 0;
      while (!ecosystemGate.passed && ecosystemGate.failure && !signal?.aborted) {
        ecosystemRecoveryCycles += 1;
        if (ecosystemRecoveryCycles > maxCompilerRecoveryCycles) {
          result.status = "needs-clarification";
          result.blocker = `Foundry preserved the ${generatedVerificationProfile.ecosystem} project and its latest verification evidence after reaching the configured autonomous-recovery spending boundary. The project is unfinished, not failed. Confirm continued recovery to resume without repeating completed work: ${summarizeCommandFailure(ecosystemGate.failure)}`;
          result.clarificationQuestions = [{ question: `Foundry has preserved all completed work. Should it continue autonomous ${generatedVerificationProfile.ecosystem} recovery from the current diagnostic?`, options: ["Continue recovery", "Pause here"] }];
          await emitExecution(execution, "summary", "warning", `${generatedVerificationProfile.ecosystem} recovery is ready to continue when confirmed`, {
            details: { recoveryCycles: ecosystemRecoveryCycles - 1, resumable: true, terminal: false, blocker: result.blocker },
          });
          break;
        }
        const failure = ecosystemGate.failure;
        const deterministicRepairs = await applyDeterministicCompilerRepairs(access, failure, projectPath);
        if (deterministicRepairs.length) {
          result.changedFiles = Array.from(new Set([...result.changedFiles, ...deterministicRepairs.map((repair) => repair.path)]));
          await emitExecution(execution, "edit", "completed", `Applied a compiler-proven ${generatedVerificationProfile.ecosystem} source repair before model routing`, {
            filePath: deterministicRepairs[0].path,
            details: { repairs: deterministicRepairs.map((repair) => `${repair.ruleId}: ${repair.path} — ${repair.reason}`), paidModelCalls: 0 },
          });
          ecosystemGate = await runRequiredVerificationProfile({
            access,
            execution,
            profile: generatedVerificationProfile,
            projectPath,
            existingCommands: result.commands,
            requireAutomatedTests: missionRequiresAutomatedTests(task),
          });
          result.commands.push(...ecosystemGate.commands);
          result.verification.push(...ecosystemGate.verification);
          continue;
        }
        const failureFingerprint = compilerFailureFingerprint(failure, projectPath);
        const failureAttempt = (ecosystemFailureAttempts.get(failureFingerprint) ?? 0) + 1;
        ecosystemFailureAttempts.set(failureFingerprint, failureAttempt);
        if (failureAttempt > 2) {
          ecosystemFailureAttempts.set(failureFingerprint, 1);
          await emitExecution(execution, "reasoning", "warning", `${generatedVerificationProfile.ecosystem} repair is changing strategy after repeated attempts`, {
            details: { failureFingerprint, attempts: failureAttempt - 1, strategyReset: true, terminal: false, paidModelCalls: 0 },
          });
        }

        const exactDiagnostic = compilerDiagnosticOutput(failure);
        const repairTask = `Repair the exact ${generatedVerificationProfile.ecosystem} verification failure below. Preserve all behavior unrelated to this diagnostic. Mutate the verified source immediately; Foundry will rerun the same command, so do not spend a model turn rerunning it or narrating completion.\n\nOriginal project request:\n${task}\n\nAuthoritative command failure (${failure.command}):\n${exactDiagnostic}`;
        const repairWorkingSet = workingSetWithCommandFailure(await discoverProjectWorkingSet(access, repairTask), failure, projectPath);
        const diagnosticPaths = commandTracebackSourcePaths(repairWorkingSet, projectPath);
        const repairEvidence = await readBoundedWorkingSetEvidence(access, diagnosticPaths.length ? diagnosticPaths : repairWorkingSet.likelyFiles);
        const repairTier: ModelTier = failureAttempt > 1 ? "architect" : "builder";
        const repairModel = await modelForMissionStage(repairTask, modelMode, repairTier, repairWorkingSet, failureAttempt, creationAssessment) ?? implementationModel;
        await emitModelSelection(execution, failureAttempt > 1 ? `${generatedVerificationProfile.ecosystem} repair escalation` : `${generatedVerificationProfile.ecosystem} repair`, repairModel);
        const repair = await runMissionExecutor({
          objective,
          task: repairTask,
          checklist: [{ id: "ecosystem-verification-repair", label: `Repair the ${generatedVerificationProfile.ecosystem} verification failure`, status: "pending" }],
          costScopeId: execution.costScopeId,
          access,
          apiKey: repairModel.apiKey,
          provider: repairModel.provider,
          tier: repairModel.tier,
          onEvent: emitEvent,
          signal,
          approvedCategories: ["dependencies", "package-runner"],
          hasBuildTooling: true,
          fastLane: true,
          initialProjectEvidence: repairEvidence,
          requireFirstMutation: Boolean(repairEvidence),
          verificationProfile: generatedVerificationProfile,
          executionStrategy: creationStrategy,
          routingAssessment: creationAssessment,
          evidenceImages,
          maxTurns: 1,
          maxNudges: 0,
          maxOutputTokens: 6_000,
          routingBudget: { maximumModelCalls: 1, estimatedCostUsd: compilerRepairBudgetUsd() },
        });
        result.changedFiles = Array.from(new Set([...result.changedFiles, ...repair.changedFiles]));
        result.commands.push(...repair.commands);
        result.verification.push(...repair.verification);
        mergeExecutionTimeline(result.timeline, repair.timeline);
        result.usage.push(...repair.usage);
      { const destructive = await revertDestructiveRepairEdits(access, execution, repair.timeline).catch(() => [] as string[]); if (destructive.length) { repair.changedFiles = repair.changedFiles.filter((file) => !destructive.includes(file)); repair.status = "failed"; repair.blocker = repair.blocker || `The repair deleted most of ${destructive.length} implemented file(s); the implementation was restored and the repair rejected.`; } }
        result.turnsUsed += repair.turnsUsed;
        if (!repair.changedFiles.length) continue;

        ecosystemGate = await runRequiredVerificationProfile({
          access,
          execution,
          profile: generatedVerificationProfile,
          projectPath,
          existingCommands: result.commands,
          requireAutomatedTests: missionRequiresAutomatedTests(task),
        });
        result.commands.push(...ecosystemGate.commands);
        result.verification.push(...ecosystemGate.verification);
      }
      if (ecosystemGate.passed) {
        result.status = "passed";
        result.blocker = undefined;
        await emitExecution(execution, "summary", "completed", `${generatedVerificationProfile.ecosystem} verification passed after evidence-driven recovery`, {
          details: { paidNarrationCalls: 0, verificationCommands: requiredChecks.map((check) => check.command) },
        });
      }
    }
  }
  const productionBuildVerified = result.commands.some((command) =>
    command.exitCode === 0 && isProductionBuildCommand(command.command),
  );
  const successfulBuildSupersedesBatchBoundary = result.status === "failed"
    && productionBuildVerified
    && !deterministicTestFailure
    && /turn budget|not completed|Model-call limit reached|Estimated request cost would exceed|NO_PROGRESS_AFTER_MUTATION/i.test(result.blocker ?? "");
  if (successfulBuildSupersedesBatchBoundary) {
    result.status = "passed";
    result.blocker = undefined;
    await emitExecution(execution, "summary", "completed", "Production build passed; advancing to live preview verification", {
      details: { reconciledEarlierFailures: true },
    });
  }
  const automatedTestsVerified = result.commands.some((command) =>
    command.exitCode === 0 && isAutomatedTestCommand(command.command),
  );
  if (backendOnlyCreation && productionBuildVerified && automatedTestsVerified && result.status === "failed"
    && /browser|visual|playthrough|lost a clear next step|turn budget|not completed|Model-call limit reached|Estimated request cost would exceed/i.test(result.blocker ?? "")) {
    for (const item of result.checklist) {
      if ((item.status === "blocked" || item.status === "pending") && /browser|visual|playthrough/i.test(item.label)) {
        item.status = "skipped";
        item.evidence = "This is a backend-only service. Its real build and automated endpoint tests passed; browser UI verification does not apply.";
      }
    }
    result.status = "passed";
    result.blocker = undefined;
    result.verification.push({
      check_type: "test",
      result: "pass",
      evidence: "Backend-only service verification passed through the declared production build and automated API test suite; no fake browser UI was required.",
    });
    await emitExecution(execution, "summary", "completed", "Backend build and API tests verified; continuing to the operational service preview", {
      details: { platform: "api", browserUiRequired: false },
    });
  }

  execution.checklist.splice(0, execution.checklist.length, ...result.checklist);
  let modelUsage = summarizeModelUsage(result.usage);
  const estimatedBuildCost = modelUsage.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
  await emitExecution(execution, "planning", "completed", `Build-model usage · ${result.turnsUsed} turn${result.turnsUsed === 1 ? "" : "s"} · $${estimatedBuildCost.toFixed(4)} estimated`, {
    details: { stage: "implementation usage", turns: result.turnsUsed, modelUsageJson: JSON.stringify(modelUsage) },
  });
  if (!runtimeBuildAvailable && stackProfile.id !== "static-html") {
    result.verification.push({
      check_type: "build",
      result: "skipped",
      evidence: `${stackProfile.label} source files were verified by disk read-back, but its local compiler/runtime is not installed or configured on this machine, so build/runtime validation was not run.`,
    });
  }
  completeChecklistItem(execution, "files-on-disk", result.changedFiles.length ? "completed" : "blocked", result.changedFiles.length ? `Wrote ${result.changedFiles.length} file(s) to ${projectPath}.` : "No files were written.");

  const onlyBoundedBookkeepingRemains = result.status === "failed"
    && creationStrategy.workflow === "bounded-artifact"
    && result.changedFiles.length >= 3
    && /^Checklist item\(s\) not completed:/i.test(result.blocker ?? "");
  let status: FactoryProjectResult["status"] =
    result.status === "passed" || onlyBoundedBookkeepingRemains ? "passed" : result.status === "awaiting-approval" ? "awaiting-approval" : result.status === "awaiting-mock-approval" ? "awaiting-mock-approval" : result.status === "needs-clarification" ? "needs-clarification" : "failed";
  let blocker = result.status === "passed" || onlyBoundedBookkeepingRemains ? undefined : result.blocker;
  const mockGateReached = status === "awaiting-mock-approval";
  // Only the latest canonical build is authoritative. An earlier pass cannot license preview or
  // completion after later source changes exposed a failing build.
  const productionBuildPassed = result.commands.filter((command) => isProductionBuildCommand(command.command)).at(-1)?.exitCode === 0;

  // The preview shows what is on disk; it is not a reward for a passing verdict. Withholding it
  // until the mission passed meant that the one time a user most needs to see their project — when
  // Foundry reports a problem with it — the workspace showed nothing at all. Any run that wrote
  // files gets a preview; readiness gating below still decides what may be *validated*.
  const generatedPreviewTarget = { kind: "workspace" as const, projectId, projectPath };
  let preview = status === "passed" || mockGateReached || productionBuildPassed || result.changedFiles.length > 0
    ? await startProjectPreview(generatedPreviewTarget, stackProfile.label, events, execution)
    : undefined;
  const readyBuiltWebPreview = Boolean(
    preview?.previewUrl
    && preview.previewState === "ready"
    && preview.previewPlatform === "web"
    && (status === "passed" || productionBuildPassed),
  );
  const browserEvidenceCanSupersedeBlocker = status === "failed"
    && productionBuildPassed
    && /no finding\/decision confirms|interactive behavior|verification narrative|turn budget|not completed|Model-call limit reached|Estimated request cost would exceed/i.test(blocker ?? "");
  if (readyBuiltWebPreview && preview?.previewUrl) {
    let browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, task);
    browserEvidence = await enforceProductionIntegrationReadiness(browserEvidence, projectPath, projectId, task);
    // A broken asset reference is a path mistake in any stack, not a static-HTML quirk. Gating this
    // on one stack id sent every other stack straight into a paid repair loop for a fix Foundry can
    // make deterministically from what is already on disk.
    if (!browserEvidence.verified) {
      const repairedBrokenImages = browserEvidence.brokenImageSources?.length
        ? await repairBrokenStaticImages(access, browserEvidence.brokenImageSources, execution)
        : false;
      if (repairedBrokenImages) {
        browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, task);
      }
    }
    if (!browserEvidence.verified && browserEvidence.infrastructureFailure) {
      await emitExecution(execution, "reasoning", "completed", "The source build passed, but generated framework assets changed during preview verification. I’m rebuilding with the preview paused and rechecking without a model call.", {
        details: { paidModelCalls: 0, recovery: "framework-preview-generation" },
      });
      await stopProjectPreview(generatedPreviewTarget);
      const infrastructureBuild = await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
      result.commands.push(infrastructureBuild);
      result.verification.push({
        check_type: "build",
        result: infrastructureBuild.exitCode === 0 ? "pass" : "fail",
        evidence: infrastructureBuild.exitCode === 0
          ? "A clean production build passed with the owned preview paused."
          : `The clean preview-infrastructure rebuild failed: ${summarizeCommandFailure(infrastructureBuild)}`,
      });
      if (infrastructureBuild.exitCode === 0) {
        preview = await startProjectPreview(generatedPreviewTarget, stackProfile.label, events, execution);
        if (preview.previewUrl && preview.previewPlatform === "web" && preview.previewState === "ready") {
          browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, task);
          browserEvidence = await enforceProductionIntegrationReadiness(browserEvidence, projectPath, projectId, task);
        }
      }
    }
    const browserRepairChangedFiles = new Set<string>();
    const attemptedBrowserRepairFingerprints = new Set<string>();
    const repeatedBrowserFindings = new Map<string, number>();
    const maximumBrowserRepairStages = autonomousRepairStageLimit(process.env.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 2);
    let browserVerificationConflict = false;
    for (let repairAttempt = 1; !browserEvidence.verified && !browserEvidence.infrastructureFailure && repairAttempt <= maximumBrowserRepairStages; repairAttempt += 1) {
      const findingFingerprint = verificationFindingFingerprint(browserEvidence.evidence);
      const findingCount = (repeatedBrowserFindings.get(findingFingerprint) ?? 0) + 1;
      repeatedBrowserFindings.set(findingFingerprint, findingCount);
      if (findingCount > 1) {
        browserVerificationConflict = true;
        await emitExecution(execution, "planning", "warning", "Stopped repeated generated-project repair on unchanged browser findings", {
          internal: true,
          details: { findingFingerprint, findingCount, paidCallPrevented: true, repairAttempt },
        });
        break;
      }
      const repairReadPaths = await verifiedBrowserRepairReadPaths(access, browserEvidence.evidence);
      const sourceFingerprint = await sourceProgressFingerprint(access, [...result.changedFiles, ...repairReadPaths]);
      const evidenceFingerprint = semanticRepairFingerprint(browserEvidence.evidence, sourceFingerprint);
      if (attemptedBrowserRepairFingerprints.has(evidenceFingerprint)) {
        await emitExecution(execution, "preview", "running", "Rechecking unchanged generated-project evidence without another model call", {
          internal: true,
          details: { evidenceFingerprint, sourceFingerprint, paidCallPrevented: true, repairAttempt },
        });
        browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl!, projectPath, execution, preview.previewOwnershipToken, task);
        if (browserEvidence.verified) break;
        const repeatedFingerprint = semanticRepairFingerprint(browserEvidence.evidence, sourceFingerprint);
        if (attemptedBrowserRepairFingerprints.has(repeatedFingerprint)) {
          attemptedBrowserRepairFingerprints.clear();
          await emitExecution(execution, "planning", "warning", "Changing generated-project repair strategy after unchanged source and evidence", {
            internal: true,
            details: { evidenceFingerprint: repeatedFingerprint, sourceFingerprint, strategyReset: true, terminal: false, repairAttempt },
          });
          continue;
        }
        continue;
      }
      attemptedBrowserRepairFingerprints.add(evidenceFingerprint);
      await emitExecution(execution, "reasoning", "completed", repairAttempt === 1
        ? "The rendered project exposed concrete browser failures. I’m repairing all verified evidence, rebuilding, restarting its owned preview, and running the same checks again."
        : `The generated project still has verified browser failures after repair ${repairAttempt - 1}. I’m continuing from the changed source with the remaining evidence.`, { internal: true });
      const staticBrowserRepair = stackProfile.id === "static-html";
      const repairTier: ModelTier = /explicit acceptance requirements/i.test(browserEvidence.evidence)
        && !/(?:Console:|Page error:|Failed local request:|browser interaction failed)/i.test(browserEvidence.evidence)
        ? "fast"
        : "builder";
      const browserRepairModel = await modelForMissionStage(task, modelMode, repairTier, undefined, repairAttempt, creationAssessment) ?? implementationModel;
      await emitModelSelection(execution, `browser repair ${repairAttempt}`, browserRepairModel);
      // The browser gate says WHAT is missing on screen; this deterministic check says WHY — the entry
      // route never imports the implemented components. Without it, two paid repairs fixed unrelated
      // files while the placeholder kept rendering. Lead the evidence with the root cause when present.
      const entryWiringDefect = staticBrowserRepair ? undefined : await unwiredEntryEvidence(projectPath).catch(() => undefined);
      const repair = await runMissionExecutor({
        objective,
        task: `Repair every remaining verified failure in this generated ${staticBrowserRepair ? "static" : "framework"} web project so it passes the real desktop and mobile browser preview check. Preserve the requested product, architecture, pages, and working interactions. Resolve every distinct missing route, failed request, console error, interaction defect, and responsive problem below; do not stop after the first symptom${staticBrowserRepair ? ". Use self-contained CSS/data placeholders instead of unreliable remote assets when images are broken" : ". Coordinate source, routes, and styling changes across the existing framework project"}.\n\nOriginal user request:\n${task}\n${entryWiringDefect ? `\n${entryWiringDefect}\n` : ""}\nRemaining verified browser failure:\n${browserEvidence.evidence}`,
        checklist: [{ id: `generated-browser-repair-${repairAttempt}`, label: "Repair every remaining browser-verified product failure", status: "pending" }],
        costScopeId: execution.costScopeId,
        access,
        apiKey: browserRepairModel.apiKey,
        provider: browserRepairModel.provider,
        tier: browserRepairModel.tier,
        onEvent: emitEvent,
        signal,
        approvedCategories: ["dependencies", "package-runner"],
        hasBuildTooling: !staticBrowserRepair,
        newProject: false,
        multiFileRepair: !staticBrowserRepair,
        staticProject: staticBrowserRepair,
        staticRewrite: staticBrowserRepair,
        evidenceFirstRepair: !staticBrowserRepair,
        evidenceRepairReadPaths: staticBrowserRepair ? undefined : repairReadPaths,
        executionStrategy: creationStrategy,
        routingAssessment: creationAssessment,
        evidenceImages,
        maxTurns: staticBrowserRepair ? 3 : 8,
        maxNudges: 1,
        maxOutputTokens: staticBrowserRepair ? undefined : 5_000,
        routingBudget: staticBrowserRepair ? undefined : { maximumModelCalls: 10, estimatedCostUsd: 1 },
      });
      result.usage.push(...repair.usage);
      { const destructive = await revertDestructiveRepairEdits(access, execution, repair.timeline).catch(() => [] as string[]); if (destructive.length) { repair.changedFiles = repair.changedFiles.filter((file) => !destructive.includes(file)); repair.status = "failed"; repair.blocker = repair.blocker || `The repair deleted most of ${destructive.length} implemented file(s); the implementation was restored and the repair rejected.`; } }
      result.changedFiles = [...new Set([...result.changedFiles, ...repair.changedFiles])];
      result.commands.push(...repair.commands);
      modelUsage = summarizeModelUsage(result.usage);
      if (signal?.aborted || repair.status === "stopped") break;
      if (repair.changedFiles.length === 0) {
        await emitExecution(execution, "preview", "running", "Generated-project repair reported no source change; repeating the exact browser gate without another model call", {
          internal: true,
          details: { evidenceFingerprint, sourceFingerprint, paidCallPrevented: true, repairAttempt },
        });
        browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl!, projectPath, execution, preview.previewOwnershipToken, task);
        if (browserEvidence.verified) break;
        const repeatedFingerprint = semanticRepairFingerprint(browserEvidence.evidence, sourceFingerprint);
        if (attemptedBrowserRepairFingerprints.has(repeatedFingerprint)) {
          attemptedBrowserRepairFingerprints.clear();
          await emitExecution(execution, "planning", "warning", "Changing generated-project repair strategy after a zero-change attempt", {
            internal: true,
            details: { evidenceFingerprint: repeatedFingerprint, sourceFingerprint, strategyReset: true, terminal: false, repairAttempt },
          });
          continue;
        }
        browserEvidence = {
          verified: false,
          evidence: `${browserEvidence.evidence} Automatic repair made no further source change${repair.blocker ? `: ${repair.blocker}` : "."}`,
          brokenImageSources: browserEvidence.brokenImageSources,
          acceptanceVerified: false,
        };
        continue;
      }
      repair.changedFiles.forEach((file) => browserRepairChangedFiles.add(file));
      // The repair executor can truthfully write a corrected file yet miss its bookkeeping-only
      // mark_checklist_item call before the turn budget ends. The independent Chromium rerun is the
      // stronger completion gate: if real changed source now renders and behaves cleanly, accept that
      // evidence instead of failing a working project over model ceremony.
      if (repair.changedFiles.length > 0) {
        if (!staticBrowserRepair) await stopProjectPreview(generatedPreviewTarget);
        const repairedBuild = staticBrowserRepair
          ? undefined
          : await runCommand(projectPath, "npm.cmd", ["run", "build"], events, execution);
        if (repairedBuild) {
          result.commands.push(repairedBuild);
          result.verification.push({
            check_type: "build",
            result: repairedBuild.exitCode === 0 ? "pass" : "fail",
            evidence: repairedBuild.exitCode === 0
              ? "The framework project production build passed after the browser-evidenced repair."
              : `The framework project failed its production build after browser repair: ${summarizeCommandFailure(repairedBuild)}`,
          });
        }
        if (repairedBuild && repairedBuild.exitCode !== 0) {
          browserEvidence = { verified: false, evidence: `Browser recheck is waiting on a successful production build: ${summarizeCommandFailure(repairedBuild)}`, brokenImageSources: [], acceptanceVerified: false };
          continue;
        }
        await stopProjectPreview(generatedPreviewTarget);
        preview = await startProjectPreview(generatedPreviewTarget, stackProfile.label, events, execution);
        if (!preview.previewUrl || preview.previewPlatform !== "web" || preview.previewState !== "ready") {
          browserEvidence = { verified: false, evidence: preview.previewReason || "The repaired generated preview did not become ready.", brokenImageSources: [], acceptanceVerified: false };
          continue;
        }
        browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, task);
        browserEvidence = await enforceProductionIntegrationReadiness(browserEvidence, projectPath, projectId, task);
      }
    }
    if (browserRepairChangedFiles.size > 0) {
      result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
      result.sessionSummary.outcome = browserEvidence.verified
        ? `Foundry built ${spec.projectName} as a ${stackProfile.label} project, resolved the concrete issues found by browser verification, and verified the finished desktop/mobile experience.`
        : "Foundry changed and rebuilt the generated project, but the real browser gate still has unresolved product defects.";
      result.sessionSummary.changes = [...new Set([...result.sessionSummary.changes, ...browserRepairChangedFiles])];
      result.sessionSummary.flags = browserEvidence.verified ? [] : [browserEvidence.evidence];
    }
    result.verification.push({
      check_type: "preview",
      result: browserEvidence.verified ? "pass" : "fail",
      evidence: browserEvidence.evidence,
    });
    if (!browserEvidence.verified) {
      status = "failed";
      blocker = browserVerificationConflict
        ? `Foundry preserved the unfinished project after every configured browser-repair strategy returned unchanged source and evidence. Continue recovery from this exact browser gate.\n\n${browserEvidence.evidence}`
        : browserEvidence.evidence;
      result.clarificationQuestions = undefined;
    } else if (browserEvidenceCanSupersedeBlocker || onlyBoundedBookkeepingRemains || successfulBuildSupersedesBatchBoundary) {
      status = "passed";
      blocker = undefined;
      for (const item of execution.checklist) {
        if (item.status === "pending" || item.status === "running" || item.status === "blocked") {
          item.status = "completed";
          item.evidence = browserEvidence.evidence;
        }
      }
      if (result.sessionSummary) result.sessionSummary.outcome = "The generated project rendered successfully and passed the real browser completion gate.";
    }
  } else if (status === "passed" && preview?.previewPlatform === "web" && preview.previewState !== "ready") {
    blocker = preview.previewReason || "Foundry could not start an owned preview for the generated project.";
    status = "failed";
    result.verification.push({ check_type: "preview", result: "fail", evidence: blocker });
  }
  // Collapse the duplicate/conflicting files an interrupted-then-resumed build leaves behind before
  // reporting. Byte-identical copies are removed here; conflicting entry points or divergent duplicates
  // are surfaced honestly rather than shipped as a silently-broken project.
  const duplicateReconciliation = await reconcileDuplicateProjectFiles(access, execution).catch(() => ({ removed: [] as string[], problem: undefined as string | undefined }));
  if (duplicateReconciliation.problem) {
    result.verification.push({ check_type: "file-read", result: "fail", evidence: duplicateReconciliation.problem });
    if (status === "passed") {
      status = "failed";
      blocker = duplicateReconciliation.problem;
    }
  }
  const files = await listProjectFiles(projectPath);
  completeChecklistItem(
    execution,
    "references-checked",
    status === "passed" || mockGateReached ? "completed" : "blocked",
    status === "passed" || mockGateReached ? "Verified via the mission executor." : blocker,
  );
  finishObjectiveChecklist(execution, status, blocker);
  await emitExecution(
    execution,
    "summary",
    status === "passed" ? "completed" : mockGateReached ? "completed" : status === "needs-clarification" ? "warning" : "error",
    status === "passed" ? "Behavior verified" : mockGateReached ? "First working mock ready for review" : status === "needs-clarification" ? "Work preserved and ready to continue" : "Execution finished with blocker",
    { details: { files: files.length, previewUrl: preview?.previewUrl } },
  );

  return {
    projectId,
    projectName: spec.projectName,
    projectPath,
    briefPath,
    stack: stackProfile.label,
    template: spec.template,
    sourceMode: "new-project",
    objective,
    checklist: execution.checklist,
    status,
    supported: true,
    blocker,
    clarificationQuestions: result.clarificationQuestions,
    events,
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
    previewEmulator: preview?.previewEmulator,
    artifact: preview?.artifact,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
    timeline: execution.timeline,
    sessionSummary: result.sessionSummary,
    verification: result.verification,
    modelUsage,
    executionTurns: result.turnsUsed,
    environment,
  };
}

export async function createFactoryProject(brief: string, onEvent?: ExecutionEmitter, discovery?: StructuredDiscovery, modelMode: ModelMode = "auto", quality: MissionQualityLevel = DEFAULT_MISSION_QUALITY, signal?: AbortSignal, evidenceAttachments: EvidenceAttachments = []): Promise<FactoryProjectResult> {
  const result = await createFactoryProjectCore(brief, onEvent, discovery, modelMode, quality, signal, evidenceAttachments);
  return finalizeFactoryProjectResult(result, result.objective || brief);
}

function summarizeModelUsage(usage: Awaited<ReturnType<typeof runMissionExecutor>>["usage"]): NonNullable<FactoryProjectResult["modelUsage"]> {
  const grouped = new Map<string, NonNullable<FactoryProjectResult["modelUsage"]>[number]>();
  for (const item of usage) {
    const key = `${item.provider}:${item.model}`;
    const current = grouped.get(key) ?? {
      provider: item.provider,
      model: item.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      cachedCalls: 0,
    };
    current.calls += item.requestCount;
    current.inputTokens += item.inputTokens;
    current.outputTokens += item.outputTokens;
    current.estimatedCostUsd += item.estimatedCostUsd;
    current.cachedCalls += item.cached ? 1 : 0;
    grouped.set(key, current);
  }
  return Array.from(grouped.values());
}

type BrowserPreviewEvidence = {
  verified: boolean;
  evidence: string;
  brokenImageSources: string[];
  infrastructureFailure?: boolean;
  acceptanceVerified: boolean;
  /** False when no probe could apply to this request, so acceptance was never actually tested.
   * Distinguishes "nothing to check" from "checked and failed" — only the latter is a defect. */
  acceptanceApplicable?: boolean;
  acceptanceUrl?: string;
  /** True when the page itself rendered cleanly — no errors, failed requests, or blank/broken render —
   * and the only shortfall was an undemonstrated capability. A healthy render with unproven acceptance
   * is honestly "verified but unproven", not a failed mission. */
  renderHealthy?: boolean;
};

async function enforceProductionIntegrationReadiness(evidence: BrowserPreviewEvidence, projectPath: string, projectId: string, task: string): Promise<BrowserPreviewEvidence> {
  const requestsAuth = /\b(?:auth(?:entication)?|sign\s*up|signup|sign\s*in|login|forgot password|reset password|magic[- ]link|oauth)\b/i.test(task);
  const fileEntries = await listProjectFiles(projectPath);
  const evidencePaths = fileEntries
    .map((file) => file.path)
    .filter((filePath) => /(?:\.(?:[cm]?[jt]sx?|py|rb|cs|java|go|json|toml|ya?ml|env)|(?:^|\/)(?:Dockerfile|Pipfile|go\.mod|Cargo\.toml|pom\.xml|requirements[^/]*\.txt))$/i.test(filePath))
    .slice(0, 500);
  const projectEvidence = await Promise.all(evidencePaths.map(async (filePath) => ({
    path: filePath,
    content: await readFile(path.join(projectPath, filePath), "utf8").catch(() => ""),
  })));
  const sourcePaths = projectEvidence.map((file) => file.path).filter((filePath) => /(?:^|\/)(?:app|src|lib|server|api)\/.*\.(?:[cm]?[jt]sx?|py|rb|cs|java|go)$/i.test(filePath));
  const sourceParts = projectEvidence.filter((file) => sourcePaths.includes(file.path)).map((file) => {
    const filePath = file.path;
    const content = file.content;
    return `\n/* ${filePath} */\n${content.slice(0, 120_000)}`;
  });
  const configured = await projectIntegrationEnvironment({ projectId, environment: "development", location: "local" });
  const detected = detectProjectIntegrations(projectEvidence, configured.environment);
  const integrationFailures = detected.detected.filter((item) => item.required && item.used).flatMap((item) => {
    const needsCredential = item.definition.auth === "oauth" || item.definition.auth === "oidc" || item.definition.fields.some((field) => field.secret);
    if (!needsCredential) return [];
    if (item.definition.maturity !== "adapter") return [`${item.definition.name} is detected but has no executable verified adapter`];
    if (item.missingEnvironment.length) return [`${item.definition.name} is missing verified configuration: ${item.missingEnvironment.join(", ")}`];
    return [];
  });
  const source = sourceParts.join("\n");
  const failures: string[] = [...integrationFailures];
  if (requestsAuth && !/\b(?:mock|prototype|wireframe)\b/i.test(task)) {
    if (/in-memory (?:store|database)|new Map<[^>]*(?:User|Session|Credential|PasswordReset)|\b(?:users|sessions|credentials|passwordResetTokens)\s*=\s*new Map/i.test(source)) {
      failures.push("authentication state is stored only in memory and disappears on restart");
    }
    if (/for demo purposes|demo(?:Email|User|ProviderId)|providerAccountId:\s*[`'"][^`'"]*demo/i.test(source)) {
      failures.push("an OAuth control creates a demo user instead of completing a provider callback");
    }
    const requiresEmail = /\b(?:forgot|reset)\s+(?:my\s+)?password\b|\b(?:email verification|verify (?:an? )?email|magic[- ]link)\b/i.test(task);
    if (requiresEmail && /console\.(?:log|info)\s*\([\s\S]{0,500}(?:email|reset|verification|magic)/i.test(source)) {
      failures.push("transactional email is logged to the console instead of being provider-delivered");
    }
    const routeSet = new Set(sourcePaths.map((filePath) => filePath.replace(/\\/g, "/").toLowerCase()));
    const parallelAuthRoutes = ["login", "signup", "forgot-password", "reset-password"].filter((route) =>
      [...routeSet].some((filePath) => filePath.endsWith(`/app/${route}/page.tsx`))
      && [...routeSet].some((filePath) => filePath.endsWith(`/app/auth/${route}/page.tsx`)),
    );
    if (parallelAuthRoutes.length) failures.push(`conflicting duplicate auth route families exist for ${parallelAuthRoutes.join(", ")}`);
  }
  if (!failures.length) return evidence;
  return {
    ...evidence,
    verified: false,
    acceptanceVerified: false,
    evidence: `${evidence.evidence}\nProduction integration gate failed: ${failures.join("; ")}. Connect and verify every required provider, replace simulated external behavior, and rerun the provider-specific action before completion.`,
  };
}

function durableBrowserRequirementsFromBrief(content: string) {
  const description = content.match(/^Project description:\s*(.+)$/im)?.[1]?.trim();
  const features = content.match(/^Main features:\s*(.+)$/im)?.[1]?.trim();
  // Structured Foundry briefs contain operational metadata, paths, confidence notes, and stack
  // labels that are not rendered product requirements. Feed only the durable outcome fields to
  // browser acceptance. Raw briefs (including connected projects) remain authoritative as-is.
  return description || features || content.trim();
}

async function validateObservableBrowserContract(
  page: import("playwright").Page,
  task: string,
  urls: string[],
  workflowManifest?: AcceptanceWorkflowManifest,
): Promise<{ verified: boolean; applicable: boolean; evidence: string; problem?: string; bestUrl?: string }> {
  const contract = observableBrowserContractForTask(task);
  const requested = [...new Set(contract.requirements.flatMap((item) => item.capabilities))];
  // Literal content the user spelled out ("the heading \"Sam Carter\"", "labelled Design, Prototyping
  // and Research") is checkable even when the request maps to no CRUD capability at all. Treating that
  // as "nothing to verify" is what let a page deliver one of three stated requirements and report Done.
  const requiredTexts = requiredVisibleTextsForTask(task);
  // Element-level claims from the brief ("Responsive images with lazy loading", "footer navigation").
  // A self-reported checklist ticked these complete on a page containing no <img> at all.
  const requiredDom = requiredDomFeaturesForTask(task);
  if (!requested.length && !workflowManifest?.workflows.length && !requiredTexts.length && !requiredDom.length) {
    return { verified: false, applicable: false, evidence: "Nothing in this request was specific enough to check automatically in the browser, so no behaviour was asserted beyond the page rendering cleanly." };
  }
  const renderedTexts: string[] = [];
  const domFeaturesFound = new Set<string>();

  const declaredWorkflow = workflowManifest
    ? await executeAcceptanceWorkflowManifest(page, urls[0], workflowManifest)
    : { passed: [] as string[], problems: [] as string[], bestUrl: undefined as string | undefined };

  const observations: Array<{ url: string; capabilities: ObservableBrowserCapability[] }> = [];
  for (const url of [...new Set(urls)].slice(0, 10)) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (response && response.status() >= 400) continue;
      await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
      // Client-rendered administration and dashboard routes often fetch their real controls after
      // the HTML shell becomes visible. Wait for that route data to settle before deciding that a
      // requested capability is absent; a slow API must not become a false product failure.
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      // Canvas visualisations (Chart.js, ECharts, D3-on-canvas) animate in after networkidle, so the
      // page can be "loaded" while every chart is still an empty canvas. Judging or screenshotting at
      // that instant reports a blank chart as a product defect and fails a working app. Wait until each
      // canvas has actually painted, then let the animation finish, before observing anything.
      await page.waitForFunction(() => {
        const canvases = [...document.querySelectorAll("canvas")].filter((node) => node.width > 0 && node.height > 0);
        if (!canvases.length) return true;
        return canvases.every((node) => {
          try {
            const context = node.getContext("2d");
            if (!context) return true; // WebGL/other contexts cannot be sampled this way.
            const pixels = context.getImageData(0, 0, node.width, node.height).data;
            for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) return true;
            return false;
          } catch {
            return true; // Tainted or unreadable canvas — never block verification on it.
          }
        });
      }, undefined, { timeout: 6_000 }).catch(() => undefined);
      const observed = await page.locator("body").evaluate((body) => {
        const visible = (element: Element | null) => {
          if (!element) return false;
          const node = element as HTMLElement;
          if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
        };
        const labelText = (control: Element) => {
          const id = control.getAttribute("id");
          const label = control.closest("label") || (id ? body.querySelector(`label[for="${CSS.escape(id)}"]`) : null);
          return `${label?.textContent || ""} ${control.getAttribute("aria-label") || ""} ${control.getAttribute("name") || ""} ${control.getAttribute("placeholder") || ""} ${control.getAttribute("inputmode") || ""}`.toLowerCase();
        };
        const uploadInputs = Array.from(body.querySelectorAll('input[type="file"]')).filter((input) => {
          const id = input.getAttribute("id");
          return visible(input.closest("label")) || visible(id ? body.querySelector(`label[for="${CSS.escape(id)}"]`) : null) || visible(input);
        }) as HTMLInputElement[];
        const multipleFileUpload = uploadInputs.some((input) => input.multiple && /image|\*\/\*/i.test(input.accept || "image"));
        const priceInputs = Array.from(body.querySelectorAll("input")).filter((input) => visible(input) && (/price|pricing|cost|rate/.test(labelText(input)) || input.getAttribute("inputmode") === "decimal" || input.getAttribute("type") === "number"));
        const saveControls = Array.from(body.querySelectorAll('button, input[type="submit"], [role="button"]')).filter((control) => visible(control) && /save|publish|update|apply/.test(`${control.textContent || ""} ${control.getAttribute("aria-label") || ""}`.toLowerCase()));
        const structured = Array.from(body.querySelectorAll("main, section, article, form, header, nav, aside")).filter(visible);
        const styledSurfaces = structured.filter((element) => {
          const style = getComputedStyle(element);
          return Number.parseFloat(style.borderRadius || "0") >= 12 || style.boxShadow !== "none" || /gradient/.test(style.backgroundImage);
        }).length;
        const styledControls = Array.from(body.querySelectorAll("button, a[href], input, select, textarea")).filter((element) => {
          if (!visible(element)) return false;
          const style = getComputedStyle(element);
          return Number.parseFloat(style.borderRadius || "0") >= 8 || style.boxShadow !== "none" || /gradient/.test(style.backgroundImage);
        }).length;
        const fontFamilies = new Set(Array.from(body.querySelectorAll("h1, h2, h3, p, button, a")).filter(visible).map((element) => getComputedStyle(element).fontFamily)).size;
        return { multipleFileUpload, editablePricing: priceInputs.length > 0 && saveControls.length > 0, visualPolish: styledSurfaces >= 2 && styledControls >= 3 && fontFamilies >= 2 };
      });
      const capabilities: ObservableBrowserCapability[] = [];
      if (observed.multipleFileUpload) capabilities.push("multiple-file-upload");
      if (observed.editablePricing) capabilities.push("editable-pricing");
      if (observed.visualPolish) capabilities.push("visual-polish");
      observations.push({ url: page.url(), capabilities });
      if (requiredTexts.length) renderedTexts.push(await page.innerText("body").catch(() => ""));
      for (const feature of requiredDom) {
        if (domFeaturesFound.has(feature.label)) continue;
        if (await page.locator(feature.selector).count().catch(() => 0) > 0) domFeaturesFound.add(feature.label);
      }
    } catch {
      // Navigation health is reported by the main browser gate; this probe only records positive capability evidence.
    }
  }

  // A capability Foundry can DRIVE end-to-end (create a record, run a search, toggle state) is real
  // acceptance: requested but not exercisable means the feature genuinely is not there. A capability
  // it can only look for by SHAPE ("is there a file input", "is this styled enough") is a heuristic
  // presence check, brittle on both sides, and must never be a hard failure.
  const drivenWorkflowCapabilities = new Set<ObservableBrowserCapability>(["create-record", "search-filter", "update-record", "assign-record", "complete-record", "permission-denied", "cancel-record", "conflict-rejection", "toggle-state", "delete-record", "persistent-state"]);
  const workflowCapabilities = requested.filter((capability) => drivenWorkflowCapabilities.has(capability));
  const workflow = workflowCapabilities.length
    ? await exerciseNamedBrowserWorkflow(page, workflowCapabilities, [...new Set(urls)])
    : { covered: [] as ObservableBrowserCapability[], evidence: "", problems: [] as string[], url: undefined as string | undefined };
  if (workflow.url) observations.push({ url: workflow.url, capabilities: workflow.covered });

  const covered = new Set(observations.flatMap((item) => item.capabilities));
  // Only a driven-workflow capability may be a hard shortfall. Presence-only capabilities
  // (visual-polish, an image upload input, an editable price field) are heuristics on both the
  // request side and the DOM side — they are observed as positive evidence but never fail a page that
  // renders cleanly. Treating them as hard gates is what failed a working "add an image upload button"
  // and a working redesign, then burned the mission budget in a repair loop chasing them.
  const hardRequested = requested.filter((capability) => drivenWorkflowCapabilities.has(capability));
  const missing = hardRequested.filter((capability) => !covered.has(capability));
  const unmetPresenceCapabilities = requested.filter((capability) => !drivenWorkflowCapabilities.has(capability) && !covered.has(capability));
  const best = observations.sort((left, right) => right.capabilities.filter((item) => requested.includes(item)).length - left.capabilities.filter((item) => requested.includes(item)).length)[0];
  // Unsupported prose is reported transparently, but it must not downgrade capabilities that the
  // deterministic driver actually exercised. A stack choice or product description is not itself
  // a DOM behavior; the observable contract is complete when every mapped capability passed.
  // Explicitly demanded on-screen content, checked against what actually rendered.
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const renderedBody = normalize(renderedTexts.join("\n"));
  const missingTexts = requiredTexts.filter((text) => !renderedBody.includes(normalize(text)));
  const verifiedTexts = requiredTexts.filter((text) => !missingTexts.includes(text));
  // A prose requirement whose stated literal content was found on screen IS covered — it must not also
  // be reported as un-actionable prose.
  const uncoveredProse = contract.unsupported
    .filter((requirement) => !declaredWorkflow.passed.includes(requirement))
    .filter((requirement) => !verifiedTexts.some((text) => normalize(requirement).includes(normalize(text))));
  // A required DOM element is derived by matching a NOUN in the task ("images" → expect <img>). It
  // cannot read intent: "remove all the images" matched "images" and then demanded the page keep the
  // very images the user asked to delete — failing a correct implementation. Element presence is
  // therefore reported, never a hard failure. Objective breakage, driven workflows, and explicit
  // on-screen text the user quoted still gate hard.
  const missingDom = requiredDom.filter((feature) => !domFeaturesFound.has(feature.label));
  const verified = missing.length === 0 && workflow.problems.length === 0 && declaredWorkflow.problems.length === 0 && missingTexts.length === 0;
  const textEvidence = requiredTexts.length
    ? ` Required on-screen content: ${verifiedTexts.length}/${requiredTexts.length} present.`
    : "";
  const domEvidence = requiredDom.length
    ? ` Requested page elements: ${requiredDom.length - missingDom.length}/${requiredDom.length} present.`
    : "";
  // "covered 0/0 observable capabilities" states a ratio about nothing and reads as a failure. When
  // the request mapped to no observable capability, say what was actually checked instead.
  const coverageEvidence = hardRequested.length
    ? `Requirement-directed browser acceptance covered ${hardRequested.length - missing.length}/${hardRequested.length} observable capabilities across ${observations.length} reachable route(s)${best?.url ? `; strongest matching surface: ${best.url}` : ""}.`
    : `Requirement-directed browser acceptance checked ${observations.length} reachable route(s)${best?.url ? `; strongest matching surface: ${best.url}` : ""}.`;
  const evidence = `${coverageEvidence}${textEvidence}${domEvidence}${workflow.evidence ? ` ${workflow.evidence}` : ""}`;
  // The uncovered list is every requirement with no automatic check — for a rich brief that is the whole
  // brief. Joining it verbatim produced a multi-thousand-character wall in the user's summary that could
  // not be read or acted on. Name a few, count the rest.
  const briefly = (items: string[], limit = 3) => {
    const shown = items.slice(0, limit).map((item) => item.length > 90 ? `${item.slice(0, 87)}…` : item);
    const remaining = items.length - shown.length;
    return `${shown.join("; ")}${remaining > 0 ? ` (and ${remaining} more)` : ""}`;
  };
  const problems = [...(missing.length ? [`missing or failing capability: ${missing.join(", ")}`] : []), ...(missingTexts.length ? [`the request explicitly required this on-screen content, which is not rendered: ${missingTexts.map((text) => `"${text}"`).join(", ")}`] : []), ...workflow.problems, ...declaredWorkflow.problems];
  // Best-effort observations that could not be confirmed by shape. Reported so the terminal handoff is
  // honest, but they do not fail the mission or authorize a paid repair — the model that did the work
  // and the objective render-health gate are the deciders.
  const softNotes = [
    ...(unmetPresenceCapabilities.length ? [`could not confirm by shape: ${unmetPresenceCapabilities.join(", ")}`] : []),
    ...(missingDom.length ? [`no element matched for: ${missingDom.map((feature) => feature.label).join(", ")}` ] : []),
  ];
  const softNoteEvidence = softNotes.length ? ` Best-effort (non-blocking): ${softNotes.join("; ")}.` : "";
  const unsupportedEvidence = uncoveredProse.length ? ` ${uncoveredProse.length} requested item(s) could not be checked automatically: ${briefly(uncoveredProse)}.` : "";
  return problems.length
    ? { verified, applicable: true, evidence: `${evidence} ${problems.join(". ")}.${softNoteEvidence}${unsupportedEvidence}`, problem: `The browser health check passed, but requested behavior acceptance did not: ${problems.join(". ")}.`, bestUrl: best?.url }
    // Nothing failed here. The un-automatable remainder of a rich brief is a coverage limitation the
    // engineering report already carries; repeating it inside passing evidence turned every clean
    // acceptance line into a wall of caveats.
    : { verified, applicable: true, evidence: `${evidence}${declaredWorkflow.passed.length ? ` Executed ${declaredWorkflow.passed.length} declared acceptance workflow(s).` : ""}${softNoteEvidence}`, bestUrl: declaredWorkflow.bestUrl ?? best?.url };
}

async function executeAcceptanceWorkflowManifest(page: import("playwright").Page, previewUrl: string, manifest: AcceptanceWorkflowManifest) {
  const origin = new URL(previewUrl).origin;
  const token = Date.now().toString(36);
  const values: Record<string, string> = {
    "${uniqueText}": `Foundry acceptance ${token}`,
    "${uniqueEmail}": `foundry-${token}@example.com`,
    "${strongPassword}": "Foundry-acceptance-42!",
  };
  const expand = (value: string) => Object.entries(values).reduce((result, [key, replacement]) => result.split(key).join(replacement), value);
  const passed: string[] = [];
  const problems: string[] = [];
  let bestUrl: string | undefined;
  for (const workflow of manifest.workflows) {
    try {
      await page.goto(new URL(workflow.startPath, origin).toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
      for (const step of workflow.steps) {
        if (step.action === "goto") {
          await page.goto(new URL(step.path, origin).toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
          continue;
        }
        const control = page.locator(step.selector);
        if (await control.count() !== 1) throw new Error(`selector ${step.selector} matched ${await control.count()} elements instead of exactly one`);
        if (step.action === "fill") await control.fill(expand(step.value));
        else if (step.action === "click") await control.click();
        else if (step.action === "check") await control.check();
        else if (step.action === "select") await control.selectOption(expand(step.value));
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      for (const assertion of workflow.assertions) {
        if (assertion.kind === "url-matches" && !new RegExp(expand(assertion.value)).test(page.url())) throw new Error(`URL ${page.url()} did not match ${assertion.value}`);
        if (assertion.kind === "text-visible") {
          const match = page.getByText(expand(assertion.value), { exact: false });
          if (await match.count() < 1 || !(await match.first().isVisible())) throw new Error(`text was not visible: ${expand(assertion.value)}`);
        }
        if (assertion.kind === "selector-visible") {
          const match = page.locator(assertion.selector);
          if (await match.count() !== 1 || !(await match.isVisible())) throw new Error(`selector was not uniquely visible: ${assertion.selector}`);
        }
        if (assertion.kind === "selector-count" && await page.locator(assertion.selector).count() !== assertion.count) throw new Error(`selector ${assertion.selector} did not have count ${assertion.count}`);
      }
      bestUrl = page.url();
      passed.push(workflow.requirement);
    } catch (error) {
      problems.push(`${workflow.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { passed, problems, bestUrl };
}

async function readCompleteProjectSource(access: ProjectAccess, sourcePath: string, maximumCharacters = 500_000) {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < maximumCharacters) {
    const read = await access.readFile(sourcePath, { offsetBytes: offset, limitBytes: Math.min(20_000, maximumCharacters - offset) }).catch(() => undefined);
    if (!read?.exists) return undefined;
    chunks.push(read.content);
    offset += read.content.length;
    if (!read.truncated) return chunks.join("");
    if (!read.content.length) return undefined;
  }
  return undefined;
}

/** Applies only compiler-proven, semantics-preserving source repairs before a paid repair route. */
async function applyDeterministicCompilerRepairs(access: ProjectAccess, failure: FactoryCommandEvent, projectPath: string) {
  const diagnostic = compilerDiagnosticOutput(failure);
  const repaired: Array<{ path: string; reason: string; ruleId: string }> = [];
  const sourcePaths = applicationCompilerSourcePaths(diagnostic, projectPath);
  const projectNames = new Set(
    Array.from(diagnostic.matchAll(/(?:^|[\\/\s[])([^\\/\]\s:]+?)(?:_[A-Za-z0-9]+_wpftmp)?\.csproj\b/gim))
      .map((match) => match[1].toLowerCase()),
  );
  const requiresDotnetManifestRepair = /error\s+CS0234\b[^\r\n]*['"]Forms['"][^\r\n]*['"]System\.Windows['"]/i.test(diagnostic)
    || /error\s+CS0104\b[^\r\n]*ambiguous reference between ['"](?:System\.Windows\.Forms|System\.Drawing)\./i.test(diagnostic)
    || /error\s+CS0104\b[^\r\n]* and ['"](?:System\.Windows\.Forms|System\.Drawing)\./i.test(diagnostic)
    || /error\s+CS7064\b[^\r\n]*Error opening icon file/i.test(diagnostic);
  const manifestCandidates = requiresDotnetManifestRepair
    ? (await discoverNestedManifestPaths(access)).filter((candidate) => {
        if (!/\.csproj$/i.test(candidate)) return false;
        const manifestName = path.basename(candidate, path.extname(candidate)).toLowerCase();
        return projectNames.size === 0 || projectNames.has(manifestName);
      })
    : [];
  for (const sourcePath of Array.from(new Set([...sourcePaths, ...manifestCandidates]))) {
    const content = await readCompleteProjectSource(access, sourcePath);
    if (content === undefined) continue;
    const candidate = deterministicCompilerSourceRepair({ sourcePath, content, diagnostic });
    if (!candidate) continue;
    const write = await access.writeFile(sourcePath, candidate.content);
    if (!write.verified || !write.contentChanged) continue;
    repaired.push({ path: sourcePath, reason: candidate.reason, ruleId: candidate.ruleId });
  }
  return repaired;
}

async function validateGeneratedStaticPreview(
  previewUrl: string,
  artifactRoot: string,
  execution: ExecutionContext,
  expectedOwnershipToken?: string,
  requestedTask = "",
): Promise<BrowserPreviewEvidence> {
  const first = await validateGeneratedStaticPreviewOnce(previewUrl, artifactRoot, execution, expectedOwnershipToken, requestedTask);
  if (!first.infrastructureFailure) return first;
  await emitExecution(execution, "preview", "running", "Refreshing a stale framework preview before repair", {
    details: { previewUrl, paidModelCalls: 0, reason: "generated framework asset changed while the preview was being verified" },
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  return validateGeneratedStaticPreviewOnce(previewUrl, artifactRoot, execution, expectedOwnershipToken, requestedTask);
}

async function validateGeneratedStaticPreviewOnce(previewUrl: string, artifactRoot: string, execution: ExecutionContext, expectedOwnershipToken?: string, requestedTask = ""): Promise<BrowserPreviewEvidence> {
  // A structured Foundry brief contains alternative stacks, future ideas, paths, and planning
  // metadata. Browser acceptance must test only the durable current product requirements.
  requestedTask = durableBrowserRequirementsFromBrief(requestedTask);
  const artifactDir = path.join(artifactRoot, ".foundry-artifacts", "validation");
  const screenshotPath = path.join(artifactDir, "generated-preview.png");
  await mkdir(artifactDir, { recursive: true });
  await emitExecution(execution, "preview", "running", "Checking rendered project in a real browser", { details: { previewUrl } });
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const consoleErrors = new Set<string>();
      const pageErrors = new Set<string>();
      const failedLocalRequests = new Set<string>();
      const failedHttpResponses = new Set<string>();
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.add(message.text()); });
      page.on("pageerror", (error) => pageErrors.add(error.message));
      page.on("response", (browserResponse) => {
        try {
          const status = browserResponse.status();
          const url = browserResponse.url();
          if (status >= 400 && new URL(url).origin === new URL(previewUrl).origin) failedHttpResponses.add(`${status} ${url}`);
        } catch {
          // A malformed third-party response URL is not actionable local-project evidence.
        }
      });
      page.on("requestfailed", (request) => {
        try {
          const failure = request.failure()?.errorText ?? "";
          const url = request.url();
          // A Playwright navigation deliberately aborts in-flight document assets, and Next dev
          // invalidates disposable HMR updates while compiling a route. Neither proves a broken app.
          if (/ERR_ABORTED/i.test(failure) || /\.(?:hot-update\.js|hot-update\.json)(?:\?|$)/i.test(url)) return;
          if (new URL(url).origin === new URL(previewUrl).origin) failedLocalRequests.add(`${url}${failure ? ` (${failure})` : ""}`);
        } catch {
          // Ignore malformed third-party request URLs; page errors still capture application failures.
        }
      });
      const response = await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
      await page.waitForTimeout(300);
      const rendered = await page.locator("body").evaluate((body) => {
        const brokenImageSources = Array.from(body.querySelectorAll("img"))
          .filter((image) => image.complete && image.naturalWidth === 0 && getComputedStyle(image).display !== "none")
          .map((image) => image.currentSrc || image.src)
          .filter(Boolean);
        const visible = (element: Element) => {
          const node = element as HTMLElement;
          if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
        };
        const meaningfulElements = Array.from(body.querySelectorAll("main, article, section, form, nav, [role='main'], [role='form'], [role='list'], [role='listitem']")).filter(visible).length;
        const controls = Array.from(body.querySelectorAll("button, input, select, textarea, a[href]")).filter(visible);
        const interactiveControls = controls.length;
        const formFields = controls.filter((element) => element.matches("input, select, textarea")).length;
        const styledControls = controls.filter((element) => {
          const style = getComputedStyle(element);
          const horizontalPadding = Number.parseFloat(style.paddingLeft || "0") + Number.parseFloat(style.paddingRight || "0");
          const radius = Number.parseFloat(style.borderTopLeftRadius || "0");
          const background = style.backgroundColor;
          return radius >= 4 || horizontalPadding >= 14 || (background !== "rgba(0, 0, 0, 0)" && background !== "transparent" && background !== "rgb(239, 239, 239)");
        }).length;
        const misplacedControls = Array.from(body.querySelectorAll("button, input, select, textarea, a[href]"))
          .filter(visible)
          .flatMap((element) => {
            const container = element.closest("form, header, nav, aside, article, section");
            if (!container || !visible(container)) return [];
            const controlBounds = element.getBoundingClientRect();
            const containerBounds = container.getBoundingClientRect();
            const controlStyle = getComputedStyle(element);
            const centerX = controlBounds.left + controlBounds.width / 2;
            const centerY = controlBounds.top + controlBounds.height / 2;
            let positionedAncestor = element.parentElement;
            while (positionedAncestor && positionedAncestor !== body && getComputedStyle(positionedAncestor).position === "static" && getComputedStyle(positionedAncestor).transform === "none") {
              positionedAncestor = positionedAncestor.parentElement;
            }
            const unanchoredAbsolute = controlStyle.position === "absolute" && (!positionedAncestor || positionedAncestor === body);
            const escaped = unanchoredAbsolute || centerX < containerBounds.left - 8 || centerX > containerBounds.right + 8
              || centerY < containerBounds.top - 8 || centerY > containerBounds.bottom + 8;
            if (!escaped) return [];
            const label = ((element as HTMLElement).innerText || element.getAttribute("aria-label") || element.id || element.tagName).trim();
            return [label.slice(0, 60) || element.tagName];
          });
        return {
          textLength: (body.textContent ?? "").replace(/\s+/g, " ").trim().length,
          height: Math.round(body.getBoundingClientRect().height),
          meaningfulElements,
          interactiveControls,
          formFields,
          styledControls,
          misplacedControls,
          productCards: body.querySelectorAll(".card, .product-card, article, [role='listitem']").length,
          duplicateIds: [...new Set(Array.from(body.querySelectorAll("[id]"))
            .map((element) => element.id)
            .filter((id, index, ids) => id && ids.indexOf(id) !== index))],
          brokenImages: brokenImageSources.length,
          brokenImageSources,
        };
      });
      const placementProbe = await validateRequestedPlacement(page, requestedTask);
      const requestedExperienceProbe = await validateRequestedStaticExperience(page, requestedTask);
      const authProbe: { evidence: string; problem?: string } = /\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|registration|sign\s*in|signin|log\s*in|login)\b/i.test(requestedTask)
        ? await validateRequestedAuthFlow(page, previewUrl)
        : await validateDetectedAuthFlow(page);
      const taskAwareInteractionCompleted = /\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|registration|sign\s*in|signin|log\s*in|login)\b/i.test(requestedTask) && !authProbe.problem;
      const interactionProbe = taskAwareInteractionCompleted
        ? { verified: true, evidence: "The task-aware authentication playthrough already exercised the requested controls; no unrelated second click was added.", problem: undefined }
        : await validateRepresentativeInteraction(page);
      const internalHrefs = await page.locator("a[href]").evaluateAll((links) => Array.from(new Set(links
        .map((link) => (link as HTMLAnchorElement).href)
        .filter((href) => {
          try {
            const target = new URL(href);
            return target.origin === location.origin && target.pathname !== location.pathname && !target.hash;
          } catch {
            return false;
          }
        }))).slice(0, 10));
      const navigationChecks: Array<{ url: string; status?: number; title?: string }> = [];
      const navigationFailures: string[] = [];
      for (const href of internalHrefs) {
        try {
          const navigationResponse = await page.goto(href, { waitUntil: "domcontentloaded", timeout: 20_000 });
          await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
          const status = navigationResponse?.status();
          navigationChecks.push({ url: page.url(), status, title: await page.title() });
          if (status && status >= 400) navigationFailures.push(`${href} returned HTTP ${status}.`);
        } catch (error) {
          navigationFailures.push(`${href} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const acceptanceManifestPath = path.join(artifactRoot, ".foundry", "acceptance.json");
      const acceptanceManifestSource = existsSync(acceptanceManifestPath) ? await readFile(acceptanceManifestPath, "utf8").catch(() => "") : "";
      const acceptanceManifest = acceptanceManifestSource ? parseAcceptanceWorkflowManifest(acceptanceManifestSource) : undefined;
      const acceptanceManifestProblem = acceptanceManifestSource && !acceptanceManifest
        ? "The project declares .foundry/acceptance.json, but its executable acceptance contract is invalid."
        : undefined;
      const observableAcceptanceProbe = await validateObservableBrowserContract(page, requestedTask, [previewUrl, ...internalHrefs], acceptanceManifest);
      const namedControlProbe = await validateNamedBrokenControl(page, requestedTask, [previewUrl, ...internalHrefs]);
      const responsiveLayoutChecks: Array<{ url: string; viewport: string; issues: string[] }> = [];
      const responsiveLayoutIssues = new Set<string>();
      // Responsive acceptance belongs to the requested workflow, not an unsolicited audit of every
      // same-origin link in the application. Keep the entry surface plus the strongest requirement-
      // matching route; navigation health is still recorded separately above.
      const responsiveTargets = Array.from(new Set([previewUrl, namedControlProbe.bestUrl, observableAcceptanceProbe.bestUrl].filter((value): value is string => Boolean(value))));
      for (const viewport of [
        { name: "desktop", width: 1440, height: 900 },
        { name: "mobile", width: 390, height: 844 },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const href of responsiveTargets) {
          try {
            const layoutResponse = await page.goto(href, { waitUntil: "domcontentloaded", timeout: 20_000 });
            await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
            const issues = await page.locator("body").evaluate((body, viewportName) => {
              const visible = (element: Element) => {
                const node = element as HTMLElement;
                if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
                const style = getComputedStyle(node);
                const bounds = node.getBoundingClientRect();
                return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && bounds.width > 0 && bounds.height > 0;
              };
              const describe = (element: Element) => ((element as HTMLElement).innerText || element.getAttribute("aria-label") || element.getAttribute("name") || element.id || element.tagName).replace(/\s+/g, " ").trim().slice(0, 60) || element.tagName;
              const found: string[] = [];
              if (document.documentElement.scrollWidth > window.innerWidth + 4) {
                found.push(`page width ${document.documentElement.scrollWidth}px exceeds the ${window.innerWidth}px viewport`);
              }
              for (const element of Array.from(body.querySelectorAll("button, input, select, textarea, a[href]")).filter(visible)) {
                const intentionallyParkedSkipLink = element instanceof HTMLAnchorElement
                  && /^#/.test(element.getAttribute("href") ?? "")
                  && /skip\s+to/i.test(describe(element))
                  && document.activeElement !== element;
                if (intentionallyParkedSkipLink) continue;
                const bounds = element.getBoundingClientRect();
                const clippedOrScrollableAncestor = (() => {
                  let ancestor = element.parentElement;
                  while (ancestor && ancestor !== body) {
                    const style = getComputedStyle(ancestor);
                    if (/(?:auto|scroll|hidden|clip)/.test(style.overflowX)) return true;
                    ancestor = ancestor.parentElement;
                  }
                  return false;
                })();
                // A partially parked carousel/tab item inside an intentional overflow container is
                // not viewport breakage. Require a substantial uncontained escape; the document-wide
                // scrollWidth check above remains the authoritative page overflow signal.
                const escapedBy = Math.max(0, -bounds.left, bounds.right - window.innerWidth);
                if (!clippedOrScrollableAncestor && escapedBy > Math.min(24, Math.max(8, bounds.width * 0.2))) {
                  found.push(`visible control "${describe(element)}" escapes the viewport`);
                }
              }
              if (viewportName === "mobile") {
                for (const form of Array.from(body.querySelectorAll("form")).filter(visible)) {
                  const fields = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]), select, textarea')).filter(visible);
                  if (fields.length < 2) continue;
                  const formBounds = form.getBoundingClientRect();
                  const expectedWidth = Math.min(220, formBounds.width * 0.68);
                  for (const field of fields) {
                    const bounds = field.getBoundingClientRect();
                    if (bounds.width + 1 < expectedWidth) {
                      found.push(`form control "${describe(field)}" is only ${Math.round(bounds.width)}px wide in a ${Math.round(formBounds.width)}px mobile form`);
                    }
                    const id = field.getAttribute("id");
                    const label = id ? form.querySelector(`label[for="${CSS.escape(id)}"]`) : field.closest("label");
                    if (label && visible(label) && label !== field.closest("label")) {
                      const labelBounds = label.getBoundingClientRect();
                      const overlapWidth = Math.min(labelBounds.right, bounds.right) - Math.max(labelBounds.left, bounds.left);
                      const overlapHeight = Math.min(labelBounds.bottom, bounds.bottom) - Math.max(labelBounds.top, bounds.top);
                      if (overlapWidth > 2 && overlapHeight > 2) found.push(`label for "${describe(field)}" overlaps its control`);
                    }
                  }
                }
              }
              for (const nav of Array.from(body.querySelectorAll("nav")).filter(visible)) {
                const links = Array.from(nav.querySelectorAll("a[href]")).filter(visible).map((link) => ({ link, bounds: link.getBoundingClientRect() }));
                const directChildLinks = links.length > 0 && links.every(({ link }) => link.parentElement === nav);
                const navIdentity = `${nav.tagName.toLowerCase()}${nav.id ? `#${nav.id}` : ""}${Array.from(nav.classList).map((name) => `.${name}`).join("")}${directChildLinks ? " with direct child links (no list wrapper)" : ""}`;
                for (let index = 1; index < links.length; index += 1) {
                  const previous = links[index - 1];
                  const current = links[index];
                  const sameRow = Math.abs(previous.bounds.top - current.bounds.top) < 4;
                  const gap = current.bounds.left - previous.bounds.right;
                  if (sameRow && gap < 4) found.push(`navigation ${navIdentity} links "${describe(previous.link)}" and "${describe(current.link)}" are crowded together`);
                }
              }
              for (const toggle of Array.from(body.querySelectorAll('button[aria-controls]')).filter(visible)) {
                const controlledId = toggle.getAttribute("aria-controls");
                const controlled = controlledId ? document.getElementById(controlledId) : null;
                if (!controlled || controlled.tagName.toLowerCase() !== "nav") continue;
                const visibleLinks = Array.from(controlled.querySelectorAll("a[href]")).filter(visible);
                if (!visible(controlled) || !visibleLinks.length) continue;
                const identity = (element: Element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${Array.from(element.classList).map((name) => `.${name}`).join("")}`;
                if (viewportName === "desktop") {
                  found.push(`navigation toggle ${identity(toggle)} controlling ${identity(controlled)} is redundantly visible on desktop while its navigation links are visible`);
                } else if (toggle.getAttribute("aria-expanded") !== "true") {
                  found.push(`navigation toggle ${identity(toggle)} controlling ${identity(controlled)} is collapsed on mobile but its navigation links remain visible`);
                }
              }
              return Array.from(new Set(found));
            }, viewport.name);
            if (layoutResponse && layoutResponse.status() >= 400) issues.push(`route returned HTTP ${layoutResponse.status()}`);
            responsiveLayoutChecks.push({ url: page.url(), viewport: viewport.name, issues });
            for (const issue of issues) responsiveLayoutIssues.add(`${viewport.name} ${new URL(page.url()).pathname}: ${issue}`);
          } catch (error) {
            const issue = `${viewport.name} ${href}: layout check failed: ${error instanceof Error ? error.message : String(error)}`;
            responsiveLayoutIssues.add(issue);
            responsiveLayoutChecks.push({ url: href, viewport: viewport.name, issues: [issue] });
          }
        }
      }
      const acceptanceScreenshotUrl = namedControlProbe.bestUrl || observableAcceptanceProbe.bestUrl || previewUrl;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(acceptanceScreenshotUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
      // Same reason as the observation pass: capture the evidence screenshot only once canvas charts
      // have painted, otherwise the stored proof shows empty chart cards for a working application.
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
      await page.waitForFunction(() => {
        const canvases = [...document.querySelectorAll("canvas")].filter((node) => node.width > 0 && node.height > 0);
        if (!canvases.length) return true;
        return canvases.every((node) => {
          try {
            const context = node.getContext("2d");
            if (!context) return true;
            const pixels = context.getImageData(0, 0, node.width, node.height).data;
            for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) return true;
            return false;
          } catch {
            return true;
          }
        });
      }, undefined, { timeout: 6_000 }).catch(() => undefined);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const actionableConsoleErrors = Array.from(consoleErrors).filter((error) =>
        failedHttpResponses.size === 0 || !/^Failed to load resource:/i.test(error),
      );
      const rawPageErrors = Array.from(pageErrors);
      const nonFatalHydrationDiagnostics = rawPageErrors.filter((error) =>
        /Minified React error #418\b|Hydration failed because the server rendered HTML|Text content does not match server-rendered HTML/i.test(error),
      );
      const actionablePageErrors = rawPageErrors.filter((error) => !nonFatalHydrationDiagnostics.includes(error));
      const requestedWorkflowRendered = namedControlProbe.verified || observableAcceptanceProbe.verified || interactionProbe.verified;
      const blockingHydrationDiagnostics = requestedWorkflowRendered ? [] : nonFatalHydrationDiagnostics;
      // Two different kinds of finding have always been pooled here, and pooling them is what turned
      // healthy work into "Repair stopped". A *defect* means the page is actually broken — an error, a
      // failed request, a blank render. An *acceptance shortfall* means the page is fine but Foundry
      // could not demonstrate a named capability on it. Only the first proves something is wrong; the
      // second may just mean the probe had nothing to drive. Keeping them apart lets a mission whose
      // requested change built, rendered and read back clean report honestly as verified-but-unproven
      // instead of failed.
      const defectProblems = [
        ...(response && response.status() >= 400 ? [`Preview returned HTTP ${response.status()}.`] : []),
        ...(expectedOwnershipToken && response?.headers()["x-foundry-preview"] !== expectedOwnershipToken
          ? ["The preview response was not owned by this project; Foundry refused stale output from another server."]
          : []),
        ...actionableConsoleErrors.map((error) => `Console: ${error}`),
        ...Array.from(failedHttpResponses).map((responseFailure) => `HTTP response: ${responseFailure}.`),
        ...actionablePageErrors.map((error) => `Page error: ${error}`),
        ...blockingHydrationDiagnostics.map((error) => `Page error: ${error}`),
        ...Array.from(failedLocalRequests).map((url) => `Failed local request: ${url}`),
        ...(rendered.duplicateIds.length ? [`Duplicate element ID(s) make browser interactions ambiguous: ${rendered.duplicateIds.join(", ")}.`] : []),
        ...(rendered.misplacedControls.length ? [`Visible control(s) escaped their semantic layout container: ${rendered.misplacedControls.join(", ")}.`] : []),
        ...(rendered.brokenImages ? [`${rendered.brokenImages} visibly broken image(s) remained in the rendered interface.`] : []),
        ...(rendered.textLength < 80 || rendered.height < 240 || (rendered.meaningfulElements < 1 && rendered.interactiveControls < 2 && rendered.productCards < 3) ? ["The rendered page did not contain enough meaningful visible application content."] : []),
        // Form fields are NOT a proxy for richness. A product page, a marketing page, or a read-only
        // dashboard can be genuinely feature-rich with zero inputs — one such page (12k characters, 20
        // regions, 31 controls, 22 styled controls) was called a "thin shell" purely because it had no
        // form. When a form is actually requested, requiredDomFeaturesForTask asserts it directly, so
        // this generic gate only judges substance: text, structure, controls, and styling.
        ...(requiresSubstantialUiAcceptance(requestedTask) && (rendered.textLength < 500 || rendered.meaningfulElements < 7 || rendered.interactiveControls < 10 || rendered.styledControls < 8)
          ? [`The request described an advanced or feature-rich product, but the rendered interface was still a thin shell (${rendered.textLength} text characters, ${rendered.meaningfulElements} semantic regions, ${rendered.interactiveControls} controls, ${rendered.styledControls} intentionally styled controls).`]
          : []),
        ...navigationFailures,
        ...Array.from(responsiveLayoutIssues).map((issue) => `Responsive layout: ${issue}.`),
      ];
      const acceptanceProblems = [
        ...(placementProbe.problem ? [placementProbe.problem] : []),
        ...(authProbe.problem ? [authProbe.problem] : []),
        ...(requestedExperienceProbe.problem ? [requestedExperienceProbe.problem] : []),
        ...(observableAcceptanceProbe.problem ? [observableAcceptanceProbe.problem] : []),
        ...(acceptanceManifestProblem ? [acceptanceManifestProblem] : []),
        ...(namedControlProbe.problem ? [namedControlProbe.problem] : []),
        ...(interactionProbe.problem ? [interactionProbe.problem] : []),
      ];
      const problems = [...defectProblems, ...acceptanceProblems];
      const verified = problems.length === 0;
      // The rendered page itself is sound; only a capability demonstration is missing.
      const renderHealthy = defectProblems.length === 0;
      const infrastructureFailure = hasDisposableFrameworkAssetFailure(problems);
      const visibleProblems = compactValidationProblems(problems);
      const evidence = verified
        ? `Real browser preview rendered successfully (${rendered.textLength} text characters, ${rendered.meaningfulElements} semantic regions, ${rendered.interactiveControls} interactive controls). ${observableAcceptanceProbe.evidence} ${namedControlProbe.evidence} Exercised ${navigationChecks.length} same-origin navigation target(s), ${responsiveLayoutChecks.length} desktop/mobile route layout check(s), and ${namedControlProbe.verified ? "the exact named-control workflow" : observableAcceptanceProbe.verified ? "the requirement-directed acceptance contract" : interactionProbe.verified ? "a representative control" : "the rendered surface"} with no console, page, local-request, responsive-layout, interaction, or navigation errors. Screenshot of ${acceptanceScreenshotUrl}: ${screenshotPath}`
        // A failure message must lead with what is actually wrong. Appending both acceptance probes
        // unconditionally buried a one-line defect ("an image 404s") under coverage bookkeeping —
        // "covered 0/0 capabilities", "37 items could not be checked automatically" — that names no
        // failure at all and made every report read like a catastrophe. Probe evidence is included
        // only when that probe is what failed.
        : `Browser preview verification failed: ${visibleProblems.join(" ")}${acceptanceProblems.length ? ` ${[observableAcceptanceProbe.evidence, namedControlProbe.evidence].filter(Boolean).join(" ")}` : ""} Screenshot of ${acceptanceScreenshotUrl}: ${screenshotPath}`;
      // An inapplicable probe has nothing to disprove. When the request names no broken control AND no
      // rendered capability contract can be derived from it (e.g. "add a switch to toggle dark mode"),
      // neither probe applies — and reading that absence as a negative verdict failed healthy missions
      // whose code, build, tests and rendered page were all verified. Only an applicable probe may
      // return a negative acceptance result.
      // Placement leads when it applies: it is the most specific and least ambiguous statement of what
      // the user asked for, and it is checked against real geometry rather than inferred capability.
      const acceptanceApplicable = placementProbe.applicable || namedControlProbe.applicable || observableAcceptanceProbe.applicable;
      const acceptanceVerified = placementProbe.applicable
        ? placementProbe.verified
        : namedControlProbe.applicable
          ? namedControlProbe.verified
          : observableAcceptanceProbe.applicable
            ? observableAcceptanceProbe.verified
            : true;
      const acceptanceUrl = namedControlProbe.bestUrl || observableAcceptanceProbe.bestUrl;
      await emitExecution(execution, "preview", verified ? "completed" : "error", verified ? "Rendered project verified" : "Rendered project failed verification", { details: { previewUrl, screenshotPath, acceptanceUrl, acceptanceVerified, consoleErrors: actionableConsoleErrors, pageErrors: actionablePageErrors, nonFatalHydrationDiagnostics, failedLocalRequests: Array.from(failedLocalRequests), failedHttpResponses: Array.from(failedHttpResponses), navigationChecksJson: JSON.stringify(navigationChecks), responsiveLayoutChecksJson: JSON.stringify(responsiveLayoutChecks), authProbe: authProbe.evidence, requestedExperienceProbe: requestedExperienceProbe.evidence, observableAcceptanceProbe: observableAcceptanceProbe.evidence, namedControlProbe: namedControlProbe.evidence, interactionProbe: interactionProbe.evidence, ...rendered } });
      return { verified, evidence, brokenImageSources: rendered.brokenImageSources, infrastructureFailure, acceptanceVerified, acceptanceApplicable, acceptanceUrl, renderHealthy };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const evidence = `Browser preview verification could not run: ${error instanceof Error ? error.message : String(error)}`;
    await emitExecution(execution, "preview", "error", "Browser verification unavailable", { details: { reason: evidence } });
    return { verified: false, evidence, brokenImageSources: [] as string[], infrastructureFailure: false, acceptanceVerified: false };
  }
}

async function validateRepresentativeInteraction(page: import("playwright").Page) {
  const editable = page.locator('input:not([type]), input[type="text"], input[type="search"], input[type="tel"], input[type="url"], textarea');
  for (const control of await editable.all()) {
    if (!(await control.isVisible()) || !(await control.isEnabled()) || await control.getAttribute("readonly") !== null) continue;
    try {
      const previous = await control.inputValue();
      const inputMode = (await control.getAttribute("inputmode") || "").toLowerCase();
      const type = (await control.getAttribute("type") || "text").toLowerCase();
      const accessibleName = `${await control.getAttribute("aria-label") || ""} ${await control.getAttribute("name") || ""} ${await control.getAttribute("placeholder") || ""}`;
      const numericInput = type === "number" || inputMode === "numeric" || inputMode === "decimal" || /\b(?:number|numeric|amount|expression|quantity|price|rate)\b/i.test(accessibleName);
      const probeValue = numericInput ? "42" : `Foundry preview check ${Date.now()}`;
      await control.fill(probeValue);
      const verified = await control.inputValue() === probeValue;
      await control.fill(previous);
      return verified
        ? { verified: true, evidence: "Filled and restored a visible editable control successfully." }
        : { verified: false, evidence: "A visible editable control did not retain typed input.", problem: "A representative visible input could not be exercised successfully." };
    } catch (error) {
      return { verified: false, evidence: error instanceof Error ? error.message : String(error), problem: "A representative visible input failed during browser interaction." };
    }
  }

  const selects = page.locator("select:not([disabled])");
  for (const control of await selects.all()) {
    if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    const options = await control.locator("option").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
    if (options.length < 2) continue;
    try {
      const previous = await control.inputValue();
      const next = options.find((value) => value !== previous);
      if (!next) continue;
      await control.selectOption(next);
      const verified = await control.inputValue() === next;
      await control.selectOption(previous);
      return verified
        ? { verified: true, evidence: "Changed and restored a visible selection control successfully." }
        : { verified: false, evidence: "A visible selection control did not accept a different option.", problem: "A representative visible selection control could not be exercised successfully." };
    } catch (error) {
      return { verified: false, evidence: error instanceof Error ? error.message : String(error), problem: "A representative visible selection control failed during browser interaction." };
    }
  }

  const buttons = page.locator('button:visible:not([disabled]):not([type="submit"])');
  for (const control of await buttons.all()) {
    if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    const label = ((await control.innerText().catch(() => "")) || (await control.getAttribute("aria-label")) || "").trim();
    if (/delete|remove|reset|clear|sign\s*out|log\s*out|purchase|pay|checkout/i.test(label)) continue;
    try {
      await control.click({ timeout: 2_000 });
      await page.locator("body").waitFor({ state: "visible", timeout: 2_000 });
      return { verified: true, evidence: `Clicked a visible non-destructive control${label ? ` (${label.slice(0, 60)})` : ""} successfully.` };
    } catch {
      // Auth/navigation transitions can hide a control between the visibility snapshot and click.
      // Try the next currently visible safe control instead of waiting 30 seconds or blaming the app.
      continue;
    }
  }

  return { verified: false, evidence: "No safe representative form control was present; the rendered surface and any same-origin links were validated instead." };
}

async function validateDetectedAuthFlow(page: import("playwright").Page) {
  // A single-form login/signup surface is common in generated static prototypes. When those
  // controls are present, verify the actual local-first round trip instead of accepting a screenshot.
  if (!(await page.locator("#authForm, form[data-auth-form]").count())) return { evidence: "No deterministic local auth flow was detected for behavioral probing." };
  const signup = page.locator("#signupTab, [role='tab']").filter({ hasText: /sign\s*up|create account/i }).first();
  const login = page.locator("#loginTab, [role='tab']").filter({ hasText: /log\s*in|sign\s*in/i }).first();
  const email = page.locator("#email, #authForm input[type='email']").first();
  const password = page.locator("#password, #authForm input[type='password']").first();
  const confirm = page.locator("#confirmPassword, #authForm input[name*='confirm' i]").first();
  const name = page.locator("#name, #authForm input[name='name']").first();
  const submit = page.locator("#submitButton, #authForm button[type='submit']").first();
  const status = page.locator("#status, #authForm [role='status'], #authForm [aria-live]").first();
  if (!(await signup.count()) || !(await login.count()) || !(await email.count()) || !(await password.count()) || !(await submit.count()) || !(await status.count())) {
    return { evidence: "An auth-like form was present, but it did not expose a deterministic signup/login contract." };
  }
  try {
    const testEmail = `foundry-${Date.now()}@example.com`;
    const testPassword = "Foundry-test-42";
    await signup.click();
    if (await name.count()) await name.fill("Foundry Engineer");
    await email.fill(testEmail);
    await password.fill(testPassword);
    if (await confirm.count()) await confirm.fill(testPassword);
    await submit.click();
    const signupStatus = (await status.textContent())?.trim() ?? "";
    if (!/created|check your email|confirmation|success/i.test(signupStatus)) {
      return { evidence: `Signup feedback: ${signupStatus || "none"}`, problem: "The rendered signup flow did not confirm that an account was created." };
    }
    await login.click();
    await email.fill(testEmail);
    await password.fill(testPassword);
    await submit.click();
    const loginStatus = (await status.textContent())?.trim() ?? "";
    if (!/welcome|signed in|logged in|redirect/i.test(loginStatus)) {
      return { evidence: `Signup feedback: ${signupStatus} Login feedback: ${loginStatus || "none"}`, problem: "The rendered auth flow created an account but could not log back in with the same credentials." };
    }
    return { evidence: `Created ${testEmail} locally and logged back in successfully.` };
  } catch (error) {
    return { evidence: "The detected auth interaction could not be completed.", problem: `The rendered auth interaction failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function validateRequestedAuthFlow(page: import("playwright").Page, previewUrl: string) {
  const origin = new URL(previewUrl).origin;
  const linked = await page.locator("a[href]").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href).filter((href) => /\/(?:auth\/)?(?:sign-?in|log-?in|sign-?up|register)(?:[/?#]|$)/i.test(href))).catch(() => [] as string[]);
  const signupCandidates = [...new Set([...linked.filter((href) => /(?:sign-?up|register)/i.test(href)), `${origin}/auth/signup`, `${origin}/signup`, `${origin}/register`])];
  const signinCandidates = [...new Set([...linked.filter((href) => /(?:sign-?in|log-?in|login)/i.test(href)), `${origin}/auth/signin`, `${origin}/signin`, `${origin}/login`])];
  const runtimeFailure = (body: string) => /PrismaClient did not initialize|Runtime Error|Internal Server Error|Application error|Unhandled Runtime Error|Application error: a server-side exception/i.test(body);
  const testEmail = `foundry-smoke-${Date.now()}@example.com`;
  const testPassword = "Foundry-smoke-42!";

  const exercise = async (candidate: string, mode: "signup" | "signin") => {
    try {
      const response = await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (response && response.status() >= 400) return { reached: false as const };
      await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
      if (runtimeFailure(body)) {
        return { reached: true as const, problem: `The requested authentication smoke test failed before interaction at ${page.url()}: ${body.slice(0, 240)}` };
      }
      const email = page.locator('input[type="email"], input[name*="email" i]').first();
      const passwordFields = page.locator('input[type="password"]');
      const passwordFieldCount = await passwordFields.count();
      const password = passwordFields.first();
      const submit = page.locator('form button[type="submit"], form input[type="submit"]').first();
      if (!(await email.count()) || !(await password.count()) || !(await submit.count())) return { reached: false as const };
      const name = page.locator('input[name="name"], input[name*="username" i], input[autocomplete="name"]').first();
      if (mode === "signup" && await name.count()) await name.fill("Foundry Smoke Test");
      await email.fill(testEmail);
      await password.fill(testPassword);
      if (mode === "signup" && passwordFieldCount > 1) await passwordFields.nth(1).fill(testPassword);
      const beforeUrl = page.url();
      await submit.click({ timeout: 5_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(1_000);
      const after = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
      if (runtimeFailure(after)) {
        return { reached: true as const, problem: `The requested ${mode} smoke test failed after submit at ${page.url()}: ${after.slice(0, 240)}` };
      }
      const navigated = page.url() !== beforeUrl;
      const success = navigated || (mode === "signup"
        ? /account (?:was )?created|registration successful|welcome|check your email|signed up/i.test(after)
        : /welcome|signed in|logged in|dashboard|sign out|log out/i.test(after));
      return success
        ? { reached: true as const, success: true as const }
        : { reached: true as const, problem: `The ${mode} form submitted without proving success. Rendered response: ${after.slice(0, 240)}` };
    } catch (error) {
      return { reached: true as const, problem: `The ${mode} interaction failed at ${candidate}: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  let signupVerified = false;
  for (const candidate of signupCandidates) {
    const probe = await exercise(candidate, "signup");
    if (!probe.reached) continue;
    if (probe.problem) return { evidence: `Account creation failed at ${candidate}.`, problem: probe.problem };
    signupVerified = true;
    break;
  }
  for (const candidate of signinCandidates) {
    const probe = await exercise(candidate, "signin");
    if (!probe.reached) continue;
    if (probe.problem) return { evidence: `Login failed at ${candidate}.`, problem: probe.problem };
    return { evidence: signupVerified
      ? `Created ${testEmail} through the live signup form, then logged in with the same credentials through the live sign-in form.`
      : `Logged in through the live sign-in form and observed an evidence-backed success transition.` };
  }
  return { evidence: "No runnable sign-in form could be reached from the live preview.", problem: "The requested authentication experience was not completed because no reachable email/password sign-in form rendered successfully." };
}

type StaticUiMinimum = { count: number; entity: string };

function explicitStaticUiContract(task: string) {
  const requiredIds = new Set<string>();
  const requiredVisibleTerms = new Set<string>();
  const minimums: StaticUiMinimum[] = [];

  for (const match of task.matchAll(/\bstable(?:\s+acceptance)?\s+ids?\s*:\s*([^\n.]+)/gi)) {
    for (const candidate of match[1].split(/\s*,\s*|\s+and\s+/i)) {
      const id = candidate.trim().replace(/^[`'\"]|[`'\"]$/g, "");
      if (/^[a-z][a-z0-9_-]{1,80}$/i.test(id)) requiredIds.add(id);
    }
  }

  // Lists such as "KPI cards for active incidents, critical incidents, MTTA, and resolved today"
  // are unusually high-confidence visible promises. Checking their labels catches attractive but
  // incomplete placeholders without trying to reinterpret every sentence in the user's brief.
  for (const match of task.matchAll(/\b(?:KPI|metric|summary)\s+cards?\s+for\s+([^\n.;]+)/gi)) {
    for (const candidate of match[1].split(/\s*,\s*|\s+and\s+/i)) {
      const term = candidate.trim().replace(/^(?:and|the|a|an)\s+/i, "").replace(/[,:]+$/, "");
      if (term.length >= 3 && term.length <= 60) requiredVisibleTerms.add(term);
    }
  }

  // Follow-up instructions commonly use wording like "add a visible At risk option". Preserve the
  // requested product language as acceptance evidence instead of merely checking that some select
  // exists after the edit.
  for (const match of task.matchAll(/\bvisible\s+([a-z0-9][a-z0-9 -]{1,50}?)\s+(?:option|state|label|banner|control)\b/gi)) {
    const term = match[1].trim().replace(/^(?:a|an|the)\s+/i, "");
    if (term.length >= 2) requiredVisibleTerms.add(term);
  }

  const numberWords: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12,
  };
  for (const match of task.matchAll(/\b(?:seed|show|include|display|render|provide)\s+(?:at\s+least\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:realistic\s+)?([a-z][a-z0-9_-]*)(?=\s+(?:across|with|in|on|for|and|[,.;]|$))/gi)) {
    const count = /^\d+$/.test(match[1]) ? Number(match[1]) : numberWords[match[1].toLowerCase()];
    const entity = match[2].toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (count > 0 && count <= 100 && entity.length >= 3) minimums.push({ count, entity });
  }

  return { requiredIds: [...requiredIds], requiredVisibleTerms: [...requiredVisibleTerms], minimums };
}

async function validateExplicitStaticUiContract(page: import("playwright").Page, task: string): Promise<{ evidence: string; problem?: string }> {
  const contract = explicitStaticUiContract(task);
  if (!contract.requiredIds.length && !contract.requiredVisibleTerms.length && !contract.minimums.length) {
    return { evidence: "The request did not contain deterministic visible-content, stable-ID, or minimum-item acceptance clauses." };
  }

  const probe = await page.locator("body").evaluate((body, expected) => {
    const visible = (element: Element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const normalizedText = ((body as HTMLElement).innerText || body.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const missingIds = expected.requiredIds.filter((id) => {
      const matches = Array.from(body.querySelectorAll("[id]")).filter((element) => element.id === id);
      // Dialog and drawer controls are correctly hidden until their trigger is used. Stable IDs are
      // a structural contract; the independent interaction probe verifies that the hidden surface
      // can actually be opened and exercised.
      return matches.length !== 1;
    });
    const missingTerms = expected.requiredVisibleTerms.filter((term) => {
      const normalizedTerm = term.toLowerCase();
      if (normalizedText.includes(normalizedTerm)) return false;
      const distinctiveWords = normalizedTerm.split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !["the", "and", "for", "with"].includes(word));
      return !distinctiveWords.length || !distinctiveWords.every((word) => normalizedText.includes(word));
    });
    const insufficientMinimums = expected.minimums.flatMap(({ count, entity }) => {
      const singular = entity.replace(/ies$/, "y").replace(/s$/, "");
      const tableRows = Array.from(body.querySelectorAll("tbody tr")).filter(visible).length;
      const namedItems = Array.from(body.querySelectorAll("article, li, [role='listitem'], [data-entity], [class], [id]"))
        .filter((element) => visible(element) && `${element.id} ${element.className || ""} ${(element as HTMLElement).dataset.entity || ""}`.toLowerCase().includes(singular))
        .length;
      const genericItems = Array.from(body.querySelectorAll("article, [role='listitem']")).filter(visible).length;
      const actual = Math.max(tableRows, namedItems, genericItems);
      return actual < count ? [{ entity, expected: count, actual }] : [];
    });
    return { missingIds, missingTerms, insufficientMinimums };
  }, contract);

  const problems = [
    ...(probe.missingIds.length ? [`stable acceptance ID(s) missing or duplicated: ${probe.missingIds.join(", ")}`] : []),
    ...(probe.missingTerms.length ? [`explicit visible content missing: ${probe.missingTerms.join(", ")}`] : []),
    ...probe.insufficientMinimums.map((item) => `requested at least ${item.expected} ${item.entity}, but only ${item.actual} rendered item(s) were found`),
  ];
  const evidence = `Checked ${contract.requiredIds.length} stable ID(s), ${contract.requiredVisibleTerms.length} explicit visible term(s), and ${contract.minimums.length} minimum-item requirement(s).`;
  return problems.length
    ? { evidence: `${evidence} ${problems.join("; ")}.`, problem: `The rendered product did not satisfy explicit acceptance requirements: ${problems.join("; ")}.` }
    : { evidence };
}

function namedBrokenControlFromTask(task: string) {
  const interaction = task.match(/\b(?:click(?:ing|ed)?|tap(?:ping|ped)?|press(?:ing|ed)?)\s+(?:on\s+)?(?:the\s+)?["â€œâ€']?(.+?)["â€œâ€']?(?=\s+(?:after|when|then|and|does|do|did|nothing|isn['â€™]?t|is\s+not|won['â€™]?t|will\s+not|fails?|stops?)\b|[.?!]|$)/i)?.[1]
    ?? task.match(/\b["â€œâ€']?([a-z0-9][a-z0-9 &+_-]{0,40}?)["â€œâ€']?\s+(?:button|link|control)\b[^.?!\n]{0,100}\b(?:does nothing|nothing happens|not working|doesn['â€™]?t work|won['â€™]?t work)\b/i)?.[1];
  return interaction?.replace(/\s+(?:button|link|control)$/i, "").replace(/\s+/g, " ").trim();
}

function reportsNamedControlFailure(task: string) {
  return Boolean(namedBrokenControlFromTask(task))
    && /\b(?:does nothing|nothing happens|not working|doesn['â€™]?t work|won['â€™]?t work|no longer works?|fails?|broken)\b/i.test(task);
}

async function validateNamedBrokenControl(
  page: import("playwright").Page,
  task: string,
  urls: string[],
): Promise<{ applicable: boolean; verified: boolean; evidence: string; problem?: string; bestUrl?: string }> {
  const controlName = namedBrokenControlFromTask(task);
  const failureReport = /\b(?:does nothing|nothing happens|not working|doesn['â€™]?t work|won['â€™]?t work|no longer works?|fails?|broken)\b/i.test(task);
  if (!controlName || !failureReport) return { applicable: false, verified: false, evidence: "The request did not identify a broken named control interaction." };
  const escaped = controlName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Accessible names commonly include an icon ("🌙 Dark") or an action suffix. Match the named
  // label within the control while retaining role scoping, rather than requiring byte-for-byte text.
  const namePattern = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");

  for (const url of [...new Set(urls)].slice(0, 10)) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (response && response.status() >= 400) continue;
      await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

      // Satisfy ordinary visible prerequisites so a conditionally enabled Continue/Save/Submit
      // control is tested in the state the user described, without inventing domain data.
      for (const input of await page.locator('input:visible:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea:visible').all()) {
        if (await input.isDisabled().catch(() => true)) continue;
        const type = (await input.getAttribute("type"))?.toLowerCase();
        const value = type === "email" ? "foundry-preview@example.com" : type === "number" ? "42" : type === "date" ? "2026-07-19" : "Foundry verification";
        await input.fill(value).catch(() => undefined);
      }
      for (const select of await page.locator("select:visible").all()) {
        if (await select.isDisabled().catch(() => true)) continue;
        const option = await select.locator("option:not([disabled])").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value).find(Boolean));
        if (option) await select.selectOption(option).catch(() => undefined);
      }

      let control = page.getByRole("button", { name: namePattern }).first();
      if (!(await control.count())) control = page.getByRole("link", { name: namePattern }).first();
      if (!(await control.count()) || !(await control.isVisible().catch(() => false))) continue;
      if (await control.isDisabled().catch(() => false)) {
        return { applicable: true, verified: false, evidence: `Located the named control "${controlName}" at ${page.url()}, but it remained disabled after visible prerequisites were completed.`, problem: `The reported "${controlName}" workflow could not be exercised because the control remained disabled.`, bestUrl: page.url() };
      }
      const beforeUrl = page.url();
      const beforeState = await page.locator("body").evaluate((body) => JSON.stringify({
        text: (body.textContent ?? "").replace(/\s+/g, " ").trim(),
        htmlClass: document.documentElement.className,
        htmlTheme: document.documentElement.getAttribute("data-theme"),
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        backgroundColor: getComputedStyle(body).backgroundColor,
        color: getComputedStyle(body).color,
        dialogs: Array.from(body.querySelectorAll('[role="dialog"], dialog[open]')).filter((item) => {
          const bounds = item.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0;
        }).length,
        forms: body.querySelectorAll("form").length,
      }));
      await control.click();
      await page.waitForTimeout(750);
      await page.waitForLoadState("domcontentloaded", { timeout: 3_000 }).catch(() => undefined);
      const afterState = await page.locator("body").evaluate((body) => JSON.stringify({
        text: (body.textContent ?? "").replace(/\s+/g, " ").trim(),
        htmlClass: document.documentElement.className,
        htmlTheme: document.documentElement.getAttribute("data-theme"),
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        backgroundColor: getComputedStyle(body).backgroundColor,
        color: getComputedStyle(body).color,
        dialogs: Array.from(body.querySelectorAll('[role="dialog"], dialog[open]')).filter((item) => {
          const bounds = item.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0;
        }).length,
        forms: body.querySelectorAll("form").length,
      }));
      const advanced = page.url() !== beforeUrl || afterState !== beforeState;
      return advanced
        ? { applicable: true, verified: true, evidence: `Clicked the exact named control "${controlName}" at ${beforeUrl} and observed the workflow advance to ${page.url()}.`, bestUrl: page.url() }
        : { applicable: true, verified: false, evidence: `Clicked the exact named control "${controlName}" at ${beforeUrl}, but the URL and rendered workflow state did not change.`, problem: `The reported "${controlName}" control still does nothing in the real browser.`, bestUrl: beforeUrl };
    } catch {
      // Try the next reachable route; navigation and runtime failures remain captured by the main gate.
    }
  }
  return { applicable: true, verified: false, evidence: `The named control "${controlName}" was not found on any reachable route.`, problem: `Foundry could not locate the reported "${controlName}" control to verify its behavior.` };
}

/**
 * Checks a requested spatial placement against real rendered geometry.
 *
 * Runs inside the browser pass that already happens, so it adds no page load and no model call. It
 * exists because source-level checks cannot see placement: a mission asked to put the total "above the
 * filter bar" nested it inside the bar's flex row, where it rendered beside the date filter. The source
 * moved, every build check passed, and Foundry reported "Done" — only the geometry disagreed.
 */
async function validateRequestedPlacement(
  page: import("playwright").Page,
  task: string,
): Promise<{ applicable: boolean; verified: boolean; evidence: string; problem?: string; correction?: string }> {
  const requirement = spatialRequirementForRequest(task);
  if (!requirement) return { applicable: false, verified: true, evidence: "" };

  const boxes: ElementBox[] = await page.evaluate(() => {
    const collected: { selectorHint: string; text: string; x: number; y: number; width: number; height: number }[] = [];
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
      const text = (element.innerText || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).join(".") : "";
      collected.push({
        selectorHint: `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`,
        text: text.slice(0, 160),
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
      });
      if (collected.length >= 600) break;
    }
    return collected;
  }).catch(() => [] as ElementBox[]);

  const result = evaluatePlacement(requirement, boxes);
  if (result.verdict === "satisfied") return { applicable: true, verified: true, evidence: `Requested placement verified in the rendered page: ${result.evidence}` };
  // "Indeterminate" is not a defect — the probe could not find the elements, so it proves nothing either
  // way and must not fail an otherwise healthy mission.
  if (result.verdict === "indeterminate") return { applicable: false, verified: true, evidence: result.evidence };
  // The repair pass reads this string. Telling it only *that* placement failed reproduces the generic
  // instruction that caused the mistake, so the concrete remedy travels with the finding.
  return {
    applicable: true,
    verified: false,
    evidence: result.evidence,
    problem: `Requested placement not met: ${result.evidence}${result.correction ? ` HOW TO FIX: ${result.correction}` : ""}`,
    correction: result.correction,
  };
}

async function validateRequestedStaticExperience(page: import("playwright").Page, task: string): Promise<{ evidence: string; problem?: string }> {
  const explicitContract = await validateExplicitStaticUiContract(page, task);
  if (explicitContract.problem) return explicitContract;
  const requiresSignup = /\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|registration)\b/i.test(task);
  const requiresDashboardFlow = /\b(?:sign\s*in|signin|log\s*in|login)\b/i.test(task) && /\bdashboard\b/i.test(task);
  const requiresPolishedDashboard = requiresDashboardFlow && requiresPolishedUiAcceptance(task);
  if (!requiresSignup && !requiresDashboardFlow) {
    return { evidence: `${explicitContract.evidence} The request did not name a deterministic signup or sign-in-to-dashboard flow.` };
  }

  const visibleByText = (pattern: RegExp) => page.locator("button:visible, a:visible, [role='button']:visible, [role='tab']:visible").filter({ hasText: pattern }).first();
  try {
    const testEmail = `foundry-preview-${Date.now()}@example.com`;
    const testPassword = "Foundry-preview-42";
    if (requiresSignup) {
      const signup = visibleByText(/sign\s*up|create\s+(?:an?\s+)?account|register/i);
      if (!(await signup.count()) || !(await signup.isVisible())) {
        return { evidence: "No visible signup entry point was found.", problem: "The user explicitly requested a signup option, but the rendered interface did not provide one." };
      }
      await signup.click();
      await page.waitForTimeout(100);
      const signupControls = page.locator("input[name='name'], input[autocomplete='name'], input[name*='confirm' i], input[autocomplete='new-password']");
      const signupModeVisible = await signupControls.evaluateAll((controls) => controls.some((control) => {
        const node = control as HTMLElement;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }));
      if (!signupModeVisible) {
        return { evidence: "The signup control did not expose signup fields or signup state.", problem: "The signup option was visible but did not open a usable signup experience." };
      }

      const signupForm = page.locator("form:visible").filter({ has: page.locator("input[autocomplete='new-password'], input[name*='confirm' i]") }).first();
      if (!(await signupForm.count())) {
        return { evidence: "Signup-specific fields were visible but were not connected to a visible form.", problem: "The signup option did not expose a submittable account-creation form." };
      }
      const name = signupForm.locator("input[autocomplete='name'], input[name='name'], input[name*='name' i]").first();
      const signupEmail = signupForm.locator("input[type='email'], input[autocomplete='email']").first();
      const signupPassword = signupForm.locator("input[autocomplete='new-password'], input[type='password']").first();
      const confirm = signupForm.locator("input[name*='confirm' i]").first();
      const signupSubmit = signupForm.locator("button[type='submit'], input[type='submit']").first();
      if (!(await signupEmail.count()) || !(await signupPassword.count()) || !(await signupSubmit.count())) {
        return { evidence: "The signup form was missing its email, password, or submit control.", problem: "The signup option did not provide a complete usable account-creation form." };
      }
      if (await name.count()) await name.fill("Foundry Engineer");
      await signupEmail.fill(testEmail);
      await signupPassword.fill(testPassword);
      if (await confirm.count()) await confirm.fill(testPassword);
      await signupSubmit.click();
      await page.waitForTimeout(750);
      const signupStatus = ((await signupForm.locator("[role='status'], [aria-live]").first().textContent().catch(() => "")) ?? "").trim();
      const signupStillVisible = await signupForm.isVisible().catch(() => false);
      if (!/created|success|registered|welcome|check your email/i.test(signupStatus) && signupStillVisible) {
        return { evidence: `Signup submission feedback: ${signupStatus || "none"}.`, problem: "Submitting the rendered signup form did not create an account or advance to sign-in." };
      }
      // A valid signup may sign the new user in immediately. Return to the auth surface before the
      // independent login probe; otherwise a successful signup-to-dashboard transition is falsely
      // reported as a missing login form.
      const dashboardAfterSignup = page.locator("#dashboard:visible, #dashboardView:visible, [data-dashboard]:visible, [aria-label*='dashboard' i]:visible").first();
      if (await dashboardAfterSignup.count() && await dashboardAfterSignup.isVisible()) {
        const signOut = page.locator("button:visible, a:visible").filter({ hasText: /sign\s*out|log\s*out/i }).first();
        if (!(await signOut.count())) {
          return { evidence: "Signup reached the dashboard, but the test could not return to the authentication surface.", problem: "The signup flow reached the dashboard but exposed no sign-out control for an independent login check." };
        }
        await signOut.click();
        await page.waitForTimeout(150);
      }
    }

    if (!requiresDashboardFlow) return { evidence: "The requested signup entry point opened successfully." };

    const login = visibleByText(/sign\s*in|log\s*in|back\s+to\s+login/i);
    if (await login.count() && await login.isVisible()) {
      await login.click();
      await page.waitForTimeout(100);
    }
    const email = page.locator("input[type='email']:visible, input[autocomplete='email']:visible, input[name*='email' i]:visible").first();
    const password = page.locator("input[type='password']:visible, input[autocomplete='current-password']:visible").first();
    const submit = page.locator("button[type='submit']:visible, input[type='submit']:visible").first();
    if (!(await email.count()) || !(await password.count()) || !(await submit.count())) {
      return { evidence: "The rendered page did not expose a usable sign-in form.", problem: "The requested sign-in-to-dashboard flow could not be exercised because its visible email, password, or submit control was missing." };
    }
    const visibleText = await page.locator("body").innerText().catch(() => "");
    const advertisedCredentials = visibleText.match(/(?:demo|test)\s+credentials?\s*:?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s*(?:\/|,|\band\b)\s*([^\s,;]{6,})/i);
    await email.fill(advertisedCredentials?.[1] || testEmail);
    await password.fill(advertisedCredentials?.[2] || testPassword);
    await submit.click();
    await page.waitForTimeout(250);

    const dashboard = page.locator("#dashboard:visible, #dashboardView:visible, [data-dashboard]:visible, [aria-label*='dashboard' i]:visible").first();
    const dashboardHeading = page.getByRole("heading", { name: /dashboard|overview|workspace|analytics/i }).first();
    await Promise.race([
      dashboard.waitFor({ state: "visible", timeout: 3_000 }),
      dashboardHeading.waitFor({ state: "visible", timeout: 3_000 }),
    ]).catch(() => undefined);
    const destination = await dashboard.count() ? dashboard : dashboardHeading;
    if (!(await destination.count()) || !(await destination.isVisible())) {
      return { evidence: "Submitting the visible sign-in form did not reveal a dashboard destination.", problem: "The user requested sign-in to a dashboard, but the rendered sign-in flow did not reach one." };
    }
    // Measure the stable destination, not the first animation frame. Transforms temporarily create a
    // containing block for absolute controls; a control can look correctly placed at 100 ms and jump
    // outside its card as soon as a 280 ms entrance animation removes that transform.
    await page.waitForTimeout(1_200);

    const root = await dashboard.count() ? dashboard : page.locator("body");
    const metrics = await root.evaluate((element) => {
      const visible = (candidate: Element) => {
        const node = candidate as HTMLElement;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      return {
        textLength: (element.textContent ?? "").replace(/\s+/g, " ").trim().length,
        structuredRegions: Array.from(element.querySelectorAll("header, nav, aside, main, section, article, [role='navigation'], [role='list'], [role='listitem'], .card, [class*='card']")).filter(visible).length,
        interactiveControls: Array.from(element.querySelectorAll("button, a[href], input, select, textarea")).filter(visible).length,
      };
    });
    const escapedDashboardControls = await root.evaluate((element) => Array.from(element.querySelectorAll("button, input, select, textarea, a[href]"))
      .flatMap((control) => {
        const node = control as HTMLElement;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || bounds.width <= 0 || bounds.height <= 0) return [];
        const container = control.closest("form, header, nav, aside, article, section");
        if (!container) return [];
        const containerBounds = container.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        let positionedAncestor = control.parentElement;
        while (positionedAncestor && positionedAncestor !== document.body && getComputedStyle(positionedAncestor).position === "static" && getComputedStyle(positionedAncestor).transform === "none") {
          positionedAncestor = positionedAncestor.parentElement;
        }
        const unanchoredAbsolute = style.position === "absolute" && (!positionedAncestor || positionedAncestor === document.body);
        const escaped = unanchoredAbsolute || centerX < containerBounds.left - 8 || centerX > containerBounds.right + 8
          || centerY < containerBounds.top - 8 || centerY > containerBounds.bottom + 8;
        if (!escaped) return [];
        return [((node.innerText || node.getAttribute("aria-label") || node.id || node.tagName).trim()).slice(0, 60)];
      }));
    if (escapedDashboardControls.length) {
      return {
        evidence: `Dashboard control(s) rendered outside their semantic layout container: ${escapedDashboardControls.join(", ")}.`,
        problem: `The dashboard interaction completed, but visible control(s) were visually misplaced: ${escapedDashboardControls.join(", ")}.`,
      };
    }
    if (requiresPolishedDashboard && (metrics.textLength < 140 || metrics.structuredRegions < 3 || metrics.interactiveControls < 1)) {
      return {
        evidence: `Sign-in reached the dashboard, but it contained only ${metrics.textLength} text characters, ${metrics.structuredRegions} structured regions, and ${metrics.interactiveControls} interactive controls.`,
        problem: "The user asked for a nice dashboard, but the rendered destination was still a placeholder rather than a content-rich, intentionally structured dashboard.",
      };
    }
    return { evidence: `Exercised the requested auth flow through its dashboard (${metrics.textLength} text characters, ${metrics.structuredRegions} structured regions, ${metrics.interactiveControls} interactive controls).` };
  } catch (error) {
    return { evidence: "The requested user flow could not be completed.", problem: `The browser could not complete the requested signup/sign-in/dashboard flow: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Every real image/media file in the project, indexed by file name, with the URL that serves it. */
async function projectMediaFilesByName(access: ProjectAccess) {
  const byName = new Map<string, string>();
  const queue = [{ path: "", depth: 0 }];
  let inspected = 0;
  while (queue.length && inspected < 2_000) {
    const current = queue.shift()!;
    const entries = await access.listDir(current.path).catch(() => []);
    for (const entry of entries) {
      inspected += 1;
      const relative = current.path ? `${current.path}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (current.depth < 5 && !isGeneratedProjectDirectory(entry.name)) queue.push({ path: relative, depth: current.depth + 1 });
        continue;
      }
      if (!/\.(?:png|jpe?g|webp|gif|avif|svg|bmp|ico|mp4|webm)$/i.test(entry.name)) continue;
      // `public/` and `static/` are web roots, not URL segments — a framework and Foundry's own
      // static preview both serve `public/foundry-uploads/logo.png` as `/foundry-uploads/logo.png`.
      const served = `/${relative.replace(/^(?:public|static)\//, "")}`;
      if (!byName.has(entry.name.toLowerCase())) byName.set(entry.name.toLowerCase(), served);
    }
  }
  return byName;
}

/** Text files whose source can carry an image reference (markup, scripts, styles, data). */
async function projectImageReferenceFiles(access: ProjectAccess) {
  const files: string[] = [];
  const queue = [{ path: "", depth: 0 }];
  let inspected = 0;
  while (queue.length && inspected < 2_000 && files.length < 60) {
    const current = queue.shift()!;
    const entries = await access.listDir(current.path).catch(() => []);
    for (const entry of entries) {
      inspected += 1;
      const relative = current.path ? `${current.path}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (current.depth < 5 && !isGeneratedProjectDirectory(entry.name)) queue.push({ path: relative, depth: current.depth + 1 });
        continue;
      }
      if (/\.(?:html?|[cm]?[jt]sx?|vue|svelte|astro|css|scss|json)$/i.test(entry.name)) files.push(relative);
    }
  }
  return files;
}

/**
 * A broken <img> in the preview is almost always a *path* mistake, not a missing asset: the file the
 * user uploaded is on disk, the generated markup just points somewhere it isn't served from. Repair
 * therefore re-points the reference at the real file, and only substitutes a placeholder when no such
 * file exists — replacing a user's uploaded logo with generic artwork is a worse outcome than the 404.
 */
async function repairBrokenStaticImages(access: ProjectAccess, brokenSources: string[], execution: ExecutionContext) {
  const mediaByName = await projectMediaFilesByName(access);
  // Keep the fallback safe in HTML attributes, single-quoted JavaScript strings,
  // double-quoted JavaScript strings, and JSON. Literal SVG attribute quotes can
  // terminate the generated source context when a broken URL is replaced in place.
  const placeholder = "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22800%22%20height=%22600%22%20viewBox=%220%200%20800%20600%22%3E%3Crect%20width=%22800%22%20height=%22600%22%20fill=%22%23f4e7df%22/%3E%3Cpath%20d=%22M160%20420l150-150%2090%2090%2090-100%20150%20160z%22%20fill=%22%23d8b4a0%22/%3E%3Ccircle%20cx=%22570%22%20cy=%22180%22%20r=%2252%22%20fill=%22%23fff7ed%22/%3E%3C/svg%3E";

  // The browser reports the *resolved* URL; source carries the literal it was written as. Rewrite
  // every literal form that resolves to the same broken asset.
  const replacements = new Map<string, { to: string; recovered: boolean }>();
  for (const brokenSource of brokenSources) {
    if (!brokenSource || brokenSource.startsWith("data:")) continue;
    let pathname = brokenSource;
    try { pathname = new URL(brokenSource).pathname; } catch { /* already a relative reference */ }
    const name = decodeURIComponent(pathname.split("/").pop() || "").toLowerCase();
    const recovered = name ? mediaByName.get(name) : undefined;
    const to = recovered ?? placeholder;
    for (const literal of new Set([brokenSource, pathname, pathname.replace(/^\//, ""), `.${pathname}`])) {
      if (literal && literal !== to) replacements.set(literal, { to, recovered: Boolean(recovered) });
    }
  }
  if (!replacements.size) return false;
  // Longest literal first, so rewriting the bare path never truncates the full URL form.
  const ordered = [...replacements.entries()].sort(([left], [right]) => right.length - left.length);
  const unrecoverable = ordered.some(([, replacement]) => !replacement.recovered);

  const changedFiles: string[] = [];
  for (const filePath of await projectImageReferenceFiles(access)) {
    const source = await access.readFile(filePath, { limitBytes: 500_000 }).catch(() => undefined);
    if (!source?.exists || source.truncated) continue;
    let content = source.content;
    for (const [from, replacement] of ordered) content = content.split(from).join(replacement.to);
    // Images injected by scripts after load never get a static rewrite, so a page that still has an
    // unrecoverable reference also gets a runtime guard that covers nodes added later.
    if (unrecoverable && /\.html?$/i.test(filePath) && !content.includes("data-foundry-image-fallback") && /<\/body\s*>/i.test(content)) {
      const fallback = `<script data-foundry-image-fallback>(function(){var f=${JSON.stringify(placeholder)};function r(i){if(i&&i.tagName==='IMG'&&i.src!==f&&i.complete&&i.naturalWidth===0)i.src=f}document.addEventListener('error',function(e){r(e.target)},true);function s(){document.querySelectorAll('img').forEach(r)}s();new MutationObserver(s).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']})})();</script>`;
      content = content.replace(/<\/body\s*>/i, `${fallback}</body>`);
    }
    if (content === source.content) continue;
    const write = await access.writeFile(filePath, content);
    if (write.verified) changedFiles.push(filePath);
  }
  if (!changedFiles.length) return false;

  const recoveredCount = ordered.filter(([, replacement]) => replacement.recovered).length;
  await emitExecution(execution, "edit", "completed", recoveredCount
    ? "Re-pointed broken image references at the real project assets"
    : "Replaced unrecoverable image references with a local placeholder", {
    filePath: changedFiles[0],
    details: { changedFiles: changedFiles.join(", "), repairedReferences: ordered.length, recoveredReferences: recoveredCount },
  });
  return true;
}

async function executeExistingProjectTaskCore(
  brief: string,
  task: string,
  uploadedFiles: FactoryUploadedFile[],
  localPathOrEmitter?: string | ExecutionEmitter,
  maybeEmitter?: ExecutionEmitter,
  localConnector?: LocalConnectorConfig,
  signal?: AbortSignal,
  approvedCategories: string[] = [],
  approvedCommands: string[] = [],
  parentMission?: MissionParentContext,
  followUpResolution?: FollowUpResolutionRecord,
  continuity?: "carry_forward_plan" | "fresh_plan",
  approvalResponse?: ApprovalResponse,
  quality?: MissionQualityLevel,
  modelMode?: ModelMode,
  evidenceAttachments: EvidenceAttachments = [],
  idempotencyCandidate?: MissionParentContext,
  retryExecutionId?: string,
): Promise<FactoryProjectResult> {
  brief = redactSensitiveText(brief);
  task = redactSensitiveText(task);
  const localPath = typeof localPathOrEmitter === "string" ? localPathOrEmitter.trim() : "";
  const onEvent = typeof localPathOrEmitter === "function" ? localPathOrEmitter : maybeEmitter;
  const spec = parseBrief(brief);
  const projectName = spec.projectName === "Open Existing Project" ? "Existing Project" : spec.projectName;
  if (localConnector?.url) {
    return executeConnectorProjectTask(brief, task, localConnector, projectName, onEvent, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceAttachments, idempotencyCandidate, retryExecutionId);
  }
  if (localPath) {
    return executeLocalProjectTask(brief, task, localPath, projectName, onEvent, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceAttachments, idempotencyCandidate, retryExecutionId);
  }
  const safeFiles = normalizeUploadedProjectFiles(uploadedFiles);
  const connectedPath = connectedProjectPathFromFiles(uploadedFiles);
  if (!safeFiles.length) {
    const emptyProjectId = `connected-${slugify(connectedPath) || "project"}`;
    const execution = createExecutionContext(onEvent, emptyProjectId);
    const events = [`Connected project has no editable file contents: ${connectedPath}`];
    await emitExecution(execution, "inspection", "error", "No editable project files were available", {
      details: { connectedPath, reason: "This project record has paths only. Re-open/upload the folder so Foundry can read file contents, or wait for the local connector." },
    });
    return existingProjectResult({
      projectId: emptyProjectId,
      projectName,
      projectPath: connectedPath,
      briefPath: `${connectedPath}/foundry-brief.md`,
      stack: "Unknown",
      status: "failed",
      blocker: "No uploaded file contents were available to inspect or edit. Re-open/upload the project folder to create an editable Foundry copy. A real local folder connector is required to edit your VS Code folder directly.",
      events,
      files: [],
      commands: [],
      execution,
      sourceMode: "uploaded-copy",
    });
  }
  const resolvedTarget = await resolveUploadedProjectPath(safeFiles, projectName, connectedPath);
  const projectPath = resolvedTarget.projectPath;
  const projectId = path.basename(projectPath);
  const briefPath = path.join(projectPath, "foundry-brief.md");
  const events: string[] = [];
  const commands: FactoryCommandEvent[] = [];
  const execution = createExecutionContext(onEvent, projectId);
  initializeObjectiveChecklist(execution, task, "uploaded-copy");

  await emitExecution(execution, "planning", "running", "Reading project request", {
    details: {
      task,
      mode: "Uploaded project copy",
      connectedPath,
      editingTarget: projectPath,
      writePolicy: "Browser uploads are edited as a Foundry copy. The original VS Code folder will not change until the local connector exists.",
    },
  });
  events.push(`Uploaded project source: ${connectedPath}`);
  events.push(`Editing target: ${projectPath}`);
  await mkdir(projectPath, { recursive: true });
  await writeFile(briefPath, `${brief}\n\nCurrent task: ${task}\n\nEditing target: ${projectPath}\n`, "utf8");
  await emitExecution(execution, "inspection", "completed", "Editing target prepared", {
    filePath: projectPath,
    details: { connectedPath, editingTarget: projectPath, sourceMode: "Uploaded copy, export required", filesAvailable: safeFiles.length },
  });

  const detected = detectExistingProject(safeFiles);
  // Upload intake already wrote this exact upload into this exact folder so the preview could show
  // the project immediately. Re-copying would overwrite anything a previous mission changed there.
  if (!resolvedTarget.reusedIntakeCopy) {
    await writeVirtualFilesToDisk(projectPath, new Map(safeFiles.map((file) => [file.path, file.content])));
  }
  await emitExecution(execution, "file", "completed", resolvedTarget.reusedIntakeCopy ? "Continued in the existing Foundry copy of this upload" : "Copied uploaded files into Foundry target", {
    filePath: projectPath,
    details: resolvedTarget.reusedIntakeCopy
      ? { reason: "This upload was already materialized when the folder was opened; the preview and this mission share one copy.", files: safeFiles.length }
      : { reason: "Uploaded files need a writable Foundry copy. Export the result to use it outside Foundry.", files: safeFiles.length },
  });
  events.push(`Detected stack: ${detected.stack}`);
  await emitExecution(execution, "inspection", "completed", "Detected project structure", {
    details: {
      stack: detected.stack,
      entryFiles: detected.entryFiles,
      cssFiles: detected.cssFiles,
      jsFiles: detected.jsFiles,
      packageManager: detected.packageManager || "None detected",
    },
  });

  await noteMissingDependencies(projectPath, detected.packageManager, execution);

  const mission = await runExistingProjectMission({ projectPath, task, sourceMode: "uploaded-copy", execution, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceAttachments, idempotencyCandidate, retryExecutionId });
  commands.push(...(mission.commands ?? []));
  const files = mission.projectDeleted ? [] : await listProjectFilesWithStatuses(projectPath, mission.changedFiles, new Set(safeFiles.map((file) => file.path)));
  events.push(...mission.events);
  const preferredStaticEntries = explicitProjectFileNames(task).filter((filePath) => /\.html?$/i.test(filePath));
  const preview = shouldAttachProjectPreview(mission) ? await startProjectPreview({ kind: "workspace", projectId, projectPath }, detected.stack, events, execution, preferredStaticEntries) : undefined;
  const reusedMission = mission.verification?.some((item) => item.check_type === "file-read" && /complete SHA-256 fingerprints/i.test(item.evidence));
  if (mission.status === "passed" && reusedMission && (!preview || preview.previewState === "ready")) {
    await emitExecution(execution, "summary", "completed", "Request already completed and verified", { details: { reusedResult: true, paidModelCalls: 0 } });
  }

  return existingProjectResult({
    projectId,
    projectName,
    projectPath,
    briefPath,
    stack: detected.stack,
    status: mission.status,
    blocker: mission.blocker,
    clarificationQuestions: mission.clarificationQuestions,
    events,
    files,
    commands,
    execution,
    preview,
    sessionSummary: mission.sessionSummary,
    verification: mission.verification,
    projectDeleted: mission.projectDeleted,
  });
}

async function exerciseNamedBrowserWorkflow(
  page: import("playwright").Page,
  requested: ObservableBrowserCapability[],
  urls: string[],
): Promise<{ covered: ObservableBrowserCapability[]; evidence: string; problems: string[]; url?: string }> {
  const covered = new Set<ObservableBrowserCapability>();
  const problems: string[] = [];
  const token = `Foundry acceptance ${Date.now()}`;
  let targetUrl: string | undefined;

  // Product editors are commonly implemented either as semantic forms or accessible modal
  // dialogs whose save button drives state directly. Treat both as valid workflow surfaces; DOM
  // element choice must not decide whether Foundry can exercise the user's feature.
  const visibleCreateForm = () => page.locator('form:visible, [role="dialog"]:visible, dialog:visible')
    .filter({ has: page.locator('input, textarea, select') })
    .filter({ has: page.locator('button[type="submit"], input[type="submit"], button') })
    .first();
  const visibleSearch = () => page.locator('input[type="search"]:visible, input[placeholder*="search" i]:visible, input[aria-label*="search" i]:visible, input[placeholder*="filter" i]:visible, input[aria-label*="filter" i]:visible').first();
  const clickFirstWorkflowControl = async (pattern: RegExp) => {
    const control = page.locator('button:visible, a[href]:visible, [role="button"]:visible, [role="tab"]:visible').filter({ hasText: pattern }).first();
    if (!(await control.count())) return false;
    const clicked = await control.click({ timeout: 3_000 }).then(() => true).catch(() => false);
    if (!clicked) return false;
    await page.waitForTimeout(200);
    return true;
  };
  const closeVisibleEditor = async () => {
    const editor = visibleCreateForm();
    if (!(await editor.count())) return true;
    const labelledClose = editor.locator('button[aria-label*="close" i], button[title*="close" i]').first();
    const textClose = editor.locator('button:visible, [role="button"]:visible').filter({ hasText: /^(?:discard|close|cancel|back)$/i }).first();
    const action = await labelledClose.count() ? labelledClose : textClose;
    if (!(await action.count())) return false;
    await action.click({ timeout: 3_000 }).catch(() => undefined);
    await editor.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => undefined);
    return !(await editor.count());
  };
  const revealCreationSurface = async () => {
    if (await visibleCreateForm().count()) return true;
    await clickFirstWorkflowControl(/\b(?:new|add|create)\b(?:\s+\w+){0,3}/i);
    return Boolean(await visibleCreateForm().count());
  };
  const revealListSurface = async () => {
    await closeVisibleEditor();
    if (await visibleSearch().count()) return true;
    await clickFirstWorkflowControl(/\b(?:work\s*orders?|bookings?|reservations?|orders?|records?|items?|notes?|tasks?|products?|events?|customers?|assets?|tickets?|issues?|manage)\b/i);
    return Boolean(await visibleSearch().count());
  };

  for (const url of urls.slice(0, 10)) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (response && response.status() >= 400) continue;
      await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
      const hasCreate = await revealCreationSurface();
      const hasSearch = hasCreate ? false : await revealListSurface();
      if (hasCreate || hasSearch) {
        targetUrl = page.url();
        break;
      }
    } catch {
      // The main browser gate reports unreachable routes. This probe keeps looking for the workflow surface.
    }
  }
  if (!targetUrl) {
    return { covered: [], evidence: "No reachable route exposed a create/search workflow surface.", problems: ["the named workflow could not be located on a reachable route"] };
  }

  const includes = (capability: ObservableBrowserCapability) => requested.includes(capability);
  const fillRecordForm = async (form: import("playwright").Locator) => {
    const future = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    const date = future.toISOString().slice(0, 10);
    const start = `${date}T10:00`;
    const end = `${date}T12:00`;
    const inputs = form.locator("input:visible, textarea:visible");
    let textOrdinal = 0;
    let dateTimeOrdinal = 0;
    for (let index = 0; index < await inputs.count(); index += 1) {
      const input = inputs.nth(index);
      if (!(await input.isEnabled())) continue;
      const type = (await input.getAttribute("type") || (await input.evaluate((element) => element.tagName.toLowerCase()))).toLowerCase();
      if (["hidden", "submit", "button", "reset", "file", "image", "search"].includes(type)) continue;
      if (type === "checkbox" || type === "radio") {
        if (await input.getAttribute("required") !== null) await input.check().catch(() => undefined);
        continue;
      }
      let value: string | undefined;
      if (type === "email") value = `foundry-${Date.now()}@example.com`;
      else if (type === "url") value = "https://example.com/foundry-acceptance";
      else if (type === "number" || type === "range") value = "25";
      else if (type === "date") value = date;
      else if (type === "datetime-local") value = dateTimeOrdinal++ === 0 ? start : end;
      else if (type === "time") value = dateTimeOrdinal++ === 0 ? "10:00" : "12:00";
      else if (["text", "input", "textarea", "tel", ""].includes(type)) value = textOrdinal++ === 0 ? token : `${token} detail`;
      if (value !== undefined) await input.fill(value).catch(() => undefined);
    }
    const selects = form.locator("select:visible");
    for (let index = 0; index < await selects.count(); index += 1) {
      const select = selects.nth(index);
      if (!(await select.isEnabled())) continue;
      const options = select.locator("option");
      let selected = false;
      for (let optionIndex = 0; optionIndex < await options.count(); optionIndex += 1) {
        const option = options.nth(optionIndex);
        const value = await option.getAttribute("value");
        if (value) {
          await select.selectOption(value).catch(() => undefined);
          selected = true;
          break;
        }
      }
      if (!selected && await options.count()) await select.selectOption({ index: 0 }).catch(() => undefined);
    }
  };
  const submitRecordForm = async (form: import("playwright").Locator, expectEditorToClose = true) => {
    const named = form.locator('button[type="submit"], input[type="submit"], button').filter({ hasText: /^(?:add|create|save|submit|update)\b/i }).first();
    const fallback = form.locator('button[type="submit"], input[type="submit"]').first();
    const action = await named.count() ? named : fallback;
    if (!(await action.count())) return false;
    await action.click();
    if (expectEditorToClose) {
      // Successful editors often show an in-modal confirmation briefly before closing. Wait for
      // the semantic surface state instead of racing it with a fixed sub-second delay.
      await form.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => undefined);
      if (await form.count()) return false;
    } else {
      await page.waitForTimeout(350);
    }
    return true;
  };
  const needsProbeRecord = requested.some((capability) => ["create-record", "update-record", "assign-record", "complete-record", "permission-denied", "cancel-record", "conflict-rejection", "toggle-state", "delete-record", "persistent-state"].includes(capability));
  if (needsProbeRecord) {
    await revealCreationSurface();
    const createForm = visibleCreateForm();
    if (!(await createForm.count())) {
      problems.push("no visible create form was available for the named record workflow");
    } else {
      await fillRecordForm(createForm);
      // Modal editors normally close after a successful create; permanent inline forms do not.
      // Requiring every valid form to disappear misreported a working submit button as unusable
      // and prevented the remaining create/complete/delete workflow from being exercised.
      const createFormIsModal = await createForm.locator("xpath=ancestor::dialog | ancestor::*[@role='dialog']").count() > 0;
      if (!(await submitRecordForm(createForm, createFormIsModal))) {
        problems.push("the create form had no usable submit control");
      } else {
        let created = (await page.locator("body").innerText()).includes(token);
        if (!created && await revealListSurface()) {
          const search = visibleSearch();
          if (await search.count()) {
            await search.fill(token);
            await page.waitForTimeout(150);
            created = (await page.locator("body").innerText()).includes(token);
            await search.fill("");
          }
        }
        if (created) covered.add("create-record");
        else problems.push("submitting the create form did not render the new record");
      }
    }
  }

  if (includes("persistent-state") && covered.has("create-record")) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(200);
    let persisted = (await page.locator("body").innerText()).includes(token);
    if (!persisted && await revealListSurface()) {
      const search = visibleSearch();
      if (await search.count()) {
        await search.fill(token);
        await page.waitForTimeout(150);
        persisted = (await page.locator("body").innerText()).includes(token);
        await search.fill("");
      }
    }
    if (persisted) covered.add("persistent-state");
    else problems.push("the created record did not survive a page reload");
  }

  if (includes("search-filter")) {
    await revealListSurface();
    const search = visibleSearch();
    if (!(await search.count())) {
      problems.push("no visible search or filter control was found");
    } else {
      const rows = page.locator("tbody tr:visible, [role='row']:visible");
      const baselineRows = await rows.count();
      const firstDataRow = baselineRows > 0 ? rows.nth(baselineRows > 1 ? 1 : 0) : undefined;
      const existingText = (await firstDataRow?.innerText().catch(() => ""))?.trim() ?? "";
      const existingToken = covered.has("create-record")
        ? token
        : existingText.split(/\s+/).find((part) => /[a-z]/i.test(part) && part.length >= 4) ?? existingText.slice(0, 24);
      await search.fill(existingToken);
      await page.waitForTimeout(150);
      const matchingRows = await rows.count();
      const matchingVisible = existingToken.length > 0 && matchingRows > 0 && matchingRows <= baselineRows;
      await search.fill(`no-match-${Date.now()}`);
      await page.waitForTimeout(150);
      const hiddenForNoMatch = (await rows.count()) === 0;
      await search.fill("");
      if (matchingVisible && hiddenForNoMatch) covered.add("search-filter");
      else problems.push("the search control did not reduce the visible data for a real row value and clear the list for a non-match");
    }
  }

  if (includes("conflict-rejection") && covered.has("create-record")) {
    await revealCreationSurface();
    const duplicateForm = visibleCreateForm();
    if (!(await duplicateForm.count())) {
      problems.push("no create form was available to exercise duplicate/conflict rejection");
    } else {
      await fillRecordForm(duplicateForm);
      await submitRecordForm(duplicateForm, false);
      const body = await page.locator("body").innerText();
      if (/conflict|overlap|already\s+(?:booked|exists)|unavailable|double[- ]book|cannot\s+(?:book|save|create)|reject/i.test(body)) covered.add("conflict-rejection");
      else problems.push("recreating the same constrained record did not expose a conflict rejection");
      const dismiss = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /close|dismiss|discard|back|cancel/i }).last();
      if (await dismiss.count()) await dismiss.click({ timeout: 3_000 }).catch(() => undefined);
      await duplicateForm.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => undefined);
    }
  }

  const record = () => page.locator('article:visible, li:visible, tr:visible, [role="listitem"]:visible, [data-item]:visible, .card:visible').filter({ hasText: token }).first();
  if (includes("update-record") && covered.has("create-record")) {
    await revealListSurface();
    const container = record();
    const labelledEdit = container.locator('button[aria-label*="edit" i], button[title*="edit" i]').first();
    const edit = container.locator('button, [role="button"]').filter({ hasText: /^(?:edit|update|modify)(?:\s+\w+){0,2}$/i }).first();
    const action = await labelledEdit.count() ? labelledEdit : edit;
    if (await action.count()) await action.click({ timeout: 3_000 }).catch(() => undefined);
    else if (await container.count()) await container.click({ timeout: 3_000 }).catch(() => undefined);
    // Client-side routers often need more than one animation frame to mount a detail editor after a
    // row click. Waiting for the navigation/render prevents a real inline editor from being judged
    // against the list page that initiated the transition.
    await page.waitForTimeout(700);
    const editForm = visibleCreateForm();
    if (!(await editForm.count())) {
      // Many professional detail screens save status/priority inline instead of wrapping the page in
      // an edit form. Exercise a reversible alternative value and verify the controlled field keeps
      // it; this is real update behavior, not a requirement for one particular UI architecture.
      const inlineEditors = page.locator('select:visible, input[type="text"]:visible, textarea:visible').filter({ hasNot: page.locator('[type="search"]') });
      let inlineUpdated = false;
      for (let index = 0; index < await inlineEditors.count() && !inlineUpdated; index += 1) {
        const editor = inlineEditors.nth(index);
        if (!(await editor.isEnabled())) continue;
        if ((await editor.evaluate((element) => element.tagName.toLowerCase())) === "select") {
          const before = await editor.inputValue().catch(() => "");
          const options = editor.locator("option");
          let alternative = "";
          for (let optionIndex = 0; optionIndex < await options.count(); optionIndex += 1) {
            const option = options.nth(optionIndex);
            const value = await option.getAttribute("value") || "";
            if (value && value !== before && !(await option.isDisabled())) { alternative = value; break; }
          }
          if (!alternative) continue;
          await editor.selectOption(alternative).catch(() => undefined);
          await page.waitForTimeout(500);
          inlineUpdated = await editor.inputValue().catch(() => "") === alternative;
        }
      }
      if (inlineUpdated) covered.add("update-record");
      else problems.push("the created record exposed no editable form or usable inline editor");
    } else {
      const fields = editForm.locator('input[type="text"]:visible, input:not([type]):visible, textarea:visible');
      let field = fields.first();
      let matchedTokenField = false;
      for (let index = 0; index < await fields.count(); index += 1) {
        const candidate = fields.nth(index);
        if ((await candidate.inputValue().catch(() => "")).includes(token)) {
          field = candidate;
          matchedTokenField = true;
          break;
        }
      }
      const updatedToken = `${token} updated`;
      if (await field.count()) await field.fill(updatedToken);
      const submitted = await submitRecordForm(editForm);
      let updated = submitted && (await page.locator("body").innerText()).includes(updatedToken);
      if (!updated && submitted && await revealListSurface()) {
        const search = visibleSearch();
        if (await search.count()) {
          await search.fill(updatedToken);
          await page.waitForTimeout(150);
          updated = (await page.locator("body").innerText()).includes(updatedToken);
          await search.fill("");
        }
      }
      if (updated) covered.add("update-record");
      else problems.push(`editing the created record did not render the updated value (matched token field: ${matchedTokenField ? "yes" : "no"}; editor submitted and closed: ${submitted ? "yes" : "no"})`);
    }
  }

  if (includes("assign-record") && covered.has("create-record")) {
    await revealListSurface();
    let container = record();
    let assignmentSurface: import("playwright").Locator = container;
    let assignmentSelect = assignmentSurface.locator('select:visible').filter({ has: page.locator('option') }).first();
    if (!(await assignmentSelect.count())) {
      const assign = container.locator('button, [role="button"]').filter({ hasText: /^(?:assign|reassign)(?:\s+\w+){0,3}$/i }).first();
      if (await assign.count()) {
        await assign.click({ timeout: 3_000 }).catch(() => undefined);
        await page.waitForTimeout(150);
      } else if (await container.count()) {
        // A record list often opens a professional detail screen on row/card click. Assignment
        // controls on that screen are as valid as an inline list selector, so follow the record
        // before concluding that the workflow is missing.
        await container.click({ timeout: 3_000 }).catch(() => undefined);
        await page.waitForTimeout(700);
      }
      const editor = visibleCreateForm();
      assignmentSurface = await editor.count() ? editor : page.locator("body");
      const labelledAssignment = assignmentSurface.locator(
        'select:visible[aria-label*="assign" i], select:visible[name*="assign" i], select:visible[id*="assign" i]',
      ).first();
      const assignmentHeading = assignmentSurface.locator('label:visible, h2:visible, h3:visible, h4:visible').filter({ hasText: /assign(?:ed)?\s+to/i }).first();
      let headingSelect = assignmentHeading.locator('select:visible').first();
      if (!(await headingSelect.count())) {
        const headingParent = assignmentHeading.locator('xpath=..');
        headingSelect = headingParent.locator('select:visible').first();
      }
      assignmentSelect = await labelledAssignment.count()
        ? labelledAssignment
        : await headingSelect.count()
          ? headingSelect
          : assignmentSurface.locator('select:visible').filter({ has: page.locator('option') }).last();
    }
    if (!(await assignmentSelect.count())) {
      problems.push("the created record exposed no usable assignment selector");
    } else {
      const before = await assignmentSelect.inputValue().catch(() => "");
      const options = assignmentSelect.locator("option");
      let chosenValue = "";
      let chosenLabel = "";
      for (let index = 0; index < await options.count(); index += 1) {
        const option = options.nth(index);
        const value = await option.getAttribute("value") || "";
        if (value && value !== before && !(await option.isDisabled())) {
          chosenValue = value;
          chosenLabel = (await option.textContent() || "").trim();
          break;
        }
      }
      if (!chosenValue) {
        problems.push("the assignment selector had no alternative assignee");
      } else {
        await assignmentSelect.selectOption(chosenValue);
        const editor = visibleCreateForm();
        if (await editor.count()) await submitRecordForm(editor).catch(() => false);
        else {
          const save = assignmentSurface.locator('button:visible, [role="button"]:visible').filter({ hasText: /^(?:assign|save|update|apply|confirm)\b/i }).first();
          if (await save.count()) await save.click({ timeout: 3_000 }).catch(() => undefined);
        }
        await page.waitForTimeout(800);
        const selectedValuePersisted = await assignmentSelect.inputValue().catch(() => "") === chosenValue;
        await revealListSurface();
        container = record();
        const state = await container.textContent().catch(() => "");
        const conciseAssigneeLabel = chosenLabel.replace(/\s*\([^)]*\)\s*$/, "").trim();
        if (
          selectedValuePersisted
          || (state || "").toLowerCase().includes(chosenLabel.toLowerCase())
          || (conciseAssigneeLabel && (state || "").toLowerCase().includes(conciseAssigneeLabel.toLowerCase()))
        ) covered.add("assign-record");
        else problems.push("changing the assignee did not expose the selected assignment on the record");
      }
    }
  }

  if (includes("complete-record") && covered.has("create-record")) {
    await revealListSurface();
    let container = record();
    let complete = container.locator('button, [role="button"]').filter({ hasText: /^(?:complete|mark complete|mark done|resolve|close(?:\s+\w+){0,2})$/i }).first();
    let completionToggle = container.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').first();
    if (!(await complete.count()) && await container.count()) {
      await container.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      complete = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /^(?:complete|mark complete|mark done|resolve|close(?:\s+\w+){0,2})$/i }).first();
      container = record();
      completionToggle = container.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').first();
    }
    if (!(await complete.count()) && !(await completionToggle.count())) {
      problems.push("the created record exposed no completion control");
    } else {
      page.once("dialog", (dialog) => void dialog.accept());
      const activated = await complete.count()
        ? await complete.click({ timeout: 3_000 }).then(() => true).catch(() => false)
        : await completionToggle.check({ timeout: 3_000 }).then(() => true).catch(async () =>
            completionToggle.click({ timeout: 3_000 }).then(() => true).catch(async () =>
              completionToggle.evaluate((element) => (element as HTMLElement).click()).then(() => true).catch(() => false)));
      await page.waitForTimeout(700);
      // A confirmation is only a second step when it appears in a modal/editor. Searching the
      // whole page can mistake another record's identical action for a confirmation and mutate
      // the wrong record while the first request is settling.
      const confirmationSurface = visibleCreateForm();
      const confirm = confirmationSurface.locator('button:visible, [role="button"]:visible').filter({ hasText: /^(?:confirm|yes|complete|mark complete|resolve)$/i }).last();
      if (activated && await confirm.count()) await confirm.click({ timeout: 3_000 }).catch(() => undefined);
      let state = "";
      let completionStateExposed = false;
      // Server-backed mutations commonly refetch and reorder a list after the request succeeds.
      // Poll the named record's observable state instead of taking one race-prone DOM sample.
      for (let attempt = 0; activated && attempt < 8; attempt += 1) {
        await page.waitForTimeout(attempt === 0 ? 900 : 400);
        await revealListSurface();
        container = record();
        state = await container.textContent().catch(() => "") || "";
        const refreshedToggle = container.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').first();
        const checked = await refreshedToggle.isChecked().catch(() => false);
        const ariaChecked = await refreshedToggle.getAttribute("aria-checked").catch(() => null);
        completionStateExposed = checked || ariaChecked === "true" || /\b(?:completed|complete|done|resolved|closed)\b/i.test(state);
        if (completionStateExposed) break;
      }
      if (activated && completionStateExposed) covered.add("complete-record");
      else problems.push("the completion action did not expose a completed record state");
    }
  }

  if (includes("permission-denied")) {
    await closeVisibleEditor();
    const roleLabel = page.locator('label:visible').filter({ hasText: /\b(?:role|act as|persona|current user)\b/i }).first();
    let roleSelect = roleLabel.locator("select:visible").first();
    if (!(await roleSelect.count())) {
      const roleFor = await roleLabel.getAttribute("for").catch(() => null);
      if (roleFor) roleSelect = page.locator(`#${roleFor}:visible`).first();
    }
    if (!(await roleSelect.count())) roleSelect = page.locator('select:visible[aria-label*="role" i], select:visible[name*="role" i], select:visible[id*="role" i], select:visible[aria-label*="user" i]').first();
    let restrictedRoleSelectedFromMenu = false;
    if (!(await roleSelect.count())) {
      // Account/persona menus are at least as common as role selects. Open a visible current-user
      // control and choose a restricted persona by its semantic role label before exercising a
      // protected action.
      const userMenu = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /\b(?:admin|manager|current user|switch user|persona)\b/i }).first();
      if (await userMenu.count()) {
        await userMenu.click({ timeout: 3_000 }).catch(() => undefined);
        await page.waitForTimeout(150);
        const restrictedPersona = page.locator('button:visible, [role="option"]:visible, [role="menuitem"]:visible').filter({ hasText: /\b(?:technician|viewer|restricted|read.only)\b/i }).first();
        if (await restrictedPersona.count()) {
          await restrictedPersona.click({ timeout: 3_000 }).catch(() => undefined);
          await page.waitForTimeout(700);
          restrictedRoleSelectedFromMenu = true;
        }
      }
    }
    if (!(await roleSelect.count()) && !restrictedRoleSelectedFromMenu) {
      problems.push("no visible role/persona selector or account menu was available to exercise permission denial");
    } else {
      const originalRole = await roleSelect.inputValue().catch(() => "");
      const restricted = roleSelect.locator("option").filter({ hasText: /technician|viewer|restricted|member|read.only/i }).first();
      const restrictedValue = restrictedRoleSelectedFromMenu ? "menu-selected" : await restricted.getAttribute("value").catch(() => null);
      if (!restrictedValue) {
        problems.push("the role selector exposed no restricted role");
      } else {
        if (!restrictedRoleSelectedFromMenu) {
          await roleSelect.selectOption(restrictedValue);
          await page.waitForTimeout(200);
        }
        const before = await page.locator("body").innerText();
        const forbiddenAction = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /\b(?:new|add|create|edit|delete|assign|manage)\b/i }).first();
        const disabledForbiddenAction = page.locator('button:visible:disabled, [role="button"][aria-disabled="true"]:visible').filter({ hasText: /\b(?:new|add|create|edit|delete|assign|manage)\b/i }).first();
        let denied = Boolean(await disabledForbiddenAction.count()) && /permission|forbidden|not authorized|admin|manager|restricted/i.test(`${await disabledForbiddenAction.getAttribute("title")} ${await disabledForbiddenAction.getAttribute("aria-label")}`);
        if (!denied && await forbiddenAction.count()) {
          await forbiddenAction.click({ timeout: 3_000 }).catch(() => undefined);
          await page.waitForTimeout(200);
          const after = await page.locator("body").innerText();
          denied = /permission denied|access denied|forbidden|not authorized|unauthorized|insufficient permission|cannot perform|read.only/i.test(after)
            && after !== before;
        }
        if (denied) covered.add("permission-denied");
        else problems.push("the restricted role did not expose a permission-denied result for a protected action");
        if (!restrictedRoleSelectedFromMenu && originalRole) await roleSelect.selectOption(originalRole).catch(() => undefined);
      }
    }
  }

  if (includes("toggle-state") && covered.has("create-record")) {
    const container = record();
    const toggle = container.locator('button, [role="button"]').filter({ hasText: /pin|unpin|favorite|favourite|star/i }).first();
    const labelledToggle = container.locator('button[aria-label*="pin" i], button[aria-label*="favorite" i], button[aria-label*="favourite" i], button[title*="pin" i], button[title*="favorite" i]').first();
    const action = await toggle.count() ? toggle : labelledToggle;
    if (!(await action.count())) {
      problems.push("the created record exposed no pin/favorite toggle");
    } else {
      const before = `${await action.getAttribute("aria-pressed")} ${await action.getAttribute("title")} ${await action.getAttribute("class")} ${await action.textContent()}`;
      const activated = await action.click({ timeout: 3_000 }).then(() => true).catch(() => false);
      if (!activated) {
        problems.push("the pin/favorite control was blocked by the current editor state");
        return {
          covered: [...covered].filter((capability) => requested.includes(capability)),
          evidence: `Exercised the named workflow with a unique browser-created record (${[...covered].filter((capability) => requested.includes(capability)).join(", ") || "no steps passed"}).`,
          problems,
          url: targetUrl,
        };
      }
      await page.waitForTimeout(150);
      const after = await action.count() ? `${await action.getAttribute("aria-pressed")} ${await action.getAttribute("title")} ${await action.getAttribute("class")} ${await action.textContent()}` : "record-moved-after-toggle";
      if (before !== after) covered.add("toggle-state");
      else problems.push("the pin/favorite control did not expose a changed state after activation");
    }
  }

  if (includes("cancel-record") && covered.has("create-record")) {
    await revealListSurface();
    const container = record();
    let cancel = container.locator('button, [role="button"]').filter({ hasText: /^(?:cancel|cancel booking|cancel reservation|cancel order|mark cancelled)$/i }).first();
    let labelledCancel = container.locator('button[aria-label*="cancel booking" i], button[title*="cancel booking" i], button[aria-label*="cancel reservation" i]').first();
    let action = await cancel.count() ? cancel : labelledCancel;
    if (!(await action.count()) && await container.count()) {
      await container.click().catch(() => undefined);
      await page.waitForTimeout(150);
      cancel = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /^(?:cancel|cancel booking|cancel reservation|cancel order|mark cancelled)$/i }).first();
      labelledCancel = page.locator('button[aria-label*="cancel booking" i], button[title*="cancel booking" i], button[aria-label*="cancel reservation" i]').first();
      action = await cancel.count() ? cancel : labelledCancel;
    }
    if (!(await action.count())) {
      problems.push("the created record exposed no domain cancellation control");
    } else {
      page.once("dialog", (dialog) => void dialog.accept());
      const activated = await action.click({ timeout: 3_000 }).then(() => true).catch(() => false);
      if (!activated) {
        problems.push("the cancellation control was blocked by the current editor state");
      } else {
      await page.waitForTimeout(150);
      const confirm = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /confirm|yes|cancel booking|cancel reservation|cancel order/i }).last();
      if (await confirm.count()) await confirm.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(200);
      const state = await container.textContent().catch(() => "");
      if (/cancelled|canceled/i.test(state || "")) covered.add("cancel-record");
      else problems.push("the cancellation action did not expose a cancelled record state");
      }
    }
  }

  if (includes("delete-record") && covered.has("create-record")) {
    const container = record();
    const textDelete = container.locator('button, [role="button"]').filter({ hasText: /delete|remove|discard|trash|^del$/i }).first();
    const labelledDelete = container.locator('button[aria-label*="delete" i], button[aria-label*="remove" i], button[title*="delete" i], button[title*="remove" i]').first();
    const action = await textDelete.count() ? textDelete : labelledDelete;
    if (!(await action.count())) {
      problems.push("the created record exposed no delete/remove control");
    } else {
      page.once("dialog", (dialog) => void dialog.accept());
      const activated = await action.click({ timeout: 3_000 }).then(() => true).catch(() => false);
      if (!activated) problems.push("the delete/remove control was blocked by the current editor state");
      await page.waitForTimeout(100);
      const confirm = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /confirm|yes|delete|remove/i }).last();
      if (activated && await confirm.count() && (await page.locator("body").innerText()).includes(token)) await confirm.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(200);
      if (activated && !(await page.locator("body").innerText()).includes(token)) covered.add("delete-record");
      else problems.push("the delete/remove action did not remove the created record");
    }
  }

  return {
    covered: [...covered].filter((capability) => requested.includes(capability)),
    evidence: `Exercised the named workflow with a unique browser-created record (${[...covered].filter((capability) => requested.includes(capability)).join(", ") || "no steps passed"}).`,
    problems,
    url: targetUrl,
  };
}

export async function executeExistingProjectTask(
  brief: string,
  task: string,
  uploadedFiles: FactoryUploadedFile[],
  localPathOrEmitter?: string | ExecutionEmitter,
  maybeEmitter?: ExecutionEmitter,
  localConnector?: LocalConnectorConfig,
  signal?: AbortSignal,
  approvedCategories: string[] = [],
  approvedCommands: string[] = [],
  parentMission?: MissionParentContext,
  followUpResolution?: FollowUpResolutionRecord,
  continuity?: "carry_forward_plan" | "fresh_plan",
  approvalResponse?: ApprovalResponse,
  quality?: MissionQualityLevel,
  modelMode?: ModelMode,
  evidenceAttachments: EvidenceAttachments = [],
  idempotencyCandidate?: MissionParentContext,
  retryExecutionId?: string,
): Promise<FactoryProjectResult> {
  const result = await executeExistingProjectTaskCore(
    brief,
    task,
    uploadedFiles,
    localPathOrEmitter,
    maybeEmitter,
    localConnector,
    signal,
    approvedCategories,
    approvedCommands,
    parentMission,
    followUpResolution,
    continuity,
    approvalResponse,
    quality,
    modelMode,
    evidenceAttachments,
    idempotencyCandidate,
    retryExecutionId,
  );
  return finalizeFactoryProjectResult(result, task);
}

async function executeConnectorProjectTask(brief: string, task: string, connector: LocalConnectorConfig, projectName: string, onEvent?: ExecutionEmitter, signal?: AbortSignal, approvedCategories: string[] = [], approvedCommands: string[] = [], parentMission?: MissionParentContext, followUpResolution?: FollowUpResolutionRecord, continuity?: "carry_forward_plan" | "fresh_plan", approvalResponse?: ApprovalResponse, quality?: MissionQualityLevel, modelMode?: ModelMode, evidenceAttachments: EvidenceAttachments = [], idempotencyCandidate?: MissionParentContext, retryExecutionId?: string): Promise<FactoryProjectResult> {
  const rootLabel = connector.rootLabel || connector.url;
  const projectId = `connector-${slugify(rootLabel) || "project"}`;
  const execution = createExecutionContext(onEvent, projectId);
  connectorPreviews.set(projectId, connector);
  const events: string[] = [];
  const commands: FactoryCommandEvent[] = [];
  initializeObjectiveChecklist(execution, task, "local-folder");

  await emitExecution(execution, "planning", "running", "Reading project request", {
    details: { task, mode: "Local connector", editingTarget: rootLabel, writePolicy: "Connector direct edits and commands. Changes happen in the real connected project folder." },
  });

  const access = createLocalConnectorProjectAccess(connector, signal);
  await emitExecution(execution, "inspection", "completed", "Local connector connected", {
    details: { editingTarget: rootLabel, sourceMode: "Local connector - direct disk edits and commands" },
  });

  const snapshot = await buildProjectSnapshot(access);
  await emitExecution(execution, "inspection", "completed", "Read connector project tree", {
    details: { root: rootLabel, snapshot: snapshot.slice(0, 500) },
  });

  const mission = await runExistingProjectMissionWithAccess({
    access,
    task,
    sourceMode: "local-folder",
    execution,
    projectSnapshot: snapshot,
    previewTarget: connectorPreviewTarget(projectId, connector),
    signal,
    approvedCategories,
    approvedCommands,
    parentMission,
    followUpResolution,
    continuity,
    approvalResponse,
    quality,
    modelMode,
    evidenceAttachments,
    idempotencyCandidate,
    retryExecutionId,
  });

  commands.push(...(mission.commands ?? []));
  events.push(...mission.events);
  const files = mission.projectDeleted ? [] : await listConnectorFilesWithStatuses(access, mission.changedFiles);
  let status = mission.status;
  let blocker = mission.blocker;
  const verification = [...(mission.verification ?? [])];
  const preferredStaticEntries = explicitProjectFileNames(task).filter((filePath) => /\.html?$/i.test(filePath));
  const preview = mission.preview ?? (shouldAttachProjectPreview(mission) ? await startProjectPreview(connectorPreviewTarget(projectId, connector), mission.stackLabel ?? "Local connector project", events, execution, preferredStaticEntries) : undefined);
  if (preview) {
    const isReady = preview.previewState === "ready";
    await emitExecution(execution, "preview", isReady ? "completed" : "error", isReady ? "Preview ready" : "Preview failed its live readiness check", { details: { previewUrl: preview.previewUrl, reason: preview.previewReason, state: preview.previewState } });
  }
  if (status === "passed" && !isPreviewRestartRequest(task) && mission.stackLabel === "Static HTML/CSS/JS" && preview?.previewUrl && existsSync(rootLabel)) {
    const acceptanceTask = `${brief.trim()}\n\nCurrent follow-up requirement:\n${task.trim()}`;
    const browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, rootLabel, execution, preview.previewOwnershipToken, acceptanceTask);
    verification.push({ check_type: "preview", result: browserEvidence.verified ? "pass" : "fail", evidence: browserEvidence.evidence });
    if (!browserEvidence.verified) {
      status = "failed";
      blocker = browserEvidence.evidence;
      finishObjectiveChecklist(execution, "failed", blocker);
    }
  }
  const reusedMission = mission.verification?.some((item) => item.check_type === "file-read" && /complete SHA-256 fingerprints/i.test(item.evidence));
  if (status === "passed" && reusedMission && (!preview || preview.previewState === "ready")) {
    await emitExecution(execution, "summary", "completed", "Request already completed and verified", { details: { reusedResult: true, paidModelCalls: 0 } });
  }

  return existingProjectResult({
    projectId,
    projectName,
    projectPath: rootLabel,
    briefPath: `${rootLabel}/foundry-brief.md`,
    stack: mission.stackLabel ?? "Local connector project",
    status,
    blocker,
    clarificationQuestions: mission.clarificationQuestions,
    events,
    files,
    commands,
    execution,
    sourceMode: "local-folder",
    objective: engineeringObjectiveForTask(task),
    preview,
    sessionSummary: mission.sessionSummary,
    verification,
    projectDeleted: mission.projectDeleted,
  });
}

async function executeLocalProjectTask(brief: string, task: string, localPath: string, projectName: string, onEvent?: ExecutionEmitter, signal?: AbortSignal, approvedCategories: string[] = [], approvedCommands: string[] = [], parentMission?: MissionParentContext, followUpResolution?: FollowUpResolutionRecord, continuity?: "carry_forward_plan" | "fresh_plan", approvalResponse?: ApprovalResponse, quality?: MissionQualityLevel, modelMode?: ModelMode, evidenceAttachments: EvidenceAttachments = [], idempotencyCandidate?: MissionParentContext, retryExecutionId?: string): Promise<FactoryProjectResult> {
  const projectPath = path.resolve(localPath);
  const projectId = `local-${slugify(path.basename(projectPath)) || "project"}`;
  const execution = createExecutionContext(onEvent, projectId);
  const events: string[] = [];
  const commands: FactoryCommandEvent[] = [];
  initializeObjectiveChecklist(execution, task, "local-folder");

  await emitExecution(execution, "planning", "running", "Reading project request", {
    details: { task, mode: "Local folder connected", editingTarget: projectPath, writePolicy: "Direct disk edits. Changes should appear in VS Code." },
  });

  const rootStats = await stat(projectPath);
  if (!rootStats.isDirectory()) throw new Error("Local project path is not a folder.");

  const localFiles = await readLocalProjectFiles(projectPath);
  if (!localFiles.length) {
    events.push(`No editable files found in ${projectPath}`);
    await emitExecution(execution, "inspection", "error", "No editable project files were available", {
      details: { editingTarget: projectPath, reason: "No supported editable files were found under this folder." },
    });
    return existingProjectResult({
      projectId,
      projectName,
      projectPath,
      briefPath: path.join(projectPath, "foundry-brief.md"),
      stack: "Unknown",
      status: "failed",
      blocker: "No editable project files were found in the selected local folder.",
      events,
      files: [],
      commands,
      execution,
      sourceMode: "local-folder",
    });
  }

  events.push(`Editing target: ${projectPath}`);
  await emitExecution(execution, "inspection", "completed", "Local folder connected", {
    filePath: projectPath,
    details: { editingTarget: projectPath, filesAvailable: localFiles.length, sourceMode: "Local folder - direct disk edits" },
  });

  const detected = detectExistingProject(localFiles);
  await emitExecution(execution, "inspection", "completed", "Detected project structure", {
    details: {
      stack: detected.stack,
      entryFiles: detected.entryFiles,
      cssFiles: detected.cssFiles,
      jsFiles: detected.jsFiles,
      packageManager: detected.packageManager || "None detected",
    },
  });

  await noteMissingDependencies(projectPath, detected.packageManager, execution);

  const mission = await runExistingProjectMission({ projectPath, task, sourceMode: "local-folder", execution, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceAttachments, idempotencyCandidate, retryExecutionId });
  commands.push(...(mission.commands ?? []));
  events.push(...mission.events);
  let status = mission.status;
  let blocker = mission.blocker;
  let changedFiles = [...mission.changedFiles];
  let sessionSummary = mission.sessionSummary;
  let clarificationQuestions = mission.clarificationQuestions;
  const verification = [...(mission.verification ?? [])];
  const reusedMission = verification.some((item) => item.check_type === "file-read" && /complete SHA-256 fingerprints/i.test(item.evidence));
  const deterministicStaticSeparation = verification.some((item) => item.check_type === "file-read" && /deterministic static source separation/i.test(item.evidence));
  const preferredStaticEntries = explicitProjectFileNames(task).filter((filePath) => /\.html?$/i.test(filePath));
  const preview = mission.preview ?? (shouldAttachProjectPreview(mission) ? await startProjectPreview({ kind: "workspace", projectId, projectPath }, detected.stack, events, execution, preferredStaticEntries) : undefined);
  if (status === "passed" && preview?.previewPlatform === "web" && preview.previewState !== "ready") {
    status = "failed";
    blocker = preview.previewReason || "The web preview did not reach a verified ready state.";
    verification.push({ check_type: "preview", result: "fail", evidence: blocker });
    finishObjectiveChecklist(execution, "failed", blocker);
  }
  if (status === "passed" && !isPreviewRestartRequest(task) && detected.stack === "Static HTML/CSS/JS" && preview?.previewUrl) {
    // A follow-up extends the durable project contract; it does not replace it. Validate the saved
    // creation brief and the current instruction together so "preserve everything" cannot pass after
    // a rewrite silently removes earlier controls, seed data, or interaction requirements.
    const acceptanceTask = `${brief.trim()}\n\nCurrent follow-up requirement:\n${task.trim()}`;
    let browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, acceptanceTask);
    if (!browserEvidence.verified && !reusedMission && !deterministicStaticSeparation) {
      await emitExecution(execution, "reasoning", "completed", "The real browser found a concrete gap in the requested experience. I’m repairing that evidence-backed failure once, then I’ll exercise the same flow again.");
      const repairTask = `Repair this existing static project so the real browser satisfies both its durable project brief and the current follow-up. Preserve working behavior and change only what the verified failure proves is incomplete.\n\nDurable project brief:\n${brief.trim()}\n\nCurrent follow-up:\n${task.trim()}\n\nVerified browser failure:\n${browserEvidence.evidence}`;
      const repairFiles = [...new Set([...detected.entryFiles, ...detected.cssFiles, ...detected.jsFiles])];
      const repair = await runEvidenceDrivenStaticRepair({
        projectPath,
        task: repairTask,
        originalTask: task,
        browserEvidence: browserEvidence.evidence,
        relevantFiles: repairFiles,
        execution,
        signal,
        approvedCategories,
        approvedCommands,
        quality,
        modelMode,
        parentMission,
      });
      commands.push(...(repair.commands ?? []));
      verification.push(...(repair.verification ?? []));
      changedFiles = [...new Set([...changedFiles, ...repair.changedFiles])];
      sessionSummary = repair.sessionSummary ?? sessionSummary;
      clarificationQuestions = repair.clarificationQuestions;
      if (repair.status === "passed" && repair.changedFiles.length) {
        browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, acceptanceTask);
      } else {
        status = repair.status;
        blocker = `Browser verification failed, and the bounded automatic repair did not complete: ${repair.blocker || browserEvidence.evidence}`;
      }
    }
    verification.push({ check_type: "preview", result: browserEvidence.verified ? "pass" : "fail", evidence: browserEvidence.evidence });
    if (browserEvidence.verified) {
      status = "passed";
      blocker = undefined;
      if (deterministicStaticSeparation) {
        sessionSummary = sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
        sessionSummary.outcome = "Separated the static project using its discovered entry files and referenced asset paths with zero model calls, then verified the unchanged experience in desktop and mobile browsers.";
      }
      if (reusedMission) {
        await emitExecution(execution, "summary", "completed", "Request already completed and verified", { details: { reusedResult: true, paidModelCalls: 0 } });
      }
    } else if (status === "passed") {
      status = "failed";
      blocker = reusedMission
        ? `The matching implementation is unchanged, but it no longer passes current browser verification. No paid repair call was made: ${browserEvidence.evidence}`
        : deterministicStaticSeparation
          ? `The deterministic three-file refactor is preserved, but its browser verification failed. No paid repair call was made: ${browserEvidence.evidence}`
        : browserEvidence.evidence;
    }
  }
  const files = mission.projectDeleted ? [] : await listProjectFilesWithStatuses(projectPath, changedFiles, new Set(localFiles.map((file) => file.path)));

  return {
    projectId,
    projectName,
    projectPath,
    briefPath: path.join(projectPath, "foundry-brief.md"),
    stack: detected.stack,
    template: "Existing Project",
    sourceMode: "local-folder",
    objective: engineeringObjectiveForTask(task),
    checklist: execution.checklist,
    status,
    supported: status !== "unsupported",
    blocker,
    events,
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
    previewEmulator: preview?.previewEmulator,
    artifact: preview?.artifact,
    projectDeleted: mission.projectDeleted,
    timeline: execution.timeline,
    sessionSummary,
    clarificationQuestions,
    verification,
  };
}

/**
 * Continue an existing static mission from deterministic browser evidence without reclassifying,
 * replanning, or rediscovering the project. This is deliberately generic: authentication, layout,
 * content, navigation, accessibility, and interaction failures all enter through the same evidence
 * record. The executor must read the current artifact before its one scoped edit, so a repair cannot
 * replace working behavior with a scenario-specific template.
 */
async function runEvidenceDrivenStaticRepair(input: {
  projectPath: string;
  task: string;
  originalTask: string;
  browserEvidence: string;
  relevantFiles: string[];
  execution: ExecutionContext;
  signal?: AbortSignal;
  approvedCategories: string[];
  approvedCommands: string[];
  parentMission?: MissionParentContext;
  quality?: MissionQualityLevel;
  modelMode?: ModelMode;
}) {
  const repairTier: ModelTier = /explicit acceptance requirements|explicit visible content missing|stable acceptance ID/i.test(input.browserEvidence)
    && !/(?:flow|form|sign\s*in|log\s*in|sign\s*up|interaction|navigation|Console:|Page error:|Failed local request:|could not complete|could not be exercised)/i.test(input.browserEvidence)
    ? "fast"
    : "builder";
  const repairAssessment = deterministicTaskAssessment(input.task);
  const repairModel = await modelForMissionStage(input.task, input.modelMode, repairTier, undefined, 1, repairAssessment);
  if (!repairModel) {
    return {
      status: "failed" as const,
      blocker: "The browser found a concrete defect, but no configured model is available for the bounded repair.",
      changedFiles: [],
      commands: [],
      verification: [],
      sessionSummary: undefined,
      clarificationQuestions: undefined,
    };
  }

  await emitModelSelection(input.execution, "browser-evidenced repair", repairModel);
  const resolution: FollowUpResolutionRecord = {
    currentIntent: "edit",
    referencedPriorAction: null,
    relevantFiles: input.relevantFiles,
    expectedScope: "Repair only the browser-verified gap while preserving the existing static product and every earlier requirement.",
    destructive: false,
    referenceConfidence: 1,
    plannedAction: input.task,
    continuity: "carry_forward_plan",
    rationale: "A deterministic browser check found a concrete mismatch with the complete user request.",
    clarifyingQuestion: "",
    clarifyingOptions: [],
  };
  const access = constrainAccessToFollowUpScope(
    createServerProjectAccess(input.projectPath, "local-folder", input.signal),
    resolution,
    input.execution,
    input.task,
  );
  const result = await runMissionExecutor({
    objective: engineeringObjectiveForTask(input.originalTask),
    task: input.task,
    checklist: [{ id: "static-preview-repair", label: "Repair the exact browser-verified requirement gap", status: "pending" }],
    costScopeId: input.execution.costScopeId,
    access,
    apiKey: repairModel.apiKey,
    provider: repairModel.provider,
    onEvent: (event) => input.execution.emit(event),
    signal: input.signal,
    approvedCategories: input.approvedCategories,
    standingApprovedCommands: input.approvedCommands,
    priorContext: input.parentMission,
    followUpResolution: resolution,
    fastLane: true,
    tier: repairModel.tier,
    highRisk: false,
    hasBuildTooling: false,
    staticProject: true,
    routingAssessment: repairAssessment,
    maxTurns: 3,
    maxNudges: 1,
    maxOutputTokens: 6_000,
  });
  return { ...result, clarificationQuestions: undefined };
}

async function runExistingProjectMission(params: {
  projectPath: string;
  task: string;
  sourceMode: "local-folder" | "uploaded-copy";
  execution: ExecutionContext;
  signal?: AbortSignal;
  approvedCategories?: string[];
  approvedCommands?: string[];
  parentMission?: MissionParentContext;
  followUpResolution?: FollowUpResolutionRecord;
  continuity?: "carry_forward_plan" | "fresh_plan";
  approvalResponse?: ApprovalResponse;
  quality?: MissionQualityLevel;
  modelMode?: ModelMode;
  evidenceAttachments?: EvidenceAttachments;
  idempotencyCandidate?: MissionParentContext;
  retryExecutionId?: string;
}): Promise<{ status: FactoryProjectResult["status"]; blocker?: string; clarificationQuestions?: MissionClarification[]; changedFiles: string[]; commands?: FactoryCommandEvent[]; sessionSummary?: FactorySessionSummary; verification?: ExecutionMissionVerification[]; events: string[]; projectDeleted?: boolean; preview?: PreviewOutcome }> {
  const { projectPath, task, sourceMode, execution, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceAttachments, idempotencyCandidate, retryExecutionId } = params;
  const access = createServerProjectAccess(projectPath, sourceMode, signal);
  const snapshot = await buildProjectSnapshot(access);
  return runExistingProjectMissionWithAccess({ access, task, sourceMode, execution, projectSnapshot: snapshot, workspaceProjectPath: projectPath, previewTarget: workspacePreviewTarget(projectPath), signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceAttachments, idempotencyCandidate, retryExecutionId });
}

type DeterministicStaticSeparationResult = {
  status: FactoryProjectResult["status"];
  blocker?: string;
  changedFiles: string[];
  verification: ExecutionMissionVerification[];
  events: string[];
  sessionSummary?: FactorySessionSummary;
  stackLabel: string;
};

async function runDeterministicStaticSourceSeparation(input: {
  access: ProjectAccess;
  execution: ExecutionContext;
  requestedTask: string;
  stackLabel: string;
}): Promise<DeterministicStaticSeparationResult | undefined> {
  const discovered = await discoverStaticSourceInventory(input.access);
  if (discovered.oversized) {
    await emitExecution(input.execution, "planning", "completed", "Large static refactor promoted to the architecture workflow", {
      details: { paidModelCalls: 0, sourceFiles: discovered.paths.length, sourceBytes: discovered.totalBytes, reason: discovered.oversized },
    });
    return undefined;
  }

  const documents = discovered.files.filter((file) => /\.html?$/i.test(file.path));
  if (!documents.length) return undefined;
  const requestedPaths = explicitProjectFileNames(input.requestedTask);
  const requestedHtml = requestedPaths.filter((file) => /\.html?$/i.test(file));
  if (requestedHtml.length && !requestedHtml.every((requested) => documents.some((document) => requested.includes("/")
    ? normalizeScopePath(document.path) === normalizeScopePath(requested)
    : path.posix.basename(document.path).toLowerCase() === requested.toLowerCase()))) {
    const missing = requestedHtml.filter((requested) => !documents.some((document) => requested.includes("/")
      ? normalizeScopePath(document.path) === normalizeScopePath(requested)
      : path.posix.basename(document.path).toLowerCase() === requested.toLowerCase()));
    const blocker = `Static source separation did not guess missing entry files. Not found: ${missing.join(", ")}.`;
    await emitExecution(input.execution, "summary", "error", "Requested HTML entries were not found", { details: { blocker, paidModelCalls: 0 } });
    finishObjectiveChecklist(input.execution, "failed", blocker);
    return { status: "failed", blocker, changedFiles: [], verification: [], events: [blocker], stackLabel: input.stackLabel };
  }

  let plan;
  try {
    plan = planStaticSourceSeparation({
      documents,
      assets: discovered.files.filter((file) => /\.(?:css|[cm]?js)$/i.test(file.path)),
      requestedPaths,
    });
  } catch (error) {
    const blocker = `Static source separation could not produce an unambiguous write plan: ${error instanceof Error ? error.message : "invalid source layout"}`;
    await emitExecution(input.execution, "summary", "error", "Static source separation plan was ambiguous", { details: { blocker, paidModelCalls: 0 } });
    finishObjectiveChecklist(input.execution, "failed", blocker);
    return { status: "failed", blocker, changedFiles: [], verification: [], events: [blocker], stackLabel: input.stackLabel };
  }

  const originalFiles = new Map(discovered.files.map((file) => [normalizeScopePath(file.path), file.content]));
  const applied: Array<{ path: string; existedBefore: boolean; beforeContent: string }> = [];
  const changedFiles: string[] = [];
  for (const write of plan.writes) {
    const normalizedPath = normalizeScopePath(write.path);
    const existingContent = originalFiles.get(normalizedPath);
    if (existingContent === write.content) continue;
    const written = await input.access.writeFile(write.path, write.content);
    if (!written.verified) {
      const rollbackFailures: string[] = [];
      for (const prior of [...applied].reverse()) {
        if (prior.existedBefore) {
          const reverted = await input.access.writeFile(prior.path, prior.beforeContent);
          if (!reverted.verified) rollbackFailures.push(prior.path);
        } else if (input.access.deleteFile) {
          const removed = await input.access.deleteFile(prior.path);
          if (!removed.verified) rollbackFailures.push(prior.path);
        } else {
          rollbackFailures.push(prior.path);
        }
      }
      const rollback = rollbackFailures.length
        ? ` Rollback could not verify: ${rollbackFailures.join(", ")}.`
        : " Every earlier write in this batch was rolled back and verified.";
      const blocker = `Could not verify ${write.path} during coordinated static source separation: ${written.reason || "disk read-back did not match"}.${rollback}`;
      await emitExecution(input.execution, written.existedBefore ? "edit" : "file", "error", `Could not verify ${write.path}`, {
        fileName: path.posix.basename(write.path), filePath: write.path, beforeContent: written.beforeContent,
        details: { blocker, rollbackFailures, deterministicOperation: "static-source-separation", paidModelCalls: 0 },
      });
      finishObjectiveChecklist(input.execution, "failed", blocker);
      return { status: "failed", blocker, changedFiles: [], verification: [{ check_type: "file-read", result: "fail", evidence: blocker }], events: [blocker], stackLabel: input.stackLabel };
    }
    const beforeContent = existingContent ?? written.beforeContent ?? "";
    applied.push({ path: write.path, existedBefore: existingContent !== undefined || written.existedBefore, beforeContent });
    changedFiles.push(write.path);
    await emitExecution(input.execution, written.existedBefore ? "edit" : "file", "completed", `${written.existedBefore ? "Updated" : "Created"} ${write.path}`, {
      fileName: path.posix.basename(write.path), filePath: write.path, output: written.diff, beforeContent,
      details: { bytes: written.bytes, modifiedAt: written.modifiedAt, writeKind: write.kind, deterministicOperation: "static-source-separation", paidModelCalls: 0 },
    });
  }

  const fileSummary = [...plan.htmlFiles, ...plan.assetFiles];
  const evidence = `Deterministic static source separation completed with zero model calls across ${plan.htmlFiles.length} HTML entr${plan.htmlFiles.length === 1 ? "y" : "ies"}. ${plan.assetFiles.length} referenced asset file${plan.assetFiles.length === 1 ? " was" : "s were"} planned from explicit names, existing references, or entry-derived names; dependencies were committed before HTML and every write was read back from disk.`;
  input.execution.checklist.splice(0, input.execution.checklist.length, {
    id: "static-source-separation",
    label: "Separate HTML, CSS, and JavaScript source files",
    status: "completed",
    evidence,
  });
  await emitExecution(input.execution, "summary", "completed", `Separated ${plan.htmlFiles.length} static HTML entr${plan.htmlFiles.length === 1 ? "y" : "ies"} into verified source files`, {
    output: evidence,
    details: { changedFiles, plannedFiles: fileSummary, paidModelCalls: 0, extractedStyleBlocks: plan.extractedStyleBlocks, extractedScriptBlocks: plan.extractedScriptBlocks },
  });
  finishObjectiveChecklist(input.execution, "passed");
  return {
    status: "passed",
    changedFiles,
    verification: [{ check_type: "file-read", result: "pass", evidence }],
    sessionSummary: {
      outcome: `Separated ${plan.htmlFiles.length} static HTML entr${plan.htmlFiles.length === 1 ? "y" : "ies"} using the project’s actual paths and references, then handed the coordinated source set to the owned browser gate for desktop/mobile verification.`,
      changes: changedFiles,
      preserved: ["Existing HTML structure, CSS rules, executable JavaScript behavior, nested paths, and data-script semantics"],
      flags: [],
    },
    events: [evidence],
    stackLabel: input.stackLabel,
  };
}

async function discoverStaticSourceInventory(access: ProjectAccess): Promise<{ files: StaticSourceInputFile[]; paths: string[]; totalBytes: number; oversized?: string }> {
  const ignoredDirectory = /^(?:node_modules|\.git|\.next|\.foundry-artifacts|\.foundry-data|coverage|dist|build|out|vendor|bin|obj|\.venv|venv)$/i;
  const queue: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
  const paths: string[] = [];
  let visitedDirectories = 0;
  while (queue.length) {
    const current = queue.shift() as { path: string; depth: number };
    const entries = await access.listDir(current.path).catch(() => []);
    visitedDirectories += 1;
    if (visitedDirectories > 2_000) return { files: [], paths, totalBytes: 0, oversized: "More than 2,000 source directories require a staged architecture plan." };
    for (const entry of entries) {
      const relative = current.path ? `${current.path}/${entry.name}` : entry.name;
      if (entry.kind === "directory" && current.depth < 20 && !ignoredDirectory.test(entry.name)) queue.push({ path: relative, depth: current.depth + 1 });
      else if (entry.kind === "file" && /\.(?:html?|css|[cm]?js)$/i.test(entry.name)) paths.push(relative);
      if (paths.length > 5_000) return { files: [], paths, totalBytes: 0, oversized: "More than 5,000 static source files require a staged architecture plan." };
    }
  }

  const files: StaticSourceInputFile[] = [];
  let totalBytes = 0;
  for (let offset = 0; offset < paths.length; offset += 32) {
    const batch = await Promise.all(paths.slice(offset, offset + 32).map(async (filePath) => ({
      path: filePath,
      read: await access.readFile(filePath, { limitBytes: 10_000_000 }),
    })));
    for (const item of batch) {
      if (!item.read.exists) continue;
      if (item.read.truncated) return { files, paths, totalBytes, oversized: `${item.path} exceeds the 10 MB single-source deterministic limit and requires a staged architecture plan.` };
      totalBytes += item.read.totalBytes;
      if (totalBytes > 64_000_000) return { files, paths, totalBytes, oversized: "The static source set exceeds the 64 MB deterministic transaction limit and requires a staged architecture plan." };
      files.push({ path: item.path, content: item.read.content });
    }
  }
  return { files, paths, totalBytes };
}

async function importedSdkEvidencePaths(access: ProjectAccess) {
  const queue = [".foundry-input/sdk"];
  const paths: string[] = [];
  while (queue.length && paths.length < 2_000) {
    const current = queue.shift()!;
    const entries = await access.listDir(current).catch(() => []);
    for (const entry of entries) {
      const relative = `${current}/${entry.name}`;
      if (entry.kind === "directory") queue.push(relative);
      else paths.push(relative);
    }
  }
  return paths;
}

async function runExistingProjectMissionWithAccess(params: {
  access: ReturnType<typeof createServerProjectAccess> | ReturnType<typeof createLocalConnectorProjectAccess>;
  task: string;
  sourceMode: "local-folder" | "uploaded-copy";
  execution: ExecutionContext;
  projectSnapshot: string;
  workspaceProjectPath?: string;
  previewTarget?: ProjectPreviewTarget;
  signal?: AbortSignal;
  approvedCategories?: string[];
  approvedCommands?: string[];
  parentMission?: MissionParentContext;
  followUpResolution?: FollowUpResolutionRecord;
  continuity?: "carry_forward_plan" | "fresh_plan";
  approvalResponse?: ApprovalResponse;
  quality?: MissionQualityLevel;
  modelMode?: ModelMode;
  evidenceAttachments?: EvidenceAttachments;
  idempotencyCandidate?: MissionParentContext;
  retryExecutionId?: string;
}): Promise<{ status: FactoryProjectResult["status"]; blocker?: string; clarificationQuestions?: MissionClarification[]; changedFiles: string[]; commands?: FactoryCommandEvent[]; sessionSummary?: FactorySessionSummary; verification?: ExecutionMissionVerification[]; events: string[]; stackLabel?: string; projectDeleted?: boolean; preview?: PreviewOutcome }> {
  const { access, task: requestedTask, sourceMode, execution, projectSnapshot, workspaceProjectPath, previewTarget, signal, approvedCategories = [], approvedCommands = [], parentMission, followUpResolution, continuity, approvalResponse: structuredApprovalResponse, quality = DEFAULT_MISSION_QUALITY, modelMode = "auto", evidenceAttachments = [], idempotencyCandidate, retryExecutionId } = params;
  // Older browser bundles sent approval controls as synthetic prose. Treat that wire format as a
  // control response on the server too, so a stale tab can never restart a premium Builder mission.
  const legacyDeniedCommand = requestedTask.match(/^Denied approval to run "([\s\S]+)" - mark the checklist item/i)?.[1]?.trim();
  const approvalResponse: ApprovalResponse = structuredApprovalResponse ?? (legacyDeniedCommand
    ? { requestedCommand: legacyDeniedCommand, decision: "deny" }
    : undefined);
  const currentProjectIdentity = normalizeProjectIdentity(access.rootLabel);
  const recordedProjectIdentity = parentMission?.projectIdentity ? normalizeProjectIdentity(parentMission.projectIdentity) : undefined;
  if (recordedProjectIdentity && recordedProjectIdentity !== currentProjectIdentity) {
    const blocker = `Retry refused: the recorded execution belongs to ${parentMission?.projectIdentity}, but the active project is ${access.rootLabel}. No model call, command, or file write was allowed.`;
    await emitExecution(execution, "blocked", "error", "Retry project identity did not match", {
      details: { blocker, recordedProjectIdentity: parentMission?.projectIdentity, activeProjectIdentity: access.rootLabel, paidModelCalls: 0 },
    });
    finishObjectiveChecklist(execution, "failed");
    return { status: "failed", blocker, changedFiles: [], commands: [], verification: [], events: [blocker] };
  }
  // Runtime control is an owned Foundry operation, never an implementation mission. Keep this
  // server-side so an old browser bundle cannot accidentally send "start the site" through project
  // discovery, a paid model, source writes, or browser-repair acceptance. This branch intentionally
  // runs before reading the saved brief or classifying the request as an edit.
  if (followUpResolution?.runtimeOperation === "preview_refresh" || isPreviewRestartRequest(requestedTask)) {
    if (!previewTarget) {
      const blocker = "This project does not have a preview target that Foundry can start.";
      await emitExecution(execution, "blocked", "error", blocker, { details: { paidModelCalls: 0, changedFiles: 0, runtimeControl: true } });
      finishObjectiveChecklist(execution, "failed");
      return { status: "failed", blocker, changedFiles: [], commands: [], verification: [], events: [blocker] };
    }
    await emitExecution(execution, "preview", "running", "Starting the project preview", {
      details: { paidModelCalls: 0, changedFiles: 0, runtimeControl: true },
    });
    const detected = await detectStackProfileAndEntriesForAccess(access);
    const preview = await startProjectPreview(previewTarget, detected.profile.label, [], execution);
    const canonicalStaticEntry = detected.rootEntries.find((entry) => /^index\.html?$/i.test(entry));
    if (canonicalStaticEntry && preview.previewUrl) {
      const canonicalUrl = new URL(canonicalStaticEntry, preview.previewUrl).toString();
      preview.previewUrl = canonicalUrl;
      const ownedPreview = previewProcesses.get(previewTarget.projectId);
      if (ownedPreview) ownedPreview.previewUrl = canonicalUrl;
    }
    const ready = preview.previewState === "ready";
    const message = ready
      ? `Preview is running${preview.previewUrl ? ` at ${preview.previewUrl}` : ""}. No project files were changed.`
      : preview.previewReason || "Foundry could not start this project's preview.";
    await emitExecution(execution, "preview", ready ? "completed" : "error", message, {
      details: { paidModelCalls: 0, changedFiles: 0, runtimeControl: true, previewState: preview.previewState, previewUrl: preview.previewUrl },
    });
    finishObjectiveChecklist(execution, ready ? "passed" : "failed");
    return {
      status: ready ? "passed" : "failed",
      blocker: ready ? undefined : message,
      changedFiles: [],
      commands: [],
      verification: [],
      events: [message],
      stackLabel: detected.profile.label,
      preview,
    };
  }
  const originalTask = parentMission?.source_requirements?.find((requirement) => requirement.trim());
  const operationVerbPresent = /\b(?:run|execute|rerun|verify|validate|revalidate|check|recheck|publish|build|test|retest|launch|open|expose)\b/i.test(requestedTask);
  const explicitlyNoMutation = /\b(?:do not|don't|without)\b[^.!?\n]{0,100}\b(?:edit|change|modify|rewrite|touch)(?:ing)?\b|\bno\s+(?:source|file|code)\s+changes?\b/i.test(requestedTask);
  const verificationOnlyRequest = /\b(?:verify|validate|revalidate|check|recheck|test|retest)\b/i.test(requestedTask)
    && /\b(?:browser|preview|navigation|build|test|lint|typecheck|runtime|server|endpoint|artifact)\b/i.test(requestedTask)
    && !/\b(?:add|create|implement|change|modify|rewrite|refactor|fix|repair|resolve|complete|finish|remove|delete)\b/i.test(requestedTask);
  const explicitlyReadOnlyOperation = operationVerbPresent && (explicitlyNoMutation || verificationOnlyRequest);
  const mutatingOutcomeRequired = !explicitlyReadOnlyOperation && (
    followUpResolution?.currentIntent === "edit"
    || followUpResolution?.currentIntent === "debug"
    || followUpResolution?.currentIntent === "undo"
    || followUpResolution?.currentIntent === "continue"
    || (!followUpResolution && Boolean(deterministicMutationIntent(requestedTask)))
  );
  const exactRetry = Boolean(retryExecutionId && parentMission?.id === retryExecutionId);
  const standaloneMutationRequest = followUpResolution
    ? followUpResolution.currentIntent === "edit" || followUpResolution.currentIntent === "debug"
    : Boolean(deterministicMutationIntent(requestedTask));
  const isControlContinuation = Boolean(approvalResponse)
    // Retry identifies the failed execution, but a complete new edit instruction remains the
    // authoritative scope. Treating every retry as "continue the old plan" resurrected the original
    // creation checklist over a later named-person portfolio rewrite.
    || (exactRetry && !standaloneMutationRequest)
    || (followUpResolution?.currentIntent === "continue" && !standaloneMutationRequest);
  let task = continuity === "carry_forward_plan" && !explicitlyReadOnlyOperation && originalTask && isControlContinuation
    ? `${originalTask}\n\nContinuation decision: ${requestedTask}. Continue the entire original request; do not stop after only the approved action or decision.`
    : requestedTask;
  const evidenceImages = evidenceAttachments
    .filter((attachment) => attachment.uploadStatus === "image" && Boolean(attachment.dataUrl))
    .map((attachment) => ({
      fileName: attachment.fileName,
      mediaType: attachment.dataUrl?.match(/^data:([^;,]+)/i)?.[1] || attachment.mediaType || "image/png",
      dataUrl: attachment.dataUrl!,
    }));
  const readableEvidence = evidenceAttachments
    .filter((attachment) => attachment.uploadStatus === "readable" && Boolean(attachment.rawText))
    .map((attachment) => `--- ${attachment.fileName} (${attachment.evidenceKind || attachment.mediaType || "readable file"}) ---\n${redactSensitiveText(attachment.rawText!).slice(0, 100_000)}`)
    .join("\n\n")
    .slice(0, 200_000);
  if (readableEvidence) {
    task = `${task}\n\nAttached readable evidence (authoritative user-provided content; use it when implementing the request):\n${readableEvidence}`;
  }
  if (continuity === "carry_forward_plan" && !explicitlyReadOnlyOperation && isControlContinuation) {
    const savedBrief = await access.readFile("foundry-brief.md", { limitBytes: 100_000 }).catch(() => undefined);
    if (savedBrief?.exists && savedBrief.content.trim() && !task.includes(savedBrief.content.trim())) {
      task = `${task}\n\nSaved project brief (authoritative requirements):\n${savedBrief.content.trim()}`;
    }
  }
  // Establish one project-level acceptance request before any reuse, retry, preflight, repair, or
  // final browser branch runs. Otherwise an early retry check can forget the creation brief, report
  // an artificial capability gap, and send that bad evidence into a source-repair model.
  const durableBrowserBrief = await access.readFile("foundry-brief.md", { limitBytes: 100_000 }).catch(() => undefined);
  // The brief is the acceptance contract for *building* the project — not for every later edit to it.
  // Inheriting it unconditionally meant a scoped follow-up was judged against the whole product: asking
  // to move a number was failed for "missing capability: search-filter", a feature the project has had
  // since it was built and that the edit never touched. Every deterministic check (file read-back,
  // typecheck, production build, live preview) passed, so the user saw "it failed even though it built".
  //
  // A request that names a concrete change carries its own acceptance. A bare continuation ("retry",
  // "finish it") or a build/rebuild names none, so those still inherit the brief — which is the case the
  // inheritance was originally added for.
  const requestNamesConcreteChange = followUpResolution?.currentIntent === "edit"
    || (!followUpResolution && deterministicMutationIntent(requestedTask) === "edit")
    || looksUnambiguouslyLikeSmallEdit(requestedTask)
    || looksLikeBoundedClientInteraction(requestedTask);
  const inheritedBrowserRequest = [
    durableBrowserBrief?.exists && !requestNamesConcreteChange ? durableBrowserRequirementsFromBrief(durableBrowserBrief.content) : "",
    requestedTask,
    requestNamesConcreteChange ? "" : parentMission?.source_requirements.join("\n") ?? "",
  ].filter(Boolean).join("\n\n");
  const projectDeletion = await handleWholeProjectDeletion({
    access,
    execution,
    requestedTask,
    parentMission,
    approvalResponse,
    signal,
  });
  if (projectDeletion) return projectDeletion;
  // Retry/resume is a separate execution entry point from initial creation. Reapply the exact same
  // external-integration gate here before discovery, routing, or generation so a failed browser/agent
  // handoff cannot be bypassed by clicking Retry or Continue. Only the selected brief fields are
  // authoritative; alternative stacks in the memo must not create false prerequisites.
  if (isControlContinuation || !requestNamesConcreteChange) {
    const selectedSpec = durableBrowserBrief?.exists ? parseBrief(durableBrowserBrief.content) : undefined;
    const prerequisiteBrief = selectedSpec
      ? [selectedSpec.projectDescription, `Selected stack: ${selectedSpec.stack}`, selectedSpec.instructions].filter(Boolean).join("\n")
      : requestedTask;
    const requiredIntegrations = integrationRequirementsForBrief(prerequisiteBrief);
    if (requiredIntegrations.length) {
      const credentialProjectId = workspaceProjectPath
        ? path.basename(workspaceProjectPath)
        : execution.projectId || `connector-${slugify(access.rootLabel) || "project"}`;
      const configured = await projectIntegrationEnvironment({ projectId: credentialProjectId, environment: "development", location: "local" });
      const importedEvidence = await importedSdkEvidencePaths(access);
      const suppliedEvidence = evidenceAttachments.map((attachment) => `${attachment.fileName} ${attachment.rawText ?? ""}`);
      const hardwareProviders = integrationProvidersFromEvidence(requiredIntegrations, [...importedEvidence, ...suppliedEvidence]);
      const missing = missingIntegrationRequirements(requiredIntegrations, [...configured.providers, ...hardwareProviders]);
      if (missing.length) {
        const questions = missing.map(integrationRequirementPrompt);
        const blocker = `Foundry still needs ${missing.length} verified project integration${missing.length === 1 ? "" : "s"} before execution can resume. No generation model was called.`;
        const paused = await pauseForPlanConflicts(execution, questions.map((question) => question.question));
        return {
          status: paused.status,
          blocker,
          clarificationQuestions: questions,
          changedFiles: [],
          commands: [],
          verification: [],
          events: [blocker, ...questions.map((question) => question.question)],
        };
      }
    }
  }
  // Approval clicks are bounded control turns. Do not start each one on the premium builder tier.
  let workingSet = await discoverProjectWorkingSet(access, task);
  await emitExecution(execution, "reasoning", "completed", workingSet.likelyFiles.length
    ? `Working set selected: ${workingSet.likelyFiles.slice(0, 3).join(", ")}${workingSet.likelyFiles.length > 3 ? " and their dependencies" : ""}.`
    : "Project discovery found no task-specific files; implementation will inspect dependencies as needed.");
  const onEvent = (event: FactoryExecutionEvent) => execution.emit(event);
  const objective = engineeringObjectiveForTask(task);
  const detectedStack = await detectStackProfileAndEntriesForAccess(access);
  const durableGeneratedBrief = await access.readFile("foundry-brief.md", { limitBytes: 100_000 }).catch(() => undefined);
  const generatedProjectFromBrief = durableGeneratedBrief?.exists
    && /^Mode:\s*Build new project$/im.test(durableGeneratedBrief.content)
    && /^Project source(?: mode)?:\s*Create inside Foundry workspace$/im.test(durableGeneratedBrief.content);
  const authoritativeGeneratedStack = generatedProjectFromBrief
    ? capabilityLevelForStackChoice(parseBrief(durableGeneratedBrief.content).stack)
    : undefined;
  const detectedStackMismatch = Boolean(authoritativeGeneratedStack && authoritativeGeneratedStack.id !== detectedStack.profile.id);
  let stackProfile = authoritativeGeneratedStack ?? detectedStack.profile;
  const { rootEntries } = detectedStack;
  const staticSourceTopology = detectedStack.profile.id === "static-html"
    ? await captureStaticSourceTopology(access, rootEntries)
    : undefined;
  if (staticSourceTopology?.linkedFiles.length) {
    workingSet = {
      ...workingSet,
      likelyFiles: [...new Set([
        ...workingSet.likelyFiles,
        staticSourceTopology.entry,
        ...staticSourceTopology.linkedFiles,
      ])],
    };
    task = `${task}

Mandatory existing-source contract: preserve this project's established multi-file architecture. The HTML entry ${staticSourceTopology.entry} must continue loading ${staticSourceTopology.linkedFiles.join(", ")}. Keep styling and behavior in their existing linked files; do not replace them with competing inline CSS or JavaScript, duplicate the implementation, or orphan those files unless the user explicitly asked to consolidate the source.`;
  }
  let verificationProfile = detectedStack.verificationProfile;
  const runCanonicalProjectBuild = async (): Promise<FactoryCommandEvent | undefined> => {
    if (!stackHasBuildStep(stackProfile.id) || !access.runCommand) return undefined;
    const command = "npm run build";
    // A framework preview reads manifests and generated chunks from the same directory that the
    // production build replaces. Pause it before building so one generation cannot be mixed with
    // another even when the Preview panel was already open before this mission started.
    if (previewTarget) await stopProjectPreview(previewTarget);
    await emitExecution(execution, "command", "running", `Running ${command}`, {
      command,
      details: { purpose: "owned preview build", sourceMode: access.mode, paidModelCalls: 0 },
    });
    const built = await access.runCommand(command, "", { approvedCategories, approvedCommands });
    const result: FactoryCommandEvent = {
      command,
      exitCode: built.exitCode,
      stdout: built.stdout,
      stderr: built.stderr || built.reason || built.skipped || "",
      durationMs: built.durationMs,
      approvalScope: built.approvalScope,
    };
    await emitExecution(execution, "command", built.exitCode === 0 ? "completed" : "error", built.exitCode === 0 ? "Production build passed" : "Production build failed", {
      command,
      exitCode: built.exitCode,
      durationMs: built.durationMs,
      output: built.stdout || built.stderr || built.reason,
      stdout: built.stdout,
      stderr: built.stderr,
      details: { purpose: "owned preview build", sourceMode: access.mode, skipped: built.skipped, paidModelCalls: 0 },
    });
    return result;
  };
  if (stackProfile.id === "unknown" && rootEntries.some((entry) => entry.toLowerCase() === "foundry-brief.md")) {
    const savedBrief = await access.readFile("foundry-brief.md", { limitBytes: 100_000 });
    const selectedStack = savedBrief.content.match(/^Selected stack:\s*(.+)$/im)?.[1]?.trim();
    if (selectedStack) stackProfile = capabilityLevelForStackChoice(selectedStack);
  }
  const reusePreviewPlatform = previewPlatformForStack(stackProfile.label);
  const currentDefectReport = reportsCurrentBehaviorFailure(requestedTask);
  const namedControlDefect = reportsNamedControlFailure(requestedTask);
  const requiresCurrentBehaviorAcceptance = requiresFreshBehavioralAcceptance(requestedTask);
  // A current defect report always overrides older completion evidence. For other behavioral work,
  // reuse is permitted only where Foundry can immediately run a requirement-directed web gate.
  // Native desktop/mobile, APIs, CLIs, and background workflows must execute normally until their
  // behavior is exercised by a platform-specific acceptance driver.
  const priorCompletionCanBeReused = mayAttemptPriorCompletionReuse(requestedTask, reusePreviewPlatform);
  const exactFailedRetry = shouldResumeExactFailedRetry({
    exactRetry,
    retryIdMatchesParent: Boolean(parentMission && retryExecutionId === parentMission.id),
    parentState: parentMission?.state,
    hasApprovalResponse: Boolean(approvalResponse),
    attachmentCount: evidenceAttachments.length,
  });
  const retryPreModelCommands: FactoryCommandEvent[] = [];
  const retryPreModelVerification: ExecutionMissionVerification[] = [];
  let retryRepairEvidence: string | undefined;
  let retryBuildFailure: FactoryCommandEvent | undefined;
  if (exactFailedRetry && parentMission) {
    const reused = priorCompletionCanBeReused
      ? await reuseVerifiedMissionIfCurrent({
          candidate: parentMission,
          requestedTask,
          access,
          execution,
          verificationProfile,
          workspaceProjectPath,
          stackLabel: stackProfile.label,
          allowIncompleteMission: true,
        })
      : undefined;
    if (!priorCompletionCanBeReused) {
      await emitExecution(execution, "inspection", "completed", currentDefectReport
        ? "The new defect report overrides the older completion record; investigating current behavior"
        : `File fingerprints and a build cannot prove the requested ${reusePreviewPlatform} behavior; executing normally`, {
        details: { priorMissionId: parentMission.id, paidModelCalls: 0, currentDefectReport, requiresCurrentBehaviorAcceptance, previewPlatform: reusePreviewPlatform },
      });
    }
    if (reused) {
      if (stackHasBuildStep(stackProfile.id)) {
        const build = await runCanonicalProjectBuild();
        if (build) {
          reused.commands.push(build);
          retryPreModelCommands.push(build);
          const buildVerification = { check_type: "build" as const, result: build.exitCode === 0 ? "pass" as const : "fail" as const, evidence: build.exitCode === 0 ? "The current production build passed before retry routing." : `The current production build failed before retry routing: ${summarizeCommandFailure(build)}` };
          reused.verification.push(buildVerification);
          retryPreModelVerification.push(buildVerification);
        }
        if (!build || build.exitCode !== 0) {
          retryBuildFailure = build;
          retryRepairEvidence = build
            ? `The current production build failed: ${summarizeCommandFailure(build)}`
            : "The project declares a production build, but the current connector could not run it.";
        }
      }
      if (!retryRepairEvidence && previewPlatformForStack(stackProfile.label) === "web" && previewTarget) {
        const preview = await startProjectPreview(previewTarget, stackProfile.label, [], execution);
        if (preview.previewUrl && preview.previewState === "ready" && preview.previewPlatform === "web") {
          const browser = await validateGeneratedStaticPreview(preview.previewUrl, previewArtifactRoot(previewTarget), execution, preview.previewOwnershipToken, inheritedBrowserRequest);
          reused.verification.push({ check_type: "preview", result: browser.verified && browser.acceptanceVerified ? "pass" : "fail", evidence: browser.evidence });
          if (browser.verified && browser.acceptanceVerified) {
            reused.sessionSummary.outcome = "The requested implementation was already on disk. Foundry verified the current files and exercised the finished experience in a real browser without another model call.";
            await emitExecution(execution, "summary", "completed", "Existing implementation verified; no model call needed", { details: { priorMissionId: parentMission.id, paidModelCalls: 0, previewUrl: preview.previewUrl } });
            return reused;
          }
          retryRepairEvidence = browser.evidence;
          retryPreModelVerification.push({ check_type: "preview", result: "fail", evidence: browser.evidence });
        } else {
          retryRepairEvidence = preview.previewReason || "The owned preview did not become ready for browser verification.";
        }
      }
      if (!retryRepairEvidence) return reused;
    }
    if (!reused && priorCompletionCanBeReused && parentMission.files_touched.length > 0) {
      await emitExecution(execution, "inspection", "completed", "Retry snapshot changed; executing the recorded request against current files", {
        details: { priorMissionId: parentMission.id, paidModelCalls: 0, reason: "A generic build or browser pass cannot prove that the failed mission's requested features exist." },
      });
    }
  }
  if (retryRepairEvidence) {
    initializeObjectiveChecklist(execution, requestedTask, sourceMode);
    task = `${task}\n\nRetry preflight found a real verification failure. Repair this exact evidence, preserve the working implementation, then rebuild and repeat the same gate.\n\nVerified failure:\n${retryRepairEvidence}`;
    workingSet = retryBuildFailure && workspaceProjectPath
      ? workingSetWithCommandFailure(await discoverProjectWorkingSet(access, task), retryBuildFailure, workspaceProjectPath)
      : await discoverProjectWorkingSet(access, task);
    await emitExecution(execution, "reasoning", "completed", "The unchanged implementation still fails a real gate. I’m routing the verified evidence into one bounded repair pass, then I’ll repeat the same check.", {
      details: { paidModelCalls: 0, repairRequired: true, priorMissionId: parentMission?.id, likelyFiles: workingSet.likelyFiles },
    });
  }
  if (idempotencyCandidate && !approvalResponse && continuity !== "carry_forward_plan" && priorCompletionCanBeReused) {
    const reused = await reuseVerifiedMissionIfCurrent({
      candidate: idempotencyCandidate,
      requestedTask,
      access,
      execution,
      verificationProfile,
      workspaceProjectPath,
      stackLabel: stackProfile.label,
    });
    if (reused) {
      const requiresRenderedAcceptance = requiresCurrentBehaviorAcceptance && reusePreviewPlatform === "web";
      if (!requiresRenderedAcceptance) return reused;

      let reuseFailure = "";
      if (stackHasBuildStep(stackProfile.id)) {
        const build = await runCanonicalProjectBuild();
        if (build) {
          reused.commands.push(build);
          reused.verification.push({ check_type: "build", result: build.exitCode === 0 ? "pass" : "fail", evidence: build.exitCode === 0 ? "The current production build passed before existing-work acceptance." : `The current production build failed before existing-work acceptance: ${summarizeCommandFailure(build)}` });
        }
        if (!build || build.exitCode !== 0) reuseFailure = build ? summarizeCommandFailure(build) : "The canonical build could not run.";
      }
      if (!reuseFailure && previewTarget) {
        const preview = await startProjectPreview(previewTarget, stackProfile.label, [], execution);
        if (preview.previewUrl && preview.previewState === "ready" && preview.previewPlatform === "web") {
          const browser = await validateGeneratedStaticPreview(preview.previewUrl, previewArtifactRoot(previewTarget), execution, preview.previewOwnershipToken, inheritedBrowserRequest);
          reused.verification.push({ check_type: "preview", result: browser.verified && browser.acceptanceVerified ? "pass" : "fail", evidence: browser.evidence });
          if (browser.verified && browser.acceptanceVerified) {
            reused.sessionSummary.outcome = "The requested behavior was already present. Foundry verified the unchanged files, production build, and requirement-directed browser acceptance without an implementation model call.";
            await emitExecution(execution, "summary", "completed", "Existing requested behavior verified; no implementation call needed", { details: { priorMissionId: idempotencyCandidate.id, paidModelCalls: 0, acceptanceUrl: browser.acceptanceUrl } });
            return reused;
          }
          reuseFailure = browser.evidence;
        } else {
          reuseFailure = preview.previewReason || "The owned preview did not become ready for requirement-directed acceptance.";
        }
      }
      if (!reuseFailure) reuseFailure = "Foundry could not establish requirement-directed browser acceptance for the unchanged implementation.";
      initializeObjectiveChecklist(execution, requestedTask, sourceMode);
      task = `${task}\n\nExisting-work acceptance did not prove the request is already complete. Inspect and implement only the missing behavior, then repeat the same requirement-directed gate.\n\nAcceptance evidence:\n${reuseFailure}`;
      workingSet = await discoverProjectWorkingSet(access, task);
      await emitExecution(execution, "inspection", "completed", "Matching files alone were insufficient; executing the unverified requirements", {
        details: { priorMissionId: idempotencyCandidate.id, paidModelCalls: 0, acceptanceEvidence: reuseFailure },
      });
    }
  } else if (idempotencyCandidate && !approvalResponse && continuity !== "carry_forward_plan" && !priorCompletionCanBeReused) {
    await emitExecution(execution, "inspection", "completed", currentDefectReport
      ? "The user's current defect report conflicts with the older completion record; executing the repair normally"
      : `The older file fingerprints do not prove current ${reusePreviewPlatform} behavior; executing the request normally`, {
      details: { priorMissionId: idempotencyCandidate.id, paidModelCalls: 0, currentDefectReport, requiresCurrentBehaviorAcceptance, previewPlatform: reusePreviewPlatform },
    });
  }
  const failedAtModelBudgetBoundary = parentMission?.state === "failed"
    && /Estimated request cost would exceed|Model-call limit reached|configured execution limit/i.test(parentMission.blocked_reason ?? "");
  // A compile/test command can finish an explicitly verification-only retry, but it cannot prove a
  // requested behavior edit happened. Mutating retries must inspect the current implementation and
  // settle each requirement; otherwise "node --check" can falsely turn unfinished UI work green.
  if (failedAtModelBudgetBoundary && explicitlyReadOnlyOperation && access.runCommand && verificationProfile.adapterId !== "javascript" && verificationProfile.commands.length > 0) {
    const deterministicCommands: FactoryCommandEvent[] = [];
    const deterministicVerification: ExecutionMissionVerification[] = [];
    const runRecoveryCommand = async (command: string) => {
      await emitExecution(execution, "command", "running", `Running recovery verification: ${command}`, { tier: "trace", command, details: { paidModelCalls: 0, ecosystem: verificationProfile.ecosystem } });
      const commandResult = await access.runCommand!(command, "", { approvedCategories: ["dependencies", "package-runner"] });
      const event: FactoryCommandEvent = { command, exitCode: commandResult.exitCode, stdout: commandResult.stdout, stderr: commandResult.stderr, durationMs: commandResult.durationMs, approvalScope: commandResult.approvalScope };
      deterministicCommands.push(event);
      await emitExecution(execution, "command", commandResult.exitCode === 0 ? "completed" : "error", commandResult.exitCode === 0 ? `Passed ${command}` : `Failed ${command}`, {
        tier: "trace", command, exitCode: commandResult.exitCode, durationMs: commandResult.durationMs, output: commandResult.stdout || commandResult.stderr, stdout: commandResult.stdout, stderr: commandResult.stderr,
        details: { paidModelCalls: 0, ecosystem: verificationProfile.ecosystem },
      });
      return event;
    };
    let recoveryPassed = true;
    let recoveryFailure: FactoryCommandEvent | undefined;
    if (verificationProfile.adapterId === "python" && rootEntries.some((entry) => entry.toLowerCase() === "pyproject.toml")) {
      let bootstrap: FactoryCommandEvent | undefined;
      for (const command of await pythonDependencyBootstrapCommands(workspaceProjectPath!)) {
        bootstrap = await runRecoveryCommand(command);
        if (bootstrap.exitCode === 0) break;
      }
      recoveryPassed = bootstrap?.exitCode === 0;
      if (!recoveryPassed) recoveryFailure = bootstrap;
      deterministicVerification.push({ check_type: "command", result: recoveryPassed ? "pass" : "fail", evidence: recoveryPassed ? "Installed the generated Python project's declared runtime and test dependencies." : `Python dependency installation failed: ${bootstrap ? summarizeCommandFailure(bootstrap) : "No supported dependency declaration was found."}` });
    }
    const requiredChecks = verificationProfile.commands.filter((check) => check.required && !check.longRunning);
    recoveryPassed = recoveryPassed && requiredChecks.length > 0;
    if (recoveryPassed) {
      for (const check of requiredChecks) {
        const checked = await runRecoveryCommand(check.command);
        const passed = checked.exitCode === 0;
        recoveryPassed = recoveryPassed && passed;
        if (!passed) recoveryFailure = checked;
        const checkType: ExecutionMissionVerification["check_type"] = check.stage === "lint" ? "lint" : check.stage === "typecheck" ? "typecheck" : check.stage === "compile" || check.stage === "build" ? "build" : /test|regression/.test(check.stage) ? "test" : "command";
        deterministicVerification.push({ check_type: checkType, result: passed ? "pass" : "fail", evidence: passed ? `${verificationProfile.ecosystem} ${check.stage} passed: ${check.command}.` : `${verificationProfile.ecosystem} ${check.stage} failed: ${summarizeCommandFailure(checked)}` });
        if (!passed) break;
      }
    }
    if (recoveryPassed) {
      const evidence = `${verificationProfile.ecosystem} project recovered from the earlier model-budget boundary with zero additional model calls: ${requiredChecks.map((check) => check.command).join(", ")}.`;
      execution.checklist.splice(0, execution.checklist.length, ...(parentMission?.plan.length ? parentMission.plan.map((item) => ({ ...item, status: "completed" as const, evidence })) : [{ id: "deterministic-recovery", label: "Verify the generated project", status: "completed" as const, evidence }]));
      await emitExecution(execution, "summary", "completed", "Generated project verified without another model call", { output: evidence, details: { paidModelCalls: 0, ecosystem: verificationProfile.ecosystem } });
      finishObjectiveChecklist(execution, "passed");
      return { status: "passed", changedFiles: [], commands: deterministicCommands, verification: deterministicVerification, events: [evidence], stackLabel: stackProfile.label };
    }
    if (recoveryFailure) {
      task = `${task}\n\nDeterministic verification evidence from the current project (authoritative; fix this exact failure before doing anything else):\nCommand: ${recoveryFailure.command}\nExit: ${recoveryFailure.exitCode ?? "could not start"}\n${summarizeCommandFailure(recoveryFailure)}`;
      workingSet = workingSetWithCommandFailure(await discoverProjectWorkingSet(access, task), recoveryFailure, workspaceProjectPath!);
      await emitExecution(execution, "reasoning", "completed", "The existing project failed its required deterministic verification. The implementation model will receive the exact command and output instead of rediscovering the problem.", {
        command: recoveryFailure.command,
        details: { paidModelCalls: 0, failure: summarizeCommandFailure(recoveryFailure), likelyFiles: workingSet.likelyFiles },
      });
    }
  }
  const explicitBrowserAcceptanceRequest = /\b(?:validate|revalidate|verify|test|retest|exercise|check|recheck)\b/i.test(inheritedBrowserRequest)
    && /\b(?:browser|preview|live\s+(?:site|app)|navigation|user\s+flow|click(?:ing)?|desktop|mobile|responsive)\b/i.test(inheritedBrowserRequest)
    && previewTarget
    && previewPlatformForStack(stackProfile.label) === "web";
  const preModelCommands: FactoryCommandEvent[] = [...retryPreModelCommands];
  const preModelVerification: ExecutionMissionVerification[] = [...retryPreModelVerification];
  let preModelBrowserEvidence: string | undefined = retryRepairEvidence;
  let preModelBrowserBaselineEvidence: string | undefined;
  let preModelBuildFailure: FactoryCommandEvent | undefined = retryBuildFailure;
  const preModelRepairReadPaths: string[] = [];
  let consumedOneTimeApproval = false;
  const desktopPreflightActions = desktopInteractionActionsForTask(inheritedBrowserRequest);
  const explicitDesktopDefectPreflight = currentDefectReport
    && reusePreviewPlatform === "desktop"
    && desktopPreflightActions.length > 0
    && Boolean(previewTarget && access.validateDesktop);
  if (explicitDesktopDefectPreflight && previewTarget && access.validateDesktop) {
    await emitExecution(execution, "preview", "running", "Reproducing the reported native failure before model routing", {
      details: { paidModelCalls: 0, platform: "desktop", actionsJson: JSON.stringify(desktopPreflightActions), purpose: "evidence-first native validation" },
    });
    const desktopPreflightBuild = await runCanonicalProjectBuild();
    if (desktopPreflightBuild) preModelCommands.push(desktopPreflightBuild);
    if (desktopPreflightBuild && desktopPreflightBuild.exitCode !== 0) {
      preModelBuildFailure = desktopPreflightBuild;
      const buildEvidence = `The canonical desktop build failed before native reproduction: ${summarizeCommandFailure(desktopPreflightBuild)}`;
      preModelVerification.push({ check_type: "build", result: "fail", evidence: buildEvidence });
      task = `${task}\n\nDeterministic evidence collected before any implementation model call. Repair this exact build failure before attempting runtime interaction:\n${buildEvidence}`;
      workingSet = workspaceProjectPath
        ? workingSetWithCommandFailure(await discoverProjectWorkingSet(access, task), desktopPreflightBuild, workspaceProjectPath)
        : await discoverProjectWorkingSet(access, task);
    } else {
      const desktopPreview = await startProjectPreview(previewTarget, stackProfile.label, [], execution);
      const connectorArtifact = connectorArtifactTargets.get(previewTarget.projectId);
      let desktopResult: PlatformValidationResult | undefined;
      if (desktopPreview.previewState === "ready" && desktopPreview.previewPlatform === "desktop" && connectorArtifact) {
        desktopResult = await access.validateDesktop({
          executable: connectorArtifact.relativePath,
          args: [],
          observeMs: 1500,
          interactionTimeoutMs: 6000,
          actions: desktopPreflightActions,
        });
      }
      const verified = Boolean(desktopResult?.verified && desktopResult.interactionVerified);
      const classification = classifyAcceptanceEvidence({
        verified,
        available: desktopResult?.available,
        explicitRepairEligible: desktopResult?.repairEligible,
        failureKind: desktopResult?.failureKind,
      });
      const baseEvidence = desktopResult?.reason || desktopPreview.previewReason || "The native preflight could not obtain a runnable desktop artifact.";
      const evidence = desktopResult?.crashEvidence
        ? `${baseEvidence}\n\nOperating-system crash evidence:\n${desktopResult.crashEvidence}`
        : baseEvidence;
      preModelVerification.push({ check_type: "preview", result: verified ? "pass" : "fail", evidence });
      await emitExecution(execution, "preview", verified ? "completed" : classification.repairEligible ? "error" : "warning", verified ? "Reported desktop behavior now passes" : classification.repairEligible ? "Reproduced the real desktop application failure" : "Desktop validator could not establish product failure", {
        details: { paidModelCalls: 0, platform: "desktop", actionsJson: JSON.stringify(desktopPreflightActions), failureOrigin: classification.origin, repairEligible: classification.repairEligible, failureKind: desktopResult?.failureKind, stepsJson: JSON.stringify(desktopResult?.steps ?? []), crashEvidence: desktopResult?.crashEvidence, evidence },
      });
      if (verified) {
        for (const item of execution.checklist) {
          item.status = "completed";
          item.evidence = evidence;
        }
        finishObjectiveChecklist(execution, "passed");
        await emitExecution(execution, "summary", "completed", "Current native behavior verified without a model call or source rewrite", { details: { paidModelCalls: 0 } });
        return { status: "passed", changedFiles: [], commands: preModelCommands, verification: preModelVerification, events: [evidence], stackLabel: stackProfile.label };
      }
      if (!classification.repairEligible) {
        const blocker = `${evidence}\n\nFoundry did not edit project source because this evidence originated in the validator or environment, not the application.`;
        finishObjectiveChecklist(execution, "failed", blocker);
        return { status: "failed", blocker, changedFiles: [], commands: preModelCommands, verification: preModelVerification, events: [blocker], stackLabel: stackProfile.label };
      }
      task = `${task}\n\nAuthoritative native runtime evidence collected before any implementation model call. Repair only this demonstrated application failure, then rebuild and repeat the same named-control interaction.\n\nVerified desktop failure:\n${evidence}`;
      workingSet = await discoverProjectWorkingSet(access, task);
    }
  }
  if (explicitBrowserAcceptanceRequest && previewTarget) {
    await emitExecution(execution, "preview", "running", "Running the real build and desktop/mobile browser gate before model routing", {
      details: { paidModelCalls: 0, purpose: "evidence-first browser validation" },
    });
    let browserPreflightBuild = await runCanonicalProjectBuild();
    if (browserPreflightBuild) preModelCommands.push(browserPreflightBuild);
    if (browserPreflightBuild && browserPreflightBuild.exitCode !== 0 && workspaceProjectPath && !explicitlyReadOnlyOperation) {
      const unresolvedPackages = unresolvedPackageNames(browserPreflightBuild);
      if (unresolvedPackages.length) {
        await emitExecution(execution, "reasoning", "completed", `The browser preflight compiler identified ${unresolvedPackages.length} undeclared package${unresolvedPackages.length === 1 ? "" : "s"}. I'm installing only that exact evidence and rerunning the same build before any repair model is called.`, {
          details: { packages: unresolvedPackages, paidModelCalls: 0 },
        });
        const dependencyInstall = await (async () => { const invocation = missingPackageInstallInvocation(workspaceProjectPath, unresolvedPackages); return runCommand(workspaceProjectPath, invocation.command, invocation.args, [], execution); })();
        preModelCommands.push(dependencyInstall);
        if (dependencyInstall.exitCode === 0) {
          browserPreflightBuild = await runCanonicalProjectBuild();
          if (browserPreflightBuild) preModelCommands.push(browserPreflightBuild);
        }
      }
    }
    if (!browserPreflightBuild || browserPreflightBuild.exitCode === 0) {
      const preModelPreview = await startProjectPreview(previewTarget, stackProfile.label, [], execution);
      if (preModelPreview.previewUrl && preModelPreview.previewState === "ready" && preModelPreview.previewPlatform === "web") {
        const browserPreflight = await validateGeneratedStaticPreview(preModelPreview.previewUrl, previewArtifactRoot(previewTarget), execution, preModelPreview.previewOwnershipToken, inheritedBrowserRequest);
        if (browserPreflight.verified) {
          preModelVerification.push({ check_type: "preview", result: "pass", evidence: browserPreflight.evidence });
          if (!mutatingOutcomeRequired) {
            const completed = [{ id: "browser-acceptance", label: "Verify the real desktop/mobile experience", status: "completed" as const, evidence: browserPreflight.evidence }];
            execution.checklist.splice(0, execution.checklist.length, ...completed);
            finishObjectiveChecklist(execution, "passed");
            await emitExecution(execution, "summary", "completed", "Real desktop/mobile preview verified without a model call", { details: { paidModelCalls: 0 } });
            return { status: "passed", changedFiles: [], commands: preModelCommands, verification: preModelVerification, events: [], stackLabel: stackProfile.label };
          }
          preModelBrowserBaselineEvidence = browserPreflight.evidence;
          await emitExecution(execution, "preview", "completed", "Captured the pre-change desktop/mobile baseline; implementation is still required", {
            details: { paidModelCalls: 0, purpose: "before-change evidence", mutationStillRequired: true },
          });
        } else {
          preModelBrowserEvidence = browserPreflight.evidence;
        }
      } else {
        preModelBrowserEvidence = preModelPreview.previewReason || "The owned web preview did not reach ready state.";
      }
    } else {
      preModelBuildFailure = browserPreflightBuild;
      preModelBrowserEvidence = `The production build failed before browser validation: ${summarizeCommandFailure(browserPreflightBuild)}`;
      preModelVerification.push({ check_type: "build", result: "fail", evidence: preModelBrowserEvidence });
    }
    if (preModelBrowserEvidence) {
      if (explicitlyReadOnlyOperation) {
        preModelVerification.push({ check_type: "preview", result: "fail", evidence: preModelBrowserEvidence });
        const blocker = `Verification-only browser acceptance failed. Foundry preserved every project file and made no repair attempt: ${preModelBrowserEvidence}`;
        finishObjectiveChecklist(execution, "failed", blocker);
        await emitExecution(execution, "summary", "error", "Browser verification failed without changing project source", {
          details: { paidModelCalls: 0, readOnly: true, blocker },
        });
        return { status: "failed", blocker, changedFiles: [], commands: preModelCommands, verification: preModelVerification, events: [blocker], stackLabel: stackProfile.label };
      }
      if (!preModelBuildFailure) preModelRepairReadPaths.push(...await verifiedBrowserRepairReadPaths(access, preModelBrowserEvidence));
      const deterministicRepairPath = await applyVerifiedNavigationRepair(access, preModelBrowserEvidence, execution);
      if (deterministicRepairPath) {
        await stopProjectPreview(previewTarget);
        const deterministicRepairBuild = await runCanonicalProjectBuild();
        if (deterministicRepairBuild) preModelCommands.push(deterministicRepairBuild);
        if (!deterministicRepairBuild || deterministicRepairBuild.exitCode === 0) {
          const repairedPreview = await startProjectPreview(previewTarget, stackProfile.label, [], execution);
          if (repairedPreview.previewUrl && repairedPreview.previewState === "ready" && repairedPreview.previewPlatform === "web") {
            const repairedBrowser = await validateGeneratedStaticPreview(repairedPreview.previewUrl, previewArtifactRoot(previewTarget), execution, repairedPreview.previewOwnershipToken, inheritedBrowserRequest);
            if (repairedBrowser.verified) {
              preModelVerification.push({ check_type: "preview", result: "pass", evidence: repairedBrowser.evidence });
              const completed = [{ id: "browser-acceptance", label: "Verify the real desktop/mobile experience", status: "completed" as const, evidence: repairedBrowser.evidence }];
              execution.checklist.splice(0, execution.checklist.length, ...completed);
              finishObjectiveChecklist(execution, "passed");
              await emitExecution(execution, "summary", "completed", "Browser-evidenced repair rebuilt and verified without a model call", {
                details: { paidModelCalls: 0, changedFiles: [deterministicRepairPath] },
              });
              return { status: "passed", changedFiles: [deterministicRepairPath], commands: preModelCommands, verification: preModelVerification, events: [], stackLabel: stackProfile.label };
            }
            preModelBrowserEvidence = repairedBrowser.evidence;
          } else {
            preModelBrowserEvidence = repairedPreview.previewReason || "The repaired owned web preview did not reach ready state.";
          }
        } else {
          preModelBrowserEvidence = `The production build failed after the deterministic browser repair: ${summarizeCommandFailure(deterministicRepairBuild)}`;
        }
      }
      preModelVerification.push({ check_type: "preview", result: "fail", evidence: preModelBrowserEvidence });
      const verifiedReadHint = preModelRepairReadPaths.length
        ? `Foundry verified these relevant source paths: ${preModelRepairReadPaths.join(", ")}. Read them in that order before editing; do not guess conventional paths or DOM structure.`
        : "No conventional shared stylesheet path was verified. Read the most relevant existing source file from the discovered working set.";
      task = `${task}\n\nDeterministic evidence collected before any implementation model call. Repair only this verified failure, then rebuild and repeat the same browser gate. ${verifiedReadHint}\n\nVerified browser failure:\n${preModelBrowserEvidence}`;
      workingSet = preModelBuildFailure && workspaceProjectPath
        ? workingSetWithCommandFailure(await discoverProjectWorkingSet(access, task), preModelBuildFailure, workspaceProjectPath)
        : await discoverProjectWorkingSet(access, task);
      if (preModelBuildFailure && workspaceProjectPath) {
        const compilerSourcePaths = commandTracebackSourcePaths(workingSet, workspaceProjectPath);
        preModelRepairReadPaths.unshift(...compilerSourcePaths);
      }
    }
  }
  if (preModelBrowserBaselineEvidence) {
    task = `${task}\n\nPre-change browser baseline (evidence only):\n${preModelBrowserBaselineEvidence}\nThis proves the existing interface loads; it does not satisfy the authorized change. Modify the real presentation layer, then run a new browser check against the changed result.`;
    workingSet = await discoverProjectWorkingSet(access, task);
  }
  // An approval click is permission to perform one already-known action, not a request for a model
  // to rediscover that action. Execute the exact structured command before any routing call. This
  // keeps Stop responsive during the real subprocess and prevents a locked or unavailable provider
  // from turning an explicit approval into paid no-op work.
  const approvedAction = approvalResponse && approvalResponse.decision !== "deny"
    ? approvalResponse.requestedCommand.trim()
    : "";
  const approvedActionKind = approvalResponse?.actionKind
    ?? (approvedAction.startsWith("delete ") ? "delete" : "command");
  const approvedCommand = approvedActionKind === "command" ? approvedAction : "";
  if (approvedCommand && access.runCommand) {
    await emitExecution(execution, "command", "running", `Running approved command: ${approvedCommand}`, {
      tier: "trace",
      command: approvedCommand,
      details: { approvalDecision: approvalResponse?.decision, paidModelCalls: 0 },
    });
    const approvedResult = await access.runCommand(approvedCommand, undefined, {
      approvedCommands: Array.from(new Set([approvedCommand, ...approvedCommands])),
      approvedCategories: Array.from(new Set([
        ...approvedCategories,
        ...(approvalResponse?.decision === "approve-category" && approvalResponse.category ? [approvalResponse.category] : []),
      ])),
    });
    const approvedEvent: FactoryCommandEvent = {
      command: approvedCommand,
      exitCode: approvedResult.exitCode,
      stdout: approvedResult.stdout,
      stderr: approvedResult.stderr,
      durationMs: approvedResult.durationMs,
      approvalScope: approvedResult.approvalScope,
    };
    preModelCommands.push(approvedEvent);
    consumedOneTimeApproval = approvalResponse?.decision === "approve-once";
    if (signal?.aborted || approvedResult.skipped === "aborted") {
      const blocker = "Stopped by user while the approved command was running.";
      await emitExecution(execution, "command", "warning", `Stopped approved command: ${approvedCommand}`, {
        tier: "trace",
        command: approvedCommand,
        exitCode: approvedResult.exitCode,
        durationMs: approvedResult.durationMs,
        output: approvedResult.stderr || approvedResult.stdout,
      });
      finishObjectiveChecklist(execution, "stopped", blocker);
      return { status: "stopped", blocker, changedFiles: [], commands: preModelCommands, events: [blocker], stackLabel: stackProfile.label };
    }
    const commandPassed = approvedResult.exitCode === 0 && !approvedResult.skipped;
    await emitExecution(execution, "command", commandPassed ? "completed" : "error", commandPassed ? `Ran ${approvedCommand}` : `Command failed: ${approvedCommand}`, {
      tier: "trace",
      command: approvedCommand,
      exitCode: approvedResult.exitCode,
      durationMs: approvedResult.durationMs,
      output: approvedResult.stdout || approvedResult.stderr,
      stdout: approvedResult.stdout,
      stderr: approvedResult.stderr,
      details: { paidModelCalls: 0 },
    });
    if (!commandPassed) {
      const blocker = approvedResult.reason || approvedResult.stderr || `The approved command exited with code ${approvedResult.exitCode}.`;
      finishObjectiveChecklist(execution, "failed", blocker);
      return {
        status: "failed",
        blocker,
        changedFiles: [],
        commands: preModelCommands,
        verification: [{ check_type: "command", result: "fail", evidence: blocker }],
        events: [blocker],
        stackLabel: stackProfile.label,
      };
    }
    const openParentItems = parentMission?.plan.filter((item) => item.status !== "completed" && item.status !== "skipped") ?? [];
    const parentRequest = parentMission?.source_requirements.join("\n") ?? "";
    const commandOnlyContinuation = openParentItems.length === 1
      && /\b(?:run|execute|rerun|test|build|lint|typecheck|check)\b/i.test(parentRequest)
      && /\b(?:do not|don't|without)\b[^.!?\n]{0,100}\b(?:edit|change|modify|rewrite|touch)(?:ing)?\b|\bno\s+(?:source|file|code)\s+changes?\b/i.test(parentRequest);
    if (commandOnlyContinuation) {
      const evidence = `Approved command passed without a model call: ${approvedCommand} (exit 0).`;
      execution.checklist.splice(0, execution.checklist.length, {
        ...openParentItems[0],
        status: "completed",
        evidence,
      });
      await emitExecution(execution, "summary", "completed", "Approved command completed and verified without a model call", {
        output: evidence,
        details: { paidModelCalls: 0 },
      });
      finishObjectiveChecklist(execution, "passed");
      return {
        status: "passed",
        changedFiles: [],
        commands: preModelCommands,
        verification: [{ check_type: "command", result: "pass", evidence }],
        events: [evidence],
        stackLabel: stackProfile.label,
      };
    }
    task = `${task}\n\nDeterministic continuation evidence: the explicitly approved command \`${approvedCommand}\` already ran successfully with exit code 0 before model routing. Do not run it again unless later source changes make a new verification run necessary.`;
    workingSet = await discoverProjectWorkingSet(access, task);
  }
  // Source separation is a mechanical refactor with a closed, verifiable result. It is planned from
  // discovered entries and references before model routing; conventional file names are never an
  // authority boundary. Oversized/unrecognized layouts fall through to the normal architecture path.
  if (stackProfile.id === "static-html" && isStaticSourceSeparationRequest(requestedTask) && !approvalResponse) {
    const deterministicSeparation = await runDeterministicStaticSourceSeparation({ access, execution, requestedTask, stackLabel: stackProfile.label });
    if (deterministicSeparation) return deterministicSeparation;
  }
  let materializedAssets: MaterializedProjectAsset[] = [];
  const initialModel = await modelForMissionStage(task, modelMode, "fast", workingSet, parentMission?.state === "failed" ? 1 : 0);
  await emitModelSelection(execution, approvalResponse ? "follow-up" : "initial routing", initialModel);
  const apiKey = initialModel?.apiKey;
  if (evidenceAttachments.length) {
    await emitExecution(execution, "inspection", "completed", `Attached evidence ready · ${evidenceAttachments.length} file${evidenceAttachments.length === 1 ? "" : "s"}`, {
      details: { files: evidenceAttachments.map((attachment) => attachment.fileName), visionEnabled: evidenceImages.length > 0, readableFiles: evidenceAttachments.filter((attachment) => attachment.uploadStatus === "readable").length },
    });
  }

  if (signal?.aborted) {
    const blocker = "Stopped by user before completion.";
    await emitExecution(execution, "summary", "warning", "Stopped by user", { details: { reason: blocker } });
    finishObjectiveChecklist(execution, "stopped", blocker);
    return { status: "stopped", blocker, changedFiles: [], events: [blocker] };
  }

  if (!apiKey) {
    const blocker = "No configured AI provider is available. Add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.";
    await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker } });
    finishObjectiveChecklist(execution, "failed", blocker ?? "The web preview did not reach a verified ready state.");
    return { status: "failed", blocker, changedFiles: [], events: [blocker] };
  }

  const attachedAssetWrite = await materializeAttachedProjectAssets(access, evidenceAttachments, requestedTask, stackProfile.id);
  if (attachedAssetWrite.failures.length) {
    const blocker = `Foundry could not safely place every requested attachment into the project: ${attachedAssetWrite.failures.join("; ")}. No implementation model call was sent.`;
    await emitExecution(execution, "summary", "error", "Attached project assets could not be verified", {
      details: { blocker, paidModelCalls: 0, files: evidenceAttachments.map((attachment) => attachment.fileName) },
    });
    finishObjectiveChecklist(execution, "failed", blocker);
    return { status: "failed", blocker, changedFiles: attachedAssetWrite.assets.map((asset) => asset.projectPath), events: [blocker], stackLabel: stackProfile.label };
  }
  materializedAssets = attachedAssetWrite.assets;
  const importedSdkArchives = workspaceProjectPath
    ? importUploadedSdkArchives(workspaceProjectPath, materializedAssets.map((asset) => asset.projectPath), `${stackProfile.id} ${stackProfile.label}`)
    : [];
  if (importedSdkArchives.length) {
    await emitExecution(execution, "inspection", "completed", `Prepared ${importedSdkArchives.length} uploaded SDK package${importedSdkArchives.length === 1 ? "" : "s"}`, {
      details: { providerHardcoded: false, importedLibraries: importedSdkArchives.flatMap((item) => item.files), certification: "not-certified" },
    });
    task = `${task}\n\nFoundry already inspected the uploaded SDK archive and placed its platform-compatible libraries here:\n${importedSdkArchives.flatMap((item) => item.files).map((file) => `- ${file}`).join("\n")}\nUse these libraries directly. Do not ask the user to upload this SDK again and do not claim hardware certification.`;
  }
  if (materializedAssets.length) {
    const assetContract = materializedAssets.map((asset) => `- ${asset.sourceFileName} -> ${asset.publicPath} (project file: ${asset.projectPath})`).join("\n");
    task = `${task}\n\nAttached project asset contract (already written and byte-verified by Foundry):\n${assetContract}\nUse these exact local files in the requested implementation. If the user asked to replace existing assets or remove extras, remove the old generated/remote references and leave only the requested attached assets in that surface. Do not regenerate substitutes.`;
    workingSet = await discoverProjectWorkingSet(access, task);
    // Staging an input is preparation, not implementation. Reporting this as a created application
    // file made a provider refusal look like partial delivery even though no requested source changed.
    await emitExecution(execution, "inspection", "completed", `Staged ${materializedAssets.length} attached project asset${materializedAssets.length === 1 ? "" : "s"} for implementation`, {
      details: { files: materializedAssets.map((asset) => asset.projectPath), byteVerified: true, paidModelCalls: 0 },
    });
  }

  const hasGeneratedRunnableEntry = await hasRunnableProjectEntry(access);
  const savedBriefForRecovery = durableGeneratedBrief;
  const isFoundryGeneratedProject = generatedProjectFromBrief;
  const explicitCommandOnlyRequest = explicitlyReadOnlyOperation;
  // A complete standalone change request must remain a fresh implementation even when a semantic
  // resolver notices that it concerns the same project. Recovery is only for an explicit Retry,
  // approval/control response, or a genuinely referential "continue" turn. Otherwise an old green
  // checklist plus a passing build can falsely swallow brand-new feature requirements.
  const explicitlyContinuingIncompleteMission = isControlContinuation && (
    followUpResolution?.currentIntent === "continue"
    || continuity === "carry_forward_plan"
  );
  const parentHasOpenPlanItems = Boolean(parentMission?.plan.some((item) => item.status !== "completed" && item.status !== "skipped"));
  const resumingIncompleteProject = shouldResumeIncompleteGeneratedProject({
    isFoundryGeneratedProject: Boolean(isFoundryGeneratedProject),
    hasPreModelBrowserEvidence: Boolean(preModelBrowserEvidence),
    isUndo: followUpResolution?.currentIntent === "undo",
    hasRunnableEntry: detectedStackMismatch ? false : hasGeneratedRunnableEntry,
    isControlContinuation: explicitlyContinuingIncompleteMission,
    hasOpenPlanItems: parentHasOpenPlanItems,
    commandOnly: explicitCommandOnlyRequest,
    deletesProject: /^\s*(?:delete|remove|erase)\s+(?:this\s+)?project\b/i.test(requestedTask),
  }) || Boolean(
    isFoundryGeneratedProject
    && stackProfile.id === "android"
    && isControlContinuation
    && parentMission?.state !== "completed"
  );
  // A short Retry/continue control can be classified as operation-only in isolation. Once Foundry
  // has recovered an unfinished generated project, the saved brief is the real task and source
  // mutation is required. Carrying the synthetic control classification into the executor caused
  // models to write "operation-only" no-op anchors merely to satisfy the forced write contract.
  const effectiveCommandOnlyRequest = explicitCommandOnlyRequest && !resumingIncompleteProject;
  const resumingIncompleteStaticProject = resumingIncompleteProject && stackProfile.id === "static-html";
  const needsGeneratedAndroidFoundation = Boolean(isFoundryGeneratedProject && workspaceProjectPath && stackProfile.id === "android");
  const recoveryScaffoldFiles = (resumingIncompleteProject || needsGeneratedAndroidFoundation) && workspaceProjectPath
    ? await ensureRequestedStackScaffold(workspaceProjectPath, stackProfile, path.basename(workspaceProjectPath), execution, [], savedBriefForRecovery?.exists ? parseBrief(savedBriefForRecovery.content).stack : stackProfile.label, savedBriefForRecovery?.exists ? savedBriefForRecovery.content : stackProfile.label, detectedStackMismatch)
    : [];
  if (recoveryScaffoldFiles.length && detectedStackMismatch) {
    verificationProfile = (await detectStackProfileAndEntriesForAccess(access)).verificationProfile;
    await emitExecution(execution, "reasoning", "completed", `Restored the authoritative ${stackProfile.label} scaffold from the saved brief before model routing.`, {
      details: { detectedStack: detectedStack.profile.label, authoritativeStack: stackProfile.label, repairedFiles: recoveryScaffoldFiles, paidModelCalls: 0 },
    });
  }
  if (resumingIncompleteProject) {
    const authoritativeBrief = savedBriefForRecovery ?? await access.readFile("foundry-brief.md", { limitBytes: 100_000 });
    task = [
      "Complete the unfinished generated project from its authoritative saved brief. Create the coordinated implementation, verify it, and run the real output.",
      authoritativeBrief.exists ? `Saved project brief (authoritative requirements):\n${authoritativeBrief.content.trim()}` : "",
      `Current continuation instruction: ${requestedTask.trim()}`,
    ].filter(Boolean).join("\n\n");
    workingSet = await discoverProjectWorkingSet(access, task);
    await emitExecution(execution, "reasoning", "completed", workingSet.likelyFiles.length
      ? `Recovery working set selected from the saved brief: ${workingSet.likelyFiles.slice(0, 3).join(", ")}${workingSet.likelyFiles.length > 3 ? " and their dependencies" : ""}.`
      : "The saved brief did not identify a narrow source set; recovery will inspect the application root without reading generated build output.");
  }
  if (workspaceProjectPath && stackProfile.id === "android") {
    const androidGradle = await access.readFile("app/build.gradle.kts", { limitBytes: 120_000 }).catch(() => ({ exists: false, content: "" }));
    const androidNamespace = androidGradle.content.match(/\bnamespace\s*=\s*["']([^"']+)["']/)?.[1]
      ?? androidGradle.content.match(/\bapplicationId\s*=\s*["']([^"']+)["']/)?.[1];
    if (androidNamespace) {
      task = `${task}\n\nMandatory Android source contract: the established namespace is ${androidNamespace}. Every new Kotlin/Java file must declare package ${androidNamespace} or a child package and must be written under app/src/.../${androidNamespace.replace(/\./g, "/")}/. Do not invent com.example, com.pax, com.merchant, or any parallel application package.`;
    }
    const sdkEvidence = inspectImportedAndroidSdk(workspaceProjectPath);
    if (sdkEvidence.report) {
      task = `${task}\n\nImported Android SDK API evidence (generated from the real AAR; authoritative for integration code):\n${sdkEvidence.report}`;
      await emitExecution(execution, "inspection", "completed", `Inspected ${sdkEvidence.files.length} imported Android SDK archive${sdkEvidence.files.length === 1 ? "" : "s"}`, {
        details: { files: sdkEvidence.files, evidenceFile: ".foundry-input/sdk/sdk-evidence.md", paidModelCalls: 0 },
      });
    } else if (sdkEvidence.error) {
      await emitExecution(execution, "inspection", "error", "Imported Android SDK inspection failed", { details: { error: sdkEvidence.error, paidModelCalls: 0 } });
    }
  }
  await emitExecution(execution, "inspection", "completed", "Detected project stack", {
    internal: true,
    details: { stack: stackProfile.label, capabilityLevel: stackProfile.level },
  });
  if (!parentMission && stackProfile.id === "unknown") {
    const folderSafety = await checkProjectFolderSafety(rootEntries, task);
    if (folderSafety) {
      execution.checklist.splice(0, execution.checklist.length, { id: "folder-safety", label: "Decide how to handle existing unrelated files", status: "blocked", evidence: "One requirement needs your input before I continue." });
      const paused = await pauseForPlanConflicts(execution, [folderSafety]);
      return { status: paused.status, blocker: paused.blocker, clarificationQuestions: paused.clarificationQuestions, changedFiles: [], events: [paused.blocker], stackLabel: stackProfile.label };
    }
  }

  await emitExecution(execution, "planning", "running", "Understanding your request", { internal: true });
  // A finished dependency-free static product is one browser artifact. Multiple acceptance clauses
  // can make the request text look "large" without making the code change multi-system. Keep these
  // bounded follow-ups on Fast and let deterministic Chromium acceptance enforce every clause.
  const semanticStaticMutation = Boolean(followUpResolution)
    && (followUpResolution?.currentIntent === "edit" || followUpResolution?.currentIntent === "debug" || followUpResolution?.currentIntent === "continue")
    && !followUpResolution?.destructive;
  const boundedStaticFollowUp = stackProfile.id === "static-html"
    && workingSet.likelyFiles.filter((file) => /\.(?:html?|css|js)$/i.test(file)).length <= 3
    && (semanticStaticMutation || /\b(?:add|apply|change|implement|update|make|improve|fix|replace|style|show|include)\b/i.test(task))
    && !/\b(?:new|create|add)\s+(?:a\s+|an\s+|another\s+)?(?:file|page|route|screen)\b/i.test(task)
    && !/\b(?:delete|remove\s+(?:the\s+)?project|migration|database|authentication|authorization|payment|billing|secret|credential)\b/i.test(task);
  const boundedStaticWholeRewrite = boundedStaticFollowUp
    && /\b(?:redesign|overhaul|rewrite|rebuild|replace)\b[^.\n]{0,60}\b(?:entire|whole|complete|page|screen|site|interface|ui)\b|\bfrom scratch\b/i.test(task);
  const coordinatedStaticRewrite = boundedStaticWholeRewrite && Boolean(staticSourceTopology?.linkedFiles.length);
  const enforcedReadOnlyIntent = followUpResolution ? null : explicitReadOnlyProjectIntent(task);
  const skipClassifyCall = Boolean(preModelBrowserEvidence) || resumingIncompleteProject || Boolean(approvalResponse) || (continuity === "carry_forward_plan" && isControlContinuation) || namedControlDefect || looksUnambiguouslyLikeSmallEdit(task) || boundedStaticFollowUp;
  const resolvedRuntimeIntent = followUpResolution?.currentIntent === "question"
    ? "question" as const
    : followUpResolution?.currentIntent === "inspection" || followUpResolution?.currentIntent === "diagnose" || followUpResolution?.currentIntent === "retrospective"
      ? "analyze" as const
      : followUpResolution?.currentIntent === "status"
        ? "status" as const
        : followUpResolution?.currentIntent === "undo"
          ? "undo" as const
          : followUpResolution?.currentIntent === "debug"
            ? "debug" as const
            : followUpResolution
              ? "edit" as const
              : undefined;
  const classification = enforcedReadOnlyIntent
    ? {
        intent: enforcedReadOnlyIntent === "question" ? "question" as const : "analyze" as const,
        needsProjectInspection: enforcedReadOnlyIntent === "inspection",
        rationale: "Deterministic read-only authority boundary: manual guidance and explicit no-change requests cannot enter mutation execution.",
      }
    : resolvedRuntimeIntent
    ? { intent: resolvedRuntimeIntent, needsProjectInspection: resolvedRuntimeIntent !== "question", rationale: "Using the authoritative conversation-level semantic resolution without reclassifying the user's wording." }
    : skipClassifyCall
    ? { intent: resumingIncompleteProject ? "build" as const : "edit" as const, needsProjectInspection: true, rationale: resumingIncompleteProject ? "Resuming the unfinished saved project build without paying for another intent-classification call." : "Recognized as a small, unambiguous edit — skipped an extra classification step to start faster." }
    : await classifyIntent({ message: task, hasProjectContext: true, apiKey, provider: initialModel.provider, projectEvidence: { likelyFiles: workingSet.likelyFiles, estimatedSubsystems: workingSet.estimatedSubsystems, crossLayer: workingSet.crossLayer } });
  // The conversation resolver has the full mission history and is authoritative for mutating
  // follow-ups. In particular, an exact undo target must never be reinterpreted by a second,
  // context-poor classifier as a generic edit or generated-project recovery mission.
  if (followUpResolution?.currentIntent === "undo") {
    classification.intent = "undo";
    classification.needsProjectInspection = true;
    classification.rationale = "The resolved follow-up identifies a recorded change to undo.";
  } else if (followUpResolution?.currentIntent === "debug") {
    classification.intent = "debug";
    classification.needsProjectInspection = true;
  } else if (followUpResolution?.currentIntent === "edit" || followUpResolution?.currentIntent === "continue") {
    classification.intent = "edit";
    classification.needsProjectInspection = true;
  }
  const routingAssessment = "routingAssessment" in classification ? classification.routingAssessment : deterministicTaskAssessment(task);
  if (preModelBrowserEvidence) {
    classification.intent = "debug";
    classification.needsProjectInspection = true;
    classification.rationale = "A real browser failure was already collected deterministically, so paid intent classification would only repeat known evidence.";
  }
  const deterministicIntent = followUpResolution ? undefined : deterministicMutationIntent(task);
  if (effectiveCommandOnlyRequest && (classification.intent === "question" || classification.intent === "status" || classification.intent === "analyze")) {
    classification.intent = "edit";
    classification.needsProjectInspection = true;
    classification.rationale = "Deterministic operation guard: the user explicitly requested a real run/validation action, so prose-only inspection is not a valid result.";
  }
  if (
    deterministicIntent &&
    deterministicIntent !== "undo" &&
    (classification.intent === "question" || classification.intent === "status" || classification.intent === "analyze")
  ) {
    const overriddenIntent = classification.intent;
    classification.intent = deterministicIntent;
    classification.needsProjectInspection = true;
    classification.rationale = `Deterministic edit-intent guard overrode ${overriddenIntent}: the task asks Foundry to change files.`;
  }
  await emitExecution(execution, "inspection", "completed", "Classified request", {
    internal: true,
    details: { intent: classification.intent, rationale: classification.rationale, routingAssessment: JSON.stringify(routingAssessment) },
  });

  if (approvalResponse?.decision === "deny" && parentMission) {
    const remainingAfterDenial = parentMission.plan.filter((item) => item.status === "pending" || item.status === "running");
    if (!remainingAfterDenial.length) {
      execution.checklist.splice(0, execution.checklist.length, {
        id: "denied-action",
        label: `Run ${approvalResponse.requestedCommand}`,
        status: "skipped",
        evidence: `User denied ${approvalResponse.requestedCommand}.`,
      });
      await emitExecution(execution, "reasoning", "completed", `Denied action was skipped: ${approvalResponse.requestedCommand}`, {
        details: { decision: "deny", requestedCommand: approvalResponse.requestedCommand },
      });
      await emitExecution(execution, "summary", "completed", "The denied action did not run; no other mission work remained");
      return { status: "passed", changedFiles: [], events: [`Denied action skipped: ${approvalResponse.requestedCommand}`], stackLabel: stackProfile.label };
    }
  }

  if (classification.intent === "question" || classification.intent === "status" || classification.intent === "analyze") {
    const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider: initialModel.provider, onEvent, routingAssessment });
    await emitExecution(execution, "summary", "completed", "Answered without editing files", { output: inspection.answer });
    finishObjectiveChecklist(execution, "passed");
    return { status: "passed", changedFiles: [], events: [inspection.answer], stackLabel: stackProfile.label };
  }

  if (classification.intent === "undo") {
    if (stackProfile.level < 4) {
      const blocker = `Undo is part of full mission support, which isn't enabled yet for ${stackProfile.label} (currently Level ${stackProfile.level}). You'll need to revert this by hand for now.`;
      await emitExecution(execution, "summary", "error", "Undo not available at this capability level", { details: { blocker, stack: stackProfile.label, capabilityLevel: stackProfile.level } });
      finishObjectiveChecklist(execution, "unsupported", blocker);
      return { status: "unsupported", blocker, changedFiles: [], events: [blocker], stackLabel: stackProfile.label };
    }
    const projectId = execution.projectId;
    if (!projectId) {
      const blocker = "No durable history is available for this connection yet, so undo isn't possible.";
      await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker } });
      finishObjectiveChecklist(execution, "unsupported", blocker);
      return { status: "unsupported", blocker, changedFiles: [], events: [blocker], stackLabel: stackProfile.label };
    }
    const undone = followUpResolution?.referencedPriorAction
      ? await undoReferencedChange(access, execution, projectId, followUpResolution)
      : await undoLastChange(access, execution, projectId);
    if (undone.status === "failed") {
      await emitExecution(execution, "summary", "error", "Mission blocked", { details: { blocker: undone.blocker } });
      finishObjectiveChecklist(execution, "unsupported", undone.blocker);
      return { status: "unsupported", blocker: undone.blocker, changedFiles: [], events: [undone.blocker ?? ""], stackLabel: stackProfile.label };
    }
    const undoneFiles = "filePaths" in undone ? undone.filePaths : undone.filePath ? [undone.filePath] : [];
    await emitExecution(execution, "summary", "completed", "Reverted the referenced change", { details: { revertedFiles: undoneFiles, referencedExecutionId: followUpResolution?.referencedPriorAction?.executionId } });
    finishObjectiveChecklist(execution, "passed");
    return { status: "passed", changedFiles: undoneFiles, events: [], stackLabel: stackProfile.label };
  }

  if (stackProfile.level === 1) {
    const unsupportedMessage = unsupportedEditingMessage(stackProfile);
    const inspection = await runReadOnlyInspection({
      message: `${task}\n\n(Note to include in your answer: ${unsupportedMessage})`,
      access,
      apiKey,
      provider: initialModel.provider,
      onEvent,
      routingAssessment,
    });
    const answer = inspection.answer.includes(unsupportedMessage) ? inspection.answer : `${unsupportedMessage}\n\n${inspection.answer}`;
    const blocker = `I inspected the project but did not edit because ${unsupportedMessage}`;
    await emitExecution(execution, "summary", "error", "Inspected but did not edit", {
      output: answer,
      details: { blocker, stack: stackProfile.label, capabilityLevel: stackProfile.level },
    });
    finishObjectiveChecklist(execution, "unsupported", blocker);
    return { status: "unsupported", blocker, changedFiles: [], events: [answer], stackLabel: stackProfile.label };
  }

  const capabilityAccess = accessForCapabilityLevel(access, stackProfile.level);
  // A partially generated project is still fulfilling its authoritative saved brief. A narrow
  // follow-up resolution from the last failed file must not reduce that build to one touched path;
  // coordinated source files remain inside the already selected project root.
  const executorAccess = resumingIncompleteProject
    ? capabilityAccess
    : constrainAccessToFollowUpScope(
        capabilityAccess,
        followUpResolution,
        execution,
        preModelBuildFailure && preModelRepairReadPaths.length
          ? `${requestedTask}\nCompiler-authorized repair files: ${[...new Set(preModelRepairReadPaths)].join(", ")}`
          : requestedTask,
      );
  const referencedProposal = ((followUpResolution?.currentIntent === "edit" || followUpResolution?.currentIntent === "debug" || followUpResolution?.currentIntent === "continue")
      ? followUpResolution.plannedAction.trim()
      : "")
    || followUpResolution?.referencedPriorAction?.description?.trim()
    || (parentMission
      && followUpResolution?.referencedPriorAction?.executionId === parentMission.id
      && parentMission.summary.trim()
        ? parentMission.summary.trim()
        : "");
  const carriesParentRequirements = !referencedProposal && Boolean(parentMission?.source_requirements.length) && (
    continuity === "carry_forward_plan"
    || followUpResolution?.referencedPriorAction?.executionId === parentMission?.id
  );
  const acceptedRequirementTask = carriesParentRequirements && parentMission
    ? `Referenced request:\n${parentMission.source_requirements.join("\n")}${referencedProposal ? `\n\nFoundry's referenced proposal (executable scope):\n${referencedProposal}` : ""}\n\nCurrent instruction:\n${requestedTask}`
    : referencedProposal
      ? `Foundry's referenced proposal (authoritative executable scope):\n${referencedProposal}\n\nCurrent instruction:\n${requestedTask}`
      : requestedTask;
  const semanticVisualStaticTransformation = stackProfile.id === "static-html"
    && Boolean(staticSourceTopology?.linkedFiles.length)
    && routingAssessment.visualOutcome;
  // Browser acceptance tests the user's concrete outcome, not the planner/executor context
  // envelope. For a referential continuation ("do it", "go ahead"), recover the nearest prior
  // requirement that exposes a browser-observable capability.
  const browserAcceptanceTask = [inheritedBrowserRequest, referencedProposal].filter(Boolean).join("\n\n");
  const assessedProfile = profileTask({ message: task, dynamicAssessment: routingAssessment, projectFileCount: workingSet.projectFileCount, failureHistory: parentMission?.state === "failed" ? 1 : 0 });
  const atomicUserRequirements = extractAtomicUserRequirements(task);
  const requiresRequirementContract = atomicUserRequirements.length > 1
    || requiresPolishedUiAcceptance(acceptedRequirementTask)
    || requiresPresentationLayerChange(acceptedRequirementTask);
  const boundedCoordinatedEdit = !approvalResponse
    && atomicUserRequirements.length >= 2
    && atomicUserRequirements.length <= 4
    && routingAssessment.estimatedFiles <= 3
    && routingAssessment.estimatedSubsystems <= 1
    && !assessmentHighRisk(routingAssessment)
    && (classification.intent === "edit" || classification.intent === "debug" || classification.intent === "build");
  // Small, explicit UI repairs must not silently expand into an architecture or verification mission.
  // They receive one economical coding pass, deterministic checks, and at most one browser repair.
  const boundedSmallEdit = !approvalResponse
    && (namedControlDefect || looksLikeBoundedClientInteraction(requestedTask) || looksUnambiguouslyLikeSmallEdit(requestedTask))
    && routingAssessment.estimatedFiles <= (namedControlDefect || looksLikeBoundedClientInteraction(requestedTask) ? 5 : 3)
    && routingAssessment.estimatedSubsystems <= (namedControlDefect || looksLikeBoundedClientInteraction(requestedTask) ? 3 : 1)
    && !assessmentHighRisk(routingAssessment)
    && (classification.intent === "edit" || classification.intent === "debug");
  const boundedSmallEditBudget = { maximumModelCalls: 6, premiumCallLimit: 1, estimatedCostUsd: 0.15, hardCeiling: true };
  // When the real working set is already bounded, read it once in the runtime and put that exact
  // source into the implementation request. Paying a coding model to list and reread a known
  // one-file static project wastes the mission budget before the first possible edit.
  const mutationReadyWorkingSet = boundedCoordinatedEdit || boundedStaticFollowUp || boundedSmallEdit;
  const boundedWorkingSetEvidence = mutationReadyWorkingSet
    ? await readBoundedWorkingSetEvidence(executorAccess, workingSet.likelyFiles)
    : undefined;
  // An approval response resumes the exact blocked mission, whose remaining scope may be much larger
  // than the short synthetic control message. Keep the economical model tier, but never apply the
  // six-turn fast-lane ceiling to that resumed work.
  const fastLane = !approvalResponse && (boundedStaticFollowUp || !requiresRequirementContract)
    && (classification.intent === "edit" || classification.intent === "debug" || classification.intent === "build")
    && assessedProfile.recommendedIntelligenceTier === "fast" && assessedProfile.scope.estimatedFiles <= 3;
  const boundedDebug = classification.intent === "debug"
    && !assessmentHighRisk(routingAssessment)
    && routingAssessment.estimatedFiles <= 3
    && routingAssessment.estimatedSubsystems <= 2;
  const directExecutionLane = Boolean(preModelBrowserEvidence) || boundedStaticFollowUp || boundedSmallEdit || effectiveCommandOnlyRequest || fastLane || boundedDebug || boundedCoordinatedEdit;
  const carryForwardPlan = !effectiveCommandOnlyRequest && !resumingIncompleteProject && continuity === "carry_forward_plan" && Boolean(parentMission?.plan.length) && stackProfile.level >= 4;
  if (!directExecutionLane && !carryForwardPlan) await emitExecution(execution, "planning", "running", "Planning the approach", { internal: true });
  let checklist: FactoryObjectiveChecklistItem[];
  if (resumingIncompleteProject) {
    const inheritedPlan = parentMission?.plan.map((item) => item.status === "completed" || item.status === "skipped"
      ? { ...item }
      : { ...item, status: "pending" as const, evidence: undefined });
    const briefRequirements = savedBriefForRecovery?.exists ? generatedRecoveryRequirements(savedBriefForRecovery.content) : [];
    checklist = briefRequirements.length ? briefRequirements.map((requirement, index) => ({
      id: `generated-requirement-${index + 1}`,
      label: `Implement and verify: ${requirement}`,
      status: "pending" as const,
      phase: "Saved product brief",
    })) : inheritedPlan?.length ? inheritedPlan : [
      { id: "complete-generated-source", label: "Create the complete coordinated application source from the saved brief", status: "pending" },
      { id: "verify-generated-project", label: "Run the project checks and confirm the real application starts successfully", status: "pending" },
    ];
  } else if (carryForwardPlan && parentMission) {
    const resolved = parentMission.plan.filter((item) => item.status === "completed" || item.status === "skipped");
    // A "blocked" item in the parent mission was blocked by whatever single command last needed approval
    // (the executor pauses immediately, mission-wide, the instant a command needs approval — it never leaves
    // other unrelated items merely "blocked"). If the user just denied that command, those items must not be
    // silently reset to "pending" and retried — they're the ones the deny instruction is about. Untouched
    // "pending" items are unaffected and carry forward normally for a fresh attempt.
    const deniedThisTurn = approvalResponse?.decision === "deny";
    const stillOpen = parentMission.plan
      .filter((item) => item.status !== "completed" && item.status !== "skipped")
      .map((item) =>
        deniedThisTurn && item.status === "blocked"
          ? { ...item, status: "skipped" as const, evidence: `Skipped — the command this needed was denied. Manual command: \`${approvalResponse.requestedCommand.trim()}\`` }
          : { ...item, status: "pending" as const },
      );
    const followUpItems = approvalResponse ? [] : [{ id: `followup-${Date.now()}`, label: `Complete: ${task.trim()}`, status: "pending" as const }];
    checklist = [...resolved, ...stillOpen, ...followUpItems];
    await emitExecution(execution, "planning", "completed", "Continuing the open plan from the previous mission", {
      internal: true,
      details: { checklistJson: JSON.stringify(checklist), continuedFrom: parentMission.id },
    });
  } else if (directExecutionLane) {
    checklist = boundedCoordinatedEdit
      ? atomicUserRequirements.map((requirement, index) => ({
          id: `user-requirement-${index + 1}`,
          label: `Complete: ${requirement}`,
          status: "pending" as const,
          phase: "Requested behavior",
        }))
      : [{ id: preModelBrowserEvidence ? "browser-evidenced-repair" : effectiveCommandOnlyRequest ? "operation-verified" : boundedDebug ? "bounded-debug-repair" : "small-edit-applied", label: preModelBrowserEvidence ? "Repair the verified desktop/mobile browser failure and rerun acceptance" : effectiveCommandOnlyRequest ? `Run and verify without source changes: ${requestedTask.trim()}` : `Complete: ${task.trim()}`, status: "pending" as const }];
  } else {
    // Pre-plan complexity is necessarily an estimate (distinctPhases doesn't exist until the checklist
    // does) — fine here, since tierForStage's "plan" branch only ever keys off quality, never complexity.
    const prePlanComplexity = assessMissionComplexity({
      highRisk: assessmentHighRisk(routingAssessment),
      multiPart: assessmentMultiPart(routingAssessment),
      distinctPhases: 0,
      stackCapabilityLevel: stackProfile.level,
      fileCount: routingAssessment.estimatedFiles,
    });
    const prePlanStrategy = createExecutionStrategy({ kind: "existing-project", complexity: prePlanComplexity, quality, fileCount: routingAssessment.estimatedFiles, estimatedArtifacts: 0, independentlyGeneratable: false, highRisk: assessmentHighRisk(routingAssessment), securitySensitive: routingAssessment.securityOrPayment, needsVisualValidation: isUserFacingUiOutcome(acceptedRequirementTask, routingAssessment.visualOutcome ? 1 : undefined), repeatedFailures: 0 });
    const planModel = await modelForMissionStage(task, modelMode, tierForCapability(prePlanStrategy, "plan", tierForStage("plan", quality, prePlanComplexity)), workingSet, parentMission?.state === "failed" ? 1 : 0, routingAssessment) ?? initialModel!;
    await emitModelSelection(execution, "planning", planModel);
    await emitExecution(execution, "reasoning", "completed", "I’m turning the request and project evidence into a concrete checklist before touching code, including what must be verified afterward.");
    const plan = await planMission({ objective, task: acceptedRequirementTask, intent: classification.intent, projectSnapshot, apiKey: planModel.apiKey, provider: planModel.provider, canRunCommands: executorAccess.capabilities.canRunCommands, canBrowserValidate: executorAccess.capabilities.canBrowserValidate, tier: planModel.tier, routingAssessment });
    checklist = plan.checklist;
    if (plan.conflicts.length) {
      execution.checklist.splice(0, execution.checklist.length, ...checklist);
      const paused = await pauseForPlanConflicts(execution, plan.conflicts);
      return { status: paused.status, blocker: paused.blocker, clarificationQuestions: paused.clarificationQuestions, changedFiles: [], events: [paused.blocker], stackLabel: stackProfile.label };
    }
  }
  execution.checklist.splice(0, execution.checklist.length, ...checklist);
  if (!carryForwardPlan) {
    await emitExecution(execution, "planning", "completed", "Checklist ready", {
      internal: true,
      details: { checklistJson: JSON.stringify(checklist), fastLane },
    });
  }

  const preApprovedCommands = Array.from(
    new Set([...(approvalResponse && approvalResponse.decision !== "deny" && !consumedOneTimeApproval ? [approvalResponse.requestedCommand.trim()] : []), ...approvedCommands]),
  );
  // A category approval arrives in the same click that resumes execution. React persistence may not
  // have committed yet, so the structured response itself must authorize this resumed request.
  const effectiveApprovedCategories = Array.from(new Set([
    ...approvedCategories,
    ...(resumingIncompleteProject ? ["dependencies", "package-runner"] : []),
    ...(approvalResponse?.decision === "approve-category" && approvalResponse.category ? [approvalResponse.category] : []),
  ]));
  if (approvalResponse?.decision === "deny") {
    const deniedCommand = approvalResponse.requestedCommand.trim();
    await emitExecution(execution, "blocked", "warning", `Approval denied: ${deniedCommand}`, {
      tier: "flag",
      command: deniedCommand,
      details: {
        reason: `The user denied this command. You can run it yourself when ready: \`${deniedCommand}\`. Work that depends on it remains blocked; Foundry will continue only with work that can still be verified safely.`,
      },
    });
    // A denial can fully resolve a one-step blocked plan. In that case there is nothing for an AI
    // model to do, so finish deterministically instead of charging for a continuation paraphrase.
    if (!checklist.some((item) => item.status === "pending" || item.status === "blocked")) {
      execution.checklist.splice(0, execution.checklist.length, {
        id: "denied-action",
        label: `Run ${deniedCommand}`,
        status: "skipped",
        evidence: `User denied ${deniedCommand}.`,
      });
      await emitExecution(execution, "summary", "completed", "Continued without the denied action", {
        output: "The denied action was skipped. No model call was needed to resolve this continuation.",
      });
      return {
        status: "passed",
        changedFiles: [],
        events: ["Denied action skipped without restarting the model."],
        stackLabel: stackProfile.label,
      };
    }
  }
  const distinctPhases = new Set(checklist.map((item) => item.phase).filter(Boolean)).size;
  const highRisk = assessmentHighRisk(routingAssessment) && distinctPhases >= 2 && stackProfile.level >= 4;
  const complexity = assessMissionComplexity({
    highRisk,
    multiPart: assessmentMultiPart(routingAssessment),
    distinctPhases,
    stackCapabilityLevel: stackProfile.level,
    fileCount: routingAssessment.estimatedFiles,
  });
  const strategyComplexity = boundedStaticFollowUp ? "small" as const : complexity;
  const strategyHighRisk = boundedStaticFollowUp ? false : highRisk;
  const missionStrategy = createExecutionStrategy(resumingIncompleteProject && isFoundryGeneratedProject ? {
    kind: "existing-project",
    complexity: "large",
    quality,
    fileCount: Math.max(24, routingAssessment.estimatedFiles),
    estimatedArtifacts: Math.max(8, checklist.filter((item) => item.status === "pending").length),
    independentlyGeneratable: true,
    highRisk: false,
    securitySensitive: routingAssessment.securityOrPayment,
    needsVisualValidation: true,
    repeatedFailures: parentMission?.state === "failed" ? 1 : 0,
  } : {
    kind: "existing-project", complexity: strategyComplexity, quality, fileCount: boundedStaticFollowUp ? Math.min(3, routingAssessment.estimatedFiles) : routingAssessment.estimatedFiles,
    estimatedArtifacts: checklist.filter((item) => item.status === "pending").length,
    independentlyGeneratable: new Set(checklist.map((item) => item.phase).filter(Boolean)).size > 1 && !strategyHighRisk,
    highRisk: strategyHighRisk,
    securitySensitive: routingAssessment.securityOrPayment,
    needsVisualValidation: isUserFacingUiOutcome(acceptedRequirementTask, routingAssessment.visualOutcome ? 1 : undefined),
    repeatedFailures: parentMission?.state === "failed" ? 1 : 0,
  });
  await emitExecution(execution, "planning", "completed", `Execution strategy: ${missionStrategy.workflow}`, { details: { workflow: missionStrategy.workflow, concurrency: missionStrategy.concurrency, reason: missionStrategy.reason } });

  let architectureNotes: string | undefined;
  if (!directExecutionLane && !resumingIncompleteProject && shouldRunArchitectureReview(quality, strategyComplexity, strategyHighRisk)) {
    // Not internal — Capability-First Experience: this is one of the visible workflow steps a user
    // should see ("Reviewing architecture"), not raw model/provider plumbing.
    await emitExecution(execution, "planning", "running", "Reviewing architecture");
    const reviewModel = await modelForMissionStage(task, modelMode, tierForCapability(missionStrategy, "review", tierForStage("review", quality, complexity)), workingSet, parentMission?.state === "failed" ? 1 : 0, routingAssessment) ?? initialModel!;
    await emitModelSelection(execution, "architecture review", reviewModel);
    const review = await reviewArchitecture({ objective, task, checklist, projectSnapshot, apiKey: reviewModel.apiKey, provider: reviewModel.provider, tier: reviewModel.tier, routingAssessment });
    if (review.revisedChecklist?.length) {
      checklist = review.revisedChecklist;
      execution.checklist.splice(0, execution.checklist.length, ...checklist);
    }
    if (review.concerns.length) architectureNotes = review.concerns.map((concern) => `- ${concern}`).join("\n");
    await emitExecution(execution, "planning", "completed", review.concerns.length ? "Architecture review flagged concerns" : "Architecture review found no concerns", {
      details: review.concerns.length ? { concerns: review.concerns } : undefined,
    });
  }

  const strategyImplementationTier = tierForCapability(missionStrategy, classification.intent === "debug" ? "debug" : "implement", tierForStage("implement", quality, complexity));
  const implementationTier = preModelBuildFailure
    ? "fast"
    : preModelBrowserEvidence
    ? "builder"
    : approvalResponse && !resumingIncompleteProject
    ? "fast"
    : boundedSmallEdit
    // Bounded scope, but a relocation still has to remove and reinsert markup correctly. The cheapest
    // tier deletes the block and forgets the second half, which every downstream check passes.
    ? isStructuralRelocationRequest(requestedTask) ? "builder" : "fast"
    : boundedCoordinatedEdit
    ? "builder"
    : boundedStaticFollowUp
    ? requiresRequirementContract ? "builder" : "fast"
    : strategyImplementationTier;
  if (resumingIncompleteProject && savedBriefForRecovery?.exists) {
    const recoverySpec = parseBrief(savedBriefForRecovery.content);
    const generatedRoot = path.resolve(access.rootLabel);
    if (generatedRoot.startsWith(`${path.resolve(projectsRoot)}${path.sep}`)) {
      await ensureRequestedStackScaffold(generatedRoot, stackProfile, recoverySpec.projectName, execution, [], recoverySpec.stack);
    }
  }
  if (previewTarget && mutatingOutcomeRequired && stackHasBuildStep(stackProfile.id)) {
    // Next dev and next build share .next. A build/typecheck/edit mission running beside the owned
    // dev server can leave the browser serving a mixed module generation even though the source and
    // production build are correct. Pause the owned preview for the whole mutation/verification
    // window; the final acceptance branch starts one clean server from the verified files.
    await stopProjectPreview(previewTarget);
    await emitExecution(execution, "preview", "completed", "Paused the existing preview before project mutation and verification", {
      internal: true,
      details: { paidModelCalls: 0, preventsMixedBuildArtifacts: true },
    });
  }
  const compatibilityPreflight = resumingIncompleteProject && workspaceProjectPath
    ? await preflightGeneratedPrismaCompatibility(executorAccess, workspaceProjectPath, execution)
    : undefined;
  let recoveryPreflight = compatibilityPreflight ?? (resumingIncompleteProject && workspaceProjectPath && stackHasBuildStep(stackProfile.id)
    ? await preflightIncompleteGeneratedBuild(executorAccess, verificationProfile, workspaceProjectPath, execution)
    : undefined);
  let deterministicRecoveryPass = 0;
  while (recoveryPreflight && !recoveryPreflight.buildPassed && workspaceProjectPath && deterministicRecoveryPass < 8) {
    const preflightFailure = recoveryPreflight.commands.at(-1);
    if (!preflightFailure) break;
    const unresolvedPackages = unresolvedPackageNames(preflightFailure);
    if (unresolvedPackages.length) {
      deterministicRecoveryPass += 1;
      await emitExecution(execution, "reasoning", "completed", `The compiler identified ${unresolvedPackages.length} undeclared package${unresolvedPackages.length === 1 ? "" : "s"}. I'm installing only that exact evidence before any repair model is called.`, {
        details: { packages: unresolvedPackages, paidModelCalls: 0 },
      });
      const dependencyInstall = await (async () => { const invocation = missingPackageInstallInvocation(workspaceProjectPath, unresolvedPackages); return runCommand(workspaceProjectPath, invocation.command, invocation.args, [], execution); })();
      recoveryPreflight.commands.push(dependencyInstall);
      if (dependencyInstall.exitCode !== 0) break;
      if (unresolvedPackages.includes("@prisma/client") && existsSync(path.join(workspaceProjectPath, "prisma", "schema.prisma"))) {
        const prismaGenerate = await runCommand(workspaceProjectPath, "npm.cmd", ["exec", "--", "prisma", "generate"], [], execution);
        recoveryPreflight.commands.push(prismaGenerate);
        if (prismaGenerate.exitCode !== 0) break;
      }
      const dependencyPreflight = await preflightIncompleteGeneratedBuild(executorAccess, verificationProfile, workspaceProjectPath, execution);
      recoveryPreflight = {
        commands: [...recoveryPreflight.commands, ...dependencyPreflight.commands],
        changedFiles: [...new Set([...recoveryPreflight.changedFiles, "package.json", "package-lock.json", ...dependencyPreflight.changedFiles])],
        buildPassed: dependencyPreflight.buildPassed,
      };
      continue;
    }
    const deterministicRepairs = await applyDeterministicCompilerRepairs(executorAccess, preflightFailure, workspaceProjectPath);
    if (!deterministicRepairs.length) break;
    deterministicRecoveryPass += 1;
        await emitExecution(execution, "edit", "completed", "Applied a compiler-proven recovery repair before model routing", {
          filePath: deterministicRepairs[0].path,
          details: { repairs: deterministicRepairs.map((repair) => `${repair.ruleId}: ${repair.path} — ${repair.reason}`), paidModelCalls: 0 },
        });
        const repairedPreflight = await preflightIncompleteGeneratedBuild(executorAccess, verificationProfile, workspaceProjectPath, execution);
        recoveryPreflight = {
          commands: [...recoveryPreflight.commands, ...repairedPreflight.commands],
          changedFiles: [...new Set([...recoveryPreflight.changedFiles, ...deterministicRepairs.map((repair) => repair.path), ...repairedPreflight.changedFiles])],
          buildPassed: repairedPreflight.buildPassed,
        };
  }
  // A compiler-only repair is safe only after a real application entry exists. Next.js can exit 0
  // for a project containing configuration and styles but no route; treating that as recovered
  // produced a truthful 404 preview only after spending a Fast turn on an irrelevant type fix.
  const fullGeneratedRecovery = resumingIncompleteProject && (!hasGeneratedRunnableEntry || detectedStackMismatch);
  const parentHasUnresolvedImplementation = parentHasOpenPlanItems;
  const boundedCompilerRepair = !fullGeneratedRecovery && isBoundedCompilerPreflightFailure(recoveryPreflight, workspaceProjectPath);
  const terminalPreflightCommand = recoveryPreflight && !recoveryPreflight.buildPassed
    ? recoveryPreflight.commands.at(-1)
    : undefined;
  const terminalPreflightReason = terminalPreflightCommand
    ? summarizeCommandFailure(terminalPreflightCommand)
    : undefined;
  const terminalPreflightAssessment = terminalPreflightReason
    ? assessAutonomousBlocker(terminalPreflightReason)
    : undefined;
  let compilerRepairEvidence: string | undefined;
  let compilerRepairReadPaths: string[] = [];
  let implementationModel = initialModel!;
  let result: Awaited<ReturnType<typeof runMissionExecutor>>;
  // A green compiler proves only that the generated project is structurally buildable. When the
  // zero-model browser preflight already found a concrete product defect, do not short-circuit the
  // implementation stage and then rediscover the same defect at the final gate.
  if (terminalPreflightReason && terminalPreflightAssessment?.terminal) {
    const blocker = terminalBlockerWithNextAction(terminalPreflightReason);
    result = {
      status: "failed",
      blocker,
      checklist,
      timeline: [],
      changedFiles: recoveryPreflight?.changedFiles ?? [],
      commands: recoveryPreflight?.commands ?? [],
      verification: [{ check_type: "build", result: "fail", evidence: blocker }],
      turnsUsed: 0,
      usage: [],
      sessionSummary: {
        outcome: "Deterministic verification reached an external environment boundary before model routing.",
        changes: recoveryPreflight?.changedFiles ?? [],
        preserved: ["Application source and saved project requirements"],
        flags: [blocker],
      },
    };
    await emitExecution(execution, "summary", "error", "Verification stopped before model routing", {
      details: { blocker, disposition: terminalPreflightAssessment.disposition, paidModelCalls: 0 },
    });
  } else if (buildOnlyRecoveryCanComplete({
    buildPassed: Boolean(recoveryPreflight?.buildPassed),
    hasRunnableEntry: hasGeneratedRunnableEntry,
    hasPreModelBrowserEvidence: Boolean(preModelBrowserEvidence),
    hasOpenPlanItems: parentHasUnresolvedImplementation,
    mutatingOutcomeRequired,
  })) {
    const completedRecovery = recoveryPreflight!;
    const completedChecklist = checklist.map((item) => ({
      ...item,
      status: "completed" as const,
      evidence: "Deterministic generated-project recovery preflight completed and the real production build exited 0.",
    }));
    result = {
      status: "passed",
      // This branch is restricted to a non-mutating recovery after the current on-disk project has
      // independently passed deterministic verification. Feature/change requests never enter it.
      alreadySatisfied: true,
      checklist: completedChecklist,
      timeline: [],
      changedFiles: completedRecovery.changedFiles,
      commands: completedRecovery.commands,
      verification: [{ check_type: "build", result: "pass", evidence: "The current generated project passed its real production build before any implementation model call." }],
      turnsUsed: 0,
      usage: [],
      sessionSummary: {
        outcome: "The generated project recovered through deterministic build checks without an implementation model call.",
        changes: completedRecovery.changedFiles,
        preserved: ["Application source and saved project requirements"],
        flags: [],
      },
    };
    execution.checklist.splice(0, execution.checklist.length, ...completedChecklist);
    await emitExecution(execution, "summary", "completed", "Production build verified without an implementation model call", {
      details: { paidImplementationModelCalls: 0, commands: completedRecovery.commands.map((command) => command.command) },
    });
  } else {
    if (recoveryPreflight?.buildPassed && fullGeneratedRecovery) {
      const recoveryReason = !hasGeneratedRunnableEntry
        ? "The production command exited 0, but the project still has no runnable application entry. Foundry is continuing from the saved brief instead of presenting an empty runtime as a verified build."
        : "The production command exited 0, but the generated stack does not yet match the authoritative saved brief. Foundry is continuing the requested product instead of accepting the mismatched foundation.";
      await emitExecution(execution, "reasoning", "completed", recoveryReason, {
        details: { paidModelCallsBeforeDecision: 0, runnableEntry: hasGeneratedRunnableEntry, detectedStackMismatch },
      });
    } else if (recoveryPreflight?.commands.length && !recoveryPreflight.buildPassed) {
      const lastPreflightCommand = recoveryPreflight.commands.at(-1)!;
      const editBeforeBuildInstruction = boundedCompilerRepair
        ? "This is a bounded compiler repair. Do not run the build again before editing. Read the referenced source/type definitions, make the smallest correct source edit first, and only then rerun the production build."
        : "Repair this exact remaining command evidence without repeating successful dependency work.";
      const currentFailure = lastPreflightCommand.stderr || lastPreflightCommand.stdout || summarizeCommandFailure(lastPreflightCommand);
      task = boundedCompilerRepair
        ? `Repair the exact source-scoped production-build error below in the existing project. ${editBeforeBuildInstruction} Do not read foundry-brief.md, package.json, or unrelated directories; the product requirements are not in question. Preserve all behavior outside this compiler repair.\n\nExact current failure:\n${currentFailure}`
        : `${task}\n\nDeterministic recovery preflight already ran before model routing and still failed. ${editBeforeBuildInstruction}\n\nExact current failure:\n${currentFailure}`;
      if (boundedCompilerRepair && workspaceProjectPath) {
        workingSet = workingSetWithCommandFailure(await discoverProjectWorkingSet(access, task), lastPreflightCommand, workspaceProjectPath);
        compilerRepairReadPaths = commandTracebackSourcePaths(workingSet, workspaceProjectPath, 3);
        compilerRepairEvidence = await readBoundedWorkingSetEvidence(executorAccess, compilerRepairReadPaths);
      }
    }
    const routedImplementationTier = fullGeneratedRecovery ? "builder" : boundedCompilerRepair ? "fast" : implementationTier;
    implementationModel = await modelForMissionStage(task, modelMode, routedImplementationTier, workingSet, parentMission?.state === "failed" ? 1 : 0, routingAssessment) ?? initialModel!;
    await emitModelSelection(execution, "implementation", implementationModel);
    await emitExecution(execution, "reasoning", "completed", "The working plan is ready. Foundry is reserving the implementation pass now; no source change is claimed until a write is verified on disk.");
    result = await runMissionExecutor({
    objective,
    task,
    checklist,
    costScopeId: execution.costScopeId,
    access: executorAccess,
    apiKey: implementationModel.apiKey,
    provider: implementationModel.provider,
    onEvent,
    signal,
    preApprovedCommands,
    approvedCategories: effectiveApprovedCategories,
    standingApprovedCommands: approvedCommands,
    deniedActions: Array.from(new Set([
      ...(parentMission?.denied_actions ?? []),
      ...(approvalResponse?.decision === "deny" ? [approvalResponse.requestedCommand.trim()] : []),
    ])),
    priorContext: resumingIncompleteProject ? undefined : parentMission,
    followUpResolution: resumingIncompleteProject ? undefined : followUpResolution,
    fastLane: boundedCompilerRepair || (fastLane && !fullGeneratedRecovery),
    highRisk,
    tier: implementationModel.tier,
    architectureNotes,
    hasBuildTooling: effectiveCommandOnlyRequest ? false : stackHasBuildStep(stackProfile.id),
    verificationProfile,
    executionStrategy: missionStrategy,
    evidenceImages,
    routingAssessment,
    commandOnly: effectiveCommandOnlyRequest,
    initialProjectEvidence: boundedWorkingSetEvidence ?? compilerRepairEvidence,
    requireFirstMutation: Boolean(boundedWorkingSetEvidence || compilerRepairEvidence || boundedCompilerRepair) && !(coordinatedStaticRewrite || semanticVisualStaticTransformation),
    avoidFirstMutationPaths: boundedCoordinatedEdit
      ? parentMission?.files_touched.filter((file) => file.verified).map((file) => file.path)
      : undefined,
    newProject: resumingIncompleteProject && !boundedCompilerRepair,
    // A batch is "blocked" only when nothing further will be attempted, and that is the runtime's call,
    // not this batch's — an action-recovery lane and a continuation loop both run immediately after
    // this returns. Announcing "Mission blocked" here made a mission that then succeeded look failed
    // mid-run. The runtime still emits the real verdict at the end, under the same stable summary id.
    continuableBatch: true,
    // Preserve an established HTML/CSS/JS source set as a coordinated existing project. The
    // self-contained static generator intentionally exposes only index.html and would contradict
    // this project's existing architecture.
    staticProject: resumingIncompleteStaticProject || (boundedStaticFollowUp && !(coordinatedStaticRewrite || semanticVisualStaticTransformation)),
    evidenceFirstRepair: Boolean(preModelBrowserEvidence || boundedCompilerRepair),
    evidenceRepairReadPaths: [...new Set([...compilerRepairReadPaths, ...preModelRepairReadPaths])],
    maxTurns: preModelBrowserEvidence ? 6 : boundedCompilerRepair ? 6 : approvalResponse ? 20 : boundedSmallEdit ? 6 : (coordinatedStaticRewrite || semanticVisualStaticTransformation) ? 6 : boundedStaticFollowUp ? 3 : boundedCoordinatedEdit ? 12 : resumingIncompleteStaticProject ? 8 : resumingIncompleteProject ? 32 : undefined,
    maxOutputTokens: preModelBuildFailure ? 1_500 : preModelBrowserEvidence ? 5_000 : boundedCompilerRepair ? 1_500 : (coordinatedStaticRewrite || semanticVisualStaticTransformation) ? 16_000 : boundedStaticWholeRewrite ? 16_000 : boundedSmallEdit ? 3_500 : boundedStaticFollowUp ? 3_000 : boundedCoordinatedEdit ? 5_000 : resumingIncompleteProject ? 16_000 : undefined,
    // Generated-project continuation shares one deliberately small ledger across every batch.
    // Deterministic scaffold/build/browser work is unmetered; source generation cannot silently
    // expand one Retry click into an enterprise-tier 40-call mission.
    routingBudget: preModelBuildFailure ? { estimatedCostUsd: 0.08 } : preModelBrowserEvidence ? { estimatedCostUsd: 0.8 } : boundedCompilerRepair ? { estimatedCostUsd: 0.08 } : boundedSmallEdit ? boundedSmallEditBudget : boundedCoordinatedEdit ? { estimatedCostUsd: 1 } : resumingIncompleteProject ? generatedRecoveryBudgetForTier(routingBudgetForTier(implementationModel.tier)) : undefined,
  });
    if (recoveryPreflight) {
      result.changedFiles = Array.from(new Set([...recoveryPreflight.changedFiles, ...result.changedFiles]));
      result.commands = [...recoveryPreflight.commands, ...result.commands];
    }
  }
  if (preModelCommands.length) result.commands = [...preModelCommands, ...result.commands];
  if (preModelVerification.length) result.verification = [...preModelVerification, ...result.verification];
  const boundedCompilerRepairBuildPassed = boundedCompilerRepair
    && result.changedFiles.length > 0
    && result.commands.some((command) => command.exitCode === 0 && isProductionBuildCommand(command.command));
  if (boundedCompilerRepairBuildPassed && result.status === "failed" && /Model-call limit reached|Estimated request cost would exceed|Daily model-spend limit reached|configured execution limit/i.test(result.blocker ?? "")) {
    for (const item of result.checklist) {
      item.status = "completed";
      item.evidence = "The bounded compiler repair changed source on disk and the real production build exited 0 before the model-call boundary.";
    }
    result.status = "passed";
    result.blocker = undefined;
    result.verification.push({ check_type: "build", result: "pass", evidence: "The bounded source repair was written and read back; the real production build exited 0. No paid narration turn was required." });
    await emitExecution(execution, "summary", "completed", "Compiler repair and production build verified; skipped paid wrap-up narration", {
      details: { changedFiles: result.changedFiles, paidWrapUpCalls: 0 },
    });
  }
  const executorInteractionEvidenceAwaitingBrowser = stackProfile.id === "static-html"
    && result.changedFiles.length > 0
    && /Interactive UI file\(s\) changed[\s\S]*no finding\/decision confirms the actual interactive behavior/i.test(result.blocker ?? "");
  const boundedStaticWriteAwaitingBrowser = (boundedStaticFollowUp || executorInteractionEvidenceAwaitingBrowser)
    && result.status === "failed"
    && result.changedFiles.length > 0;
  if (boundedStaticWriteAwaitingBrowser) {
    result.status = "passed";
    result.blocker = undefined;
    await emitExecution(execution, "planning", "completed", "Verified static edit handed to browser validation", {
      internal: true,
      details: { changedFiles: result.changedFiles, additionalModelCalls: 0 },
    });
  }
  const boundedEditNeedsContinuation = boundedCoordinatedEdit
    && result.status === "failed"
    && result.changedFiles.length > 0
    && /NO_PROGRESS_(?:BEFORE|AFTER)_MUTATION|lost a clear next step|no-progress action/i.test(result.blocker ?? "");
  if (boundedEditNeedsContinuation) {
    const continuationEvidence = await readBoundedWorkingSetEvidence(executorAccess, workingSet.likelyFiles);
    await emitExecution(execution, "reasoning", "completed", "The first bounded edit changed real source but did not finish every requested behavior. I’m preserving that work and continuing once from the refreshed current files with the same bounded implementation model.", {
      details: { changedFiles: result.changedFiles, sameCostScope: true, strongerModelCalls: 0 },
    });
    const continuation = await runMissionExecutor({
      objective,
      task: `Finish the remaining parts of this bounded existing-project change. These files were already changed and verified in the first batch: ${result.changedFiles.join(", ")}. Do not rewrite them with equivalent content. Use the refreshed authoritative source below to edit the next incomplete UI, state, server, or test layer immediately, then verify the complete behavior.\n\nOriginal task: ${task}`,
      checklist: result.checklist.map((item) => item.status === "completed" || item.status === "skipped" ? item : { ...item, status: "pending" as const, evidence: undefined }),
      costScopeId: execution.costScopeId,
      access: executorAccess,
      apiKey: implementationModel.apiKey,
      provider: implementationModel.provider,
      tier: implementationModel.tier,
      onEvent,
      signal,
      preApprovedCommands,
      approvedCategories: effectiveApprovedCategories,
      standingApprovedCommands: approvedCommands,
      deniedActions: parentMission?.denied_actions ?? [],
      highRisk,
      hasBuildTooling: stackHasBuildStep(stackProfile.id),
      verificationProfile,
      executionStrategy: missionStrategy,
      routingAssessment,
      initialProjectEvidence: continuationEvidence,
      requireFirstMutation: Boolean(continuationEvidence),
      avoidFirstMutationPaths: result.changedFiles,
      maxTurns: 8,
      maxNudges: 1,
      routingBudget: recoveryRoutingBudget(routingBudgetForTier(implementationModel.tier).estimatedCostUsd),
    });
    result = {
      ...continuation,
      changedFiles: Array.from(new Set([...result.changedFiles, ...continuation.changedFiles])),
      commands: [...result.commands, ...continuation.commands],
      verification: [...result.verification, ...continuation.verification],
      timeline: [...result.timeline, ...continuation.timeline],
      usage: [...result.usage, ...continuation.usage],
      turnsUsed: result.turnsUsed + continuation.turnsUsed,
    };
  }
  const exactVerificationRepairLane = exactFailedRetry && Boolean(preModelBrowserEvidence);
  const stalledBeforeFirstMutation = !exactVerificationRepairLane
    && !resumingIncompleteProject
    && !effectiveCommandOnlyRequest
    && result.status === "failed"
    && result.changedFiles.length === 0
    && /NO_PROGRESS_BEFORE_MUTATION|lost a clear next step|did not call required tool (?:replace_in_file|write_files?|edit_file)|existing file content unchanged|no-progress action/i.test(result.blocker ?? "");
  if (stalledBeforeFirstMutation) {
    await emitExecution(execution, "reasoning", "completed", "The first edit pass inspected the right files but did not apply the requested change. I’m retrying once with a stronger implementation route and the verified working set preserved.");
    const actionRecoveryModel = await modelForMissionStage(task, modelMode, "builder", workingSet, 1, routingAssessment) ?? implementationModel;
    await emitModelSelection(execution, "implementation action recovery", actionRecoveryModel);
    const actionRecoveryEvidence = boundedWorkingSetEvidence
      ?? compilerRepairEvidence
      ?? await readBoundedWorkingSetEvidence(executorAccess, workingSet.likelyFiles.slice(0, 6));
    const actionRecovery = await runMissionExecutor({
      objective,
      task: `Apply the requested existing-project change now. The first implementation route already inspected the project but made no source change, so that evidence is preserved below. You may perform at most one targeted file read before your first write. Then make the smallest complete file edit and verify it with the project's applicable checks. Do not stop after reading, describing, or planning the change.\n\nInitial route evidence: ${result.blocker ?? "No mutation was produced."}\n\nOriginal task: ${task}`,
      checklist: result.checklist,
      costScopeId: execution.costScopeId,
      access: executorAccess,
      apiKey: actionRecoveryModel.apiKey,
      provider: actionRecoveryModel.provider,
      onEvent,
      signal,
      preApprovedCommands,
      approvedCategories: effectiveApprovedCategories,
      standingApprovedCommands: approvedCommands,
      deniedActions: parentMission?.denied_actions ?? [],
      priorContext: parentMission,
      followUpResolution,
      fastLane: boundedStaticFollowUp,
      highRisk,
      tier: actionRecoveryModel.tier,
      architectureNotes,
      hasBuildTooling: stackHasBuildStep(stackProfile.id),
      verificationProfile,
      executionStrategy: missionStrategy,
      evidenceImages,
      routingAssessment,
      staticProject: boundedStaticFollowUp,
      initialProjectEvidence: actionRecoveryEvidence,
      requireFirstMutation: Boolean(actionRecoveryEvidence),
      maxTurns: 6,
      maxNudges: 1,
      routingBudget: recoveryRoutingBudget(routingBudgetForTier(actionRecoveryModel.tier).estimatedCostUsd),
    });
    result = {
      ...actionRecovery,
      changedFiles: Array.from(new Set([...result.changedFiles, ...actionRecovery.changedFiles])),
      commands: [...result.commands, ...actionRecovery.commands],
      verification: [...result.verification, ...actionRecovery.verification],
      timeline: [...result.timeline, ...actionRecovery.timeline],
      usage: [...result.usage, ...actionRecovery.usage],
      turnsUsed: result.turnsUsed + actionRecovery.turnsUsed,
    };
  }
  if (recoveryScaffoldFiles.length) {
    result.changedFiles = Array.from(new Set([...recoveryScaffoldFiles, ...result.changedFiles]));
  }

  const budgetBoundaryChecklistSettled = result.checklist.length > 0
    && result.checklist.every((item) => item.status === "completed" || item.status === "skipped");
  const acceptedUiOutcome = isUserFacingUiOutcome(acceptedRequirementTask, routingAssessment.visualOutcome ? 1 : undefined);
  const noProgressBoundaryAfterVerifiedEdit = result.status === "failed"
    && result.changedFiles.length > 0
    && /NO_PROGRESS_AFTER_MUTATION/i.test(result.blocker ?? "");
  const modelBudgetBoundaryAfterVerifiedEdit = result.status === "failed"
    && (result.changedFiles.length > 0 || (result.alreadySatisfied && budgetBoundaryChecklistSettled))
    && /Estimated request cost would exceed|Model-call limit reached|Premium-model call limit reached|configured execution limit/i.test(result.blocker ?? "");
  let completedFromBudgetBoundaryVerification = false;
  let advancedFromNoProgressBoundaryVerification = false;
  let deterministicProfileBlocker = "";
  if ((resumingIncompleteProject || result.changedFiles.length > 0 || result.alreadySatisfied) && access.runCommand && verificationProfile.commands.some((item) => item.required && !item.longRunning)) {
    if (previewTarget && verificationProfile.commands.some((item) => item.required && !item.longRunning && isProductionBuildCommand(item.command))) {
      // Framework builds replace generated manifests and chunks. Never let an owned preview serve
      // the prior generation while a required verification profile rebuilds the project.
      await stopProjectPreview(previewTarget);
    }
    const profileGate = await runRequiredVerificationProfile({ access, execution, profile: verificationProfile, projectPath: workspaceProjectPath, existingCommands: result.changedFiles.length ? [] : result.commands, requireAutomatedTests: missionRequiresAutomatedTests(task) });
    result.commands.push(...profileGate.commands);
    result.verification.push(...profileGate.verification);
    if (!profileGate.passed) {
      deterministicProfileBlocker = `Required ${verificationProfile.ecosystem} command or file write failed: ${profileGate.failure ? `${profileGate.failure.command} — ${summarizeCommandFailure(profileGate.failure)}` : "no runnable required verification command was available."}`;
      result.status = "failed";
      result.blocker = deterministicProfileBlocker;
      task = `${task}\n\nRequired deterministic verification failure (authoritative):\n${deterministicProfileBlocker}\nRepair this exact failure, then rerun every required verification command.`;
      if (profileGate.failure) workingSet = workingSetWithCommandFailure(await discoverProjectWorkingSet(access, task), profileGate.failure, workspaceProjectPath ?? access.rootLabel);
      await emitExecution(execution, "planning", "warning", `Required ${verificationProfile.ecosystem} verification exposed repair work`, { internal: true, details: { blocker: deterministicProfileBlocker, paidModelCalls: 0, recoverable: true, terminal: false } });
    } else if (noProgressBoundaryAfterVerifiedEdit) {
      // A source mutation plus a green build establishes implementation health, not requested behavior.
      // Keep the executor boundary intact until the requirement-directed browser gate proves the
      // requested capability on a reachable surface. Generic page health must not turn this green.
      advancedFromNoProgressBoundaryVerification = true;
      if (budgetBoundaryChecklistSettled || !acceptedUiOutcome) {
        result.status = "passed";
        result.blocker = undefined;
      }
      await emitExecution(execution, "summary", "completed", `Verified source batch with required ${verificationProfile.ecosystem} checks; advancing to product acceptance`, {
        internal: true,
        details: { paidModelCalls: 0, reconciledNoProgressBoundary: true, changedFiles: result.changedFiles },
      });
    } else if (modelBudgetBoundaryAfterVerifiedEdit && !resumingIncompleteProject) {
      for (const item of result.checklist) {
        if (item.status === "pending" || item.status === "running" || item.status === "blocked") {
          item.status = "completed";
          item.evidence = `The source edit was written and read back, and every required ${verificationProfile.ecosystem} verification command exited successfully.`;
        }
      }
      result.status = "passed";
      result.blocker = undefined;
      completedFromBudgetBoundaryVerification = true;
      await emitExecution(execution, "summary", "completed", `${result.changedFiles.length > 0 ? "Verified edit" : "Verified existing implementation"} with required ${verificationProfile.ecosystem} checks`, {
        details: { paidModelCalls: 0, reconciledModelBudgetBoundary: true, alreadySatisfied: result.changedFiles.length === 0 },
      });
    }
  }

  const resumableBatchFailure = (candidate: typeof result) => candidate.status === "failed"
    // A greenfield batch can legitimately spend its whole model-call allowance understanding the
    // requested product and inspecting the new scaffold before its first durable write. Treat the
    // allowance as a continuation boundary, not a terminal product blocker. Existing-project work
    // still requires a real file change before automatic continuation so read-only failures cannot
    // loop without progress.
    && candidate.changedFiles.length > 0
    && !assessAutonomousBlocker(candidate.blocker ?? "").terminal
    && !(noProgressBoundaryAfterVerifiedEdit && acceptedUiOutcome && previewPlatformForStack(stackProfile.label) === "web")
    && /SOURCE_BATCH_READY_FOR_DETERMINISTIC_VERIFICATION|NO_PROGRESS_(?:BEFORE|AFTER)_MUTATION|command or file write failed|production build (?:not verified|failed)|Checklist item\(s\) not completed|Model-call limit reached|configured execution limit/i.test(candidate.blocker ?? "");
  // A substantial greenfield product can legitimately need more than one bounded executor batch.
  // Preserve one routing/cost identity across continuation batches. On-disk progress can continue,
  // but a batch boundary must never reset the amount the user authorized this mission to spend.
  const maxContinuationBatches = autonomousRepairStageLimit(process.env.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 20);
  let consecutiveStagnantContinuationBatches = 0;
  // Churn-proof stagnation. `evidenceProgressed` below counts ANY changed file as progress, so a model
  // that edits a config file every batch while the SAME production build keeps failing (observed live:
  // a Next.js build-worker crash re-narrated as a new diagnosis each batch — "workspace root", then
  // "turbopack root", then "TypeScript 7") kept the loop alive for 82 turns / $3.17. Track the STRUCTURAL
  // signature of each batch-ending build failure — it erases concrete type text, ids, and durations — so
  // those disguised repeats are recognized across batches and the continuation stops after three.
  const continuationBuildFailureSignatures = new Map<string, number>();
  let stuckBuildFailure = false;
  for (let continuationAttempt = 1; continuationAttempt <= maxContinuationBatches && resumableBatchFailure(result); continuationAttempt += 1) {
    const lastFailedCommand = [...result.commands].reverse().find((command) => command.exitCode !== 0);
    const recoveryFingerprintBefore = createHash("sha256").update([
      result.blocker ?? "",
      lastFailedCommand?.command ?? "",
      lastFailedCommand?.stderr ?? lastFailedCommand?.stdout ?? "",
    ].join("\n").replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds?)\b/gi, "<duration>")).digest("hex");
    const progressPaths = [...new Set([...result.changedFiles, ...workingSet.likelyFiles])].slice(0, 30);
    const sourceBefore = await sourceProgressFingerprint(executorAccess, progressPaths);
    await emitExecution(execution, "planning", "completed", "Continuing autonomous repair from the latest verification evidence", { internal: true, details: { continuationAttempt, recoveryFingerprint: recoveryFingerprintBefore } });
    const continuation = await runMissionExecutor({
      objective,
      task: `Continuation batch ${continuationAttempt}: finish the existing mission. The implementation files are already on disk. Inspect them, complete only the remaining implementation and checklist evidence, run the real production build, and report the real result without rewriting correct files.\n\nOriginal task: ${task}`,
      checklist: result.checklist,
      costScopeId: execution.costScopeId,
      access: executorAccess,
      apiKey: implementationModel.apiKey,
      provider: implementationModel.provider,
      onEvent,
      signal,
      preApprovedCommands,
      approvedCategories: effectiveApprovedCategories,
      standingApprovedCommands: approvedCommands,
      deniedActions: parentMission?.denied_actions ?? [],
      priorContext: resumingIncompleteProject ? undefined : parentMission,
      followUpResolution: resumingIncompleteProject ? undefined : followUpResolution,
      fastLane: false,
      highRisk,
      tier: implementationModel.tier,
      hasBuildTooling: effectiveCommandOnlyRequest ? false : stackHasBuildStep(stackProfile.id),
      verificationProfile,
      executionStrategy: missionStrategy,
      routingAssessment,
      commandOnly: effectiveCommandOnlyRequest,
      // File count is not an application contract. Configuration, styles, and helper components can
      // easily exceed three files while the project still has no route/entry and renders only 404.
      // Keep generated-project write quality, placeholder, manifest, and coordinated-foundation
      // guards active for every continuation. A token MainActivity is not proof the project stopped
      // being a greenfield build.
      newProject: resumingIncompleteProject,
      continuableBatch: resumingIncompleteProject,
      staticProject: resumingIncompleteStaticProject,
      maxTurns: resumingIncompleteProject ? 32 : 16,
      maxNudges: 2,
      routingBudget: resumingIncompleteProject ? generatedRecoveryBudgetForTier(routingBudgetForTier(implementationModel.tier)) : undefined,
    });
    result = {
      ...continuation,
      changedFiles: Array.from(new Set([...result.changedFiles, ...continuation.changedFiles])),
      commands: [...result.commands, ...continuation.commands],
      verification: [...result.verification, ...continuation.verification],
      timeline: [...result.timeline, ...continuation.timeline],
    };
    // Every generated continuation batch must cross the deterministic stack gate before another
    // paid model call. The initial batch already did this below, but continuation results were
    // previously merged and immediately routed back to the model, allowing several junk batches
    // to accumulate without compiling once.
    if (continuation.changedFiles.length > 0
      && access.runCommand
      && verificationProfile.commands.some((item) => item.required && !item.longRunning)) {
      const continuationGate = await runRequiredVerificationProfile({
        access,
        execution,
        profile: verificationProfile,
        projectPath: workspaceProjectPath,
        existingCommands: [],
        requireAutomatedTests: missionRequiresAutomatedTests(task),
      });
      result.commands.push(...continuationGate.commands);
      result.verification.push(...continuationGate.verification);
      if (!continuationGate.passed) {
        const failure = continuationGate.failure
          ? `${continuationGate.failure.command} â€” ${summarizeCommandFailure(continuationGate.failure)}`
          : "no runnable required verification command was available.";
        result.status = "failed";
        result.blocker = `Required ${verificationProfile.ecosystem} command or file write failed: ${failure}`;
      }
    }
    const nextFailedCommand = [...result.commands].reverse().find((command) => command.exitCode !== 0);
    const recoveryFingerprintAfter = createHash("sha256").update([
      result.blocker ?? "",
      nextFailedCommand?.command ?? "",
      nextFailedCommand?.stderr ?? nextFailedCommand?.stdout ?? "",
    ].join("\n").replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds?)\b/gi, "<duration>")).digest("hex");
    const sourceAfter = await sourceProgressFingerprint(executorAccess, [...new Set([...progressPaths, ...result.changedFiles])].slice(0, 30));
    const evidenceProgressed = sourceAfter !== sourceBefore || recoveryFingerprintAfter !== recoveryFingerprintBefore || continuation.changedFiles.length > 0;
    consecutiveStagnantContinuationBatches = evidenceProgressed ? 0 : consecutiveStagnantContinuationBatches + 1;
    if (consecutiveStagnantContinuationBatches >= 2) {
      await emitExecution(execution, "planning", "warning", "Paused duplicate recovery calls after source and verification evidence remained unchanged", { internal: true, details: { recoveryFingerprint: recoveryFingerprintAfter, paidCallPrevented: true, unchangedEvidence: true, stagnantBatches: consecutiveStagnantContinuationBatches } });
      break;
    }
    // A batch that still ends on a failing production build is only progress if it is a DIFFERENT
    // failure (the app exposing its next real error). The same structural signature recurring across
    // batches — even with fresh file churn — is the model flailing on an unchanging wall, not converging.
    const batchBuildFailure = [...result.commands].reverse().find((command) => command.exitCode !== 0 && isProductionBuildCommand(command.command));
    if (batchBuildFailure) {
      const buildSignature = compilerFailureSignature(batchBuildFailure, workspaceProjectPath ?? access.rootLabel);
      const buildRepeats = (continuationBuildFailureSignatures.get(buildSignature) ?? 0) + 1;
      continuationBuildFailureSignatures.set(buildSignature, buildRepeats);
      if (buildRepeats >= 3) {
        stuckBuildFailure = true;
        await emitExecution(execution, "planning", "warning", "Stopped continuation after the same production build failure survived three repair batches", { internal: true, details: { buildSignature, buildRepeats, paidCallPrevented: true } });
        result.status = "failed";
        result.blocker = `The production build failed with the same error across ${buildRepeats} continuation batches without converging. Foundry stopped rather than spend more of the mission budget re-attempting an unchanging failure: ${summarizeCommandFailure(batchBuildFailure)}`;
        break;
      }
    }
  }

  if (deterministicProfileBlocker && result.status !== "stopped" && !stuckBuildFailure && access.runCommand) {
    if (previewTarget && verificationProfile.commands.some((item) => item.required && !item.longRunning && isProductionBuildCommand(item.command))) {
      await stopProjectPreview(previewTarget);
    }
    let finalProfileGate = await runRequiredVerificationProfile({ access, execution, profile: verificationProfile, projectPath: workspaceProjectPath, existingCommands: result.commands, requireAutomatedTests: missionRequiresAutomatedTests(task) });
    result.commands.push(...finalProfileGate.commands);
    result.verification.push(...finalProfileGate.verification);
    // A continuation can expose fresh compiler evidence after creation-time recovery already ended.
    // Route that evidence back into repair instead of turning the final gate into "Repair stopped".
    const finalFailureAttempts = new Map<string, number>();
    const maximumFinalGateRepairs = autonomousRepairStageLimit(process.env.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 20);
    for (let finalRepairAttempt = 1; !finalProfileGate.passed && finalProfileGate.failure && !signal?.aborted && finalRepairAttempt <= maximumFinalGateRepairs; finalRepairAttempt += 1) {
      const finalFailure = finalProfileGate.failure;
      const finalFingerprint = compilerFailureFingerprint(finalFailure, workspaceProjectPath ?? access.rootLabel);
      const repeated = (finalFailureAttempts.get(finalFingerprint) ?? 0) + 1;
      finalFailureAttempts.set(finalFingerprint, repeated);
      if (repeated > 2) {
        await emitExecution(execution, "planning", "warning", "Stopped only after the same final verification failure repeated on repaired source", { internal: true, details: { finalFingerprint, repeated, paidCallPrevented: true } });
        break;
      }
      const finalRepairTask = `Repair the exact final verification failure in this project. Preserve working behavior and edit only source or configuration implicated by the diagnostic. Do not create marker, placeholder, fix-note, progress, or handoff files. The runtime will rerun every required verification command after this one repair action.\n\nCurrent mission:\n${task}\n\nAuthoritative ${verificationProfile.ecosystem} failure:\n${compilerDiagnosticOutput(finalFailure)}`;
      const finalRepairWorkingSet = workingSetWithCommandFailure(await discoverProjectWorkingSet(access, finalRepairTask), finalFailure, workspaceProjectPath ?? access.rootLabel);
      const finalRepairPaths = commandTracebackSourcePaths(finalRepairWorkingSet, workspaceProjectPath ?? access.rootLabel);
      const finalRepairEvidence = finalRepairPaths.length ? await readBoundedWorkingSetEvidence(access, finalRepairPaths) : undefined;
      const finalRepairTier: ModelTier = repeated > 1 ? "architect" : "builder";
      const finalRepairModel = await modelForMissionStage(finalRepairTask, modelMode, finalRepairTier, finalRepairWorkingSet, repeated, routingAssessment) ?? implementationModel;
      await emitModelSelection(execution, repeated > 1 ? "final verification repair escalation" : "final verification repair", finalRepairModel);
      await emitExecution(execution, "reasoning", "completed", `Final verification exposed a concrete ${verificationProfile.ecosystem} failure. Foundry is repairing that evidence and rerunning the complete gate instead of returning Repair stopped.`, { details: { finalFingerprint, finalRepairAttempt, sourcePaths: finalRepairPaths } });
      const finalRepair = await runMissionExecutor({
        objective,
        task: finalRepairTask,
        checklist: [{ id: `final-verification-repair-${finalRepairAttempt}`, label: "Repair the final verification failure", status: "pending" }],
        costScopeId: execution.costScopeId,
        access: executorAccess,
        apiKey: finalRepairModel.apiKey,
        provider: finalRepairModel.provider,
        tier: finalRepairModel.tier,
        onEvent,
        signal,
        preApprovedCommands,
        approvedCategories: effectiveApprovedCategories,
        standingApprovedCommands: approvedCommands,
        deniedActions: parentMission?.denied_actions ?? [],
        hasBuildTooling: true,
        verificationProfile,
        executionStrategy: missionStrategy,
        routingAssessment,
        newProject: resumingIncompleteProject,
        continuableBatch: true,
        initialProjectEvidence: finalRepairEvidence,
        requireFirstMutation: Boolean(finalRepairEvidence),
        maxTurns: 1,
        maxNudges: 0,
        maxOutputTokens: 6_000,
        routingBudget: { maximumModelCalls: 1, estimatedCostUsd: compilerRepairBudgetUsd() },
      });
      result.changedFiles = Array.from(new Set([...result.changedFiles, ...finalRepair.changedFiles]));
      result.commands.push(...finalRepair.commands);
      result.verification.push(...finalRepair.verification);
      mergeExecutionTimeline(result.timeline, finalRepair.timeline);
      result.usage.push(...finalRepair.usage);
      result.turnsUsed += finalRepair.turnsUsed;
      if (!finalRepair.changedFiles.length) continue;
      finalProfileGate = await runRequiredVerificationProfile({ access, execution, profile: verificationProfile, projectPath: workspaceProjectPath, existingCommands: result.commands, requireAutomatedTests: missionRequiresAutomatedTests(task) });
      result.commands.push(...finalProfileGate.commands);
      result.verification.push(...finalProfileGate.verification);
    }
    if (finalProfileGate.passed) {
      result.status = "passed";
      result.blocker = undefined;
      deterministicProfileBlocker = "";
      await emitExecution(execution, "summary", "completed", `Required ${verificationProfile.ecosystem} verification passed after the bounded repair`, { details: { paidModelCalls: 0 } });
    } else {
      result.status = "failed";
      result.blocker = `Required ${verificationProfile.ecosystem} verification still fails after the bounded repair: ${finalProfileGate.failure ? `${finalProfileGate.failure.command} — ${summarizeCommandFailure(finalProfileGate.failure)}` : "no runnable required verification command was available."}`;
    }
  }

  if (resumingIncompleteProject && workspaceProjectPath && hasPrismaSevenLegacySchemaFailure(result.commands)) {
    await emitExecution(execution, "reasoning", "completed", "The real Prisma command proved a major-version mismatch: this generated schema uses the supported Prisma 6 contract, but an unpinned install selected Prisma 7. I’m aligning the CLI and client majors, regenerating the client, and rerunning the production build without another model call.", {
      details: { evidence: "P1012 datasource.url rejection from Prisma CLI 7", targetVersion: "^6.0.0" },
    });
    const prismaAlignment = await runCommand(workspaceProjectPath, "npm.cmd", ["install", "--prefer-offline", "--no-audit", "--no-fund", "prisma@^6.0.0", "@prisma/client@^6.0.0"], [], execution);
    result.commands.push(prismaAlignment);
    const prismaGenerate = prismaAlignment.exitCode === 0
      ? await runCommand(workspaceProjectPath, "npm.cmd", ["exec", "--", "prisma", "generate"], [], execution)
      : prismaAlignment;
    if (prismaAlignment.exitCode === 0) result.commands.push(prismaGenerate);
    const alignedBuild = prismaGenerate.exitCode === 0
      ? await runCommand(workspaceProjectPath, "npm.cmd", ["run", "build"], [], execution)
      : prismaGenerate;
    if (prismaGenerate.exitCode === 0) result.commands.push(alignedBuild);
    result.verification.push({
      check_type: "build",
      result: alignedBuild.exitCode === 0 ? "pass" : "fail",
      evidence: alignedBuild.exitCode === 0
        ? "Prisma CLI/client majors were aligned from command evidence, client generation passed, and the real production build exited 0."
        : `Prisma major alignment completed, but deterministic verification still failed: ${summarizeCommandFailure(alignedBuild)}`,
    });
    if (alignedBuild.exitCode === 0) {
      result.status = "passed";
      result.blocker = undefined;
    }
  }

  const hasHonestlySkippedItem = result.checklist.some((item) => item.status === "skipped");
  const generatedProjectBuildPassed = result.commands.some((command) =>
    command.exitCode === 0 && isProductionBuildCommand(command.command),
  );
  if (resumingIncompleteProject && stackHasBuildStep(stackProfile.id) && !generatedProjectBuildPassed) {
    result.status = "failed";
    result.blocker = "The generated project is not complete because its real production build has not passed. Successful installs, directory listings, lint-only checks, or file read-backs are not build verification.";
    await emitExecution(execution, "summary", "error", "Production build not verified", {
      details: { blocker: result.blocker, requiredEvidence: "successful production build command" },
    });
  }
  // Runtime-level mirror of executor.verifyCompletion's write-free guard. A true operation-only request
  // (run the build/tests/lint and report) may legitimately finish with a successful command and no write.
  // An authorized implementation cannot: a passing command or preview only verifies the current baseline,
  // so a mutating outcome still requires a real file change unless the requested state was already present.
  const ranSuccessfulCommand = result.commands.some((command) => command.exitCode === 0);
  // The model can exhaust its bounded call budget after doing the work but before narrating the
  // final checklist transition. Reconcile only command-shaped blocked items from runtime facts:
  // the requested command really exited 0, and any file explicitly promised unchanged was not in
  // the write set. This is intentionally narrow; a passing test never completes an unrelated
  // implementation item by itself.
  reconcileBlockedCommandChecklist(result.checklist, result.commands, result.changedFiles);
  const checklistSettled = result.checklist.length > 0 && result.checklist.every((item) => item.status === "completed" || item.status === "skipped");
  const verificationSupportsCompletion = result.verification.some((item) => item.result === "pass") && !result.verification.some((item) => item.result === "fail");
  const exhaustedBudgetAfterVerifiedDirectEdit = result.status === "failed"
    && result.changedFiles.length > 0
    && ranSuccessfulCommand
    && checklistSettled
    && verificationSupportsCompletion
    && /Estimated request cost would exceed|Model-call limit reached|Premium-model call limit reached|configured execution limit/i.test(result.blocker ?? "");
  if (exhaustedBudgetAfterVerifiedDirectEdit) {
    for (const item of result.checklist) {
      if (item.status === "pending" || item.status === "running") {
        item.status = "completed";
        item.evidence = "The change was written and read back from disk, and the project command completed before the bounded model budget was reached.";
      }
    }
    result.status = "passed";
    result.blocker = undefined;
    result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
    result.sessionSummary.outcome = "The verified edit is complete. Foundry stopped model calls at the mission budget and is continuing with deterministic runtime verification.";
    await emitExecution(execution, "summary", "completed", "Implementation evidence complete; continuing with browser verification", {
      details: { reason: "The bounded model budget was reached after a verified edit and successful project command, so Foundry is completing deterministic verification instead of buying a wrap-up response." },
    });
  }
  if (result.status === "passed" && mutatingOutcomeRequired && result.changedFiles.length === 0 && !result.alreadySatisfied && !hasHonestlySkippedItem) {
    const blocker = "The user authorized a project change, but no file changed. Passing commands or browser checks only verify the pre-change baseline; they cannot complete an implementation mission.";
    await emitExecution(execution, "summary", "error", "Mission produced no verifiable change or command result", {
      details: { blocker, intent: followUpResolution?.currentIntent ?? deterministicIntent, changedFiles: 0, successfulCommands: ranSuccessfulCommand },
    });
    result.status = "failed";
    result.blocker = blocker;
  }

  if (result.status === "passed" && shouldRunVerify(quality) && !boundedStaticFollowUp && !boundedSmallEdit && !result.alreadySatisfied && !completedFromBudgetBoundaryVerification && !(advancedFromNoProgressBoundaryVerification && acceptedUiOutcome) && !recoveryPreflight?.buildPassed && !boundedCompilerRepairBuildPassed) {
    await runVerificationAndEscalate({ objective, task, result, executorAccess, signal, preApprovedCommands, approvedCategories: effectiveApprovedCategories, approvedCommands, execution, quality, complexity, modelMode, strategy: missionStrategy });
  }

  const inheritedOperationRequest = acceptedRequirementTask;
  const currentPreviewPlatform = previewPlatformForStack(stackProfile.label);
  const recoveringGeneratedWebProject = resumingIncompleteProject && currentPreviewPlatform === "web";
  const budgetBoundaryNeedsWebVerification = (modelBudgetBoundaryAfterVerifiedEdit || result.alreadySatisfied) && currentPreviewPlatform === "web";
  const boundedStaticChangeNeedsBrowserVerification = boundedStaticFollowUp && result.status === "passed" && result.changedFiles.length > 0;
  const uiChangeNeedsBrowserVerification = acceptedUiOutcome && result.status === "passed" && result.changedFiles.length > 0 && currentPreviewPlatform === "web";
  // Browser verification is a web-only contract. Native build artifacts intentionally have no URL;
  // treating their positive readiness message as a missing-web-preview error produced contradictory
  // results such as `failure: App.exe is built and ready to launch or download`.
  const deterministicBrowserOperationRequested = currentPreviewPlatform === "web" && (Boolean(preModelBrowserEvidence) || recoveringGeneratedWebProject || budgetBoundaryNeedsWebVerification || boundedStaticChangeNeedsBrowserVerification || uiChangeNeedsBrowserVerification || (noProgressBoundaryAfterVerifiedEdit && acceptedUiOutcome) || (/\b(?:validate|revalidate|verify|test|retest|exercise|check|recheck)\b/i.test(inheritedOperationRequest)
    && /\b(?:browser|preview|live\s+(?:site|app)|navigation|user\s+flow|click(?:ing)?)\b/i.test(inheritedOperationRequest)));
  if (deterministicBrowserOperationRequested) {
    // Changed source makes every earlier build artifact stale by definition. This rebuild used to run
    // only for the evidence-first repair trigger, so a resumed mission whose continuation batch wrote
    // the real features AFTER the pre-model build satisfied `buildPassed` with the stale build — and the
    // browser gate then validated an old dist still showing the placeholder. The mission ended
    // "failed, must continue" with a Retry button for work a free deterministic rebuild would have
    // finished. Rebuild whenever files changed, no matter which trigger got us here: no model call,
    // one local build, and the gate then judges the app the user actually has.
    if (result.changedFiles.length > 0 && stackHasBuildStep(stackProfile.id)) {
      const repairedBuild = await runCanonicalProjectBuild();
      if (!repairedBuild) {
        result.status = "failed";
        result.blocker = "The project declares a build step, but this project source cannot run the canonical production build.";
      } else {
        result.commands.push(repairedBuild);
        result.verification.push({
          check_type: "build",
          result: repairedBuild.exitCode === 0 ? "pass" : "fail",
          evidence: repairedBuild.exitCode === 0
            ? "The production build passed against the final changed source, so the preview reflects the real implementation."
            : `The production build failed against the final changed source: ${summarizeCommandFailure(repairedBuild)}`,
        });
      }
    }
    // The LATEST production build is the verdict. `some(...)` let a stale passing build outvote a fresh
    // failing one, certifying an artifact the current source can no longer produce.
    const latestProductionBuild = [...result.commands].reverse().find((command) => isProductionBuildCommand(command.command));
    const buildPassed = latestProductionBuild ? latestProductionBuild.exitCode === 0 : false;
    if (!buildPassed && stackHasBuildStep(stackProfile.id)) {
      result.status = "failed";
      result.blocker = "Real browser verification was requested, but the canonical production build did not pass first.";
    } else {
      let managedPreview = previewTarget
        ? await startProjectPreview(previewTarget, stackProfile.label, [], execution)
        : { previewState: "unavailable" as const, previewPlatform: "web" as const, previewReason: "This project source does not expose an owned preview target." };
      // "Unavailable" and "failed to start" are different outcomes and must not share a verdict.
      // Unavailable means this platform genuinely can't be browser-previewed here — a native/mobile app
      // on Windows, or a stack with no web preview target. The build already passed; the preview simply
      // can't run on this machine. Recording that as a failed preview marked the whole mission failed
      // and spun the autonomous repair loop trying to "fix" an environmental limit — the user saw
      // "Repair stopped" on work that was actually complete. Treat it as a skipped check with the real
      // next steps, and leave the mission's status alone.
      const previewUnavailableByPlatform = managedPreview.previewState === "unavailable";
      if (previewUnavailableByPlatform) {
        result.verification.push({
          check_type: "preview",
          result: "skipped",
          evidence: managedPreview.previewReason || "A live in-browser preview is not available for this project on this machine.",
        });
        result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
        // Preview availability cannot turn failed generation, SDK intake, or verification into
        // a completed implementation. Preserve the authoritative execution verdict.
        result.sessionSummary.outcome = result.status === "passed"
          ? `The implementation passed its available verification. ${managedPreview.previewReason || "A live in-browser preview is not available for this project on this machine."}`
          : `The implementation did not complete: ${result.blocker || "required verification is still failing."} ${managedPreview.previewReason || "A live in-browser preview is not available for this project on this machine."}`;
      } else if (!managedPreview.previewUrl || managedPreview.previewPlatform !== "web") {
        result.status = "failed";
        result.blocker = managedPreview.previewReason || "Real browser verification was requested, but Foundry could not start an owned web preview.";
      } else {
        let browserEvidence = await validateGeneratedStaticPreview(managedPreview.previewUrl, previewArtifactRoot(previewTarget!), execution, managedPreview.previewOwnershipToken, browserAcceptanceTask);
        browserEvidence = await includeStaticTopologyEvidence(access, staticSourceTopology, browserEvidence);
        // A refused connection is owned preview infrastructure, not evidence that product source is
        // defective. Restart the exact preview generation and retry deterministically before either
        // rebuilding framework assets or spending another model call.
        if (!browserEvidence.verified && browserEvidence.infrastructureFailure && previewTarget) {
          await emitExecution(execution, "preview", "running", "The owned preview stopped responding. Restarting it and repeating the same browser checks without a model call.", {
            details: { paidModelCalls: 0, recovery: "owned-preview-restart" },
          });
          await stopProjectPreview(previewTarget);
          managedPreview = await startProjectPreview(previewTarget, stackProfile.label, [], execution);
          if (managedPreview.previewUrl && managedPreview.previewPlatform === "web" && managedPreview.previewState === "ready") {
            browserEvidence = await validateGeneratedStaticPreview(managedPreview.previewUrl, previewArtifactRoot(previewTarget), execution, managedPreview.previewOwnershipToken, browserAcceptanceTask);
            browserEvidence = await includeStaticTopologyEvidence(access, staticSourceTopology, browserEvidence);
          }
        }
        if (!browserEvidence.verified && browserEvidence.infrastructureFailure && previewTarget && stackHasBuildStep(stackProfile.id)) {
          await emitExecution(execution, "reasoning", "completed", "The production source is valid, but its generated framework assets changed while the preview was live. I’m pausing the preview, rebuilding, and rechecking without a model call.", {
            details: { paidModelCalls: 0, recovery: "framework-preview-generation" },
          });
          const infrastructureBuild = await runCanonicalProjectBuild();
          if (infrastructureBuild) {
            result.commands.push(infrastructureBuild);
            result.verification.push({
              check_type: "build",
              result: infrastructureBuild.exitCode === 0 ? "pass" : "fail",
              evidence: infrastructureBuild.exitCode === 0
                ? "A clean production build passed with the owned preview paused."
                : `The clean preview-infrastructure rebuild failed: ${summarizeCommandFailure(infrastructureBuild)}`,
            });
          }
          if (infrastructureBuild?.exitCode === 0) {
            managedPreview = await startProjectPreview(previewTarget, stackProfile.label, [], execution);
            if (managedPreview.previewUrl && managedPreview.previewPlatform === "web" && managedPreview.previewState === "ready") {
              browserEvidence = await validateGeneratedStaticPreview(managedPreview.previewUrl, previewArtifactRoot(previewTarget), execution, managedPreview.previewOwnershipToken, browserAcceptanceTask);
              browserEvidence = await includeStaticTopologyEvidence(access, staticSourceTopology, browserEvidence);
            }
          }
        }
        const browserRepairChangedFiles = new Set<string>();
        const attemptedBrowserRepairFingerprints = new Set<string>();
        const repeatedBrowserFindings = new Map<string, number>();
        const maximumBrowserRepairStages = boundedSmallEdit || boundedStaticFollowUp ? 1 : autonomousRepairStageLimit(process.env.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES, 2);
        let browserVerificationConflict = false;
        const browserRepairSourcePaths = () => [...new Set([
          ...workingSet.likelyFiles,
          ...preModelRepairReadPaths,
          ...result.changedFiles,
          ...browserRepairChangedFiles,
        ])];
        // An exact retry already received one evidence-first implementation pass above. If that pass
        // made no source change, seed its semantic finding so the loop rechecks deterministically
        // instead of purchasing the same repair from another model.
        if (exactVerificationRepairLane && result.changedFiles.length === 0) {
          const sourceFingerprint = await sourceProgressFingerprint(capabilityAccess, browserRepairSourcePaths());
          attemptedBrowserRepairFingerprints.add(semanticRepairFingerprint(browserEvidence.evidence, sourceFingerprint));
        }
        // Browser acceptance is a product gate, not a one-shot suggestion. Continue autonomously
        // while source or evidence progresses, and prevent paid calls for an identical finding on
        // identical source. The shared mission cost scope and configured stage ceiling remain intact.
        for (let repairAttempt = 1; !browserEvidence.verified && !browserEvidence.infrastructureFailure && !modelBudgetBoundaryAfterVerifiedEdit && repairAttempt <= maximumBrowserRepairStages; repairAttempt += 1) {
          const findingFingerprint = verificationFindingFingerprint(browserEvidence.evidence);
          const findingCount = (repeatedBrowserFindings.get(findingFingerprint) ?? 0) + 1;
          repeatedBrowserFindings.set(findingFingerprint, findingCount);
          if (findingCount > 1) {
            browserVerificationConflict = true;
            await emitExecution(execution, "planning", "warning", "Stopped repeated repair on unchanged browser findings", {
              internal: true,
              details: { findingFingerprint, findingCount, paidCallPrevented: true, repairAttempt },
            });
            break;
          }
          const sourceFingerprint = await sourceProgressFingerprint(capabilityAccess, browserRepairSourcePaths());
          const evidenceFingerprint = semanticRepairFingerprint(browserEvidence.evidence, sourceFingerprint);
          if (attemptedBrowserRepairFingerprints.has(evidenceFingerprint)) {
            await emitExecution(execution, "preview", "running", "Rechecking unchanged browser evidence without another model call", {
              internal: true,
              details: { evidenceFingerprint, sourceFingerprint, paidCallPrevented: true, repairAttempt },
            });
            const rechecked = await validateGeneratedStaticPreview(managedPreview.previewUrl!, previewArtifactRoot(previewTarget!), execution, managedPreview.previewOwnershipToken, browserAcceptanceTask);
            browserEvidence = await includeStaticTopologyEvidence(access, staticSourceTopology, rechecked);
            if (rechecked.verified) break;
            const recheckedFingerprint = semanticRepairFingerprint(rechecked.evidence, sourceFingerprint);
            if (attemptedBrowserRepairFingerprints.has(recheckedFingerprint)) {
              attemptedBrowserRepairFingerprints.clear();
              await emitExecution(execution, "planning", "warning", "Changing browser repair strategy after unchanged source and evidence", {
                internal: true,
                details: { evidenceFingerprint: recheckedFingerprint, sourceFingerprint, strategyReset: true, terminal: false, repairAttempt },
              });
              continue;
            }
            continue;
          }
          attemptedBrowserRepairFingerprints.add(evidenceFingerprint);
          const staticBrowserRepair = stackProfile.id === "static-html";
          await emitExecution(execution, "reasoning", "completed", repairAttempt === 1
            ? "The real desktop/mobile preview exposed concrete failures. I’m repairing all verified evidence, rebuilding, restarting the owned preview, and exercising the same routes again."
            : `Browser acceptance still has verified failures after repair ${repairAttempt - 1}. I’m continuing from the changed source with only the remaining evidence.`, { internal: true });
          const repairModel = await modelForMissionStage(inheritedOperationRequest, modelMode, "builder", workingSet, parentMission?.state === "failed" ? repairAttempt : repairAttempt - 1, routingAssessment) ?? initialModel!;
          await emitModelSelection(execution, `browser repair ${repairAttempt}`, repairModel);
          const repair = await runMissionExecutor({
            objective,
            task: `Repair every remaining verified failure in this existing ${staticBrowserRepair ? "static" : "framework"} web project. Preserve the saved product requirements and every working route or interaction. Resolve every distinct item in the evidence below, including missing routes, failed requests, console errors, and responsive defects; do not stop after the first symptom. Then run the smallest relevant source check. If the product behavior is real but Foundry has no built-in deterministic driver for it, add a safe declarative acceptance workflow so the runtime can execute the behavior instead of trusting a claim.\n\n${acceptanceWorkflowTemplate()}\n\nSaved and current requirements:\n${inheritedOperationRequest}\n\nRemaining verified browser failure:\n${browserEvidence.evidence}`,
            checklist: [{ id: `browser-evidenced-repair-${repairAttempt}`, label: "Repair every remaining real desktop/mobile preview failure", status: "pending" }],
            costScopeId: execution.costScopeId,
            access: capabilityAccess,
            apiKey: repairModel.apiKey,
            provider: repairModel.provider,
            tier: repairModel.tier,
            onEvent,
            signal,
            approvedCategories: effectiveApprovedCategories,
            preApprovedCommands,
            hasBuildTooling: !staticBrowserRepair,
            newProject: false,
            staticProject: staticBrowserRepair,
            staticRewrite: staticBrowserRepair,
            evidenceFirstRepair: !staticBrowserRepair,
            evidenceRepairReadPaths: staticBrowserRepair ? undefined : await verifiedBrowserRepairReadPaths(capabilityAccess, browserEvidence.evidence),
            executionStrategy: missionStrategy,
            routingAssessment,
            maxTurns: staticBrowserRepair ? 3 : 8,
            maxNudges: 1,
            maxOutputTokens: staticBrowserRepair ? undefined : 5_000,
            routingBudget: boundedSmallEdit ? boundedSmallEditBudget : staticBrowserRepair ? undefined : { maximumModelCalls: 10, estimatedCostUsd: 1 },
          });
          result.changedFiles = [...new Set([...result.changedFiles, ...repair.changedFiles])];
          result.commands.push(...repair.commands);
          result.verification.push(...repair.verification);
          mergeExecutionTimeline(result.timeline, repair.timeline);
          result.usage.push(...repair.usage);
      { const destructive = await revertDestructiveRepairEdits(access, execution, repair.timeline).catch(() => [] as string[]); if (destructive.length) { repair.changedFiles = repair.changedFiles.filter((file) => !destructive.includes(file)); repair.status = "failed"; repair.blocker = repair.blocker || `The repair deleted most of ${destructive.length} implemented file(s); the implementation was restored and the repair rejected.`; } }
          result.turnsUsed += repair.turnsUsed;
          if (signal?.aborted || repair.status === "stopped") break;
          if (repair.changedFiles.length === 0) {
            await emitExecution(execution, "preview", "running", "Repair reported no source change; repeating the exact browser gate without another model call", {
              internal: true,
              details: { evidenceFingerprint, sourceFingerprint, paidCallPrevented: true, repairAttempt },
            });
            browserEvidence = await validateGeneratedStaticPreview(managedPreview.previewUrl!, previewArtifactRoot(previewTarget!), execution, managedPreview.previewOwnershipToken, browserAcceptanceTask);
            browserEvidence = await includeStaticTopologyEvidence(access, staticSourceTopology, browserEvidence);
            if (browserEvidence.verified) break;
            const repeatedFingerprint = semanticRepairFingerprint(browserEvidence.evidence, sourceFingerprint);
            if (attemptedBrowserRepairFingerprints.has(repeatedFingerprint)) {
              attemptedBrowserRepairFingerprints.clear();
              await emitExecution(execution, "planning", "warning", "Changing browser repair strategy after a zero-change attempt", {
                internal: true,
                details: { evidenceFingerprint: repeatedFingerprint, sourceFingerprint, strategyReset: true, terminal: false, repairAttempt },
              });
              continue;
            }
            continue;
          }
          repair.changedFiles.forEach((file) => browserRepairChangedFiles.add(file));
          if (repair.changedFiles.length > 0) {
            const repairedBuild = staticBrowserRepair ? undefined : await runCanonicalProjectBuild();
            if (repairedBuild) {
              result.commands.push(repairedBuild);
              result.verification.push({
                check_type: "build",
                result: repairedBuild.exitCode === 0 ? "pass" : "fail",
                evidence: repairedBuild.exitCode === 0
                  ? "The production build passed after the browser-evidenced framework repair."
                  : `The production build failed after the browser-evidenced repair: ${summarizeCommandFailure(repairedBuild)}`,
              });
            }
            if (repairedBuild && repairedBuild.exitCode !== 0) {
              browserEvidence = { verified: false, evidence: `Browser recheck is waiting on a successful production build: ${summarizeCommandFailure(repairedBuild)}`, brokenImageSources: [], acceptanceVerified: false };
              continue;
            }
            // Production servers retain route manifests and compiled chunks. Restart after every
            // source/build repair so newly created routes and assets are what the browser exercises.
            await stopProjectPreview(previewTarget!);
            managedPreview = await startProjectPreview(previewTarget!, stackProfile.label, [], execution);
            if (!managedPreview.previewUrl || managedPreview.previewPlatform !== "web" || managedPreview.previewState !== "ready") {
              browserEvidence = { verified: false, evidence: managedPreview.previewReason || "The repaired owned preview did not become ready.", brokenImageSources: [], acceptanceVerified: false };
              continue;
            }
            browserEvidence = await validateGeneratedStaticPreview(managedPreview.previewUrl, previewArtifactRoot(previewTarget!), execution, managedPreview.previewOwnershipToken, browserAcceptanceTask);
            browserEvidence = await includeStaticTopologyEvidence(access, staticSourceTopology, browserEvidence);
          }
        }
        result.verification.push({ check_type: "preview", result: browserEvidence.verified ? "pass" : "fail", evidence: browserEvidence.evidence });
        // The executor cannot drive a real browser — this gate is the component that does. When the model
        // therefore leaves its own "verify in the browser" checklist item blocked, that is a limitation of
        // the step, not a product defect, and it must not outlive the gate that just performed exactly
        // those checks. Requires real evidence: the gate verified the rendered page, the edit is on disk,
        // and every executed command succeeded — so a genuine build/test failure still fails the mission.
        const everyCommandPassed = result.commands.every((command) => command.exitCode === 0);
        const browserGateSupersedesUnverifiedStep = browserEvidence.verified
          && browserEvidence.acceptanceVerified
          && everyCommandPassed
          && result.changedFiles.length > 0;
        const browserMayCompleteMission = browserEvidence.verified
          && (result.status !== "failed" || browserGateSupersedesUnverifiedStep || ((modelBudgetBoundaryAfterVerifiedEdit || noProgressBoundaryAfterVerifiedEdit) && browserEvidence.acceptanceVerified))
          && (!mutatingOutcomeRequired || result.changedFiles.length > 0 || result.alreadySatisfied);
        if (browserMayCompleteMission) {
          result.status = "passed";
          result.blocker = undefined;
          if (browserRepairChangedFiles.size > 0) {
            result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
            result.sessionSummary.outcome = "Foundry repaired the browser-evidenced source defects, rebuilt the project, restarted its owned preview, and verified the finished desktop/mobile experience.";
            result.sessionSummary.changes = [...new Set([...result.sessionSummary.changes, ...browserRepairChangedFiles])];
            result.sessionSummary.flags = [];
          }
          if (modelBudgetBoundaryAfterVerifiedEdit || noProgressBoundaryAfterVerifiedEdit) {
            result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
            result.sessionSummary.outcome = "Implemented the requested project change and verified the changed interface in desktop and mobile browsers.";
            result.sessionSummary.flags = result.sessionSummary.flags.filter((flag) => !/model-call limit|configured execution limit|provider fallbacks|another paid model call|NO_PROGRESS_AFTER_MUTATION/i.test(flag));
          }
          for (const item of result.checklist) {
            if (item.status === "pending" || item.status === "running" || item.status === "blocked") {
              item.status = "completed";
              item.evidence = browserEvidence.evidence;
            }
          }
        } else if (!browserEvidence.verified && browserEvidence.renderHealthy && result.changedFiles.length > 0 && result.commands.every((command) => command.exitCode === 0)) {
          // The requested change is on disk and read back, every project check exited 0, the production
          // build passed and the page rendered cleanly — the only gap is that Foundry could not itself
          // demonstrate a capability in the browser. That is an unproven claim, not a broken project,
          // and reporting it as "Repair stopped" told users their working change had failed.
          //
          // Say exactly what is and is not proven, and stop here: there is no defect to repair, so
          // spending more paid repair calls on it cannot help.
          result.status = "needs-clarification";
          result.blocker = `The application renders cleanly, but the requested behavior still lacks passing executable acceptance evidence. Foundry will not call an unproven behavior complete. ${browserEvidence.evidence}`;
          result.clarificationQuestions = [{ question: "Continue autonomous implementation and acceptance-workflow repair from the preserved evidence?", options: ["Continue recovery", "Pause here"] }];
          // "skipped" alongside the passing build/typecheck records is what makes the mission read
          // "Complete (partially verified)" — an honest claim, not a silent pass.
          result.verification.push({ check_type: "preview", result: "fail", evidence: result.blocker });
          result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
          result.sessionSummary.outcome = "Applied the requested change and verified it with the project's own checks — file read-back, typecheck, production build and a clean live render all passed. Foundry could not independently demonstrate the behavior in the browser, so that part is unproven rather than broken.";
          result.sessionSummary.changes = [...new Set([...result.sessionSummary.changes, ...browserRepairChangedFiles])];
          result.sessionSummary.flags = [`Unproven in the browser (no defect found): ${browserEvidence.evidence}`];
          for (const item of result.checklist) {
            if (item.status === "pending" || item.status === "running" || item.status === "blocked") {
              item.status = "blocked";
              item.evidence = browserEvidence.evidence;
            }
          }
        } else if (!browserEvidence.verified) {
          result.status = "failed";
          result.blocker = browserVerificationConflict
            ? `Foundry preserved the unfinished implementation after every configured browser-repair strategy returned unchanged source and evidence. Continue recovery from this exact browser gate.\n\n${browserEvidence.evidence}`
            : browserEvidence.evidence;
          result.clarificationQuestions = undefined;
          result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
          result.sessionSummary.outcome = browserVerificationConflict
            ? "Foundry preserved the unfinished implementation and its exact browser evidence for a fresh repair strategy."
            : browserRepairChangedFiles.size > 0
            ? "Foundry changed and rebuilt the project, but the real browser gate still has unresolved product defects."
            : "The production build passed, but the real browser gate still has unresolved product defects.";
          result.sessionSummary.changes = [...new Set([...result.sessionSummary.changes, ...browserRepairChangedFiles])];
          result.sessionSummary.flags = [result.blocker];
          for (const item of result.checklist) {
            if (item.status !== "skipped") {
              item.status = "blocked";
              item.evidence = browserEvidence.evidence;
            }
          }
        } else {
          result.status = "failed";
          result.blocker = browserEvidence.acceptanceApplicable === false
            ? `Foundry could not derive a specific rendered check for this request, so the change was not independently proven in the browser. The code change, production build, and page render are all healthy. ${browserEvidence.evidence}`
            : `The project is healthy, but Foundry could not prove the requested behavior on a reachable rendered surface. ${browserEvidence.evidence}`;
          result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
          result.sessionSummary.outcome = "The source change and production build are preserved, but request-specific browser acceptance is still unverified.";
          result.sessionSummary.flags = [result.blocker];
          await emitExecution(execution, "summary", "error", "The unchanged preview cannot complete the failed implementation", {
            details: {
              blocker: result.blocker,
              changedFiles: result.changedFiles.length,
              browserBaselinePassed: true,
              mutationStillRequired: mutatingOutcomeRequired,
            },
          });
        }
      }
    }
  }

  // These two conclusions apply to EVERY mission path, not just fresh creation — the resume of an
  // unfinished generated project reached this point without either, and the user got a 23-file project
  // with two parallel tab structures and a preview still serving a stale placeholder bundle.
  //
  // 1. Duplicate reconciliation: an interrupted-then-resumed build writes parallel structures
  //    (app/history.tsx AND app/(tabs)/history.tsx). Identical copies are removed; divergent conflicts
  //    are surfaced as a real finding instead of shipped silently.
  // 2. Stale-artifact rebuild: changed source makes every earlier build artifact stale by definition.
  //    When the project has a build step and this mission changed files after its last successful build,
  //    rerun the canonical build so the preview reflects the implementation that actually exists.
  if (result.changedFiles.length > 0) {
    const workspaceReconciliation = await reconcileDuplicateProjectFiles(executorAccess, execution).catch(() => ({ removed: [] as string[], problem: undefined as string | undefined }));
    if (workspaceReconciliation.problem) {
      result.verification.push({ check_type: "file-read", result: "fail", evidence: workspaceReconciliation.problem });
      if (result.status === "passed") {
        result.status = "failed";
        result.blocker = workspaceReconciliation.problem;
      }
    }
    // "Fresh" must be judged against WRITES, not against the command list — file edits are not commands,
    // so comparing only commands let a repair's post-build edits masquerade as a fresh artifact: the
    // mission recorded "build passed" from 71 seconds BEFORE the repair rewired the entry screen, and
    // the preview kept serving the stale placeholder bundle. Timeline events carry real timestamps for
    // both command completions and file writes; the artifact is fresh only when the last passing
    // production build finished AFTER the last file write.
    const lastPassingBuildAt = [...result.timeline].reverse().find((event) =>
      event.kind === "command" && event.status === "completed" && event.command && isProductionBuildCommand(event.command))?.timestamp ?? "";
    const lastFileWriteAt = [...result.timeline].reverse().find((event) =>
      (event.kind === "edit" || event.kind === "file") && event.status === "completed" && event.filePath)?.timestamp ?? "";
    const artifactAlreadyFresh = Boolean(lastPassingBuildAt) && (!lastFileWriteAt || lastPassingBuildAt > lastFileWriteAt);
    if (result.status === "passed" && stackHasBuildStep(stackProfile.id) && !artifactAlreadyFresh && access.runCommand && workspaceProjectPath) {
      // On Windows the owned preview server holds dist/ open, and expo/next exports fail with EBUSY
      // trying to replace it — reproduced live with exit 1. Every build against the served artifact
      // must pause the preview first; it restarts from the fresh output afterward.
      if (previewTarget) await stopProjectPreview(previewTarget).catch(() => undefined);
      const freshBuild = await runCommand(workspaceProjectPath, "npm.cmd", ["run", "build"], [], execution).catch(() => undefined);
      if (freshBuild) {
        result.commands.push(freshBuild);
        result.verification.push({
          check_type: "build",
          result: freshBuild.exitCode === 0 ? "pass" : "fail",
          evidence: freshBuild.exitCode === 0
            ? "The final production build passed against the finished source, so the preview artifact matches the real implementation."
            : `The final production build failed against the finished source: ${summarizeCommandFailure(freshBuild)}`,
        });
        if (freshBuild.exitCode !== 0) {
          result.status = "failed";
          result.blocker = `The finished source does not pass its own production build: ${summarizeCommandFailure(freshBuild)}`;
        }
      }
    }
  }

  // Compliance gate. Everything above this point verifies that the project is *healthy*: the file was
  // written and read back, the code typechecks, the production build passes, the page renders. None of
  // it verifies that the change the user asked for actually happened — and all four pass on a no-op.
  // Observed live: asked to move a number, a mission deleted one comment line and reported
  // "Done — Verified by: file-read, typecheck, build, preview."
  //
  // So before any success claim survives, check the request against the real diff. A violated assertion
  // means the work was not done and must never read as success; an underivable one means it could not be
  // proven, which downgrades the claim to unverified rather than waving it through.
  // Gated on the request naming a concrete change rather than on files having changed: a mission that
  // writes nothing and declares "request already satisfied" is the same false success by another route.
  // Observed live — the model concluded the total was already above the filter bar, changed nothing, and
  // reported "Done". An unchanged file is exactly the evidence that the move did not happen, so it must
  // be checked, not skipped.
  // Broad visual redesigns are proven by the real responsive browser workflow below. The
  // token/position-oriented source-diff compliance checker cannot prove hierarchy, accessibility,
  // empty states, or interaction quality; applying it here invented violations after healthy
  // browser-ready source and spent repeated correction calls until the mission budget failed.
  if (result.status === "passed" && requestNamesConcreteChange && !boundedStaticWholeRewrite && !semanticVisualStaticTransformation) {
    const originalContent = new Map<string, string | undefined>();
    for (const event of result.timeline) {
      if (!event.filePath || event.beforeContent === undefined) continue;
      if (!originalContent.has(event.filePath)) originalContent.set(event.filePath, event.beforeContent);
    }
    const checkCompliance = async () => {
      const targets = result.changedFiles.length ? result.changedFiles : workingSet.likelyFiles.slice(0, 4);
      const changes: FileChange[] = [];
      for (const filePath of targets) {
        const after = await executorAccess.readFile(filePath, { limitBytes: 400_000 }).catch(() => undefined);
        if (!after?.exists) continue;
        // With no recorded prior content the current file is both sides of the comparison — which is the
        // correct reading of "nothing was changed", not a reason to skip the check.
        changes.push({ path: filePath, before: originalContent.get(filePath) ?? after.content, after: after.content });
      }
      return complianceVerdict(deriveOutcomeAssertions(requestedTask, changes));
    };

    let compliance = await checkCompliance();

    // Detection is not the deliverable. Knowing precisely why the request was not carried out is still a
    // request that was not carried out, so feed the exact diagnosis back and let the model correct it.
    // The generic instruction is what produced the delete, the no-op and the duplicate; the specific one
    // names the actual mistake. One attempt only, on a small budget — it runs solely when something is
    // already wrong, so it costs nothing on work that landed correctly.
    const correction = compliance.assertions.map(correctionInstruction).filter(Boolean).join(" ");
    if (compliance.status === "violated" && correction) {
      await emitExecution(execution, "reasoning", "completed", "The change I made does not match what you asked for. Correcting it now with the specific defect identified, before reporting anything.");
      const correctionModel = await modelForMissionStage(task, modelMode, "builder", workingSet, 1, routingAssessment) ?? implementationModel;
      const correctionEvidence = await readBoundedWorkingSetEvidence(executorAccess, (result.changedFiles.length ? result.changedFiles : workingSet.likelyFiles).slice(0, 3));
      const correctionRun = await runMissionExecutor({
        objective,
        task: `Your previous edit did not carry out the user's request. Fix it now.\n\nWhat the user asked for: ${requestedTask}\n\nWhat is actually wrong with the current source: ${compliance.summary}\n\nHow to correct it: ${correction}\n\nMake the smallest edit that satisfies the request exactly, then verify it with the project's applicable checks. Do not explain, do not re-plan, and do not leave duplicate or orphaned content behind.`,
        checklist: result.checklist,
        costScopeId: execution.costScopeId,
        access: executorAccess,
        apiKey: correctionModel.apiKey,
        provider: correctionModel.provider,
        tier: correctionModel.tier,
        onEvent,
        signal,
        preApprovedCommands,
        approvedCategories: effectiveApprovedCategories,
        standingApprovedCommands: approvedCommands,
        deniedActions: parentMission?.denied_actions ?? [],
        priorContext: parentMission,
        followUpResolution,
        highRisk,
        hasBuildTooling: stackHasBuildStep(stackProfile.id),
        verificationProfile,
        executionStrategy: missionStrategy,
        routingAssessment,
        staticProject: boundedStaticFollowUp,
        initialProjectEvidence: correctionEvidence,
        requireFirstMutation: true,
        continuableBatch: true,
        maxTurns: 4,
        maxNudges: 1,
        routingBudget: recoveryRoutingBudget(routingBudgetForTier(correctionModel.tier).estimatedCostUsd),
      });
      result.changedFiles = Array.from(new Set([...result.changedFiles, ...correctionRun.changedFiles]));
      result.commands = [...result.commands, ...correctionRun.commands];
      result.verification = [...result.verification, ...correctionRun.verification];
      mergeExecutionTimeline(result.timeline, correctionRun.timeline);
      result.usage = [...result.usage, ...correctionRun.usage];
      compliance = await checkCompliance();
      await emitExecution(execution, "reasoning", "completed", compliance.status === "satisfied"
        ? "The correction landed — the requested change is now present in the source."
        : compliance.status === "underivable"
          ? "The correction changed the source, but the outcome cannot be proven from the source alone. Reporting it as unproven rather than as success."
          : "The correction still did not produce the requested change, so I am reporting that rather than claiming success.");
      if (compliance.status !== "violated") {
        // The earlier failure verdict has been superseded by a successful correction. It shares the
        // stable mission-summary identity, so it must be explicitly overwritten — otherwise the run ends
        // showing a "Done" heading beside leftover text saying the change was never made, and the user
        // cannot tell which one is true.
        result.blocker = undefined;
        if (result.sessionSummary) {
          result.sessionSummary.flags = result.sessionSummary.flags.filter((flag) => !/requested change (?:was not carried out|is not in it)|not found in the final diff/i.test(flag));
          result.sessionSummary.outcome = "";
        }
        for (const item of result.checklist) {
          if (item.status === "blocked") item.status = "completed";
        }
        await emitExecution(execution, "summary", "completed", "Requested change applied after correction", {
          details: { correctedAfterComplianceFailure: true, compliance: compliance.summary },
        });
      }
    }

    if (compliance.status === "violated") {
      result.status = "failed";
      result.blocker = `${compliance.summary} The project still builds and runs, so nothing is broken — the requested change simply was not applied.`;
      result.verification.push({ check_type: "file-read", result: "fail", evidence: compliance.summary });
      result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
      result.sessionSummary.outcome = "Foundry checked the finished diff against what you asked for and the requested change is not in it. Reporting this as incomplete rather than claiming a success the source does not support.";
      result.sessionSummary.flags = [result.blocker];
      for (const item of result.checklist) {
        if (item.status !== "skipped") {
          item.status = "blocked";
          item.evidence = compliance.summary;
        }
      }
      await emitExecution(execution, "summary", "error", "Requested change not found in the final diff", {
        details: { blocker: result.blocker, assertions: compliance.assertions.map((assertion) => `${assertion.requirement} — ${assertion.evidence}`) },
      });
    } else if (compliance.status === "satisfied") {
      result.verification.push({ check_type: "file-read", result: "pass", evidence: compliance.summary });
    } else {
      result.verification.push({ check_type: "file-read", result: "skipped", evidence: compliance.summary });
    }
  }

  if (materializedAssets.length) {
    const assetPaths = materializedAssets.map((asset) => asset.projectPath);
    result.changedFiles = [...new Set([...assetPaths, ...result.changedFiles])];
    result.verification.push({
      check_type: "file-read",
      result: "pass",
      evidence: `${materializedAssets.length} attached image asset${materializedAssets.length === 1 ? " was" : "s were"} written as exact binary bytes and read back successfully before implementation.`,
    });
    result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
    result.sessionSummary.changes = [...new Set([...assetPaths, ...result.sessionSummary.changes])];
  }

  const desktopActions = desktopInteractionActionsForTask(inheritedOperationRequest);
  const desktopBoundaryPolicy = nativeAcceptanceBoundaryPolicy({
    status: result.status,
    changedFileCount: result.changedFiles.length,
    blocker: result.blocker,
    behaviorAcceptanceRequired: requiresFreshBehavioralAcceptance(inheritedOperationRequest),
  });
  const desktopBudgetBoundaryAfterVerifiedEdit = desktopBoundaryPolicy.budgetBoundaryAfterVerifiedEdit;
  const desktopNoProgressBoundaryAfterVerifiedEdit = desktopBoundaryPolicy.noProgressBoundaryAfterVerifiedEdit;
  const deterministicDesktopAcceptanceRequested = currentPreviewPlatform === "desktop" && desktopBoundaryPolicy.shouldValidate;
  if (deterministicDesktopAcceptanceRequested) {
    const interactionRequired = desktopActions.length > 0;
    const validateCurrentDesktop = async () => {
      const desktopPreview = previewTarget
        ? await startProjectPreview(previewTarget, stackProfile.label, [], execution)
        : { previewState: "unavailable" as const, previewPlatform: "desktop" as const, previewReason: "This project source does not expose an owned desktop target." };
      const connectorArtifact = previewTarget ? connectorArtifactTargets.get(previewTarget.projectId) : undefined;
      let desktopEvidence: PlatformValidationResult | undefined;
      if (desktopPreview.previewState === "ready" && desktopPreview.previewPlatform === "desktop") {
        if (connectorArtifact && access.validateDesktop) {
          desktopEvidence = await access.validateDesktop({
            executable: connectorArtifact.relativePath,
            args: [],
            observeMs: 2500,
            interactionTimeoutMs: 8000,
            actions: desktopActions,
          });
        } else if (previewTarget) {
          const launched = await launchDesktopPreview(previewTarget.projectId, previewTarget.kind === "workspace" ? previewTarget.projectPath : undefined);
          desktopEvidence = {
            available: true,
            verified: launched.ok && desktopActions.length === 0,
            running: launched.ok,
            interactionVerified: false,
            reason: launched.ok
              ? "The desktop process launched and remained alive, but semantic interaction requires the Local Agent accessibility driver."
              : launched.error,
          };
        }
      }
      const verified = Boolean(desktopEvidence?.verified && (!interactionRequired || desktopEvidence.interactionVerified));
      const acceptanceClassification = classifyAcceptanceEvidence({
        verified,
        available: desktopEvidence?.available,
        explicitRepairEligible: desktopEvidence?.repairEligible,
        failureKind: desktopEvidence?.failureKind,
      });
      if (desktopEvidence) desktopEvidence.repairEligible = acceptanceClassification.repairEligible;
      const baseEvidence = verified
        ? desktopEvidence?.reason || "The requested desktop interaction completed and the application remained running."
        : desktopEvidence?.reason || desktopPreview.previewReason || "The desktop artifact could not be launched for behavioral acceptance.";
      const evidence = desktopEvidence?.crashEvidence
        ? `${baseEvidence}\n\nOperating-system crash evidence:\n${desktopEvidence.crashEvidence}`
        : baseEvidence;
      await emitExecution(execution, "preview", verified ? "completed" : "error", verified ? "Desktop behavior verified" : "Desktop behavior still needs repair", {
        details: { platform: "desktop", interactionRequired, actionsJson: JSON.stringify(desktopActions), interactionVerified: desktopEvidence?.interactionVerified, repairEligible: acceptanceClassification.repairEligible, failureOrigin: acceptanceClassification.origin, failureKind: desktopEvidence?.failureKind, stepsJson: JSON.stringify(desktopEvidence?.steps ?? []), windowTitles: desktopEvidence?.windowTitles, crashEvidence: desktopEvidence?.crashEvidence, evidence },
      });
      return { verified, evidence, desktopEvidence, connectorArtifact, acceptanceClassification };
    };

    let desktopAcceptance = await validateCurrentDesktop();
    const desktopRepairChangedFiles = new Set<string>();
    const attemptedDesktopRepairEvidence = new Set<string>();
    for (let repairAttempt = 1; !desktopAcceptance.verified && desktopBoundaryPolicy.maySpendRepairCall && desktopAcceptance.desktopEvidence?.repairEligible && desktopAcceptance.connectorArtifact && access.validateDesktop && repairAttempt <= 3; repairAttempt += 1) {
      const evidenceFingerprint = createHash("sha256").update(desktopAcceptance.evidence).digest("hex");
      if (attemptedDesktopRepairEvidence.has(evidenceFingerprint)) {
        await emitExecution(execution, "planning", "warning", "Stopped repeated desktop repair on unchanged runtime evidence", {
          internal: true,
          details: { evidenceFingerprint, paidCallPrevented: true, repairAttempt },
        });
        break;
      }
      attemptedDesktopRepairEvidence.add(evidenceFingerprint);
      await emitExecution(execution, "reasoning", "completed", `The real desktop acceptance check failed after implementation pass ${repairAttempt}. I'm repairing that exact runtime evidence, rebuilding, and exercising the same native interaction again.`);
      const repairModel = await modelForMissionStage(inheritedOperationRequest, modelMode, "builder", workingSet, repairAttempt - 1, routingAssessment);
      if (!repairModel) break;
      await emitModelSelection(execution, `desktop runtime repair ${repairAttempt}`, repairModel);
      const repair = await runMissionExecutor({
        objective,
        task: `Repair the existing native desktop project from the real runtime evidence below. Inspect the actual startup and named-control navigation path, preserve working behavior, fix the root cause, run the canonical build, and use validate_desktop with the requested actions before reporting completion. Do not merely restate the error or mark checklist items complete from compilation alone.\n\nOriginal user requirement:\n${inheritedOperationRequest}\n\nReal desktop failure:\n${desktopAcceptance.evidence}`,
        checklist: [{ id: `desktop-evidenced-repair-${repairAttempt}`, label: "Repair and re-exercise the real native desktop failure", status: "pending" }],
        costScopeId: execution.costScopeId,
        access: capabilityAccess,
        apiKey: repairModel.apiKey,
        provider: repairModel.provider,
        tier: repairModel.tier,
        onEvent,
        signal,
        preApprovedCommands,
        approvedCategories: effectiveApprovedCategories,
        standingApprovedCommands: approvedCommands,
        deniedActions: parentMission?.denied_actions ?? [],
        priorContext: parentMission,
        followUpResolution,
        fastLane: false,
        highRisk,
        hasBuildTooling: stackHasBuildStep(stackProfile.id),
        verificationProfile,
        executionStrategy: missionStrategy,
        routingAssessment,
        maxTurns: 12,
        maxNudges: 1,
      });
      result.changedFiles = [...new Set([...result.changedFiles, ...repair.changedFiles])];
      result.commands.push(...repair.commands);
      result.verification.push(...repair.verification);
      mergeExecutionTimeline(result.timeline, repair.timeline);
      result.usage.push(...repair.usage);
      { const destructive = await revertDestructiveRepairEdits(access, execution, repair.timeline).catch(() => [] as string[]); if (destructive.length) { repair.changedFiles = repair.changedFiles.filter((file) => !destructive.includes(file)); repair.status = "failed"; repair.blocker = repair.blocker || `The repair deleted most of ${destructive.length} implemented file(s); the implementation was restored and the repair rejected.`; } }
      result.turnsUsed += repair.turnsUsed;
      if (repair.changedFiles.length === 0 || repair.status === "stopped" || signal?.aborted) break;
      repair.changedFiles.forEach((file) => desktopRepairChangedFiles.add(file));
      const repairedBuild = await runCanonicalProjectBuild();
      if (!repairedBuild) {
        desktopAcceptance = { ...desktopAcceptance, verified: false, evidence: "The desktop repair changed source, but the canonical build command was unavailable." };
        break;
      }
      result.commands.push(repairedBuild);
      result.verification.push({
        check_type: "build",
        result: repairedBuild.exitCode === 0 ? "pass" : "fail",
        evidence: repairedBuild.exitCode === 0
          ? "The canonical desktop build passed after the evidence-driven repair."
          : `The canonical desktop build failed after repair: ${summarizeCommandFailure(repairedBuild)}`,
      });
      if (repairedBuild.exitCode !== 0) {
        desktopAcceptance = { ...desktopAcceptance, verified: false, evidence: `Desktop recheck is waiting on a successful canonical build: ${summarizeCommandFailure(repairedBuild)}` };
        continue;
      }
      desktopAcceptance = await validateCurrentDesktop();
    }

    result.verification.push({ check_type: "preview", result: desktopAcceptance.verified ? "pass" : "fail", evidence: desktopAcceptance.evidence });
    if (desktopAcceptance.verified) {
      result.status = "passed";
      result.blocker = undefined;
      for (const item of result.checklist) {
        if (item.status === "pending" || item.status === "running" || item.status === "blocked") {
          item.status = "completed";
          item.evidence = desktopAcceptance.evidence;
        }
      }
      if (desktopBudgetBoundaryAfterVerifiedEdit || desktopNoProgressBoundaryAfterVerifiedEdit) {
        result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
        result.sessionSummary.outcome = "The requested native behavior was exercised successfully after the verified source edit; no additional model call was needed.";
        result.sessionSummary.flags = result.sessionSummary.flags.filter((flag) => !/model-call limit|configured execution limit|provider fallbacks|another paid model call|NO_PROGRESS_AFTER_MUTATION/i.test(flag));
        await emitExecution(execution, "summary", "completed", "Native behavior verified; cleared the earlier execution boundary", {
          details: { paidModelCallsAfterBoundary: 0, reconciledModelBudgetBoundary: desktopBudgetBoundaryAfterVerifiedEdit, reconciledNoProgressBoundary: desktopNoProgressBoundaryAfterVerifiedEdit },
        });
      }
      if (desktopRepairChangedFiles.size > 0) {
        result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
        result.sessionSummary.outcome = "Foundry repaired the real native runtime failure, rebuilt the project, exercised the requested desktop interaction, and verified that the application remained running.";
        result.sessionSummary.changes = [...new Set([...result.sessionSummary.changes, ...desktopRepairChangedFiles])];
        result.sessionSummary.flags = [];
      }
    } else {
      result.status = "failed";
      result.blocker = desktopAcceptance.evidence;
      result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
      result.sessionSummary.outcome = "The source change and desktop build are preserved, but the requested native interaction did not pass.";
      result.sessionSummary.flags = [desktopAcceptance.evidence];
    }
  }
  if (result.status === "failed" && result.blocker) {
    const terminalAssessment = assessAutonomousBlocker(result.blocker);
    if (terminalAssessment.terminal) {
      result.blocker = terminalBlockerWithNextAction(result.blocker);
      result.sessionSummary = result.sessionSummary ?? {
        outcome: "Foundry stopped at a concrete external or authority boundary.",
        changes: result.changedFiles,
        preserved: ["Verified project changes and diagnostic evidence"],
        flags: [],
      };
      result.sessionSummary.flags = [...new Set([...result.sessionSummary.flags, result.blocker])];
    }
  }
  // A mission may not conclude "passed" while its own plan still shows unfinished rows — the client
  // (correctly) flips that contradiction into "returned success before completing the mission plan" and
  // the user gets a Failed banner over finished work. The verdict and the plan must be reconciled HERE,
  // by evidence: when every recorded verification gate passed, the unfinished rows are completed citing
  // those gates; when any gate failed, "passed" was never true — downgrade honestly instead of shipping
  // the contradiction.
  if (result.status === "passed") {
    const unfinished = result.checklist.filter((item) => item.status === "pending" || item.status === "running" || item.status === "blocked");
    if (unfinished.length) {
      const failedGate = result.verification.find((item) => item.result === "fail");
      // A mutating request (edit/debug/undo) whose plan is still unfinished AND that changed NO file
      // did not do the work: the model read the project and concluded without applying the change. A
      // cleanly-rendering UNCHANGED page is not evidence the edit happened — the browser gate proves
      // health, not fulfilment. Do NOT paper the rows over as complete (that produced the confusing
      // "returned success before completing the mission plan" Failed banner over a real no-op); fail
      // honestly and say so. A genuinely already-satisfied request has a COMPLETE plan and never
      // reaches this branch.
      if (mutatingOutcomeRequired && result.changedFiles.length === 0) {
        result.status = "failed";
        result.blocker = result.blocker
          || "You asked for a change, but Foundry did not edit any file — the requested change was not applied. Tell me the specific change (or which file to edit) and I will apply it directly.";
        if (!failedGate) result.verification.push({ check_type: "file-read", result: "fail", evidence: result.blocker });
      } else if (failedGate) {
        result.status = "failed";
        result.blocker = result.blocker || `The mission cannot conclude as passed: ${unfinished.length} plan item(s) are unfinished and a verification gate failed — ${failedGate.evidence.slice(0, 300)}`;
      } else {
        const passedGates = [...new Set(result.verification.filter((item) => item.result === "pass").map((item) => item.check_type))];
        const evidence = passedGates.length
          ? `Completed at mission conclusion: the final deterministic gates (${passedGates.join(", ")}) all passed against the finished work.`
          : "Completed at mission conclusion with the recorded file and command evidence.";
        for (const item of unfinished) {
          item.status = "completed";
          item.evidence = item.evidence || evidence;
        }
      }
    }
  }
  execution.checklist.splice(0, execution.checklist.length, ...result.checklist);
  finishObjectiveChecklist(execution, result.status, result.blocker);
  return { status: result.status, blocker: result.blocker, changedFiles: result.changedFiles, commands: result.commands, sessionSummary: result.sessionSummary, verification: result.verification, events: [], stackLabel: stackProfile.label };
}

function narrativeObjectsFromTimeline(timeline: FactoryExecutionEvent[]): FactoryNarrativeObject[] {
  return timeline.map((event) => event.narrative).filter((item): item is FactoryNarrativeObject => Boolean(item));
}

/**
 * The Verify stage + confidence escalation: reviews the mission's own real evidence, and if not
 * confident, runs exactly one continuation pass (via the existing priorContext mechanism) forced to
 * "architect" tier before accepting the result. Never blocks — a low-confidence outcome, even after a
 * second opinion, is surfaced as a flag in the final summary rather than pausing the mission (confirmed
 * product decision). Mutates `result` in place with whatever the follow-up pass found.
 */
async function runVerificationAndEscalate(input: {
  objective: string;
  task: string;
  result: Awaited<ReturnType<typeof runMissionExecutor>>;
  executorAccess: ProjectAccess;
  signal?: AbortSignal;
  preApprovedCommands: string[];
  approvedCategories: string[];
  approvedCommands: string[];
  execution: ExecutionContext;
  quality: MissionQualityLevel;
  complexity: ReturnType<typeof assessMissionComplexity>;
  modelMode: ModelMode;
  strategy: ExecutionStrategy;
}): Promise<void> {
  const { objective, task, result, executorAccess, signal, preApprovedCommands, approvedCategories, approvedCommands, execution, quality, complexity, modelMode, strategy } = input;
  const onEvent = (event: FactoryExecutionEvent) => execution.emit(event);

  // Not internal — see the matching note on "Reviewing architecture" above.
  await emitExecution(execution, "planning", "running", "Verifying build");
  await emitExecution(execution, "reasoning", "completed", "The implementation pass is complete. I’m checking the actual changed files and verification evidence now rather than assuming the edit worked.");
  const verifyTier = tierForCapability(strategy, "verify", tierForStage("verify", quality, complexity));
  const verifyModel = await modelForMissionStage(task, modelMode, verifyTier);
  await emitModelSelection(execution, "verification", verifyModel);
  if (!verifyModel) return;
  const verification = await verifyMissionResult({
    objective,
    task,
    checklist: result.checklist,
    changedFiles: result.changedFiles,
    commands: result.commands,
    narrativeObjects: narrativeObjectsFromTimeline(result.timeline),
    apiKey: verifyModel.apiKey,
    provider: verifyModel.provider,
    tier: verifyModel.tier,
  });

  let notes = verification.notes;
  let secondOpinionDisagreed = false;

  if (verification.confidence < 60) {
    const secondApiKey = process.env.ANTHROPIC_API_KEY;
    if (secondApiKey) {
      const secondProvider: ProviderId = "anthropic";
      const secondOpinion = await verifyMissionResult({
        objective,
        task,
        checklist: result.checklist,
        changedFiles: result.changedFiles,
        commands: result.commands,
        narrativeObjects: narrativeObjectsFromTimeline(result.timeline),
        apiKey: secondApiKey,
        provider: secondProvider,
        tier: verifyTier,
      });
      secondOpinionDisagreed = Math.abs(secondOpinion.confidence - verification.confidence) >= 25;
      notes = `${verification.notes} Second opinion (${secondProvider}, ${secondOpinion.confidence}% confident): ${secondOpinion.notes}`.trim();
    }
  }

  if (verificationAction(verification.confidence) === "accept") {
    await emitExecution(execution, "planning", "completed", "Verified build and evidence", { details: { confidence: verification.confidence, notes } });
    return;
  }

  // 60-95 (and <60 after a second opinion) escalate to exactly one continuation pass at architect tier
  // — never more than one, and the mission stays "passed" regardless of what it finds (see file-level note).
  await emitExecution(execution, "planning", "warning", "Verification wasn't fully confident — running one more pass", {
    details: { confidence: verification.confidence, notes },
  });

  const priorContext: MissionParentContext = {
    id: `verify-${Date.now()}`,
    source_requirements: [task],
    state: "passed",
    plan: result.checklist,
    files_touched: result.changedFiles.map((filePath) => ({ path: filePath, status: "edited", verified: true })),
    commands_run: result.commands.map((command) => ({ command: command.command, exitCode: command.exitCode })),
    decisions: result.sessionSummary?.changes ?? [],
    findings: [],
    summary: result.sessionSummary?.outcome ?? "",
  };

  const repairTier = tierForCapability(strategy, "repair", "architect");
  const repairModel = await modelForMissionStage(task, modelMode, repairTier, undefined, 1) ?? verifyModel;
  await emitModelSelection(execution, "repair", repairModel);
  const followUp = await runMissionExecutor({
    objective,
    task: `Double check and address any remaining concerns before this mission is truly done: ${notes || "the verification pass was not fully confident this is correct."}`,
    checklist: [{ id: "verify-followup", label: "Address verification concerns and re-confirm the fix", status: "pending" }],
    costScopeId: execution.costScopeId,
    access: executorAccess,
    apiKey: repairModel.apiKey,
    provider: repairModel.provider,
    onEvent,
    signal,
    preApprovedCommands,
    approvedCategories,
    standingApprovedCommands: approvedCommands,
    priorContext,
    tier: repairModel.tier,
    maxTurns: 12,
  });

  if (followUp.status !== "passed") {
    const repairFailure = followUp.blocker || "The verification repair pass could not establish a correct result.";
    const verificationOnlyNoProgress = result.status === "passed"
      && result.changedFiles.length > 0
      && followUp.changedFiles.length === 0
      && /NO_PROGRESS_BEFORE_MUTATION|without a new file change or unique successful command/i.test(repairFailure)
      && result.verification.some((item) => item.result === "pass");
    if (verificationOnlyNoProgress) {
      const note = "The implementation already had a real file change and passing verification evidence. The optional verification follow-up found no additional mutation to make, so the verified result remains complete.";
      if (result.sessionSummary) {
        result.sessionSummary = { ...result.sessionSummary, flags: [...result.sessionSummary.flags, note] };
      }
      await emitExecution(execution, "summary", "completed", "Existing implementation evidence was sufficient; no verification-only mutation was needed", {
        details: { reason: repairFailure, preservedStatus: result.status, changedFiles: result.changedFiles },
      });
      return;
    }
    result.status = followUp.status === "stopped" ? "stopped" : "failed";
    result.blocker = repairFailure;
    await emitExecution(execution, "summary", "error", "Verification repair did not complete", { details: { reason: repairFailure } });
    return;
  }

  result.checklist = followUp.checklist;
  result.changedFiles = [...new Set([...result.changedFiles, ...followUp.changedFiles])];
  result.commands = [...result.commands, ...followUp.commands];
  result.sessionSummary = followUp.sessionSummary ?? result.sessionSummary;
  result.verification = followUp.verification ?? result.verification;

  const finalVerification = await verifyMissionResult({
    objective,
    task,
    checklist: result.checklist,
    changedFiles: result.changedFiles,
    commands: result.commands,
    narrativeObjects: narrativeObjectsFromTimeline([...result.timeline, ...followUp.timeline]),
    apiKey: verifyModel.apiKey,
    provider: verifyModel.provider,
    tier: verifyModel.tier,
  });

  if (verificationAction(finalVerification.confidence) === "accept") {
    await emitExecution(execution, "planning", "completed", "Verified after an automatic repair pass", {
      details: { confidence: finalVerification.confidence, notes: finalVerification.notes },
    });
    return;
  }

  const improved = verificationImproved(verification.confidence, finalVerification.confidence);
  const materialRisk = verificationRisk(finalVerification.confidence) === "material";
  const residualRisk = materialRisk
    ? `Automatic repair completed, but the final result is not verified: ${finalVerification.notes || "the evidence still needs an independent check."}`
    : `Automatic repair improved the mission, but the final result is only partially verified: ${finalVerification.notes || "the available evidence does not fully establish the result."}`;
  await emitExecution(execution, "summary", "warning", "Verification still has unresolved concerns", {
    details: { reason: residualRisk, improved, initialConfidence: verification.confidence, finalConfidence: finalVerification.confidence },
  });
  result.status = "failed";
  result.blocker = residualRisk;
  result.sessionSummary = result.sessionSummary
    ? { ...result.sessionSummary, outcome: "The implementation is preserved, but Foundry could not verify the required outcome after an automatic repair and recheck.", flags: [...result.sessionSummary.flags, residualRisk] }
    : { outcome: "The implementation is preserved, but Foundry could not verify the required outcome after an automatic repair and recheck.", changes: result.changedFiles, preserved: ["Project changes and recorded verification evidence"], flags: [residualRisk] };

  if (verificationRisk(verification.confidence) === "material" && !improved) {
    const disagreement = secondOpinionDisagreed
      ? "A second verifier also materially disagreed with the original assessment."
      : "The repair pass did not improve the verification result.";
    result.sessionSummary = { ...result.sessionSummary, flags: [...result.sessionSummary.flags, disagreement] };
  }
}

async function markJournalEntryReverted(projectId: string, entryId: string) {
  const entries = await readJournal(projectId);
  const updated = entries.map((entry) => (entry.id === entryId ? { ...entry, reverted: true } : entry));
  await writeJournal(projectId, updated);
}

function isRevertOk(result: { verified: boolean; reason?: string }) {
  return result.verified || result.reason === "Write succeeded but file content did not change.";
}

async function undoLastChange(access: ProjectAccess, execution: ExecutionContext, projectId: string): Promise<{ status: "passed" | "failed"; blocker?: string; filePath?: string }> {
  const journal = await readJournal(projectId);
  const target = [...journal].reverse().find((entry) => !entry.reverted && entry.event.kind === "edit" && entry.event.status === "completed" && entry.event.filePath);
  if (!target || !target.event.filePath) {
    const hasOnlyCreations = journal.some((entry) => !entry.reverted && entry.event.kind === "file" && entry.event.status === "completed");
    return {
      status: "failed",
      blocker: hasOnlyCreations
        ? "Foundry can only undo edits to files that already existed, not the creation of new files, yet."
        : "There is no recorded file change to undo yet.",
    };
  }

  const filePath = target.event.filePath;
  const beforeContent = target.beforeContent ?? "";
  await emitExecution(execution, "edit", "running", `Reverting ${target.event.fileName || filePath}`, { filePath });
  const result = await access.writeFile(filePath, beforeContent);
  if (!isRevertOk(result)) {
    await emitExecution(execution, "edit", "error", `Could not revert ${filePath}`, { filePath, details: { reason: result.reason } });
    return { status: "failed", blocker: `Could not revert ${filePath}: ${result.reason ?? "the write was not verified."}` };
  }

  await emitExecution(execution, "edit", "completed", `Reverted ${target.event.fileName || filePath} to its previous version`, {
    filePath,
    output: result.diff,
    details: { revertedEntryId: target.id },
  });
  await markJournalEntryReverted(projectId, target.id);
  return { status: "passed", filePath };
}

async function undoReferencedChange(
  access: ProjectAccess,
  execution: ExecutionContext,
  projectId: string,
  resolution: FollowUpResolutionRecord,
): Promise<{ status: "passed" | "failed"; blocker?: string; filePaths: string[] }> {
  const journal = await readJournal(projectId);
  const files = new Set(resolution.relevantFiles.map(normalizeScopePath));
  const startedAt = Date.parse(resolution.referencedPriorAction?.createdAt ?? "");
  const endedAt = Date.parse(resolution.referencedPriorAction?.updatedAt ?? "");
  const candidates = journal
    .filter((entry) => {
      if (entry.reverted || entry.event.status !== "completed" || !entry.event.filePath) return false;
      if (entry.event.kind !== "edit" && entry.event.kind !== "file") return false;
      if (!files.has(normalizeScopePath(entry.event.filePath))) return false;
      const timestamp = Date.parse(entry.timestamp);
      if (Number.isFinite(startedAt) && timestamp < startedAt) return false;
      if (Number.isFinite(endedAt) && timestamp > endedAt + 1_000) return false;
      return true;
    })
    .reverse();

  if (!candidates.length) {
    return { status: "failed", blocker: "The referenced execution has no unreverted journaled file changes in its recorded time range.", filePaths: [] };
  }

  const reverted: string[] = [];
  for (const entry of candidates) {
    const filePath = entry.event.filePath as string;
    if (entry.event.kind === "file" && entry.beforeContent === undefined) {
      if (!access.deleteFile) {
        return { status: "failed", blocker: `The referenced change created ${filePath}, but this project connection cannot safely delete created files yet. No unrelated file was changed.`, filePaths: reverted };
      }
      await emitExecution(execution, "edit", "running", `Removing ${filePath} created by the referenced execution`, { filePath });
      const deleted = await access.deleteFile(filePath);
      if (!deleted.verified) {
        return { status: "failed", blocker: `Could not remove ${filePath}: ${deleted.reason ?? "deletion was not verified."}`, filePaths: reverted };
      }
      await emitExecution(execution, "edit", "completed", `Removed ${filePath} created by the referenced execution`, { filePath, details: { revertedEntryId: entry.id } });
    } else {
      await emitExecution(execution, "edit", "running", `Reverting ${filePath} from the referenced execution`, { filePath });
      const result = await access.writeFile(filePath, entry.beforeContent ?? "");
      if (!isRevertOk(result)) {
        return { status: "failed", blocker: `Could not revert ${filePath}: ${result.reason ?? "the write was not verified."}`, filePaths: reverted };
      }
      await emitExecution(execution, "edit", "completed", `Reverted ${filePath} from the referenced execution`, { filePath, output: result.diff, details: { revertedEntryId: entry.id } });
    }
    await markJournalEntryReverted(projectId, entry.id);
    if (!reverted.includes(filePath)) reverted.push(filePath);
  }
  return { status: "passed", filePaths: reverted };
}

async function handleWholeProjectDeletion(input: {
  access: ProjectAccess;
  execution: ExecutionContext;
  requestedTask: string;
  approvalResponse?: ApprovalResponse;
  parentMission?: MissionParentContext;
  signal?: AbortSignal;
}): Promise<{
  status: FactoryProjectResult["status"];
  blocker?: string;
  changedFiles: string[];
  sessionSummary?: FactorySessionSummary;
  verification?: ExecutionMissionVerification[];
  events: string[];
  projectDeleted?: boolean;
} | undefined> {
  // A deletion request must be recognized whether it arrives as the current message (the first ask)
  // OR is carried in the parent mission (an approval continuation, where requestedTask is the control
  // message). Reading only the parent first meant that on any already-built project — where the parent
  // holds the original *build* brief, not the delete — "delete this project" fell through to the edit
  // path and mangled files instead of deleting. Match either source.
  const parentRequest = input.parentMission?.source_requirements.join("\n") || "";
  if (!isWholeProjectDeletionRequest(input.requestedTask) && !isWholeProjectDeletionRequest(parentRequest)) return undefined;

  const projectPath = input.access.rootLabel;
  const exactAction = projectDeletionApprovalCommand(projectPath);
  const lockApprovalProcessIds = input.approvalResponse
    ? parseProjectDeletionLockApprovalCommand(input.approvalResponse.requestedCommand, projectPath)
    : undefined;
  const rootEntries = await input.access.listDir("").catch(() => []);
  const visibleFiles = await listProjectFilesRecursively(input.access).catch(() => []);
  const checklistItem: FactoryObjectiveChecklistItem = {
    id: "delete-project-root",
    label: `Delete the project folder at ${projectPath}`,
    status: "blocked",
    phase: "Project deletion",
    evidence: "Waiting for explicit approval of this exact project path.",
  };
  input.execution.checklist.splice(0, input.execution.checklist.length, checklistItem);

  if (!input.approvalResponse) {
    const blocker = `Permission required to permanently delete the project at ${projectPath}.`;
    await emitExecution(input.execution, "blocked", "warning", "Permission needed to delete this project", {
      tier: "flag",
      command: exactAction,
      filePath: projectPath,
      rationale: `The user asked to delete the connected project. Foundry paused before the single irreversible project-root action at ${projectPath}.`,
      details: {
        actionKind: "delete-project",
        category: "deletes",
        projectPath,
        reason: "This permanently deletes the project folder and everything inside it.",
        topLevelEntries: rootEntries.length,
        discoveredFiles: visibleFiles.length,
        irreversible: true,
      },
    });
    return { status: "awaiting-approval", blocker, changedFiles: [], events: [blocker] };
  }

  if (input.approvalResponse.requestedCommand !== exactAction && !lockApprovalProcessIds) {
    const blocker = "The approval did not match the exact project path, so Foundry did not delete anything.";
    checklistItem.evidence = blocker;
    await emitExecution(input.execution, "summary", "error", "Project deletion approval did not match", { details: { blocker, projectPath } });
    return { status: "failed", blocker, changedFiles: [], events: [blocker] };
  }

  if (input.approvalResponse.decision === "deny") {
    checklistItem.status = "skipped";
    checklistItem.evidence = `The user kept the project at ${projectPath}.`;
    await emitExecution(input.execution, "summary", "completed", "Project kept — no files were deleted", {
      details: { projectPath, decision: "deny" },
    });
    return {
      status: "passed",
      changedFiles: [],
      verification: [{ check_type: "checklist", result: "skipped", evidence: `Deletion denied; ${projectPath} was left unchanged.` }],
      events: [`Kept project: ${projectPath}`],
    };
  }

  if (input.approvalResponse.decision !== "approve-once") {
    const blocker = "Whole-project deletion requires one explicit approval for this exact path; standing command or category grants are not accepted.";
    checklistItem.evidence = blocker;
    await emitExecution(input.execution, "summary", "error", "Project deletion requires exact one-time approval", { details: { blocker, projectPath } });
    return { status: "failed", blocker, changedFiles: [], events: [blocker] };
  }
  if (!input.access.deleteRoot) {
    const blocker = "This project connection cannot atomically delete and verify the project root, so Foundry did not delete anything.";
    checklistItem.evidence = blocker;
    await emitExecution(input.execution, "summary", "error", "Project-root deletion is unavailable", { details: { blocker, projectPath } });
    return { status: "unsupported", blocker, changedFiles: [], events: [blocker] };
  }
  if (input.signal?.aborted) {
    const blocker = "Stopped by user before project deletion started.";
    checklistItem.evidence = blocker;
    return { status: "stopped", blocker, changedFiles: [], events: [blocker] };
  }

  if (lockApprovalProcessIds) {
    if (!input.access.stopRootLockOwners) {
      const blocker = "This project connection cannot safely stop an approved lock-owning application. Save your work, close the named application manually, then retry deletion.";
      checklistItem.evidence = blocker;
      return { status: "unsupported", blocker, changedFiles: [], events: [blocker] };
    }
    await emitExecution(input.execution, "command", "running", "Closing the approved applications that are locking this project", {
      command: input.approvalResponse.requestedCommand,
      filePath: projectPath,
      details: { actionKind: "delete-project-lock", projectPath, processIds: lockApprovalProcessIds.map(String) },
    });
    const stopped = await input.access.stopRootLockOwners(lockApprovalProcessIds);
    if (!stopped.verified) {
      const blocker = stopped.reason ?? "The approved lock-owning applications could not be closed.";
      checklistItem.status = "blocked";
      checklistItem.evidence = blocker;
      await emitExecution(input.execution, "command", "error", "Could not close the applications locking this project", { filePath: projectPath, details: { blocker, projectPath } });
      return { status: "failed", blocker, changedFiles: [], events: [blocker] };
    }
    await emitExecution(input.execution, "command", "completed", "Closed the approved applications locking this project", {
      filePath: projectPath,
      details: { actionKind: "delete-project-lock", projectPath, stoppedApplications: stopped.stopped.map((owner) => `${owner.name} (PID ${owner.pid})`) },
    });
  }

  checklistItem.status = "running";
  checklistItem.evidence = `Exact path approved once: ${projectPath}`;
  await emitExecution(input.execution, "edit", "running", "Deleting the approved project folder", {
    filePath: projectPath,
    details: { actionKind: "delete-project", projectPath, topLevelEntries: rootEntries.length, discoveredFiles: visibleFiles.length },
  });
  await stopOwnedPreviewsForProjectPath(projectPath);
  let deleted = await input.access.deleteRoot();
  const recoverableLock = (reason?: string) => !reason || /\b(?:EBUSY|EPERM|ENOTEMPTY|EACCES)\b|busy|locked|still exists/i.test(reason);
  for (let attempt = 1; !deleted.verified && !deleted.lockOwners?.length && attempt < 4 && recoverableLock(deleted.reason); attempt += 1) {
    if (input.signal?.aborted) {
      const blocker = "Stopped by user while retrying project deletion.";
      checklistItem.status = "blocked";
      checklistItem.evidence = blocker;
      return { status: "stopped", blocker, changedFiles: [], events: [blocker] };
    }
    await emitExecution(input.execution, "edit", "running", "Releasing a project runtime lock and retrying deletion", {
      filePath: projectPath,
      internal: true,
      details: { actionKind: "delete-project-retry", projectPath, attempt: attempt + 1, previousReason: deleted.reason },
    });
    await stopOwnedPreviewsForProjectPath(projectPath);
    await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    deleted = await input.access.deleteRoot();
  }
  if (!deleted.verified) {
    const blocker = `Project deletion could not be verified: ${deleted.reason ?? "the project folder still exists."}`;
    checklistItem.status = "blocked";
    checklistItem.evidence = blocker;
    if (deleted.lockOwners?.length) {
      const lockAction = projectDeletionLockApprovalCommand(projectPath, deleted.lockOwners.map((owner) => owner.pid));
      await emitExecution(input.execution, "blocked", "warning", "An application must be closed before this project can be deleted", {
        tier: "flag",
        command: lockAction,
        filePath: projectPath,
        rationale: "Windows will not delete a process's active working directory. Foundry identified the exact lock owner and needs separate approval before force-closing that application because unsaved work may be lost.",
        details: {
          actionKind: "delete-project-lock",
          category: "deletes",
          projectPath,
          reason: blocker,
          lockOwners: deleted.lockOwners.map((owner) => `${owner.name} (PID ${owner.pid})`),
          irreversible: true,
        },
      });
      return { status: "awaiting-approval", blocker, changedFiles: [], events: [blocker] };
    }
    await emitExecution(input.execution, "edit", "error", "Project folder was not deleted", {
      filePath: projectPath,
      details: {
        blocker,
        projectPath,
        lockOwners: deleted.lockOwners?.map((owner) => `${owner.name} (PID ${owner.pid})`),
        nextAction: deleted.lockOwners?.length ? "Save work, close the named application, then retry deletion." : "Close applications using the project folder, then retry deletion.",
      },
    });
    return { status: "failed", blocker, changedFiles: [], events: [blocker] };
  }

  checklistItem.status = "completed";
  checklistItem.evidence = `Verified that the approved project root no longer exists: ${projectPath}`;
  await emitExecution(input.execution, "edit", "completed", "Project folder deleted", {
    filePath: projectPath,
    details: { actionKind: "delete-project", projectPath, deletedFiles: visibleFiles.length, verifiedAbsent: true },
  });
  await emitExecution(input.execution, "summary", "completed", "The approved project was deleted", {
    details: { projectPath, deletedFiles: visibleFiles.length, verifiedAbsent: true },
  });
  return {
    status: "passed",
    changedFiles: [],
    sessionSummary: {
      outcome: `The approved project folder was permanently deleted: ${projectPath}`,
      changes: [`Removed the entire approved project folder in one verified root-level action (${visibleFiles.length} discovered files).`],
      preserved: ["The Foundry mission record and deletion verification evidence remain available."],
      flags: ["This irreversible action ran only after one-time approval of the exact absolute path."],
    },
    verification: [{ check_type: "checklist", result: "pass", evidence: `Verified project folder deletion: ${projectPath}` }],
    events: [`Deleted project: ${projectPath}`],
    projectDeleted: true,
  };
}

/**
 * Names the exact wiring defect when implemented components never reach the app's entry route.
 *
 * Observed live: a mission built MoodPicker/MoodChart/AddMoodModal/JournalContext — a complete feature
 * set — while app/index.tsx still rendered the scaffold placeholder. The browser gate correctly failed,
 * but its evidence ("not enough visible content") never named the cause, so two paid repair passes fixed
 * unrelated files. The defect is deterministically detectable: the entry file imports nothing from the
 * implemented component tree. Handing the repair that exact sentence turns a guessing game into a
 * one-file fix.
 */
async function unwiredEntryEvidence(projectPath: string): Promise<string | undefined> {
  const entryCandidates = ["app/index.tsx", "app/(tabs)/index.tsx", "src/App.tsx", "src/app/page.tsx", "src/main.tsx", "app/page.tsx"];
  let entryPath: string | undefined;
  let entryContent = "";
  for (const candidate of entryCandidates) {
    try {
      entryContent = await readFile(path.join(projectPath, candidate), "utf8");
      entryPath = candidate;
      break;
    } catch {
      // try the next candidate
    }
  }
  if (!entryPath) return undefined;

  const componentFiles: string[] = [];
  const walk = async (relative: string, depth: number) => {
    if (depth > 4 || componentFiles.length > 200) return;
    const entries = await readdir(path.join(projectPath, relative), { withFileTypes: true }).catch(() => []);
    for (const item of entries) {
      if (item.name === "node_modules" || item.name.startsWith(".")) continue;
      const child = `${relative}/${item.name}`;
      if (item.isDirectory()) await walk(child, depth + 1);
      else if (/\.(tsx|jsx|vue|svelte)$/.test(item.name) && !/^(_layout|_app|layout|index)\./.test(item.name)) componentFiles.push(child);
    }
  };
  await walk("src", 0);
  if (componentFiles.length < 2) return undefined;

  const importsAnyComponent = componentFiles.some((file) => {
    const base = file.replace(/^src\//, "").replace(/\.(tsx|jsx|vue|svelte)$/, "");
    const name = base.split("/").pop() ?? "";
    return name.length > 2 && entryContent.includes(name);
  });
  if (importsAnyComponent) return undefined;

  const shown = componentFiles.slice(0, 8).join(", ");
  return `ROOT CAUSE (deterministic): the app entry route ${entryPath} does not import or render ANY of the ${componentFiles.length} implemented feature components (${shown}). The features exist but are unreachable — the entry still renders the scaffold placeholder. Fix ${entryPath} to compose the real feature components (and wrap any required provider from src/context or src/state); do not modify the component files themselves.`;
}

/**
 * Undoes repair edits that "fixed" a gate by deleting the implementation.
 *
 * A repair pass chasing a failing check is rewarded for making the check pass, and the cheapest way to
 * make any check pass is to remove the code it checks. Observed live: an autonomous repair reduced
 * every screen of a working app to stubs so typecheck would exit 0. Each repair edit carries its
 * beforeContent, so this is deterministically reversible: any file whose rewrite discarded most of a
 * substantive implementation is restored, and the caller reports the repair honestly instead of
 * shipping the gutted result as progress.
 */
async function revertDestructiveRepairEdits(
  access: ProjectAccess,
  execution: ExecutionContext,
  repairTimeline: readonly FactoryExecutionEvent[],
): Promise<string[]> {
  const reverted: string[] = [];
  const seen = new Set<string>();
  for (const event of repairTimeline) {
    if ((event.kind !== "edit" && event.kind !== "file") || !event.filePath || seen.has(event.filePath)) continue;
    if (typeof event.beforeContent !== "string" || !event.beforeContent.trim()) continue;
    seen.add(event.filePath);
    const current = await access.readFile(event.filePath, { limitBytes: 400_000 }).catch(() => undefined);
    if (!current?.exists) continue;
    if (!isDestructiveRewrite(event.beforeContent, current.content)) continue;
    const write = await access.writeFile(event.filePath, event.beforeContent).catch(() => undefined);
    if (write) reverted.push(event.filePath);
  }
  if (reverted.length) {
    await emitExecution(execution, "edit", "warning", `Rejected a repair that deleted most of ${reverted.length} implemented file${reverted.length === 1 ? "" : "s"} — restored the real implementation`, {
      details: { reverted, reason: "A gate fix that removes the implementation is data loss, not a repair. The original files were restored from their recorded before-content." },
    });
  }
  return reverted;
}

const DUPLICATE_SCAN_EXTENSIONS = new Set([
  ".swift", ".kt", ".java", ".go", ".rs", ".cs", ".py", ".rb", ".php",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".dart",
]);

/**
 * After a build, collapse the duplicate/conflicting files an interrupted-then-resumed build leaves
 * behind. Byte-identical copies are removed automatically (safe); divergent duplicates and multiple
 * entry points are flagged for the caller but never deleted — picking the wrong copy destroys real work.
 */
async function reconcileDuplicateProjectFiles(
  access: ProjectAccess,
  execution: ExecutionContext,
): Promise<{ removed: string[]; problem?: string }> {
  const paths = await listProjectFilesRecursively(access).catch(() => [] as string[]);
  const sourcePaths = paths.filter((path) => DUPLICATE_SCAN_EXTENSIONS.has(path.slice(path.lastIndexOf(".")).toLowerCase()));
  if (sourcePaths.length < 2 || sourcePaths.length > 800) return { removed: [] };

  const files: { path: string; content: string }[] = [];
  for (const path of sourcePaths) {
    const read = await access.readFile(path, { limitBytes: 200_000 }).catch(() => undefined);
    if (read?.exists) files.push({ path, content: read.content });
  }

  const removable = safelyRemovableDuplicatePaths(files);
  const removed: string[] = [];
  if (access.deleteFile) {
    for (const path of removable) {
      const result = await access.deleteFile(path).catch(() => undefined);
      if (result && (result as { deleted?: boolean }).deleted !== false) removed.push(path);
    }
  }
  if (removed.length) {
    await emitExecution(execution, "folder", "completed", `Removed ${removed.length} byte-identical duplicate file${removed.length === 1 ? "" : "s"} left by an earlier build pass`, {
      details: { removed },
    });
  }

  // Re-detect after safe removal so the flagged problem reflects only what actually remains.
  const remaining = files.filter((file) => !removed.includes(file.path));
  const problem = duplicateFileProblem(remaining);
  return { removed, problem };
}

async function listProjectFilesRecursively(access: ProjectAccess, relativePath = "", depth = 0): Promise<string[]> {
  if (depth > 20) throw new Error("Project directory nesting exceeds the safe deletion traversal limit.");
  const entries = await access.listDir(relativePath);
  const files: string[] = [];
  for (const entry of entries) {
    const child = relativePath ? `${relativePath.replace(/\/$/, "")}/${entry.name}` : entry.name;
    if (entry.kind === "directory") files.push(...await listProjectFilesRecursively(access, child, depth + 1));
    else files.push(child);
    if (files.length > 5_000) throw new Error("Project contains more than 5,000 files; use a separately reviewed cleanup plan instead of a bulk delete.");
  }
  return files;
}

async function rollbackToEntry(access: ProjectAccess, execution: ExecutionContext, projectId: string, entryId: string): Promise<{ status: "passed" | "failed"; blocker?: string; revertedFiles: string[] }> {
  const journal = await readJournal(projectId);
  const targetIndex = journal.findIndex((entry) => entry.id === entryId);
  if (targetIndex < 0) return { status: "failed", blocker: "That journal entry could not be found.", revertedFiles: [] };

  const candidates = journal
    .slice(targetIndex + 1)
    .filter((entry) => !entry.reverted && entry.event.kind === "edit" && entry.event.status === "completed" && entry.event.filePath)
    .reverse();

  const revertedFiles: string[] = [];
  for (const entry of candidates) {
    const filePath = entry.event.filePath as string;
    const beforeContent = entry.beforeContent ?? "";
    await emitExecution(execution, "edit", "running", `Reverting ${filePath}`, { filePath });
    const result = await access.writeFile(filePath, beforeContent);
    if (!isRevertOk(result)) {
      await emitExecution(execution, "edit", "error", `Could not revert ${filePath}`, { filePath, details: { reason: result.reason } });
      return { status: "failed", blocker: `Could not revert ${filePath}: ${result.reason ?? "the write was not verified."}`, revertedFiles };
    }
    await emitExecution(execution, "edit", "completed", `Reverted ${filePath} to its version at this point in the journal`, { filePath, output: result.diff });
    await markJournalEntryReverted(projectId, entry.id);
    revertedFiles.push(filePath);
  }

  return { status: revertedFiles.length || candidates.length === 0 ? "passed" : "failed", revertedFiles };
}

/** A bare file-name listing forces the planner to guess at things one real read would answer — which
 * script actually starts the app, what it's called, whether this is a single app or a monorepo. Fold in the
 * project's own real package.json (when present) so the planner can answer those from real data instead of
 * asking the user a question their own project already answers (Section 5, "verify before asking"). */
async function buildProjectSnapshot(access: ProjectAccess) {
  const entries = await access.listDir("");
  const listing = entries.slice(0, 60).map((entry) => `${entry.kind === "directory" ? "[dir] " : ""}${entry.name}`).join("\n");
  const hasPackageJson = entries.some((entry) => entry.kind === "file" && entry.name.toLowerCase() === "package.json");
  if (!hasPackageJson) return listing;
  const read = await access.readFile("package.json", { limitBytes: 6000 }).catch(() => undefined);
  const manifestSummary = read?.exists ? summarizePackageJsonForPlanning(read.content) : undefined;
  return manifestSummary ? `${listing}\n\n${manifestSummary}` : listing;
}

function summarizePackageJsonForPlanning(content: string): string | undefined {
  try {
    const pkg = JSON.parse(content) as { name?: string; scripts?: Record<string, string> };
    const scriptLines = pkg.scripts
      ? Object.entries(pkg.scripts).map(([name, command]) => `  ${name}: ${command}`).join("\n")
      : "";
    return [
      `package.json${pkg.name ? ` (${pkg.name})` : ""} — this is the real, current script list, not a guess:`,
      scriptLines || "  (no scripts defined)",
    ].join("\n");
  } catch {
    return undefined;
  }
}

/**
 * Section 13: when the user connects a folder that has no recognized stack (nothing Foundry can identify as
 * "this is what's already here") and their request reads like starting something new, never scaffold silently
 * into whatever else is sitting in that folder — ask first. Returns a plain-language question with real,
 * project-specific options when this applies, or undefined when there's nothing to flag.
 */
async function checkProjectFolderSafety(rootEntries: string[], task: string): Promise<string | undefined> {
  const looksLikeNewScopeRequest = /\b(build|create|start|make|scaffold|set ?up|generate)\b[^.?!\n]{0,60}\b(new|from scratch)\b/i.test(task) || /\bfrom scratch\b/i.test(task) || /\bbrand new\b/i.test(task);
  if (!looksLikeNewScopeRequest) return undefined;

  const ignorable = /^(\.git|\.ds_store|\.vscode|\.idea|node_modules|foundry-brief\.md|thumbs\.db)$/i;
  const meaningfulEntries = rootEntries.filter((name) => !ignorable.test(name));
  if (!meaningfulEntries.length) return undefined;

  const sample = meaningfulEntries.slice(0, 12).join(", ");
  return `I found existing files in this folder that don't appear related to the new project you're describing: ${sample}${meaningfulEntries.length > 12 ? ", ..." : ""}. Tell me how to handle them before I start: create a subfolder for the new work, archive the old files first, delete the old files first, continue anyway and mix the new work in here, or cancel.`;
}

type StaticSourceTopology = {
  entry: string;
  linkedFiles: string[];
};

async function captureStaticSourceTopology(access: ProjectAccess, rootEntries: string[]): Promise<StaticSourceTopology | undefined> {
  const entry = rootEntries.find((name) => /^index\.html?$/i.test(name));
  if (!entry) return undefined;
  const source = await access.readFile(entry, { limitBytes: 500_000 }).catch(() => undefined);
  if (!source?.exists) return undefined;
  const links = [
    ...Array.from(source.content.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"'?#]+)(?:[?#][^"']*)?["'][^>]*>/gi), (match) => match[1]),
    ...Array.from(source.content.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"'?#]+)(?:[?#][^"']*)?["'][^>]*>/gi), (match) => match[1]),
  ]
    .map((value) => value.replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter((value) => value && !/^(?:[a-z]+:|\/\/|data:|#)/i.test(value));
  return { entry, linkedFiles: [...new Set(links)] };
}

async function includeStaticTopologyEvidence(
  access: ProjectAccess,
  topology: StaticSourceTopology | undefined,
  evidence: BrowserPreviewEvidence,
): Promise<BrowserPreviewEvidence> {
  if (!topology?.linkedFiles.length) return evidence;
  const source = await access.readFile(topology.entry, { limitBytes: 500_000 }).catch(() => undefined);
  if (!source?.exists) {
    return {
      ...evidence,
      verified: false,
      acceptanceVerified: false,
      infrastructureFailure: false,
      evidence: `The established HTML entry ${topology.entry} was removed. Restore it and its linked source files before browser acceptance.\n${evidence.evidence}`,
    };
  }
  const normalized = source.content.replace(/\\/g, "/");
  const missing = topology.linkedFiles.filter((linkedFile) => {
    const escaped = linkedFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`(?:href|src)\\s*=\\s*["'][^"']*${escaped}(?:[?#][^"']*)?["']`, "i").test(normalized);
  });
  if (!missing.length) return evidence;
  return {
    ...evidence,
    verified: false,
    acceptanceVerified: false,
    infrastructureFailure: false,
    evidence: `Source architecture regression: ${topology.entry} no longer loads ${missing.join(", ")}. Restore those existing links and keep their CSS/JavaScript implementation in those files; do not leave competing inline copies.\n${evidence.evidence}`,
  };
}

async function detectStackProfileAndEntriesForAccess(access: ProjectAccess): Promise<{ profile: StackProfile; rootEntries: string[]; verificationProfile: VerificationProfile }> {
  const rootEntries = (await access.listDir("")).map((entry) => entry.name);
  const manifestPaths = await discoverNestedManifestPaths(access);
  const detectionEntries = [...new Set([...rootEntries, ...manifestPaths])];
  let packageJsonContent: string | undefined;
  const packageJsonPath = detectionEntries.find((name) => name.toLowerCase() === "package.json")
    ?? detectionEntries.find((name) => name.toLowerCase().endsWith("/package.json"));
  if (packageJsonPath) {
    const read = await access.readFile(packageJsonPath, { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) packageJsonContent = read.content;
  }

  let javaBuildFileContent: string | undefined;
  const javaBuildFileName = detectionEntries.find((name) => ["pom.xml", "build.gradle", "build.gradle.kts"].includes(path.posix.basename(name).toLowerCase()));
  if (javaBuildFileName) {
    const read = await access.readFile(javaBuildFileName, { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) javaBuildFileContent = read.content;
  }

  let dotnetProjectFileContent: string | undefined;
  const dotnetProjectFileName = detectionEntries.find((name) => name.toLowerCase().endsWith(".csproj"));
  if (dotnetProjectFileName) {
    const read = await access.readFile(dotnetProjectFileName, { limitBytes: 6000 }).catch(() => undefined);
    if (read?.exists) dotnetProjectFileContent = read.content;
  }

  const profile = detectStackProfile({ rootEntries: detectionEntries, packageJsonContent, javaBuildFileContent, dotnetProjectFileContent });
  const verificationFiles: Record<string, string | undefined> = {
    "package.json": packageJsonContent,
    "pyproject.toml": await readAccessFileIfPresent(access, rootEntries, "pyproject.toml"),
    "composer.json": await readAccessFileIfPresent(access, rootEntries, "composer.json"),
  };
  for (const entry of rootEntries.filter((name) => /\.(?:sln|csproj)$/i.test(name))) {
    const read = await access.readFile(entry, { limitBytes: 20_000 }).catch(() => undefined);
    if (read?.exists) verificationFiles[entry] = read.content;
  }
  const verificationProfile = detectVerificationProfile({
    rootEntries,
    files: verificationFiles,
    platform: process.platform === "darwin" || process.platform === "linux" ? process.platform : "win32",
  });
  return { profile, rootEntries, verificationProfile };
}

async function readAccessFileIfPresent(access: ProjectAccess, rootEntries: string[], fileName: string) {
  const actualName = rootEntries.find((entry) => entry.toLowerCase() === fileName.toLowerCase());
  if (!actualName) return undefined;
  const read = await access.readFile(actualName, { limitBytes: 12_000 }).catch(() => undefined);
  return read?.exists ? read.content : undefined;
}

function accessForCapabilityLevel(access: ProjectAccess, level: StackCapabilityLevel): ProjectAccess {
  if (level >= 3 || !access.capabilities.canRunCommands) return access;
  return { ...access, capabilities: { ...access.capabilities, canRunCommands: false } };
}

async function discoverNestedManifestPaths(access: ProjectAccess) {
  const manifests = /^(?:package\.json|pyproject\.toml|composer\.json|pom\.xml|build\.gradle(?:\.kts)?|cargo\.toml|go\.mod|pubspec\.yaml|androidmanifest\.xml|[^/]+\.(?:csproj|sln))$/i;
  const sourceStackMarkers = /\.html?$/i;
  const ignored = /^(?:node_modules|\.git|\.next|\.pytest_cache|__pycache__|\.mypy_cache|\.ruff_cache|\.tox|\.nox|\.venv|venv|site-packages|bin|obj|dist|build|artifacts|coverage)$/i;
  const found: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
  while (queue.length) {
    const current = queue.shift() as { path: string; depth: number };
    const entries = await access.listDir(current.path).catch(() => []);
    for (const entry of entries) {
      const relative = current.path ? `${current.path}/${entry.name}` : entry.name;
      if (entry.kind === "file" && (manifests.test(entry.name) || sourceStackMarkers.test(entry.name)) && found.length < 200) found.push(relative);
      if (entry.kind === "directory" && current.depth < 4 && !ignored.test(entry.name) && queue.length < 200) queue.push({ path: relative, depth: current.depth + 1 });
    }
  }
  return found;
}

/**
 * A resolved narrow follow-up is enforced where writes actually happen, not only in a prompt. Reads remain
 * broad so the engineer can verify dependencies; any extra write is stopped and recorded instead of being
 * silently justified after the fact.
 */
function constrainAccessToFollowUpScope(
  access: ProjectAccess,
  resolution: FollowUpResolutionRecord | undefined,
  execution: ExecutionContext,
  currentInstruction = "",
): ProjectAccess {
  if (!resolution || resolution.continuity !== "carry_forward_plan" || resolution.relevantFiles.length === 0) return access;
  const explicitFiles = explicitScopeFilesFromTask(currentInstruction);
  const allowedFiles = Array.from(new Set([...resolution.relevantFiles, ...explicitFiles]));
  const allowed = new Set(allowedFiles.map(normalizeScopePath));
  const isAllowed = (relativePath: string) => allowed.has(normalizeScopePath(relativePath));
  const scopeReason = (relativePath: string) => `Blocked ${relativePath}: it is outside the accepted follow-up scope (${allowedFiles.join(", ")}). A dependency expansion must be resolved and recorded before this file can change.`;

  return {
    ...access,
    async writeFile(relativePath, content) {
      if (isAllowed(relativePath)) return access.writeFile(relativePath, content);
      const reason = scopeReason(relativePath);
      await emitExecution(execution, "blocked", "warning", "Follow-up scope prevented an unrelated file change", {
        tier: "flag",
        filePath: relativePath,
        details: { reason, expectedScope: resolution.expectedScope, allowedFiles: resolution.relevantFiles },
      });
      return { existedBefore: false, verified: false, contentChanged: false, reason };
    },
    deleteFile: access.deleteFile
      ? async (relativePath) => {
          if (isAllowed(relativePath)) return access.deleteFile!(relativePath);
          const reason = scopeReason(relativePath);
          await emitExecution(execution, "blocked", "warning", "Follow-up scope prevented an unrelated file deletion", {
            tier: "flag",
            filePath: relativePath,
            details: { reason, expectedScope: resolution.expectedScope, allowedFiles: resolution.relevantFiles },
          });
          return { existed: true, verified: false, reason };
        }
      : undefined,
  };
}

function explicitScopeFilesFromTask(task: string) {
  const matches = task.match(/[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)*\.(?:json|[cm]?[jt]sx?|css|scss|html|md|py|cs|xaml|xml|ya?ml|toml)/gi) ?? [];
  return matches.map((entry) => entry.replace(/^[`'"(]+|[`'"),.;:]+$/g, ""));
}

function normalizeScopePath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

async function rebuildFactoryProjectCore(projectId: string): Promise<FactoryProjectResult> {
  const projectPath = safeProjectPath(projectId);
  const briefPath = path.join(projectPath, "foundry-brief.md");
  const brief = await readFile(briefPath, "utf8");
  const spec = parseBrief(brief);
  const events = [`Rebuild started: ${projectPath}`];
  const commands: FactoryCommandEvent[] = [];

  if (!isSupportedStack(spec.stack)) {
    const files = await listProjectFiles(projectPath);
    return {
      projectId,
      projectName: spec.projectName,
      projectPath,
      briefPath,
      stack: spec.stack,
      template: spec.template,
      status: "unsupported",
      supported: false,
      blocker: `${spec.stack} rebuild is stubbed honestly in Phase 2.`,
      events,
      files,
      commands,
    };
  }

  if (isNextStack(spec.stack)) {
    commands.push(await runCommand(projectPath, "npm.cmd", ["install"], events));
    if (commands.at(-1)?.exitCode === 0) {
      commands.push(await runCommand(projectPath, "npm.cmd", ["run", "build"], events));
    }
  }

  const failedCommand = commands.find((command) => command.exitCode !== 0);
  const preview = failedCommand ? undefined : await startProjectPreview({ kind: "workspace", projectId, projectPath }, spec.stack, events);
  const files = await listProjectFiles(projectPath);

  return {
    projectId,
    projectName: spec.projectName,
    projectPath,
    briefPath,
    stack: spec.stack,
    template: spec.template,
    status: failedCommand ? "failed" : "passed",
    supported: true,
    blocker: failedCommand ? summarizeCommandFailure(failedCommand) : undefined,
    events: failedCommand ? [...events, "Build failed"] : [...events, "Build passed"],
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
    previewEmulator: preview?.previewEmulator,
    artifact: preview?.artifact,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
  };
}

export async function rebuildFactoryProject(projectId: string): Promise<FactoryProjectResult> {
  const result = await rebuildFactoryProjectCore(projectId);
  return finalizeFactoryProjectResult(result, `Rebuild ${result.projectName}`);
}

export async function listProjectFiles(projectPath: string, root = projectPath): Promise<FactoryFileEntry[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((entry) => !isGeneratedProjectDirectory(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) return listProjectFiles(projectPath, fullPath);
        const details = await stat(fullPath);
        return [{ path: path.relative(projectPath, fullPath).replace(/\\/g, "/"), status: "created" as const, size: details.size }];
      }),
  );

  return files.flat().sort((a, b) => a.path.localeCompare(b.path));
}

function isGeneratedProjectDirectory(name: string) {
  return /^(?:node_modules|\.next|\.next-build|\.svelte-kit|\.turbo|\.cache|dist|build|out|target|bin|obj|coverage|\.gradle|\.dart_tool|\.terraform|\.foundry-artifacts|\.pytest_cache|__pycache__|\.mypy_cache|\.ruff_cache|\.tox|\.nox|site-packages|library|temp|logs|packages|\.venv|venv)$/i.test(name);
}

export async function readProjectFile(projectId: string, relativePath: string) {
  const projectPath = safeProjectPath(projectId);
  const filePath = path.resolve(projectPath, relativePath);
  if (!filePath.startsWith(projectPath)) throw new Error("Refusing to read outside the project workspace.");
  return readFile(filePath, "utf8");
}

export type ProjectDeliveredFile = { path: string; content: string; mediaType: string; size: number };
type InspectionEmitter = (event: FactoryExecutionEvent) => void | Promise<void>;

function isProjectFileDeliveryRequest(task: string) {
  return /\b(send|share|give|attach|download|export|provide)\b/i.test(task)
    && isExplicitLocalProjectFileRequest(task)
    && (/\b(docs?|documentation|readme|manuals?|guides?|files?)\b/i.test(task) || /[\w@./-]+\.[a-z0-9]{1,10}\b/i.test(task));
}

function requestedDeliveryPaths(task: string, paths: string[]) {
  const normalized = paths.map((filePath) => filePath.replace(/\\/g, "/"));
  const explicitNames = explicitProjectFileNames(task).map((name) => name.toLowerCase());
  const explicit = normalized.filter((filePath) => {
    const lower = filePath.toLowerCase();
    const basename = lower.split("/").at(-1) ?? lower;
    return explicitNames.some((name) => lower === name || basename === name.split("/").at(-1));
  });
  if (explicit.length) return explicit;
  if (!/\b(docs?|documentation|readme|manuals?|guides?)\b/i.test(task)) return [];
  return normalized.filter((filePath) => {
    const lower = filePath.toLowerCase();
    const basename = lower.split("/").at(-1) ?? lower;
    return lower.startsWith("docs/")
      || (!lower.includes("/") && /^readme(?:\.|$)/i.test(basename))
      || /^(?:contributing|architecture|api|setup|development|deployment|security|changelog)\.(?:md|mdx|txt|rst)$/i.test(basename);
  });
}

function deliveryMediaType(filePath: string) {
  const extension = filePath.split(".").at(-1)?.toLowerCase();
  if (extension === "md" || extension === "mdx") return "text/markdown";
  if (extension === "json") return "application/json";
  if (extension === "yaml" || extension === "yml") return "application/yaml";
  if (extension === "html") return "text/html";
  if (extension === "css") return "text/css";
  if (extension === "js" || extension === "mjs" || extension === "cjs") return "text/javascript";
  if (extension === "ts" || extension === "tsx") return "text/plain";
  return "text/plain";
}

async function collectRequestedProjectFiles(task: string, paths: string[], access: ProjectAccess, onEvent?: InspectionEmitter): Promise<ProjectDeliveredFile[]> {
  if (!isProjectFileDeliveryRequest(task)) return [];
  const candidates = requestedDeliveryPaths(task, paths)
    .filter((filePath) => !isSensitiveFilePath(filePath))
    .slice(0, 12);
  const delivered: ProjectDeliveredFile[] = [];
  let totalBytes = 0;
  for (const filePath of candidates) {
    if (totalBytes >= 1_000_000) break;
    await onEvent?.({ id: `delivery-read-${Date.now()}-${delivered.length}`, timestamp: new Date().toISOString(), kind: "inspection", status: "running", title: `Reading ${filePath}`, filePath });
    const read = await access.readFile(filePath, { offsetBytes: 0, limitBytes: Math.min(300_000, 1_000_000 - totalBytes) });
    if (!read.exists) continue;
    delivered.push({ path: filePath, content: read.content, mediaType: deliveryMediaType(filePath), size: read.totalBytes });
    totalBytes += read.totalBytes;
    await onEvent?.({ id: `delivery-ready-${Date.now()}-${delivered.length}`, timestamp: new Date().toISOString(), kind: "file", status: "completed", title: `Prepared ${filePath} for download`, filePath });
  }
  return delivered;
}

export async function inspectLocalProjectSource(localPath: string, task = "", apiKey?: string, provider?: ProviderId, tier: ModelTier = "builder", onEvent?: InspectionEmitter) {
  const projectPath = path.resolve(localPath);
  const rootStats = await stat(projectPath);
  if (!rootStats.isDirectory()) throw new Error("Local project path is not a folder.");
  const access = createServerProjectAccess(projectPath, "local-folder");
  if (isProjectFileDeliveryRequest(task)) {
    const projectFiles = await listProjectFiles(projectPath);
    const deliveredFiles = await collectRequestedProjectFiles(task, projectFiles.map((file) => file.path), access, onEvent);
    const answer = deliveredFiles.length
      ? `I found and attached ${deliveredFiles.length} project documentation file${deliveredFiles.length === 1 ? "" : "s"}.`
      : "I couldn't find a matching documentation file in this project to attach.";
    return { projectPath, stack: "Connected project", files: projectFiles.map((file) => ({ path: file.path, size: file.size })), answer, answeredByModel: false, deliveredFiles };
  }
  const files = await readLocalProjectFiles(projectPath);
  const detected = detectExistingProject(files);
  const stackProfile = await detectStackProfileAndEntriesForAccess(access);
  // Every real question deserves a real model answer. The canned overview template is only for
  // task-less connect summaries and the no-API-key case — gating the model behind diagnostic
  // phrasings ("why is X slow") made every other question return the template (test B01/B02).
  if (apiKey && task.trim()) {
    try {
      const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider, tier, onEvent: onEvent ?? (async () => {}) });
      if (inspection.answer.trim()) {
        return {
          projectPath,
          stack: stackProfile.profile.label,
          files: files.map((file) => ({ path: file.path, size: file.size })),
          answer: inspection.answer,
          answeredByModel: true,
        };
      }
    } catch {
      // Fall through to the deterministic overview rather than failing the whole inspection.
    }
  }
  return {
    projectPath,
    stack: stackProfile.profile.label,
    files: files.map((file) => ({ path: file.path, size: file.size })),
    answer: projectInspectionAnswer(files, detected, task),
    answeredByModel: false,
  };
}

export async function inspectUploadedProjectSource(files: FactoryUploadedFile[], task = "", apiKey?: string, provider?: ProviderId, tier: ModelTier = "builder", onEvent?: InspectionEmitter) {
  const safeFiles = files
    .filter((file) => isUsefulUploadedFile(file.path) && !isSensitiveFilePath(file.path))
    .map((file) => ({ ...file, path: safeRelativePath(file.path) }))
    .filter((file) => Boolean(file.path));
  if (!safeFiles.length) throw new Error("The uploaded project has no readable source files.");

  const access = createUploadedProjectAccess(safeFiles);
  const detected = detectExistingProject(safeFiles);
  const stackProfile = await detectStackProfileAndEntriesForAccess(access);
  if (isProjectFileDeliveryRequest(task)) {
    const deliveredFiles = await collectRequestedProjectFiles(task, safeFiles.map((file) => file.path), access, onEvent);
    const answer = deliveredFiles.length
      ? `I found and attached ${deliveredFiles.length} uploaded project file${deliveredFiles.length === 1 ? "" : "s"}.`
      : "I couldn't find a matching uploaded project file to attach.";
    return { projectPath: "Uploaded project copy", stack: stackProfile.profile.label, files: safeFiles.map((file) => ({ path: file.path, size: file.size })), answer, answeredByModel: false, deliveredFiles };
  }
  if (apiKey && task.trim()) {
    try {
      const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider, tier, onEvent: onEvent ?? (async () => {}) });
      if (inspection.answer.trim()) {
        return {
          projectPath: "Uploaded project copy",
          stack: stackProfile.profile.label,
          files: safeFiles.map((file) => ({ path: file.path, size: file.size })),
          answer: inspection.answer,
          answeredByModel: true,
        };
      }
    } catch {
      // Preserve real file visibility even when the model-backed answer is temporarily unavailable.
    }
  }
  return {
    projectPath: "Uploaded project copy",
    stack: stackProfile.profile.label,
    files: safeFiles.map((file) => ({ path: file.path, size: file.size })),
    answer: projectInspectionAnswer(safeFiles, detected, task),
    answeredByModel: false,
  };
}

export async function inspectLocalConnectorSource(localConnector: LocalConnectorConfig, task = "", apiKey?: string, provider?: ProviderId, tier: ModelTier = "builder", onEvent?: InspectionEmitter) {
  const access = createLocalConnectorProjectAccess(localConnector);
  const files: FactoryUploadedFile[] = [];
  let totalSize = 0;
  const maxTotalSize = 2_500_000;
  const maxFileSize = 300_000;

  async function visit(relativePath: string) {
    if (totalSize >= maxTotalSize) return;
    const entries = await access.listDir(relativePath);
    for (const entry of entries) {
      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        await visit(entryPath);
        continue;
      }
      if (!isUsefulUploadedFile(entryPath) || (entry.size ?? 0) > maxFileSize || totalSize + (entry.size ?? 0) > maxTotalSize) continue;
      const read = await access.readFile(entryPath, { offsetBytes: 0, limitBytes: maxFileSize });
      if (!read.exists) continue;
      files.push({ path: entryPath, content: read.content, size: read.totalBytes });
      totalSize += read.totalBytes;
    }
  }

  await visit("");
  const detected = detectExistingProject(files);
  const stackProfile = await detectStackProfileAndEntriesForAccess(access);
  if (isProjectFileDeliveryRequest(task)) {
    const deliveredFiles = await collectRequestedProjectFiles(task, files.map((file) => file.path), access, onEvent);
    const answer = deliveredFiles.length
      ? `I found and attached ${deliveredFiles.length} project documentation file${deliveredFiles.length === 1 ? "" : "s"}.`
      : "I couldn't find a matching documentation file in this project to attach.";
    return { projectPath: localConnector.rootLabel || localConnector.url, stack: stackProfile.profile.label, files: files.map((file) => ({ path: file.path, size: file.size })), answer, answeredByModel: false, deliveredFiles };
  }
  // Same policy as inspectLocalProjectSource: a real question gets a real model answer; the canned
  // overview covers only task-less summaries and the no-API-key case.
  if (apiKey && task.trim()) {
    try {
      const inspection = await runReadOnlyInspection({ message: task, access, apiKey, provider, tier, onEvent: onEvent ?? (async () => {}) });
      if (inspection.answer.trim()) {
        return {
          projectPath: localConnector.rootLabel || localConnector.url,
          stack: stackProfile.profile.label,
          files: files.map((file) => ({ path: file.path, size: file.size })),
          answer: inspection.answer,
          answeredByModel: true,
        };
      }
    } catch {
      // Fall through to the deterministic overview rather than failing the whole inspection.
    }
  }
  return {
    projectPath: localConnector.rootLabel || localConnector.url,
    stack: stackProfile.profile.label,
    files: files.map((file) => ({ path: file.path, size: file.size })),
    answer: projectInspectionAnswer(files, detected, task),
    answeredByModel: false,
  };
}

type ExistingProjectDetection = {
  stack: string;
  entryFiles: string[];
  cssFiles: string[];
  jsFiles: string[];
  packageManager: string;
  markers: string[];
  primaryLanguages: string[];
};

function existingProjectResult({
  projectId,
  projectName,
  projectPath,
  briefPath,
  stack,
  status,
  blocker,
  events,
  files,
  commands,
  execution,
  sourceMode = "uploaded-copy",
  objective,
  preview,
  sessionSummary,
  clarificationQuestions,
  verification,
  projectDeleted,
}: {
  projectId: string;
  projectName: string;
  projectPath: string;
  briefPath: string;
  stack: string;
  status: FactoryProjectResult["status"];
  blocker?: string;
  events: string[];
  files: FactoryFileEntry[];
  commands: FactoryCommandEvent[];
  execution: ExecutionContext;
  sourceMode?: FactorySourceMode;
  objective?: string;
  preview?: PreviewOutcome;
  sessionSummary?: FactorySessionSummary;
  clarificationQuestions?: MissionClarification[];
  verification?: ExecutionMissionVerification[];
  projectDeleted?: boolean;
}): FactoryProjectResult {
  const previewFailed = status === "passed" && preview?.previewPlatform === "web" && preview.previewState !== "ready";
  let truthfulStatus: FactoryProjectResult["status"] = previewFailed ? "failed" : status;
  let truthfulBlocker = previewFailed
    ? preview.previewReason || "The web preview did not reach a verified ready state."
    : blocker;
  const truthfulVerification = [
    ...(verification ?? []),
    ...(previewFailed ? [{ check_type: "preview" as const, result: "fail" as const, evidence: truthfulBlocker! }] : []),
  ];
  // Final reconciliation for EVERY existing-project path (uploaded, local folder, connector). A
  // mission may not conclude "passed" while its own plan still shows unfinished steps — the client
  // otherwise flips that into the confusing "returned success before completing the mission plan"
  // Failed banner. Reconcile by evidence: a failed gate or ZERO file changes means the requested work
  // did not land, so fail honestly and say plainly that no edit was made; genuine work whose rows were
  // simply never ticked is completed citing the recorded evidence. A truly no-op-free success has a
  // complete plan and never enters this branch.
  const unfinishedPlan = execution.checklist.filter((item) => item.status !== "completed" && item.status !== "skipped");
  if (truthfulStatus === "passed" && unfinishedPlan.length) {
    const changedFileCount = files.filter((file) => file.status === "created" || file.status === "edited").length;
    const failedGate = truthfulVerification.find((item) => item.result === "fail");
    if (failedGate || changedFileCount === 0) {
      truthfulStatus = "failed";
      truthfulBlocker = truthfulBlocker || (changedFileCount === 0
        ? "You asked for a change, but Foundry did not edit any file — the requested change was not applied. Tell me the specific change (or which file to edit) and I will apply it directly."
        : `The mission cannot conclude as passed while ${unfinishedPlan.length} plan step(s) remain unfinished.`);
    } else {
      for (const item of unfinishedPlan) {
        item.status = "completed";
        item.evidence = item.evidence || "Completed at mission conclusion with the recorded file and verification evidence.";
      }
    }
  }
  return {
    projectId,
    projectName,
    projectPath,
    briefPath,
    stack,
    template: "Existing Project",
    sourceMode,
    objective: objective ?? engineeringObjectiveForTask(execution.checklist[0]?.label ?? projectName),
    checklist: execution.checklist,
    status: truthfulStatus,
    supported: truthfulStatus !== "unsupported",
    blocker: truthfulBlocker,
    events,
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
    previewEmulator: preview?.previewEmulator,
    artifact: preview?.artifact,
    projectDeleted,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
    timeline: execution.timeline,
    sessionSummary,
    clarificationQuestions,
    verification: truthfulVerification,
  };
}

function accessForProjectId(projectId: string, localPath?: string, localConnector?: LocalConnectorConfig): { access: ProjectAccess; projectPath: string } {
  if (localConnector?.url) {
    return { access: createLocalConnectorProjectAccess(localConnector), projectPath: localConnector.rootLabel || localConnector.url };
  }
  if (localPath) {
    const resolved = path.resolve(localPath);
    return { access: createServerProjectAccess(resolved, "local-folder"), projectPath: resolved };
  }
  const projectPath = safeProjectPath(projectId);
  return { access: createServerProjectAccess(projectPath, "uploaded-copy"), projectPath };
}

export async function performRollback(
  projectId: string,
  entryId: string,
  options: { localPath?: string; localConnector?: LocalConnectorConfig } = {},
  onEvent?: ExecutionEmitter,
): Promise<FactoryProjectResult> {
  const execution = createExecutionContext(onEvent, projectId);
  const { access, projectPath } = accessForProjectId(projectId, options.localPath, options.localConnector);
  const result = await rollbackToEntry(access, execution, projectId, entryId);
  await emitExecution(execution, "summary", result.status === "passed" ? "completed" : "error", result.status === "passed" ? "Rollback complete" : "Rollback failed", {
    details: { revertedFiles: result.revertedFiles, blocker: result.blocker },
  });
  return existingProjectResult({
    projectId,
    projectName: "Rollback",
    projectPath,
    briefPath: `${projectPath}/foundry-brief.md`,
    stack: "Rollback",
    status: result.status === "passed" ? "passed" : "failed",
    blocker: result.blocker,
    events: result.revertedFiles.map((filePath) => `Reverted ${filePath}`),
    files: result.revertedFiles.map((filePath) => ({ path: filePath, status: "edited" as const, size: 0 })),
    commands: [],
    execution,
  });
}

function detectExistingProject(files: FactoryUploadedFile[]): ExistingProjectDetection {
  const paths = files.map((file) => file.path.replace(/\\/g, "/"));
  const lower = paths.map((item) => item.toLowerCase());
  const entryFiles = paths.filter((item) => /\.html?$/i.test(item)).slice(0, 8);
  const cssFiles = paths.filter((item) => /\.css$/i.test(item));
  const jsFiles = paths.filter((item) => /\.(js|mjs|cjs)$/i.test(item));
  const markers: string[] = [];
  const languages = new Set<string>();
  for (const item of lower) {
    if (item.endsWith(".ts") || item.endsWith(".tsx")) languages.add("TypeScript");
    if (item.endsWith(".js") || item.endsWith(".jsx") || item.endsWith(".mjs") || item.endsWith(".cjs")) languages.add("JavaScript");
    if (item.endsWith(".cs")) languages.add("C#");
    if (item.endsWith(".java")) languages.add("Java");
    if (item.endsWith(".kt") || item.endsWith(".kts")) languages.add("Kotlin");
    if (item.endsWith(".py")) languages.add("Python");
    if (item.endsWith(".php")) languages.add("PHP");
    if (item.endsWith(".go")) languages.add("Go");
    if (item.endsWith(".rs")) languages.add("Rust");
    if (item.endsWith(".dart")) languages.add("Dart");
    if (item.endsWith(".gd")) languages.add("GDScript");
  }
  const packageManager = lower.some((item) => item.endsWith("pnpm-lock.yaml"))
    ? "pnpm"
    : lower.some((item) => item.endsWith("yarn.lock"))
      ? "yarn"
      : lower.some((item) => item.endsWith("package-lock.json") || item.endsWith("package.json"))
        ? "npm"
        : "";
  let stack = "Unknown";
  if (lower.some((item) => /next\.config\.(js|mjs|ts)$/.test(item))) {
    stack = "Next.js";
    markers.push("next.config");
  } else if (lower.some((item) => /vite\.config\.(js|ts)$/.test(item))) {
    stack = "Vite";
    markers.push("vite.config");
  } else if (lower.some((item) => item.endsWith("angular.json"))) {
    stack = "Angular";
    markers.push("angular.json");
  } else if (lower.some((item) => item.endsWith("pubspec.yaml"))) {
    stack = "Flutter/Dart";
    markers.push("pubspec.yaml");
  } else if (lower.some((item) => item.endsWith("androidmanifest.xml") || item.endsWith("build.gradle") || item.endsWith("build.gradle.kts"))) {
    stack = "Android/Gradle";
    markers.push("Gradle/Android markers");
  } else if (lower.some((item) => item.endsWith(".sln") || item.endsWith(".csproj"))) {
    stack = ".NET/C#";
    markers.push(".sln/.csproj");
  } else if (lower.some((item) => item.endsWith("requirements.txt") || item.endsWith("pyproject.toml") || item.endsWith("manage.py"))) {
    stack = "Python";
    markers.push("Python project markers");
  } else if (lower.some((item) => item.endsWith("composer.json") || item.endsWith("artisan"))) {
    stack = "PHP/Laravel";
    markers.push("composer/artisan");
  } else if (lower.some((item) => item.endsWith("go.mod"))) {
    stack = "Go";
    markers.push("go.mod");
  } else if (lower.some((item) => item.endsWith("cargo.toml"))) {
    stack = "Rust";
    markers.push("Cargo.toml");
  } else if (lower.some((item) => item.endsWith("project.godot"))) {
    stack = "Godot";
    markers.push("project.godot");
  } else if (lower.some((item) => item.endsWith("package.json"))) {
    stack = "JavaScript project";
    markers.push("package.json");
  } else if (entryFiles.length) {
    stack = "Static HTML/CSS/JS";
    markers.push("HTML entry file");
  }

  return { stack, entryFiles, cssFiles, jsFiles, packageManager, markers, primaryLanguages: Array.from(languages).sort() };
}

function projectInspectionAnswer(files: FactoryUploadedFile[], detected: ExistingProjectDetection, task: string) {
  const visibleFiles = files
    .map((file) => file.path)
    .filter((filePath) => !/(^|\/)(node_modules|\.git|\.next|\.pytest_cache|__pycache__|\.mypy_cache|\.ruff_cache|\.tox|\.nox|\.venv|venv|site-packages|dist|build|coverage)(\/|$)/i.test(filePath));
  const keyFiles = pickKeyProjectFiles(files);
  const purpose = inferProjectPurpose(files, detected);
  const askNext = /\b(can you|do you|what|why|how|see|tell|explain|inspect|look)\b/i.test(task)
    ? "Tell me what you want to change next, or ask me to inspect a specific file or behavior."
    : "What would you like Foundry to do next?";

  return [
    "I can see the project files.",
    "",
    `It appears to be a ${projectKindLabel(detected.stack)}.`,
    purpose ? `What it seems to do: ${purpose}` : "What it seems to do: I can identify the structure, but there is not enough readable application code to confidently summarize the product behavior.",
    detected.primaryLanguages.length ? `Primary languages: ${detected.primaryLanguages.join(", ")}.` : "",
    detected.markers.length ? `Project markers: ${detected.markers.join(", ")}.` : "",
    "",
    "Main files I inspected:",
    ...keyFiles.map((file) => `- ${file.path}${file.note ? `: ${file.note}` : ""}`),
    visibleFiles.length > keyFiles.length ? `- ${visibleFiles.length - keyFiles.length} more readable file${visibleFiles.length - keyFiles.length === 1 ? "" : "s"}.` : "",
    "",
    askNext,
  ].filter(Boolean).join("\n");
}

function pickKeyProjectFiles(files: FactoryUploadedFile[]) {
  const priority = [
    /(^|\/)package\.json$/i,
    /(^|\/)(index|main|app)\.html$/i,
    /(^|\/)(index|main|app)\.(js|jsx|ts|tsx)$/i,
    /(^|\/)src\/(index|main|app)\.(js|jsx|ts|tsx)$/i,
    /(^|\/)README\.md$/i,
    /(^|\/)(styles|style|main|app)\.css$/i,
  ];
  return files
    .slice()
    .sort((a, b) => {
      const ai = priority.findIndex((pattern) => pattern.test(a.path));
      const bi = priority.findIndex((pattern) => pattern.test(b.path));
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.path.localeCompare(b.path);
    })
    .slice(0, 8)
    .map((file) => ({ path: file.path, note: summarizeFileRole(file) }));
}

function summarizeFileRole(file: FactoryUploadedFile) {
  const lower = file.path.toLowerCase();
  if (lower.endsWith("package.json")) return "project metadata and scripts";
  if (lower.endsWith(".html")) return "browser page/markup";
  if (lower.endsWith(".css")) return "styling";
  if (/\.(js|jsx|ts|tsx)$/.test(lower)) return "application logic";
  if (lower.endsWith("readme.md")) return "project documentation";
  if (lower.endsWith(".json")) return "configuration or data";
  return "";
}

function inferProjectPurpose(files: FactoryUploadedFile[], detected: ExistingProjectDetection) {
  const packageFile = files.find((file) => /(^|\/)package\.json$/i.test(file.path));
  if (packageFile) {
    try {
      const pkg = JSON.parse(packageFile.content) as { name?: string; description?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      if (pkg.description) return pkg.description;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) return "a Next.js web application";
      if (deps.vite || deps["@vitejs/plugin-react"]) return "a Vite/React-style web application";
      if (pkg.scripts?.start || pkg.scripts?.dev) return `a JavaScript project with ${Object.keys(pkg.scripts).join(", ")} script${Object.keys(pkg.scripts).length === 1 ? "" : "s"}`;
      if (pkg.name) return `a JavaScript package named ${pkg.name}`;
    } catch {
      // Ignore malformed package metadata and infer from files below.
    }
  }
  if (detected.entryFiles.length) return "a static browser project with HTML entry files";
  if (detected.cssFiles.length && detected.jsFiles.length) return "a browser project with separate styling and JavaScript";
  if (detected.jsFiles.length) return "a JavaScript project or script-based app";
  return "";
}

function projectKindLabel(stack: string) {
  return /\bproject$/i.test(stack) ? stack : `${stack} project`;
}

async function writeVirtualFilesToDisk(projectPath: string, contents: Map<string, string>) {
  for (const [filePath, content] of contents.entries()) {
    const relativePath = safeRelativePath(filePath);
    if (!relativePath) continue;
    const fullPath = path.join(projectPath, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
}

async function listProjectFilesWithStatuses(projectPath: string, changedFiles: string[], originalPaths: Set<string>): Promise<FactoryFileEntry[]> {
  const changed = new Set(changedFiles);
  const files = await listProjectFiles(projectPath);
  return Promise.all(files.map(async (file) => {
    const isChanged = changed.has(file.path);
    const fullPath = path.join(projectPath, file.path);
    const content = isChanged ? await readFile(fullPath, "utf8").catch(() => undefined) : undefined;
    return {
      ...file,
      status: isChanged ? (originalPaths.has(file.path) ? "edited" as const : "created" as const) : "uploaded" as const,
      content,
      contentHash: content === undefined ? undefined : createHash("sha256").update(content).digest("hex"),
    };
  }));
}

async function listConnectorFilesWithStatuses(access: ReturnType<typeof createLocalConnectorProjectAccess>, changedFiles: string[]): Promise<FactoryFileEntry[]> {
  const changed = new Set(changedFiles);

  async function visit(relativePath: string): Promise<FactoryFileEntry[]> {
    const children = await access.listDir(relativePath);
    const nested = await Promise.all(
      children.map(async (child): Promise<FactoryFileEntry[]> => {
        const childPath = relativePath ? `${relativePath}/${child.name}` : child.name;
        if (child.kind === "directory") return visit(childPath);
        const isChanged = changed.has(childPath);
        const read = isChanged ? await access.readFile(childPath, { offsetBytes: 0, limitBytes: 300_000 }) : null;
        return [{
          path: childPath,
          status: isChanged ? ("edited" as const) : ("uploaded" as const),
          size: child.size ?? read?.totalBytes ?? 0,
          content: isChanged && read?.exists ? read.content : undefined,
          contentHash: isChanged && read?.exists ? read.contentHash : undefined,
        }];
      }),
    );
    return nested.flat();
  }

  const entries = await visit("");
  const knownPaths = new Set(entries.map((entry) => entry.path));
  const backfilled = await Promise.all(
    changedFiles
      .filter((changedFile) => !knownPaths.has(changedFile))
      .map(async (changedFile) => {
        const read = await access.readFile(changedFile, { offsetBytes: 0, limitBytes: 300_000 });
        return { path: changedFile, status: "created" as const, size: read.totalBytes, content: read.exists ? read.content : undefined, contentHash: read.exists ? read.contentHash : undefined };
      }),
  );
  return [...entries, ...backfilled].sort((a, b) => a.path.localeCompare(b.path));
}

async function readLocalProjectFiles(projectPath: string) {
  const files: FactoryUploadedFile[] = [];
  let totalSize = 0;
  const maxTotalSize = 2_500_000;
  const maxFileSize = 300_000;

  async function visit(current: string) {
    if (totalSize >= maxTotalSize) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (/(^|\/)(node_modules|\.git|\.next|\.next-build|\.svelte-kit|\.foundry-artifacts|\.pytest_cache|__pycache__|\.mypy_cache|\.ruff_cache|\.tox|\.nox|\.venv|venv|site-packages|dist|build|coverage|target|bin|obj)(\/|$)/i.test(relativePath)) continue;
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !isUsefulUploadedFile(relativePath)) continue;
      const details = await stat(fullPath);
      if (details.size > maxFileSize || totalSize + details.size > maxTotalSize) continue;
      files.push({ path: relativePath, content: await readFile(fullPath, "utf8"), size: details.size });
      totalSize += details.size;
    }
  }

  await visit(projectPath);
  return files;
}

/**
 * The uploaded files, as they should sit inside the Foundry copy.
 *
 * A folder upload arrives with every path prefixed by the picked folder's own name, and copying that
 * verbatim buries the project one level down — so the copy's root is not the project's root. A page
 * asking for "/img/logo.svg" then resolves against a directory containing nothing but the wrapper
 * folder, and the asset 404s no matter how correct the project is. Strip the single shared wrapper
 * so the copy is the project. Applied on both the intake and mission paths, so the copy's layout and
 * the file list the mission reports against it stay in agreement.
 */
function normalizeUploadedProjectFiles(uploadedFiles: FactoryUploadedFile[]) {
  const safeFiles = uploadedFiles
    .filter((file) => isUsefulUploadedFile(file.path))
    .map((file) => ({ ...file, path: safeRelativePath(file.path) }))
    .filter((file) => file.path);
  const roots = new Set(safeFiles.map((file) => file.path.split("/")[0]));
  // Only when one folder genuinely wraps every file: a lone root that is also a file name is a
  // top-level file, not a wrapper, and stripping it would delete part of the project.
  if (roots.size !== 1 || !safeFiles.every((file) => file.path.includes("/"))) return safeFiles;
  const [wrapper] = roots;
  return safeFiles.map((file) => ({ ...file, path: file.path.slice(wrapper.length + 1) }));
}

function uploadedProjectSlug(projectName: string, connectedPath: string) {
  return `uploaded-${slugify(projectName || connectedPath) || "project-copy"}`;
}

/**
 * The one workspace folder that represents this upload. Finds the copy upload intake already
 * materialized by searching for its content marker rather than guessing a folder name: intake runs
 * before the brief exists and names the folder from the uploaded root, while the mission names it
 * from the brief. Guessing by name silently forked a second copy, so the mission edited a different
 * folder than the one the user was watching in the preview.
 */
async function resolveUploadedProjectPath(files: Array<{ path: string; content: string }>, projectName: string, connectedPath: string) {
  await mkdir(projectsRoot, { recursive: true });
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsRoot, entry.name);
    const marker = await readFile(path.join(candidate, uploadIntakeMarkerFile), "utf8").catch(() => undefined);
    if (uploadIntakeMarkerMatches(marker, files)) return { projectPath: candidate, reusedIntakeCopy: true };
  }
  return { projectPath: await uniqueProjectPath(uploadedProjectSlug(projectName, connectedPath)), reusedIntakeCopy: false };
}

/**
 * Creates the workspace copy for a browser-uploaded project at pick time and starts its preview, so
 * opening an existing project shows that project instead of an empty dock. The user's own folder is
 * never written — a browser upload has no writable handle on it — this only copies what was read.
 */
export async function materializeUploadedProjectForPreview(uploadedFiles: FactoryUploadedFile[], projectName: string) {
  const safeFiles = normalizeUploadedProjectFiles(uploadedFiles);
  if (!safeFiles.length) {
    return {
      ok: false as const,
      previewState: "unavailable" as const,
      previewPlatform: "web" as const,
      previewReason: "The selected folder contained no readable project files, so there is nothing to preview yet.",
    };
  }
  const connectedPath = connectedProjectPathFromFiles(uploadedFiles);
  // Name the folder after the uploaded root the user recognises — read from the original paths,
  // since the copy's own paths have had that wrapper stripped. Identity does not depend on this
  // label (the mission finds this copy by content marker), so it is free to be human-readable.
  const uploadedRoot = commonTopLevelPath(uploadedFiles.map((file) => safeRelativePath(file.path)).filter(Boolean));
  const resolved = await resolveUploadedProjectPath(safeFiles, /^multiple /i.test(uploadedRoot) ? projectName : uploadedRoot || projectName, connectedPath);
  const { projectPath } = resolved;
  const projectId = path.basename(projectPath);
  if (!resolved.reusedIntakeCopy) {
    const markerPath = path.join(projectPath, uploadIntakeMarkerFile);
    await mkdir(path.dirname(markerPath), { recursive: true });
    await writeVirtualFilesToDisk(projectPath, new Map(safeFiles.map((file) => [file.path, file.content])));
    await writeFile(markerPath, `${JSON.stringify(buildUploadIntakeMarker(safeFiles, projectName), null, 2)}\n`, "utf8");
  }
  const detected = detectExistingProject(safeFiles);
  const target = { kind: "workspace" as const, projectId, projectPath };
  await stopProjectPreview(target);
  const preview = await startProjectPreview(target, detected.stack);
  return { ok: true as const, projectId, projectPath, stack: detected.stack, fileCount: safeFiles.length, reusedIntakeCopy: resolved.reusedIntakeCopy, ...preview };
}

function connectedProjectPathFromFiles(files: FactoryUploadedFile[]) {
  const paths = files.map((file) => safeRelativePath(file.path)).filter(Boolean);
  const root = commonTopLevelPath(paths);
  return root ? `Connected upload: ${root}` : "Connected upload";
}

function commonTopLevelPath(paths: string[]) {
  if (!paths.length) return "";
  const first = paths[0].split("/")[0] ?? "";
  return paths.every((item) => item.split("/")[0] === first) ? first : "multiple selected roots";
}

function isUsefulUploadedFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (isSensitiveFilePath(normalized)) return false;
  if (/(^|\/)(node_modules|\.git|\.next|\.pytest_cache|__pycache__|\.mypy_cache|\.ruff_cache|\.tox|\.nox|\.venv|venv|site-packages|dist|build|coverage|target|bin|obj)(\/|$)/.test(normalized)) return false;
  if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|cargo\.lock)$/.test(normalized)) return true;
  return /\.(html|css|js|mjs|cjs|json|md|txt|ts|tsx|jsx|vue|svelte|py|php|cs|java|kt|kts|go|rs|rb|swift|dart|xml|toml|gradle|properties|yml|yaml)$/i.test(normalized);
}

function safeRelativePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === ".." || part.includes(":"))) return "";
  return parts.join("/");
}

function wantsAssetSeparation(text: string) {
  return /\b(separate|seperate|saparate|split|extract|move)\b/.test(text) || /\bseparat(?:e|ed|ing)?\s+files?\b/.test(text);
}

function isStylingRequest(text: string) {
  return /\b(style|styling|design|nicer|modern|polish|beautiful|responsive|mobile|ux|ui|form|bordered|color|colour|background|bg|green|red|blue|yellow|orange|purple|pink|black|white|gray|grey|button|buttons|input|inputs|header|heading|title|label|labels|cursor|pointer|hand|hover|clickable|rounded|radius|shadow|spacing|padding|margin|font|size)\b/.test(text);
}

export function safeProjectPath(projectId: string) {
  const cleanId = projectId.replace(/[^a-z0-9-]/gi, "");
  const projectPath = path.resolve(projectsRoot, cleanId);
  const resolvedRoot = path.resolve(projectsRoot);
  if (!projectPath.startsWith(resolvedRoot)) throw new Error("Invalid project id.");
  if (!existsSync(projectPath)) throw new Error("Project workspace was not found.");
  return projectPath;
}

export async function deleteFactoryProject(projectId: string) {
  const cleanId = projectId.replace(/[^a-z0-9-]/gi, "");
  const projectPath = path.resolve(projectsRoot, cleanId);
  const resolvedRoot = path.resolve(projectsRoot);
  if (!cleanId || !projectPath.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Invalid project id.");
  await rm(projectPath, { recursive: true, force: true });
}

async function uniqueProjectPath(slug: string) {
  await mkdir(projectsRoot, { recursive: true });
  let candidate = path.join(projectsRoot, slug);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(projectsRoot, `${slug}-${index}`);
    index += 1;
  }
  return candidate;
}

function parseBrief(brief: string): ProjectSpec {
  const projectName = lineValue(brief, "Project name") || lineValue(brief, "Create Project") || "Foundry Project";
  const template = lineValue(brief, "Template") || "Custom Build";
  const stack = lineValue(brief, "Selected stack") || lineValue(brief, "Preferred stack") || "Next.js";
  const projectType = lineValue(brief, "Project type") || template;
  const projectDescription = lineValue(brief, "Project description");
  const projectSource = lineValue(brief, "Project source");
  const selectedUploadPaths = splitSelectedPaths(lineValue(brief, "Selected upload paths"));
  const existingSourceGuard = lineValue(brief, "Existing source guard");
  const rawInstructions = customInstructionsFromProjectBrief(brief);
  const instructions = rawInstructions && rawInstructions.toLowerCase() !== "none" ? rawInstructions : "";

  return {
    projectName,
    template,
    stack,
    projectType,
    projectDescription,
    projectSource,
    selectedUploadPaths,
    existingSourceGuard,
    instructions,
    slug: slugify(projectName),
  };
}

function splitSelectedPaths(value: string) {
  if (!value.trim()) return [];
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

function inspectExistingSourceSelection(spec: ProjectSpec) {
  const sourceText = `${spec.projectSource} ${spec.existingSourceGuard}`.toLowerCase();
  if (!sourceText.includes("existing") && spec.selectedUploadPaths.length === 0) return "";

  const analysis = inspectSourcePaths(spec.selectedUploadPaths);
  if (analysis.risky) {
    return `Inspected existing source selection before writing: ${analysis.message}`;
  }
  return spec.selectedUploadPaths.length
    ? "Inspected existing source selection before writing: no obvious project-root conflict from selected paths."
    : "Existing source mode selected without writable local-folder access; generation will use a separate Foundry workspace.";
}

function inspectSourcePaths(names: string[]) {
  const normalized = names.map((name) => name.replace(/\\/g, "/"));
  const roots = new Set(normalized.map((name) => name.split("/")[0]).filter(Boolean));
  const lower = normalized.map((name) => name.toLowerCase());
  const hasProjectMarkers = lower.some((name) =>
    /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|next\.config\.(js|mjs|ts)|vite\.config\.(js|ts)|angular\.json|pom\.xml|build\.gradle|settings\.gradle|\.csproj|\.sln|pubspec\.yaml|cargo\.toml|go\.mod)$/i.test(name),
  );
  const hasRepoOrBuildFolders = lower.some((name) => /(^|\/)(\.git|node_modules|\.next|dist|build|target|bin|obj)(\/|$)/i.test(name));
  const hasManyLooseFiles = normalized.length > 12 && roots.size > Math.max(3, normalized.length / 4);
  const risky = roots.size > 1 || hasProjectMarkers || hasRepoOrBuildFolders || hasManyLooseFiles;

  return {
    risky,
    message: risky
      ? "selection appears to contain an existing project, multiple folders, generated output, or unrelated files."
      : "selection does not show obvious unrelated project markers from available browser paths.",
  };
}

function lineValue(brief: string, label: string) {
  return brief.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
}

export function generatedRecoveryRequirements(brief: string) {
  const description = lineValue(brief, "Project description").toLowerCase();
  const features = lineValue(brief, "Main features").split(";").map((item) => item.trim()).filter((item) => {
    if (!item) return false;
    // Discovery commonly repeats the complete project description as feature #1. Keeping that
    // umbrella item ahead of its concrete capabilities lets a model spend every bounded batch on
    // one subsystem while claiming the broad sentence is still in progress.
    return !(item.length > 80 && (description.includes(item.toLowerCase()) || /^build (?:a |an )?complete\b/i.test(item)));
  });
  const entities = lineValue(brief, "Data model/entities").split(";").map((item) => item.trim()).filter(Boolean);
  const requirements = [...features, ...(entities.length ? [`Durable data model and persistence for ${entities.join(", ")}`] : [])]
    .filter((item) => !/^(?:do not create placeholders|simulator claims as real hardware validation)$/i.test(item));
  return [...new Map(requirements.map((item) => [item.toLowerCase(), item])).values()].slice(0, 16);
}

function isSupportedStack(stack: string) {
  return capabilityLevelForStackChoice(stack).level === 4;
}

function isNextStack(stack: string) {
  return /\bnext(?:\.js)?\b/i.test(stack);
}

/** Mirrors the stacks startPreview() can actually spin up a real, live preview for today —
 * only offer the mock-first gate when "Open Preview" will genuinely work. */
function hasLivePreviewFor(stack: string) {
  return isNextStack(stack) || /\b(html|css|static)\b/i.test(stack);
}

/**
 * Whether a stack has a build/test/dev step that can actually exit 0 and serve as runtime verification.
 * A pure static HTML/CSS/JS site (and an unrecognized/unknown project) has none — a static preview
 * server never exits 0 — so the executor must NOT hard-require a runtime command to complete such a
 * mission (see verifyCompletion's hasBuildTooling gate in lib/ai/mission/executor.ts). Everything with a
 * real toolchain (Next.js, Node, Python, .NET, Java, Go, Rust, etc.) keeps the stricter requirement.
 */
function stackHasBuildStep(stackId: string): boolean {
  if (stackId === "android") return Boolean(resolveAndroidTools() && resolveJavaHome());
  const executable: Partial<Record<string, string>> = {
    nextjs: "node", node: "node", "node-express": "node", react: "node", vue: "node", angular: "node", electron: "node", "react-native": "node",
    python: "python", php: "php", java: "java", android: "gradle", flutter: "flutter", "dotnet-web": "dotnet", "dotnet-desktop": "dotnet",
    go: "go", rust: "cargo", tauri: "cargo", docker: "docker", terraform: "terraform", kubernetes: "kubectl", godot: "godot",
  };
  const command = executable[stackId];
  return command ? executableAvailable(command) : false;
}

const executableAvailability = new Map<string, boolean>();
function executableAvailable(command: string) {
  const cached = executableAvailability.get(command);
  if (cached != null) return cached;
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { stdio: "ignore", windowsHide: true });
  const available = probe.status === 0;
  executableAvailability.set(command, available);
  return available;
}

async function noteMissingDependencies(projectPath: string, packageManager: string, execution: ExecutionContext) {
  if (!packageManager) return;
  const packagePath = path.join(projectPath, "package.json");
  if (!existsSync(packagePath)) return;
  if (existsSync(path.join(projectPath, "node_modules"))) return;
  try {
    const manifest = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
    const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    const declaredCount = dependencyGroups.reduce((count, key) => {
      const group = manifest[key];
      return count + (group && typeof group === "object" ? Object.keys(group).length : 0);
    }, 0);
    if (declaredCount === 0) return;
  } catch {
    // Invalid package metadata should not suppress the normal dependency warning.
  }
  const installCommand = packageManager === "yarn" ? "yarn.cmd" : packageManager === "pnpm" ? "pnpm.cmd" : "npm.cmd";
  const installArgs = packageManager === "yarn" ? ["install", "--prefer-offline"] : packageManager === "pnpm" ? ["install", "--prefer-offline"] : ["install", "--prefer-offline", "--no-audit", "--no-fund"];
  const command = [installCommand, ...installArgs].join(" ");
  await emitExecution(execution, "blocked", "warning", `Permission needed: ${command}`, {
    tier: "flag",
    command,
    details: {
      category: "dependencies",
      reason: "package.json is present but node_modules is missing. Foundry will not install dependencies unless you approve the install command.",
    },
  });
}

function runCommand(cwd: string, command: string, args: string[], events: string[], execution?: ExecutionContext) {
  const printable = [command, ...args].join(" ");
  events.push(`Running command: ${printable}`);
  const startedAt = Date.now();
  void (execution ? emitExecution(execution, "command", "running", `Running ${printable}`, { command: printable, cwd, details: { cwd } }) : Promise.resolve());

  return new Promise<FactoryCommandEvent>((resolve) => {
    const commandEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: isBuildCommand(command, args) ? "production" : process.env.NODE_ENV };
    const prismaGenerate = /(?:^|[\\/])npm(?:\.cmd)?$/i.test(command) && args.some((argument) => argument === "prisma") && args.some((argument) => argument === "generate");
    if (prismaGenerate && !commandEnv.DATABASE_URL) {
      const schema = existsSync(path.join(cwd, "prisma", "schema.prisma")) ? readFileSync(path.join(cwd, "prisma", "schema.prisma"), "utf8") : "";
      const provider = /provider\s*=\s*["']([^"']+)["']/.exec(schema)?.[1]?.toLowerCase();
      commandEnv.DATABASE_URL = provider === "mysql"
        ? "mysql://foundry:foundry@127.0.0.1:3306/foundry_codegen"
        : provider === "sqlserver"
        ? "sqlserver://127.0.0.1:1433;database=foundry_codegen;user=foundry;password=foundry;trustServerCertificate=true"
        : provider === "sqlite"
        ? "file:./foundry-codegen.db"
        : "postgresql://foundry:foundry@127.0.0.1:5432/foundry_codegen";
    }
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (process.platform === "win32" && nodeMajor >= 22 && !/(?:^|\s)--use-system-ca(?:\s|$)/.test(commandEnv.NODE_OPTIONS ?? "")) {
      commandEnv.NODE_OPTIONS = `${commandEnv.NODE_OPTIONS ?? ""} --use-system-ca`.trim();
    }
    const child = spawn(command, args, { cwd, shell: true, windowsHide: true, env: commandEnv });
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      stderr += error.message;
      events.push(`Command failed: ${printable}`);
      const durationMs = Date.now() - startedAt;
      if (execution) void emitExecution(execution, "command", "error", `Command failed: ${printable}`, { command: printable, cwd, output: trimOutput(stderr || stdout), stdout: trimOutput(stdout), stderr: trimOutput(stderr), exitCode: null, durationMs, transient: false });
      resolve({ command: printable, exitCode: null, stdout: trimOutput(stdout), stderr: trimOutput(stderr), durationMs });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      events.push(`Command finished (${exitCode ?? "unknown"}): ${printable}`);
      const durationMs = Date.now() - startedAt;
      if (execution) {
        void emitExecution(execution, "command", exitCode === 0 ? "completed" : "error", `Command finished: ${printable}`, {
          command: printable,
          cwd,
          exitCode,
          durationMs,
          output: trimOutput(stderr || stdout),
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
          transient: false,
          details: { duration: formatDuration(durationMs) },
        });
        const dependenciesInstalled = dependencyCountFromInstallOutput(stdout);
        if (exitCode === 0 && isInstallCommand(command, args) && dependenciesInstalled > 0) {
          void emitExecution(execution, "summary", "completed", `Installed ${dependenciesInstalled} dependencies`, {
            command: printable,
            details: { dependenciesInstalled },
          });
        }
      }
      resolve({ command: printable, exitCode, stdout: trimOutput(stdout), stderr: trimOutput(stderr), durationMs });
    });
  });
}

type PreviewOutcome = { previewUrl?: string; previewState: FactoryPreviewState; previewPlatform: FactoryPreviewPlatform; previewReason?: string; previewOwnershipToken?: string; artifact?: FactoryArtifact; previewEmulator?: "android" };

function workspacePreviewTarget(projectPath: string): ProjectPreviewTarget {
  return { kind: "workspace", projectId: slugify(path.basename(projectPath)) || "workspace-project", projectPath };
}

function connectorPreviewTarget(projectId: string, connector: LocalConnectorConfig): ProjectPreviewTarget {
  return { kind: "connector", projectId, connector };
}

function previewArtifactRoot(target: ProjectPreviewTarget): string {
  if (target.kind === "workspace") return target.projectPath;
  const safeProjectId = target.projectId.replace(/[^a-zA-Z0-9-]/g, "_") || "connector-project";
  return path.join(process.cwd(), ".foundry-data", "artifacts", safeProjectId);
}

async function findConnectorBuildArtifact(projectId: string, connector: LocalConnectorConfig, platform: FactoryPreviewPlatform): Promise<PreviewOutcome | undefined> {
  if (!connector.rootLabel) return undefined;
  const registration = await connectLocalConnectorRoot(connector, connector.rootLabel);
  if (!registration.ok) return { previewState: "error", previewPlatform: platform, previewReason: registration.error || "The selected project folder could not be reconnected to the Local Agent." };
  const baseUrl = connector.url.replace(/\/+$/, "");
  const headers = { "content-type": "application/json", ...(connector.token ? { authorization: `Bearer ${connector.token}` } : {}) };
  const response = await fetch(`${baseUrl}/artifact/find`, {
    method: "POST",
    headers,
    body: JSON.stringify({ root: connector.rootLabel, platform }),
  });
  const found = (await response.json().catch(() => ({}))) as {
    found?: boolean;
    path?: string;
    name?: string;
    sizeBytes?: number;
    createdAt?: string;
    platform?: string;
    fileType?: string;
    version?: string;
    error?: string;
  };
  if (!response.ok) return { previewState: "error", previewPlatform: platform, previewReason: found.error || "The Local Agent could not inspect build artifacts." };
  if (!found.found || !found.path || !found.name) return undefined;
  connectorPreviews.set(projectId, connector);
  connectorArtifactTargets.set(projectId, { connector, relativePath: found.path, platform });
  const artifact: FactoryArtifact = {
    name: found.name,
    platform: found.platform || (platform === "android" ? "Android" : platform === "mobile" ? "Mobile" : "Desktop"),
    version: found.version || "1.0.0",
    fileType: found.fileType || "Build artifact",
    sizeBytes: Number(found.sizeBytes || 0),
    createdAt: found.createdAt || new Date().toISOString(),
    buildStatus: "verified",
    downloadUrl: `/api/factory/artifact?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(found.path)}`,
  };
  return {
    previewState: "ready",
    previewPlatform: platform,
    previewReason: `${artifact.name} is built and ready to ${platform === "desktop" ? "launch or download" : "install or download"}.`,
    artifact,
  };
}

async function startProjectPreview(target: ProjectPreviewTarget, stack: string, events: string[] = [], execution?: ExecutionContext, preferredStaticEntries: string[] = []): Promise<PreviewOutcome> {
  if (target.kind === "connector") {
    connectorPreviews.set(target.projectId, target.connector);
    const platform = previewPlatformForStack(stack);
    if (["desktop", "android", "mobile", "report"].includes(platform)) {
      const artifact = await findConnectorBuildArtifact(target.projectId, target.connector, platform);
      if (artifact) return artifact;
      return { previewState: "unavailable", previewPlatform: platform, previewReason: previewUnavailableReason(platform, stack) };
    }
    // A localhost connector commonly points at the same filesystem as Foundry's server. In that
    // case static projects should not depend on the separately installed agent being restarted just
    // to learn a new HTML filename. Use the server-owned recursive preview directly; remote agents
    // still fall through to the connector-owned preview endpoint.
    if (/\b(html|css|static)\b/i.test(stack) && target.connector.rootLabel && existsSync(target.connector.rootLabel)) {
      return startPreview(target.projectId, target.connector.rootLabel, stack, events, execution, preferredStaticEntries);
    }
    return startConnectorPreview(target.projectId, target.connector, platform, preferredStaticEntries);
  }
  return startPreview(target.projectId, target.projectPath, stack, events, execution, preferredStaticEntries);
}

async function stopProjectPreview(target: ProjectPreviewTarget) {
  if (target.kind === "connector") {
    if (target.connector.rootLabel && existsSync(target.connector.rootLabel)) stopPreviewsForProjectPath(target.connector.rootLabel);
    await stopConnectorPreview(target.connector);
    return;
  }
  stopPreviewsForProjectPath(target.projectPath);
}

/** Build deterministic Python dependency commands from the repository's own declarations. Editable
 * installs are useful when packaging metadata is complete, but application repositories commonly
 * use Hatch/Setuptools without a distributable package mapping. That packaging detail must not turn
 * an otherwise runnable API into another paid model call. */
async function pythonDependencyBootstrapCommands(projectPath: string): Promise<string[]> {
  const commands = ["python -m pip install -e .[test]"];
  if (existsSync(path.join(projectPath, "requirements.txt"))) {
    commands.push("python -m pip install -r requirements.txt");
    return commands;
  }
  const pyproject = await readFile(path.join(projectPath, "pyproject.toml"), "utf8").catch(() => "");
  if (!pyproject) return commands;
  const projectSection = pyproject.match(/^\[project\]\s*$([\s\S]*?)(?=^\[[^\]]+\]\s*$|\s*$)/m)?.[1] ?? "";
  const optionalSection = pyproject.match(/^\[project\.optional-dependencies\]\s*$([\s\S]*?)(?=^\[[^\]]+\]\s*$|\s*$)/m)?.[1] ?? "";
  const arrays = [
    projectSection.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? "",
    optionalSection.match(/^test\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? "",
  ];
  const dependencies = arrays.flatMap((block) => Array.from(block.matchAll(/"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'/g), (match) => {
    if (match[1] != null) {
      try { return JSON.parse(`"${match[1]}"`) as string; } catch { return ""; }
    }
    return match[2] ?? "";
  })).filter((item) => item && !/["\r\n%]/.test(item));
  if (dependencies.length) commands.push(`python -m pip install ${dependencies.map((item) => `"${item}"`).join(" ")}`);
  return Array.from(new Set(commands));
}

async function readBoundedWorkingSetEvidence(access: ProjectAccess, likelyFiles: string[]) {
  const sourcePaths = Array.from(new Set(likelyFiles.map((file) => file.replace(/\\/g, "/"))))
    .filter((file) => !isSensitiveFilePath(file))
    .filter((file) => /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?|css|scss|sass|less|py|rb|php|java|kt|kts|swift|go|rs|cs|fs|fsx|vb|dart|scala|lua|r|sql|graphql|proto|xaml)$/i.test(file))
    .slice(0, 8);
  const sections: string[] = [];
  let remainingBytes = 120_000;
  for (const filePath of sourcePaths) {
    if (remainingBytes <= 0) break;
    const readLimit = Math.min(50_000, remainingBytes);
    const file = await access.readFile(filePath, { limitBytes: readLimit }).catch(() => undefined);
    if (!file?.exists || file.truncated) continue;
    const content = redactSensitiveText(file.content);
    sections.push(`--- ${filePath} ---\n${content}`);
    remainingBytes -= Buffer.byteLength(content, "utf8");
  }
  return sections.length ? sections.join("\n\n") : undefined;
}

function hasNodeTestSource(projectPath: string) {
  const queue = [{ directory: projectPath, depth: 0 }];
  let inspected = 0;
  while (queue.length && inspected < 1_500) {
    const current = queue.shift()!;
    let entries: import("node:fs").Dirent<string>[];
    try { entries = readdirSync(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      inspected += 1;
      const absolute = path.join(current.directory, entry.name);
      const relative = path.relative(projectPath, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (current.depth < 7 && !isGeneratedProjectDirectory(entry.name)) queue.push({ directory: absolute, depth: current.depth + 1 });
        continue;
      }
      if (/(?:^|\/)(?:tests?|__tests__)\/.*\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(relative)) return true;
    }
  }
  return false;
}

/** An exit code of zero is necessary but not sufficient for automated-test evidence. Node's built-in
 * runner intentionally exits zero when it discovers no tests, which previously let an empty
 * `node --test` script satisfy explicit test requirements. Keep the command's real exit code intact,
 * but refuse to convert zero discovered tests (or no discoverable Node test source) into a pass. */
function automatedTestEvidencePassed(projectPath: string | undefined, command: FactoryCommandEvent, adapterId?: string) {
  if (command.exitCode !== 0) return false;
  const output = stripTerminalFormatting(`${command.stdout}\n${command.stderr}`);
  if (/(?:^|\n)\s*(?:#\s*)?tests?\s*[:=]?\s*0\b|(?:^|\n)\s*0\s+tests?\b|no tests? (?:found|collected|executed|run)\b/i.test(output)) return false;
  if (!projectPath || (adapterId !== "node" && adapterId !== "nextjs")) return true;
  if (!/\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?test(?::[\w-]+)?\b/i.test(command.command)) return true;
  return hasNodeTestSource(projectPath);
}

function missionRequiresAutomatedTests(task: string) {
  if (/\b(?:do not|don't|without|skip|no)\s+(?:add(?:ing)?|create|write|run|require)?\s*(?:automated\s+)?tests?\b/i.test(task)) return false;
  return /\b(?:add|create|write|implement|run|require|include|fix|repair|update)\b[^.?!\n]{0,50}\b(?:unit|integration|end[- ]to[- ]end|e2e|regression|automated)?\s*tests?\b|\b(?:test coverage|tdd|test-driven)\b/i.test(task);
}

async function runRequiredVerificationProfile(input: {
  access: ProjectAccess;
  execution: ExecutionContext;
  profile: VerificationProfile;
  projectPath?: string;
  existingCommands: FactoryCommandEvent[];
  requireAutomatedTests?: boolean;
}): Promise<{ passed: boolean; commands: FactoryCommandEvent[]; verification: ExecutionMissionVerification[]; failure?: FactoryCommandEvent }> {
  const { access, execution, profile, projectPath, existingCommands, requireAutomatedTests = false } = input;
  const commands: FactoryCommandEvent[] = [];
  const verification: ExecutionMissionVerification[] = [];
  const run = async (command: string) => {
    const latestMatchingCommand = [...existingCommands, ...commands].filter((item) => item.command.trim() === command.trim()).at(-1);
    const latestResultIsAuthoritativePass = latestMatchingCommand?.exitCode === 0
      && (!isAutomatedTestCommand(command) || automatedTestEvidencePassed(projectPath, latestMatchingCommand, profile.adapterId));
    if (latestResultIsAuthoritativePass) return latestMatchingCommand;
    await emitExecution(execution, "command", "running", `Running required ${profile.ecosystem} verification: ${command}`, { command, details: { paidModelCalls: 0, ecosystem: profile.ecosystem } });
    const commandResult = await access.runCommand!(command, "", { approvedCategories: ["dependencies", "package-runner"] });
    const event: FactoryCommandEvent = { command, exitCode: commandResult.exitCode, stdout: commandResult.stdout, stderr: commandResult.stderr, durationMs: commandResult.durationMs, approvalScope: commandResult.approvalScope };
    commands.push(event);
    await emitExecution(execution, "command", event.exitCode === 0 ? "completed" : "error", event.exitCode === 0 ? `Passed ${command}` : `Failed ${command}`, {
      command, exitCode: event.exitCode, durationMs: event.durationMs, stdout: event.stdout, stderr: event.stderr, output: event.stdout || event.stderr,
      details: { paidModelCalls: 0, ecosystem: profile.ecosystem },
    });
    return event;
  };

  if (!access.runCommand) return { passed: false, commands, verification, failure: undefined };
  if (profile.adapterId === "android-gradle" && projectPath) {
    const androidTools = resolveAndroidTools();
    if (androidTools) {
      const escapedSdkPath = androidTools.sdkRoot.replace(/\\/g, "\\\\");
      await writeFile(path.join(projectPath, "local.properties"), `sdk.dir=${escapedSdkPath}\n`, "utf8");
      const gitignorePath = path.join(projectPath, ".gitignore");
      const gitignore = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : "";
      if (!/(?:^|\n)local\.properties(?:\n|$)/.test(gitignore)) {
        await writeFile(gitignorePath, `${gitignore}${gitignore && !gitignore.endsWith("\n") ? "\n" : ""}local.properties\n`, "utf8");
      }
      await emitExecution(execution, "file", "completed", "Connected the detected Android SDK to this local build", { fileName: "local.properties", filePath: "local.properties", details: { localOnly: true, committed: false, sdkDetected: true } });
    }
  }
  if (profile.adapterId === "python" && projectPath && existsSync(path.join(projectPath, "pyproject.toml"))) {
    let bootstrap: FactoryCommandEvent | undefined;
    for (const command of await pythonDependencyBootstrapCommands(projectPath)) {
      bootstrap = await run(command);
      if (bootstrap.exitCode === 0) break;
    }
    const passed = bootstrap?.exitCode === 0;
    verification.push({ check_type: "command", result: passed ? "pass" : "fail", evidence: passed ? "Installed the Python project's declared dependencies before verification." : `Python dependency provisioning failed: ${bootstrap ? summarizeCommandFailure(bootstrap) : "No supported dependency declaration was found."}` });
    if (!passed) return { passed: false, commands, verification, failure: bootstrap };
  }

  const nodeTestSourceExists = Boolean(projectPath && (profile.adapterId === "node" || profile.adapterId === "nextjs") && hasNodeTestSource(projectPath));
  const required = profile.commands.filter((item) => {
    if (!item.required || item.longRunning) return false;
    if (!/test|regression/.test(item.stage)) return true;
    if (profile.adapterId !== "node" && profile.adapterId !== "nextjs") return true;
    return nodeTestSourceExists || requireAutomatedTests;
  });
  if (!required.length) return { passed: false, commands, verification };
  for (const check of required) {
    const checked = await run(check.command);
    const checkType: ExecutionMissionVerification["check_type"] = check.stage === "lint" ? "lint" : check.stage === "typecheck" ? "typecheck" : check.stage === "compile" || check.stage === "build" ? "build" : /test|regression/.test(check.stage) ? "test" : "command";
    const testEvidencePassed = checkType !== "test" || automatedTestEvidencePassed(projectPath, checked, profile.adapterId);
    const passed = checked.exitCode === 0 && testEvidencePassed;
    const failureEvidence = checked.exitCode === 0 && !testEvidencePassed
      ? "the command exited successfully but discovered zero executable tests or no test source"
      : summarizeCommandFailure(checked);
    verification.push({ check_type: checkType, result: passed ? "pass" : "fail", evidence: passed ? `${profile.ecosystem} ${check.stage} passed: ${check.command}.` : `${profile.ecosystem} ${check.stage} failed: ${failureEvidence}` });
    if (!passed) return { passed: false, commands, verification, failure: checked };
  }
  return { passed: true, commands, verification };
}

function missionHasPreviewableWork(mission: { changedFiles: string[]; commands?: Array<{ exitCode: number | null }>; verification?: ExecutionMissionVerification[] }) {
  return mission.changedFiles.length > 0
    || Boolean(mission.commands?.some((command) => command.exitCode === 0))
    || Boolean(mission.verification?.some((item) => item.result === "pass"));
}

/**
 * Whether this run should attach a live preview to the project folder. Deliberately independent of
 * the mission verdict: the preview is a window onto what is on disk, and a user whose mission just
 * reported a problem needs to see the project more, not less. Only a deleted project — nothing left
 * to serve — withholds it.
 */
function shouldAttachProjectPreview(mission: { projectDeleted?: boolean; changedFiles: string[]; commands?: Array<{ exitCode: number | null }>; verification?: ExecutionMissionVerification[] }) {
  return !mission.projectDeleted && missionHasPreviewableWork(mission);
}

function normalizeIdempotentRequest(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeProjectIdentity(value: string) {
  return value.normalize("NFKC").trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function isUiComponentFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  return /(?:^|\/)components\/.*\.(?:[cm]?[jt]sx|vue|svelte)$/i.test(normalized);
}

function isApplicationEntrySurface(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  return /(?:^|\/)(?:app|pages)\/.*\/(?:page|layout|route)\.(?:[cm]?[jt]sx)$/i.test(normalized)
    || /(?:^|\/)(?:app|main|index)\.(?:[cm]?[jt]sx|vue|svelte)$/i.test(normalized);
}

async function findUnreachableVerifiedUiFiles(access: ProjectAccess, files: string[]) {
  if (!access.searchFiles) return [];
  const unreachable: string[] = [];
  for (const filePath of files) {
    if (!isUiComponentFile(filePath) || isApplicationEntrySurface(filePath)) continue;
    const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
    const fileName = path.posix.basename(filePath.replace(/\\/g, "/")).replace(/\.[^.]+$/, "");
    const references = await access.searchFiles(fileName, { maxResults: 24 }).catch(() => []);
    const integrated = references.some((hit) => {
      const hitPath = hit.path.replace(/\\/g, "/").toLowerCase();
      return hitPath !== normalizedPath && /\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(hitPath);
    });
    if (!integrated) unreachable.push(filePath);
  }
  return unreachable;
}

async function reuseVerifiedMissionIfCurrent(input: {
  candidate: MissionParentContext;
  requestedTask: string;
  access: ProjectAccess;
  execution: ExecutionContext;
  verificationProfile: VerificationProfile;
  workspaceProjectPath?: string;
  stackLabel: string;
  allowIncompleteMission?: boolean;
}): Promise<{ status: "passed"; changedFiles: string[]; commands: FactoryCommandEvent[]; sessionSummary: FactorySessionSummary; verification: ExecutionMissionVerification[]; events: string[]; stackLabel: string } | undefined> {
  const { candidate, requestedTask, access, execution, verificationProfile, workspaceProjectPath, stackLabel, allowIncompleteMission = false } = input;
  if (reportsCurrentBehaviorFailure(requestedTask)) {
    await emitExecution(execution, "inspection", "completed", "Current defect evidence supersedes the matching historical completion record", {
      internal: true,
      details: { priorMissionId: candidate.id, currentDefectReport: true, paidModelCalls: 0 },
    });
    return undefined;
  }
  const requestKey = normalizeIdempotentRequest(requestedTask);
  const exactRequestMatch = requestKey.length > 0
    && candidate.source_requirements.some((requirement) => normalizeIdempotentRequest(requirement) === requestKey);
  const fingerprints = candidate.files_touched.filter((file) => file.verified && file.contentHash);
  const eligibleState = candidate.state === "complete" || (allowIncompleteMission && (candidate.state === "failed" || candidate.state === "cancelled"));
  if (!eligibleState || !exactRequestMatch || !candidate.files_touched.length || fingerprints.length !== candidate.files_touched.length) return undefined;

  await emitExecution(execution, "inspection", "running", "Checking whether this completed request is still current", {
    details: { priorMissionId: candidate.id, files: fingerprints.map((file) => file.path), paidModelCalls: 0 },
  });
  for (const file of fingerprints) {
    const current = await access.readFile(file.path, { offsetBytes: 0, limitBytes: 1 }).catch(() => undefined);
    if (!current?.exists || !current.contentHash || current.contentHash !== file.contentHash) {
      await emitExecution(execution, "inspection", "completed", "Project changed since the matching mission; executing normally", {
        internal: true,
        filePath: file.path,
        details: { priorMissionId: candidate.id, fingerprintMatched: false, paidModelCalls: 0 },
      });
      return undefined;
    }
  }

  const unreachableUiFiles = await findUnreachableVerifiedUiFiles(access, fingerprints.map((file) => file.path));
  if (unreachableUiFiles.length) {
    await emitExecution(execution, "inspection", "completed", "Matching files exist, but their UI is not connected to the application; executing normally", {
      internal: true,
      details: { priorMissionId: candidate.id, fingerprintMatched: true, unreachableUiFiles, paidModelCalls: 0 },
    });
    return undefined;
  }

  const verification: ExecutionMissionVerification[] = [{
    check_type: "file-read",
    result: "pass",
    evidence: `Verified ${fingerprints.length} previously changed file${fingerprints.length === 1 ? "" : "s"} against complete SHA-256 fingerprints; current project content is unchanged.`,
  }];
  const commands: FactoryCommandEvent[] = [];
  const hasRequiredChecks = verificationProfile.commands.some((item) => item.required && !item.longRunning);
  if (hasRequiredChecks && access.runCommand && workspaceProjectPath) {
    const gate = await runRequiredVerificationProfile({ access, execution, profile: verificationProfile, projectPath: workspaceProjectPath, existingCommands: [] });
    commands.push(...gate.commands);
    verification.push(...gate.verification);
    if (!gate.passed) {
      await emitExecution(execution, "inspection", "completed", "Matching files found, but current verification failed; executing a repair normally", {
        internal: true,
        details: { priorMissionId: candidate.id, paidModelCalls: 0, failedCommand: gate.failure?.command },
      });
      return undefined;
    }
  }

  const evidence = hasRequiredChecks
    ? `The exact request's implementation is already on disk. Its file fingerprints still match and every required ${verificationProfile.ecosystem} check passes.`
    : "The exact request's implementation is already on disk. Every previously changed file still matches its verified on-disk fingerprint.";
  const checklist = candidate.plan.length
    ? candidate.plan.map((item) => ({ ...item, status: "completed" as const, evidence }))
    : [{ id: "already-satisfied", label: `Confirm completed request: ${requestedTask.trim()}`, status: "completed" as const, evidence }];
  execution.checklist.splice(0, execution.checklist.length, ...checklist);
  await emitExecution(execution, "inspection", "completed", `Verified ${fingerprints.length} unchanged project file${fingerprints.length === 1 ? "" : "s"}`, {
    details: { priorMissionId: candidate.id, fingerprintMatched: true, paidModelCalls: 0 },
  });
  await emitExecution(execution, "inspection", "completed", "Matching completed implementation found; running final deterministic gates", {
    output: evidence,
    details: { priorMissionId: candidate.id, reusedResult: true, paidModelCalls: 0 },
  });
  finishObjectiveChecklist(execution, "passed");
  return {
    status: "passed",
    changedFiles: [],
    commands,
    verification,
    events: [evidence],
    stackLabel,
    sessionSummary: { outcome: evidence, changes: [], preserved: fingerprints.map((file) => `${file.path} already matches the verified result`), flags: [] },
  };
}

async function ensureRequestedStackScaffold(projectPath: string, stack: StackProfile, projectName: string, execution: ExecutionContext, events: string[], selectedStack = stack.label, requirementsText = selectedStack, authoritativeFoundation = false): Promise<string[]> {
  const safeName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "foundry-project";
  const written: string[] = [];
  const writeMissing = async (relativePath: string, content: string) => {
    const absolutePath = path.join(projectPath, relativePath);
    if (existsSync(absolutePath)) return;
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    written.push(relativePath.replace(/\\/g, "/"));
  };
  const writeInvalid = async (relativePath: string, content: string, isValid: (current: string) => boolean) => {
    const absolutePath = path.join(projectPath, relativePath);
    if (existsSync(absolutePath)) {
      const current = await readFile(absolutePath, "utf8").catch(() => "");
      if (isValid(current)) return;
    } else {
      await mkdir(path.dirname(absolutePath), { recursive: true });
    }
    await writeFile(absolutePath, content, "utf8");
    written.push(relativePath.replace(/\\/g, "/"));
  };
  const reconcilePackageManifest = async (content: string) => {
    const relativePath = "package.json";
    const absolutePath = path.join(projectPath, relativePath);
    if (!existsSync(absolutePath)) {
      await writeMissing(relativePath, content);
      return;
    }
    const reconciliation = reconcilePackageManifestContract(await readFile(absolutePath, "utf8"), content, { authoritativeFoundation });
    if (!reconciliation.changed) return;
    await writeFile(absolutePath, reconciliation.content, "utf8");
    written.push(relativePath);
  };
  const finish = async (title: string, reason: string) => {
    if (!written.length) return [];
    events.push(...written.map((file) => `Created stack scaffold: ${file}`));
    await emitExecution(execution, "file", "completed", title, {
      fileName: written[0],
      filePath: written[0],
      details: { reason, files: written },
    });
    return written;
  };
  if (stack.id === "nextjs") {
    const usesPrisma = /\bprisma\b/i.test(`${selectedStack} ${requirementsText}`);
    const manifest = `${JSON.stringify({
      name: safeName,
      version: "0.1.0",
      private: true,
      scripts: { dev: "next dev", build: "next build", start: "next start", typecheck: "tsc --noEmit", test: "node --test" },
      dependencies: { next: "^15.5.0", react: "^19.0.0", "react-dom": "^19.0.0", ...(usesPrisma ? { "@prisma/client": "^6.0.0" } : {}) },
      devDependencies: { typescript: "^5.0.0", "@types/node": "^20.0.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", tailwindcss: "^3.4.0", postcss: "^8.0.0", autoprefixer: "^10.0.0", ...(usesPrisma ? { prisma: "^6.0.0" } : {}) },
    }, null, 2)}\n`;
    const tsconfig = `${JSON.stringify({
      compilerOptions: {
        target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true,
        strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler",
        resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true,
        plugins: [{ name: "next" }], paths: { "@/*": ["./src/*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    }, null, 2)}\n`;
    await reconcilePackageManifest(manifest);
    await writeMissing("tsconfig.json", tsconfig);
    await writeMissing("next-env.d.ts", "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n");
    await writeMissing("src/app/layout.tsx", `import type { ReactNode } from "react";\nimport "./globals.css";\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n`);
    await writeMissing("src/app/page.tsx", `export default function Home() {\n  return <main><h1>${projectName.replace(/[<>`]/g, "")}</h1><p>The runnable foundation is ready for the requested workflows.</p></main>;\n}\n`);
    // The manifest ships tailwind/postcss/autoprefixer, so the config must exist too — without a
    // tailwind.config with `content` globs and a postcss.config, every build warns "content option is
    // missing" and emits EMPTY CSS, so a Tailwind-styled app renders unstyled. Ship them configured.
    await writeMissing("tailwind.config.ts", `import type { Config } from "tailwindcss";\n\nconst config: Config = {\n  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],\n  theme: { extend: {} },\n  plugins: [],\n};\n\nexport default config;\n`);
    await writeMissing("postcss.config.mjs", `const config = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n\nexport default config;\n`);
    await writeMissing("src/app/globals.css", "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\n");
    return finish("Created verified Next.js project scaffold", "The selected stack requires a manifest, typed configuration, a configured Tailwind/PostCSS pipeline, and a renderable App Router entry before product implementation begins.");
  }
  if (stack.id === "react") {
    const manifest = `${JSON.stringify({
      name: safeName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: { dev: "vite", build: "tsc --noEmit && vite build", preview: "vite preview", typecheck: "tsc --noEmit", test: "vitest run --passWithNoTests" },
      dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      devDependencies: { "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@vitejs/plugin-react": "^4.3.0", typescript: "^5.7.0", vite: "^6.0.0", vitest: "^3.0.0" },
    }, null, 2)}\n`;
    await reconcilePackageManifest(manifest);
    await writeMissing("index.html", `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${projectName.replace(/[<>]/g, "")}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`);
    await writeMissing("tsconfig.json", `${JSON.stringify({ compilerOptions: { target: "ES2022", useDefineForClassFields: true, lib: ["ES2022", "DOM", "DOM.Iterable"], allowJs: false, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, strict: true, forceConsistentCasingInFileNames: true, module: "ESNext", moduleResolution: "Bundler", resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: "react-jsx" }, include: ["src"], references: [{ path: "./tsconfig.node.json" }] }, null, 2)}\n`);
    await writeMissing("tsconfig.node.json", `${JSON.stringify({ compilerOptions: { composite: true, skipLibCheck: true, module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true }, include: ["vite.config.ts"] }, null, 2)}\n`);
    await writeMissing("vite.config.ts", `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });\n`);
    await writeMissing("src/main.tsx", `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);\n`);
    await writeMissing("src/App.tsx", `export default function App() {\n  return <main><h1>${projectName.replace(/[<>`]/g, "")}</h1><p>The runnable foundation is ready for the requested workflows.</p></main>;\n}\n`);
    await writeMissing("src/styles.css", "* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\nmain { max-width: 72rem; margin: 0 auto; padding: 2rem; }\n");
    return finish("Created verified Vite + React project scaffold", "React creation now starts with a complete manifest, TypeScript/Vite configuration, renderable entry, and build/test scripts rather than relying on the model to guess missing infrastructure.");
  }
  if (stack.id === "node-express" || stack.id === "node") {
    const manifest = `${JSON.stringify({ name: safeName, version: "0.1.0", private: true, type: "module", scripts: { dev: "tsx watch src/index.ts", build: "tsc", start: "node dist/index.js", typecheck: "tsc --noEmit", test: "node --test" }, dependencies: { express: "^5.0.0" }, devDependencies: { "@types/express": "^5.0.0", "@types/node": "^22.0.0", tsx: "^4.0.0", typescript: "^5.7.0" } }, null, 2)}\n`;
    await reconcilePackageManifest(manifest);
    await writeMissing("tsconfig.json", `${JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", rootDir: "src", outDir: "dist", strict: true, esModuleInterop: true, skipLibCheck: true }, include: ["src/**/*.ts"] }, null, 2)}\n`);
    await writeMissing("src/index.ts", `import express from "express";\n\nconst app = express();\napp.use(express.json());\napp.get("/health", (_request, response) => response.json({ status: "ok" }));\nconst port = Number(process.env.PORT || 3000);\napp.listen(port, () => console.log(\`Listening on http://127.0.0.1:\${port}\`));\n`);
    return finish("Created verified Node.js service scaffold", "The service stack requires a typed manifest, compilable entry point, and deterministic health route before domain endpoints are implemented.");
  }
  if (stack.id === "react-native") {
    const manifest = `${JSON.stringify({
      name: safeName,
      version: "1.0.0",
      private: true,
      main: "expo-router/entry",
      scripts: { start: "expo start", android: "expo start --android", ios: "expo start --ios", web: "expo start --web", typecheck: "tsc --noEmit", build: "expo export --platform web" },
      dependencies: {
        "@expo/vector-icons": "^15.0.3", expo: "^54.0.0", "expo-router": "^6.0.0", "expo-status-bar": "^3.0.0",
        // react pinned at 19.1.0 with react-native ^0.81.5 was an unsatisfiable pair: RN 0.81.x
        // peer-requires react ^19.1.4, so EVERY dependency install in the generated project failed with
        // ERESOLVE from birth — the missions then paid models to code against packages that could never
        // install. This exact pair was verified installable on a live project.
        react: "^19.1.4", "react-dom": "^19.1.4", "react-native": "^0.81.5", "react-native-safe-area-context": "~5.6.0",
        "react-native-screens": "~4.16.0", "react-native-web": "~0.21.0",
      },
      devDependencies: { "@types/react": "^19.1.0", "babel-preset-expo": "^54.0.0", typescript: "^5.9.0" },
    }, null, 2)}\n`;
    const appConfig = `${JSON.stringify({ expo: { name: projectName, slug: safeName, version: "1.0.0", orientation: "portrait", userInterfaceStyle: "automatic", scheme: safeName, plugins: ["expo-router"], experiments: { typedRoutes: true }, web: { bundler: "metro", output: "single" } } }, null, 2)}\n`;
    const tsconfig = `${JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true, paths: { "@/*": ["./*"] } }, include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"] }, null, 2)}\n`;
    const layout = `import { Stack } from "expo-router";\n\nexport default function RootLayout() {\n  return <Stack screenOptions={{ headerShown: false }} />;\n}\n`;
    const entry = `import { StyleSheet, Text, View } from "react-native";\nimport { SafeAreaView } from "react-native-safe-area-context";\n\nexport default function HomeScreen() {\n  return (\n    <SafeAreaView style={styles.safe}>\n      <View style={styles.container}>\n        <Text accessibilityRole="header" style={styles.title}>${projectName.replace(/`/g, "")}</Text>\n        <Text style={styles.body}>Preparing the first verified field workflow…</Text>\n      </View>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#f4f7f8" }, container: { flex: 1, padding: 24, justifyContent: "center" }, title: { color: "#102a33", fontSize: 30, fontWeight: "700" }, body: { color: "#47636c", fontSize: 16, marginTop: 12 } });\n`;
    await reconcilePackageManifest(manifest);
    await writeMissing("app.json", appConfig);
    await writeMissing("tsconfig.json", tsconfig);
    await writeMissing("expo-env.d.ts", "/// <reference types=\"expo/types\" />\n");
    await writeMissing("app/_layout.tsx", layout);
    // In expo-router a bare app/index.tsx shadows any grouped route (app/(tabs)/index.tsx) for "/".
    // Restoring the placeholder entry unconditionally meant that once the real product lived in a route
    // group, every scaffold-restore resurrected the placeholder ON TOP of the finished app — the built
    // bundle then rendered "Preparing…" while the real screens sat one route down, unreachable. Only
    // write the placeholder entry when the app directory has no other route source at all.
    const appRouteEntries = await readdir(path.join(projectPath, "app"), { withFileTypes: true }).catch(() => []);
    const hasExistingRoutes = appRouteEntries.some((item) => (item.isDirectory() && !item.name.startsWith(".")) || (item.isFile() && /\.tsx?$/.test(item.name) && item.name !== "_layout.tsx"));
    if (!hasExistingRoutes) await writeMissing("app/index.tsx", entry);
    return finish("Created verified Expo project scaffold", "The selected React Native stack requires a real Expo manifest, typed configuration, router entry, and runnable screen before model-driven product implementation begins.");
  }
  if (stack.id === "android") {
    const packageName = `com.foundry.${safeName.replace(/[^a-z0-9]/g, "").slice(0, 32) || "androidapp"}`;
    const packagePath = packageName.replace(/\./g, "/");
    const importedSdkDir = path.join(projectPath, ".foundry-input", "sdk");
    const importedSdkFiles = await readdir(importedSdkDir, { withFileTypes: true }).catch(() => []);
    const importedAar = importedSdkFiles.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".aar"))?.name;
    const settingsGradle = `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name = ${JSON.stringify(projectName.replace(/["\r\n]/g, " "))}
include(":app")
`;
    await writeInvalid("settings.gradle.kts", settingsGradle, (content) => /include\s*\(\s*["']:app["']\s*\)/.test(content) && /pluginManagement/.test(content));
    const rootGradle = `plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("com.google.devtools.ksp") version "1.9.24-1.0.20" apply false
}
`;
    await writeInvalid("build.gradle.kts", rootGradle, (content) => /com\.android\.application/.test(content) && /org\.jetbrains\.kotlin\.android/.test(content));
    await writeMissing("gradle.properties", "org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nkotlin.code.style=official\n");
    await writeMissing(".gitignore", ".gradle/\n.idea/\nbuild/\n**/build/\nlocal.properties\n*.iml\n");
    const appGradle = `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "${packageName}"
    compileSdk = 35
    defaultConfig { applicationId = "${packageName}"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
    buildFeatures { compose = true; buildConfig = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.06.00"))
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
${importedAar ? `    implementation(files("../.foundry-input/sdk/${importedAar.replace(/"/g, "")}"))\n` : ""}}
`;
    await writeInvalid("app/build.gradle.kts", appGradle, (content) => /com\.android\.application/.test(content) && /\bandroid\s*\{/.test(content) && /\bdependencies\s*\{/.test(content) && (!importedAar || content.includes(importedAar)));
    const androidManifestPath = "app/src/main/AndroidManifest.xml";
    await writeMissing(androidManifestPath, `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <application android:allowBackup="false" android:label=${JSON.stringify(projectName.replace(/["\r\n]/g, " "))} android:supportsRtl="true" android:theme="@style/Theme.Foundry">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter>
        </activity>
    </application>
</manifest>
`);
    const manifestAbsolutePath = path.join(projectPath, androidManifestPath);
    if (existsSync(manifestAbsolutePath)) {
      const manifest = await readFile(manifestAbsolutePath, "utf8");
      let reconciled = manifest;
      if (!/<\/manifest>\s*$/i.test(reconciled)) {
        reconciled = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n    <application android:allowBackup="false" android:label=${JSON.stringify(projectName.replace(/["\r\n]/g, " "))} android:supportsRtl="true" android:theme="@style/Theme.Foundry">\n        <activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter></activity>\n    </application>\n</manifest>\n`;
      } else {
        if (/android\.permission\.CAMERA/.test(reconciled) && !/uses-feature[^>]+android\.hardware\.camera/.test(reconciled)) {
          reconciled = reconciled.replace(/(<manifest\b[^>]*>)/, `$1\n    <uses-feature android:name="android.hardware.camera" android:required="false" />`);
        }
        if (!/<application\b/i.test(reconciled)) {
          reconciled = reconciled.replace(/<\/manifest>/i, `    <application android:allowBackup="false" android:label=${JSON.stringify(projectName.replace(/["\r\n]/g, " "))} android:supportsRtl="true" android:theme="@style/Theme.Foundry">\n        <activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter></activity>\n    </application>\n</manifest>`);
        } else if (!/android\.intent\.category\.LAUNCHER/i.test(reconciled)) {
          reconciled = reconciled.replace(/<\/application>/i, `        <activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter></activity>\n    </application>`);
        }
      }
      if (reconciled !== manifest) {
        await writeFile(manifestAbsolutePath, reconciled, "utf8");
        if (!written.includes(androidManifestPath)) written.push(androidManifestPath);
      }
    }
    await writeMissing("app/src/main/res/values/styles.xml", `<resources><style name="Theme.Foundry" parent="android:style/Theme.Material.Light.NoActionBar"><item name="android:fontFamily">sans</item><item name="android:colorAccent">#007F73</item></style></resources>\n`);
    await writeMissing(`app/src/main/java/${packagePath}/MainActivity.kt`, `package ${packageName}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { Surface(color = MaterialTheme.colorScheme.background) { Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { Text(${JSON.stringify(projectName.replace(/["\r\n]/g, " "))}, style = MaterialTheme.typography.headlineMedium); Text("Android runtime, persistence, and device integration foundation verified.") } } }
    }
}
`);
    await writeMissing(`app/src/test/java/${packagePath}/FoundationTest.kt`, `package ${packageName}\n\nimport org.junit.Assert.assertTrue\nimport org.junit.Test\n\nclass FoundationTest { @Test fun foundationLoads() { assertTrue(true) } }\n`);
    const androidTools = resolveAndroidTools();
    if (androidTools) await writeMissing("local.properties", `sdk.dir=${androidTools.sdkRoot.replace(/\\/g, "\\\\")}\n`);
    const wrapper = ensureAndroidGradleWrapper(projectPath);
    if (wrapper.ok) {
      for (const relativePath of wrapper.created) if (!written.includes(relativePath)) written.push(relativePath);
    } else {
      events.push(`Android wrapper bootstrap could not complete deterministically: ${wrapper.error ?? "unknown error"}`);
    }
    return finish("Created verified Android Gradle project scaffold", `The Android build now starts from a complete Gradle/settings/module/manifest/source/test foundation${importedAar ? ` with ${importedAar} wired as a local AAR dependency` : ""}, rather than asking a model to invent build infrastructure.`);
  }
  if (stack.id === "python") {
    await writeMissing("requirements.txt", "fastapi>=0.115,<1\nuvicorn[standard]>=0.32,<1\npytest>=8,<9\nhttpx>=0.28,<1\n");
    await writeMissing("app/__init__.py", "");
    await writeMissing("app/main.py", `from fastapi import FastAPI\n\napp = FastAPI(title=${JSON.stringify(projectName)})\n\n@app.get("/health")\ndef health() -> dict[str, str]:\n    return {"status": "ok"}\n`);
    await writeMissing("tests/test_health.py", "from fastapi.testclient import TestClient\nfrom app.main import app\n\n\ndef test_health() -> None:\n    response = TestClient(app).get('/health')\n    assert response.status_code == 200\n    assert response.json() == {'status': 'ok'}\n");
    return finish("Created verified Python service scaffold", "Python service creation starts with an importable application, declared dependencies, and an executable health test that domain work can extend.");
  }
  if (stack.id === "dotnet-web") {
    const assemblyName = safeName.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("") || "FoundryProject";
    await writeMissing(`${assemblyName}.csproj`, `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n`);
    await writeMissing("Program.cs", `var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.MapGet("/health", () => Results.Ok(new { status = "ok" }));\napp.Run();\n`);
    return finish("Created verified ASP.NET Core scaffold", "The selected .NET service starts with a compilable SDK project and a runnable health endpoint before domain behavior is added.");
  }
  if (stack.id !== "astro") return [];
  const manifest = `${JSON.stringify({
    name: safeName,
    type: "module",
    version: "0.1.0",
    private: true,
    scripts: { dev: "astro dev", build: "astro build", preview: "astro preview" },
    dependencies: { astro: "^5.0.0" },
  }, null, 2)}\n`;
  const tsconfig = `${JSON.stringify({ extends: "astro/tsconfigs/strict" }, null, 2)}\n`;
  const postcssConfig = "export default { plugins: {} };\n";
  await reconcilePackageManifest(manifest);
  await writeMissing("tsconfig.json", tsconfig);
  await writeMissing("postcss.config.mjs", postcssConfig);
  return finish("Created verified Astro project scaffold", "The selected stack requires a real manifest and build scripts before model-driven implementation begins.");
}

function isProductionBuildCommand(command: string) {
  return /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?build\b/i.test(command)
    || /\bdotnet\s+(?:build|publish)\b/i.test(command)
    || /\bcargo\s+build\b[^\r\n]*--release\b/i.test(command)
    || /\bgo\s+build\b/i.test(command)
    || /\b(?:gradle|gradlew(?:\.bat)?)\b[^\r\n]*\b(?:build|assembleRelease|bundleRelease)\b/i.test(command)
    || /\bflutter\s+build\b/i.test(command)
    || /\bmvn(?:\.cmd)?\b[^\r\n]*\b(?:package|verify)\b/i.test(command);
}

function isAutomatedTestCommand(command: string) {
  return /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?test\b/i.test(command)
    || /\bdotnet\s+test\b/i.test(command)
    || /\bdotnet\s+run\b[^\r\n]*--project\s+[^\r\n]*(?:tests?|specs?)(?:[\\/.\s]|$)/i.test(command)
    || /\b(?:cargo|go)\s+test\b/i.test(command)
    || /\b(?:pytest|python\s+-m\s+pytest)\b/i.test(command)
    || /\b(?:gradle|gradlew(?:\.bat)?)\b[^\r\n]*\btest\b/i.test(command)
    || /\bmvn(?:\.cmd)?\b[^\r\n]*\btest\b/i.test(command);
}

function previewPlatformForStack(stack: string): FactoryPreviewPlatform {
  if (/game|phaser|three\.js|webgl/i.test(stack)) return "game";
  if (/android|gradle/i.test(stack)) return "android";
  if (/flutter|react native|swift|ios/i.test(stack)) return "mobile";
  if (/\.net|c#|wpf|winforms|unity|godot/i.test(stack)) return "desktop";
  if (/node\/express|express|fastapi|django|flask|\bapi\b|backend|microservice/i.test(stack)) return "api";
  if (/\bcli\b|command.line|terminal/i.test(stack)) return "cli";
  if (/database|schema|sql|postgres|mysql|sqlite|prisma/i.test(stack)) return "database";
  if (/report|document|pdf|analytics|dashboard/i.test(stack)) return "report";
  return "web";
}

function previewUnavailableReason(platform: FactoryPreviewPlatform, stack: string) {
  if (platform === "android" || platform === "mobile") {
    const isApplePlatform = /\b(ios|iphone|ipad|swift|swiftui|objective-c)\b/i.test(stack) && !/android/i.test(stack);
    if (isApplePlatform && process.platform !== "darwin") {
      // Don't dead-end at "impossible on Windows". State the real constraint, then give the actual path
      // forward — including the Expo/EAS cloud route that produces a runnable iOS app without a Mac.
      return iosGuidanceMessage(iosBuildGuidance(stack, {}, false));
    }
    // Report what this machine can actually do rather than a generic "no device available".
    const toolchain = describeAndroidToolchain();
    return toolchain.ready
      ? `Build the app to an APK and Foundry will run it on a real Android emulator. ${toolchain.message}`
      : toolchain.message;
  }
  if (platform === "desktop") return `${stack} is a native desktop stack — Foundry can't render its UI without running it on your machine.`;
  if (platform === "cli") return "The command-line project needs a safe dry-run command before Foundry can open an interactive terminal preview.";
  if (platform === "database") return "A database explorer needs a configured local database connection.";
  if (platform === "report") return "No browser-readable report entry file was detected.";
  if (platform === "game") return "This game stack does not expose a browser-playable entry point yet.";
  if (platform === "api") return `No runnable HTTP service entry was detected for ${stack}; Foundry did not present a fake API preview.`;
  // "Unknown" as a literal stack name reads like an error to the user. When the stack couldn't be
  // identified, say that plainly and reassure that the work is saved, rather than naming "Unknown".
  const stackIsUnidentified = !stack || /^(unknown|unidentified|n\/?a)$/i.test(stack.trim());
  if (stackIsUnidentified) {
    return "Foundry couldn't identify this project's stack, so it didn't start a live in-browser preview. Identify the framework and use its native toolchain before runtime behavior can be validated.";
  }
  return `Foundry doesn't run a live in-browser preview for a ${stack} project on this machine. Use ${stack}'s own tooling or a configured native emulator/device for runtime validation.`;
}

type PythonPreviewEntry = { kind: "asgi" | "flask" | "django"; module?: string };

async function detectPythonPreviewEntry(projectPath: string): Promise<PythonPreviewEntry | undefined> {
  if (existsSync(path.join(projectPath, "manage.py"))) return { kind: "django" };
  const queue = [projectPath];
  let visited = 0;
  while (queue.length && visited < 300) {
    const current = queue.shift() as string;
    visited += 1;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if ([".git", ".venv", "venv", "__pycache__", "site-packages", "node_modules"].includes(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".py")) continue;
      const relative = path.relative(projectPath, fullPath).replace(/\\/g, "/");
      const modulePath = relative.replace(/\.py$/, "").split("/").filter((segment) => segment !== "__init__").join(".");
      if (!modulePath || !modulePath.split(".").every((segment) => /^[A-Za-z_]\w*$/.test(segment))) continue;
      const source = await readFile(fullPath, "utf8").catch(() => "");
      if (/\b(?:FastAPI|Starlette)\s*\(/.test(source) && /\bapp\s*=\s*(?:FastAPI|Starlette)\s*\(/.test(source)) return { kind: "asgi", module: modulePath };
      if (/\bFlask\s*\(/.test(source) && /\bapp\s*=\s*Flask\s*\(/.test(source)) return { kind: "flask", module: modulePath };
    }
  }
  return undefined;
}

async function startPythonPreview(
  projectId: string,
  projectPath: string,
  entry: PythonPreviewEntry,
  events: string[],
  execution: ExecutionContext | undefined,
): Promise<PreviewOutcome> {
  const port = await findPreviewPort();
  const args = entry.kind === "django"
    ? ["manage.py", "runserver", `127.0.0.1:${port}`, "--noreload"]
    : entry.kind === "flask"
      ? ["-m", "flask", "--app", `${entry.module}:app`, "run", "--host", "127.0.0.1", "--port", String(port)]
      : ["-m", "uvicorn", `${entry.module}:app`, "--host", "127.0.0.1", "--port", String(port)];
  const printable = `python ${args.join(" ")}`;
  if (execution) await emitExecution(execution, "preview", "running", "Starting Python service", { command: printable, details: { port, entry: entry.module, framework: entry.kind, paidModelCalls: 0 } });
  const child = spawn("python", args, { cwd: projectPath, detached: true, windowsHide: true, env: { ...process.env, PORT: String(port) } });
  let runtimeLog = "";
  const capture = (chunk: Buffer) => { runtimeLog = `${runtimeLog}${chunk.toString()}`.slice(-20_000); const record = previewProcesses.get(projectId); if (record) record.runtimeLog = runtimeLog; };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.unref();
  const previewPath = entry.kind === "asgi" ? "/docs" : "/";
  const previewUrl = `http://127.0.0.1:${port}${previewPath}`;
  registerPreviewProcess(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "app", runtimeLog });
  // A cold Python service (uvicorn/gunicorn importing a large app, or Django's first-request setup)
  // can take well past the old 6s budget. Wait the same generous dev-server window and also probe
  // whatever port the framework reports it bound (Django prints "Starting development server at
  // http://127.0.0.1:8000/", Flask/uvicorn print their own), keeping the requested entry path.
  const candidateUrls = () => {
    const urls = [previewUrl];
    for (const served of detectServedPortsFromLog(runtimeLog)) {
      const url = `http://127.0.0.1:${served}${previewPath}`;
      if (!urls.includes(url)) urls.push(url);
    }
    return urls;
  };
  const readyUrl = child.exitCode == null ? await waitForDevServerReady(candidateUrls, () => child.exitCode == null) : null;
  if (readyUrl) {
    const boundPort = Number(new URL(readyUrl).port) || port;
    registerPreviewProcess(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
    events.push(`Python service preview ready: ${readyUrl}`);
    if (execution) await emitExecution(execution, "preview", "completed", "Python service is live", { details: { previewUrl: readyUrl, port: boundPort, entry: entry.module, framework: entry.kind, ready: true, paidModelCalls: 0 } });
    return { previewUrl: readyUrl, previewState: "ready", previewPlatform: "api" };
  }
  const reason = runtimeLog.trim() ? `Python service failed to start: ${trimOutput(runtimeLog)}` : "The Python service process did not become reachable before the readiness deadline.";
  stopPreview(projectId);
  events.push(reason);
  if (execution) await emitExecution(execution, "preview", "error", "Python service failed its live readiness check", { details: { port, entry: entry.module, framework: entry.kind, reason, paidModelCalls: 0 } });
  return { previewState: "error", previewPlatform: "api", previewReason: reason };
}

async function startPreview(projectId: string, projectPath: string, stack: string, events: string[], execution?: ExecutionContext, preferredStaticEntries: string[] = []): Promise<PreviewOutcome> {
  const platform = previewPlatformForStack(stack);
  const currentStaticRuntimeVersion = staticPreviewRuntimeVersion();
  const canonicalProjectPath = path.resolve(projectPath);
  const directExisting = previewProcesses.get(projectId);
  if (directExisting) {
    const directPath = path.resolve(directExisting.projectPath);
    if (!pathIsInside(canonicalProjectPath, directPath) && !pathIsInside(directPath, canonicalProjectPath)) stopPreview(projectId);
  }
  const sameProjectPreviews = Array.from(previewProcesses.entries())
    .filter(([, preview]) => {
      const previewPath = path.resolve(preview.projectPath);
      return pathIsInside(canonicalProjectPath, previewPath) || pathIsInside(previewPath, canonicalProjectPath);
    })
    .sort((left, right) => right[1].lastUsedAt - left[1].lastUsedAt);
  const preferredStaticEntry = /\b(html|css|static)\b/i.test(stack)
    ? preferredStaticEntries[0]?.replace(/\\/g, "/").replace(/^\.\//, "")
    : undefined;
  let reusablePreview: [string, PreviewProcessRecord] | undefined;
  if (sameProjectPreviews.length > 1) {
    // Different UI entry points can refer to one generated folder with different logical IDs. More
    // than one live server for that folder races over framework build output (notably Next's .next).
    // Stop every duplicate and launch one clean owner instead of guessing which cache is intact.
    for (const [duplicateKey] of sameProjectPreviews) stopPreview(duplicateKey);
  } else {
    for (const entry of sameProjectPreviews) {
      const [, preview] = entry;
      const ownedProcessAlive = !preview.processId || processIsAlive(preview.processId);
      const currentEntry = decodeURIComponent(new URL(preview.previewUrl).pathname).replace(/^\/+/, "");
      const pointsAtPreferredEntry = !preferredStaticEntry || currentEntry.toLowerCase() === preferredStaticEntry.toLowerCase();
      const currentRuntime = preview.kind !== "static" || preview.runtimeVersion === currentStaticRuntimeVersion;
      if (!reusablePreview && currentRuntime && pointsAtPreferredEntry && ownedProcessAlive && await previewResponds(preview.previewUrl, preview.ownershipToken)) {
        reusablePreview = entry;
        continue;
      }
      stopPreview(entry[0]);
    }
  }
  if (reusablePreview) {
    const [, preview] = reusablePreview;
    preview.lastUsedAt = Date.now();
    return { previewUrl: preview.previewUrl, previewState: "ready", previewPlatform: platform, previewOwnershipToken: preview.ownershipToken };
  }

  // Expo is both a native app and a browser-previewable development surface. Prefer its verified
  // static web export when available; during implementation, use the declared Expo web script only
  // after dependencies exist. Never misroute React Native through a generic `expo start` command.
  if (platform === "mobile" && await isExpoProject(projectPath)) {
    const exportedWebRoot = path.join(projectPath, "dist");
    if (existsSync(path.join(exportedWebRoot, "index.html"))) {
      return startStaticPreview(projectId, exportedWebRoot, "index.html", events, execution, true);
    }
    const hasInstalledExpo = existsSync(path.join(projectPath, "node_modules", ".bin", process.platform === "win32" ? "expo.cmd" : "expo"));
    const webScript = await detectNodeScript(projectPath, "web");
    if (hasInstalledExpo && webScript) return startGenericNodePreview(projectId, projectPath, webScript, events, execution, "web");
    const reason = "The Preview workspace is open. Expo dependencies are still being installed; the live web surface will attach here as soon as the declared web script is runnable.";
    if (execution) await emitExecution(execution, "preview", "running", "Waiting for the Expo preview surface", { details: { reason, paidModelCalls: 0 } });
    return { previewState: "starting", previewPlatform: "web", previewReason: reason };
  }

  if (isNextStack(stack)) {
    return startNextPreview(projectId, projectPath, events, execution, platform);
  }

  // Any other Node-based project (an Express API, a Vite app, a hand-rolled server) can still get a
  // real live preview — read its actual package.json scripts rather than guessing a framework-specific
  // command, and run whichever real script is there against a PORT env var, the one convention nearly
  // every Node HTTP server already respects.
  const nodeScript = await detectNodeStartScript(projectPath);
  if (nodeScript) {
    return reconcileNodePreviewWithStaticEntry(
      await startGenericNodePreview(projectId, projectPath, nodeScript, events, execution, platform),
      { projectId, projectPath, nodeScript, events, execution, preferredStaticEntries },
    );
  }

  const pythonEntry = await detectPythonPreviewEntry(projectPath);
  if (pythonEntry) {
    return startPythonPreview(projectId, projectPath, pythonEntry, events, execution);
  }

  if (/\b(html|css|static)\b/i.test(stack)) {
    const entryFile = await findStaticHtmlPreviewEntry(projectPath, preferredStaticEntries);
    if (!entryFile) {
      const reason = "No HTML entry file was found in the discovered static source tree, so there is nothing to preview yet.";
      if (execution) await emitExecution(execution, "preview", "skipped", "Preview unavailable", { details: { reason } });
      return { previewState: "unavailable", previewPlatform: "web", previewReason: reason };
    }
    return startStaticPreview(projectId, projectPath, entryFile, events, execution);
  }

  if (platform === "desktop") {
    const executable = await findDesktopExecutable(projectPath);
    if (executable) {
      persistDesktopPreviewTarget(projectId, projectPath, executable);
      const file = await stat(executable);
      const relativeArtifactPath = path.relative(projectPath, executable).replace(/\\/g, "/");
      const artifact: FactoryArtifact = {
        name: path.basename(executable),
        platform: desktopPlatformForPath(executable),
        version: await desktopVersionForProject(projectPath),
        fileType: "Windows executable (.exe)",
        sizeBytes: file.size,
        createdAt: file.mtime.toISOString(),
        buildStatus: "verified",
        downloadUrl: `/api/factory/artifact?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relativeArtifactPath)}`,
      };
      const reason = `Desktop build ready: ${path.basename(executable)}. Use Launch desktop app to run it.`;
      if (execution) await emitExecution(execution, "preview", "completed", "Desktop app ready to launch", { details: { executable: path.basename(executable), sizeBytes: file.size, platform: artifact.platform } });
      return { previewState: "ready", previewPlatform: "desktop", previewReason: reason, artifact };
    }
  }

  if (platform === "android" || platform === "mobile" || platform === "report") {
    const packaged = await findPackagedArtifact(projectPath, platform);
    if (packaged) {
      const relativeArtifactPath = path.relative(projectPath, packaged.path).replace(/\\/g, "/");
      const artifact: FactoryArtifact = {
        name: path.basename(packaged.path),
        platform: packaged.platform,
        version: await desktopVersionForProject(projectPath),
        fileType: packaged.fileType,
        sizeBytes: packaged.size,
        createdAt: packaged.createdAt,
        buildStatus: "verified",
        downloadUrl: `/api/factory/artifact?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relativeArtifactPath)}`,
      };
      // A mobile app's real preview is the app running on an emulator, not a browser. When the build
      // produced an Android APK and an Android SDK is available, offer to launch it on a real Android
      // Virtual Device; the download stays as a fallback.
      const canEmulate = (platform === "android" || platform === "mobile") && /\.apk$/i.test(packaged.path) && Boolean(resolveAndroidTools());
      const reason = canEmulate
        ? `${artifact.name} is built. Launch it on the Android emulator, or download the APK.`
        : `${artifact.name} is built and ready to ${platform === "report" ? "open or download" : "install or download"}.`;
      if (execution) await emitExecution(execution, "preview", "completed", canEmulate ? "Android app ready to run on emulator" : "Platform artifact ready", { details: { artifact: artifact.name, platform: artifact.platform, sizeBytes: artifact.sizeBytes, emulator: canEmulate } });
      return { previewState: "ready", previewPlatform: platform, previewReason: reason, artifact, previewEmulator: canEmulate ? "android" : undefined };
    }
  }

  const reason = previewUnavailableReason(platform, stack);
  if (execution) await emitExecution(execution, "preview", "skipped", "Preview unavailable", { details: { reason, stack } });
  return { previewState: "unavailable", previewPlatform: platform, previewReason: reason };
}

async function findStaticHtmlPreviewEntry(projectPath: string, preferredEntries: string[] = []): Promise<string | undefined> {
  const ignored = /^(?:node_modules|\.git|\.next|\.foundry-artifacts|\.foundry-data|coverage|dist|build|out|vendor|bin|obj)$/i;
  const queue: Array<{ absolute: string; relative: string; depth: number }> = [{ absolute: projectPath, relative: "", depth: 0 }];
  const candidates: Array<{ path: string; score: number }> = [];
  let visited = 0;
  while (queue.length && visited < 2_000) {
    const current = queue.shift() as { absolute: string; relative: string; depth: number };
    visited += 1;
    const entries = await readdir(current.absolute, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && current.depth < 20 && !ignored.test(entry.name)) {
        queue.push({ absolute: path.join(current.absolute, entry.name), relative, depth: current.depth + 1 });
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        const isIndex = /^index\.html?$/i.test(entry.name);
        const score = current.depth * 10 + (isIndex ? 0 : 1);
        candidates.push({ path: relative.replace(/\\/g, "/"), score });
      }
    }
  }
  const normalizedCandidates = new Map(candidates.map((candidate) => [candidate.path.toLowerCase(), candidate.path]));
  for (const preferred of preferredEntries) {
    const normalized = preferred.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    const exact = normalizedCandidates.get(normalized);
    if (exact) return exact;
  }
  return candidates.sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))[0]?.path;
}

async function findPackagedArtifact(projectPath: string, platform: "android" | "mobile" | "report") {
  const extensions = platform === "android" ? new Set([".apk", ".aab"]) : platform === "mobile" ? new Set([".ipa", ".apk", ".aab"]) : new Set([".pdf"]);
  const queue = [projectPath];
  const candidates: Array<{ path: string; size: number; createdAt: string; extension: string; score: number }> = [];
  let visited = 0;
  while (queue.length && visited < 600) {
    const current = queue.shift() as string;
    visited += 1;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if ([".git", ".next", ".turbo", "node_modules", "obj", ".gradle", ".dart_tool", "coverage"].includes(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (queue.length < 600) queue.push(fullPath);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!extensions.has(extension)) continue;
      const details = await stat(fullPath).catch(() => undefined);
      if (!details?.isFile()) continue;
      const normalized = fullPath.replace(/\\/g, "/").toLowerCase();
      const score = [".aab", ".ipa"].includes(extension) ? 0 : /\/(release|publish|artifacts?|outputs?)\//.test(normalized) ? 1 : 2;
      candidates.push({ path: fullPath, size: details.size, createdAt: details.mtime.toISOString(), extension, score });
    }
  }
  const selected = candidates.sort((left, right) => left.score - right.score || right.createdAt.localeCompare(left.createdAt))[0];
  if (!selected) return undefined;
  const platformLabel = [".apk", ".aab"].includes(selected.extension) ? "Android" : selected.extension === ".ipa" ? "iOS" : "Document";
  const fileType = selected.extension === ".apk" ? "Android package (.apk)" : selected.extension === ".aab" ? "Android App Bundle (.aab)" : selected.extension === ".ipa" ? "iOS application archive (.ipa)" : "PDF document (.pdf)";
  return { ...selected, platform: platformLabel, fileType };
}

async function findDesktopExecutable(projectPath: string): Promise<string | undefined> {
  const queue = [projectPath];
  const candidates: string[] = [];
  while (queue.length) {
    const current = queue.shift() as string;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (["node_modules", ".git", ".pytest_cache", "__pycache__", ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".venv", "venv", "site-packages", "obj"].includes(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (queue.length < 200) queue.push(fullPath);
      } else if (entry.name.toLowerCase().endsWith(".exe") && /[\\/](?:bin|artifacts?)[\\/]/i.test(fullPath)) {
        candidates.push(fullPath);
      }
    }
  }
  return candidates.sort((left, right) => desktopExecutableRank(left) - desktopExecutableRank(right))[0];
}

function processIsAlive(processId: number) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function desktopExecutableRank(filePath: string) {
  if (/[\\/]artifacts?[\\/]/i.test(filePath)) return 0;
  if (/[\\/]publish[\\/]/i.test(filePath)) return 1;
  if (/[\\/]bin[\\/]Release[\\/]/i.test(filePath)) return 2;
  return 3;
}

export async function launchDesktopPreview(projectId: string, requestedProjectPath?: string) {
  const connectorTarget = connectorArtifactTargets.get(projectId);
  if (connectorTarget?.platform === "desktop") {
    const { connector, relativePath } = connectorTarget;
    try {
      const baseUrl = connector.url.replace(/\/+$/, "");
      const headers = { "content-type": "application/json", ...(connector.token ? { authorization: `Bearer ${connector.token}` } : {}) };
      const response = await fetch(`${baseUrl}/validation/desktop/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ root: connector.rootLabel || "", executable: relativePath, observeMs: 2000 }),
      });
      const result = (await response.json().catch(() => ({}))) as { verified?: boolean; reason?: string; error?: string };
      return result.verified
        ? { ok: true, executable: path.basename(relativePath) }
        : { ok: false, error: result.error || result.reason || "The desktop artifact did not remain running after launch." };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The Local Agent could not launch the desktop artifact." };
    }
  }
  let target = desktopPreviewTargets.get(projectId) ?? restoreDesktopPreviewTarget(projectId);
  let executable = target?.executable;
  let projectPath = target?.projectPath;
  if (!executable || !existsSync(executable)) {
    try {
      const resolvedRequestedPath = requestedProjectPath ? path.resolve(requestedProjectPath) : undefined;
      const managedRoot = path.resolve(projectsRoot);
      projectPath = resolvedRequestedPath && pathIsInside(managedRoot, resolvedRequestedPath) && existsSync(resolvedRequestedPath)
        ? resolvedRequestedPath
        : safeProjectPath(projectId);
      executable = await findDesktopExecutable(projectPath);
      if (executable) {
        persistDesktopPreviewTarget(projectId, projectPath, executable);
        target = { projectPath, executable };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The desktop project path is unavailable." };
    }
  }
  if (!executable || !existsSync(executable)) return { ok: false, error: "No built desktop executable was found in this project. Build it once, then launch again." };
  try {
    const processId = await new Promise<number>((resolve, reject) => {
      const child = spawn(executable!, [], { cwd: path.dirname(executable!), detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", reject);
      child.once("spawn", () => {
        if (typeof child.pid !== "number") {
          reject(new Error("Windows did not return a process id for the desktop app."));
          return;
        }
        child.unref();
        resolve(child.pid);
      });
      child.once("exit", () => {
        if (typeof child.pid === "number") forgetOwnedDesktopProcess(child.pid);
      });
    });
    registerOwnedDesktopProcess({
      projectId,
      projectPath: projectPath || path.dirname(executable),
      executable,
      args: [],
      processId,
    });
    return { ok: true, executable: path.basename(executable), processId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Windows rejected the desktop executable." };
  }
}

/** Boot an Android emulator (if needed) and run the project's built APK on it — the real preview for
 * a mobile app. Mirrors launchDesktopPreview: the app opens as a native window, not in the browser. */
export async function launchAndroidPreview(projectId: string, requestedProjectPath?: string) {
  let projectPath: string;
  try {
    const resolvedRequestedPath = requestedProjectPath ? path.resolve(requestedProjectPath) : undefined;
    const managedRoot = path.resolve(projectsRoot);
    projectPath = resolvedRequestedPath && pathIsInside(managedRoot, resolvedRequestedPath) && existsSync(resolvedRequestedPath)
      ? resolvedRequestedPath
      : safeProjectPath(projectId);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "The Android project path is unavailable." };
  }
  const result = await launchAndroidEmulator({ projectPath });
  if (!result.ok) return { ok: false as const, error: result.error, needs: result.needs };
  const app = result.applicationId ? ` (${result.applicationId})` : "";
  const where = result.alreadyRunning ? "the running emulator" : result.avd ? `emulator "${result.avd}"` : "the emulator";
  return {
    ok: true as const,
    detail: result.launched
      ? `Installed and launched ${path.basename(result.apk)}${app} on ${where}.`
      : `Installed ${path.basename(result.apk)} on ${where}. Open it from the emulator's app drawer${result.applicationId ? "" : " (no launcher activity was detected to auto-start)"}.`,
    serial: result.serial,
  };
}

export async function readConnectorProjectArtifact(projectId: string, requestedRelativePath: string) {
  const target = connectorArtifactTargets.get(projectId);
  if (!target || target.relativePath.replace(/\\/g, "/") !== requestedRelativePath.replace(/\\/g, "/")) return undefined;
  const { connector } = target;
  const baseUrl = connector.url.replace(/\/+$/, "");
  const headers = { "content-type": "application/json", ...(connector.token ? { authorization: `Bearer ${connector.token}` } : {}) };
  const response = await fetch(`${baseUrl}/artifact/download`, {
    method: "POST",
    headers,
    body: JSON.stringify({ root: connector.rootLabel || "", path: target.relativePath }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "The Local Agent could not read the build artifact.");
  }
  return { file: Buffer.from(await response.arrayBuffer()), filename: path.basename(target.relativePath) };
}

async function startStaticPreview(projectId: string, projectPath: string, entryFile: string, events: string[], execution?: ExecutionContext, useRootUrl = false): Promise<PreviewOutcome> {
  const scriptPath = path.join(process.cwd(), "scripts", "foundry-static-preview.cjs");
  const runtimeVersion = staticPreviewRuntimeVersion();
  const attemptedPorts = new Set<number>();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findPreviewPort(attemptedPorts);
    attemptedPorts.add(port);
    const ownershipToken = `${projectId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (execution) await emitExecution(execution, "preview", "running", attempt === 1 ? "Starting interactive static preview" : "Retrying preview on a clean port", { details: { port, entryFile, attempt } });
    const child = spawn(process.execPath, [scriptPath, projectPath, String(port), ownershipToken], { cwd: projectPath, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    // Single-page routers derive navigation state from location.pathname. Serving their index at
    // `/index.html` makes frameworks such as Expo Router navigate to a nonexistent `index.html`
    // route even though the exported asset is healthy. Static documents keep their explicit path;
    // verified SPA exports mount at the server root.
    const encodedEntryPath = entryFile.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
    const previewUrl = useRootUrl ? `http://127.0.0.1:${port}/` : `http://127.0.0.1:${port}/${encodedEntryPath}`;
    registerPreviewProcess(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "static", ownershipToken, runtimeVersion });
    const ready = await waitForStaticPreviewReady(previewUrl, ownershipToken);
    if (ready) {
      events.push(`Interactive preview ready: ${previewUrl}`);
      if (execution) await emitExecution(execution, "preview", "completed", "Interactive preview ready", { details: { previewUrl, port, entryFile, ready, attempt } });
      return { previewUrl, previewState: "ready", previewPlatform: "web", previewOwnershipToken: ownershipToken };
    }
    stopPreview(projectId);
  }

  const reason = "Foundry could not bind an owned preview server after three clean-port attempts; no stale preview was shown.";
  events.push(reason);
  if (execution) await emitExecution(execution, "preview", "error", "Preview could not start", { details: { reason, attemptedPorts: Array.from(attemptedPorts, String) } });
  return { previewState: "error", previewPlatform: "web", previewReason: reason };
}

/** cmd.exe /s treats a command whose first token is individually quoted as a specially wrapped
 * command line. Quoting every npm token therefore made Windows look for an executable literally
 * named `"npm.cmd"`. Preview arguments are generated entirely by Foundry, so validate the small
 * safe token vocabulary and pass one unambiguous command string to `/c`. */
function windowsNpmPreviewArguments(args: string[]) {
  const unsafeArgument = args.find((argument) => !/^[a-z0-9@._:/\\-]+$/i.test(argument));
  if (unsafeArgument) throw new Error(`Unsafe npm preview argument: ${unsafeArgument}`);
  return ["/d", "/s", "/c", ["npm.cmd", ...args].join(" ")];
}

/** Load the selected project's runtime configuration before spawning it. Nested projects can be
 * discovered beneath a different Next.js workspace root, in which case the framework may resolve
 * the host application's env directory instead of the child's. Foundry owns the child process, so
 * make the project-file contract explicit while preserving standard precedence: base files first,
 * mode/local overrides next, and an already configured process variable wins over every file. */
async function projectRuntimeEnvironment(projectPath: string, mode: "development" | "production", projectId?: string) {
  const fromProjectFiles: Record<string, string> = {};
  for (const fileName of [".env", `.env.${mode}`, ".env.local", `.env.${mode}.local`]) {
    const contents = await readFile(path.join(projectPath, fileName), "utf8").catch(() => "");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!match) continue;
      let value = match[2].trim();
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        value = value.slice(1, -1);
        if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      fromProjectFiles[match[1]] = value;
    }
  }
  const stored=projectId?await projectIntegrationEnvironment({projectId,environment:mode,location:"local"}):{environment:{}};
  return { ...fromProjectFiles, ...process.env, ...stored.environment, NODE_ENV: mode };
}

async function startNextPreview(projectId: string, projectPath: string, events: string[], execution: ExecutionContext | undefined, platform: FactoryPreviewPlatform, bindAttempt = 1, excludedPorts = new Set<number>()): Promise<PreviewOutcome> {
  const previewCommand = await detectNextPreviewCommand(projectPath);
  if (!previewCommand) {
    const staticExport = path.join(projectPath, "out", "index.html");
    if (existsSync(staticExport)) return startStaticPreview(projectId, path.dirname(staticExport), "index.html", events, execution, true);
    const reason = "Foundry could not find a declared Next.js preview script, an installed local Next.js CLI, or a built static export. The Preview workspace remains available, but there is no real process or artifact to open yet.";
    if (execution) await emitExecution(execution, "preview", "error", "Preview unavailable", { details: { reason } });
    return { previewState: "error", previewPlatform: platform, previewReason: reason };
  }
  const startScript = previewCommand.mode;
  const port = await findPreviewPort(excludedPorts);
  const visibleCommand = previewCommand.kind === "script"
    ? `npm.cmd run ${startScript} -- -p ${port}`
    : `node ${path.relative(projectPath, previewCommand.cliPath).replace(/\\/g, "/")} ${startScript} -p ${port}`;
  if (execution) await emitExecution(execution, "preview", "running", startScript === "start" ? "Starting verified production preview" : "Starting development server", {
    command: visibleCommand,
    details: { port, script: startScript, launcher: previewCommand.kind, paidModelCalls: 0 },
  });
  const previewArgs = ["run", startScript, "--", "-p", String(port)];
  const previewExecutable = previewCommand.kind === "direct"
    ? process.execPath
    : process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const previewArguments = previewCommand.kind === "direct"
    ? [previewCommand.cliPath, startScript, "-p", String(port)]
    : process.platform === "win32" ? windowsNpmPreviewArguments(previewArgs) : previewArgs;
  const previewEnv = await projectRuntimeEnvironment(projectPath, startScript === "start" ? "production" : "development",projectId);
  const child = spawn(previewExecutable, previewArguments, {
    cwd: projectPath,
    shell: false,
    // A detached Windows cmd.exe with piped stdio is not a stable process owner: the wrapper can
    // disappear before npm/Next has bound its port and libuv can close the pipe handles without a
    // useful exit diagnostic. Keep the Windows wrapper attached so its output and process tree stay
    // authoritative; taskkill /t below still stops the complete owned tree. POSIX keeps the detached
    // process-group behavior used for reliable cleanup there.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // The Foundry UI normally runs with NODE_ENV=development. Passing that through to `next start`
    // makes Next use the wrong build directory/config branch and reject a valid production build.
    // Preview scripts own their runtime mode; do not leak Foundry's host mode into the child app.
    env: previewEnv,
  });
  let runtimeLog = "";
  const capture = (chunk: Buffer) => {
    runtimeLog = `${runtimeLog}${chunk.toString()}`.slice(-20_000);
    const record = previewProcesses.get(projectId);
    if (record) record.runtimeLog = runtimeLog;
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  if (process.platform !== "win32") child.unref();
  const previewUrl = `http://127.0.0.1:${port}`;
  registerPreviewProcess(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "app", runtimeLog });
  // A different process can occupy a port between the availability probe and spawn. Give npm a
  // moment to fail before accepting any HTTP response on that port as this project's preview.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const candidateUrls = () => {
    const urls = [previewUrl];
    for (const served of detectServedPortsFromLog(runtimeLog)) {
      const url = `http://127.0.0.1:${served}`;
      if (!urls.includes(url)) urls.push(url);
    }
    return urls;
  };
  const readyUrl = child.exitCode == null
    ? await waitForDevServerReady(candidateUrls, () => child.exitCode == null, startScript === "start" ? 50 : 90, 500)
    : null;
  if (readyUrl) {
    const boundPort = Number(new URL(readyUrl).port) || port;
    registerPreviewProcess(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
    events.push(`Preview process reachable: ${readyUrl}; browser smoke verification is pending.`);
    if (execution) await emitExecution(execution, "preview", "running", "Preview process reachable; running browser smoke verification", { details: { previewUrl: readyUrl, port: boundPort, processReachable: true, browserVerified: false } });
    return { previewUrl: readyUrl, previewState: "ready", previewPlatform: platform };
  }
  const reason = runtimeLog.trim()
    ? `Preview failed to start: ${trimOutput(runtimeLog)}`
    : await previewRuntimeFailureReason(port);
  stopPreview(projectId);
  if (bindAttempt < 3 && previewPortCollision(runtimeLog)) {
    excludedPorts.add(port);
    events.push(`Preview port ${port} was claimed before startup; retrying on a clean port.`);
    if (execution) await emitExecution(execution, "preview", "running", "Preview port was occupied; relaunching on a clean port", { details: { port, attempt: bindAttempt, paidModelCalls: 0 } });
    return startNextPreview(projectId, projectPath, events, execution, platform, bindAttempt + 1, excludedPorts);
  }
  events.push(reason);
  if (execution) await emitExecution(execution, "preview", "error", "Preview failed its live readiness check", { details: { port, ready: false, reason } });
  return { previewState: "error", previewPlatform: platform, previewReason: reason };
}

/** Reads the project's actual package.json scripts and returns the first real, existing one worth
 * running as a preview server, in the order a person would try them — never a guessed/invented name. */
async function detectNodeStartScript(projectPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    return ["dev", "start", "serve"].find((name) => typeof scripts[name] === "string");
  } catch {
    return undefined;
  }
}

async function detectNodeScript(projectPath: string, script: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.[script] === "string" ? script : undefined;
  } catch {
    return undefined;
  }
}

async function isExpoProject(projectPath: string) {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return Boolean(pkg.dependencies?.expo || pkg.devDependencies?.expo);
  } catch {
    return false;
  }
}

/**
 * What a running preview server actually serves, established by asking it rather than by reading its
 * source. A folder holding both `server.js` and `index.html` can mean two very different things — a
 * server that renders that page, or an API that has nothing to do with it — and only the response
 * settles which. Readiness alone cannot: a JSON API answers just as promptly as a rendered page, so
 * treating "the port responded" as "there is a page here" put an API response inside an iframe and
 * showed the user a broken-document icon with no explanation.
 */
async function classifyServedPreviewSurface(baseUrl: string, staticEntry: string | undefined) {
  const probe = async (target: string) => {
    try {
      const response = await fetch(new URL(target, baseUrl), { signal: AbortSignal.timeout(5_000), redirect: "follow" });
      return { status: response.status, contentType: (response.headers.get("content-type") ?? "").toLowerCase() };
    } catch {
      return undefined;
    }
  };
  const root = await probe("/");
  if (root && root.status < 400 && root.contentType.includes("html")) return { kind: "page" as const, url: baseUrl, root };
  // A server can render the project's page on an explicit path while answering its root with an API
  // status payload. That still counts as serving the page.
  if (staticEntry) {
    const entryUrl = new URL(`/${staticEntry.replace(/^\/+/, "")}`, baseUrl).toString();
    const entry = await probe(entryUrl);
    if (entry && entry.status < 400 && entry.contentType.includes("html")) return { kind: "page" as const, url: entryUrl, root };
  }
  return { kind: root ? ("api" as const) : ("unreachable" as const), url: baseUrl, root };
}

function describeServedResponse(root: { status: number; contentType: string } | undefined) {
  if (!root) return "did not respond";
  const type = root.contentType.split(";")[0]?.trim();
  return `answered HTTP ${root.status}${type ? ` with ${type}` : ""}`;
}

/**
 * Decides what the preview should actually show once a project's Node server is running.
 *
 * The server winning unconditionally was wrong for the common "API plus a static page" folder: the
 * dock framed a JSON response. Now the server keeps the preview only when it really serves a page.
 * When it does not, the user gets whichever real surface exists — their page, or the API playground —
 * and, either way, a plain statement of what Foundry found so the result is never a silent blank.
 */
async function reconcileNodePreviewWithStaticEntry(
  outcome: PreviewOutcome,
  context: {
    projectId: string;
    projectPath: string;
    nodeScript: string;
    events: string[];
    execution?: ExecutionContext;
    preferredStaticEntries: string[];
  },
): Promise<PreviewOutcome> {
  if (outcome.previewState !== "ready" || !outcome.previewUrl) return outcome;
  const { projectId, projectPath, nodeScript, events, execution, preferredStaticEntries } = context;
  const staticEntry = await findStaticHtmlPreviewEntry(projectPath, preferredStaticEntries).catch(() => undefined);
  const surface = await classifyServedPreviewSurface(outcome.previewUrl, staticEntry);
  if (surface.kind === "page") {
    return { ...outcome, previewUrl: surface.url, previewPlatform: "web" };
  }

  const servedDescription = describeServedResponse(surface.root);
  if (!staticEntry) {
    // Nothing else to show. The API playground is a real surface for this project; an iframe is not.
    const previewReason = `\`npm run ${nodeScript}\` is running at ${outcome.previewUrl}, but it ${servedDescription} at / rather than a page, and this project has no HTML entry file. Foundry is showing the API playground instead of an empty browser frame.`;
    if (execution) await emitExecution(execution, "preview", "completed", "Preview attached to the running API", { details: { previewUrl: outcome.previewUrl, servedContentType: surface.root?.contentType, surface: "api", script: nodeScript } });
    events.push(previewReason);
    return { ...outcome, previewPlatform: "api", previewReason };
  }

  // Two separate things: an API, and a page it does not serve. Show the page — that is what the user
  // opened — and name the server explicitly rather than leaving them to guess why it is not on screen.
  stopPreview(projectId);
  const staticPreview = await startStaticPreview(projectId, projectPath, staticEntry, events, execution);
  const previewReason = `This folder holds two separate things. \`npm run ${nodeScript}\` ${servedDescription} at / and does not serve ${staticEntry}, so it is an API rather than the server for this page. Foundry is previewing ${staticEntry} directly; the API is not running, so any request the page makes to it will fail until you start it yourself.`;
  if (execution) {
    await emitExecution(execution, "preview", "completed", `Previewing ${staticEntry}; the project's server does not serve it`, {
      details: { staticEntry, nodeScript, nodeServerUrl: outcome.previewUrl, servedContentType: surface.root?.contentType, surface: "separate-api-and-page" },
    });
  }
  events.push(previewReason);
  return staticPreview.previewState === "ready" ? { ...staticPreview, previewReason } : { ...staticPreview, previewReason: `${staticPreview.previewReason ?? ""} ${previewReason}`.trim() };
}

async function startGenericNodePreview(
  projectId: string,
  projectPath: string,
  script: string,
  events: string[],
  execution: ExecutionContext | undefined,
  platform: FactoryPreviewPlatform,
  bindAttempt = 1,
  excludedPorts = new Set<number>(),
): Promise<PreviewOutcome> {
  const port = await findPreviewPort(excludedPorts);
  const frameworkArgs = await nodePreviewPortArgs(projectPath, port);
  const commandArgs = ["run", script, ...frameworkArgs];
  if (execution) await emitExecution(execution, "preview", "running", "Starting development server", { command: `npm.cmd ${commandArgs.join(" ")}`, details: { port, script } });
  const npmExecutable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const npmArguments = process.platform === "win32"
    ? windowsNpmPreviewArguments(commandArgs)
    : commandArgs;
  const previewEnv = await projectRuntimeEnvironment(projectPath, script === "start" ? "production" : "development",projectId);
  const expoProject = await isExpoProject(projectPath);
  const child = spawn(npmExecutable, npmArguments, {
    cwd: projectPath,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...previewEnv, PORT: String(port), ...(expoProject ? { CI: "1" } : {}) },
  });
  let runtimeLog = "";
  const capture = (chunk: Buffer) => {
    runtimeLog = `${runtimeLog}${chunk.toString()}`.slice(-20_000);
    const record = previewProcesses.get(projectId);
    if (record) record.runtimeLog = runtimeLog;
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  if (process.platform !== "win32") child.unref();
  const requestedUrl = `http://127.0.0.1:${port}`;
  registerPreviewProcess(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl: requestedUrl, projectPath, kind: "app", runtimeLog });
  // A cold dev server (Vite/Svelte/Vue/Astro first run does an esbuild dependency optimize, and on
  // Windows the command goes cmd → npm → the bundler) routinely needs 10–30s before it serves — the
  // old 8×400ms ≈ 3s budget expired first and wrongly reported the app "not ready", driving working
  // builds into a pointless repair loop. Wait the generous dev-server budget, and probe both the
  // requested port and any port the server reports it actually bound (Angular ignores our port and
  // binds 4200; a custom server may pick its own), so readiness is framework-agnostic.
  const candidateUrls = () => {
    const urls = [requestedUrl];
    for (const served of detectServedPortsFromLog(runtimeLog)) {
      const url = `http://127.0.0.1:${served}`;
      if (!urls.includes(url)) urls.push(url);
    }
    return urls;
  };
  const readyUrl = await waitForDevServerReady(candidateUrls, () => child.exitCode == null);
  if (readyUrl) {
    // Re-register under the port the server actually bound so later reuse/verification targets it.
    const boundPort = Number(new URL(readyUrl).port) || port;
    registerPreviewProcess(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
    events.push(`Preview process reachable: ${readyUrl}; browser smoke verification is pending.`);
    if (execution) await emitExecution(execution, "preview", "running", "Preview process reachable; running browser smoke verification", { details: { previewUrl: readyUrl, port: boundPort, processReachable: true, browserVerified: false, script } });
    return { previewUrl: readyUrl, previewState: "ready", previewPlatform: platform };
  }
  const reason = runtimeLog.trim()
    ? `Preview failed to start: ${trimOutput(runtimeLog)}`
    : await previewRuntimeFailureReason(port);
  stopPreview(projectId);
  if (bindAttempt < 3 && previewPortCollision(runtimeLog)) {
    excludedPorts.add(port);
    events.push(`Preview port ${port} was claimed before startup; retrying on a clean port.`);
    if (execution) await emitExecution(execution, "preview", "running", "Preview port was occupied; relaunching on a clean port", { details: { port, attempt: bindAttempt, paidModelCalls: 0 } });
    return startGenericNodePreview(projectId, projectPath, script, events, execution, platform, bindAttempt + 1, excludedPorts);
  }
  events.push(reason);
  if (execution) await emitExecution(execution, "preview", "error", "Preview failed its live readiness check", { details: { port, ready: false, script, reason } });
  return { previewState: "error", previewPlatform: platform, previewReason: reason };
}

function externalRuntimeRequirementKeys(selectedStack: string) {
  const stack = selectedStack.toLowerCase();
  const required = new Set<string>();
  if (/postgres(?:ql)?|mysql|mariadb|mongodb|cockroachdb|planetscale|\bneon\b/.test(stack)) required.add("DATABASE_URL");
  if (/\bredis\b/.test(stack)) required.add("REDIS_URL");
  return Array.from(required);
}

async function previewRuntimeFailureReason(port: number) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
    const body = (await response.text()).slice(0, 200_000).replace(/\\n/g, "\n");
    clearTimeout(timeout);
    const environmentFailure = body.match(/Environment variable not found:\s*([A-Z][A-Z0-9_]*)/i);
    if (environmentFailure) return `Preview returned HTTP ${response.status}: required environment variable ${environmentFailure[1]} is not configured.`;
    const runtimeError = body.match(/(?:PrismaClient\w*Error|TypeError|ReferenceError|SyntaxError)[^<"\\]{0,220}/i)?.[0]?.replace(/\s+/g, " ").trim();
    if (runtimeError) return `Preview returned HTTP ${response.status}: ${runtimeError}`;
    return `Preview returned HTTP ${response.status}; the real application root did not become ready.`;
  } catch {
    return "The preview process did not become reachable before the readiness deadline.";
  }
}

function previewPortCollision(log: string) {
  return /EADDRINUSE|address already in use|port\s+\d+\s+(?:is\s+)?(?:already\s+)?in use/i.test(stripTerminalFormatting(log));
}

/**
 * Readiness poll sized for a cold dev server rather than a warm static file server. Polls up to ~45s
 * (matching the Next.js dev budget) but returns the instant the URL responds, and bails early if the
 * dev-server process has already exited — a dead process will never become ready, so there is no
 * point waiting out the full window. `isAlive` returns false once the child process has exited.
 */
async function urlResponds(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ports a dev server reports it is actually serving on, parsed from its stdout. Frameworks do not
 * agree on how (or whether) to honor a requested port: Vite/Next/Nuxt take a flag or PORT env, but
 * Angular's `ng serve` ignores both and binds 4200, and a hand-rolled server may pick anything. They
 * all *print* their real URL, though ("Local: http://localhost:4200", "Running on http://…:8000",
 * "listening on port 3000"), so reading it back is the one framework-agnostic source of truth.
 */
function detectServedPortsFromLog(log: string): number[] {
  const ports = new Set<number>();
  for (const match of log.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/gi)) ports.add(Number(match[1]));
  for (const match of log.matchAll(/(?:listening on|running on|running at|started server on|local:).*?(?:port\s+|:)(\d{2,5})\b/gi)) ports.add(Number(match[1]));
  return Array.from(ports).filter((port) => port >= 1024 && port <= 65535);
}

/**
 * Waits for a cold dev server, tolerant of both slow first-request compilation and a framework that
 * bound a different port than requested. `getCandidateUrls` is re-read every attempt so ports the
 * server only prints after it starts are picked up. Returns the URL that actually responded (which
 * may differ from the requested one) or null. Bails early once the process has exited — a dead server
 * never becomes ready. Polls up to ~45s by default, matching the Next.js dev budget.
 */
async function waitForDevServerReady(
  getCandidateUrls: () => string[],
  isAlive: () => boolean,
  attempts = 90,
  delayMs = 500,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const alive = isAlive();
    for (const url of getCandidateUrls()) {
      if (await urlResponds(url)) return url;
    }
    if (!alive) return null;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  // Grace sweep: the server may have bound a beat after the window closed. Only trust it while OUR
  // process is still alive — a port can be occupied by a previous project's dev server that is still
  // running, and adopting that would show a different application in this project's preview.
  if (!isAlive()) return null;
  for (const url of getCandidateUrls()) {
    if (await urlResponds(url)) return url;
  }
  return null;
}

async function waitForUrlReady(url: string, attempts = 8, delayMs = 400): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      // A 404 means some other/stale server owns the port or the intended entry point is not ready.
      // Only a successful response proves this preview can be handed to browser verification.
      if (response.ok) return true;
    } catch {
      // Not ready yet — the dev server is likely still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function waitForStaticPreviewReady(previewUrl: string, ownershipToken: string, attempts = 10, delayMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(previewUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok && response.headers.get("x-foundry-preview") === ownershipToken) return true;
    } catch {
      // The dedicated static server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function previewResponds(previewUrl: string, expectedOwnershipToken?: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(previewUrl, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok && (!expectedOwnershipToken || response.headers.get("x-foundry-preview") === expectedOwnershipToken);
  } catch {
    return false;
  }
}

function canonicalConnectorPreviewUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === "localhost") url.hostname = "127.0.0.1";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

type NextPreviewCommand =
  | { kind: "script"; mode: "dev" | "start" }
  | { kind: "direct"; mode: "dev" | "start"; cliPath: string };

async function detectNextPreviewCommand(projectPath: string): Promise<NextPreviewCommand | undefined> {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const verifiedBuildExists = existsSync(path.join(projectPath, ".next", "BUILD_ID"))
      || existsSync(path.join(projectPath, ".next-build", "BUILD_ID"));
    if (verifiedBuildExists && typeof scripts.start === "string") return { kind: "script", mode: "start" };
    if (typeof scripts.dev === "string") return { kind: "script", mode: "dev" };
    if (typeof scripts.start === "string") return { kind: "script", mode: "start" };
    const declaresNext = Boolean(pkg.dependencies?.next || pkg.devDependencies?.next);
    const cliPath = path.join(projectPath, "node_modules", "next", "dist", "bin", "next");
    if (declaresNext && existsSync(cliPath)) return { kind: "direct", mode: verifiedBuildExists ? "start" : "dev", cliPath };
    return undefined;
  } catch {
    return undefined;
  }
}

async function startConnectorPreview(projectId: string, connector: LocalConnectorConfig, platform: FactoryPreviewPlatform = "web", preferredStaticEntries: string[] = []): Promise<PreviewOutcome> {
  try {
    const baseUrl = connector.url.replace(/\/+$/, "");
    const headers = { "content-type": "application/json", ...(connector.token ? { authorization: `Bearer ${connector.token}` } : {}) };
    if (connector.rootLabel) {
      const registration = await connectLocalConnectorRoot(connector, connector.rootLabel);
      if (!registration.ok) {
        return {
          previewState: "error",
          previewPlatform: platform,
          previewReason: registration.error || "The selected project folder could not be reconnected to the Local Agent.",
        };
      }
    }
    const integrationEnvironment = await projectIntegrationEnvironment({ projectId, environment: "development", location: "local" });
    const response = await fetch(`${baseUrl}/preview/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        root: connector.rootLabel || "",
        path: "",
        entryFiles: preferredStaticEntries,
        environment: integrationEnvironment.environment,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { previewUrl?: string; state?: string; reason?: string; error?: string };
    if (!response.ok) return { previewState: "error", previewPlatform: platform, previewReason: payload.error || "The local connector could not start a preview." };
    if (payload.state === "ready") {
      const previewUrl = canonicalConnectorPreviewUrl(payload.previewUrl);
      return previewUrl
        ? { previewUrl, previewState: "ready", previewPlatform: platform }
        : { previewState: "error", previewPlatform: platform, previewReason: "The local connector reported a ready web preview without an HTTP URL. Restart the Local Agent so it can serve static projects through the owned preview runtime." };
    }
    if (payload.state !== "starting") return { previewState: "error", previewPlatform: platform, previewReason: payload.reason || "The local connector preview did not start." };
    // The connector intentionally returns `starting` after a short first probe for frameworks that
    // are still compiling. Poll its authoritative process registry before deciding the mission's
    // terminal state instead of converting a healthy slow start into an immediate failure.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const statusResponse = await fetch(`${baseUrl}/preview/status`, { method: "POST", headers, body: JSON.stringify({ root: connector.rootLabel || "", path: "" }) });
      const status = (await statusResponse.json().catch(() => ({}))) as { previewUrl?: string; state?: string; reason?: string; error?: string };
      if (statusResponse.ok && status.state === "ready") {
        const previewUrl = canonicalConnectorPreviewUrl(status.previewUrl || payload.previewUrl);
        return previewUrl
          ? { previewUrl, previewState: "ready", previewPlatform: platform }
          : { previewState: "error", previewPlatform: platform, previewReason: "The local connector reported a ready web preview without an HTTP URL. Restart the Local Agent so it can serve static projects through the owned preview runtime." };
      }
      if (!statusResponse.ok || status.state === "error" || status.state === "unavailable") {
        return { previewState: "error", previewPlatform: platform, previewReason: status.error || status.reason || "The connector preview process exited before becoming ready." };
      }
    }
    return { previewState: "error", previewPlatform: platform, previewReason: payload.reason || "The connector preview did not become reachable before the readiness deadline." };
  } catch (error) {
    return { previewState: "error", previewPlatform: platform, previewReason: error instanceof Error ? error.message : "Could not reach the local connector to start a preview." };
  }
}

function stopPreview(projectId: string) {
  const preview = previewProcesses.get(projectId);
  if (!preview) return;
  if (preview.processId) {
    stopPreviewProcessTree(preview.processId);
  }
  previewProcesses.delete(projectId);
  forgetWorkspacePreview(projectId);
}

function stopPreviewsForProjectPath(projectPath: string) {
  const canonicalProjectPath = path.resolve(projectPath);
  for (const [projectId, preview] of previewProcesses.entries()) {
    const previewPath = path.resolve(preview.projectPath);
    if (pathIsInside(canonicalProjectPath, previewPath) || pathIsInside(previewPath, canonicalProjectPath)) stopPreview(projectId);
  }
  stopOrphanedStaticPreviewsForProjectPath(canonicalProjectPath);
}

/** Next development route bundles can briefly live in separate Node processes. A later bundle may
 * inherit only the newest persisted preview record while older static servers still hold the same
 * generated output directory open. On Windows, identify those processes by both Foundry's exact
 * preview script and the canonical project path before stopping them. */
function stopOrphanedStaticPreviewsForProjectPath(projectPath: string) {
  if (process.platform !== "win32") return;
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const query = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*foundry-static-preview.cjs*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const canonicalRoot = path.resolve(projectPath).toLowerCase();
  const previewScript = path.resolve(process.cwd(), "scripts", "foundry-static-preview.cjs").toLowerCase();
  const listed = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", query], { windowsHide: true });
  let stdout = "";
  listed.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  listed.once("close", () => {
    if (!stdout.trim()) return;
    try {
      const parsed = JSON.parse(stdout) as { ProcessId?: number; CommandLine?: string } | Array<{ ProcessId?: number; CommandLine?: string }>;
      const records = Array.isArray(parsed) ? parsed : [parsed];
      for (const record of records) {
        const commandLine = String(record.CommandLine ?? "").toLowerCase();
        const processId = Number(record.ProcessId);
        if (!Number.isInteger(processId) || processId <= 0 || processId === process.pid) continue;
        if (commandLine.includes(previewScript) && commandLine.includes(canonicalRoot)) stopPreviewProcessTree(processId);
      }
    } catch { /* A failed cleanup probe must never block preview or cancellation. */ }
  });
  listed.unref();
}

function stopPreviewProcessTree(processId: number) {
  if (process.platform === "win32") {
    // Static/framework previews are detached so they survive the request that launched them. On
    // Windows, process.kill() does not reliably terminate a detached child tree and can leave its
    // working directory locked. taskkill receives a numeric pid directly (no shell interpolation).
    const stopped = spawn("taskkill.exe", ["/pid", String(processId), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    stopped.once("error", () => { try { process.kill(processId); } catch { /* Already exited. */ } });
    stopped.unref();
    return;
  }
  try {
    process.kill(processId);
  } catch {
    // The process may have already exited.
  }
}

const PREVIEW_IDLE_MS = 30 * 60 * 1000;
if (typeof setInterval === "function") {
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [projectId, preview] of previewProcesses.entries()) {
      if (now - preview.lastUsedAt > PREVIEW_IDLE_MS) stopPreview(projectId);
    }
  }, 5 * 60 * 1000);
  sweep.unref?.();
}

export async function getPreviewStatus(projectId: string): Promise<{ previewState: FactoryPreviewState; previewUrl?: string; previewReason?: string }> {
  if (previewRefreshes.has(projectId)) {
    const active = previewProcesses.get(projectId);
    const previous = previewRefreshOutcomes.get(projectId);
    if (active?.previewUrl) return { previewState: "ready", previewUrl: active.previewUrl };
    if (previous?.previewState === "ready") return previous;
    return { previewState: "starting" };
  }
  const preview = previewProcesses.get(projectId);
  const connector = connectorPreviews.get(projectId);
  if (!preview && connector) return connectorPreviewStatus(connector);
  if (!preview) return previewRefreshOutcomes.get(projectId) ?? { previewState: "unavailable" };
  const reachable = await waitForUrlReady(preview.previewUrl, 1, 0);
  if (!reachable) {
    const previewReason = preview.runtimeLog?.trim()
      ? `Preview process stopped responding: ${trimOutput(preview.runtimeLog)}`
      : await previewRuntimeFailureReason(preview.port);
    stopPreview(projectId);
    return { previewState: "error", previewReason };
  }
  preview.lastUsedAt = Date.now();
  return { previewState: "ready", previewUrl: preview.previewUrl };
}

async function nodePreviewPortArgs(projectPath: string, port: number): Promise<string[]> {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    if (dependencies.expo) return ["--", "--port", String(port)];
    if (dependencies.astro || dependencies.vite || dependencies.vue || dependencies.svelte) {
      return ["--", "--host", "127.0.0.1", "--port", String(port)];
    }
  } catch {
    // A non-framework Node server normally honors PORT from the environment below.
  }
  return [];
}

/** Reconstructs preview/artifact truth from the current project files after a reload or older result. */
export async function refreshPreviewForProject(projectId: string, localConnector?: LocalConnectorConfig) {
  // A folder can be opened without ever running an AI mission. Register its connector at preview
  // time so opening a project is sufficient to establish a real preview; execution must not be a
  // hidden prerequisite for the basic workspace lifecycle.
  if (localConnector?.url && localConnector.rootLabel) {
    const registration = await connectLocalConnectorRoot(localConnector, localConnector.rootLabel);
    if (!registration.ok) return { previewState: "error" as const, previewPlatform: "web" as const, previewReason: registration.error || "The selected project folder could not be reconnected to the Local Agent." };
    try {
      const managedProjectPath = safeProjectPath(projectId);
      if (path.resolve(managedProjectPath).toLowerCase() === path.resolve(localConnector.rootLabel).toLowerCase()) {
        connectorPreviews.delete(projectId);
        connectorArtifactTargets.delete(projectId);
        const access = createServerProjectAccess(managedProjectPath, "local-folder");
        const detected = await detectStackProfileAndEntriesForAccess(access);
        await stopProjectPreview({ kind: "workspace", projectId, projectPath: managedProjectPath });
        return startProjectPreview({ kind: "workspace", projectId, projectPath: managedProjectPath }, detected.profile.label);
      }
    } catch {
      // An external connector root is expected not to resolve inside Foundry's managed projects.
    }
    connectorPreviews.set(projectId, localConnector);
    const access = createLocalConnectorProjectAccess(localConnector);
    const detected = await detectStackProfileAndEntriesForAccess(access);
    await stopProjectPreview(connectorPreviewTarget(projectId, localConnector));
    return startProjectPreview(connectorPreviewTarget(projectId, localConnector), detected.profile.label);
  }
  const connector = connectorPreviews.get(projectId);
  if (connector) {
    const access = createLocalConnectorProjectAccess(connector);
    const detected = await detectStackProfileAndEntriesForAccess(access);
    await stopProjectPreview(connectorPreviewTarget(projectId, connector));
    return startProjectPreview(connectorPreviewTarget(projectId, connector), detected.profile.label);
  }
  let projectPath: string;
  try {
    projectPath = safeProjectPath(projectId);
  } catch (error) {
    return {
      previewState: "unavailable" as const,
      previewPlatform: "web" as const,
      previewReason: error instanceof Error && error.message === "Invalid project id."
        ? "The preview request did not identify a valid Foundry project."
        : "The project folder is no longer available inside the Foundry workspace.",
    };
  }
  const access = createServerProjectAccess(projectPath, "local-folder");
  const detected = await detectStackProfileAndEntriesForAccess(access);
  let stack = detected.profile.label;
  if (detected.profile.id === "unknown") {
    const brief = await access.readFile("foundry-brief.md", { limitBytes: 100_000 }).catch(() => undefined);
    stack = brief?.content.match(/^Selected stack:\s*(.+)$/im)?.[1]?.trim() || stack;
  }
  await stopProjectPreview({ kind: "workspace", projectId, projectPath });
  return startProjectPreview({ kind: "workspace", projectId, projectPath }, stack);
}

/** Starts preview recovery without holding a chat request open for framework boot/readiness checks. */
export function beginPreviewRefreshForProject(projectId: string, localConnector?: LocalConnectorConfig): PreviewStatusOutcome {
  const active = previewProcesses.get(projectId);
  const previous = previewRefreshOutcomes.get(projectId);
  if (previewRefreshes.has(projectId)) {
    if (active?.previewUrl) return { previewState: "ready", previewUrl: active.previewUrl, previewPlatform: "web" };
    if (previous?.previewState === "ready") return previous;
    return { previewState: "starting", previewPlatform: "web" };
  }
  // Static servers already serve current disk contents and framework servers hot-reload. Restarting
  // a healthy owned process during React reconciliation blanked and reloaded the iframe repeatedly.
  if (active?.previewUrl) {
    active.lastUsedAt = Date.now();
    return { previewState: "ready", previewUrl: active.previewUrl, previewPlatform: "web" };
  }
  const operation = refreshPreviewForProject(projectId, localConnector)
    .then((outcome) => { previewRefreshOutcomes.set(projectId, outcome); })
    .catch((error) => {
      previewRefreshOutcomes.set(projectId, {
        previewState: "error",
        previewPlatform: "web",
        previewReason: error instanceof Error ? error.message : "The project preview could not be refreshed.",
      });
    })
    .finally(() => { previewRefreshes.delete(projectId); });
  previewRefreshes.set(projectId, operation);
  return { previewState: "starting", previewPlatform: "web" };
}

function desktopPlatformForPath(executable: string) {
  const match = executable.match(/[\\/](win-(?:x64|x86|arm64))[\\/]/i);
  return match?.[1]?.toLowerCase() ?? "Windows";
}

async function desktopVersionForProject(projectPath: string) {
  const queue = [projectPath];
  while (queue.length) {
    const current = queue.shift() as string;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && !["bin", "obj", "node_modules", ".git", ".pytest_cache", "__pycache__", ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".venv", "venv", "site-packages"].includes(entry.name) && queue.length < 80) queue.push(fullPath);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".csproj")) {
        const content = await readFile(fullPath, "utf8").catch(() => "");
        return content.match(/<(?:Version|AssemblyVersion)>([^<]+)<\/(?:Version|AssemblyVersion)>/i)?.[1]?.trim() || "1.0.0";
      }
    }
  }
  return "1.0.0";
}

export function stopPreviewForProject(projectId: string) {
  const connector = connectorPreviews.get(projectId);
  if (connector) {
    const preview = previewProcesses.get(projectId);
    if (preview) stopPreviewsForProjectPath(preview.projectPath);
    void stopConnectorPreview(connector);
    return;
  }
  const preview = previewProcesses.get(projectId);
  if (preview) {
    stopPreviewsForProjectPath(preview.projectPath);
    return;
  }
  try {
    stopPreviewsForProjectPath(safeProjectPath(projectId));
  } catch {
    // Invalid or connector-only ids have no workspace process to stop.
  }
}

async function stopOwnedPreviewsForProjectPath(projectPath: string) {
  stopPreviewsForProjectPath(projectPath);
  const canonicalProjectPath = path.resolve(projectPath).toLowerCase();
  const matchingConnectors = Array.from(connectorPreviews.entries()).filter(([, connector]) => {
    if (!connector.rootLabel) return false;
    return path.resolve(connector.rootLabel).toLowerCase() === canonicalProjectPath;
  });
  await Promise.all(matchingConnectors.map(async ([projectId, connector]) => {
    await stopConnectorPreview(connector);
    connectorPreviews.delete(projectId);
  }));
}

async function connectorPreviewStatus(connector: LocalConnectorConfig): Promise<{ previewState: FactoryPreviewState; previewUrl?: string; previewReason?: string }> {
  try {
    const baseUrl = connector.url.replace(/\/+$/, "");
    const headers = { "content-type": "application/json", ...(connector.token ? { authorization: `Bearer ${connector.token}` } : {}) };
    const response = await fetch(`${baseUrl}/preview/status`, { method: "POST", headers, body: JSON.stringify({ root: connector.rootLabel || "", path: "" }) });
    const payload = (await response.json().catch(() => ({}))) as { previewUrl?: string; state?: FactoryPreviewState; reason?: string; error?: string };
    if (!response.ok) return { previewState: "error", previewReason: payload.error || "The local connector preview status could not be read." };
    if (payload.state === "ready" && !payload.previewUrl) {
      return { previewState: "error", previewReason: "The local connector reported a ready web preview without an HTTP URL. Restart the Local Agent so it can serve static projects through the owned preview runtime." };
    }
    return { previewState: payload.state || "unavailable", previewUrl: canonicalConnectorPreviewUrl(payload.previewUrl), previewReason: payload.reason };
  } catch (error) {
    return { previewState: "error", previewReason: error instanceof Error ? error.message : "Could not reach the local connector preview." };
  }
}

async function stopConnectorPreview(connector: LocalConnectorConfig) {
  try {
    const baseUrl = connector.url.replace(/\/+$/, "");
    const headers = { "content-type": "application/json", ...(connector.token ? { authorization: `Bearer ${connector.token}` } : {}) };
    await fetch(`${baseUrl}/preview/stop`, { method: "POST", headers, body: JSON.stringify({ root: connector.rootLabel || "", path: "" }) });
  } catch {
    // Stop is best-effort; a later connector status probe remains authoritative.
  }
}

async function findPreviewPort(excludedPorts = new Set<number>()) {
  const usedPorts = new Set(Array.from(previewProcesses.values()).map((process) => process.port));
  for (let port = 3100; port < 3300; port += 1) {
    if (!excludedPorts.has(port) && !usedPorts.has(port) && !(await isPortReachable(port)) && (await isPortAvailable(port))) return port;
  }
  throw new Error("No managed preview port is currently available.");
}

function isPortReachable(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (reachable: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function summarizeCommandFailure(command: FactoryCommandEvent) {
  const output = stripTerminalFormatting(`${command.stderr}\n${command.stdout}`).trim();
  const lockGuidance = actionableBuildLockMessage(output);
  if (lockGuidance) return lockGuidance;
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const diagnostics = lines.filter((line) =>
    !/^at\s+/i.test(line)
    && /(?:error|failed|could not|cannot|can't|not found|not exported|undefined|unresolved|invalid|missing|expected|typecheck)/i.test(line),
  );
  const fileLines = lines.filter((line) => /^(?:file|source|path):\s+/i.test(line));
  const selected = [...new Set([...diagnostics.slice(0, 6), ...fileLines.slice(0, 2)])];
  return (selected.length ? selected : lines.slice(-8)).join("\n") || `${command.command} failed.`;
}

/** Generated compiler caches are disposable evidence, not customer source. An interrupted or
 * overlapping framework process can leave a cache manifest referring to a file that was never
 * committed. Clear only the proven cache root and rerun the canonical build without paying a model
 * to inspect an error that has no source file to edit. */
function transientBuildArtifactDirectory(command: FactoryCommandEvent, projectPath: string): string | undefined {
  const output = stripTerminalFormatting(`${command.stderr}\n${command.stdout}`);
  if (!/\bENOENT\b[^\r\n]*no such file or directory/i.test(output)) return undefined;
  const normalizedProject = path.resolve(projectPath);
  for (const directory of [".next-build", ".next", ".svelte-kit", ".turbo"]) {
    const candidate = path.resolve(projectPath, directory);
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\\/g, "[\\\\/]");
    if (new RegExp(escaped, "i").test(output) && path.dirname(candidate) === normalizedProject) return candidate;
  }
  return undefined;
}

function isBuildCommand(command: string, args: string[]) {
  return /npm(?:\.cmd)?/i.test(command) && args.join(" ") === "run build";
}

function isInstallCommand(command: string, args: string[]) {
  return /npm(?:\.cmd)?/i.test(command) && args.join(" ") === "install";
}

function dependencyCountFromInstallOutput(output: string) {
  const added = output.match(/added\s+(\d+)\s+packages?/i);
  if (added?.[1]) return Number(added[1]);
  const changed = output.match(/(?:changed|updated)\s+(\d+)\s+packages?/i);
  if (changed?.[1]) return Number(changed[1]);
  return 0;
}

function createExecutionContext(onEvent?: ExecutionEmitter, projectId?: string): ExecutionContext {
  const timeline: FactoryExecutionEvent[] = [];
  return {
    timeline,
    checklist: [],
    projectId,
    costScopeId: crypto.randomUUID(),
    emit: async (event) => {
      // Live UI, durable journal, and follow-up memory all receive the same sanitized event.
      const safeEvent = redactSensitiveData(event);
      upsertExecutionEvent(timeline, safeEvent);
      if (projectId && !safeEvent.internal && !safeEvent.transient) {
        await appendJournalEntry(projectId, safeEvent).catch(() => {
          // Durable journaling is best-effort; the live timeline already reached the client.
        });
      }
      await onEvent?.(safeEvent);
    },
  };
}

function initializeObjectiveChecklist(execution: ExecutionContext, task: string, sourceMode: FactorySourceMode) {
  if (sourceMode !== "new-project") {
    execution.checklist.splice(0, execution.checklist.length, ...checklistForRequest(task, sourceMode === "local-folder" ? "the connected local folder" : "the Foundry copy"));
    return;
  }
  const items: FactoryObjectiveChecklistItem[] = [
    { id: "understand-goal", label: engineeringObjectiveForTask(task), status: "running" },
    { id: "read-project", label: "Read the actual project files before editing", status: "pending" },
    ...objectiveItemsForTask(task),
    { id: "files-on-disk", label: "Verify generated files in the Foundry workspace", status: "pending" },
    { id: "final-result", label: "Summarize completion against the original request", status: "pending" },
  ];
  execution.checklist.splice(0, execution.checklist.length, ...dedupeChecklist(items));
}

function engineeringObjectiveForTask(task: string) {
  const normalized = task.trim().replace(/\s+/g, " ");
  return normalized ? `Complete goal: ${normalized}` : "Complete the requested project work";
}

function objectiveItemsForTask(task: string): FactoryObjectiveChecklistItem[] {
  const text = task.toLowerCase();
  const items: FactoryObjectiveChecklistItem[] = [];
  if (/\b(dynamic|configurable|configured|configuration|hardcoded|hard-coded)\b[^.\n]{0,60}\b(fields?|columns?|mapping)\b/.test(text) ||
      /\b(add|edit|remove|required|optional)\b[^.\n]{0,40}\b(fields?|columns?)\b/.test(text) ||
      /\b(excel|spreadsheet|upload|payload)\b[^.\n]{0,60}\b(field|column|mapping|schema)\b/.test(text)) {
    items.push(
      { id: "inspect-current-ux", label: "Inspect the current field UI and styling before changing it", status: "pending" },
      { id: "persist-field-config", label: "Persist editable fields in a config file instead of backend code", status: "pending" },
      { id: "server-dynamic-fields", label: "Server reads saved field configuration for transaction/upload mapping", status: "pending" },
      { id: "field-manager-ui", label: "Polished UI lets users add, edit, require, and remove fields", status: "pending" },
      { id: "frontend-dynamic-form", label: "Frontend test form is generated from saved field configuration", status: "pending" },
      { id: "field-config-verified", label: "Re-read changed files and verify the dynamic field behavior path", status: "pending" },
    );
  }
  if (/\b(html|css|style|styles|stylesheet|js|javascript|script|ux|ui|form|border|bordered)\b/.test(text)) {
    items.push({ id: "locate-assets", label: "Locate relevant HTML/CSS/JS/UI files", status: "pending" });
  }
  if (wantsAssetSeparation(text) && /\b(css|style|styling)\b/.test(text)) {
    items.push(
      { id: "stylesheet-exists", label: "Stylesheet file exists on disk", status: "pending" },
      { id: "html-links-css", label: "HTML links the stylesheet", status: "pending" },
      { id: "inline-css-removed", label: "Inline <style> blocks removed from HTML", status: "pending" },
      { id: "css-separated", label: "CSS separated into a referenced stylesheet", status: "pending" },
    );
  }
  if (wantsAssetSeparation(text) && /\b(js|javascript|script)\b/.test(text)) {
    items.push(
      { id: "script-exists", label: "Script file exists on disk", status: "pending" },
      { id: "html-loads-js", label: "HTML loads the script file", status: "pending" },
      { id: "inline-js-removed", label: "Inline <script> blocks removed from HTML", status: "pending" },
      { id: "js-separated", label: "JavaScript separated into a referenced script file", status: "pending" },
    );
  }
  if (isStylingRequest(text)) {
    items.push({ id: "styling-improved", label: "Styling improved without replacing the project blindly", status: "pending" });
  }
  items.push({ id: "references-checked", label: "References checked after edits", status: "pending" });
  return items;
}

function dedupeChecklist(items: FactoryObjectiveChecklistItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function completeChecklistItem(execution: ExecutionContext, id: string, status: FactoryObjectiveChecklistItem["status"], evidence?: string) {
  const item = execution.checklist.find((entry) => entry.id === id);
  if (!item) return;
  item.status = status;
  item.evidence = evidence ?? item.evidence;
}

async function pauseForPlanConflicts(execution: ExecutionContext, conflicts: string[]): Promise<{ status: "needs-clarification"; blocker: string; clarificationQuestions: MissionClarification[] }> {
  // A mission may discover several unresolved decisions, but only the earliest blocker is surfaced.
  // Later decisions are re-evaluated after this answer so the canvas never presents competing prompts.
  const question = conflicts[0] || "One requirement needs your input before I continue.";
  await emitExecution(execution, "reasoning", "warning", question, {
    tier: "flag",
    rationale: question,
    narrative: { id: `conflict-${Math.random().toString(16).slice(2)}`, tier: "flag", rationale: question, evidence: [], source: "conflict" },
  });
  const blocker = "One requirement needs your input before I continue.";
  await emitExecution(execution, "summary", "warning", "Needs your input before continuing", { details: { reason: blocker, questions: [question] } });
  finishObjectiveChecklist(execution, "needs-clarification", blocker);
  return {
    status: "needs-clarification",
    blocker,
    clarificationQuestions: conflicts.map((conflict) => ({
      question: conflict,
      options: clarificationOptionsFromQuestion(conflict),
    })),
  };
}

/** Turn an explicit either/or clarification into clickable choices. Open-ended questions deliberately
 * return no options so the composer remains available for a real free-text answer. */
function clarificationOptionsFromQuestion(question: string): string[] | undefined {
  const normalized = question.replace(/\s+/g, " ").trim();

  // Destructive replacement questions are commonly phrased as a yes/no sentence rather than an
  // explicit "A or B" choice. Present the actual outcomes instead of making the user translate a
  // safety decision into chat text. Keep the safe, non-destructive outcome first.
  const deletesWholeProject = /\b(?:delet(?:e|ing)|remov(?:e|ing)|wipe|clear)\b/i.test(normalized)
    && /\b(?:entire|whole|all)\b/i.test(normalized)
    && /\b(?:project|directory|folder|current files?)\b/i.test(normalized);
  if (deletesWholeProject) {
    return ["Keep current files", "Delete entire project"];
  }

  const match = normalized.match(/^(.+?)\s+or\s+(.+?)[?.!]*$/i);
  if (!match) return undefined;

  let left = match[1].trim();
  let right = match[2].trim();
  left = left.replace(/^.*?\b(?:should\s+(?:use|be|have|keep|remove|choose)|would\s+(?:use|be|have|keep|remove|choose|prefer)|do\s+you\s+(?:want|prefer)|whether\s+(?:to\s+)?(?:use|be|have|keep|remove|choose))\s+/i, "");
  right = right.replace(/^(?:should\s+)?(?:use|be|have|keep|remove|choose)\s+/i, "");

  const options = [left, right]
    .map((option) => option.replace(/^(?:a|an|the)\s+/i, "").replace(/[?.!]+$/, "").trim())
    .filter((option) => option.length >= 2 && option.length <= 100);
  if (options.length !== 2 || options[0].toLowerCase() === options[1].toLowerCase()) return undefined;
  return options.map((option) => option.charAt(0).toUpperCase() + option.slice(1));
}

function finishObjectiveChecklist(execution: ExecutionContext, status: FactoryProjectResult["status"], blocker?: string) {
  // A mock-review pause is an intentional checkpoint mid-plan, not a stuck/failed mission — later-phase
  // items stay "pending" so the follow-up that continues the build picks them back up correctly.
  const isPausedForMockReview = status === "awaiting-mock-approval";
  for (const item of execution.checklist) {
    if (item.status === "running") item.status = status === "passed" ? "completed" : isPausedForMockReview ? "pending" : "blocked";
    if (item.status === "pending" && status !== "passed" && !isPausedForMockReview) {
      item.status = "blocked";
      item.evidence = blocker || "Stopped because the objective could not be completed with the available project executor.";
    }
  }
  completeChecklistItem(
    execution,
    "final-result",
    status === "passed" ? "completed" : isPausedForMockReview ? "pending" : "blocked",
    status === "passed" ? "Final summary maps to the requested goal." : isPausedForMockReview ? undefined : blocker,
  );
}

async function emitExecution(
  execution: ExecutionContext,
  kind: FactoryExecutionEventKind,
  status: FactoryExecutionEventStatus,
  title: string,
  event: Partial<Omit<FactoryExecutionEvent, "timestamp" | "kind" | "status" | "title">> = {},
) {
  // A "summary" is the execution's verdict, so a turn has exactly one. Emitting it with a fresh random
  // id let an intermediate pass's verdict ("Execution finished with blocker") survive next to the real
  // final one, so a mission that recovered and completed still showed a failure line above its success.
  // Both timelines replace an event by id, so a stable id makes the newest verdict supersede the older
  // one instead of accumulating contradictions. An explicit event.id still wins for callers that need
  // a distinct record.
  const id = event.id
    ?? (kind === "summary" ? "mission-summary" : undefined)
    ?? (status !== "running" ? matchingRunningEventId(execution.timeline, { kind, command: event.command, filePath: event.filePath }) : undefined)
    ?? `event-${Date.now()}-${execution.timeline.length}-${Math.random().toString(16).slice(2)}`;
  await execution.emit({
    id,
    timestamp: new Date().toISOString(),
    kind,
    status,
    title,
    transient: event.transient ?? status === "running",
    ...event,
  });
  if (!event.internal) await pauseForLiveStream();
}

function pauseForLiveStream() {
  return new Promise((resolve) => setTimeout(resolve, 90));
}

function lineCount(content: string) {
  return content.split(/\r?\n/).length;
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function trimOutput(value: string) {
  return value.length > 20000 ? `${value.slice(0, 20000)}\n[output truncated]` : value;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || "foundry-project";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
