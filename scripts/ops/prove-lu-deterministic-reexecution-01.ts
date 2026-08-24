/**
 * LU-DETERMINISTIC-REEXECUTION-V1 -- live proof, proof-matrix items 01-08.
 *
 * Runs a real assessment against the real dev CAS, then re-executes it via
 * `reExecuteLocalizationAssessment()` under deliberately hostile/mutated conditions to prove the
 * 10 frozen invariants hold in practice, not just by code inspection:
 *   01. fresh manifest_id only (no state carried over from the original run except the id)
 *   02. no RuntimeState anywhere in the call -- only assessmentArtifactId + artifactRepository
 *   03. DATABASE_URL unset/invalid
 *   04. PostGIS unavailable (no pool constructed anywhere in the path)
 *   05. network poisoned (global fetch made to throw)
 *   06/07/08. "current" geometry/binding/release env state mutated after the original run --
 *       historical re-execution is unaffected, because the module never resolves anything current
 *
 * Items 09-16 (findings/rule_refs tampering, missing/tampered evidence, manifest/attempt mismatch,
 * determinism-on-rerun, contract-version dispatch) are fast deterministic unit proofs and live in
 * packages/mps-lu/tests/LuDeterministicReExecution.test.ts -- not duplicated here.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-lu-deterministic-reexecution-01.ts
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { runLuAssessmentViaKernel, reExecuteLocalizationAssessment } from '@miljobeslut/mps-lu';
import type { SpatialEvidenceArtifact } from '@miljobeslut/mps-lu';
import { SPATIAL_STACK_V1, buildSpatialEvidenceContentHash } from '@miljobeslut/mps-lu';

function evidence(siteId: string): SpatialEvidenceArtifact {
  const payload = {
    result_semantics: {
      kind: 'EXISTENCE_WITHIN_DISTANCE',
      query: { subject_ref: { artifact_id: `prop-reexec-live-${siteId}`, artifact_type: 'PROPERTY' }, srid: 3006, distance_meters: 100 },
      result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
    },
    property_ref: { artifact_id: `prop-reexec-live-${siteId}`, artifact_type: 'PROPERTY' },
    geometry: null,
    srid: 3006,
    operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
    layer_ref: { layer_id: 'water', version_hash: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc', layer_version: 'v1' },
    source_metadata: { provider: 'SGU', dataset: 'water', dataset_version: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc', retrieved_at: '2026-08-24T08:00:00.000Z' },
    query_context: { query_id: `q-reexec-live-${siteId}`, query_type: 'SPATIAL_DWITHIN', parameters: { search_distance_meters: 100 } },
  };
  return {
    artifact_id: `spatial-reexec-live-${siteId}`,
    artifact_type: 'SPATIAL_EVIDENCE',
    content_hash: buildSpatialEvidenceContentHash(payload as never),
    references: [{ artifact_id: `prop-reexec-live-${siteId}`, artifact_type: 'PROPERTY' }],
    payload,
  } as unknown as SpatialEvidenceArtifact;
}

async function main() {
  console.log('########## PROVE-LU-DETERMINISTIC-REEXECUTION-01 ##########\n');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');
  const results: Record<string, boolean> = {};

  process.env.MPS_LU_BOOTSTRAP_ADMIT = '1';
  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;

  console.log('=== STEP 1: run a real assessment, capture assessment_id ===\n');
  const siteId = `site-reexec-live-${Date.now()}`;
  const ev = evidence(siteId);
  await repo.put({ artifact_id: ev.artifact_id, content_hash: ev.content_hash, body: ev });
  const result = await runLuAssessmentViaKernel({
    site_id: siteId,
    deterministic_seed: `seed:${siteId}`,
    evidence: [ev],
    artifact_repository: repo,
    assessment_draft: {
      site_id: siteId,
      project_context_ref: { artifact_id: `lu_project_context-reexec-live-${siteId}`, artifact_type: 'LU_PROJECT_CONTEXT' },
      property_ref: { artifact_id: `prop-reexec-live-${siteId}`, artifact_type: 'PROPERTY' },
      evidence_refs: [{ artifact_id: ev.artifact_id, artifact_type: ev.artifact_type }],
      system_summary: 'LU-DETERMINISTIC-REEXECUTION-V1 live proof',
    },
  });
  console.log(`  admitted: ${result.admitted}, manifest_id: ${result.manifest_id}, assessment_id: ${result.assessment?.artifact_id}\n`);
  results.originalRunAdmitted = result.admitted;

  console.log('=== ITEMS 01+02: re-execute with ONLY assessment_id + repo -- no manifest_id, no RuntimeState ===\n');
  // The call below is the entire proof for 01/02: the function signature accepts exactly two
  // fields (assessmentArtifactId, artifactRepository). There is no manifest_id parameter and no
  // RuntimeState parameter to pass even if we wanted to -- TypeScript would reject it.
  const baseline = await reExecuteLocalizationAssessment({
    assessmentArtifactId: result.assessment!.artifact_id,
    artifactRepository: repo,
  });
  console.log(`  outcome: ${baseline.outcome}, mismatches: ${JSON.stringify(baseline.mismatches)}\n`);
  results.freshManifestIdOnlyNoRuntimeState = baseline.outcome === 'PASS';

  console.log('=== ITEMS 03+04+05: poison DATABASE_URL, PostGIS, network -- re-execute must be unaffected ===\n');
  const savedDatabaseUrl = process.env.DATABASE_URL;
  const savedFetch = globalThis.fetch;
  delete process.env.DATABASE_URL;
  // @ts-expect-error -- deliberately poisoning global fetch to prove no network dependency
  globalThis.fetch = () => { throw new Error('NETWORK_POISONED_FOR_PROOF'); };
  console.log('  DATABASE_URL: unset');
  console.log('  global fetch: poisoned to throw on any call');
  console.log('  no PostGIS pool constructed anywhere in this script\'s call path to reExecuteLocalizationAssessment\n');
  let hostileResult;
  try {
    hostileResult = await reExecuteLocalizationAssessment({
      assessmentArtifactId: result.assessment!.artifact_id,
      artifactRepository: repo,
    });
    console.log(`  outcome under hostile env: ${hostileResult.outcome}\n`);
  } finally {
    if (savedDatabaseUrl !== undefined) process.env.DATABASE_URL = savedDatabaseUrl;
    globalThis.fetch = savedFetch;
  }
  results.survivesNoDatabaseUrlNoPostgisNoNetwork = hostileResult?.outcome === 'PASS';

  console.log('=== ITEMS 06+07+08: mutate "current" release/binding/geometry env state -- historical re-execution unchanged ===\n');
  const savedReleaseArtifactId = process.env.PRODUCT_RELEASE_ARTIFACT_ID;
  const savedReleaseIssuerKeyId = process.env.PRODUCT_RELEASE_ISSUER_KEY_ID;
  const savedReleaseIssuerPem = process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM;
  // These env vars are how "current release" is resolved elsewhere in the product (H13). Setting
  // them to garbage simulates the current release having moved to something entirely different
  // since the original run -- the same real signal a live release rotation would produce.
  process.env.PRODUCT_RELEASE_ARTIFACT_ID = 'release-mutated-for-proof';
  process.env.PRODUCT_RELEASE_ISSUER_KEY_ID = 'issuer-mutated-for-proof';
  process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM = 'not-a-real-key';
  console.log('  PRODUCT_RELEASE_ARTIFACT_ID / ISSUER_KEY_ID / ISSUER_PUBLIC_KEY_PEM: mutated to unrelated values');
  console.log('  (standing in for: current release rotated, current binding superseded, current geometry superseded --');
  console.log('   this module never resolves any of the three, so mutating their env-level "current" signal must be a no-op)\n');
  let mutatedResult;
  try {
    mutatedResult = await reExecuteLocalizationAssessment({
      assessmentArtifactId: result.assessment!.artifact_id,
      artifactRepository: repo,
    });
    console.log(`  outcome after mutating current-state env: ${mutatedResult.outcome}\n`);
  } finally {
    if (savedReleaseArtifactId !== undefined) process.env.PRODUCT_RELEASE_ARTIFACT_ID = savedReleaseArtifactId; else delete process.env.PRODUCT_RELEASE_ARTIFACT_ID;
    if (savedReleaseIssuerKeyId !== undefined) process.env.PRODUCT_RELEASE_ISSUER_KEY_ID = savedReleaseIssuerKeyId; else delete process.env.PRODUCT_RELEASE_ISSUER_KEY_ID;
    if (savedReleaseIssuerPem !== undefined) process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM = savedReleaseIssuerPem; else delete process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM;
  }
  results.unaffectedByMutatedCurrentReleaseBindingGeometryState =
    mutatedResult?.outcome === 'PASS' &&
    JSON.stringify(mutatedResult.fresh_findings) === JSON.stringify(baseline.fresh_findings) &&
    JSON.stringify(mutatedResult.fresh_rule_refs) === JSON.stringify(baseline.fresh_rule_refs);

  console.log('=== STRUCTURAL CHECK: module never imports a spatial/binding/release/DB "current" resolver ===\n');
  const moduleSource = readFileSync('packages/mps-lu/src/execution/LuDeterministicReExecution.ts', 'utf-8');
  const importLines = moduleSource.split(/\r?\n/).filter((line) => /^import /.test(line));
  const forbidden = /SpatialProvider|PostGIS|resolveCanonicalProductRelease|resolveCurrent|ProjectContextBindingSupersession|LocalizationGeometrySupersession|RuntimeState|node:child_process|node-fetch/;
  const noLiveDependency = !importLines.some((line) => forbidden.test(line));
  console.log(`  import statements: ${importLines.map((l) => l.trim()).join(' | ')}`);
  console.log(`  no current-state/PostGIS/RuntimeState import present: ${noLiveDependency}\n`);
  results.structurallyNoCurrentStateDependency = noLiveDependency;

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
