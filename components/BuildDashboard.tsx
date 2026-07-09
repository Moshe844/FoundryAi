"use client";

import {
  AlertTriangle,
  AppWindow,
  BrainCircuit,
  Boxes,
  CheckCircle2,
  CircleDot,
  Code2,
  Download,
  FolderGit2,
  Gamepad2,
  Globe2,
  History,
  LayoutDashboard,
  Loader2,
  Lock,
  Pencil,
  Settings,
  ShoppingBag,
  SkipForward,
  Smartphone,
  Store,
  Trash2,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { ExecutionMission, MissionState } from "@/lib/mission-engine";
import { discoverProject } from "@/lib/ai/project-discovery";
import type { DiscoveryDecision, DiscoveryDimension, ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import { pickBrowserFolder, readBrowserFolderFiles, supportsBrowserFolderAccess } from "@/lib/factory/browser-folder";
import { capabilityLevelForStackChoice, unsupportedCreationMessage } from "@/lib/factory/language-adapters";
import type { StackProfile } from "@/lib/factory/language-adapters";
import type { CommandPermissionCategory } from "@/lib/ai/mission/command-permissions";
import type { FactoryExecutionEvent, FactoryExistingProjectRequest, FactoryFileReadResult, FactoryJournalEntry, FactoryObjectiveChecklistItem, FactoryProjectResult, FactoryUploadedFile } from "@/lib/factory/types";

type ApprovalResponse = FactoryExistingProjectRequest["approvalResponse"];

type BuildDashboardProps = {
  missions: MissionState[];
  activeMissionId: string;
  queuedTask?: string;
  onSelectMission: (missionId: string) => void;
  onCreateMission: () => void;
  onDeleteMission?: (missionId: string) => void;
  onCreateProject?: (brief: string, files?: FactoryUploadedFile[]) => void | Promise<void>;
  onUpdateProjectExecution?: (missionId: string, result: FactoryProjectResult) => void;
  onExecuteProject?: (missionId: string, task: string, approvalResponse?: ApprovalResponse) => void | Promise<void>;
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
type ExistingActionId = "connect-existing" | "debug-existing" | "improve-existing" | "analyze-architecture" | "deploy-existing";
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
  discovery: ProjectDiscoveryResult | null;
  discoveryAnswers: Record<string, string>;
  alternativeStacks: string[];
  deploymentNote: string;
  lede: string;
  styleChoice: string;
  customStyle: string;
};

type BuildTemplate = {
  id: TemplateId;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: "teal" | "amber" | "blue";
  defaults: string[];
};

type ProjectCategory = "web" | "desktop" | "desktop-windows" | "android" | "mobile-cross-platform" | "game" | "backend-api" | "ai-app" | "custom";

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
};

type FactoryView = "workspace" | "templates" | "settings" | "journal";

type ExecutionLevel = "summary" | "details" | "code" | "command";

type BlockedCommandAction = "approve-once" | "approve-category" | "approve-command" | "skip";

function executionTier(event: FactoryExecutionEvent) {
  return event.tier ?? "trace";
}

function isNarrativeEvent(event: FactoryExecutionEvent) {
  const tier = executionTier(event);
  return tier === "finding" || tier === "decision" || tier === "flag";
}

function eventVisibleAtLevel(event: FactoryExecutionEvent, level: ExecutionLevel) {
  if (level === "details") return true;
  if (level === "summary") return isNarrativeEvent(event) || event.kind === "summary" || event.kind === "build" || event.kind === "preview" || event.kind === "blocked" || event.kind === "planning";
  if (level === "code") return event.kind === "edit" || event.kind === "file";
  if (level === "command") return event.kind === "command" || event.kind === "build" || event.kind === "blocked";
  return true;
}

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

const stackRecommendations: Record<ProjectCategory, StackRecommendation[]> = {
  web: [
    {
      name: "Next.js",
      recommended: true,
      defaults: ["App Router", "TypeScript", "Tailwind CSS", "Local-first unless backend, database, or auth is requested"],
      why: "Best default for websites, dashboards, inventory tools, and commerce apps because it handles pages, UI state, routing, preview builds, and production deployment cleanly.",
    },
    {
      name: "React + Vite",
      defaults: ["TypeScript", "Tailwind CSS", "Client-side routing only when needed", "Static deployment-ready output"],
      why: "Good when the project is mostly a client-side interface and does not need server rendering, API routes, or auth-aware routing yet.",
    },
  ],
  desktop: [
    {
      name: "Electron",
      recommended: true,
      defaults: ["Desktop app", "TypeScript", "Web UI shell", "Local files or SQLite by default", "Cross-platform: Windows, macOS, Linux"],
      why: "Best default for a generic desktop app because it ships to Windows, macOS, and Linux from one codebase using familiar web UI technology.",
    },
    {
      name: ".NET WPF",
      defaults: [".NET", "C#", "WPF", "SQLite or local files by default", "Installer option later"],
      why: "Good when the app is Windows-only and benefits from richer native layouts, data binding, and a long-lived maintainable UI.",
    },
    {
      name: ".NET WinForms",
      defaults: [".NET", "C#", "WinForms", "SQLite or local files by default", "Installer option later"],
      why: "Good for simple internal Windows-only utilities and classic business tools where speed matters more than custom UI.",
    },
    {
      name: "Tauri",
      defaults: ["Desktop app", "Rust shell", "Web UI", "Local files or SQLite by default", "Smaller cross-platform bundles"],
      why: "Good when the app needs a smaller, faster cross-platform bundle than Electron and the team is comfortable with a Rust-backed shell.",
    },
  ],
  "desktop-windows": [
    {
      name: ".NET WPF",
      recommended: true,
      defaults: [".NET", "C#", "WPF", "SQLite or local files by default", "Installer option later"],
      why: "Best default for a polished Windows desktop app with richer layouts, data binding, and a long-lived maintainable UI.",
    },
    {
      name: ".NET WinForms",
      defaults: [".NET", "C#", "WinForms", "SQLite or local files by default", "Installer option later"],
      why: "Good for simple internal Windows utilities, fast forms, and classic business tools where speed matters more than custom UI.",
    },
  ],
  android: [
    {
      name: "Android Kotlin",
      recommended: true,
      defaults: ["Kotlin", "Android Studio project", "Gradle", "minSdk 26 suggestion", "targetSdk latest stable", "Device/emulator setup"],
      why: "Best native Android default because Kotlin is the modern Android language and Android Studio plus Gradle matches the platform toolchain.",
    },
    {
      name: "Android Java",
      defaults: ["Java", "Android Studio project", "Gradle", "minSdk 23 suggestion", "targetSdk latest stable", "Device/emulator setup"],
      why: "Useful for Java-heavy teams, older codebases, or when compatibility with existing Java Android examples matters.",
    },
  ],
  "mobile-cross-platform": [
    {
      name: "React Native",
      recommended: true,
      defaults: ["TypeScript", "Platform choice: iOS, Android, or both", "Navigation scaffold", "Device-safe layouts"],
      why: "Best default when the app should share code across iOS and Android while staying close to the React/TypeScript ecosystem.",
    },
    {
      name: "Flutter",
      defaults: ["Dart", "Platform choice: iOS, Android, or both", "Material/Cupertino-aware layout", "Device/emulator setup"],
      why: "Good when the project needs a highly consistent custom UI across platforms and the team is comfortable with Dart.",
    },
  ],
  game: [
    {
      name: "Unity",
      recommended: true,
      defaults: ["Unity", "C#", "Scene-based project", "Input setup", "Build target selected after prototype"],
      why: "Best default for a full game project with scenes, assets, physics, animation, and future desktop/mobile builds.",
    },
    {
      name: "Godot",
      defaults: ["Godot", "GDScript", "Scene tree", "Input map", "Export target selected after prototype"],
      why: "Good for lightweight 2D/3D games, fast iteration, and open-source workflows.",
    },
    {
      name: "Phaser",
      defaults: ["Web game", "Phaser", "TypeScript", "Responsive canvas", "Keyboard and pointer input"],
      why: "Best when the goal is a browser-playable game with quick preview URLs and web deployment.",
    },
  ],
  "backend-api": [
    {
      name: "Node/Express",
      recommended: true,
      defaults: ["TypeScript", "REST API", "Database choice required", "Local env file", "Health check endpoint"],
      why: "Best default for a small to medium API because it is fast to scaffold, easy to deploy, and works naturally with web frontends.",
    },
    {
      name: "NestJS",
      defaults: ["TypeScript", "Modular API", "Database choice required", "Validation layer", "Config module"],
      why: "Good when the backend needs stronger structure, dependency injection, modules, and larger-team maintainability.",
    },
    {
      name: ".NET Web API",
      defaults: ["C#", ".NET Web API", "Database choice required", "OpenAPI/Swagger", "Production config"],
      why: "Strong option for Windows/.NET teams, enterprise APIs, and projects that benefit from C# tooling.",
    },
    {
      name: "FastAPI",
      defaults: ["Python", "FastAPI", "Pydantic models", "Database choice required", "OpenAPI docs"],
      why: "Best Python default for typed APIs, data-heavy services, and AI-adjacent backends.",
    },
    {
      name: "Django",
      defaults: ["Python", "Django", "Database choice required", "Admin panel", "Auth-ready structure"],
      why: "Good when the backend needs an admin interface, built-in auth patterns, and a batteries-included framework.",
    },
    {
      name: "Spring Boot",
      defaults: ["Java", "Spring Boot", "Database choice required", "Gradle or Maven", "Actuator-ready health checks"],
      why: "Best fit for Java teams and enterprise-style APIs with mature ecosystem support.",
    },
  ],
  "ai-app": [
    {
      name: "Next.js AI App",
      recommended: true,
      defaults: ["Next.js App Router", "TypeScript", "Tailwind CSS", "Model provider selection", "Vector DB only if needed"],
      why: "Best default when the AI product needs a real UI, auth later, previews, and deployable web app behavior.",
    },
    {
      name: "Python/FastAPI AI Service",
      defaults: ["Python", "FastAPI", "Model provider selection", "Background task path when needed", "Vector DB only if needed"],
      why: "Best when the AI work is backend-heavy, data-processing-heavy, or needs Python ML tooling more than a full UI.",
    },
  ],
  custom: [
    {
      name: "Needs Discovery",
      recommended: true,
      defaults: ["Clarify target platform", "Pick stack after project type is known", "Preserve local workspace connector path"],
      why: "Custom projects need a little classification first so Foundry does not force a web stack onto a desktop, Android, backend, AI, or game project.",
    },
  ],
};

const broadStackOptions: StackRecommendation[] = [
  {
    name: "Next.js",
    defaults: ["App Router", "TypeScript", "Tailwind CSS", "Local-first unless backend, database, or auth is requested"],
    why: "A strong general web-app default for product UIs, dashboards, storefronts, and deployable previews.",
  },
  {
    name: "React + Vite",
    defaults: ["TypeScript", "Tailwind CSS", "Client-side routing only when needed", "Static deployment-ready output"],
    why: "Good for fast client-side apps that do not need server rendering or backend routes yet.",
  },
  {
    name: "Node/Express",
    defaults: ["TypeScript", "REST API", "Database choice when needed", "Local env file", "Health check endpoint"],
    why: "Good for lightweight APIs and services that need quick scaffolding and broad hosting support.",
  },
  {
    name: "Python/FastAPI",
    defaults: ["Python", "FastAPI", "Pydantic models", "OpenAPI docs", "Database choice when needed"],
    why: "Good for Python backends, data-heavy workflows, and AI-adjacent services.",
  },
  {
    name: ".NET WPF",
    defaults: [".NET", "C#", "WPF", "SQLite or local files by default", "Installer option later"],
    why: "Good for polished Windows desktop applications with richer layouts and data binding.",
  },
  {
    name: ".NET WinForms",
    defaults: [".NET", "C#", "WinForms", "SQLite or local files by default", "Installer option later"],
    why: "Good for practical Windows business tools and simple internal desktop apps.",
  },
  {
    name: "Android Kotlin",
    defaults: ["Kotlin", "Android Studio project", "Gradle", "minSdk 26 suggestion", "targetSdk latest stable", "Device/emulator setup"],
    why: "Good for native Android apps using the modern Android toolchain.",
  },
  {
    name: "Android Java",
    defaults: ["Java", "Android Studio project", "Gradle", "minSdk 23 suggestion", "targetSdk latest stable", "Device/emulator setup"],
    why: "Good for Java Android projects, older codebases, or Java-first teams.",
  },
  {
    name: "React Native",
    defaults: ["TypeScript", "Platform choice: iOS, Android, or both", "Navigation scaffold", "Device-safe layouts"],
    why: "Good for cross-platform mobile apps in the React and TypeScript ecosystem.",
  },
  {
    name: "Flutter",
    defaults: ["Dart", "Platform choice: iOS, Android, or both", "Material/Cupertino-aware layout", "Device/emulator setup"],
    why: "Good for consistent custom mobile UI across iOS and Android.",
  },
  {
    name: "Unity",
    defaults: ["Unity", "C#", "Scene-based project", "Input setup", "Build target selected after prototype"],
    why: "Good for full game projects with scenes, assets, physics, and future platform builds.",
  },
  {
    name: "Godot",
    defaults: ["Godot", "GDScript", "Scene tree", "Input map", "Export target selected after prototype"],
    why: "Good for lightweight 2D/3D games and fast open-source iteration.",
  },
  {
    name: "Phaser",
    defaults: ["Web game", "Phaser", "TypeScript", "Responsive canvas", "Keyboard and pointer input"],
    why: "Good for browser-playable games with quick preview and web deployment.",
  },
  {
    name: "PHP/Laravel",
    defaults: ["PHP", "Laravel", "Database choice when needed", "Blade or API routes", "Auth scaffolding only if requested"],
    why: "Good for PHP teams, CRUD-heavy apps, and Laravel ecosystem workflows.",
  },
  {
    name: "Electron",
    defaults: ["Desktop app", "TypeScript", "Web UI shell", "Local files or SQLite by default", "Installer option later"],
    why: "Good for desktop apps that benefit from web UI technology and cross-platform packaging.",
  },
  {
    name: "Tauri",
    defaults: ["Desktop app", "Rust shell", "Web UI", "Local files or SQLite by default", "Installer option later"],
    why: "Good for smaller desktop bundles with a Rust-backed native shell.",
  },
  {
    name: "Rust",
    defaults: ["Rust", "Cargo project", "CLI or service shape", "Structured errors", "Tests from the start"],
    why: "Good for performance-sensitive tools, CLIs, and systems-oriented projects.",
  },
  {
    name: "Go",
    defaults: ["Go", "Simple module layout", "CLI or HTTP service shape", "Structured config", "Tests from the start"],
    why: "Good for small services, CLIs, and deployable backend tools.",
  },
  {
    name: "HTML/CSS/JS",
    defaults: ["Static HTML", "CSS", "Vanilla JavaScript", "No framework by default", "Static deployment-ready output"],
    why: "Good for simple websites, prototypes, and small browser-only projects.",
  },
  {
    name: "Custom",
    defaults: ["Use the custom stack or language details from the field below", "Clarify structure before generation"],
    why: "Use this when the project needs a stack not covered by the common presets.",
  },
];

export function BuildDashboard({ missions, activeMissionId, queuedTask, onSelectMission, onCreateMission, onDeleteMission, onCreateProject, onExecuteProject, onRollbackToEntry, onApproveCategory, onApproveCommand }: BuildDashboardProps) {
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
  const realEvents = connectedProject?.liveWorkEvents ?? [];
  const execution = connectedProject ? projectExecutionFromMission(connectedProject) : null;
  const connectorInfo = connectedProject ? connectorInfoFromMission(connectedProject) : null;
  const [connectorTreeFiles, setConnectorTreeFiles] = useState<FactoryProjectResult["files"]>([]);
  const [connectorTreeForMissionId, setConnectorTreeForMissionId] = useState("");

  useEffect(() => {
    if (!connectedProject || !connectorInfo) {
      setConnectorTreeFiles([]);
      setConnectorTreeForMissionId("");
      return;
    }
    let cancelled = false;
    const missionId = connectedProject.missionId;
    void listAgentTree(connectorInfo.url, connectorInfo.token, connectorInfo.root).then((result) => {
      if (cancelled || !result.ok) return;
      setConnectorTreeFiles(result.entries.map((entry) => ({ path: entry.path, status: "uploaded" as const, size: entry.size })));
      setConnectorTreeForMissionId(missionId);
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
  const connectedPath = connectedProject ? connectedPathForMission(connectedProject, execution) : "";
  const selectedProjectBrief = connectedProject && isSoftwareProjectMission(connectedProject) ? projectBriefFromMission(connectedProject) : "";

  async function fetchFileContent(filePath: string): Promise<string | null> {
    const virtualFile = execution?.files.find((file) => file.path === filePath && typeof file.content === "string");
    if (virtualFile?.content !== undefined) return virtualFile.content;
    const connectedFile = workspaceFiles.find((file) => file.path === filePath);
    if (connectedFile && typeof connectedFile.content === "string") return connectedFile.content;
    if (connectorInfo) return readAgentFile(connectorInfo.url, connectorInfo.token, connectorInfo.root, filePath);
    const projectId = execution?.projectId;
    if (!projectId) return null;
    try {
      const response = await fetch(`/api/factory/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`);
      if (!response.ok) return null;
      const result = (await response.json()) as FactoryFileReadResult;
      return result.content;
    } catch {
      return null;
    }
  }

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
      const content = await readAgentFile(connectorInfo.url, connectorInfo.token, connectorInfo.root, filePath);
      if (content !== null) {
        setSelectedFile({ projectId: connectedPath || "connected-project", path: filePath, content });
        setFilePanelOpen(true);
      } else {
        setFileReadError("Could not read that file from the connected local agent.");
      }
      return;
    }
    if (connectedFile && typeof connectedFile.content !== "string") {
      setSelectedFile({
        projectId: connectedPath || "connected-project",
        path: filePath,
        content: "File content is not available for this older project record. Re-open/upload the project folder to let Foundry inspect and edit file contents.",
      });
      setFileReadError("");
      setFilePanelOpen(true);
      return;
    }
    const projectId = projectIdOverride ?? execution?.projectId;
    if (!projectId) return;
    setFileReadError("");
    try {
      const response = await fetch(`/api/factory/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`);
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Could not read file.");
      setSelectedFile((await response.json()) as FactoryFileReadResult);
      setFilePanelOpen(true);
    } catch (error) {
      setFileReadError(error instanceof Error ? error.message : "Could not read file.");
    }
  }

  function openFlow(template: BuildTemplate) {
    const subtype = firstSubtypeFor(template.id);
    const appKind = appKindFor(template, subtype, "");
    const projectName = template.id === "custom" ? "" : cleanProjectName(appKind);
    const initialDiscovery = template.id === "custom" ? null : discoverProject(appKind);
    const recommendedStack = initialDiscovery?.recommendedStack ?? primaryRecommendationFor(template, appKind).name;
    setActiveTemplate(template);
    setFlowStep("kind");
    setStart({
      template,
      projectMode: "new",
      projectLocation: "inside-foundry",
      subtype,
      customSubtype: "",
      projectName,
      projectNameTouched: false,
      projectDescription: "",
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
      stack: recommendedStack,
      customStack: "",
      instructions: "",
      discovery: initialDiscovery,
      discoveryAnswers: {},
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
      void onCreateProject?.(projectBriefFor(start), start.uploadedFiles);
    } else {
      onCreateMission();
    }
    closeFlow();
  }

  return (
    <>
      <main
        className="grid min-h-0 gap-4 overflow-hidden p-3 lg:grid-cols-[240px_minmax(0,1fr)] lg:p-4"
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
        />

        {activeView === "templates" ? (
          <FactoryHome realEvents={realEvents} onOpenFlow={openFlow} onOpenExistingFlow={openExistingFlow} />
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
            <ProjectBriefView
              mission={connectedProject}
              brief={selectedProjectBrief}
              execution={execution}
              connectedPath={connectedPath}
              workspaceFiles={workspaceFiles}
              queuedTask={queuedTask}
            onStartProject={() => openFlow(buildTemplates.find((template) => template.id === "custom") ?? buildTemplates[0])}
            onViewFiles={() => setFilePanelOpen(true)}
            onReadFile={readGeneratedFile}
            onFetchFileContent={fetchFileContent}
            onExecute={(task, approvalResponse) => {
              setActiveView("workspace");
              setFilePanelOpen(false);
              setSelectedFile(null);
              void onExecuteProject?.(connectedProject.missionId, task, approvalResponse);
            }}
            onApproveCategory={onApproveCategory ? (category) => onApproveCategory(connectedProject.missionId, category) : undefined}
            onApproveCommand={onApproveCommand ? (command) => onApproveCommand(connectedProject.missionId, command) : undefined}
          />
        ) : (
          <FactoryHome realEvents={realEvents} onOpenFlow={openFlow} onOpenExistingFlow={openExistingFlow} />
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
              const currentRecommendations = recommendationsFor(nextStart.template, effectiveAppKind);
              const nextStack = currentRecommendations.some((recommendation) => recommendation.name === start.stack)
                ? start.stack
                : currentRecommendations[0]?.name ?? start.stack;
              updateStart({ ...update, appKind: effectiveAppKind, stack: update.stack ?? nextStack });
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

      {filePanelOpen && (execution || selectedFile) ? (
        <FileTreePanel
          execution={execution}
          workspaceFiles={workspaceFiles}
          connectedPath={connectedPath}
          selectedFile={selectedFile}
          error={fileReadError}
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
}: Pick<BuildDashboardProps, "missions" | "activeMissionId" | "onSelectMission" | "onCreateMission" | "onDeleteMission"> & {
  activeView: FactoryView;
  onViewChange: (view: FactoryView) => void;
}) {
  const projectMissions = missions.filter(isSoftwareProjectMission);
  const activeMission = missions.find((mission) => mission.missionId === activeMissionId);
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
    <aside className="glass-panel flex min-h-0 flex-col gap-4 p-3" aria-label="Factory navigation">
      <div className="px-1">
        <p className="section-kicker">Projects</p>
        <p className="mt-1 text-xs leading-5 text-foundry-subtle">Switch workspaces or start a new one.</p>
      </div>

      <nav className="grid gap-1.5 border-t border-white/10 pt-3" aria-label="Workspace views">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition ${
                activeView === item.id ? "bg-white/[0.075] text-foundry-ink" : "text-foundry-muted hover:bg-white/[0.045] hover:text-foundry-ink"
              }`}
              type="button"
              onClick={() => onViewChange(item.id)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="min-h-0 border-t border-white/10 pt-3">
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
                activeMissionId === mission.missionId ? "bg-white/[0.075] text-foundry-ink" : "text-foundry-muted hover:bg-white/[0.045] hover:text-foundry-ink"
              }`}
            >
              <button className="min-w-0 px-3 py-2 text-left" type="button" onClick={() => onSelectMission(mission.missionId)}>
                <span className="block truncate text-[13px] font-semibold">{projectTitleFor(mission)}</span>
                <span className="mt-0.5 block truncate text-[11px] text-foundry-subtle">{mission.updatedAt.slice(0, 10)}</span>
              </button>
              {onDeleteMission ? (
                <button
                  className="mr-1 grid h-8 w-8 place-items-center rounded-md text-foundry-subtle opacity-70 transition hover:bg-white/10 hover:text-foundry-ink group-hover:opacity-100"
                  type="button"
                  title={`Delete ${projectTitleFor(mission)}`}
                  aria-label={`Delete ${projectTitleFor(mission)}`}
                  onClick={() => onDeleteMission(mission.missionId)}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          ))}
          {projectMissions.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/15 px-3 py-4 text-xs leading-5 text-foundry-subtle">
              Old chat threads are hidden here. New factory projects will appear after you start a build.
            </div>
          ) : null}
        </div>
      </section>
    </aside>
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
    <section className="min-h-0 overflow-auto rounded-xl border border-white/10 bg-[#101416]/90 shadow-workspace">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <p className="section-kicker">Permanent Record</p>
        <h1 className="mt-2 text-2xl font-extrabold text-foundry-ink">Execution Journal</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foundry-muted">
          Every action Foundry has taken on this project, durably recorded — commands run, files created and edited, permissions requested, retries, and failures. This survives reloads and is separate from the live mission timeline.
        </p>
      </div>

      <div className="grid gap-2 p-4 sm:p-5">
        {!projectId ? (
          <div className="rounded-md border border-dashed border-white/15 px-3 py-6 text-sm leading-6 text-foundry-subtle">Open a project to see its execution journal.</div>
        ) : loading ? (
          <div className="px-3 py-6 text-sm text-foundry-muted">Loading journal...</div>
        ) : error ? (
          <div className="rounded-md border border-red-400/25 bg-red-400/[0.05] px-3 py-3 text-sm text-red-200">{error}</div>
        ) : entries.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/15 px-3 py-6 text-sm leading-6 text-foundry-subtle">No durable history recorded for this project yet.</div>
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
    <div className={`rounded-md border px-3 py-2 ${entry.reverted ? "border-white/5 bg-black/10 opacity-60" : "border-white/10 bg-black/20"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="font-mono text-[10px] text-foundry-subtle">{new Date(entry.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <span className="min-w-0 truncate font-semibold text-foundry-ink">{event.title}</span>
          {entry.reverted ? <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-foundry-subtle">reverted</span> : null}
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
    <section className="min-h-0 overflow-auto border border-white/10 bg-[#0c1011]/95 shadow-workspace">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <p className="section-kicker">Settings</p>
        <h1 className="mt-2 text-2xl font-extrabold text-foundry-ink">Workspace settings</h1>
      </div>

      <div className="grid max-w-4xl gap-5 p-4 sm:p-5">
        <section className="grid gap-3 border-b border-white/10 pb-5">
          <h2 className="text-sm font-extrabold text-foundry-ink">Current project</h2>
          <SummaryRow label="Workspace" value={mission ? projectTitleFor(mission) : "No workspace selected"} />
          <SummaryRow label="Editing target" value={editingTarget} />
          <SummaryRow label="Source mode" value={projectSourceCopy(sourceMode, Boolean(localPath), Boolean(execution?.projectPath))} />
          <SummaryRow label="Files loaded" value={String(files)} />
          <SummaryRow label="Last result" value={mission?.lastResult || "Ready"} />
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <button
            className="min-h-24 rounded-md border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-foundry-teal/35 hover:bg-foundry-teal/[0.08]"
            type="button"
            onClick={onOpenTemplates}
          >
            <span className="text-sm font-extrabold text-foundry-ink">Templates</span>
            <span className="mt-2 block text-xs leading-5 text-foundry-muted">Create a new project from a starter or custom brief.</span>
          </button>
          <button
            className="min-h-24 rounded-md border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-foundry-blue/35 hover:bg-foundry-blue/[0.08]"
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
      className="group min-h-[210px] rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-foundry-teal/35 hover:bg-white/[0.065] focus-visible:border-foundry-teal/45 focus-visible:outline-none"
      type="button"
      onClick={onStart}
    >
      <span className={`grid h-10 w-10 place-items-center rounded-md border ${accentClass}`}>
        <Icon size={19} />
      </span>
      <span className="mt-4 block text-base font-extrabold text-foundry-ink">{template.title}</span>
      <span className="mt-2 block text-sm leading-6 text-foundry-muted">{template.description}</span>
      <span className="mt-4 grid gap-1.5">
        {template.defaults.slice(0, 2).map((item) => (
          <span key={item} className="flex items-center gap-2 text-xs font-bold text-foundry-subtle">
            <CircleDot size={12} className="text-foundry-teal" />
            {item}
          </span>
        ))}
      </span>
    </button>
  );
}

function FactoryHome({
  realEvents,
  onOpenFlow,
  onOpenExistingFlow,
}: {
  realEvents: string[];
  onOpenFlow: (template: BuildTemplate) => void;
  onOpenExistingFlow: (action: ExistingActionId) => void;
}) {
  const starterTemplates = buildTemplates.filter((template) => template.id !== "custom");
  const customTemplate = buildTemplates.find((template) => template.id === "custom") ?? buildTemplates[0];
  const localAgentStatus = useLocalAgentInstallStatus();
  const localAgentInstalled = localAgentStatus === "installed" || localAgentStatus === "connected";

  return (
    <section className="min-h-0 overflow-auto rounded-xl border border-white/10 bg-[#101416]/90 shadow-workspace">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <p className="section-kicker">AI Software Factory</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-foundry-ink sm:text-3xl">Projects</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foundry-muted">
              Create a new software project or open an existing one. Once you are inside a project, Foundry becomes the engineering teammate for build, debug, improve, analyze, deploy, preview, and export work.
            </p>
          </div>
          {localAgentInstalled ? (
            <button
              className="inline-flex min-h-10 cursor-default items-center gap-2 rounded-md border border-white/15 bg-white/[0.045] px-3.5 text-sm font-extrabold text-foundry-subtle opacity-70"
              type="button"
              disabled
              title="Foundry Local Agent is responding on this computer."
            >
              <CheckCircle2 size={16} />
              Local Agent Downloaded
            </button>
          ) : localAgentStatus === "checking" ? (
            <button
              className="inline-flex min-h-10 cursor-default items-center gap-2 rounded-md border border-white/15 bg-white/[0.045] px-3.5 text-sm font-extrabold text-foundry-subtle"
              type="button"
              disabled
            >
              <Loader2 size={16} className="animate-spin" />
              Checking Agent
            </button>
          ) : (
            <a
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3.5 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]"
              href="/api/factory/agent/download?platform=windows"
              download
              onClick={(event) => {
                event.currentTarget.href = `/api/factory/agent/download?platform=windows&v=${encodeURIComponent(String(Date.now()))}`;
              }}
            >
              <Download size={16} />
              Download Local Agent
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5">
        <section className="grid gap-3 lg:grid-cols-2">
          <button
            className="min-h-[190px] rounded-lg border border-foundry-teal/25 bg-foundry-teal/[0.07] p-5 text-left transition hover:border-foundry-teal/45 hover:bg-foundry-teal/[0.11] focus-visible:border-foundry-teal/50 focus-visible:outline-none"
            type="button"
            onClick={() => onOpenFlow(customTemplate)}
          >
            <span className="grid h-11 w-11 place-items-center rounded-md border border-foundry-teal/30 bg-black/20 text-foundry-teal">
              <Code2 size={20} />
            </span>
            <span className="mt-4 block text-xl font-extrabold text-foundry-ink">Create New Project</span>
            <span className="mt-2 block text-sm leading-6 text-foundry-muted">
              Choose a starter or describe what you want, then Foundry asks type, subtype, stack, name, instructions, and generates the project.
            </span>
          </button>

          <button
            className="min-h-[190px] rounded-lg border border-foundry-blue/25 bg-foundry-blue/[0.07] p-5 text-left transition hover:border-foundry-blue/45 hover:bg-foundry-blue/[0.11] focus-visible:border-foundry-blue/50 focus-visible:outline-none"
            type="button"
            onClick={() => onOpenExistingFlow("connect-existing")}
          >
            <span className="grid h-11 w-11 place-items-center rounded-md border border-foundry-blue/30 bg-black/20 text-foundry-blue">
              <FolderGit2 size={20} />
            </span>
            <span className="mt-4 block text-xl font-extrabold text-foundry-ink">Open Existing Project</span>
            <span className="mt-2 block text-sm leading-6 text-foundry-muted">
              Open a Foundry workspace project, upload ZIP/project files now, or use GitHub/local folder connectors when those integrations arrive.
            </span>
          </button>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-extrabold text-foundry-ink">Create New Project Starters</h2>
            <span className="text-xs font-bold text-foundry-subtle">Optional shortcuts</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {starterTemplates.map((template) => (
              <BuildCard key={template.id} template={template} onStart={() => onOpenFlow(template)} />
            ))}
            <BuildCard template={customTemplate} onStart={() => onOpenFlow(customTemplate)} />
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <p className="section-kicker">Open Existing Project</p>
            <h2 className="mt-2 text-lg font-extrabold text-foundry-ink">Bring a project into Foundry</h2>
            <p className="mt-2 text-sm leading-6 text-foundry-muted">
              Open a Foundry workspace project from the sidebar, upload ZIP/project files now, or prepare for GitHub and local folder connector support later. Debug, improve, refactor, analyze, and deploy happen after the project is open.
            </p>
            <button
              className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-white/15 bg-white/[0.055] px-3.5 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-blue/35 hover:bg-foundry-blue/10 hover:text-foundry-ink"
              type="button"
              onClick={() => onOpenExistingFlow("connect-existing")}
            >
              <FolderGit2 size={16} />
              Open Project Flow
            </button>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <p className="section-kicker">Recent Project Activity</p>
            <div className="mt-3 grid gap-2">
              {realEvents.length > 0 ? (
                realEvents.slice(-5).map((event, index) => (
                  <div key={`${event}-${index}`} className="flex items-center gap-2 rounded-md bg-black/20 px-3 py-2 text-sm text-foundry-muted">
                    <CheckCircle2 size={15} className="text-foundry-teal" />
                    <span>{event}</span>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-white/15 px-3 py-6 text-sm leading-6 text-foundry-subtle">
                  No execution events yet. When Foundry creates files, edits code, runs commands, captures logs, fixes errors, or exposes a preview URL, those real events appear here.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function ProjectBriefView({
  mission,
  brief,
  execution,
  connectedPath,
  workspaceFiles,
  queuedTask,
  onStartProject,
  onViewFiles,
  onReadFile,
  onFetchFileContent,
  onExecute,
  onApproveCategory,
  onApproveCommand,
}: {
  mission: MissionState;
  brief: string;
  execution: FactoryProjectResult | null;
  connectedPath: string;
  workspaceFiles: FactoryProjectResult["files"];
  queuedTask?: string;
  onStartProject: () => void;
  onViewFiles: () => void;
  onReadFile: (path: string) => void;
  onFetchFileContent: (path: string) => Promise<string | null>;
  onExecute: (task: string, approvalResponse?: ApprovalResponse) => void;
  onApproveCategory?: (category: string) => void;
  onApproveCommand?: (command: string) => void;
}) {
  const [task, setTask] = useState("");
  const [executionLevel, setExecutionLevel] = useState<ExecutionLevel>("summary");
  const activeTaskRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const workScrollRef = useRef<HTMLDivElement | null>(null);
  const timeline = projectTimelineFromMission(mission, execution);
  const activeExecutionMission = activeExecutionMissionFor(mission);
  const isExecutionLive = isProjectWorkInProgress(mission);
  const isExistingProject = /^Mode:\s*Work on existing project/im.test(brief);
  const localPath = brief.match(/^Local project path:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const sourceMode = projectSourceModeForBrief(brief);
  const browserFolderName = brief.match(/^Browser folder name:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const visibleFiles = execution?.files.length ? mergeConnectorFiles(workspaceFiles, execution.files) : workspaceFiles;
  const editingTarget = browserFolderName || localPath || (sourceMode === "upload" && execution?.projectPath ? `${execution.projectPath} (Foundry copy)` : connectedPath || execution?.projectPath || "No editing target yet");
  const activeFileEvent = liveFileIndicatorEvent(timeline, isExecutionLive);
  const recentlyChangedPaths = useRecentlyChangedPaths(timeline);
  const needsUserAction = activeExecutionMission?.state === "waiting_for_approval" || activeExecutionMission?.state === "waiting_for_user";
  const effectiveLevel: ExecutionLevel = isExecutionLive || needsUserAction ? "details" : executionLevel;
  const connectorUrl = brief.match(/^Local connector URL:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const connectorToken = brief.match(/^Local connector token:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const connectorRoot = brief.match(/^Local connector root:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const liveAgentStatus = useLiveAgentStatus(sourceMode === "connector" ? connectorUrl : "", connectorToken, connectorRoot);

  useEffect(() => {
    composerRef.current?.focus();
  }, [isExecutionLive, execution?.status, mission.messages.length]);

  useEffect(() => {
    // A mission paused waiting on the user must keep showing the detailed timeline — that's
    // the only view with the approval buttons / clarification prompt. Never auto-collapse it
    // to the summary card, no matter how long it's been since the mission actually ran.
    if (!isExecutionLive && !needsUserAction) setExecutionLevel("summary");
  }, [isExecutionLive, needsUserAction]);

  function runTask() {
    const trimmed = task.trim();
    if (!trimmed && isExecutionLive) return;
    const nextTask = trimmed || (execution ? "Continue working on this project" : "Build the initial project");
    setTask("");
    onExecute(nextTask);
  }

  function stopTask() {
    setTask("");
    onExecute("stop");
  }

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border border-white/10 bg-[#0c1011]/95 shadow-workspace">
      <div className="border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold text-foundry-ink sm:text-2xl">{projectTitleFor(mission)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-foundry-muted">
              <span className="break-all text-foundry-ink">{editingTarget}</span>
              <span>{projectSourceCopy(sourceMode, Boolean(localPath), Boolean(execution?.projectPath))}</span>
              {liveAgentStatus ? <AgentStatusBadge status={liveAgentStatus} /> : null}
            </div>
              {activeFileEvent ? <LiveFileIndicator event={activeFileEvent} /> : null}
              {activeExecutionMission ? <MissionStatePill mission={activeExecutionMission} /> : null}
          </div>
          <div className="flex items-center gap-2">
            {!isExecutionLive && !needsUserAction ? <ExecutionLevelToggle level={executionLevel} onChange={setExecutionLevel} /> : null}
            <button className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/15 bg-white/[0.035] px-3 text-xs font-extrabold text-foundry-muted transition hover:border-foundry-blue/35 hover:bg-foundry-blue/10 hover:text-foundry-ink" type="button" onClick={onStartProject}>
              <Code2 size={16} />
              New Project
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-white/10 bg-black/15 p-3 lg:border-b-0 lg:border-r lg:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Project</p>
              <h2 className="mt-1 text-sm font-extrabold text-foundry-ink">{visibleFiles.length} files</h2>
            </div>
            <button className="text-xs font-extrabold text-foundry-teal" type="button" onClick={onViewFiles}>Open</button>
          </div>
          <ProjectFileTree files={visibleFiles} onReadFile={onReadFile} recentlyChangedPaths={recentlyChangedPaths} />
        </aside>
        <div ref={workScrollRef} className="min-h-0 overflow-auto p-3 pr-1 sm:p-4">
          <ProjectWorkConversation
            mission={mission}
            execution={execution}
            timeline={timeline}
            activeExecutionMission={activeExecutionMission}
            level={effectiveLevel}
            isExecutionLive={isExecutionLive}
            isExistingProject={isExistingProject}
            activeTaskRef={activeTaskRef}
            scrollContainerRef={workScrollRef}
            onReadFile={onReadFile}
            onFetchFileContent={onFetchFileContent}
            onSkipItem={(item) => onExecute(`The user asked to skip checklist item "${item.label}" — mark it skipped and continue with everything else.`)}
            onApproveCommand={(event, action) => {
              const command = event.command ?? event.title;
              const category = event.details?.category as CommandPermissionCategory | undefined;
              if (action === "skip") {
                onExecute(
                  `Denied approval to run "${command}" - mark the checklist item that needed it as skipped (not blocked) and continue with every other item that can still be verified safely.`,
                  { requestedCommand: command, decision: "deny" },
                );
                return;
              }
              if (action === "approve-category" && category) {
                onApproveCategory?.(category);
              }
              if (action === "approve-command") {
                onApproveCommand?.(command);
              }
              const decision = action === "approve-once" ? "approve-once" : action === "approve-category" ? "approve-category" : "approve-command";
              onExecute(`Approved: run ${command}`, { requestedCommand: command, decision, category: decision === "approve-category" ? category : undefined });
            }}
          />
        </div>
      </div>

      {activeExecutionMission?.pending_mock_review ? (
        <MockReviewPanel pendingMockReview={activeExecutionMission.pending_mock_review} execution={execution} onExecute={onExecute} />
      ) : null}

      <ProjectComposer
        inputRef={composerRef}
        task={task}
        isBusy={isExecutionLive}
        queuedTask={queuedTask}
        canUndo={timeline.some((event) => !event.internal && event.kind === "edit" && event.status === "completed")}
        onTaskChange={setTask}
        onExecute={runTask}
        onStop={stopTask}
        onUndo={() => onExecute("Undo the last file change")}
      />
    </section>
  );
}

function ProjectWorkConversation({
  mission,
  execution,
  timeline,
  activeExecutionMission,
  level,
  isExecutionLive,
  isExistingProject,
  activeTaskRef,
  scrollContainerRef,
  onReadFile,
  onFetchFileContent,
  onApproveCommand,
  onSkipItem,
}: {
  mission: MissionState;
  execution: FactoryProjectResult | null;
  timeline: FactoryExecutionEvent[];
  activeExecutionMission: ExecutionMission | undefined;
  level: ExecutionLevel;
  isExecutionLive: boolean;
  isExistingProject: boolean;
  activeTaskRef: RefObject<HTMLDivElement | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onReadFile: (path: string) => void;
  onFetchFileContent: (path: string) => Promise<string | null>;
  onApproveCommand?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
  onSkipItem?: (item: FactoryObjectiveChecklistItem) => void;
}) {
  const requestMessages = mission.messages.filter((message) => message.tags?.includes("Project request"));
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const latestRequest = requestMessages.at(-1);
  const previousExecutionMissions = mission.executionMissions.filter((item) => item.id !== activeExecutionMission?.id).slice().reverse();

  useEffect(() => {
    const container = scrollContainerRef.current;
    const followTarget = timelineEndRef.current ?? activeTaskRef.current;
    if (!container || !followTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const targetRect = followTarget.getBoundingClientRect();
      const bottomOverflow = targetRect.bottom - containerRect.bottom + 16;
      if (bottomOverflow > 0) {
        container.scrollTo({ top: container.scrollTop + bottomOverflow, behavior: "smooth" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTaskRef, execution?.status, isExecutionLive, latestRequest?.id, mission.liveWorkEvents.length, scrollContainerRef, timeline.length]);

  if (!requestMessages.length) {
    return (
      <div className="grid min-h-full content-start gap-5 px-1 py-2">
        <section ref={activeTaskRef} className="max-w-4xl border-b border-white/10 pb-5">
          <h2 className="text-lg font-extrabold text-foundry-ink">Ready for the next instruction.</h2>
          <p className="mt-2 text-sm leading-6 text-foundry-muted">
            {isExistingProject
              ? "Ask a question to inspect without edits, or describe a change and Foundry will work directly against the connected source mode."
              : "Describe what to build. Foundry will create files only for new-project mode."}
          </p>
          {(isExecutionLive || level !== "summary") && (isExecutionLive || timeline.length) ? (
            <div className="mt-4 border-l border-white/10 pl-4">
              <ExecutionTimeline
                timeline={timeline}
                level={level}
                fallbackEvents={mission.liveWorkEvents.length ? mission.liveWorkEvents : isExecutionLive ? ["Starting execution..."] : []}
                endRef={timelineEndRef}
                onReadFile={onReadFile}
                onFetchFileContent={onFetchFileContent}
                onApproveCommand={onApproveCommand}
              />
            </div>
          ) : null}
          {!isExecutionLive && level === "summary" && execution ? (
            <div className="mt-4 border-l border-white/10 pl-4">
              <MissionSummary execution={execution} timeline={timeline} onReadFile={onReadFile} onApproveCommand={onApproveCommand} />
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  const activeRequest = latestRequest ?? requestMessages[requestMessages.length - 1];
  const latestAnswer = answerForProjectRequest(mission, activeRequest, undefined);

  return (
    <div className="grid gap-5 pb-6">
      {previousExecutionMissions.length ? <PreviousMissionsPanel missions={previousExecutionMissions} /> : null}
      <section key={activeRequest.id} ref={activeTaskRef} className="max-w-4xl border-b border-white/10 pb-5">
        <ProjectThreadMessage message={activeRequest} prominent />
        <div className="mt-4 border-l border-white/10 pl-4">
          {latestAnswer ? <ProjectThreadMessage message={latestAnswer} compact /> : null}
          {(activeExecutionMission?.plan.length ? activeExecutionMission.plan : execution?.checklist)?.length ? (
            <MissionChecklistBoard
              checklist={activeExecutionMission?.plan.length ? activeExecutionMission.plan : execution?.checklist ?? []}
              isLive={isExecutionLive}
              onSkipItem={isExecutionLive ? onSkipItem : undefined}
            />
          ) : null}
          {(isExecutionLive || level !== "summary") && (isExecutionLive || timeline.length || mission.liveWorkEvents.length) ? (
            <ExecutionTimeline
              timeline={timeline}
              level={level}
              fallbackEvents={mission.liveWorkEvents.length ? mission.liveWorkEvents : ["Starting execution..."]}
              endRef={timelineEndRef}
              onReadFile={onReadFile}
              onFetchFileContent={onFetchFileContent}
              onApproveCommand={onApproveCommand}
            />
          ) : null}
          {!isExecutionLive && level === "summary" && execution ? (
            <>
              <MissionSummary execution={execution} timeline={timeline} onReadFile={onReadFile} onApproveCommand={onApproveCommand} />
              <PreviewPanel execution={execution} />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function answerForProjectRequest(mission: MissionState, requestMessage: MissionState["messages"][number], nextRequestMessage: MissionState["messages"][number] | undefined) {
  const startIndex = mission.messages.findIndex((message) => message.id === requestMessage.id);
  if (startIndex < 0) return undefined;
  const endIndex = nextRequestMessage ? mission.messages.findIndex((message) => message.id === nextRequestMessage.id) : mission.messages.length;

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const candidate = mission.messages[index];
    if (candidate.tags?.includes("Project answer")) return candidate;
  }
  return undefined;
}

function ProjectThreadMessage({ message, prominent = false, compact = false }: { message: MissionState["messages"][number]; prominent?: boolean; compact?: boolean }) {
  const isUser = message.tags?.includes("Project request") || message.author === "You";
  const body = message.body.trim();
  return (
    <article className={`${prominent ? "sticky -top-3 z-20 -mx-3 border-b border-white/15 bg-[#0c1011] px-3 pb-3 pt-4 shadow-[0_12px_24px_rgba(0,0,0,0.42)] sm:-top-4 sm:-mx-4 sm:px-4 sm:pt-5" : ""} ${compact ? "mb-4" : "max-w-4xl border-b border-white/10 pb-5"} ${isUser ? "" : "border-l border-white/10 pl-4"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foundry-subtle">
        <p className="font-extrabold uppercase tracking-[0.08em]">{isUser ? "You" : "Foundry"}</p>
        <span>{message.time}</span>
      </div>
      <MessageBody body={body} className={prominent ? "text-[15px] leading-7 text-foundry-ink" : "text-sm leading-6 text-foundry-muted"} />
    </article>
  );
}

function MessageBody({ body, className }: { body: string; className: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const lineCount = body.split("\n").length;
  const shouldCollapse = body.length > 400 || lineCount > 6;

  if (!shouldCollapse) {
    return <p className={`mt-2 whitespace-pre-wrap break-words ${className}`}>{body}</p>;
  }

  const preview = body.split("\n").filter((line) => line.trim()).slice(0, 2).join(" ").replace(/\s+/g, " ").trim().slice(0, 160);

  return (
    <details className={`mt-2 ${className}`} open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-[0.08em] text-foundry-teal">
        {isOpen ? "Show less" : `${preview}... Show more`}
      </summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{body}</p>
    </details>
  );
}

function ProjectComposer({
  inputRef,
  task,
  isBusy,
  queuedTask,
  canUndo,
  onTaskChange,
  onExecute,
  onStop,
  onUndo,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  task: string;
  isBusy: boolean;
  queuedTask?: string;
  canUndo?: boolean;
  onTaskChange: (value: string) => void;
  onExecute: () => void;
  onStop: () => void;
  onUndo?: () => void;
}) {
  return (
    <div className="border-t border-white/10 bg-[#0b0f10]/95 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase tracking-[0.06em]">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${isBusy ? "border-foundry-teal/30 bg-foundry-teal/10 text-foundry-teal" : "border-white/15 bg-white/[0.04] text-foundry-muted"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isBusy ? "bg-foundry-teal" : "bg-foundry-muted"}`} />
          {isBusy ? "Working" : "Ready"}
        </span>
        {queuedTask ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-foundry-blue/30 bg-foundry-blue/10 px-2.5 py-1 text-foundry-blue">
            <span className="truncate normal-case tracking-normal">Queued: {queuedTask}</span>
          </span>
        ) : null}
        {canUndo && !isBusy && onUndo ? (
          <button type="button" className="ml-auto normal-case tracking-normal text-foundry-subtle underline-offset-2 hover:text-foundry-ink hover:underline" onClick={onUndo}>
            Undo last change
          </button>
        ) : null}
      </div>
      <div className="flex items-end gap-2 rounded-md border border-foundry-teal/25 bg-black/30 p-2 focus-within:border-foundry-teal/60">
        <textarea
          ref={inputRef}
          className="max-h-40 min-h-16 flex-1 resize-y border-0 bg-transparent p-2 text-sm leading-6 text-foundry-ink outline-none placeholder:text-foundry-subtle"
          value={task}
          onChange={(event) => onTaskChange(event.target.value)}
          placeholder={isBusy ? "Foundry is working — send a follow-up, or type stop to interrupt it..." : "Give Foundry a mission in this project..."}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onExecute();
            }
          }}
        />
        {isBusy ? (
          <button
            className="min-h-11 rounded-md border border-red-400/35 bg-red-400/[0.12] px-4 text-sm font-extrabold text-red-200 transition hover:bg-red-400/[0.2]"
            type="button"
            title="Stops now. Send another message anytime to pick up where this left off."
            onClick={onStop}
          >
            Stop
          </button>
        ) : null}
        <button
          className="min-h-11 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.16] px-5 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.22]"
          type="button"
          onClick={onExecute}
        >
          Send
        </button>
      </div>
    </div>
  );
}

type ChecklistPhaseGroup = {
  phase: string;
  items: FactoryObjectiveChecklistItem[];
};

function groupChecklistByPhase(checklist: FactoryObjectiveChecklistItem[]): ChecklistPhaseGroup[] {
  const groups: ChecklistPhaseGroup[] = [];
  const indexByPhase = new Map<string, number>();
  for (const item of checklist) {
    const phase = item.phase?.trim() || "Tasks";
    if (!indexByPhase.has(phase)) {
      indexByPhase.set(phase, groups.length);
      groups.push({ phase, items: [] });
    }
    groups[indexByPhase.get(phase) as number].items.push(item);
  }
  return groups;
}

const CHECKLIST_STATUS_META: Record<FactoryObjectiveChecklistItem["status"], { icon: LucideIcon; tone: string; label: string }> = {
  pending: { icon: CircleDot, tone: "text-foundry-subtle", label: "Pending" },
  running: { icon: Loader2, tone: "text-foundry-teal", label: "Active" },
  completed: { icon: CheckCircle2, tone: "text-foundry-teal", label: "Done" },
  blocked: { icon: AlertTriangle, tone: "text-red-300", label: "Blocked" },
  skipped: { icon: SkipForward, tone: "text-foundry-subtle", label: "Skipped" },
  "needs-approval": { icon: Lock, tone: "text-foundry-amber", label: "Needs approval" },
};

/** Live, always-visible mission checklist: which phase is active, which item is active right now, and the full backlog — so nothing gets lost in a long multi-part request. */
function MissionChecklistBoard({
  checklist,
  isLive,
  onSkipItem,
}: {
  checklist: FactoryObjectiveChecklistItem[];
  isLive: boolean;
  onSkipItem?: (item: FactoryObjectiveChecklistItem) => void;
}) {
  if (checklist.length <= 1) return null;

  const phases = groupChecklistByPhase(checklist);
  const activeItemId = checklist.find((item) => item.status === "running")?.id ?? checklist.find((item) => item.status === "pending")?.id;
  const activePhaseIndex = Math.max(0, phases.findIndex((group) => group.items.some((item) => item.id === activeItemId)));
  const doneCount = checklist.filter((item) => item.status === "completed" || item.status === "skipped").length;

  return (
    <section className="mb-3 max-w-4xl rounded-md border border-white/10 bg-black/15 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">
          Mission checklist · {doneCount}/{checklist.length} resolved
        </p>
        {isLive ? <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-foundry-teal"><Loader2 size={11} className="animate-spin" /> Working</span> : null}
      </div>
      <div className="mt-2 grid gap-2">
        {phases.map((group, phaseIndex) => {
          const phaseDone = group.items.every((item) => item.status === "completed" || item.status === "skipped");
          const isActivePhase = phaseIndex === activePhaseIndex;
          const collapsedByDefault = phaseDone && phaseIndex !== activePhaseIndex;
          return (
            <details key={group.phase} className="group rounded border border-white/5" open={!collapsedByDefault}>
              {phases.length > 1 ? (
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-xs font-bold text-foundry-ink">
                  <span className="flex items-center gap-2">
                    {phaseDone ? <CheckCircle2 size={13} className="text-foundry-teal" /> : isActivePhase ? <Loader2 size={13} className="animate-spin text-foundry-teal" /> : <CircleDot size={13} className="text-foundry-subtle" />}
                    {group.phase}
                  </span>
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-subtle">
                    {group.items.filter((item) => item.status === "completed" || item.status === "skipped").length}/{group.items.length}
                  </span>
                </summary>
              ) : null}
              <div className="grid gap-0.5 px-2 pb-1.5 pt-1">
                {group.items.map((item) => {
                  const meta = CHECKLIST_STATUS_META[item.status];
                  const Icon = meta.icon;
                  const isActive = item.id === activeItemId;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-2 rounded px-1.5 py-1 text-xs leading-5 ${isActive ? "bg-foundry-teal/[0.08] text-foundry-ink" : "text-foundry-muted"}`}
                    >
                      <Icon size={13} className={`mt-0.5 shrink-0 ${meta.tone} ${item.status === "running" ? "animate-spin" : ""}`} />
                      <span className="min-w-0 flex-1">{item.label}</span>
                      {isActive ? <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">Now</span> : null}
                      {onSkipItem && (item.status === "pending" || item.status === "running") ? (
                        <button
                          type="button"
                          className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-subtle transition hover:border-white/30 hover:text-foundry-ink"
                          onClick={() => onSkipItem(item)}
                        >
                          Skip
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function RunResultSummary({ execution }: { execution: FactoryProjectResult }) {
  const changedFiles = execution.files.filter((file) => file.status === "created" || file.status === "edited");
  const verifiedItems = execution.checklist?.filter((item) => item.status === "completed") ?? [];
  const remainingItems = execution.checklist?.filter((item) => item.status === "blocked" || item.status === "pending") ?? [];
  return (
    <section className="mt-3 rounded-md border border-foundry-teal/20 bg-foundry-teal/[0.04] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">
          Done · changed {changedFiles.length} file{changedFiles.length === 1 ? "" : "s"}
        </p>
        <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-foundry-teal">{execution.status}</span>
      </div>
      {execution.objective ? <p className="mt-2 text-sm font-semibold text-foundry-ink">{execution.objective}</p> : null}
      {execution.checklist?.length ? (
        <p className="mt-1 text-xs leading-5 text-foundry-muted">
          Verified {verifiedItems.length}/{execution.checklist.length} objective items{remainingItems.length ? `; remaining: ${remainingItems.map((item) => item.label).join("; ")}` : "."}
        </p>
      ) : null}
      <div className="mt-2 grid gap-1">
        {changedFiles.length ? (
          changedFiles.map((file) => (
            <div key={file.path} className="flex items-center justify-between gap-3 rounded bg-black/20 px-2 py-1 text-xs">
              <span className="min-w-0 truncate text-foundry-muted">{file.path}</span>
              <span className="shrink-0 font-bold text-foundry-teal">{file.status}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-foundry-muted">No file changes were reported.</p>
        )}
      </div>
      {execution.sourceMode === "uploaded-copy" || execution.projectPath.includes("\\projects\\") || execution.projectPath.includes("/projects/") ? (
        <p className="mt-3 text-xs leading-5 text-foundry-subtle">Editing Foundry copy. Export to apply these changes outside Foundry.</p>
      ) : execution.sourceMode === "local-folder" ? (
        <p className="mt-3 text-xs leading-5 text-foundry-subtle">Edited the connected local folder directly; changes should appear in VS Code.</p>
      ) : null}
    </section>
  );
}

function MissionSummary({
  execution,
  timeline,
  onReadFile,
  onApproveCommand,
}: {
  execution: FactoryProjectResult;
  timeline: FactoryExecutionEvent[];
  onReadFile?: (path: string) => void;
  onApproveCommand?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
}) {
  const visibleTimeline = timeline.filter((event) => !event.internal);
  const changedFiles = execution.files.filter((file) => file.status === "created" || file.status === "edited");
  const checklist = execution.checklist ?? [];
  const verifiedItems = checklist.filter((item) => item.status === "completed");
  const remainingItems = checklist.filter((item) => item.status !== "completed");
  const passed = execution.status === "passed";
  const stopped = execution.status === "stopped";
  const awaitingApproval = execution.status === "awaiting-approval";
  const needsClarification = execution.status === "needs-clarification";
  const sessionSummary = execution.sessionSummary;
  const finalSummary = finalSummaryFromTimeline(visibleTimeline);
  const requestedBehavior = requestSummaryForExecution(execution);
  // A "passed" mission with no verification evidence at all is exactly the stub "looks good" failure mode
  // this UI must never present as a confident result — see the verifyCompletion() gate this mirrors.
  const verificationEmpty = passed && !(execution.verification?.length);
  const headline = verificationEmpty
    ? "Complete (unverified)"
    : passed
    ? "Behavior updated"
    : awaitingApproval
      ? "Waiting for your approval"
      : needsClarification
        ? "Needs your input"
        : stopped
          ? "Stopped by user"
          : "Needs more work";

  const errorEvent = visibleTimeline.find((event) => event.status === "error");
  const approvalEvent = [...visibleTimeline].reverse().find((event) => event.kind === "blocked" && event.status === "warning" && event.command);
  const issue =
    execution.blocker ||
    (errorEvent ? (errorEvent.details?.reason as string | undefined) || errorEvent.title : passed ? "No issues — the mission completed as requested." : "Mission did not reach a clear resolution.");

  const filesInspected = visibleTimeline.filter((event) => event.kind === "inspection" && /^Read\b/i.test(event.title)).length;
  const commandEvents = visibleTimeline.filter((event) => event.kind === "command" && event.status !== "running");
  const commandsRun = execution.commands.length || commandEvents.length;
  const buildChecks = visibleTimeline.filter((event) => event.kind === "build").length;

  const actionsPerformed = sessionSummary?.changes.length
    ? sessionSummary.changes
    : visibleTimeline
        .filter((event) => event.status === "completed" && (event.kind === "edit" || event.kind === "file" || event.kind === "command"))
        .map((event) => event.title);

  const lastBuildEvent = [...visibleTimeline].reverse().find((event) => event.kind === "build");
  const verification = passed
    ? lastBuildEvent
      ? `Verified by ${lastBuildEvent.status === "completed" ? "a successful build" : "the build output"} and ${verifiedItems.length}/${checklist.length || verifiedItems.length} checked objective items.`
      : checklist.length
        ? `Verified by ${verifiedItems.length}/${checklist.length} checked objective items with recorded evidence.`
        : "Verified by the completed file changes above."
    : stopped
      ? "Stopped before verification could complete."
      : "Could not be fully verified — see remaining issues below.";

  const timestamps = visibleTimeline.map((event) => new Date(event.timestamp).getTime()).filter((value) => Number.isFinite(value));
  const durationMs = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const buildDurationMs = buildDurationFromTimeline(visibleTimeline);
  const retries = visibleTimeline.filter((event) => event.title === "Completion claim rejected").length;

  return (
    <section
      className={`mt-4 grid gap-4 overflow-hidden rounded-lg border text-sm leading-6 ${passed ? "border-foundry-teal/25 bg-foundry-teal/[0.03]" : stopped ? "border-foundry-amber/25 bg-foundry-amber/[0.03]" : "border-red-300/30 bg-red-400/[0.03]"}`}
    >
      <header className="border-b border-white/10 px-4 py-3">
        <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">Mission Summary</p>
        <h3 className="mt-1 text-base font-extrabold text-foundry-ink">{headline}</h3>
      </header>

      <div className="grid gap-4 px-4 pb-4">
        <SummarySection title="User Request">
          <p>{requestedBehavior}</p>
        </SummarySection>

        <SummarySection title={passed ? "Behavior Now" : "Current State"}>
          <p>{sessionSummary?.outcome || finalSummary || issue}</p>
          {verificationEmpty ? (
            <p className="mt-2 text-foundry-amber">Nothing here was verified against real file or command evidence — treat this as unconfirmed until you check it yourself.</p>
          ) : null}
        </SummarySection>

        {needsClarification && execution.clarificationQuestions?.length ? (
          <SummarySection title="Needs your input">
            <ul className="grid gap-1.5">
              {execution.clarificationQuestions.map((question, index) => (
                <li key={`${question}-${index}`} className="rounded border border-foundry-amber/25 bg-foundry-amber/[0.06] px-2.5 py-1.5 text-foundry-ink">
                  {question}
                </li>
              ))}
            </ul>
          </SummarySection>
        ) : null}

        {awaitingApproval && approvalEvent ? (
          <SummarySection title="Approval Required">
            <BlockedCommandLine event={approvalEvent} onApprove={onApproveCommand} />
          </SummarySection>
        ) : null}

        {sessionSummary?.preserved.length ? (
          <SummarySection title="Preserved">
            <ul className="grid gap-1">
              {sessionSummary.preserved.map((item, index) => (
                <li key={`${item}-${index}`} className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-foundry-blue" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </SummarySection>
        ) : null}

        {actionsPerformed.length ? (
          <SummarySection title={sessionSummary?.changes.length ? "Behavior Changes" : "Engineering Work"}>
            <ul className="grid gap-1">
              {actionsPerformed.map((title, index) => (
                <li key={`${title}-${index}`} className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-foundry-teal" />
                  <span>{title}</span>
                </li>
              ))}
            </ul>
          </SummarySection>
        ) : null}

        {sessionSummary?.flags.length ? (
          <SummarySection title="Flags">
            <ul className="grid gap-1">
              {sessionSummary.flags.map((flag, index) => (
                <li key={`${flag}-${index}`} className="flex items-start gap-2">
                  <CircleDot size={14} className="mt-0.5 shrink-0 text-foundry-amber" />
                  <span>{flag}</span>
                </li>
              ))}
            </ul>
          </SummarySection>
        ) : null}

        {changedFiles.length ? (
          <SummarySection title={`Files Changed (${changedFiles.length})`}>
            <div className="grid gap-1.5">
              {changedFiles.map((file) => {
                const matchingEvent = [...visibleTimeline].reverse().find((event) => event.filePath === file.path && (event.kind === "edit" || event.kind === "file"));
                return (
                  <details key={file.path} className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-xs text-foundry-ink">{file.path}</span>
                      <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">{file.status}</span>
                    </summary>
                    {matchingEvent ? (
                      <div className="mt-2">
                        <div className="mb-2 grid gap-1 text-xs text-foundry-muted">
                          {matchingEvent.details?.lineRange ? <DetailRow label="Lines" value={String(matchingEvent.details.lineRange)} /> : null}
                          {matchingEvent.rationale ? <DetailRow label="Reason" value={matchingEvent.rationale} /> : null}
                        </div>
                        <CodeViewTabs event={matchingEvent} onReadFile={onReadFile} />
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-foundry-subtle">No captured change detail for this file.</p>
                    )}
                  </details>
                );
              })}
            </div>
          </SummarySection>
        ) : null}

        {execution.commands.length ? (
          <SummarySection title="Commands Executed">
            <div className="grid gap-1.5">
              {execution.commands.map((command, index) => (
                <div key={`${command.command}-${index}`} className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 font-mono text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[#d8f3ec]">{command.command}</span>
                    <span className={`shrink-0 text-[10px] font-extrabold ${command.exitCode === 0 ? "text-foundry-teal" : "text-red-300"}`}>
                      exit {command.exitCode ?? "—"}
                      {command.durationMs ? ` · ${(command.durationMs / 1000).toFixed(1)}s` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </SummarySection>
        ) : null}

        <SummarySection title="Limitations">
          {remainingItems.length || execution.blocker ? (
            <ul className="grid gap-1">
              {execution.blocker ? <li>{execution.blocker}</li> : null}
              {remainingItems.map((item) => (
                <li key={item.id}>
                  {item.label}
                  {item.evidence ? ` — ${item.evidence}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>No unresolved checklist items were recorded.</p>
          )}
        </SummarySection>

        <SummarySection title="Verification Evidence">
          <p>
            {verification}
          </p>
          <p className="mt-1">
            Evidence recorded: {filesInspected} file read{filesInspected === 1 ? "" : "s"}, {changedFiles.length} file change{changedFiles.length === 1 ? "" : "s"}, {commandsRun} command{commandsRun === 1 ? "" : "s"} run{buildChecks ? `, ${buildChecks} build check${buildChecks === 1 ? "" : "s"}` : ""}.
          </p>
        </SummarySection>

        <SummarySection title="Time Metrics">
          <p>
            Duration {formatDurationMs(durationMs)} · {filesInspected} file location{filesInspected === 1 ? "" : "s"} inspected · {changedFiles.length} file{changedFiles.length === 1 ? "" : "s"} modified · {commandsRun} command{commandsRun === 1 ? "" : "s"} run
            {retries ? ` · ${retries} retr${retries === 1 ? "y" : "ies"}` : ""}
            {buildDurationMs ? ` · build took ${formatDurationMs(buildDurationMs)}` : ""}
          </p>
        </SummarySection>

        {execution.sourceMode === "uploaded-copy" || execution.projectPath.includes("\\projects\\") || execution.projectPath.includes("/projects/") ? (
          <p className="text-xs leading-5 text-foundry-subtle">Editing Foundry copy. Export to apply these changes outside Foundry.</p>
        ) : execution.sourceMode === "local-folder" ? (
          <p className="text-xs leading-5 text-foundry-subtle">Edited the connected local folder directly; changes should appear in VS Code.</p>
        ) : null}
      </div>
    </section>
  );
}

function SummarySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">{title}</p>
      <div className="text-[13px] leading-6 text-foundry-muted">{children}</div>
    </section>
  );
}

function PreviewPanel({ execution }: { execution: FactoryProjectResult }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const previousUrlRef = useRef(execution.previewUrl);

  useEffect(() => {
    if (execution.previewUrl && execution.previewUrl !== previousUrlRef.current) {
      previousUrlRef.current = execution.previewUrl;
      setRefreshKey((current) => current + 1);
    }
  }, [execution.previewUrl]);

  if (!execution.previewState || execution.previewState === "unavailable") {
    return execution.previewReason ? (
      <p className="mt-4 rounded-md border border-dashed border-white/15 px-3 py-2 text-xs leading-5 text-foundry-subtle">Preview: {execution.previewReason}</p>
    ) : null;
  }

  if (execution.previewUrl && execution.previewPlatform === "api") {
    return <ApiPlayground baseUrl={execution.previewUrl} />;
  }

  if (execution.previewUrl) {
    return (
      <div className="mt-4 overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">Live Preview</span>
          <span className="truncate font-mono text-[10.5px] text-foundry-subtle">{execution.previewUrl}</span>
        </div>
        <iframe key={refreshKey} src={execution.previewUrl} className="h-72 w-full border-0 bg-white" title="Live preview" />
      </div>
    );
  }

  return <p className="mt-4 rounded-md border border-dashed border-white/15 px-3 py-2 text-xs leading-5 text-foundry-subtle">{execution.previewReason || "Open index.html from the project folder to preview this static project."}</p>;
}

function ApiPlayground({ baseUrl }: { baseUrl: string }) {
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<{ status: number; body: string } | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    setError("");
    setResponse(null);
    try {
      const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
      const init: RequestInit = { method };
      if (method !== "GET" && method !== "HEAD" && body.trim()) {
        init.headers = { "content-type": "application/json" };
        init.body = body;
      }
      const result = await fetch(url, init);
      const text = await result.text();
      setResponse({ status: result.status, body: text });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed — the preview server may not allow cross-origin requests from this page.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-md border border-white/10">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-1.5">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal">API Playground</span>
        <span className="truncate font-mono text-[10.5px] text-foundry-subtle">{baseUrl}</span>
      </div>
      <div className="grid gap-2 p-3">
        <div className="flex gap-2">
          <select
            className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs font-bold text-foundry-ink"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <input
            className="flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 font-mono text-xs text-foundry-ink outline-none focus:border-foundry-teal/40"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/api/resource"
          />
          <button
            className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-1.5 text-xs font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2] disabled:opacity-50"
            type="button"
            disabled={sending}
            onClick={send}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        {method !== "GET" && method !== "HEAD" ? (
          <textarea
            className="min-h-[3rem] resize-y rounded-md border border-white/10 bg-black/20 p-2 font-mono text-xs text-foundry-ink outline-none focus:border-foundry-teal/40"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder='{"key": "value"}'
          />
        ) : null}
        {error ? <p className="text-xs leading-5 text-red-300">{error}</p> : null}
        {response ? (
          <div className="rounded-md border border-white/10 bg-black/30 p-2">
            <p className="font-mono text-[11px] font-bold text-foundry-teal">Status: {response.status}</p>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foundry-muted">{response.body}</pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MockReviewPanel({
  pendingMockReview,
  execution,
  onExecute,
}: {
  pendingMockReview: { message: string; preview_url?: string };
  execution: FactoryProjectResult | null;
  onExecute: (task: string) => void;
}) {
  const [feedback, setFeedback] = useState("");

  function sendFeedback() {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setFeedback("");
    onExecute(trimmed);
  }

  function continueBuilding() {
    onExecute("The mock looks good — continue building out the rest of the plan.");
  }

  return (
    <div className="mx-3 mb-3 rounded-lg border border-foundry-teal/25 bg-foundry-teal/[0.05] p-4 sm:mx-4">
      <p className="section-kicker">First Working Mock — Ready For Review</p>
      <p className="mt-2 text-sm leading-6 text-foundry-ink">{pendingMockReview.message}</p>
      {execution ? <PreviewPanel execution={execution} /> : null}
      {pendingMockReview.preview_url ? (
        <a
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]"
          href={pendingMockReview.preview_url}
          target="_blank"
          rel="noreferrer"
        >
          Open preview in a new tab
        </a>
      ) : null}
      <div className="mt-4 grid gap-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-extrabold uppercase tracking-[0.06em] text-foundry-subtle">Anything to change?</span>
          <textarea
            className="min-h-[4rem] resize-y rounded-md border border-white/10 bg-black/20 p-2 text-sm text-foundry-ink outline-none focus:border-foundry-teal/40"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Move the nav to the left, make the header bigger…"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]"
            type="button"
            onClick={continueBuilding}
          >
            Looks good — continue building
          </button>
          <button
            className="rounded-md border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={!feedback.trim()}
            onClick={sendFeedback}
          >
            Send feedback
          </button>
        </div>
      </div>
    </div>
  );
}

function finalSummaryFromTimeline(timeline: FactoryExecutionEvent[]) {
  const summaryEvent = [...timeline].reverse().find((event) => event.kind === "summary" && event.status === "completed");
  const summary = summaryEvent?.details?.summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : "";
}

function requestSummaryForExecution(execution: FactoryProjectResult) {
  return (execution.objective || "Complete the requested project work")
    .replace(/^Complete goal:\s*/i, "")
    .trim();
}

function buildDurationFromTimeline(timeline: FactoryExecutionEvent[]) {
  const buildEvents = timeline.filter((event) => event.kind === "build");
  const running = buildEvents.find((event) => event.status === "running");
  const finished = [...buildEvents].reverse().find((event) => event.status === "completed" || event.status === "error");
  if (!running || !finished) return 0;
  const delta = new Date(finished.timestamp).getTime() - new Date(running.timestamp).getTime();
  return delta > 0 ? delta : 0;
}

function formatDurationMs(ms: number) {
  if (!ms) return "under a second";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatClockTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function liveFileIndicatorEvent(timeline: FactoryExecutionEvent[], isExecutionLive: boolean): FactoryExecutionEvent | null {
  if (!isExecutionLive) return null;
  const visible = timeline.filter((event) => !event.internal && (event.kind === "edit" || event.kind === "file" || event.kind === "inspection"));
  if (!visible.length) return null;
  const running = [...visible].reverse().find((event) => event.status === "running");
  if (running) return running;
  const last = visible.at(-1);
  if (last && Date.now() - new Date(last.timestamp).getTime() < 5000) return last;
  return null;
}

function liveFileIndicatorVerb(event: FactoryExecutionEvent) {
  if (event.kind === "inspection") return event.title.toLowerCase().startsWith("verified") ? "Verified" : event.status === "running" ? "Reading" : "Read";
  if (event.kind === "file") return event.status === "running" ? "Creating" : "Created";
  if (event.kind === "edit") return event.status === "running" ? "Editing" : "Saved";
  return "Working on";
}

function LiveFileIndicator({ event }: { event: FactoryExecutionEvent }) {
  const verb = liveFileIndicatorVerb(event);
  const target = event.filePath || event.fileName || "";
  return (
    <span className="mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-full border border-foundry-teal/25 bg-foundry-teal/[0.07] px-2.5 py-1 text-[11px] font-bold text-foundry-teal">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foundry-teal" />
      {verb}
      {target ? ` ${target}` : ""}
    </span>
  );
}

function BlockedCommandLine({ event, onApprove }: { event: FactoryExecutionEvent; onApprove?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void }) {
  const reason = (event.details?.reason as string | undefined) || event.output || "Foundry needs approval before continuing.";
  const category = event.details?.category as string | undefined;
  const command = event.command || event.title;
  return (
    <div className="my-1 overflow-hidden rounded-md border border-foundry-amber/30 bg-foundry-amber/[0.06]">
      <div className="flex items-start gap-2 px-3 py-2 font-mono text-[12.5px] leading-5">
        <span className="font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
        <span className="shrink-0 text-foundry-amber">!</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[#f3e0b8]">{command}</span>
      </div>
      <div className="border-t border-foundry-amber/20 bg-black/20 px-3 py-2">
        <p className="text-xs leading-5 text-foundry-amber">Needs your approval - {reason}</p>
        <p className="mt-1 text-[11px] leading-5 text-foundry-subtle">
          Exact command approvals only match this command text in this project. They do not widen to other installs, deletes, pushes, or shell mutations.
        </p>
        {onApprove ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="shrink-0 rounded border border-foundry-amber/40 bg-foundry-amber/[0.14] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-amber transition hover:bg-foundry-amber/[0.22]"
              onClick={() => onApprove(event, "approve-once")}
            >
              Allow once
            </button>
            {category ? (
              <button
                type="button"
                className="shrink-0 rounded border border-foundry-amber/40 bg-foundry-amber/[0.14] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-amber transition hover:bg-foundry-amber/[0.22]"
                onClick={() => onApprove(event, "approve-category")}
              >
                Allow this category
              </button>
            ) : null}
            <button
              type="button"
              className="shrink-0 rounded border border-foundry-amber/40 bg-foundry-amber/[0.14] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-amber transition hover:bg-foundry-amber/[0.22]"
              onClick={() => onApprove(event, "approve-command")}
            >
              Always allow exact command
            </button>
            <button
              type="button"
              className="shrink-0 rounded border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-foundry-subtle transition hover:bg-white/[0.08] hover:text-foundry-ink"
              onClick={() => onApprove(event, "skip")}
            >
              Deny
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function useRecentlyChangedPaths(timeline: FactoryExecutionEvent[]) {
  const [recent, setRecent] = useState<Record<string, number>>({});
  const seenIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let changed = false;
    const now = Date.now();
    const next = { ...recent };
    for (const event of timeline) {
      if (seenIdsRef.current.has(event.id)) continue;
      seenIdsRef.current.add(event.id);
      if ((event.kind === "edit" || event.kind === "file") && event.status === "completed" && event.filePath) {
        next[event.filePath] = now;
        changed = true;
      }
    }
    if (changed) setRecent(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  useEffect(() => {
    if (!Object.keys(recent).length) return;
    const timer = window.setTimeout(() => {
      const cutoff = Date.now() - 4000;
      setRecent((current) => Object.fromEntries(Object.entries(current).filter(([, timestamp]) => timestamp > cutoff)));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [recent]);

  return recent;
}

function ExecutionLevelToggle({ level, onChange }: { level: ExecutionLevel; onChange: (level: ExecutionLevel) => void }) {
  const levels: Array<{ id: ExecutionLevel; label: string }> = [
    { id: "summary", label: "Summary" },
    { id: "details", label: "Details" },
    { id: "code", label: "Code" },
    { id: "command", label: "Command" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.03] p-0.5" role="tablist" aria-label="Execution level">
      {levels.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={level === item.id}
          className={`rounded px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] transition ${level === item.id ? "bg-foundry-teal/20 text-foundry-teal" : "text-foundry-subtle hover:text-foundry-ink"}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
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
    <div className="mt-3 min-h-0 overflow-auto border-t border-white/10 pt-2">
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
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-bold text-foundry-muted hover:bg-white/[0.055] hover:text-foundry-ink"
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

function ExecutionTimeline({
  timeline,
  level,
  fallbackEvents,
  endRef,
  onReadFile,
  onFetchFileContent,
  onApproveCommand,
}: {
  timeline: FactoryExecutionEvent[];
  level: ExecutionLevel;
  fallbackEvents: string[];
  endRef?: RefObject<HTMLDivElement | null>;
  onReadFile?: (path: string) => void;
  onFetchFileContent?: (path: string) => Promise<string | null>;
  onApproveCommand?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
}) {
  const visibleTimeline = timeline.filter((event) => !event.internal);
  const narrativeEvents = visibleTimeline.filter((event) => event.kind !== "blocked" && isNarrativeEvent(event) && eventVisibleAtLevel(event, level));
  const traceEvents = visibleTimeline.filter((event) => executionTier(event) === "trace" && eventVisibleAtLevel(event, level));
  const blockedEvents = visibleTimeline.filter((event) => event.kind === "blocked" && eventVisibleAtLevel(event, level));
  const rawMode = level === "code" || level === "command";

  return (
    <div className="grid gap-0.5">
        {rawMode && (traceEvents.length || blockedEvents.length) ? (
          <>
            {traceEvents.map((event) => renderTraceEvent(event, { level, onReadFile, onFetchFileContent, onApproveCommand }))}
            {blockedEvents.map((event) => <BlockedCommandLine key={event.id} event={event} onApprove={onApproveCommand} />)}
          </>
        ) : narrativeEvents.length || traceEvents.length || blockedEvents.length ? (
          <>
            {narrativeEvents.map((event) => (
              <NarrativeLine key={event.id} event={event} />
            ))}
            {traceEvents.map((event) => renderTraceEvent(event, { level, onReadFile, onFetchFileContent, onApproveCommand }))}
            {blockedEvents.map((event) => <BlockedCommandLine key={event.id} event={event} onApprove={onApproveCommand} />)}
          </>
        ) : visibleTimeline.length === 0 ? (
          fallbackEvents.map((event, index) => (
            <div key={`${event}-${index}`} className="flex items-center gap-2 py-1 text-sm text-foundry-muted">
              <CircleDot size={15} className="text-foundry-teal" />
              <span>{event}</span>
            </div>
          ))
        ) : (
          // The mission actually ran but has nothing in this specific category — say so plainly instead of
          // silently falling back to the same generic "getting started" text every empty tab would otherwise
          // share, which made Code and Command look identical for a mission with neither.
          <p className="py-2 text-sm text-foundry-subtle">
            {level === "code"
              ? "No file edits were made in this mission."
              : level === "command"
                ? "No commands were run in this mission."
                : "Nothing to show at this detail level."}
          </p>
        )}
        <div ref={endRef} />
    </div>
  );
}

function renderTraceEvent(
  event: FactoryExecutionEvent,
  options: {
    level: ExecutionLevel;
    onReadFile?: (path: string) => void;
    onFetchFileContent?: (path: string) => Promise<string | null>;
    onApproveCommand?: (event: FactoryExecutionEvent, action: BlockedCommandAction) => void;
  },
) {
  if (event.kind === "blocked") return <BlockedCommandLine key={event.id} event={event} onApprove={options.onApproveCommand} />;
  if (event.kind === "reasoning") return <ReasoningLine key={event.id} event={event} />;
  if (event.kind === "build") return <BuildLine key={event.id} event={event} onReadFile={options.onReadFile} forceOpen={options.level === "command"} />;
  if (event.kind === "command") return <CommandLine key={event.id} event={event} forceOpen={options.level === "command"} />;
  return <TimelineItem key={event.id} event={event} forceOpen={options.level === "code"} onReadFile={options.onReadFile} onFetchFileContent={options.onFetchFileContent} />;
}

function NarrativeLine({ event }: { event: FactoryExecutionEvent }) {
  const tier = executionTier(event);
  const narrative = event.narrative;
  const evidence = narrative?.evidence ?? [];
  const source = narrative?.source ? humanizeKey(narrative.source.replace(/-/g, " ")) : "";
  const text = narrative?.rationale || event.rationale || event.title;
  const icon = tier === "finding" ? "ok" : tier === "decision" ? ">" : "!";

  if (tier !== "flag") {
    return (
      <details className="group my-0.5 rounded-md text-[13px] leading-5">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-1.5 py-1.5 text-foundry-ink transition hover:bg-white/[0.035]">
          <span className={`mt-0.5 w-4 shrink-0 font-mono ${tier === "finding" ? "text-foundry-blue" : "text-foundry-teal"}`}>{icon}</span>
          <span className="min-w-0 flex-1">{text}</span>
          <span className="shrink-0 font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
        </summary>
        <div className="ml-7 grid gap-1.5 border-l border-white/10 px-3 py-2 text-xs leading-5 text-foundry-muted">
          {source ? <DetailRow label="Source" value={source} /> : null}
          {narrative?.filePath ? <DetailRow label="Path" value={narrative.filePath} /> : event.filePath ? <DetailRow label="Path" value={event.filePath} /> : null}
          {typeof narrative?.confidence === "number" ? <DetailRow label="Confidence" value={`${narrative.confidence}%`} /> : null}
          {narrative?.details
            ? Object.entries(narrative.details).map(([key, value]) =>
                typeof value === "undefined" ? null : <DetailRow key={key} label={humanizeKey(key)} value={Array.isArray(value) ? value.join("\n") : String(value)} />,
              )
            : null}
          {evidence.length ? <DetailRow label="Evidence" value={evidence.join("\n")} /> : null}
        </div>
      </details>
    );
  }

  return (
    <details className="group my-1 overflow-hidden rounded-md border border-foundry-amber/30 bg-foundry-amber/[0.08] text-foundry-amber" open>
      <summary className="cursor-pointer list-none px-3 py-2.5">
        <span className="grid gap-1">
          <span className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.08em]">Needs attention</span>
            <span className="font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
          </span>
          <span className="text-[13.5px] font-bold leading-5 text-foundry-ink">{text}</span>
          {narrative?.source === "conflict" ? (
            <span className="text-[11px] font-semibold normal-case tracking-normal text-foundry-amber/80">Type your answer in the message box below to continue.</span>
          ) : null}
        </span>
      </summary>
      <div className="grid gap-2 border-t border-foundry-amber/20 px-3 py-2 text-xs leading-5 text-foundry-muted">
        {source ? <DetailRow label="Source" value={source} /> : null}
        {narrative?.filePath ? <DetailRow label="Path" value={narrative.filePath} /> : event.filePath ? <DetailRow label="Path" value={event.filePath} /> : null}
        {typeof narrative?.confidence === "number" ? <DetailRow label="Confidence" value={`${narrative.confidence}%`} /> : null}
        {narrative?.details
          ? Object.entries(narrative.details).map(([key, value]) =>
              typeof value === "undefined" ? null : <DetailRow key={key} label={humanizeKey(key)} value={Array.isArray(value) ? value.join("\n") : String(value)} />,
            )
          : null}
        {evidence.length ? (
          <div>
            <p className="font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">Evidence</p>
            <ul className="mt-1 grid gap-1">
              {evidence.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ReasoningLine({ event }: { event: FactoryExecutionEvent }) {
  return <p className="py-1.5 text-[14px] leading-6 text-foundry-ink">{event.title}</p>;
}

function CommandLine({ event, forceOpen = false }: { event: FactoryExecutionEvent; forceOpen?: boolean }) {
  const [tab, setTab] = useState<"stdout" | "stderr">("stdout");
  const failed = event.status === "error";
  const [open, setOpen] = useState(forceOpen || failed);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const running = event.status === "running";
  const command = event.command || event.title;
  const promptSymbol = running ? ">" : failed ? "!" : "$";
  const promptTone = running ? "text-foundry-blue" : failed ? "text-red-300" : "text-foundry-teal";
  const hasSplitOutput = Boolean(event.stdout || event.stderr);

  return (
    <div className={`my-1 overflow-hidden rounded-md border ${failed ? "border-red-400/25 bg-red-400/[0.05]" : "border-foundry-teal/20 bg-black/35"}`}>
      <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left font-mono text-[12.5px] leading-5" onClick={() => setOpen((current) => !current)}>
        <span className="font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
        <span className={`shrink-0 ${promptTone}`}>{promptSymbol}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[#d8f3ec]">{command}</span>
      </button>
      {event.cwd ? <p className="border-t border-white/10 px-3 py-1 text-[10.5px] text-foundry-subtle">cwd: {event.cwd}</p> : null}
      {event.details?.shellFallbackFrom ? (
        <p className="border-t border-white/10 px-3 py-1 text-[10.5px] text-foundry-amber">
          Ran via {String(event.details.shellUsed)} — {String(event.details.shellFallbackFrom)} didn&apos;t recognize this.
        </p>
      ) : null}
      {open && (hasSplitOutput || event.output) ? (
        <div>
          {hasSplitOutput ? (
            <div className="flex items-center gap-1 border-t border-white/10 px-2 pt-1.5">
              <button type="button" className={`rounded px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] ${tab === "stdout" ? "bg-foundry-teal/20 text-foundry-teal" : "text-foundry-subtle"}`} onClick={() => setTab("stdout")}>
                stdout
              </button>
              <button type="button" className={`rounded px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] ${tab === "stderr" ? "bg-foundry-teal/20 text-foundry-teal" : "text-foundry-subtle"}`} onClick={() => setTab("stderr")}>
                stderr
              </button>
              {typeof event.exitCode !== "undefined" ? <span className="ml-auto pr-1 text-[10px] font-bold text-foundry-subtle">exit {event.exitCode}</span> : null}
              {event.durationMs ? <span className="pr-1 text-[10px] font-bold text-foundry-subtle">{(event.durationMs / 1000).toFixed(1)}s</span> : null}
            </div>
          ) : null}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-white/10 bg-black/40 px-3 py-2 text-[11.5px] leading-5 text-foundry-muted">
            {hasSplitOutput ? (tab === "stdout" ? event.stdout || "(empty)" : event.stderr || "(empty)") : event.output}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

type BuildLocation = { file: string; line: number; column?: number; severity: "error" | "warning"; message: string };

function parseBuildLocations(output: string): BuildLocation[] {
  const results: BuildLocation[] = [];
  const lines = output.split(/\r?\n/);
  const pattern = /^(.*?\.(?:tsx?|jsx?|css|json|mjs|cjs)):(\d+):?(\d+)?/i;
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const severity: "error" | "warning" = /error/i.test(line) ? "error" : "warning";
    results.push({
      file: match[1].replace(/\\/g, "/").replace(/^\.\//, ""),
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : undefined,
      severity,
      message: line.replace(pattern, "").trim().slice(0, 160),
    });
    if (results.length >= 25) break;
  }
  return results;
}

function BuildLine({ event, onReadFile, forceOpen = false }: { event: FactoryExecutionEvent; onReadFile?: (path: string) => void; forceOpen?: boolean }) {
  const failed = event.status === "error";
  const [open, setOpen] = useState(forceOpen || failed);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const output = `${event.stderr || ""}\n${event.stdout || ""}\n${event.output || ""}`.trim();
  const locations = parseBuildLocations(output);

  return (
    <div className={`my-1 overflow-hidden rounded-md border ${failed ? "border-red-400/25 bg-red-400/[0.05]" : "border-foundry-teal/20 bg-black/30"}`}>
      <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] font-bold" onClick={() => setOpen((current) => !current)}>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-normal text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
          <span className={failed ? "text-red-300" : "text-foundry-teal"}>{event.title}</span>
        </span>
        {locations.length ? <span className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-subtle">{locations.length} location{locations.length === 1 ? "" : "s"}</span> : null}
      </button>
      {open ? (
        <div className="border-t border-white/10 px-3 py-2">
          {locations.length ? (
            <div className="grid gap-1">
              {locations.map((location, index) => (
                <button
                  key={`${location.file}-${location.line}-${index}`}
                  type="button"
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[11.5px] text-foundry-muted hover:bg-white/[0.05] hover:text-foundry-ink"
                  onClick={() => onReadFile?.(location.file)}
                >
                  <span className={`font-mono ${location.severity === "error" ? "text-red-300" : "text-foundry-amber"}`}>{location.severity === "error" ? "✕" : "!"}</span>
                  <span className="font-mono text-foundry-teal">
                    {location.file}:{location.line}
                    {location.column ? `:${location.column}` : ""}
                  </span>
                  <span className="min-w-0 truncate">{location.message}</span>
                </button>
              ))}
            </div>
          ) : null}
          {output ? <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

type CodeViewTab = "diff" | "entire" | "before-after";

function CodeViewTabs({
  event,
  onFetchFileContent,
  onReadFile,
}: {
  event: FactoryExecutionEvent;
  onFetchFileContent?: (path: string) => Promise<string | null>;
  onReadFile?: (path: string) => void;
}) {
  const [tab, setTab] = useState<CodeViewTab>("diff");
  const [afterContent, setAfterContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const filePath = event.filePath;

  async function ensureAfterContent() {
    if (afterContent !== null || !filePath || !onFetchFileContent) return;
    setLoading(true);
    const content = await onFetchFileContent(filePath);
    setAfterContent(content ?? "Could not load current file content.");
    setLoading(false);
  }

  return (
    <div className="mt-1">
      <div className="mb-1.5 flex items-center gap-1">
        {(["diff", "entire", "before-after"] as CodeViewTab[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`rounded px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] ${tab === id ? "bg-foundry-teal/20 text-foundry-teal" : "text-foundry-subtle hover:text-foundry-ink"}`}
            onClick={() => {
              setTab(id);
              if (id === "entire" || id === "before-after") void ensureAfterContent();
            }}
          >
            {id === "diff" ? "Diff" : id === "entire" ? "Entire file" : "Before / After"}
          </button>
        ))}
        {filePath && onReadFile ? (
          <button type="button" className="ml-auto text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-teal" onClick={() => onReadFile(filePath)}>
            Open in viewer
          </button>
        ) : null}
      </div>
      {tab === "diff" ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{event.output || "No diff captured for this change."}</pre>
      ) : tab === "entire" ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{loading ? "Loading..." : afterContent || "No content available."}</pre>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">Before</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{event.beforeContent || "(new file — no previous version)"}</pre>
          </div>
          <div>
            <p className="mb-1 font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">After</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{loading ? "Loading..." : afterContent || "No content available."}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineItem({
  event,
  forceOpen = false,
  onReadFile,
  onFetchFileContent,
}: {
  event: FactoryExecutionEvent;
  forceOpen?: boolean;
  onReadFile?: (path: string) => void;
  onFetchFileContent?: (path: string) => Promise<string | null>;
}) {
  const line = eventLineFor(event);
  const isCodeEvent = (event.kind === "edit" || event.kind === "file") && Boolean(event.filePath);
  return (
    <details className="group" open={forceOpen || event.status === "error"}>
      <summary className="cursor-pointer list-none">
        <span className="grid min-w-0 grid-cols-[3rem_1.25rem_minmax(0,1fr)_auto] items-center gap-2 py-1 text-sm">
          <span className="font-mono text-[10px] text-foundry-subtle">{formatClockTime(event.timestamp)}</span>
          <span className={`font-mono text-sm ${line.tone}`}>{line.symbol}</span>
          <span className="min-w-0 truncate text-foundry-ink">{line.text}</span>
          {line.delta ? <span className="font-mono text-xs font-bold text-foundry-teal">{line.delta}</span> : null}
        </span>
      </summary>
      <div className="ml-5 grid gap-2 border-l border-white/10 py-2 pl-3 text-xs leading-5 text-foundry-muted">
        <DetailRow label="Status" value={event.status} />
        <DetailRow label="Time" value={new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} />
        {event.filePath ? <DetailRow label={event.status === "completed" ? "Path" : "File"} value={event.filePath} /> : null}
        {event.rationale ? <DetailRow label="Reason" value={event.rationale} /> : null}
        {event.command ? <DetailRow label="Command" value={event.command} /> : null}
        {typeof event.exitCode !== "undefined" ? <DetailRow label="Exit code" value={String(event.exitCode)} /> : null}
        {event.durationMs ? <DetailRow label="Duration" value={`${(event.durationMs / 1000).toFixed(1)} seconds`} /> : null}
        {event.details
          ? Object.entries(event.details).map(([key, value]) =>
              typeof value === "undefined" ? null : <DetailRow key={key} label={humanizeKey(key)} value={Array.isArray(value) ? value.join("\n") : String(value)} />,
            )
          : null}
        {isCodeEvent ? (
          <CodeViewTabs event={event} onFetchFileContent={onFetchFileContent} onReadFile={onReadFile} />
        ) : event.output ? (
          <div>
            <p className="font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">Output</p>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 text-[11px] leading-5 text-foundry-muted">{event.output}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function eventLineFor(event: FactoryExecutionEvent) {
  const target = event.filePath || event.fileName || event.command || "";
  const delta = compactChangeText(event);
  const failed = event.status === "error";
  const running = event.status === "running";
  const warning = event.status === "warning";
  const symbol = failed ? "!" : warning ? "-" : running ? ">" : event.kind === "edit" || event.kind === "file" ? "+" : "✓";
  const tone = failed ? "text-red-300" : warning ? "text-foundry-amber" : running ? "text-foundry-blue" : event.kind === "edit" || event.kind === "file" ? "text-foundry-teal" : "text-foundry-muted";
  const verb =
    event.kind === "command" || event.kind === "build"
      ? running
        ? "Running"
        : failed
          ? "Command failed"
          : "Ran"
      : event.kind === "edit"
        ? event.title
        : event.kind === "file"
          ? event.title.toLowerCase().includes("copied")
            ? "Copied"
            : event.title
            : event.kind === "inspection"
              ? event.title
            : event.kind === "preview"
              ? running
                ? "Preview updating"
                : "Preview ready"
            : event.kind === "summary"
                ? event.title
                : running
                  ? event.title
                  : event.title;
  const text = target && verb !== event.title ? `${verb} ${target}` : verb;

  return { symbol, tone, text, delta };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[110px_minmax(0,1fr)]">
      <span className="font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-foundry-muted">{value}</span>
    </div>
  );
}

function FileTreePanel({
  execution,
  workspaceFiles,
  connectedPath,
  selectedFile,
  error,
  onClose,
  onReadFile,
}: {
  execution: FactoryProjectResult | null;
  workspaceFiles: FactoryProjectResult["files"];
  connectedPath: string;
  selectedFile: FactoryFileReadResult | null;
  error: string;
  onClose: () => void;
  onReadFile: (path: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <section className="grid h-[86vh] w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-white/15 bg-[#101416] shadow-workspace">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="section-kicker">Project Files</p>
            <h2 className="truncate text-lg font-extrabold text-foundry-ink">{execution?.projectPath ?? connectedPath ?? selectedFile?.projectId ?? "Connected project"}</h2>
          </div>
          <button className="rounded-md px-3 py-2 text-sm font-bold text-foundry-muted transition hover:bg-white/10 hover:text-foundry-ink" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="grid min-h-0 gap-0 md:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-auto border-b border-white/10 p-3 md:border-b-0 md:border-r">
            <ProjectFileTree files={execution?.files ?? workspaceFiles} onReadFile={onReadFile} />
            <div className="hidden">
              {(execution?.files ?? (selectedFile ? [{ path: selectedFile.path, status: "created" as const, size: selectedFile.content.length }] : [])).map((file) => (
                <button
                  key={file.path}
                  className={`rounded-md px-3 py-2 text-left text-xs transition ${selectedFile?.path === file.path ? "bg-foundry-teal/15 text-foundry-ink" : "text-foundry-muted hover:bg-white/[0.06] hover:text-foundry-ink"}`}
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
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <p className="truncate text-sm font-extrabold text-foundry-ink">{selectedFile?.path ?? "Select a file"}</p>
              <button
                className="rounded-md border border-white/10 px-3 py-2 text-xs font-extrabold text-foundry-muted transition enabled:hover:border-foundry-teal/35 enabled:hover:text-foundry-ink disabled:opacity-50"
                type="button"
                disabled={!selectedFile}
                onClick={() => selectedFile && void navigator.clipboard.writeText(selectedFile.content)}
              >
                Copy
              </button>
            </div>
            {error ? <p className="p-4 text-sm text-red-300">{error}</p> : null}
            <pre className="min-h-0 overflow-auto whitespace-pre-wrap p-4 text-xs leading-5 text-foundry-muted">{selectedFile?.content ?? "Choose a file from the tree."}</pre>
          </section>
        </div>
      </section>
    </div>
  );
}

function CustomBuildStep({ start, onUpdate }: { start: ProjectStart; onUpdate: (update: Partial<ProjectStart>) => void }) {
  function applyDescription(value: string) {
    const next = discoverProject(value);
    onUpdate({
      projectDescription: value,
      appKind: next.projectType,
      subtype: firstSubtypeForDetectedType(next.projectType),
      customSubtype: "",
      projectName: start.projectNameTouched ? start.projectName : cleanProjectName(next.projectType),
      stack: next.recommendedStack,
      customStack: "",
      discovery: value.trim() ? next : null,
      discoveryAnswers: {},
    });
  }

  return (
    <FlowSection eyebrow="Foundry is asking" title="What do you want to build?" body="Describe it in your own words. Foundry will infer the shape, stack, architecture, features, style, and data model before it asks anything else.">
      <textarea
        className="min-h-32 w-full resize-y border-0 border-b border-white/10 bg-transparent p-0 pb-2 font-serif text-[17px] italic leading-8 text-foundry-ink outline-none placeholder:not-italic placeholder:text-foundry-subtle focus:border-foundry-teal/50"
        value={start.projectDescription}
        onChange={(event) => applyDescription(event.target.value)}
        placeholder="a small warehouse system tracking pallets across three sites…"
      />
      {start.discovery ? (
        <p className="mt-4 text-xs text-foundry-subtle">Foundry has enough signal to draft a decision memo. Continue to review and edit it before building.</p>
      ) : null}
    </FlowSection>
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function UnderstandingStep({ start, onUpdate, onAdvance }: { start: ProjectStart; onUpdate: (update: Partial<ProjectStart>) => void; onAdvance: () => void }) {
  const [showEscape, setShowEscape] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    const escapeTimer = window.setTimeout(() => {
      if (!cancelledRef.current) setShowEscape(true);
    }, 2500);
    // Foundry is genuinely reasoning here even when the API call resolves in a
    // few hundred ms — without a floor the "thinking" beat can flash by unnoticed.
    const minVisibleMs = 1800;
    const startedAt = Date.now();

    async function refine() {
      if (!start.discovery) {
        const remaining = minVisibleMs - (Date.now() - startedAt);
        if (remaining > 0) await wait(remaining);
        if (!cancelledRef.current) onAdvance();
        return;
      }
      try {
        const inspection = start.uploadNames.length ? inspectExistingSourceNames(start.uploadNames) : null;
        const response = await fetch("/api/factory/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            context: {
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
            heuristic: start.discovery,
          }),
        });
        const result = await response.json().catch(() => null);
        if (!cancelledRef.current && result?.ok && result.discovery) {
          onUpdate({
            discovery: result.discovery,
            alternativeStacks: Array.isArray(result.alternativeStacks) ? result.alternativeStacks : [],
            deploymentNote: typeof result.deploymentNote === "string" ? result.deploymentNote : "",
            lede: typeof result.lede === "string" ? result.lede : "",
          });
        }
      } catch {
        // Network error, timeout, or malformed response — keep the heuristic result already in start.discovery.
      } finally {
        window.clearTimeout(escapeTimer);
        const remaining = minVisibleMs - (Date.now() - startedAt);
        if (remaining > 0 && !cancelledRef.current) await wait(remaining);
        if (!cancelledRef.current) onAdvance();
      }
    }

    void refine();
    return () => {
      cancelledRef.current = true;
      window.clearTimeout(timeout);
      window.clearTimeout(escapeTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function skipRefinement() {
    cancelledRef.current = true;
    controllerRef.current?.abort();
    onAdvance();
  }

  const reasoningLines = [
    `Read the domain — ${start.appKind || "this project"}`,
    "Weighed likely users and complexity",
    "Drafting architecture and a first data model…",
    "Choosing a stack it can honestly commit to",
  ];

  return (
    <FlowSection eyebrow="Foundry is thinking" title="Working out what this actually needs." body="This takes a few seconds. Foundry is reasoning about purpose, users, architecture, and an honest first stack recommendation — not asking you anything else yet.">
      <div className="flex items-start gap-7">
        <span
          className="mt-1 h-[46px] w-[46px] shrink-0 animate-breathe-slow rounded-full"
          style={{ background: "radial-gradient(circle at 35% 30%, #7cf0d4, #1f7a5c 70%)", boxShadow: "0 0 0 1px rgba(52,216,166,0.3), 0 0 40px -6px rgba(52,216,166,0.7)" }}
        />
        <div className="grid gap-3.5">
          {reasoningLines.map((line, index) => (
            <div
              key={line}
              className={`flex animate-reveal items-center gap-2.5 font-mono text-[13px] ${index < 2 ? "text-foundry-ink" : index === 2 ? "text-foundry-ink" : "text-foundry-subtle opacity-40"}`}
              style={{ animationDelay: `${index * 0.2 + 0.05}s` }}
            >
              {index < 2 ? (
                <CheckCircle2 size={13} className="shrink-0 text-foundry-teal" />
              ) : index === 2 ? (
                <span className="h-1.5 w-1.5 shrink-0 animate-breathe rounded-full bg-foundry-amber" />
              ) : (
                <span className="w-[13px] shrink-0 text-center text-foundry-subtle">·</span>
              )}
              {line}
            </div>
          ))}
        </div>
      </div>
      {showEscape ? (
        <button
          className="mt-8 text-xs font-bold text-foundry-subtle transition hover:text-foundry-muted"
          type="button"
          onClick={skipRefinement}
        >
          Continue without deeper analysis
        </button>
      ) : null}
    </FlowSection>
  );
}

function DiscoveryRail({ start, stepIndex, steps }: { start: ProjectStart; stepIndex: number; steps: FlowStep[] }) {
  const idx = (target: FlowStep) => steps.indexOf(target);
  const starterLabel = start.template.id === "custom" ? "Custom project" : start.template.title.replace(/^Build\s+/i, "");
  const locationResolved = stepIndex > idx("project");
  const styleValue = start.customStyle.trim() || start.styleChoice;

  const rows: Array<{ key: string; label: string; value: string; show: boolean; pending?: boolean }> = [
    { key: "starter", label: "Starter", value: starterLabel, show: true },
    { key: "domain", label: "Domain", value: start.discovery?.projectType ?? "", show: Boolean(start.discovery) },
    { key: "stack", label: "Stack", value: selectedStackFor(start), show: stepIndex >= idx("stack") },
    { key: "style", label: "Style", value: styleValue, show: stepIndex >= idx("style") && Boolean(styleValue) },
    { key: "location", label: "Where it lives", value: locationResolved ? locationLabel(start.projectLocation) : "Not chosen yet", show: true, pending: !locationResolved },
  ];

  return (
    <aside className="hidden border-r border-white/[0.06] bg-gradient-to-b from-white/[0.025] to-transparent px-5 py-6 md:flex md:flex-col">
      <div className="mb-8 flex items-center gap-2">
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-gradient-to-br from-foundry-teal to-[#1f7a5c] font-serif text-[13px] font-bold italic text-[#06110d]">F</span>
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

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] text-foundry-muted">
          <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-foundry-teal" />
          Foundry is here with you
        </span>
      </div>
    </aside>
  );
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
  const recommendations = recommendationsFor(start.template, start.appKind);
  const starredRecommendations = recommendations.filter((item) => item.recommended);
  const advancedRecommendations = recommendations.filter((item) => !item.recommended);
  const selectedRecommendation = recommendationForStart(start);
  const defaults = selectedRecommendation.defaults;
  const canUseFolderPicker = supportsBrowserFolderAccess();
  const steps: FlowStep[] = ["kind", "project", "understanding", "stack", "style", "summary", "instructions"];
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
    const stackChanged = resolved !== start.discovery.recommendedStack;
    const nextArchitecture = stackChanged ? genericArchitectureFor(resolved, start.discovery.dataModel) : start.discovery.architecture;
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
      input.setAttribute("accept", ".zip,.tar,.gz,.7z,.rar,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.py,.cs,.java,.kt,.php,.go,.rs");
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <section className="grid max-h-[90vh] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-white/15 bg-[#111617] shadow-workspace">
        <header className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-foundry-teal/25 bg-foundry-teal/[0.08] text-foundry-teal">
              <Icon size={16} />
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foundry-subtle">Intelligent Project Discovery</span>
          </div>
          <button className="rounded-md px-3 py-1.5 text-sm font-bold text-foundry-muted hover:bg-white/10 hover:text-foundry-ink" type="button" onClick={onClose}>
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
                      uploadNames: selectedUploadNames(files),
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
                        const discovery = discoverProject(appKind);
                        onUpdate({
                          subtype,
                          customSubtype: "",
                          appKind,
                          projectName: cleanProjectName(appKind),
                          projectNameTouched: false,
                          stack: discovery.recommendedStack,
                          customStack: "",
                          discovery,
                          discoveryAnswers: {},
                        });
                      }}
                    />
                  ))}
                </div>
                <label className="mt-7 flex items-baseline gap-2.5 text-[15px]">
                  <span className="whitespace-nowrap font-serif italic text-foundry-subtle">or, in your words —</span>
                  <input
                    className="flex-1 border-0 border-b border-white/10 bg-transparent p-0 pb-1.5 text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/50"
                    value={start.customSubtype}
                    onChange={(event) => {
                      const appKind = appKindFor(start.template, start.subtype, event.target.value);
                      const discovery = discoverProject(appKind);
                      onUpdate({
                        customSubtype: event.target.value,
                        appKind,
                        projectName: cleanProjectName(appKind),
                        projectNameTouched: false,
                        stack: discovery.recommendedStack,
                        customStack: "",
                        discovery,
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
                  <div className="rounded-md border border-white/10 bg-white/[0.035] p-3 text-sm text-foundry-muted">
                    Current workspace project detected: <span className="font-bold text-foundry-ink">{connectedProjectTitle}</span>
                  </div>
                ) : null}

                {start.projectLocation !== "create-folder" ? (
                  <div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-5 text-foundry-muted">
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
                          <a className="rounded-md border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink" href="/api/factory/agent/download?platform=mac" download>
                            macOS
                          </a>
                          <a className="rounded-md border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink" href="/api/factory/agent/download?platform=linux" download>
                            Linux
                          </a>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-foundry-subtle">
                          Requires Node.js already installed (get it from nodejs.org if needed). Run the downloaded file once — it installs itself, starts running, and relaunches automatically every time you log in. Then check again below.
                        </p>
                        <button
                          className="mt-3 rounded-md border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink"
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
                        className="rounded-md border border-white/15 bg-white/[0.055] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-blue/35 hover:bg-foundry-blue/10 hover:text-foundry-ink"
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
            <FlowSection eyebrow="Foundry recommends, doesn't force" title="Pick a stack — or trust the recommendation." body="Starred picks fit this project best. Everything else Foundry supports is one click away, with an honest capability level attached.">
              <div className="grid gap-2.5 sm:grid-cols-2">
                {starredRecommendations.map((recommendation) => (
                  <StackCard key={recommendation.name} recommendation={recommendation} active={!start.customStack.trim() && start.stack === recommendation.name} onClick={() => selectStack(recommendation.name)} />
                ))}
              </div>

              {advancedRecommendations.length ? (
                <details className="mt-6 border-t border-white/[0.07] pt-4" open>
                  <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.08em] text-foundry-subtle">
                    Every other language Foundry supports — {advancedRecommendations.length} more
                  </summary>
                  <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    {groupedAdvancedStacks(advancedRecommendations).map((group) => (
                      <div key={group.label}>
                        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">{group.label}</div>
                        <div className="grid">
                          {group.items.map((recommendation) => (
                            <StackRow key={recommendation.name} recommendation={recommendation} active={!start.customStack.trim() && start.stack === recommendation.name} onClick={() => selectStack(recommendation.name)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {defaults.length ? (
                <ul className="mt-6 grid gap-1 text-[12.5px] text-foundry-muted">
                  {defaults.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-foundry-subtle">—</span>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}

              <label className="mt-6 flex items-baseline gap-2.5 text-[15px]">
                <span className="whitespace-nowrap font-serif italic text-foundry-subtle">or, another stack —</span>
                <input
                  className="flex-1 border-0 border-b border-white/10 bg-transparent p-0 pb-1.5 text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/50"
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
                        ? "border-foundry-teal bg-foundry-teal font-semibold text-[#06120d]"
                        : "border-white/10 bg-white/[0.04] text-foundry-muted hover:border-white/25 hover:text-foundry-ink"
                    }`}
                    onClick={() =>
                      onUpdate({
                        styleChoice: option,
                        customStyle: "",
                        discovery: start.discovery ? { ...start.discovery, styleDirection: styleDescriptions[option] } : start.discovery,
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
                  className="flex-1 border-0 border-b border-white/10 bg-transparent p-0 pb-1.5 text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/50"
                  value={start.customStyle}
                  onChange={(event) =>
                    onUpdate({
                      customStyle: event.target.value,
                      styleChoice: "",
                      discovery: start.discovery && event.target.value.trim() ? { ...start.discovery, styleDirection: event.target.value } : start.discovery,
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
            <FlowSection eyebrow="Optional" title="Anything else Foundry should know?" body="Constraints, features, data fields, brand direction, integrations — leave it empty and Foundry builds from the memo alone.">
              <textarea
                className="min-h-32 w-full resize-y border-0 border-b border-white/10 bg-transparent p-0 pb-2 font-serif text-[17px] italic leading-8 text-foundry-ink outline-none placeholder:not-italic placeholder:text-foundry-subtle focus:border-foundry-teal/50"
                value={start.instructions}
                onChange={(event) => onUpdate({ instructions: event.target.value })}
                placeholder="roles, pages, workflows, data, integrations, visual style, constraints…"
              />
            </FlowSection>
          ) : null}
        </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-7 py-5 sm:px-9">
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
                    {step === "kind" && !start.discovery ? (
                      <p className="max-w-xs text-right text-xs leading-5 text-foundry-amber">Select or describe the project first so Foundry can infer a confidence map.</p>
                    ) : null}
                    {step === "project" && blockedByExistingSource ? (
                      <p className="max-w-xs text-right text-xs leading-5 text-foundry-amber">Choose what Foundry should do about the existing files before continuing.</p>
                    ) : null}
                    <button
                      className="inline-flex items-center gap-2 rounded-md bg-foundry-teal px-5 py-2.5 text-[13.5px] font-bold text-[#06120d] shadow-[0_6px_20px_-8px_rgba(79,209,189,0.7)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-35 disabled:shadow-none"
                      type="button"
                      disabled={(step === "kind" && !start.discovery) || (step === "project" && blockedByExistingSource)}
                      onClick={() => onStepChange(nextStep)}
                    >
                      Continue <span aria-hidden="true">→</span>
                    </button>
                  </div>
                ) : (
                  <button
                    className="inline-flex items-center gap-2 rounded-md bg-foundry-amber px-5 py-2.5 text-[13.5px] font-bold text-[#1a1206] shadow-[0_6px_20px_-8px_rgba(232,183,92,0.7)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-35 disabled:shadow-none"
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
  const everConnectedRef = useRef(false);

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
        ? Boolean(start.localConnectorUrl && start.localConnectorRoot)
        : start.source === "local"
          ? Boolean(start.localPath.trim())
          : start.source === "upload"
            ? start.uploadedFiles.length > 0
            : false;

  const activeSourceNames = start.source === "connector" ? connectedFolderEntries : start.source === "browser-local" || start.source === "upload" ? start.uploadNames : [];
  const existingSourceRisky = activeSourceNames.length > 0 && inspectExistingSourceNames(activeSourceNames, "open-existing").risky;
  const blockedByExistingSource = existingSourceRisky && !start.existingSourceChoice;

  async function handleExistingUpload(files: FileList | null) {
    const uploadNames = selectedUploadNames(files);
    const uploadedFiles = await selectedUploadedFiles(files);
    onUpdate({ uploadNames, uploadedFiles, source: "upload", existingSourceConfirmed: false, existingSourceChoice: null });
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
      return;
    }
    let cancelled = false;
    void listAgentTree(agentUrl, agentToken, start.localConnectorRoot).then((result) => {
      if (!cancelled && result.ok) setConnectedFolderEntries(result.entries.map((entry) => entry.path));
    });
    return () => {
      cancelled = true;
    };
  }, [start.source, agentStatus, start.localConnectorRoot, agentUrl, agentToken]);

  function applyConnectedFolder(root: string) {
    onUpdate({ source: "connector", localConnectorUrl: agentUrl, localConnectorToken: agentToken, localConnectorRoot: root, existingSourceConfirmed: false, existingSourceChoice: null });
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
      input.setAttribute("accept", ".zip,.tar,.gz,.7z,.rar,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.py,.cs,.java,.kt,.php,.go,.rs,.log");
    }
    input.click();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <section className="grid max-h-[90vh] w-full max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-white/15 bg-[#111617] shadow-workspace">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-4">
          <div>
            <p className="section-kicker">Open Existing Project</p>
            <h2 className="mt-1 text-lg font-extrabold text-foundry-ink">Bring a project into Foundry</h2>
          </div>
          <button className="rounded-md px-3 py-1.5 text-sm font-bold text-foundry-muted hover:bg-white/10 hover:text-foundry-ink" type="button" onClick={onClose}>
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
                      The Local Agent lets Foundry read, write, and run real commands against a real folder on this computer — real <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[11px]">node_modules</code>, real dev server, not a throwaway copy. Install it once, then connect any project folder.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a className="rounded-md border border-foundry-teal/35 bg-foundry-teal/[0.14] px-3 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-teal/[0.2]" href="/api/factory/agent/download?platform=windows" download>
                        Download for Windows
                      </a>
                      <a className="rounded-md border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink" href="/api/factory/agent/download?platform=mac" download>
                        macOS
                      </a>
                      <a className="rounded-md border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink" href="/api/factory/agent/download?platform=linux" download>
                        Linux
                      </a>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-foundry-subtle">
                      Requires Node.js already installed (get it from nodejs.org if needed). Run the downloaded file once — it installs itself, starts running, and relaunches automatically every time you log in, so you will not need to run it again. Then check again below.
                      On macOS you may need to right-click the downloaded file and choose Open the first time.
                    </p>
                    <button
                      className="mt-3 rounded-md border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink"
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
                        className="min-h-10 rounded-md border border-white/10 bg-black/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                        value={folderPathInput}
                        onChange={(event) => setFolderPathInput(event.target.value)}
                        placeholder="C:\Users\you\Documents\your-project"
                      />
                    </label>
                    <button
                      className="justify-self-start rounded-md border border-white/15 bg-white/[0.05] px-3 py-2 text-xs font-extrabold text-foundry-muted transition hover:border-foundry-teal/35 hover:text-foundry-ink disabled:cursor-not-allowed disabled:opacity-50"
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
                          className="min-h-10 rounded-md border border-white/10 bg-black/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                          value={agentUrl}
                          onChange={(event) => setAgentUrl(event.target.value)}
                          placeholder="http://127.0.0.1:3917"
                        />
                      </label>
                      <label className="grid gap-1.5 text-xs font-bold text-foundry-muted">
                        Token (optional)
                        <input
                          className="min-h-10 rounded-md border border-white/10 bg-black/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
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
                    className="rounded-md border border-white/15 bg-white/[0.055] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-blue/35 hover:bg-foundry-blue/10 hover:text-foundry-ink"
                    type="button"
                    onClick={() => openExistingUploadPicker("files")}
                  >
                    Choose ZIP/project files
                  </button>
                  <button
                    className="rounded-md border border-white/15 bg-white/[0.055] px-3 py-2 text-sm font-extrabold text-foundry-muted transition hover:border-foundry-blue/35 hover:bg-foundry-blue/10 hover:text-foundry-ink"
                    type="button"
                    onClick={() => openExistingUploadPicker("folder")}
                  >
                    Import folder copy
                  </button>
                </div>
                <UploadSummary names={start.uploadNames} />
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
                    className="min-h-10 rounded-md border border-white/10 bg-black/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                    value={start.localPath}
                    onChange={(event) => onUpdate({ localPath: event.target.value })}
                    placeholder="C:\\Users\\you\\Documents\\your-project"
                  />
                </label>
              </div>
            ) : null}

            <label className="mt-4 grid gap-1.5 text-xs font-bold text-foundry-muted">
              Optional project context
              <textarea
                className="min-h-36 w-full resize-y rounded-md border border-white/10 bg-black/25 p-3 text-sm leading-6 text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
                value={start.description}
                onChange={(event) => onUpdate({ description: event.target.value })}
                placeholder="Example: This is a Next.js storefront. The current priority is fixing checkout bugs and preparing for Vercel later..."
              />
            </label>

            <div className="mt-4 rounded-md border border-foundry-amber/25 bg-foundry-amber/[0.08] p-3 text-sm leading-6 text-foundry-muted">
              Import copy mode creates a Foundry workspace folder and requires export. Local folder path mode edits the original folder on disk.
            </div>
          </FlowSection>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 p-4">
          {blockedByExistingSource ? <p className="mr-auto max-w-xs text-xs leading-5 text-foundry-amber">Choose what Foundry should do about the existing files before opening this project.</p> : null}
          <button className="rounded-md px-3 py-2 text-sm font-bold text-foundry-muted transition hover:bg-white/10 hover:text-foundry-ink" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded-md border border-foundry-amber/35 bg-foundry-amber/[0.12] px-4 py-2 text-sm font-extrabold text-foundry-ink transition hover:bg-foundry-amber/[0.18] disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            disabled={!canOpenProject || blockedByExistingSource}
            onClick={onCreate}
          >
            {start.source === "upload" ? "Open Foundry Copy" : "Open Project"}
          </button>
        </footer>
      </section>
    </div>
  );
}

type AgentStatus = "checking" | "not-installed" | "installed" | "connected" | "offline";

function useLocalAgentInstallStatus(): AgentStatus {
  const [status, setStatus] = useState<AgentStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const health = await checkAgentHealth("http://127.0.0.1:3917", "");
      if (cancelled) return;
      setStatus(health.ok ? "installed" : "not-installed");
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

function useLiveAgentStatus(connectorUrl: string, connectorToken: string, connectorRoot: string): AgentStatus | null {
  const [status, setStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    if (!connectorUrl) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    setStatus("checking");

    async function poll() {
      const health = await checkAgentHealth(connectorUrl, connectorToken);
      if (cancelled) return;
      if (!health.ok) {
        setStatus("offline");
        return;
      }
      setStatus(connectorRoot && health.approvedRoots.includes(connectorRoot) ? "connected" : "installed");
    }

    void poll();
    const interval = window.setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connectorUrl, connectorToken, connectorRoot]);

  return status;
}

function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const config: Record<AgentStatus, { label: string; className: string }> = {
    checking: { label: "Checking...", className: "border-white/15 bg-white/[0.05] text-foundry-subtle" },
    "not-installed": { label: "Agent Not Installed", className: "border-white/15 bg-white/[0.05] text-foundry-subtle" },
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
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <section className="grid max-h-[85vh] w-full max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-white/15 bg-[#111617] shadow-workspace">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-4">
          <div>
            <p className="section-kicker">Local Agent</p>
            <h2 className="mt-1 text-lg font-extrabold text-foundry-ink">Choose a Project Folder</h2>
          </div>
          <button className="rounded-md px-3 py-1.5 text-sm font-bold text-foundry-muted hover:bg-white/10 hover:text-foundry-ink" type="button" onClick={onClose}>
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
                  className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm font-bold text-foundry-muted transition hover:border-foundry-teal/30 hover:bg-white/[0.06] hover:text-foundry-ink"
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
                    className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm font-bold text-foundry-ink transition hover:border-foundry-teal/30 hover:bg-white/[0.06]"
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
            <div className="mt-4 border-t border-white/10 pt-3">
              {newFolderOpen ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="min-h-9 flex-1 rounded-md border border-white/10 bg-black/25 px-3 text-sm text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-teal/45"
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

        <footer className="flex justify-end gap-2 border-t border-white/10 p-4">
          <button className="rounded-md px-3 py-2 text-sm font-bold text-foundry-muted transition hover:bg-white/10 hover:text-foundry-ink" type="button" onClick={onClose}>
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

function ChoiceButton({ active, label, description, onClick }: { active: boolean; label: string; description?: string; onClick: () => void }) {
  return (
    <button
      className={`min-h-11 rounded-lg border px-3.5 py-2.5 text-left text-[13.5px] font-semibold transition ${
        active ? "border-foundry-teal/45 bg-foundry-teal/[0.08] text-foundry-ink" : "border-white/10 bg-white/[0.03] text-foundry-muted hover:border-white/20 hover:text-foundry-ink"
      }`}
      type="button"
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
        active ? "border-foundry-teal bg-foundry-teal font-semibold text-[#06120d]" : "border-white/10 bg-white/[0.04] text-foundry-muted hover:border-white/25 hover:text-foundry-ink"
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
    2: "border-white/15 text-foundry-muted",
    1: "border-red-300/40 text-red-300",
  };
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9.5px] tracking-wide ${styles[level] ?? styles[2]}`}>{level}/4</span>;
}

function StackCard({ recommendation, active, onClick }: { recommendation: StackRecommendation; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-4 py-4 text-left transition ${
        active ? "border-foundry-teal/50 bg-foundry-teal/[0.07] shadow-[inset_0_0_0_1px_rgba(79,209,189,0.3)]" : "border-white/10 bg-white/[0.03] hover:border-white/20"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-serif text-[19px] text-foundry-ink">{recommendation.name}</span>
        {recommendation.recommended ? <span className="font-mono text-[9.5px] uppercase tracking-wider text-foundry-amber">★ recommended</span> : null}
      </div>
      <p className="m-0 text-[12.5px] leading-relaxed text-foundry-muted">{recommendation.why}</p>
    </button>
  );
}

function StackRow({ recommendation, active, onClick }: { recommendation: StackRecommendation; active: boolean; onClick: () => void }) {
  const capability = capabilityLevelForStackChoice(recommendation.name);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-3 border-b border-white/[0.06] py-2 text-left text-[13px] transition ${active ? "text-foundry-ink" : "text-foundry-muted hover:text-foundry-ink"}`}
    >
      <span>{active ? "✓ " : ""}{recommendation.name}</span>
      <CapabilityBadge level={capability.level} />
    </button>
  );
}

function groupLabelForStack(name: string): string {
  const value = name.toLowerCase();
  if (/react native|flutter|android/.test(value)) return "Mobile";
  if (/wpf|winforms|electron|tauri/.test(value)) return "Desktop";
  if (/unity|godot|phaser/.test(value)) return "Game";
  if (/node|express|nestjs|fastapi|django|spring|web api|rust|\bgo\b/.test(value)) return "Backend";
  if (/next\.?js|react|vue|angular|astro|laravel|php|html/.test(value)) return "Web";
  return "Other";
}

function groupedAdvancedStacks(recommendations: StackRecommendation[]) {
  const order = ["Web", "Backend", "Desktop", "Mobile", "Game", "Other"];
  const groups = new Map<string, StackRecommendation[]>();
  for (const recommendation of recommendations) {
    const label = groupLabelForStack(recommendation.name);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)?.push(recommendation);
  }
  return order.filter((label) => groups.has(label)).map((label) => ({ label, items: groups.get(label) as StackRecommendation[] }));
}

function UploadSummary({ names }: { names: string[] }) {
  if (!names.length) {
    return <p className="mt-3 text-xs leading-5 text-foundry-subtle">No files selected yet.</p>;
  }

  const visible = names.slice(0, 5);
  const hiddenCount = Math.max(names.length - visible.length, 0);

  return (
    <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3">
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
      <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-5 text-foundry-subtle">
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
    const nextArchitecture = stackChanged ? genericArchitectureFor(name, currentDiscovery.dataModel) : currentDiscovery.architecture;
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
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">Foundry&apos;s Understanding</p>
        <p className="font-serif text-[17px] leading-[1.75] text-foundry-ink">{ledeFor(start)}</p>
      </div>

      {discovery.keyFacts.length ? (
        <div>
          <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foundry-subtle">What Foundry Already Knows</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {discovery.keyFacts.map((fact) => (
              <li key={fact} className="flex items-baseline gap-2 text-[13.5px] leading-relaxed text-foundry-ink">
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
          <div className="border-t border-white/[0.07]">
            {alternativeStacks.map((name) => (
              <div key={name} className="flex items-center justify-between gap-3 border-b border-white/[0.07] py-2.5 text-[13.5px] text-foundry-ink">
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
                  className="border-0 border-b border-white/10 bg-transparent p-0 pb-1.5 pl-[19px] text-[13.5px] text-foundry-ink outline-none placeholder:text-foundry-subtle focus:border-foundry-amber/50"
                  value={start.discoveryAnswers[decision.dimension] ?? ""}
                  onChange={(event) => onUpdate({ discoveryAnswers: { ...start.discoveryAnswers, [decision.dimension]: event.target.value } })}
                  placeholder="Answer if it matters for the first build…"
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <details className="border-t border-white/[0.07] pt-4">
        <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.08em] text-foundry-subtle">Full reasoning &amp; confidence map — {disclosedDecisions.length} decisions</summary>
        <div className="mt-3 grid overflow-hidden rounded-md border border-white/[0.07]">
          {disclosedDecisions.map((decision) => (
            <div key={decision.dimension} className="grid gap-1 border-b border-white/[0.06] bg-white/[0.015] px-3 py-2.5 font-mono text-[11px] leading-5 text-foundry-muted last:border-b-0">
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
          className="border-0 border-b border-white/10 bg-transparent p-0 pb-1 text-[14px] text-foundry-ink outline-none focus:border-foundry-teal/50"
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
  return `${chosenSubtype} ${defaultKindFor(template.id)}`.trim();
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

function firstSubtypeForDetectedType(detectedType: string) {
  const inferredTemplateId = templateIdForDetectedType(detectedType);
  if (inferredTemplateId) return firstSubtypeFor(inferredTemplateId);
  return customSubtypesForDetectedType(detectedType)[0] ?? detectedType ?? "Custom";
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

function selectedUploadNames(files: FileList | null) {
  if (!files) return [];

  return Array.from(files)
    .map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return relativePath || file.name;
    })
    .filter(isEditableUploadPath);
}

async function selectedUploadedFiles(files: FileList | null): Promise<FactoryUploadedFile[]> {
  if (!files) return [];
  const maxFileSize = 240_000;
  const maxTotalSize = 1_500_000;
  let totalSize = 0;
  const readableFiles: FactoryUploadedFile[] = [];

  for (const file of Array.from(files)) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (!isEditableUploadPath(relativePath) || file.size > maxFileSize || totalSize + file.size > maxTotalSize) continue;
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

function isEditableUploadPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)(node_modules|\.git|\.next|dist|build|coverage|target|bin|obj)(\/|$)/.test(normalized)) return false;
  return /\.(html|css|js|mjs|cjs|json|md|txt|ts|tsx|jsx|vue|svelte|py|php|cs|java|kt|xml|yml|yaml)$/i.test(normalized);
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
      normalized.filter((name) => PROJECT_MARKER_PATTERN.test(name.toLowerCase()) && !NOISE_PATH_PATTERN.test(name.toLowerCase())).map((name) => name.split("/")[0]),
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

function primaryRecommendationFor(template: BuildTemplate, appKind: string) {
  return recommendationsFor(template, appKind)[0] ?? stackRecommendations.custom[0];
}

function selectedStackFor(start: ProjectStart) {
  return start.customStack.trim() || start.stack;
}

function genericArchitectureFor(stack: string, entities: string[]) {
  const primaryEntities = entities.slice(0, 2).join(" and ") || "the core data";
  return `${stack} implementation with create/update/delete flows for ${primaryEntities}, optimistic UI feedback, and local-first storage until a real backend or multi-device sync is requested.`;
}

/** "What Foundry Already Knows" carries a short architecture-derived tag that would otherwise keep
 * naming the old stack after the user switches — swap any fact that still mentions it. */
function refreshArchitectureKeyFact(keyFacts: string[], oldStack: string, newStack: string): string[] {
  const oldStackLower = oldStack.trim().toLowerCase();
  if (!oldStackLower) return keyFacts;
  const replacement = `${newStack} architecture`;
  return keyFacts.map((fact) => (fact.toLowerCase().includes(oldStackLower) ? replacement : fact));
}

function alternativeStacksFor(start: ProjectStart) {
  if (start.alternativeStacks.length) return start.alternativeStacks;
  const selected = selectedStackFor(start);
  return recommendationsFor(start.template, start.appKind)
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
  if (/next\.?js|react|vue|angular|astro|node|express|fastapi|django|laravel|php|html/.test(stack)) return "Deploys well to Vercel, Netlify, or any Node/static host.";
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
      defaults: ["Use the custom stack exactly as entered", "Clarify project structure before generation", "Preserve factory build compatibility"],
      why: "You entered a custom stack, so Foundry will preserve it in the project brief instead of forcing a recommended preset.",
    };
  }

  return recommendationsFor(start.template, start.appKind).find((item) => item.name === start.stack) ?? primaryRecommendationFor(start.template, start.appKind);
}

function recommendationsFor(template: BuildTemplate, appKind: string) {
  return uniqueRecommendations([...stackRecommendations[categoryForProject(template, appKind)], ...broadStackOptions]);
}

function uniqueRecommendations(recommendations: StackRecommendation[]) {
  const seen = new Set<string>();
  return recommendations.filter((recommendation) => {
    const key = recommendation.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categoryForProject(template: BuildTemplate, appKind: string): ProjectCategory {
  // The dedicated starters carry known intent, so they resolve before any text sniffing —
  // this keeps "Build Desktop Application" cross-platform by default even though its own
  // copy contains the word "desktop", which would otherwise match the Windows-specific regex below.
  if (template.id === "desktop") return "desktop";
  if (template.id === "api") return "backend-api";
  if (template.id === "ai") return "ai-app";

  const text = `${template.title} ${template.description} ${appKind}`.toLowerCase();

  if (/\b(ai|llm|chatbot|agent|rag|model provider|openai|anthropic|vector|embedding)\b/.test(text)) return "ai-app";
  if (/\b(api|backend|server|service|microservice|rest|graphql|spring|django|fastapi|express|nestjs)\b/.test(text)) return "backend-api";
  if (/\b(android|kotlin|java android|apk|gradle|emulator)\b/.test(text)) return "android";
  if (/\b(desktop|windows app|winforms|wpf|\.net desktop|installer)\b/.test(text)) return "desktop-windows";
  if (/\b(mobile|ios|react native|flutter|cross-platform|cross platform)\b/.test(text) || template.id === "mobile") return "mobile-cross-platform";
  if (/\b(game|unity|godot|phaser)\b/.test(text) || template.id === "game") return "game";
  if (/\b(login|sign.?in|sign.?up|auth|account|website|landing page|blog|portfolio)\b/.test(text) || ["inventory", "commerce", "dashboard", "website", "pos"].includes(template.id)) return "web";

  return "custom";
}

function cleanProjectName(value: string) {
  return titleCase(
    value
      .replace(/\b(build|create|make|me|an?|the|with|for)\b/gi, " ")
      .replace(/\b(system|app|application|project)\b/gi, " $&")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function inferCustomBuild(description: string) {
  const text = description.trim();
  const detectedType = detectCustomProjectType(text);
  const names = suggestProjectNames(text, detectedType);
  const stack = stackForDetectedType(detectedType);
  const prompts = promptsForDetectedType(text, detectedType);

  return { detectedType, names, stack, prompts };
}

function detectCustomProjectType(text: string) {
  const normalized = text.toLowerCase();
  if (/\b(inventory|stock|sku|warehouse|barcode)\b/.test(normalized)) return "Inventory System";
  if (/\b(store|shop|e-?commerce|cart|checkout|product catalog)\b/.test(normalized)) return "E-commerce Store";
  if (/\b(pos|point of sale|register|checkout terminal)\b/.test(normalized)) return "POS App";
  if (/\b(dashboard|metrics|analytics|reporting|kpi)\b/.test(normalized)) return "Dashboard";
  if (/\b(website|landing|portfolio|docs|marketing)\b/.test(normalized)) return "Website";
  if (/\b(android|mobile|ios|react native|flutter)\b/.test(normalized)) return "Mobile App";
  if (/\b(game|unity|godot|phaser|level|score)\b/.test(normalized)) return "Game";
  if (/\b(api|backend|service|server)\b/.test(normalized)) return "Backend/API";
  if (/\b(ai|llm|chatbot|agent|rag|model)\b/.test(normalized)) return "AI App";
  return deriveCustomProjectTarget(text);
}

function suggestProjectNames(text: string, detectedType: string) {
  const normalized = text.toLowerCase();
  if (detectedType === "Inventory System") {
    if (/\b(shoe|sneaker|clothing|size|color)\b/.test(normalized)) return ["Shoe Inventory Manager", "Barcode Inventory System", "Retail Stock Manager"];
    if (/\b(warehouse)\b/.test(normalized)) return ["Warehouse Inventory Manager", "Stock Control Hub", "Inventory Operations Console"];
    return ["Inventory Manager", "Stock Control System", "Product Inventory Hub"];
  }
  if (detectedType === "E-commerce Store") return ["Commerce Storefront", "Product Shop", "Online Sales Hub"];
  if (detectedType === "POS App") return ["Point of Sale Console", "Checkout Manager", "Sales Register App"];
  if (detectedType === "Dashboard") return ["Operations Dashboard", "Metrics Command Center", "Reporting Hub"];
  if (detectedType === "Website") return ["Website Studio", "Brand Website", "Product Site"];
  if (detectedType === "Mobile App") return ["Mobile Companion", "Field App", "Mobile Workspace"];
  if (detectedType === "Game") return ["Game Prototype", "Play Studio", "Arcade Project"];
  if (detectedType === "Backend/API") return ["API Service", "Backend Platform", "Service Core"];
  if (detectedType === "AI App") return ["AI Workspace", "Model Assistant", "AI Operations App"];

  const base = detectedType || deriveCustomProjectTarget(text);
  const core = stripGenericSuffix(base);
  return uniqueStrings([base, `${core} Studio`, `${core} Manager`, `${core} Builder`]).slice(0, 3);
}

function stackForDetectedType(detectedType: string) {
  if (["Inventory System", "E-commerce Store", "POS App", "Dashboard", "Website"].includes(detectedType)) return "Next.js";
  if (detectedType === "Mobile App") return "React Native";
  if (detectedType === "Game") return "Phaser";
  if (detectedType === "Backend/API") return "Node/Express";
  if (detectedType === "AI App") return "Next.js AI App";
  return "Next.js";
}

function promptsForDetectedType(text: string, detectedType: string) {
  if (detectedType === "Inventory System") {
    return [
      "Do you need size/color variants?",
      "Do you need barcode scanner support?",
      "Do you need purchase orders?",
      "Do you need sales/orders?",
      "Should it be local-only or have login/database?",
    ];
  }
  if (detectedType === "E-commerce Store") return ["What products are sold?", "Do you need checkout?", "Do you need inventory sync?", "Do you need subscriptions?", "Should customers log in?"];
  if (detectedType === "POS App") return ["What business type is this for?", "Do you need receipts?", "Do you need payment SDK support?", "Do you need offline mode?", "Do you need inventory sync?"];
  if (detectedType === "AI App") return ["Which model provider?", "Does it need a UI?", "Do you need file upload?", "Is RAG/vector search required?", "Should conversations be saved?"];
  return ["Who will use this?", "What should the first screen do?", "What data should it manage?", "Does it need accounts, storage, or integrations?", "What should Foundry build first?"];
}

function customSubtypesForDetectedType(detectedType: string) {
  if (detectedType === "Backend/API") return ["REST API", "Auth API", "Payment API", "Data processing API", "Admin API", "Custom API"];
  if (detectedType === "AI App") return ["Chat app", "Document Q&A app", "AI assistant", "RAG search app", "Workflow agent", "Custom AI app"];
  if (detectedType === "Custom Software Project") return ["Web app", "Business app", "Internal tool", "AI app", "Backend/API", "Desktop app"];
  const label = sentenceLabel(detectedType);
  return uniqueStrings([prefixedSubtype("Simple", label), prefixedSubtype("Subscription", label), prefixedSubtype("Admin", label), prefixedSubtype("Customer", label), prefixedSubtype("Internal", label), prefixedSubtype("Mobile", label)]);
}

function deriveCustomProjectTarget(text: string) {
  const withoutFeatureClause = text
    .replace(/\b(with|including|that|where|using|connected to|integrated with|for)\b[\s\S]*$/i, " ")
    .replace(/[^\w\s/+.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = withoutFeatureClause
    .split(/\s+/)
    .filter((word) => !customTargetStopWords.has(word.toLowerCase()))
    .slice(0, 5);
  const target = words.join(" ").trim();

  return titleCase(target || "Custom Software Project");
}

const customTargetStopWords = new Set([
  "build",
  "create",
  "make",
  "generate",
  "design",
  "develop",
  "code",
  "me",
  "please",
  "want",
  "need",
  "would",
  "like",
  "a",
  "an",
  "the",
  "my",
  "new",
  "for",
  "from",
  "scratch",
  "project",
]);

function stripGenericSuffix(value: string) {
  return value.replace(/\b(app|application|system|project|software project)\b/gi, "").replace(/\s+/g, " ").trim() || value;
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

function isSoftwareProjectMission(mission: MissionState) {
  const title = `${mission.title} ${mission.conversationTitle} ${mission.objective} ${mission.lastResult}`.toLowerCase();
  return (
    mission.desiredOutcome === "project" ||
    mission.desiredOutcome === "patch" ||
    mission.createdArtifacts.some((artifact) => artifact.type === "project" || artifact.type === "patch" || artifact.kind === "code") ||
    /\b(create project|build inventory|build e-commerce|build ecommerce|build pos|build dashboard|build website|build mobile|build game|ai software factory|preferred stack|smart defaults)\b/.test(title)
  );
}

function projectTitleFor(mission: MissionState) {
  const source = mission.title || mission.conversationTitle || mission.objective || "Untitled project";
  return source.replace(/^Create Project:\s*/i, "").trim() || "Untitled project";
}

function projectBriefFromMission(mission: MissionState) {
  return mission.createdArtifacts.find((artifact) => artifact.type === "project" && artifact.title === "Project Brief")?.body ?? mission.objective;
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
  const artifact = mission.createdArtifacts.find((item) => item.title === "Project Execution");
  if (!artifact) return null;

  try {
    return JSON.parse(artifact.body) as FactoryProjectResult;
  } catch {
    return null;
  }
}

function projectFilesForMission(mission: MissionState, execution: FactoryProjectResult | null): FactoryProjectResult["files"] {
  if (execution?.files.length) return execution.files;

  const uploadedArtifact = mission.createdArtifacts.find((item) => item.title === "Uploaded Project Files");
  if (uploadedArtifact) {
    try {
      const files = JSON.parse(uploadedArtifact.body) as FactoryUploadedFile[];
      if (Array.isArray(files)) {
        return files.map((file) => ({
          path: normalizeProjectPath(file.path),
          status: "uploaded" as const,
          size: file.size ?? file.content?.length ?? 0,
          content: file.content,
        })).filter((file) => file.path);
      }
    } catch {
      // Fall back to paths saved in the brief.
    }
  }

  return selectedUploadPathsFromBrief(projectBriefFromMission(mission)).map((filePath) => ({
    path: normalizeProjectPath(filePath),
    status: "uploaded" as const,
    size: 0,
  })).filter((file) => file.path);
}

function connectedPathForMission(mission: MissionState, execution: FactoryProjectResult | null) {
  const brief = projectBriefFromMission(mission);
  const browserFolderName = brief.match(/^Browser folder name:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (browserFolderName) return browserFolderName;
  const localPath = brief.match(/^Local project path:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (localPath) return localPath;
  const connectorRoot = brief.match(/^Local connector root:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (connectorRoot) return connectorRoot;
  if (execution?.projectPath) return execution.projectPath;
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

async function listAgentTree(agentUrl: string, token: string, root: string, maxEntries = 2000): Promise<{ ok: boolean; entries: Array<{ path: string; size: number }>; truncated?: boolean }> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
    const response = await fetch(`${agentUrl.replace(/\/+$/, "")}/tree`, { method: "POST", headers, body: JSON.stringify({ root, maxEntries }) });
    const result = (await response.json().catch(() => ({}))) as { entries?: Array<{ path: string; size: number }>; truncated?: boolean; error?: string };
    if (!response.ok) return { ok: false, entries: [] };
    return { ok: true, entries: result.entries ?? [], truncated: result.truncated };
  } catch {
    return { ok: false, entries: [] };
  }
}

function mergeConnectorFiles(treeFiles: FactoryProjectResult["files"], overlayFiles: FactoryProjectResult["files"]): FactoryProjectResult["files"] {
  const overlayPaths = new Set(overlayFiles.map((file) => file.path));
  const merged = [...overlayFiles];
  for (const file of treeFiles) {
    if (!overlayPaths.has(file.path)) merged.push(file);
  }
  return merged;
}

async function readAgentFile(agentUrl: string, token: string, root: string, filePath: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
    const response = await fetch(`${agentUrl.replace(/\/+$/, "")}/read`, { method: "POST", headers, body: JSON.stringify({ root, path: filePath }) });
    const result = (await response.json().catch(() => ({}))) as { exists?: boolean; content?: string };
    if (!response.ok || !result.exists) return null;
    return result.content ?? null;
  } catch {
    return null;
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

function projectTimelineFromMission(mission: MissionState, execution: FactoryProjectResult | null) {
  const activeExecution = activeExecutionMissionFor(mission);
  if (activeExecution?.timeline?.length) return activeExecution.timeline;
  const artifact = mission.createdArtifacts.find((item) => item.title === "Project Execution Timeline");
  if (artifact) {
    try {
      return JSON.parse(artifact.body) as FactoryExecutionEvent[];
    } catch {
      return execution?.timeline ?? [];
    }
  }
  return execution?.timeline ?? [];
}

function activeExecutionMissionFor(mission: MissionState) {
  return (
    mission.executionMissions.find((item) => item.id === mission.activeExecutionMissionId) ??
    mission.executionMissions.at(-1)
  );
}

function executionMissionStateLabel(mission: ExecutionMission) {
  if (mission.state === "complete" && mission.verification_status !== "passed") return "Complete (unverified)";
  return mission.state.replace(/_/g, " ");
}

function MissionStatePill({ mission }: { mission: ExecutionMission }) {
  const isWaiting = mission.state === "waiting_for_approval" || mission.state === "waiting_for_user";
  const isBlocked = mission.state === "blocked" || mission.state === "failed";
  const tone = isWaiting
    ? "border-foundry-amber/30 bg-foundry-amber/[0.08] text-foundry-amber"
    : isBlocked
      ? "border-red-400/30 bg-red-400/[0.08] text-red-200"
      : mission.state === "complete"
        ? "border-foundry-teal/30 bg-foundry-teal/[0.08] text-foundry-teal"
        : "border-foundry-blue/30 bg-foundry-blue/[0.08] text-foundry-blue";
  return (
    <span className={`mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] ${tone}`}>
      {executionMissionStateLabel(mission)}
    </span>
  );
}


function PreviousMissionsPanel({ missions }: { missions: ExecutionMission[] }) {
  return (
    <section className="max-w-4xl rounded-md border border-white/10 bg-black/15">
      <div className="border-b border-white/10 px-3 py-2">
        <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-foundry-subtle">Previous Missions</p>
      </div>
      <div className="grid gap-1 p-2">
        {missions.map((mission) => (
          <details key={mission.id} className="rounded border border-white/5 bg-black/15">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2.5 py-2 text-sm">
              <span className="min-w-0 truncate font-bold text-foundry-ink">{mission.title}</span>
              <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.06em] text-foundry-subtle">{executionMissionStateLabel(mission)}</span>
            </summary>
            <div className="grid gap-2 border-t border-white/10 px-2.5 py-2 text-xs leading-5 text-foundry-muted">
              <DetailRow label="Request" value={mission.source_requirements.join("\n") || mission.title} />
              <DetailRow label="Summary" value={mission.summary || mission.blocked_reason || "No final summary was recorded."} />
              {mission.files_touched.length ? <DetailRow label="Files" value={mission.files_touched.map((file) => `${file.verified ? "verified" : "unverified"} ${file.path}`).join("\n")} /> : null}
              {mission.commands_run.length ? (
                <DetailRow
                  label="Commands"
                  value={mission.commands_run.map((command) => `${command.command} (exit ${command.exitCode ?? "-"}) — ${command.approval_scope_label}`).join("\n")}
                />
              ) : null}
              {mission.verification.length ? <DetailRow label="Verification" value={mission.verification.map((item) => `${item.result}: ${item.evidence}`).join("\n")} /> : null}
              {mission.parent_mission_id ? <DetailRow label="Continues" value={mission.parent_mission_id} /> : null}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function isProjectWorkInProgress(mission: MissionState) {
  const activeExecution = activeExecutionMissionFor(mission);
  if (
    activeExecution &&
    ["understanding", "planning", "executing", "verifying", "waiting_for_user", "waiting_for_approval", "undoing"].includes(activeExecution.state)
  ) {
    return true;
  }
  const result = mission.lastResult.trim();
  if (/^(Factory execution started|Inspecting project|Reading the project|Reading previous project result|Getting started)\.?$/i.test(result)) return true;
  return mission.liveWorkEvents.some((event) => /^(Factory execution started|Inspecting project|Reading the project|Reading previous project result|Routing mission|Getting started|Starting execution)/i.test(event));
}

function compactChangeText(event: FactoryExecutionEvent) {
  const linesAdded = event.details?.linesAdded;
  if (typeof linesAdded === "number" && linesAdded > 0) return `+${linesAdded}`;
  const changed = typeof event.details?.changed === "string" ? event.details.changed : "";
  const delta = changed.match(/(-?\d+)\s+line delta/i)?.[1];
  if (delta) {
    const value = Number(delta);
    if (Number.isFinite(value) && value !== 0) return value > 0 ? `+${value}` : String(value);
  }
  return "";
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

function timelineStyle(status: string) {
  if (status === "completed") return { border: "border-foundry-teal/25", bg: "bg-foundry-teal/[0.055]", dot: "bg-foundry-teal/20 text-foundry-teal", text: "text-foundry-teal", icon: "ok" };
  if (status === "error") return { border: "border-red-400/35", bg: "bg-red-500/[0.08]", dot: "bg-red-500/20 text-red-300", text: "text-red-300", icon: "x" };
  if (status === "running") return { border: "border-foundry-blue/30", bg: "bg-foundry-blue/[0.07]", dot: "bg-foundry-blue/20 text-foundry-blue", text: "text-foundry-blue", icon: "..." };
  if (status === "completed") return { border: "border-foundry-teal/25", bg: "bg-foundry-teal/[0.055]", dot: "bg-foundry-teal/20 text-foundry-teal", text: "text-foundry-teal", icon: "✓" };
  if (status === "warning") return { border: "border-foundry-amber/30", bg: "bg-foundry-amber/[0.08]", dot: "bg-foundry-amber/20 text-foundry-amber", text: "text-foundry-amber", icon: "!" };
  if (status === "error") return { border: "border-red-400/35", bg: "bg-red-500/[0.08]", dot: "bg-red-500/20 text-red-300", text: "text-red-300", icon: "×" };
  return { border: "border-white/10", bg: "bg-white/[0.035]", dot: "bg-white/10 text-foundry-subtle", text: "text-foundry-subtle", icon: "-" };
}

function humanizeKey(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function projectBriefFor(start: ProjectStart) {
  const recommendation = recommendationForStart(start);
  const selectedStack = start.discovery?.recommendedStack || selectedStackFor(start);
  const defaults = recommendation.defaults;
  const projectName = start.projectName || cleanProjectName(start.discovery?.projectType || start.appKind);
  const discovery = start.discovery;
  const answeredQuestions = Object.entries(start.discoveryAnswers)
    .filter(([, answer]) => answer.trim())
    .map(([dimension, answer]) => `${humanizeKey(dimension)}: ${answer.trim()}`);
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
    start.instructions ? `Custom instructions: ${start.instructions}` : answeredQuestions.length ? `Custom instructions: ${answeredQuestions.join("; ")}` : "Custom instructions: None",
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
  ]
    .filter(Boolean)
    .join("\n");
}

function existingProjectBriefFor(start: ExistingProjectStart) {
  const action = existingProjectActions.find((item) => item.id === start.action) ?? existingProjectActions[0];
  const source = existingSourceOptions.find((item) => item.id === start.source) ?? existingSourceOptions[0];
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
    start.description ? `Custom instructions: ${start.description.replace(/\s+/g, " ").trim()}` : "Custom instructions: No additional instructions.",
    start.description ? `Initial requested task: ${start.description.replace(/\s+/g, " ").trim()}` : "Initial requested task: Not described yet.",
    "",
    "Factory status: existing project workspace opened. Foundry should inspect connected project files/evidence before making changes.",
    "Next action: work inside the project workspace to add features, fix bugs, improve UI, analyze architecture, or prepare deployment.",
  ].filter(Boolean).join("\n");
}
