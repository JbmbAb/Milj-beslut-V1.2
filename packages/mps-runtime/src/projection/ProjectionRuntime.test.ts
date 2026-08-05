import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
} from "../repository/CasBackedArtifactRepository.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";
import {
  PROJECTION_RUNTIME_VERSION,
  ProjectionRuntime,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkTs(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

async function seedRepo() {
  const backend = new MemoryByteStorageBackend();
  const repo = new CasBackedArtifactRepository(backend);
  const body = {
    artifact_type: "CAPABILITY_EXECUTION",
    capability_ref: { artifact_id: "cap-1" },
    outputs: ["f-1"],
  };
  const content_hash = sha256ContentHash(body);
  await repo.put({
    artifact_id: "exec-1",
    content_hash,
    body,
  });
  return { backend, repo, body, content_hash };
}

describe("Projection Runtime (Epoch II §2.7)", () => {
  it("exposes version", () => {
    expect(PROJECTION_RUNTIME_VERSION).toBe("1.0.0");
  });

  it("projects artifact via resolver without writing to CAS", async () => {
    const { backend, repo, body, content_hash } = await seedRepo();
    const existsBefore = await backend.exists("exec-1");
    const projection = ProjectionRuntime.create({ resolver: repo.resolver });

    const view = await projection.project({
      artifact_id: "exec-1",
      artifact_type: "CAPABILITY_EXECUTION",
    });

    expect(view.projection_kind).toBe("artifact");
    expect(view.artifact_id).toBe("exec-1");
    expect(view.artifact_type).toBe("CAPABILITY_EXECUTION");
    expect(view.content_hash).toEqual(content_hash);
    expect(view.body).toEqual(body);
    expect(view.projection_hash.value).toMatch(/^[a-f0-9]{64}$/);

    // Purity: no new artifacts; original still present
    expect(await backend.exists("exec-1")).toBe(existsBefore);
    expect(await backend.exists("exec-2")).toBe(false);

    // Projected body is frozen
    expect(Object.isFrozen(view.body)).toBe(true);
  });

  it("same refs → same projection_hash (reproducible)", async () => {
    const { repo } = await seedRepo();
    const projection = ProjectionRuntime.create({ resolver: repo.resolver });
    const ref = {
      artifact_id: "exec-1",
      artifact_type: "CAPABILITY_EXECUTION",
    };
    const a = await projection.project(ref);
    const b = await projection.project(ref);
    expect(a.projection_hash.value).toBe(b.projection_hash.value);

    const batch1 = await projection.projectMany([ref]);
    const batch2 = await projection.projectMany([ref]);
    expect(batch1.batch_hash.value).toBe(batch2.batch_hash.value);
    expect(batch1.views).toHaveLength(1);
  });

  it("fail-closed when artifact missing", async () => {
    const { repo } = await seedRepo();
    const projection = ProjectionRuntime.create({ resolver: repo.resolver });
    await expect(
      projection.project({
        artifact_id: "missing",
        artifact_type: "CAPABILITY_EXECUTION",
      }),
    ).rejects.toThrow(/Artifact not found/);
  });

  it("facade has no put / write surface and never imports domain", () => {
    const runtimeSrc = readFileSync(
      path.join(__dirname, "ProjectionRuntime.ts"),
      "utf8",
    );
    expect(runtimeSrc).not.toMatch(/\bput\s*\(/);
    expect(runtimeSrc).not.toContain("artifactRepository.put");
    expect(runtimeSrc).not.toContain("asExecutorPort");

    const violations: string[] = [];
    for (const file of walkTs(__dirname)) {
      const src = readFileSync(file, "utf8");
      if (/from\s+['"][^'"]*mps-lu[^'"]*['"]/.test(src)) {
        violations.push(file);
      }
      if (/LURuleEngine|PostgisSpatialProvider/.test(src)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
