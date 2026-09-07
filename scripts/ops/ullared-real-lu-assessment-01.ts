/**
 * ULLARED-REAL-LU-ASSESSMENT-01.
 *
 * Consumes the already-materialized Ullared DocumentEvidence V2 chain through the production
 * GenerateLocalizationReportUseCase. This script does not recreate document evidence, facts,
 * property bindings, reviewer grants, signer families, or raw CAS.
 */
import { readFileSync } from 'node:fs';
import { FileCASRepository, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  createLuRegistryRuntime,
  deriveLuExecutionSeed,
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  LU_EXECUTION_PRINCIPAL_ID,
  orchestrator,
  reExecuteLocalizationAssessment,
  type LocalizationAssessmentArtifact,
} from '@miljobeslut/mps-lu';
import { validateLocalizationAssessmentContractVersion } from '../../packages/mps-lu/src/governance/GovernedAssessmentPersistence';
import { isDocumentEvidenceV2ContentHashValid, type DocumentEvidenceArtifactV2 } from '../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2';
import { isDocumentEvidencePropertyBindingV3ContentHashValid, type DocumentEvidencePropertyBindingArtifactV3 } from '../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifactV3';
import { isVerifiedDocumentFactV2ContentHashValid, type VerifiedDocumentFactArtifactV2 } from '../../packages/mps-data-governance/src/VerifiedDocumentFactV2';
import { resolveCanonicalProjectContext } from '../../src/application/resolveCanonicalProjectContext';
import { GenerateLocalizationReportUseCase } from '../../src/application/generate-localization-report.usecase';
import { createLocalizationSpatialRuntime } from '../../server/modules/localization/createLocalizationSpatialRuntime';
import { resolveOrDeriveCurrentLocalizationGeometry } from '../../server/modules/localization/localizationGeometryService';
import { resolveCanonicalProductRelease } from '../../server/modules/release/productReleaseRuntime';
import { getProjectContextBindingIssuerVerifier } from '../../server/security/projectContextBindingIssuerKey';
import { verifyLuExecutionAuthorityChain } from '../../packages/mps-lu/src/execution/LuExecutionAuthorityChain';
import { issueExecutionIdentityV3 } from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import { computeExecutionIdentityArtifactIdV3 } from '../../packages/mps-runtime/src/execution/ExecutionIdentityScopeV2';
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from '../../packages/mps-lu/src/registry/LuSiteAssessmentRegistry';
import { resolveGovernanceReviewerActor, verifyGovernanceReviewerActorReference } from '../../server/services/governanceReviewerGrantService';
import type { AuthUser } from '../../server/security/types';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const MIMERS_ROOT = 'C:/Users/jimmy/.mimers';
const GOVERNANCE_GRANT_ROOT = 'C:/miljöbeslut/.data/governance-reviewer-grants';
const PRODUCT_RELEASE_ID = 'product-release-772aceb600c4690777593ea8';
const PRODUCT_RELEASE_ISSUER_KEY_ID = 'product-release-issuer-v1-3822fa1b7c7a1c05';
const PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = 'project-context-binding-issuer-v1-fb38fb09cba8f5f8';
const LU_ROOT_KEY_ID = 'ed25519:lu-execution-root-v1-839f2a91ad203e79';
const LU_ISSUER_KEY_ID = 'ed25519:lu-execution-issuer-v1-656368e58631c925';
const LU_ISSUER_REF = { artifact_id: 'lu-execution-authority-issuer-8a7861f9da74621c6bda9032', artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE } as const;

const PROJECT_ID = 'cmt9zz05b000zacf7zn9doe37';
const REVIEWER_A_USER_ID = 'cmt5c74dm000cokf76rtqbe4v';
const REVIEWER_B_USER_ID = 'cmtbfpr91001racf7tiwpogs6';
const DOCUMENT_EVIDENCE_ID = 'doc-evidence-v2-eb37cb52d2641629c6cbe21b';
const DOCUMENT_EVIDENCE_HASH = '23fc077c4bf3a27176c2ff218b1b8651017c2f815941f896c546a25bbda4105a';
const VERIFIED_FACT_ID = 'fact-verified-v2-9f27b723400bbfabb813a47e';
const VERIFIED_FACT_HASH = '4c7da0f408525936eab87001f9ec253a0ccc4bf942374109620bf197f379588e';
const PROPERTY_BINDING_ID = 'document-evidence-property-binding-v3-5c9d1590ec4dfb1b1fe9db59';
const PROPERTY_BINDING_HASH = '41264a3e2cc2fa1abecac6aba21795f86563a34146a549f0a38dcd1ba1af044f';
const PROPERTY_CONTEXT_ID = 'lu_property_context-efe0bbffd8feca9cecb8f51b';
const PROPERTY_CONTEXT_HASH = '3b82114f46438db4a1e2ab167d619f82d35492918c0cbbc6350f566947e64837';
const RAW_SOURCE_ID = '34d0a4ce-df46-494f-8264-e4e46d5adff7';
const RAW_SOURCE_HASH = '919edd923c272ea9523749e097b8c0223c4002cd312d5138d0efb0ccf6fda794';

function pem(path: string): string {
  return readFileSync(path, 'utf8');
}

function configureRuntime(): void {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut?sslmode=disable';
  process.env.MIMERS_ROOT = MIMERS_ROOT;
  process.env.GOVERNANCE_REVIEWER_GRANT_CAS_ROOT = GOVERNANCE_GRANT_ROOT;
  process.env.LOCALIZATION_STRICT_SOURCES = 'false';
  process.env.PRODUCT_RELEASE_ARTIFACT_ID = PRODUCT_RELEASE_ID;
  process.env.PRODUCT_RELEASE_ISSUER_KEY_ID = PRODUCT_RELEASE_ISSUER_KEY_ID;
  process.env.PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/product-release-issuer-v1-public.pem`);
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`);
  process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID = LU_ISSUER_KEY_ID;
  process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/lu-execution-authority/issuer-public.pem`);
  process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = pem(`${SECRETS_DIR}/lu-execution-authority/issuer-private.pem`);
  process.env.LU_EXECUTION_AUTHORITY_ROOT_KEY_ID = LU_ROOT_KEY_ID;
  process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/lu-execution-authority/root-public.pem`);
  process.env.GOVERNANCE_REVIEWER_ISSUER_PUBLIC_KEY_PEM = pem(`${SECRETS_DIR}/governance-reviewer-role-issuer-v1/public.pem`);
}

async function authUser(id: string): Promise<AuthUser> {
  const { prisma } = await import('../../server/db/prisma');
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, organisationId: true, bankidId: true, role: true, identityEnvironment: true },
  });
  if (!user) throw new Error(`missing authenticated user ${id}`);
  return user as AuthUser;
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) throw new Error('Refusing to run without --execute.');
  configureRuntime();

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;
  const cas = new FileCASRepository(`${MIMERS_ROOT}/cas`, { durabilityMode: 'best-effort' });
  await cas.initialize();

  const rootVerification = new LocalPemVerificationKeyProvider(LU_ROOT_KEY_ID, process.env.LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM as string);
  const issuerVerification = new LocalPemVerificationKeyProvider(LU_ISSUER_KEY_ID, process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM as string);
  await verifyLuExecutionAuthorityChain({ issuerRef: LU_ISSUER_REF, repository: repo, rootVerification, issuerVerification });
  getProjectContextBindingIssuerVerifier();

  const reviewerAUser = await authUser(REVIEWER_A_USER_ID);
  const reviewerBUser = await authUser(REVIEWER_B_USER_ID);
  const reviewerA = await resolveGovernanceReviewerActor(reviewerAUser);
  const reviewerB = await resolveGovernanceReviewerActor(reviewerBUser);
  await verifyGovernanceReviewerActorReference(reviewerA);
  await verifyGovernanceReviewerActorReference(reviewerB);
  if (reviewerA.identity_ref.id === reviewerB.identity_ref.id) throw new Error('Reviewer A/B collapsed to one identity');

  const evidence = await repo.resolve<DocumentEvidenceArtifactV2>({ artifact_id: DOCUMENT_EVIDENCE_ID, artifact_type: 'DOCUMENT_EVIDENCE' });
  if (evidence.content_hash.value !== DOCUMENT_EVIDENCE_HASH || !isDocumentEvidenceV2ContentHashValid(evidence)) throw new Error('real DocumentEvidence V2 failed self-check');
  const fact = await repo.resolve<VerifiedDocumentFactArtifactV2>({ artifact_id: VERIFIED_FACT_ID, artifact_type: 'VERIFIED_DOCUMENT_FACT' });
  if (fact.content_hash.digest !== VERIFIED_FACT_HASH || fact.contract_version !== 'verified-document-fact-v2' || !isVerifiedDocumentFactV2ContentHashValid(fact)) {
    throw new Error('real VerifiedDocumentFact V2 failed self-check');
  }
  const binding = await repo.resolve<DocumentEvidencePropertyBindingArtifactV3>({ artifact_id: PROPERTY_BINDING_ID, artifact_type: 'document_evidence_property_binding' });
  if (binding.content_hash.value !== PROPERTY_BINDING_HASH || !isDocumentEvidencePropertyBindingV3ContentHashValid(binding)) throw new Error('real PropertyBinding V3 failed self-check');
  if (binding.payload.property_ref.artifact_id !== PROPERTY_CONTEXT_ID || binding.payload.property_ref.content_hash !== PROPERTY_CONTEXT_HASH) throw new Error('real binding does not bind the expected LUPropertyContext');
  if (binding.payload.document_evidence_ref.artifact_id !== evidence.artifact_id || binding.payload.document_evidence_ref.content_hash !== evidence.content_hash.value) throw new Error('real binding does not bind the expected DocumentEvidence V2');
  if (JSON.stringify(binding.payload.verified_fact_refs) !== JSON.stringify(evidence.payload.verified_fact_refs)) throw new Error('binding/fact refs diverged from DocumentEvidence V2');

  const rawBytes = await cas.getBytes(`sha256:${RAW_SOURCE_HASH}`, { verifyHash: true });
  if (!rawBytes) throw new Error('original raw Ullared CAS byte missing');
  if (evidence.payload.raw_source_ref?.artifact_id !== RAW_SOURCE_ID || evidence.payload.raw_source_ref.content_hash !== RAW_SOURCE_HASH) throw new Error('DocumentEvidence V2 does not cite the canonical Ullared raw source');

  const canonicalContext = await resolveCanonicalProjectContext(PROJECT_ID, repo);
  if (canonicalContext.propertyContextRef.artifact_id !== PROPERTY_CONTEXT_ID) throw new Error('project canonical property does not match real Ullared binding');
  const release = await resolveCanonicalProductRelease({ artifactRepository: repo });
  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY);
  if (!capability) throw new Error('LU capability unavailable');

  const spatialRuntime = await createLocalizationSpatialRuntime();
  const { geometry } = await resolveOrDeriveCurrentLocalizationGeometry({
    projectId: PROJECT_ID,
    artifactRepository: repo,
    propertyContextRef: canonicalContext.propertyContextRef,
    propertyCentroidSweref: canonicalContext.coordinates,
    sweref99ToWgs84: spatialRuntime.sweref99ToWgs84,
    createdBy: reviewerAUser.id,
  });
  await spatialRuntime.close();
  const geometryRef = { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type };
  const releaseRef = { artifact_id: release.artifact_id, artifact_type: release.artifact_type };
  const subject = {
    site_id: canonicalContext.propertyIdentity,
    project_context_binding_ref: canonicalContext.contextBindingRef,
    product_release_ref: releaseRef,
    execution_contract_version: 'lu-execution-identity-v1',
    localization_geometry_ref: geometryRef,
  };
  const seed = deriveLuExecutionSeed({
    site_id: subject.site_id,
    project_id: PROJECT_ID,
    project_context_ref: canonicalContext.projectContextRef,
    property_context_ref: canonicalContext.propertyContextRef,
    project_context_binding_ref: canonicalContext.contextBindingRef,
    product_release_ref: releaseRef,
    product_release_hash: release.release_hash.value,
    execution_contract_version: subject.execution_contract_version,
    rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    localization_geometry_ref: geometryRef,
  });
  const expectedIdentityId = computeExecutionIdentityArtifactIdV3(subject);
  let executionIdentityStatus = 'EXISTING';
  try {
    await repo.resolve({ artifact_id: expectedIdentityId, artifact_type: 'execution_identity' });
  } catch {
    await issueExecutionIdentityV3({
      subject,
      deterministic_seed: seed,
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      issuer_ref: LU_ISSUER_REF,
      governed_references: [canonicalContext.contextBindingRef, canonicalContext.projectContextRef, canonicalContext.propertyContextRef, releaseRef, geometryRef],
      artifact_repository: repo,
    });
    executionIdentityStatus = 'ISSUED_FROM_EXISTING_AUTHORITY';
  }

  let syntheticFallbackCalled = false;
  const originalGenerateDocumentEvidence = orchestrator.generateDocumentEvidence;
  (orchestrator as unknown as { generateDocumentEvidence: typeof originalGenerateDocumentEvidence }).generateDocumentEvidence = async (...args) => {
    syntheticFallbackCalled = true;
    return originalGenerateDocumentEvidence(...args);
  };

  const [lng, lat] = geometry.payload.geometry.coordinates;
  const report = await new GenerateLocalizationReportUseCase(createLocalizationSpatialRuntime).execute({
    projectId: PROJECT_ID,
    userId: reviewerAUser.id,
    user: reviewerAUser,
    siteAlternatives: [{
      id: 'ullared-real-lu-assessment-01',
      name: 'Ullared 2:215',
      lat,
      lng,
      documentEvidenceRefs: [{
        artifact_id: DOCUMENT_EVIDENCE_ID,
        artifact_type: 'DOCUMENT_EVIDENCE',
        content_hash: DOCUMENT_EVIDENCE_HASH,
        property_binding_ref: {
          artifact_id: PROPERTY_BINDING_ID,
          artifact_type: 'document_evidence_property_binding',
          content_hash: PROPERTY_BINDING_HASH,
        },
      }],
    }],
  });

  const analysis = report.siteAnalyses[0];
  if (!analysis.executionMotor?.admitted || !analysis.executionMotor.assessment_artifact_id) throw new Error(`LU assessment did not admit: ${analysis.executionMotor?.reason_codes.join(',')}`);
  const finding = analysis.executionMotor.findings.find((candidate) => candidate.rule_id === 'LU-DOC-BESLUT-001');
  if (!finding) throw new Error('LU-DOC-BESLUT-001 was not produced');
  if (!finding.evidence_refs.some((ref) => ref.artifact_id === DOCUMENT_EVIDENCE_ID) || !finding.evidence_refs.some((ref) => ref.artifact_id === VERIFIED_FACT_ID)) {
    throw new Error('LU-DOC-BESLUT-001 did not cite the real document evidence and V2 fact');
  }

  const assessment = await repo.resolve<LocalizationAssessmentArtifact>({ artifact_id: analysis.executionMotor.assessment_artifact_id, artifact_type: 'LOCALIZATION_ASSESSMENT' });
  validateLocalizationAssessmentContractVersion(assessment.payload);
  const reexec = await reExecuteLocalizationAssessment({ assessmentArtifactId: assessment.artifact_id, artifactRepository: repo });
  if (reexec.outcome !== 'PASS') throw new Error(`deterministic re-execution failed: ${JSON.stringify(reexec.mismatches)}`);

  const output = {
    unit: 'PROVEN',
    document_evidence_consumption: 'PROVEN',
    verified_fact_resolution: 'PROVEN',
    lu_doc_beslut_001: 'PROVEN',
    real_finding: 'PROVEN',
    localization_assessment_artifact: 'PROVEN',
    canonical_fresh_read: assessment.artifact_id === analysis.executionMotor.assessment_artifact_id ? 'PROVEN' : 'OPEN',
    deterministic_repeat_replay: reexec.outcome === 'PASS' ? 'PROVEN' : 'OPEN',
    legacy_synthetic_fallback: syntheticFallbackCalled ? 'FOUND' : 'ABSENT',
    full_trace: {
      project_id: PROJECT_ID,
      authenticated_user_id: reviewerAUser.id,
      reviewer_a: reviewerA.identity_ref.id,
      reviewer_b: reviewerB.identity_ref.id,
      original_raw_cas_hash: RAW_SOURCE_HASH,
      document_evidence_v2: { artifact_id: evidence.artifact_id, content_hash: evidence.content_hash.value },
      verified_document_fact_v2: { artifact_id: fact.artifact_id, content_hash: fact.content_hash.digest, review_attestation_ref: fact.review_attestation_ref },
      property_binding_v3: { artifact_id: binding.artifact_id, content_hash: binding.content_hash.value, property_ref: binding.payload.property_ref, review_attestation_ref: binding.payload.review_attestation_ref },
      localization_geometry_ref: geometryRef,
      execution_identity: { artifact_id: expectedIdentityId, status: executionIdentityStatus },
      manifest_id: analysis.executionMotor.manifest_id,
      outcome_id: analysis.executionMotor.outcome_id,
      finding: { finding_id: finding.finding_id, evidence_refs: finding.evidence_refs },
      assessment: { artifact_id: assessment.artifact_id, content_hash: assessment.content_hash.value },
    },
    safe_to_start_authenticated_ui_e2e: syntheticFallbackCalled ? 'NO' : 'YES',
  };
  console.log(JSON.stringify(output, null, 2));
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  const { prisma } = await import('../../server/db/prisma');
  await prisma.$disconnect();
});
