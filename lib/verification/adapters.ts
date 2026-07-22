import type { EcosystemAdapter, ProjectEvidence, VerificationCommand } from "./types";

const names = (evidence: ProjectEvidence) => new Set(evidence.rootEntries.map((entry) => entry.toLowerCase()));
const has = (evidence: ProjectEvidence, name: string) => names(evidence).has(name.toLowerCase());
const endsWith = (evidence: ProjectEvidence, suffix: string) => evidence.rootEntries.some((entry) => entry.toLowerCase().endsWith(suffix));
const command = (id: string, stage: VerificationCommand["stage"], value: string, source: string, required = true, longRunning = false): VerificationCommand => ({ id, stage, command: value, required, source, longRunning });
const dependency = (evidence: ProjectEvidence, name: string) => Boolean(packageJson(evidence)?.dependencies?.[name] || packageJson(evidence)?.devDependencies?.[name]);

function packageJson(evidence: ProjectEvidence) {
  try {
    return JSON.parse(evidence.files["package.json"] || "") as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; packageManager?: string };
  } catch {
    return undefined;
  }
}

function isPlaceholderNodeScript(name: string, value: string) {
  if (name !== "test") return false;
  const normalized = value.toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();
  return /(?:^|&&|;)\s*exit\s+1\b/.test(normalized)
    && /(?:no test specified|no tests? (?:configured|defined|found)|tests? not implemented)/.test(normalized);
}

function rootJavaScriptSyntaxCommands(evidence: ProjectEvidence) {
  return evidence.rootEntries
    // Connector command tokenization deliberately avoids shell evaluation. Quoted arguments would
    // therefore be passed to Node with the quote characters still attached. Restrict this fallback
    // to shell-safe relative paths and pass them unquoted; projects with complex paths should define
    // a real package script instead.
    .filter((entry) => /^(?![./]*$)[a-z0-9_./-]+\.(?:cjs|mjs|js)$/i.test(entry))
    .slice(0, 8)
    .map((entry, index) => command(
      `node-syntax-${index + 1}`,
      "compile",
      `node --check ${entry}`,
      `root JavaScript source: ${entry}`,
    ));
}

function shellQuotedPath(filePath: string) {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}

function dotnetVerificationTarget(evidence: ProjectEvidence) {
  const solutions = evidence.rootEntries.filter((entry) => entry.toLowerCase().endsWith(".sln"));
  const projects = evidence.rootEntries.filter((entry) => entry.toLowerCase().endsWith(".csproj"));
  const candidates = solutions.length ? solutions : projects;
  if (!candidates.length) return undefined;
  const rootNames = new Set(evidence.rootEntries.map((entry) => entry.toLowerCase()));
  return [...candidates].sort((left, right) => {
    const score = (entry: string) => {
      const base = entry.replace(/\.[^.]+$/, "").toLowerCase();
      const content = evidence.files[entry] ?? evidence.files[entry.toLowerCase()] ?? "";
      const referencedProjects = Array.from(content.matchAll(/Project\([^\r\n]+?=\s*"[^"]+"\s*,\s*"([^"]+\.csproj)"/gi)).length;
      return (rootNames.has(base) ? 100 : 0) + referencedProjects * 10 + (content.trim() ? 1 : 0);
    };
    return score(right) - score(left) || left.localeCompare(right);
  })[0];
}

function nodeAdapter(): EcosystemAdapter {
  return {
    id: "node",
    label: "Node.js",
    detect: (evidence) => has(evidence, "package.json") ? 70 : 0,
    buildProfile: (evidence) => {
      const pkg = packageJson(evidence);
      const scripts = pkg?.scripts || {};
      const manager = has(evidence, "pnpm-lock.yaml") ? "pnpm" : has(evidence, "yarn.lock") ? "yarn" : has(evidence, "bun.lockb") || has(evidence, "bun.lock") ? "bun" : "npm";
      const run = (script: string) => manager === "npm" ? `${evidence.platform === "win32" ? "npm.cmd" : "npm"} run ${script}` : `${manager} ${script}`;
      const commands: VerificationCommand[] = [];
      let ignoredPlaceholderTest = false;
      for (const [script, stage] of [["format:check", "format"], ["lint", "lint"], ["typecheck", "typecheck"], ["check", "typecheck"], ["build", "build"], ["test", "unit-test"], ["test:unit", "unit-test"], ["test:integration", "integration-test"], ["test:e2e", "integration-test"]] as const) {
        if (!scripts[script]) continue;
        if (isPlaceholderNodeScript(script, scripts[script])) {
          ignoredPlaceholderTest = true;
          continue;
        }
        commands.push(command(`node-${script.replace(/:/g, "-")}`, stage, run(script), `package.json script: ${script}`));
      }
      if (!commands.length) commands.push(...rootJavaScriptSyntaxCommands(evidence));
      const startScript = scripts.dev ? "dev" : scripts.start ? "start" : undefined;
      return {
        packageManager: manager,
        commands,
        preview: startScript ? { command: run(startScript), expectedUrl: scripts.dev?.includes("3001") ? "http://localhost:3001" : undefined } : undefined,
        limitations: [
          ...(ignoredPlaceholderTest ? ["Ignored the default failing npm test placeholder because it is not real project verification."] : []),
          ...(!commands.length ? ["package.json defines no recognized verification scripts and no root JavaScript source was available for syntax verification."] : []),
        ],
      };
    },
  };
}

const adapters: EcosystemAdapter[] = [
  {
    id: "nextjs", label: "Next.js",
    detect: (evidence) => has(evidence, "next.config.js") || has(evidence, "next.config.mjs") || has(evidence, "next.config.ts") || Boolean(packageJson(evidence)?.dependencies?.next || packageJson(evidence)?.devDependencies?.next) ? 100 : 0,
    buildProfile: (evidence) => nodeAdapter().buildProfile(evidence),
  },
  {
    id: "android-gradle", label: "Android/Gradle",
    detect: (evidence) => (has(evidence, "settings.gradle") || has(evidence, "settings.gradle.kts")) && (has(evidence, "app") || has(evidence, "androidmanifest.xml")) ? 95 : 0,
    buildProfile: (evidence) => {
      const wrapper = evidence.platform === "win32" && has(evidence, "gradlew.bat") ? "gradlew.bat" : has(evidence, "gradlew") ? "./gradlew" : "gradle";
      const source = has(evidence, "gradlew") || has(evidence, "gradlew.bat") ? "Gradle wrapper" : "system Gradle";
      return { commands: [command("android-compile", "compile", `${wrapper} compileDebugKotlin`, source), command("android-lint", "lint", `${wrapper} lintDebug`, source), command("android-unit", "unit-test", `${wrapper} testDebugUnitTest`, source), command("android-build", "build", `${wrapper} assembleDebug`, source)], limitations: ["Instrumentation tests require an available emulator or connected device."] };
    },
  },
  {
    id: "gradle-jvm", label: "Java/Kotlin Gradle",
    detect: (evidence) => (has(evidence, "build.gradle") || has(evidence, "build.gradle.kts")) ? 88 : 0,
    buildProfile: (evidence) => { const gradle = evidence.platform === "win32" && has(evidence, "gradlew.bat") ? "gradlew.bat" : has(evidence, "gradlew") ? "./gradlew" : "gradle"; return { commands: [command("gradle-check", "build", `${gradle} check`, has(evidence, "gradlew") || has(evidence, "gradlew.bat") ? "Gradle wrapper" : "Gradle build"), command("gradle-test", "unit-test", `${gradle} test`, "Gradle build")], limitations: [] }; },
  },
  {
    id: "maven", label: "Java/Maven",
    detect: (evidence) => has(evidence, "pom.xml") ? 90 : 0,
    buildProfile: (evidence) => { const mvn = has(evidence, "mvnw.cmd") && evidence.platform === "win32" ? "mvnw.cmd" : has(evidence, "mvnw") ? "./mvnw" : "mvn"; return { commands: [command("maven-verify", "build", `${mvn} verify`, has(evidence, "mvnw") || has(evidence, "mvnw.cmd") ? "Maven wrapper" : "pom.xml")], limitations: [] }; },
  },
  {
    id: "dotnet", label: ".NET",
    detect: (evidence) => endsWith(evidence, ".sln") || endsWith(evidence, ".csproj") ? 90 : 0,
    buildProfile: (evidence) => {
      const target = dotnetVerificationTarget(evidence);
      const targetArg = target ? ` ${shellQuotedPath(target)}` : "";
      const source = target ? `selected solution/project: ${target}` : "solution/project file";
      return {
        commands: [
          command("dotnet-restore", "dependencies", `dotnet restore${targetArg}`, source),
          command("dotnet-build", "build", `dotnet build${targetArg} --no-restore`, source),
          command("dotnet-test", "unit-test", `dotnet test${targetArg} --no-build`, source, false),
        ],
        limitations: [],
      };
    },
  },
  {
    id: "python", label: "Python",
    detect: (evidence) => has(evidence, "pyproject.toml") || has(evidence, "requirements.txt") || has(evidence, "manage.py") ? 85 : 0,
    buildProfile: (evidence) => { const pyproject = evidence.files["pyproject.toml"] || ""; const commands = [command("python-compile", "compile", "python -m compileall .", "Python project")]; if (/pytest/i.test(pyproject) || has(evidence, "pytest.ini")) commands.push(command("python-test", "unit-test", "python -m pytest -p no:cacheprovider", "pytest configuration")); if (/ruff/i.test(pyproject)) commands.push(command("python-lint", "lint", "python -m ruff check .", "pyproject.toml")); if (/mypy/i.test(pyproject)) commands.push(command("python-types", "typecheck", "python -m mypy .", "pyproject.toml")); if (has(evidence, "manage.py")) commands.push(command("django-check", "configuration", "python manage.py check", "manage.py")); return { commands, limitations: [] }; },
  },
  {
    id: "php-composer", label: "PHP/Composer",
    detect: (evidence) => has(evidence, "composer.json") ? 85 : 0,
    buildProfile: (evidence) => ({ commands: [command("composer-validate", "configuration", "composer validate", "composer.json"), ...(has(evidence, "phpunit.xml") || has(evidence, "phpunit.xml.dist") ? [command("phpunit", "unit-test", "vendor/bin/phpunit", "PHPUnit configuration")] : [])], limitations: [] }),
  },
  { id: "go", label: "Go", detect: (evidence) => has(evidence, "go.mod") ? 85 : 0, buildProfile: () => ({ commands: [command("go-vet", "lint", "go vet ./...", "go.mod"), command("go-test", "unit-test", "go test ./...", "go.mod"), command("go-build", "build", "go build ./...", "go.mod")], limitations: [] }) },
  { id: "rust", label: "Rust", detect: (evidence) => has(evidence, "cargo.toml") ? 85 : 0, buildProfile: () => ({ commands: [command("cargo-format", "format", "cargo fmt --check", "Cargo.toml"), command("cargo-check", "compile", "cargo check", "Cargo.toml"), command("cargo-clippy", "lint", "cargo clippy -- -D warnings", "Cargo.toml"), command("cargo-test", "unit-test", "cargo test", "Cargo.toml"), command("cargo-build", "build", "cargo build", "Cargo.toml")], limitations: [] }) },
  {
    id: "flutter",
    label: "Flutter",
    detect: (evidence) => {
      if (!has(evidence, "pubspec.yaml")) return 0;
      const pubspec = evidence.files["pubspec.yaml"] || "";
      return has(evidence, ".metadata") || /(?:^|\n)\s*flutter\s*:|sdk\s*:\s*flutter\b/i.test(pubspec) ? 85 : 0;
    },
    buildProfile: () => ({ commands: [command("flutter-analyze", "lint", "flutter analyze", "pubspec.yaml"), command("flutter-test", "unit-test", "flutter test", "pubspec.yaml")], limitations: ["Device launch and platform builds depend on locally installed SDK targets."] }),
  },
  { id: "svelte", label: "Svelte/SvelteKit", detect: (evidence) => dependency(evidence, "@sveltejs/kit") || dependency(evidence, "svelte") ? 96 : 0, buildProfile: (evidence) => nodeAdapter().buildProfile(evidence) },
  { id: "nuxt", label: "Nuxt", detect: (evidence) => dependency(evidence, "nuxt") ? 96 : 0, buildProfile: (evidence) => nodeAdapter().buildProfile(evidence) },
  { id: "vue", label: "Vue", detect: (evidence) => dependency(evidence, "vue") ? 92 : 0, buildProfile: (evidence) => nodeAdapter().buildProfile(evidence) },
  { id: "angular", label: "Angular", detect: (evidence) => has(evidence, "angular.json") || dependency(evidence, "@angular/core") ? 96 : 0, buildProfile: (evidence) => nodeAdapter().buildProfile(evidence) },
  { id: "react", label: "React", detect: (evidence) => dependency(evidence, "react") ? 90 : 0, buildProfile: (evidence) => nodeAdapter().buildProfile(evidence) },
  { id: "astro", label: "Astro", detect: (evidence) => dependency(evidence, "astro") ? 94 : 0, buildProfile: (evidence) => nodeAdapter().buildProfile(evidence) },
  { id: "ruby", label: "Ruby", detect: (evidence) => has(evidence, "gemfile") ? 85 : 0, buildProfile: (evidence) => ({ commands: [...(has(evidence, ".rubocop.yml") ? [command("ruby-lint", "lint", "bundle exec rubocop", ".rubocop.yml")] : []), ...(has(evidence, "spec") ? [command("ruby-rspec", "unit-test", "bundle exec rspec", "spec directory")] : [command("ruby-test", "unit-test", "bundle exec rails test", "Gemfile", false)])], limitations: [] }) },
  { id: "swift", label: "Swift Package", detect: (evidence) => has(evidence, "package.swift") ? 85 : 0, buildProfile: () => ({ commands: [command("swift-build", "build", "swift build", "Package.swift"), command("swift-test", "unit-test", "swift test", "Package.swift")], limitations: process.platform === "darwin" ? [] : ["Xcode, iOS simulator, and signing validation require macOS."] }) },
  { id: "cmake", label: "C/C++ CMake", detect: (evidence) => has(evidence, "cmakelists.txt") ? 85 : 0, buildProfile: () => ({ commands: [command("cmake-configure", "configuration", "cmake -S . -B build", "CMakeLists.txt"), command("cmake-build", "build", "cmake --build build", "CMakeLists.txt"), command("cmake-test", "unit-test", "ctest --test-dir build --output-on-failure", "CMakeLists.txt", false)], limitations: [] }) },
  { id: "meson", label: "C/C++ Meson", detect: (evidence) => has(evidence, "meson.build") ? 85 : 0, buildProfile: () => ({ commands: [command("meson-setup", "configuration", "meson setup build", "meson.build"), command("meson-compile", "build", "meson compile -C build", "meson.build"), command("meson-test", "unit-test", "meson test -C build", "meson.build", false)], limitations: [] }) },
  { id: "make", label: "Make", detect: (evidence) => has(evidence, "makefile") ? 65 : 0, buildProfile: () => ({ commands: [command("make-build", "build", "make", "Makefile")], limitations: ["No portable test target can be assumed without inspecting the Makefile."] }) },
  { id: "elixir", label: "Elixir", detect: (evidence) => has(evidence, "mix.exs") ? 85 : 0, buildProfile: () => ({ commands: [command("mix-format", "format", "mix format --check-formatted", "mix.exs"), command("mix-compile", "compile", "mix compile --warnings-as-errors", "mix.exs"), command("mix-test", "unit-test", "mix test", "mix.exs")], limitations: [] }) },
  { id: "scala-sbt", label: "Scala/sbt", detect: (evidence) => has(evidence, "build.sbt") ? 85 : 0, buildProfile: () => ({ commands: [command("sbt-compile", "compile", "sbt compile", "build.sbt"), command("sbt-test", "unit-test", "sbt test", "build.sbt")], limitations: [] }) },
  { id: "dart", label: "Dart", detect: (evidence) => has(evidence, "pubspec.yaml") ? 75 : 0, buildProfile: () => ({ commands: [command("dart-format", "format", "dart format --output=none --set-exit-if-changed .", "pubspec.yaml"), command("dart-analyze", "lint", "dart analyze", "pubspec.yaml"), command("dart-test", "unit-test", "dart test", "pubspec.yaml", false)], limitations: [] }) },
  { id: "r-package", label: "R Package", detect: (evidence) => has(evidence, "description") && has(evidence, "namespace") ? 85 : 0, buildProfile: (evidence) => ({ commands: [command("r-check", "build", `${evidence.platform === "win32" ? "R.exe" : "R"} CMD check .`, "DESCRIPTION")], limitations: [] }) },
  { id: "lua", label: "Lua", detect: (evidence) => has(evidence, ".luacheckrc") || has(evidence, "rockspec") || endsWith(evidence, ".rockspec") ? 75 : 0, buildProfile: (evidence) => ({ commands: [...(has(evidence, ".luacheckrc") ? [command("lua-lint", "lint", "luacheck .", ".luacheckrc")] : []), command("lua-test", "unit-test", "busted", "Lua project", false)], limitations: [] }) },
  { id: "powershell", label: "PowerShell", detect: (evidence) => endsWith(evidence, ".psd1") || endsWith(evidence, ".psm1") ? 75 : 0, buildProfile: () => ({ commands: [command("powershell-analyze", "lint", "pwsh -NoProfile -Command Invoke-ScriptAnalyzer -Path . -Recurse", "PowerShell module")], limitations: ["PSScriptAnalyzer must be installed in the local PowerShell environment."] }) },
  { id: "shell", label: "Shell", detect: (evidence) => endsWith(evidence, ".sh") ? 55 : 0, buildProfile: () => ({ commands: [command("shellcheck", "lint", "shellcheck **/*.sh", "shell scripts")], limitations: ["shellcheck and shell glob support must be available locally."] }) },
  { id: "docker", label: "Docker", detect: (evidence) => has(evidence, "dockerfile") || has(evidence, "docker-compose.yml") || has(evidence, "docker-compose.yaml") ? 90 : 0, buildProfile: (evidence) => ({ commands: [command("docker-build", "build", "docker build -t foundry-validation .", "Dockerfile"), ...(has(evidence, "docker-compose.yml") || has(evidence, "docker-compose.yaml") ? [command("docker-compose-config", "configuration", "docker compose config --quiet", "Compose file")] : [])], limitations: ["Container startup validation requires a running local Docker engine."] }) },
  { id: "terraform", label: "Terraform", detect: (evidence) => evidence.rootEntries.some((entry) => entry.toLowerCase().endsWith(".tf")) ? 90 : 0, buildProfile: () => ({ commands: [command("terraform-format", "format", "terraform fmt -check -recursive", "Terraform files"), command("terraform-validate", "configuration", "terraform validate", "Terraform files", false)], limitations: ["Provider-backed plan/apply validation requires initialized providers and credentials; Foundry never applies infrastructure automatically."] }) },
  { id: "kubernetes", label: "Kubernetes", detect: (evidence) => has(evidence, "k8s") || has(evidence, "kubernetes") || has(evidence, "helm") || has(evidence, "chart.yaml") ? 88 : 0, buildProfile: (evidence) => ({ commands: has(evidence, "chart.yaml") ? [command("helm-lint", "lint", "helm lint .", "Chart.yaml")] : [], limitations: ["Cluster admission and rollout verification require an explicitly configured Kubernetes context; Foundry does not deploy automatically."] }) },
  { id: "godot", label: "Godot", detect: (evidence) => has(evidence, "project.godot") ? 92 : 0, buildProfile: () => ({ commands: [command("godot-parse", "compile", "godot --headless --editor --path . --quit", "project.godot", false)], limitations: ["Playable validation requires the Godot executable and platform display/input support."] }) },
  { id: "unity", label: "Unity", detect: (evidence) => has(evidence, "assets") && has(evidence, "projectsettings") ? 92 : 0, buildProfile: () => ({ commands: [], limitations: ["Unity batch compilation and play-mode tests require a locally installed, licensed Unity Editor whose executable path is configured."] }) },
  { id: "sql", label: "SQL/Database", detect: (evidence) => evidence.rootEntries.some((entry) => entry.toLowerCase().endsWith(".sql")) || has(evidence, "migrations") ? 80 : 0, buildProfile: () => ({ commands: [], limitations: ["Dialect-aware execution requires an explicit database engine and disposable connection; Foundry verifies SQL source and migration structure without applying it to unknown data."] }) },
  { id: "static-web", label: "Static HTML/CSS/JavaScript", detect: (evidence) => endsWith(evidence, ".html") ? 60 : 0, buildProfile: () => ({ commands: [], limitations: ["No configured compiler or test runner was detected; use static preview and browser validation."] }) },
  nodeAdapter(),
];

export function registeredEcosystemAdapters(): readonly EcosystemAdapter[] {
  return adapters;
}
