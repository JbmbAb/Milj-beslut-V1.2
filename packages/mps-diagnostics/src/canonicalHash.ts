/**
 * Deterministic canonical JSON + SHA-256 for Package 22 identity hashes.
 * Timestamps and other metadata MUST NOT be passed into hashCanonical.
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

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function hashCanonical(value: unknown): string {
  const bytes = Buffer.from(canonicalizeJson(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}
