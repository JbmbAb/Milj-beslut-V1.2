import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileCASRepository,
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { describe, expect, it } from 'vitest';

import {
  LEGACY_MASTER_ADMISSION_MODE,
  LegacyMasterAdmissionError,
  attestLegacyMasterAdmission,
  createLegacyMasterAdmissionDraft,
  persistLegacyMasterAdmission,
  resolveLegacyMasterAdmission,
  verifyLegacyMasterAdmissionArtifact,
} from '../src/LegacyMasterAdmission';
import type { VerifiedSourceDefinition } from '../src/SourceRegistry';

const KEY_ID = 'ed25519:test-legacy-master-admission';
const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);

function verifiedSource(overrides: Partial<VerifiedSourceDefinition> = {}): VerifiedSourceDefinition {
  return {
    sourceId: 'lantmateriet-stac-byggnader',
    authority: { name: 'Lantmäteriet', type: 'other' },
    endpointUrl: 'https://api.lantmateriet.se/stac-vektor/v1/collections/byggnader/items',
    adapter: 'LM_STAC_BYGGNADER_V1',
    frequency: 'weekly',
    allowedDomains: ['api.lantmateriet.se', 'dl1.lantmateriet.se'],
    artifactTypes: ['SPATIAL_DATASET'],
    policy: {
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      politeness_delay_ms: 1000,
      max_object_size_bytes: 52_428_800,
      retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
    },
    registryArtifactId: 'reg-lantmateriet-stac-byggnader-001',
    sourceContentHash: 'a'.repeat(64),
    ...overrides,
  };
}

async function issueFixture(args: { readonly filename?: string; readonly bytes?: Uint8Array } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'p2-lm-legacy-master-'));
  const bytes = args.bytes ?? BYTES;
  const filename = args.filename ?? '1762.zip';
  const filePath = join(root, filename);
  writeFileSync(filePath, bytes);
  const localBytes = await readFile(filePath);
  const crypto = await import('node:crypto');
  const sha256 = crypto.createHash('sha256').update(localBytes).digest('hex');
  const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
  const verification = new LocalPemVerificationKeyProvider(KEY_ID, generated.publicKey);
  const draft = createLegacyMasterAdmissionDraft({
    source: verifiedSource(),
    local_object_ref: { path: filePath, filename, size_bytes: localBytes.byteLength, sha256 },
    municipality_id: '1762',
    internal_asset_name: 'byggnad_kn1762.gpkg',
    admitted_at: '2026-08-20T12:00:00.000Z',
  });
  const artifact = await attestLegacyMasterAdmission({
    draft,
    approver_actor_id: 'owner:test',
    signing: generated.provider,
  });
  return { root, filePath, bytes, draft, artifact, verification, signing: generated.provider };
}

describe('P2-LM-BYGGNADER-LEGACY-MASTER-RECONCILIATION-ADMISSION-01', () => {
  it('admits a current byte observation without inventing historical acquisition or quarantine provenance', async () => {
    const fixture = await issueFixture();
    try {
      const cas = new FileCASRepository(join(fixture.root, 'cas'), { durabilityMode: 'none' });
      await cas.initialize();
      const reference = await persistLegacyMasterAdmission({
        artifact: fixture.artifact,
        verification: fixture.verification,
        cas,
      });
      const resolved = await resolveLegacyMasterAdmission({
        reference,
        verification: fixture.verification,
        cas,
      });

      expect(resolved.bytes).toEqual(fixture.bytes);
      expect(resolved.artifact.payload.admission_mode).toBe(LEGACY_MASTER_ADMISSION_MODE);
      expect(resolved.artifact.payload.historical_acquisition).toEqual({
        status: 'UNKNOWN',
        source_url: null,
        item_updated: null,
        retrieved_at: null,
        manifest_ref: null,
        quarantine_ref: null,
      });
      expect(JSON.stringify(resolved.artifact)).not.toContain('DownloadManifest');
      expect(JSON.stringify(resolved.artifact)).not.toContain('quarantine_id');
      expect(reference.current_byte_observation_ref).toBe(
        `sha256:${fixture.artifact.payload.local_object_ref.sha256}`,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('uses the exact same admission and CAS references when the same signed observation is replayed', async () => {
    const fixture = await issueFixture();
    try {
      const cas = new FileCASRepository(join(fixture.root, 'cas'), { durabilityMode: 'none' });
      await cas.initialize();
      const first = await persistLegacyMasterAdmission({
        artifact: fixture.artifact,
        verification: fixture.verification,
        cas,
      });
      const second = await persistLegacyMasterAdmission({
        artifact: fixture.artifact,
        verification: fixture.verification,
        cas,
      });
      expect(second).toEqual(first);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('gives changed bytes a distinct admission identity', async () => {
    const first = await issueFixture();
    const second = await issueFixture({ bytes: new Uint8Array([...BYTES, 0x04]) });
    try {
      expect(second.artifact.artifact_id).not.toBe(first.artifact.artifact_id);
      expect(second.artifact.content_hash).not.toBe(first.artifact.content_hash);
      expect(second.artifact.payload.current_byte_observation_ref).not.toBe(
        first.artifact.payload.current_byte_observation_ref,
      );
    } finally {
      await rm(first.root, { recursive: true, force: true });
      await rm(second.root, { recursive: true, force: true });
    }
  });

  it('denies changed local bytes before CAS persistence', async () => {
    const fixture = await issueFixture();
    try {
      writeFileSync(fixture.filePath, new Uint8Array([0x99]));
      const cas = new FileCASRepository(join(fixture.root, 'cas'), { durabilityMode: 'none' });
      await cas.initialize();
      await expect(
        persistLegacyMasterAdmission({ artifact: fixture.artifact, verification: fixture.verification, cas }),
      ).rejects.toMatchObject({ reason_code: 'REJECT_BYTE_OBSERVATION' });
      expect(await cas.exists(fixture.artifact.payload.current_byte_observation_ref)).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects a missing SHA-256, wrong source family, and a mismatched municipality before signing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'p2-lm-legacy-master-invalid-'));
    const filePath = join(root, '1762.zip');
    writeFileSync(filePath, BYTES);
    const base = {
      local_object_ref: { path: filePath, filename: '1762.zip', size_bytes: BYTES.byteLength, sha256: '' },
      municipality_id: '1762',
      internal_asset_name: 'byggnad_kn1762.gpkg',
      admitted_at: '2026-08-20T12:00:00.000Z',
    };
    try {
      expect(() => createLegacyMasterAdmissionDraft({ source: verifiedSource(), ...base })).toThrow(
        'REJECT_LEGACY_MASTER_SHAPE',
      );
      expect(() =>
        createLegacyMasterAdmissionDraft({
          source: verifiedSource({ sourceId: 'another-source' }),
          ...base,
        }),
      ).toThrow('REJECT_SOURCE_FAMILY');
      expect(() =>
        createLegacyMasterAdmissionDraft({
          source: verifiedSource(),
          ...base,
          local_object_ref: { ...base.local_object_ref, sha256: 'b'.repeat(64) },
          municipality_id: '9999',
        }),
      ).toThrow('REJECT_MUNICIPALITY_BINDING');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects fabricated historic acquisition fields even when their surrounding artifact is otherwise well formed', async () => {
    const fixture = await issueFixture();
    try {
      const forged = {
        ...fixture.artifact,
        payload: {
          ...fixture.artifact.payload,
          historical_acquisition: {
            ...fixture.artifact.payload.historical_acquisition,
            retrieved_at: '2025-01-01T00:00:00.000Z',
          },
        },
      };
      await expect(verifyLegacyMasterAdmissionArtifact(forged, fixture.verification)).rejects.toMatchObject({
        reason_code: 'REJECT_HISTORICAL_PROVENANCE',
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects an admission signed by an untrusted authority', async () => {
    const fixture = await issueFixture();
    try {
      const untrusted = LocalPemSigningKeyProvider.generate('ed25519:untrusted-legacy-master');
      const wrongVerification = new LocalPemVerificationKeyProvider(
        'ed25519:untrusted-legacy-master',
        untrusted.publicKey,
      );
      await expect(
        verifyLegacyMasterAdmissionArtifact(fixture.artifact, wrongVerification),
      ).rejects.toMatchObject({
        reason_code: 'REJECT_ADMISSION_SIGNATURE',
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects an untrusted admission before it can write observed bytes to CAS', async () => {
    const fixture = await issueFixture();
    try {
      const cas = new FileCASRepository(join(fixture.root, 'cas'), { durabilityMode: 'none' });
      await cas.initialize();
      const untrusted = LocalPemSigningKeyProvider.generate('ed25519:untrusted-legacy-master');
      const wrongVerification = new LocalPemVerificationKeyProvider(
        'ed25519:untrusted-legacy-master',
        untrusted.publicKey,
      );
      await expect(
        persistLegacyMasterAdmission({ artifact: fixture.artifact, verification: wrongVerification, cas }),
      ).rejects.toMatchObject({ reason_code: 'REJECT_ADMISSION_SIGNATURE' });
      expect(await cas.exists(fixture.artifact.payload.current_byte_observation_ref)).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
