const documentationTopic = /\b(docs?|documentation|developer portal|api reference|manuals?|guides?)\b/i;
const documentationLookupAction = /\b(need|want|find|get|send|give|share|provide|show|open|locate|search|look up|where(?:'s| is)?)\b/i;
const projectFileExtensions = "md|mdx|txt|rst|json|jsonc|ya?ml|toml|ini|env|csv|xml|html?|css|scss|sass|less|[cm]?[jt]sx?|vue|svelte|astro|py|rb|php|go|rs|java|kt|kts|cs|csproj|fs|fsproj|vb|sln|swift|dart|sql|graphql|proto|sh|bash|zsh|fish|ps1|bat|cmd|gradle|properties|lock";
const explicitProjectFile = new RegExp(`(?:^|[\\s'"(])((?:[\\w@.-]+[\\\\/])*[\\w@.-]+\\.(?:${projectFileExtensions}))(?=$|[\\s'",):?])`, "gi");
const extensionlessProjectFile = /(?:^|[\s'"(])(README|Dockerfile|Makefile|LICENSE)(?=$|[\s'",):?])/gi;

export function explicitProjectFileNames(message: string) {
  explicitProjectFile.lastIndex = 0;
  extensionlessProjectFile.lastIndex = 0;
  const names = Array.from(message.matchAll(explicitProjectFile), (match) => match[1].replace(/\\/g, "/"));
  names.push(...Array.from(message.matchAll(extensionlessProjectFile), (match) => match[1]));
  return Array.from(new Set(names));
}

/** True only when the user explicitly asks for files inside the connected project. */
export function isExplicitLocalProjectFileRequest(message: string) {
  if (explicitProjectFileNames(message).length) return true;
  return /\b(?:this|the current|our|local|connected)\s+(?:project|repo|repository|codebase)(?:'s)?\s+(?:docs?|documentation|files?)\b/i.test(message)
    || /\b(?:docs?|documentation|files?)\s+(?:in|from|inside|for)\s+(?:this|the current|our|the local|the connected)\s+(?:project|repo|repository|codebase)\b/i.test(message)
    || /\bproject\s+(?:docs?|documentation|files?)\b/i.test(message);
}

/** Unqualified product/library/vendor documentation requests are external lookups by default. */
export function isExternalDocumentationLookupRequest(message: string) {
  return documentationTopic.test(message)
    && documentationLookupAction.test(message)
    && !isExplicitLocalProjectFileRequest(message);
}
