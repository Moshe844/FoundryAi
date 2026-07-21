export type CommandPermissionCategory =
  | "dependencies"
  | "package-runner"
  | "git"
  | "infra"
  | "deploy"
  | "database"
  | "shell-mutation"
  | "environment-changes"
  | "deletes"
  | "unrecognized";

export type CommandPermissionDecision = {
  allowed: boolean;
  status?: "permission-required" | "destructive";
  reason?: string;
  category?: CommandPermissionCategory;
};

/** How a command that needed approval was actually authorized to run. Deliberately narrow: exact-command matches only the literal normalized command text, in this project only — it never widens to other installs, deletes, pushes, or shell mutations. Absent entirely when the command never needed approval in the first place. */
export type CommandApprovalScope =
  | { kind: "one-time" }
  | { kind: "exact-command"; command: string }
  | { kind: "category"; category: CommandPermissionCategory };

/** Plain-language description of what was actually granted, shown identically wherever an approved command is rendered (live timeline, history panel). This is the one place that wording is decided. */
export function approvalScopeLabel(scope?: CommandApprovalScope): string {
  if (!scope) return "Ran without approval — already safe.";
  if (scope.kind === "one-time") return "Approved once.";
  if (scope.kind === "exact-command") return `Always allowed: exact command \`${scope.command}\`, this project only.`;
  return `Always allowed: ${scope.category} commands, this project only.`;
}

const DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
  /\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0\b/i,
  /\brm\s+-rf\s+(\/|~|\.\s*$)/i,
  /\brd\s+\/s\s+\/q\s+[a-z]:\\?\s*$/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bgit\s+push\s+.*--force/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-fdx/i,
  /\bsudo\b/i,
  /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sh|bash|iex|invoke-expression)\b/i,
];

const PERMISSION_REQUIRED_PATTERNS: Array<{ pattern: RegExp; reason: string; category: CommandPermissionCategory }> = [
  { pattern: /\b(npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:ci|i|install|add|remove|uninstall|upgrade|update)\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(pip|pip3|python\s+-m\s+pip|py\s+-m\s+pip|uv|poetry|pipenv)(?:\.exe)?\s+(?:install|add|remove|uninstall|update|upgrade)\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(dotnet)\s+(?:add|remove)\s+package\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(cargo)\s+(?:add|remove|rm|install|update)\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(flutter)\s+pub\s+(?:add|remove|upgrade|downgrade)\b/i, reason: "Dependency changes need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(gradle|gradlew|mvn|mvnw)(?:\.cmd)?\b.*\b(?:dependency|dependencies|wrapper|publish|deploy)\b/i, reason: "Build-tool dependency or publication commands need approval before modifying the project environment.", category: "dependencies" },
  { pattern: /\b(npx|pnpm\s+dlx|yarn\s+dlx|bunx)(?:\.cmd)?\b/i, reason: "Downloading or running a package executable needs approval.", category: "package-runner" },
  { pattern: /\b(git\s+(?:push|pull|fetch|merge|rebase|commit|tag|checkout|switch|branch|restore|reset|clean|stash))\b/i, reason: "Git history or remote operations need approval.", category: "git" },
  { pattern: /\b(docker|docker-compose|podman|kubectl|helm|terraform|pulumi)\b/i, reason: "Infrastructure and container commands need approval.", category: "infra" },
  { pattern: /\b(vercel|netlify|firebase|wrangler|flyctl|railway|render)\b/i, reason: "Deploy commands need approval.", category: "deploy" },
  { pattern: /\b(prisma|drizzle|sequelize|typeorm|knex|alembic|rails)\b.*\b(migrate|db:|database|schema)\b/i, reason: "Database schema or data commands need approval.", category: "database" },
  { pattern: /\b(powershell|pwsh|bash|sh|cmd)\b.*\b(remove-item|del|erase|rmdir|rm|mv|move|copy-item|set-content|add-content)\b/i, reason: "Shell file mutation commands need approval.", category: "shell-mutation" },
];

const SAFE_COMMAND_PATTERNS: RegExp[] = [
  // Pure directory listings are inspection. Anchor the whole command so a chained mutation cannot
  // inherit this allowance (e.g. `dir & del ...` must still require approval).
  /^\s*(?:dir(?:\s+\/[a-z]+)*(?:\s+[^&|;<>]+)?|ls(?:\s+-[a-z]+)*(?:\s+[^&|;<>]+)?|Get-ChildItem(?:\s+[^&|;<>]+)?)\s*$/i,
  /\b(npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:build|test|lint|typecheck|check|dev|start|preview)\b/i,
  /\b(node|python|python3|py|ruby|php|java|go|cargo|dotnet|mvn|gradle|pytest|vitest|jest|tsc|eslint|next|vite|astro|svelte-kit)\b/i,
  /\bgit\s+(?:status|log|diff|show|rev-parse|blame|shortlog|describe|ls-files|remote(?:\s+-v)?)\b/i,
  // Checking that a locally-spawned server responds is a read-only verification step, not a risk — scoped to
  // loopback addresses only (never a blanket curl/wget allow, and the pipe-to-shell destructive pattern above
  // already takes precedence over this regardless of target).
  /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])\b/i,
  // Confirming whether a port is already in use/listening is a read-only check, never a mutation.
  /\b(netstat|lsof|ss)\b/i,
  /\b(Get-NetTCPConnection|Test-NetConnection)\b/i,
];

/** Adapter-generated verification commands that are safe to run without widening an entire
 * executable into the safe list. These patterns are anchored to read/build/test operations, and
 * shell control operators are rejected so a valid prefix cannot authorize a chained mutation. */
const SAFE_ADAPTER_VERIFICATION_PATTERNS: RegExp[] = [
  /^R(?:\.exe)?\s+CMD\s+(?:check|build)\b/i,
  /^composer(?:\.bat)?\s+validate\b/i,
  /^bundle(?:\.bat)?\s+exec\s+(?:rubocop|rspec|rails\s+test)\b/i,
  /^swift\s+(?:build|test)\b/i,
  /^cmake\s+(?:-S\b|--build\b)/i,
  /^ctest\s+--test-dir\b/i,
  /^meson\s+(?:setup|compile|test)\b/i,
  /^mix\s+(?:format\s+--check-formatted|compile\s+--warnings-as-errors|test)\b/i,
  /^sbt\s+(?:compile|test)\b/i,
  /^dart\s+(?:format\s+--output=none|analyze|test)\b/i,
  /^(?:luacheck|busted)\b/i,
  /^pwsh(?:\.exe)?\s+-NoProfile\s+-Command\s+Invoke-ScriptAnalyzer\b/i,
  /^shellcheck\b/i,
  /^godot(?:\.exe)?\s+--headless\s+--editor\b/i,
];

function isSafeAdapterVerificationCommand(command: string) {
  if (/[&|;<>`$\r\n]/.test(command)) return false;
  return SAFE_ADAPTER_VERIFICATION_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * A read-only existence probe the model routinely emits before deciding whether a dependency actually
 * needs installing — e.g. `dir node_modules\pkg 2>nul || echo NOT_FOUND`, `ls node_modules/pkg 2>/dev/null
 * && echo FOUND`, `node -e "require.resolve('pkg')"`. These read the filesystem/module graph and mutate
 * nothing, but the strict anchored dir/ls SAFE pattern rejects the `2>nul`/`|| echo` idiom, so they were
 * falling through to an approval prompt — friction on the very "is this actually required?" check the
 * install-approval flow depends on (Suite D). Allowed ONLY when the base is a read-only inspector, the only
 * redirection is stderr-suppression, and the only chained part is a literal `echo <token>` — so a real
 * chain like `dir & del x` still leaves residual metacharacters and is refused below.
 */
function isReadOnlyExistenceProbe(command: string): boolean {
  // Unwrap a single shell wrapper — the model invokes the same existence check as `Test-Path X`,
  // `powershell -Command "Test-Path X"`, `cmd /c "dir X"`, `bash -c "ls X"` interchangeably across runs.
  // Safe to unwrap: destructive/permission patterns are already checked BEFORE this in
  // decideCommandPermission, and the read-only base whitelist below only ever allows inspection verbs, so
  // an inner mutation cannot slip through here.
  const wrapper = command.trim().match(/^(?:powershell|pwsh|cmd|bash|sh)(?:\.exe)?\s+(?:-command|-c|\/c|\/k)\s+(.+)$/i);
  const inner = wrapper ? wrapper[1].trim().replace(/^["']|["']$/g, "") : command;
  const stderrStripped = inner.replace(/\s+2>\s*(?:nul|\/dev\/null)\b/gi, "");
  const chainStripped = stderrStripped.replace(/\s*(?:\|\||&&)\s*echo\s+[\w.\-/\\]+\s*$/i, "").trim();
  // A single pipe into a read-only filter (findstr/grep/Select-String/wc/...) is still read-only — the
  // model commonly writes `dir node_modules | findstr pkg`. Strip one such trailing segment; a pipe into
  // anything not on this filter list leaves the `|` in place and is refused by the metacharacter check.
  const pipeStripped = chainStripped
    .replace(/\s*\|\s*(?:findstr|find|grep|egrep|fgrep|select-string|sls|wc|head|tail|more|sort|uniq|select-object|measure-object|out-string)\b[^|&;<>`$]*$/i, "")
    .trim();
  if (/[&|;<>`$]/.test(pipeStripped)) return false;
  return (
    /^(?:dir|ls|type|cat|stat|Test-Path|Get-Item|Get-ChildItem|where|which)\b/i.test(pipeStripped) ||
    /^test\s+-[ef]\b/i.test(pipeStripped) ||
    /^node\s+(?:-e|--eval)\b.*require\.resolve/i.test(pipeStripped)
  );
}

export function decideCommandPermission(command: string): CommandPermissionDecision {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, status: "permission-required", reason: "Empty commands are not runnable.", category: "unrecognized" };

  if (DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allowed: false, status: "destructive", reason: "Command was blocked because it is destructive." };
  }

  const approvalMatch = PERMISSION_REQUIRED_PATTERNS.find((entry) => entry.pattern.test(trimmed));
  if (approvalMatch) {
    return { allowed: false, status: "permission-required", reason: approvalMatch.reason, category: approvalMatch.category };
  }

  if (SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed)) || isReadOnlyExistenceProbe(trimmed) || isSafeAdapterVerificationCommand(trimmed)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    status: "permission-required",
    reason: "Foundry needs approval before running an unrecognized local command.",
    category: "unrecognized",
  };
}
