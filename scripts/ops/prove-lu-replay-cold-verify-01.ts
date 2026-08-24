/**
 * LU-REPLAY-COLD-VERIFY-V1 -- live proof.
 *
 * Runs a real assessment against the real dev CAS, then verifies it via
 * `DefaultReplayEngine.replayFromManifestId()` -- manifest_id only, no RuntimeState carried over
 * -- under deliberately hostile conditions: DATABASE_URL unset, no PostGIS import anywhere in the
 * replay path, no "current" release/geometry/binding resolver reachable.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-lu-replay-cold-verify-01.ts
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { runLuAssessmentViaKernel } from '@miljobeslut/mps-lu';
import { DefaultReplayEngine } from '../../packages/mps-runtime/src/replay/DefaultReplayEngine';
import type { SpatialEvidenceArtifact } from '@miljobeslut/mps-lu';
import { SPATIAL_STACK_V1 } from '@miljobeslut/mps-lu';

function evidence(): SpatialEvidenceArtifact {
  return {
    artifact_id: 'spatial-cold-verify-live',
    artifact_type: 'SPATIAL_EVIDENCE',
    content_hash: { algorithm: 'sha256', value: 'spatial-hash-cold-verify-live' },
    references: [{ artifact_id: 'prop-cold-verify-live', artifact_type: 'PROPERTY' }],
    payload: {
      result_semantics: {
        kind: 'EXISTENCE_WITHIN_DISTANCE',
        query: { subject_ref: { artifact_id: 'prop-cold-verify-live', artifact_type: 'PROPERTY' }, srid: 3006, distance_meters: 100 },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: 'prop-cold-verify-live', artifact_type: 'PROPERTY' },
      geometry: null,
      srid: 3006,
      operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
      layer_ref: { layer_id: 'water', version_hash: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc', layer_version: 'v1' },
      source_metadata: { provider: 'SGU', dataset: 'water', dataset_version: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc', retrieved_at: '2026-08-13T08:00:00.000Z' },
      query_context: { query_id: 'q-cold-verify-live', query_type: 'SPATIAL_DWITHIN', parameters: { search_distance_meters: 100 } },
    },
  } as unknown as SpatialEvidenceArtifact;
}

async function main() {
  console.log('########## PROVE-LU-REPLAY-COLD-VERIFY-01 ##########\n');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');
  const results: Record<string, boolean> = {};

  process.env.MPS_LU_BOOTSTRAP_ADMIT = '1';
  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;

  console.log('=== STEP 1: run a real assessment, capture manifest_id ===\n');
  const ev = evidence();
  await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
  const siteId = `site-cold-verify-live-${Date.now()}`;
  const result = await runLuAssessmentViaKernel({
    site_id: siteId,
    deterministic_seed: `seed:${siteId}`,
    evidence: [ev],
    artifact_repository: repo,
  });
  console.log(`  admitted: ${result.admitted}, manifest_id: ${result.manifest_id}\n`);
  results.originalRunAdmitted = result.admitted;

  console.log('=== STEP 2: poison the environment before cold verify ===\n');
  const savedDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PRODUCT_RELEASE_ARTIFACT_ID;
  delete process.env.PRODUCT_RELEASE_ISSUER_KEY_ID;
  delete process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM;
  console.log('  DATABASE_URL: unset');
  console.log('  PRODUCT_RELEASE_ARTIFACT_ID / PRODUCT_RELEASE_ISSUER_*: unset (no "current release" reachable)\n');

  console.log('=== STEP 3: cold verify -- manifest_id only, no RuntimeState, hostile env ===\n');
  try {
    const coldEngine = new DefaultReplayEngine(repo);
    const replay = await coldEngine.replayFromManifestId(result.manifest_id);
    console.log(`  replayed_outcome_ref: ${replay.replayed_outcome_ref.artifact_id}`);
    console.log(`  equivalence_proof: ${replay.equivalence_proof.value}\n`);
    results.coldVerifySucceededUnderHostileEnv =
      replay.replayed_outcome_ref.artifact_id === `outcome-attempt-${result.manifest_id}-1`;
  } catch (error) {
    console.log(`  UNEXPECTED FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    results.coldVerifySucceededUnderHostileEnv = false;
  } finally {
    if (savedDatabaseUrl !== undefined) process.env.DATABASE_URL = savedDatabaseUrl;
  }

  console.log('=== STRUCTURAL CHECK: no PostGIS / spatial-provider import anywhere in the replay module ===\n');
  const replaySource = readFileSync('packages/mps-runtime/src/replay/DefaultReplayEngine.ts', 'utf-8');
  const importLines = replaySource.split(/\r?\n/).filter((line) => /^import /.test(line));
  const codeOnly = replaySource
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  const noLiveDependency =
    !importLines.some((line) => /SpatialProvider|PostGIS|resolveCanonicalProductRelease|resolveCurrent/.test(line)) &&
    !codeOnly.includes('process.env');
  console.log(`  DefaultReplayEngine.ts import statements: ${importLines.map((l) => l.trim()).join(' | ')}`);
  console.log(`  DefaultReplayEngine.ts has no PostGIS/current-resolver/env dependency in actual code: ${noLiveDependency}\n`);
  results.structurallyNoLiveDependency = noLiveDependency;

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(results, null, 2));
  const ok = Object.values(results).every(Boolean);
  console.log(`\nALL GREEN: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exitCode = 1;
});
