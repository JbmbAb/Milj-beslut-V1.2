import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import type { ContentHash } from "../artifacts/ContentHash.js";

/**
 * Canonical artifact identity for Frozen Core.
 *
 * Pipeline (enforcement boundary — do not bypass):
 *   payload → RFC 8785 (json-canonicalize) → UTF-8 bytes → SHA-256 → ContentHash
 *
 * No other identity path may hash via JSON.stringify or ad-hoc key sorting.
 */
export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(Buffer.from(canonicalize(value), "utf8"))
    .digest("hex");
}

export function sha256ContentHash(canonicalPayload: unknown): ContentHash {
  return {
    algorithm: "sha256",
    value: sha256CanonicalJson(canonicalPayload),
  };
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
