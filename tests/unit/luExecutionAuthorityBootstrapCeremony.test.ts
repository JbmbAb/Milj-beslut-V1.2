import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '../../packages/mps-runtime/src/repository/InMemoryArtifactRepository';
import { createLuExecutionAuthorityIssuerArtifact } from '../../packages/mps-lu/src/artifacts/LuExecutionAuthorityArtifact';
import { verifyExecutionIdentityAttestation, buildExecutionIdentityAttestationPredicate } from '../../packages/mps-lu/src/execution/ExecutionIdentityAttestation';
import { issueExecutionIdentity } from '../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import { createLuRegistryRuntime } from '../../packages/mps-lu/src/registry/createLuRegistryRuntime';
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from '../../packages/mps-lu/src/registry/LuSiteAssessmentRegistry';
import { LU_EXECUTION_PRINCIPAL_ID } from '../../packages/mps-lu/src/execution/LuExecutionKernelClient';
import { __resetLuExecutionAuthoritySigningProviderForTests } from '../../server/security/luExecutionAuthoritySigningKey';
import {
  LU_EXECUTION_AUTHORITY_ISSUER_FAMILY,
  LU_EXECUTION_AUTHORITY_ROOT_FAMILY,
  bootstrapLuExecutionAuthorityCeremony,
  verifyLuExecutionAuthorityCeremony,
} from '../../server/security/luExecutionAuthorityBootstrapCeremony';
import { keypairPaths } from '../../server/security/ceremonyKeypairBootstrap';

const KEY_IDS = {
  rootKeyId: 'ed25519:ceremony-test-lu-root',
  issuerKeyId: 'ed25519:ceremony-test-lu-issuer',
};

function hashes(root: string): string[] {
  return [
    keypairPaths(root, LU_EXECUTION_AUTHORITY_ROOT_FAMILY).privatePath,
    keypairPaths(root, LU_EXECUTION_AUTHORITY_ROOT_FAMILY).publicPath,
    keypairPaths(root, LU_EXECUTION_AUTHORITY_ISSUER_FAMILY).privatePath,
    keypairPaths(root, LU_EXECUTION_AUTHORITY_ISSUER_FAMILY).publicPath,
  ].map((file) => createHash('sha256').update(readFileSync(file)).digest('hex'));
}

describe('LU root/issuer bootstrap ceremony', () => {
  const temporaryRoots: string[] = [];

  function temporaryRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'lu-root-issuer-ceremony-'));
    temporaryRoots.push(root);
    return root;
  }

  afterEach(() => {
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('creates a root-signed issuer chain and verifies it using public keys only', async () => {
    const repository = new InMemoryArtifactRepository();
    const ceremony = await bootstrapLuExecutionAuthorityCeremony({
      secretsRoot: temporaryRoot(),
      keyIds: KEY_IDS,
      repository,
    });

    const verified = await verifyLuExecutionAuthorityCeremony({
      issuerRef: { artifact_id: ceremony.issuer.artifact_id, artifact_type: ceremony.issuer.artifact_type },
      repository,
      rootPublicPem: ceremony.rootKeypair.publicPem,
      issuerPublicPem: ceremony.issuerKeypair.publicPem,
      keyIds: KEY_IDS,
    });

    expect(verified.artifact_id).toBe(ceremony.issuer.artifact_id);
    expect(verified.payload.root_ref.artifact_id).toBe(ceremony.root.artifact_id);
  });

  it('rejects a wrong root, an issuer without delegation, and a tampered delegation', async () => {
    const repository = new InMemoryArtifactRepository();
    const ceremony = await bootstrapLuExecutionAuthorityCeremony({
      secretsRoot: temporaryRoot(),
      keyIds: KEY_IDS,
      repository,
    });
    const rogueRoot = LocalPemSigningKeyProvider.generate('ed25519:rogue-root');
    await expect(verifyLuExecutionAuthorityCeremony({
      issuerRef: { artifact_id: ceremony.issuer.artifact_id, artifact_type: ceremony.issuer.artifact_type },
      repository,
      rootPublicPem: rogueRoot.publicKey,
      issuerPublicPem: ceremony.issuerKeypair.publicPem,
      keyIds: { ...KEY_IDS, rootKeyId: 'ed25519:rogue-root' },
    })).rejects.toThrow(/ROOT/);

    const unsignedRepo = new InMemoryArtifactRepository();
    await unsignedRepo.put({ artifact_id: ceremony.root.artifact_id, content_hash: ceremony.root.content_hash, body: ceremony.root });
    const unsignedIssuer = createLuExecutionAuthorityIssuerArtifact({
      issuer_key_id: KEY_IDS.issuerKeyId,
      public_key_fingerprint: ceremony.issuer.payload.public_key_fingerprint,
      root_ref: { artifact_id: ceremony.root.artifact_id, artifact_type: ceremony.root.artifact_type },
    });
    await unsignedRepo.put({ artifact_id: unsignedIssuer.artifact_id, content_hash: unsignedIssuer.content_hash, body: unsignedIssuer });
    await expect(verifyLuExecutionAuthorityCeremony({
      issuerRef: { artifact_id: unsignedIssuer.artifact_id, artifact_type: unsignedIssuer.artifact_type },
      repository: unsignedRepo,
      rootPublicPem: ceremony.rootKeypair.publicPem,
      issuerPublicPem: ceremony.issuerKeypair.publicPem,
      keyIds: KEY_IDS,
    })).rejects.toThrow(/ISSUER_SIGNATURE/);

    const tamperedRepo = new InMemoryArtifactRepository();
    await tamperedRepo.put({ artifact_id: ceremony.root.artifact_id, content_hash: ceremony.root.content_hash, body: ceremony.root });
    await tamperedRepo.put({
      artifact_id: ceremony.issuer.artifact_id,
      content_hash: ceremony.issuer.content_hash,
      body: { ...ceremony.issuer, payload: { ...ceremony.issuer.payload, issuer_key_id: 'ed25519:tampered' } },
    });
    await expect(verifyLuExecutionAuthorityCeremony({
      issuerRef: { artifact_id: ceremony.issuer.artifact_id, artifact_type: ceremony.issuer.artifact_type },
      repository: tamperedRepo,
      rootPublicPem: ceremony.rootKeypair.publicPem,
      issuerPublicPem: ceremony.issuerKeypair.publicPem,
      keyIds: KEY_IDS,
    })).rejects.toThrow(/CANONICAL/);
  });

  it('lets the delegated issuer sign a real execution identity that a public-only verifier accepts', async () => {
    const repository = new InMemoryArtifactRepository();
    const ceremony = await bootstrapLuExecutionAuthorityCeremony({
      secretsRoot: temporaryRoot(),
      keyIds: KEY_IDS,
      repository,
    });
    __resetLuExecutionAuthoritySigningProviderForTests(
      new LocalPemSigningKeyProvider(KEY_IDS.issuerKeyId, ceremony.issuerKeypair.privatePem, ceremony.issuerKeypair.publicPem),
    );
    const registry = createLuRegistryRuntime();
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
    const identity = await issueExecutionIdentity({
      site_id: 'ceremony-test-site',
      deterministic_seed: 'ceremony-test-seed',
      actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' },
      capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
      release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      issuer_ref: { artifact_id: ceremony.issuer.artifact_id, artifact_type: ceremony.issuer.artifact_type },
      artifact_repository: repository,
    });
    const attestation = await repository.resolve<any>(identity.signature_envelope_ref);
    const verification = await verifyExecutionIdentityAttestation({
      identity,
      attestation,
      expectedPredicate: buildExecutionIdentityAttestationPredicate({
        execution_identity_id: identity.artifact_id,
        actor_ref: identity.actor_ref,
        capability_ref: identity.capability_ref,
        release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
        site_id: 'ceremony-test-site',
        deterministic_seed: 'ceremony-test-seed',
      }),
      authorityVerifier: new LocalPemVerificationKeyProvider(KEY_IDS.issuerKeyId, ceremony.issuerKeypair.publicPem),
    });

    expect(verification.verified).toBe(true);
  });

  it('rejects a second ceremony before writing and leaves all key bytes unchanged', async () => {
    const repository = new InMemoryArtifactRepository();
    const secretsRoot = temporaryRoot();
    await bootstrapLuExecutionAuthorityCeremony({ secretsRoot, keyIds: KEY_IDS, repository });
    const before = hashes(secretsRoot);

    await expect(bootstrapLuExecutionAuthorityCeremony({ secretsRoot, keyIds: KEY_IDS, repository }))
      .rejects.toThrow(/REJECT_CEREMONY_ALREADY_PROVISIONED/);

    expect(hashes(secretsRoot)).toEqual(before);
  });
});
