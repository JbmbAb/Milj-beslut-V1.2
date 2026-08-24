import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

import { approveSourceRegistryEntry } from '../src/SourceApproval';
import {
  getSourceRegistryVerificationKeyringFromEnv,
  loadVerifiedSourceRegistry,
  SourceRegistryVerificationKeyring,
} from '../src/SourceRegistry';
import { unsignedDraftFixture } from './fixtures/unsignedSourceRegistryDrafts';

describe('SOURCE-REGISTRY-MULTI-KEY-VERIFICATION-V1', () => {
  const oldKey = LocalPemSigningKeyProvider.generate('ed25519:governor-old');
  const successorKey = LocalPemSigningKeyProvider.generate('ed25519:governor-successor');

  async function signedRegistry() {
    const oldEntry = await approveSourceRegistryEntry({
      entry: unsignedDraftFixture('puh'), approver_actor_id: 'governor:old', signing: oldKey.provider,
    });
    const successorEntry = await approveSourceRegistryEntry({
      entry: { ...unsignedDraftFixture('sfs'), artifact_id: 'reg-successor-sfs-001' },
      approver_actor_id: 'governor:successor', signing: successorKey.provider,
    });
    const path = join(mkdtempSync(join(tmpdir(), 'source-registry-keyring-')), 'registry.json');
    writeFileSync(path, JSON.stringify([oldEntry, successorEntry]), 'utf8');
    return path;
  }

  it('verifies historical and successor entries through their own signer-bound public keys', async () => {
    const registry = await loadVerifiedSourceRegistry({
      registryPath: await signedRegistry(),
      verificationKeyring: new SourceRegistryVerificationKeyring([oldKey.provider, successorKey.provider]),
    });
    expect(registry.sources.map((source) => source.sourceId).sort()).toEqual([
      'domstolsverket-puh-mmod', 'regeringskansliet-sfs-1998-808',
    ]);
  });

  it('fails closed when an entry signer is absent from the configured keyring', async () => {
    await expect(loadVerifiedSourceRegistry({
      registryPath: await signedRegistry(),
      verificationKeyring: new SourceRegistryVerificationKeyring([oldKey.provider]),
    })).rejects.toThrow(/unknown or untrusted key/);
  });

  it('does not let a successor public key validate a historical attestation', async () => {
    const registry = await loadVerifiedSourceRegistry({
      registryPath: await signedRegistry(),
      verificationKeyring: new SourceRegistryVerificationKeyring([successorKey.provider, oldKey.provider]),
    });
    expect(registry.getSource('domstolsverket-puh-mmod')).not.toBeNull();
  });

  it('denies a signer claim changed from the signing key to another trusted key', async () => {
    const path = await signedRegistry();
    const entries = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, any>>;
    const successor = entries[1]!;
    successor.approval_attestation = {
      ...successor.approval_attestation,
      signer: oldKey.provider.keyId,
      predicate: { ...successor.approval_attestation.predicate, signer_key_id: oldKey.provider.keyId },
    };
    writeFileSync(path, JSON.stringify(entries), 'utf8');

    await expect(loadVerifiedSourceRegistry({
      registryPath: path,
      verificationKeyring: new SourceRegistryVerificationKeyring([oldKey.provider, successorKey.provider]),
    })).rejects.toThrow(/signature_valid/);
  });

  it('denies a tampered entry even when its signer remains trusted', async () => {
    const path = await signedRegistry();
    const entries = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, any>>;
    entries[0]!.producer = { ...entries[0]!.producer, name: 'Tampered authority' };
    writeFileSync(path, JSON.stringify(entries), 'utf8');

    await expect(loadVerifiedSourceRegistry({
      registryPath: path,
      verificationKeyring: new SourceRegistryVerificationKeyring([oldKey.provider, successorKey.provider]),
    })).rejects.toThrow(/subject_digest|source_content_hash/);
  });

  it('rejects a duplicate key id even when it carries different public material', () => {
    const conflicting = LocalPemSigningKeyProvider.generate(oldKey.provider.keyId);
    expect(() => new SourceRegistryVerificationKeyring([oldKey.provider, conflicting.provider]))
      .toThrow(/duplicate key id/);
  });

  it('loads a multi-key public configuration without a private signing key', () => {
    const original = {
      trusted: process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON,
      keyId: process.env.SOURCE_REGISTRY_SIGNING_KEY_ID,
      publicKey: process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM,
    };
    try {
      process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON = JSON.stringify([
        { key_id: oldKey.provider.keyId, public_key_pem: oldKey.publicKey },
        { key_id: successorKey.provider.keyId, public_key_pem: successorKey.publicKey },
      ]);
      const keyring = getSourceRegistryVerificationKeyringFromEnv();
      expect(keyring.resolve(oldKey.provider.keyId)?.keyId).toBe(oldKey.provider.keyId);
      expect(keyring.resolve(successorKey.provider.keyId)?.keyId).toBe(successorKey.provider.keyId);
      expect('sign' in keyring.resolve(oldKey.provider.keyId)!).toBe(false);
    } finally {
      if (original.trusted === undefined) delete process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON;
      else process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON = original.trusted;
      if (original.keyId === undefined) delete process.env.SOURCE_REGISTRY_SIGNING_KEY_ID;
      else process.env.SOURCE_REGISTRY_SIGNING_KEY_ID = original.keyId;
      if (original.publicKey === undefined) delete process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;
      else process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM = original.publicKey;
    }
  });

  it('retains the established singleton environment as a one-key keyring', () => {
    const original = {
      trusted: process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON,
      keyId: process.env.SOURCE_REGISTRY_SIGNING_KEY_ID,
      publicKey: process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM,
    };
    try {
      delete process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON;
      process.env.SOURCE_REGISTRY_SIGNING_KEY_ID = oldKey.provider.keyId;
      process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM = oldKey.publicKey;
      const keyring = getSourceRegistryVerificationKeyringFromEnv();
      expect(keyring.resolve(oldKey.provider.keyId)?.keyId).toBe(oldKey.provider.keyId);
      expect(keyring.resolve(successorKey.provider.keyId)).toBeNull();
    } finally {
      if (original.trusted === undefined) delete process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON;
      else process.env.SOURCE_REGISTRY_TRUSTED_PUBLIC_KEYS_JSON = original.trusted;
      if (original.keyId === undefined) delete process.env.SOURCE_REGISTRY_SIGNING_KEY_ID;
      else process.env.SOURCE_REGISTRY_SIGNING_KEY_ID = original.keyId;
      if (original.publicKey === undefined) delete process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;
      else process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM = original.publicKey;
    }
  });
});
