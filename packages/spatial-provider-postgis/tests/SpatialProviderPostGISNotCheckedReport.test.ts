import { describe, it, expect, vi } from "vitest";
import type { LUPropertyContextArtifact } from "@miljobeslut/mps-lu";
import type { SpatialQueryRequest } from "@miljobeslut/mps-lu/src/services/SpatialQueryContract";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";

/**
 * U30-R2 (LU 72h): a layer whose governed query cannot be executed is reported within the existing
 * NOT_CHECKED contract -- `SpatialQueryOutcomeV2.unavailable_layers` -- with a STABLE machine code as
 * its `reason` and the driver's raw text only as internal `diagnostic`. Nothing is written to CAS for
 * it and no new artifact type exists (owner 2026-10-02: SPATIAL_LAYER_UNAVAILABLE is not adopted).
 * Hermetic: `pg` is mocked (same fake-pool pattern as SpatialProviderPostGISLayerIsolation.test.ts),
 * CAS is in memory.
 */
const REGISTRY: Record<string, { table: string; version_hash: string }> = {
  water: { table: "env.sgu_well", version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc" },
  ebh: { table: "env.ebh_potentiellt_fororenade_omraden", version_hash: "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186" },
};

const PROPERTY_ARTIFACT = {
  artifact_id: "prop-not-checked-report-fixture",
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

describe("U30-R2: SpatialProviderPostGIS reports an unavailable layer within the existing NOT_CHECKED contract", () => {
  it("reason is the stable class code SOURCE_UNAVAILABLE; the raw driver text is only internal diagnostic; no artifact is cited", async () => {
    (globalThis as any).__FAKE_PG_POOL__ = makeFakePool(REGISTRY.ebh.table);
    const repo = await repoWithProperty();
    const { SpatialProviderPostGIS } = await import("../src/SpatialProviderPostGIS");
    const provider = new SpatialProviderPostGIS("postgresql://fixture", repo);

    const outcome = await provider.query(REQUEST);

    expect(outcome.evidence.map((e) => e.payload.source_metadata.dataset)).toEqual(["water"]);
    expect(outcome.unavailable_layers).toEqual([
      {
        dataset: "ebh",
        reason: "SOURCE_UNAVAILABLE",
        diagnostic: 'QueryFailedError: relation "env.ebh_potentiellt_fororenade_omraden" does not exist',
      },
    ]);
  });

  it("nothing is written to CAS for the unavailable layer -- only the executed layer's SPATIAL_EVIDENCE", async () => {
    (globalThis as any).__FAKE_PG_POOL__ = makeFakePool(REGISTRY.ebh.table);
    const repo = await repoWithProperty();
    const realPut = repo.put.bind(repo);
    const written: string[] = [];
    repo.put = vi.fn(async (artifact: Parameters<typeof realPut>[0]) => {
      written.push((artifact.body as { artifact_type?: string }).artifact_type ?? "?");
      return realPut(artifact);
    });
    const { SpatialProviderPostGIS } = await import("../src/SpatialProviderPostGIS");
    const provider = new SpatialProviderPostGIS("postgresql://fixture", repo);

    await provider.query(REQUEST);

    expect(written).toEqual(["SPATIAL_EVIDENCE"]);
  });

  it("an unavailable layer does not depend on CAS: a CAS that refuses every non-evidence write does not fail the query", async () => {
    (globalThis as any).__FAKE_PG_POOL__ = makeFakePool(REGISTRY.ebh.table);
    const repo = await repoWithProperty();
    const realPut = repo.put.bind(repo);
    repo.put = vi.fn(async (artifact: Parameters<typeof realPut>[0]) => {
      if ((artifact.body as { artifact_type?: string }).artifact_type !== "SPATIAL_EVIDENCE") {
        throw new Error("CAS write refused (simulated)");
      }
      return realPut(artifact);
    });
    const { SpatialProviderPostGIS } = await import("../src/SpatialProviderPostGIS");
    const provider = new SpatialProviderPostGIS("postgresql://fixture", repo);

    const outcome = await provider.query(REQUEST);
    expect(outcome.unavailable_layers.map((u) => [u.dataset, u.reason])).toEqual([["ebh", "SOURCE_UNAVAILABLE"]]);
  });
});
