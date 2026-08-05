import { describe, it, expect } from "vitest";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
} from "./CasBackedArtifactRepository.js";

describe("CasBackedArtifactRepository", () => {
  it("stores and retrieves by artifact_id with content hash", async () => {
    const repo = new CasBackedArtifactRepository(new MemoryByteStorageBackend());
    const content_hash = { algorithm: "sha256" as const, value: "abc123" };
    await repo.put({
      artifact_id: "a1",
      content_hash,
      body: { hello: "world" },
    });

    const got = await repo.resolve({
      artifact_id: "a1",
      artifact_type: "execution_manifest",
    });
    expect(got).toEqual({ hello: "world" });
  });

  it("enforces WORM on conflicting bytes", async () => {
    const backend = new MemoryByteStorageBackend();
    const repo = new CasBackedArtifactRepository(backend);
    const content_hash = { algorithm: "sha256" as const, value: "h1" };
    await repo.put({ artifact_id: "a1", content_hash, body: { v: 1 } });
    await expect(
      repo.put({ artifact_id: "a1", content_hash, body: { v: 2 } }),
    ).rejects.toThrow(/WORM/);
  });
});
