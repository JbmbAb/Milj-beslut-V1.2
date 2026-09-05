// packages/mps-legal-corpus/tests/SourceRegistryAdmissionAuthority.test.ts
//
// K2.1 — CORPUS-ADMISSION-REGISTRY-BINDING.
// Dedicated tests for the registry-binding helper in isolation from CorpusImportGate. Uses a
// synthetic, locally-generated signing key and a temp-file registry — never a live network call,
// never the real production source-registry/national-registry.json.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { approveSourceRegistryEntry } from '../../mps-data-governance/src/SourceApproval';
import type { SourceRegistryArtifact } from '../../mps-data-governance/src/SourceRegistry';
import { createRegistryAdmissionAuthority } from '../src/SourceRegistryAdmissionAuthority';

async function buildRegistryFixture(): Promise<{
  readonly dir: string;
  readonly registryPath: string;
  readonly signingOptions: { registryPath: string; signing: LocalPemVerificationKeyProvider };
  readonly approvedArtifactId: string;
  readonly approvedContentHash: string;
}> {
  const { provider: signing, publicKey } = LocalPemSigningKeyProvider.generate(
    'ed25519:test-registry-admission-authority',
  );
  const verification = new LocalPemVerificationKeyProvider(signing.keyId, publicKey);

  const draft: Omit<SourceRegistryArtifact, 'approval_attestation'> = {
    artifact_id: 'reg-test-source-001',
    artifact_type: 'SOURCE_REGISTRY_ENTRY',
    source_id: 'test-source',
    producer: { producer_id: 'TEST', name: 'Test Authority', type: 'agency' },
    channel: {
      channel_type: 'WEBSITE',
      endpoint_url: 'https://example.invalid/test-source',
      allowed_domains: ['example.invalid'],
    },
    adapter: 'SINGLE_ENDPOINT_V1',
    artifact_types: ['LAW'],
    collection_frequency: 'WEEKLY',
    change_detection: { strategy: 'CONTENT_HASH' },
    policy: {
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
    },
    lifecycle_state: 'REGISTERED',
  };

  const approved = await approveSourceRegistryEntry({
    entry: draft,
    approver_actor_id: 'test-reviewer',
    signing,
  });

  const dir = mkdtempSync(join(tmpdir(), 'k2-1-registry-fixture-'));
  const registryPath = join(dir, 'national-registry.json');
  writeFileSync(registryPath, JSON.stringify([approved], null, 2), 'utf8');

  return {
    dir,
    registryPath,
    signingOptions: { registryPath, signing: verification },
    approvedArtifactId: approved.artifact_id,
    approvedContentHash: approved.approval_attestation.predicate.source_content_hash as string,
  };
}

describe('createRegistryAdmissionAuthority', () => {
  it('admits a real, currently-APPROVED registry entry with a matching content hash', async () => {
    const fixture = await buildRegistryFixture();
    try {
      const authority = createRegistryAdmissionAuthority(fixture.signingOptions);
      const result = await authority.checkAdmissible(fixture.approvedArtifactId, fixture.approvedContentHash);
      expect(result.ok).toBe(true);
      expect(result.reason).toBeUndefined();
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('RED-A / denies a fabricated registry_artifact_id that never existed', async () => {
    const fixture = await buildRegistryFixture();
    try {
      const authority = createRegistryAdmissionAuthority(fixture.signingOptions);
      const result = await authority.checkAdmissible('reg-does-not-exist-999', fixture.approvedContentHash);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('ARTIFACT_NOT_FOUND');
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('RED-C / denies an artifact_id that is no longer present in the active registry (revoked/superseded)', async () => {
    // This repo's own convention for revocation/supersession is removal from the active
    // registry file (see docs/architecture/KNOWLEDGE-INGESTION-REACHABILITY-AUDIT-2026-09-05.md),
    // not an in-file REJECTED/QUARANTINED marker left behind. A once-real, now-removed
    // artifact_id must resolve identically to a never-real one: both mean "not currently usable".
    const fixture = await buildRegistryFixture();
    try {
      const authority = createRegistryAdmissionAuthority(fixture.signingOptions);
      const result = await authority.checkAdmissible(
        'reg-test-source-000-superseded',
        fixture.approvedContentHash,
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('ARTIFACT_NOT_FOUND');
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('RED-B / denies a wrong registry_source_content_hash for a real artifact_id', async () => {
    const fixture = await buildRegistryFixture();
    try {
      const authority = createRegistryAdmissionAuthority(fixture.signingOptions);
      const result = await authority.checkAdmissible(fixture.approvedArtifactId, '00'.repeat(32));
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('CONTENT_HASH_MISMATCH');
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('RED-D / denies when the registry file does not exist at all — fails closed, not open', async () => {
    const authority = createRegistryAdmissionAuthority({
      registryPath: join(tmpdir(), 'k2-1-nonexistent-registry-' + Math.floor(Math.random() * 1e9) + '.json'),
    });
    const result = await authority.checkAdmissible('reg-anything', '11'.repeat(32));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('REGISTRY_UNAVAILABLE');
  });

  it('RED-D / denies when the registry file is present but signed by an untrusted key', async () => {
    const fixture = await buildRegistryFixture();
    try {
      // A DIFFERENT verification key than the one the fixture was actually signed with —
      // simulates missing/invalid signing configuration, which must deny, not silently pass.
      const wrongVerification = new LocalPemVerificationKeyProvider(
        fixture.signingOptions.signing.keyId,
        LocalPemSigningKeyProvider.generate('ed25519:unrelated-key').publicKey,
      );
      const authority = createRegistryAdmissionAuthority({
        registryPath: fixture.registryPath,
        signing: wrongVerification,
      });
      const result = await authority.checkAdmissible(fixture.approvedArtifactId, fixture.approvedContentHash);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('REGISTRY_UNAVAILABLE');
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('denies when registry_artifact_id / registry_source_content_hash are empty strings — no fallback', async () => {
    const fixture = await buildRegistryFixture();
    try {
      const authority = createRegistryAdmissionAuthority(fixture.signingOptions);
      const result = await authority.checkAdmissible('', '');
      expect(result.ok).toBe(false);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });
});
