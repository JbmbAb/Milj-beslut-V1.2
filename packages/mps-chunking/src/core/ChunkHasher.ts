import { createHash } from "node:crypto";
import type { ContentHash } from "./ChunkTypes.js";

export function sha256Bytes(bytes: Uint8Array): ContentHash {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Hash UTF-8 bytes of canonical chunk text (text contract). */
export function sha256Utf8Text(text: string): ContentHash {
  return sha256Bytes(Buffer.from(text, "utf8"));
}
