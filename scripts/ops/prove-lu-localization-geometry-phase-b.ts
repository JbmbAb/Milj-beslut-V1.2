/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 Phase B -- real, live proof run against the real dev
 * DB/CAS and the real ORSA STACKMORA 3:12 project (`cmt2m7bdj0000h0f7uj4jykis`), the same project
 * this session's prior live proofs (ORSA-VIEWER-CAPABILITY-PROVISIONING-01,
 * ORSA-EXECUTION-IDENTITY-REISSUE-01) used as evidence -- left in place afterward as evidence for
 * this unit too, not a disposable/synthetic project.
 *
 * Reuses, does not recreate: the existing persisted ProjectContextBindingIssuer and LU execution
 * authority root+issuer keys (~/.mimers/secrets/...). No new key, issuer, trust root, or authority
 * is created here. Private key material is loaded and used only inside this offline script's own
 * process; it is never written to .env/.env.local.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" PRODUCT_RELEASE_ARTIFACT_ID=<verified-release> npx tsx scripts/ops/prove-lu-localization-geometry-phase-b.ts --execute
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  deriveLuExecutionSeed,
  createLocalizationGeometryArtifact,
  LU_EXECUTION_PRINCIPAL_ID,
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
} from '@miljobeslut/mps-lu';
import { createLuRegistryRuntime } from '../../packages/mps-lu/src/registry/createLuRegistryRuntime';
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from '../../packages/mps-lu/src/registry/LuSiteAssessmentRegistry';
import { issueExecutionIdentityV3 } from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import { verifyLuExecutionAuthorityChain } from '../../packages/mps-lu/src/execution/LuExecutionAuthorityChain';
import { resolveCanonicalProjectContext } from '../../src/application/resolveCanonicalProjectContext';
import { resolveCanonicalProductRelease } from '../../server/modules/release/productReleaseRuntime';
import { registerLocalizationGeometry, resolveCurrentLocalizationGeometry } from '../../server/modules/localization/localizationGeometryProjection';
import { resolveCurrentAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../server/security/projectContextBindingIssuerKey';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';
import { createLocalizationSpatialRuntime } from '../../server/modules/localization/createLocalizationSpatialRuntime';
import { SpatialProviderPostGIS } from '../../packages/spatial-provider-postgis/src/SpatialProviderPostGIS';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const REAL_ISSUER_REF = { artifact_id: 'lu-execution-authority-issuer-8a7861f9da74621c6bda9032', artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE } as const;

// Point A: near ORSA Stackmora. Point B: a genuinely different point several km away, so the
// coordinate assertions below are not a coincidence of rounding.
const POINT_A = { wgs84LngLat: [14.5, 61.15] as const, sweref99: [6789000, 490000] as const, label: 'Proof point A' };
const POINT_B = { wgs84LngLat: [14.55, 61.20] as const, sweref99: [6795000, 492000] as const, label: 'Proof point B (moved)' };

function loadRealKeys() {
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = 'project-context-binding-issuer-v1-fb38fb09cba8f5f8';
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`, 'utf8');

  const rootKeyId = 'ed25519:lu-execution-root-v1-839f2a91ad203e79';
  const rootPublic = readFileSync(`${SECRETS_DIR}/lu-execution-authority/root-public.pem`, 'utf8');
  const issuerKeyId = 'ed25519:lu-execution-issuer-v1-656368e58631c925';
  const issuerPublic = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-public.pem`, 'utf8');
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = issuerKeyId;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = issuerPublic;
  process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = readFileSync(`${SECRETS_DIR}/lu-execution-authority/issuer-private.pem`, 'utf8');
  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = rootKeyId;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = rootPublic;

  return {
    rootVerification: new LocalPemVerificationKeyProvider(rootKeyId, rootPublic),
    issuerVerification: new LocalPemVerificationKeyProvider(issuerKeyId, issuerPublic),
  };
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('refusing to write without --execute');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  const { rootVerification, issuerVerification } = loadRealKeys();
  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;

  await verifyLuExecutionAuthorityChain({ issuerRef: REAL_ISSUER_REF, repository: repo, rootVerification, issuerVerification });
  console.log(`STEP 0 PASS: reused, verified LU execution authority chain (issuer=${REAL_ISSUER_REF.artifact_id})`);

  const canonicalContext = await resolveCanonicalProjectContext(PROJECT_ID, repo);
  const release = await resolveCanonicalProductRelease({ artifactRepository: repo });
  const currentRelease = {
    releaseRef: { artifact_id: release.artifact_id, artifact_type: release.artifact_type },
    releaseHash: release.release_hash.value,
  };
  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY);
  if (!capability) throw new Error('LU capability unavailable');
  console.log(`STEP 1 PASS: canonical context resolved. binding=${canonicalContext.contextBindingRef.artifact_id} property=${canonicalContext.propertyIdentity}`);

  async function issueAndRunFor(point: typeof POINT_A) {
    const geometry = createLocalizationGeometryArtifact({
      project_id: PROJECT_ID,
      property_context_ref: canonicalContext.propertyContextRef,
      wgs84LngLat: [...point.wgs84LngLat],
      sweref99NorthingEasting: [...point.sweref99],
      provenance: 'user_defined',
      label: point.label,
      created_by: 'PRODUCT-LU-LOCALIZATION-GEOMETRY-01-live-proof',
    });
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });
    await registerLocalizationGeometry({ projectId: PROJECT_ID, geometry });
    const geometryRef = { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type };

    const subject = {
      site_id: canonicalContext.propertyIdentity,
      project_context_binding_ref: canonicalContext.contextBindingRef,
      product_release_ref: currentRelease.releaseRef,
      execution_contract_version: 'lu-execution-identity-v1',
      localization_geometry_ref: geometryRef,
    };
    const seed = deriveLuExecutionSeed({
      site_id: subject.site_id,
      project_id: PROJECT_ID,
      project_context_ref: canonicalContext.projectContextRef,
      property_context_ref: canonicalContext.propertyContextRef,
      project_context_binding_ref: canonicalContext.contextBindingRef,
      product_release_ref: currentRelease.releaseRef,
      product_release_hash: currentRelease.releaseHash,
      execution_contract_version: subject.execution_contract_version,
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      localization_geometry_ref: geometryRef,
    });
    const identity = await issueExecutionIdentityV3({
      subject,
      deterministic_seed: seed,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      issuer_ref: REAL_ISSUER_REF,
      governed_references: [canonicalContext.contextBindingRef, canonicalContext.projectContextRef, canonicalContext.propertyContextRef, currentRelease.releaseRef, geometryRef],
      artifact_repository: repo,
    });
    console.log(`  issued V3 identity ${identity.artifact_id} for ${point.label} (geometry=${geometry.artifact_id})`);

    const report = await new GenerateLocalizationReportUseCase(createLocalizationSpatialRuntime).execute({
      projectId: PROJECT_ID,
      siteAlternatives: [{ id: 'live-proof-alt', lat: point.wgs84LngLat[1], lng: point.wgs84LngLat[0] }],
    });
    const motor = report.siteAnalyses[0].executionMotor;
    console.log(`  run result: admitted=${motor?.admitted} reason_codes=${JSON.stringify(motor?.reason_codes)} assessment=${motor?.assessment_artifact_id} manifest=${motor?.manifest_id}`);
    return { geometry, geometryRef, identity, motor };
  }

  console.log('\n=== POINT A: issue + run ===');
  const a = await issueAndRunFor(POINT_A);
  if (!a.motor?.admitted || !a.motor.assessment_artifact_id) throw new Error('PROOF FAILED: point A run was not admitted / produced no assessment');
  console.log('  PROOF PASS: point A admitted, assessment persisted.');

  console.log('\n=== MOVE TO POINT B (register only, do NOT issue identity yet) ===');
  const geometryB = createLocalizationGeometryArtifact({
    project_id: PROJECT_ID,
    property_context_ref: canonicalContext.propertyContextRef,
    wgs84LngLat: [...POINT_B.wgs84LngLat],
    sweref99NorthingEasting: [...POINT_B.sweref99],
    provenance: 'user_defined',
    label: POINT_B.label,
    created_by: 'PRODUCT-LU-LOCALIZATION-GEOMETRY-01-live-proof',
  });
  await repo.put({ artifact_id: geometryB.artifact_id, content_hash: geometryB.content_hash, body: geometryB });
  await registerLocalizationGeometry({ projectId: PROJECT_ID, geometry: geometryB });
  const currentAfterMove = await resolveCurrentLocalizationGeometry({ projectId: PROJECT_ID, artifactRepository: repo });
  if (currentAfterMove.geometryArtifactId !== geometryB.artifact_id) throw new Error('PROOF FAILED: current geometry did not become point B after registration');
  console.log(`  PROOF PASS: current localization geometry is now B (${geometryB.artifact_id}), not A (${a.geometry.artifact_id}).`);

  console.log('\n=== RUN WITH ONLY A\'S IDENTITY (no identity issued for B yet) -> must DENY ===');
  const denyReport = await new GenerateLocalizationReportUseCase(createLocalizationSpatialRuntime).execute({
    projectId: PROJECT_ID,
    siteAlternatives: [{ id: 'live-proof-alt', lat: POINT_B.wgs84LngLat[1], lng: POINT_B.wgs84LngLat[0] }],
  });
  const denyMotor = denyReport.siteAnalyses[0].executionMotor;
  console.log(`  run result: admitted=${denyMotor?.admitted} reason_codes=${JSON.stringify(denyMotor?.reason_codes)}`);
  if (denyMotor?.admitted) throw new Error('PROOF FAILED: run against point B was admitted using an identity minted only for point A');
  console.log("  PROOF PASS: point A's identity cannot authorize point B -- denied.");

  console.log('\n=== POINT B: issue matching identity + run -> must ACCEPT with a distinct identity/manifest ===');
  const b = await issueAndRunFor(POINT_B);
  if (!b.motor?.admitted || !b.motor.assessment_artifact_id) throw new Error('PROOF FAILED: point B run was not admitted after issuing its own identity');
  if (b.identity.artifact_id === a.identity.artifact_id) throw new Error('PROOF FAILED: identical ExecutionIdentity artifact_id for A and B');
  if (b.motor.manifest_id === a.motor.manifest_id) throw new Error('PROOF FAILED: identical manifest_id for A and B');
  if (b.motor.assessment_artifact_id === a.motor.assessment_artifact_id) throw new Error('PROOF FAILED: identical assessment_artifact_id for A and B');
  console.log('  PROOF PASS: distinct V3 identity, distinct manifest, distinct assessment for point B.');

  console.log('\n=== CURRENT ASSESSMENT RESOLUTION: must be B, not A ===');
  const currentBindingProvider = new ProjectContextBindingProvider(repo, new PrismaProjectContextBindingIndex(), getProjectContextBindingIssuerVerifier());
  const currentGeometryFinal = await resolveCurrentLocalizationGeometry({ projectId: PROJECT_ID, artifactRepository: repo });
  const currentAssessment = await resolveCurrentAssessmentProjection({
    projectId: PROJECT_ID,
    artifactRepository: repo,
    currentBindingProvider,
    currentLocalizationGeometryArtifactId: currentGeometryFinal.geometryArtifactId,
  });
  console.log(`  current assessment = ${currentAssessment.assessmentArtifactId}`);
  if (currentAssessment.assessmentArtifactId !== b.motor.assessment_artifact_id) throw new Error('PROOF FAILED: current assessment is not B');
  if (currentAssessment.assessmentArtifactId === a.motor.assessment_artifact_id) throw new Error('PROOF FAILED: current assessment resolved to A');
  console.log('  PROOF PASS: current assessment resolves to B, not A.');

  console.log('\n=== HISTORICAL A: still readable by exact ref, immutable ===');
  const historicalA = await repo.resolve<{ artifact_id: string; payload: { localization_geometry_ref?: { artifact_id: string } } }>({
    artifact_id: a.motor.assessment_artifact_id!,
    artifact_type: 'LOCALIZATION_ASSESSMENT',
  });
  if (historicalA.artifact_id !== a.motor.assessment_artifact_id) throw new Error('PROOF FAILED: historical assessment A no longer resolves by its own ref');
  if (historicalA.payload.localization_geometry_ref?.artifact_id !== a.geometry.artifact_id) throw new Error('PROOF FAILED: historical assessment A does not carry point A\'s geometry ref');
  console.log('  PROOF PASS: assessment A remains immutable and resolvable by exact ref, still bound to point A.');

  console.log("\n=== SPATIAL QUERY: verify the exact point reached PostGIS, not the property centroid ===");
  const provider = new SpatialProviderPostGIS(process.env.DATABASE_URL!, repo);
  const capturedParams: Array<{ label: string; easting: number; northing: number }> = [];
  const originalPoolQuery = (provider as unknown as { pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> } }).pool.query.bind(
    (provider as unknown as { pool: unknown }).pool,
  );
  (provider as unknown as { pool: { query: typeof originalPoolQuery } }).pool.query = (async (sql: string, params?: unknown[]) => {
    const result = await originalPoolQuery(sql, params);
    if (sql.includes('ST_DWithin') && params) {
      const [easting, northing] = params as [number, number, number, number];
      capturedParams.push({ label: 'unlabeled', easting, northing });
    }
    return result;
  }) as typeof originalPoolQuery;

  await provider.query({ property_ref: canonicalContext.propertyContextRef, location_ref: a.geometryRef, layers: [{ name: 'water', version_hash: 'v1.0' }] });
  await provider.query({ property_ref: canonicalContext.propertyContextRef, location_ref: b.geometryRef, layers: [{ name: 'water', version_hash: 'v1.0' }] });
  await provider.close();

  console.log(`  captured query points: ${JSON.stringify(capturedParams)}`);
  if (capturedParams.length !== 2) throw new Error(`PROOF FAILED: expected 2 captured spatial queries, got ${capturedParams.length}`);
  const [capturedA, capturedB] = capturedParams;
  if (capturedA.northing !== POINT_A.sweref99[0] || capturedA.easting !== POINT_A.sweref99[1]) throw new Error('PROOF FAILED: query for A did not use point A\'s exact SWEREF coordinates');
  if (capturedB.northing !== POINT_B.sweref99[0] || capturedB.easting !== POINT_B.sweref99[1]) throw new Error('PROOF FAILED: query for B did not use point B\'s exact SWEREF coordinates');
  if (capturedA.northing === canonicalContext.coordinates[0] && capturedA.easting === canonicalContext.coordinates[1]) {
    throw new Error('PROOF FAILED: query used the property centroid instead of the explicit point');
  }
  console.log('  PROOF PASS: spatial query used the exact explicit point for both A and B, never the property centroid.');

  console.log('\nALL PHASE B LIVE PROOFS PASS');
  console.log(
    JSON.stringify(
      {
        project_id: PROJECT_ID,
        point_a: { geometry_ref: a.geometryRef, identity: a.identity.artifact_id, manifest: a.motor.manifest_id, assessment: a.motor.assessment_artifact_id },
        point_b: { geometry_ref: b.geometryRef, identity: b.identity.artifact_id, manifest: b.motor.manifest_id, assessment: b.motor.assessment_artifact_id },
        current_assessment: currentAssessment.assessmentArtifactId,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
