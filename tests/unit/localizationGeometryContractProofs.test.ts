/**
 * PRODUCT-LU-LOCALIZATION-GEOMETRY-01 — Phase B proof matrix, part 1: artifact contract,
 * current-geometry projection, spatial-query wiring, and ExecutionIdentity V3 semantics.
 *
 * PROOF-ONLY. No new runtime design in this file -- every assertion targets behavior already
 * implemented in LocalizationGeometryArtifact.ts, localizationGeometryProjection.ts,
 * SpatialProviderPostGIS.ts, ExecutionIdentityScopeV2.ts (V3 additions), and
 * ExecutionIdentityAttestation.ts.
 *
 * Covers proof-matrix items: 1 (artifact idempotency), 4, 5, 6, 7, 8, 9, 11 (query wiring at the
 * provider boundary), 12, and the explicit V3 negative proof (valid signature + wrong
 * localization_geometry_ref -> DENY). End-to-end product-level proofs (2 full, 3, 10, and the
 * legacy-compatibility proof) live in localizationGeometryProductProofs.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '../../packages/mps-runtime/src/repository/InMemoryArtifactRepository';
import {
  createLocalizationGeometryArtifact,
  validateLocalizationGeometryArtifact,
  type LocalizationGeometryArtifact,
} from '../../packages/mps-lu/src/artifacts/LocalizationGeometryArtifact';
import {
  registerLocalizationGeometry,
  resolveCurrentLocalizationGeometry,
} from '../../server/modules/localization/localizationGeometryProjection';
import type { LocalizationGeometryProjectionIndex } from '../../server/repositories/localizationGeometryProjectionRepository';
import { SpatialProviderPostGIS } from '../../packages/spatial-provider-postgis/src/SpatialProviderPostGIS';
import { SPATIAL_LAYER_REGISTRY } from '../../packages/spatial-provider-postgis/src/SpatialLayerRegistry';
import type { LUPropertyContextArtifact } from '../../packages/mps-lu/src/artifacts/LUPropertyContextArtifact';
import {
  computeExecutionIdentityArtifactIdV3,
  computeExecutionManifestIdV3,
  LU_EXECUTION_IDENTITY_SCOPE_V3,
  type ExecutionIdentitySubjectV3,
} from '../../packages/mps-runtime/src/execution/ExecutionIdentityScopeV2';
import {
  buildExecutionIdentityAttestationPredicate,
  verifyExecutionIdentityAttestation,
} from '../../packages/mps-lu/src/execution/ExecutionIdentityAttestation';
import { issueExecutionIdentityV3 } from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import { LU_EXECUTION_PRINCIPAL_ID } from '../../packages/mps-lu/src/execution/LuExecutionKernelClient';
import {
  getLuExecutionAuthorityVerifier,
  __resetLuExecutionAuthorityVerifierForTests,
} from '../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { __resetLuExecutionAuthoritySigningProviderForTests } from '../../server/security/luExecutionAuthoritySigningKey';
import { sha256ContentHash } from '../../packages/mps-compliance/src/canonical/sha256Canonical';
import { issueExecutionIdentityV2 } from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';

const PROPERTY_REF = { artifact_id: 'property-ctx-proof-1', artifact_type: 'LU_PROPERTY_CONTEXT' as const };
const OTHER_PROPERTY_REF = { artifact_id: 'property-ctx-proof-OTHER', artifact_type: 'LU_PROPERTY_CONTEXT' as const };

function makeGeometry(overrides?: Partial<Parameters<typeof createLocalizationGeometryArtifact>[0]>): LocalizationGeometryArtifact {
  return createLocalizationGeometryArtifact({
    project_id: 'project-proof-1',
    property_context_ref: PROPERTY_REF,
    wgs84LngLat: [18.07, 59.33],
    sweref99NorthingEasting: [6580000, 674000],
    provenance: 'user_defined',
    label: 'Test point',
    created_by: 'tester',
    ...overrides,
  });
}

// In-memory fake mirroring the real Prisma-backed LocalizationGeometryProjectionIndex's public
// contract exactly (register is ON CONFLICT DO NOTHING; listForProject returns createdAt desc).
class FakeLocalizationGeometryProjectionIndex implements LocalizationGeometryProjectionIndex {
  private rows: Array<{
    projectId: string;
    geometryArtifactId: string;
    propertyContextRefId: string;
    propertyContextRefType: string;
    createdAt: Date;
  }> = [];

  async register(row: {
    projectId: string;
    geometryArtifactId: string;
    propertyContextRef: { artifact_id: string; artifact_type: string };
  }): Promise<void> {
    if (this.rows.some((r) => r.projectId === row.projectId && r.geometryArtifactId === row.geometryArtifactId)) {
      return; // ON CONFLICT DO NOTHING
    }
    this.rows.push({
      projectId: row.projectId,
      geometryArtifactId: row.geometryArtifactId,
      propertyContextRefId: row.propertyContextRef.artifact_id,
      propertyContextRefType: row.propertyContextRef.artifact_type,
      createdAt: new Date(Date.now() + this.rows.length), // monotonic insertion order
    });
  }

  async listForProject(projectId: string) {
    return this.rows.filter((r) => r.projectId === projectId).map((r) => ({ ...r }));
  }

  get rowCount(): number {
    return this.rows.length;
  }
}

describe('PRODUCT-LU-LOCALIZATION-GEOMETRY-01 — artifact contract proofs', () => {
  it('proof 1: same exact point -> same artifact identity (idempotent creation)', () => {
    const a = makeGeometry();
    const b = makeGeometry();
    expect(a.artifact_id).toBe(b.artifact_id);
    expect(a.content_hash.value).toBe(b.content_hash.value);
  });

  it('proof 12 (artifact half): same property + project, different point -> different artifact identity', () => {
    const a = makeGeometry({ wgs84LngLat: [18.07, 59.33], sweref99NorthingEasting: [6580000, 674000] });
    const b = makeGeometry({ wgs84LngLat: [18.08, 59.34], sweref99NorthingEasting: [6581000, 674100] });
    expect(a.artifact_id).not.toBe(b.artifact_id);
  });

  it('proof 8: unsupported geometry type -> REJECT (DENY for V1)', () => {
    const geometry = makeGeometry();
    const tampered = {
      ...geometry,
      payload: { ...geometry.payload, geometry_type: 'POLYGON' as unknown as 'POINT' },
    };
    expect(() => validateLocalizationGeometryArtifact(tampered)).toThrow(/REJECT_LOCALIZATION_GEOMETRY_UNSUPPORTED_TYPE/);
  });

  it('proof 9a: invalid SRID -> REJECT', () => {
    const geometry = makeGeometry();
    const wrongSrid = { ...geometry, payload: { ...geometry.payload, srid: 4326 } };
    expect(() => validateLocalizationGeometryArtifact(wrongSrid)).toThrow(/REJECT_LOCALIZATION_GEOMETRY_UNSUPPORTED_SRID/);
  });

  it('proof 9b: non-finite / malformed coordinate pair -> REJECT', () => {
    const geometry = makeGeometry();
    const badCoords = {
      ...geometry,
      payload: { ...geometry.payload, coordinates: [Number.NaN, 674000] as unknown as readonly [number, number] },
    };
    expect(() => validateLocalizationGeometryArtifact(badCoords)).toThrow(/REJECT_LOCALIZATION_GEOMETRY/);
  });

  it('proof 7a: tampered content_hash -> REJECT (fail closed)', () => {
    const geometry = makeGeometry();
    const tampered = { ...geometry, content_hash: { algorithm: 'sha256' as const, value: 'f'.repeat(64) } };
    expect(() => validateLocalizationGeometryArtifact(tampered)).toThrow(/content_hash mismatch/);
  });

  it('proof 7b: tampered payload (artifact_id no longer matches its own payload) -> REJECT', () => {
    const geometry = makeGeometry();
    // Recompute content_hash to match the tampered payload (so the content_hash check alone
    // would pass) -- isolates the SEPARATE artifact_id-from-payload self-consistency check.
    const tamperedPayload = { ...geometry.payload, label: 'a different label entirely' };
    const recomputedHash = sha256ContentHash({
      artifact_id: geometry.artifact_id,
      artifact_type: geometry.artifact_type,
      references: geometry.references,
      payload: tamperedPayload,
    });
    const tampered = { ...geometry, payload: tamperedPayload, content_hash: recomputedHash };
    expect(() => validateLocalizationGeometryArtifact(tampered)).toThrow(
      /artifact_id does not match its own payload/,
    );
  });
});

describe('PRODUCT-LU-LOCALIZATION-GEOMETRY-01 — current-geometry projection proofs', () => {
  it('proof 1 (projection half): re-registering the identical point is idempotent, not a duplicate', async () => {
    const repo = new InMemoryArtifactRepository();
    const index = new FakeLocalizationGeometryProjectionIndex();
    const geometry = makeGeometry();
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    await registerLocalizationGeometry({ projectId: 'project-proof-1', geometry, index });
    await registerLocalizationGeometry({ projectId: 'project-proof-1', geometry, index });
    expect(index.rowCount).toBe(1);

    const current = await resolveCurrentLocalizationGeometry({
      projectId: 'project-proof-1',
      artifactRepository: repo,
      index,
    });
    expect(current.geometryArtifactId).toBe(geometry.artifact_id);
  });

  it('proof 4: wrong-project geometry -> DENY (never resolved as current for a different project)', async () => {
    const repo = new InMemoryArtifactRepository();
    const index = new FakeLocalizationGeometryProjectionIndex();
    const geometry = makeGeometry({ project_id: 'project-proof-1' });
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });
    await registerLocalizationGeometry({ projectId: 'project-proof-1', geometry, index });

    await expect(
      resolveCurrentLocalizationGeometry({ projectId: 'project-DIFFERENT', artifactRepository: repo, index }),
    ).rejects.toThrow(/REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND/);
  });

  it('proof 5: wrong property-context geometry -> DENY (projection row disagrees with the CAS artifact)', async () => {
    const repo = new InMemoryArtifactRepository();
    const index = new FakeLocalizationGeometryProjectionIndex();
    const geometry = makeGeometry({ property_context_ref: PROPERTY_REF });
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });
    // Register the row claiming a DIFFERENT property_context_ref than the artifact actually carries.
    await index.register({ projectId: 'project-proof-1', geometryArtifactId: geometry.artifact_id, propertyContextRef: OTHER_PROPERTY_REF });

    await expect(
      resolveCurrentLocalizationGeometry({ projectId: 'project-proof-1', artifactRepository: repo, index }),
    ).rejects.toThrow(/REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND/);
  });

  it('proof 6: missing CAS object -> DENY / fail closed', async () => {
    const repo = new InMemoryArtifactRepository();
    const index = new FakeLocalizationGeometryProjectionIndex();
    // Register a projection row pointing at an artifact_id that was never actually put into CAS.
    await index.register({
      projectId: 'project-proof-1',
      geometryArtifactId: 'localization-geometry-never-persisted',
      propertyContextRef: PROPERTY_REF,
    });

    await expect(
      resolveCurrentLocalizationGeometry({ projectId: 'project-proof-1', artifactRepository: repo, index }),
    ).rejects.toThrow(/REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND/);
  });

  it('proof 7: tampered CAS object -> DENY / fail closed (candidate rejected, not silently trusted)', async () => {
    const repo = new InMemoryArtifactRepository();
    const index = new FakeLocalizationGeometryProjectionIndex();
    const geometry = makeGeometry();
    const tampered: LocalizationGeometryArtifact = {
      ...geometry,
      payload: { ...geometry.payload, label: 'tampered after the fact' },
    };
    // Persisted to CAS under the ORIGINAL artifact_id but with a body that no longer matches its
    // own content_hash/artifact_id -- exactly what a direct DB/CAS tamper would look like.
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: tampered });
    await index.register({ projectId: 'project-proof-1', geometryArtifactId: geometry.artifact_id, propertyContextRef: PROPERTY_REF });

    await expect(
      resolveCurrentLocalizationGeometry({ projectId: 'project-proof-1', artifactRepository: repo, index }),
    ).rejects.toThrow(/REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND/);
  });
});

describe('PRODUCT-LU-LOCALIZATION-GEOMETRY-01 — spatial query wiring proofs (provider boundary)', () => {
  function seedProperty(repo: InMemoryArtifactRepository, coordinates: readonly [number, number] = [6580000, 674000]) {
    const property: LUPropertyContextArtifact = {
      artifact_id: PROPERTY_REF.artifact_id,
      artifact_type: 'LU_PROPERTY_CONTEXT',
      content_hash: { algorithm: 'sha256', value: 'irrelevant-for-this-proof' },
      references: [],
      payload: {
        property_ref: 'TEST 1:1',
        official_name: 'Test property',
        geometry_ref: { artifact_id: 'geom-1', artifact_type: 'CANONICAL_PROPERTY_GEOMETRY' },
        municipality: 'TESTKOMMUN',
        coordinates,
      },
    };
    return repo.put({ artifact_id: property.artifact_id, content_hash: property.content_hash, body: property }).then(() => property);
  }

  it('proof 11: explicit point reaches the spatial query exactly (not the property centroid) when location_ref is supplied', async () => {
    const repo = new InMemoryArtifactRepository();
    await seedProperty(repo, [6580000, 674000]); // property centroid, deliberately different from the explicit point below
    const explicitGeometry = makeGeometry({
      sweref99NorthingEasting: [6590000, 675000], // a DIFFERENT point than the property centroid
    });
    await repo.put({ artifact_id: explicitGeometry.artifact_id, content_hash: explicitGeometry.content_hash, body: explicitGeometry });

    const provider = new SpatialProviderPostGIS('postgresql://unused-in-this-proof', repo);
    const queryCalls: Array<{ easting: number; northing: number }> = [];
    const poolQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('PostgisImportBatch')) {
        return { rows: [{ content_bundle_sha256: SPATIAL_LAYER_REGISTRY.water!.version_hash, dataset_version: 'test' }] };
      }
      if (sql.includes('ST_DWithin')) {
        const [easting, northing] = params as [number, number, number, number];
        queryCalls.push({ easting, northing });
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL in proof 11: ${sql}`);
    });
    (provider as unknown as { pool: { query: typeof poolQuery } }).pool = { query: poolQuery };

    await provider.query({
      property_ref: PROPERTY_REF,
      location_ref: { artifact_id: explicitGeometry.artifact_id, artifact_type: explicitGeometry.artifact_type },
      layers: [{ name: 'water', version_hash: 'v1.0' }],
    });

    expect(queryCalls).toHaveLength(1);
    // SWEREF99 TM [northing, easting] -> the SQL binds (easting, northing) in that param order.
    expect(queryCalls[0]).toEqual({ northing: 6590000, easting: 675000 });
  });

  it('proof 11b: falls back to the property centroid when no location_ref is supplied (backward compatible)', async () => {
    const repo = new InMemoryArtifactRepository();
    await seedProperty(repo, [6580000, 674000]);
    const provider = new SpatialProviderPostGIS('postgresql://unused-in-this-proof', repo);
    const queryCalls: Array<{ easting: number; northing: number }> = [];
    const poolQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('PostgisImportBatch')) {
        return { rows: [{ content_bundle_sha256: SPATIAL_LAYER_REGISTRY.water!.version_hash, dataset_version: 'test' }] };
      }
      if (sql.includes('ST_DWithin')) {
        const [easting, northing] = params as [number, number, number, number];
        queryCalls.push({ easting, northing });
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    (provider as unknown as { pool: { query: typeof poolQuery } }).pool = { query: poolQuery };

    await provider.query({ property_ref: PROPERTY_REF, layers: [{ name: 'water', version_hash: 'v1.0' }] });

    expect(queryCalls[0]).toEqual({ northing: 6580000, easting: 674000 });
  });

  it('proof 5b (provider boundary): wrong property-context geometry -> DENY, query never executes', async () => {
    const repo = new InMemoryArtifactRepository();
    await seedProperty(repo, [6580000, 674000]);
    const wrongPropertyGeometry = makeGeometry({ property_context_ref: OTHER_PROPERTY_REF });
    await repo.put({
      artifact_id: wrongPropertyGeometry.artifact_id,
      content_hash: wrongPropertyGeometry.content_hash,
      body: wrongPropertyGeometry,
    });

    const provider = new SpatialProviderPostGIS('postgresql://unused-in-this-proof', repo);
    const poolQuery = vi.fn();
    (provider as unknown as { pool: { query: typeof poolQuery } }).pool = { query: poolQuery };

    await expect(
      provider.query({
        property_ref: PROPERTY_REF,
        location_ref: { artifact_id: wrongPropertyGeometry.artifact_id, artifact_type: wrongPropertyGeometry.artifact_type },
        layers: [{ name: 'water', version_hash: 'v1.0' }],
      }),
    ).rejects.toThrow(/REJECT_LOCALIZATION_GEOMETRY_WRONG_PROPERTY/);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('proof 6b (provider boundary): missing CAS geometry -> DENY, query never executes', async () => {
    const repo = new InMemoryArtifactRepository();
    await seedProperty(repo, [6580000, 674000]);
    const provider = new SpatialProviderPostGIS('postgresql://unused-in-this-proof', repo);
    const poolQuery = vi.fn();
    (provider as unknown as { pool: { query: typeof poolQuery } }).pool = { query: poolQuery };

    await expect(
      provider.query({
        property_ref: PROPERTY_REF,
        location_ref: { artifact_id: 'localization-geometry-never-persisted', artifact_type: 'localization_geometry' },
        layers: [{ name: 'water', version_hash: 'v1.0' }],
      }),
    ).rejects.toThrow();
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe('PRODUCT-LU-LOCALIZATION-GEOMETRY-01 — ExecutionIdentity V3 pure-function proofs', () => {
  afterEach(() => {
    __resetLuExecutionAuthorityVerifierForTests(null);
    __resetLuExecutionAuthoritySigningProviderForTests(null);
  });

  const geometryRefA = { artifact_id: 'localization-geometry-point-a', artifact_type: 'localization_geometry' as const };
  const geometryRefB = { artifact_id: 'localization-geometry-point-b', artifact_type: 'localization_geometry' as const };
  const baseSubject = {
    site_id: 'property:test:proof',
    project_context_binding_ref: { artifact_id: 'binding-1', artifact_type: 'project_context_binding' as const },
    product_release_ref: { artifact_id: 'release-1', artifact_type: 'product_release_manifest' as const },
    execution_contract_version: 'lu-execution-identity-v1',
  };

  it('proof 12: same property + binding + release, different point -> distinct V3 subject/identity/manifest', () => {
    const subjectA: ExecutionIdentitySubjectV3 = { ...baseSubject, localization_geometry_ref: geometryRefA };
    const subjectB: ExecutionIdentitySubjectV3 = { ...baseSubject, localization_geometry_ref: geometryRefB };
    expect(computeExecutionIdentityArtifactIdV3(subjectA)).not.toBe(computeExecutionIdentityArtifactIdV3(subjectB));
    expect(computeExecutionManifestIdV3(subjectA)).not.toBe(computeExecutionManifestIdV3(subjectB));
  });

  it('proof 1 (identity half): identical V3 subject -> identical identity/manifest id (deterministic, idempotent)', () => {
    const subjectA1: ExecutionIdentitySubjectV3 = { ...baseSubject, localization_geometry_ref: geometryRefA };
    const subjectA2: ExecutionIdentitySubjectV3 = { ...baseSubject, localization_geometry_ref: { ...geometryRefA } };
    expect(computeExecutionIdentityArtifactIdV3(subjectA1)).toBe(computeExecutionIdentityArtifactIdV3(subjectA2));
    expect(computeExecutionManifestIdV3(subjectA1)).toBe(computeExecutionManifestIdV3(subjectA2));
  });

  it('negative proof: valid signature + wrong localization_geometry_ref -> DENY (SUBJECT_MISMATCH)', async () => {
    const repo = new InMemoryArtifactRepository();
    const authorityKey = LocalPemSigningKeyProvider.generate('ed25519:lu-authority-proof-negative-v3');
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = authorityKey.privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = authorityKey.publicKey;
    try {
      const subjectA: ExecutionIdentitySubjectV3 = { ...baseSubject, localization_geometry_ref: geometryRefA };
      const capabilityRef = { artifact_id: 'cap-lu-site-assessment-proof', artifact_type: 'CAPABILITY_DEFINITION' as const };
      const actorRef = { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' as const };

      const identity = await issueExecutionIdentityV3({
        subject: subjectA,
        deterministic_seed: 'seed-proof-negative-v3',
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'release-snapshot-proof',
        artifact_repository: repo,
      });
      const attestation = await repo.resolve<{ signer: string; predicateType: string; subjectDigest: string; predicate: unknown }>(
        identity.signature_envelope_ref,
      );

      const expectedPredicate = buildExecutionIdentityAttestationPredicate({
        execution_identity_id: identity.artifact_id,
        actor_ref: identity.actor_ref,
        capability_ref: identity.capability_ref,
        release_snapshot_id: 'release-snapshot-proof',
        site_id: subjectA.site_id,
        deterministic_seed: 'seed-proof-negative-v3',
      });

      // The identity was validly minted and validly signed for point A. A caller that expects
      // point B (a genuinely different, valid V3 subject differing ONLY in the geometry ref) must
      // be denied -- a valid signature over the WRONG subject is not authorization for this run.
      const expectedSubjectB: ExecutionIdentitySubjectV3 = { ...baseSubject, localization_geometry_ref: geometryRefB };
      const result = await verifyExecutionIdentityAttestation({
        identity,
        attestation: attestation as unknown as Parameters<typeof verifyExecutionIdentityAttestation>[0]['attestation'],
        expectedPredicate,
        authorityVerifier: getLuExecutionAuthorityVerifier(),
        expectedSubjectV3: expectedSubjectB,
      });

      expect(result).toEqual({ verified: false, reason: 'SUBJECT_MISMATCH' });

      // Counter-proof: the SAME identity against its OWN correct subject (point A) verifies fine
      // -- isolating that the denial above is specifically the geometry-ref mismatch, not some
      // unrelated breakage in the attestation chain.
      const resultCorrect = await verifyExecutionIdentityAttestation({
        identity,
        attestation: attestation as unknown as Parameters<typeof verifyExecutionIdentityAttestation>[0]['attestation'],
        expectedPredicate,
        authorityVerifier: getLuExecutionAuthorityVerifier(),
        expectedSubjectV3: subjectA,
      });
      expect(resultCorrect.verified).toBe(true);
    } finally {
      delete process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
      delete process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    }
  });

  it('proof 2 (identity half): old V2-scoped identity cannot authorize a V3-required (point-bound) run', async () => {
    // A hand-built V2 identity (no subject_v3 at all) can never satisfy a caller that requires
    // V3 -- exact-match-only contract, no "V2 is close enough" fallback. See
    // ExecutionIdentityAttestation.ts step 5's LEGACY_IDENTITY_NOT_ALLOWED branch.
    const repo = new InMemoryArtifactRepository();
    const authorityKey = LocalPemSigningKeyProvider.generate('ed25519:lu-authority-proof-v2-vs-v3');
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM = authorityKey.privateKey;
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM = authorityKey.publicKey;
    try {
      const capabilityRef = { artifact_id: 'cap-lu-site-assessment-proof-2', artifact_type: 'CAPABILITY_DEFINITION' as const };
      const actorRef = { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' as const };
      const v2Identity = await issueExecutionIdentityV2({
        subject: baseSubject,
        deterministic_seed: 'seed-proof-2',
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: 'release-snapshot-proof-2',
        artifact_repository: repo,
      });
      const attestation = await repo.resolve<{ signer: string; predicateType: string; subjectDigest: string; predicate: unknown }>(
        v2Identity.signature_envelope_ref,
      );
      const expectedPredicate = buildExecutionIdentityAttestationPredicate({
        execution_identity_id: v2Identity.artifact_id,
        actor_ref: v2Identity.actor_ref,
        capability_ref: v2Identity.capability_ref,
        release_snapshot_id: 'release-snapshot-proof-2',
        site_id: baseSubject.site_id,
        deterministic_seed: 'seed-proof-2',
      });
      const subjectA: ExecutionIdentitySubjectV3 = { ...baseSubject, localization_geometry_ref: geometryRefA };
      const result = await verifyExecutionIdentityAttestation({
        identity: v2Identity,
        attestation: attestation as unknown as Parameters<typeof verifyExecutionIdentityAttestation>[0]['attestation'],
        expectedPredicate,
        authorityVerifier: getLuExecutionAuthorityVerifier(),
        expectedSubjectV3: subjectA,
      });
      expect(result).toEqual({ verified: false, reason: 'LEGACY_IDENTITY_NOT_ALLOWED' });
    } finally {
      delete process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM;
      delete process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM;
    }
  });
});
