/**
 * SPATIAL-DATASET-RUNTIME-BINDING-V1 -- live proof.
 *
 * Runs against the real dev DB/CAS. Proves, using the REAL `PostgisImportBatch` rows already in
 * this database (no mutation -- read-only against that table):
 *
 *   1. POSITIVE: every real layer in SpatialLayerRegistry.ts currently has a matching SUCCESS
 *      batch row, so a real SpatialProviderPostGIS.query() call succeeds unchanged.
 *   2. NEGATIVE: the exact mechanism the contract exists to catch -- a claimed `version_hash`
 *      that does not match what the connected database's own governed batch record says was
 *      actually materialized -- is denied, using the real connection and real batch data (the
 *      mismatch is simulated on the CLAIM side, i.e. as if the registry claimed a different
 *      hash than what's really there; this is the same code path and the same real-DB read as a
 *      genuine DATABASE_URL swap would exercise, without needing a second physical Postgres
 *      instance provisioned just for this proof).
 *
 * Usage: npx tsx scripts/ops/prove-spatial-dataset-runtime-binding-01.ts
 */
import '../../server/loadEnvFirst';
import { Pool } from 'pg';
import { SPATIAL_LAYER_REGISTRY } from '../../packages/spatial-provider-postgis/src/SpatialLayerRegistry';
import {
  verifySpatialLayerRuntimeBinding,
  SpatialLayerRuntimeBindingError,
} from '../../packages/spatial-provider-postgis/src/SpatialDatasetRuntimeBinding';

async function main() {
  console.log('########## PROVE-SPATIAL-DATASET-RUNTIME-BINDING-01 ##########\n');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const results: Record<string, boolean> = {};

  console.log('=== POSITIVE: every real registry layer currently binds cleanly ===\n');
  for (const [layerName, binding] of Object.entries(SPATIAL_LAYER_REGISTRY)) {
    try {
      await verifySpatialLayerRuntimeBinding(pool, binding);
      console.log(`  ${layerName} (${binding.table}): PASS`);
      results[`positive_${layerName}`] = true;
    } catch (error) {
      console.log(`  ${layerName} (${binding.table}): FAIL -- ${error instanceof Error ? error.message : String(error)}`);
      results[`positive_${layerName}`] = false;
    }
  }

  console.log('\n=== NEGATIVE: claimed hash diverges from the real connected database\'s batch record ===\n');
  const waterBinding = SPATIAL_LAYER_REGISTRY.water!;
  const tamperedClaim = { ...waterBinding, version_hash: 'deliberately-wrong-hash-simulating-a-different-materialized-dataset' };
  try {
    await verifySpatialLayerRuntimeBinding(pool, tamperedClaim);
    console.log('  UNEXPECTED: mismatched claim was accepted -- negative proof FAILED\n');
    results.negativeDenied = false;
  } catch (error) {
    const isRightError = error instanceof SpatialLayerRuntimeBindingError && error.code === 'REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISMATCH';
    console.log(`  DENIED as expected: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`  correct error code (REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISMATCH): ${isRightError}\n`);
    results.negativeDenied = isRightError;
  }

  console.log('=== NEGATIVE: a layer with no SUCCESS batch row at all is denied ===\n');
  const noBatchBinding = { ...waterBinding, table: 'env.this_table_has_no_batch_row_at_all' };
  try {
    await verifySpatialLayerRuntimeBinding(pool, noBatchBinding);
    console.log('  UNEXPECTED: accepted with no batch row -- negative proof FAILED\n');
    results.negativeMissingDenied = false;
  } catch (error) {
    const isRightError = error instanceof SpatialLayerRuntimeBindingError && error.code === 'REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISSING';
    console.log(`  DENIED as expected: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`  correct error code (REJECT_SPATIAL_LAYER_RUNTIME_BINDING_MISSING): ${isRightError}\n`);
    results.negativeMissingDenied = isRightError;
  }

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(results, null, 2));
  const ok = Object.values(results).every(Boolean);
  console.log(`\nALL GREEN: ${ok}`);

  await pool.end();
  process.exitCode = ok ? 0 : 1;
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  process.exitCode = 1;
});
