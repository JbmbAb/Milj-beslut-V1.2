import { createHash } from "node:crypto";

/**
 * Deterministic content hash for Package24 / Frozen Core projections.
 * SHA-256 over UTF-8 JSON.stringify of the projection (stable field order from factories).
 */
export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(Buffer.from(JSON.stringify(value), "utf8"))
    .digest("hex");
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
