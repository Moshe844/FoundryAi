import type { RuntimeUsageRecord } from "@/lib/ai/foundry-runtime";
import { callManagedModel } from "@/lib/ai/providers/dispatch";
import { resolveModelForTier, type ModelTier } from "@/lib/ai/model-router";
import { commandPermissionIdentity, isLongRunningServerCommand, isSensitiveFilePath, normalizeCommandForExecution, normalizeCommandText, type ProjectAccess } from "@/lib/ai/mission/project-access";
import { approvalScopeLabel, type CommandApprovalScope } from "@/lib/ai/mission/command-permissions";
import { isEmptySourceWrite } from "@/lib/ai/mission/write-verification";
import type { ManagedToolCall, NeutralContentPart, NeutralMessage, NeutralTool, ProviderId } from "@/lib/ai/providers/types";
import type { ExecutionMissionVerification, FactoryExecutionEvent, FactoryExecutionEventKind, FactoryExecutionEventStatus, FactoryNarrativeObject, FactoryObjectiveChecklistItem, FactorySessionSummary, MissionClarification, MissionParentContext } from "@/lib/factory/types";
import { matchingRunningEventId, upsertExecutionEvent } from "@/lib/factory/event-contract";
import { formatVerificationProfile } from "@/lib/verification/project-detector";
import { complianceVerdict, correctionInstruction, deriveOutcomeAssertions } from "@/lib/verification/outcome-compliance";
import type { VerificationProfile } from "@/lib/verification/types";
import type { ExecutionStrategy } from "@/lib/ai/mission/execution-strategy";
import { assessAutonomousBlocker } from "@/lib/ai/mission/autonomy-contract";
import { routingContext } from "@/lib/ai/routing/request-context";
import type { DynamicTaskAssessment, RoutingBudget } from "@/lib/ai/routing/types";
import type { FollowUpResolutionRecord } from "@/lib/mission/classifyFollowUp";
import { isUserFacingUiOutcome, requiresPresentationLayerChange } from "@/lib/ai/mission/requirement-contract";
import { redactSensitiveData, redactSensitiveText } from "@/lib/security/secret-redaction";
import { Script } from "node:vm";

export type MissionExecutorInput = {
  objective: string;
  task: string;
  checklist: FactoryObjectiveChecklistItem[];
  access: ProjectAccess;
  onEvent: (event: FactoryExecutionEvent) => void | Promise<void>;
  apiKey: string;
  workspaceId?: string;
  userId?: string;
  /** Shared billing identity for every executor batch, fallback, and repair in one user mission. */
  costScopeId?: string;
  maxTurns?: number;
  /** Optional stage-specific output ceiling. Used by evidence-driven repair callers that need a
   * targeted tool edit rather than the executor's larger general Builder generation allowance. */
  maxOutputTokens?: number;
  /** A caller may reserve a small, explicit phase allowance after deterministic evidence exists.
   * This expands only the shared mission ledger; maxTurns still bounds the phase itself. */
  routingBudget?: RoutingBudget;
  /** The caller owns a larger phased mission and will immediately continue a bounded batch. */
  continuableBatch?: boolean;
  /** A repair that re-reads a real multi-file generated project before fixing it — it legitimately
   * inspects across several calls, so it keeps the full pre-mutation allowance instead of the tight
   * edit cap that would otherwise strangle it before it can act. */
  multiFileRepair?: boolean;
  maxNudges?: number;
  signal?: AbortSignal;
  /** Commands the user has just explicitly approved for this run only (e.g. via an "Approve and retry" action). Matched by exact normalized text, not a standing grant. */
  preApprovedCommands?: string[];
  /** Command categories (see CommandPermissionCategory) the user has approved for the rest of this conversation, e.g. "dependencies". */
  approvedCategories?: string[];
  /** The subset of preApprovedCommands that are real standing grants (persisted "always allow this exact command"), as opposed to a fresh one-time approval for just this run. Used only to label approval_scope correctly — matching behavior is identical either way. */
  standingApprovedCommands?: string[];
  /** Exact action keys the user denied for this continuation. */
  deniedActions?: string[];
  evidenceImages?: Array<{ fileName: string; mediaType: string; dataUrl: string }>;
  /** Structured record of the mission this run continues, given only for continuation-style follow-ups so the model has real plan/decision state instead of needing to blindly re-investigate. */
  priorContext?: MissionParentContext;
  /** Accepted follow-up intent/reference/scope. The model may inspect within the project but must keep writes inside this recorded scope. */
  followUpResolution?: FollowUpResolutionRecord;
  /** Set when the task was heuristically detected as a small, single-file change — relaxes completion verification for a single-item checklist only. */
  fastLane?: boolean;
  /** Set when the task was heuristically detected as a rewrite/migration/architecture-scale change — keeps the old implementation in place until the user approves replacing it, and checkpoints after each phase. */
  highRisk?: boolean;
  /** Set for larger new-project builds with a live-previewable stack: the first checklist phase should be a
   * minimal but real, clickable first pass of the primary screens, and the mission pauses there for the user
   * to open the preview and react before Foundry goes deeper — instead of building the whole thing unseen. */
  offerMockGate?: boolean;
  /** Defaults to "openai" — the only provider missions ran on before this field existed. Passing "anthropic"/"google" routes this mission's autonomous loop through that provider's models instead. */
  provider?: ProviderId;
  /** Overrides the fastLane/highRisk-derived tier outright — set by a quality-aware caller via tierForStage("implement", quality, complexity) (see lib/ai/mission/orchestration.ts). Omit to get that same 3-way mapping as the default. */
  tier?: ModelTier;
  /** Whether this project actually has a build/test/dev step that can exit 0 (Next.js, Node, Python, .NET, etc. -> true; a pure static HTML/CSS/JS site -> false). Defaults to true. When false, completion does NOT require a build/dev/test command to have run — a no-build static site can never produce one (a dev server never exits 0), and demanding it falsely blocks a fully-built site. */
  hasBuildTooling?: boolean;
  /** Advisory concerns from the Architecture Review stage (lib/ai/mission/architecture-review.ts), folded into the system prompt as extra context. Never blocks — the executor treats these exactly like any other planning input. */
  architectureNotes?: string;
  /** Empty-project creation can generate coordinated files without repeatedly rediscovering an existing codebase. */
  newProject?: boolean;
  /** A dependency-free browser project whose runtime verification is owned by Foundry's deterministic
   * static preview after generation, rather than by an LLM-started command. */
  staticProject?: boolean;
  /** Browser-evidenced static repair: replace the complete self-contained page in one forced write. */
  staticRewrite?: boolean;
  /** A deterministic browser gate already proved the failure. Permit one relevant read and then force
   * a source mutation; Foundry owns the rebuild and repeat browser validation outside the model loop. */
  evidenceFirstRepair?: boolean;
  /** Existing source paths selected deterministically for evidence-first reads, in required order. */
  evidenceRepairReadPaths?: string[];
  /** Mission-first workflow chosen before model/provider assignment. */
  executionStrategy?: ExecutionStrategy;
  /** Stack-specific checks detected from real project files by the registered ecosystem adapter. */
  verificationProfile?: VerificationProfile;
  routingAssessment?: DynamicTaskAssessment;
  /** Operation-only mission: commands and reads are allowed, but source mutation tools are omitted. */
  commandOnly?: boolean;
  /** Current source gathered deterministically for a bounded coordinated edit. */
  initialProjectEvidence?: string;
  /** The supplied source evidence is sufficient for an immediate first mutation. */
  requireFirstMutation?: boolean;
  /** Files already changed by an immediately preceding bounded batch. */
  avoidFirstMutationPaths?: string[];
};

export type MissionExecutorResult = {
  status: "passed" | "failed" | "stopped" | "awaiting-approval" | "awaiting-mock-approval" | "needs-clarification";
  blocker?: string;
  /** Resumable decision requested when autonomous work is preserved instead of being mislabeled as failed. */
  clarificationQuestions?: MissionClarification[];
  /** Only set when status is "awaiting-approval" — the exact action blocked, for a precise approval prompt instead of parsing `blocker`'s free text. */
  blockedStep?: { kind: "write" | "delete" | "command"; target: string; category: string };
  checklist: FactoryObjectiveChecklistItem[];
  timeline: FactoryExecutionEvent[];
  changedFiles: string[];
  commands: Array<{ command: string; exitCode: number | null; stdout: string; stderr: string; durationMs?: number; approvalScope?: CommandApprovalScope }>;
  sessionSummary?: FactorySessionSummary;
  verification: ExecutionMissionVerification[];
  turnsUsed: number;
  usage: RuntimeUsageRecord[];
  /** A verified proposed edit matched the current file byte-for-byte. */
  alreadySatisfied?: boolean;
};

const IMPLEMENTATION_SCAN_EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", ".next-build", ".svelte-kit", ".turbo", ".cache", ".foundry-artifacts", ".foundry-data", "dist", "build", "out", "coverage", "target", "bin", "obj"]);
const EXECUTABLE_SOURCE_PATH = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?|css|scss|sass|less|py|rb|php|java|kt|kts|swift|go|rs|cs|fs|fsx|vb|dart|scala|lua|r|sql|graphql|proto|xaml)$/i;

export function generatedProcessTheaterPath(files: Array<{ path?: unknown; content?: unknown }>): string | undefined {
  return files.find((file) => {
    const filePath = String(file.path ?? "").replace(/\\/g, "/");
    const content = String(file.content ?? "");
    if (!EXECUTABLE_SOURCE_PATH.test(filePath) || !content) return false;
    const internalClaims = [
      /\b(?:operation-only request|operational compliance artifact|mission resumed|mission decision)\b/i,
      /\b(?:provider decision|selected provider|excluded providers?|decision (?:applied|locked))\b/i,
      /\bsettings\s*(?:->|→)\s*credentials\s*&\s*integrations\b/i,
      /\b(?:local agent requested|verified\s*=\s*true)\b/i,
    ].filter((pattern) => pattern.test(content)).length;
    const theaterName = /(?:^|\/)(?:immediate)?(?:operation|decision)(?:record|runner|note|state|checkpoint|verifier)(?:test)?\.(?:kt|java|swift|[cm]?[jt]sx?|py|rb|cs|go)$/i.test(filePath);
    // These are Foundry execution assertions disguised as customer source. Real provider adapters
    // prove readiness by invoking an SDK/API and interpreting its response; they do not persist a
    // boolean claiming that an internal selection or mission step was verified.
    return internalClaims >= 2 || (theaterName && internalClaims >= 1);
  })?.path as string | undefined;
}

export function jvmTopLevelDeclarations(content: string) {
  const packageName = content.match(/^\s*package\s+([\w.]+)/m)?.[1] ?? "";
  const declarations = [...content.matchAll(/^\s*(?:(?:public|private|internal|protected|sealed|abstract|open|data|enum|annotation|value)\s+)*(?:class|interface|object)\s+([A-Za-z_]\w*)/gm)]
    .map((match) => packageName ? `${packageName}.${match[1]}` : match[1]);
  return [...new Set(declarations)];
}

export async function duplicateJvmDeclarationIssue(access: ProjectAccess, files: Array<{ path?: unknown; content?: unknown }>) {
  const proposed = files.flatMap((file) => {
    const filePath = String(file.path ?? "").replace(/\\/g, "/");
    if (!/\.(?:kt|java)$/i.test(filePath)) return [];
    return jvmTopLevelDeclarations(String(file.content ?? "")).map((name) => ({ name, filePath }));
  });
  const proposedOwner = new Map<string, string>();
  for (const declaration of proposed) {
    const existingOwner = proposedOwner.get(declaration.name);
    if (existingOwner && existingOwner.toLowerCase() !== declaration.filePath.toLowerCase()) {
      return `${declaration.name} is declared by both ${existingOwner} and ${declaration.filePath} in the same generated batch.`;
    }
    proposedOwner.set(declaration.name, declaration.filePath);
  }
  if (!access.searchFiles) return undefined;
  for (const declaration of proposed) {
    const simpleName = declaration.name.split(".").at(-1)!;
    const hits = await access.searchFiles(simpleName, { maxResults: 40 }).catch(() => []);
    for (const hit of hits) {
      const hitPath = hit.path.replace(/\\/g, "/");
      if (hitPath.toLowerCase() === declaration.filePath.toLowerCase() || !/\.(?:kt|java)$/i.test(hitPath)) continue;
      const existing = await access.readFile(hitPath, { limitBytes: 100_000 }).catch(() => null);
      if (existing?.exists && jvmTopLevelDeclarations(existing.content).includes(declaration.name)) {
        return `${declaration.name} already exists in ${hitPath}; writing ${declaration.filePath} would create a duplicate JVM declaration.`;
      }
    }
  }
  return undefined;
}

export async function hasRunnableProjectEntry(access: ProjectAccess): Promise<boolean> {
  const entryPatterns = [
    /^(?:src\/)?app\/page\.[cm]?[jt]sx?$/i,
    /^(?:src\/)?pages\/index\.[cm]?[jt]sx?$/i,
    /^(?:src\/)?(?:main|index|app)\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|rb|php|go|rs|cs|java|kt|swift|dart)$/i,
    /^index\.html?$/i,
    /(?:^|\/)(?:program\.cs|app\.xaml|mainwindow\.xaml|mainactivity\.(?:java|kt)|__main__\.py|main\.(?:rs|go|dart|swift|c|cc|cpp|cxx)|application\.java)$/i,
  ];
  async function visit(relativePath: string, depth: number): Promise<boolean> {
    if (depth > 10) return false;
    const entries = await access.listDir(relativePath).catch(() => []);
    for (const entry of entries) {
      const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (!IMPLEMENTATION_SCAN_EXCLUDED_DIRS.has(entry.name.toLowerCase()) && await visit(childPath, depth + 1)) return true;
      } else if (entryPatterns.some((pattern) => pattern.test(childPath))) {
        const entry = await access.readFile(childPath, { limitBytes: 4_000 }).catch(() => null);
        const content = entry?.content?.trim() ?? "";
        const obviousStub = content.length < 400 && /continuing implementation|coming soon|todo|placeholder|hello world/i.test(content);
        // A filename alone is not a runnable experience. Generated recovery previously accepted a
        // seven-line "Continuing implementation" page as complete and moved straight to build.
        const conventionalCompiledEntry = /(?:^|\/)(?:program\.cs|app\.xaml|mainwindow\.xaml|mainactivity\.(?:java|kt)|__main__\.py|main\.(?:rs|go|dart|swift|c|cc|cpp|cxx)|application\.java)$/i.test(childPath);
        if (content.length >= (conventionalCompiledEntry ? 120 : 400) && !obviousStub) return true;
      }
    }
    return false;
  }
  return visit("", 0);
}

function projectManifestFamily(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (/\.sln$/.test(normalized)) return "dotnet-solution";
  if (/\.(?:cs|fs|vb)proj$/.test(normalized)) return "dotnet-project";
  if (/(?:^|\/)package\.json$/.test(normalized)) return "node-package";
  if (/(?:^|\/)cargo\.toml$/.test(normalized)) return "rust-package";
  if (/(?:^|\/)go\.mod$/.test(normalized)) return "go-module";
  if (/(?:^|\/)pom\.xml$/.test(normalized)) return "maven-project";
  if (/(?:^|\/)build\.gradle(?:\.kts)?$/.test(normalized)) return "gradle-project";
  if (/(?:^|\/)pyproject\.toml$/.test(normalized)) return "python-project";
  if (/(?:^|\/)pubspec\.yaml$/.test(normalized)) return "dart-package";
  return undefined;
}

async function existingProjectManifestPaths(access: ProjectAccess) {
  const found: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
  const ignored = /^(?:node_modules|\.git|\.next|dist|build|out|bin|obj|target)$/i;
  while (queue.length && found.length < 80) {
    const current = queue.shift()!;
    const entries = await access.listDir(current.path).catch(() => []);
    for (const entry of entries) {
      const child = current.path ? `${current.path}/${entry.name}` : entry.name;
      if (entry.kind === "file" && projectManifestFamily(child)) found.push(child.replace(/\\/g, "/"));
      if (entry.kind === "directory" && current.depth < 3 && !ignored.test(entry.name)) queue.push({ path: child, depth: current.depth + 1 });
    }
  }
  return found;
}

function explicitRequiredProjectPaths(task: string): string[] {
  const line = task.match(/(?:^|\n)Required files:\s*([^\r\n]+)/i)?.[1];
  if (!line) return [];
  return Array.from(new Set(line.split(",")
    .map((item) => item.trim().replace(/^[`'\"]+|[`'\".]+$/g, "").replace(/\\/g, "/"))
    .filter((item) => item.length > 1 && item.length <= 180 && !item.includes("*") && /(?:^|\/)\.?[\w@+.-]+(?:\/[\w@+.-]+)*$/i.test(item))));
}

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_NUDGES = 6;

function toolSchemas(canRunCommands: boolean, canBrowserValidate = false): NeutralTool[] {
  const tools: NeutralTool[] = [
    {
      name: "list_dir",
      description: "List immediate files and subdirectories under a path relative to the project root. Use \"\" for the root. Does not recurse.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      name: "read_file",
      description: "Read a text file's contents relative to the project root. Large files are truncated; pass offset_bytes/limit_bytes to page through them. Use offset_bytes 0 and limit_bytes 20000 for a normal first read.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          offset_bytes: { type: "integer" },
          limit_bytes: { type: "integer" },
        },
        required: ["path", "offset_bytes", "limit_bytes"],
      },
    },
    {
      name: "write_file",
      description: "Create or overwrite a text file relative to the project root with the complete new file contents (never a diff/patch). path must be a real relative file path such as \"server.js\" or \"src/index.js\" — never empty, \".\", or \"/\". The write is read back from disk and verified before being reported successful.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    {
      name: "write_files",
      description: "Create or overwrite a coordinated set of complete text files in one verified operation. Use this for new-project scaffolds and multi-file features instead of spending one model turn per file. Every file is independently written and read back from disk; the operation fails if any entry is invalid.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          files: {
            type: "array",
            minItems: 3,
            maxItems: 24,
            items: {
              type: "object",
              additionalProperties: false,
              properties: { path: { type: "string" }, content: { type: "string" } },
              required: ["path", "content"],
            },
          },
        },
        required: ["files"],
      },
    },
    {
      name: "replace_in_file",
      description: "Make one small, exact edit in an existing text file without rewriting the whole file. old_text must occur exactly once or the edit is rejected. The result is written, read back, diffed, and verified on disk.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
        required: ["path", "old_text", "new_text"],
      },
    },
    {
      name: "delete_file",
      description: "Delete a file relative to the project root. Always requires the user's approval before it actually happens — call it when deletion is the right fix, don't avoid it just because it needs approval.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      name: "search_files",
      description: "Search file names and contents under the project root for a query string.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "mark_checklist_item",
      description: "Update the status of one objective checklist item as you make verifiable progress. Use 'skipped' only when the user explicitly told you to skip it — never to avoid difficult work.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["running", "completed", "blocked", "skipped"] },
          evidence: { type: "string" },
        },
        required: ["id", "status", "evidence"],
      },
    },
    {
      name: "record_finding",
      description: "Record a project-understanding finding. This creates a narrative-layer event from a structured finding object, not a rewritten trace log.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          rationale: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          file_path: { type: "string" },
        },
        required: ["id", "rationale", "evidence", "file_path"],
      },
    },
    {
      name: "record_decision",
      description: "Record a chosen engineering action from the Confidence Map decision object. The rationale must be the decision rationale.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          rationale: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          chosen_action: { type: "string" },
          confidence: { type: "integer" },
        },
        required: ["id", "rationale", "evidence", "chosen_action", "confidence"],
      },
    },
    {
      name: "record_flag",
      description: "Record uncertainty, conflict, or a preserved behavior worth user attention. This creates a flag-layer event from a structured flag object.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          rationale: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          flag_type: { type: "string" },
        },
        required: ["id", "rationale", "evidence", "flag_type"],
      },
    },
    {
      name: "report_complete",
      description: "Call this only once every checklist item is completed with real evidence from files you actually read or commands you actually ran. The summary must explain the user's request, user-facing behavior now, files changed and why, verification evidence, and limitations. Ends the mission.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
    {
      name: "report_blocked",
      description: "Call this only for a concrete external dependency, missing user authority/credential, incompatible required host, or explicit user stop. Compiler, build, test, preview, command, and no-progress failures are engineering work: inspect their evidence, repair them, and continue instead of reporting blocked.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          reason: { type: "string" },
          blocked_item_ids: { type: "array", items: { type: "string" } },
        },
        required: ["reason", "blocked_item_ids"],
      },
    },
  ];

  if (canRunCommands) {
    tools.push({
      name: "run_command",
      description: "Run a shell command inside the project (or a subdirectory of it). No interactive stdin is provided, so avoid commands that prompt for input.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { command: { type: "string" }, cwd: { type: "string" } },
        required: ["command", "cwd"],
      },
    });
  }

  if (canBrowserValidate) {
    tools.push({
      name: "validate_browser",
      description: "Validate a running loopback web application in a real Playwright browser. Perform the affected user flow, capture console/page/network failures, and save a screenshot as evidence.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          viewport_width: { type: "integer" },
          viewport_height: { type: "integer" },
          screenshot_name: { type: "string" },
          baseline_screenshot: { type: "string" },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                action: { type: "string", enum: ["click", "fill", "type", "press", "check", "select", "wait", "assert-text", "assert-count"] },
                selector: { type: "string" }, value: { type: "string" }, text: { type: "string" }, key: { type: "string" }, ms: { type: "integer" }, exact: { type: "boolean" }, expected: { type: "integer" },
              },
              required: ["action"],
            },
          },
        },
        required: ["url", "actions", "viewport_width", "viewport_height", "screenshot_name", "baseline_screenshot"],
      },
    });
    tools.push({
      name: "validate_mobile",
      description: "Use the Local Agent's real Android adb or iOS Simulator runner. It truthfully reports unavailable SDK/device/host combinations.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          platform: { type: "string", enum: ["android", "ios"] },
          action: { type: "string", enum: ["devices", "install", "launch", "tap", "text", "keyevent", "logcat", "screenshot"] },
          component: { type: "string" }, bundle_id: { type: "string" }, device: { type: "string" }, lines: { type: "integer" }, screenshot_name: { type: "string" }, apk_path: { type: "string" }, x: { type: "integer" }, y: { type: "integer" }, text: { type: "string" }, key: { type: "string" },
        },
        required: ["platform", "action", "component", "bundle_id", "device", "lines", "screenshot_name", "apk_path", "x", "y", "text", "key"],
      },
    });
    tools.push({
      name: "validate_desktop",
      description: "Launch a desktop executable inside the connected project, optionally click named or automation-id controls through the operating system accessibility API, and verify that the real process remains alive after the requested interactions.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          executable: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          observe_ms: { type: "integer" },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { action: { type: "string", enum: ["click"] }, name: { type: "string" }, automation_id: { type: "string" } },
              required: ["action", "name", "automation_id"],
            },
          },
        },
        required: ["executable", "args", "observe_ms", "actions"],
      },
    });
  }

  return tools;
}

export async function runMissionExecutor(input: MissionExecutorInput): Promise<MissionExecutorResult> {
  const maxTurns = Math.min(20, input.maxTurns ?? (input.fastLane ? 6 : input.executionStrategy?.workflow === "bounded-artifact" ? 12 : DEFAULT_MAX_TURNS));
  const maxNudges = input.maxNudges ?? (input.fastLane ? 1 : DEFAULT_MAX_NUDGES);
  const checklist = input.checklist.map((item) => ({ ...item }));
  const timeline: FactoryExecutionEvent[] = [];
  const usage: RuntimeUsageRecord[] = [];
  const changedFiles = new Set<string>();
  const generatedWriteCounts = new Map<string, number>();
  let hasSelfContainedStaticEntry = false;
  const commands: MissionExecutorResult["commands"] = [];
  const narrativeObjects: FactoryNarrativeObject[] = [];
  // Static projects without build tooling already have an owned preview and deterministic browser gate.
  // Hiding command execution prevents the model from launching a redundant `npx serve`/`http.server`
  // process, whether the project was just generated or connected earlier.
  const allowCommandTools = input.access.capabilities.canRunCommands && input.hasBuildTooling !== false;
  const candidateTools = toolSchemas(allowCommandTools, input.access.capabilities.canBrowserValidate);
  const referencedProposal = ((input.followUpResolution?.currentIntent === "edit" || input.followUpResolution?.currentIntent === "debug" || input.followUpResolution?.currentIntent === "continue")
      ? input.followUpResolution.plannedAction.trim()
      : "")
    || input.followUpResolution?.referencedPriorAction?.description?.trim()
    || (input.priorContext
      && input.followUpResolution?.referencedPriorAction?.executionId === input.priorContext.id
      ? input.priorContext.summary
      : "");
  const carriesPriorRequirements = !referencedProposal && Boolean(input.priorContext?.source_requirements.length) && (
    input.followUpResolution?.continuity === "carry_forward_plan"
    || input.followUpResolution?.referencedPriorAction?.executionId === input.priorContext?.id
  );
  const acceptedRequirements = [
    ...(carriesPriorRequirements ? input.priorContext?.source_requirements ?? [] : []),
    referencedProposal,
    input.task,
  ]
    .filter(Boolean)
    .join("\n");
  const semanticVisualNeed = input.routingAssessment?.visualOutcome
    || input.executionStrategy?.stages.some((stage) => stage.capability === "visual") ? 1 : undefined;
  const uiOutcomeRequested = isUserFacingUiOutcome(acceptedRequirements, semanticVisualNeed);
  const presentationChangeRequired = requiresPresentationLayerChange(acceptedRequirements, semanticVisualNeed);
  const explicitBrowserValidationRequested = Boolean(input.commandOnly)
    && (/\bvalidate_browser\b/i.test(input.task)
      || (/\b(?:validate|verify|test|exercise|check)\b/i.test(input.task)
        && /\b(?:browser|preview|live\s+(?:site|app)|navigation|user\s+flow|click(?:ing)?)\b/i.test(input.task)));
  // UI outcomes are verified as UI outcomes whenever the connection can do so. Static generation
  // and evidence-first static repair are validated by the runtime's deterministic preview gate.
  const browserValidationOwnedByRuntime = Boolean(input.staticProject && (input.newProject || input.staticRewrite));
  // Never let an implementation model invent a localhost port. Foundry owns normal preview startup
  // and browser acceptance after the source batch. The model-level browser tool is exposed only for
  // an explicit operation-only request that already contains the exact loopback URL to exercise.
  const immediateBrowserValidationRequested = Boolean(input.access.capabilities.canBrowserValidate)
    && !browserValidationOwnedByRuntime
    && explicitBrowserValidationRequested
    && /\bvalidate_browser\b/i.test(input.task)
    && /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/i.test(input.task);
  const browserValidationRequested = immediateBrowserValidationRequested;
  const availableTools = immediateBrowserValidationRequested
    ? candidateTools
    : candidateTools.filter((tool) => tool.name !== "validate_browser");
  const requiredBrowserValidationPasses = browserValidationRequested
    && (presentationChangeRequired || /\b(?:then\s+repeat|repeat\s+at|both\s+(?:viewports?|sizes?))\b/i.test(input.task)) ? 2 : 1;
  let successfulBrowserValidationPasses = 0;
  const requiredEvidenceRepairReadPaths = Array.from(new Set(
    (input.evidenceRepairReadPaths ?? [])
      .map((candidate) => candidate.replace(/\\/g, "/").trim())
      .filter(Boolean),
  ));
  const readOnlyFollowUp = !input.newProject && !input.requireFirstMutation && Boolean(
    input.followUpResolution
    && ["question", "inspection", "diagnose", "status", "retrospective"].includes(input.followUpResolution.currentIntent),
  );
  // A new static project has one meaningful model action: write its complete first artifact. Keeping
  // the full inspection/deletion/reporting catalogue in this forced-tool request adds schema noise
  // and gives small coding models more ways to return prose instead of the required write. Foundry
  // owns browser verification and completion immediately after the coherent source lands.
  const tools = readOnlyFollowUp
    ? availableTools.filter((tool) => ["list_dir", "read_file", "search_files", "mark_checklist_item", "record_finding", "record_decision", "record_flag", "report_complete", "report_blocked"].includes(tool.name))
    : immediateBrowserValidationRequested
    ? availableTools.filter((tool) => ["validate_browser", "mark_checklist_item", "record_finding", "record_decision", "record_flag", "report_complete", "report_blocked"].includes(tool.name))
    : input.evidenceFirstRepair
    ? availableTools
        .filter((tool) => ["read_file", "replace_in_file", "write_file", "write_files", "mark_checklist_item", "record_finding", "record_decision", "record_flag", "report_complete", "report_blocked"].includes(tool.name))
        .map((tool) => tool.name === "replace_in_file" ? {
          ...tool,
          description: "Make one small exact compiler- or browser-evidenced edit. Copy only the shortest uniquely matching source fragment around the reported failure; never send the complete file in old_text or new_text.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: requiredEvidenceRepairReadPaths.length ? { type: "string", enum: requiredEvidenceRepairReadPaths } : { type: "string" },
              old_text: { type: "string", minLength: 1, maxLength: 3_000 },
              new_text: { type: "string", maxLength: 3_000 },
            },
            required: ["path", "old_text", "new_text"],
          },
        } : tool)
    : input.staticProject && input.fastLane && !input.newProject
    ? availableTools
        .filter((tool) => ["read_file", "replace_in_file", "write_file", "mark_checklist_item", "record_finding", "record_decision", "record_flag", "report_complete", "report_blocked"].includes(tool.name))
        .map((tool) => tool.name === "read_file" ? {
          ...tool,
          description: "Read the complete existing index.html exactly once before applying this bounded static follow-up.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "string", const: "index.html" },
              offset_bytes: { type: "integer", const: 0 },
              limit_bytes: { type: "integer", const: 50_000 },
            },
            required: ["path", "offset_bytes", "limit_bytes"],
          },
        } : tool)
    : input.commandOnly && !input.newProject && !input.requireFirstMutation
    ? availableTools.filter((tool) => !["write_file", "write_files", "replace_in_file", "delete_file"].includes(tool.name))
    : input.staticProject && (input.newProject || input.staticRewrite)
    ? availableTools.filter((tool) => tool.name === "write_file").map((tool) => ({
        ...tool,
        description: "Create index.html as the complete finished static application in one write. Keep the document compact and at most 30,000 characters so the verified tool call cannot be truncated. The content must be at least 2,500 characters and include the full semantic HTML, embedded responsive CSS, embedded interactive JavaScript, realistic content/data, accessible labelled controls, and closing </script>, </body>, and </html> tags. Skeletons, initialization placeholders, deferred follow-up edits, separate CSS/JS files, and explanations are invalid.",
        parameters: {
          ...tool.parameters,
          properties: {
            path: { type: "string", const: "index.html" },
            content: { type: "string", minLength: 2_500, maxLength: 30_000 },
          },
        },
      }))
    : input.newProject
      ? availableTools.filter((tool) => tool.name !== "report_blocked").map((tool) => input.verificationProfile?.adapterId === "android-gradle" && tool.name === "write_files" ? {
          ...tool,
          description: `${tool.description} For this Android project, every path must be real Kotlin/Java source, Android resource XML, test source, or the existing Gradle configuration. Temp, ops, log, marker, note, and generic text files are invalid.`,
          parameters: {
            ...tool.parameters,
            properties: {
              files: {
                type: "array",
                minItems: 3,
                maxItems: 24,
                contains: {
                  type: "object",
                  properties: { path: { type: "string", pattern: "^app/src/(?:main|test|androidTest)/(?:java|kotlin)/.+\\.(?:kt|java)$" } },
                  required: ["path"],
                },
                minContains: 2,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    path: { type: "string", pattern: "^(?:settings\\.gradle(?:\\.kts)?|build\\.gradle(?:\\.kts)?|gradle\\.properties|app/build\\.gradle(?:\\.kts)?|app/src/(?:main|test|androidTest)/(?:java|kotlin|res)/.+\\.(?:kt|java|xml))$" },
                    content: { type: "string", minLength: 80 },
                  },
                  required: ["path", "content"],
                },
              },
            },
          },
        } : tool)
      : availableTools;
  const provider: ProviderId = input.provider ?? "openai";
  const needsGeneratedEntryRecovery = input.newProject
    ? !(await hasRunnableProjectEntry(input.access))
    : false;
  const establishedProjectManifests = input.newProject ? await existingProjectManifestPaths(input.access) : [];
  const explicitProjectExpansion = /\b(?:add|create)\s+(?:another|additional|second|new)\s+(?:project|module|service|library)\b|\bmulti[- ]project\b/i.test(acceptedRequirements);
  const generatedWriteFloor = input.newProject
    ? Math.min(8, Math.max(3, Math.ceil(input.routingAssessment?.estimatedFiles ?? 3)))
    : 0;
  // Cost Optimization mapping (Intelligent Mission Orchestration): fastLane -> fast, highRisk -> architect,
  // everything else -> builder. input.tier lets a quality-aware caller (lib/factory/runtime.ts, via
  // tierForStage("implement", quality, complexity)) override this outright; callers that don't pass one
  // (or don't pass quality) get this same 3-way default, which is what "standard" quality resolves to
  // anyway. Applied uniformly across all providers, including OpenAI — dropping the old OpenAI-only
  // modelForProfile bypass, since this is now an intentional routing decision, not just a migration.
  const effectiveTier: ModelTier = input.tier ?? (input.fastLane ? "fast" : input.highRisk ? "architect" : "builder");
  const { model, effort } = resolveModelForTier(effectiveTier, { provider });

  async function emit(kind: FactoryExecutionEventKind, status: FactoryExecutionEventStatus, title: string, extra: Partial<FactoryExecutionEvent> = {}) {
    // Suppress a near-duplicate user-facing narrative line before it ever reaches the canvas — this is
    // what stops a generic lifecycle template from being emitted identically every batch. Findings and
    // decisions carry distinct rationale, so this only ever collapses true repeats. Never applied to the
    // live "running" placeholder (it updates in place) or to internal/orchestration events.
    if (kind === "reasoning" && status === "completed" && !extra.internal && !extra.tier && title.trim().length >= 12) {
      const normalized = normalizeForSimilarity(title.trim());
      if (recentReasoningNormalized.some((prior) => textSimilarity(normalized, prior) > 0.72)) return;
      recentReasoningNormalized.push(normalized);
      if (recentReasoningNormalized.length > 8) recentReasoningNormalized.shift();
    }
    const id = extra.id
      ?? (status !== "running" ? matchingRunningEventId(timeline, { kind, command: extra.command, filePath: extra.filePath }) : undefined)
      ?? `mission-event-${timeline.length}-${Math.random().toString(16).slice(2)}`;
    const event: FactoryExecutionEvent = {
      id,
      timestamp: new Date().toISOString(),
      tier: extra.tier ?? "trace",
      kind,
      status,
      title,
      transient: extra.transient ?? status === "running",
      ...extra,
    };
    upsertExecutionEvent(timeline, event);
    await input.onEvent(event);
  }

  async function emitChecklistSnapshot() {
    await emit("planning", "completed", "Checklist updated", {
      internal: true,
      details: { checklistJson: JSON.stringify(checklist) },
    });
  }

  function finalize(
    status: "passed" | "failed" | "stopped" | "awaiting-approval" | "awaiting-mock-approval",
    blocker: string | undefined,
    turnsUsed: number,
    blockedStep?: MissionExecutorResult["blockedStep"]
  ): MissionExecutorResult {
    return {
      status,
      blocker,
      blockedStep,
      checklist,
      timeline,
      changedFiles: Array.from(changedFiles),
      commands,
      sessionSummary: buildSessionSummary(timeline, changedFiles, status, blocker),
      verification: buildVerificationEntries(checklist, changedFiles, commands, timeline),
      turnsUsed,
      usage,
      alreadySatisfied,
    };
  }

  async function stoppedByUser(turn: number): Promise<MissionExecutorResult> {
    await emit("summary", "warning", "Stopped by user", { details: { reason: "The user stopped this mission before it finished." } });
    return finalize("stopped", "Stopped by user before completion.", turn);
  }

  const system: string = [
    input.followUpResolution
      ? `Accepted follow-up resolution (authoritative): intent=${input.followUpResolution.currentIntent}; referenced execution=${input.followUpResolution.referencedPriorAction?.executionId ?? "none"}; relevant files=${input.followUpResolution.relevantFiles.join(", ") || "not pre-bounded"}; destructive=${input.followUpResolution.destructive}; confidence=${input.followUpResolution.referenceConfidence}; expected scope=${input.followUpResolution.expectedScope}; planned action=${input.followUpResolution.plannedAction}. Do not reinterpret the user as asking for a different action. For a bounded file list, do not write or delete any other file; if a dependency makes that necessary, report the dependency and stop for a new resolution instead of widening scope yourself.`
      : "",
    readOnlyFollowUp
      ? "This follow-up is authoritatively read-only. Mutation and command tools are unavailable. Inspect only relevant evidence, answer the request, and do not create notes, scratchpads, summaries, markers, or any other project file."
      : "",
    input.deniedActions?.length
      ? `The user explicitly denied these actions: ${input.deniedActions.join(", ")}. Do not request or attempt them again. Mark dependent work skipped and continue independent work.`
      : "",
    "You are a senior engineer working inside a real, already-connected project. You investigate and fix real problems by calling tools — you are not running a scripted plan.",
            input.commandOnly ? "This is an operation-only request. Source mutation tools are unavailable by design. Run and verify the requested operation without creating markers, notes, placeholders, or code changes." : "",
            immediateBrowserValidationRequested ? "The user explicitly requested real browser validation and supplied its URL, viewports, and assertions. Invoke validate_browser immediately with those exact details. Do not search the project for the tool name and do not substitute source inspection." : browserValidationRequested ? "The user requires real browser evidence. Start the project's real server, take the final Local URL it reports, and call validate_browser for the requested flow. A build or server-start command alone cannot complete this mission." : "",
            input.priorContext
              ? "You already have verified context from earlier in this same mission, given below — trust it and don't re-read files it already covers unless something looks inconsistent with the current request."
              : "You have no built-in knowledge of this project's current contents — read files before assuming anything about them.",
            input.initialProjectEvidence
              ? "Foundry already read the bounded working set immediately before this call and included its exact current contents below. Do not list the project, read package.json, or reread those files before editing. Apply the first real source mutation immediately from that verified evidence, then continue through every acceptance item."
              : "",
            "write_file always takes one complete new file, while write_files writes a coordinated verified set in one operation. For a new project or multi-file feature, prefer one write_files call over one model turn per file. For a localized change in an existing file, prefer replace_in_file with an exact old_text match so a small repair never requires a risky whole-file rewrite.",
            input.newProject && !input.staticProject
              ? "For an unfinished multi-file generated build, each write_files response must be a substantial executable product slice: normally 8–12 complete coordinated files and no more than roughly 100,000 characters total. Include the user-visible screen or workflow, its state/domain logic, persistence or real integration boundary, and meaningful automated tests in the SAME batch. Tiny utility-only batches, one-class-per-call work, markers, constants-only batches, and build-process artifacts are invalid. A passing compiler proves only that the current slice compiles; it is never evidence that the saved product brief is implemented. Do not edit Gradle files unless a concrete compiler diagnostic requires it. Prefer three substantial verified product slices over dozens of tiny batches."
              : "",
            input.newProject
              ? "Foundry's process is never part of the customer's product. Do not create operation, decision, checkpoint, readiness, compliance, or status classes/tests that merely record a selected provider, credentials screen, Local Agent action, mission state, or `verified = true`. Those are execution notes disguised as code. Implement named customer workflows from the saved brief. A provider integration must call APIs proven by supplied SDK/API evidence, interpret real responses and errors, and expose that behavior to the product."
              : "",
            "Never create an empty placeholder source file and plan to fill it in on a later turn. Write complete meaningful content on the first write_file call. Empty HTML, CSS, JavaScript, TypeScript, component, config, or data files are not implementation progress.",
            "The first working version must actually IMPLEMENT the requested features — not a shell that announces them. A screen whose entire content is a title plus text like \"coming soon\", \"preparing…\", \"under construction\", \"first workflow\", or \"feature will be added\" is NOT a working version; it is a placeholder that fails the request. If the user asked for a workout logger, a calorie tracker, and a meditation timer with a dashboard, the first build must contain a real workout logging UI with input and a list, a real calorie entry UI, a real timer, and a dashboard that reads from them — with local state wired up — not a landing screen describing them. Build the real screens and their interactions in the first pass; a scaffold that only renders a heading is an incomplete build, not a milestone.",
            "Conform to the project structure that already exists on disk — do not invent a parallel one. Before creating a file, check whether the project already has a file for that role and extend it in place. Never create a SECOND application entry point (a second `@main`, `main()`, root layout, `index` page, or App component) and never create a second file with the same name in a different folder. Two entry points break the build, and duplicate-named files leave the real implementation next to a dead copy. If earlier work placed files under one folder, keep using that folder.",
            // A production `next build`/`tsc` fails on this constantly: the model annotates an inline
            // callback passed to a generically-typed library prop (recharts formatter/labelFormatter,
            // table cell renderers, chart tooltips), the annotation disagrees with the library's own
            // generic, and every "fix" that re-annotates produces a new variant of the same error.
            "In TypeScript, never add explicit parameter type annotations to an inline callback you pass to a library prop or generic API (chart formatter/labelFormatter/tickFormatter, table cell renderers, event handlers, array callbacks). Let TypeScript infer the parameter contextually — write `formatter={(value) => ...}`, not `formatter={(value: number) => ...}`. Library generics often admit undefined or a union, so an explicit annotation makes the production build fail. If the body needs a specific type, coerce inside it (`Number(value).toFixed(2)`, `String(label)`) instead of annotating the parameter.",
            "Declare every package you import in package.json with a real version before you finish. An import of a library that is not in the manifest fails the production build even though the dev server may still render.",
            "Moving something is two edits, not one: remove it from its old place AND insert it in the new one. Before you finish a move, read the file back and confirm the moved content still exists exactly once. Deleting it and never reinserting it is the most common way this fails, and it passes typecheck, build, and preview because the code is still valid — the user just silently loses working UI.",
            "Never write a CSS rule for a class or attribute you have not seen in this project's markup. Read the component first and style the class names it actually uses. Inventing selectors such as `.page-shell` or `[data-total-spend]` produces rules that match nothing: every build still passes, the user's requested change silently does not happen, and dead code is left behind. If the change needs a hook that does not exist yet, add it to the markup in the same edit rather than styling a name you hope is there.",
            input.newProject && input.staticProject
              ? "This exported static project must still render useful content when index.html is opened directly from disk. Browsers may block fetch('data.json') under file://, so never make local JSON fetch the only initialization path. Embed seed data in a normal script file or provide a real bundled fallback, handle initialization errors visibly, and then use localStorage for local-first edits."
              : "",
            input.newProject && input.staticProject
              ? "Treat visual design as implementation, not decoration: establish an intentional type scale, page hierarchy, content-rich hero or introduction, polished responsive cards, purposeful spacing, accessible empty/error/loading states, and mobile behavior. A header plus empty whitespace or raw form controls is not a finished interface."
              : "",
            input.newProject && input.staticProject
              ? "Use semantic page structure with one visible, descriptive h1 for the primary page purpose or product name, labelled controls, keyboard-operable interactions, and landmarks that make the generated project usable with assistive technology and discoverable by search engines."
              : "",
            input.newProject && input.staticProject
              ? "Never rely on third-party image URLs without a designed local/CSS fallback. Every image card must remain intentional if the remote asset is unavailable; broken-image icons or large blank image regions are verification failures."
              : "",
            input.staticRewrite
              ? "This is one browser-evidenced repair of an already-generated static page. The task contains the original requirements and exact browser failure. Do not list or read files and do not explain. Call write_file once with a complete corrected self-contained index.html that preserves every requested feature and fixes the verified failure."
              : "",
            input.evidenceFirstRepair
              ? `Foundry already reproduced the exact compiler or browser failure and included it in the task. Do not start a server, run a build, or invoke browser validation inside this model loop. Read ${requiredEvidenceRepairReadPaths.length ? `these deterministically verified source paths in order before editing: ${requiredEvidenceRepairReadPaths.join(", ")}` : "the most directly relevant existing source file"}, then call replace_in_file with only the shortest unique fragment around the reported failure (at most 3,000 characters for old_text and new_text). Never copy or rewrite the complete file. Foundry will rebuild and repeat the same gate deterministically after the write.`
              : "",
            "Writing to an environment/secrets-shaped file (.env and variants, credentials/secrets files, key material) needs the user's approval, same as a shell command — expect it to pause the same way, and don't avoid the edit just because it needs approval if it's the right fix.",
            "delete_file removes a file and always needs the user's approval — never avoid deleting something that genuinely should go, and never delete anything as a substitute for asking when you are unsure whether it's still needed.",
            /\b(?:delete|remove|erase|wipe|clear)\b/i.test(input.task) && /\b(?:entire|whole|all)\b/i.test(input.task) && /\b(?:project|directory|folder|files?|contents?)\b/i.test(input.task)
              ? "The user asked to delete the whole project's contents. Use list_directory for inspection, then call delete_file for every listed project file. Do not run shell listing commands, do not stop after the first deletion, and do not report complete until list_directory shows no project entries remain. The project root itself stays as the connected workspace container."
              : "",
            input.fastLane
              ? "This is a small, focused task — either a quick edit or a single operational action like starting a server, running a build, or running tests. Keep it tight: do only what the request actually needs (the smallest correct edit, or the one command that satisfies an operational request), verify the real outcome directly (re-read the changed file, or confirm the server/build/test actually succeeded — e.g. an operational request to start a server is not done until you've confirmed it's actually reachable), and finish. Do not produce a multi-phase plan, architecture review, or full-project analysis for a task this size."
              : "",
            input.staticProject && input.fastLane && !input.newProject
              ? "This is a bounded follow-up to an existing static browser artifact. Read index.html once with a large enough limit to cover the complete file, then make the requested mutation on the very next turn. Do not list the project, search globally, or re-read the same file before editing. Foundry independently opens the finished preview and checks every explicit acceptance clause after the edit."
              : "",
            input.fastLane
              ? "For a request to start/run something that might already be running (a dev server, in particular): check first (e.g. a port check or a request to the expected local URL) before starting it again. If it's already up and reachable, say so and stop there — do not restart it, and do not treat confirming that as something that needs approval."
              : "",
            input.highRisk
              ? "This is a large-scope rewrite/migration/conversion/architecture mission. Build the new implementation alongside the existing one wherever the project structure allows it — do not overwrite or delete the old implementation's working files as a byproduct of building the new one. Only remove old files once the new path that replaces them is verified working, and do it via delete_file (which always pauses for approval) rather than silently overwriting them with write_file. The user should be able to see the old implementation still there until they explicitly approve removing it."
              : "",
            input.highRisk
              ? "Migrate feature-by-feature, not line-by-line. For each feature, first understand what it actually does for the user in the existing project, then re-implement that behavior the idiomatic way in the target stack — do not transliterate the old code statement-by-statement. Two implementations of the same feature in different stacks should rarely look structurally alike; they should behave alike."
              : "",
            input.highRisk
              ? "Work phase by phase in the order given. The moment every item in a phase is marked completed or skipped, record a decision or finding that plainly states what that phase actually changed and what still matches the old behavior — that's the user's checkpoint to see real progress before you start the next phase."
              : "",
            input.offerMockGate
              ? "This is a larger build, so treat the first checklist phase as building a minimal but real, clickable first pass of the primary screens — real navigation, real forms and layout, placeholder/mock data where deeper logic isn't built yet, professionally designed, not a wireframe. Do not build deep business logic, full data persistence, or later phases yet. The moment every item in that first phase is completed or skipped, the mission will pause automatically so the user can open a live preview and react before you continue — this is expected, not a failure or an interruption to work around. Do not call report_complete or try to keep working past the first phase; let it pause."
              : "",
            "For user-facing UI work, inspect the current UI structure and styling before editing. Improve the actual screen the user will see: aligned rows, clear labels, helpful helper text, sane empty states, accessible controls, and professional spacing. Do not ship raw/basic controls when the request is for product behavior.",
            "Treat every user-requirement item as an acceptance contract copied from the user's message. Complete and verify each clause independently; one token implementation must never stand in for a different clause. If the user asks for signup, sign-in to a dashboard, and a polished dashboard, all three must exist and work before completion.",
            "Quality words are requirements, not filler. A requested nice/polished/professional dashboard needs intentional navigation and hierarchy, useful summary content or data sections, multiple meaningful interactions, responsive layout, and real visual structure. A welcome heading, one sentence, and a sign-out button is a placeholder and must not be marked complete.",
            input.access.capabilities.canBrowserValidate
              ? `Foundry owns preview startup and real-browser acceptance after your source batch. Do not start a dev server, guess a localhost port, or claim visual verification inside this model loop. Implement the complete UI requirement and run the canonical build; Foundry will then exercise the owned preview${presentationChangeRequired ? " at desktop and mobile sizes" : " at the relevant viewport"} and route concrete browser evidence back into repair if needed.`
              : "Real browser interaction is unavailable in this connection mode. Never claim visual or workflow verification from source inspection or a preview URL alone; report that limitation explicitly.",
            "A styling or layout change is not verified by how it looks in your head — it's verified by the app still working. Before report_complete on any mission that touched .tsx/.jsx/.vue/.svelte/.html files: (1) actually run the app (build, dev server, or existing test suite — whichever this project has) and confirm it starts/builds without new errors, and (2) explicitly check that the interactive elements your change touched or sits near — buttons, forms, nav links, click handlers — still reference real, existing functions/state after your edit (read the handler wiring, don't assume a move/restyle left it intact). Record a finding or decision that states this plainly, e.g. \"Verified nav links still route correctly after moving the nav\" — not just \"updated styles.\" If you find something broken, fix it before completing; never report complete with a known-broken interaction.",
            "For requests that move hardcoded backend fields, payload fields, spreadsheet columns, or transaction fields into the frontend or configuration, build the whole product loop unless the existing project makes it impossible: create or update a durable config file, load existing fields from it, add/edit/remove fields in the UI, persist required/optional metadata, generate frontend forms from that config, and make backend upload/API mapping read the saved config dynamically.",
            "Do not treat 'created config file' as complete if the frontend still cannot edit it or the backend still uses hardcoded fields. Do not treat 'frontend form exists' as complete if Excel/upload/server processing is still hardcoded.",
            "Maintain two execution layers. Raw tool activity is trace. Narrative must come only from structured objects you explicitly record: record_finding for project understanding, record_decision for Confidence Map decisions, and record_flag for uncertainty/conflict/preserved behavior. Do not rely on generic reasoning text as narrative.",
            "Before report_complete on an edit/build/debug/deploy mission, record at least one finding and one decision. Record a flag whenever you preserve a path, leave uncertainty, encounter conflicting evidence, skip a verification, or see a behavior worth user attention.",
            "Work the way an experienced engineer actually works: form a hypothesis, test it with the smallest check that gives a real answer, learn from what you find, and adjust your next step. Don't work down a fixed list of steps decided in advance.",
            "For concrete bug/debug/error reports, inspect the existing code path before asking product or architecture questions. Do not ask whether to use design A or design B until you have read the files and found real conflicting implementations or requirements. Infer the intended behavior from the current code whenever there is one clear existing path.",
            "State your hypothesis once, in one or two plain sentences, like you're thinking out loud to a colleague. Then investigate quietly. Do not restate the same hypothesis again in different words (\"I think...\", \"My hunch is...\", \"I suspect...\") — if your understanding hasn't changed, say nothing and keep working. Speak again only when you've confirmed or ruled something out, when your understanding meaningfully changes, or right before you change a file or run a command.",
            "Never mention tool names, checklist ids, turn counts, or any other internal mechanics in what you say, and never describe your own process as a \"checklist\" or \"plan\" to the user — that bookkeeping is yours alone, for verifying you actually finished. Speak the way a person explains their thinking, not the way a program logs its steps. Keep each statement short — a sentence or two, not a paragraph.",
            "Call mark_checklist_item as soon as you have real evidence for an item, whether completed, blocked, or skipped, but never read the checklist back to the user or narrate updating it.",
            checklist.some((item) => item.phase)
              ? "Checklist items are grouped into phases (visible below as [phase] on each line). Work through phases in order — finish the items in the current phase before starting a later phase — unless a later item is trivially fast and clearly independent."
              : "",
            "Only call report_complete once every checklist item is completed or explicitly skipped with real evidence. If anything cannot be verified, call report_blocked instead and say exactly what is unresolved.",
            "The final report_complete summary must be product-specific: what the user asked for, what behavior changed, which files changed and why, how the user uses the new behavior, what was verified, and any limitations. Never summarize with generic next actions.",
            "If one checklist item gets stuck for a reason that has nothing to do with permission (e.g. a tool error, ambiguous request), don't stop everything — keep making real progress on every other item you still can, and only call report_blocked once you've done all the work that doesn't depend on the stuck item.",
            "If the user denies a command you needed, mark that checklist item skipped and, in the very next thing you say, state the exact command as something the user can run themselves (e.g. \"You can run `<command>` yourself when ready — I'll continue with everything else.\"). Never just say it was denied and move on silently. Then keep making progress on every other item.",
            input.access.capabilities.canRunCommands
              ? "You can run shell commands with run_command, confined to the project root. If run_command returns skipped: permission-required, the mission stops immediately and automatically the moment that happens — you do not get to try something else or keep working on other items first. Prefer the simplest command that gives real evidence — don't try several different verification strategies in a row, or repeatedly stop and restart the same server, if a simpler single check (or the file contents you already read) already answers the question — every permission prompt costs the user a real interruption."
              : "This connection cannot run shell commands. If a checklist item can only be verified by running a build/test, mark it blocked and explain why instead of guessing.",
            input.access.capabilities.canRunCommands
              ? "Do not run a bare dependency install such as npm ci, npm install, pnpm install, yarn install, or bun install as a reflex. First inspect package.json, lockfiles, and whether node_modules exists. IMPORTANT: check for a dependency or file using the list_dir, read_file, and search_files tools (they read the project directly and NEVER need approval) — do NOT shell out `dir`, `ls`, `Test-Path`, or piped probes via run_command for existence checks, because an unrecognized shell command triggers a needless approval prompt and stalls the mission. If dependencies already appear installed, run the smallest relevant existing script or direct local command instead. If the user's request is to start an existing server, prefer the existing start/dev script or direct server entry command before any install. Ask for install approval only when dependency evidence is actually missing or a new package is truly required. For a new dependency, request the install command BEFORE editing package.json, lockfiles, imports, or dependent code; an approval pause must leave the project exactly as it was before the dependency operation began."
              : "",
            input.access.capabilities.canRunCommands && !input.fastLane
              ? "Before report_complete on a mission that changed code, check whether this specific project already has its own build, test, or lint tooling configured for what you touched — e.g. package.json build/test/lint scripts, a dotnet test project, a gradlew wrapper, flutter test, cargo test, go test, or an equivalent already present in this project — and run whichever of those is relevant to what changed as your real verification. Treat that as the one canonical check for this item, not an extra strategy on top of file read-back. If it fails, diagnose the actual cause, fix it when the fix matches the existing design, and rerun it before reporting anything — never summarize a failing check as if it passed. If this project genuinely has no such tooling configured for what you changed, say so plainly in your summary instead of leaving it unaddressed."
              : "",
            input.newProject && input.staticProject
              ? "This is a new empty static project and the complete requirements are already in the task. Do not list the folder, do not read foundry-brief.md, and do not re-read a file after write_file has already confirmed it on disk. Start writing immediately. Create either one complete self-contained HTML file with real CSS and JavaScript, or a coordinated HTML/CSS/JavaScript source set. Prefer the self-contained form for a small single-page utility or catalogue; prefer separate files when that materially improves maintainability. Never spend a response describing code instead of writing it. Do not start a server; Foundry starts and browser-tests the result deterministically after generation."
              : input.newProject
              ? "This is an unfinished generated project whose authoritative brief is already included verbatim in the task. Do not inspect parent/root aliases, do not read or write foundry-brief.md, and do not rediscover whether the brief exists. Inspect the project root once, then continue its existing application-root convention: if src/app exists, write every Next.js route/layout/style under src/app; if app exists, stay under app. Never create parallel app and src/app trees. Start with real executable application source, domain data/state modules, reusable interactive components, and the required routes/screens. Hidden marker files, inspect/probe files, status/touchpoint/bootstrap/handoff files, temp files, notes, and documentation are forbidden and never count as progress. Create the coordinated implementation in one write_files call whenever it fits, then build and repair only concrete compiler/runtime errors."
              : "",
            input.executionStrategy
              ? `Mission workflow: ${input.executionStrategy.workflow}. ${input.executionStrategy.reason} Concurrency budget: ${input.executionStrategy.concurrency}. ${workflowInstruction(input.executionStrategy)}`
              : "",
            input.verificationProfile
              ? `Use this detected verification profile as the project-specific verification contract. Run applicable checks in the listed order after code or behavior edits. A project build/test is not applicable to a documentation-only or plain-text artifact change that cannot affect runtime behavior; verify that artifact by exact read-back instead and record any already-known project health issue separately. Do not invent absent checks. If an applicable required check fails, diagnose it, apply a focused repair, and resume from that failed stage.\n${formatVerificationProfile(input.verificationProfile)}`
              : "",
            input.highRisk && input.verificationProfile?.commands.length
              ? "Before the first high-risk edit, run the applicable verification profile once as a baseline. Record failures found before editing as pre-existing issues. After implementation, run the profile again and distinguish unchanged baseline failures from regressions introduced by this mission."
              : "",
            ...(!input.fastLane && input.access.capabilities.canRunCommands
              ? ["By default, run the app for the user, not just edit its files. Once you're reasonably confident in a fix and the project is a runnable app or server, start (or restart) it as your verification step and leave it running so the user can see the real result — don't stop at 'the file is correct.' Only skip this if the user explicitly said not to run it, or the checklist item genuinely doesn't need a running process to verify (e.g. a pure text/config change)."]
              : []),
            "Never create or write a file just to prove work happened. Every file you create or change must exist because it improves the actual project — evidence of your work belongs in what you say, not in the user's codebase.",
            input.architectureNotes ? `A pre-implementation architecture review flagged these concerns before you started — address them where relevant, but they are advisory, not a blocking checklist:\n${input.architectureNotes}` : "",
          ].join("\n");

  // Provider-agnostic turn history — each provider's request-builder renders this into its own wire
  // format at call time (see lib/ai/providers/*-runtime.ts), same pattern already proven in
  // lib/ai/mission/inspector.ts's smaller read-only loop.
  const conversation: NeutralMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `Objective: ${input.objective}`,
            `Task: ${input.task}`,
            `Project root: ${input.access.rootLabel}`,
            ...(input.priorContext ? ["", "Mission this continues:", formatParentContext(input.priorContext)] : []),
            ...(input.followUpResolution ? ["", "Accepted follow-up resolution:", JSON.stringify(input.followUpResolution)] : []),
            ...(input.initialProjectEvidence ? ["", "Verified current working-set source (authoritative):", input.initialProjectEvidence] : []),
            "",
            "Checklist:",
            ...checklist.map((item) => `- [${item.id}]${item.phase ? ` [${item.phase}]` : ""} ${item.label}`),
          ].join("\n"),
        },
        ...(input.evidenceImages ?? []).map((image) => ({ type: "image" as const, dataUrl: image.dataUrl, mediaType: image.mediaType, fileName: image.fileName })),
      ],
    },
  ];
  let toolCallSeq = 0;

  let consecutiveProviderFailures = 0;
  let nudgesUsed = 0;
  let completionRejections = 0;
  const maxCompletionRejections = 3;
  let lastFailedWriteSignature = "";
  let repeatedWriteFailures = 0;
  let generatedWriteCalls = 0;
  let hadUnresolvedToolFailure = false;
  let lastReasoningNormalized = "";
  // Every user-facing reasoning line, whatever its source, is checked against the recent ones so a
  // hard-coded lifecycle template ("The complete source set is ready…") can never repeat verbatim the way
  // it did across continuation batches. The model's own specific reasoning is what should dominate.
  const recentReasoningNormalized: string[] = [];
  let silentExplorationTurns = 0;
  // Runtime-supplied working-set evidence is a completed inspection. Do not pay the model to list or
  // reread files whose exact current contents are already present in its authoritative context.
  let inspectedExistingProject = Boolean(input.initialProjectEvidence);
  let consecutiveExplorationTurns = 0;
  const completedEvidenceRepairReads = new Set<string>();
  let modelCallsSinceDurableProgress = 0;
  let consecutiveRejectedGeneratedWrites = 0;
  let paidModelCallsThisBatch = 0;
  // A healthy implementation batch coordinates files and then hands verification to deterministic
  // tools. It must not consume the entire mission allowance by turning every tiny file into another
  // paid turn. Complex work can be resumed explicitly from verified state; silent 24-call spirals are
  // never an acceptable default.
  const maximumPaidModelCallsThisBatch = Math.max(3, Math.min(12, Number(process.env.FOUNDRY_MAX_MODEL_CALLS_PER_EXECUTION_BATCH) || 8));
  const successfulCommandSignatures = new Set<string>();
  const coordinatedEvidencePaths = Array.from(input.initialProjectEvidence?.matchAll(/^--- (.+?) ---$/gm) ?? [], (match) => match[1].replace(/\\/g, "/"));
  const coordinatedMutationCounts = new Map<string, number>();
  let lastCoordinatedMutationPath = "";
  const coordinatedDiversityNudges = new Set<string>();
  // Idle calls are not free, and they get *more* expensive as the transcript grows. Observed on a
  // one-line reposition: four consecutive pre-mutation calls returned 66-134 output tokens each while
  // input climbed 9.3k -> 12.1k, burning ~$0.20 before the escalation lane even started.
  //
  // Patience is worth paying for only after something durable exists. Before the first mutation the
  // model is stuck, not working — that is exactly the state the stronger action-enforced route was
  // built to rescue, so reaching it sooner is strictly better. After a mutation, keep the original
  // allowance: continuing is often genuinely productive there.
  const configuredNoProgressCalls = Math.max(1, Number(process.env.FOUNDRY_MAX_NO_PROGRESS_MODEL_CALLS) || 4);
  // The tight pre-mutation cap catches a stuck EDIT fast — an edit should be editing, not spelunking, so
  // reaching the action-enforced route sooner is strictly better. But a new-project BUILD (and its
  // browser-repair, which re-reads a real multi-file project before fixing it) legitimately inspects,
  // scaffolds, and plans across several calls before or between writes. Applying the edit cap to a build
  // strangled it: a fresh Expo app rendered a placeholder, the repair read the project twice to fix it,
  // and got cut off at 2 calls before it could add the real features. Builds keep the full allowance.
  // Gate on newProject (a build) and multiFileRepair (re-reading a real generated project to fix it),
  // NOT on initialProjectEvidence — that is also set for a bounded one-file edit, which is exactly the
  // stuck-edit case the tight cap must still catch to avoid the pre-mutation money bleed.
  const buildLikeGeneration = input.newProject || Boolean(input.multiFileRepair);
  const preMutationNoProgressCalls = buildLikeGeneration
    ? configuredNoProgressCalls
    : Math.max(1, Math.min(2, configuredNoProgressCalls));
  let forcedMutationRecovery: "replace_in_file" | "write_file" | undefined = input.requireFirstMutation ? mutationToolForExistingProject() : undefined;
  const initialGeneratedRootEntries = input.newProject ? await input.access.listDir("").catch(() => []) : [];
  const initialGeneratedManifestPresent = initialGeneratedRootEntries.some((entry) => entry.kind === "file" && /^(?:package\.json|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|pom\.xml|cargo\.toml|go\.mod|pubspec\.yaml|[^/]+\.(?:csproj|sln))$/i.test(entry.name));
  const coordinatedGeneratedFoundationNeeded = input.newProject
    && (!initialGeneratedManifestPresent || !(await hasRunnableProjectEntry(input.access)) || input.executionStrategy?.workflow === "autonomous-mission");
  let mutationRecoveryUsed = false;
  let alreadySatisfied = false;
  const explicitlyRequiredPaths = input.newProject ? explicitRequiredProjectPaths(input.task) : [];
  let lastRequiredPathNudge = "";
  let forcedRequiredWriteFailures = 0;
  const routingOperationId = input.costScopeId ?? crypto.randomUUID();
  const consequentialToolNames = new Set(["write_file", "write_files", "replace_in_file", "delete_file", "run_command", "report_complete", "report_blocked"]);
  const explorationToolNames = new Set(["list_dir", "read_file", "search_files"]);

  async function emitReasoning(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (trimmed.length < 12) return false;
    const normalized = normalizeForSimilarity(trimmed);
    if (lastReasoningNormalized && textSimilarity(normalized, lastReasoningNormalized) > 0.6) return false;
    lastReasoningNormalized = normalized;
    await emit("reasoning", "completed", trimmed);
    return true;
  }

  async function emitBlockedOrContinuation(reason: string) {
    if (input.continuableBatch) {
      await emit("planning", "warning", "Execution batch needs continuation", {
        internal: true,
        details: { reason, continuation: true },
      });
      return;
    }
    await emit("summary", "error", "Mission blocked", { details: { reason } });
  }

  function mutationToolForExistingProject(): "replace_in_file" | "write_file" {
    // A small visual request (background, color, spacing, copy, sizing) is still a localized edit.
    // Whole-file static rewrites are reserved for explicit page-wide redesigns; forcing every CSS
    // tweak through write_file inflated latency/cost and made a one-line change depend on a huge JSON
    // response surviving intact.
    if (input.staticProject && input.initialProjectEvidence && presentationChangeRequired
      && /\b(?:redesign|overhaul|rewrite|rebuild|replace)\b[^.\n]{0,60}\b(?:entire|whole|complete|page|screen|site|interface|ui)\b|\bfrom scratch\b/i.test(input.task)) return "write_file";
    return /\b(?:create|add|new)\b[^.\n]{0,50}\b(?:file|page|route|component|screen)\b/i.test(input.task)
      ? "write_file"
      : "replace_in_file";
  }

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (input.signal?.aborted) return stoppedByUser(turn);
    if (paidModelCallsThisBatch >= maximumPaidModelCallsThisBatch) {
      const reason = `Model-call limit reached (${maximumPaidModelCallsThisBatch}) for this execution batch. Foundry stopped before spending the remaining mission allowance; preserve verified files and require deterministic verification or an explicit user resume.`;
      await emit("planning", "warning", "Execution batch stopped at its paid-call safety boundary", { details: { reason, paidCallPrevented: true, recoverable: true } });
      return finalize("failed", reason, Math.max(0, turn - 1));
    }
    // Existing-project missions may need a small amount of inspection, but inspection is not the
    // requested outcome. Once two model turns have only read/listed/searched, require the next
    // call to mutate the project. This applies to every detected stack and keeps a weak Fast model
    // from consuming the whole no-progress allowance before the runtime can escalate it.
    if (
      !input.newProject
      && !input.commandOnly
      && changedFiles.size === 0
      && inspectedExistingProject
      && consecutiveExplorationTurns >= 2
      && !mutationRecoveryUsed
    ) {
      forcedMutationRecovery = mutationToolForExistingProject();
      conversation.push({
        role: "user",
        content: [{
          type: "text",
          text: `Inspection is complete. Apply the requested change now with ${forcedMutationRecovery}. Do not read, list, or search again. Use the verified file evidence already in this conversation, make one real source change, and then verify it.`,
        }],
      });
    }
    const durableWorkExistsNow = changedFiles.size > 0 || successfulCommandSignatures.size > 0;
    const maxModelCallsWithoutDurableProgress = durableWorkExistsNow ? configuredNoProgressCalls : preMutationNoProgressCalls;
    if (modelCallsSinceDurableProgress >= maxModelCallsWithoutDurableProgress) {
      const durableWorkExists = durableWorkExistsNow;
      const reason = durableWorkExists
        ? `NO_PROGRESS_AFTER_MUTATION: ${changedFiles.size} verified file change${changedFiles.size === 1 ? " is" : "s are"} already on disk, but the current implementation batch then used ${modelCallsSinceDurableProgress} model calls without another durable change or unique successful command. Preserve the written work and continue with deterministic verification or one refreshed continuation batch.`
        : `NO_PROGRESS_BEFORE_MUTATION: The initial implementation route used ${modelCallsSinceDurableProgress} consecutive model calls without a new file change or unique successful command. No additional provider call was sent; the runtime should preserve the inspected evidence and try one stronger action-enforced route.`;
      await emit("planning", "warning", "Implementation route needs escalation", {
        internal: true,
        details: { reason, paidCallPrevented: true, recoverable: true, durableWorkExists },
      });
      return finalize("failed", reason, Math.max(0, turn - 1));
    }

    // Announce the work once. Later turns are an implementation detail of the model/tool loop, not
    // user-visible milestones. Emitting a generic recovery sentence on every turn made healthy
    // multi-step missions look stuck even when the previous turn had successfully read, edited, or
    // verified the project. Subsequent visible updates are grounded in actual tool calls below;
    // no-action responses retry quietly and remain bounded by maxNudges.
    if (turn === 1 && input.staticProject && input.newProject) {
      await emit("reasoning", "running", "I’m generating the first complete working page now. The next visible change will be a file written to the project.");
    }

    const missingExplicitRequiredPaths = input.newProject && explicitlyRequiredPaths.length
      ? (await Promise.all(explicitlyRequiredPaths.map(async (requiredPath) => ({
          path: requiredPath,
          exists: Boolean((await input.access.readFile(requiredPath, { limitBytes: 1 }).catch(() => null))?.exists),
        })))).filter((item) => !item.exists).map((item) => item.path)
      : [];
    const forcedRequiredPath = missingExplicitRequiredPaths[0];
    const forceRequiredFile = Boolean(input.newProject && !input.staticProject && generatedWriteCalls >= generatedWriteFloor && forcedRequiredPath);
    const requiredPathSignature = missingExplicitRequiredPaths.join("|");
    if (forceRequiredFile && requiredPathSignature !== lastRequiredPathNudge) {
      conversation.push({
        role: "user",
        content: [{
          type: "text",
          text: `The next user-required project file is still absent: ${forcedRequiredPath}. Create that exact path now with one complete write_file action implementing its real requested behavior. Do not explain, reread unrelated files, batch in another path, or substitute a differently named artifact.`,
        }],
      });
      lastRequiredPathNudge = requiredPathSignature;
    }

    const pendingEvidenceRepairReadPath = input.evidenceFirstRepair
      ? requiredEvidenceRepairReadPaths.find((candidate) => !completedEvidenceRepairReads.has(candidate))
      : undefined;
    const avoidOnThisTurn = changedFiles.size === 0 && input.avoidFirstMutationPaths?.length
      ? new Set(input.avoidFirstMutationPaths.map((file) => file.replace(/\\/g, "/").toLowerCase()))
      : lastCoordinatedMutationPath && (coordinatedMutationCounts.get(lastCoordinatedMutationPath) ?? 0) >= 2
        ? new Set([lastCoordinatedMutationPath.toLowerCase()])
        : undefined;
    const coordinatedAlternatePaths = avoidOnThisTurn
      ? coordinatedEvidencePaths.filter((file) => !avoidOnThisTurn.has(file.toLowerCase()))
      : [];
    if (coordinatedAlternatePaths.length && lastCoordinatedMutationPath && !coordinatedDiversityNudges.has(lastCoordinatedMutationPath)) {
      coordinatedDiversityNudges.add(lastCoordinatedMutationPath);
      conversation.push({
        role: "user",
        content: [{
          type: "text",
          text: `${lastCoordinatedMutationPath} has already received two verified mutations in this bounded multi-file mission. Do not rewrite it again yet. Apply the next incomplete acceptance layer in one of these other current source files: ${coordinatedAlternatePaths.join(", ")}.`,
        }],
      });
    }
    const baseTurnTools = pendingEvidenceRepairReadPath
      ? tools.map((tool) => tool.name === "read_file" ? {
          ...tool,
          description: `Read the deterministically verified repair source at ${pendingEvidenceRepairReadPath}.`,
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "string", const: pendingEvidenceRepairReadPath },
              offset_bytes: { type: "integer", const: 0 },
              limit_bytes: { type: "integer", const: 200_000 },
            },
            required: ["path", "offset_bytes", "limit_bytes"],
          },
        } : tool)
      : tools;
    const turnTools = coordinatedAlternatePaths.length
      ? baseTurnTools.map((tool) => tool.name === "replace_in_file" ? {
          ...tool,
          description: `${tool.description} For this turn, continue the coordinated change in a different source file.`,
          parameters: {
            ...tool.parameters,
            properties: {
              ...((tool.parameters.properties as Record<string, unknown> | undefined) ?? {}),
              path: { type: "string", enum: coordinatedAlternatePaths },
            },
          },
      } : tool)
      : baseTurnTools;
    const activeProviderStage = pendingEvidenceRepairReadPath
      ? `Preparing an exact repair from ${pendingEvidenceRepairReadPath}`
      : changedFiles.size > 0
        ? `Continuing from ${changedFiles.size} verified file change${changedFiles.size === 1 ? "" : "s"}`
        : input.newProject
          ? "Generating the first runnable source batch"
          : forcedMutationRecovery
            ? "Applying the required source change"
            : "Preparing the next verified project action";
    // Greenfield recovery must buy coordinated implementation, not one tiny file per provider call.
    const coordinatedNewProjectFoundation = coordinatedGeneratedFoundationNeeded && !input.staticProject && generatedWriteCalls < 10;
    await emit("reasoning", "running", activeProviderStage, {
      // One provider-wait lifecycle replaces itself across turns and continuation batches. Without
      // a stable identity the canvas rendered the same "Continuing from …" state once per model call.
      id: "implementation-provider-wait",
      details: { provider, model, turn, waitingOnProvider: true, changedFiles: changedFiles.size },
    });
    const result = await callManagedModel(
      {
        provider,
        model,
        effort,
        cacheKey: `${input.workspaceId ?? "workspace"}:${effectiveTier}:executor`,
        system,
        messages: conversation,
        tools: pendingEvidenceRepairReadPath
          ? turnTools.filter((tool) => tool.name === "read_file")
          : forcedMutationRecovery && changedFiles.size === 0
          ? turnTools.filter((tool) => tool.name === forcedMutationRecovery)
          : forceRequiredFile
          ? turnTools.filter((tool) => tool.name === "write_file")
          : needsGeneratedEntryRecovery && generatedWriteCalls < generatedWriteFloor
          ? turnTools.filter((tool) => tool.name === (input.staticProject ? "write_file" : "write_files"))
          : coordinatedNewProjectFoundation
          ? turnTools.filter((tool) => tool.name === "write_files")
          : input.staticProject && input.fastLane && !input.newProject && inspectedExistingProject
          ? turnTools.filter((tool) => !explorationToolNames.has(tool.name))
          : turnTools,
        // A greenfield or incomplete generated project already has its authoritative brief in the
        // task. Require the first concrete action to put source on disk; otherwise models can spend
        // an entire guarded batch repeatedly proving that the missing application is still missing.
        // After one verified write the normal evidence-driven loop resumes.
        toolChoice: immediateBrowserValidationRequested && turn === 1
          ? { name: "validate_browser" }
          : input.staticRewrite
          ? { name: "write_file" }
          : input.evidenceFirstRepair && pendingEvidenceRepairReadPath
          ? { name: "read_file" }
          : input.evidenceFirstRepair && changedFiles.size === 0
          ? { name: "replace_in_file" }
          : forcedMutationRecovery
          ? { name: forcedMutationRecovery }
          : input.staticProject && input.fastLane && !input.newProject && !inspectedExistingProject
          ? { name: "read_file" }
          : input.staticProject && input.fastLane && !input.newProject && inspectedExistingProject
          ? { name: "replace_in_file" }
          : forceRequiredFile
          ? { name: "write_file" }
          : needsGeneratedEntryRecovery && generatedWriteCalls < generatedWriteFloor
          ? { name: input.staticProject ? "write_file" : "write_files" }
          : coordinatedNewProjectFoundation
          ? { name: "write_files" }
          : coordinatedAlternatePaths.length
          ? { name: "replace_in_file" }
          : "auto",
        maxOutputTokens: input.staticProject && input.fastLane && !input.newProject
          ? !inspectedExistingProject ? 1200 : input.maxOutputTokens ?? (input.tier && input.tier !== "fast" ? 10_000 : 6000)
          : input.maxOutputTokens ?? (input.fastLane
          ? 2500
          : input.staticProject && (input.newProject || input.staticRewrite)
          ? 10_000
          : input.newProject
          ? 16_000
          : 8000),
        routing: {
          ...routingContext(input.task, "implement", effectiveTier, input.workspaceId, input.routingAssessment, routingOperationId),
          budget: input.routingBudget,
        },
      },
      { apiKey: input.apiKey, workspaceId: input.workspaceId, userId: input.userId, maxAttempts: 1, signal: input.signal, timeoutMs: input.staticProject && (input.newProject || input.staticRewrite || (input.fastLane && input.tier && input.tier !== "fast")) ? 120_000 : input.staticProject ? 90_000 : input.fastLane ? 60_000 : 160_000 },
    );
    if (result.usage.requestCount > 0) {
      modelCallsSinceDurableProgress += 1;
      paidModelCallsThisBatch += result.usage.requestCount;
    }
    usage.push(result.usage);
    if (turn === 1) {
      await emit("planning", "completed", `Model · ${result.usage.provider}/${result.usage.model}`, {
        details: { stage: "implementation", tier: effectiveTier, provider: result.usage.provider, model: result.usage.model, cached: result.usage.cached },
      });
    }

    if (result.stopReason === "error") {
      if (input.continuableBatch && /(?:Model-call|Premium-model call|Estimated request cost).*limit|would exceed/i.test(result.errorMessage ?? "")) {
        const reason = result.errorMessage || "This bounded execution batch reached its safety boundary.";
        await emit("planning", "completed", "Execution batch complete", { details: { reason, continuation: true } });
        return finalize("failed", reason, turn);
      }
      // A provider failure after the executor has already collected sufficient completion
      // evidence must not overwrite that evidence with a model-availability blocker. This
      // commonly happens after a successful build/install command and checklist updates: the
      // model spends its final call narrating completion, the call budget rejects it, and the
      // UI used to show "Blocked" despite every objective being satisfied. Completion status is
      // derived from verified work, not from whether a final prose response was available.
      const verifiedBeforeProviderRecovery = verifyCompletion(
        checklist,
        changedFiles,
        narrativeObjects,
        Boolean(input.fastLane),
        hadUnresolvedToolFailure,
        commands,
        input.hasBuildTooling ?? true,
        input.verificationProfile,
        { uiOutcomeRequested, presentationChangeRequired, browserValidationRequested, successfulBrowserValidationPasses, requiredBrowserValidationPasses },
      );
      if (verifiedBeforeProviderRecovery.ok) {
        const completionSummary = buildCompletionHandoff("", changedFiles, commands, timeline, narrativeObjects, checklist);
        await emit("summary", "completed", "Implementation complete", { output: completionSummary, details: { summary: completionSummary } });
        return finalize("passed", undefined, turn);
      }
      if (result.failureKind === "guardrail") {
        const preservedWork = changedFiles.size
          ? `${changedFiles.size} changed file${changedFiles.size === 1 ? " was" : "s were"} preserved.`
          : "No project files were changed.";
        const billedCalls = usage.reduce((sum, item) => sum + item.requestCount, 0);
        const billedCost = usage.reduce((sum, item) => sum + item.estimatedCostUsd, 0);
        const paidWork = billedCalls > 0
          ? `${billedCalls} provider call${billedCalls === 1 ? " was" : "s were"} already billed (estimated $${billedCost.toFixed(4)})${changedFiles.size ? "." : " without producing a verified file change."}`
          : "No provider call was billed for the blocked attempt.";
        const reason = `Foundry reached its configured execution limit and did not send an additional provider call. ${paidWork} ${preservedWork} ${result.errorMessage || "No additional provider call was sent."}`;
        if (changedFiles.size > 0 || alreadySatisfied || Boolean(input.initialProjectEvidence)) {
          // A budget boundary after a verified write is an orchestration hand-off, not yet a product
          // failure. The same is true for a coordinated retry whose edits landed in an earlier
          // bounded batch. The runtime owns stack-specific command/browser verification and can
          // complete it without buying a narration response. Keep this internal so the canvas does
          // not show a false red terminal event immediately before deterministic verification wins.
          await emit("planning", "warning", changedFiles.size > 0 ? "Model budget reached after verified edit" : "Model batch complete; deterministic verification pending", {
            internal: true,
            details: { reason, deterministicVerificationPending: true, changedFiles: changedFiles.size, alreadySatisfied, coordinatedEvidence: Boolean(input.initialProjectEvidence), noAdditionalCall: true },
          });
        } else {
          await emit("summary", "error", "Execution limit reached", {
            details: { reason, retryable: true, changedFiles: 0, noAdditionalCall: true },
          });
        }
        return finalize("failed", reason, turn);
      }
      if (result.failureKind === "transport") {
        const preservedWork = changedFiles.size
          ? `${changedFiles.size} changed file${changedFiles.size === 1 ? " was" : "s were"} preserved, but Foundry could not finish and verify the request.`
          : "No project files were changed.";
        const providerFailure = result.errorMessage || "The configured provider attempts failed during transport.";
        const timedOut = /timed?\s*out|timeout/i.test(providerFailure);
        const reason = `${timedOut ? "AI provider attempts timed out." : "AI providers could not be reached."} ${preservedWork} ${providerFailure}`;
        await emit("summary", "error", timedOut ? "AI provider attempts timed out" : "AI providers unavailable", { details: { reason, retryable: true, changedFiles: changedFiles.size } });
        return finalize("failed", reason, turn);
      }
      const recoveredStaticHtml = input.staticProject && input.newProject && /did not call required tool write_file/i.test(result.errorMessage ?? "")
        ? extractCompleteStaticHtml(result.text)
        : undefined;
      if (recoveredStaticHtml) {
        // Some coding models occasionally honor the requested artifact but ignore the wire-level
        // function-call envelope. Accept only a structurally complete self-contained document, then
        // send it through the exact same verified write path as a normal write_file call. Truncated
        // or prose-only responses never reach disk.
        const recoveredWrite = await executeTool(
          "write_file",
          { path: "index.html", content: recoveredStaticHtml },
          input.access,
          emit,
          changedFiles,
          commands,
          narrativeObjects,
          input.preApprovedCommands,
          input.approvedCategories,
          "",
          input.task,
          input.standingApprovedCommands,
          input.deniedActions,
        );
        if (!isFailedWriteResult(recoveredWrite)) {
          hasSelfContainedStaticEntry = true;
          await emit("reasoning", "completed", "The complete page source is on disk. I’m opening it in a real browser now and checking the rendered experience.");
          return finalize("passed", undefined, turn);
        }
      }
      consecutiveProviderFailures += 1;
      if (consecutiveProviderFailures >= 2) {
        const detail = result.errorMessage;
        const reason = result.failureKind === "tool"
          ? `The configured model twice returned without the executable project action Foundry required. ${detail || "No file action was produced."}`
          : detail ? `AI provider response failed twice: ${detail}` : "AI provider response failed twice.";
        await emit("summary", "error", result.failureKind === "tool" ? "No executable edit was produced" : "AI provider failed", {
          details: { reason, retryable: true, changedFiles: changedFiles.size },
        });
        return finalize("failed", reason, turn);
      }
      await emit("reasoning", "warning", result.failureKind === "tool"
        ? "The model response did not contain an executable project action. I’m switching to one action-enforced recovery attempt."
        : "The model response could not be used. I’m making one bounded recovery attempt.", {
        details: result.errorMessage ? { reason: result.errorMessage } : undefined,
      });
      if (input.staticProject && input.newProject && /did not call required tool write_file/i.test(result.errorMessage ?? "")) {
        // The previous implementation repeated the byte-for-byte identical request, which made a
        // second failure overwhelmingly likely. Give the recovery call new, precise context while
        // retaining the authoritative brief and required tool choice.
        conversation.push({
          role: "user",
          content: [{
            type: "text",
            text: "Your previous response returned without the required project write. Call write_file now with one complete, self-contained index.html that implements the saved brief, including embedded CSS and JavaScript, a visible h1, accessible controls, realistic seed data, local persistence, and closing script/body/html tags. Do not explain the code before the tool call.",
          }],
        });
      } else if (input.newProject && /did not call required tool write_files/i.test(result.errorMessage ?? "")) {
        // A non-static greenfield recovery also needs materially different, size-bounded context.
        // Repeating the original broad product brief with the same forced tool caused a second prose
        // response and a terminal blocker before any executable source existed.
        conversation.push({
          role: "user",
          content: [{
            type: "text",
            text: "Your previous response returned without the required project write. Call write_files now with one substantial executable product slice of 8–12 coordinated files and at most roughly 100,000 characters total. The same batch must include the primary usable screen/workflow, state and domain logic, persistence or real integration boundary, and meaningful tests. Do not write markers, constants-only utilities, placeholders, documentation, or explanations before the tool call.",
          }],
        });
      }
      continue;
    }
    consecutiveProviderFailures = 0;

    const functionCalls: ManagedToolCall[] = result.toolCalls;
    const messageText = result.text;

    // Surface the model's own reasoning at moments a person would actually want to hear it: its
    // opening hypothesis, right before a consequential action, when it has nothing to call at all,
    // or — so the user is never left wondering what's happening — after a couple of turns spent
    // purely exploring (reading/listing/searching) with no visible update at all.
    const hasConsequentialCall = functionCalls.some((call) => consequentialToolNames.has(call.name ?? ""));
    const explorationOnly = functionCalls.length > 0 && functionCalls.every((call) => explorationToolNames.has(call.name ?? ""));
    consecutiveExplorationTurns = explorationOnly ? consecutiveExplorationTurns + 1 : 0;
    const forceCheckIn = explorationOnly && silentExplorationTurns >= 2;
    let emittedThisTurn = false;
    if (turn === 1 || hasConsequentialCall || forceCheckIn) {
      const fallbackCheckIn = specificCheckInForCalls(functionCalls);
      emittedThisTurn = await emitReasoning(messageText.trim().length >= 12 ? messageText : forceCheckIn ? fallbackCheckIn : messageText);
    }
    silentExplorationTurns = emittedThisTurn ? 0 : explorationOnly ? silentExplorationTurns + 1 : 0;

    if (!functionCalls.length) {
      nudgesUsed += 1;
      if (nudgesUsed > maxNudges) {
        const stuckReason = changedFiles.size > 0
          ? "NO_PROGRESS_AFTER_MUTATION: Source changes are on disk, but the model stopped producing executable actions. Continue with deterministic verification and requirement-directed acceptance; do not treat model narration as the completion verdict."
          : "NO_PROGRESS_BEFORE_MUTATION: The model stopped producing executable actions before a verified source change.";
        await emitBlockedOrContinuation(stuckReason);
        return finalize("failed", stuckReason, turn);
      }
      const outstanding = checklist.filter((item) => item.status !== "completed" && item.status !== "skipped");
      if (!input.newProject && !input.commandOnly && inspectedExistingProject && !mutationRecoveryUsed) {
        forcedMutationRecovery = mutationToolForExistingProject();
      }
      conversation.push({ role: "assistant", content: [{ type: "text", text: messageText || "(no text)" }] });
      conversation.push({
        role: "user",
        content: [{
          type: "text",
          text: input.staticProject && input.newProject
             ? `Write the next missing complete project artifact now. Do not list or read the empty project and do not describe code without calling write_file. A small single-page project may be one complete index.html with embedded style and script; otherwise finish the missing stylesheet or JavaScript file. Outstanding work: ${outstanding.map((item) => `[${item.id}] ${item.label}`).join("; ")}.`
            : outstanding.length
            ? `Continue working. These checklist items are not yet completed with evidence: ${outstanding.map((item) => `[${item.id}] ${item.label}`).join("; ")}. Verify each by reading the actual file (or re-running a command), then call mark_checklist_item for it. Call a tool now.`
            : "Continue: call a tool, or report_complete / report_blocked.",
        }],
      });
      continue;
    }

    if (forcedMutationRecovery) {
      mutationRecoveryUsed = true;
      forcedMutationRecovery = undefined;
    }

    // Preserve a provider's complete tool-call turn as one assistant message. Gemini 3 may attach
    // one thought signature to the first part of a parallel function-call group; splitting the
    // remaining parts into separate model messages makes those otherwise valid calls look unsigned
    // on the next request and Gemini rejects the conversation.
    const preparedFunctionCalls = functionCalls.map((call) => {
      toolCallSeq += 1;
      return { call, callId: call.id ?? `call-${turn}-${toolCallSeq}` };
    });
    conversation.push({
      role: "assistant",
      content: preparedFunctionCalls.map(({ call, callId }) => ({
        type: "tool_use" as const,
        id: callId,
        name: call.name,
        arguments: call.arguments ?? "{}",
        thoughtSignature: call.thoughtSignature,
      })),
    });
    const toolResultParts: NeutralContentPart[] = [];

    for (const { call, callId } of preparedFunctionCalls) {
      if (input.signal?.aborted) return stoppedByUser(turn);

      const rawArgs = call.arguments ?? "{}";
      const parsedArgs = safeJsonParse(rawArgs);
      const args = parsedArgs ?? {};
      // Models sometimes pass ABSOLUTE paths ("C:\...\project\app\index.tsx"). The access layer writes
      // the right file anyway (containment check passes), but every event, changed-file record, and the
      // file tree then carries a second spelling of the same file — the user saw the whole project
      // duplicated in the tree, once relative and once absolute. Canonicalize to project-relative at
      // this single dispatch point so every consumer downstream sees one spelling.
      normalizeToolCallPaths(args, input.access.rootLabel);
      if (explorationToolNames.has(call.name ?? "")) inspectedExistingProject = true;
      if (!parsedArgs && rawArgs.length > 2) {
        const reason = "The tool call arguments could not be parsed, most likely because the file content was too large and got cut off mid-write. Split this into a smaller change and try again.";
        hadUnresolvedToolFailure = true;
        await emit("edit", "warning", "Large edit failed, switching to a smaller patch", { details: { reason } });
        toolResultParts.push({ type: "tool_result", toolUseId: callId, content: JSON.stringify({ verified: false, accepted: false, reason }) });
        continue;
      }

      if (call.name === "report_complete") {
        const verification = verifyCompletion(
          checklist,
          changedFiles,
          narrativeObjects,
          Boolean(input.fastLane),
          hadUnresolvedToolFailure,
          commands,
          input.hasBuildTooling ?? true,
          input.verificationProfile,
          { uiOutcomeRequested, presentationChangeRequired, browserValidationRequested, successfulBrowserValidationPasses, requiredBrowserValidationPasses },
        );
        if (!verification.ok) {
          completionRejections += 1;
          if (completionRejections > maxCompletionRejections) {
            await emitBlockedOrContinuation(verification.reason);
            return finalize("failed", verification.reason, turn);
          }
          await emit("planning", "warning", "Completion claim rejected", { internal: true, details: { reason: verification.reason } });
          toolResultParts.push({
            type: "tool_result",
            toolUseId: callId,
            content: JSON.stringify({
              accepted: false,
              reason: verification.reason,
              instruction: "Do not call report_complete again until every checklist item below is verified with real evidence via mark_checklist_item (re-read files or re-run commands as needed).",
            }),
          });
          continue;
        }
        const completionSummary = buildCompletionHandoff(String(args.summary ?? ""), changedFiles, commands, timeline, narrativeObjects, checklist);
        await emit("summary", "completed", "Implementation complete", { output: completionSummary, details: { summary: completionSummary } });
        return finalize("passed", undefined, turn);
      }

      if (call.name === "report_blocked") {
        const reason = String(args.reason ?? "The model reported it could not complete the objective.");
        const assessment = assessAutonomousBlocker(reason);
        if (!assessment.terminal) {
          await emit("planning", "warning", "Recoverable engineering failure returned to execution", {
            internal: true,
            details: { reason, disposition: assessment.disposition, terminal: false },
          });
          toolResultParts.push({
            type: "tool_result",
            toolUseId: callId,
            content: JSON.stringify({
              accepted: false,
              reason: "This is a recoverable project/verification failure, not an external blocker.",
              instruction: "Continue autonomously: use the exact failure evidence, make a durable source/configuration change or run a new diagnostic command, then repeat the failed verification. Do not call report_blocked for this fingerprint again.",
            }),
          });
          continue;
        }
        await emitBlockedOrContinuation(reason);
        return finalize("failed", reason, turn);
      }

      const writePath = String(args.path ?? "").replace(/\\/g, "/");
      const coordinatedWritePaths = call.name === "write_files" && Array.isArray(args.files)
        ? args.files.map((file) => file && typeof file === "object" ? String((file as Record<string, unknown>).path ?? "").replace(/\\/g, "/") : "")
        : [];
      const generatedMutationPaths = coordinatedWritePaths.length ? coordinatedWritePaths : [writePath];
      const proposedGeneratedFiles = call.name === "write_files" && Array.isArray(args.files)
        ? args.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
        : [args];
      const wrongForcedRequiredPath = forceRequiredFile && call.name === "write_file" && writePath.toLowerCase() !== forcedRequiredPath?.toLowerCase()
        ? `This recovery action must create the exact missing user-required path ${forcedRequiredPath}; ${writePath || "a blank path"} is not an accepted substitute.`
        : undefined;
      const lastCommandFailed = commands.length > 0 && commands[commands.length - 1]?.exitCode !== 0;
      const repeatedGeneratedWriteIssue = input.newProject
        && ["write_file", "write_files"].includes(call.name ?? "")
        && generatedMutationPaths.length > 0
        && generatedMutationPaths.every((filePath) => filePath && (generatedWriteCounts.get(filePath.toLowerCase()) ?? 0) > 0)
        && !lastCommandFailed
        ? `This batch already wrote ${generatedMutationPaths.join(", ")} successfully and no failed build names it for repair. Rewriting only the same file is not project progress; create the next missing route, component, state module, test, or configuration file instead.`
        : undefined;
      let generatedApplicationRootIssue: string | undefined;
      if (input.newProject && ["write_file", "write_files", "replace_in_file"].includes(call.name ?? "")) {
        const rootEntries = await input.access.listDir("").catch(() => []);
        const srcEntries = rootEntries.some((entry) => entry.kind === "directory" && entry.name.toLowerCase() === "src")
          ? await input.access.listDir("src").catch(() => [])
          : [];
        const hasRootApp = rootEntries.some((entry) => entry.kind === "directory" && entry.name.toLowerCase() === "app");
        const hasSrcApp = srcEntries.some((entry) => entry.kind === "directory" && entry.name.toLowerCase() === "app");
        const rootAppEntries = hasRootApp ? await input.access.listDir("app").catch(() => []) : [];
        const srcAppEntries = hasSrcApp ? await input.access.listDir("src/app").catch(() => []) : [];
        const appTreeScore = (entries: typeof rootAppEntries) => entries.reduce((score, entry) => score
          + (/^page\.[cm]?[jt]sx?$/i.test(entry.name) ? 100 : 0)
          + (/^layout\.[cm]?[jt]sx?$/i.test(entry.name) ? 10 : 0)
          + (entry.kind === "file" ? 1 : 0), 0);
        const preferredRoot = hasRootApp && hasSrcApp
          ? (appTreeScore(rootAppEntries) >= appTreeScore(srcAppEntries) ? "app" : "src/app")
          : hasRootApp ? "app" : hasSrcApp ? "src/app" : undefined;
        if (preferredRoot === "src/app" && generatedMutationPaths.some((path) => /^app\//i.test(path))) {
          generatedApplicationRootIssue = "This project already uses src/app. Writing a parallel app tree would create conflicting routes; keep every Next.js route, layout, and style under src/app.";
        } else if (preferredRoot === "app" && generatedMutationPaths.some((path) => /^src\/app\//i.test(path))) {
          generatedApplicationRootIssue = "This project already uses app. Writing a parallel src/app tree would create conflicting routes; keep every Next.js route, layout, and style under app.";
        }
      }
      const runnableEntryExistsNow = input.newProject ? await hasRunnableProjectEntry(input.access) : true;
      const protectedBatchPath = input.newProject ? generatedMutationPaths.find((path) => /(?:^|\/)foundry-brief\.md$/i.test(path)) : undefined;
      const generatedBatchDocumentationPath = input.newProject && !runnableEntryExistsNow ? generatedMutationPaths.find((path) => /(?:^|\/)(?:readme(?:\.[^/]+)?|changelog(?:\.[^/]+)?|notes?(?:\.[^/]+)?|scratch(?:\.[^/]+)?|temp(?:\.[^/]+)?|todo(?:\.[^/]+)?|\.init-stamp)$/i.test(path)) : undefined;
      const generatedBatchMarkerPath = input.newProject ? generatedMutationPaths.find((path) => /(?:^|\/)(?:\.(?:bootstrap|handoff|stamp|keep|touch|placeholder)(?:\.[^/]*)?|fix\.txt|[^/]*(?:touchpoint|status|progress|handoff|bootstrap|inspect|probe|noop|marker|fix[-_ ]?(?:note|placeholder|stub|temp)|repair[-_ ]?note|debug[-_ ]?note|verification[-_ ]?note)[^/]*)(?:\.[^/]*)?$|\.(?:tmp|log)$/i.test(path)) : undefined;
      const generatedPlainPlaceholderPath = input.newProject ? generatedMutationPaths.find((candidate) =>
        /(?:^|\/)(?:placeholder\d*(?:\.[^/]*)?|boot\.txt|init\.txt|[^/]*(?:scaffoldnote|kickoff|missioncontinuation|featurescaffold|batch\d*anchor|batch\d*[a-z]?|init(?:one|two|three|\d+)|keep\d+)[^/]*\.[^/]*)$/i.test(candidate)
        || /(?:^|\/)(?:temp|placeholder)(?:\/|$)/i.test(candidate)) : undefined;
      let invalidAndroidNamespacePath: string | undefined;
      if (input.newProject && input.verificationProfile?.adapterId === "android-gradle") {
        const appGradle = await input.access.readFile("app/build.gradle.kts", { limitBytes: 120_000 }).catch(() => ({ exists: false, content: "" }));
        const fallbackGradle = appGradle.exists ? appGradle : await input.access.readFile("app/build.gradle", { limitBytes: 120_000 }).catch(() => ({ exists: false, content: "" }));
        const namespace = fallbackGradle.content.match(/\bnamespace\s*(?:=\s*)?["']([^"']+)["']/)?.[1]
          ?? fallbackGradle.content.match(/\bapplicationId\s*(?:=\s*)?["']([^"']+)["']/)?.[1];
        if (namespace) {
          const namespacePath = namespace.replace(/\./g, "/").toLowerCase();
          invalidAndroidNamespacePath = generatedMutationPaths.find((candidate) => {
            const normalized = candidate.replace(/\\/g, "/").toLowerCase();
            const source = normalized.match(/^app\/src\/(?:main|test|androidtest)\/(?:java|kotlin)\/(.+)\.(?:kt|java)$/i)?.[1];
            return Boolean(source && source !== namespacePath && !source.startsWith(`${namespacePath}/`));
          });
        }
      }
      const invalidAndroidProductPath = input.newProject && input.verificationProfile?.adapterId === "android-gradle"
        ? generatedMutationPaths.find((candidate) => !/^(?:settings\.gradle(?:\.kts)?|build\.gradle(?:\.kts)?|gradle\.properties|app\/build\.gradle(?:\.kts)?|app\/src\/(?:main|test|androidTest)\/(?:java|kotlin|res)\/.+\.(?:kt|java|xml))$/i.test(candidate))
        : undefined;
      const androidSourceFiles = proposedGeneratedFiles.filter((file) => /^app\/src\/(?:main|test|androidTest)\/(?:java|kotlin)\/.+\.(?:kt|java)$/i.test(String(file.path ?? "").replace(/\\/g, "/")));
      const androidProductLayers = new Set(androidSourceFiles.flatMap((file) => {
        const candidatePath = String(file.path ?? "").replace(/\\/g, "/").toLowerCase();
        const content = String(file.content ?? "");
        const layers: string[] = [];
        if (/\/(?:ui|screen|presentation)\/|(?:activity|screen|viewmodel)\.(?:kt|java)$/.test(candidatePath)
          || /\b(?:@Composable|Activity|ViewModel)\b/.test(content)) layers.push("experience");
        if (/\/(?:domain|usecase|workflow|feature)\/|\b(?:use\s*case|workflow|checkout|cart|sale|refund|inventory)\b/i.test(`${candidatePath} ${content}`)) layers.push("behavior");
        if (/\/(?:data|repository|database|dao|integration|gateway|terminal)\/|\b(?:@Entity|@Dao|RoomDatabase|Repository|Gateway|POSLink|Terminal)\b/.test(`${candidatePath} ${content}`)) layers.push("persistence-or-integration");
        if (/^app\/src\/(?:test|androidtest)\//.test(candidatePath) || /\b@Test\b/.test(content)) layers.push("test");
        return layers;
      }));
      const coordinatedAndroidProductSlice = androidSourceFiles.length >= 3
        && androidProductLayers.has("experience")
        && androidProductLayers.has("behavior")
        && (androidProductLayers.has("persistence-or-integration") || androidProductLayers.has("test"));
      const insufficientAndroidSourceBatch = input.newProject && input.verificationProfile?.adapterId === "android-gradle" && call.name === "write_files"
        && androidSourceFiles.length < (runnableEntryExistsNow ? 6 : 2)
        && !coordinatedAndroidProductSlice;
      const generatedPlaceholderContentPath = input.newProject
        ? proposedGeneratedFiles.find((file) => proposedFileIsPlaceholderOnly(String(file.path ?? ""), String(file.content ?? "")))?.path as string | undefined
        : undefined;
      const undersizedCoordinatedFoundation = coordinatedNewProjectFoundation
        && call.name === "write_files"
        && proposedGeneratedFiles.length < 3
        ? `A coordinated greenfield foundation requires at least 3 complete related files; this call supplied ${proposedGeneratedFiles.length}. The batch was rejected before disk write.`
        : undefined;
      const generatedOrchestrationArtifactPath = generatedMutationPaths.find((candidate) => {
        const normalized = candidate.replace(/\\/g, "/");
        return /(?:^|\/)[^/]*(?:build[-_ ]?lock|verification[-_ ]?repair|compiler[-_ ]?repair|provider[-_ ]?fallback|scaffold[-_ ]?repair)[^/]*\.[^/]+$/i.test(normalized)
          || /(?:^|\/)[^/]*marker[^/]*\.(?:txt|md|json|log)$/i.test(normalized)
          // Provider/SDK prerequisites belong in Foundry's execution state, never as fake
          // customer-domain classes whose only behavior is documenting that work is blocked.
          || /(?:^|\/)[^/]*(?:continuation(?:note)?|sdk(?:evidence|readiness)|evidence(?:gate|record|checklist)|hardwarevalidationnotice|validationnotice)[^/]*\.[^/]+$/i.test(normalized);
      });
      const generatedProcessTheater = input.newProject ? generatedProcessTheaterPath(proposedGeneratedFiles) : undefined;
      const competingProjectManifestPath = input.newProject && !explicitProjectExpansion
        ? generatedMutationPaths.find((candidate) => {
            const family = projectManifestFamily(candidate);
            if (!family) return false;
            const normalized = candidate.replace(/\\/g, "/").toLowerCase();
            return establishedProjectManifests.some((existing) => projectManifestFamily(existing) === family && existing.toLowerCase() !== normalized);
          })
        : undefined;
      let generatedManifestIssue: string | undefined;
      if (input.newProject) {
        const manifestWrite = call.name === "write_files" && Array.isArray(args.files)
          ? args.files.find((file) => file && typeof file === "object" && /(?:^|\/)package\.json$/i.test(String((file as Record<string, unknown>).path ?? "").replace(/\\/g, "/"))) as Record<string, unknown> | undefined
          : call.name === "write_file" && /(?:^|\/)package\.json$/i.test(writePath)
            ? args
            : undefined;
        if (manifestWrite && typeof manifestWrite.content === "string") {
          try {
            const proposed = JSON.parse(manifestWrite.content) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
            const previous = await input.access.readFile(String(manifestWrite.path ?? "package.json"), { limitBytes: 200_000 });
            const current = previous.exists ? JSON.parse(previous.content) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } : undefined;
            const proposedEntries = { ...(proposed.dependencies ?? {}), ...(proposed.devDependencies ?? {}) };
            const currentEntries = { ...(current?.dependencies ?? {}), ...(current?.devDependencies ?? {}) };
            const changedFoundation = Object.entries(currentEntries).find(([name, version]) => proposedEntries[name] && proposedEntries[name] !== version);
            const removedFoundation = Object.keys(currentEntries).find((name) => proposedEntries[name] === undefined);
            const removedScaffoldScript = Object.keys(current?.scripts ?? {}).find((name) => proposed.scripts?.[name] === undefined);
            const floatingVersion = Object.entries(proposedEntries).find(([, version]) => /^latest$/i.test(version));
            if (changedFoundation) {
              generatedManifestIssue = `The verified scaffold already pins ${changedFoundation[0]} at ${changedFoundation[1]}. Preserve its compatible foundation versions and add only genuinely required packages; do not replace the scaffold dependency set.`;
            } else if (removedFoundation) {
              generatedManifestIssue = `The verified scaffold requires ${removedFoundation}. Generated implementation may add dependencies, but it cannot delete the selected stack's foundation packages.`;
            } else if (removedScaffoldScript) {
              generatedManifestIssue = `The verified scaffold requires the ${removedScaffoldScript} script. Generated implementation cannot delete canonical build, typecheck, test, start, or preview commands.`;
            } else if (floatingVersion) {
              generatedManifestIssue = `${floatingVersion[0]} uses the floating \"latest\" tag. Generated projects must use an explicit compatible version range so a future registry release cannot silently break the build.`;
            }
          } catch {
            generatedManifestIssue = "package.json must be valid JSON and preserve the verified scaffold's compatible dependency versions.";
          }
        }
      }
      const protectedGeneratedBriefIssue = input.newProject && call.name === "write_file" && /(?:^|\/)foundry-brief\.md$/i.test(writePath)
        ? "foundry-brief.md already exists and is the authoritative saved requirement included in your task. It cannot be overwritten as generated application output. Continue now by writing a real source file such as app/page.tsx, src/main.tsx, or index.html instead; do not report that the brief is missing."
        : undefined;
      const generatedDocumentationIssue = input.newProject && !runnableEntryExistsNow && (call.name === "write_file" || call.name === "replace_in_file") && /(?:^|\/)(?:readme(?:\.[^/]+)?|changelog(?:\.[^/]+)?|notes?(?:\.[^/]+)?|scratch(?:\.[^/]+)?|temp(?:\.[^/]+)?|todo(?:\.[^/]+)?|\.init-stamp)$/i.test(writePath)
        ? "Documentation cannot substitute for the unfinished application. Write the missing coordinated application source, configuration, data, or tests first; update README only after the real project builds."
        : undefined;
      const generatedMarkerIssue = input.newProject && (call.name === "write_file" || call.name === "replace_in_file")
        && (/(?:^|\/)(?:\.(?:bootstrap|handoff|stamp|keep|touch|placeholder)(?:\.[^/]*)?|fix\.txt|[^/]*(?:touchpoint|status|progress|handoff|bootstrap|inspect|probe|noop|marker|fix[-_ ]?(?:note|placeholder|stub|temp)|repair[-_ ]?note|debug[-_ ]?note|verification[-_ ]?note)[^/]*)(?:\.[^/]*)?$/i.test(writePath)
          || /\.(?:tmp|log)$/i.test(writePath))
        ? "Internal marker, status, progress, bootstrap, handoff, temp, and log files are not customer application source. Write a real executable source, style, configuration, domain-data, route, component, or test file instead."
        : undefined;
      const generatedRecoveryWriteIssue = input.newProject && !runnableEntryExistsNow && call.name === "write_file" && !EXECUTABLE_SOURCE_PATH.test(writePath)
        ? "The runnable application entry is still missing. This recovery batch accepts only real executable application source or styles until the app has a coherent entry point; marker, metadata, and handoff files do not count."
        : undefined;
      const firstStaticArtifactIssue = input.staticProject && (input.newProject || input.staticRewrite) && generatedWriteCalls === 0 && call.name === "write_file"
        && (writePath.toLowerCase() !== "index.html" || !isCompleteSelfContainedStaticEntry(writePath, String(args.content ?? "")))
        ? "The first static-project write must be the finished index.html, not a skeleton or initialization placeholder. Write at least 2,500 characters with the complete requested content, embedded responsive CSS, embedded interactive JavaScript, realistic seed data, accessible controls, and closing </script>, </body>, and </html> tags. This one coherent artifact lets Foundry verify the browser without buying several follow-up model turns."
        : undefined;
      const coordinatedGeneratedWriteIssue = undersizedCoordinatedFoundation
        ?? (insufficientAndroidSourceBatch
        ? `${runnableEntryExistsNow ? "An Android continuation batch must implement a substantial product slice with at least six coordinated Kotlin/Java application and test files" : "An unfinished Android foundation must include at least two real Kotlin/Java application or test files"}. Tiny utility batches and XML resources alone do not implement the saved product brief.`
        : invalidAndroidProductPath
        ? `${invalidAndroidProductPath} is not Android application source, test source, resource XML, or verified Gradle configuration. Generated Android batches may not create temp, log, marker, or generic text files.`
        : invalidAndroidNamespacePath
        ? `${invalidAndroidNamespacePath} is outside the Android application's established namespace. Extend the existing application package declared in app/build.gradle instead of creating a disconnected parallel source tree.`
        : protectedBatchPath
        ? "foundry-brief.md is the authoritative saved requirement and cannot be overwritten as generated application output."
        : competingProjectManifestPath
          ? `${competingProjectManifestPath} would create a competing project root beside the established ${establishedProjectManifests.join(", ")}. Repair the existing project in place; do not scaffold a replacement unless the user explicitly requests another project or module.`
        : generatedOrchestrationArtifactPath
          ? `${generatedOrchestrationArtifactPath} describes Foundry's own build, verification, provider, scaffold, or progress machinery. Internal orchestration artifacts are never customer application source and cannot be written into a generated project.`
        : generatedProcessTheater
          ? `${generatedProcessTheater} turns Foundry's internal provider/mission state into customer source and claims success without a real SDK/API action. Implement an actual user workflow or provider adapter and verify its response; execution notes and hard-coded verified booleans are rejected.`
        : generatedPlainPlaceholderPath
          ? `${generatedPlainPlaceholderPath} is a placeholder/bootstrap artifact, not customer application source. This entire batch was rejected before disk write.`
        : generatedPlaceholderContentPath
          ? `${generatedPlaceholderContentPath} contains placeholder-only implementation rather than requested product behavior. This entire batch was rejected before disk write.`
        : generatedBatchDocumentationPath
          ? `${generatedBatchDocumentationPath} is documentation, not the unfinished customer application. Write the coordinated application source first.`
          : generatedBatchMarkerPath
            ? `${generatedBatchMarkerPath} is an internal marker/progress artifact, not customer application source.`
            : undefined);
      // Structural-drift guard: a write whose relative imports point at files that do not exist is not
      // an implementation — it is an invented parallel structure. Observed live: a repair wrote screens
      // importing ../src/state/MoodContext while the real module lived at src/context/JournalContext;
      // typecheck was recorded before the writes, the bundler failed after the mission concluded, and
      // the app shipped broken. Every import must resolve against the real project (or a file in the
      // same coordinated batch) BEFORE the write touches disk.
      const unresolvedImportIssue = ["write_file", "write_files", "replace_in_file"].includes(call.name ?? "")
        ? await unresolvedRelativeImportIssue(input.access, call.name ?? "", args, generatedMutationPaths).catch(() => undefined)
        : undefined;
      const duplicateJvmIssue = input.newProject && ["write_file", "write_files"].includes(call.name ?? "")
        ? await duplicateJvmDeclarationIssue(input.access, proposedGeneratedFiles).catch(() => undefined)
        : undefined;
      const staticWriteIssue = wrongForcedRequiredPath ?? unresolvedImportIssue ?? duplicateJvmIssue ?? repeatedGeneratedWriteIssue ?? generatedApplicationRootIssue ?? generatedManifestIssue ?? coordinatedGeneratedWriteIssue ?? protectedGeneratedBriefIssue ?? generatedDocumentationIssue ?? generatedMarkerIssue ?? generatedRecoveryWriteIssue ?? firstStaticArtifactIssue ?? (input.staticProject && call.name === "write_file"
        ? invalidStaticEntryWrite(writePath, String(args.content ?? ""))
        : undefined);
      const evidenceRepairReplacement = typeof args.new_text === "string" ? args.new_text : "";
      const evidenceRepairWriteIssue = input.evidenceFirstRepair
        && call.name === "replace_in_file"
        && /direct child links \(no list wrapper\)/i.test(input.task)
        && /nav\s+(?:>\s*)?(?:ul|ol)\s*\{/i.test(evidenceRepairReplacement)
        && !/(?:\.primary-nav|#primary-nav|nav(?:[#.][\w-]+)*)\s*\{/i.test(evidenceRepairReplacement)
          ? "The browser proved these navigation links are direct children of the nav and there is no list wrapper. A nav ul/nav ol rule cannot affect this DOM. Target the verified nav container or its direct anchors instead."
          : undefined;
      const modelOwnedPreviewCommandIssue = !input.commandOnly
        && call.name === "run_command"
        && isLongRunningServerCommand(String(args.command ?? ""))
        ? "Foundry owns preview startup outside the implementation model. Run the canonical finite build/test command instead; a dev or start server cannot count as successful production verification."
        : undefined;
      let toolResult: unknown;
      if (staticWriteIssue ?? evidenceRepairWriteIssue ?? modelOwnedPreviewCommandIssue) {
        const rejectedWriteReason = staticWriteIssue ?? evidenceRepairWriteIssue ?? modelOwnedPreviewCommandIssue!;
        await emit(modelOwnedPreviewCommandIssue ? "command" : "edit", "warning", modelOwnedPreviewCommandIssue ? "Model-owned preview command rejected" : "Incomplete page write rejected before touching disk", {
          filePath: String(args.path ?? ""),
          details: { reason: rejectedWriteReason },
        });
        toolResult = { verified: false, reason: rejectedWriteReason };
        if (input.newProject && ["write_file", "write_files", "replace_in_file"].includes(call.name ?? "")) {
          consecutiveRejectedGeneratedWrites += 1;
          if (consecutiveRejectedGeneratedWrites >= 2) {
            const reason = `Generated source was rejected twice without a durable mutation. Foundry stopped before buying another provider call. Latest rejection: ${rejectedWriteReason}`;
            await emit("planning", "warning", "Rejected generation stopped before another paid call", {
              internal: true,
              details: { reason, paidCallPrevented: true, recoverable: true },
            });
            return finalize("failed", reason, turn);
          }
        }
      } else {
        toolResult = await executeTool(call.name ?? "", args, input.access, emit, changedFiles, commands, narrativeObjects, input.preApprovedCommands, input.approvedCategories, messageText, input.task, input.standingApprovedCommands, input.deniedActions).catch((error) => ({
          error: error instanceof Error ? error.message : "Tool call failed unexpectedly.",
        }));
      }
      if (call.name === "read_file" && input.evidenceFirstRepair) {
        const normalizedReadPath = typeof args.path === "string" ? args.path.replace(/\\/g, "/").trim() : "";
        const readResult = toolResult as { exists?: boolean; error?: unknown };
        if (normalizedReadPath && readResult.exists === true && !readResult.error) {
          completedEvidenceRepairReads.add(normalizedReadPath);
        }
      }
      if (["write_file", "write_files", "replace_in_file"].includes(call.name ?? "")) {
        const writeResult = toolResult as { verified?: boolean; contentChanged?: boolean; written?: number };
        if (writeResult.verified && (writeResult.contentChanged || Number(writeResult.written ?? 0) > 0)) {
          consecutiveRejectedGeneratedWrites = 0;
          modelCallsSinceDurableProgress = 0;
          consecutiveExplorationTurns = 0;
          const mutationPaths = coordinatedWritePaths.length ? coordinatedWritePaths : [writePath];
          for (const mutationPath of mutationPaths.filter(Boolean)) {
            const normalizedMutationPath = mutationPath.toLowerCase();
            coordinatedMutationCounts.set(normalizedMutationPath, (coordinatedMutationCounts.get(normalizedMutationPath) ?? 0) + 1);
            lastCoordinatedMutationPath = normalizedMutationPath;
          }
          if (input.staticProject && input.fastLane && !input.newProject) {
            // The runtime owns the real static preview and browser acceptance gate. Once the targeted
            // edit is verified on disk, another paid model turn can only narrate/checklist the work or
            // incorrectly ask to start a server. Hand off immediately and let deterministic evidence
            // decide success or failure.
            await emit("planning", "completed", "Verified static edit ready for browser validation", {
              internal: true,
              details: { changedFiles: Array.from(changedFiles), deterministicBrowserVerificationPending: true },
            });
            return finalize("passed", undefined, turn);
          }
        }
      }
      if (call.name === "run_command") {
        const commandResult = toolResult as { exitCode?: number | null; skipped?: string };
        const command = typeof args.command === "string" ? args.command : "";
        if (commandResult.exitCode === 0 && !commandResult.skipped && command && !successfulCommandSignatures.has(command)) {
          successfulCommandSignatures.add(command);
          modelCallsSinceDurableProgress = 0;
        }
        if (commandResult.exitCode === 0 && !commandResult.skipped && explicitlyRequestsCommand(input.task, command)) {
          checklist.forEach((item) => {
            if (item.status === "pending" || item.status === "running") {
              item.status = "completed";
              item.evidence = `${command} exited with code 0.`;
            }
          });
          await emitChecklistSnapshot();
          await emit("summary", "completed", `Command completed: ${command}`, {
            details: { summary: `${command} exited with code 0.` },
          });
          return finalize("passed", undefined, turn);
        }
      }
      if (call.name === "validate_browser" && (toolResult as { verified?: boolean }).verified) {
        successfulBrowserValidationPasses += 1;
        if (input.commandOnly && successfulBrowserValidationPasses >= requiredBrowserValidationPasses) {
          checklist.forEach((item) => {
            if (item.status === "pending" || item.status === "running") {
              item.status = "completed";
              item.evidence = `${successfulBrowserValidationPasses} requested browser validation${successfulBrowserValidationPasses === 1 ? "" : "s"} passed with real runtime evidence.`;
            }
          });
        }
      }
      if (call.name === "mark_checklist_item") {
        const phaseBefore = checklist.find((item) => item.id === args.id)?.phase;
        const phaseWasOpenBefore = phaseBefore
          ? checklist.some((item) => item.phase === phaseBefore && item.status !== "completed" && item.status !== "skipped")
          : false;
        applyChecklistUpdate(checklist, args);
        await emitChecklistSnapshot();
        if ((input.highRisk || input.offerMockGate) && phaseBefore && phaseWasOpenBefore) {
          const phaseNowDone = checklist.every((item) => item.phase !== phaseBefore || item.status === "completed" || item.status === "skipped");
          if (phaseNowDone) {
            const isFirstPhase = checklist[0]?.phase === phaseBefore;
            if (input.offerMockGate && isFirstPhase) {
              const message = `The first working mock is ready — "${phaseBefore}" is done. Open the preview and try it out, then tell me what to change or say it looks good to keep building.`;
              await emit("summary", "completed", "First working mock ready for review", { details: { reason: message } });
              return finalize("awaiting-mock-approval", message, turn);
            }
            await emit("summary", "completed", `Checkpoint: ${phaseBefore} complete`, {
              details: { reason: `Every item in "${phaseBefore}" is resolved. Review this checkpoint before the next phase starts.` },
            });
          }
        }
      }
      if (call.name === "write_file" || call.name === "write_files") {
        const writeResult = toolResult as { skipped?: string; reason?: string; category?: string; requestedCommand?: string };
        if (writeResult.skipped === "permission-required") {
          const writePath = typeof args.path === "string" ? args.path : "coordinated project files";
          const requestedAction = writeResult.requestedCommand ?? `write ${writePath}`;
          const approvalActionKind = writeResult.requestedCommand ? "command" : "write";
          const reason = writeResult.reason ?? "This write needs your approval before Foundry can continue.";
          await emit("blocked", "warning", `Permission needed: ${requestedAction}`, {
            command: requestedAction,
            details: { reason, category: writeResult.category ?? "unrecognized", approvalActionKind, approvalTarget: writeResult.requestedCommand ? requestedAction : writePath },
          });
          return finalize("awaiting-approval", `Waiting for your approval to run: ${requestedAction}`, turn, {
            kind: writeResult.requestedCommand ? "command" : "write",
            target: requestedAction,
            category: writeResult.category ?? "unrecognized",
          });
        }
        if (isFailedWriteResult(toolResult)) {
          hadUnresolvedToolFailure = true;
          if (forceRequiredFile) {
            forcedRequiredWriteFailures += 1;
            if (forcedRequiredWriteFailures >= 2) {
              const requiredFailure = `Required file write failed twice for ${forcedRequiredPath}. Foundry stopped this batch instead of paying for another identical no-progress action.`;
              await emitBlockedOrContinuation(requiredFailure);
              return finalize("failed", requiredFailure, turn);
            }
          }
          const rawPath = call.name === "write_files" ? "(coordinated batch)" : String(args.path ?? "");
          const isBlankish = !rawPath.trim() || /^[./\\]*$/.test(rawPath.trim());
          const signature = `${isBlankish ? "(blank)" : rawPath}::${toolResult.reason ?? ""}`;
          repeatedWriteFailures = signature === lastFailedWriteSignature ? repeatedWriteFailures + 1 : 1;
          lastFailedWriteSignature = signature;

          if (repeatedWriteFailures >= 3) {
            const stuckReason = "I kept repeating the same failing file write and couldn't self-correct, so I'm stopping instead of continuing to guess.";
            await emitBlockedOrContinuation(stuckReason);
            return finalize("failed", stuckReason, turn);
          }

          if (repeatedWriteFailures === 2) {
            (toolResult as Record<string, unknown>).note =
              "You have made this exact write_file call with this exact invalid path twice in a row. Do not repeat it — provide a real relative file path, such as 'styles.css' or 'src/index.js'.";
          }
        } else {
          if ((toolResult as { verified?: boolean }).verified) {
            if (forceRequiredFile) forcedRequiredWriteFailures = 0;
            generatedWriteCalls += call.name === "write_files" ? Number((toolResult as { written?: number }).written ?? 1) : 1;
            generatedMutationPaths.filter(Boolean).forEach((filePath) => {
              const key = filePath.toLowerCase();
              generatedWriteCounts.set(key, (generatedWriteCounts.get(key) ?? 0) + 1);
            });
            if (input.newProject && call.name === "write_files") {
              const reason = "SOURCE_BATCH_READY_FOR_DETERMINISTIC_VERIFICATION: The coordinated source batch is on disk. Run the stack's required compile, lint, tests, and build before requesting another generated batch.";
              await emit("planning", "completed", "Source batch ready for deterministic verification", {
                internal: true,
                details: { reason, changedFiles: generatedMutationPaths, paidModelCallsBeforeVerification: paidModelCallsThisBatch },
              });
              return finalize("failed", reason, turn);
            }
          }
          lastFailedWriteSignature = "";
          repeatedWriteFailures = 0;
          if (hadUnresolvedToolFailure) {
            hadUnresolvedToolFailure = false;
            await emit("edit", "completed", "Recovered — completed successfully with a smaller change");
          }
          if (input.staticProject && call.name === "write_file") {
            const staticPath = String(args.path ?? "");
            const staticContent = String(args.content ?? "");
            const incompleteEntry = isIncompleteStaticHtmlEntry(staticPath, staticContent);
            hasSelfContainedStaticEntry ||= isCompleteSelfContainedStaticEntry(staticPath, staticContent);
            if (incompleteEntry) {
              hadUnresolvedToolFailure = true;
              (toolResult as Record<string, unknown>).note = "The HTML file is truncated or structurally incomplete. Rewrite it with closing </script>, </body>, and </html> tags before moving on.";
              await emit("edit", "warning", "Page source was incomplete, continuing the build", { filePath: staticPath });
            }
            const progress = staticProjectProgressForFile(String(args.path ?? ""), changedFiles.size);
            if (progress) await emitReasoning(progress);
          }
        }
      }
      if (call.name === "replace_in_file") {
        if (isFailedWriteResult(toolResult)) {
          hadUnresolvedToolFailure = true;
        } else if (hadUnresolvedToolFailure) {
          hadUnresolvedToolFailure = false;
          await emit("edit", "completed", "Recovered — the targeted edit completed successfully");
        }
      }
      if (input.evidenceFirstRepair && call.name === "replace_in_file" && (toolResult as { verified?: boolean; contentChanged?: boolean }).verified && (toolResult as { contentChanged?: boolean }).contentChanged) {
        await emit("reasoning", "completed", "The evidence-backed source repair is on disk. Foundry is rebuilding and repeating the same browser gate now; no paid wrap-up call is needed.");
        return finalize("passed", undefined, turn);
      }
      if (
        !input.newProject
        && changedFiles.size === 0
        && (call.name === "write_file" || call.name === "replace_in_file")
        && (toolResult as { noOp?: boolean }).noOp
      ) {
        if (input.fastLane && checklist.length <= 1) {
          // A no-op write proves the model wrote what it intended — not that what it intended satisfies
          // the request. Treating the two as the same is how a mission declares victory without looking:
          // it re-wrote the file byte-identically, concluded the work was already done, and returned
          // "passed" with every checklist item completed while the user's request was untouched.
          //
          // So the claim has to be checked against the file as it actually stands. When the request
          // yields no derivable assertion the verdict is "underivable" rather than "violated", so this
          // guard stays silent on requests it cannot judge instead of blocking them.
          const noOpPath = String(args.path ?? "");
          const currentFile = noOpPath ? await input.access.readFile(noOpPath, { limitBytes: 400_000 }).catch(() => undefined) : undefined;
          const currentContent = currentFile?.exists ? currentFile.content : undefined;
          const satisfiedClaim = currentContent === undefined
            ? { status: "underivable" as const, summary: "", assertions: [] }
            : complianceVerdict(deriveOutcomeAssertions(input.task, [{ path: noOpPath, before: currentContent, after: currentContent }]));

          if (satisfiedClaim.status === "violated") {
            const remedy = satisfiedClaim.assertions.map(correctionInstruction).filter(Boolean).join(" ");
            await emit("edit", "warning", "That write changed nothing and the request is not yet satisfied", {
              internal: true,
              details: { reason: satisfiedClaim.summary, rejectedAlreadySatisfiedClaim: true },
            });
            conversation.push({
              role: "user",
              content: [{
                type: "text",
                text: `Your write changed nothing, and the request is NOT already satisfied. Checking the current file contents against the request: ${satisfiedClaim.summary}${remedy ? ` ${remedy}` : ""}\n\nDo not claim this is already done. Read the current file, find the exact content the request refers to, and make a real edit now.`,
              }],
            });
            continue;
          }

          alreadySatisfied = true;
          const evidence = satisfiedClaim.status === "satisfied"
            ? `${noOpPath || "The target file"} already contains the requested content, confirmed against the request: ${satisfiedClaim.summary}`
            : `${noOpPath || "The target file"} already contains the exact requested content; the verified write was a no-op.`;
          for (const item of checklist) {
            item.status = "completed";
            item.evidence = evidence;
          }
          await emit("summary", "completed", "Request already satisfied", {
            details: { reason: evidence, alreadySatisfied: true, verifiedAgainstRequest: satisfiedClaim.status === "satisfied", paidWrapUpCalls: 0 },
          });
          return finalize("passed", undefined, turn);
        }
        if (input.initialProjectEvidence) {
          // A coordinated existing-project edit can span several files. On a retry, the first
          // proposed mutation may correctly be a no-op because that part already landed in the
          // prior bounded run. That is evidence to continue verifying the complete requirement
          // set, not evidence that the executor is stuck. Do not auto-complete the checklist here:
          // every item still needs explicit evidence plus the project's deterministic checks.
          (toolResult as Record<string, unknown>).continuation =
            "This proposed edit is already present. Verify every checklist requirement against the supplied project evidence, run the required checks, and report completion only when the entire request is satisfied.";
          await emit("inspection", "completed", "This part of the requested change is already present; verifying the complete request", {
            internal: true,
            details: { path: String(args.path ?? ""), noOp: true, verificationRequired: true },
          });
        } else {
          const reason = "The first edit pass returned the existing file content unchanged, so Foundry stopped before spending more calls on the same no-progress action.";
          await emit("planning", "warning", "No source change was applied", {
            internal: true,
            details: { reason, noProgress: true, escalate: true },
          });
          return finalize("failed", reason, turn);
        }
      }
      if (call.name === "delete_file") {
        const deleteResult = toolResult as { skipped?: string; reason?: string; category?: string };
        if (deleteResult.skipped === "permission-required") {
          const deletePath = typeof args.path === "string" ? args.path : "";
          const reason = deleteResult.reason ?? "This delete needs your approval before Foundry can continue.";
          await emit("blocked", "warning", `Permission needed: delete ${deletePath}`, {
            command: `delete ${deletePath}`,
            details: { reason, category: deleteResult.category ?? "unrecognized", approvalActionKind: "delete", approvalTarget: deletePath },
          });
          return finalize("awaiting-approval", `Waiting for your approval to delete: ${deletePath}`, turn, {
            kind: "delete",
            target: deletePath,
            category: deleteResult.category ?? "unrecognized",
          });
        }
      }
      if (call.name === "run_command") {
        const commandResult = toolResult as { exitCode?: number | null; skipped?: string; reason?: string; category?: string };
        if (commandResult.skipped === "permission-required") {
          const command = typeof args.command === "string" ? args.command : "";
          const reason = commandResult.reason ?? "This command needs your approval before Foundry can continue.";
          await emit("blocked", "warning", `Permission needed: ${command}`, {
            command,
            details: { reason, category: commandResult.category ?? "unrecognized" },
          });
          return finalize("awaiting-approval", `Waiting for your approval to run: ${command}`, turn, {
            kind: "command",
            target: command,
            category: commandResult.category ?? "unrecognized",
          });
        }
        if (!commandResult.skipped && typeof commandResult.exitCode === "number") {
          if (commandResult.exitCode !== 0) {
            hadUnresolvedToolFailure = true;
          } else if (hadUnresolvedToolFailure) {
            hadUnresolvedToolFailure = false;
            await emit("command", "completed", "Recovered — the alternate approach completed successfully");
          }
        }
      }
      toolResultParts.push({ type: "tool_result", toolUseId: callId, content: compactToolResultForContext(call.name, toolResult) });
    }
    if (toolResultParts.length) conversation.push({ role: "user", content: toolResultParts });

    // The model's job for a dependency-free static project ends when the coordinated source set is
    // durably written. Foundry owns the next step: start its dedicated server and exercise the result
    // in Chromium. Requiring more model turns merely to narrate/read back those same files inflated a
    // four-file utility into the costly multi-minute loop this path is specifically meant to avoid.
    if (input.staticProject && (input.newProject || input.staticRewrite || (input.initialProjectEvidence && input.requireFirstMutation)) && hasCompleteStaticProject(changedFiles, hasSelfContainedStaticEntry) && !hadUnresolvedToolFailure) {
      checklist.forEach((item) => {
        if (item.status === "pending" || item.status === "running") {
          item.status = "completed";
          item.evidence = `The complete static source set was written and read back from disk (${Array.from(changedFiles).join(", ")}); deterministic browser verification follows in the runtime gate.`;
        }
      });
      const writtenFiles = Array.from(changedFiles);
      const fileSummary = writtenFiles.length <= 3
        ? writtenFiles.join(", ")
        : `${writtenFiles.slice(0, 3).join(", ")} and ${writtenFiles.length - 3} more`;
      await emit("reasoning", "completed", `The source is written${fileSummary ? ` (${fileSummary})` : ""}. I’m opening it in a real browser now to verify the rendered result.`);
      return finalize("passed", undefined, turn);
    }
  }

  const ranOutOfTurnsButActuallyDone = verifyCompletion(
    checklist,
    changedFiles,
    narrativeObjects,
    Boolean(input.fastLane),
    hadUnresolvedToolFailure,
    commands,
    input.hasBuildTooling ?? true,
    input.verificationProfile,
    { uiOutcomeRequested, presentationChangeRequired, browserValidationRequested, successfulBrowserValidationPasses, requiredBrowserValidationPasses },
  );
  if (ranOutOfTurnsButActuallyDone.ok) {
    const completionSummary = buildCompletionHandoff("", changedFiles, commands, timeline, narrativeObjects, checklist);
    await emit("summary", "completed", "Implementation complete", { output: completionSummary, details: { summary: completionSummary } });
    return finalize("passed", undefined, maxTurns);
  }

  // The completion gate already has the concrete failed invariant. Prefer that deterministic evidence
  // over another model call that can contradict the status (e.g. "fully implemented" while items are
  // still incomplete), adds latency, and produces a confusing pseudo-summary.
  const tookTooLongReason = ranOutOfTurnsButActuallyDone.reason;
  if (input.continuableBatch) {
    await emit("planning", "completed", "Execution batch complete", { details: { reason: tookTooLongReason, continuation: true } });
  } else if (input.fastLane && input.requireFirstMutation) {
    await emit("reasoning", "warning", "Repair pass returned without a verified mutation; the runtime will change strategy using the preserved diagnostic", { details: { reason: exactFailureReason(tookTooLongReason, commands), recoverable: true, terminal: false } });
  } else {
    await emit("summary", "error", "Mission blocked", { details: { reason: exactFailureReason(tookTooLongReason, commands) } });
  }
  return finalize("failed", tookTooLongReason, maxTurns);

}

function compactToolResultForContext(toolName: string, result: unknown) {
  const redactedResult = redactSensitiveData(result);
  const value: Record<string, unknown> = redactedResult && typeof redactedResult === "object" ? { ...(redactedResult as Record<string, unknown>) } : { result: redactedResult };
  if (toolName === "run_command") {
    value.stdout = summarizeExecutionOutput(String(value.stdout ?? ""));
    value.stderr = summarizeExecutionOutput(String(value.stderr ?? ""));
    value.output_compacted = true;
  }
  if (toolName === "read_file" && typeof value.content === "string" && value.content.length > 18_000) {
    value.content_hash = stableContextHash(value.content);
    value.content = `${value.content.slice(0, 8_000)}\n[unchanged middle compacted]\n${value.content.slice(-4_000)}`;
    value.content_compacted = true;
  }
  return JSON.stringify(value);
}

function summarizeExecutionOutput(output: string) {
  if (output.length <= 6_000) return output;
  const lines = output.split(/\r?\n/);
  const important = lines.filter((line) => /error|fail|exception|warn|assert|expected|actual|passed|success|summary/i.test(line)).slice(0, 80);
  return [...important, "[full output retained in mission timeline]", ...lines.slice(-12)].join("\n").slice(0, 8_000);
}

function stableContextHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Renders the structured parent-mission record into plain text for the prompt. Kept as real structured fields end-to-end (never a pre-flattened string) so this is the only place formatting choices are made, and so a future caller could use the fields directly instead of parsing prose back out of them. */
function formatParentContext(context: MissionParentContext): string {
  const lines: string[] = [`Previous mission: "${context.summary || context.id}" (${context.state})`];
  const openItems = context.plan.filter((item) => item.status !== "completed" && item.status !== "skipped");
  const doneItems = context.plan.filter((item) => item.status === "completed" || item.status === "skipped");
  if (doneItems.length) lines.push(`Already done: ${doneItems.map((item) => item.label).join("; ")}`);
  if (openItems.length) lines.push(`Still open: ${openItems.map((item) => item.label).join("; ")}`);
  if (context.files_touched.length) {
    lines.push(`Files changed: ${context.files_touched.map((file) => `${file.status ?? "changed"} ${file.path}${file.diffSummary ? ` (${file.diffSummary})` : ""}`).join("; ")}`);
  }
  if (context.commands_run.length) {
    lines.push(`Commands run: ${context.commands_run.map((command) => `${command.command} (exit ${command.exitCode ?? "-"})`).join("; ")}`);
  }
  if (context.decisions.length) lines.push(`Decisions made: ${context.decisions.join("; ")}`);
  if (context.findings.length) lines.push(`Findings: ${context.findings.join("; ")}`);
  if (context.blocked_reason) lines.push(`Blocked on: ${context.blocked_reason}`);
  lines.push("This is real prior state — trust it and don't re-investigate what it already covers unless something looks inconsistent with the current request.");
  return lines.join("\n");
}

function specificCheckInForCalls(functionCalls: ManagedToolCall[]) {
  const runCommand = functionCalls.find((call) => call.name === "run_command");
  if (runCommand) {
    const args = safeJsonParse(runCommand.arguments ?? "{}") ?? {};
    const command = typeof args.command === "string" ? args.command : "";
    if (/\b(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:i|install|add)\b/i.test(command)) {
      return "Checking the project dependency evidence before deciding whether an install approval is needed.";
    }
    return command ? `Running ${command} to verify the current behavior.` : "Running the next verification command.";
  }

  const writeCall = functionCalls.find((call) => call.name === "write_file" || call.name === "write_files");
  if (writeCall) {
    const args = safeJsonParse(writeCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Updating ${pathArg} and then reading it back from disk.` : "Applying the next file change and verifying it on disk.";
  }

  const replaceCall = functionCalls.find((call) => call.name === "replace_in_file");
  if (replaceCall) {
    const args = safeJsonParse(replaceCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Applying a targeted repair to ${pathArg} and verifying it on disk.` : "Applying the targeted source repair and verifying it on disk.";
  }

  const deleteCall = functionCalls.find((call) => call.name === "delete_file");
  if (deleteCall) {
    const args = safeJsonParse(deleteCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Deleting ${pathArg}.` : "Deleting the file identified as no longer needed.";
  }

  const readCall = functionCalls.find((call) => call.name === "read_file");
  if (readCall) {
    const args = safeJsonParse(readCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Opening ${pathArg} to inspect the relevant code.` : "Opening the next file to inspect the relevant code.";
  }

  const searchCall = functionCalls.find((call) => call.name === "search_files");
  if (searchCall) {
    const args = safeJsonParse(searchCall.arguments ?? "{}") ?? {};
    const query = typeof args.query === "string" ? args.query : "";
    return query ? `Searching for "${query}" to locate the right implementation path.` : "Searching the project to locate the right implementation path.";
  }

  const listCall = functionCalls.find((call) => call.name === "list_dir");
  if (listCall) {
    const args = safeJsonParse(listCall.arguments ?? "{}") ?? {};
    const pathArg = typeof args.path === "string" ? args.path : "";
    return pathArg ? `Scanning ${pathArg} to understand the project structure.` : "Scanning the project structure before changing files.";
  }

  return "Checking the next piece of project evidence before changing files.";
}

function applyChecklistUpdate(checklist: FactoryObjectiveChecklistItem[], args: Record<string, unknown>) {
  const item = checklist.find((entry) => entry.id === args.id);
  if (!item) return;
  const status = args.status;
  if (status === "running" || status === "completed" || status === "blocked" || status === "skipped") item.status = status;
  if (typeof args.evidence === "string") item.evidence = args.evidence;
}

/** Files whose extension means "this is interactive UI markup, not pure logic" — buttons, forms, nav,
 * event handlers live here. Used to decide whether report_complete needs real behavioral evidence on
 * top of the build/lint/typecheck check already required elsewhere, not just a styling read-back. */
function dependencyAdditions(beforeText: string, afterText: string) {
  try {
    const before = JSON.parse(beforeText) as Record<string, unknown>;
    const after = JSON.parse(afterText) as Record<string, unknown>;
    const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    const existing = new Set(sections.flatMap((section) => Object.keys((before[section] as Record<string, unknown> | undefined) ?? {})));
    return Array.from(new Set(sections.flatMap((section) => Object.keys((after[section] as Record<string, unknown> | undefined) ?? {})).filter((name) => !existing.has(name))));
  } catch {
    return [];
  }
}

const interactiveUiExtensions = /\.(tsx|jsx|vue|svelte|html)$/i;
const presentationLayerExtensions = /\.(tsx|jsx|vue|svelte|html|css|scss|sass|less)$/i;
const browserUiAssetExtensions = /\.(?:[cm]?[jt]sx?|vue|svelte|html|css|scss|sass|less)$/i;

function changedInteractiveUiFiles(changedFiles: Set<string>, uiOutcomeRequested = false): string[] {
  return Array.from(changedFiles).filter((path) =>
    interactiveUiExtensions.test(path) || (uiOutcomeRequested && browserUiAssetExtensions.test(path)),
  );
}

type CompletionEvidencePolicy = {
  uiOutcomeRequested: boolean;
  presentationChangeRequired: boolean;
  browserValidationRequested: boolean;
  successfulBrowserValidationPasses: number;
  requiredBrowserValidationPasses: number;
};

/** Whether the mission ran something that could actually exercise runtime behavior (build/dev server/
 * test), as opposed to only reading a file back — a read-back proves the edit landed, not that it runs. */
function hasRuntimeVerificationCommand(commands: MissionExecutorResult["commands"]): boolean {
  return commands.some((command) => command.exitCode === 0 && /\b(build|dev|start|test|serve)\b/i.test(command.command));
}

/** Matches narrative text that actually addresses interactive/runtime behavior, not just styling —
 * e.g. "confirmed the nav links still route correctly" vs. "moved the nav and updated the colors". */
const interactionVerificationPattern = /\b(buttons?|forms?|submit\w*|clicks?|clicked|navigat\w*|links?|interactions?|wired|wiring|handlers?|renders?|rendering|rendered|runtime errors?|console errors?|no (new )?errors?|still works?|still functions?|behavior (is |was )?(unchanged|preserved|intact))\b/i;

function hasInteractionVerificationNarrative(narrativeObjects: FactoryNarrativeObject[]): boolean {
  return narrativeObjects.some((item) => interactionVerificationPattern.test(item.rationale ?? ""));
}

function verifyCompletion(
  checklist: FactoryObjectiveChecklistItem[],
  changedFiles: Set<string>,
  narrativeObjects: FactoryNarrativeObject[],
  _fastLane = false,
  hasUnresolvedFailure = false,
  commands: MissionExecutorResult["commands"] = [],
  hasBuildTooling = true,
  verificationProfile?: VerificationProfile,
  policy: CompletionEvidencePolicy = {
    uiOutcomeRequested: false,
    presentationChangeRequired: false,
    browserValidationRequested: false,
    successfulBrowserValidationPasses: 0,
    requiredBrowserValidationPasses: 0,
  },
): { ok: true } | { ok: false; reason: string } {
  void _fastLane; // Fast execution changes cost/turn limits, never the evidence required to say "done".
  // Section 19: never let a mission complete while its most recent command or write failure was never
  // followed by a fix or a successful retry — completion must never silently paper over a real failure.
  if (hasUnresolvedFailure) {
    return { ok: false, reason: "A command or file write failed and was never followed by a fix or a successful retry." };
  }
  if (policy.browserValidationRequested && policy.successfulBrowserValidationPasses < policy.requiredBrowserValidationPasses) {
    return {
      ok: false,
      reason: `The requested UI outcome is not complete until real browser verification passes (${policy.successfulBrowserValidationPasses}/${policy.requiredBrowserValidationPasses} required viewport checks passed).`,
    };
  }
  const incomplete = checklist.filter((item) => item.status !== "completed" && item.status !== "skipped");
  if (incomplete.length) {
    return { ok: false, reason: `Checklist item(s) not completed: ${incomplete.map((item) => item.label).join("; ")}` };
  }
  const withoutEvidence = checklist.filter((item) => !item.evidence?.trim());
  if (withoutEvidence.length) {
    return { ok: false, reason: `Checklist item(s) marked completed without evidence: ${withoutEvidence.map((item) => item.label).join("; ")}` };
  }
  const genericEvidence = checklist.filter((item) =>
    item.status === "completed"
    && /^(?:done|complete(?:d)?|implemented|verified|completed and verified before the mission finished)[.!]?$/i.test(item.evidence?.trim() ?? ""),
  );
  if (genericEvidence.length) {
    return { ok: false, reason: `Checklist evidence is too generic to prove completion: ${genericEvidence.map((item) => item.label).join("; ")}` };
  }
  const runtimeRelevantChanges = changedFiles.size === 0 || Array.from(changedFiles).some((path) => !/\.(?:md|mdx|txt|rst)$/i.test(path));
  const missingRequiredChecks = runtimeRelevantChanges ? verificationProfile?.commands
    .filter((check) => check.required)
    .filter((check) => !commands.some((executed) => sameVerificationCommand(executed.command, check.command) && executed.exitCode === 0)) ?? [] : [];
  if (missingRequiredChecks.length) {
    return {
      ok: false,
      reason: `Required project verification did not pass: ${missingRequiredChecks.map((check) => `${check.stage} (${check.command})`).join("; ")}.`,
    };
  }
  // This guard catches a specific hallucination: an EDIT mission that marks every checklist item "done"
  // but never actually wrote anything to disk. It must NOT fire for legitimately write-free missions —
  // "run the build and report", "run the tests", diagnose/inspect — whose real deliverable is a command
  // that ran, not a file. A successfully-executed command is real, verifiable, on-the-record work, so it
  // satisfies the "did something real" bar just as a write does. (An honestly-skipped item likewise means
  // the mission already admitted some work didn't happen, e.g. a denied command, so demanding a write on
  // top would penalize honesty.) Only when NOTHING landed — no write, no successful command, nothing
  // skipped — is an all-"completed" checklist the hallucination shape this guard exists to reject.
  const hasSkippedItem = checklist.some((item) => item.status === "skipped");
  const ranSuccessfulCommand = commands.some((command) => command.exitCode === 0);
  if (checklist.length && changedFiles.size === 0 && !hasSkippedItem && !ranSuccessfulCommand) {
    return { ok: false, reason: "The mission reported completion, but produced no verifiable evidence — no file write on disk and no command that ran successfully." };
  }
  const hasFinding = narrativeObjects.some((item) => item.tier === "finding");
  if (policy.presentationChangeRequired && !Array.from(changedFiles).some((path) => presentationLayerExtensions.test(path))) {
    return {
      ok: false,
      reason: "The request calls for a broad visual/UX improvement, but no rendered presentation-layer file (component, markup, or stylesheet) changed. A logic-only edit cannot satisfy that outcome.",
    };
  }
  const hasDecision = narrativeObjects.some((item) => item.tier === "decision");
  if (!hasFinding || !hasDecision) {
    return { ok: false, reason: "The mission cannot complete until it records structured finding and decision objects for the narrative layer." };
  }
  // A change to interactive UI markup is not verified by styling alone: require evidence the app was
  // actually run (build/dev/test), and a narrative object that speaks to interactive behavior — not just
  // "the file reads back correctly." Skip this for fastLane (already handled above) and for missions that
  // only skipped items (already flagged honestly by the checks above).
  const touchedUi = changedInteractiveUiFiles(changedFiles, policy.uiOutcomeRequested);
  if (touchedUi.length && !hasSkippedItem) {
    // The build/dev/test-run requirement only applies to projects that actually HAVE such a step. A
    // pure static HTML/CSS/JS site has no build/test, and a static preview server never exits 0 — so
    // demanding a runtime command there is unsatisfiable and falsely blocks a fully-built site. For
    // those, reading the handler wiring (the interaction-verification narrative below) is the honest
    // ceiling, and Foundry's own preview server is the real runtime check once the mission passes.
    if (hasBuildTooling && !hasRuntimeVerificationCommand(commands)) {
      return {
        ok: false,
        reason: `Interactive UI file(s) changed (${touchedUi.join(", ")}) but no build/dev/test run verified the app still runs. A styling change is not enough evidence — actually run it.`,
      };
    }
    if (!hasInteractionVerificationNarrative(narrativeObjects)) {
      return {
        ok: false,
        reason: `Interactive UI file(s) changed (${touchedUi.join(", ")}) but no finding/decision confirms the actual interactive behavior (buttons, forms, navigation) still works — only that it runs or looks right. Record a finding or decision that says so, based on real evidence (reading the handler, checking the console/build output), not an assumption.`,
      };
    }
  }
  return { ok: true };
}

function workflowInstruction(strategy: ExecutionStrategy) {
  if (strategy.workflow === "bounded-artifact") return "Keep planning compact, generate independent artifacts together when possible, and repair only the artifact whose verification failed.";
  if (strategy.workflow === "focused-edit") return "Inspect only the affected path, make the smallest correct change, and run the narrowest relevant verification.";
  if (strategy.workflow === "staged-migration") return "Work sequentially through compatibility checkpoints and preserve the old path until its replacement is verified.";
  if (strategy.workflow === "autonomous-mission") return "Maintain the durable plan, parallelize only genuinely independent work, and verify after each meaningful phase.";
  return "Answer directly without mutating the project.";
}

function staticProjectProgressForFile(filePath: string, changedFileCount: number) {
  const name = filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (/\.html?$/.test(name)) return "The real page structure is in place. I’m connecting its visual design and interactions now.";
  if (/\.(css|scss|sass)$/.test(name)) return "The responsive interface is taking shape. I’m wiring the behavior and checking the complete experience next.";
  if (/\.(?:js|mjs|cjs|ts)$/.test(name)) return "The interaction layer is in place. I’m checking the finished project in a real browser before handing it over.";
  if (changedFileCount === 1) return `${name || "The first project file"} is in place. I’m continuing with the connected pieces now.`;
  return "Another coordinated project piece is in place. I’m continuing with the remaining implementation.";
}

function hasCompleteStaticArtifactSet(changedFiles: Set<string>) {
  const paths = Array.from(changedFiles, (file) => file.toLowerCase());
  return paths.some((file) => /\.html?$/.test(file))
    && paths.some((file) => /\.(?:css|scss|sass)$/.test(file))
    && paths.some((file) => /\.(?:js|mjs|cjs|ts)$/.test(file));
}

/**
 * True when a proposed generated file is a placeholder/stub rather than real product source — used to
 * reject it before disk write. This must NOT catch legitimate real content, or a whole build produces
 * zero files. The bug it fixes: a bare `\bplaceholder\b` matched the HTML `placeholder="…"` attribute,
 * so a real portfolio's contact form (`<input placeholder="Your email">`) was rejected as
 * "placeholder-only" twice and the mission failed with nothing written.
 */
/**
 * A browser serves an `.html` file literally. When a mission picks a Markdown/Astro-flavored stack but
 * the file is served as raw static HTML, the model prepends YAML/TOML frontmatter (`---\ntitle: …\n---`)
 * that renders as visible garbage and fails the browser gate on every attempt. That is not valid HTML
 * content, so strip a leading frontmatter block from HTML entry files before writing. Conservative: only
 * acts when a real HTML document (`<!doctype`/`<html`/`<…>`) follows the block, so legitimate files are
 * never mangled. Exported for testing.
 */
export function htmlEntryWithoutFrontmatter(rawPath: string, content: string): string {
  if (!/\.html?$/i.test(rawPath.replace(/\\/g, "/"))) return content;
  const match = content.match(/^﻿?\s*(---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n\1[ \t]*\r?\n?/);
  if (!match) return content;
  const remainder = content.slice(match[0].length);
  return /^\s*<(?:!doctype\b|!--|html\b|[a-z])/i.test(remainder) ? remainder.replace(/^\s*\n/, "") : content;
}

export function proposedFileIsPlaceholderOnly(rawPath: string, rawContent: string): boolean {
  const candidatePath = rawPath.replace(/\\/g, "/");
  const content = rawContent.trim();
  if (!candidatePath || !content) return false;

  // Foundry-internal stub/handoff phrases — these are never legitimate customer content.
  if (/\b(?:touch to satisfy tool-call requirement|no-op anchor|satisfy (?:the )?tool contract|not referenced by (?:the )?application runtime|operation-only mission|initialization artifact|continuation batch|coordinated source write|stable state wiring|companion initialization|batch\d+)\b/i.test(content)) return true;

  // "Coming soon", "under construction", placeholder prose, and lone TODO/FIXME stubs are placeholder
  // signals — but ONLY when they dominate a small file. A substantial real page (a portfolio is
  // thousands of chars of real markup) that merely *mentions* "coming soon" in one section, or uses the
  // HTML placeholder attribute in a form, is real product. Gate the prose signals on small content.
  const withoutTags = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const looksSubstantial = content.length >= 1_200 || withoutTags.length >= 400;
  if (!looksSubstantial) {
    if (/\b(?:build in progress|coming soon|under construction|starting coordinated)\b|\/\/\s*(?:TODO|FIXME)\b/i.test(content)) return true;
    // Placeholder as PROSE ("this is a placeholder", "placeholder content"), never the HTML
    // placeholder="…" attribute, CSS ::placeholder, or an object key `placeholder:`.
    const placeholderAt = content.toLowerCase().indexOf("placeholder");
    if (placeholderAt >= 0) {
      const before = content[placeholderAt - 1] ?? "";
      const after = content.slice(placeholderAt + "placeholder".length);
      const attachedToIdentifier = /[a-z0-9_:-]/i.test(before) || /^[a-z0-9_:-]/i.test(after);
      const usedAsAttributeOrKey = /^\s*[=:]/.test(after);
      if (!attachedToIdentifier && !usedAsAttributeOrKey) return true;
    }
  }

  // A tiny non-web source file that declares a type/const but no real behavior is a stub regardless.
  return /\.(?:kt|java|swift|ts|tsx|js|jsx)$/i.test(candidatePath)
    && content.length < 300
    && /\b(?:object|class)\s+\w+[\s\S]*\bconst\s+val\b/i.test(content)
    && !/\bfun\s+\w+\s*\(|\b(?:Activity|ViewModel|Composable)\b/.test(content);
}

function isCompleteSelfContainedStaticEntry(filePath: string, content: string) {
  return /\.html?$/i.test(filePath)
    && content.length >= 2_500
    && /<style(?:\s|>)/i.test(content)
    && /<script(?:\s|>)/i.test(content)
    && /<\/script\s*>/i.test(content)
    && /<\/body\s*>/i.test(content)
    && /<\/html\s*>/i.test(content)
    && /<(?:button|input|select|textarea|form)(?:\s|>)/i.test(content);
}

function exactFailureReason(fallback: string, commands: Array<{ command: string; exitCode: number | null; stdout?: string; stderr?: string }>) {
  const failed = [...commands].reverse().find((command) => command.exitCode != null && command.exitCode !== 0);
  if (!failed) return fallback;
  const output = summarizeExecutionOutput(failed.stderr || failed.stdout || "").trim();
  return output ? `${failed.command} exited with code ${failed.exitCode}: ${output}` : `${failed.command} exited with code ${failed.exitCode}. ${fallback}`;
}

function extractCompleteStaticHtml(text: string) {
  const doctypeIndex = text.search(/<!doctype\s+html/i);
  const htmlIndex = text.search(/<html(?:\s|>)/i);
  const start = doctypeIndex >= 0 ? doctypeIndex : htmlIndex;
  const closing = text.toLowerCase().lastIndexOf("</html>");
  if (start < 0 || closing < start) return undefined;
  const content = text.slice(start, closing + "</html>".length).trim();
  return isCompleteSelfContainedStaticEntry("index.html", content) ? content : undefined;
}

function isIncompleteStaticHtmlEntry(filePath: string, content: string) {
  return /\.html?$/i.test(filePath)
    && (!/<\/body\s*>/i.test(content) || !/<\/html\s*>/i.test(content) || (/<script(?:\s|>)/i.test(content) && !/<\/script\s*>/i.test(content)));
}

function invalidStaticEntryWrite(filePath: string, content: string) {
  if (!/\.html?$/i.test(filePath)) return undefined;
  if (isIncompleteStaticHtmlEntry(filePath, content)) {
    return "The proposed HTML is truncated or structurally incomplete. It must include closing </body> and </html> tags, and every opened <script> must have a closing </script>, before Foundry will replace the file.";
  }
  const scriptError = inlineJavaScriptSyntaxError(content);
  return scriptError ? `The proposed HTML contains invalid inline JavaScript and was not written: ${scriptError}` : undefined;
}

function inlineJavaScriptSyntaxError(html: string) {
  const inlineScripts = Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script\s*>/gi));
  for (const match of inlineScripts) {
    const attributes = match[1] ?? "";
    if (/\bsrc\s*=|\btype\s*=\s*["'](?:application\/json|importmap|module)["']/i.test(attributes)) continue;
    try {
      new Script(match[2] ?? "");
    } catch (error) {
      return error instanceof Error ? error.message : "JavaScript syntax validation failed.";
    }
  }
  return undefined;
}

function hasCompleteStaticProject(changedFiles: Set<string>, hasSelfContainedStaticEntry: boolean) {
  return hasSelfContainedStaticEntry || hasCompleteStaticArtifactSet(changedFiles);
}

function sameVerificationCommand(executed: string, expected: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/\.cmd\b/g, "").replace(/\s+/g, " ").trim();
  return normalize(executed) === normalize(expected);
}

/** Builds real verification evidence from the exact same signals verifyCompletion() inspects — checklist evidence, files actually verified on disk, command/build results, and recorded findings/decisions. This is the one place verification is computed; the client must never re-derive it independently. */
function buildVerificationEntries(
  checklist: FactoryObjectiveChecklistItem[],
  changedFiles: Set<string>,
  commands: MissionExecutorResult["commands"],
  timeline: FactoryExecutionEvent[],
): ExecutionMissionVerification[] {
  const entries: ExecutionMissionVerification[] = [];

  for (const item of checklist) {
    if (item.status === "completed") {
      entries.push({ check_type: "checklist", result: "pass", evidence: item.evidence?.trim() || item.label });
    } else if (item.status === "skipped") {
      entries.push({ check_type: "checklist", result: "skipped", evidence: item.evidence?.trim() || `Skipped: ${item.label}` });
    } else if (item.status === "blocked") {
      entries.push({ check_type: "checklist", result: "fail", evidence: item.evidence?.trim() || `Blocked: ${item.label}` });
    }
  }

  for (const path of changedFiles) {
    entries.push({ check_type: "file-read", result: "pass", evidence: `${path} was written and read back from disk to confirm the change.` });
  }

  for (const command of commands) {
    const isTypecheckLike = /\b(typecheck|tsc)\b/i.test(command.command);
    const isLintLike = /\b(?:eslint|lint)\b/i.test(command.command);
    const isBuildLike = /\b(build|compile)\b/i.test(command.command);
    const isTestLike = /\btest\b/i.test(command.command);
    entries.push({
      check_type: isTypecheckLike ? "typecheck" : isLintLike ? "lint" : isBuildLike ? "build" : isTestLike ? "test" : "command",
      result: command.exitCode === 0 ? "pass" : "fail",
      evidence: `${command.command} exited with code ${command.exitCode ?? "unknown"}.`,
    });
  }

  for (const event of timeline.filter((item) => item.kind === "preview" && item.status !== "running")) {
    const url = typeof event.details?.url === "string" ? ` at ${event.details.url}` : "";
    entries.push({
      check_type: "preview",
      result: event.status === "completed" ? "pass" : "fail",
      evidence: `${event.title}${url}.`,
    });
  }

  return entries;
}

/** Same bypass semantics as run_command's approval check, generalized to non-command actions (file writes/deletes) keyed by a synthetic action string instead of a shell command. */
function isActionApproved(actionKey: string, category: string, preApprovedCommands: string[], approvedCategories: string[]): boolean {
  const exactApproved = preApprovedCommands.some((entry) => normalizeCommandText(entry) === normalizeCommandText(actionKey));
  const categoryApproved = approvedCategories.includes(category);
  return exactApproved || categoryApproved;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  access: ProjectAccess,
  emit: (kind: FactoryExecutionEventKind, status: FactoryExecutionEventStatus, title: string, extra?: Partial<FactoryExecutionEvent>) => Promise<void>,
  changedFiles: Set<string>,
  commands: MissionExecutorResult["commands"],
  narrativeObjects: FactoryNarrativeObject[],
  preApprovedCommands: string[] = [],
  approvedCategories: string[] = [],
  rationale = "",
  task = "",
  standingApprovedCommands: string[] = [],
  deniedActions: string[] = [],
): Promise<unknown> {
  const pathArg = typeof args.path === "string" ? args.path : "";
  const basename = pathArg.split("/").pop() || pathArg;

  switch (name) {
    case "list_dir": {
      await emit("inspection", "running", `Listing ${pathArg || "/"}`, { tier: "trace", filePath: pathArg || "/" });
      const entries = await access.listDir(pathArg);
      await emit("inspection", "completed", `Listed ${entries.length} entries in ${pathArg || "/"}`, {
        tier: "trace",
        filePath: pathArg || "/",
        details: { entries: entries.slice(0, 50).map((entry) => `${entry.kind === "directory" ? "[dir] " : ""}${entry.name}`) },
      });
      return { entries };
    }
    case "read_file": {
      const offsetBytes = typeof args.offset_bytes === "number" ? args.offset_bytes : 0;
      const limitBytes = typeof args.limit_bytes === "number" ? args.limit_bytes : 20_000;
      await emit("inspection", "running", `Reading ${basename}`, {
        tier: "trace",
        fileName: basename,
        filePath: pathArg,
        details: { offsetBytes, limitBytes },
      });
      const result = await access.readFile(pathArg, { offsetBytes, limitBytes });
      if (!result.exists) {
        await emit("inspection", "warning", `${pathArg} not found`, { tier: "trace", fileName: basename, filePath: pathArg });
      } else {
        const linesRead = countLines(result.content);
        await emit("inspection", "completed", `Read ${basename} (${result.totalBytes} bytes)`, {
          tier: "trace",
          fileName: basename,
          filePath: pathArg,
          details: {
            offsetBytes,
            limitBytes,
            totalBytes: result.totalBytes,
            truncated: result.truncated,
            lineRange: offsetBytes === 0 ? `Lines 1-${linesRead}` : `${linesRead} line(s) from byte ${offsetBytes}`,
          },
        });
      }
      // Keep environment-variable names available for diagnosis without ever returning their values
      // to the model. Deterministic runtime preflights can still check local configuration directly.
      return isSensitiveFilePath(pathArg) && result.exists
        ? { ...result, content: redactSensitiveText(result.content), sensitiveValuesRedacted: true }
        : result;
    }
    case "search_files": {
      const query = typeof args.query === "string" ? args.query : "";
      await emit("inspection", "running", `Searching for "${query}"`, { tier: "trace", details: { query } });
      const hits = access.searchFiles ? await access.searchFiles(query) : [];
      await emit("inspection", "completed", `Found ${hits.length} matches for "${query}"`, {
        tier: "trace",
        details: { query, matches: hits.slice(0, 20).map((hit) => `${hit.path}${hit.line ? `:${hit.line}` : ""}`) },
      });
      return { hits };
    }
    case "write_files": {
      const files = Array.isArray(args.files) ? args.files.slice(0, 24) : [];
      const normalized = files.map((item) => {
        const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return { path: typeof value.path === "string" ? value.path : "", content: typeof value.content === "string" ? value.content : "" };
      });
      if (!normalized.length) return { verified: false, reason: "files must contain at least one complete project file." };
      const invalid = normalized.find((file) => !file.path.trim() || /^[./\\]*$/.test(file.path.trim()) || isEmptySourceWrite(file.path, file.content));
      if (invalid) return { verified: false, reason: `Invalid or empty batch file: ${invalid.path || "(blank path)"}.` };
      const marker = normalized.find((file) => /(?:^|\/)(?:\.placeholder|[^/]*(?:touchpoint|status|progress|handoff|bootstrap|inspect|probe|noop|marker|fix[-_ ]?(?:placeholder|stub|temp))[^/]*)$|\.(?:tmp|log)$/i.test(file.path.replace(/\\/g, "/")));
      if (marker) return { verified: false, reason: `${marker.path} is an internal marker/progress artifact, not customer application source.` };
      for (const file of normalized.filter((item) => /^(?:package\.json|deno\.json)$/i.test(item.path.split("/").pop() ?? ""))) {
        const before = await access.readFile(file.path, { limitBytes: 200_000 });
        const additions = dependencyAdditions(before.exists ? before.content : "{}", file.content);
        const installCommand = additions.length ? `npm install ${additions.join(" ")}` : "";
        if (installCommand && !isActionApproved(installCommand, "dependencies", preApprovedCommands, approvedCategories)) {
          return { verified: false, skipped: "permission-required", reason: `Adding ${additions.join(", ")} changes the project dependency environment.`, category: "dependencies", requestedCommand: installCommand };
        }
      }
      const results: Array<{ path: string; result: unknown }> = [];
      for (const file of normalized) {
        const result = await executeTool("write_file", file, access, emit, changedFiles, commands, narrativeObjects, preApprovedCommands, approvedCategories, rationale, task, standingApprovedCommands, deniedActions);
        results.push({ path: file.path, result });
        if (isFailedWriteResult(result)) return { verified: false, reason: result.reason || `Batch write failed for ${file.path}.`, results };
      }
      await emit("summary", "completed", `Verified ${normalized.length} coordinated files`, { details: { files: normalized.map((file) => file.path) } });
      return { verified: true, written: normalized.length, results };
    }
    case "write_file": {
      const content = htmlEntryWithoutFrontmatter(pathArg, typeof args.content === "string" ? args.content : "");
      if (/^(?:\.checklist|checklist(?:\.[a-z0-9_-]+)?|progress(?:\.[a-z0-9_-]+)?|evidence(?:\.[a-z0-9_-]+)?|notes?\.txt)$/i.test(pathArg.replace(/\\/g, "/").split("/").pop() ?? "")) {
        const reason = `${basename} is an internal progress/evidence artifact, not application source. Create the actual requested project file instead.`;
        await emit("edit", "error", `Refused internal progress file: ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, details: { reason } });
        return { verified: false, contentChanged: false, reason };
      }
      if (deniedActions.some((entry) => normalizeCommandText(entry) === normalizeCommandText(`write ${pathArg}`))) {
        return { verified: false, skipped: "denied", reason: "The user denied this file write." };
      }
      if (!pathArg.trim() || /^[./\\]*$/.test(pathArg.trim())) {
        await emit("edit", "error", "Refused write with no file path", { tier: "trace", details: { reason: "path was empty or pointed at the project root." } });
        return {
          verified: false,
          reason: "path was empty, \".\", or otherwise pointed at the project root. You must pass a real relative file path, such as \"server.js\" or \"src/index.js\" — never an empty string, \".\", \"/\", or the project root.",
        };
      }
      if (isEmptySourceWrite(pathArg, content)) {
        const reason = `${basename} would be an empty placeholder. Write its complete meaningful content in this call instead.`;
        await emit("edit", "error", `Refused empty source file: ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, details: { reason } });
        return { verified: false, contentChanged: false, reason };
      }
      if (isSensitiveFilePath(pathArg) && !isActionApproved(`write ${pathArg}`, "environment-changes", preApprovedCommands, approvedCategories)) {
        const reason = `${basename} looks like an environment/secrets file. Writing to it needs your approval.`;
        return { verified: false, skipped: "permission-required", reason, category: "environment-changes" };
      }
      if (/^(?:package\.json|deno\.json)$/i.test(pathArg.replace(/\\/g, "/").split("/").pop() ?? "")) {
        const before = await access.readFile(pathArg, { limitBytes: 200_000 });
        const addedDependencies = dependencyAdditions(before.exists ? before.content : "{}", content);
        if (addedDependencies.length) {
          const installCommand = `npm install ${addedDependencies.join(" ")}`;
          if (!isActionApproved(installCommand, "dependencies", preApprovedCommands, approvedCategories)) {
            return { verified: false, skipped: "permission-required", reason: `Adding ${addedDependencies.join(", ")} changes the project dependency environment. Approval is required before the manifest or lockfile is changed.`, category: "dependencies", requestedCommand: installCommand };
          }
        }
      }
      const existedBeforeHint = await access.readFile(pathArg, { limitBytes: 1 });
      await emit(existedBeforeHint.exists ? "edit" : "file", "running", `${existedBeforeHint.exists ? "Editing" : "Creating"} ${basename}`, { tier: "trace" });
      const result = await access.writeFile(pathArg, content);
      if (result.verified) {
        if (!result.contentChanged) {
          await emit("inspection", "completed", `${basename} already matched the requested content`, {
            tier: "trace",
            fileName: basename,
            filePath: pathArg,
            details: { modifiedAt: result.modifiedAt, bytes: result.bytes, noOp: true },
          });
          return { verified: true, contentChanged: false, noOp: true, bytes: result.bytes };
        }
        changedFiles.add(pathArg);
        const delta = result.diff ? diffSummaryFromText(result.diff) : { added: 0, removed: 0 };
        const lineRange =
          result.firstChangedLine && result.lastChangedLine
            ? result.firstChangedLine === result.lastChangedLine
              ? `Line ${result.firstChangedLine}`
              : `Lines ${result.firstChangedLine}-${result.lastChangedLine}`
            : undefined;
        await emit(result.existedBefore ? "edit" : "file", "completed", writeEventTitle(pathArg, result.existedBefore, task, content, rationale, delta), {
          tier: "trace",
          fileName: basename,
          filePath: pathArg,
          output: result.diff,
          beforeContent: result.beforeContent,
          rationale: rationale.trim() || undefined,
          details: lineRange ? { lineRange } : undefined,
        });
        await emit("inspection", "completed", `Verified ${basename} on disk`, {
          tier: "trace",
          fileName: basename,
          filePath: pathArg,
          details: { modifiedAt: result.modifiedAt, bytes: result.bytes },
        });
      } else {
        await emit("edit", "error", `Verification failed for ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, details: { reason: result.reason } });
      }
      return { verified: result.verified, contentChanged: result.contentChanged, reason: result.reason, bytes: result.bytes };
    }
    case "replace_in_file": {
      const oldText = typeof args.old_text === "string" ? args.old_text : "";
      const newText = typeof args.new_text === "string" ? args.new_text : "";
      if (!pathArg.trim() || /^[./\\]*$/.test(pathArg.trim())) return { verified: false, reason: "A real relative file path is required." };
      if (!oldText) return { verified: false, reason: "old_text must be a non-empty exact source fragment." };
      if (isSensitiveFilePath(pathArg) || /^(?:package\.json|deno\.json)$/i.test(basename)) {
        return { verified: false, reason: "Targeted replacement is disabled for environment, secret, and dependency-manifest files. Use the approval-aware write path instead." };
      }
      const before = await access.readFile(pathArg, { limitBytes: 500_000 });
      if (!before.exists) return { verified: false, reason: `${basename} does not exist.` };
      if (before.truncated) return { verified: false, reason: `${basename} is too large for a verified exact replacement.` };
      const occurrences = before.content.split(oldText).length - 1;
      if (occurrences !== 1) {
        return { verified: false, reason: occurrences === 0 ? "old_text did not match the current file." : `old_text matched ${occurrences} locations; make the match more specific.` };
      }
      const content = before.content.replace(oldText, newText);
      await emit("edit", "running", `Editing ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg });
      const result = await access.writeFile(pathArg, content);
      if (!result.verified) {
        await emit("edit", "error", `Verification failed for ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, details: { reason: result.reason } });
        return { verified: false, reason: result.reason };
      }
      if (!result.contentChanged) {
        await emit("inspection", "completed", `${basename} already matched the requested content`, {
          tier: "trace",
          fileName: basename,
          filePath: pathArg,
          details: { modifiedAt: result.modifiedAt, bytes: result.bytes, noOp: true },
        });
        return { verified: true, contentChanged: false, noOp: true, bytes: result.bytes };
      }
      changedFiles.add(pathArg);
      const delta = result.diff ? diffSummaryFromText(result.diff) : { added: 0, removed: 0 };
      await emit("edit", "completed", `Updated ${basename} +${delta.added} -${delta.removed}`, {
        tier: "trace",
        fileName: basename,
        filePath: pathArg,
        output: result.diff,
        beforeContent: result.beforeContent,
        rationale: rationale.trim() || undefined,
        details: { exactReplacement: true },
      });
      await emit("inspection", "completed", `Verified ${basename} on disk`, { tier: "trace", fileName: basename, filePath: pathArg, details: { modifiedAt: result.modifiedAt, bytes: result.bytes } });
      return { verified: true, contentChanged: result.contentChanged, bytes: result.bytes };
    }
    case "delete_file": {
      if (deniedActions.some((entry) => normalizeCommandText(entry) === normalizeCommandText(`delete ${pathArg}`))) {
        return { verified: false, skipped: "denied", reason: "The user denied this deletion." };
      }
      if (!pathArg.trim() || /^[./\\]*$/.test(pathArg.trim())) {
        return { verified: false, reason: "path was empty, \".\", or otherwise pointed at the project root. Pass a real relative file path." };
      }
      if (!access.deleteFile) {
        await emit("edit", "skipped", `Delete unavailable: ${basename}`, { tier: "trace", filePath: pathArg });
        return { verified: false, skipped: "unsupported", reason: "Deleting files is not available in this connection mode." };
      }
      if (!isActionApproved(`delete ${pathArg}`, "deletes", preApprovedCommands, approvedCategories)) {
        const reason = `Deleting ${basename} needs your approval.`;
        return { verified: false, skipped: "permission-required", reason, category: "deletes" };
      }
      await emit("edit", "running", `Deleting ${basename}`, { tier: "trace", filePath: pathArg });
      const result = await access.deleteFile(pathArg);
      if (result.verified) {
        changedFiles.add(pathArg);
        await emit("edit", "completed", `Deleted ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, rationale: rationale.trim() || undefined });
      } else {
        await emit("edit", "error", `Delete failed for ${basename}`, { tier: "trace", fileName: basename, filePath: pathArg, details: { reason: result.reason } });
      }
      return { verified: result.verified, reason: result.reason };
    }
    case "run_command": {
      const command = normalizeCommandForExecution(typeof args.command === "string" ? args.command : "");
      args.command = command;
      if (deniedActions.some((entry) => commandPermissionIdentity(entry) === commandPermissionIdentity(command))) {
        return { exitCode: null, stdout: "", stderr: "The user denied this command.", skipped: "denied" };
      }
      const cwd = typeof args.cwd === "string" ? args.cwd : "";
      await emit("command", "running", `Running ${command}`, { tier: "trace", command, cwd });
      if (!access.runCommand) {
        await emit("command", "skipped", `Command unavailable: ${command}`, { tier: "trace", command, cwd });
        return { exitCode: null, stdout: "", stderr: "Commands are not available in this connection mode.", skipped: "unsupported" };
      }
      const result = await access.runCommand(command, cwd, { approvedCommands: preApprovedCommands, approvedCategories, standingApprovedCommands });
      if (!result.skipped) {
        commands.push({ command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, approvalScope: result.approvalScope });
      }
      const isBuildLike = /\b(build|tsc|compile)\b/i.test(command);
      if (result.skipped) {
        const needsPermission = result.skipped === "permission-required";
        if (result.skipped === "dependency-present") {
          await emit("command", "completed", `Verified dependencies for ${command}`, {
            tier: "trace",
            command,
            cwd,
            output: result.stdout || result.stderr,
            stdout: result.stdout,
            stderr: result.stderr,
            details: { reason: result.reason ?? "Dependency install skipped because packages were already available." },
          });
        } else if (needsPermission) {
          const permissionReason = result.reason || dependencyCommandReason(command) || result.stderr || result.skipped;
          const narrative = makeNarrativeObject(
            "flag",
            {
              id: `permission-${Date.now()}`,
              rationale: `Permission is needed before running ${command}.`,
              evidence: [permissionReason ?? command].filter(Boolean),
              flag_type: "permission",
            },
            "uncertainty",
          );
          narrativeObjects.push(narrative);
        } else {
          await emit("command", "skipped", `Command skipped: ${command}`, {
            tier: "trace",
            command,
            cwd,
            output: result.stderr,
            details: { reason: result.reason ?? result.skipped },
          });
        }
      } else if (result.exitCode === 0) {
        await emit("command", "completed", `Ran ${command}`, { tier: "trace", command, cwd, exitCode: result.exitCode, durationMs: result.durationMs, output: result.stdout || result.stderr, stdout: result.stdout, stderr: result.stderr, details: { shellUsed: result.shellUsed, shellFallbackFrom: result.shellFallbackFrom, approvalScopeLabel: approvalScopeLabel(result.approvalScope) } });
        if (isBuildLike) await emit("build", "completed", "Build passed", { tier: "trace", command, cwd, stdout: result.stdout, stderr: result.stderr });
      } else {
        await emit("command", "error", `Command failed: ${command}`, { tier: "trace", command, cwd, exitCode: result.exitCode, durationMs: result.durationMs, output: result.stderr || result.stdout, stdout: result.stdout, stderr: result.stderr, details: { shellUsed: result.shellUsed, shellFallbackFrom: result.shellFallbackFrom, approvalScopeLabel: approvalScopeLabel(result.approvalScope) } });
        if (isBuildLike) await emit("build", "error", "Build failed", { tier: "trace", command, cwd, stdout: result.stdout, stderr: result.stderr });
      }
      return result;
    }
    case "validate_browser": {
      if (!access.validateBrowser) return { available: false, verified: false, reason: "Real browser validation is not available in this connection mode." };
      const authorizedUrl = task.match(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/[^\s]*)?/i)?.[0];
      if (!authorizedUrl) {
        return { available: false, verified: false, reason: "Foundry has not supplied an owned browser URL to this model call. Preview startup and browser verification remain runtime-owned." };
      }
      // The request's explicit URL is authoritative. Ignore a model-supplied substitute so a guessed
      // default port can never validate a different application that happens to be running locally.
      const url = authorizedUrl;
      await emit("preview", "running", `Validating ${url} in a real browser`, { tier: "trace", details: { url } });
      const result = await access.validateBrowser({
        url,
        actions: Array.isArray(args.actions) ? args.actions as Array<{ action: string; selector?: string; value?: string; text?: string; key?: string; ms?: number; exact?: boolean; expected?: number }> : [],
        viewport: { width: Number(args.viewport_width || 1440), height: Number(args.viewport_height || 900) },
        screenshotName: typeof args.screenshot_name === "string" ? args.screenshot_name : undefined,
        baselineScreenshot: typeof args.baseline_screenshot === "string" && args.baseline_screenshot ? args.baseline_screenshot : undefined,
      });
      const failures = [...(result.consoleErrors ?? []), ...(result.failedRequests ?? []).map((item) => `${item.method} ${item.url}: ${item.error}`)];
      await emit("preview", result.verified ? "completed" : "error", result.verified ? "Requested browser step passed" : "Requested browser step found failures", {
        tier: "trace",
        details: { url: result.url || url, title: result.title, screenshotPath: result.screenshotPath, stepsJson: result.steps ? JSON.stringify(result.steps) : undefined, visualComparisonJson: result.visualComparison ? JSON.stringify(result.visualComparison) : undefined, failures },
      });
      return result;
    }
    case "validate_mobile": {
      const platform = args.platform === "ios" ? "ios" : "android";
      if (!access.validatePlatform) return { available: false, verified: false, reason: `${platform} validation is not available in this connection mode.` };
      await emit("inspection", "running", `Validating the ${platform === "ios" ? "iOS" : "Android"} application on a real local target`, { tier: "trace" });
      const result = await access.validatePlatform(platform, {
        action: String(args.action || "devices"), component: String(args.component || ""), bundleId: String(args.bundle_id || ""), device: String(args.device || ""), lines: Number(args.lines || 300), screenshotName: String(args.screenshot_name || ""), apkPath: String(args.apk_path || ""), x: Number(args.x || 0), y: Number(args.y || 0), text: String(args.text || ""), key: String(args.key || ""),
      });
      const passed = result.available && result.exitCode !== null && result.exitCode !== undefined ? result.exitCode === 0 : Boolean(result.verified);
      await emit("inspection", passed ? "completed" : result.available ? "error" : "skipped", passed ? `${platform === "ios" ? "iOS" : "Android"} validation passed` : result.reason || `${platform} validation did not pass`, { tier: "trace", output: result.stderr || result.stdout, details: { resultJson: JSON.stringify(result) } });
      return result;
    }
    case "validate_desktop": {
      if (!access.validateDesktop) return { available: false, verified: false, reason: "Desktop validation is not available in this connection mode." };
      const executable = String(args.executable || "");
      await emit("inspection", "running", `Launching ${executable} for desktop validation`, { tier: "trace", filePath: executable });
      const actions = Array.isArray(args.actions) ? args.actions.map((action) => {
        const item = action && typeof action === "object" ? action as Record<string, unknown> : {};
        return { action: "click", name: String(item.name || ""), automationId: String(item.automation_id || "") };
      }) : [];
      const result = await access.validateDesktop({ executable, args: Array.isArray(args.args) ? args.args.map(String) : [], observeMs: Number(args.observe_ms || 2000), actions });
      await emit("inspection", result.verified ? "completed" : "error", result.verified ? (result.interactionVerified ? "Desktop interaction passed" : "Desktop application launched successfully") : "Desktop application validation failed", { tier: "trace", filePath: executable, details: { resultJson: JSON.stringify(result), stepsJson: JSON.stringify(result.steps ?? []), windowTitles: result.windowTitles ?? [] } });
      return result;
    }
    case "record_finding": {
      const narrative = makeNarrativeObject("finding", args, "project-understanding");
      narrativeObjects.push(narrative);
      await emit("reasoning", "completed", narrative.rationale, { tier: "finding", filePath: narrative.filePath, rationale: narrative.rationale, narrative, details: narrative.details });
      return { recorded: true, narrative };
    }
    case "record_decision": {
      const narrative = makeNarrativeObject("decision", args, "confidence-map");
      narrativeObjects.push(narrative);
      await emit("reasoning", "completed", narrative.rationale, { tier: "decision", rationale: narrative.rationale, narrative, details: narrative.details });
      return { recorded: true, narrative };
    }
    case "record_flag": {
      const narrative = makeNarrativeObject("flag", args, String(args.flag_type ?? "").toLowerCase().includes("conflict") ? "conflict" : "uncertainty");
      narrativeObjects.push(narrative);
      await emit("reasoning", "warning", narrative.rationale, { tier: "flag", rationale: narrative.rationale, narrative, details: narrative.details });
      return { recorded: true, narrative };
    }
    case "mark_checklist_item":
      return { acknowledged: true };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function writeEventTitle(
  filePath: string,
  existedBefore: boolean,
  task: string,
  content: string,
  rationale: string,
  delta: { added: number; removed: number },
) {
  const basename = filePath.split("/").pop() || filePath;
  const lowerTask = task.toLowerCase();
  const lowerContent = content.toLowerCase();
  const change = `+${delta.added}${delta.removed ? ` -${delta.removed}` : ""}`;

  if (/\b(fields?|columns?|excel|spreadsheet|upload|mapping|transaction|tx)\b/.test(lowerTask)) {
    if (/fields?\.json$/i.test(filePath)) return `${existedBefore ? "Updated" : "Created"} ${basename} field configuration ${change}`;
    if (/server\.(js|ts|mjs|cjs)$/i.test(filePath)) return `Updated ${basename} to load dynamic field configuration ${change}`;
    if (/\.(html|tsx|jsx|vue|svelte)$/i.test(filePath)) return `Updated ${basename} field manager UI ${change}`;
    if (/\.(js|ts|mjs|cjs)$/i.test(filePath) && /\b(add|remove|delete|save|field|config|required)\b/.test(lowerContent)) {
      return `Updated ${basename} add/edit/remove/save field behavior ${change}`;
    }
    if (/\.(css|scss|sass|less)$/i.test(filePath)) return `Polished ${basename} field manager styling ${change}`;
  }

  const reason = rationale
    .replace(/\s+/g, " ")
    .replace(/^(i('| a)?m|i am|i will|i need to|i'm going to|going to)\s+/i, "")
    .slice(0, 90)
    .trim();
  if (reason.length >= 18) return `${existedBefore ? "Updated" : "Created"} ${basename}: ${reason} ${change}`;
  return `${existedBefore ? "Updated" : "Created"} ${basename} ${change}`;
}

function makeNarrativeObject(
  tier: Exclude<FactoryNarrativeObject["tier"], "trace">,
  args: Record<string, unknown>,
  source: FactoryNarrativeObject["source"],
): FactoryNarrativeObject {
  const evidence = Array.isArray(args.evidence) ? args.evidence.map((item) => String(item)).filter(Boolean).slice(0, 8) : [];
  const confidence = typeof args.confidence === "number" ? Math.max(0, Math.min(100, Math.round(args.confidence))) : undefined;
  const details: FactoryNarrativeObject["details"] = {};
  if (typeof args.chosen_action === "string") details.chosenAction = args.chosen_action;
  if (typeof args.flag_type === "string") details.flagType = args.flag_type;
  if (typeof confidence === "number") details.confidence = confidence;

  return {
    id: String(args.id || `${tier}-${Date.now()}`),
    tier,
    rationale: String(args.rationale || `${tier} recorded.`).replace(/\s+/g, " ").trim(),
    evidence,
    source,
    confidence,
    filePath: typeof args.file_path === "string" ? args.file_path : undefined,
    details,
  };
}

function concreteEditEvidence(timeline: FactoryExecutionEvent[]) {
  return timeline
    .filter((event) => event.kind === "edit" && event.status === "completed" && event.filePath && event.output)
    .slice(-6)
    .map((event) => {
      const lines = (event.output ?? "").split(/\r?\n/);
      const removed = lines.filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
      const added = lines.filter((line) => line.startsWith("+ ")).map((line) => line.slice(2).trim());
      if (removed.length === 1 && added.length === 1 && removed[0].length <= 280 && added[0].length <= 280) {
        return `${event.filePath}: ${removed[0]} → ${added[0]}`;
      }
      return `${event.title}${event.filePath ? ` (${event.filePath})` : ""}`;
    });
}

function buildSessionSummary(timeline: FactoryExecutionEvent[], changedFiles: Set<string>, status: MissionExecutorResult["status"], blocker?: string): FactorySessionSummary {
  const narrative = timeline.map((event) => event.narrative).filter((item): item is FactoryNarrativeObject => Boolean(item));
  const findings = narrative.filter((item) => item.tier === "finding");
  const decisions = narrative.filter((item) => item.tier === "decision");
  const flags = narrative.filter((item) => item.tier === "flag");
  const changed = Array.from(changedFiles);
  const editEvidence = concreteEditEvidence(timeline);
  const reportedOutcome = [...timeline]
    .reverse()
    .find((event) => event.kind === "summary" && event.status === "completed")
    ?.output?.trim();
  const outcome = status === "failed"
    ? blocker || "The mission did not complete."
    : reportedOutcome ||
      decisions.at(-1)?.rationale ||
      findings.at(-1)?.rationale ||
      (changed.length ? `Updated ${changed.length} file${changed.length === 1 ? "" : "s"} and verified the writes on disk.` : "No user-facing outcome was verified.");

  return {
    outcome,
    preserved: flags
      .filter((flag) => /preserv|kept|left|unchanged/i.test(flag.rationale) || /preserv/i.test(String(flag.details?.flagType ?? "")))
      .map((flag) => flag.rationale),
    changes: editEvidence.length ? editEvidence : decisions.length ? decisions.map((decision) => decision.rationale) : changed.map((filePath) => `Changed ${filePath}.`),
    flags: flags.map((flag) => flag.rationale),
  };
}

function buildCompletionHandoff(
  reportedSummary: string,
  changedFiles: Set<string>,
  commands: MissionExecutorResult["commands"],
  timeline: FactoryExecutionEvent[],
  narrativeObjects: FactoryNarrativeObject[],
  checklist: FactoryObjectiveChecklistItem[],
): string {
  const cleanReported = reportedSummary.replace(/\s+/g, " ").trim();
  const narrativeOutcome = [...narrativeObjects]
    .reverse()
    .find((item) => item.tier === "decision" || item.tier === "finding")
    ?.rationale?.trim();
  const outcome = cleanReported || narrativeOutcome || "The requested implementation is complete.";
  const fileLine = changedFiles.size
    ? `Changed files: ${Array.from(changedFiles).join(", ")}.`
    : "Changed files: none; this mission completed through a verified operation.";
  const passedCommands = commands.filter((command) => command.exitCode === 0).map((command) => command.command);
  const passedPreviews = timeline.filter((event) => event.kind === "preview" && event.status === "completed").map((event) => event.title);
  const checks = [...passedCommands, ...passedPreviews];
  const verificationLine = checks.length
    ? `Verified: ${checks.join("; ")}.`
    : "Verified: no runtime check was available; only recorded file evidence supports this result.";
  const limitations = checklist
    .filter((item) => item.status === "skipped")
    .map((item) => item.evidence?.trim() || item.label)
    .filter(Boolean);
  const limitationLine = limitations.length ? `Limitations: ${limitations.join("; ")}.` : "Limitations: none recorded.";
  return [outcome, fileLine, verificationLine, limitationLine].join("\n");
}

function dependencyCommandCategory(command: string) {
  return /\b(npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:ci|i|install|add|remove|uninstall|upgrade|update)\b/i.test(command)
    ? "dependencies"
    : undefined;
}

function dependencyCommandReason(command: string) {
  return dependencyCommandCategory(command)
    ? `${command} changes or recreates the project's dependency environment, so it needs approval before running.`
    : undefined;
}

function diffSummaryFromText(diffText: string) {
  const lines = diffText.split(/\r?\n/);
  return {
    added: lines.filter((line) => line.startsWith("+ ")).length,
    removed: lines.filter((line) => line.startsWith("- ")).length,
  };
}

function countLines(content: string) {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function explicitlyRequestsCommand(task: string, command: string) {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/\.cmd\b/g, "")
    .replace(/[^a-z0-9@._/-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const normalizedTask = normalize(task);
  const normalizedCommand = normalize(command);
  return Boolean(normalizedCommand && normalizedTask.includes(normalizedCommand));
}

const HEDGE_PREFIX_PATTERN = /^(i think|i believe|i suspect|my hunch is|my guess is|it looks like|it seems like|it seems that)\b[,:]?\s*/i;

export function normalizeForSimilarity(text: string) {
  return text
    .toLowerCase()
    .replace(HEDGE_PREFIX_PATTERN, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

export function textSimilarity(a: string, b: string) {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function safeJsonParse(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

const RELATIVE_IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](\.\.?\/[^"']+)["']/g;
const IMPORT_CHECK_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
const IMPORT_RESOLUTION_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", "/index.ts", "/index.tsx", "/index.js", ".json", ".css"];

/** Pure POSIX-style resolution of a relative specifier against the importing file's directory. */
export function resolveRelativeImport(importerPath: string, specifier: string): string {
  const parts = importerPath.replace(/\\/g, "/").split("/").slice(0, -1);
  for (const segment of specifier.replace(/\\/g, "/").split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** Every relative specifier the file imports, deduplicated, capped for cheap checking. */
export function relativeImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  for (const match of content.matchAll(RELATIVE_IMPORT_PATTERN)) {
    specifiers.add(match[1]);
    if (specifiers.size >= 24) break;
  }
  return [...specifiers];
}

/**
 * Rejects a write whose relative imports resolve to nothing — on disk or in the same coordinated batch.
 * Returns the exact missing targets so the model corrects the import instead of re-guessing structure.
 */
export async function unresolvedRelativeImportIssue(
  access: ProjectAccess,
  toolName: string,
  args: Record<string, unknown>,
  batchPaths: readonly string[],
): Promise<string | undefined> {
  const files: { path: string; content: string }[] = [];
  if (toolName === "write_files" && Array.isArray(args.files)) {
    for (const entry of args.files) {
      if (entry && typeof entry === "object") {
        const filePath = String((entry as Record<string, unknown>).path ?? "");
        const content = String((entry as Record<string, unknown>).content ?? "");
        if (filePath && content) files.push({ path: filePath, content });
      }
    }
  } else {
    const filePath = String(args.path ?? "");
    const content = String(args.content ?? args.new_text ?? "");
    if (filePath && content) files.push({ path: filePath, content });
  }

  const batch = new Set(batchPaths.filter(Boolean).map((path) => path.toLowerCase()));
  const missing: string[] = [];
  for (const file of files) {
    if (!IMPORT_CHECK_EXTENSIONS.test(file.path)) continue;
    for (const specifier of relativeImportSpecifiers(file.content)) {
      const base = resolveRelativeImport(file.path, specifier);
      let resolves = false;
      for (const suffix of IMPORT_RESOLUTION_CANDIDATES) {
        const candidate = `${base}${suffix}`;
        if (batch.has(candidate.toLowerCase())) { resolves = true; break; }
        const read = await access.readFile(candidate, { limitBytes: 1 }).catch(() => undefined);
        if (read?.exists) { resolves = true; break; }
      }
      if (!resolves) missing.push(`${file.path} imports "${specifier}" -> no file at ${base} (any known extension)`);
      if (missing.length >= 6) break;
    }
    if (missing.length >= 6) break;
  }
  if (!missing.length) return undefined;
  return `Rejected before touching disk: this write imports modules that DO NOT EXIST in this project — ${missing.join("; ")}. Do not invent a parallel structure. Use list_dir/read_file to find the real module paths that already exist and import those, or create the missing module in the same coordinated write batch.`;
}

/** One file path, canonicalized to forward-slash project-relative form. An absolute path inside the
 * project root is stripped to its relative remainder; anything else is returned cleaned but intact. */
export function canonicalProjectRelativePath(rawPath: string, rootLabel: string): string {
  const cleaned = rawPath.replace(/\\/g, "/").trim();
  const root = rootLabel.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && cleaned.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return cleaned.slice(root.length + 1).replace(/^\/+/, "");
  }
  if (root && cleaned.toLowerCase() === root.toLowerCase()) return "";
  return cleaned.replace(/^\.\//, "");
}

/** Mutates a parsed tool call's path arguments in place — single-file `path` and `write_files` batches —
 * so every downstream consumer (access, events, changed-file records, the file tree) sees one spelling. */
function normalizeToolCallPaths(args: Record<string, unknown>, rootLabel: string): void {
  if (typeof args.path === "string") args.path = canonicalProjectRelativePath(args.path, rootLabel);
  if (typeof args.cwd === "string") args.cwd = canonicalProjectRelativePath(args.cwd, rootLabel);
  if (Array.isArray(args.files)) {
    for (const entry of args.files) {
      if (entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string") {
        (entry as { path: string }).path = canonicalProjectRelativePath((entry as { path: string }).path, rootLabel);
      }
    }
  }
}

function isFailedWriteResult(result: unknown): result is { verified: false; reason?: string } {
  return typeof result === "object" && result !== null && (result as { verified?: unknown }).verified === false;
}
