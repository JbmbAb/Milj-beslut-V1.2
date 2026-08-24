import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

import { approveSourceRegistryEntry } from '../src/SourceApproval';
import { unsignedDraftFixture } from './fixtures/unsignedSourceRegistryDrafts';
import {
  loadVerifiedSourceRegistry,
  createSourceRegistryTrustedKeyring,
  type SourceRegistryArtifact,
} from '../src/SourceRegistry';

/**
 * SOURCE-REGISTRY-MULTI-KEY-VERIFICATION-V1.
 *
 * Proves the defect SOURCE-REGISTRY-GOVERNOR-KEY-ROTATION-V1 stopped on
 * (SOURCE_REGISTRY_KEY_ROTATION_MODEL_GAP) is closed: a historical entry signed by a retired
 * governor key and a new entry signed by its successor now coexist and each verify against the
 * exact key that actually signed them, resolved per entry by `attestation.signer` -- not against
 * one registry-wide key.
 *
 * Fixture keys only; the production registry / governor key is never touched.
 */
describe('SOURCE-REGISTRY-MULTI-KEY-VERIFICATION-V1', () => {
  const OLD_KEY_ID = 'ed25519:test-governor-old';
  const NEW_KEY_ID = 'ed25519:test-governor-new';
  const APPROVER = 'governor:test-owner';

  async function writeTwoEntryRegistry(): Promise<{
    path: string;
    oldKey: { keyId: string; publicKey: string; privateKey: string };
    newKey: { keyId: string; publicKey: string; privateKey: string };
  }> {
    const oldGenerated = LocalPemSigningKeyProvider.generate(OLD_KEY_ID);
    const newGenerated = LocalPemSigningKeyProvider.generate(NEW_KEY_ID);

    const entryA = await approveSourceRegistryEntry({
      entry: unsignedDraftFixture('puh'),
      approver_actor_id: APPROVER,
      signing: oldGenerated.provider,
    });
    const entryB = await approveSourceRegistryEntry({
      entry: unsignedDraftFixture('sfs'),
      approver_actor_id: APPROVER,
      signing: newGenerated.provider,
    });

    const dir = mkdtempSync(join(tmpdir(), 'sr-multikey-'));
    const path = join(dir, 'registry.json');
    writeFileSync(path, JSON.stringify([entryA, entryB], null, 2) + '\n', 'utf8');

    return {
      path,
      oldKey: { keyId: OLD_KEY_ID, publicKey: oldGenerated.publicKey, privateKey: oldGenerated.privateKey },
      newKey: { keyId: NEW_KEY_ID, publicKey: newGenerated.publicKey, privateKey: newGenerated.privateKey },
    };
  }

  it('1+2+3: old entry + old key, new entry + new key, and both together in one registry all PASS', async () => {
    const { path, oldKey, newKey } = await writeTwoEntryRegistry();
    const keyring = createSourceRegistryTrustedKeyring(
      new Map([
        [oldKey.keyId, oldKey.publicKey],
        [newKey.keyId, newKey.publicKey],
      ]),
    );

    const registry = await loadVerifiedSourceRegistry({ registryPath: path, trustedKeyring: keyring });
    expect(registry.sources.map((s) => s.sourceId).sort()).toEqual(
      ['domstolsverket-puh-mmod', 'regeringskansliet-sfs-1998-808'].sort(),
    );
  });

  it('4: unknown signer -> whole registry load fails closed', async () => {
    const { path, oldKey } = await writeTwoEntryRegistry();
    // Keyring trusts only the old key -- the new entry's signer is unknown to it.
    const keyring = createSourceRegistryTrustedKeyring(new Map([[oldKey.keyId, oldKey.publicKey]]));

    await expect(loadVerifiedSourceRegistry({ registryPath: path, trustedKeyring: keyring })).rejects.toThrow(
      /untrusted key/i,
    );
  });

  it('5: entry claims a trusted key id but was actually signed by a different private key -> DENY', async () => {
    const { path, oldKey, newKey } = await writeTwoEntryRegistry();
    // Trust a key with the SAME id as the new key, but DIFFERENT key material (an impostor).
    const impostor = LocalPemSigningKeyProvider.generate(newKey.keyId);
    const keyring = createSourceRegistryTrustedKeyring(
      new Map([
        [oldKey.keyId, oldKey.publicKey],
        [newKey.keyId, impostor.publicKey],
      ]),
    );

    await expect(loadVerifiedSourceRegistry({ registryPath: path, trustedKeyring: keyring })).rejects.toThrow(
      /signature_valid/,
    );
  });

  it('6: tampered payload -> DENY', async () => {
    const { path, oldKey, newKey } = await writeTwoEntryRegistry();
    const raw = JSON.parse(readFileSync(path, 'utf8')) as SourceRegistryArtifact[];
    (raw[0] as { policy: { rate_limit_requests_per_second: number } }).policy.rate_limit_requests_per_second = 999;
    writeFileSync(path, JSON.stringify(raw, null, 2) + '\n', 'utf8');

    const keyring = createSourceRegistryTrustedKeyring(
      new Map([
        [oldKey.keyId, oldKey.publicKey],
        [newKey.keyId, newKey.publicKey],
      ]),
    );
    await expect(loadVerifiedSourceRegistry({ registryPath: path, trustedKeyring: keyring })).rejects.toThrow();
  });

  it('8: a verify-only keyring (public keys only, no private key material anywhere in this test) loads both entries', async () => {
    const { path, oldKey, newKey } = await writeTwoEntryRegistry();
    // Only public keys are placed in the keyring -- the private keys generated above are never
    // referenced again below, demonstrating the verify-only host needs no signing capability.
    const keyring = createSourceRegistryTrustedKeyring(
      new Map([
        [oldKey.keyId, oldKey.publicKey],
        [newKey.keyId, newKey.publicKey],
      ]),
    );
    const registry = await loadVerifiedSourceRegistry({ registryPath: path, trustedKeyring: keyring });
    expect(registry.sources).toHaveLength(2);
  });

  it('historical single-key callers are unaffected: passing `signing` still requires every entry to match that one key', async () => {
    const { path, oldKey } = await writeTwoEntryRegistry();
    // The two-entry registry has a second entry signed by the NEW key -- the old single-key path
    // must still fail closed on it, exactly as before this unit.
    await expect(
      loadVerifiedSourceRegistry({
        registryPath: path,
        signing: new LocalPemVerificationKeyProvider(oldKey.keyId, oldKey.publicKey),
      }),
    ).rejects.toThrow(/signer_key/);
  });
});
