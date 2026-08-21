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
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingSupersessionArtifact,
  createProjectContextBindingIssuerArtifact,
  createProductViewerCapabilityArtifact,
  createViewerCapabilityIssuerArtifact,
  createViewerIdentityArtifact,
  createViewerIdentityIssuerArtifact,
  createGovernedLocalizationAssessment,
  SPATIAL_STACK_V1,
  type SpatialEvidenceArtifact,
} from '@miljobeslut/mps-lu';
import { SecurityRuntime } from '../../packages/mps-runtime/src/security/SecurityRuntime';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import {
  installOwnerIssuedProjectContextBinding,
  installOwnerIssuedProjectContextBindingSupersession,
} from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import {
  attestProjectContextBindingArtifact,
  attestProjectContextBindingSupersessionArtifact,
} from '../../server/modules/localization/projectContextBindingAuthority';
import {
  attestProductViewerCapability,
  attestViewerCapabilityIssuerArtifact,
} from '../../server/modules/localization/productViewerCapabilityAuthority';
import {
  attestViewerIdentityArtifact,
  attestViewerIdentityIssuerArtifact,
} from '../../server/modules/localization/viewerIdentityAuthority';
import type { ProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { resolveGovernedLocalizationPresentation } from '../../server/modules/localization/resolveGovernedLocalizationPresentation';
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

const PROJECT_ID = 'project-presentation-boundary';
const contextOld = { artifact_id: 'lu-context-presentation-old', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const contextNew = { artifact_id: 'lu-context-presentation-new', artifact_type: 'LU_PROJECT_CONTEXT' } as const;
const propertyBinding = { artifact_id: 'project-property-binding-presentation', artifact_type: 'project_property_binding' } as const;

const pcbIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:pcb-issuer-presentation-test');
const pcbVerification = new LocalPemVerificationKeyProvider(pcbIssuerKey.provider.keyId, pcbIssuerKey.publicKey);
const pcbIssuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: pcbIssuerKey.provider.keyId, issuer_version: 'project-context-binding-issuer-v2' });
const pcbAuthority = { artifact_id: pcbIssuer.artifact_id, artifact_type: pcbIssuer.artifact_type } as const;

const vcIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:vc-issuer-presentation-test');
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-presentation-test', artifact_type: 'owner_authority_attestation' } as const;
const viIssuerKey = LocalPemSigningKeyProvider.generate('ed25519:vi-issuer-presentation-test');

const RELEASE_REF = { artifact_id: 'product-release-presentation', artifact_type: 'product_release' } as const;
const RELEASE_HASH = 'd'.repeat(64);
const NOW = new Date('2026-08-21T12:00:00.000Z');

const AUTH_USER: AuthUser = { id: 'user-presentation-test', organisationId: 'org-presentation-test', bankidId: 'bankid:presentation-test', role: 'CONSULTANT' };

function existenceEvidence(id: string): SpatialEvidenceArtifact {
  const payload = {
    result_semantics: {
      kind: 'EXISTENCE_WITHIN_DISTANCE' as const,
      query: {
        subject_ref: { artifact_id: 'property-presentation', artifact_type: 'PROPERTY' },
        srid: 3006,
        distance_meters: 250,
      },
      result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
    },
    property_ref: { artifact_id: 'property-presentation', artifact_type: 'PROPERTY' },
    geometry: null,
    srid: 3006,
    operation: { algorithm: 'spatial.dwithin_existence', engine: 'PostGIS', engine_fingerprint: SPATIAL_STACK_V1 },
    layer_ref: { layer_id: 'water', version_hash: 'b'.repeat(64), layer_version: 'v1' },
    source_metadata: { provider: 'SGU', dataset: 'water', dataset_version: 'b'.repeat(64), retrieved_at: '2026-08-20T12:00:00.000Z' },
    query_context: { query_id: id, query_type: 'SPATIAL_DWITHIN', parameters: {} },
  };
  return {
    artifact_id: id,
    artifact_type: 'SPATIAL_EVIDENCE',
    content_hash: { algorithm: 'sha256', value: 'evidence-hash-placeholder' },
    references: [{ artifact_id: 'property-presentation', artifact_type: 'PROPERTY' }],
    payload,
  } as unknown as SpatialEvidenceArtifact;
}

async function setup() {
  const repository = new MemoryRepository();
  const index = new MemoryBindingIndex();
  await repository.put({ artifact_id: pcbIssuer.artifact_id, body: pcbIssuer });

  const oldBindingUnsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: contextOld, project_property_binding_ref: propertyBinding,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-08-20T00:00:00.000Z',
  });
  const oldBinding = { ...oldBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: oldBindingUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index, binding: oldBinding, verification: pcbVerification });

  const newBindingUnsigned = createProjectContextBindingArtifact({
    project_id: PROJECT_ID, project_context_ref: contextNew, project_property_binding_ref: propertyBinding,
    binding_version: 'project-context-binding-v2', authority_ref: pcbAuthority, created_at: '2026-08-21T00:00:00.000Z',
  });
  const newBinding = { ...newBindingUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: newBindingUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBinding({ artifactRepository: repository, index, binding: newBinding, verification: pcbVerification });

  const supersessionUnsigned = createProjectContextBindingSupersessionArtifact({
    contract_version: 'PROJECT_CONTEXT_BINDING_SUPERSESSION_V1', project_id: PROJECT_ID,
    superseded_binding_ref: { artifact_id: oldBinding.artifact_id, artifact_type: oldBinding.artifact_type },
    successor_binding_ref: { artifact_id: newBinding.artifact_id, artifact_type: newBinding.artifact_type },
    reason_code: 'TEST_SUPERSESSION', issuer_ref: pcbAuthority, issuer_key_id: pcbIssuerKey.provider.keyId,
    issued_at: '2026-08-21T00:01:00.000Z',
  });
  const supersession = { ...supersessionUnsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: supersessionUnsigned, issuer: pcbIssuer, signing: pcbIssuerKey.provider }) };
  await installOwnerIssuedProjectContextBindingSupersession({ artifactRepository: repository, index, supersession, verification: pcbVerification });

  const vcIssuerUnsigned = createViewerCapabilityIssuerArtifact({ issuer_key_id: vcIssuerKey.provider.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const vcIssuer = { ...vcIssuerUnsigned, attestation: await attestViewerCapabilityIssuerArtifact({ issuer: vcIssuerUnsigned, signing: vcIssuerKey.provider }) };
  await repository.put({ artifact_id: vcIssuer.artifact_id, body: vcIssuer });

  const viIssuerUnsigned = createViewerIdentityIssuerArtifact({ issuer_key_id: viIssuerKey.provider.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const viIssuer = { ...viIssuerUnsigned, attestation: await attestViewerIdentityIssuerArtifact({ issuer: viIssuerUnsigned, signing: viIssuerKey.provider }) };
  await repository.put({ artifact_id: viIssuer.artifact_id, body: viIssuer });
  const viUnsigned = createViewerIdentityArtifact({
    runtime_component: 'viewer-capability-presentation-test', product_release_ref: RELEASE_REF, product_release_hash: RELEASE_HASH,
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
      subject_project_id: PROJECT_ID,
      project_context_binding_ref: bindingRef,
      viewer_identity_ref: viewerIdentityRef,
      product_release_ref: RELEASE_REF,
      product_release_hash: RELEASE_HASH,
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
    });
    const attestation = await attestProductViewerCapability({ capability: unsigned, issuer: vcIssuer, signing: vcIssuerKey.provider });
    const capability = { ...unsigned, attestation };
    await repository.put({ artifact_id: capability.artifact_id, body: capability });
    return capability;
  }

  function configFor(capabilityArtifactId: string, bindingRef: ArtifactReference): LocalizationViewerRuntimeConfig {
    return {
      capabilityArtifactId,
      expectedProjectId: PROJECT_ID,
      expectedContextBindingId: bindingRef.artifact_id,
      expectedViewerIdentityId: viewerIdentityRef.artifact_id,
      expectedReleaseId: RELEASE_REF.artifact_id,
      expectedReleaseHash: RELEASE_HASH,
    };
  }

  async function buildAndPersistAssessment(projectContextRef: ArtifactReference, evidenceRefs: readonly ArtifactReference[]) {
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `presentation-${Date.now()}-${Math.random()}` });
    security.bindPrincipal('lu.site_assessment.actor');
    const outcome = {
      outcome_id: `outcome-presentation-${Date.now()}-${Math.random()}`,
      artifact_type: 'execution_outcome' as const,
      attempt_ref: { artifact_id: 'attempt-presentation', artifact_type: 'execution_attempt' },
      result: 'success' as const,
      content_hash: sha256ContentHash({ result: 'success' }),
    };
    const attestation = security.attestOutcome(outcome.content_hash);
    const assessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: 'site-presentation',
        project_context_ref: projectContextRef,
        property_ref: { artifact_id: 'property-presentation', artifact_type: 'PROPERTY' },
        evidence_refs: evidenceRefs,
        system_summary: 'presentation boundary test assessment',
      },
      findings: [],
      outcome,
      attestation,
    });
    await repository.put({ artifact_id: assessment.artifact_id, content_hash: assessment.content_hash, body: assessment });
    return assessment;
  }

  return {
    repository, index,
    oldBindingRef: { artifact_id: oldBinding.artifact_id, artifact_type: oldBinding.artifact_type },
    newBindingRef: { artifact_id: newBinding.artifact_id, artifact_type: newBinding.artifact_type },
    viewerIdentityRef,
    buildCapability,
    configFor,
    buildAndPersistAssessment,
    currentBindingProvider: () => new ProjectContextBindingProvider(repository, index, pcbVerification),
  };
}

describe('P3-LU-PRESENTATION-BOUNDARY-01 PHASE 1', () => {
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

  it('authorized project + current capability + persisted assessment/evidence -> ViewerKernel output', async () => {
    const s = await setup();
    const evidence = existenceEvidence('spatial-evidence-presentation-1');
    // Persist with a real, self-consistent content_hash so the module's own tamper check passes.
    const { buildSpatialEvidenceContentHash } = await import('@miljobeslut/mps-lu');
    const realHash = buildSpatialEvidenceContentHash(evidence.payload);
    const realEvidence = { ...evidence, content_hash: realHash };
    await s.repository.put({ artifact_id: realEvidence.artifact_id, body: realEvidence });

    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: realEvidence.artifact_id, artifact_type: 'SPATIAL_EVIDENCE' }]);

    const result = await resolveGovernedLocalizationPresentation({
      authUser: AUTH_USER,
      projectId: PROJECT_ID,
      assessmentArtifactId: assessment.artifact_id,
      artifactRepository: s.repository,
      config: s.configFor(capability.artifact_id, s.newBindingRef),
      now: () => NOW,
      currentBindingProvider: s.currentBindingProvider(),
    });

    expect(result.assessmentArtifactId).toBe(assessment.artifact_id);
    expect(result.capabilityArtifactId).toBe(capability.artifact_id);
    const geojson = result.geojson as { type: string; features: Array<{ geometry: unknown; properties: Record<string, unknown> }> };
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(1);
    // geometry:null evidence remains geometry:null -- no fabricated marker/sphere.
    expect(geojson.features[0]!.geometry).toBeNull();
    expect(geojson.features[0]!.properties.cas_artifact_id).toBe(realEvidence.artifact_id);
    expect(geojson.features[0]!.properties.viewer_capability_id).toBe(capability.artifact_id);
  });

  it('unauthorized user -> DENY before artifact presentation', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, []);
    membershipAllowed = false;
    await expect(
      resolveGovernedLocalizationPresentation({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        assessmentArtifactId: assessment.artifact_id,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_PROJECT_MEMBERSHIP');
  });

  it('missing capability -> DENY', async () => {
    const s = await setup();
    const assessment = await s.buildAndPersistAssessment(contextNew, []);
    await expect(
      resolveGovernedLocalizationPresentation({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        assessmentArtifactId: assessment.artifact_id,
        artifactRepository: s.repository,
        config: s.configFor('viewer-capability-never-installed', s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_LU_VIEWER_CAPABILITY_UNAVAILABLE');
  });

  it('superseded capability -> DENY', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.oldBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextOld, []);
    await expect(
      resolveGovernedLocalizationPresentation({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        assessmentArtifactId: assessment.artifact_id,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.oldBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_VIEWER_CAPABILITY_CONTEXT_BINDING_SUPERSEDED');
  });

  it('missing CAS evidence -> DENY / explicit unavailable state', async () => {
    const s = await setup();
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: 'spatial-evidence-never-persisted', artifact_type: 'SPATIAL_EVIDENCE' }]);
    await expect(
      resolveGovernedLocalizationPresentation({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        assessmentArtifactId: assessment.artifact_id,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('not found');
  });

  it('tampered CAS evidence artifact -> verification failure', async () => {
    const s = await setup();
    const evidence = existenceEvidence('spatial-evidence-presentation-tampered');
    const { buildSpatialEvidenceContentHash } = await import('@miljobeslut/mps-lu');
    const realHash = buildSpatialEvidenceContentHash(evidence.payload);
    // Content_hash claims the ORIGINAL payload's hash, but the stored body has been mutated
    // (result flipped from exists:true to exists:false) -- exactly what a corrupted/tampered CAS
    // write would look like, without needing a real WORM-bypassing attacker.
    const tampered = { ...evidence, content_hash: realHash, payload: { ...evidence.payload, result_semantics: { ...evidence.payload.result_semantics, result: { ...evidence.payload.result_semantics.result, exists: false } } } };
    await s.repository.put({ artifact_id: tampered.artifact_id, body: tampered });

    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: tampered.artifact_id, artifact_type: 'SPATIAL_EVIDENCE' }]);

    await expect(
      resolveGovernedLocalizationPresentation({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        assessmentArtifactId: assessment.artifact_id,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      }),
    ).rejects.toThrow('REJECT_LOCALIZATION_PRESENTATION: evidence content_hash mismatch');
  });

  it('same immutable evidence -> deterministic presentation', async () => {
    const s = await setup();
    const evidence = existenceEvidence('spatial-evidence-presentation-deterministic');
    const { buildSpatialEvidenceContentHash } = await import('@miljobeslut/mps-lu');
    const realHash = buildSpatialEvidenceContentHash(evidence.payload);
    const realEvidence = { ...evidence, content_hash: realHash };
    await s.repository.put({ artifact_id: realEvidence.artifact_id, body: realEvidence });

    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: realEvidence.artifact_id, artifact_type: 'SPATIAL_EVIDENCE' }]);
    const call = () =>
      resolveGovernedLocalizationPresentation({
        authUser: AUTH_USER,
        projectId: PROJECT_ID,
        assessmentArtifactId: assessment.artifact_id,
        artifactRepository: s.repository,
        config: s.configFor(capability.artifact_id, s.newBindingRef),
        now: () => NOW,
        currentBindingProvider: s.currentBindingProvider(),
      });
    const first = await call();
    const second = await call();
    expect(first.geojson).toEqual(second.geojson);
  });

  it('PostGIS unavailable: already-captured presentation still works (no dependency on spatial-provider-postgis)', async () => {
    const source = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/modules/localization/resolveGovernedLocalizationPresentation.ts'),
      'utf8',
    );
    // The doc comment legitimately explains the absence by name; only an actual import/reference
    // to the concrete implementation would be a real violation.
    expect(source).not.toMatch(/from\s+["'][^"']*spatial-provider-postgis[^"']*["']/);
    expect(source).not.toContain('new SpatialProviderPostGIS');
    expect(source).not.toContain('viewerCapabilitySigningKey');

    // Functional half of the proof: resolving already-captured presentation succeeds using only
    // the in-memory CAS + the mocked Prisma membership check -- no PostGIS pool exists in this
    // process at all, and the call still succeeds.
    const s = await setup();
    const evidence = existenceEvidence('spatial-evidence-presentation-no-postgis');
    const { buildSpatialEvidenceContentHash } = await import('@miljobeslut/mps-lu');
    const realEvidence = { ...evidence, content_hash: buildSpatialEvidenceContentHash(evidence.payload) };
    await s.repository.put({ artifact_id: realEvidence.artifact_id, body: realEvidence });
    const capability = await s.buildCapability(s.newBindingRef);
    const assessment = await s.buildAndPersistAssessment(contextNew, [{ artifact_id: realEvidence.artifact_id, artifact_type: 'SPATIAL_EVIDENCE' }]);

    const result = await resolveGovernedLocalizationPresentation({
      authUser: AUTH_USER,
      projectId: PROJECT_ID,
      assessmentArtifactId: assessment.artifact_id,
      artifactRepository: s.repository,
      config: s.configFor(capability.artifact_id, s.newBindingRef),
      now: () => NOW,
      currentBindingProvider: s.currentBindingProvider(),
    });
    expect((result.geojson as { features: unknown[] }).features).toHaveLength(1);
  });
});
