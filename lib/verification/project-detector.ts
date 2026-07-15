import { registeredEcosystemAdapters } from "./adapters";
import type { ProjectEvidence, VerificationProfile } from "./types";

export function detectVerificationProfile(evidence: ProjectEvidence): VerificationProfile {
  const ranked = registeredEcosystemAdapters()
    .map((adapter) => ({ adapter, score: adapter.detect(evidence) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const selected = ranked[0];
  if (!selected) {
    return { adapterId: "unknown", ecosystem: "Unknown", detectedFrom: [], commands: [], limitations: ["No registered ecosystem adapter matched the project files."] };
  }
  const body = selected.adapter.buildProfile(evidence);
  return {
    adapterId: selected.adapter.id,
    ecosystem: selected.adapter.label,
    detectedFrom: evidence.rootEntries.filter(isProjectMarker),
    ...body,
  };
}

function isProjectMarker(entry: string) {
  return /^(package\.json|.+-lock\.(?:json|ya?ml)|yarn\.lock|bun\.lockb?|next\.config\..+|pom\.xml|mvnw(?:\.cmd)?|gradlew(?:\.bat)?|settings\.gradle(?:\.kts)?|build\.gradle(?:\.kts)?|pyproject\.toml|requirements\.txt|manage\.py|composer\.json|go\.mod|cargo\.toml|pubspec\.yaml|dockerfile|docker-compose\.ya?ml|project\.godot|chart\.yaml|.+\.(?:sln|csproj|tf|sql)|.+\.html?)$/i.test(entry);
}

export function formatVerificationProfile(profile: VerificationProfile): string {
  const checks = profile.commands.length
    ? profile.commands.map((item, index) => `${index + 1}. [${item.stage}] ${item.command} (${item.source})`).join("\n")
    : "No configured command checks were detected.";
  return [`Detected ecosystem: ${profile.ecosystem}`, `Package manager: ${profile.packageManager || "not detected"}`, "Applicable checks in order:", checks, profile.preview ? `Preview command: ${profile.preview.command}${profile.preview.expectedUrl ? `; expected URL: ${profile.preview.expectedUrl}` : ""}` : "Preview: no reliable launch command detected.", profile.limitations.length ? `Known verification limits: ${profile.limitations.join(" ")}` : ""].filter(Boolean).join("\n");
}
