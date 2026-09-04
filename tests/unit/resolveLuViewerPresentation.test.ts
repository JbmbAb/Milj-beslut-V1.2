import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let membershipAllowed = true;
vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: vi.fn(async () => {
    if (!membershipAllowed) throw new Error('REJECT_PROJECT_MEMBERSHIP: not a member');
  }),
}));

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ArtifactReference } from '../../packages/mps-compliance/src/artifacts/ArtifactReference';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectContextBindingSupersessionIssuerArtifact,
  createProductViewerCapabilityArtifact,
  createViewerCapabilityIssuerArtifact,
  createViewerIdentityArtifact,
  createViewerIdentityIssuerArtifact,
  createGovernedLocalizationAssessment,
  buildSpatialEvidenceContentHash,
  SPATIAL_STACK_V1,
  type SpatialEvidenceArtifact,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { attestProjectContextBindingArtifact } from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProjectContextBindingSupersessionArtifact,
  attestProjectContextBindingSupersessionIssuerArtifact,
} from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { __resetProjectContextBindingSupersessionVerifierForTests } from '../../server/security/projectContextBindingSupersessionVerifier';
import {
  attestProductViewerCapability,
  attestViewerCapabilityIssuerArtifact,
} from '../../server/modules/localization/productViewerCapabilityAuthority';
import {
  attestViewerIdentityArtifact,
  attestViewerIdentityIssuerArtifact,
} from '../../server/modules/localization/viewerIdentityAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import type { ProjectAssessmentProjectionIndex, ProjectAssessmentProjectionRow } from '../../server/repositories/projectAssessmentProjectionRepository';
import { registerAssessmentProjection } from '../../server/modules/localization/assessmentProjection';
import { resolveLuViewerPresentation } from '../../server/modules/localization/localizationOrchestrator';
import type { LocalizationViewerRuntimeConfig } from '../../server/modules/localization/createLocalizationViewerRuntime';
import type { AuthUser } from '../../server/security/types';

class MemoryRepository {
  readonly values = new Map<string, unknown>();
  async put(artifact: { artifact_id: string; body: unknown }): Promise<void> {
    this.values.set(artifact.artifact_id, artifact.body);
  }
  async resolve<T>(reference: ArtifactReference): Promise<T> {
    const value = this.values.get(reference.artifact_id);
    if (!value) throw new Error(`not found: ${reference.artifact_id}`);
    return value as T;
  }
}

class MemoryBindingIndex implements ProjectContextBindingIndex {
  private readonly byProjectAndContext = new Map<string, string>();
  private readonly bindingsByProject = new Map<string, ArtifactReference[]>();
  private readonly supersessionsByProject = new Map<string, ArtifactReference[]>();
  private key(projectId: string, context: ArtifactReference): string {
    return `${projectId}:${context.artifact_type}:${context.artifact_id}`;
  }
  async register(binding: ReturnType<typeof createProjectContextBindingArtifact>): Promise<void> {
    const key = this.key(binding.payload.project_id, binding.payload.project_context_ref);
    const existing = this.byProjectAndContext.get(key);
    if (existing && existing !== binding.artifact_id) throw new Error('binding collision');
    this.byProjectAndContext.set(key, binding.artifact_id);
    const list = this.bindingsByProject.get(binding.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === binding.artifact_id)) {
      list.push({ artifact_id: binding.artifact_id, artifact_type: binding.artifact_type });
      this.bindingsByProject.set(binding.payload.project_id, list);
    }
  }
  async resolve(projectId: string, context: ArtifactReference): Promise<string> {
    const bindingId = this.byProjectAndContext.get(this.key(projectId, context));
    if (!bindingId) throw new Error('no binding');
    return bindingId;
  }
  async registerSupersession(supersession: ReturnType<typeof createProjectContextBindingSupersessionArtifact>): Promise<void> {
    const list = this.supersessionsByProject.get(supersession.payload.project_id) ?? [];
    if (!list.some((r) => r.artifact_id === supersession.artifact_id)) {
      list.push({ artifact_id: supersession.artifact_id, artifact_type: supersession.artifact_type });
      this.supersessionsByProject.set(supersession.payload.project_id, list);
    }
  }
  async listBindingRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.bindingsByProject.get(projectId) ?? [];
  }
  async listSupersessionRefs(projectId: string): Promise<readonly ArtifactReference[]> {
    return this.supersessionsByProject.get(projectId) ?? [];
  }
}

class FakeAssessmentProjectionIndex implements ProjectAssessmentProjectionIndex {
  private counter = 0;
  private readonly rowsByProject = new Map<string, ProjectAssessmentProjectionRow[]>();
  async register(row: {
    projectId: string; assessmentArtifactId: string; assessmentArtifactType: string;
    projectContextRef: ArtifactReference; bindingArtifactId: string; releaseArtifactId: string;
  }): Promise<void> {
    const list = this.rowsByProject.get(row.projectId) ?? [];
    if (list.some((r) => r.assessmentArtifactId === row.assessmentArtifactId)) return;
    this.counter += 1;
    list.push({
      projectId: row.projectId, assessmentArtifactId: row.assessmentArtifactId, assessmentArtifactType: row.assessmentArtifactType,
      projectContextRefId: row.projectContextRef.artifact_id, projectContextRefType: row.projectContextRef.artifact_type,
      bindingArtifactId: row.bindingArtifactId, releaseArtifactId: row.releaseArtifactId, createdAt: new Date(this.counter * 1000),
    });
    this.rowsByProject.set(row.projectId, list);
  }
  async listForProject(projectId: string): Promise<readonly ProjectAssessmentProjectionRow[]> {
    return [...(this.rowsByProject.get(projectId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

const PROJECT_ID = 'project-cesium-wiring';
const contextOld = { artifact_id: 'lu-context-cesium-old', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const contextNew = { artifact_id: 'lu-context-cesium-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-cesium', artifact_type: 'project_property_binding' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-cesium-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;
const pcbSupersessionIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-supersession-issuer-cesium-test');

const vcIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:vc-issuer-cesium-test');
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-cesium-test', artifact_type: 'owner_authority_attestation' } as const;
const viIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:vi-issuer-cesium-test');

const RELEASE_REF = { artifact_id: 'product-release-cesium', artifact_type: 'product_release' } as const;
const RELEASE_HASH = 'a1'.repeat(32);
const NOW = new Date('2026-08-22T09:00:00.000Z');
const AUTH_USER: AuthUser = { id: 'user-cesium-test', organisationId: 'org-cesium-test', bankidId: 'bankid:cesium-test', role: 'CONSULTANT' };

function existenceEvidence(id: string): SpatialEvidenceArtifact {
  const payload = {
    result_semantics: {
      kind: 'EXISTENCE_WITHIN_DISTANCE' as const,
      query: { subject_ref: { artifact_id: 'property-cesium', artifact_type: 'PROPERTY' }, srid: 3006, distance_meters: 250 },
      result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
    },
    property_ref: { artifact_id: 'property-cesium', artifact_type: 'PROPERTY' },
    geometry: null,
    srid: 3006,
    operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
    layer_ref: { layer_id: 'water', version_hash: 'b'.repeat(64), layer_version: 'v1' },
    source_metadata: { provider: 'SGU', dataset: 'water', dataset_version: 'b'.repeat(64), retrieved_at: '2026-08-20T12:00:00.000Z' },
    query_context: { query_id: id, query_type: 'SPATIAL_DWITHIN', parameters: {} },
  };
  return {
    artifact_id: id, artifact_type: 'SPATIAL_EVIDENCE',
    content_hash: buildSpatialEvidenceContentHash(payload),
    references: [{ artifact_id: 'property-cesium', artifact_type: 'PROPERTY' }],
    payload,
  } as unknown as SpatialEvidenceArtifact;
}

async function setup() {
  const repository = new MemoryRepository();
  const bindingIndex = new MemoryBindingIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });

  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = pcbSupersessionIssuerKey.provider.keyId;
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = pcbSupersessionIssuerKey.publicKey;
  __resetProjectContextBindingSupersessionVerifierForTests(null);
  const pcbSupersessionIssuerUnsigned = createProjectContextBindingSupersessionIssuerArtifact({
    issuer_key_id: pcbSupersessionIssuerKey.provider.keyId,
    owner_authority_ref: pcbAuthority,
  });
  const pcbSupersessionIssuer = {
    ...pcbSupersessionIssuerUnsigned,
    attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: pcbSupersessionIssuerUnsigned, signing: pcbSupersessionIssuerKey.provider }),
  };
  const pcbSupersessionAuthority = { artifact_id: pcbSupersessionIssuer.artifact_id, artifact_type: pcbSupersessionIssuer.artifact_type } as const;
  await repository.put({ artifact_id: pcbSupersessionIssuer.artifact_id, body: pcbSupersessionIssuer });

  async function provisionBinding(contextRef: ArtifactReference, createdAt: string) {
    const unsigned = createProjectContextBindingArtifact({
      project_id: PROJECT_ID, project_context_ref: contextRef, project_property_binding_ref: propertyBinding,
      binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: createdAt,
    });
    const signed = { ...unsigned, attestation: await attestProjectContextBindingArtifact({ artifact: unsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
    await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index: bindingIndex, binding: signed, verification: pcbVerification });
    return { artifact_id: signed.artifact_id, artifact_type: signed.artifact_type } as const;
  }

  const newBindingRef = await provisionBinding(contextNew, '2026-08-22T00:00:00.000Z');

  async function provisionOldBindingAndSupersede(): Promise<ArtifactReference> {
    const oldBindingRef = await provisionBinding(contextOld, '2026-08-20T00:00:00.000Z');
    const unsigned = createProjectContextBindingSupersessionArtifact({
      contract_version: 'PROJECT_CONTEXT_BINDING_SUPERSESSION_V1', project_id: PROJECT_ID,
      superseded_binding_ref: oldBindingRef, successor_binding_ref: newBindingRef,
      reason_code: 'TEST_SUPERSESSION', issuer_ref: pcbSupersessionAuthority, issuer_key_id: pcbSupersessionIssuerKey.provider.keyId, issued_at: '2026-08-22T00:01:00.000Z',
    });
    const signed = { ...unsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: unsigned, issuer: pcbSupersessionIssuer, signing: pcbSupersessionIssuerKey.provider }) };
    await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repository, index: bindingIndex, supersession: signed, verification: pcbVerification });
    return oldBindingRef;
  }

  const vcIssuerUnsigned = createViewerCapabilityIssuerArtifact({ issuer_key_id: vcIssuerKey.provider.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const vcIssuer = { ...vcIssuerUnsigned, attestation: await attestViewerCapabilityIssuerArtifact({ issuer: vcIssuerUnsigned, signing: vcIssuerKey.provider }) };
  await repository.put({ artifact_id: vcIssuer.artifact_id, body: vcIssuer });

  const viIssuerUnsigned = createViewerIdentityIssuerArtifact({ issuer_key_id: viIssuerKey.provider.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const viIssuer = { ...viIssuerUnsigned, attestation: await attestViewerIdentityIssuerArtifact({ issuer: viIssuerUnsigned, signing: viIssuerKey.provider }) };
  await repository.put({ artifact_id: viIssuer.artifact_id, body: viIssuer });
  const viUnsigned = createViewerIdentityArtifact({
    runtime_component: 'viewer-cesium-test', product_release_ref: RELEASE_REF, product_release_hash: RELEASE_HASH,
    issuer_ref: { artifact_id: viIssuer.artifact_id, artifact_type: viIssuer.artifact_type }, issuer_key_id: viIssuerKey.provider.keyId,
  });
  const vi = { ...viUnsigned, attestation: await attestViewerIdentityArtifact({ identity: viUnsigned, issuer: viIssuer, signing: viIssuerKey.provider }) };
  await repository.put({ artifact_id: vi.artifact_id, body: vi });
  const viewerIdentityRef = { artifact_id: vi.artifact_id, artifact_type: vi.artifact_type };

  await repository.put({
    artifact_id: RELEASE_REF.artifact_id,
    body: { artifact_id: RELEASE_REF.artifact_id, artifact_type: RELEASE_REF.artifact_type, content_hash: { algorithm: 'sha256', value: 'release-content-hash' }, references: [], payload: {}, release_hash: { algorithm: 'sha256', value: RELEASE_HASH } },
  });

  async function buildCapability(bindingRef: ArtifactReference) {
    const unsigned = createProductViewerCapabilityArtifact({
      issuer_key_id: vcIssuerKey.provider.keyId,
      issuer_ref: { artifact_id: vcIssuer.artifact_id, artifact_type: vcIssuer.artifact_type },
      subject_project_id: PROJECT_ID, project_context_binding_ref: bindingRef, viewer_identity_ref: viewerIdentityRef,
      product_release_ref: RELEASE_REF, product_release_hash: RELEASE_HASH,
      valid_from: '2026-01-01T00:00:00.000Z', valid_until: '2027-01-01T00:00:00.000Z',
    });
    const attestation = await attestProductViewerCapability({ capability: unsigned, issuer: vcIssuer, signing: vcIssuerKey.provider });
    const capability = { ...unsigned, attestation };
    await repository.put({ artifact_id: capability.artifact_id, body: capability });
    return capability;
  }

  function configFor(capabilityArtifactId: string, bindingRef: ArtifactReference): LocalizationViewerRuntimeConfig {
    return {
      capabilityArtifactId, expectedProjectId: PROJECT_ID, expectedContextBindingId: bindingRef.artifact_id,
      expectedViewerIdentityId: viewerIdentityRef.artifact_id, expectedReleaseId: RELEASE_REF.artifact_id, expectedReleaseHash: RELEASE_HASH,
    };
  }

  async function buildAndPersistAssessment(projectContextRef: ArtifactReference, evidenceRefs: readonly ArtifactReference[] = []) {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `cesium-${Date.now()}-${Math.random()}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-cesium-${Date.now()}-${Math.random()}`, artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-cesium', artifact_type: 'execution_attempt' },
      result: 'success' as const, content_hash: sha256ContentHash({ result: 'success', nonce: Math.random() }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const assessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-cesium', project_context_ref: projectContextRef,
        property_ref: { artifact_id: 'property-cesium', artifact_type: 'PROPERTY' },
        evidence_refs: evidenceRefs, system_summary: `cesium wiring test assessment ${Math.random()}`,
      },
      findings: [], outcome, attestation,
    });
    await repository.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    return assessment;
  }

  return {
    repository, bindingIndex, newBindingRef, provisionOldBindingAndSupersede,
    buildCapability, configFor, buildAndPersistAssessment,
    currentBindingProvider: () => new ProjectContextBindingProvider(repository, bindingIndex, pcbVerification),
  };
}

describe('P3-LU-CESIUM-PRESENTATION-WIRING-01: resolveLuViewerPresentation', () => {
  beforeEach(() => {
    membershipAllowed = true;
    process.env.VIEWER_IDENTITY_ISSUER_KEY_ID = viIssuerKey.provider.keyId;
    process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM = viIssuerKey.publicKey;
    process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID = vcIssuerKey.provider.keyId;
    process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM = vcIssuerKey.publicKey;
  });
  afterEach(() => {
    delete process.env.VIEWER_IDENTITY_ISSUER_KEY_ID;
    delete process.env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM;
    delete process.env.VIEWER_CAPABILITY_ISSUER_KEY_ID;
    delete process.env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM;
  });

  it('authenticated + current assessment + valid capability -> governed ViewerKernel output', async () => {
    const s = await setup();
    const evidence = existenceEvidence('spatial-evidence-cesium-1');
    await s.repository.put({ artifact_id: evidence.artifact_id, body: evidence });
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: evidence.artifact_id, artifact_type: 'SPATIAL_EVIDENCE' }]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex, config: s.configFor(capability.artifact_id, s.newBindingRef),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.assessmentArtifactId).toBe(assessment.artifact_id);
    expect(result.capabilityArtifactId).toBe(capability.artifact_id);
    const geojson = result.geojson as { type: string; features: Array<{ geometry: unknown }> };
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(1);
    // geometry:null must remain null through this API/orchestrator path too.
    expect(geojson.features[0]!.geometry).toBeNull();
  });

  it('unauthorized user -> DENY (403)', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });
    membershipAllowed = false;

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex, config: s.configFor(capability.artifact_id, s.newBindingRef),
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('missing current assessment -> explicit unavailable (404), no stale fallback', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const projectionIndex = new FakeAssessmentProjectionIndex(); // never registered

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex, config: s.configFor(capability.artifact_id, s.newBindingRef),
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('assessment_projection_registered = false (registration never happened) -> no stale/browser-supplied fallback', async () => {
    // Simulates exactly the P3-LU-ASSESSMENT-PROJECTION-RELIABILITY-01 scenario: the assessment
    // was persisted to CAS, but its projection row was never written. The orchestrator must not
    // fall back to any other signal (e.g. a browser-held id) -- it has none, and correctly denies.
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    await s.buildAndPersistAssessment(contextNew); // persisted to CAS, but never registered below
    const projectionIndex = new FakeAssessmentProjectionIndex();

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex, config: s.configFor(capability.artifact_id, s.newBindingRef),
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('superseded capability -> DENY (424)', async () => {
    const s = await setup();
    const oldBindingRef = await s.provisionOldBindingAndSupersede();
    const capability = await s.buildCapability(oldBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextOld);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    // Registered against the OLD binding, matching what a real run under that (now superseded)
    // context would have produced.
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: oldBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex, config: s.configFor(capability.artifact_id, oldBindingRef),
    });
    // The projection itself already refuses (NOT_CURRENT) before the capability is even reached,
    // since the old binding is no longer current -- proving the denial either way.
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('missing CAS evidence referenced by the assessment -> DENY (424)', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: 'spatial-evidence-never-persisted', artifact_type: 'SPATIAL_EVIDENCE' }]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex, config: s.configFor(capability.artifact_id, s.newBindingRef),
    });
    expect(result).toMatchObject({ ok: false, status: 424 });
  });

  it('tampered CAS evidence -> DENY (424)', async () => {
    const s = await setup();
    const evidence = existenceEvidence('spatial-evidence-cesium-tampered');
    const tampered = { ...evidence, payload: { ...evidence.payload, result_semantics: { ...evidence.payload.result_semantics, result: { ...evidence.payload.result_semantics.result, exists: false } } } };
    await s.repository.put({ artifact_id: tampered.artifact_id, body: tampered });
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: tampered.artifact_id, artifact_type: 'SPATIAL_EVIDENCE' }]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex, config: s.configFor(capability.artifact_id, s.newBindingRef),
    });
    expect(result).toMatchObject({ ok: false, status: 424 });
  });

  it('PostGIS unavailable: already-captured governed presentation still renders (zero PostGIS dependency)', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const orchestratorSource = readFileSync(path.resolve(here, '../../server/modules/localization/localizationOrchestrator.ts'), 'utf8');
    expect(orchestratorSource).not.toMatch(/from\s+["'][^"']*spatial-provider-postgis[^"']*["']/);
    expect(orchestratorSource).not.toContain('new SpatialProviderPostGIS');
    expect(orchestratorSource).toContain('resolveLocalizationViewerRuntimeConfigForProject');
    expect(orchestratorSource).not.toContain('readLocalizationViewerRuntimeConfig');
    // The route itself never calls the legacy raw-PostGIS evidence endpoint (the doc comment
    // legitimately names it by way of explaining what this route is NOT a replacement for).
    const routeSource = readFileSync(path.resolve(here, '../../server/routes/localization.routes.ts'), 'utf8');
    expect(routeSource).not.toMatch(/fetch\(\s*['"`][^'"`]*\/api\/spatial\/evidence/);
    expect(routeSource).not.toContain('gis.routes');

    const s = await setup();
    const evidence = existenceEvidence('spatial-evidence-cesium-no-postgis');
    await s.repository.put({ artifact_id: evidence.artifact_id, body: evidence });
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: evidence.artifact_id, artifact_type: 'SPATIAL_EVIDENCE' }]);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex, config: s.configFor(capability.artifact_id, s.newBindingRef),
    });
    expect(result.ok).toBe(true);
  });

  it('capability bound to a different project -> 404 not configured, no governed presentation fallback', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew);
    const projectionIndex = new FakeAssessmentProjectionIndex();
    await registerAssessmentProjection({ projectId: PROJECT_ID, assessment, contextBindingRef: s.newBindingRef, releaseRef: RELEASE_REF, index: projectionIndex });

    const result = await resolveLuViewerPresentation({
      authUser: AUTH_USER, projectId: PROJECT_ID,
      artifactRepository: s.repository, currentBindingProvider: s.currentBindingProvider(),
      assessmentProjectionIndex: projectionIndex,
      config: { ...s.configFor(capability.artifact_id, s.newBindingRef), expectedProjectId: 'other-project' },
    });
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Governed viewer capability is not configured for this project.',
    });
  });
});
