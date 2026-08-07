/**
 * Canonical hashing for RetrievalExecutionTrace identity (observation only).
 * Metadata (timestamps, latency, tokens, user, model) MUST NOT enter hash.
 */

import { createHash } from "node:crypto";

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

export function canonicalizeTraceJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function hashTraceCanonical(value: unknown): string {
  return createHash("sha256")
    .update(Buffer.from(canonicalizeTraceJson(value), "utf8"))
    .digest("hex");
}
