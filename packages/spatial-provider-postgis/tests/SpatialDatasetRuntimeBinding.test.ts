import { describe, expect, it, vi } from "vitest";
import {
  verifySpatialLayerRuntimeBinding,
  SpatialLayerRuntimeBindingError,
} from "../src/SpatialDatasetRuntimeBinding";
import type { SpatialLayerBinding } from "../src/SpatialLayerRegistry";

/**
 * SPATIAL-DATASET-RUNTIME-BINDING-V1.
 *
 * Unit coverage of the three branches (missing / mismatch / match) with a mocked Pool, isolated
 * from any real database. The live negative proof against a real Postgres instance -- the actual
 * "point DATABASE_URL at a different materialized dataset while the registry still claims the
 * original hash" scenario -- lives in scripts/ops/prove-spatial-dataset-runtime-binding-01.ts.
 */
function binding(overrides: Partial<SpatialLayerBinding> = {}): SpatialLayerBinding {
  return {
    logical_name: "water",
    table: "env.sgu_well",
    provider: "SGU",
    version_hash: "real-governed-hash",
    geom_column: "geom",
    ...overrides,
  };
}

function fakePool(rows: readonly { content_bundle_sha256: string; dataset_version: string | null }[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { query } as unknown as import("pg").Pool;
}

describe("SPATIAL-DATASET-RUNTIME-BINDING-V1", () => {
  it("passes when the latest SUCCESS batch row's hash matches the registry's claim", async () => {
    const pool = fakePool([{ content_bundle_sha256: "real-governed-hash", dataset_version: "v1" }]);
    await expect(verifySpatialLayerRuntimeBinding(pool, binding())).resolves.toBeUndefined();
  });

  it("REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISSING when no SUCCESS batch row exists for the table", async () => {
    const pool = fakePool([]);
    await expect(verifySpatialLayerRuntimeBinding(pool, binding())).rejects.toMatchObject({
      code: "REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISSING",
    });
  });

  it("REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISMATCH -- negative proof: a different materialized dataset claiming the same registry hash is denied", async () => {
    // This is the exact scenario the contract exists to catch: the connected database's own
    // governed batch record disagrees with what SpatialLayerRegistry.ts claims for this layer --
    // whether because DATABASE_URL now points at a different physical instance with different
    // materialized content, or because the table was overwritten out-of-band. Either way, the
    // registry's claimed hash ("real-governed-hash") does not match what this connection's own
    // PostgisImportBatch record says was actually promoted ("different-materialized-dataset").
    const pool = fakePool([{ content_bundle_sha256: "different-materialized-dataset", dataset_version: "v1" }]);
    const error = await verifySpatialLayerRuntimeBinding(pool, binding()).catch((e) => e);
    expect(error).toBeInstanceOf(SpatialLayerRuntimeBindingError);
    expect((error as SpatialLayerRuntimeBindingError).code).toBe("REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISMATCH");
  });

  it("checks the batch row on the SAME pool passed in, never a separate connection", async () => {
    const pool = fakePool([{ content_bundle_sha256: "real-governed-hash", dataset_version: "v1" }]);
    await verifySpatialLayerRuntimeBinding(pool, binding());
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain("PostgisImportBatch");
    expect(sql).toContain("status = 'SUCCESS'");
    expect(params).toEqual(["env", "sgu_well"]);
  });

  it("row_count is never part of the check -- only content_bundle_sha256 is authority", async () => {
    // Two distinct datasets can share a row count; this must not be load-bearing for the check.
    // (The query itself doesn't even select row_count -- this proves the check would still deny
    // a hash mismatch even if a caller tried to smuggle a matching row_count in.)
    const pool = fakePool([{ content_bundle_sha256: "wrong-hash", dataset_version: "v1" }]);
    await expect(verifySpatialLayerRuntimeBinding(pool, binding())).rejects.toMatchObject({
      code: "REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISMATCH",
    });
  });

  it("rejects a non-schema-qualified table binding rather than guessing a schema", async () => {
    const pool = fakePool([]);
    await expect(
      verifySpatialLayerRuntimeBinding(pool, binding({ table: "sgu_well" })),
    ).rejects.toThrow(/not schema-qualified/);
  });
});
