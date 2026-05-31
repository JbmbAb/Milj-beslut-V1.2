/**
 * Audit Log Sanitization Service
 * Ensures sensitive PII and confidential information doesn't persist in audit trails.
 */

const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /credential/i,
  /bankid/i,
  /pii/i,
  /ssn/i,
  /personnummer/i,
  // Keep key matching narrow to API/private key-like names, including camelCase prefixes.
  /api[-_ ]?key/i,
  /private[-_ ]?key/i,
];

const SENSITIVE_FIELDS = new Set([
  'password',
  'refreshtoken',
  'accesstoken',
  'apikey',
  'secret',
  'bankidid',
  'personnummer',
  'socialsecuritynumber',
]);

// These regexes use String#replace, which safely resets /g state per call.
const VALUE_REDACTION_PATTERNS: ReadonlyArray<RegExp> = [
  // Swedish personal identity number formats (YYMMDD-XXXX, YYMMDD+XXXX, YYYYMMDD-XXXX, YYYYMMDD+XXXX, and no separator)
  /\b\d{6}[-+]\d{4}\b/g,
  /\b\d{8}[-+]\d{4}\b/g,
  /\b\d{10}\b/g,
  /\b\d{12}\b/g,
  // Email addresses (basic)
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

function sanitizeStringValue(input: string): string {
  let output = input;
  for (const pattern of VALUE_REDACTION_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]');
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_FIELDS.has(key.toLowerCase()) || SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeAuditValue(value: unknown, visiting: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return sanitizeStringValue(value);
  }

  if (Array.isArray(value)) {
    if (visiting.has(value)) {
      return '[CIRCULAR]';
    }

    visiting.add(value);
    try {
      return value.map((item) => sanitizeAuditValue(item, visiting));
    } finally {
      visiting.delete(value);
    }
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (isPlainObject(value)) {
    if (visiting.has(value)) {
      return '[CIRCULAR]';
    }

    visiting.add(value);
    try {
      return sanitizeAuditPayloadInternal(value, visiting);
    } finally {
      visiting.delete(value);
    }
  }

  return value;
}

function sanitizeAuditPayloadInternal(
  payload: Record<string, unknown>,
  visiting: WeakSet<object>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (isSensitiveKey(key)) {
      if (typeof value === 'string') {
        sanitized[key] = `[REDACTED_${value.length}_CHARS]`;
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = '[REDACTED_OBJECT]';
      } else {
        sanitized[key] = '[REDACTED]';
      }
      continue;
    }

    sanitized[key] = sanitizeAuditValue(value, visiting);
  }

  return sanitized;
}

/**
 * GDPR-compliant sanitization: removes or masks sensitive fields from audit payloads.
 * Audit trails cannot be deleted (legal requirement), but can be anonymized.
 */
export function sanitizeAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const visiting = new WeakSet<object>();
  visiting.add(payload);
  return sanitizeAuditPayloadInternal(payload, visiting);
}

/**
 * Wraps payload sanitization for audit events.
 */
export function auditPayloadSafe(payload: Record<string, unknown>): Record<string, unknown> {
  return sanitizeAuditPayload(payload);
}
