const REDACTED = "[REDACTED]";

const SENSITIVE_FIELD_NAME = /(?:api[_-]?key|access[_-]?key|secret|token|password|passphrase|credential|private[_-]?key|client[_-]?secret|authorization)/i;

/**
 * Removes credential-shaped values while preserving enough surrounding structure for diagnostics.
 * This is intentionally provider-agnostic: user text, compiler output, tool results, and persisted
 * mission events all pass through the same rule set instead of relying on one vendor's key prefix.
 */
export function redactSensitiveText(value: string): string {
  if (!value) return value;

  return value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, REDACTED)
    .replace(/^(\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|CREDENTIAL|PRIVATE_KEY|CLIENT_SECRET)[A-Z0-9_]*\s*=\s*).*$/gim, `$1${REDACTED}`)
    .replace(/(["']?(?:api[_-]?key|access[_-]?key|secret|token|password|passphrase|credential|private[_-]?key|client[_-]?secret|authorization)["']?\s*:\s*["'])([^"'\r\n]+)(["'])/gi, `$1${REDACTED}$3`)
    .replace(/(\b(?:authorization|x-api-key)\s*:\s*(?:Bearer\s+)?)([^\s,;]+)/gi, `$1${REDACTED}`)
    .replace(/\bsk-(?:proj-|ant-api\d{2}-)?[A-Za-z0-9_-]{20,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{25,}\b/g, REDACTED)
    .replace(/\bAQ\.[A-Za-z0-9_-]{20,}\b/g, REDACTED)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED);
}

/** Redacts nested event/request data without modifying binary image payloads. */
export function redactSensitiveData<T>(value: T, fieldName = ""): T {
  if (typeof value === "string") {
    if (/^(?:dataUrl|image_url|imageUrl|data)$/i.test(fieldName) && /^data:image\//i.test(value)) return value;
    if (SENSITIVE_FIELD_NAME.test(fieldName) && value.trim()) return REDACTED as T;
    return redactSensitiveText(value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item)) as T;
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = redactSensitiveData(item, key);
  }
  return result as T;
}
