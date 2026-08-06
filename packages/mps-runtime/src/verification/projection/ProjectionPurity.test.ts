import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
} from "../../repository/CasBackedArtifactRepository.js";
import { sha256ContentHash } from "../../kernel/ExecutionKernel.js";
import {
  EphemeralProjectionStore,
  ProjectionRuntime,
} from "../../projection/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Projection verification — ProjectionPurity", () => {
  it("projecting never mutates CAS artifact bytes", async () => {
    const backend = new MemoryByteStorageBackend();
    const repo = new CasBackedArtifactRepository(backend);
    const body = { artifact_type: "execution_outcome", result: "success" };
    const content_hash = sha256ContentHash(body);
    await repo.put({
      artifact_id: "out-pure",
      content_hash,
      body,
    });

    const before = await backend.get("out-pure");
    const runtime = ProjectionRuntime.create({ resolver: repo.resolver });
    const view = await runtime.project({
      artifact_id: "out-pure",
      artifact_type: "execution_outcome",
    });

    // Mutating the projected body must not affect store (frozen + cloned)
    expect(Object.isFrozen(view.body)).toBe(true);
    expect(() => {
      (view.body as { result: string }).result = "tampered";
    }).toThrow();

    const after = await backend.get("out-pure");
    expect(Buffer.compare(Buffer.from(before!), Buffer.from(after!))).toBe(0);

    const store = new EphemeralProjectionStore();
    store.put(view);
    store.clear();
    const again = await backend.get("out-pure");
    expect(Buffer.compare(Buffer.from(before!), Buffer.from(again!))).toBe(0);
  });

  it("ProjectionRuntime has no put / write surface", () => {
    const src = readFileSync(
      path.join(__dirname, "../../projection/ProjectionRuntime.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\bput\s*\(/);
    expect(src).not.toContain("artifactRepository");
  });
});
