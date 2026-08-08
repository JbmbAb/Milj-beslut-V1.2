import { describe, it, expect } from "vitest";
import {
  buildArchiveChunkResult,
  verifyArchiveBytes,
  ARCHIVE_CHUNK_VERSION,
  ARCHIVE_MAX_CHUNK_BYTES,
} from "../src/index.js";

describe("archive MB-005 determinism", () => {
  const source = { artifact_id: "archive-file-1", artifact_type: "archive_file" };

  it("chunks fixed byte ranges with stable SHA-256 order (small synthetic input)", () => {
    const bytes = new Uint8Array(20);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;

    const a = buildArchiveChunkResult(bytes, source, 8);
    const b = buildArchiveChunkResult(bytes, source, 8);

    expect(a.chunks).toHaveLength(3); // 8+8+4
    expect(a.chunks[0]?.chunk_version).toBe(ARCHIVE_CHUNK_VERSION);
    expect(a.chunks[0]?.byte_offset_start).toBe(0);
    expect(a.chunks[0]?.byte_offset_end).toBe(8);
    expect(a.verification.control).toBe("MB-005");
    expect(a.manifest.manifest_hash.value).toBe(b.manifest.manifest_hash.value);

    const verify = verifyArchiveBytes(bytes, a.verification);
    expect(verify).toEqual({ ok: true });
  });

  it("detects byte tampering on replay", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const result = buildArchiveChunkResult(bytes, source, 4);
    const tampered = new Uint8Array(bytes);
    tampered[0] = 99;

    const verify = verifyArchiveBytes(tampered, result.verification);
    expect(verify.ok).toBe(false);
    if (!verify.ok) expect(verify.reason).toContain("REJECT_MB005");
  });

  it("enforces default MB-005 max chunk size of 256 MiB without explicit limit passed", () => {
    // Assert the default product boundary is exactly 256 MiB
    expect(ARCHIVE_MAX_CHUNK_BYTES).toBe(256 * 1024 * 1024);

    // Create an array that is exactly 256 MiB + 1 byte to trigger a boundary split
    // (We allocate 1 byte over the limit to ensure it splits into exactly 2 chunks)
    // We only allocate the minimum needed array for the test to avoid OOM
    const limit = ARCHIVE_MAX_CHUNK_BYTES;
    const bytes = new Uint8Array(limit + 1);
    
    // We don't pass the chunk limit, so it must use the default
    const result = buildArchiveChunkResult(bytes, source);
    
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]?.byte_offset_start).toBe(0);
    expect(result.chunks[0]?.byte_offset_end).toBe(limit);
    
    expect(result.chunks[1]?.byte_offset_start).toBe(limit);
    expect(result.chunks[1]?.byte_offset_end).toBe(limit + 1);
    
    expect(result.verification.control).toBe("MB-005");
  });
});
