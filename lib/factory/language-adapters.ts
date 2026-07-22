import type { FactoryObjectiveChecklistItem } from "@/lib/factory/types";

/**
 * Compatibility value retained for persisted briefs and badges. Every recognized/custom stack now enters
 * Level 4's full mission workflow. Runtime/toolchain availability is represented separately by detected
 * verification profiles and skipped evidence—not by disabling planning, edits, history, or undo.
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
 * All detected ecosystems receive the full mission workflow. Whether compilation, device launch, engine
 * validation, database execution, or infrastructure validation can run is discovered from the actual project
 * and local environment and reported as passed/failed/skipped evidence.
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
  if (has("astro.config.js") || has("astro.config.mjs") || has("astro.config.ts") || hasDependency(pkg, "astro")) {
    return { id: "astro", label: "Astro", level: 4 };
  }
  if (hasDependency(pkg, "react-native")) return { id: "react-native", label: "React Native", level: 4 };
  if (hasDependency(pkg, "electron")) return { id: "electron", label: "Electron", level: 4 };
  if (has("tauri.conf.json") || has("src-tauri")) return { id: "tauri", label: "Tauri", level: 4 };
  if (has("angular.json")) return { id: "angular", label: "Angular", level: 4 };
  if (has("vue.config.js") || has("vue.config.ts") || hasDependency(pkg, "vue")) return { id: "vue", label: "Vue", level: 4 };
  if (hasDependency(pkg, "react")) return { id: "react", label: "React", level: 4 };
  if (hasDependency(pkg, "express")) return { id: "node-express", label: "Node/Express", level: 4 };
  if (pkg) return { id: "node", label: "Node.js", level: 4 };

  // Mobile / desktop native
  if (has("pubspec.yaml")) return { id: "flutter", label: "Flutter", level: 4 };
  if (has("androidmanifest.xml")) return { id: "android", label: "Android (Java/Kotlin)", level: 4 };
  if (endsWith(".sln") || endsWith(".csproj")) {
    const isDesktop = isDotnetDesktopProject(input.dotnetProjectFileContent);
    return isDesktop
      ? { id: "dotnet-desktop", label: /wpf/i.test(input.dotnetProjectFileContent ?? "") ? ".NET WPF" : ".NET WinForms", level: 4 }
      : { id: "dotnet-web", label: ".NET Web API", level: 4 };
  }

  // Backend
  if (has("composer.json") || has("artisan")) return { id: "php", label: has("artisan") ? "PHP/Laravel" : "PHP", level: 4 };
  if (has("pom.xml") || endsWith("build.gradle") || endsWith("build.gradle.kts")) {
    const isSpring = /spring-boot/i.test(input.javaBuildFileContent ?? "");
    return { id: "java", label: isSpring ? "Java/Spring" : "Java", level: 4 };
  }
  if (has("requirements.txt") || has("pyproject.toml") || has("manage.py")) {
    return { id: "python", label: has("manage.py") ? "Python/Django" : "Python", level: 4 };
  }
  if (has("gemfile")) return { id: "ruby", label: "Ruby/Rails", level: 4 };
  if (has("go.mod")) return { id: "go", label: "Go", level: 4 };
  if (has("cargo.toml")) return { id: "rust", label: "Rust", level: 4 };

  // Other
  if (has("project.godot")) return { id: "godot", label: "Godot", level: 4 };
  if (has("assets") && has("projectsettings")) return { id: "unity", label: "Unity", level: 4 };
  if (has("k8s") || has("kubernetes") || has("helm")) return { id: "kubernetes", label: "Kubernetes", level: 4 };
  if (has("dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml")) return { id: "docker", label: "Docker", level: 4 };
  if (names.some((name) => name.endsWith(".tf"))) return { id: "terraform", label: "Terraform", level: 4 };
  if (names.some((name) => name.endsWith(".sql")) || has("migrations")) return { id: "sql", label: "SQL/database project", level: 4 };
  if (names.some((name) => name.endsWith(".html") || name.endsWith(".htm"))) return { id: "static-html", label: "Static HTML/CSS/JS", level: 4 };

  return { id: "unknown", label: "Custom project", level: 4 };
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
  if (/\bastro\b/.test(name)) return { id: "astro", label: "Astro", level: 4 };
  if (/next\.?js/.test(name)) return { id: "nextjs", label: "Next.js", level: 4 };
  if (/node\s*\/?\s*express|node\.js|express/.test(name)) return { id: "node-express", label: "Node/Express", level: 4 };
  if (/html\s*(?:\/|\+|,|and)\s*css(?:\s*(?:\/|\+|,|and)\s*(?:vanilla\s*)?(?:java\s*script|javascript|js))?|vanilla\s*(?:java\s*script|javascript|js)|static\s*(?:html|site|website)/.test(name)) return { id: "static-html", label: "Static HTML/CSS/JS", level: 4 };
  if (/phaser/.test(name)) return { id: "phaser", label: "Phaser (web game)", level: 4 };
  if (/react\s*native/.test(name)) return { id: "react-native", label: "React Native", level: 4 };
  if (/react/.test(name)) return { id: "react", label: "React", level: 4 };
  if (/vue/.test(name)) return { id: "vue", label: "Vue", level: 4 };
  if (/angular/.test(name)) return { id: "angular", label: "Angular", level: 4 };
  if (/android|jetpack\s+compose|kotlin[^\n]{0,80}\b(?:room|native vendor sdk|device sdk)\b/.test(name)) return { id: "android", label: /kotlin|jetpack/.test(name) ? "Android (Kotlin)" : "Android (Java)", level: 4 };
  if (/flutter/.test(name)) return { id: "flutter", label: "Flutter", level: 4 };
  if (/web\s*api|asp\.?net/.test(name)) return { id: "dotnet-web", label: ".NET Web API", level: 4 };
  if (/wpf/.test(name)) return { id: "dotnet-desktop", label: ".NET WPF", level: 4 };
  if (/winforms/.test(name)) return { id: "dotnet-desktop", label: ".NET WinForms", level: 4 };
  if (/\.net|dotnet/.test(name)) return { id: "dotnet-desktop", label: ".NET", level: 4 };
  if (/fastapi|django|python/.test(name)) return { id: "python", label: "Python", level: 4 };
  if (/laravel|php/.test(name)) return { id: "php", label: "PHP/Laravel", level: 4 };
  if (/spring/.test(name)) return { id: "java", label: "Java/Spring", level: 4 };
  if (/java\b/.test(name)) return { id: "java", label: "Java", level: 4 };
  if (/electron/.test(name)) return { id: "electron", label: "Electron", level: 4 };
  if (/tauri/.test(name)) return { id: "tauri", label: "Tauri", level: 4 };
  if (/docker/.test(name)) return { id: "docker", label: "Docker", level: 4 };
  if (/\bsql\b|database/.test(name)) return { id: "sql", label: "SQL/database project", level: 4 };
  if (/unity/.test(name)) return { id: "unity", label: "Unity", level: 4 };
  if (/godot/.test(name)) return { id: "godot", label: "Godot", level: 4 };
  if (/kubernetes|k8s/.test(name)) return { id: "kubernetes", label: "Kubernetes", level: 4 };
  if (/terraform/.test(name)) return { id: "terraform", label: "Terraform", level: 4 };
  if (/rust/.test(name)) return { id: "rust", label: "Rust", level: 4 };
  if (/^go$|golang/.test(name)) return { id: "go", label: "Go", level: 4 };
  return { id: "custom", label: stackName?.trim() || "Custom", level: 4 };
}

const bigScopePattern = /\b(refactor|restructure|redesign|migrate|migration|architecture|rewrite|overhaul|multiple files|several files|every page|all pages|throughout|entire (project|app|codebase)|new feature|from scratch)\b/i;
// Adding a new external dependency always carries unverified-runtime risk (does it actually resolve/install?)
// disproportionate to how small the edit otherwise looks — never fast-lane past that, regardless of file count.
const newDependencyPattern =
  /\b(npm|pip|pypi|nuget|composer|cargo|gem)\s+(?:i|install|add)\b|\b(?:use|add|install|bring in|pull in)\b[^.?!\n]{0,40}\b(?:npm |python |pip )?(?:package|library|module|dependency|gem|crate)\b/i;
const smallTweakPattern =
  /\b(typo|rename|color|colour|gray|grey|background|button|label|title|padding|margin|font|border|border-radius|shadow|size|width|height|position|align|spacing|one line|tweak|swap|toggle|hover|disabled state)\b/i;
// Moving an existing element is one of the most common trivial layout edits, and the vocabulary above
// already covers its siblings ("position", "align", "spacing") — its absence was an oversight that
// escalated one-line moves to the architect tier and cost ~$0.89 for a single reposition. Both a
// reposition verb *and* a positional target are required, so "move the database to Postgres" (a real
// migration with no positional word) is still treated as full-scope work.
const repositionPattern =
  /\b(?:move|reposition|reorder|relocate|place|put|shift|drag)\b[^.?!\n]{0,60}\b(?:above|below|under|underneath|beneath|over|on top|top|bottom|left|right|center|centre|before|after|next to|beside|alongside|inside|within|first|last|header|footer|sidebar|navbar|nav bar|toolbar)\b/i;
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
  return filePaths.size === 1 || smallTweakPattern.test(text) || repositionPattern.test(text);
}

/**
 * Relocating existing markup is small in *scope* but not small in *difficulty*: it requires removing a
 * block from one parent and reinserting it under another, and a half-applied move silently deletes
 * working UI. Observed on the weakest tier — asked to move a total above the filter bar, the model
 * deleted the total and never re-added it, while typecheck, build and preview all stayed green.
 *
 * Callers should keep these on the bounded small-edit budget but refuse to run them on the cheapest
 * model. Budget reflects how much work there is; tier reflects how easy it is to get wrong.
 */
export function isStructuralRelocationRequest(task: string): boolean {
  const text = task.trim();
  if (!text || text.length > 200) return false;
  return repositionPattern.test(text);
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
  return /\b(dynamic|configurable|configured|configuration|hardcoded|hard-coded)\b[^.\n]{0,60}\b(fields?|columns?|mapping)\b/.test(text) ||
    /\b(add|edit|remove|required|optional)\b[^.\n]{0,40}\b(fields?|columns?)\b/.test(text) ||
    /\b(excel|spreadsheet|upload|payload)\b[^.\n]{0,60}\b(field|column|mapping|schema)\b/.test(text);
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
