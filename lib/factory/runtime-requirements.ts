const DATABASE_TECHNOLOGY = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb|cockroachdb|planetscale|neon)\b/i;
const REDIS_TECHNOLOGY = /\bredis\b/i;
const EXTERNAL_NOW = /\b(?:existing|shared|production|hosted|remote|connect(?:ed|ion)?|database_url|redis_url|supabase project|neon project)\b/i;

/**
 * Return credentials that are genuine prerequisites for the first local build.
 * Naming a production-capable technology is an architecture preference, not an
 * instruction to stop before scaffolding a zero-setup, locally verified system.
 */
export function externalRuntimeRequirementKeys(requirements: string) {
  const required = new Set<string>();
  if (!EXTERNAL_NOW.test(requirements)) return [];
  if (DATABASE_TECHNOLOGY.test(requirements) || /\bDATABASE_URL\b/i.test(requirements)) required.add("DATABASE_URL");
  if (REDIS_TECHNOLOGY.test(requirements) || /\bREDIS_URL\b/i.test(requirements)) required.add("REDIS_URL");
  return Array.from(required);
}
