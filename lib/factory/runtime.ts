import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createHash } from "node:crypto";
import { capabilityLevelForStackChoice, checklistForRequest, detectStackProfile, isLikelySmallSingleFileRequest, unsupportedCreationMessage, unsupportedEditingMessage, type StackCapabilityLevel, type StackProfile } from "@/lib/factory/language-adapters";
import { classifyIntent, deterministicMutationIntent, deterministicTaskAssessment } from "@/lib/ai/mission/intent-classifier";
import { runReadOnlyInspection } from "@/lib/ai/mission/inspector";
import { planMission } from "@/lib/ai/mission/mission-planner";
import { extractAtomicUserRequirements, isUserFacingUiOutcome, mayAttemptPriorCompletionReuse, observableBrowserContractForTask, reportsCurrentBehaviorFailure, requiresFreshBehavioralAcceptance, requiresPolishedUiAcceptance, requiresPresentationLayerChange, requiresSubstantialUiAcceptance, type ObservableBrowserCapability } from "@/lib/ai/mission/requirement-contract";
import { hasRunnableProjectEntry, runMissionExecutor } from "@/lib/ai/mission/executor";
import { reviewArchitecture } from "@/lib/ai/mission/architecture-review";
import { verifyMissionResult } from "@/lib/ai/mission/mission-verifier";
import { verificationAction, verificationImproved, verificationRisk } from "@/lib/ai/mission/verification-policy";
import { detectVerificationProfile } from "@/lib/verification/project-detector";
import { compilerDiagnosticOutput, compilerFailureFingerprint, extractCompilerSourcePaths, isCompilerSourcePath } from "@/lib/verification/compiler-evidence";
import { deterministicCompilerSourceRepair } from "@/lib/verification/deterministic-source-repair";
import { hasDisposableFrameworkAssetFailure } from "@/lib/verification/browser-infrastructure";
import type { VerificationProfile } from "@/lib/verification/types";
import { assessMissionComplexity, shouldRunArchitectureReview, shouldRunVerify, tierForStage } from "@/lib/ai/mission/orchestration";
import { createExecutionStrategy, tierForCapability, type ExecutionStrategy } from "@/lib/ai/mission/execution-strategy";
import { DEFAULT_MISSION_QUALITY, type MissionQualityLevel } from "@/lib/ai/mission/quality-level";
import type { ProviderId } from "@/lib/ai/providers/types";
import { apiKeyForProvider } from "@/lib/ai/providers/dispatch";
import type { ModelMode, ModelTier } from "@/lib/ai/model-router";
import { routeDynamically } from "@/lib/ai/routing/dynamic-router";
import { profileTask } from "@/lib/ai/routing/task-profiler";
import type { DynamicTaskAssessment } from "@/lib/ai/routing/types";
import { discoverProjectWorkingSet, type ProjectWorkingSet } from "@/lib/ai/routing/project-working-set";
import { connectLocalConnectorRoot, createLocalConnectorProjectAccess, createServerProjectAccess, createUploadedProjectAccess, isSensitiveFilePath, type LocalConnectorConfig, type PlatformValidationResult, type ProjectAccess } from "@/lib/ai/mission/project-access";
import type { ExecutionMissionVerification, FactoryArtifact, FactoryCommandEvent, FactoryExecutionEvent, FactoryExecutionEventKind, FactoryExecutionEventStatus, FactoryExistingProjectRequest, FactoryFileEntry, FactoryJournalEntry, FactoryNarrativeObject, FactoryObjectiveChecklistItem, FactoryPreviewPlatform, FactoryPreviewState, FactoryProjectResult, FactorySessionSummary, FactorySourceMode, FactoryUploadedFile, MissionClarification, MissionParentContext, StructuredDiscovery } from "@/lib/factory/types";
import { environmentReadinessForStack } from "@/lib/toolchains/provisioner";
import { explicitReadOnlyProjectIntent, type FollowUpResolutionRecord } from "@/lib/mission/classifyFollowUp";
import { reconcileBlockedCommandChecklist } from "@/lib/factory/evidence-reconciliation";
import { isWholeProjectDeletionRequest, parseProjectDeletionLockApprovalCommand, projectDeletionApprovalCommand, projectDeletionLockApprovalCommand } from "@/lib/factory/project-deletion";
import { customInstructionsFromProjectBrief } from "@/lib/factory/project-brief";
import { assessAutonomousBlocker, terminalBlockerWithNextAction } from "@/lib/ai/mission/autonomy-contract";
import { compactValidationProblems, matchingRunningEventId, upsertExecutionEvent } from "@/lib/factory/event-contract";
import { buildOnlyRecoveryCanComplete, shouldResumeIncompleteGeneratedProject } from "@/lib/factory/recovery-policy";
import { redactSensitiveData, redactSensitiveText } from "@/lib/security/secret-redaction";
import { explicitProjectFileNames, isExplicitLocalProjectFileRequest } from "@/lib/sources/intent";
import { stripTerminalFormatting } from "@/lib/text/terminal";
import { actionableBuildLockMessage, forgetOwnedDesktopProcess, registerOwnedDesktopProcess } from "@/lib/factory/owned-desktop-processes";
import { desktopInteractionActionsForTask } from "@/lib/factory/desktop-acceptance";

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

function attachedAssetDirectory(stackId: string) {
  return /^(?:nextjs|react|vite|static-html|astro|remix|svelte)/i.test(stackId) ? "public/foundry-uploads" : "assets/foundry-uploads";
}

async function materializeAttachedProjectAssets(access: ProjectAccess, attachments: EvidenceAttachments, task: string, stackId: string, materializeAll = false) {
  const explicitAssetRequest = requestsAttachedFilesAsProjectAssets(task);
  const projectAssets = attachments.filter((attachment) => materializeAll || attachment.evidenceKind === "photo" || explicitAssetRequest);
  if (!projectAssets.length || !access.writeBinary) return { assets: [] as MaterializedProjectAsset[], failures: [] as string[] };
  const directory = attachedAssetDirectory(stackId);
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
      publicPath: directory.startsWith("public/") ? `/${projectPath.slice("public/".length)}` : projectPath,
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
  for (const match of output.matchAll(/(?:Module not found:\s*)?Can't resolve\s+['"]([^'"]+)['"]/gi)) {
    const specifier = match[1]?.trim();
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#") || specifier.startsWith("node:")) continue;
    const packageName = specifier.startsWith("@")
      ? /^@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/.exec(specifier)?.[0]
      : /^[A-Za-z0-9._-]+/.exec(specifier)?.[0];
    if (packageName) unresolved.add(packageName);
  }
  // @prisma/client is generated by the Prisma CLI. Installing the runtime package alone can leave
  // a second predictable failure, so compiler evidence for that import authorizes its paired CLI.
  if (unresolved.has("@prisma/client")) unresolved.add("prisma");
  return [...unresolved].sort();
}

function compatibleGeneratedPackageSpec(packageName: string) {
  return packageName === "prisma" || packageName === "@prisma/client" ? `${packageName}@^6.0.0` : packageName;
}

function workingSetWithCommandFailure(base: ProjectWorkingSet, failure: FactoryCommandEvent, projectPath: string): ProjectWorkingSet {
  const output = stripTerminalFormatting(`${failure.stdout}\n${failure.stderr}`);
  const referenced = new Set<string>();
  const contractOwners = new Set<string>();
  for (const sourcePath of extractCompilerSourcePaths(output, projectPath)) referenced.add(sourcePath);
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
  const match = /Could not resolve\s+["']([^"']+)["']\s+from\s+["']([^"']+)["']/i.exec(output);
  if (!match?.[1]?.startsWith(".") || !match[2]) return undefined;
  const importer = match[2].replace(/\\/g, "/");
  const target = path.relative(projectPath, path.resolve(projectPath, path.dirname(importer), match[1])).replace(/\\/g, "/");
  if (!target || target.startsWith("../") || path.isAbsolute(target) || existsSync(path.join(projectPath, target))) return undefined;
  return { importer, specifier: match[1], target };
}

function commandTracebackSourcePaths(workingSet: ProjectWorkingSet, projectPath: string, limit = 3): string[] {
  return workingSet.evidence
    .map((item) => /^(.*?) \(command traceback\)$/.exec(item)?.[1]?.trim())
    .filter((item): item is string => Boolean(item))
    .filter((item) => existsSync(path.join(projectPath, item)) && isCompilerSourcePath(item))
    .slice(0, limit);
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
    discovery.mainFeatures.length ? `Required behavior:\n${discovery.mainFeatures.slice(0, 10).map((item) => `- ${conciseRequirement(item, 180)}`).join("\n")}` : "",
    discovery.dataModel.length ? `Data: ${discovery.dataModel.slice(0, 8).map((item) => conciseRequirement(item, 140)).join("; ")}` : "",
    discovery.styleDirection ? `Design: ${conciseRequirement(discovery.styleDirection, 220)}` : "",
    discovery.keyFacts.length ? `Constraints:\n${discovery.keyFacts.slice(0, 8).map((item) => `- ${conciseRequirement(item, 160)}`).join("\n")}` : "",
    discovery.decisions.length
      ? `Accepted decisions:\n${discovery.decisions.slice(0, 8).map((item) => `- ${conciseRequirement(item.dimension, 50)}: ${conciseRequirement(item.hypothesis, 150)}`).join("\n")}`
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
type PreviewProcessRecord = { port: number; processId?: number; lastUsedAt: number; previewUrl: string; projectPath: string; kind: "static" | "app"; ownershipToken?: string; runtimeLog?: string };
const previewProcessGlobal = globalThis as typeof globalThis & { __foundryPreviewProcesses?: Map<string, PreviewProcessRecord> };
// Next.js compiles API routes into separate module graphs. A module-local map lets the execution
// route start a detached preview while the preview/stop route sees an empty registry and falsely
// reports success. Process-global ownership keeps start/status/stop consistent across route bundles
// and survives development hot reloads without orphaning locked project directories.
const previewProcesses = previewProcessGlobal.__foundryPreviewProcesses ??= new Map<string, PreviewProcessRecord>();
const workspacePreviewRegistryDirectory = path.join(process.cwd(), ".foundry-data", "preview-processes-v1");

function workspacePreviewRecordPath(projectId: string) {
  return path.join(workspacePreviewRegistryDirectory, `${createHash("sha256").update(projectId).digest("hex")}.json`);
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

function journalPathFor(projectId: string) {
  const cleanId = projectId.replace(/[^a-zA-Z0-9-]/g, "_") || "project";
  return path.join(journalsRoot, cleanId, "journal.ndjson");
}

async function appendJournalEntry(projectId: string, event: FactoryExecutionEvent) {
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

export async function createFactoryProject(brief: string, onEvent?: ExecutionEmitter, discovery?: StructuredDiscovery, modelMode: ModelMode = "auto", quality: MissionQualityLevel = DEFAULT_MISSION_QUALITY, signal?: AbortSignal, evidenceAttachments: EvidenceAttachments = []): Promise<FactoryProjectResult> {
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
  const offerMockGate = stackProfile.id !== "static-html" && distinctPhases >= 2 && hasLivePreviewFor(stackProfile.label);

  // Establish the selected stack's minimum runnable contract before any model edit. edit_file
  // cannot create a missing manifest, and build/preview must never guess one later.
  await ensureRequestedStackScaffold(projectPath, stackProfile, spec.projectName, execution, events, spec.stack);
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
    maxTurns: stackProfile.id === "static-html" ? 8 : creationStrategy.workflow === "bounded-artifact" ? 10 : undefined,
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
  const maxCreationContinuationBatches = 1;
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
      ...result.changedFiles,
    ]));
  }

  // A model-budget boundary after real source generation is not evidence that the project failed.
  // For non-JavaScript ecosystems, detect the repository's declared verification profile and run
  // those commands mechanically before asking for another model call. JavaScript keeps its more
  // specialized install/build recovery immediately below.
  const budgetBoundaryAfterGeneration = result.status === "failed"
    && result.changedFiles.length > 0
    && /Estimated request cost would exceed|Model-call limit reached|configured execution limit/i.test(result.blocker ?? "");
  if (budgetBoundaryAfterGeneration && access.runCommand) {
    const generatedProfile = (await detectStackProfileAndEntriesForAccess(access)).verificationProfile;
    if (generatedProfile.adapterId !== "javascript" && generatedProfile.commands.length > 0) {
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
  if (!alreadyBuilt && existsSync(path.join(projectPath, "package.json"))) {
    try {
      const packageJson = JSON.parse(await readFile(path.join(projectPath, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      if (packageJson.scripts?.build) {
        await emitExecution(execution, "command", "running", "Running the declared production build as the final deterministic verification gate");
        if (!existsSync(path.join(projectPath, "node_modules"))) {
          result.commands.push(await runCommand(projectPath, "npm.cmd", ["install", "--prefer-offline", "--no-audit", "--no-fund"], events, execution));
        }
        if (!result.commands.some((command) => /\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+install\b/i.test(command.command) && command.exitCode !== 0)) {
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
    const unresolvedPackages = unresolvedPackageNames(deterministicBuildFailure);
    if (unresolvedPackages.length) {
      await emitExecution(execution, "reasoning", "completed", `The compiler identified ${unresolvedPackages.length} undeclared package${unresolvedPackages.length === 1 ? "" : "s"}. I’m installing only those exact dependencies, then rerunning the same production build without another model call.`, {
        details: { packages: unresolvedPackages },
      });
      const dependencyInstall = await runCommand(projectPath, "npm.cmd", ["install", "--prefer-offline", "--no-audit", "--no-fund", ...unresolvedPackages.map(compatibleGeneratedPackageSpec)], events, execution);
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
  let compilerRepairPass = 0;
  while (partialGenerationCanUseCompilerRecovery && deterministicBuildFailure && result.changedFiles.length > 0 && !signal?.aborted) {
    compilerRepairPass += 1;
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
    const failureFingerprint = compilerFailureFingerprint(deterministicBuildFailure, projectPath);
    const failureAttempt = (compilerFailureAttempts.get(failureFingerprint) ?? 0) + 1;
    compilerFailureAttempts.set(failureFingerprint, failureAttempt);
    if (failureAttempt > 2) {
      result.status = "failed";
      result.blocker = `The production compiler still reports the same source error after a targeted repair and one stronger escalation: ${summarizeCommandFailure(deterministicBuildFailure)}`;
      await emitExecution(execution, "summary", "error", "Compiler repair reached a genuine repeated-error blocker", {
        details: { failureFingerprint, attempts: failureAttempt - 1, paidRepeatPrevented: true, blocker: result.blocker },
      });
      break;
    }
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
      requireFirstMutation: Boolean(compilerSourceEvidence || missingImport),
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
    result.timeline.push(...buildRepair.timeline);
    result.usage.push(...buildRepair.usage);
    result.turnsUsed += buildRepair.turnsUsed;

    if (!buildRepair.changedFiles.length) {
      // Do not rerun a known-failing build when the repair route made no source change. The same
      // fingerprint receives one stronger action-enforced repair on the next iteration.
      continue;
    }

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
      });
      result.commands.push(...ecosystemGate.commands);
      result.verification.push(...ecosystemGate.verification);
      const ecosystemFailureAttempts = new Map<string, number>();
      while (!ecosystemGate.passed && ecosystemGate.failure && !signal?.aborted) {
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
          });
          result.commands.push(...ecosystemGate.commands);
          result.verification.push(...ecosystemGate.verification);
          continue;
        }
        const failureFingerprint = compilerFailureFingerprint(failure, projectPath);
        const failureAttempt = (ecosystemFailureAttempts.get(failureFingerprint) ?? 0) + 1;
        ecosystemFailureAttempts.set(failureFingerprint, failureAttempt);
        if (failureAttempt > 2) {
          result.status = "failed";
          result.blocker = `Required ${generatedVerificationProfile.ecosystem} verification still reports the same error after a targeted repair and one stronger escalation: ${summarizeCommandFailure(failure)}`;
          await emitExecution(execution, "summary", "error", `${generatedVerificationProfile.ecosystem} repair reached a genuine repeated-error blocker`, {
            details: { failureFingerprint, attempts: failureAttempt - 1, paidRepeatPrevented: true, blocker: result.blocker },
          });
          break;
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
        result.timeline.push(...repair.timeline);
        result.usage.push(...repair.usage);
        result.turnsUsed += repair.turnsUsed;
        if (!repair.changedFiles.length) continue;

        ecosystemGate = await runRequiredVerificationProfile({
          access,
          execution,
          profile: generatedVerificationProfile,
          projectPath,
          existingCommands: result.commands,
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
    && /turn budget|not completed|Model-call limit reached|Estimated request cost would exceed/i.test(result.blocker ?? "");
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
    result.status === "passed" || onlyBoundedBookkeepingRemains ? "passed" : result.status === "awaiting-approval" ? "awaiting-approval" : result.status === "awaiting-mock-approval" ? "awaiting-mock-approval" : "failed";
  let blocker = result.status === "passed" || onlyBoundedBookkeepingRemains ? undefined : result.blocker;
  const mockGateReached = status === "awaiting-mock-approval";
  const productionBuildPassed = result.commands.some((command) =>
    command.exitCode === 0 && isProductionBuildCommand(command.command),
  );

  // A successful real build is enough to expose the actual preview for the remaining interactive
  // gate even when the mission is still honestly blocked on browser/playthrough evidence.
  const generatedPreviewTarget = { kind: "workspace" as const, projectId, projectPath };
  let preview = status === "passed" || mockGateReached || productionBuildPassed ? await startProjectPreview(generatedPreviewTarget, stackProfile.label, events, execution) : undefined;
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
    if (!browserEvidence.verified && stackProfile.id === "static-html") {
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
        }
      }
    }
    const browserRepairChangedFiles = new Set<string>();
    for (let repairAttempt = 1; !browserEvidence.verified && !browserEvidence.infrastructureFailure && repairAttempt <= 3; repairAttempt += 1) {
      await emitExecution(execution, "reasoning", "completed", repairAttempt === 1
        ? "The rendered project exposed concrete browser failures. I’m repairing all verified evidence, rebuilding, restarting its owned preview, and running the same checks again."
        : `The generated project still has verified browser failures after repair ${repairAttempt - 1}. I’m continuing from the changed source with the remaining evidence.`);
      const staticBrowserRepair = stackProfile.id === "static-html";
      const repairTier: ModelTier = /explicit acceptance requirements/i.test(browserEvidence.evidence)
        && !/(?:Console:|Page error:|Failed local request:|browser interaction failed)/i.test(browserEvidence.evidence)
        ? "fast"
        : "builder";
      const browserRepairModel = await modelForMissionStage(task, modelMode, repairTier, undefined, repairAttempt, creationAssessment) ?? implementationModel;
      await emitModelSelection(execution, `browser repair ${repairAttempt}`, browserRepairModel);
      const repair = await runMissionExecutor({
        objective,
        task: `Repair every remaining verified failure in this generated ${staticBrowserRepair ? "static" : "framework"} web project so it passes the real desktop and mobile browser preview check. Preserve the requested product, architecture, pages, and working interactions. Resolve every distinct missing route, failed request, console error, interaction defect, and responsive problem below; do not stop after the first symptom${staticBrowserRepair ? ". Use self-contained CSS/data placeholders instead of unreliable remote assets when images are broken" : ". Coordinate source, routes, and styling changes across the existing framework project"}.\n\nOriginal user request:\n${task}\n\nRemaining verified browser failure:\n${browserEvidence.evidence}`,
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
        staticProject: staticBrowserRepair,
        staticRewrite: staticBrowserRepair,
        evidenceFirstRepair: !staticBrowserRepair,
        evidenceRepairReadPaths: staticBrowserRepair ? undefined : await verifiedBrowserRepairReadPaths(access, browserEvidence.evidence),
        executionStrategy: creationStrategy,
        routingAssessment: creationAssessment,
        evidenceImages,
        maxTurns: staticBrowserRepair ? 3 : 8,
        maxNudges: 1,
        maxOutputTokens: staticBrowserRepair ? undefined : 5_000,
        routingBudget: staticBrowserRepair ? undefined : { maximumModelCalls: 10, estimatedCostUsd: 1 },
      });
      result.usage.push(...repair.usage);
      result.changedFiles = [...new Set([...result.changedFiles, ...repair.changedFiles])];
      result.commands.push(...repair.commands);
      modelUsage = summarizeModelUsage(result.usage);
      if (signal?.aborted || repair.status === "stopped" || repair.changedFiles.length === 0) {
        browserEvidence = {
          verified: false,
          evidence: `${browserEvidence.evidence} Automatic repair made no further source change${repair.blocker ? `: ${repair.blocker}` : "."}`,
          brokenImageSources: browserEvidence.brokenImageSources,
          acceptanceVerified: false,
        };
        break;
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
      }
    }
    if (browserRepairChangedFiles.size > 0) {
      result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
      result.sessionSummary.outcome = browserEvidence.verified
        ? "Foundry repaired the generated project’s browser-evidenced defects, rebuilt it, restarted its owned preview, and verified the finished desktop/mobile experience."
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
      blocker = browserEvidence.evidence;
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
    status === "passed" ? "completed" : mockGateReached ? "completed" : "error",
    status === "passed" ? "Behavior verified" : mockGateReached ? "First working mock ready for review" : "Execution finished with blocker",
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
    events,
    files,
    commands,
    previewUrl: preview?.previewUrl,
    previewState: preview?.previewState,
    previewPlatform: preview?.previewPlatform,
    previewReason: preview?.previewReason,
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
  acceptanceUrl?: string;
};

async function validateObservableBrowserContract(
  page: import("playwright").Page,
  task: string,
  urls: string[],
): Promise<{ verified: boolean; applicable: boolean; evidence: string; problem?: string; bestUrl?: string }> {
  const contract = observableBrowserContractForTask(task);
  const requested = [...new Set(contract.requirements.flatMap((item) => item.capabilities))];
  if (!requested.length) {
    return { verified: false, applicable: false, evidence: "No deterministic rendered capability contract could be derived from this request." };
  }

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
    } catch {
      // Navigation health is reported by the main browser gate; this probe only records positive capability evidence.
    }
  }

  const covered = new Set(observations.flatMap((item) => item.capabilities));
  const missing = requested.filter((capability) => !covered.has(capability));
  const best = observations.sort((left, right) => right.capabilities.filter((item) => requested.includes(item)).length - left.capabilities.filter((item) => requested.includes(item)).length)[0];
  const fullyContracted = contract.unsupported.length === 0;
  const verified = fullyContracted && missing.length === 0;
  const evidence = `Requirement-directed browser acceptance covered ${requested.length - missing.length}/${requested.length} observable capabilities across ${observations.length} reachable route(s)${best?.url ? `; strongest matching surface: ${best.url}` : ""}.`;
  const problems = missing.length ? [`missing rendered capability: ${missing.join(", ")}`] : [];
  const unsupportedEvidence = contract.unsupported.length ? ` No deterministic browser contract was available for: ${contract.unsupported.join("; ")}.` : "";
  return problems.length
    ? { verified, applicable: true, evidence: `${evidence} ${problems.join(". ")}.${unsupportedEvidence}`, problem: `The browser health check passed, but requested behavior acceptance did not: ${problems.join(". ")}.`, bestUrl: best?.url }
    : { verified, applicable: true, evidence: `${evidence}${unsupportedEvidence}`, bestUrl: best?.url };
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
  const sourcePaths = extractCompilerSourcePaths(diagnostic, projectPath);
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
      const requestedExperienceProbe = await validateRequestedStaticExperience(page, requestedTask);
      const authProbe: { evidence: string; problem?: string } = /\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|registration|sign\s*in|signin|log\s*in|login)\b/i.test(requestedTask)
        ? { evidence: "The task-aware browser check exercised the requested authentication experience." }
        : await validateDetectedAuthFlow(page);
      const taskAwareInteractionCompleted = /\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|registration|sign\s*in|signin|log\s*in|login)\b/i.test(requestedTask);
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
      const observableAcceptanceProbe = await validateObservableBrowserContract(page, requestedTask, [previewUrl, ...internalHrefs]);
      const responsiveLayoutChecks: Array<{ url: string; viewport: string; issues: string[] }> = [];
      const responsiveLayoutIssues = new Set<string>();
      const responsiveTargets = Array.from(new Set([previewUrl, ...internalHrefs]));
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
                if (bounds.left < -4 || bounds.right > window.innerWidth + 4) {
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
      const acceptanceScreenshotUrl = observableAcceptanceProbe.bestUrl || previewUrl;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(acceptanceScreenshotUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.locator("body").waitFor({ state: "visible", timeout: 5_000 });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const actionableConsoleErrors = Array.from(consoleErrors).filter((error) =>
        failedHttpResponses.size === 0 || !/^Failed to load resource:/i.test(error),
      );
      const problems = [
        ...(response && response.status() >= 400 ? [`Preview returned HTTP ${response.status()}.`] : []),
        ...(expectedOwnershipToken && response?.headers()["x-foundry-preview"] !== expectedOwnershipToken
          ? ["The preview response was not owned by this project; Foundry refused stale output from another server."]
          : []),
        ...actionableConsoleErrors.map((error) => `Console: ${error}`),
        ...Array.from(failedHttpResponses).map((responseFailure) => `HTTP response: ${responseFailure}.`),
        ...Array.from(pageErrors).map((error) => `Page error: ${error}`),
        ...Array.from(failedLocalRequests).map((url) => `Failed local request: ${url}`),
        ...(rendered.duplicateIds.length ? [`Duplicate element ID(s) make browser interactions ambiguous: ${rendered.duplicateIds.join(", ")}.`] : []),
        ...(rendered.misplacedControls.length ? [`Visible control(s) escaped their semantic layout container: ${rendered.misplacedControls.join(", ")}.`] : []),
        ...(rendered.brokenImages ? [`${rendered.brokenImages} visibly broken image(s) remained in the rendered interface.`] : []),
        ...(rendered.textLength < 80 || rendered.height < 240 || (rendered.meaningfulElements < 1 && rendered.interactiveControls < 2 && rendered.productCards < 3) ? ["The rendered page did not contain enough meaningful visible application content."] : []),
        ...(requiresSubstantialUiAcceptance(requestedTask) && (rendered.textLength < 500 || rendered.meaningfulElements < 7 || rendered.interactiveControls < 10 || rendered.formFields < 2 || rendered.styledControls < 8)
          ? [`The request described an advanced or feature-rich product, but the rendered interface was still a thin shell (${rendered.textLength} text characters, ${rendered.meaningfulElements} semantic regions, ${rendered.interactiveControls} controls, ${rendered.formFields} form fields, ${rendered.styledControls} intentionally styled controls).`]
          : []),
        ...(authProbe.problem ? [authProbe.problem] : []),
        ...(requestedExperienceProbe.problem ? [requestedExperienceProbe.problem] : []),
        ...(observableAcceptanceProbe.problem ? [observableAcceptanceProbe.problem] : []),
        ...(interactionProbe.problem ? [interactionProbe.problem] : []),
        ...navigationFailures,
        ...Array.from(responsiveLayoutIssues).map((issue) => `Responsive layout: ${issue}.`),
      ];
      const verified = problems.length === 0;
      const infrastructureFailure = hasDisposableFrameworkAssetFailure(problems);
      const visibleProblems = compactValidationProblems(problems);
      const evidence = verified
        ? `Real browser preview rendered successfully (${rendered.textLength} text characters, ${rendered.meaningfulElements} semantic regions, ${rendered.interactiveControls} interactive controls). ${observableAcceptanceProbe.evidence} Exercised ${navigationChecks.length} same-origin navigation target(s), ${responsiveLayoutChecks.length} desktop/mobile route layout check(s), and ${interactionProbe.verified ? "one representative control" : "the rendered surface"} with no console, page, local-request, responsive-layout, interaction, or navigation errors. Screenshot of ${acceptanceScreenshotUrl}: ${screenshotPath}`
        : `Browser preview verification failed: ${visibleProblems.join(" ")} ${observableAcceptanceProbe.evidence} Screenshot of ${acceptanceScreenshotUrl}: ${screenshotPath}`;
      await emitExecution(execution, "preview", verified ? "completed" : "error", verified ? "Rendered project verified" : "Rendered project failed verification", { details: { previewUrl, screenshotPath, acceptanceUrl: observableAcceptanceProbe.bestUrl, acceptanceVerified: observableAcceptanceProbe.verified, consoleErrors: actionableConsoleErrors, pageErrors: Array.from(pageErrors), failedLocalRequests: Array.from(failedLocalRequests), failedHttpResponses: Array.from(failedHttpResponses), navigationChecksJson: JSON.stringify(navigationChecks), responsiveLayoutChecksJson: JSON.stringify(responsiveLayoutChecks), authProbe: authProbe.evidence, requestedExperienceProbe: requestedExperienceProbe.evidence, observableAcceptanceProbe: observableAcceptanceProbe.evidence, interactionProbe: interactionProbe.evidence, ...rendered } });
      return { verified, evidence, brokenImageSources: rendered.brokenImageSources, infrastructureFailure, acceptanceVerified: observableAcceptanceProbe.verified, acceptanceUrl: observableAcceptanceProbe.bestUrl };
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
      const probeValue = `Foundry preview check ${Date.now()}`;
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

async function repairBrokenStaticImages(access: ProjectAccess, brokenSources: string[], execution: ExecutionContext) {
  const entries = await access.listDir("");
  const entry = entries.find((item) => item.kind === "file" && /\.html?$/i.test(item.name));
  if (!entry) return false;
  const source = await access.readFile(entry.name, { limitBytes: 500_000 });
  if (!source.exists || source.truncated) return false;

  // Keep the fallback safe in HTML attributes, single-quoted JavaScript strings,
  // double-quoted JavaScript strings, and JSON. Literal SVG attribute quotes can
  // terminate the generated source context when a broken URL is replaced in place.
  const placeholder = "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22800%22%20height=%22600%22%20viewBox=%220%200%20800%20600%22%3E%3Crect%20width=%22800%22%20height=%22600%22%20fill=%22%23f4e7df%22/%3E%3Cpath%20d=%22M160%20420l150-150%2090%2090%2090-100%20150%20160z%22%20fill=%22%23d8b4a0%22/%3E%3Ccircle%20cx=%22570%22%20cy=%22180%22%20r=%2252%22%20fill=%22%23fff7ed%22/%3E%3C/svg%3E";
  let content = source.content;
  for (const brokenSource of brokenSources) content = content.split(brokenSource).join(placeholder);
  if (content === source.content && !content.includes("data-foundry-image-fallback")) {
    const fallback = `<script data-foundry-image-fallback>document.querySelectorAll('img').forEach((image)=>{const fallback=${JSON.stringify(placeholder)};const repair=()=>{if(image.src!==fallback)image.src=fallback};image.addEventListener('error',repair,{once:true});if(image.complete&&image.naturalWidth===0)repair()});</script>`;
    content = content.replace(/<\/body\s*>/i, `${fallback}</body>`);
  }
  if (content === source.content) return false;

  await emitExecution(execution, "edit", "running", "Replacing broken preview images with reliable local fallbacks", { filePath: entry.name });
  const write = await access.writeFile(entry.name, content);
  await emitExecution(execution, "edit", write.verified ? "completed" : "error", write.verified ? "Repaired broken preview images" : "Could not repair broken preview images", {
    filePath: entry.name,
    details: { repairedImages: brokenSources.length, reason: write.reason },
  });
  return write.verified;
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
  const safeFiles = uploadedFiles.filter((file) => isUsefulUploadedFile(file.path)).map((file) => ({ ...file, path: safeRelativePath(file.path) })).filter((file) => file.path);
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
  const projectPath = await uniqueProjectPath(`uploaded-${slugify(projectName || connectedPath) || "project-copy"}`);
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
  await writeVirtualFilesToDisk(projectPath, new Map(safeFiles.map((file) => [file.path, file.content])));
  await emitExecution(execution, "file", "completed", "Copied uploaded files into Foundry target", {
    filePath: projectPath,
    details: { reason: "Uploaded files need a writable Foundry copy. Export the result to use it outside Foundry.", files: safeFiles.length },
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
  const preview = mission.status === "passed" && !mission.projectDeleted && missionHasPreviewableWork(mission) ? await startProjectPreview({ kind: "workspace", projectId, projectPath }, detected.stack, events, execution) : undefined;
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
  const preview = mission.status === "passed" && !mission.projectDeleted && missionHasPreviewableWork(mission) ? await startProjectPreview(connectorPreviewTarget(projectId, connector), mission.stackLabel ?? "Local connector project", events, execution) : undefined;
  if (preview) {
    const isReady = preview.previewState === "ready";
    await emitExecution(execution, "preview", isReady ? "completed" : "error", isReady ? "Preview ready" : "Preview failed its live readiness check", { details: { previewUrl: preview.previewUrl, reason: preview.previewReason, state: preview.previewState } });
  }
  const reusedMission = mission.verification?.some((item) => item.check_type === "file-read" && /complete SHA-256 fingerprints/i.test(item.evidence));
  if (mission.status === "passed" && reusedMission && (!preview || preview.previewState === "ready")) {
    await emitExecution(execution, "summary", "completed", "Request already completed and verified", { details: { reusedResult: true, paidModelCalls: 0 } });
  }

  return existingProjectResult({
    projectId,
    projectName,
    projectPath: rootLabel,
    briefPath: `${rootLabel}/foundry-brief.md`,
    stack: mission.stackLabel ?? "Local connector project",
    status: mission.status,
    blocker: mission.blocker,
    clarificationQuestions: mission.clarificationQuestions,
    events,
    files,
    commands,
    execution,
    sourceMode: "local-folder",
    objective: engineeringObjectiveForTask(task),
    preview,
    sessionSummary: mission.sessionSummary,
    verification: mission.verification,
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
  const existingEnvironment = await environmentReadinessForStack(capabilityLevelForStackChoice(detected.stack).id);
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
  const preview = status === "passed" && !mission.projectDeleted && missionHasPreviewableWork(mission) ? await startProjectPreview({ kind: "workspace", projectId, projectPath }, detected.stack, events, execution) : undefined;
  if (status === "passed" && preview?.previewPlatform === "web" && preview.previewState !== "ready") {
    status = "failed";
    blocker = preview.previewReason || "The web preview did not reach a verified ready state.";
    verification.push({ check_type: "preview", result: "fail", evidence: blocker });
    finishObjectiveChecklist(execution, "failed", blocker);
  }
  if (status === "passed" && detected.stack === "Static HTML/CSS/JS" && preview?.previewUrl) {
    // A follow-up extends the durable project contract; it does not replace it. Validate the saved
    // creation brief and the current instruction together so "preserve everything" cannot pass after
    // a rewrite silently removes earlier controls, seed data, or interaction requirements.
    const acceptanceTask = `${brief.trim()}\n\nCurrent follow-up requirement:\n${task.trim()}`;
    let browserEvidence = await validateGeneratedStaticPreview(preview.previewUrl, projectPath, execution, preview.previewOwnershipToken, acceptanceTask);
    if (!browserEvidence.verified && !reusedMission) {
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
      if (reusedMission) {
        await emitExecution(execution, "summary", "completed", "Request already completed and verified", { details: { reusedResult: true, paidModelCalls: 0 } });
      }
    } else if (status === "passed") {
      status = "failed";
      blocker = reusedMission
        ? `The matching implementation is unchanged, but it no longer passes current browser verification. No paid repair call was made: ${browserEvidence.evidence}`
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
    artifact: preview?.artifact,
    projectDeleted: mission.projectDeleted,
    timeline: execution.timeline,
    sessionSummary,
    clarificationQuestions,
    verification,
    environment: existingEnvironment,
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
}): Promise<{ status: FactoryProjectResult["status"]; blocker?: string; clarificationQuestions?: MissionClarification[]; changedFiles: string[]; commands?: FactoryCommandEvent[]; sessionSummary?: FactorySessionSummary; verification?: ExecutionMissionVerification[]; events: string[]; projectDeleted?: boolean }> {
  const { projectPath, task, sourceMode, execution, signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceAttachments, idempotencyCandidate, retryExecutionId } = params;
  const access = createServerProjectAccess(projectPath, sourceMode, signal);
  const snapshot = await buildProjectSnapshot(access);
  return runExistingProjectMissionWithAccess({ access, task, sourceMode, execution, projectSnapshot: snapshot, workspaceProjectPath: projectPath, previewTarget: workspacePreviewTarget(projectPath), signal, approvedCategories, approvedCommands, parentMission, followUpResolution, continuity, approvalResponse, quality, modelMode, evidenceAttachments, idempotencyCandidate, retryExecutionId });
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
}): Promise<{ status: FactoryProjectResult["status"]; blocker?: string; clarificationQuestions?: MissionClarification[]; changedFiles: string[]; commands?: FactoryCommandEvent[]; sessionSummary?: FactorySessionSummary; verification?: ExecutionMissionVerification[]; events: string[]; stackLabel?: string; projectDeleted?: boolean }> {
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
    || Boolean(deterministicMutationIntent(requestedTask))
  );
  const exactRetry = Boolean(retryExecutionId && parentMission?.id === retryExecutionId);
  const standaloneMutationRequest = Boolean(deterministicMutationIntent(requestedTask));
  const isControlContinuation = Boolean(approvalResponse)
    || exactRetry
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
  const projectDeletion = await handleWholeProjectDeletion({
    access,
    execution,
    requestedTask,
    parentMission,
    approvalResponse,
    signal,
  });
  if (projectDeletion) return projectDeletion;
  // Approval clicks are bounded control turns. Do not start each one on the premium builder tier.
  let workingSet = await discoverProjectWorkingSet(access, task);
  await emitExecution(execution, "reasoning", "completed", workingSet.likelyFiles.length
    ? `Working set selected: ${workingSet.likelyFiles.slice(0, 3).join(", ")}${workingSet.likelyFiles.length > 3 ? " and their dependencies" : ""}.`
    : "Project discovery found no task-specific files; implementation will inspect dependencies as needed.");
  const onEvent = (event: FactoryExecutionEvent) => execution.emit(event);
  const objective = engineeringObjectiveForTask(task);
  const detectedStack = await detectStackProfileAndEntriesForAccess(access);
  let stackProfile = detectedStack.profile;
  const { rootEntries, verificationProfile } = detectedStack;
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
  const requiresCurrentBehaviorAcceptance = requiresFreshBehavioralAcceptance(requestedTask);
  // A current defect report always overrides older completion evidence. For other behavioral work,
  // reuse is permitted only where Foundry can immediately run a requirement-directed web gate.
  // Native desktop/mobile, APIs, CLIs, and background workflows must execute normally until their
  // behavior is exercised by a platform-specific acceptance driver.
  const priorCompletionCanBeReused = mayAttemptPriorCompletionReuse(requestedTask, reusePreviewPlatform);
  const exactFailedRetry = Boolean(
    exactRetry
    && retryExecutionId === parentMission?.id
    && parentMission
    && (parentMission.state === "failed" || parentMission.state === "cancelled")
    && followUpResolution?.currentIntent === "continue"
    && continuity === "carry_forward_plan"
    && !approvalResponse
    && evidenceAttachments.length === 0,
  );
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
          const browser = await validateGeneratedStaticPreview(preview.previewUrl, previewArtifactRoot(previewTarget), execution, preview.previewOwnershipToken, requestedTask);
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
          const browser = await validateGeneratedStaticPreview(preview.previewUrl, previewArtifactRoot(previewTarget), execution, preview.previewOwnershipToken, requestedTask);
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
  const inheritedBrowserRequest = `${requestedTask}\n${parentMission?.source_requirements.join("\n") ?? ""}`;
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
  if (explicitBrowserAcceptanceRequest && previewTarget) {
    await emitExecution(execution, "preview", "running", "Running the real build and desktop/mobile browser gate before model routing", {
      details: { paidModelCalls: 0, purpose: "evidence-first browser validation" },
    });
    const browserPreflightBuild = await runCanonicalProjectBuild();
    if (browserPreflightBuild) preModelCommands.push(browserPreflightBuild);
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
  const approvedCommand = approvalResponse && approvalResponse.decision !== "deny"
    ? approvalResponse.requestedCommand.trim()
    : "";
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
    finishObjectiveChecklist(execution, "failed", blocker);
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
  if (materializedAssets.length) {
    const assetContract = materializedAssets.map((asset) => `- ${asset.sourceFileName} -> ${asset.publicPath} (project file: ${asset.projectPath})`).join("\n");
    task = `${task}\n\nAttached project asset contract (already written and byte-verified by Foundry):\n${assetContract}\nUse these exact local files in the requested implementation. If the user asked to replace existing assets or remove extras, remove the old generated/remote references and leave only the requested attached assets in that surface. Do not regenerate substitutes.`;
    workingSet = await discoverProjectWorkingSet(access, task);
    await emitExecution(execution, "file", "completed", `Imported ${materializedAssets.length} attached project asset${materializedAssets.length === 1 ? "" : "s"}`, {
      details: { files: materializedAssets.map((asset) => asset.projectPath), byteVerified: true, paidModelCalls: 0 },
    });
  }

  const hasGeneratedRunnableEntry = await hasRunnableProjectEntry(access);
  const savedBriefForRecovery = await access.readFile("foundry-brief.md", { limitBytes: 100_000 }).catch(() => undefined);
  const isFoundryGeneratedProject = savedBriefForRecovery?.exists
    && /^Mode:\s*Build new project$/im.test(savedBriefForRecovery.content)
    && /^Project source(?: mode)?:\s*Create inside Foundry workspace$/im.test(savedBriefForRecovery.content);
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
    hasRunnableEntry: hasGeneratedRunnableEntry,
    isControlContinuation: explicitlyContinuingIncompleteMission,
    hasOpenPlanItems: parentHasOpenPlanItems,
    commandOnly: explicitCommandOnlyRequest,
    deletesProject: /^\s*(?:delete|remove|erase)\s+(?:this\s+)?project\b/i.test(requestedTask),
  });
  const resumingIncompleteStaticProject = resumingIncompleteProject && stackProfile.id === "static-html";
  const recoveryScaffoldFiles = resumingIncompleteProject && workspaceProjectPath
    ? await ensureRequestedStackScaffold(workspaceProjectPath, stackProfile, path.basename(workspaceProjectPath), execution, [], savedBriefForRecovery?.exists ? parseBrief(savedBriefForRecovery.content).stack : stackProfile.label)
    : [];
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
  const enforcedReadOnlyIntent = explicitReadOnlyProjectIntent(task);
  const skipClassifyCall = Boolean(preModelBrowserEvidence) || resumingIncompleteProject || Boolean(approvalResponse) || (continuity === "carry_forward_plan" && isControlContinuation) || looksUnambiguouslyLikeSmallEdit(task) || boundedStaticFollowUp;
  const classification = enforcedReadOnlyIntent
    ? {
        intent: enforcedReadOnlyIntent === "question" ? "question" as const : "analyze" as const,
        needsProjectInspection: enforcedReadOnlyIntent === "inspection",
        rationale: "Deterministic read-only authority boundary: manual guidance and explicit no-change requests cannot enter mutation execution.",
      }
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
  const deterministicIntent = deterministicMutationIntent(task);
  if (explicitCommandOnlyRequest && (classification.intent === "question" || classification.intent === "status" || classification.intent === "analyze")) {
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
    : constrainAccessToFollowUpScope(capabilityAccess, followUpResolution, execution, requestedTask);
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
  // Browser acceptance tests the user's concrete outcome, not the planner/executor context
  // envelope. For a referential continuation ("do it", "go ahead"), recover the nearest prior
  // requirement that exposes a browser-observable capability.
  const browserAcceptanceTask = [
    requestedTask,
    parentMission?.source_requirements.join("\n"),
    referencedProposal,
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()))
    .find((candidate) => observableBrowserContractForTask(candidate).requirements.some((item) => item.capabilities.length > 0))
    ?? requestedTask;
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
  // When the real working set is already bounded, read it once in the runtime and put that exact
  // source into the implementation request. Paying a coding model to list and reread a known
  // one-file static project wastes the mission budget before the first possible edit.
  const mutationReadyWorkingSet = boundedCoordinatedEdit || boundedStaticFollowUp;
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
  const directExecutionLane = Boolean(preModelBrowserEvidence) || boundedStaticFollowUp || explicitCommandOnlyRequest || fastLane || boundedDebug || boundedCoordinatedEdit;
  const carryForwardPlan = !explicitCommandOnlyRequest && !resumingIncompleteProject && continuity === "carry_forward_plan" && Boolean(parentMission?.plan.length) && stackProfile.level >= 4;
  if (!directExecutionLane && !carryForwardPlan) await emitExecution(execution, "planning", "running", "Planning the approach", { internal: true });
  let checklist: FactoryObjectiveChecklistItem[];
  if (resumingIncompleteProject) {
    const inheritedPlan = parentMission?.plan.map((item) => item.status === "completed" || item.status === "skipped"
      ? { ...item }
      : { ...item, status: "pending" as const, evidence: undefined });
    checklist = inheritedPlan?.length ? inheritedPlan : [
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
      : [{ id: preModelBrowserEvidence ? "browser-evidenced-repair" : explicitCommandOnlyRequest ? "operation-verified" : boundedDebug ? "bounded-debug-repair" : "small-edit-applied", label: preModelBrowserEvidence ? "Repair the verified desktop/mobile browser failure and rerun acceptance" : explicitCommandOnlyRequest ? `Run and verify without source changes: ${requestedTask.trim()}` : `Complete: ${task.trim()}`, status: "pending" as const }];
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
  const missionStrategy = createExecutionStrategy({
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
  if (!resumingIncompleteProject && shouldRunArchitectureReview(quality, strategyComplexity, strategyHighRisk)) {
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
  const fullGeneratedRecovery = resumingIncompleteProject && !hasGeneratedRunnableEntry;
  const parentHasUnresolvedImplementation = parentHasOpenPlanItems;
  const boundedCompilerRepair = !fullGeneratedRecovery && isBoundedCompilerPreflightFailure(recoveryPreflight, workspaceProjectPath);
  let compilerRepairEvidence: string | undefined;
  let compilerRepairReadPaths: string[] = [];
  let implementationModel = initialModel!;
  let result: Awaited<ReturnType<typeof runMissionExecutor>>;
  // A green compiler proves only that the generated project is structurally buildable. When the
  // zero-model browser preflight already found a concrete product defect, do not short-circuit the
  // implementation stage and then rediscover the same defect at the final gate.
  if (buildOnlyRecoveryCanComplete({
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
      await emitExecution(execution, "reasoning", "completed", "The production command exited 0, but the project still has no runnable application entry. Foundry is continuing from the saved brief instead of presenting an empty 404 runtime as a verified build.", {
        details: { paidModelCallsBeforeDecision: 0, runnableEntry: false },
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
    await emitExecution(execution, "reasoning", "completed", `The working plan is ready. I’m applying the ${classification.intent === "debug" ? "smallest evidence-backed repair" : "requested change"} now and will report any scope change before escalating.`);
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
    hasBuildTooling: explicitCommandOnlyRequest ? false : stackHasBuildStep(stackProfile.id),
    verificationProfile,
    executionStrategy: missionStrategy,
    evidenceImages,
    routingAssessment,
    commandOnly: explicitCommandOnlyRequest,
    initialProjectEvidence: boundedWorkingSetEvidence ?? compilerRepairEvidence,
    requireFirstMutation: Boolean(boundedWorkingSetEvidence || compilerRepairEvidence || boundedCompilerRepair),
    avoidFirstMutationPaths: boundedCoordinatedEdit
      ? parentMission?.files_touched.filter((file) => file.verified).map((file) => file.path)
      : undefined,
    newProject: resumingIncompleteProject && !boundedCompilerRepair,
    continuableBatch: resumingIncompleteProject && !boundedCompilerRepair,
    staticProject: resumingIncompleteStaticProject || boundedStaticFollowUp,
    evidenceFirstRepair: Boolean(preModelBrowserEvidence || boundedCompilerRepair),
    evidenceRepairReadPaths: [...new Set([...compilerRepairReadPaths, ...preModelRepairReadPaths])],
    maxTurns: preModelBrowserEvidence ? 6 : boundedCompilerRepair ? 6 : approvalResponse ? 20 : boundedStaticFollowUp ? 3 : boundedCoordinatedEdit ? 12 : resumingIncompleteStaticProject ? 8 : resumingIncompleteProject ? 32 : undefined,
    maxOutputTokens: preModelBuildFailure ? 1_500 : preModelBrowserEvidence ? 5_000 : boundedCompilerRepair ? 1_500 : boundedStaticWholeRewrite ? 16_000 : boundedStaticFollowUp ? 3_000 : boundedCoordinatedEdit ? 5_000 : resumingIncompleteProject ? 6_000 : undefined,
    // Completing a generated application is not a small edit. Keep one shared ceiling and the
    // restart-safe daily kill switch, but reserve enough room for multiple verified 3-4 file batches,
    // a compiler repair, and runtime verification. No-progress/repeated-write guards still stop waste.
    routingBudget: preModelBuildFailure ? { estimatedCostUsd: 0.08 } : preModelBrowserEvidence ? { estimatedCostUsd: 0.8 } : boundedCompilerRepair ? { estimatedCostUsd: 0.08 } : boundedStaticFollowUp ? { estimatedCostUsd: 0.5 } : boundedCoordinatedEdit ? { estimatedCostUsd: 1 } : resumingIncompleteProject ? { maximumModelCalls: 40, estimatedCostUsd: 3 } : undefined,
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
  const boundedStaticWriteAwaitingBrowser = boundedStaticFollowUp
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
      routingBudget: { maximumModelCalls: 8, estimatedCostUsd: 1 },
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
  const stalledBeforeFirstMutation = !resumingIncompleteProject
    && !explicitCommandOnlyRequest
    && result.status === "failed"
    && result.changedFiles.length === 0
    && /NO_PROGRESS_BEFORE_MUTATION|lost a clear next step|did not call required tool (?:replace_in_file|write_file)|existing file content unchanged|no-progress action/i.test(result.blocker ?? "");
  if (stalledBeforeFirstMutation) {
    await emitExecution(execution, "reasoning", "completed", "The first edit pass inspected the right files but did not apply the requested change. I’m retrying once with a stronger implementation route and the verified working set preserved.");
    const actionRecoveryModel = await modelForMissionStage(task, modelMode, "builder", workingSet, 1, routingAssessment) ?? implementationModel;
    await emitModelSelection(execution, "implementation action recovery", actionRecoveryModel);
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
      maxTurns: 6,
      maxNudges: 1,
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
    const profileGate = await runRequiredVerificationProfile({ access, execution, profile: verificationProfile, projectPath: workspaceProjectPath, existingCommands: result.commands });
    result.commands.push(...profileGate.commands);
    result.verification.push(...profileGate.verification);
    if (!profileGate.passed) {
      deterministicProfileBlocker = `Required ${verificationProfile.ecosystem} command or file write failed: ${profileGate.failure ? `${profileGate.failure.command} — ${summarizeCommandFailure(profileGate.failure)}` : "no runnable required verification command was available."}`;
      result.status = "failed";
      result.blocker = deterministicProfileBlocker;
      task = `${task}\n\nRequired deterministic verification failure (authoritative):\n${deterministicProfileBlocker}\nRepair this exact failure, then rerun every required verification command.`;
      if (profileGate.failure) workingSet = workingSetWithCommandFailure(await discoverProjectWorkingSet(access, task), profileGate.failure, workspaceProjectPath ?? access.rootLabel);
      await emitExecution(execution, "summary", "error", `Required ${verificationProfile.ecosystem} verification failed`, { details: { blocker: deterministicProfileBlocker, paidModelCalls: 0 } });
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
    } else if (modelBudgetBoundaryAfterVerifiedEdit) {
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
    && (resumingIncompleteProject || candidate.changedFiles.length > 0)
    && !assessAutonomousBlocker(candidate.blocker ?? "").terminal
    && !(noProgressBoundaryAfterVerifiedEdit && acceptedUiOutcome && previewPlatformForStack(stackProfile.label) === "web")
    && /NO_PROGRESS_(?:BEFORE|AFTER)_MUTATION|command or file write failed|production build (?:not verified|failed)|Checklist item\(s\) not completed/i.test(candidate.blocker ?? "");
  const needsGeneratedEntryContinuation = resumingIncompleteProject
    && !(await hasRunnableProjectEntry(executorAccess));
  // A substantial greenfield product can legitimately need more than one bounded executor batch.
  // Preserve one routing/cost identity across continuation batches. On-disk progress can continue,
  // but a batch boundary must never reset the amount the user authorized this mission to spend.
  const maxContinuationBatches = Math.max(1, Math.min(8, Number(process.env.FOUNDRY_MAX_AUTONOMOUS_RECOVERY_STAGES) || 4));
  const attemptedRecoveryFingerprints = new Set<string>();
  for (let continuationAttempt = 1; continuationAttempt <= maxContinuationBatches && resumableBatchFailure(result); continuationAttempt += 1) {
    const lastFailedCommand = [...result.commands].reverse().find((command) => command.exitCode !== 0);
    const recoveryFingerprint = createHash("sha256").update([
      result.blocker ?? "",
      lastFailedCommand?.command ?? "",
      lastFailedCommand?.stderr ?? lastFailedCommand?.stdout ?? "",
      result.changedFiles.slice().sort().join("|"),
    ].join("\n").replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds?)\b/gi, "<duration>")).digest("hex");
    if (attemptedRecoveryFingerprints.has(recoveryFingerprint)) {
      await emitExecution(execution, "planning", "warning", "Skipped a repeated paid recovery attempt", {
        internal: true,
        details: { recoveryFingerprint, paidCallPrevented: true, unchangedEvidence: true },
      });
      break;
    }
    attemptedRecoveryFingerprints.add(recoveryFingerprint);
    await emitExecution(execution, "reasoning", "completed", `The implementation files are on disk, but batch ${continuationAttempt} did not finish the mission. I’m continuing automatically with the remaining work instead of asking you to restart.`);
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
      hasBuildTooling: explicitCommandOnlyRequest ? false : stackHasBuildStep(stackProfile.id),
      verificationProfile,
      executionStrategy: missionStrategy,
      routingAssessment,
      commandOnly: explicitCommandOnlyRequest,
      // File count is not an application contract. Configuration, styles, and helper components can
      // easily exceed three files while the project still has no route/entry and renders only 404.
      newProject: needsGeneratedEntryContinuation,
      continuableBatch: resumingIncompleteProject,
      staticProject: resumingIncompleteStaticProject,
      maxTurns: resumingIncompleteProject ? 32 : 16,
      maxNudges: 2,
    });
    result = {
      ...continuation,
      changedFiles: Array.from(new Set([...result.changedFiles, ...continuation.changedFiles])),
      commands: [...result.commands, ...continuation.commands],
      verification: [...result.verification, ...continuation.verification],
      timeline: [...result.timeline, ...continuation.timeline],
    };
  }

  if (deterministicProfileBlocker && result.status !== "stopped" && access.runCommand) {
    if (previewTarget && verificationProfile.commands.some((item) => item.required && !item.longRunning && isProductionBuildCommand(item.command))) {
      await stopProjectPreview(previewTarget);
    }
    const finalProfileGate = await runRequiredVerificationProfile({ access, execution, profile: verificationProfile, projectPath: workspaceProjectPath, existingCommands: result.commands });
    result.commands.push(...finalProfileGate.commands);
    result.verification.push(...finalProfileGate.verification);
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

  if (result.status === "passed" && shouldRunVerify(quality) && !boundedStaticFollowUp && !result.alreadySatisfied && !completedFromBudgetBoundaryVerification && !(advancedFromNoProgressBoundaryVerification && acceptedUiOutcome) && !recoveryPreflight?.buildPassed && !boundedCompilerRepairBuildPassed) {
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
    if (preModelBrowserEvidence && result.changedFiles.length > 0 && stackHasBuildStep(stackProfile.id)) {
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
            ? "The production build passed after the evidence-first source repair."
            : `The production build failed after the evidence-first source repair: ${summarizeCommandFailure(repairedBuild)}`,
        });
      }
    }
    const buildPassed = result.commands.some((command) => command.exitCode === 0 && isProductionBuildCommand(command.command));
    if (!buildPassed && stackHasBuildStep(stackProfile.id)) {
      result.status = "failed";
      result.blocker = "Real browser verification was requested, but the canonical production build did not pass first.";
    } else {
      let managedPreview = previewTarget
        ? await startProjectPreview(previewTarget, stackProfile.label, [], execution)
        : { previewState: "unavailable" as const, previewPlatform: "web" as const, previewReason: "This project source does not expose an owned preview target." };
      if (!managedPreview.previewUrl || managedPreview.previewPlatform !== "web") {
        result.status = "failed";
        result.blocker = managedPreview.previewReason || "Real browser verification was requested, but Foundry could not start an owned web preview.";
      } else {
        let browserEvidence = await validateGeneratedStaticPreview(managedPreview.previewUrl, previewArtifactRoot(previewTarget!), execution, managedPreview.previewOwnershipToken, browserAcceptanceTask);
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
            }
          }
        }
        const browserRepairChangedFiles = new Set<string>();
        // Browser acceptance is a product gate, not a one-shot suggestion. Continue only while each
        // bounded pass makes a real source change, and keep every pass in the mission's shared cost scope.
        for (let repairAttempt = 1; !browserEvidence.verified && !browserEvidence.infrastructureFailure && !modelBudgetBoundaryAfterVerifiedEdit && repairAttempt <= 3; repairAttempt += 1) {
          const staticBrowserRepair = stackProfile.id === "static-html";
          await emitExecution(execution, "reasoning", "completed", repairAttempt === 1
            ? "The real desktop/mobile preview exposed concrete failures. I’m repairing all verified evidence, rebuilding, restarting the owned preview, and exercising the same routes again."
            : `Browser acceptance still has verified failures after repair ${repairAttempt - 1}. I’m continuing from the changed source with only the remaining evidence.`);
          const repairModel = await modelForMissionStage(inheritedOperationRequest, modelMode, "builder", workingSet, parentMission?.state === "failed" ? repairAttempt : repairAttempt - 1, routingAssessment) ?? initialModel!;
          await emitModelSelection(execution, `browser repair ${repairAttempt}`, repairModel);
          const repair = await runMissionExecutor({
            objective,
            task: `Repair every remaining verified failure in this existing ${staticBrowserRepair ? "static" : "framework"} web project. Preserve the saved product requirements and every working route or interaction. Resolve every distinct item in the evidence below, including missing routes, failed requests, console errors, and responsive defects; do not stop after the first symptom. Then run the smallest relevant source check.\n\nSaved and current requirements:\n${inheritedOperationRequest}\n\nRemaining verified browser failure:\n${browserEvidence.evidence}`,
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
            routingBudget: staticBrowserRepair ? undefined : { maximumModelCalls: 10, estimatedCostUsd: 1 },
          });
          result.changedFiles = [...new Set([...result.changedFiles, ...repair.changedFiles])];
          result.commands.push(...repair.commands);
          result.verification.push(...repair.verification);
          result.timeline.push(...repair.timeline);
          result.usage.push(...repair.usage);
          result.turnsUsed += repair.turnsUsed;
          if (signal?.aborted || repair.status === "stopped" || repair.changedFiles.length === 0) break;
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
          }
        }
        result.verification.push({ check_type: "preview", result: browserEvidence.verified ? "pass" : "fail", evidence: browserEvidence.evidence });
        const browserMayCompleteMission = browserEvidence.verified
          && (result.status !== "failed" || ((modelBudgetBoundaryAfterVerifiedEdit || noProgressBoundaryAfterVerifiedEdit) && browserEvidence.acceptanceVerified))
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
          if (modelBudgetBoundaryAfterVerifiedEdit) {
            result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
            result.sessionSummary.outcome = "Implemented the requested project change and verified the changed interface in desktop and mobile browsers.";
            result.sessionSummary.flags = result.sessionSummary.flags.filter((flag) => !/model-call limit|configured execution limit|provider fallbacks|another paid model call/i.test(flag));
          }
          for (const item of result.checklist) {
            if (item.status === "pending" || item.status === "running" || item.status === "blocked") {
              item.status = "completed";
              item.evidence = browserEvidence.evidence;
            }
          }
        } else if (!browserEvidence.verified) {
          result.status = "failed";
          result.blocker = browserEvidence.evidence;
          result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
          result.sessionSummary.outcome = browserRepairChangedFiles.size > 0
            ? "Foundry changed and rebuilt the project, but the real browser gate still has unresolved product defects."
            : "The production build passed, but the real browser gate still has unresolved product defects.";
          result.sessionSummary.changes = [...new Set([...result.sessionSummary.changes, ...browserRepairChangedFiles])];
          result.sessionSummary.flags = [browserEvidence.evidence];
          for (const item of result.checklist) {
            if (item.status !== "skipped") {
              item.status = "blocked";
              item.evidence = browserEvidence.evidence;
            }
          }
        } else {
          result.status = "failed";
          result.blocker = `The project is healthy, but Foundry could not prove the requested behavior on a reachable rendered surface. ${browserEvidence.evidence}`;
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
  const deterministicDesktopAcceptanceRequested = currentPreviewPlatform === "desktop"
    && result.status === "passed"
    && result.changedFiles.length > 0
    && requiresFreshBehavioralAcceptance(inheritedOperationRequest);
  if (deterministicDesktopAcceptanceRequested) {
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
    const interactionRequired = desktopActions.length > 0;
    const desktopVerified = Boolean(desktopEvidence?.verified && (!interactionRequired || desktopEvidence.interactionVerified));
    const evidence = desktopVerified
      ? desktopEvidence?.reason || "The requested desktop interaction completed and the application remained running."
      : desktopEvidence?.reason || desktopPreview.previewReason || "The desktop artifact could not be launched for behavioral acceptance.";
    result.verification.push({ check_type: "preview", result: desktopVerified ? "pass" : "fail", evidence });
    await emitExecution(execution, "preview", desktopVerified ? "completed" : "error", desktopVerified ? "Desktop behavior verified" : "Desktop behavior still needs repair", {
      details: { platform: "desktop", interactionRequired, actionsJson: JSON.stringify(desktopActions), interactionVerified: desktopEvidence?.interactionVerified, stepsJson: JSON.stringify(desktopEvidence?.steps ?? []), windowTitles: desktopEvidence?.windowTitles, evidence },
    });
    if (!desktopVerified) {
      result.status = "failed";
      result.blocker = evidence;
      result.sessionSummary = result.sessionSummary ?? { outcome: "", changes: [], preserved: [], flags: [] };
      result.sessionSummary.outcome = "The source change and desktop build are preserved, but the requested native interaction did not pass.";
      result.sessionSummary.flags = [evidence];
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
  if (result.sessionSummary) result.sessionSummary = { ...result.sessionSummary, flags: [...result.sessionSummary.flags, residualRisk] };

  if (verificationRisk(verification.confidence) === "material" && !improved) {
    const disagreement = secondOpinionDisagreed
      ? "A second verifier also materially disagreed with the original assessment."
      : "The repair pass did not improve the verification result.";
    if (result.sessionSummary) result.sessionSummary = { ...result.sessionSummary, flags: [...result.sessionSummary.flags, disagreement] };
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
  const originalRequest = input.parentMission?.source_requirements.join("\n") || input.requestedTask;
  if (!isWholeProjectDeletionRequest(originalRequest)) return undefined;

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
  const ignored = /^(?:node_modules|\.git|\.next|\.pytest_cache|__pycache__|\.mypy_cache|\.ruff_cache|\.tox|\.nox|\.venv|venv|site-packages|bin|obj|dist|build|artifacts|coverage)$/i;
  const found: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
  while (queue.length) {
    const current = queue.shift() as { path: string; depth: number };
    const entries = await access.listDir(current.path).catch(() => []);
    for (const entry of entries) {
      const relative = current.path ? `${current.path}/${entry.name}` : entry.name;
      if (entry.kind === "file" && manifests.test(entry.name)) found.push(relative);
      if (entry.kind === "directory" && current.depth < 2 && !ignored.test(entry.name) && queue.length < 80) queue.push({ path: relative, depth: current.depth + 1 });
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

export async function rebuildFactoryProject(projectId: string): Promise<FactoryProjectResult> {
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
    artifact: preview?.artifact,
    exportUrl: `/api/factory/export?projectId=${encodeURIComponent(projectId)}`,
  };
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
  const truthfulStatus: FactoryProjectResult["status"] = previewFailed ? "failed" : status;
  const truthfulBlocker = previewFailed
    ? preview.previewReason || "The web preview did not reach a verified ready state."
    : blocker;
  const truthfulVerification = [
    ...(verification ?? []),
    ...(previewFailed ? [{ check_type: "preview" as const, result: "fail" as const, evidence: truthfulBlocker! }] : []),
  ];
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
  const entryFiles = paths.filter((item) => /(^|\/)(index|main|app)\.html$/i.test(item) || /\.html$/i.test(item)).slice(0, 8);
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

type PreviewOutcome = { previewUrl?: string; previewState: FactoryPreviewState; previewPlatform: FactoryPreviewPlatform; previewReason?: string; previewOwnershipToken?: string; artifact?: FactoryArtifact };

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

async function startProjectPreview(target: ProjectPreviewTarget, stack: string, events: string[] = [], execution?: ExecutionContext): Promise<PreviewOutcome> {
  if (target.kind === "connector") {
    connectorPreviews.set(target.projectId, target.connector);
    const platform = previewPlatformForStack(stack);
    if (["desktop", "android", "mobile", "report"].includes(platform)) {
      const artifact = await findConnectorBuildArtifact(target.projectId, target.connector, platform);
      if (artifact) return artifact;
      return { previewState: "unavailable", previewPlatform: platform, previewReason: previewUnavailableReason(platform, stack) };
    }
    return startConnectorPreview(target.connector, platform);
  }
  return startPreview(target.projectId, target.projectPath, stack, events, execution);
}

async function stopProjectPreview(target: ProjectPreviewTarget) {
  if (target.kind === "connector") {
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

async function runRequiredVerificationProfile(input: {
  access: ProjectAccess;
  execution: ExecutionContext;
  profile: VerificationProfile;
  projectPath?: string;
  existingCommands: FactoryCommandEvent[];
}): Promise<{ passed: boolean; commands: FactoryCommandEvent[]; verification: ExecutionMissionVerification[]; failure?: FactoryCommandEvent }> {
  const { access, execution, profile, projectPath, existingCommands } = input;
  const commands: FactoryCommandEvent[] = [];
  const verification: ExecutionMissionVerification[] = [];
  const run = async (command: string) => {
    const alreadyPassed = [...existingCommands, ...commands].some((item) => item.command.trim() === command.trim() && item.exitCode === 0);
    if (alreadyPassed) return [...existingCommands, ...commands].find((item) => item.command.trim() === command.trim() && item.exitCode === 0) as FactoryCommandEvent;
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

  const required = profile.commands.filter((item) => item.required && !item.longRunning);
  if (!required.length) return { passed: false, commands, verification };
  for (const check of required) {
    const checked = await run(check.command);
    const passed = checked.exitCode === 0;
    const checkType: ExecutionMissionVerification["check_type"] = check.stage === "lint" ? "lint" : check.stage === "typecheck" ? "typecheck" : check.stage === "compile" || check.stage === "build" ? "build" : /test|regression/.test(check.stage) ? "test" : "command";
    verification.push({ check_type: checkType, result: passed ? "pass" : "fail", evidence: passed ? `${profile.ecosystem} ${check.stage} passed: ${check.command}.` : `${profile.ecosystem} ${check.stage} failed: ${summarizeCommandFailure(checked)}` });
    if (!passed) return { passed: false, commands, verification, failure: checked };
  }
  return { passed: true, commands, verification };
}

function missionHasPreviewableWork(mission: { changedFiles: string[]; commands?: Array<{ exitCode: number | null }>; verification?: ExecutionMissionVerification[] }) {
  return mission.changedFiles.length > 0
    || Boolean(mission.commands?.some((command) => command.exitCode === 0))
    || Boolean(mission.verification?.some((item) => item.result === "pass"));
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

async function ensureRequestedStackScaffold(projectPath: string, stack: StackProfile, projectName: string, execution: ExecutionContext, events: string[], selectedStack = stack.label): Promise<string[]> {
  if (existsSync(path.join(projectPath, "package.json"))) return [];
  const safeName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "foundry-project";
  if (stack.id === "nextjs") {
    const usesPrisma = /\bprisma\b/i.test(selectedStack);
    const manifest = `${JSON.stringify({
      name: safeName,
      version: "0.1.0",
      private: true,
      scripts: { dev: "next dev", build: "next build", start: "next start" },
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
    await writeFile(path.join(projectPath, "package.json"), manifest, "utf8");
    if (!existsSync(path.join(projectPath, "tsconfig.json"))) await writeFile(path.join(projectPath, "tsconfig.json"), tsconfig, "utf8");
    events.push("Created stack scaffold: package.json", "Created stack scaffold: tsconfig.json");
    await emitExecution(execution, "file", "completed", "Created verified Next.js project scaffold", {
      fileName: "package.json",
      filePath: "package.json",
      details: { reason: "The selected stack requires a real manifest and build scripts before preview or verification can begin." },
    });
    return ["package.json", "tsconfig.json"];
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
        react: "19.1.0", "react-dom": "19.1.0", "react-native": "0.81.5", "react-native-safe-area-context": "~5.6.0",
        "react-native-screens": "~4.16.0", "react-native-web": "~0.21.0",
      },
      devDependencies: { "@types/react": "^19.1.0", "babel-preset-expo": "^54.0.0", typescript: "^5.9.0" },
    }, null, 2)}\n`;
    const appConfig = `${JSON.stringify({ expo: { name: projectName, slug: safeName, version: "1.0.0", orientation: "portrait", userInterfaceStyle: "automatic", scheme: safeName, plugins: ["expo-router"], experiments: { typedRoutes: true }, web: { bundler: "metro", output: "static" } } }, null, 2)}\n`;
    const tsconfig = `${JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true, paths: { "@/*": ["./*"] } }, include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"] }, null, 2)}\n`;
    const layout = `import { Stack } from "expo-router";\n\nexport default function RootLayout() {\n  return <Stack screenOptions={{ headerShown: false }} />;\n}\n`;
    const entry = `import { StyleSheet, Text, View } from "react-native";\nimport { SafeAreaView } from "react-native-safe-area-context";\n\nexport default function HomeScreen() {\n  return (\n    <SafeAreaView style={styles.safe}>\n      <View style={styles.container}>\n        <Text accessibilityRole="header" style={styles.title}>${projectName.replace(/`/g, "")}</Text>\n        <Text style={styles.body}>Preparing the first verified field workflow…</Text>\n      </View>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#f4f7f8" }, container: { flex: 1, padding: 24, justifyContent: "center" }, title: { color: "#102a33", fontSize: 30, fontWeight: "700" }, body: { color: "#47636c", fontSize: 16, marginTop: 12 } });\n`;
    await mkdir(path.join(projectPath, "app"), { recursive: true });
    await writeFile(path.join(projectPath, "package.json"), manifest, "utf8");
    await writeFile(path.join(projectPath, "app.json"), appConfig, "utf8");
    await writeFile(path.join(projectPath, "tsconfig.json"), tsconfig, "utf8");
    await writeFile(path.join(projectPath, "expo-env.d.ts"), "/// <reference types=\"expo/types\" />\n", "utf8");
    await writeFile(path.join(projectPath, "app", "_layout.tsx"), layout, "utf8");
    await writeFile(path.join(projectPath, "app", "index.tsx"), entry, "utf8");
    const files = ["package.json", "app.json", "tsconfig.json", "expo-env.d.ts", "app/_layout.tsx", "app/index.tsx"];
    events.push(...files.map((file) => `Created stack scaffold: ${file}`));
    await emitExecution(execution, "file", "completed", "Created verified Expo project scaffold", {
      fileName: "package.json",
      filePath: "package.json",
      details: { reason: "The selected React Native stack requires a real Expo manifest, typed configuration, router entry, and runnable screen before model-driven product implementation begins.", files },
    });
    return files;
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
  await writeFile(path.join(projectPath, "package.json"), manifest, "utf8");
  await writeFile(path.join(projectPath, "tsconfig.json"), tsconfig, "utf8");
  await writeFile(path.join(projectPath, "postcss.config.mjs"), postcssConfig, "utf8");
  events.push("Created stack scaffold: package.json", "Created stack scaffold: tsconfig.json", "Created stack isolation: postcss.config.mjs");
  await emitExecution(execution, "file", "completed", "Created verified Astro project scaffold", {
    fileName: "package.json",
    filePath: "package.json",
    details: { reason: "The selected stack requires a real manifest and build scripts before model-driven implementation begins." },
  });
  return ["package.json", "tsconfig.json", "postcss.config.mjs"];
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
  if (platform === "android") return "Android preview needs a connected device or emulator, which Foundry does not have access to in this environment.";
  if (platform === "desktop") return `${stack} is a native desktop stack — Foundry can't render its UI without running it on your machine.`;
  if (platform === "mobile") return "Mobile app preview needs a device or simulator, which isn't available in this environment.";
  if (platform === "cli") return "The command-line project needs a safe dry-run command before Foundry can open an interactive terminal preview.";
  if (platform === "database") return "A database explorer needs a configured local database connection.";
  if (platform === "report") return "No browser-readable report entry file was detected.";
  if (platform === "game") return "This game stack does not expose a browser-playable entry point yet.";
  if (platform === "api") return `No runnable HTTP service entry was detected for ${stack}; Foundry did not present a fake API preview.`;
  return `Foundry does not yet run a live preview for ${stack}.`;
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
  previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "app", runtimeLog });
  persistWorkspacePreview(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "app", runtimeLog });
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
    previewProcesses.set(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
    persistWorkspacePreview(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
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

async function startPreview(projectId: string, projectPath: string, stack: string, events: string[], execution?: ExecutionContext): Promise<PreviewOutcome> {
  const platform = previewPlatformForStack(stack);
  const canonicalProjectPath = path.resolve(projectPath).toLowerCase();
  const directExisting = previewProcesses.get(projectId);
  if (directExisting && path.resolve(directExisting.projectPath).toLowerCase() !== canonicalProjectPath) stopPreview(projectId);
  const sameProjectPreviews = Array.from(previewProcesses.entries())
    .filter(([, preview]) => path.resolve(preview.projectPath).toLowerCase() === canonicalProjectPath)
    .sort((left, right) => right[1].lastUsedAt - left[1].lastUsedAt);
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
      if (!reusablePreview && ownedProcessAlive && await previewResponds(preview.previewUrl, preview.ownershipToken)) {
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

  if (isNextStack(stack)) {
    return startNextPreview(projectId, projectPath, events, execution, platform);
  }

  // Any other Node-based project (an Express API, a Vite app, a hand-rolled server) can still get a
  // real live preview — read its actual package.json scripts rather than guessing a framework-specific
  // command, and run whichever real script is there against a PORT env var, the one convention nearly
  // every Node HTTP server already respects.
  const nodeScript = await detectNodeStartScript(projectPath);
  if (nodeScript) {
    return startGenericNodePreview(projectId, projectPath, nodeScript, events, execution, platform);
  }

  const pythonEntry = await detectPythonPreviewEntry(projectPath);
  if (pythonEntry) {
    return startPythonPreview(projectId, projectPath, pythonEntry, events, execution);
  }

  if (/\b(html|css|static)\b/i.test(stack)) {
    const rootEntries = await readdir(projectPath).catch(() => [] as string[]);
    const entryFile = rootEntries.find((name) => name.toLowerCase() === "index.html") ?? rootEntries.find((name) => name.toLowerCase().endsWith(".html"));
    if (!entryFile) {
      const reason = "No HTML entry file was found in the project root, so there is nothing to preview yet.";
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
      const reason = `${artifact.name} is built and ready to ${platform === "report" ? "open or download" : "install or download"}.`;
      if (execution) await emitExecution(execution, "preview", "completed", "Platform artifact ready", { details: { artifact: artifact.name, platform: artifact.platform, sizeBytes: artifact.sizeBytes } });
      return { previewState: "ready", previewPlatform: platform, previewReason: reason, artifact };
    }
  }

  const reason = previewUnavailableReason(platform, stack);
  if (execution) await emitExecution(execution, "preview", "skipped", "Preview unavailable", { details: { reason, stack } });
  return { previewState: "unavailable", previewPlatform: platform, previewReason: reason };
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

async function startStaticPreview(projectId: string, projectPath: string, entryFile: string, events: string[], execution?: ExecutionContext): Promise<PreviewOutcome> {
  const scriptPath = path.join(process.cwd(), "scripts", "foundry-static-preview.cjs");
  const attemptedPorts = new Set<number>();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findPreviewPort(attemptedPorts);
    attemptedPorts.add(port);
    const ownershipToken = `${projectId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (execution) await emitExecution(execution, "preview", "running", attempt === 1 ? "Starting interactive static preview" : "Retrying preview on a clean port", { details: { port, entryFile, attempt } });
    const child = spawn(process.execPath, [scriptPath, projectPath, String(port), ownershipToken], { cwd: projectPath, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    const previewUrl = `http://127.0.0.1:${port}/${encodeURIComponent(entryFile)}`;
    previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "static", ownershipToken });
    persistWorkspacePreview(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "static", ownershipToken });
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

async function startNextPreview(projectId: string, projectPath: string, events: string[], execution: ExecutionContext | undefined, platform: FactoryPreviewPlatform): Promise<PreviewOutcome> {
  const startScript = await detectNextPreviewScript(projectPath);
  if (!startScript) {
    const reason = "The Next.js project has no runnable package.json dev/start script, so Foundry did not open a preview.";
    if (execution) await emitExecution(execution, "preview", "error", "Preview unavailable", { details: { reason } });
    return { previewState: "error", previewPlatform: platform, previewReason: reason };
  }
  const environmentFailure = await runtimeEnvironmentPreflightFailure(projectPath);
  if (environmentFailure) {
    events.push(environmentFailure);
    if (execution) await emitExecution(execution, "preview", "error", "Preview environment is not configured", { details: { reason: environmentFailure, paidModelCalls: 0 } });
    return { previewState: "error", previewPlatform: platform, previewReason: environmentFailure };
  }
  const port = await findPreviewPort();
  const previewCommand = `npm.cmd run ${startScript} -- -p ${port}`;
  if (execution) await emitExecution(execution, "preview", "running", startScript === "start" ? "Starting verified production preview" : "Starting development server", {
    command: previewCommand,
    details: { port, script: startScript, paidModelCalls: 0 },
  });
  const previewArgs = ["run", startScript, "--", "-p", String(port)];
  const previewExecutable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const previewArguments = process.platform === "win32"
    ? windowsNpmPreviewArguments(previewArgs)
    : previewArgs;
  const child = spawn(previewExecutable, previewArguments, {
    cwd: projectPath,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let runtimeLog = "";
  const capture = (chunk: Buffer) => {
    runtimeLog = `${runtimeLog}${chunk.toString()}`.slice(-20_000);
    const record = previewProcesses.get(projectId);
    if (record) record.runtimeLog = runtimeLog;
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.unref();
  const previewUrl = `http://127.0.0.1:${port}`;
  previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "app", runtimeLog });
  persistWorkspacePreview(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl, projectPath, kind: "app", runtimeLog });
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
    previewProcesses.set(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
    persistWorkspacePreview(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
    events.push(`Preview ready: ${readyUrl}`);
    if (execution) await emitExecution(execution, "preview", "completed", "Preview ready", { details: { previewUrl: readyUrl, port: boundPort, ready: true } });
    return { previewUrl: readyUrl, previewState: "ready", previewPlatform: platform };
  }
  const reason = runtimeLog.trim()
    ? `Preview failed to start: ${trimOutput(runtimeLog)}`
    : await previewRuntimeFailureReason(port);
  stopPreview(projectId);
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

async function startGenericNodePreview(
  projectId: string,
  projectPath: string,
  script: string,
  events: string[],
  execution: ExecutionContext | undefined,
  platform: FactoryPreviewPlatform,
): Promise<PreviewOutcome> {
  const environmentFailure = await runtimeEnvironmentPreflightFailure(projectPath);
  if (environmentFailure) {
    events.push(environmentFailure);
    if (execution) await emitExecution(execution, "preview", "error", "Preview environment is not configured", { details: { reason: environmentFailure, paidModelCalls: 0 } });
    return { previewState: "error", previewPlatform: platform, previewReason: environmentFailure };
  }
  const port = await findPreviewPort();
  const frameworkArgs = await nodePreviewPortArgs(projectPath, port);
  const commandArgs = ["run", script, ...frameworkArgs];
  if (execution) await emitExecution(execution, "preview", "running", "Starting development server", { command: `npm.cmd ${commandArgs.join(" ")}`, details: { port, script } });
  const npmExecutable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const npmArguments = process.platform === "win32"
    ? windowsNpmPreviewArguments(commandArgs)
    : commandArgs;
  const child = spawn(npmExecutable, npmArguments, {
    cwd: projectPath,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PORT: String(port) },
  });
  let runtimeLog = "";
  const capture = (chunk: Buffer) => {
    runtimeLog = `${runtimeLog}${chunk.toString()}`.slice(-20_000);
    const record = previewProcesses.get(projectId);
    if (record) record.runtimeLog = runtimeLog;
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.unref();
  const requestedUrl = `http://127.0.0.1:${port}`;
  previewProcesses.set(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl: requestedUrl, projectPath, kind: "app", runtimeLog });
  persistWorkspacePreview(projectId, { port, processId: child.pid, lastUsedAt: Date.now(), previewUrl: requestedUrl, projectPath, kind: "app", runtimeLog });
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
    previewProcesses.set(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
    persistWorkspacePreview(projectId, { port: boundPort, processId: child.pid, lastUsedAt: Date.now(), previewUrl: readyUrl, projectPath, kind: "app", runtimeLog });
    events.push(`Preview ready: ${readyUrl}`);
    if (execution) await emitExecution(execution, "preview", "completed", "Preview ready", { details: { previewUrl: readyUrl, port: boundPort, ready: true, script } });
    return { previewUrl: readyUrl, previewState: "ready", previewPlatform: platform };
  }
  const reason = runtimeLog.trim()
    ? `Preview failed to start: ${trimOutput(runtimeLog)}`
    : await previewRuntimeFailureReason(port);
  stopPreview(projectId);
  events.push(reason);
  if (execution) await emitExecution(execution, "preview", "error", "Preview failed its live readiness check", { details: { port, ready: false, script, reason } });
  return { previewState: "error", previewPlatform: platform, previewReason: reason };
}

/** Detect hard runtime contracts before launching a server. This is deliberately deterministic:
 * missing credentials/configuration are environment work, not an implementation-model problem,
 * and starting a process just to rediscover them wastes time while obscuring the real blocker. */
async function runtimeEnvironmentPreflightFailure(projectPath: string) {
  const required = new Set<string>();
  const prismaSchema = await readFile(path.join(projectPath, "prisma", "schema.prisma"), "utf8").catch(() => "");
  for (const match of prismaSchema.matchAll(/\benv\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)/g)) required.add(match[1]);
  if (!required.size) return undefined;

  const configured = new Set(
    Object.entries(process.env)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key]) => key),
  );
  for (const fileName of [".env.local", ".env.development.local", ".env.development", ".env"]) {
    const contents = await readFile(path.join(projectPath, fileName), "utf8").catch(() => "");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^(["'])(.*)\1$/, "$2").trim();
      if (value) configured.add(match[1]);
    }
  }

  const missing = Array.from(required).filter((key) => !configured.has(key));
  if (!missing.length) return undefined;
  const noun = missing.length === 1 ? "variable" : "variables";
  return `Preview cannot start because required environment ${noun} ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not configured. Add ${missing.length === 1 ? "it" : "them"} to the project's .env.local or the Foundry process environment, then retry preview.`;
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
  // Grace sweep: the server may have bound a beat after the window closed.
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

async function detectNextPreviewScript(projectPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const verifiedBuildExists = existsSync(path.join(projectPath, ".next", "BUILD_ID"))
      || existsSync(path.join(projectPath, ".next-build", "BUILD_ID"));
    if (verifiedBuildExists && typeof scripts.start === "string") return "start";
    return ["dev", "start"].find((name) => typeof scripts[name] === "string");
  } catch {
    return undefined;
  }
}

async function startConnectorPreview(connector: LocalConnectorConfig, platform: FactoryPreviewPlatform = "web"): Promise<PreviewOutcome> {
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
    const response = await fetch(`${baseUrl}/preview/start`, { method: "POST", headers, body: JSON.stringify({ root: connector.rootLabel || "", path: "" }) });
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
  const canonicalProjectPath = path.resolve(projectPath).toLowerCase();
  for (const [projectId, preview] of previewProcesses.entries()) {
    if (path.resolve(preview.projectPath).toLowerCase() === canonicalProjectPath) stopPreview(projectId);
  }
}

function stopPreviewProcessTree(processId: number) {
  if (process.platform === "win32") {
    // Static/framework previews are detached so they survive the request that launched them. On
    // Windows, process.kill() does not reliably terminate a detached child tree and can leave its
    // working directory locked. taskkill receives a numeric pid directly (no shell interpolation).
    const stopped = spawnSync("taskkill.exe", ["/pid", String(processId), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    if (stopped.status === 0) return;
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
  const connector = connectorPreviews.get(projectId);
  if (connector) return connectorPreviewStatus(connector);
  const preview = previewProcesses.get(projectId);
  if (!preview) return { previewState: "unavailable" };
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
        return startProjectPreview({ kind: "workspace", projectId, projectPath: managedProjectPath }, detected.profile.label);
      }
    } catch {
      // An external connector root is expected not to resolve inside Foundry's managed projects.
    }
    connectorPreviews.set(projectId, localConnector);
    const access = createLocalConnectorProjectAccess(localConnector);
    const detected = await detectStackProfileAndEntriesForAccess(access);
    return startProjectPreview(connectorPreviewTarget(projectId, localConnector), detected.profile.label);
  }
  const connector = connectorPreviews.get(projectId);
  if (connector) {
    const access = createLocalConnectorProjectAccess(connector);
    const detected = await detectStackProfileAndEntriesForAccess(access);
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
  return startProjectPreview({ kind: "workspace", projectId, projectPath }, stack);
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
    void stopConnectorPreview(connector);
    return;
  }
  stopPreview(projectId);
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
  const id = event.id
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
