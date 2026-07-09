import type { FactoryObjectiveChecklistItem } from "@/lib/factory/types";

/**
 * Level 1 — Inspect/Explain: read and describe the code, propose changes as diffs, but never edit or run anything.
 * Level 2 — Safe Edits: edit files directly (with approval per the approval system) and verify via file
 *   read-back, but cannot run this stack's build/test/lint tooling in-session.
 * Level 3 — Run Build/Test: edit files AND execute the stack's build/test/lint commands in-session, with real
 *   output streamed back — but not yet multi-phase mission planning, checkpointing, or undo for this stack.
 * Level 4 — Full Mission Support: everything in 1-3, plus multi-phase mission planning, checkpointing, and
 *   undo across the full Mission Contract.
 */
export type StackCapabilityLevel = 1 | 2 | 3 | 4;

export type StackProfile = {
  id: string;
  label: string;
  level: StackCapabilityLevel;
};

type PackageJsonProbe = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

function hasDependency(pkg: PackageJsonProbe | undefined, name: string): boolean {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function safeParsePackageJson(content: string | undefined): PackageJsonProbe | undefined {
  if (!content) return undefined;
  try {
    return JSON.parse(content) as PackageJsonProbe;
  } catch {
    return undefined;
  }
}

export type StackDetectionInput = {
  /** File/directory names at the project root — a non-recursive listing is enough. */
  rootEntries: string[];
  /** Raw contents of a root-level package.json, when present, for JS framework sub-detection. */
  packageJsonContent?: string;
  /** Raw contents of a root-level pom.xml/build.gradle(.kts), when present, for a light Spring Boot check. */
  javaBuildFileContent?: string;
  /** Raw contents of a root-level .csproj/.sln-referenced project file, when present, to tell an ASP.NET Web API apart from a WinForms/WPF desktop app. */
  dotnetProjectFileContent?: string;
};

function isDotnetDesktopProject(content: string | undefined): boolean {
  if (!content) return false;
  return /<UseWindowsForms>\s*true\s*<\/UseWindowsForms>|<UseWPF>\s*true\s*<\/UseWPF>/i.test(content);
}

/**
 * Detects the project's stack and the capability level Foundry currently supports for it. Never assume web/JS
 * by default — fall through every category before giving up.
 *
 * Target levels (concrete, not vague — see Section 17):
 * Level 4 (full mission support): HTML/CSS/JS, React, Next.js, Vue, Node, Python
 * Level 3 (edit + run build/test in-session, no multi-phase mission/checkpointing/undo yet): Angular, PHP,
 *   .NET Web API, Java/Spring, Go, Rust
 * Level 2 (safe edits + verified read-back, no commands): .NET WinForms/WPF, Android, Flutter, React Native,
 *   Electron, Tauri, SQL, Docker
 * Level 1 (inspect/explain only): Unity, Godot, Kubernetes, Terraform
 */
export function detectStackProfile(input: StackDetectionInput): StackProfile {
  const names = input.rootEntries.map((name) => name.toLowerCase());
  const has = (name: string) => names.includes(name.toLowerCase());
  const endsWith = (suffix: string) => names.some((name) => name.endsWith(suffix.toLowerCase()));
  const pkg = safeParsePackageJson(input.packageJsonContent);

  // Web
  if (has("next.config.js") || has("next.config.mjs") || has("next.config.ts") || hasDependency(pkg, "next")) {
    return { id: "nextjs", label: "Next.js", level: 4 };
  }
  if (hasDependency(pkg, "react-native")) return { id: "react-native", label: "React Native", level: 2 };
  if (hasDependency(pkg, "electron")) return { id: "electron", label: "Electron", level: 2 };
  if (has("tauri.conf.json") || has("src-tauri")) return { id: "tauri", label: "Tauri", level: 2 };
  if (has("angular.json")) return { id: "angular", label: "Angular", level: 3 };
  if (has("vue.config.js") || has("vue.config.ts") || hasDependency(pkg, "vue")) return { id: "vue", label: "Vue", level: 4 };
  if (hasDependency(pkg, "react")) return { id: "react", label: "React", level: 4 };
  if (hasDependency(pkg, "express")) return { id: "node-express", label: "Node/Express", level: 4 };
  if (pkg) return { id: "node", label: "Node.js", level: 4 };

  // Mobile / desktop native
  if (has("pubspec.yaml")) return { id: "flutter", label: "Flutter", level: 2 };
  if (has("androidmanifest.xml")) return { id: "android", label: "Android (Java/Kotlin)", level: 2 };
  if (endsWith(".sln") || endsWith(".csproj")) {
    const isDesktop = isDotnetDesktopProject(input.dotnetProjectFileContent);
    return isDesktop
      ? { id: "dotnet-desktop", label: /wpf/i.test(input.dotnetProjectFileContent ?? "") ? ".NET WPF" : ".NET WinForms", level: 2 }
      : { id: "dotnet-web", label: ".NET Web API", level: 3 };
  }

  // Backend
  if (has("composer.json") || has("artisan")) return { id: "php", label: has("artisan") ? "PHP/Laravel" : "PHP", level: 3 };
  if (has("pom.xml") || endsWith("build.gradle") || endsWith("build.gradle.kts")) {
    const isSpring = /spring-boot/i.test(input.javaBuildFileContent ?? "");
    return { id: "java", label: isSpring ? "Java/Spring" : "Java", level: isSpring ? 3 : 2 };
  }
  if (has("requirements.txt") || has("pyproject.toml") || has("manage.py")) {
    return { id: "python", label: has("manage.py") ? "Python/Django" : "Python", level: 4 };
  }
  if (has("gemfile")) return { id: "ruby", label: "Ruby/Rails", level: 1 };
  if (has("go.mod")) return { id: "go", label: "Go", level: 3 };
  if (has("cargo.toml")) return { id: "rust", label: "Rust", level: 3 };

  // Other
  if (has("project.godot")) return { id: "godot", label: "Godot", level: 1 };
  if (has("assets") && has("projectsettings")) return { id: "unity", label: "Unity", level: 1 };
  if (has("k8s") || has("kubernetes") || has("helm")) return { id: "kubernetes", label: "Kubernetes", level: 1 };
  if (has("dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml")) return { id: "docker", label: "Docker", level: 2 };
  if (names.some((name) => name.endsWith(".tf"))) return { id: "terraform", label: "Terraform", level: 1 };
  if (names.some((name) => name.endsWith(".sql")) || has("migrations")) return { id: "sql", label: "SQL/database project", level: 2 };
  if (names.some((name) => name.endsWith(".html") || name.endsWith(".htm"))) return { id: "static-html", label: "Static HTML/CSS/JS", level: 4 };

  return { id: "unknown", label: "Unknown project", level: 1 };
}

export function unsupportedEditingMessage(stack: StackProfile): string {
  return `I can inspect and explain this project, but full automated editing/build support for ${stack.label} is not enabled yet.`;
}

export function unsupportedCreationMessage(stack: StackProfile): string {
  return `I can't fully scaffold a new ${stack.label} project yet — full automated creation support for this stack is not enabled yet (current support level: ${stack.level}). Tell me what the project should do and I can describe the file structure and starting code you'd need instead.`;
}

/** Maps a stack name the user explicitly chose in the new-project wizard (e.g. "Next.js", "Python/FastAPI") to its capability level. Unlike detectStackProfile, this has no files to inspect — it classifies the choice itself. */
export function capabilityLevelForStackChoice(stackName: string): StackProfile {
  const name = (stackName || "").toLowerCase();
  if (/next\.?js/.test(name)) return { id: "nextjs", label: "Next.js", level: 4 };
  if (/node\s*\/?\s*express|node\.js|express/.test(name)) return { id: "node-express", label: "Node/Express", level: 4 };
  if (/html\s*\/\s*css\s*\/\s*js|static/.test(name)) return { id: "static-html", label: "Static HTML/CSS/JS", level: 4 };
  if (/phaser/.test(name)) return { id: "phaser", label: "Phaser (web game)", level: 4 };
  if (/react\s*native/.test(name)) return { id: "react-native", label: "React Native", level: 2 };
  if (/react/.test(name)) return { id: "react", label: "React", level: 4 };
  if (/vue/.test(name)) return { id: "vue", label: "Vue", level: 4 };
  if (/angular/.test(name)) return { id: "angular", label: "Angular", level: 3 };
  if (/android/.test(name)) return { id: "android", label: /kotlin/.test(name) ? "Android (Kotlin)" : "Android (Java)", level: 2 };
  if (/flutter/.test(name)) return { id: "flutter", label: "Flutter", level: 2 };
  if (/web\s*api|asp\.?net/.test(name)) return { id: "dotnet-web", label: ".NET Web API", level: 3 };
  if (/wpf/.test(name)) return { id: "dotnet-desktop", label: ".NET WPF", level: 2 };
  if (/winforms/.test(name)) return { id: "dotnet-desktop", label: ".NET WinForms", level: 2 };
  if (/\.net|dotnet/.test(name)) return { id: "dotnet-desktop", label: ".NET", level: 2 };
  if (/fastapi|django|python/.test(name)) return { id: "python", label: "Python", level: 4 };
  if (/laravel|php/.test(name)) return { id: "php", label: "PHP/Laravel", level: 3 };
  if (/spring/.test(name)) return { id: "java", label: "Java/Spring", level: 3 };
  if (/java\b/.test(name)) return { id: "java", label: "Java", level: 2 };
  if (/electron/.test(name)) return { id: "electron", label: "Electron", level: 2 };
  if (/tauri/.test(name)) return { id: "tauri", label: "Tauri", level: 2 };
  if (/docker/.test(name)) return { id: "docker", label: "Docker", level: 2 };
  if (/\bsql\b|database/.test(name)) return { id: "sql", label: "SQL/database project", level: 2 };
  if (/unity/.test(name)) return { id: "unity", label: "Unity", level: 1 };
  if (/godot/.test(name)) return { id: "godot", label: "Godot", level: 1 };
  if (/kubernetes|k8s/.test(name)) return { id: "kubernetes", label: "Kubernetes", level: 1 };
  if (/terraform/.test(name)) return { id: "terraform", label: "Terraform", level: 1 };
  if (/rust/.test(name)) return { id: "rust", label: "Rust", level: 3 };
  if (/^go$|golang/.test(name)) return { id: "go", label: "Go", level: 3 };
  return { id: "custom", label: stackName?.trim() || "Custom", level: 1 };
}

const bigScopePattern = /\b(refactor|restructure|redesign|migrate|migration|architecture|rewrite|overhaul|multiple files|several files|every page|all pages|throughout|entire (project|app|codebase)|new feature|from scratch)\b/i;
// Adding a new external dependency always carries unverified-runtime risk (does it actually resolve/install?)
// disproportionate to how small the edit otherwise looks — never fast-lane past that, regardless of file count.
const newDependencyPattern =
  /\b(npm|pip|pypi|nuget|composer|cargo|gem)\s+(?:i|install|add)\b|\b(?:use|add|install|bring in|pull in)\b[^.?!\n]{0,40}\b(?:npm |python |pip )?(?:package|library|module|dependency|gem|crate)\b/i;
const smallTweakPattern =
  /\b(typo|rename|color|colour|gray|grey|background|button|label|title|padding|margin|font|border|border-radius|shadow|size|width|height|position|align|spacing|one line|tweak|swap|toggle|hover|disabled state)\b/i;
const recognizedFileExtensions = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss", "sass", "less", "html", "htm", "json", "py", "rb", "php",
  "java", "kt", "kts", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "go", "rs", "vue", "svelte", "md", "mdx", "yml",
  "yaml", "xml", "sql", "sh", "bash", "env", "toml", "ini", "gradle", "dart", "m", "mm",
]);

export function isLikelySmallSingleFileRequest(task: string): boolean {
  const text = task.trim();
  if (!text || text.length > 200) return false;
  if (bigScopePattern.test(text)) return false;
  if (newDependencyPattern.test(text)) return false;
  const candidates = text.match(/\b[\w./-]+\.[a-zA-Z0-9]{1,12}\b/g) ?? [];
  const filePaths = new Set(
    candidates
      .filter((candidate) => recognizedFileExtensions.has(candidate.split(".").pop()?.toLowerCase() ?? ""))
      .map((candidate) => candidate.toLowerCase()),
  );
  if (filePaths.size > 1) return false;
  if ((text.toLowerCase().match(/\b(and|then)\b/g) ?? []).length >= 2) return false;
  return filePaths.size === 1 || smallTweakPattern.test(text);
}

// "Start my server", "run the build", "run the tests" name one concrete operational action with an
// obvious, directly-verifiable outcome — no multi-phase plan is needed for these, same as a small edit.
const tinyOperationalPattern =
  /\b(start|restart|stop|run|launch)\b[^.?!\n]{0,30}\b(server|dev server|the app|the application|build|the build|tests?|the tests|lint|linter|typecheck)\b/i;

export function isLikelyTinyOperationalRequest(task: string): boolean {
  const text = task.trim();
  if (!text || text.length > 150) return false;
  if (bigScopePattern.test(text)) return false;
  if (newDependencyPattern.test(text)) return false;
  if ((text.toLowerCase().match(/\b(and|then)\b/g) ?? []).length >= 2) return false;
  return tinyOperationalPattern.test(text);
}

export function checklistForRequest(task: string, sourceModeLabel: string): FactoryObjectiveChecklistItem[] {
  const text = task.toLowerCase();
  const isStaticAssetGoal = wantsAssetSeparation(text) && (/\b(css|style|styling)\b/.test(text) || /\b(js|javascript|script)\b/.test(text));
  const isStyleGoal = isStylingRequest(text);
  const isExactFileOperation = /(?:^|\s)([\w./-]+\.[a-z0-9]{1,12})(?:\s|$|[.,;:!?])/i.test(task) && (/(?:```[\s\S]*?```)/.test(task) || /\b(?:content|with contents?|write)\s*:/i.test(task));
  const items: FactoryObjectiveChecklistItem[] = [
    { id: "understand-goal", label: `Complete goal: ${task.trim() || "project request"}`, status: "running" },
    { id: "read-project", label: "Read the actual project files before editing", status: "pending" },
    { id: "locate-relevant-files", label: "Identify relevant files for the requested stack and goal", status: "pending" },
  ];
  if (isDynamicFieldConfigurationRequest(text)) {
    items.push(
      { id: "inspect-current-ux", label: "Inspect the current field UI and styling before changing it", status: "pending" },
      { id: "persist-field-config", label: "Persist editable fields in a config file instead of backend code", status: "pending" },
      { id: "server-dynamic-fields", label: "Server reads saved field configuration for transaction/upload mapping", status: "pending" },
      { id: "field-manager-ui", label: "Polished UI lets users add, edit, require, and remove fields", status: "pending" },
      { id: "frontend-dynamic-form", label: "Frontend test form is generated from saved field configuration", status: "pending" },
      { id: "field-config-verified", label: "Re-read changed files and verify the dynamic field behavior path", status: "pending" },
    );
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
  if (isStyleGoal) {
    items.push({ id: "styling-improved", label: "Styling improved without replacing the project blindly", status: "pending" });
  }
  if (/\b(fix|bug|error|crash|broken|failing|issue|exception|trace|stack)\b/.test(text)) {
    items.push({ id: "bugfix-verified", label: "Bug fix verified with project-appropriate evidence", status: "pending" });
  }
  if (!isStaticAssetGoal && !isStyleGoal && !isExactFileOperation && /\b(add|create|implement|feature|support|allow|enable)\b/.test(text)) {
    items.push({ id: "feature-verified", label: "Requested feature implemented and verified", status: "pending" });
  }
  if (/\b(refactor|clean|simplify|restructure|organize|architecture)\b/.test(text)) {
    items.push({ id: "refactor-verified", label: "Refactor completed without changing intended behavior", status: "pending" });
  }
  items.push(
    { id: "references-checked", label: "References checked after edits", status: "pending" },
    { id: "files-on-disk", label: `Verify changed files in ${sourceModeLabel}`, status: "pending" },
    { id: "final-result", label: "Summarize completion against the original request", status: "pending" },
  );
  return dedupeChecklist(items);
}

function isDynamicFieldConfigurationRequest(text: string) {
  return /\b(fields?|columns?|excel|spreadsheet|upload|mapping|transaction|tx|payload)\b/.test(text) &&
    /\b(dynamic|config|configuration|frontend|ui|edit|add|remove|required|optional|hardcoded|hard-coded|server\.js)\b/.test(text);
}

function wantsAssetSeparation(text: string) {
  return /\b(separate|seperate|saparate|split|extract|move)\b/.test(text) || /\bseparat(?:e|ed|ing)?\s+files?\b/.test(text);
}

function isStylingRequest(text: string) {
  return /\b(style|styling|design|nicer|modern|polish|beautiful|responsive|mobile|ux|ui|form|bordered|color|colour|background|bg|green|red|blue|yellow|orange|purple|pink|black|white|gray|grey|button|buttons|input|inputs|header|heading|title|label|labels|cursor|pointer|hand|hover|clickable|rounded|radius|shadow|spacing|padding|margin|font|size)\b/.test(text);
}

function dedupeChecklist(items: FactoryObjectiveChecklistItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
