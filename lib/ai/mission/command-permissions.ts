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
  /\b(npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:build|test|lint|typecheck|check|dev|start|preview)\b/i,
  /\b(node|python|python3|py|ruby|php|java|go|cargo|dotnet|mvn|gradle|pytest|vitest|jest|tsc|eslint|next|vite|astro|svelte-kit)\b/i,
  /\bgit\s+(?:status|log|diff|show|rev-parse|blame|shortlog|describe|ls-files|remote(?:\s+-v)?)\b/i,
];

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

  if (SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allowed: true };
  }

  return {
    allowed: false,
    status: "permission-required",
    reason: "Foundry needs approval before running an unrecognized local command.",
    category: "unrecognized",
  };
}
