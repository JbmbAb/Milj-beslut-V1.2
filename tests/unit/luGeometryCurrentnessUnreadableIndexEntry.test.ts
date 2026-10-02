/**
 * U30-A6 x ADV-1 (coordinator addition): a read failure on the CAS id->hash index entry of the
 * CURRENT geometry B must never make its superseded predecessor A current.
 *
 * Before U30-A6, MimersByteStorageBackend.readHash() turned every index read failure into "not
 * indexed": the resolver then threw `Artifact not found: <B>`, which LocalizationGeometryCurrentProvider
 * correctly treats as a DETERMINED missing verdict (frozen reject-and-continue posture) -- so B
 * was excluded, the A -> B edge was dropped with it, and A resolved as the current point. The
 * misclassification sat in the storage layer, not in the provider.
 *
 * Real stack end to end, no database: FileCASRepository in a temp directory ->
 * MimersByteStorageBackend -> CasBackedArtifactRepository -> LocalizationGeometryCurrentProvider
 * (real graph reduction, geometry validation, supersession signing and verification). The two
 * projection indexes are in-memory candidate lists; server/db/prisma is replaced by the hermetic
 * guard (it throws on any access). The fault is real: B's index entry is replaced by a directory,
 * so reading it fails with EISDIR.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import { FileCASRepository, LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
  createLocalizationGeometryArtifactV2,
  createLocalizationGeometrySupersessionArtifact,
  createLocalizationGeometrySupersessionIssuerArtifact,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import { MimersByteStorageBackend } from '../../packages/mps-runtime/src/repository/MimersByteStorageBackend';
import { CasBackedArtifactRepository } from '../../packages/mps-runtime/src/repository/CasBackedArtifactRepository';
import { sha256ContentHash } from '../../packages/mps-runtime/src/kernel/ExecutionKernel';
import {
  LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE_PREFIX,
  LocalizationGeometryCurrentProvider,
} from '../../server/modules/localization/localizationGeometryCurrentProvider';
import {
  attestLocalizationGeometrySupersessionArtifact,
  attestLocalizationGeometrySupersessionIssuerArtifact,
} from '../../server/modules/localization/localizationGeometrySupersessionAuthority';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const PROJECT_ID = 'project-u30-adv1';
const PROPERTY_REF = { artifact_id: 'property-ctx-u30-adv1', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const key = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-issuer-u30-adv1');

function userGeometry(northing: number): LocalizationGeometryArtifact {
  return createLocalizationGeometryArtifactV2({
    project_id: PROJECT_ID,
    property_context_ref: PROPERTY_REF,
    wgs84LngLat: [18.07, 59.33],
    sweref99NorthingEasting: [674571.9, northing],
    provenance: 'user_defined',
    label: `user point ${northing}`,
    created_by: 'user-u30-adv1',
  });
}

describe('ADV-1: unreadable index entry of the current geometry (U30-A6)', () => {
  let root: string;
  let indexDir: string;
  let repo: CasBackedArtifactRepository;
  let provider: LocalizationGeometryCurrentProvider;
  let a: LocalizationGeometryArtifact;
  let b: LocalizationGeometryArtifact;

  async function put(body: { artifact_id: string }): Promise<void> {
    await repo.put({ artifact_id: body.artifact_id, content_hash: sha256ContentHash(body), body });
  }

  function indexEntry(artifactId: string): string {
    return path.join(indexDir, `${createHash('sha256').update(artifactId).digest('hex')}.idx`);
  }

  beforeEach(async () => {
    hermeticPrismaTouches.length = 0;
    root = mkdtempSync(path.join(tmpdir(), 'u30-adv1-'));
    indexDir = path.join(root, 'cas', 'artifact-id-index');
    const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'none' });
    await cas.initialize();
    repo = new CasBackedArtifactRepository(new MimersByteStorageBackend(cas, indexDir));

    a = userGeometry(6580743.0);
    b = userGeometry(6580843.0);
    await put(a);
    await put(b);

    const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
      issuer_key_id: key.provider.keyId,
      owner_authority_ref: { artifact_id: 'owner-authority-u30-adv1', artifact_type: 'owner_authority_attestation' },
    });
    const issuer = { ...bareIssuer, attestation: await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing: key.provider }) };
    await put(issuer);
    const bareEdge = createLocalizationGeometrySupersessionArtifact({
      contract_version: LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
      project_id: PROJECT_ID,
      predecessor_geometry_ref: { artifact_id: a.artifact_id, artifact_type: a.artifact_type },
      successor_geometry_ref: { artifact_id: b.artifact_id, artifact_type: b.artifact_type },
      reason_code: 'USER_LOCALIZATION_CHANGE_V1',
      issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
      issuer_key_id: key.provider.keyId,
      issued_at: '2026-10-02T00:00:00.000Z',
    });
    const edge = { ...bareEdge, attestation: await attestLocalizationGeometrySupersessionArtifact({ artifact: bareEdge, issuer, signing: key.provider }) };
    await put(edge);

    const geometryRow = (g: LocalizationGeometryArtifact) => ({
      projectId: PROJECT_ID,
      geometryArtifactId: g.artifact_id,
      propertyContextRefId: PROPERTY_REF.artifact_id,
      propertyContextRefType: PROPERTY_REF.artifact_type,
      createdAt: new Date(),
    });
    provider = new LocalizationGeometryCurrentProvider(
      repo,
      { listForProject: async () => [geometryRow(a), geometryRow(b)] } as never,
      {
        listForProject: async () => [
          {
            projectId: PROJECT_ID,
            supersessionArtifactId: edge.artifact_id,
            predecessorGeometryArtifactId: a.artifact_id,
            successorGeometryArtifactId: b.artifact_id,
            createdAt: new Date(),
          },
        ],
      } as never,
      new LocalPemVerificationKeyProvider(key.provider.keyId, key.publicKey),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('control: everything readable -> B (the successor) is current', async () => {
    const current = await provider.resolveCurrent(PROJECT_ID);
    expect(current.artifact_id).toBe(b.artifact_id);
    expect(hermeticPrismaTouches).toEqual([]);
  });

  it("B's index entry unreadable -> resolution fails closed (candidate unresolvable), A is NEVER current", async () => {
    rmSync(indexEntry(b.artifact_id));
    mkdirSync(indexEntry(b.artifact_id)); // a directory where the entry file was: reading it fails (EISDIR)

    const outcome = await provider.resolveCurrent(PROJECT_ID).then(
      (current) => ({ resolved: current.artifact_id === a.artifact_id ? 'A (superseded)' : current.artifact_id === b.artifact_id ? 'B' : current.artifact_id }),
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
    );

    expect(outcome).not.toEqual({ resolved: 'A (superseded)' });
    expect(outcome).toHaveProperty('error');
    const message = (outcome as { error: string }).error;
    expect(message.startsWith(`${LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE_PREFIX}: geometry ${b.artifact_id}`)).toBe(true);
    expect(message).toContain('MIMERS_ARTIFACT_INDEX_READ_FAILED');
    expect(hermeticPrismaTouches).toEqual([]);
  });
});
