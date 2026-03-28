/**
 * Audit Log Sanitization Service
 * Ensures sensitive PII and confidential information doesn't persist in audit trails.
 */

/**
 * GDPR-compliant sanitization: removes or masks sensitive fields from audit payloads.
 * Audit trails cannot be deleted (legal requirement), but can be anonymized.
 */
export function sanitizeAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /token/i,
    /credential/i,
    /bankid/i,
    /pii/i,
    /ssn/i,
    /personnummer/i,
    // Avoid broad /key/i matching (would redact e.g. "validKey"). Keep narrower key patterns instead.
    /\bapi[-_ ]?key\b/i,
    /\bprivate[-_ ]?key\b/i,
  ];

  const sensitiveFields = [
    "password",
    "refreshToken",
    "accessToken",
    "apiKey",
    "secret",
    "bankidId",
    "personnummer",
    "socialSecurityNumber",
  ];

  const valueRedactionPatterns: ReadonlyArray<RegExp> = [
    // Swedish personal identity number formats (YYMMDD-XXXX, YYMMDD+XXXX, YYYYMMDD-XXXX, YYYYMMDD+XXXX)
    /\b\d{6}[-+]\d{4}\b/g,
    /\b\d{8}[-+]\d{4}\b/g,
    // Email addresses (basic)
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  ];

  const sanitizeStringValue = (input: string): string => {
    let output = input;
    for (const pattern of valueRedactionPatterns) {
      output = output.replace(pattern, "[REDACTED]");
    }
    return output;
  };

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    // Check if key matches sensitive patterns
    const isSensitive = sensitiveFields.includes(key) || sensitivePatterns.some((p) => p.test(key));

    if (isSensitive) {
      // Mask sensitive values
      if (typeof value === "string") {
        sanitized[key] = `[REDACTED_${value.length}_CHARS]`;
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = "[REDACTED_OBJECT]";
      } else {
        sanitized[key] = "[REDACTED]";
      }
    } else {
      // Recursively sanitize nested objects
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sanitized[key] = sanitizeAuditPayload(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map((item) =>
          typeof item === "object" && item !== null
            ? sanitizeAuditPayload(item as Record<string, unknown>)
            : typeof item === "string"
              ? sanitizeStringValue(item)
              : item
        );
      } else if (typeof value === "string") {
        sanitized[key] = sanitizeStringValue(value);
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}

/**
 * Wraps payload sanitization for audit events.
 */
export function auditPayloadSafe(payload: Record<string, unknown>): Record<string, unknown> {
  return sanitizeAuditPayload(payload);
}
