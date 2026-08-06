import { describe, it, expect } from "vitest";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
} from "../../repository/CasBackedArtifactRepository.js";
import { sha256ContentHash } from "../../kernel/ExecutionKernel.js";
import {
  EphemeralProjectionStore,
  ProjectionRuntime,
} from "../../projection/index.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
} from "../harness/PlatformHarness.js";

/**
 * Blocking Fas 6 — ProjectionRebuild
 *
 * DELETE projections → Rebuild from artifacts → identical UI hashes.
 * Proves Projection is never a source of truth.
 */
describe("Projection verification — ProjectionRebuild (blocking Fas 6)", () => {
  it("DELETE all projections → rebuild → identical batch_hash and CAS unchanged", async () => {
    const backend = new MemoryByteStorageBackend();
    const repo = new CasBackedArtifactRepository(backend);

    const artifacts = [
      {
        artifact_id: "exec-a",
        body: {
          artifact_type: "CAPABILITY_EXECUTION",
          outputs: ["f-a"],
        },
      },
      {
        artifact_id: "exec-b",
        body: {
          artifact_type: "CAPABILITY_EXECUTION",
          outputs: ["f-b"],
        },
      },
      {
        artifact_id: "outcome-1",
        body: {
          artifact_type: "execution_outcome",
          result: "success",
        },
      },
    ] as const;

    for (const a of artifacts) {
      const content_hash = sha256ContentHash(a.body);
      await repo.put({
        artifact_id: a.artifact_id,
        content_hash,
        body: a.body,
      });
    }

    const refs = artifacts.map((a) => ({
      artifact_id: a.artifact_id,
      artifact_type: a.body.artifact_type,
    }));

    const runtime = ProjectionRuntime.create({ resolver: repo.resolver });
    const store = new EphemeralProjectionStore();

    const first = await store.rebuildFromArtifacts(runtime, refs);
    expect(store.size()).toBe(3);
    const firstBatchHash = first.batch_hash.value;
    const firstViewHashes = first.views.map((v) => v.projection_hash.value);

    // Capture CAS digests before delete
    const casBefore = await Promise.all(
      refs.map(async (r) => {
        const env = await repo.resolveEnvelope(r);
        return { id: r.artifact_id, hash: env.content_hash.value };
      }),
    );

    // DELETE projections
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.list()).toHaveLength(0);

    // CAS must still hold truth
    for (const row of casBefore) {
      expect(await backend.exists(row.id)).toBe(true);
    }

    // Rebuild from artifacts only
    const second = await store.rebuildFromArtifacts(runtime, refs);
    expect(store.size()).toBe(3);
    expect(second.batch_hash.value).toBe(firstBatchHash);
    expect(second.views.map((v) => v.projection_hash.value)).toEqual(
      firstViewHashes,
    );

    // CAS artifacts byte-identical (content_hash unchanged)
    for (const row of casBefore) {
      const env = await repo.resolveEnvelope({
        artifact_id: row.id,
        artifact_type: "any",
      });
      expect(env.content_hash.value).toBe(row.hash);
    }
  });

  it("rebuild after platform execution matches prior projection of same artifacts", async () => {
    const seed = "seed:proj-rebuild";
    const harness = createPlatformHarness({
      snapshot_id: "snap-pr",
      release_id: "rel-pr",
      seed,
      capabilities: [
        {
          artifact_id: "cap-pr",
          capability_key: "proj.rebuild",
          implementation_id: "impl-pr",
          handler: async () => [{ artifact_id: "finding-pr" }],
        },
      ],
    });

    const { result } = await runCapabilityOnce(
      harness,
      buildManifest({
        manifest_id: "m-pr",
        capability_id: "cap-pr",
        seed,
      }),
    );
    expect(result.admission.decision).toBe("admitted");

    const refs = [
      {
        artifact_id: result.capability_executions[0]!.artifact_id,
        artifact_type: "CAPABILITY_EXECUTION" as const,
      },
      {
        artifact_id: result.outcome!.outcome_id,
        artifact_type: "execution_outcome" as const,
      },
    ];

    const runtime = ProjectionRuntime.create({
      resolver: harness.repo.resolver,
    });
    const store = new EphemeralProjectionStore();
    const before = await store.rebuildFromArtifacts(runtime, refs);
    store.clear();
    const after = await store.rebuildFromArtifacts(runtime, refs);

    expect(after.batch_hash.value).toBe(before.batch_hash.value);
    expect(after.views[0]?.projection_hash.value).toBe(
      before.views[0]?.projection_hash.value,
    );
  });
});
