"use client";


import {
  AppWindow,
  ArrowRight,
  ChevronDown,
  BrainCircuit,
  Boxes,
  CheckCircle2,
  Code2,
  Download,
  FolderGit2,
  FolderOpen,
  Gamepad2,
  Globe2,
  History,
  LayoutDashboard,
  File,
  Pencil,
  Paperclip,
  Settings,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Store,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { strFromU8, unzipSync } from "fflate";
import type { MissionState } from "@/lib/mission-engine";
import { deriveMissionDisplayStatus, isSoftwareProjectMission, projectBriefFromMission, projectTitleFor } from "@/lib/mission/status";
import { continueOrResumeMission, recentProjects } from "@/lib/discovery/personalization";
import { runDiscoveryEngine } from "@/lib/discovery/engine";
import { FALLBACK_STACK_OPTIONS, type StackOption } from "@/lib/ai/project-discovery-llm";
import { platformStackOptionsForProject, reconcilePlatformStackOptions } from "@/lib/discovery/platform-stack-policy";
import { genericHistoryRecommendation, type HistoryRecommendation } from "@/lib/discovery/history-recommendations";
import { deriveQuestionsAndAssumptions, discoverProject, explicitPlatformFromPrompt, explicitProjectNameFromPrompt, explicitStackFromPrompt, reconcileDiscoveryWithExplicitBrief } from "@/lib/ai/project-discovery";
import type { DiscoveryDecision, DiscoveryDimension, ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import { pickBrowserFolder, readBrowserFolderFiles, supportsBrowserFolderAccess } from "@/lib/factory/browser-folder";
import { generatedWorkspaceForMission } from "@/lib/factory/live-project";
import { capabilityLevelForStackChoice, unsupportedCreationMessage } from "@/lib/factory/language-adapters";
import type { StackProfile } from "@/lib/factory/language-adapters";
import type { FactoryExistingProjectRequest, FactoryFileReadResult, FactoryJournalEntry, FactoryProjectResult, FactoryUploadedFile, StructuredDiscovery } from "@/lib/factory/types";
import { MissionCanvas } from "@/components/canvas/MissionCanvas";
import { humanizeKey } from "@/components/execution/timelineUtils";
import { ModelModeSelector, ModelSelectionChip } from "@/components/ModelModeSelector";
import { CredentialsSettings } from "@/components/integrations/CredentialsSettings";
import { useModelMode } from "@/lib/ai/model-mode";
import type { TierResolution } from "@/lib/ai/model-router";

type ApprovalResponse = FactoryExistingProjectRequest["approvalResponse"];

type BuildDashboardProps = {
  missions: MissionState[];
  activeMissionId: string;
  queuedTask?: string;
  onSelectMission: (missionId: string) => void;
  onCreateMission: () => void;
  onDeleteMission?: (missionId: string) => void;
  onCreateProject?: (brief: string, files?: FactoryUploadedFile[], discovery?: StructuredDiscovery, evidenceFiles?: File[]) => void | Promise<void>;
  onUpdateProjectExecution?: (missionId: string, result: FactoryProjectResult) => void;
  onPreviewStateChange?: (missionId: string, preview: Pick<FactoryProjectResult, "previewState" | "previewUrl" | "previewPlatform" | "previewReason">) => void;
  onExecuteProject?: (missionId: string, task: string, approvalResponse?: ApprovalResponse, evidenceFiles?: File[], control?: { retryExecutionId?: string; undoExecutionId?: string }) => void | Promise<void>;
  onRollbackToEntry?: (missionId: string, projectId: string, entryId: string) => void | Promise<void>;
  onApproveCategory?: (missionId: string, category: string) => void;
  onApproveCommand?: (missionId: string, command: string) => void;
};

type TemplateId =
  | "inventory"
  | "commerce"
  | "pos"
  | "dashboard"
  | "website"
  | "mobile"
  | "game"
  | "api"
  | "ai"
  | "desktop"
  | "custom";

type FlowStep = "kind" | "project" | "understanding" | "stack" | "style" | "summary" | "instructions";
type ProjectLocation = "connect-existing" | "create-folder" | "inside-foundry";
type ExistingActionId = "connect-existing" | "debug-existing" | "improve-existing" | "analyze-architecture" | "deploy-existing" | "convert-existing" | "clone-existing";
type ExistingSource = "browser-local" | "upload" | "local" | "connector" | "github-later";
type ExistingFolderChoice = "archive" | "create-subfolder" | "continue-anyway" | "continue" | "choose-different" | "cancel";

type ProjectStart = {
  template: BuildTemplate;
  projectMode: "continue" | "new";
  projectLocation: ProjectLocation;
  subtype: string;
  customSubtype: string;
  projectName: string;
  projectNameTouched: boolean;
  projectDescription: string;
  uploadNames: string[];
  uploadedFiles: FactoryUploadedFile[];
  browserFolderHandleId: string;
  browserFolderName: string;
  existingSourceConfirmed: boolean;
  existingSourceChoice: ExistingFolderChoice | null;
  localConnectorUrl: string;
  localConnectorToken: string;
  localConnectorRoot: string;
  appKind: string;
  stack: string;
  customStack: string;
  instructions: string;
  instructionFiles: File[];
  discovery: ProjectDiscoveryResult | null;
  discoveryProvenance: "pending" | "model" | "deterministic" | "brief" | "rough";
  discoveryAnswers: Record<string, string>;
  /** Dynamically-authored stack choices from the Discovery Engine's LLM pass — empty until UnderstandingStep resolves, seeded with a small universal fallback until then. Replaces the old static per-category stackRecommendations table. */
  stackOptions: StackOption[];
  alternativeStacks: string[];
  deploymentNote: string;
  lede: string;
  styleChoice: string;
  customStyle: string;
  /** The exact tier/provider/model the Discovery Engine's LLM pass resolved to — null until that call resolves, or if it never ran (blank description skipped straight to summary). Never re-derived client-side; see ModelSelectionChip. */
  modelSelection?: (TierResolution & { autoSelected: boolean; reason?: string }) | null;
};

type BuildTemplate = {
  id: TemplateId;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: "teal" | "amber" | "blue";
  defaults: string[];
};

type StackRecommendation = {
  name: string;
  defaults: string[];
  why: string;
  recommended?: boolean;
};

type ExistingProjectStart = {
  action: ExistingActionId;
  source: ExistingSource;
  uploadNames: string[];
  uploadedFiles: FactoryUploadedFile[];
  localPath: string;
  localConnectorUrl: string;
  localConnectorToken: string;
  localConnectorRoot: string;
  browserFolderHandleId: string;
  browserFolderName: string;
  existingSourceConfirmed: boolean;
  existingSourceChoice: ExistingFolderChoice | null;
  description: string;
  /** Only meaningful when action is "convert-existing"/"clone-existing" — the stack the project should migrate to. */
  targetStack: string;
};

type FactoryView = "workspace" | "templates" | "settings" | "journal";

const buildTemplates: BuildTemplate[] = [
  {
    id: "inventory",
    title: "Build Inventory System",
    description: "Stock levels, suppliers, purchase orders, barcode-ready workflows.",
    icon: Boxes,
    accent: "teal",
    defaults: ["Products and SKU tracking", "Low-stock alerts", "Local-first data model"],
  },
  {
    id: "commerce",
    title: "Build E-commerce Store",
    description: "Catalog, cart, checkout, order management, storefront preview.",
    icon: ShoppingBag,
    accent: "amber",
    defaults: ["Responsive storefront", "Cart and checkout flow", "Admin product tools"],
  },
  {
    id: "pos",
    title: "Build POS App",
    description: "Fast checkout, item lookup, receipts, register-friendly UI.",
    icon: Store,
    accent: "blue",
    defaults: ["Touch-friendly selling screen", "Receipt workflow", "Offline-first by default"],
  },
  {
    id: "dashboard",
    title: "Build Dashboard",
    description: "Metrics, tables, charts, filters, alerts, exportable reports.",
    icon: LayoutDashboard,
    accent: "teal",
    defaults: ["KPI overview", "Filterable data table", "Charts with empty states"],
  },
  {
    id: "website",
    title: "Build Website",
    description: "Product, venue, portfolio, docs, or marketing site with real pages.",
    icon: Globe2,
    accent: "blue",
    defaults: ["Responsive pages", "Reusable sections", "SEO-ready metadata"],
  },
  {
    id: "mobile",
    title: "Build Mobile App",
    description: "Mobile-first product flow, navigation, settings, and device states.",
    icon: Smartphone,
    accent: "amber",
    defaults: ["Core screens", "Navigation model", "Platform-aware layout"],
  },
  {
    id: "game",
    title: "Build Game",
    description: "Playable mechanics, HUD, levels, score loop, and asset plan.",
    icon: Gamepad2,
    accent: "teal",
    defaults: ["Playable first screen", "Stateful game loop", "Keyboard and pointer input"],
  },
  {
    id: "api",
    title: "Build API",
    description: "REST/GraphQL endpoints, auth, database-backed services, ready for any frontend to call.",
    icon: Webhook,
    accent: "blue",
    defaults: ["Typed request/response contracts", "Validation and error handling", "Health-check endpoint"],
  },
  {
    id: "ai",
    title: "Build AI Application",
    description: "Chat, agents, RAG search, or workflow automation powered by a model provider.",
    icon: BrainCircuit,
    accent: "teal",
    defaults: ["Model provider integration", "Conversation or workflow UI", "Guardrails for cost and latency"],
  },
  {
    id: "desktop",
    title: "Build Desktop Application",
    description: "A native or web-shell desktop app for Windows, macOS, or Linux with local data and offline-first workflows.",
    icon: AppWindow,
    accent: "amber",
    defaults: ["Local-first data", "Native window/menu shell", "Installer path planned after prototype"],
  },
  {
    id: "custom",
    title: "Custom Build",
    description: "Describe anything Foundry should build from scratch.",
    icon: Code2,
    accent: "blue",
    defaults: ["Requirements discovery", "Stack recommendation", "Implementation plan"],
  },
];

const foundryProjectRoot = "Foundry workspace\\projects";

const existingProjectActions: Array<{ id: ExistingActionId; label: string; description: string }> = [
  { id: "connect-existing", label: "Open Existing Project", description: "Bring an existing codebase into Foundry, then decide the next engineering task inside the project workspace." },
  {
    id: "convert-existing",
    label: "Convert Existing Project",
    description: "Bring an existing project in and migrate it to a different stack in place — Foundry builds the new implementation alongside the old one until it's verified, then removes what's no longer needed.",
  },
  {
    id: "clone-existing",
    label: "Clone Into Another Stack",
    description: "Bring an existing project in and build a new copy of it in a different stack, preserving the original untouched.",
  },
];

const existingSourceOptions: Array<{ id: ExistingSource; label: string; description: string; status: string }> = [
  { id: "connector", label: "Connect Local Agent", description: "Install Foundry's local agent once, then connect any project folder on this computer. Real files, real commands, real node_modules, real dev server — not a copy.", status: "Recommended" },
  { id: "local", label: "Connect local folder path", description: "Paste a real folder path. Only works when Foundry's own server runs on this same computer.", status: "Available with explicit path" },
  { id: "browser-local", label: "Open Local Folder", description: "Pick a real folder and let Foundry edit it directly in the browser. No real commands can run this way — browsers can't execute processes.", status: "Uses File System Access API, no commands" },
  { id: "upload", label: "Import Copy", description: "Fallback only. Creates an editable Foundry copy of uploaded files — edits a copy, not your original folder.", status: "Fallback" },
  { id: "github-later", label: "GitHub repo", description: "Connect a repository once GitHub integration is enabled.", status: "Later" },
];

const locationOptions: Array<{ id: ProjectLocation; label: string; description: string; status: string }> = [
  {
    id: "create-folder",
    label: "Connect Local Project",
    description: "Install Foundry's local agent once, then pick or create a real folder on this computer. Real files, real commands, real dev server.",
    status: "Recommended",
  },
  {
    id: "inside-foundry",
    label: "Create inside Foundry workspace",
    description: "Foundry becomes the project workspace/IDE. Files are stored in Foundry and can be viewed, edited, or exported later.",
    status: "Creates a real Foundry workspace now",
  },
  {
    id: "connect-existing",
    label: "Import existing files (copy)",
    description: "Fallback only. Upload files as a starting point — Foundry edits a copy, not the connected local project.",
    status: "Fallback",
  },
];

const styleDescriptions: Record<string, string> = {
  "Minimal & Clean": "Quiet and uncluttered, generous whitespace — the interface gets out of the way of the work.",
  "Enterprise / SaaS": "Professional and dense, optimized for scanning tables and repeated workflows all day.",
  "Playful & Bold": "High-contrast and energetic, motion-forward — built to feel fun to use.",
  Editorial: "Content-forward and typographic — reads like a considered publication, not a dashboard.",
  "Dark & Technical": "Terminal-adjacent, monospace-leaning, built for people comfortable with tools.",
  "Warm & Approachable": "Soft, rounded, human — designed to feel welcoming to non-technical users.",
  "Brutalist / Raw": "Unpolished on purpose — sharp edges, visible structure, no decoration.",
  Retro: "Nostalgic references, period-accurate color and type choices.",
  "Luxury / Premium": "Restrained and high-contrast with generous negative space — signals quality over quantity.",
};

const styleOptions = Object.keys(styleDescriptions);

const projectSubtypeOptions: Record<TemplateId, string[]> = {
  inventory: [
    "Retail inventory",
    "Warehouse inventory",
    "Manufacturing inventory",
    "Medical/pharmacy inventory",
    "Restaurant inventory",
    "Clothing/apparel inventory",
    "Asset tracking",
    "Small business inventory",
    "Enterprise inventory",
  ],
  commerce: ["Clothing store", "Grocery", "Digital products", "Wholesale", "Subscription"],
  pos: ["Retail POS", "Restaurant POS", "Service business", "Cardknox/payment SDK"],
  dashboard: ["Operations dashboard", "Sales dashboard", "Inventory dashboard", "Finance dashboard", "Executive dashboard"],
  website: ["Marketing site", "Portfolio", "Product page", "Docs site", "Business website"],
  mobile: ["Consumer mobile app", "Field operations app", "Internal business app", "Companion app", "Mobile commerce app"],
  game: ["2D arcade game", "Puzzle game", "Platformer", "Card/board game", "Educational game"],
  api: ["REST API", "GraphQL API", "Internal microservice", "Public developer API", "Webhook/integration service", "Auth/identity service", "Data processing API"],
  ai: ["Chat assistant", "Document Q&A / RAG", "Agentic workflow", "Content generation tool", "AI-powered internal tool", "Voice/multimodal app"],
  desktop: ["Internal business tool", "Data entry / forms tool", "Utility / productivity tool", "Creative or media tool", "POS/register terminal", "Monitoring/dashboard tool"],
  custom: ["Web app", "Business app", "Internal tool", "AI app", "Backend/API", "Desktop app"],
};

export function BuildDashboard({ missions, activeMissionId, queuedTask, onSelectMission, onCreateMission, onDeleteMission, onCreateProject, onExecuteProject, onPreviewStateChange, onRollbackToEntry, onApproveCategory, onApproveCommand }: BuildDashboardProps) {
  const [activeTemplate, setActiveTemplate] = useState<BuildTemplate | null>(null);
  const [existingStart, setExistingStart] = useState<ExistingProjectStart | null>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>("kind");
  const [start, setStart] = useState<ProjectStart | null>(null);
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FactoryFileReadResult | null>(null);
  const [fileReadError, setFileReadError] = useState("");
  const [activeView, setActiveView] = useState<FactoryView>("workspace");
  const connectedProject = missions.find((mission) => mission.missionId === activeMissionId) ?? missions[0];
  const hasConnectedProject = Boolean(connectedProject && connectedProject.messages.length + connectedProject.attachments.length + connectedProject.createdArtifacts.length > 0);
  const execution = connectedProject ? projectExecutionFromMission(connectedProject) : null;
  const connectorInfo = connectedProject ? connectorInfoFromMission(connectedProject) : null;
  const [connectorTreeFiles, setConnectorTreeFiles] = useState<FactoryProjectResult["files"]>([]);
  const [connectorTreeForMissionId, setConnectorTreeForMissionId] = useState("");
  const [connectorTreeError, setConnectorTreeError] = useState("");
  const [connectorTreeLoading, setConnectorTreeLoading] = useState(false);

  useEffect(() => {
    if (!connectedProject || !connectorInfo) {
      setConnectorTreeFiles([]);
      setConnectorTreeForMissionId("");
      setConnectorTreeError("");
      setConnectorTreeLoading(false);
      return;
    }
    let cancelled = false;
    const missionId = connectedProject.missionId;
    setConnectorTreeLoading(true);
    setConnectorTreeError("");
    void listAgentTreeWithRetry(connectorInfo.url, connectorInfo.token, connectorInfo.root).then((result) => {
      if (cancelled) return;
      setConnectorTreeLoading(false);
      if (!result.ok) {
        setConnectorTreeFiles([]);
        setConnectorTreeForMissionId(missionId);
        setConnectorTreeError(result.error || "Could not load files from the Local Agent.");
        return;
      }
      setConnectorTreeFiles(result.entries.map((entry) => ({ path: entry.path, status: "uploaded" as const, size: entry.size })));
      setConnectorTreeForMissionId(missionId);
      setConnectorTreeError("");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedProject?.missionId, connectorInfo?.url, connectorInfo?.root, connectorInfo?.token]);

  const baseWorkspaceFiles = connectedProject ? projectFilesForMission(connectedProject, execution) : [];
  const workspaceFiles =
    connectedProject && connectorTreeForMissionId === connectedProject.missionId && connectorTreeFiles.length
      ? mergeConnectorFiles(connectorTreeFiles, baseWorkspaceFiles)
      : baseWorkspaceFiles;
  const firstWorkspaceFilePath = workspaceFiles[0]?.path ?? "";
  const connectedPath = connectedProject ? connectedPathForMission(connectedProject, execution) : "";
  const selectedProjectBrief = connectedProject && isSoftwareProjectMission(connectedProject) ? projectBriefFromMission(connectedProject) : "";

  useEffect(() => {
    setFilePanelOpen(false);
    setSelectedFile(null);
    setFileReadError("");
  }, [connectedProject?.missionId]);

  function openProjectFiles() {
    setFilePanelOpen(true);
    setFileReadError("");
    if (!selectedFile && workspaceFiles.length) {
      void readGeneratedFile(workspaceFiles[0].path);
    } else if (!workspaceFiles.length) {
      setFileReadError(connectorInfo
        ? connectorTreeLoading ? "" : connectorTreeError || "No readable project files were found in the connected folder."
        : "No readable project files are stored in this workspace. Re-import the project folder or a ZIP containing supported text source files.");
    }
  }

  useEffect(() => {
    if (!filePanelOpen || selectedFile) return;
    if (firstWorkspaceFilePath) {
      setFileReadError("");
      void readGeneratedFile(firstWorkspaceFilePath);
      return;
    }
    if (connectorInfo && !connectorTreeLoading && connectorTreeForMissionId === connectedProject?.missionId) {
      setFileReadError(connectorTreeError || "No readable project files were found in the connected folder.");
    }
    // readGeneratedFile intentionally follows the currently rendered connector/workspace snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePanelOpen, selectedFile, firstWorkspaceFilePath, connectorTreeLoading, connectorTreeForMissionId, connectorTreeError, connectedProject?.missionId]);

  async function readGeneratedFile(filePath: string, projectIdOverride?: string) {
    const virtualFile = execution?.files.find((file) => file.path === filePath && typeof file.content === "string");
    if (virtualFile?.content !== undefined) {
      setSelectedFile({ projectId: execution?.projectId ?? "connected-project", path: filePath, content: virtualFile.content });
      setFileReadError("");
      setFilePanelOpen(true);
      return;
    }
    const connectedFile = workspaceFiles.find((file) => file.path === filePath);
    if (connectedFile && typeof connectedFile.content === "string") {
      setSelectedFile({ projectId: connectedPath || "connected-project", path: filePath, content: connectedFile.content });
      setFileReadError("");
      setFilePanelOpen(true);
      return;
    }
    if (connectorInfo) {
      setFileReadError("");
      const read = await readAgentFile(connectorInfo.url, connectorInfo.token, connectorInfo.root, filePath);
      if (read.content !== null) {
        setSelectedFile({ projectId: connectedPath || "connected-project", path: filePath, content: read.content });
        setFilePanelOpen(true);
      } else {
        setFileReadError(read.error || "Could not read that file from the connected Local Agent.");
      }
      return;
    }
    const connectedProjectId = connectedPath.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
    const projectIds = Array.from(new Set([projectIdOverride, execution?.projectId, connectedProjectId].filter((value): value is string => Boolean(value))));
    if (!projectIds.length) {
      setFileReadError("This project record has file metadata but no durable project id. Reconnect its folder to restore file access.");
      setFilePanelOpen(true);
      return;
    }
    setFileReadError("");
    try {
      let lastError = "Could not read file.";
      for (const projectId of projectIds) {
        const response = await fetch(`/api/factory/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`);
        if (!response.ok) {
          lastError = (await response.json() as { error?: string }).error ?? lastError;
          continue;
        }
        setSelectedFile((await response.json()) as FactoryFileReadResult);
        setFilePanelOpen(true);
        return;
      }
      throw new Error(lastError);
    } catch (error) {
      setFileReadError(error instanceof Error ? error.message : "Could not read file.");
    }
  }

  function openFlow(template: BuildTemplate, initialDescription = "") {
    const described = initialDescription.trim();
    // When the caller already captured a description (dashboard prompt, history recommendation), mirror
    // the seed the "What do you want to build?" step would apply, then skip straight past that step so
    // the same question isn't asked twice.
    // A freeform project has no platform until the user's brief supplies one. Seeding the
    // first custom chip ("Web app") here made that UI default look user-confirmed and also
    // sent it to the discovery engine, biasing Android, iOS, desktop, CLI, and backend briefs.
    const subtype = template.id === "custom" ? "" : firstSubtypeFor(template.id);
    const appKind = initialDescription || appKindFor(template, subtype, "");
    const projectName = template.id === "custom"
      ? (described ? cleanProjectName(initialDescription) : "")
      : cleanProjectName(appKind);
    setActiveTemplate(template);
    setFlowStep(described ? "project" : "kind");
    const platformStackOptions = platformStackOptionsForProject(template.id);
    const initialStackOptions = platformStackOptions.length ? platformStackOptions : FALLBACK_STACK_OPTIONS;
    setStart({
      template,
      projectMode: "new",
      projectLocation: "inside-foundry",
      subtype,
      customSubtype: "",
      projectName,
      projectNameTouched: false,
      projectDescription: initialDescription,
      uploadNames: [],
      uploadedFiles: [],
      browserFolderHandleId: "",
      browserFolderName: "",
      existingSourceConfirmed: false,
      existingSourceChoice: null,
      localConnectorUrl: "",
      localConnectorToken: "",
      localConnectorRoot: "",
      appKind,
      stack: initialStackOptions[0].name,
      customStack: "",
      instructions: "",
      instructionFiles: [],
      // A starter card is now just a seed hint into the same Discovery Engine as freeform text — the
      // full heuristic no longer runs synchronously here. discovery stays null (DiscoveryRail shows a
      // Stage-A seed guess instead) until UnderstandingStep's LLM call actually resolves it.
      discovery: null,
      discoveryProvenance: "pending",
      discoveryAnswers: {},
      stackOptions: initialStackOptions,
      alternativeStacks: [],
      deploymentNote: "",
      lede: "",
      styleChoice: "",
      customStyle: "",
    });
  }

  function openExistingFlow(action: ExistingActionId) {
    setExistingStart({
      action,
      source: "connector",
      uploadNames: [],
      uploadedFiles: [],
      localPath: "",
      localConnectorUrl: "http://127.0.0.1:3917",
      localConnectorToken: "",
      localConnectorRoot: "",
      browserFolderHandleId: "",
      browserFolderName: "",
      existingSourceConfirmed: false,
      existingSourceChoice: null,
      description: "",
      targetStack: "",
    });
  }

  function updateStart(update: Partial<ProjectStart>) {
    setStart((current) => (current ? { ...current, ...update } : current));
  }

  function closeFlow() {
    setActiveTemplate(null);
    setStart(null);
    setFlowStep("kind");
  }

  function createProject() {
    if (start) {
      void onCreateProject?.(projectBriefFor(start), start.uploadedFiles, structuredDiscoveryFor(start), start.instructionFiles);
      // The build starts immediately, so take the user to the live mission canvas immediately too.
      // Leaving the Templates dashboard visible made real execution look disconnected or invisible.
      setActiveView("workspace");
    } else {
      onCreateMission();
    }
    closeFlow();
  }

  return (
    <>
      <main
        className="grid min-h-0 gap-4 overflow-y-auto p-3 lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-hidden lg:p-4"
      >
        <FactorySidebar
          missions={missions}
          activeMissionId={activeMissionId}
          activeView={activeView}
          onViewChange={setActiveView}
          onSelectMission={(missionId) => {
            setActiveView("workspace");
            onSelectMission(missionId);
          }}
          onCreateMission={() => {
            setActiveView("templates");
            onCreateMission();
          }}
          onDeleteMission={onDeleteMission}
          hideOnMobile={activeView === "workspace" && Boolean(connectedProject)}
        />

        {activeView === "templates" ? (
          <FactoryHome
            missions={missions}
            activeMissionId={activeMissionId}
            onOpenFlow={openFlow}
            onOpenExistingFlow={openExistingFlow}
            onSelectMission={onSelectMission}
          />
        ) : activeView === "journal" ? (
          <JournalView
            projectId={execution?.projectId}
            onReadFile={readGeneratedFile}
            onRollback={
              onRollbackToEntry && connectedProject && execution?.projectId
                ? (entryId: string) => onRollbackToEntry(connectedProject.missionId, execution.projectId, entryId)
                : undefined
            }
          />
        ) : activeView === "settings" ? (
          <FactorySettingsView
            mission={connectedProject}
            execution={execution}
            connectedPath={connectedPath}
            selectedProjectBrief={selectedProjectBrief}
            onOpenTemplates={() => setActiveView("templates")}
            onOpenExistingProject={() => openExistingFlow("connect-existing")}
          />
        ) : connectedProject && selectedProjectBrief ? (
          <MissionCanvas
            mission={connectedProject}
            brief={selectedProjectBrief}
            execution={execution}
            connectedPath={connectedPath}
            localConnector={connectorInfo ? { url: connectorInfo.url, token: connectorInfo.token, rootLabel: connectorInfo.root } : undefined}
            workspaceFiles={workspaceFiles}
            queuedTask={queuedTask}
            onStartProject={() => {
              setActiveView("templates");
              setFilePanelOpen(false);
              setSelectedFile(null);
            }}
            onViewFiles={openProjectFiles}
            onExecute={(task, approvalResponse, evidenceFiles) => {
              setActiveView("workspace");
              setFilePanelOpen(false);
              setSelectedFile(null);
              void onExecuteProject?.(connectedProject.missionId, task, approvalResponse, evidenceFiles);
            }}
            onRetry={(task, executionId) => {
              setActiveView("workspace");
              setFilePanelOpen(false);
              setSelectedFile(null);
              void onExecuteProject?.(connectedProject.missionId, task, undefined, [], { retryExecutionId: executionId });
            }}
            onUndo={(executionId) => {
              setActiveView("workspace");
              setFilePanelOpen(false);
              setSelectedFile(null);
              void onExecuteProject?.(connectedProject.missionId, "Undo the last file change", undefined, [], { undoExecutionId: executionId });
            }}
            onPreviewStateChange={(preview) => onPreviewStateChange?.(connectedProject.missionId, preview)}
            onApproveCategory={onApproveCategory ? (category) => onApproveCategory(connectedProject.missionId, category) : undefined}
            onApproveCommand={onApproveCommand ? (command) => onApproveCommand(connectedProject.missionId, command) : undefined}
          />
        ) : (
          <FactoryHome
            missions={missions}
            activeMissionId={activeMissionId}
            onOpenFlow={openFlow}
            onOpenExistingFlow={openExistingFlow}
            onSelectMission={onSelectMission}
          />
        )}

      </main>

      {activeTemplate && start ? (
        <ProjectStartFlow
          start={start}
          hasConnectedProject={hasConnectedProject}
          connectedProjectTitle={connectedProject?.title ?? "Current project"}
          step={flowStep}
          onStepChange={setFlowStep}
          onUpdate={(update) => {
            if ((update.appKind || update.subtype || update.customSubtype || update.projectDescription) && start && !start.customStack.trim()) {
              const nextStart = { ...start, ...update };
              const appKind = appKindFor(nextStart.template, nextStart.subtype, nextStart.customSubtype);
              const effectiveAppKind = nextStart.template.id === "custom" ? nextStart.appKind : appKind;
              // No static per-category table to re-derive a stack from anymore — the Discovery Engine's
              // LLM pass (UnderstandingStep) is what actually decides stack options, so a domain/subtype
              // change here just keeps whatever stack is already selected until that pass re-runs.
              updateStart({ ...update, appKind: effectiveAppKind });
              return;
            }

            updateStart(update);
          }}
          onClose={closeFlow}
          onCreate={createProject}
        />
      ) : null}

      {existingStart ? (
        <ExistingProjectFlow
          start={existingStart}
          onUpdate={(update) => setExistingStart((current) => (current ? { ...current, ...update } : current))}
          onClose={() => setExistingStart(null)}
          onCreate={() => {
            void onCreateProject?.(existingProjectBriefFor(existingStart), existingStart.uploadedFiles);
            setExistingStart(null);
            setActiveView("workspace");
          }}
        />
      ) : null}

      {filePanelOpen ? (
        <FileTreePanel
          execution={execution}
          workspaceFiles={workspaceFiles}
          connectedPath={connectedPath}
          selectedFile={selectedFile}
          error={fileReadError}
          loading={Boolean(connectorInfo && connectorTreeLoading && !selectedFile)}
          onClose={() => setFilePanelOpen(false)}
          onReadFile={readGeneratedFile}
        />
      ) : null}
    </>
  );
}

function FactorySidebar({
  missions,
  activeMissionId,
  activeView,
  onViewChange,
  onSelectMission,
  onCreateMission,
  onDeleteMission,
  hideOnMobile,
}: Pick<BuildDashboardProps, "missions" | "activeMissionId" | "onSelectMission" | "onCreateMission" | "onDeleteMission"> & {
  activeView: FactoryView;
  onViewChange: (view: FactoryView) => void;
  hideOnMobile?: boolean;
}) {
  const projectMissions = missions.filter(isSoftwareProjectMission);
  const activeMission = missions.find((mission) => mission.missionId === activeMissionId);
  // Deleting a chat is irreversible (the mission history is gone from the workspace), so the trash
  // button only stages the id here and a confirmation dialog performs the actual delete.
  const [pendingDelete, setPendingDelete] = useState<{ missionId: string; title: string } | null>(null);
  const visibleProjects =
    projectMissions.length > 0
      ? projectMissions
      : activeMission
        ? [activeMission]
        : missions.slice(0, 1);
  const navItems: Array<{ id: FactoryView; label: string; icon: LucideIcon }> = [
    { id: "workspace", label: "Workspace", icon: LayoutDashboard },
    { id: "templates", label: "Templates", icon: Code2 },
    { id: "journal", label: "Journal", icon: History },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <>
    <aside className={`glass-panel lg:min-h-0 flex-col gap-4 p-3 ${hideOnMobile ? "hidden lg:flex" : "flex"}`} aria-label="Factory navigation">
      <div className="px-1">
        <p className="section-kicker">Projects</p>
        <p className="mt-1 text-xs leading-5 text-foundry-subtle">Switch workspaces or start a new one.</p>
      </div>

      <nav className="grid gap-1.5 border-t border-overlay/10 pt-3" aria-label="Workspace views">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition ${
                activeView === item.id ? "bg-overlay/[0.075] text-foundry-ink" : "text-foundry-muted hover:bg-overlay/[0.045] hover:text-foundry-ink"
              }`}
              type="button"
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => onViewChange(item.id)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="min-h-0 border-t border-overlay/10 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-3">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-foundry-muted">Workspaces</p>
          <button className="icon-button h-7 w-7" type="button" title="New workspace" aria-label="New workspace" onClick={onCreateMission}>
            <FolderGit2 size={14} />
          </button>
        </div>
        <div className="grid max-h-full gap-1.5 overflow-auto pr-1">
          {visibleProjects.slice(0, 8).map((mission) => (
            <div
              key={mission.missionId}
              className={`group grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center rounded-md transition ${
                activeMissionId === mission.missionId ? "bg-overlay/[0.075] text-foundry-ink" : "text-foundry-muted hover:bg-overlay/[0.045] hover:text-foundry-ink"
              }`}
            >
              <button className="min-w-0 px-3 py-2 text-left" type="button" onClick={() => onSelectMission(mission.missionId)}>
                <span className="block truncate text-[13px] font-semibold">{projectTitleFor(mission)}</span>
                <span className="mt-0.5 block truncate text-[11px] text-foundry-subtle">{mission.updatedAt.slice(0, 10)}</span>
              </button>
              {onDeleteMission ? (
                <button
                  className="mr-1 grid h-8 w-8 place-items-center rounded-md text-foundry-subtle opacity-70 transition hover:bg-overlay/10 hover:text-foundry-ink group-hover:opacity-100"
                  type="button"
                  title={`Delete ${projectTitleFor(mission)}`}
                  aria-label={`Delete ${projectTitleFor(mission)}`}
                  onClick={() => setPendingDelete({ missionId: mission.missionId, title: projectTitleFor(mission) })}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          ))}
          {projectMissions.length === 0 ? (
            <div className="rounded-md border border-dashed border-overlay/15 px-3 py-4 text-xs leading-5 text-foundry-subtle">
              Old chat threads are hidden here. New factory projects will appear after you start a build.
            </div>
          ) : null}
        </div>
      </section>
    </aside>

    {pendingDelete ? (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-shade/60 p-4 backdrop-blur-sm"
        role="presentation"
        onClick={() => setPendingDelete(null)}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-chat-title"
          aria-describedby="delete-chat-body"
          className="w-full max-w-sm rounded-xl border border-overlay/12 bg-foundry-raised p-5 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") setPendingDelete(null);
          }}
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-red-400/30 bg-red-400/[0.08] text-red-300">
              <Trash2 size={18} />
            </span>
            <div className="min-w-0">
              <h2 id="delete-chat-title" className="text-base font-extrabold leading-6 text-foundry-ink">
                Delete &ldquo;{pendingDelete.title}&rdquo;?
              </h2>
              <p id="delete-chat-body" className="mt-1.5 text-sm leading-6 text-foundry-muted">
                This removes the chat and its mission history from Foundry and can&rsquo;t be undone. Files the project already created on disk are not deleted.
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              autoFocus
              type="button"
              className="rounded-md border border-overlay/15 bg-overlay/[0.05] px-3.5 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-overlay/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-teal/50"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md border border-red-400/40 bg-red-500/15 px-3.5 py-2 text-sm font-extrabold text-red-200 transition hover:bg-red-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
              onClick={() => {
                onDeleteMission?.(pendingDelete.missionId);
                setPendingDelete(null);
              }}
            >
              Delete chat
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

function JournalView({
  projectId,
  onReadFile,
  onRollback,
}: {
  projectId?: string;
  onReadFile: (path: string) => void;
  onRollback?: (entryId: string) => void;
}) {
  const [entries, setEntries] = useState<FactoryJournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/factory/journal?projectId=${encodeURIComponent(projectId)}`)
      .then((response) => response.json())
      .then((data: { entries?: FactoryJournalEntry[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        setEntries(data.entries ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the execution journal.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="lg:min-h-0 lg:overflow-auto rounded-xl border border-overlay/10 bg-foundry-raised/90 shadow-workspace">
      <div className="border-b border-overlay/10 px-4 py-4 sm:px-5">
        <p className="section-kicker">Permanent Record</p>
        <h1 className="mt-2 text-2xl font-extrabold text-foundry-ink">Execution Journal</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foundry-muted">
          Every action Foundry has taken on this project, durably recorded — commands run, files created and edited, permissions requested, retries, and failures. This survives reloads and is separate from the live mission timeline.
        </p>
      </div>

      <div className="grid gap-2 p-4 sm:p-5">
        {!projectId ? (
          <div className="rounded-md border border-dashed border-overlay/15 px-3 py-6 text-sm leading-6 text-foundry-subtle">Open a project to see its execution journal.</div>
        ) : loading ? (
          <div className="px-3 py-6 text-sm text-foundry-muted">Loading journal...</div>
        ) : error ? (
          <div className="rounded-md border border-red-400/25 bg-red-400/[0.05] px-3 py-3 text-sm text-red-200">{error}</div>
        ) : entries.length === 0 ? (
          <div className="rounded-md border border-dashed border-overlay/15 px-3 py-6 text-sm leading-6 text-foundry-subtle">No durable history recorded for this project yet.</div>
        ) : (
          entries.map((entry) => (
            <JournalRow key={entry.id} entry={entry} onReadFile={onReadFile} onRollback={onRollback} />
          ))
        )}
      </div>
    </section>
  );
}

function JournalRow({
  entry,
  onReadFile,
  onRollback,
}: {
  entry: FactoryJournalEntry;
  onReadFile: (path: string) => void;
  onRollback?: (entryId: string) => void;
}) {
  const event = entry.event;
  const canRollback = Boolean(onRollback && !entry.reverted && event.filePath && (event.kind === "edit" || event.kind === "file") && event.status === "completed");

  return (
    <div className={`rounded-md border px-3 py-2 ${entry.reverted ? "border-overlay/5 bg-shade/10 opacity-60" : "border-overlay/10 bg-shade/20"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="font-mono text-[10px] text-foundry-subtle">{new Date(entry.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <span className="min-w-0 truncate font-semibold text-foundry-ink">{event.title}</span>
          {entry.reverted ? <span className="rounded-full border border-overlay/15 px-1.5 py-0.5 text-[10px] font-bold text-foundry-subtle">reverted</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {event.filePath ? (
            <button type="button" className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal" onClick={() => onReadFile(event.filePath as string)}>
              Open file
            </button>
          ) : null}
          {canRollback ? (
            <button
              type="button"
              className="rounded border border-foundry-amber/30 bg-foundry-amber/[0.1] px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-amber hover:bg-foundry-amber/[0.18]"
              onClick={() => onRollback?.(entry.id)}
            >
              Rollback to here
            </button>
          ) : null}
        </div>
      </div>
      {event.filePath ? <p className="mt-1 truncate font-mono text-[11px] text-foundry-subtle">{event.filePath}</p> : null}
    </div>
  );
}

function FactorySettingsView({
  mission,
  execution,
  connectedPath,
  selectedProjectBrief,
  onOpenTemplates,
  onOpenExistingProject,
}: {
  mission: MissionState | undefined;
  execution: FactoryProjectResult | null;
  connectedPath: string;
  selectedProjectBrief: string;
  onOpenTemplates: () => void;
  onOpenExistingProject: () => void;
}) {
  const sourceMode = selectedProjectBrief ? projectSourceModeForBrief(selectedProjectBrief) : "new";
  const localPath = selectedProjectBrief.match(/^Local project path:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const editingTarget = connectedPath || execution?.projectPath || localPath || "No project connected";
  const files = execution?.files.length ?? 0;

  return (
    <section className="lg:min-h-0 lg:overflow-auto border border-overlay/10 bg-foundry-surface/95 shadow-workspace">
      <div className="border-b border-overlay/10 px-4 py-4 sm:px-5">
        <p className="section-kicker">Settings</p>
        <h1 className="mt-2 text-2xl font-extrabold text-foundry-ink">Workspace settings</h1>
      </div>

      <div className="grid max-w-4xl gap-5 p-4 sm:p-5">
        <section className="grid gap-3 border-b border-overlay/10 pb-5">
          <h2 className="text-sm font-extrabold text-foundry-ink">Current project</h2>
          <SummaryRow label="Workspace" value={mission ? projectTitleFor(mission) : "No workspace selected"} />
          <SummaryRow label="Editing target" value={editingTarget} />
          <SummaryRow label="Source mode" value={projectSourceCopy(sourceMode, Boolean(localPath), Boolean(execution?.projectPath))} />
          <SummaryRow label="Files loaded" value={String(files)} />
          <SummaryRow label="Last result" value={mission?.lastResult || "Ready"} />
        </section>

        <ModelModeSelector />

        <CredentialsSettings
          projectId={execution?.projectId || mission?.missionId || "unassigned-project"}
          workspaceId={mission?.missionId || "local-workspace"}
          files={(execution?.files || []).map((file) => ({ path: file.path, content: file.content }))}
          localAgentOffline={Boolean(selectedProjectBrief.match(/^Local connector root:/im) && !execution)}
        />

        <section className="grid gap-3 sm:grid-cols-2">
          <button
            className="min-h-24 rounded-md border border-overlay/10 bg-overlay/[0.035] p-4 text-left transition hover:border-foundry-teal/35 hover:bg-foundry-teal/[0.08]"
            type="button"
            onClick={onOpenTemplates}
          >
            <span className="text-sm font-extrabold text-foundry-ink">Templates</span>
            <span className="mt-2 block text-xs leading-5 text-foundry-muted">Create a new project from a starter or custom brief.</span>
          </button>
          <button
            className="min-h-24 rounded-md border border-overlay/10 bg-overlay/[0.035] p-4 text-left transition hover:border-foundry-blue/35 hover:bg-foundry-blue/[0.08]"
            type="button"
            onClick={onOpenExistingProject}
          >
            <span className="text-sm font-extrabold text-foundry-ink">Open project</span>
            <span className="mt-2 block text-xs leading-5 text-foundry-muted">Connect a live folder or import an editable Foundry copy.</span>
          </button>
        </section>
      </div>
    </section>
  );
}

function BuildCard({ template, onStart }: { template: BuildTemplate; onStart: () => void }) {
  const Icon = template.icon;
  const accentClass =
    template.accent === "teal"
      ? "border-foundry-teal/25 bg-foundry-teal/[0.055] text-foundry-teal"
      : template.accent === "amber"
        ? "border-foundry-amber/25 bg-foundry-amber/[0.07] text-foundry-amber"
        : "border-foundry-blue/25 bg-foundry-blue/[0.07] text-foundry-blue";

  return (
    <button
      className="group flex items-start gap-3 rounded-lg border border-overlay/10 bg-overlay/[0.03] p-3.5 text-left transition hover:border-foundry-teal/35 hover:bg-overlay/[0.06] focus-visible:border-foundry-teal/45 focus-visible:outline-none"
      type="button"
      onClick={onStart}
      title={template.defaults.slice(0, 2).join(" · ")}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${accentClass}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-extrabold text-foundry-ink">{template.title}</span>
        <span className="mt-1 block text-xs leading-5 text-foundry-muted">{template.description}</span>
      </span>
    </button>
  );
}

/** Home-page personalization must never consume project-execution budget merely because the user
 * opened Templates. Richer model-authored recommendations belong behind an explicit user action. */
function useHistoryRecommendation(missions: MissionState[]): { recommendations: HistoryRecommendation[]; loading: boolean; modelSelection: TierResolution & { autoSelected: boolean; reason?: string } | null } {
  return { recommendations: genericHistoryRecommendation(missions), loading: false, modelSelection: null };
}

function FactoryHome({
  missions,
  activeMissionId,
  onOpenFlow,
  onOpenExistingFlow,
  onSelectMission,
}: {
  missions: MissionState[];
  activeMissionId?: string;
  onOpenFlow: (template: BuildTemplate, initialDescription?: string) => void;
  onOpenExistingFlow: (action: ExistingActionId) => void;
  onSelectMission: (missionId: string) => void;
}) {
  const starterTemplates = buildTemplates.filter((template) => template.id !== "custom");
  const customTemplate = buildTemplates.find((template) => template.id === "custom") ?? buildTemplates[0];
  const localAgentStatus = useLocalAgentInstallStatus();
  const localAgentInstalled = localAgentStatus === "installed" || localAgentStatus === "connected";
  const continueCard = continueOrResumeMission(missions, activeMissionId);
  const recentCards = recentProjects(missions, activeMissionId, continueCard ? 2 : 3).filter((card) => card.missionId !== continueCard?.missionId);
  const { showModelNames } = useModelMode();
  const { recommendations: historyRecommendations, modelSelection: historyModelSelection } = useHistoryRecommendation(missions);

  const [prompt, setPrompt] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templateById = (id: string) => buildTemplates.find((template) => template.id === id) ?? customTemplate;
  function startBuilding() {
    const text = prompt.trim();
    onOpenFlow(customTemplate, text);
  }

  // The two entry points the hero prompt does NOT already cover. "Build something new" lived here
  // once but duplicated the prompt directly above it, so the prompt is now the single path to a new
  // project. Each option is a thin wrapper over an existing handler — no new paths.
  const beginOptions: Array<{ label: string; hint: string; cta: string; icon: LucideIcon; accent: "teal" | "amber" | "blue"; onSelect: () => void }> = [
    {
      label: "Open an existing project",
      hint: "Connect a folder, upload files, or continue work already on your computer.",
      cta: "Open",
      icon: FolderOpen,
      accent: "blue",
      onSelect: () => onOpenExistingFlow("connect-existing"),
    },
    {
      label: "Use a ready-made template",
      hint: "Start faster with a website, business app, mobile app, dashboard, or AI app.",
      cta: "Browse",
      icon: LayoutDashboard,
      accent: "teal",
      onSelect: () => {
        setTemplatesOpen(true);
        requestAnimationFrame(() => document.getElementById("all-project-types")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      },
    },
  ];

  const beginTone = (accent: "teal" | "amber" | "blue") =>
    accent === "amber"
      ? "border-foundry-amber/25 bg-foundry-amber/[0.06] hover:border-foundry-amber/45 hover:shadow-[0_12px_30px_rgb(var(--foundry-amber)/0.14)] focus-visible:ring-foundry-amber/40"
      : accent === "blue"
        ? "border-foundry-blue/25 bg-foundry-blue/[0.06] hover:border-foundry-blue/45 hover:shadow-[0_12px_30px_rgb(var(--foundry-blue)/0.14)] focus-visible:ring-foundry-blue/40"
        : "border-foundry-teal/25 bg-foundry-teal/[0.06] hover:border-foundry-teal/45 hover:shadow-[0_12px_30px_rgb(var(--foundry-teal)/0.14)] focus-visible:ring-foundry-teal/40";

  // Broad directions; each opens the real discovery flow with a representative template.
  const directions: Array<{ label: string; hint: string; templateId: string; icon: LucideIcon; accent: "teal" | "amber" | "blue" }> = [
    { label: "Website", hint: "Marketing site, portfolio, documentation, landing page, or online store.", templateId: "website", icon: Globe2, accent: "blue" },
    { label: "Business app", hint: "Inventory, POS, CRM, dashboard, reports, forms, and internal tools.", templateId: "dashboard", icon: LayoutDashboard, accent: "teal" },
    { label: "Mobile or desktop app", hint: "Installable apps for Windows, macOS, Android, or iPhone.", templateId: "mobile", icon: Smartphone, accent: "amber" },
    { label: "AI or custom project", hint: "Agents, automation, APIs, data tools, games, and anything unusual.", templateId: "ai", icon: Sparkles, accent: "teal" },
  ];

  // Real completion from the mission's own plan checklist — never a fabricated percentage.
  const continueProgress = (() => {
    if (!continueCard) return null;
    const mission = missions.find((item) => item.missionId === continueCard.missionId);
    if (!mission) return null;
    const status = deriveMissionDisplayStatus(mission);
    const plan = status.activeExecutionMission?.plan ?? [];
    const done = plan.filter((item) => item.status === "completed" || item.status === "skipped").length;
    return { percent: plan.length ? Math.round((done / plan.length) * 100) : null, label: status.label };
  })();

  const runtimePill = localAgentInstalled
    ? { text: "Runtime connected and ready", dotClass: "bg-foundry-teal", textClass: "text-foundry-teal", spin: false }
    : localAgentStatus === "checking"
      ? { text: "Checking runtime…", dotClass: "bg-foundry-subtle", textClass: "text-foundry-subtle", spin: true }
      : localAgentStatus === "offline"
        ? { text: "Local agent installed, but not running", dotClass: "bg-foundry-amber", textClass: "text-foundry-amber", spin: false }
        : { text: "Local runtime not installed — cloud work still available", dotClass: "bg-foundry-subtle", textClass: "text-foundry-subtle", spin: false };

  const accentBorder = (accent: "teal" | "amber" | "blue") =>
    accent === "teal" ? "border-foundry-teal/30 text-foundry-teal" : accent === "amber" ? "border-foundry-amber/30 text-foundry-amber" : "border-foundry-blue/30 text-foundry-blue";

  return (
    <section className="lg:min-h-0 lg:overflow-auto rounded-xl border border-overlay/10 bg-foundry-bg shadow-workspace">
      <div className="relative overflow-hidden px-4 py-12 sm:px-6 sm:py-16">
        <div className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-72 max-w-3xl rounded-full bg-foundry-amber/[0.07] blur-3xl" />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-foundry-teal/25 bg-foundry-teal/[0.09] px-3 py-1 text-[11px] font-bold">
            <span className={`h-1.5 w-1.5 rounded-full ${runtimePill.dotClass} ${runtimePill.spin ? "animate-pulse" : ""}`} />
            <span className={runtimePill.textClass}>{runtimePill.text}</span>
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.06] tracking-tight text-foundry-ink sm:text-[3.25rem]">
            Turn an idea into
            <br />
            <span className="bg-gradient-to-r from-foundry-amber via-foundry-amber to-foundry-teal bg-clip-text text-transparent">working software.</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-foundry-muted sm:text-base">
            Describe what you want. Foundry will understand the project, choose the right architecture, build it, test it, and show you the result.
          </p>

          <div className="mt-8 flex w-full max-w-2xl items-center gap-2 rounded-2xl border border-overlay/10 bg-foundry-surface p-2 shadow-[0_10px_34px_rgb(var(--foundry-overlay)/0.07)] transition focus-within:border-foundry-amber/45">
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  startBuilding();
                }
              }}
              placeholder="Example: Build me a simple inventory app for my store…"
              aria-label="Describe the project to build"
              className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle"
            />
            <button
              type="button"
              onClick={startBuilding}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-foundry-amber px-4 py-2.5 text-sm font-extrabold text-foundry-bg shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-amber/50"
            >
              Start building
              <ArrowRight size={15} />
            </button>
          </div>

          {localAgentStatus === "offline" || localAgentStatus === "not-installed" ? (
            <div className="mt-6 w-full max-w-xl rounded-lg border border-foundry-amber/30 bg-foundry-amber/[0.07] px-4 py-3 text-left">
              <p className="text-sm font-extrabold text-foundry-ink">
                {localAgentStatus === "offline" ? "Local agent installed, but not running" : "Local runtime not installed"}
              </p>
              <p className="mt-1 text-xs leading-5 text-foundry-muted">
                {localAgentStatus === "offline" ? (
                  <>Local execution is unavailable until the agent restarts. Run <code className="rounded bg-shade/30 px-1 py-0.5 font-mono text-[11px] text-foundry-ink">npm run agent</code> in your Foundry folder, or re-download it. Cloud and read-only work still works.</>
                ) : (
                  <>Install Foundry&apos;s local agent once to build with real files, commands, and a dev server on this computer. Cloud and read-only work is available without it.</>
                )}
              </p>
              <a
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-extrabold text-foundry-teal transition hover:text-foundry-ink"
                href="/api/factory/agent/download?platform=windows"
                download
                onClick={(event) => {
                  event.currentTarget.href = `/api/factory/agent/download?platform=windows&v=${encodeURIComponent(String(Date.now()))}`;
                }}
              >
                <Download size={12} />
                {localAgentStatus === "offline" ? "Re-download Local Agent" : "Download Local Agent"}
              </a>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-8 sm:px-6">
        <section>
          <h2 className="text-base font-extrabold text-foundry-ink">Or choose how you want to begin</h2>
          <p className="mt-0.5 text-xs text-foundry-subtle">Only the most important choices are shown here.</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {beginOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={option.onSelect}
                  className={`group flex flex-col rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 ${beginTone(option.accent)}`}
                >
                  <span className={`grid h-10 w-10 place-items-center rounded-xl border bg-foundry-surface shadow-sm ${accentBorder(option.accent)}`}>
                    <Icon size={18} />
                  </span>
                  <span className="mt-4 block text-[15px] font-extrabold text-foundry-ink">{option.label}</span>
                  <span className="mt-1.5 block text-xs leading-5 text-foundry-muted">{option.hint}</span>
                  <span className="mt-4 inline-flex items-center gap-1 self-end text-xs font-extrabold text-foundry-muted transition group-hover:gap-1.5 group-hover:text-foundry-ink">
                    {option.cta}
                    <ArrowRight size={13} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {directions.map((direction) => {
              const Icon = direction.icon;
              return (
                <button
                  key={direction.label}
                  type="button"
                  onClick={() => onOpenFlow(templateById(direction.templateId))}
                  className="flex items-start gap-3.5 rounded-2xl border border-overlay/10 bg-foundry-surface p-4 text-left shadow-[0_1px_2px_rgb(var(--foundry-overlay)/0.04)] transition hover:border-foundry-amber/40 hover:shadow-[0_8px_24px_rgb(var(--foundry-overlay)/0.07)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-amber/40"
                >
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-foundry-bg ${accentBorder(direction.accent)}`}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold text-foundry-ink">{direction.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-foundry-muted">{direction.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {continueCard ? (
          <section className="rounded-2xl border border-overlay/10 bg-foundry-surface p-4 shadow-[0_1px_2px_rgb(var(--foundry-overlay)/0.04)]">
            <h2 className="text-sm font-extrabold text-foundry-ink">Continue where you left off</h2>
            <button
              type="button"
              onClick={() => onSelectMission(continueCard.missionId)}
              className="mt-3 flex w-full items-center gap-3 rounded-xl border border-overlay/[0.07] bg-foundry-bg px-3.5 py-3 text-left transition hover:border-foundry-amber/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-amber/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold text-foundry-ink">{continueCard.title}</span>
                <span className="mt-0.5 block truncate text-xs text-foundry-muted">{continueCard.subtitle}</span>
                {continueProgress?.percent != null ? (
                  <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-overlay/[0.08]">
                    <span className="block h-full rounded-full bg-gradient-to-r from-foundry-amber to-foundry-teal" style={{ width: `${continueProgress.percent}%` }} />
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs font-extrabold text-foundry-muted">Open →</span>
            </button>
          </section>
        ) : null}

        {recentCards.length || historyRecommendations.length ? (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-extrabold text-foundry-ink">{recentCards.length ? "Recent projects" : "Suggested for you"}</h2>
              {historyRecommendations.length ? <ModelSelectionChip selection={historyModelSelection} showModelNames={showModelNames} /> : null}
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {recentCards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className="rounded-lg border border-overlay/10 bg-overlay/[0.03] p-3.5 text-left transition hover:border-foundry-teal/35 hover:bg-overlay/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-teal/40"
                  onClick={() => onSelectMission(card.missionId)}
                >
                  <span className="block truncate text-[13px] font-extrabold text-foundry-ink">{card.title}</span>
                  <span className="mt-1 block truncate text-xs leading-5 text-foundry-muted">{card.subtitle}</span>
                </button>
              ))}
              {historyRecommendations.map((recommendation) => (
                <button
                  key={recommendation.id}
                  type="button"
                  className="rounded-lg border border-foundry-amber/25 bg-foundry-amber/[0.05] p-3.5 text-left transition hover:border-foundry-amber/45 hover:bg-foundry-amber/[0.1] focus-visible:border-foundry-amber/50 focus-visible:outline-none"
                  onClick={() => onOpenFlow(customTemplate, recommendation.suggestedMessage)}
                >
                  <span className="block truncate text-[13px] font-extrabold text-foundry-ink">{recommendation.title}</span>
                  <span className="mt-1 block truncate text-xs leading-5 text-foundry-muted">{recommendation.reason}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Secondary: every template stays reachable, but collapsed so the default view is the hero
            plus the primary choices rather than a wall of ~15 cards. */}
        <section id="all-project-types" className="scroll-mt-4 overflow-hidden rounded-2xl border border-overlay/10 bg-foundry-surface">
          <button
            type="button"
            aria-expanded={templatesOpen}
            aria-controls="all-project-types-grid"
            onClick={() => setTemplatesOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-extrabold text-foundry-ink transition hover:bg-overlay/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-amber/40"
          >
            <span>Browse all project types</span>
            <span className="inline-flex items-center gap-2 text-xs font-bold text-foundry-subtle">
              {starterTemplates.length + 1} templates
              <ChevronDown size={14} className={`transition ${templatesOpen ? "rotate-180" : ""}`} />
            </span>
          </button>
          {templatesOpen ? (
            <div id="all-project-types-grid" className="grid gap-2.5 border-t border-overlay/10 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {starterTemplates.map((template) => (
                <BuildCard key={template.id} template={template} onStart={() => onOpenFlow(template)} />
              ))}
              <BuildCard template={customTemplate} onStart={() => onOpenFlow(customTemplate)} />
            </div>
          ) : null}
        </section>

        <section aria-label="Bring in existing work" className="flex flex-wrap items-center gap-x-1.5 gap-y-2 pb-2 text-xs text-foundry-subtle">
          <span className="font-bold">Moving a project between stacks?</span>
          <button
            type="button"
            className="rounded font-extrabold text-foundry-blue underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-blue/40"
            onClick={() => onOpenExistingFlow("convert-existing")}
            title="Migrate an existing project to a different stack in place — Foundry builds the new version alongside the old one until it's verified."
          >
            Convert to another stack
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="rounded font-extrabold text-foundry-blue underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foundry-blue/40"
            onClick={() => onOpenExistingFlow("clone-existing")}
            title="Build a new copy of an existing project in a different stack, and leave the original untouched."
          >
            Clone into another stack
          </button>
        </section>
      </div>
    </section>
  );
}



type FileTreeNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  status?: "created" | "edited" | "uploaded";
  children: FileTreeNode[];
};

function ProjectFileTree({
  files,
  onReadFile,
  recentlyChangedPaths,
}: {
  files: FactoryProjectResult["files"];
  onReadFile: (path: string) => void;
  recentlyChangedPaths?: Record<string, number>;
}) {
  const tree = buildFileTree(files);
  return (
    <div className="mt-3 min-h-0 overflow-auto border-t border-overlay/10 pt-2">
      {tree.children.length ? (
        tree.children.map((node) => <FileTreeNodeView key={node.path || node.name} node={node} depth={0} onReadFile={onReadFile} recentlyChangedPaths={recentlyChangedPaths} />)
      ) : (
        <p className="p-3 text-xs text-foundry-subtle">No files loaded yet.</p>
      )}
    </div>
  );
}

function FileTreeNodeView({
  node,
  depth,
  onReadFile,
  recentlyChangedPaths,
}: {
  node: FileTreeNode;
  depth: number;
  onReadFile: (path: string) => void;
  recentlyChangedPaths?: Record<string, number>;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isRecentlyChanged = Boolean(node.path && recentlyChangedPaths?.[node.path]);
  if (node.type === "folder") {
    return (
      <div>
        <button
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-bold text-foundry-muted hover:bg-overlay/[0.055] hover:text-foundry-ink"
          style={{ paddingLeft: 8 + depth * 14 }}
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="w-3 text-foundry-subtle">{open ? "v" : ">"}</span>
          <span className="truncate">{node.name}</span>
        </button>
        {open ? node.children.map((child) => <FileTreeNodeView key={child.path || child.name} node={child} depth={depth + 1} onReadFile={onReadFile} recentlyChangedPaths={recentlyChangedPaths} />) : null}
      </div>
    );
  }

  return (
    <button
      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition ${isRecentlyChanged ? "bg-foundry-teal/[0.14] text-foundry-ink" : "text-foundry-muted hover:bg-foundry-teal/[0.08] hover:text-foundry-ink"}`}
      style={{ paddingLeft: 22 + depth * 14 }}
      type="button"
      onClick={() => onReadFile(node.path)}
    >
      <span className="min-w-0 truncate">{node.name}</span>
      {node.status && node.status !== "uploaded" ? <span className="rounded-full border border-foundry-teal/25 px-1.5 py-0.5 text-[10px] font-bold text-foundry-teal">{node.status}</span> : null}
    </button>
  );
}

function FileTreePanel({
  execution,
  workspaceFiles,
  connectedPath,
  selectedFile,
  error,
  loading,
  onClose,
  onReadFile,
}: {
  execution: FactoryProjectResult | null;
  workspaceFiles: FactoryProjectResult["files"];
  connectedPath: string;
  selectedFile: FactoryFileReadResult | null;
  error: string;
  loading?: boolean;
  onClose: () => void;
  onReadFile: (path: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-shade/70 p-4">
      <section className="grid h-[86vh] w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-overlay/15 bg-foundry-raised shadow-workspace">
        <header className="flex items-center justify-between gap-3 border-b border-overlay/10 px-4 py-3">
          <div className="min-w-0">
            <p className="section-kicker">Project Files</p>
            <h2 className="truncate text-lg font-extrabold text-foundry-ink">{execution?.projectPath || connectedPath || selectedFile?.projectId || "Connected project"}</h2>
          </div>
          <button className="rounded-md px-3 py-2 text-sm font-bold text-foundry-muted transition hover:bg-overlay/10 hover:text-foundry-ink" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="grid min-h-0 gap-0 md:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-auto border-b border-overlay/10 p-3 md:border-b-0 md:border-r">
            <ProjectFileTree files={workspaceFiles} onReadFile={onReadFile} />
            <div className="hidden">
              {(execution?.files ?? (selectedFile ? [{ path: selectedFile.path, status: "created" as const, size: selectedFile.content.length }] : [])).map((file) => (
                <button
                  key={file.path}
                  className={`rounded-md px-3 py-2 text-left text-xs transition ${selectedFile?.path === file.path ? "bg-foundry-teal/15 text-foundry-ink" : "text-foundry-muted hover:bg-overlay/[0.06] hover:text-foundry-ink"}`}
                  type="button"
                  onClick={() => onReadFile(file.path)}
                >
                  <span className="block truncate font-bold">{file.path}</span>
                  <span className="text-[11px] text-foundry-subtle">{file.status} · {file.size} bytes</span>
                </button>
              ))}
            </div>
          </aside>
          <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="flex items-center justify-between gap-3 border-b border-overlay/10 px-4 py-3">
              <p className="truncate text-sm font-extrabold text-foundry-ink">{selectedFile?.path ?? "Select a file"}</p>
              <button
                className="rounded-md border border-overlay/10 px-3 py-2 text-xs font-extrabold text-foundry-muted transition enabled:hover:border-foundry-teal/35 enabled:hover:text-foundry-ink disabled:opacity-50"
                type="button"
                disabled={!selectedFile}
                onClick={() => selectedFile && void navigator.clipboard.writeText(selectedFile.content)}
              >
                Copy
              </button>
            </div>
            {loading ? <p className="p-4 text-sm text-foundry-muted">Loading and indexing project files…</p> : error ? <p className="p-4 text-sm text-red-300">{error}</p> : null}
            <pre className="min-h-0 overflow-auto whitespace-pre-wrap p-4 text-xs leading-5 text-foundry-muted">{selectedFile?.content ?? (loading ? "Project files will appear here automatically." : "Choose a file from the tree.")}</pre>
          </section>
        </div>
      </section>
    </div>
  );
}

/** Only the custom/freeform path can lack signal on the "kind" step — every template starter already
 * seeded a real appKind in openFlow(), so it's never blocked here regardless of discovery/stack state. */
function lacksKindStepSignal(start: ProjectStart): boolean {
  return start.template.id === "custom" && !start.projectDescription.trim();
}

function CustomBuildStep({ start, onUpdate }: { start: ProjectStart; onUpdate: (update: Partial<ProjectStart>) => void }) {
  // Thin text-capture step — no local inference cluster anymore (inferCustomBuild and its helpers are
  // deleted). A Stage-A seed only enriches naming/subtype chips instantly; the real analysis always
  // comes from the same Discovery Engine LLM pass every other entry path uses, not a duplicate one.
  function applyDescription(value: string) {
    onUpdate({
      projectDescription: value,
      appKind: value,
      // Keep freeform discovery unclassified until the brief is analyzed. The old Web-app
      // seed survived every edit and was presented as "Your choice" even for Android apps.
      subtype: "",
      customSubtype: "",
      projectName: start.projectNameTouched ? start.projectName : cleanProjectName(value),
      discoveryAnswers: {},
    });
  }

  return (
    <FlowSection eyebrow="Foundry is asking" title="What do you want to build?" body="Describe it in your own words. Foundry will infer the shape, stack, architecture, features, style, and data model before it asks anything else.">
      <textarea
        className="min-h-32 w-full resize-y border-0 border-b border-overlay/10 bg-transparent p-0 pb-2 font-serif text-[17px] italic leading-8 text-foundry-ink outline-none placeholder:not-italic placeholder:text-foundry-subtle focus:border-foundry-teal/50"
        value={start.projectDescription}
        onChange={(event) => applyDescription(event.target.value)}
        placeholder="a small warehouse system tracking pallets across three sites…"
      />
      {start.projectDescription.trim() ? (
        <p className="mt-4 text-xs text-foundry-subtle">Continue and Foundry will analyze this in depth before drafting a decision memo you can review and edit.</p>
      ) : null}
    </FlowSection>
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

type DiscoveryEngineOutcome = Awaited<ReturnType<typeof runDiscoveryEngine>>;

/**
 * Module-level cache so the single real discovery request survives React's mount→unmount→mount cycle
 * (Strict Mode in dev, plus any spurious parent remount). Before this, UnderstandingStep's effect
 * cleanup called controller.abort(), which tore down the in-flight fetch before it ever reached the
 * server on every mount — so discovery ALWAYS fell back to the local heuristic, producing the generic
 * "Next.js" memo and the four hardcoded fallback stack cards. Keying by the request signature means a
 * remount awaits the same in-flight promise instead of firing (and aborting) a fresh one.
 */
type CachedDiscoveryRequest = { promise: Promise<DiscoveryEngineOutcome>; abort: () => void };
const discoveryRequestCache = new Map<string, CachedDiscoveryRequest>();

function discoverySeedText(start: ProjectStart) {
  if (start.template.id !== "custom") {
    return `${defaultKindFor(start.template.id)}. Subtype: ${start.customSubtype.trim() || start.appKind || start.subtype}`;
  }
  return start.projectDescription.trim() || start.appKind;
}

function deterministicDiscoveryIsSufficient(brief: string) {
  const words = brief.trim().split(/\s+/).filter(Boolean).length;
  if (explicitStackFromPrompt(brief)) return words >= 5;
  // Require more than a bare "Android app"-style label: platform plus a concrete product/workflow
  // is enough for the local policy, while genuinely underspecified requests still get refinement.
  return Boolean(explicitPlatformFromPrompt(brief)) && words >= 8
    && /\b(?:allow|build|checkout|create|display|integrate|let|manage|scan|send|support|track|using|with)\b/i.test(brief);
}

function cachedRunDiscoveryEngine(key: string, run: (signal: AbortSignal) => Promise<DiscoveryEngineOutcome>): CachedDiscoveryRequest {
  const existing = discoveryRequestCache.get(key);
  if (existing) return existing;
  const controller = new AbortController();
  const request: CachedDiscoveryRequest = {
    promise: run(controller.signal)
      .then((result) => {
        if (!result.ok) discoveryRequestCache.delete(key);
        return result;
      })
      .catch((error) => {
        discoveryRequestCache.delete(key);
        throw error;
      }),
    abort: () => controller.abort("Discovery exceeded the user-facing time budget."),
  };
  discoveryRequestCache.set(key, request);
  return request;
}

function UnderstandingStep({ start, onUpdate, onAdvance }: { start: ProjectStart; onUpdate: (update: Partial<ProjectStart>) => void; onAdvance: () => void }) {
  const [showEscape, setShowEscape] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [discoveryError, setDiscoveryError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // "cancelled" means only "this mounted instance should stop touching state" — it must NOT abort the
  // underlying discovery request. React remounts this component (Strict Mode in dev + parent
  // re-renders); tying the network request's lifetime to the effect is exactly what made the fetch get
  // aborted before it reached the server every time. The request now lives in discoveryRequestCache,
  // independent of any single mount.
  const cancelledRef = useRef(false);
  const activeRequestRef = useRef<CachedDiscoveryRequest | null>(null);

  useEffect(() => {
    if (discoveryError) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [attempt, discoveryError]);

  useEffect(() => {
    cancelledRef.current = false;
    const escapeTimer = window.setTimeout(() => {
      if (!cancelledRef.current) setShowEscape(true);
    }, 5000);
    // Foundry is genuinely reasoning here even when the API call resolves in a
    // few hundred ms — without a floor the "thinking" beat can flash by unnoticed.
    const minVisibleMs = start.template.id === "custom" ? 300 : 80;
    // A real gpt-5 analysis has been observed taking 60-80+ seconds; 110s is the hard ceiling. This is a
    // Promise.race that resolves to a heuristic fallback rather than aborting the shared request, so a
    // remount's own timer can never tear down an in-flight discovery the cache is serving.
    const hardTimeoutMs = 60_000;
    const startedAt = Date.now();

    async function refine() {
      const seedText = discoverySeedText(start);
      if (!seedText.trim()) {
        const remaining = minVisibleMs - (Date.now() - startedAt);
        if (remaining > 0) await wait(remaining);
        if (!cancelledRef.current) onAdvance();
        return;
      }
      // discoverProject() runs once, right here, purely as Stage B's starting hint — every path
      // (starter or freeform) goes through the same real analysis, not a cached guess. It also doubles
      // as the fallback memo content if the LLM call fails, so the user never lands on a blank summary
      // step just because OPENAI_API_KEY is unset or the network hiccups.
      const heuristic = discoverProject(seedText);
      // An explicit platform or stack is already an authoritative architecture constraint. Waiting
      // for a remote model to rediscover "Android" (or iOS, WPF, FastAPI, etc.) adds latency and cost
      // without resolving an unknown. Reconcile it through the same universal stack policy locally.
      if (start.template.id === "custom" && deterministicDiscoveryIsSufficient(seedText)) {
        const resolvedDiscovery = reconcileDiscoveryWithExplicitBrief({
          ...reconcileKnownStarterDiscovery(heuristic, start),
          // A broad commerce keyword such as "checkout" must not rename a specifically described
          // PAX/Android product to the generic catalog profile "E-commerce store".
          projectType: cleanProjectName(seedText) || heuristic.projectType,
          prompt: seedText,
        }, seedText);
        const platformContract = reconcilePlatformStackOptions(start.template.id, resolvedDiscovery, fallbackStackOptionsFor(resolvedDiscovery, start));
        const resolvedStackOptions = platformContract.stackOptions;
        const resolvedStack = resolvedStackOptions.find((option) => option.recommended)?.name || platformContract.recommendedStack || resolvedDiscovery.recommendedStack;
        const authoritativeDiscovery = alignDiscoveryWithSelectionAndConstraints(resolvedDiscovery, start, resolvedStack);
        onUpdate({
          discovery: authoritativeDiscovery,
          discoveryProvenance: "deterministic",
          stack: resolvedStack,
          customStack: "",
          projectName: start.projectNameTouched ? start.projectName : cleanProjectName(authoritativeDiscovery.projectType),
          alternativeStacks: resolvedStackOptions.filter((option) => option.name !== resolvedStack).map((option) => option.name),
          deploymentNote: "Deployment will follow the selected platform's native packaging and runtime requirements.",
          lede: "Foundry used the explicit platform and product requirements in your brief.",
          stackOptions: resolvedStackOptions,
          modelSelection: null,
        });
        window.clearTimeout(escapeTimer);
        const remaining = minVisibleMs - (Date.now() - startedAt);
        if (remaining > 0) await wait(remaining);
        if (!cancelledRef.current) onAdvance();
        return;
      }
      const cacheKey = JSON.stringify(["fast-discovery-v5-explicit-contract", attempt, seedText, start.template.id, start.subtype, start.customSubtype, start.projectLocation, start.uploadNames]);
      let completed = false;
      try {
        const inspection = start.uploadNames.length ? inspectExistingSourceNames(start.uploadNames) : null;
        const cachedRequest = cachedRunDiscoveryEngine(cacheKey, (signal) =>
            runDiscoveryEngine(
              heuristic,
              {
                starter: { id: start.template.id, title: start.template.title },
                subtype: start.subtype,
                customSubtype: start.customSubtype,
                projectDescription: start.projectDescription,
                location: {
                  choice: start.projectLocation,
                  label: locationLabel(start.projectLocation),
                  existingSourceRisky: inspection?.risky ?? false,
                  existingSourceSignals: inspection?.signals ?? [],
                },
              },
              // Deliberately no AbortSignal — the request must outlive this effect's cleanup.
              // Discovery is a bounded comparison task. The Fast reasoning tier preserves real AI
              // stack analysis without making the user wait on a build-scale model; the selected
              // execution tier still governs the actual architecture/build mission afterward.
              { mode: "fast", signal }
            ),
        );
        activeRequestRef.current = cachedRequest;
        const result = await Promise.race([
          cachedRequest.promise,
          wait(hardTimeoutMs).then((): DiscoveryEngineOutcome => {
            cachedRequest.abort();
            return { ok: false, error: "Discovery analysis exceeded the 60-second time budget and was cancelled." };
          }),
        ]);
        if (!cancelledRef.current) {
          if (!result.ok || !result.discovery) {
            setDiscoveryError(result.error || "Discovery could not produce a complete project decision.");
            return;
          }
          const rawDiscovery = result.discovery;
          const resolvedDiscovery = {
            ...reconcileKnownStarterDiscovery(rawDiscovery, start),
            // Reconcile against the typed brief, not a model-authored prompt echo. This keeps an
            // Android vendor SDK requirement authoritative when the model proposes a web bridge.
            prompt: start.projectDescription.trim() || rawDiscovery.prompt,
          };
          const proposedStackOptions = Array.isArray(result.stackOptions) && result.stackOptions.length ? result.stackOptions : fallbackStackOptionsFor(resolvedDiscovery, start);
          const platformContract = reconcilePlatformStackOptions(start.template.id, resolvedDiscovery, proposedStackOptions);
          const resolvedStackOptions = platformContract.stackOptions;
          const recommendedOption = resolvedStackOptions.find((option) => option.recommended);
          const resolvedStack = recommendedOption?.name || resolvedDiscovery.recommendedStack;
          const authoritativeDiscovery = alignDiscoveryWithSelectionAndConstraints(resolvedDiscovery, start, resolvedStack);
          onUpdate({
            discovery: authoritativeDiscovery,
            discoveryProvenance: result.provenance === "brief" ? "brief" : "model",
            // The recommendation and the selected value are one decision. Keeping the old
            // seed stack here made the sidebar/build brief claim Next.js while the cards
            // correctly recommended WPF (or another domain-specific stack).
            stack: resolvedStack,
            customStack: "",
            projectName: start.projectNameTouched ? start.projectName : cleanProjectName(authoritativeDiscovery.projectType),
            alternativeStacks: Array.isArray(result.alternativeStacks) ? result.alternativeStacks : [],
            deploymentNote: typeof result.deploymentNote === "string" ? result.deploymentNote : "",
            lede: typeof result.lede === "string" ? result.lede : "",
            stackOptions: resolvedStackOptions,
            modelSelection: result.modelSelection ?? null,
          });
          completed = true;
        }
      } catch (error) {
        // Network error or malformed response — fall back to the heuristic-only memo rather than
        // leaving start.discovery null and the summary step blank.
        if (!cancelledRef.current) setDiscoveryError(error instanceof Error ? error.message : "Discovery failed before returning a project decision.");
      } finally {
        window.clearTimeout(escapeTimer);
        const remaining = minVisibleMs - (Date.now() - startedAt);
        if (remaining > 0 && !cancelledRef.current) await wait(remaining);
        if (!cancelledRef.current && completed) onAdvance();
      }
    }

    void refine();
    return () => {
      cancelledRef.current = true;
      window.clearTimeout(escapeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function skipRefinement() {
    cancelledRef.current = true;
    activeRequestRef.current?.abort();
    // Same fallback as a failed LLM call (see refine() above) — skipping must never leave the summary
    // step with a blank memo just because the user got impatient before Stage B resolved. The in-flight
    // request keeps running in the cache; it just no longer has a listener.
    if (!start.discovery) {
      const seedText = discoverySeedText(start);
      if (seedText.trim()) {
        const heuristic = discoverProject(seedText);
        onUpdate({ discovery: heuristic, discoveryProvenance: "rough", projectName: start.projectNameTouched ? start.projectName : cleanProjectName(heuristic.projectType) });
      }
    }
    onAdvance();
  }

  return (
    <FlowSection eyebrow="Project discovery" title="Understanding your project." body="Foundry is analyzing the description now. The decision memo opens automatically when the real result is ready.">
      <div className="flex items-start gap-7">
        <span
          className="mt-1 h-[46px] w-[46px] shrink-0 animate-breathe-slow rounded-full"
          style={{ background: "radial-gradient(circle at 35% 30%, #7cf0d4, #1f7a5c 70%)", boxShadow: "0 0 0 1px rgba(52,216,166,0.3), 0 0 40px -6px rgba(52,216,166,0.7)" }}
        />
        <div className="grid gap-2">
          <p aria-live="polite" className="flex items-center gap-2.5 font-mono text-[13px] text-foundry-ink">
            <span className="h-1.5 w-1.5 shrink-0 animate-breathe rounded-full bg-foundry-teal" />
            Analyzing “{(start.projectDescription.trim() || start.appKind || "your project").replace(/\s+/g, " ").slice(0, 96)}{(start.projectDescription.trim() || start.appKind).length > 96 ? "…" : ""}”
          </p>
          <p className="text-xs leading-5 text-foundry-subtle">{elapsedSeconds < 2 ? "Sending the project context…" : `Waiting for the selected model · ${elapsedSeconds}s`}</p>
        </div>
      </div>
      {discoveryError ? (
        <div className="mt-8 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-4">
          <p className="text-sm font-bold text-red-100">Discovery did not complete</p>
          <p className="mt-1 text-xs leading-5 text-foundry-muted">{discoveryError} No AI recommendation has been accepted as authoritative.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button className="text-xs font-bold text-foundry-teal transition hover:text-foundry-ink" type="button" onClick={() => { setDiscoveryError(""); setShowEscape(false); setElapsedSeconds(0); setAttempt((value) => value + 1); }}>
              Retry discovery
            </button>
            <button className="text-xs font-bold text-foundry-subtle transition hover:text-foundry-muted" type="button" onClick={skipRefinement}>
              Continue with a clearly labeled rough pass
            </button>
          </div>
        </div>
      ) : showEscape ? (
        <div className="mt-8">
          <p className="text-xs leading-5 text-foundry-subtle">Still reasoning — a thorough analysis genuinely takes a while. You can wait for it, or continue now with a rough first pass instead.</p>
          <button className="mt-2 text-xs font-bold text-foundry-subtle transition hover:text-foundry-muted" type="button" onClick={skipRefinement}>
            Continue with a rough first pass
          </button>
        </div>
      ) : null}
    </FlowSection>
  );
}

function DiscoveryRail({ start, stepIndex, steps }: { start: ProjectStart; stepIndex: number; steps: FlowStep[] }) {
  const idx = (target: FlowStep) => steps.indexOf(target);
  const starterLabel = start.template.id === "custom" ? "Custom project" : start.template.title.replace(/^Build\s+/i, "");
  const styleValue = start.customStyle.trim() || start.styleChoice;
  const exactProjectChoice = start.template.id === "custom"
    ? explicitSurfaceFromBrief(start.projectDescription, start.discovery)
    : start.customSubtype.trim() || (start.subtype === "Other / Custom" ? "" : start.subtype.trim());

  const rows: Array<{ key: string; label: string; value: string; show: boolean; pending?: boolean }> = [
    { key: "starter", label: "Starter", value: starterLabel, show: true },
    { key: "choice", label: "Your choice", value: exactProjectChoice, show: Boolean(exactProjectChoice) },
    {
      key: "domain",
      label: start.discovery ? "Domain" : "Project brief",
      // Before the model finishes, repeat only what the user actually said. A keyword seed is useful
      // internally but must never appear under "Established so far" as if it were authoritative.
      value: start.discovery?.projectType ?? cleanProjectName(start.projectDescription || start.appKind),
      show: true,
    },
    { key: "stack", label: "Stack", value: selectedStackFor(start), show: stepIndex >= idx("stack") },
    { key: "style", label: "Style", value: styleValue, show: stepIndex >= idx("style") && Boolean(styleValue) },
    // ProjectStart always has an explicit location default. Reflect that choice in the
    // rail immediately so the summary cannot contradict the active option or make
    // Continue look like it silently selected a destination.
    { key: "location", label: "Where it lives", value: locationLabel(start.projectLocation), show: true },
  ];

  return (
    <aside className="hidden border-r border-overlay/[0.06] bg-gradient-to-b from-overlay/[0.025] to-transparent px-5 py-6 md:flex md:flex-col">
      <div className="mb-8 flex items-center gap-2">
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-gradient-to-br from-foundry-teal to-[#1f7a5c] font-serif text-[13px] font-bold italic text-foundry-bg">F</span>
        <span className="font-serif text-[16px] text-foundry-ink">Foundry</span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-foundry-subtle">discovery</span>
      </div>

      <div className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.1em] text-foundry-subtle">Established so far</div>
      <div className="flex flex-1 flex-col gap-0.5">
        {rows
          .filter((row) => row.show)
          .map((row) => (
            <div key={row.key} className={`flex items-start gap-2.5 rounded-md px-1.5 py-2 transition-opacity ${row.pending ? "opacity-30" : "opacity-100"}`}>
              <span className={`mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full ${row.pending ? "bg-foundry-subtle" : "bg-foundry-teal shadow-[0_0_0_3px_rgba(79,209,189,0.16)]"}`} />
              <span className="flex flex-col gap-0.5">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-foundry-subtle">{row.label}</span>
                <span className="text-[12.5px] leading-tight text-foundry-ink">{row.value}</span>
              </span>
            </div>
          ))}
      </div>

      <div className="mt-4 border-t border-overlay/[0.06] pt-4">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] text-foundry-muted">
          <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-foundry-teal" />
          Foundry is here with you
        </span>
      </div>
    </aside>
  );
}

function projectNeedsVisualStyle(start: ProjectStart) {
  const projectShape = `${start.discovery?.projectType ?? ""} ${start.appKind} ${start.subtype} ${start.customSubtype}`;
  return !/\b(?:backend|api|microservice|webhook service|command[- ]line|cli|library|sdk)\b/i.test(projectShape);
}

function DiscoveryAttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [source, setSource] = useState("");
  const isImage = file.type.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);

  useEffect(() => {
    if (!isImage) {
      setSource("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  return (
    <figure className="group relative overflow-hidden rounded-lg border border-overlay/10 bg-shade/35">
      {isImage && source ? (
        // This local URL exists only while the unsent discovery attachment is being previewed.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt={file.name || "Pasted screenshot"} className="h-28 w-full object-contain" />
      ) : (
        <div className="flex h-28 flex-col items-center justify-center gap-2 px-3 text-center text-foundry-muted">
          <File size={24} />
          <span className="max-w-full truncate text-[11px] font-semibold">{file.name || "Attached file"}</span>
          <span className="text-[10px] text-foundry-subtle">{formatDiscoveryFileSize(file.size)}</span>
        </div>
      )}
      <figcaption className="truncate border-t border-overlay/8 px-2.5 py-1.5 text-[10px] text-foundry-subtle">{file.name || "Pasted screenshot"}</figcaption>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name || "attachment"}`}
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-overlay/15 bg-shade/80 text-overlay/75 shadow-lg transition hover:border-overlay/30 hover:bg-black hover:text-white"
      >
        <X size={13} />
      </button>
    </figure>
  );
}

function formatDiscoveryFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ProjectStartFlow({
  start,
  hasConnectedProject,
  connectedProjectTitle,
  step,
  onStepChange,
  onUpdate,
  onClose,
  onCreate,
}: {
  start: ProjectStart;
  hasConnectedProject: boolean;
  connectedProjectTitle: string;
  step: FlowStep;
  onStepChange: (step: FlowStep) => void;
  onUpdate: (update: Partial<ProjectStart>) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const projectUploadInputRef = useRef<HTMLInputElement | null>(null);
  const instructionAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const stackOptions = start.stackOptions.length ? start.stackOptions : FALLBACK_STACK_OPTIONS;
  const selectedRecommendation = recommendationForStart(start);
  const canUseFolderPicker = supportsBrowserFolderAccess();
  const hasVisualExperience = projectNeedsVisualStyle(start);
  const steps: FlowStep[] = hasVisualExperience
    ? ["kind", "project", "understanding", "stack", "style", "summary", "instructions"]
    : ["kind", "project", "understanding", "stack", "summary", "instructions"];
  const stepIndex = steps.indexOf(step);
  const nextStep = steps[Math.min(stepIndex + 1, steps.length - 1)];
  // Going back from "stack" skips the transitional "understanding" screen rather than re-triggering it.
  const previousStep = step === "stack" ? "project" : steps[Math.max(stepIndex - 1, 0)];
  const Icon = start.template.icon;
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("checking");
  const [agentUrl] = useState(start.localConnectorUrl || "http://127.0.0.1:3917");
  const [agentToken] = useState(start.localConnectorToken || "");
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [pickError, setPickError] = useState("");
  const [connectedFolderEntries, setConnectedFolderEntries] = useState<string[]>([]);
  const everConnectedRef = useRef(false);

  function addInstructionFiles(files: File[]) {
    if (!files.length) return;
    const next = new Map(start.instructionFiles.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]));
    for (const file of files) next.set(`${file.name}:${file.size}:${file.lastModified}`, file);
    onUpdate({ instructionFiles: Array.from(next.values()) });
  }

  useEffect(() => {
    if (step === "style" && !hasVisualExperience) onStepChange("summary");
  }, [hasVisualExperience, onStepChange, step]);

  // Keeps discovery.recommendedStack in sync with the user's actual pick — projectBriefFor() and the
  // memo's "Recommended stack" field both read discovery.recommendedStack, so without this the build
  // silently used whatever the heuristic/LLM guessed first regardless of what was clicked here.
  function selectStack(name: string, customStack = "") {
    const resolved = (customStack || name).trim();
    if (!start.discovery || !resolved) {
      onUpdate({ stack: name, customStack });
      return;
    }
    // Switching away from the originally-recommended stack invalidates any framework-specific
    // architecture language (e.g. "Next.js App Router with Server Actions") — replace it with a
    // stack-neutral description instead of leaving a wrong, stack-mismatched claim in the memo.
    const stackChanged = !sameStackChoice(resolved, start.discovery.recommendedStack);
    const nextArchitecture = stackChanged ? genericArchitectureFor(resolved, start.discovery.dataModel, start.discovery.projectType, start.discovery.mainFeatures) : start.discovery.architecture;
    onUpdate({
      stack: name,
      customStack,
      discovery: {
        ...start.discovery,
        recommendedStack: resolved,
        architecture: nextArchitecture,
        decisions: stackChanged
          ? start.discovery.decisions.map((decision) => (decision.dimension === "architecture" ? { ...decision, hypothesis: nextArchitecture } : decision))
          : start.discovery.decisions,
        keyFacts: stackChanged ? refreshArchitectureKeyFact(start.discovery.keyFacts, start.discovery.recommendedStack, resolved) : start.discovery.keyFacts,
      },
    });
  }

  const pollAgentStatus = useCallback(async () => {
    const health = await checkAgentHealth(agentUrl, agentToken);
    if (!health.ok) {
      setAgentStatus(everConnectedRef.current ? "offline" : "not-installed");
      return;
    }
    everConnectedRef.current = true;
    setAgentStatus(start.localConnectorRoot && health.approvedRoots.includes(start.localConnectorRoot) ? "connected" : "installed");
  }, [agentUrl, agentToken, start.localConnectorRoot]);

  useEffect(() => {
    if (start.projectLocation !== "create-folder") return;
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      await pollAgentStatus();
    }

    void poll();
    const interval = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [start.projectLocation, pollAgentStatus]);

  useEffect(() => {
    if (start.projectLocation !== "create-folder" || agentStatus !== "connected" || !start.localConnectorRoot) {
      setConnectedFolderEntries([]);
      return;
    }
    let cancelled = false;
    void listAgentTree(agentUrl, agentToken, start.localConnectorRoot).then((result) => {
      if (!cancelled && result.ok) setConnectedFolderEntries(result.entries.map((entry) => entry.path));
    });
    return () => {
      cancelled = true;
    };
  }, [start.projectLocation, agentStatus, start.localConnectorRoot, agentUrl, agentToken]);

  function applyConnectedProjectFolder(root: string) {
    onUpdate({ projectLocation: "create-folder", localConnectorUrl: agentUrl, localConnectorToken: agentToken, localConnectorRoot: root, existingSourceChoice: null, existingSourceConfirmed: false });
    setAgentStatus("connected");
    setPickError("");
  }

  async function handleCreateProjectSubfolder() {
    if (!start.localConnectorRoot) return;
    const slug = slugifyProjectName(start.projectName || start.appKind || defaultKindFor(start.template.id));
    const result = await createAgentFolder(agentUrl, agentToken, start.localConnectorRoot, slug);
    if (result.ok && result.root) {
      applyConnectedProjectFolder(result.root);
      onUpdate({ existingSourceChoice: "create-subfolder", existingSourceConfirmed: true });
    } else {
      setPickError(result.error || "Could not create a subfolder there.");
    }
  }

  async function handleOpenProjectFolderPicker() {
    setPickError("");
    const result = await pickAgentFolderNative(agentUrl, agentToken);
    if (result.ok && result.root) {
      applyConnectedProjectFolder(result.root);
      return;
    }
    if (result.cancelled) return;
    if (result.unsupported) {
      setPickError("Your local agent is running an older connector that cannot open the system folder picker. Download/restart the latest local agent, or paste the folder path under Advanced.");
      return;
    }
    setPickError(result.error || "Could not open the folder picker.");
  }

  function openProjectUploadPicker(mode: "files" | "folder") {
    const input = projectUploadInputRef.current;
    if (!input) return;
    input.value = "";
    if (mode === "folder") {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
      input.removeAttribute("accept");
    } else {
      input.removeAttribute("webkitdirectory");
      input.removeAttribute("directory");
      input.setAttribute("accept", ".zip,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.scss,.sass,.less,.html,.py,.cs,.java,.kt,.php,.go,.rs,.rb,.swift,.dart,.sql,.xml,.yml,.yaml,.toml,.sh,.ps1");
    }
    input.click();
  }

  async function openProjectBrowserFolder() {
    if (!canUseFolderPicker) {
      openProjectUploadPicker("folder");
      return;
    }
    const folder = await pickBrowserFolder();
    const files = await readBrowserFolderFiles(folder.handle);
    onUpdate({
      projectLocation: "connect-existing",
      browserFolderHandleId: folder.id,
      browserFolderName: folder.name,
      uploadNames: files.map((file) => file.path),
      uploadedFiles: files,
      existingSourceConfirmed: false,
    });
  }

  const activeSourceNames = start.projectLocation === "create-folder" ? connectedFolderEntries : start.projectLocation === "connect-existing" ? start.uploadNames : [];
  const existingSourceRisky = activeSourceNames.length > 0 && inspectExistingSourceNames(activeSourceNames).risky;
  const blockedByExistingSource = existingSourceRisky && !start.existingSourceChoice;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-shade/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <section className="grid max-h-[90vh] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-overlay/15 bg-foundry-raised shadow-workspace">
        <header className="flex items-center justify-between gap-4 border-b border-overlay/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-foundry-teal/25 bg-foundry-teal/[0.08] text-foundry-teal">
              <Icon size={16} />
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foundry-subtle">Intelligent Project Discovery</span>
          </div>
          <button className="rounded-md px-3 py-1.5 text-sm font-bold text-foundry-muted hover:bg-overlay/10 hover:text-foundry-ink" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="grid min-h-0 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
          <DiscoveryRail start={start} stepIndex={stepIndex} steps={steps} />

          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
            <div className="min-h-0 overflow-auto px-7 py-8 sm:px-9">
              <input
                ref={projectUploadInputRef}
                className="sr-only"
                type="file"
                multiple
                onChange={(event) => {
                  const files = event.currentTarget.files;
                  void selectedUploadedFiles(files).then((uploadedFiles) =>
                    onUpdate({
                      uploadNames: uploadedFiles.map((file) => file.path),
                      uploadedFiles,
                      browserFolderHandleId: "",
                      browserFolderName: "",
                      existingSourceConfirmed: false,
                      existingSourceChoice: null,
                    }),
                  );
                }}
              />

              {step === "kind" ? (
            start.template.id === "custom" ? (
              <CustomBuildStep start={start} onUpdate={onUpdate} />
            ) : (
              <FlowSection eyebrow="Foundry is asking" title={kindStepTitle(start.template, start.appKind)} body="Pick the closest shape — or skip the chips and describe it your own way below.">
                <div className="flex flex-wrap gap-2.5">
                  {subtypesForEffectiveProject(start).map((subtype) => (
                    <ChipButton
                      key={subtype}
                      active={!start.customSubtype.trim() && start.subtype === subtype}
                      label={subtype}
                      onClick={() => {
                        const appKind = appKindFor(start.template, subtype, "");
                        onUpdate({
                          subtype,
                          customSubtype: "",
                          appKind,
                          projectName: cleanProjectName(appKind),
                          projectNameTouched: false,
                          discoveryAnswers: {},
                        });
                      }}
                    />
                  ))}
                </div>
                <label className="mt-7 flex items-baseline gap-2.5 text-[15px]">
                  <span className="whitespace-nowrap font-serif italic text-foundry-subtle">or, in your words —</span>
                  <input
                    className="flex-1 border-0 border-b border-overlay/10 bg-transparent p-0 pb-1.5 text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/50"
                    value={start.customSubtype}
                    onChange={(event) => {
                      const appKind = appKindFor(start.template, start.subtype, event.target.value);
                      onUpdate({
                        customSubtype: event.target.value,
                        appKind,
                        projectName: cleanProjectName(appKind),
                        projectNameTouched: false,
                        discoveryAnswers: {},
                      });
                    }}
                    placeholder="describe the exact project type…"
                  />
                </label>
              </FlowSection>
            )
          ) : null}

          {step === "project" ? (
            <FlowSection eyebrow="Foundry is asking" title="Where should this live?" body="Debugging, refactoring, analysis, and deployment all happen after the project is open.">
              <div className="grid gap-3">
                <div>
                  <div className="grid gap-2">
                    {locationOptions.map((option) => (
                      <ChoiceButton
                        key={option.id}
                        active={start.projectLocation === option.id}
                        label={option.label}
                        description={`${option.description} Status: ${option.status}.`}
                        onClick={() => onUpdate({ projectLocation: option.id, uploadNames: option.id === "connect-existing" ? start.uploadNames : [], uploadedFiles: option.id === "connect-existing" ? start.uploadedFiles : [], browserFolderHandleId: option.id === "connect-existing" ? start.browserFolderHandleId : "", browserFolderName: option.id === "connect-existing" ? start.browserFolderName : "", existingSourceConfirmed: false })}
                      />
                    ))}
                  </div>
                </div>

                {hasConnectedProject ? (
                  <div className="rounded-md border border-overlay/10 bg-overlay/[0.035] p-3 text-sm text-foundry-muted">
                    Current workspace project detected: <span className="font-bold text-foundry-ink">{connectedProjectTitle}</span>
                  </div>
                ) : null}

                {start.projectLocation !== "create-folder" ? (
                  <div className="rounded-md border border-overlay/10 bg-shade/20 p-3 text-xs leading-5 text-foundry-muted">
                    Planned folder path: <span className="font-mono text-foundry-ink">{plannedProjectPath(start)}</span>
                  </div>
                ) : null}

                {start.projectLocation === "create-folder" ? (
                  <div className="rounded-md border border-foundry-teal/20 bg-foundry-teal/[0.06] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="section-kicker">Foundry Local Agent</p>
                      <AgentStatusBadge status={agentStatus} />
                    </div>

                    {agentStatus === "checking" ? (
                      <p className="mt-2 text-sm leading-6 text-foundry-muted">Checking for the Foundry Local Agent on this computer...</p>
                    ) : agentStatus === "not-installed" ? (
                      <>
                        <p className="mt-2 text-sm leading-6 text-foundry-muted">
                          The Local Agent lets Foundry create and edit a real project folder on this computer and run real commands in it. Install it once, then pick or create a folder.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <a className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]" href="/api/factory/agent/download?platform=windows" download>
                            Download for Windows
                          </a>
                          <a className="rounded-md border border-overlay/15 bg-overlay/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink" href="/api/factory/agent/download?platform=mac" download>
                            macOS
                          </a>
                          <a className="rounded-md border border-overlay/15 bg-overlay/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink" href="/api/factory/agent/download?platform=linux" download>
                            Linux
                          </a>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-foundry-subtle">
                          Requires Node.js already installed (get it from nodejs.org if needed). Run the downloaded file once — it installs itself, starts running, and relaunches automatically every time you log in. Then check again below.
                        </p>
                        <button
                          className="mt-3 rounded-md border border-overlay/15 bg-overlay/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink"
                          type="button"
                          onClick={() => {
                            setAgentStatus("checking");
                            void pollAgentStatus();
                          }}
                        >
                          I&apos;ve installed it — Check again
                        </button>
                      </>
                    ) : (
                      <>
                        {agentStatus === "offline" ? (
                          <p className="mt-2 text-sm font-bold text-red-300">The agent isn&apos;t responding anymore. Make sure the window it opened is still running, then check again.</p>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-foundry-muted">Agent detected. Pick an existing folder, or create a new one, for this project to live in.</p>
                        )}
                        <button
                          className="mt-3 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]"
                          type="button"
                          onClick={() => void handleOpenProjectFolderPicker()}
                        >
                          Open Project Folder
                        </button>
                        {agentStatus === "connected" && start.localConnectorRoot ? (
                          <>
                            <p className="mt-3 text-sm font-bold text-foundry-teal">Connected: {start.localConnectorRoot}</p>
                            <ExistingSourceGuard
                              names={connectedFolderEntries}
                              mode="new-project"
                              choice={start.existingSourceChoice}
                              onChoose={(choice) => onUpdate({ existingSourceChoice: choice, existingSourceConfirmed: true })}
                              onCreateSubfolder={() => void handleCreateProjectSubfolder()}
                              onCancel={() => onUpdate({ localConnectorRoot: "", existingSourceChoice: null, existingSourceConfirmed: false })}
                            />
                          </>
                        ) : pickError ? (
                          <p className="mt-3 text-sm font-bold text-red-300">{pickError}</p>
                        ) : null}
                      </>
                    )}

                    {folderBrowserOpen ? (
                      <FolderBrowserModal
                        agentUrl={agentUrl}
                        agentToken={agentToken}
                        onClose={() => setFolderBrowserOpen(false)}
                        onSelect={(root) => {
                          setFolderBrowserOpen(false);
                          applyConnectedProjectFolder(root);
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}

                {start.projectLocation === "connect-existing" ? (
                  <div className="rounded-md border border-foundry-blue/20 bg-foundry-blue/[0.06] p-3">
                    <p className="section-kicker">Starting Files</p>
                    <p className="mt-2 text-sm leading-6 text-foundry-muted">
                      Open a live local folder when supported, or import files as an editable Foundry copy. Live folders can be read and edited directly after browser permission.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded-md border border-foundry-teal/25 bg-foundry-teal/[0.08] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:border-foundry-teal/45 hover:bg-foundry-teal/[0.13]"
                        type="button"
                        onClick={() => void openProjectBrowserFolder()}
                      >
                        {canUseFolderPicker ? "Open live folder" : "Upload folder copy"}
                      </button>
                      <button
                        className="rounded-md border border-overlay/15 bg-overlay/[0.055] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-blue/35 hover:bg-foundry-blue/10 hover:text-foundry-ink"
                        type="button"
                        onClick={() => openProjectUploadPicker("files")}
                      >
                        Choose ZIP/project files
                      </button>
                    </div>
                    {start.browserFolderName ? (
                      <p className="mt-3 text-sm font-bold text-foundry-ink">Connected live folder: {start.browserFolderName}</p>
                    ) : null}
                    <UploadSummary names={start.uploadNames} />
                    <ExistingSourceGuard
                      names={start.uploadNames}
                      mode="new-project"
                      choice={start.existingSourceChoice}
                      onChoose={(choice) => onUpdate({ existingSourceChoice: choice, existingSourceConfirmed: true })}
                      onCancel={() =>
                        onUpdate({
                          projectLocation: "inside-foundry",
                          uploadNames: [],
                          uploadedFiles: [],
                          browserFolderHandleId: "",
                          browserFolderName: "",
                          existingSourceChoice: null,
                          existingSourceConfirmed: false,
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            </FlowSection>
          ) : null}

          {step === "understanding" ? <UnderstandingStep start={start} onUpdate={onUpdate} onAdvance={() => onStepChange("stack")} /> : null}

          {step === "stack" ? (
            <FlowSection eyebrow="Foundry recommends, doesn't force" title="Pick a complete delivery stack — or trust the recommendation." body="Each option covers framework, runtime, persistence, security, required integrations, testing, and deployment for this project. Foundry build support is reported separately from architectural fit.">
              {start.discoveryProvenance === "rough" ? (
                <div role="status" className="mb-4 rounded-lg border border-foundry-amber/25 bg-foundry-amber/[0.06] px-3 py-2 text-xs leading-5 text-foundry-muted">
                  Rough local pass — the AI discovery call did not complete. These choices are provisional and are not presented as a verified model recommendation.
                </div>
              ) : null}
              {start.discoveryProvenance === "brief" ? (
                <div role="status" className="mb-4 rounded-lg border border-foundry-teal/25 bg-foundry-teal/[0.06] px-3 py-2 text-xs leading-5 text-foundry-muted">
                  Brief-derived decision: your explicit platform, stack, workflows, and constraints were preserved because the optional model refinement returned an incomplete payload.
                </div>
              ) : null}
              {start.discoveryProvenance === "deterministic" ? (
                <div role="status" className="mb-4 rounded-lg border border-foundry-teal/25 bg-foundry-teal/[0.06] px-3 py-2 text-xs leading-5 text-foundry-muted">
                  Brief-derived decision: your explicit platform and requirements were sufficient to select compatible delivery stacks locally. No discovery model call was needed.
                </div>
              ) : null}
              <div className="grid gap-2.5 sm:grid-cols-2">
                {stackOptions.map((option) => (
                  <StackCard
                    key={option.name}
                    recommendation={{ name: option.name, why: option.why, recommended: option.recommended, defaults: [] }}
                    active={!start.customStack.trim() && start.stack === option.name}
                    onClick={() => selectStack(option.name)}
                  />
                ))}
              </div>

              <label className="mt-6 flex items-baseline gap-2.5 text-[15px]">
                <span className="whitespace-nowrap font-serif italic text-foundry-subtle">or, another stack —</span>
                <input
                  className="flex-1 border-0 border-b border-overlay/10 bg-transparent p-0 pb-1.5 text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/50"
                  value={start.customStack}
                  onChange={(event) => selectStack(start.stack, event.target.value)}
                  placeholder="type any language or framework…"
                />
              </label>

              <p className="mt-5 text-[13px] leading-relaxed text-foundry-muted">{selectedRecommendation.why}</p>
            </FlowSection>
          ) : null}

          {step === "style" ? (
            <FlowSection eyebrow="Foundry is asking" title="What should this feel like?" body="Pick a direction, or describe it yourself — adjectives, a reference app, a mood. This shapes density, color, and motion, not just a label.">
              <div className="flex flex-wrap gap-2.5">
                {styleOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`rounded-full border px-4 py-2.5 text-[13.5px] transition ${
                      !start.customStyle.trim() && start.styleChoice === option
                        ? "border-foundry-teal bg-foundry-teal font-semibold text-foundry-bg"
                        : "border-overlay/10 bg-overlay/[0.04] text-foundry-muted hover:border-overlay/25 hover:text-foundry-ink"
                    }`}
                    onClick={() =>
                      onUpdate({
                        styleChoice: option,
                        customStyle: "",
                        discovery: start.discovery ? applyConfirmedStyle(reconcileKnownStarterDiscovery(start.discovery, start), styleDescriptions[option]) : start.discovery,
                      })
                    }
                  >
                    {option}
                  </button>
                ))}
              </div>

              <label className="mt-7 flex items-baseline gap-2.5 text-[15px]">
                <span className="whitespace-nowrap font-serif italic text-foundry-subtle">or, in your words —</span>
                <input
                  className="flex-1 border-0 border-b border-overlay/10 bg-transparent p-0 pb-1.5 text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/50"
                  value={start.customStyle}
                  onChange={(event) =>
                    onUpdate({
                      customStyle: event.target.value,
                      styleChoice: "",
                      discovery: start.discovery && event.target.value.trim() ? applyConfirmedStyle(reconcileKnownStarterDiscovery(start.discovery, start), event.target.value) : start.discovery,
                    })
                  }
                  placeholder="like the Linear app, but warmer"
                />
              </label>
              <p className="mt-4 text-xs text-foundry-subtle">Foundry carries this into every screen it generates — not just a color swap.</p>
            </FlowSection>
          ) : null}

          {step === "summary" ? (
            <FlowSection eyebrow="Foundry's Understanding" title={start.discovery?.projectType || "Your project"} body="Read Foundry's reasoning below — hover any decision to edit it before building.">
              {start.discovery ? (
                <ProjectDiscoveryMemo
                  start={start}
                  onUpdate={onUpdate}
                />
              ) : (
                <div className="rounded-md border border-foundry-amber/25 bg-foundry-amber/[0.08] p-3 text-sm leading-6 text-foundry-muted">
                  Go back and choose or describe a project first so Foundry can build a confidence map.
                </div>
              )}
            </FlowSection>
          ) : null}

          {step === "instructions" ? (
            <FlowSection eyebrow="Optional" title="Anything else Foundry should know?" body={hasVisualExperience ? "Constraints, features, data fields, brand direction, integrations — leave it empty and Foundry builds from the memo alone." : "Constraints, endpoints, data contracts, integrations, deployment requirements — leave it empty and Foundry builds from the memo alone."}>
              <div className="grid gap-4">
                <textarea
                  className="min-h-32 w-full resize-y border-0 border-b border-overlay/10 bg-transparent p-0 pb-2 font-serif text-[17px] italic leading-8 text-foundry-ink outline-none placeholder:not-italic placeholder:text-foundry-subtle focus:border-foundry-teal/50"
                  value={start.instructions}
                  onChange={(event) => onUpdate({ instructions: event.target.value })}
                  onPaste={(event) => {
                    const pastedFiles = Array.from(event.clipboardData.items)
                      .filter((item) => item.kind === "file")
                      .map((item) => item.getAsFile())
                      .filter((file): file is File => Boolean(file));
                    addInstructionFiles(pastedFiles);
                  }}
                  placeholder={hasVisualExperience ? "roles, pages, workflows, data, integrations, visual style, constraints…" : "endpoints, validation, data contracts, integrations, deployment constraints…"}
                />
                <input
                  ref={instructionAttachmentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addInstructionFiles(Array.from(event.target.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => instructionAttachmentInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-md border border-foundry-teal/25 bg-foundry-teal/[0.07] px-3.5 py-2 text-xs font-bold text-foundry-teal transition hover:border-foundry-teal/45 hover:bg-foundry-teal/[0.12]"
                  >
                    <Paperclip size={14} /> Attach files
                  </button>
                  <p className="text-xs leading-5 text-foundry-subtle">Choose any file, or paste a screenshot directly into the field. Attachments are read with the brief when the build starts.</p>
                </div>
                {start.instructionFiles.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Project brief attachments">
                    {start.instructionFiles.map((file, index) => (
                      <DiscoveryAttachmentPreview
                        key={`${file.name}:${file.size}:${file.lastModified}`}
                        file={file}
                        onRemove={() => onUpdate({ instructionFiles: start.instructionFiles.filter((_, fileIndex) => fileIndex !== index) })}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </FlowSection>
          ) : null}
        </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-overlay/[0.07] px-7 py-5 sm:px-9">
              <button
                className="text-[13px] font-medium text-foundry-subtle transition hover:text-foundry-muted disabled:opacity-30"
                type="button"
                disabled={stepIndex === 0}
                onClick={() => onStepChange(previousStep)}
              >
                ← back
              </button>
              <div className="flex gap-2">
                {step === "understanding" ? null : step !== "instructions" ? (
                  <div className="grid justify-items-end gap-2">
                    {step === "kind" && lacksKindStepSignal(start) ? (
                      <p className="max-w-xs text-right text-xs leading-5 text-foundry-amber">Describe the project first so Foundry has something to analyze.</p>
                    ) : null}
                    {step === "project" && blockedByExistingSource ? (
                      <p className="max-w-xs text-right text-xs leading-5 text-foundry-amber">Choose what Foundry should do about the existing files before continuing.</p>
                    ) : null}
                    <button
                      className="inline-flex items-center gap-2 rounded-md bg-foundry-teal px-5 py-2.5 text-[13.5px] font-bold text-foundry-bg shadow-[0_6px_20px_-8px_rgba(79,209,189,0.7)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-35 disabled:shadow-none"
                      type="button"
                      disabled={(step === "kind" && lacksKindStepSignal(start)) || (step === "project" && blockedByExistingSource)}
                      onClick={() => onStepChange(nextStep)}
                    >
                      Continue <span aria-hidden="true">→</span>
                    </button>
                  </div>
                ) : (
                  <button
                    className="inline-flex items-center gap-2 rounded-md bg-foundry-amber px-5 py-2.5 text-[13.5px] font-bold text-foundry-bg shadow-[0_6px_20px_-8px_rgba(232,183,92,0.7)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-35 disabled:shadow-none"
                    type="button"
                    disabled={blockedByExistingSource}
                    onClick={onCreate}
                  >
                    Looks good — build it <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}

function ExistingProjectFlow({
  start,
  onUpdate,
  onClose,
  onCreate,
}: {
  start: ExistingProjectStart;
  onUpdate: (update: Partial<ExistingProjectStart>) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const existingUploadInputRef = useRef<HTMLInputElement | null>(null);
  const canUseFolderPicker = supportsBrowserFolderAccess();
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("checking");
  const [agentUrl, setAgentUrl] = useState(start.localConnectorUrl || "http://127.0.0.1:3917");
  const [agentToken, setAgentToken] = useState(start.localConnectorToken || "");
  const [folderPathInput, setFolderPathInput] = useState(start.localConnectorRoot || "");
  const [connectError, setConnectError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [connectedFolderEntries, setConnectedFolderEntries] = useState<string[]>([]);
  const [connectedFolderTreeState, setConnectedFolderTreeState] = useState<"idle" | "loading" | "ready" | "error">(start.localConnectorRoot ? "loading" : "idle");
  const [importingUpload, setImportingUpload] = useState(false);
  const everConnectedRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  function selectExistingSource(sourceId: ExistingSource) {
    onUpdate({
      source: sourceId,
      browserFolderHandleId: sourceId === "browser-local" ? start.browserFolderHandleId : "",
      browserFolderName: sourceId === "browser-local" ? start.browserFolderName : "",
      uploadNames: sourceId === "upload" || sourceId === "browser-local" ? start.uploadNames : [],
      uploadedFiles: sourceId === "upload" || sourceId === "browser-local" ? start.uploadedFiles : [],
      localPath: sourceId === "local" ? start.localPath : "",
      localConnectorUrl: sourceId === "browser-local" || sourceId === "connector" ? start.localConnectorUrl : "",
      localConnectorToken: sourceId === "connector" ? start.localConnectorToken : "",
      localConnectorRoot: sourceId === "browser-local" || sourceId === "connector" ? start.localConnectorRoot : "",
      existingSourceConfirmed: false,
      existingSourceChoice: null,
    });
  }
  const canOpenProject =
    start.source === "browser-local"
      ? Boolean(start.browserFolderHandleId)
      : start.source === "connector"
        ? Boolean(start.localConnectorUrl && start.localConnectorRoot && connectedFolderTreeState === "ready")
        : start.source === "local"
          ? Boolean(start.localPath.trim())
          : start.source === "upload"
            ? !importingUpload && start.uploadedFiles.length > 0
            : false;

  const activeSourceNames = start.source === "connector" ? connectedFolderEntries : start.source === "browser-local" || start.source === "upload" ? start.uploadNames : [];
  const existingSourceRisky = activeSourceNames.length > 0 && inspectExistingSourceNames(activeSourceNames, "open-existing").risky;
  const blockedByExistingSource = existingSourceRisky && !start.existingSourceChoice;
  const needsTargetStack = start.action === "convert-existing" || start.action === "clone-existing";
  const targetStackMissing = needsTargetStack && !start.targetStack.trim();

  async function handleExistingUpload(files: FileList | null) {
    setImportingUpload(true);
    try {
      const uploadedFiles = await selectedUploadedFiles(files);
      onUpdate({ uploadNames: uploadedFiles.map((file) => file.path), uploadedFiles, source: "upload", existingSourceConfirmed: false, existingSourceChoice: null });
    } finally {
      setImportingUpload(false);
    }
  }

  async function openBrowserLocalFolder() {
    if (!canUseFolderPicker) {
      onUpdate({ source: "upload", browserFolderHandleId: "", browserFolderName: "" });
      return;
    }
    const folder = await pickBrowserFolder();
    const files = await readBrowserFolderFiles(folder.handle);
    const agent = await detectLocalAgentForFolder(folder.name, start.localConnectorUrl || "http://127.0.0.1:3917");
    onUpdate({
      source: "browser-local",
      browserFolderHandleId: folder.id,
      browserFolderName: folder.name,
      uploadNames: files.map((file) => file.path),
      uploadedFiles: files,
      localPath: "",
      localConnectorUrl: agent ? agent.url : "",
      localConnectorRoot: agent ? agent.root : "",
      localConnectorToken: "",
      existingSourceConfirmed: false,
      existingSourceChoice: null,
    });
  }

  const pollAgentStatus = useCallback(async () => {
    const health = await checkAgentHealth(agentUrl, agentToken);
    if (!health.ok) {
      setAgentStatus(everConnectedRef.current ? "offline" : "not-installed");
      return;
    }
    everConnectedRef.current = true;
    setAgentStatus(start.localConnectorRoot && health.approvedRoots.includes(start.localConnectorRoot) ? "connected" : "installed");
  }, [agentUrl, agentToken, start.localConnectorRoot]);

  useEffect(() => {
    if (start.source !== "connector") return;
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      await pollAgentStatus();
    }

    void poll();
    const interval = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [start.source, pollAgentStatus]);

  useEffect(() => {
    if (start.source !== "connector" || agentStatus !== "connected" || !start.localConnectorRoot) {
      setConnectedFolderEntries([]);
      setConnectedFolderTreeState(start.source === "connector" && start.localConnectorRoot ? "loading" : "idle");
      return;
    }
    let cancelled = false;
    setConnectedFolderTreeState("loading");
    setConnectError("");
    void listAgentTreeWithRetry(agentUrl, agentToken, start.localConnectorRoot).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setConnectedFolderEntries([]);
        setConnectedFolderTreeState("error");
        setConnectError(result.error || "Could not index project files from the connected folder.");
        return;
      }
      const paths = result.entries.map((entry) => entry.path);
      setConnectedFolderEntries(paths);
      setConnectedFolderTreeState("ready");
      onUpdateRef.current({ uploadNames: paths, uploadedFiles: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [start.source, agentStatus, start.localConnectorRoot, agentUrl, agentToken]);

  function applyConnectedFolder(root: string) {
    setConnectedFolderEntries([]);
    setConnectedFolderTreeState("loading");
    onUpdate({ source: "connector", localConnectorUrl: agentUrl, localConnectorToken: agentToken, localConnectorRoot: root, uploadNames: [], uploadedFiles: [], existingSourceConfirmed: false, existingSourceChoice: null });
    setAgentStatus("connected");
    setConnectError("");
  }

  async function handleOpenFolderPicker() {
    setConnectError("");
    const result = await pickAgentFolderNative(agentUrl, agentToken);
    if (result.ok && result.root) {
      applyConnectedFolder(result.root);
      return;
    }
    if (result.cancelled) return;
    if (result.unsupported) {
      setConnectError("Your local agent is running an older connector that cannot open the system folder picker. Download/restart the latest local agent, or paste the folder path under Advanced.");
      return;
    }
    setConnectError(result.error || "Could not open the folder picker.");
  }

  async function handleConnectFolder() {
    const folderPath = folderPathInput.trim();
    if (!folderPath) return;
    setConnecting(true);
    setConnectError("");
    const result = await connectAgentFolder(agentUrl, agentToken, folderPath);
    setConnecting(false);
    if (!result.ok) {
      setConnectError(result.error || "Could not connect that folder.");
      return;
    }
    applyConnectedFolder(result.root || folderPath);
  }

  function openExistingUploadPicker(mode: "files" | "folder") {
    const input = existingUploadInputRef.current;
    if (!input) return;
    input.value = "";
    if (mode === "folder") {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
      input.removeAttribute("accept");
    } else {
      input.removeAttribute("webkitdirectory");
      input.removeAttribute("directory");
      input.setAttribute("accept", ".zip,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.scss,.sass,.less,.html,.py,.cs,.java,.kt,.php,.go,.rs,.rb,.swift,.dart,.sql,.xml,.yml,.yaml,.toml,.sh,.ps1,.log");
    }
    input.click();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-shade/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <section className="grid max-h-[90vh] w-full max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-overlay/15 bg-foundry-raised shadow-workspace">
        <header className="flex items-start justify-between gap-4 border-b border-overlay/10 p-4">
          <div>
            <p className="section-kicker">Open Existing Project</p>
            <h2 className="mt-1 text-lg font-extrabold text-foundry-ink">Bring a project into Foundry</h2>
          </div>
          <button className="rounded-md px-3 py-1.5 text-sm font-bold text-foundry-muted hover:bg-overlay/10 hover:text-foundry-ink" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="min-h-0 overflow-auto p-4">
          <input
            ref={existingUploadInputRef}
            className="sr-only"
            type="file"
            multiple
            onChange={(event) => {
              void handleExistingUpload(event.currentTarget.files);
            }}
          />
          <FlowSection eyebrow="Bring a project into Foundry" title="Where's the project?" body="Connect Local Agent is the recommended way to work on a real project with real commands. Import Copy is a fallback that only edits a copy of what you upload.">
            <div className="grid gap-2">
              {existingSourceOptions
                .filter((source) => source.id === "connector" || source.id === "upload")
                .map((source) => (
                  <ChoiceButton
                    key={source.id}
                    active={start.source === source.id}
                    label={source.label}
                    description={`${source.description} Status: ${source.status}.`}
                    onClick={() => selectExistingSource(source.id)}
                  />
                ))}
            </div>

            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-[0.06em] text-foundry-subtle">Advanced: other ways to connect</summary>
              <div className="mt-2 grid gap-2">
                {existingSourceOptions
                  .filter((source) => source.id !== "connector" && source.id !== "upload")
                  .map((source) => (
                    <ChoiceButton
                      key={source.id}
                      active={start.source === source.id}
                      label={source.label}
                      description={`${source.description} Status: ${source.status}.`}
                      disabled={source.id === "github-later"}
                      onClick={() => selectExistingSource(source.id)}
                    />
                  ))}
              </div>
            </details>

            {start.source === "browser-local" ? (
              <div className="mt-4 rounded-md border border-foundry-teal/20 bg-foundry-teal/[0.06] p-3">
                <p className="section-kicker">Connected Live Folder</p>
                <p className="mt-2 text-sm leading-6 text-foundry-muted">
                  {canUseFolderPicker
                    ? "Pick a folder. Foundry stores the browser folder handle after permission and writes changes back to that folder from this browser."
                    : "This browser does not support live folder access. Use Import Copy, or paste a local folder path if this environment can access it."}
                </p>
                <button
                  className="mt-3 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={!canUseFolderPicker}
                  onClick={() => {
                    void openBrowserLocalFolder();
                  }}
                >
                  Open Local Folder
                </button>
                {start.browserFolderName ? (
                  <p className="mt-3 text-sm font-bold text-foundry-ink">Connected (live folder): {start.browserFolderName}</p>
                ) : null}
                {start.localConnectorRoot ? (
                  <p className="mt-2 text-xs leading-5 text-foundry-teal">Local agent attached for permanent commands.</p>
                ) : null}
                <UploadSummary names={start.uploadNames} />
                <ExistingSourceGuard
                  names={start.uploadNames}
                  mode="open-existing"
                  choice={start.existingSourceChoice}
                  onChoose={(choice) => onUpdate({ existingSourceChoice: choice, existingSourceConfirmed: true })}
                  onCancel={() => onUpdate({ browserFolderHandleId: "", browserFolderName: "", uploadNames: [], uploadedFiles: [], existingSourceChoice: null, existingSourceConfirmed: false })}
                />
              </div>
            ) : null}

            {start.source === "connector" ? (
              <div className="mt-4 rounded-md border border-foundry-teal/20 bg-foundry-teal/[0.06] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="section-kicker">Foundry Local Agent</p>
                  <AgentStatusBadge status={agentStatus} />
                </div>

                {agentStatus === "checking" ? (
                  <p className="mt-2 text-sm leading-6 text-foundry-muted">Checking for the Foundry Local Agent on this computer...</p>
                ) : agentStatus === "not-installed" ? (
                  <>
                    <p className="mt-2 text-sm leading-6 text-foundry-muted">
                      The Local Agent lets Foundry read, write, and run real commands against a real folder on this computer — real <code className="rounded bg-shade/30 px-1 py-0.5 font-mono text-[11px]">node_modules</code>, real dev server, not a throwaway copy. Install it once, then connect any project folder.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]" href="/api/factory/agent/download?platform=windows" download>
                        Download for Windows
                      </a>
                      <a className="rounded-md border border-overlay/15 bg-overlay/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink" href="/api/factory/agent/download?platform=mac" download>
                        macOS
                      </a>
                      <a className="rounded-md border border-overlay/15 bg-overlay/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink" href="/api/factory/agent/download?platform=linux" download>
                        Linux
                      </a>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-foundry-subtle">
                      Requires Node.js already installed (get it from nodejs.org if needed). Run the downloaded file once — it installs itself, starts running, and relaunches automatically every time you log in, so you will not need to run it again. Then check again below.
                      On macOS you may need to right-click the downloaded file and choose Open the first time.
                    </p>
                    <button
                      className="mt-3 rounded-md border border-overlay/15 bg-overlay/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink"
                      type="button"
                      onClick={() => {
                        setAgentStatus("checking");
                        void pollAgentStatus();
                      }}
                    >
                      I&apos;ve installed it — Check again
                    </button>
                  </>
                ) : (
                  <>
                    {agentStatus === "offline" ? (
                      <p className="mt-2 text-sm font-bold text-red-300">The agent isn&apos;t responding anymore. Make sure the window it opened is still running, then check again.</p>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-foundry-muted">Agent detected. Pick the real folder you want Foundry to work on — you can connect a different folder any time.</p>
                    )}
                    <button
                      className="mt-3 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]"
                      type="button"
                      onClick={() => void handleOpenFolderPicker()}
                    >
                      Open Project Folder
                    </button>
                    {agentStatus === "connected" && start.localConnectorRoot ? (
                      <>
                        <p className="mt-3 text-sm font-bold text-foundry-teal">Connected: {start.localConnectorRoot}</p>
                        {connectedFolderTreeState === "loading" ? (
                          <p className="mt-2 text-xs font-bold text-foundry-muted">Indexing project files… The project will open as soon as its file tree is ready.</p>
                        ) : connectedFolderTreeState === "ready" ? (
                          <p className="mt-2 text-xs font-bold text-foundry-teal">{connectedFolderEntries.length} readable project file{connectedFolderEntries.length === 1 ? "" : "s"} detected.</p>
                        ) : connectedFolderTreeState === "error" ? (
                          <p className="mt-2 text-xs font-bold text-red-300">{connectError || "Project files could not be indexed."}</p>
                        ) : null}
                        <ExistingSourceGuard
                          names={connectedFolderEntries}
                          mode="open-existing"
                          choice={start.existingSourceChoice}
                          onChoose={(choice) => onUpdate({ existingSourceChoice: choice, existingSourceConfirmed: true })}
                          onCancel={() => onUpdate({ localConnectorRoot: "", existingSourceChoice: null, existingSourceConfirmed: false })}
                        />
                      </>
                    ) : connectError ? (
                      <p className="mt-3 text-sm font-bold text-red-300">{connectError}</p>
                    ) : null}
                  </>
                )}

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-[0.06em] text-foundry-subtle">Advanced: paste a path / agent URL / token</summary>
                  <div className="mt-2 grid gap-2">
                    <label className="grid gap-1.5 text-xs font-bold text-foundry-muted">
                      Project folder path
                      <input
                        className="min-h-10 rounded-md border border-overlay/10 bg-shade/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                        value={folderPathInput}
                        onChange={(event) => setFolderPathInput(event.target.value)}
                        placeholder="C:\Users\you\Documents\your-project"
                      />
                    </label>
                    <button
                      className="justify-self-start rounded-md border border-overlay/15 bg-overlay/[0.05] px-3 py-2 text-xs font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={connecting || !folderPathInput.trim()}
                      onClick={() => {
                        void handleConnectFolder();
                      }}
                    >
                      {connecting ? "Connecting..." : "Connect Folder"}
                    </button>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-xs font-bold text-foundry-muted">
                        Agent URL
                        <input
                          className="min-h-10 rounded-md border border-overlay/10 bg-shade/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                          value={agentUrl}
                          onChange={(event) => setAgentUrl(event.target.value)}
                          placeholder="http://127.0.0.1:3917"
                        />
                      </label>
                      <label className="grid gap-1.5 text-xs font-bold text-foundry-muted">
                        Token (optional)
                        <input
                          className="min-h-10 rounded-md border border-overlay/10 bg-shade/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                          value={agentToken}
                          onChange={(event) => setAgentToken(event.target.value)}
                          placeholder="Only if the agent was started with a token"
                        />
                      </label>
                    </div>
                  </div>
                </details>
              </div>
            ) : null}

            {folderBrowserOpen ? (
              <FolderBrowserModal
                agentUrl={agentUrl}
                agentToken={agentToken}
                onClose={() => setFolderBrowserOpen(false)}
                onSelect={(root) => {
                  setFolderBrowserOpen(false);
                  setFolderPathInput(root);
                  applyConnectedFolder(root);
                }}
              />
            ) : null}

            {start.source === "upload" ? (
              <div className="mt-4 rounded-md border border-foundry-blue/20 bg-foundry-blue/[0.06] p-3">
                <p className="section-kicker">Import Foundry Copy</p>
                <p className="mt-2 text-sm leading-6 text-foundry-muted">
                  Choose project files or a folder. Foundry imports them into its own writable copy. Your original VS Code folder will not change from this option.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-md border border-overlay/15 bg-overlay/[0.055] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-blue/35 hover:bg-foundry-blue/10 hover:text-foundry-ink"
                    type="button"
                    onClick={() => openExistingUploadPicker("files")}
                  >
                    Choose ZIP/project files
                  </button>
                  <button
                    className="rounded-md border border-overlay/15 bg-overlay/[0.055] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-blue/35 hover:bg-foundry-blue/10 hover:text-foundry-ink"
                    type="button"
                    onClick={() => openExistingUploadPicker("folder")}
                  >
                    Import folder copy
                  </button>
                </div>
                <UploadSummary names={start.uploadNames} />
                {importingUpload ? <p className="mt-2 text-xs font-bold text-foundry-muted">Reading and indexing uploaded project files…</p> : start.uploadedFiles.length ? <p className="mt-2 text-xs font-bold text-foundry-teal">{start.uploadedFiles.length} readable project file{start.uploadedFiles.length === 1 ? "" : "s"} ready.</p> : null}
                <ExistingSourceGuard
                  names={start.uploadNames}
                  mode="open-existing"
                  choice={start.existingSourceChoice}
                  onChoose={(choice) => onUpdate({ existingSourceChoice: choice, existingSourceConfirmed: true })}
                  onCancel={() => onUpdate({ uploadNames: [], uploadedFiles: [], existingSourceChoice: null, existingSourceConfirmed: false })}
                />
              </div>
            ) : null}

            {start.source === "local" ? (
              <div className="mt-4 rounded-md border border-foundry-teal/20 bg-foundry-teal/[0.06] p-3">
                <p className="section-kicker">Local Folder Direct Edit</p>
                <p className="mt-2 text-sm leading-6 text-foundry-muted">
                  Paste the exact folder path from your editor. Foundry will read and write that folder directly, so changes should appear in VS Code.
                </p>
                <label className="mt-3 grid gap-1.5 text-xs font-bold text-foundry-muted">
                  Folder path
                  <input
                    className="min-h-10 rounded-md border border-overlay/10 bg-shade/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                    value={start.localPath}
                    onChange={(event) => onUpdate({ localPath: event.target.value })}
                    placeholder="C:\\Users\\you\\Documents\\your-project"
                  />
                </label>
              </div>
            ) : null}

            {needsTargetStack ? (
              <div className="mt-4 rounded-md border border-foundry-amber/25 bg-foundry-amber/[0.06] p-3">
                <p className="section-kicker">
                  {start.action === "clone-existing" ? "Clone target" : "Migration target"}
                </p>
                <p className="mt-1.5 text-xs leading-5 text-foundry-muted">
                  {start.action === "clone-existing"
                    ? "Foundry builds a new copy of this project in the stack below, feature-by-feature — not a line-by-line translation — and leaves the original untouched."
                    : "Foundry builds the new implementation alongside the current one and only removes old files once the migration is verified."}
                </p>
                <label className="mt-3 grid gap-1.5 text-xs font-bold text-foundry-muted">
                  Target stack
                  <input
                    className="min-h-10 rounded-md border border-overlay/10 bg-shade/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-amber/45"
                    value={start.targetStack}
                    onChange={(event) => onUpdate({ targetStack: event.target.value })}
                    placeholder="e.g. Next.js (TypeScript), Python/FastAPI, .NET WPF…"
                  />
                </label>
              </div>
            ) : null}

            <label className="mt-4 grid gap-1.5 text-xs font-bold text-foundry-muted">
              {needsTargetStack ? "What should Foundry know before migrating?" : "Optional project context"}
              <textarea
                className="min-h-36 w-full resize-y rounded-md border border-overlay/10 bg-shade/25 p-3 text-sm leading-6 text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                value={start.description}
                onChange={(event) => onUpdate({ description: event.target.value })}
                placeholder={needsTargetStack ? "Anything Foundry should preserve, avoid, or prioritize during the migration…" : "Example: This is a Next.js storefront. The current priority is fixing checkout bugs and preparing for Vercel later..."}
              />
            </label>

            <div className="mt-4 rounded-md border border-foundry-amber/25 bg-foundry-amber/[0.08] p-3 text-sm leading-6 text-foundry-muted">
              Import copy mode creates a Foundry workspace folder and requires export. Local folder path mode edits the original folder on disk.
            </div>
          </FlowSection>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-overlay/10 p-4">
          {blockedByExistingSource ? <p className="mr-auto max-w-xs text-xs leading-5 text-foundry-amber">Choose what Foundry should do about the existing files before opening this project.</p> : null}
          <button className="rounded-md px-3 py-2 text-sm font-bold text-foundry-muted transition hover:bg-overlay/10 hover:text-foundry-ink" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded-md border border-foundry-amber/35 bg-foundry-amber/[0.12] px-4 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-amber/[0.18] disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            disabled={!canOpenProject || blockedByExistingSource || targetStackMissing}
            onClick={onCreate}
          >
            {needsTargetStack ? (start.action === "clone-existing" ? "Clone Project" : "Convert Project") : start.source === "upload" ? "Open Foundry Copy" : "Open Project"}
          </button>
        </footer>
      </section>
    </div>
  );
}

type AgentStatus = "checking" | "not-installed" | "installed" | "connected" | "offline";

const AGENT_SEEN_KEY = "foundry-local-agent-seen";

function useLocalAgentInstallStatus(): AgentStatus {
  const [status, setStatus] = useState<AgentStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const health = await checkAgentHealth("http://127.0.0.1:3917", "");
      if (cancelled) return;
      if (health.ok) {
        try { localStorage.setItem(AGENT_SEEN_KEY, "1"); } catch { /* ignore */ }
        setStatus("installed");
        return;
      }
      // A failed health check on a machine where the agent has responded before means
      // "installed but not running" — not "never installed". Regressing to the download
      // CTA in that case misleads the user about the actual fix (start the agent).
      let seenBefore = false;
      try { seenBefore = localStorage.getItem(AGENT_SEEN_KEY) === "1"; } catch { /* ignore */ }
      setStatus(seenBefore ? "offline" : "not-installed");
    }

    void poll();
    const interval = window.setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return status;
}

function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const config: Record<AgentStatus, { label: string; className: string }> = {
    checking: { label: "Checking...", className: "border-overlay/15 bg-overlay/[0.05] text-foundry-subtle" },
    "not-installed": { label: "Agent Not Installed", className: "border-overlay/15 bg-overlay/[0.05] text-foundry-subtle" },
    installed: { label: "Agent Connected", className: "border-foundry-teal/30 bg-foundry-teal/[0.1] text-foundry-teal" },
    connected: { label: "Agent Connected", className: "border-foundry-teal/30 bg-foundry-teal/[0.1] text-foundry-teal" },
    offline: { label: "Agent Offline", className: "border-red-400/30 bg-red-400/[0.1] text-red-300" },
  };
  const { label, className } = config[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] ${className}`}>{label}</span>;
}

async function checkAgentHealth(agentUrl: string, token: string): Promise<{ ok: boolean; approvedRoots: string[] }> {
  const normalizedAgentUrl = (agentUrl.trim() || "http://127.0.0.1:3917").replace(/\/+$/, "");
  try {
    const response = await fetch("/api/factory/agent/health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: normalizedAgentUrl, token }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; approvedRoots?: string[] };
    if (response.ok && result.ok) {
      return { ok: true, approvedRoots: Array.isArray(result.approvedRoots) ? result.approvedRoots : [] };
    }
  } catch {
    // Fall back to direct browser access below for older dev servers or non-Next shells.
  }

  try {
    const headers: Record<string, string> = {};
    if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
    const response = await fetch(`${normalizedAgentUrl}/health`, { method: "GET", headers });
    if (!response.ok) return { ok: false, approvedRoots: [] };
    const result = (await response.json()) as { ok?: boolean; approvedRoots?: string[] };
    return { ok: Boolean(result.ok), approvedRoots: Array.isArray(result.approvedRoots) ? result.approvedRoots : [] };
  } catch {
    return { ok: false, approvedRoots: [] };
  }
}

async function connectAgentFolder(agentUrl: string, token: string, folderPath: string): Promise<{ ok: boolean; root?: string; error?: string }> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
    const response = await fetch(`${agentUrl.replace(/\/+$/, "")}/connect`, { method: "POST", headers, body: JSON.stringify({ path: folderPath }) });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; root?: string; error?: string };
    if (!response.ok || !result.ok) return { ok: false, error: result.error || `Agent responded with HTTP ${response.status}.` };
    return { ok: true, root: result.root };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach the local agent." };
  }
}

type BrowseEntry = { name: string; path: string };
type BrowseResult = { ok: boolean; path: string; parent: string | null; entries: BrowseEntry[]; error?: string };

async function browseAgentFolder(agentUrl: string, token: string, targetPath: string): Promise<BrowseResult> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
    const response = await fetch(`${agentUrl.replace(/\/+$/, "")}/browse`, { method: "POST", headers, body: JSON.stringify({ path: targetPath }) });
    const result = (await response.json().catch(() => ({}))) as Partial<BrowseResult>;
    if (!response.ok || !result.ok) return { ok: false, path: targetPath, parent: null, entries: [], error: result.error || `Agent responded with HTTP ${response.status}.` };
    return { ok: true, path: result.path ?? targetPath, parent: result.parent ?? null, entries: result.entries ?? [] };
  } catch (error) {
    return { ok: false, path: targetPath, parent: null, entries: [], error: error instanceof Error ? error.message : "Could not reach the local agent." };
  }
}

async function createAgentFolder(agentUrl: string, token: string, parentPath: string, name: string): Promise<{ ok: boolean; root?: string; error?: string }> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
    const response = await fetch(`${agentUrl.replace(/\/+$/, "")}/create-folder`, { method: "POST", headers, body: JSON.stringify({ path: parentPath, name }) });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; root?: string; error?: string };
    if (!response.ok || !result.ok) return { ok: false, error: result.error || `Agent responded with HTTP ${response.status}.` };
    return { ok: true, root: result.root };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach the local agent." };
  }
}

async function pickAgentFolderNative(agentUrl: string, token: string): Promise<{ ok: boolean; root?: string; cancelled?: boolean; unsupported?: boolean; error?: string }> {
  const normalizedAgentUrl = (agentUrl.trim() || "http://127.0.0.1:3917").replace(/\/+$/, "");
  try {
    const response = await fetch("/api/factory/agent/pick-folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: normalizedAgentUrl, token }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; root?: string; cancelled?: boolean; unsupported?: boolean; error?: string };
    if (response.ok && (result.ok || result.cancelled || result.unsupported || result.error)) {
      return result.ok
        ? { ok: true, root: result.root }
        : { ok: false, cancelled: result.cancelled, unsupported: result.unsupported, error: result.error };
    }
  } catch {
    // Fall back to direct browser access below for older dev servers or non-Next shells.
  }

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
    const response = await fetch(`${normalizedAgentUrl}/pick-folder`, { method: "POST", headers, body: JSON.stringify({}) });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; root?: string; cancelled?: boolean; unsupported?: boolean; error?: string };
    if (!response.ok) {
      const error = result.error || `Agent responded with HTTP ${response.status}.`;
      if (response.status === 404 || /unknown connector endpoint/i.test(error)) return { ok: false, unsupported: true };
      return { ok: false, error };
    }
    return result.ok
      ? { ok: true, root: result.root }
      : { ok: false, cancelled: result.cancelled, unsupported: result.unsupported, error: result.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach the local agent." };
  }
}

function FolderBrowserModal({
  agentUrl,
  agentToken,
  onSelect,
  onClose,
}: {
  agentUrl: string;
  agentToken: string;
  onSelect: (root: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const load = useCallback(
    async (targetPath: string) => {
      setLoading(true);
      setError("");
      const result = await browseAgentFolder(agentUrl, agentToken, targetPath);
      setLoading(false);
      if (!result.ok) {
        setError(result.error || "Could not open that folder.");
        return;
      }
      setCurrentPath(result.path);
      setParentPath(result.parent);
      setEntries(result.entries);
    },
    [agentUrl, agentToken],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  async function handleUseThisFolder() {
    if (!currentPath) return;
    setBusy(true);
    setError("");
    const result = await connectAgentFolder(agentUrl, agentToken, currentPath);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Could not connect that folder.");
      return;
    }
    onSelect(result.root || currentPath);
  }

  async function handleCreateFolder() {
    if (!currentPath || !newFolderName.trim()) return;
    setBusy(true);
    setError("");
    const result = await createAgentFolder(agentUrl, agentToken, currentPath, newFolderName.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Could not create that folder.");
      return;
    }
    onSelect(result.root || currentPath);
  }

  const breadcrumbSegments = currentPath ? currentPath.replace(/\\/g, "/").split("/").filter(Boolean) : [];

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-shade/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <section className="grid max-h-[85vh] w-full max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-overlay/15 bg-foundry-raised shadow-workspace">
        <header className="flex items-start justify-between gap-4 border-b border-overlay/10 p-4">
          <div>
            <p className="section-kicker">Local Agent</p>
            <h2 className="mt-1 text-lg font-extrabold text-foundry-ink">Choose a Project Folder</h2>
          </div>
          <button className="rounded-md px-3 py-1.5 text-sm font-bold text-foundry-muted hover:bg-overlay/10 hover:text-foundry-ink" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="min-h-0 overflow-auto p-4">
          <p className="truncate text-xs font-mono text-foundry-subtle" title={currentPath}>
            {currentPath ? breadcrumbSegments.join(" / ") : "This computer"}
          </p>

          {loading ? (
            <p className="mt-4 text-sm text-foundry-muted">Loading folders...</p>
          ) : error ? (
            <p className="mt-4 text-sm font-bold text-red-300">{error}</p>
          ) : (
            <div className="mt-3 grid gap-1">
              {parentPath !== null ? (
                <button
                  className="flex items-center gap-2 rounded-md border border-overlay/10 bg-overlay/[0.03] px-3 py-2 text-left text-sm font-bold text-foundry-muted transition hover:border-foundry-teal/30 hover:bg-overlay/[0.06] hover:text-foundry-ink"
                  type="button"
                  onClick={() => void load(parentPath)}
                >
                  .. Up one folder
                </button>
              ) : null}
              {entries.length === 0 ? (
                <p className="px-1 py-2 text-sm text-foundry-subtle">No subfolders here.</p>
              ) : (
                entries.map((entry) => (
                  <button
                    key={entry.path}
                    className="flex items-center gap-2 rounded-md border border-overlay/10 bg-overlay/[0.03] px-3 py-2 text-left text-sm font-bold text-foundry-ink transition hover:border-foundry-teal/30 hover:bg-overlay/[0.06]"
                    type="button"
                    onClick={() => void load(entry.path)}
                  >
                    {entry.name}
                  </button>
                ))
              )}
            </div>
          )}

          {currentPath && !loading ? (
            <div className="mt-4 border-t border-overlay/10 pt-3">
              {newFolderOpen ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="min-h-9 flex-1 rounded-md border border-overlay/10 bg-shade/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder="New folder name"
                    autoFocus
                  />
                  <button
                    className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-xs font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={busy || !newFolderName.trim()}
                    onClick={() => void handleCreateFolder()}
                  >
                    Create &amp; Use
                  </button>
                  <button
                    className="rounded-md px-2 py-2 text-xs font-bold text-foundry-muted hover:text-foundry-ink"
                    type="button"
                    onClick={() => {
                      setNewFolderOpen(false);
                      setNewFolderName("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="text-xs font-extrabold uppercase tracking-[0.06em] text-foundry-teal hover:underline"
                  type="button"
                  onClick={() => setNewFolderOpen(true)}
                >
                  + New folder here
                </button>
              )}
            </div>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-overlay/10 p-4">
          <button className="rounded-md px-3 py-2 text-sm font-bold text-foundry-muted transition hover:bg-overlay/10 hover:text-foundry-ink" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-4 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={busy || !currentPath || loading}
            onClick={() => void handleUseThisFolder()}
          >
            {busy ? "Connecting..." : "Use This Folder"}
          </button>
        </footer>
      </section>
    </div>
  );
}

async function detectLocalAgentForFolder(folderName: string, agentUrl: string) {
  const health = await checkAgentHealth(agentUrl, "");
  if (!health.ok) return null;
  const match = health.approvedRoots.find((candidate) => (candidate.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "").toLowerCase() === folderName.toLowerCase());
  return match ? { url: agentUrl, root: match } : null;
}

function FlowSection({ eyebrow, title, body, children }: { eyebrow: string; title: string; body: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3.5 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-foundry-teal">
        <span className="inline-block h-px w-3.5 bg-foundry-teal" aria-hidden="true" />
        {eyebrow}
      </div>
      <h1 className="max-w-2xl text-balance font-serif text-[32px] font-medium leading-[1.22] tracking-tight text-foundry-ink">{title}</h1>
      <p className="mt-2.5 max-w-lg text-[14.5px] leading-relaxed text-foundry-muted">{body}</p>
      <div className="mt-7">{children}</div>
    </section>
  );
}

function ChoiceButton({ active, label, description, disabled = false, onClick }: { active: boolean; label: string; description?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      className={`min-h-11 rounded-lg border px-3.5 py-2.5 text-left text-[13.5px] font-semibold transition ${
        disabled
          ? "cursor-not-allowed border-overlay/[0.06] bg-overlay/[0.015] text-foundry-subtle opacity-60"
          : active
            ? "border-foundry-teal/45 bg-foundry-teal/[0.08] text-foundry-ink"
            : "border-overlay/10 bg-overlay/[0.03] text-foundry-muted hover:border-overlay/20 hover:text-foundry-ink"
      }`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="block">{label}</span>
      {description ? <span className="mt-1 block text-xs font-medium leading-5 text-foundry-subtle">{description}</span> : null}
    </button>
  );
}

function ChipButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2.5 text-[13.5px] transition ${
        active ? "border-foundry-teal bg-foundry-teal font-semibold text-foundry-bg" : "border-overlay/10 bg-overlay/[0.04] text-foundry-muted hover:border-overlay/25 hover:text-foundry-ink"
      }`}
    >
      {label}
    </button>
  );
}

function CapabilityBadge({ level }: { level: number }) {
  const styles: Record<number, string> = {
    4: "border-foundry-teal/40 text-foundry-teal",
    3: "border-foundry-amber/45 text-foundry-amber",
    2: "border-overlay/15 text-foundry-muted",
    1: "border-red-300/40 text-red-300",
  };
  return <span title="Foundry build and verification support" aria-label={`Foundry build support ${level} of 4`} className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9.5px] tracking-wide ${styles[level] ?? styles[2]}`}>build support {level}/4</span>;
}

function StackCard({ recommendation, active, onClick }: { recommendation: StackRecommendation; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-4 py-4 text-left transition ${
        active ? "border-foundry-teal/50 bg-foundry-teal/[0.07] shadow-[inset_0_0_0_1px_rgba(79,209,189,0.3)]" : "border-overlay/10 bg-overlay/[0.03] hover:border-overlay/20"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-serif text-[19px] text-foundry-ink">{recommendation.name}</span>
        {recommendation.recommended ? <span className="font-mono text-[9.5px] uppercase tracking-wider text-foundry-amber">★ recommended</span> : null}
      </div>
      <p className="m-0 text-[12.5px] leading-relaxed text-foundry-muted">{recommendation.why}</p>
      <div className="mt-2.5">
        <CapabilityBadge level={capabilityLevelForStackChoice(recommendation.name).level} />
      </div>
    </button>
  );
}

function UploadSummary({ names }: { names: string[] }) {
  if (!names.length) {
    return <p className="mt-3 text-xs leading-5 text-foundry-subtle">No files selected yet.</p>;
  }

  const visible = names.slice(0, 5);
  const hiddenCount = Math.max(names.length - visible.length, 0);

  return (
    <div className="mt-3 rounded-md border border-overlay/10 bg-shade/20 p-3">
      <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-foundry-muted">Selected</p>
      <ul className="mt-2 grid gap-1 text-xs leading-5 text-foundry-muted">
        {visible.map((name) => (
          <li key={name} className="truncate">{name}</li>
        ))}
      </ul>
      {hiddenCount ? <p className="mt-2 text-xs text-foundry-subtle">+{hiddenCount} more file{hiddenCount === 1 ? "" : "s"}</p> : null}
    </div>
  );
}

type ExistingSourceGuardMode = "new-project" | "open-existing";

/**
 * Real gating, not a cosmetic checkbox: when the inspected source looks risky
 * (existing/unrelated project, multiple roots, repo/build noise), the caller
 * must disable its action button until `choice` is non-null. See gating call
 * sites in ProjectStartFlow and ExistingProjectFlow.
 */
function ExistingSourceGuard({
  names,
  mode,
  choice,
  onChoose,
  onCreateSubfolder,
  onCancel,
}: {
  names: string[];
  mode: ExistingSourceGuardMode;
  choice: ExistingFolderChoice | null;
  onChoose: (choice: ExistingFolderChoice) => void;
  onCreateSubfolder?: () => void;
  onCancel: () => void;
}) {
  if (!names.length) {
    return (
      <div className="mt-3 rounded-md border border-overlay/10 bg-shade/20 p-3 text-xs leading-5 text-foundry-subtle">
        {mode === "open-existing"
          ? "Select a folder or project files before Foundry opens this project."
          : "Select a folder or project files before Foundry uses an existing source as a starting reference for this new project."}
      </div>
    );
  }

  const inspection = inspectExistingSourceNames(names, mode);

  if (!inspection.risky) {
    return (
      <div className="mt-3 rounded-md border border-foundry-teal/25 bg-foundry-teal/[0.07] p-3">
        <p className="section-kicker">{mode === "open-existing" ? "Project Selected" : "Existing Source Inspection"}</p>
        <p className="mt-2 text-sm leading-6 text-foundry-muted">{inspection.message}</p>
        <ul className="mt-2 grid gap-1 text-xs leading-5 text-foundry-subtle">
          {inspection.signals.map((signal) => (
            <li key={signal}>- {signal}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-foundry-amber/30 bg-foundry-amber/[0.08] p-3">
      <p className="section-kicker">{mode === "open-existing" ? "Multiple Projects Detected" : "Existing Source Inspection"}</p>
      <p className="mt-2 text-sm leading-6 text-foundry-muted">{inspection.message}</p>
      <ul className="mt-2 grid gap-1 text-xs leading-5 text-foundry-subtle">
        {inspection.signals.map((signal) => (
          <li key={signal}>- {signal}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs font-extrabold uppercase tracking-[0.08em] text-foundry-muted">
        {mode === "open-existing" ? "Foundry found files that don't appear related. What should happen?" : "I found files that don't appear related. What should Foundry do?"}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {mode === "new-project" ? (
          <>
            {onCreateSubfolder ? (
              <ChoiceButton active={choice === "create-subfolder"} label="Create a new subfolder" description="Foundry creates a fresh subfolder here and builds inside it." onClick={onCreateSubfolder} />
            ) : null}
            <ChoiceButton active={choice === "archive"} label="Archive existing files first" description="Foundry moves existing content aside before generating (applied when the build starts)." onClick={() => onChoose("archive")} />
            <ChoiceButton active={choice === "continue-anyway"} label="Continue anyway" description="Generate here without touching or moving anything first." onClick={() => onChoose("continue-anyway")} />
            <ChoiceButton active={false} label="Cancel / choose another location" onClick={onCancel} />
          </>
        ) : (
          <>
            <ChoiceButton active={choice === "continue"} label="Continue - this is my project" description="Foundry will inspect before making any changes." onClick={() => onChoose("continue")} />
            <ChoiceButton active={false} label="Choose a different folder / cancel" onClick={onCancel} />
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="font-extrabold text-foundry-subtle">{label}</dt>
      <dd className="text-foundry-ink">{value}</dd>
    </div>
  );
}

function ProjectDiscoveryMemo({ start, onUpdate }: { start: ProjectStart; onUpdate: (update: Partial<ProjectStart>) => void }) {
  const { showModelNames } = useModelMode();
  const discovery = start.discovery;
  if (!discovery) return null;
  const currentDiscovery = discovery;

  function updateDiscovery(update: Partial<ProjectDiscoveryResult>) {
    const nextDiscovery: ProjectDiscoveryResult = {
      prompt: update.prompt ?? currentDiscovery.prompt,
      projectType: update.projectType ?? currentDiscovery.projectType,
      recommendedStack: update.recommendedStack ?? currentDiscovery.recommendedStack,
      architecture: update.architecture ?? currentDiscovery.architecture,
      mainFeatures: update.mainFeatures ?? currentDiscovery.mainFeatures,
      styleDirection: update.styleDirection ?? currentDiscovery.styleDirection,
      dataModel: update.dataModel ?? currentDiscovery.dataModel,
      assumptions: update.assumptions ?? currentDiscovery.assumptions,
      questions: update.questions ?? currentDiscovery.questions,
      decisions: update.decisions ?? currentDiscovery.decisions,
      keyFacts: update.keyFacts ?? currentDiscovery.keyFacts,
      futureCapabilities: update.futureCapabilities ?? currentDiscovery.futureCapabilities,
    };
    onUpdate({ discovery: nextDiscovery });
  }

  function updateList(key: "mainFeatures" | "dataModel", value: string) {
    updateDiscovery({ [key]: value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) });
  }

  const disclosedDecisions = discovery.decisions.filter((decision) => decision.action !== "silent-infer");
  const questionDecisions = discovery.decisions.filter((decision) => decision.action === "ask").slice(0, 3);
  const alternativeStacks = alternativeStacksFor(start);
  const stackCapability = capabilityLevelForStackChoice(selectedStackFor(start));
  const stackCapabilityNote = stackCapabilityNoteFor(stackCapability);
  const memoSections = memoSectionsFor(discovery.decisions);

  function applyAlternativeStack(name: string) {
    const stackChanged = name !== currentDiscovery.recommendedStack;
    const nextArchitecture = stackChanged ? genericArchitectureFor(name, currentDiscovery.dataModel, currentDiscovery.projectType, currentDiscovery.mainFeatures) : currentDiscovery.architecture;
    updateDiscovery({
      recommendedStack: name,
      architecture: nextArchitecture,
      decisions: stackChanged
        ? currentDiscovery.decisions.map((decision) => (decision.dimension === "architecture" ? { ...decision, hypothesis: nextArchitecture } : decision))
        : currentDiscovery.decisions,
      keyFacts: stackChanged ? refreshArchitectureKeyFact(currentDiscovery.keyFacts, currentDiscovery.recommendedStack, name) : currentDiscovery.keyFacts,
    });
    onUpdate({ stack: name, customStack: "" });
  }

  return (
    <div className="grid gap-9">
      <div>
        <div className="flex items-center gap-2">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">Foundry&apos;s Understanding</p>
          <ModelSelectionChip selection={start.modelSelection} showModelNames={showModelNames} />
        </div>
        <p className="font-serif text-[17px] leading-[1.75] text-foundry-ink">{ledeFor(start)}</p>
      </div>

      {discovery.keyFacts.length ? (
        <div>
          <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">What Foundry Already Knows</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {discovery.keyFacts.map((fact, index) => (
              <li key={`${fact}-${index}`} className="flex items-baseline gap-2 text-[13.5px] leading-relaxed text-foundry-ink">
                <CheckCircle2 size={13} className="mt-[3px] shrink-0 text-foundry-teal" />
                {fact}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {memoSections.map((section) => (
        <div key={section.label}>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">{section.label}</p>
          <ul className="grid gap-3.5">
            {section.items.map((decision) => (
              <li key={decision.dimension}>
                <div className="flex items-baseline gap-2.5 text-[13.5px] leading-relaxed">
                  <CheckCircle2 size={13} className="mt-[3px] shrink-0 text-foundry-teal" />
                  <span className="font-bold text-foundry-ink">{decision.hypothesis}</span>
                </div>
                {decision.rationale ? <p className="mt-0.5 pl-[21px] font-serif text-[12.5px] italic leading-relaxed text-foundry-subtle">{decision.rationale}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="grid gap-5 sm:grid-cols-2">
        <ReadableField label="Project type" value={discovery.projectType} onChange={(value) => updateDiscovery({ projectType: value })} />
        <ReadableField label="Recommended stack" value={discovery.recommendedStack} onChange={(value) => updateDiscovery({ recommendedStack: value })} />
      </div>

      {alternativeStacks.length ? (
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">Alternative Stacks</p>
          <div className="border-t border-overlay/[0.07]">
            {alternativeStacks.map((name) => (
              <div key={name} className="flex items-center justify-between gap-3 border-b border-overlay/[0.07] py-2.5 text-[13.5px] text-foundry-ink">
                <span>{name}</span>
                <button className="font-mono text-[10.5px] text-foundry-subtle transition hover:text-foundry-teal" type="button" onClick={() => applyAlternativeStack(name)}>
                  use instead →
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ReadableArea label="Main features" value={discovery.mainFeatures.join("\n")} onChange={(value) => updateList("mainFeatures", value)} />
      <ReadableArea label="Data model / entities" value={discovery.dataModel.join("\n")} onChange={(value) => updateList("dataModel", value)} />

      {discovery.futureCapabilities.length ? (
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">Growth Strategy</p>
          <p className="mb-2.5 font-serif text-[13.5px] italic leading-relaxed text-foundry-subtle">
            Foundry has seen projects like this before — the architecture already leaves room for these without a rewrite.
          </p>
          <ul className="grid gap-1.5">
            {discovery.futureCapabilities.map((item) => (
              <li key={item} className="flex gap-2 text-[13.5px] leading-relaxed text-foundry-ink">
                <span className="text-foundry-subtle">·</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ReadableArea label="Deployment" value={deploymentNoteFor(start)} onChange={(value) => onUpdate({ deploymentNote: value })} />

      {stackCapabilityNote ? (
        <div className={`flex gap-2.5 border-l-2 py-1 pl-3.5 text-[12.5px] leading-relaxed text-foundry-muted ${stackCapability.level >= 4 ? "border-foundry-teal" : stackCapability.level >= 2 ? "border-foundry-amber" : "border-red-300/60"}`}>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">Stack capability</p>
              <p className="mt-1 font-bold text-foundry-ink">{stackCapability.label} · {stackCapability.level}/4</p>
              <p className="mt-0.5">{stackCapabilityNote}</p>
            </div>
          </div>
      ) : null}

      {questionDecisions.length ? (
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">Remaining Unknowns</p>
          <p className="mb-3 font-serif text-[13.5px] italic leading-relaxed text-foundry-subtle">Only the few things that would actually change the architecture.</p>
          <div className="grid gap-4">
            {questionDecisions.map((decision) => (
              <label key={decision.dimension} className="grid gap-2">
                <span className="flex items-baseline gap-2 font-serif text-[14.5px] text-foundry-ink">
                  <span className="shrink-0 font-mono text-[11px] text-foundry-amber">?</span>
                  {decision.question}
                </span>
                <input
                  className="border-0 border-b border-overlay/10 bg-transparent p-0 pb-1.5 pl-[19px] text-[13.5px] text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-amber/50"
                  value={start.discoveryAnswers[decision.dimension] ?? ""}
                  onChange={(event) => onUpdate({ discoveryAnswers: { ...start.discoveryAnswers, [decision.dimension]: event.target.value } })}
                  placeholder="Answer if it matters for the first build…"
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <details className="border-t border-overlay/[0.07] pt-4">
        <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.08em] text-foundry-subtle">Full reasoning &amp; confidence map — {disclosedDecisions.length} decisions</summary>
        <div className="mt-3 grid overflow-hidden rounded-md border border-overlay/[0.07]">
          {disclosedDecisions.map((decision) => (
            <div key={decision.dimension} className="grid gap-1 border-b border-overlay/[0.06] bg-overlay/[0.015] px-3 py-2.5 font-mono text-[11px] leading-5 text-foundry-muted last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-foundry-ink">{humanizeKey(decision.dimension)}</span>
                <span className="text-foundry-subtle">{decision.confidence}% · {decision.stakes} stakes · {decision.source} · {decision.action}</span>
              </div>
              <p className="font-sans">{decision.hypothesis}</p>
              <p className="font-sans text-foundry-subtle">{decision.rationale}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function ReadableField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <label className="grid gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">{label}</span>
        <input
          autoFocus
          className="border-0 border-b border-overlay/10 bg-transparent p-0 pb-1 text-[14px] text-foundry-ink outline-none focus:border-foundry-teal/50"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => { if (event.key === "Enter") setEditing(false); }}
        />
      </label>
    );
  }
  return (
    <div className="group grid gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">{label}</span>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] text-foundry-ink">{value}</p>
        <button
          type="button"
          className="mt-0.5 shrink-0 text-foundry-subtle opacity-0 transition hover:text-foundry-teal group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
        >
          <Pencil size={12} />
        </button>
      </div>
    </div>
  );
}

function ReadableArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <label className="grid gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">{label}</span>
        <textarea
          autoFocus
          className="min-h-[3.5rem] resize-y border-0 bg-transparent p-0 text-[14px] leading-[1.55] text-foundry-ink outline-none"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setEditing(false)}
        />
      </label>
    );
  }
  return (
    <div className="group grid gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">{label}</span>
      <div className="flex items-start justify-between gap-3">
        <p className="whitespace-pre-line text-[14px] leading-[1.55] text-foundry-ink">{value}</p>
        <button
          type="button"
          className="mt-0.5 shrink-0 text-foundry-subtle opacity-0 transition hover:text-foundry-teal group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
        >
          <Pencil size={12} />
        </button>
      </div>
    </div>
  );
}

function defaultKindFor(id: TemplateId) {
  const defaults: Record<TemplateId, string> = {
    inventory: "Inventory management system",
    commerce: "E-commerce store",
    pos: "Point-of-sale app",
    dashboard: "Operational dashboard",
    website: "Responsive website",
    mobile: "Mobile app",
    game: "Playable game",
    api: "API service",
    ai: "AI application",
    desktop: "Desktop application",
    custom: "Custom software project",
  };

  return defaults[id];
}

function subtypesFor(id: TemplateId) {
  return [...projectSubtypeOptions[id], "Other / Custom"];
}

function firstSubtypeFor(id: TemplateId) {
  return projectSubtypeOptions[id][0] ?? "Custom";
}

function appKindFor(template: BuildTemplate, subtype: string, customSubtype: string) {
  const chosenSubtype = customSubtype.trim() || (subtype === "Other / Custom" ? "Custom" : subtype);
  // Starter subtype labels are already complete product descriptions (for example,
  // "Warehouse inventory" or "SaaS dashboard"). Appending the template kind made
  // customer-facing names and folder slugs repeat themselves.
  return chosenSubtype === "Custom" || !chosenSubtype ? defaultKindFor(template.id) : chosenSubtype;
}

function kindStepTitle(template: BuildTemplate, appKind?: string) {
  if (template.id === "custom") return kindStepTitleForDetectedType(appKind || "Custom Software Project");
  if (template.id === "inventory") return "What kind of inventory?";
  if (template.id === "commerce") return "What kind of store?";
  if (template.id === "pos") return "What kind of POS?";
  if (template.id === "website") return "What kind of website?";
  if (template.id === "dashboard") return "What kind of dashboard?";
  if (template.id === "mobile") return "What kind of mobile app?";
  if (template.id === "game") return "What kind of game?";
  if (template.id === "api") return "What kind of API?";
  if (template.id === "ai") return "What kind of AI application?";
  if (template.id === "desktop") return "What kind of desktop application?";
  return "Project Type";
}

function kindStepTitleForDetectedType(detectedType: string) {
  if (detectedType === "Inventory System") return "What kind of inventory?";
  if (detectedType === "E-commerce Store") return "What kind of store?";
  if (detectedType === "POS App") return "What kind of POS?";
  if (detectedType === "Website") return "What kind of website?";
  if (detectedType === "Dashboard") return "What kind of dashboard?";
  if (detectedType === "Mobile App") return "What kind of mobile app?";
  if (detectedType === "Game") return "What kind of game?";
  if (detectedType === "Backend/API") return "What kind of backend/API?";
  if (detectedType === "AI App") return "What kind of AI app?";
  return `What kind of ${sentenceLabel(detectedType)}?`;
}

function subtypesForEffectiveProject(start: ProjectStart) {
  if (start.template.id !== "custom") return subtypesFor(start.template.id);

  const inferredTemplateId = templateIdForDetectedType(start.appKind);
  if (inferredTemplateId) return subtypesFor(inferredTemplateId);

  return [...customSubtypesForDetectedType(start.appKind), "Other / Custom"];
}

function templateIdForDetectedType(detectedType: string): TemplateId | null {
  if (detectedType === "Inventory System") return "inventory";
  if (detectedType === "E-commerce Store") return "commerce";
  if (detectedType === "POS App") return "pos";
  if (detectedType === "Dashboard") return "dashboard";
  if (detectedType === "Website") return "website";
  if (detectedType === "Mobile App") return "mobile";
  if (detectedType === "Game") return "game";
  return null;
}

function locationLabel(location: ProjectLocation) {
  return locationOptions.find((option) => option.id === location)?.label ?? "Create inside Foundry workspace";
}

function plannedProjectPath(start: ProjectStart) {
  return `${foundryProjectRoot}\\${slugifyProjectName(start.projectName || start.appKind || defaultKindFor(start.template.id))}`;
}

function slugifyProjectName(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "new-project"
  );
}

async function selectedUploadedFiles(files: FileList | null): Promise<FactoryUploadedFile[]> {
  if (!files) return [];
  const maxFileSize = 240_000;
  const maxTotalSize = 1_500_000;
  const maxArchiveSize = 20_000_000;
  let totalSize = 0;
  const readableFiles: FactoryUploadedFile[] = [];

  for (const file of Array.from(files)) {
    const relativePath = normalizeUploadedPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    if (/\.zip$/i.test(relativePath)) {
      if (file.size > maxArchiveSize) continue;
      try {
        let acceptedSize = 0;
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
          filter: (entry) => {
            const path = normalizeUploadedPath(entry.name);
            const size = entry.originalSize;
            if (!path || !isEditableUploadPath(path) || size > maxFileSize || totalSize + acceptedSize + size > maxTotalSize) return false;
            acceptedSize += size;
            return true;
          },
        });
        for (const [entryName, bytes] of Object.entries(entries)) {
          const path = normalizeUploadedPath(entryName);
          if (!path || !isEditableUploadPath(path) || totalSize + bytes.byteLength > maxTotalSize) continue;
          readableFiles.push({ path, content: strFromU8(bytes), size: bytes.byteLength });
          totalSize += bytes.byteLength;
        }
      } catch {
        // Invalid, encrypted, or unsupported ZIP archives are ignored instead of creating fake file records.
      }
      continue;
    }
    if (!relativePath || !isEditableUploadPath(relativePath) || file.size > maxFileSize || totalSize + file.size > maxTotalSize) continue;
    try {
      const content = await file.text();
      readableFiles.push({ path: relativePath, content, size: file.size });
      totalSize += file.size;
    } catch {
      // Browser File.text can fail for unusual file handles; keep the path display but skip editable content.
    }
  }

  return readableFiles;
}

function normalizeUploadedPath(filePath: string) {
  const parts = filePath.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return "";
  return parts.join("/");
}

function isEditableUploadPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|bin|obj)(\/|$)/.test(normalized)) return false;
  return /\.(html|css|scss|sass|less|js|mjs|cjs|json|md|mdx|txt|ts|tsx|jsx|vue|svelte|py|php|cs|java|kt|go|rs|rb|swift|dart|sql|sh|bash|zsh|ps1|xml|yml|yaml|toml|ini|env|graphql|gql|proto|log)$/i.test(normalized)
    || /(^|\/)(dockerfile|makefile|procfile|gemfile|rakefile)$/i.test(normalized);
}

function uploadSummaryText(names: string[]) {
  if (!names.length) return "None selected";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

const PROJECT_MARKER_PATTERN =
  /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|next\.config\.(js|mjs|ts)|vite\.config\.(js|ts)|angular\.json|pom\.xml|build\.gradle|settings\.gradle|\.csproj|\.sln|pubspec\.yaml|cargo\.toml|go\.mod)$/i;
const NOISE_PATH_PATTERN = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|bin|obj|out|\.cache|\.vscode|\.idea)(\/|$)/i;

function inspectExistingSourceNames(names: string[], mode: ExistingSourceGuardMode = "new-project") {
  const normalized = names.map((name) => name.replace(/\\/g, "/"));
  const roots = new Set(normalized.map((name) => name.split("/")[0]).filter(Boolean));
  const lower = normalized.map((name) => name.toLowerCase());
  const hasProjectMarkers = lower.some((name) => PROJECT_MARKER_PATTERN.test(name));
  const hasRepoOrBuildFolders = lower.some((name) => NOISE_PATH_PATTERN.test(name));

  if (mode === "open-existing") {
    // Opening an existing project SHOULD look like a real project — config files, a
    // node_modules folder, multiple top-level folders are reassuring here, not risky.
    // The one real danger is selecting a parent directory that bundles several distinct,
    // separate projects together (each with its own project marker) instead of one.
    // node_modules alone can contain hundreds of nested package.json files, so those are
    // excluded here — only markers outside dependency/build noise count toward a "root".
    const markerRootCount = new Set(
      normalized
        .filter((name) => PROJECT_MARKER_PATTERN.test(name.toLowerCase()) && !NOISE_PATH_PATTERN.test(name.toLowerCase()))
        .map((name) => {
          const parts = name.split("/").filter(Boolean);
          return parts.length > 1 ? parts[0] : ".";
        }),
    ).size;
    const risky = markerRootCount > 1;
    const signals = [
      `${normalized.length} selected path${normalized.length === 1 ? "" : "s"}`,
      `${roots.size} top-level folder${roots.size === 1 ? "" : "s"} detected`,
      hasProjectMarkers ? "Project configuration file found — this looks like a real project" : "No project configuration file detected yet",
      hasRepoOrBuildFolders ? "Dependency/build folders found (normal for a real project)" : "No dependency/build folders detected yet",
    ];
    return {
      risky,
      signals,
      message: risky
        ? "This selection appears to bundle more than one separate project together (multiple folders each with their own project configuration). Pick the single project folder you want Foundry to open, or continue if that's intentional."
        : "This looks like a real project — Foundry detected the usual project structure. Confirm this is the project you want to open.",
    };
  }

  const hasManyLooseFiles = normalized.length > 12 && roots.size > Math.max(3, normalized.length / 4);
  const risky = roots.size > 1 || hasProjectMarkers || hasRepoOrBuildFolders || hasManyLooseFiles;
  const signals = [
    `${normalized.length} selected path${normalized.length === 1 ? "" : "s"}`,
    `${roots.size} top-level folder${roots.size === 1 ? "" : "s"} detected`,
    hasProjectMarkers ? "Existing project markers found" : "No strong project marker found",
    hasRepoOrBuildFolders ? "Repository/build output folders found" : "No repository/build output folder detected",
  ];

  return {
    risky,
    signals,
    message: risky
      ? "This selection appears to contain an existing project, multiple folders, generated output, or unrelated files. Foundry will not write a new generated project into this root automatically. Choose another folder, create a new subfolder, clean/delete unrelated folders first, or confirm reference-only use."
      : "This selection does not show obvious unrelated project markers from the available browser paths. Foundry will still generate into a separate workspace unless a future local connector receives explicit write approval.",
  };
}

function existingSourceSummary(names: string[], confirmed: boolean) {
  if (!names.length) return "No existing source selected. New files will be generated in a Foundry workspace.";
  const inspection = inspectExistingSourceNames(names);
  if (!inspection.risky) return "Inspected selected paths. New files will be generated in a separate Foundry workspace.";
  return confirmed
    ? "Warning acknowledged. Existing source is reference-only; Foundry will not write into the selected root."
    : "Warning: selected source may be unrelated or already contain a project. Foundry will not write into that root automatically.";
}

function openedExistingProjectSummary(names: string[]) {
  if (!names.length) return "No files selected yet.";
  const inspection = inspectExistingSourceNames(names, "open-existing");
  return `Existing project opened intentionally. ${inspection.signals.join("; ")}. Foundry should inspect before editing.`;
}

function selectedStackFor(start: ProjectStart) {
  return start.customStack.trim() || start.stack;
}

function genericArchitectureFor(stack: string, entities: string[], projectType = "", features: string[] = []) {
  const projectShape = projectType.trim();
  const featureShape = features.join(" ");
  if (/\b(?:backend|api|microservice|webhook service)\b/i.test(projectShape)) {
    const primaryEntities = entities.slice(0, 2).join(" and ") || "the named API resources";
    return `${stack} backend service with versioned routes for ${primaryEntities}, schema-based request validation, centralized JSON errors and logging, explicit local persistence, automated endpoint tests, and runnable API documentation. No visual UI is introduced unless the brief requests one.`;
  }
  if (/\b(website|portfolio|marketing|landing|brochure|content|studio|agency)\b/i.test(projectShape)
    || (!projectShape && /\b(website|portfolio|marketing|landing|brochure|content|studio|agency)\b/i.test(featureShape))) {
    return `${stack} presentation site with reusable content sections, static-first pages, responsive media, accessible navigation, per-page SEO metadata, and a real inquiry path. Content editing stays outside the visitor experience unless an admin CMS is explicitly requested.`;
  }
  const primaryEntities = entities.slice(0, 2).join(" and ") || "the core data";
  return `${stack} implementation with create/update/delete flows for ${primaryEntities}, optimistic UI feedback, and local-first storage until a real backend or multi-device sync is requested.`;
}

/** "What Foundry Already Knows" carries a short architecture-derived tag that would otherwise keep
 * naming the old stack after the user switches — swap any fact that still mentions it. Dedupes the
 * result: when two facts both mentioned the old stack they'd otherwise collapse into the identical
 * "${newStack} architecture" string, which both shows the tag twice and (fatally) collides as a React
 * list key. */
function refreshArchitectureKeyFact(keyFacts: string[], oldStack: string, newStack: string): string[] {
  const oldStackLower = oldStack.trim().toLowerCase();
  if (!oldStackLower) return keyFacts;
  const replacement = `${newStack} architecture`;
  const frameworkFact = /\b(next(?:\.js)?|react|astro|nuxt|vue|svelte(?:kit)?|django|laravel|rails|spring|fastapi|flutter|electron|tauri)\b/i;
  const swapped = keyFacts.map((fact) => (fact.toLowerCase().includes(oldStackLower) || frameworkFact.test(fact) ? replacement : fact));
  return swapped.filter((fact, index) => swapped.indexOf(fact) === index);
}

function alternativeStacksFor(start: ProjectStart) {
  if (start.alternativeStacks.length) return start.alternativeStacks;
  const selected = selectedStackFor(start);
  const options = start.stackOptions.length ? start.stackOptions : FALLBACK_STACK_OPTIONS;
  return options
    .map((item) => item.name)
    .filter((name) => name !== selected)
    .slice(0, 3);
}

function deploymentNoteFor(start: ProjectStart) {
  if (start.deploymentNote.trim()) return start.deploymentNote;
  const stack = selectedStackFor(start).toLowerCase();
  if (/wpf|winforms|\.net desktop|electron|tauri/.test(stack)) return "Ships as a desktop installer; no web hosting needed.";
  if (/unity|godot/.test(stack)) return "Exports to a game build target after prototype; not web-deployed.";
  if (/phaser/.test(stack)) return "Deploys as a browser-playable build to any static host.";
  if (/android|flutter|react native/.test(stack)) return "Builds to app-store packages (Google Play/App Store) after prototype.";
  if (/node|express|fastapi|django|laravel|php|spring|gin|asp\.net/.test(stack)) return "Deploy as a long-running service or container on a Node/server runtime; serverless platforms require an explicit function adapter. This is not a static-host artifact.";
  if (/next\.?js/.test(stack)) return "Deploy to a compatible Next.js runtime such as Vercel or a Node/container host; static export is available only when the application does not require server features.";
  if (/react|vue|angular|astro|html/.test(stack)) return "Deploys as a web build to a compatible static host when no server runtime is required.";
  return "Deployment path depends on the final stack; Foundry will confirm before shipping.";
}

function ledeFor(start: ProjectStart) {
  if (start.lede.trim()) return start.lede;
  const discovery = start.discovery;
  if (!discovery) return "";
  return `${discovery.architecture} ${discovery.styleDirection}`.trim();
}

// domain / likely-users / complexity are deliberately excluded here — they're already
// carried by the narrative lede and "What Foundry Already Knows", so repeating them as
// their own decision group would just be the same understanding said twice.
function reconcileKnownStarterDiscovery(discovery: ProjectDiscoveryResult, start: ProjectStart): ProjectDiscoveryResult {
  if (start.template.id === "custom") return discovery;
  const established = new Set<DiscoveryDimension>(["domain", "platform", "data-shape", "features"]);
  const decisions = discovery.decisions.map((item) => established.has(item.dimension) && item.action === "ask"
    ? { ...item, confidence: Math.max(90, item.confidence), source: "user-confirmed" as const, action: "silent-infer" as const, question: undefined }
    : item);
  const { questions, assumptions } = deriveQuestionsAndAssumptions(decisions);
  return { ...discovery, decisions, questions, assumptions };
}

function alignDiscoveryWithSelectionAndConstraints(discovery: ProjectDiscoveryResult, start: ProjectStart, selectedStack: string): ProjectDiscoveryResult {
  const brief = `${start.projectDescription} ${discovery.prompt}`;
  const explicitProjectName = explicitProjectNameFromPrompt(start.projectDescription);
  const stackChanged = selectedStack.trim() !== "" && !sameStackChoice(selectedStack, discovery.recommendedStack);
  const platformHypothesis = explicitSurfaceFromBrief(start.projectDescription, discovery) || explicitPlatformFromPrompt(brief);
  const nativeMobilePlatform = /^(?:android|ios|mobile) app$/i.test(platformHypothesis || "");
  const reconciledStyleDirection = nativeMobilePlatform
    ? "Native touch-first operations interface with platform navigation, large tap targets, resilient offline states, and device-appropriate accessibility."
    : discovery.styleDirection;
  const architecture = stackChanged
    ? genericArchitectureFor(selectedStack, discovery.dataModel, discovery.projectType, discovery.mainFeatures)
    : discovery.architecture;
  const excludesAuth = /\b(?:no|without)\s+(?:login|logins|authentication|auth|accounts?|user accounts?)\b/i.test(brief);
  const excludesDatabase = /\b(?:no|without)\s+(?:a\s+)?(?:database|db|backend|server)\b/i.test(brief)
    || /\bno\s+(?:login|auth|database|backend)(?:\s+or\s+(?:a\s+)?(?:login|auth|database|backend))+\b/i.test(brief);
  const decisions = discovery.decisions.map((decision) => {
    if (decision.dimension === "platform" && platformHypothesis && decision.hypothesis !== platformHypothesis) {
      return {
        ...decision,
        hypothesis: platformHypothesis,
        rationale: "The platform is explicitly stated in the current project brief and determines the native runtime, preview, packaging, and verification path.",
        confidence: 100,
        source: "user-confirmed" as const,
        action: "silent-infer" as const,
        question: undefined,
      };
    }
    if (nativeMobilePlatform && decision.dimension === "style") {
      return { ...decision, hypothesis: reconciledStyleDirection, rationale: "The explicit mobile platform requires native touch, accessibility, density, and device-state conventions rather than web/SaaS presentation assumptions.", confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, question: undefined };
    }
    if (nativeMobilePlatform && decision.dimension === "navigation") {
      return { ...decision, hypothesis: "Native screen hierarchy with platform back behavior, task-focused tabs or destinations, and preserved cart/workflow state.", rationale: "Navigation follows the selected native mobile runtime and the requested operational workflow.", confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, question: undefined };
    }
    if (decision.dimension === "architecture" && stackChanged) {
      return { ...decision, hypothesis: architecture, rationale: `The selected ${selectedStack} delivery stack replaces assumptions tied to the previous architecture.`, confidence: 100, source: "user-confirmed" as const, action: "silent-infer" as const, question: undefined };
    }
    if (decision.dimension === "auth-database-api" && (excludesAuth || excludesDatabase)) {
      const excluded = [excludesAuth ? "authentication or user accounts" : "", excludesDatabase ? "a database or backend" : ""].filter(Boolean).join(" and ");
      return {
        ...decision,
        hypothesis: `First version explicitly excludes ${excluded}; keep the project free of disconnected auth or persistence UI.`,
        rationale: "The user's brief explicitly excluded this scope.",
        confidence: 100,
        source: "user-confirmed" as const,
        action: "silent-infer" as const,
        question: undefined,
      };
    }
    return decision;
  });
  const explicitFeatures = [
    /\bevent calendar\b/i,
    /\bobserving guides?\b/i,
    /\bmembership inquiry form\b/i,
    /\binquiry form\b/i,
    /\bcontact form\b/i,
    /\bresponsive (?:design|layout|pages?|experience)\b/i,
    /\baccessible (?:design|navigation|experience|site)\b/i,
  ].map((pattern) => brief.match(pattern)?.[0]).filter((value): value is string => Boolean(value));
  const mainFeatures = Array.from(new Map([...explicitFeatures, ...discovery.mainFeatures].map((feature) => [feature.toLowerCase(), feature])).values());
  const { questions, assumptions } = deriveQuestionsAndAssumptions(decisions);
  const constraintFact = `First version excludes ${[excludesAuth ? "authentication/user accounts" : "", excludesDatabase ? "database/backend" : ""].filter(Boolean).join(" and ")}.`;
  let keyFacts = (excludesAuth || excludesDatabase)
    ? [...discovery.keyFacts.filter((fact) => !/\b(auth|login|account|database|backend|persistence)\b/i.test(fact)), constraintFact]
    : discovery.keyFacts;
  if (platformHypothesis) {
    const previousPlatform = discovery.decisions.find((decision) => decision.dimension === "platform")?.hypothesis;
    keyFacts = keyFacts.map((fact) => fact === previousPlatform || (/^(?:web|mobile|desktop|android|ios) app$/i.test(fact) && fact !== platformHypothesis) ? platformHypothesis : fact);
    keyFacts = keyFacts.filter((fact, index) => keyFacts.indexOf(fact) === index);
  }
  if (nativeMobilePlatform) {
    keyFacts = keyFacts.map((fact) => /\bsaas\b|web interface|browser interface/i.test(fact) ? "Native touch-first operations interface" : fact);
    keyFacts = keyFacts.filter((fact, index) => keyFacts.indexOf(fact) === index);
  }
  return {
    ...discovery,
    projectType: explicitProjectName || discovery.projectType,
    recommendedStack: selectedStack || discovery.recommendedStack,
    architecture,
    styleDirection: reconciledStyleDirection,
    mainFeatures,
    decisions,
    questions,
    assumptions,
    keyFacts: stackChanged ? refreshArchitectureKeyFact(keyFacts, discovery.recommendedStack, selectedStack) : keyFacts,
  };
}

function sameStackChoice(left: string, right: string) {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/\bwith\b/g, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
  return normalize(left) === normalize(right);
}

function fallbackStackOptionsFor(discovery: ProjectDiscoveryResult, start: ProjectStart): StackOption[] {
  const platformOptions = platformStackOptionsForProject(start.template.id, discovery);
  if (platformOptions.length) return platformOptions;
  const evidence = `${discovery.projectType} ${discovery.prompt} ${discovery.architecture}`.toLowerCase();
  const contentOnlyWeb = /\b(content|public|marketing|portfolio|club|venue|studio|website)\b/.test(evidence)
    && /\b(no|without) (?:login|auth|database|backend)\b/.test(evidence);
  if (contentOnlyWeb) {
    return [
      { name: "Astro + TypeScript", why: "Content-first pages, strong accessibility, and minimal client JavaScript fit a public site without a database.", recommended: true },
      { name: "Next.js + TypeScript", why: "A strong alternative when the site is likely to add server features or richer application behavior later.", recommended: false },
      { name: "Vite + React + TypeScript", why: "Useful when the experience needs more client-side interaction while remaining a static deployment.", recommended: false },
      { name: "Static HTML + CSS + JavaScript", why: "The smallest dependency surface for a simple content site with only lightweight form behavior.", recommended: false },
    ];
  }
  const recommended = discovery.recommendedStack.trim() || FALLBACK_STACK_OPTIONS[0].name;
  return [
    { name: recommended, why: `Matches the inferred ${discovery.projectType} architecture and first-version requirements.`, recommended: true },
    ...FALLBACK_STACK_OPTIONS.filter((item) => item.name.toLowerCase() !== recommended.toLowerCase()).map((item) => ({ ...item, recommended: false })),
  ].slice(0, 5);
}

function applyConfirmedStyle(discovery: ProjectDiscoveryResult, direction: string): ProjectDiscoveryResult {
  const decisions = discovery.decisions.map((item) => item.dimension === "style"
    ? {
        ...item,
        hypothesis: direction,
        confidence: 100,
        source: "user-confirmed" as const,
        action: "silent-infer" as const,
        rationale: "The user selected this visual direction during discovery.",
        question: undefined,
      }
    : item);
  const { questions, assumptions } = deriveQuestionsAndAssumptions(decisions);
  return { ...discovery, styleDirection: direction, decisions, questions, assumptions };
}

const sectionForDimension: Partial<Record<DiscoveryDimension, string>> = {
  platform: "Architectural Direction",
  architecture: "Architectural Direction",
  "auth-database-api": "Architectural Direction",
  "data-shape": "Architectural Direction",
  navigation: "Product Experience",
  style: "Product Experience",
  features: "Product Experience",
};

const sectionOrder = ["Architectural Direction", "Product Experience"];

function memoSectionsFor(decisions: DiscoveryDecision[]) {
  const groups = new Map<string, DiscoveryDecision[]>();
  for (const decision of decisions) {
    // Decisions Foundry is asking about live only in "Remaining Unknowns" — showing
    // them here too would repeat the same open question twice on the page.
    if (decision.action === "ask") continue;
    const label = sectionForDimension[decision.dimension];
    if (!label) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)?.push(decision);
  }
  return sectionOrder.filter((label) => groups.has(label)).map((label) => ({ label, items: groups.get(label) as DiscoveryDecision[] }));
}

function stackCapabilityNoteFor(stack: StackProfile) {
  if (stack.level >= 4) return null;
  if (stack.level === 3) return "Foundry can edit this stack and run its build/test commands, with narrower automation than the fully-supported stacks.";
  return unsupportedCreationMessage(stack);
}

function stackCapabilityLine(stackName: string) {
  const stack = capabilityLevelForStackChoice(stackName);
  const note = stackCapabilityNoteFor(stack);
  return `${stack.label} (level ${stack.level}/4)${note ? ` - ${note}` : ""}`;
}

function recommendationForStart(start: ProjectStart): StackRecommendation {
  const customStack = start.customStack.trim();
  if (customStack) {
    return {
      name: customStack,
      defaults: [],
      why: "You entered a custom stack, so Foundry will preserve it in the project brief instead of forcing a recommended preset.",
    };
  }

  const options = start.stackOptions.length ? start.stackOptions : FALLBACK_STACK_OPTIONS;
  const matched = options.find((item) => item.name === start.stack) ?? options.find((item) => item.recommended) ?? options[0];
  return { name: matched.name, why: matched.why, recommended: matched.recommended, defaults: [] };
}

function cleanProjectName(value: string) {
  const explicitName = explicitProjectNameFromPrompt(value);
  if (explicitName) return explicitName.trim();
  const cleaned = titleCase(
    value
      .replace(/\b(build|create|make|me|an?|the|with|for)\b/gi, " ")
      .replace(/\b(system|app|application|project)\b/gi, " $&")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.slice(0, 7).join(" ");
}

/** A customer-facing surface label derived only from current evidence, never a starter default. */
function explicitSurfaceFromBrief(brief: string, discovery?: ProjectDiscoveryResult | null) {
  if (/\bandroid\b/i.test(brief)) return "Android app";
  if (/\b(?:ios|iphone|ipad)\b/i.test(brief)) return "iOS app";
  if (/\bmobile\s+(?:app|application)\b/i.test(brief)) return "Mobile app";
  if (/\b(?:desktop|windows|macos)\s+(?:app|application)\b/i.test(brief)) return "Desktop app";
  if (/\b(?:command[- ]line|cli)\b/i.test(brief)) return "Command-line app";
  if (/\b(?:backend|server-only|microservice|rest\s+api|web\s+api|api\s+(?:service|server))\b/i.test(brief)) return "Backend service";
  if (/\b(?:web|browser)\s+(?:app|application|site|website|dashboard)\b/i.test(brief)) return "Web app";
  const platformDecision = discovery?.decisions.find((decision) => decision.dimension === "platform")?.hypothesis?.trim();
  return platformDecision || "";
}

function customSubtypesForDetectedType(detectedType: string) {
  if (detectedType === "Backend/API") return ["REST API", "Auth API", "Payment API", "Data processing API", "Admin API", "Custom API"];
  if (detectedType === "AI App") return ["Chat app", "Document Q&A app", "AI assistant", "RAG search app", "Workflow agent", "Custom AI app"];
  if (detectedType === "Custom Software Project") return ["Web app", "Business app", "Internal tool", "AI app", "Backend/API", "Desktop app"];
  const label = sentenceLabel(detectedType);
  return uniqueStrings([prefixedSubtype("Simple", label), prefixedSubtype("Subscription", label), prefixedSubtype("Admin", label), prefixedSubtype("Customer", label), prefixedSubtype("Internal", label), prefixedSubtype("Mobile", label)]);
}

function sentenceLabel(value: string) {
  const trimmed = value.trim() || "project";
  if (/^[A-Z0-9/]+$/.test(trimmed)) return trimmed;
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

function prefixedSubtype(prefix: string, label: string) {
  return label.toLowerCase().startsWith(prefix.toLowerCase()) ? titleCase(label) : `${prefix} ${label}`;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function projectSourceModeForBrief(brief: string): "browser-local" | "local" | "connector" | "upload" | "new" {
  const sourceMode = brief.match(/^Project source mode:\s*(.+)$/im)?.[1]?.toLowerCase() ?? "";
  const mode = brief.match(/^Mode:\s*(.+)$/im)?.[1]?.toLowerCase() ?? "";
  if (sourceMode.includes("local connector") || /^Local connector URL:\s*.+$/im.test(brief)) return "connector";
  if (sourceMode.includes("connected live folder") || /^Browser folder handle id:\s*.+$/im.test(brief)) return "browser-local";
  if (sourceMode.includes("local folder") || /^Local project path:\s*.+$/im.test(brief)) return "local";
  if (sourceMode.includes("uploaded copy")) return "upload";
  if (mode.includes("existing")) return "upload";
  return "new";
}

function projectSourceCopy(sourceMode: "browser-local" | "local" | "connector" | "upload" | "new", hasLocalPath: boolean, hasExecutionPath: boolean) {
  if (sourceMode === "browser-local") return "Connected (live folder). Foundry writes directly to this folder through browser-granted permission.";
  if (sourceMode === "connector") return "Local agent connected. Foundry edits and runs commands in the real project folder.";
  if (sourceMode === "local" && hasLocalPath) return "Local folder connected. Foundry edits that original folder directly; changes should appear in your editor.";
  if (sourceMode === "local") return "Local folder mode needs an exact folder path before Foundry can edit files.";
  if (sourceMode === "upload") {
    return hasExecutionPath
      ? "Imported copy mode. Foundry created a workspace copy; your original folder is not being edited. Export to apply locally."
      : "Import copy mode. Foundry will create a writable workspace copy before edits. Your original folder will not change.";
  }
  return "New project mode. Foundry creates a new workspace folder only for this flow.";
}

function projectExecutionFromMission(mission: MissionState): FactoryProjectResult | null {
  const artifact = [...mission.createdArtifacts].reverse().find((item) => item.title === "Project Execution");
  if (!artifact) return null;

  try {
    return JSON.parse(artifact.body) as FactoryProjectResult;
  } catch {
    return null;
  }
}

function projectFilesForMission(mission: MissionState, execution: FactoryProjectResult | null): FactoryProjectResult["files"] {
  const merged = new Map<string, FactoryProjectResult["files"][number]>();
  (execution?.files ?? []).forEach((file) => merged.set(normalizeProjectPath(file.path), { ...file, path: normalizeProjectPath(file.path) }));

  const uploadedArtifact = mission.createdArtifacts.find((item) => item.title === "Uploaded Project Files");
  if (uploadedArtifact) {
    try {
      const files = JSON.parse(uploadedArtifact.body) as FactoryUploadedFile[];
      if (Array.isArray(files)) {
        files.map((file) => ({
          path: normalizeProjectPath(file.path),
          status: "uploaded" as const,
          size: file.size ?? file.content?.length ?? 0,
          content: file.content,
        })).filter((file) => file.path).forEach((file) => { if (!merged.has(file.path)) merged.set(file.path, file); });
      }
    } catch {
      // Fall back to paths saved in the brief.
    }
  }

  selectedUploadPathsFromBrief(projectBriefFromMission(mission)).map((filePath) => ({
    path: normalizeProjectPath(filePath),
    status: "uploaded" as const,
    size: 0,
  })).filter((file) => file.path).forEach((file) => { if (!merged.has(file.path)) merged.set(file.path, file); });

  const liveEvents = mission.executionMissions.flatMap((item) => item.timeline);
  liveEvents
    .filter((event) => (event.kind === "file" || event.kind === "edit") && Boolean(event.filePath || event.fileName))
    .forEach((event) => {
      const filePath = normalizeProjectPath(event.filePath || event.fileName || "");
      if (!filePath) return;
      const existing = merged.get(filePath);
      const detailsSize = typeof event.details?.bytes === "number" ? event.details.bytes : typeof event.details?.size === "number" ? event.details.size : undefined;
      merged.set(filePath, {
        path: filePath,
        status: event.kind === "file" ? "created" : existing?.status === "created" ? "created" : "edited",
        size: detailsSize ?? existing?.size ?? 0,
        content: existing?.content,
      });
    });

  return [...merged.values()];
}

function connectedPathForMission(mission: MissionState, execution: FactoryProjectResult | null) {
  if (execution?.projectPath) return execution.projectPath;
  const generatedWorkspace = generatedWorkspaceForMission(mission);
  if (generatedWorkspace) return generatedWorkspace.projectPath;
  const brief = projectBriefFromMission(mission);
  const browserFolderName = brief.match(/^Browser folder name:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (browserFolderName) return browserFolderName;
  const localPath = brief.match(/^Local project path:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (localPath) return localPath;
  const connectorRoot = brief.match(/^Local connector root:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (connectorRoot) return connectorRoot;
  const files = projectFilesForMission(mission, execution);
  if (!files.length) return "";
  const roots = Array.from(new Set(files.map((file) => file.path.split("/")[0]).filter(Boolean)));
  return roots.length === 1 ? `Connected upload: ${roots[0]}` : "Connected upload: multiple selected roots";
}

function connectorInfoFromMission(mission: MissionState): { url: string; token: string; root: string } | null {
  const brief = projectBriefFromMission(mission);
  const url = brief.match(/^Local connector URL:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const root = brief.match(/^Local connector root:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (!url || !root) return null;
  const token = brief.match(/^Local connector token:\s*(.+)$/im)?.[1]?.trim() ?? "";
  return { url, token, root };
}

async function listAgentTree(agentUrl: string, token: string, root: string, maxEntries = 2000): Promise<{ ok: boolean; entries: Array<{ path: string; size: number }>; truncated?: boolean; error?: string }> {
  try {
    const response = await fetch("/api/factory/agent/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: agentUrl, token, root, action: "tree", maxEntries }),
    });
    const result = (await response.json().catch(() => ({}))) as { entries?: Array<{ path: string; size: number }>; truncated?: boolean; error?: string };
    if (!response.ok) return { ok: false, entries: [], error: result.error || `Could not load Local Agent files (HTTP ${response.status}).` };
    return { ok: true, entries: result.entries ?? [], truncated: result.truncated };
  } catch (error) {
    return { ok: false, entries: [], error: error instanceof Error ? error.message : "Could not reach the Local Agent file bridge." };
  }
}

async function listAgentTreeWithRetry(agentUrl: string, token: string, root: string, maxEntries = 2000) {
  let latest: Awaited<ReturnType<typeof listAgentTree>> = { ok: false, entries: [], error: "Could not load Local Agent files." };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    latest = await listAgentTree(agentUrl, token, root, maxEntries);
    if (latest.ok) return latest;
    if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
  }
  return latest;
}

function mergeConnectorFiles(treeFiles: FactoryProjectResult["files"], overlayFiles: FactoryProjectResult["files"]): FactoryProjectResult["files"] {
  const overlayPaths = new Set(overlayFiles.map((file) => file.path));
  const merged = [...overlayFiles];
  for (const file of treeFiles) {
    if (!overlayPaths.has(file.path)) merged.push(file);
  }
  return merged;
}

async function readAgentFile(agentUrl: string, token: string, root: string, filePath: string): Promise<{ content: string | null; error?: string }> {
  try {
    const response = await fetch("/api/factory/agent/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: agentUrl, token, root, action: "read", path: filePath }),
    });
    const result = (await response.json().catch(() => ({}))) as { exists?: boolean; content?: string; error?: string };
    if (!response.ok || !result.exists) return { content: null, error: result.error || `Could not read ${filePath} from the Local Agent.` };
    return { content: result.content ?? "" };
  } catch (error) {
    return { content: null, error: error instanceof Error ? error.message : "Could not reach the Local Agent file bridge." };
  }
}

function selectedUploadPathsFromBrief(brief: string) {
  const line = brief.match(/^Selected upload paths:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (!line) return [];
  return line.split(";").map((item) => item.trim()).filter(Boolean);
}

function normalizeProjectPath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.?\//, "");
}

function buildFileTree(files: FactoryProjectResult["files"]): FileTreeNode {
  const root: FileTreeNode = { name: "root", path: "", type: "folder", children: [] };
  files.forEach((file) => {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const nodePath = parts.slice(0, index + 1).join("/");
      let next = current.children.find((child) => child.name === part && child.type === (isFile ? "file" : "folder"));
      if (!next) {
        next = { name: part, path: nodePath, type: isFile ? "file" : "folder", status: isFile ? file.status : undefined, children: [] };
        current.children.push(next);
        current.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
      }
      current = next;
    });
  });
  return root;
}

/**
 * Maps the client-side Decision Memo (ProjectDiscoveryResult) onto the typed request field the
 * executor actually reads (StructuredDiscovery, lib/factory/types.ts) — the fix for the confirmed gap
 * where reviewed memo content never reached the executor, only a regex-scraped brief fragment did.
 */
function structuredDiscoveryFor(start: ProjectStart): StructuredDiscovery | undefined {
  if (!start.discovery) return undefined;
  const discovery = start.discovery;
  return {
    projectType: discovery.projectType,
    architecture: discovery.architecture,
    styleDirection: discovery.styleDirection,
    mainFeatures: discovery.mainFeatures,
    dataModel: discovery.dataModel,
    keyFacts: discovery.keyFacts,
    futureCapabilities: discovery.futureCapabilities,
    recommendedStack: selectedStackFor(start) || discovery.recommendedStack,
    decisions: discovery.decisions.map((decision) => ({ dimension: decision.dimension, hypothesis: decision.hypothesis, rationale: decision.rationale })),
  };
}

function projectBriefFor(start: ProjectStart) {
  const recommendation = recommendationForStart(start);
  const selectedStack = start.discovery?.recommendedStack || selectedStackFor(start);
  const defaults = recommendation.defaults;
  // For a freeform build the current brief/discovery is the source of truth. Reusing the
  // mutable projectName seed here allowed an older dashboard prompt (for example Inventory
  // Management System) to determine the new mission title and folder after the brief changed.
  const projectName = start.template.id === "custom" && !start.projectNameTouched
    ? cleanProjectName(start.discovery?.projectType || start.projectDescription || start.appKind)
    : start.projectName || cleanProjectName(start.discovery?.projectType || start.appKind);
  const discovery = start.discovery;
  const answeredQuestions = Object.entries(start.discoveryAnswers)
    .filter(([, answer]) => answer.trim())
    .map(([dimension, answer]) => `${humanizeKey(dimension)}: ${answer.trim()}`);
  const customInstructions = start.instructions.trim() || (answeredQuestions.length ? answeredQuestions.join("; ") : "");
  const customInstructionsSummary = customInstructions.replace(/\s+/g, " ").trim();
  const liveFolderMode = start.projectLocation === "connect-existing" && Boolean(start.browserFolderHandleId);
  const uploadedCopyMode = start.projectLocation === "connect-existing" && !start.browserFolderHandleId && start.uploadedFiles.length > 0;
  const connectorMode = start.projectLocation === "create-folder" && Boolean(start.localConnectorRoot);
  const sourceMode = liveFolderMode
    ? "Connected live folder - browser File System Access direct edits"
    : uploadedCopyMode
      ? "Imported copy - Foundry workspace edits, export required"
      : connectorMode
        ? "Local agent - direct disk edits and permanent commands"
        : locationLabel(start.projectLocation);

  return [
    "# Foundry Project Brief",
    "",
    `Create Project: ${projectName}`,
    "",
    `Template: Intelligent Project Discovery`,
    liveFolderMode || uploadedCopyMode || connectorMode ? "Mode: Work on existing project" : "Mode: Build new project",
    `Project source: ${locationLabel(start.projectLocation)}`,
    `Project source mode: ${sourceMode}`,
    `Planned path: ${connectorMode ? start.localConnectorRoot : plannedProjectPath(start)}`,
    liveFolderMode ? `Browser folder handle id: ${start.browserFolderHandleId}` : "",
    liveFolderMode ? `Browser folder name: ${start.browserFolderName}` : "",
    connectorMode && start.localConnectorUrl ? `Local connector URL: ${start.localConnectorUrl}` : "",
    connectorMode ? `Local connector root: ${start.localConnectorRoot}` : "",
    connectorMode && start.localConnectorToken ? `Local connector token: ${start.localConnectorToken}` : "",
    `Selected upload files: ${uploadSummaryText(start.uploadNames)}`,
    start.uploadNames.length ? `Selected upload paths: ${start.uploadNames.join("; ")}` : "",
    start.projectLocation === "connect-existing"
      ? `Existing source guard: ${existingSourceSummary(start.uploadNames, start.existingSourceConfirmed)}`
      : "",
    start.existingSourceChoice ? `Existing folder guard: ${start.existingSourceChoice}` : "",
    `Project name: ${projectName}`,
    start.projectDescription ? `Project description: ${start.projectDescription}` : "",
    `Project type: ${discovery?.projectType || start.customSubtype.trim() || start.subtype}`,
    `Selected stack: ${selectedStack}`,
    alternativeStacksFor(start).length ? `Alternative stacks: ${alternativeStacksFor(start).join("; ")}` : "",
    `Architecture: ${discovery?.architecture || recommendation.why}`,
    discovery?.styleDirection ? `Style direction: ${discovery.styleDirection}` : "",
    discovery?.mainFeatures.length ? `Main features: ${discovery.mainFeatures.join("; ")}` : "",
    discovery?.dataModel.length ? `Data model/entities: ${discovery.dataModel.join("; ")}` : "",
    discovery?.keyFacts.length ? `Key facts: ${discovery.keyFacts.join("; ")}` : "",
    discovery?.futureCapabilities.length ? `Anticipated future capabilities (not building now, but leave room for): ${discovery.futureCapabilities.join("; ")}` : "",
    `Deployment: ${deploymentNoteFor(start)}`,
    `Stack capability: ${stackCapabilityLine(selectedStack)}`,
    discovery?.assumptions.length ? `Assumptions: ${discovery.assumptions.join("; ")}` : "",
    answeredQuestions.length ? `User-confirmed answers: ${answeredQuestions.join("; ")}` : "",
    discovery?.decisions.length ? `Confidence map: ${discovery.decisions.map((decision) => `${decision.dimension}=${decision.hypothesis} (${decision.confidence}%, ${decision.stakes}, ${decision.source}, ${decision.action})`).join("; ")}` : "",
    defaults.length && !discovery ? `Smart defaults: ${defaults.join("; ")}` : "",
    customInstructionsSummary ? `Custom instructions: ${customInstructionsSummary}` : "Custom instructions: None",
    start.instructionFiles.length ? `Attached project evidence: ${start.instructionFiles.map((file) => `${file.name} (${file.type || "unknown type"}, ${file.size} bytes)`).join("; ")}` : "Attached project evidence: None",
    "",
    liveFolderMode
      ? "Factory status: live local folder opened. Foundry should inspect and edit this browser-granted folder directly."
      : uploadedCopyMode
        ? "Factory status: uploaded project copy opened. Foundry edits a Foundry workspace copy; export is required to apply changes outside Foundry."
        : connectorMode
          ? "Factory status: local agent connected to a real folder on this computer. Foundry should create and edit files and run real commands there."
          : "Factory status: create a real workspace, save the brief, generate supported files, run real commands, and show actual execution results.",
    liveFolderMode || uploadedCopyMode || connectorMode ? "Next action: work inside the project workspace to add features, fix bugs, improve UI, analyze architecture, or prepare deployment." : "Next action: enter the project workspace and continue project work there.",
    "Architecture constraint: do not assume Foundry will depend only on uploaded files. Preserve a path for future local workspace connectors, local project folders, terminal/build logs, dev server ports, previews, and explicit user-approved file edits or commands.",
    "",
    "## User-provided custom instructions",
    customInstructions || "_None provided._",
    "",
    "## User-provided attachments",
    start.instructionFiles.length
      ? start.instructionFiles.map((file) => `- ${file.name} — ${file.type || "unknown type"}, ${file.size} bytes`).join("\n")
      : "_None provided._",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Migrate/Clone build a directive that reliably triggers isHighRiskArchitectureRequest()
 * (lib/ai/mission/mission-planner.ts) — the same feature-by-feature, build-alongside migration
 * guidance already used for a chat-driven "convert this to X" request, just constructed here instead
 * of hoping the user's own phrasing happens to match, since this is a creation-time action with a
 * known target stack rather than free text.
 */
function migrationDirectiveFor(start: ExistingProjectStart): string {
  const notes = start.description.replace(/\s+/g, " ").trim();
  if (start.action === "clone-existing") {
    return [`Create a new copy of this project migrated to ${start.targetStack.trim()}. Preserve feature parity — migrate feature-by-feature, not line-by-line — and leave the original project untouched.`, notes].filter(Boolean).join(" ");
  }
  if (start.action === "convert-existing") {
    return [`Migrate this project from its current stack to ${start.targetStack.trim()}. Build the new implementation alongside the current one and only remove old files once the migration is verified.`, notes].filter(Boolean).join(" ");
  }
  return notes;
}

function existingProjectBriefFor(start: ExistingProjectStart) {
  const action = existingProjectActions.find((item) => item.id === start.action) ?? existingProjectActions[0];
  const source = existingSourceOptions.find((item) => item.id === start.source) ?? existingSourceOptions[0];
  const effectiveDescription = migrationDirectiveFor(start);
  const sourceMode =
    start.source === "browser-local"
      ? start.localConnectorUrl && start.localConnectorRoot
        ? "Connected live folder + local agent - direct edits and permanent commands"
        : "Connected live folder - browser File System Access direct edits"
      : start.source === "connector"
        ? "Local agent - direct disk edits and permanent commands"
      : start.source === "local"
        ? "Local folder connected - direct disk edits"
        : start.source === "upload"
          ? "Imported copy - Foundry workspace edits, export required"
          : source.status;

  return [
    `Create Project: ${action.label}`,
    "",
    "Mode: Work on existing project",
    `Existing project action: ${action.label}`,
    `Project source: ${source.label}`,
    `Project source mode: ${sourceMode}`,
    start.source === "browser-local" ? `Browser folder handle id: ${start.browserFolderHandleId}` : "",
    start.source === "browser-local" ? `Browser folder name: ${start.browserFolderName}` : "",
    (start.source === "browser-local" || start.source === "connector") && start.localConnectorUrl && start.localConnectorRoot ? `Local connector URL: ${start.localConnectorUrl}` : "",
    (start.source === "browser-local" || start.source === "connector") && start.localConnectorRoot ? `Local connector root: ${start.localConnectorRoot}` : "",
    (start.source === "browser-local" || start.source === "connector") && start.localConnectorToken ? `Local connector token: ${start.localConnectorToken}` : "",
    start.source === "local" ? `Local project path: ${start.localPath}` : "",
    `Source status: ${source.status}`,
    `Selected upload files: ${uploadSummaryText(start.uploadNames)}`,
    start.uploadNames.length ? `Selected upload paths: ${start.uploadNames.join("; ")}` : "",
    `Editable uploaded files stored: ${start.uploadedFiles.length}`,
    `Existing project selection: ${openedExistingProjectSummary(start.uploadNames)}`,
    start.existingSourceChoice ? `Existing folder guard: ${start.existingSourceChoice}` : "",
    start.action === "convert-existing" || start.action === "clone-existing" ? `Target stack: ${start.targetStack.trim()}` : "",
    effectiveDescription ? `Custom instructions: ${effectiveDescription}` : "Custom instructions: No additional instructions.",
    effectiveDescription ? `Initial requested task: ${effectiveDescription}` : "Initial requested task: Not described yet.",
    "",
    "Factory status: existing project workspace opened. Foundry should inspect connected project files/evidence before making changes.",
    "Next action: work inside the project workspace to add features, fix bugs, improve UI, analyze architecture, or prepare deployment.",
  ].filter(Boolean).join("\n");
}
