import { describe, it, expect, vi } from "vitest";
import type { LUPropertyContextArtifact, SpatialLayerUnavailableArtifact } from "@miljobeslut/mps-lu";
import { isSpatialLayerUnavailableEvidenceValid, SPATIAL_LAYER_UNAVAILABLE } from "@miljobeslut/mps-lu";
import type { SpatialQueryRequest } from "@miljobeslut/mps-lu/src/services/SpatialQueryContract";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";

/**
 * U30-R (LU 72h): when one layer's governed query fails to execute, the provider pins the cause in
 * CAS as a SPATIAL_LAYER_UNAVAILABLE record and reports it by reference. Hermetic: `pg` is mocked
 * (same fake-pool pattern as SpatialProviderPostGISLayerIsolation.test.ts), CAS is in memory.
 */
const REGISTRY: Record<string, { table: string; version_hash: string }> = {
  water: { table: "env.sgu_well", version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc" },
  ebh: { table: "env.ebh_potentiellt_fororenade_omraden", version_hash: "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186" },
};

const PROPERTY_ARTIFACT = {
  artifact_id: "prop-unavailable-cause-fixture",
  artifact_type: "LU_PROPERTY_CONTEXT",
  content_hash: { algorithm: "sha256", value: "hash-fixture" },
  references: [],
  payload: {
    property_ref: "FIXTURE 1:1",
    official_name: "Fixture 1:1",
    geometry_ref: { artifact_id: "geom-fixture", artifact_type: "CANONICAL_GEOMETRY" },
    municipality: "Fixture",
    coordinates: [6612345, 591234],
  },
} as unknown as LUPropertyContextArtifact;

function makeFakePool(failingTable: string) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("PostgisImportBatch")) {
        const [schema, table] = params as [string, string];
        const entry = Object.values(REGISTRY).find((r) => r.table === `${schema}.${table}`);
        if (!entry) throw new Error(`FIXTURE GAP: no registry entry for ${schema}.${table}`);
        return { rows: [{ content_bundle_sha256: entry.version_hash, dataset_version: null }] };
      }
      for (const entry of Object.values(REGISTRY)) {
        if (sql.includes(`FROM ${entry.table}`)) {
          if (entry.table === failingTable) {
            const error = new Error(`relation "${entry.table}" does not exist`);
            error.name = "QueryFailedError";
            throw error;
          }
          return { rows: [{ hit: 1 }], rowCount: 1 };
        }
      }
      throw new Error(`FIXTURE GAP: unrecognized query: ${sql}`);
    }),
    end: vi.fn(async () => {}),
  };
}

vi.mock("pg", () => {
  const PoolMock = vi.fn().mockImplementation(function FakePool() {
    return (globalThis as any).__FAKE_PG_POOL__;
  });
  return { Pool: PoolMock, default: { Pool: PoolMock } };
});

const REQUEST: SpatialQueryRequest = {
  property_ref: { artifact_id: PROPERTY_ARTIFACT.artifact_id, artifact_type: PROPERTY_ARTIFACT.artifact_type },
  layers: [
    { name: "water", version_hash: "v1.0" },
    { name: "ebh", version_hash: "v1.0" },
  ],
  buffer_distance_meters: 500,
} as SpatialQueryRequest;

async function repoWithProperty() {
  const repo = new InMemoryArtifactRepository();
  await repo.put({ artifact_id: PROPERTY_ARTIFACT.artifact_id, content_hash: PROPERTY_ARTIFACT.content_hash, body: PROPERTY_ARTIFACT });
  return repo;
}

describe("U30-R: SpatialProviderPostGIS pins the cause of an unavailable layer", () => {
  it("mints one self-consistent SPATIAL_LAYER_UNAVAILABLE record in CAS: layer, registry hash, the same query contract, reason", async () => {
    (globalThis as any).__FAKE_PG_POOL__ = makeFakePool(REGISTRY.ebh.table);
    const repo = await repoWithProperty();
    const { SpatialProviderPostGIS } = await import("../src/SpatialProviderPostGIS");
    const provider = new SpatialProviderPostGIS("postgresql://fixture", repo);

    const outcome = await provider.query(REQUEST);

    expect(outcome.evidence.map((e) => e.payload.source_metadata.dataset)).toEqual(["water"]);
    expect(outcome.unavailable_layers).toHaveLength(1);
    const entry = outcome.unavailable_layers[0]!;
    expect(entry).toMatchObject({ dataset: "ebh", reason: expect.stringContaining("QueryFailedError") });
    expect(entry.evidence_ref?.artifact_type).toBe(SPATIAL_LAYER_UNAVAILABLE);

    const stored = await repo.resolve<SpatialLayerUnavailableArtifact>(entry.evidence_ref!);
    expect(isSpatialLayerUnavailableEvidenceValid(stored)).toBe(true);
    expect(stored.payload.layer_ref).toEqual({ layer_id: "ebh", version_hash: REGISTRY.ebh.version_hash, layer_version: "v1.0" });
    expect(stored.payload.cause).toEqual({ kind: "QUERY_EXECUTION_FAILED", reason: entry.reason });
    expect(stored.payload.query_contract).toEqual((outcome.evidence[0]!.payload as { query_contract: unknown }).query_contract);
  });

  it("re-querying the same failure is WORM-idempotent: same record, no conflict", async () => {
    (globalThis as any).__FAKE_PG_POOL__ = makeFakePool(REGISTRY.ebh.table);
    const repo = await repoWithProperty();
    const { SpatialProviderPostGIS } = await import("../src/SpatialProviderPostGIS");
    const provider = new SpatialProviderPostGIS("postgresql://fixture", repo);

    const first = await provider.query(REQUEST);
    const second = await provider.query(REQUEST);

    expect(second.unavailable_layers[0]!.evidence_ref).toEqual(first.unavailable_layers[0]!.evidence_ref);
  });

  it("if the cause cannot be written to CAS the query fails; an unpinned cause is never reported", async () => {
    (globalThis as any).__FAKE_PG_POOL__ = makeFakePool(REGISTRY.ebh.table);
    const repo = await repoWithProperty();
    const realPut = repo.put.bind(repo);
    repo.put = vi.fn(async (artifact: Parameters<typeof realPut>[0]) => {
      if (artifact.artifact_id.startsWith("layer-unavailable-")) throw new Error("CAS write failed (simulated)");
      return realPut(artifact);
    });
    const { SpatialProviderPostGIS } = await import("../src/SpatialProviderPostGIS");
    const provider = new SpatialProviderPostGIS("postgresql://fixture", repo);

    await expect(provider.query(REQUEST)).rejects.toThrow("CAS write failed (simulated)");
  });
});
