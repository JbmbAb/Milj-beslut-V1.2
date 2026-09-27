import { describe, it, expect, vi } from "vitest";
import type { LUPropertyContextArtifact } from "@miljobeslut/mps-lu";
import type { ArtifactRepositoryPort } from "../../mps-runtime/src/kernel/ExecutionKernel";
import type { SpatialQueryRequest } from "@miljobeslut/mps-lu/src/services/SpatialQueryContract";

/**
 * SEM-1 / W2 — RED/GREEN probe for per-layer isolation in SpatialProviderPostGIS.query().
 *
 * Registered LU layers and their real PostGIS tables (SpatialLayerRegistry.ts), so this fixture
 * can distinguish "the failing layer's own ST_DWithin query" from every other layer's query and
 * from the runtime-binding identity check, which must keep denying the whole batch unchanged.
 */
const REGISTRY: Record<string, { table: string; version_hash: string }> = {
  water: { table: "env.sgu_well", version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc" },
  ebh: { table: "env.ebh_potentiellt_fororenade_omraden", version_hash: "02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186" },
  protected_area: { table: "env.protected_area", version_hash: "983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae" },
};

const PROPERTY_ARTIFACT: LUPropertyContextArtifact = {
  artifact_id: "prop-layer-isolation-fixture",
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

/**
 * A minimal pg.Pool fake: answers the runtime-binding identity check truthfully for every
 * registered layer (so that check never denies the batch), and answers each layer's own
 * ST_DWithin existence query with a normal empty result -- EXCEPT for `failingTable`, whose
 * ST_DWithin query throws a plain technical error, simulating a real query-execution failure
 * (never an identity/admission failure) on exactly one layer.
 */
function makeFakePool(failingTable: string) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("PostgisImportBatch")) {
        const [schema, table] = params as [string, string];
        const qualified = `${schema}.${table}`;
        const entry = Object.values(REGISTRY).find((r) => r.table === qualified);
        if (!entry) {
          throw new Error(`FIXTURE GAP: no registry entry for ${qualified}`);
        }
        return { rows: [{ content_bundle_sha256: entry.version_hash, dataset_version: null }] };
      }
      for (const entry of Object.values(REGISTRY)) {
        if (sql.includes(`FROM ${entry.table}`)) {
          if (entry.table === failingTable) {
            throw new Error(
              `RED_PROBE_FIXTURE: simulated technical query failure on ${entry.table} ` +
                `(e.g. connection reset) -- NOT an identity/admission failure`,
            );
          }
          return { rows: [], rowCount: 0 };
        }
      }
      throw new Error(`FIXTURE GAP: unrecognized query: ${sql}`);
    }),
    end: vi.fn(async () => {}),
  };
}

const FAKE_REPO: ArtifactRepositoryPort = {
  resolve: vi.fn(async (ref: { artifact_id: string }) => {
    if (ref.artifact_id === PROPERTY_ARTIFACT.artifact_id) {
      return PROPERTY_ARTIFACT;
    }
    throw new Error("not present — continue to first-write");
  }),
  put: vi.fn(async () => {}),
} as unknown as ArtifactRepositoryPort;

vi.mock("pg", () => {
  // A plain `function`, not an arrow: `new Pool(...)` requires a constructible value, and an
  // arrow-function mock implementation throws "is not a constructor" -- proven by an isolated
  // repro before this fix.
  const PoolMock = vi.fn().mockImplementation(function FakePool() {
    return (globalThis as any).__FAKE_PG_POOL__;
  });
  // Both shapes are needed: SpatialProviderPostGIS does `import { Pool } from "pg"`, but this
  // module graph transitively pulls in server/db/prisma.ts (via @miljobeslut/mps-lu's
  // LUBackendOrchestrator barrel export), which does `import pg from "pg"; new pg.Pool(...)`.
  // Providing only the named export leaves the default-import consumer unmocked.
  return {
    Pool: PoolMock,
    default: { Pool: PoolMock },
  };
});

describe("SEM-1 W2: SpatialProviderPostGIS per-layer isolation", () => {
  it(
    "a single layer's technical query failure (ebh) must not discard the other layers' " +
      "evidence (water, protected_area); query() must isolate it and report it explicitly, " +
      "never as exists:false and never by throwing for the whole batch -- FAILS on base " +
      "038286ed (query() throws for everything today), PASSES once query() isolates per-layer " +
      "failures",
    async () => {
      (globalThis as any).__FAKE_PG_POOL__ = makeFakePool(REGISTRY.ebh.table);

      const { SpatialProviderPostGIS } = await import("../src/SpatialProviderPostGIS");
      const provider = new SpatialProviderPostGIS("postgresql://fixture", FAKE_REPO);

      const request: SpatialQueryRequest = {
        property_ref: { artifact_id: PROPERTY_ARTIFACT.artifact_id, artifact_type: PROPERTY_ARTIFACT.artifact_type },
        layers: [
          { name: "water", version_hash: "v1.0" },
          { name: "ebh", version_hash: "v1.0" },
          { name: "protected_area", version_hash: "v1.0" },
        ],
      } as SpatialQueryRequest;

      // Desired, fixed behavior (this is what must be true on the candidate). On base
      // 038286ed, `query()` still returns `Promise<SpatialEvidenceArtifact[]>` and REJECTS
      // instead of resolving to this shape, so this assertion fails closed (uncaught rejection)
      // -- the correct RED result, proving the defect without a separate "current behavior"
      // assertion that would need deleting later.
      const outcome = await provider.query(request);

      expect(outcome.unavailable_layers).toHaveLength(1);
      expect(outcome.unavailable_layers[0]).toMatchObject({ dataset: "ebh" });
      expect(typeof outcome.unavailable_layers[0].reason).toBe("string");
      expect(outcome.unavailable_layers[0].reason.length).toBeGreaterThan(0);

      expect(outcome.evidence).toHaveLength(2);
      const datasets = outcome.evidence.map((e) => e.payload.source_metadata.dataset).sort();
      expect(datasets).toEqual(["protected_area", "water"]);
    },
  );
});
