import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

import { approveSourceRegistryEntry } from '../src/SourceApproval';
import { unsignedDraftFixture } from './fixtures/unsignedSourceRegistryDrafts';
import {
  loadVerifiedSourceRegistry,
  verifySourceRegistryArtifact,
  getSourceRegistryVerificationKeyFromEnv,
  getSourceRegistrySigningKeyFromEnv,
  type SourceRegistryArtifact,
} from '../src/SourceRegistry';

/**
 * ✅ P2-SR-VERIFY-ONLY-01 — VERIFY / MINT CAPABILITY SEPARATION.
 *
 *   Invariant under test:
 *     A runtime that reads the source registry cannot mint an approval, because it is never
 *     handed the capability — not because it is told not to.
 *
 *   The defect this closes: `loadVerifiedSourceRegistry()` defaulted to a key provider that
 *   required SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM. Every harvest host therefore had to hold
 *   the GOVERNOR private key merely to READ the registry, and could then sign an APPROVED
 *   attestation for a source nobody reviewed. The authority arrived through the environment
 *   rather than through a declared port, so no signature check could have caught it.
 *
 *   ⚠️ FIXTURE KEYS ONLY. Every key is generated inside this file. The production private key is
 *   never read here, and after this unit the runtime path cannot read it at all.
 *
 *   @see ../src/SourceRegistry.ts
 *   @see ../../mimers-brunn-core/src/signing/SignatureEnvelope.ts
 */
describe('P2-SR-VERIFY-ONLY-01 — verification without minting capability', () => {
  const REPO_ROOT = resolve(__dirname, '../../..');
  const AUTHORITY_PATH = join(REPO_ROOT, 'source-registry', 'national-registry.json');
  const KEY_ID = 'ed25519:test-governor';
  const APPROVER = 'governor:test-owner';

  /**
   * A signed registry file on disk, built with a fixture key.
   *
   * Written to a temp directory rather than into the repo: the real authority file is signed by
   * the GOVERNOR and this test must not be able to produce something that could be mistaken
   * for it.
   */
  async function signedRegistryFile(): Promise<{
    path: string;
    publicKey: string;
    privateKey: string;
    keyId: string;
  }> {
    const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
    const draft = unsignedDraftFixture('puh');
    const approved = await approveSourceRegistryEntry({
      entry: draft,
      approver_actor_id: APPROVER,
      signing: generated.provider,
    });

    const dir = mkdtempSync(join(tmpdir(), 'p2-sr-verify-only-'));
    const path = join(dir, 'registry.json');
    writeFileSync(path, JSON.stringify([approved], null, 2) + '\n', 'utf8');

    return {
      path,
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      keyId: KEY_ID,
    };
  }

  /** Runs `fn` with exactly the given SOURCE_REGISTRY_* env, restoring whatever was there. */
  async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
    const names = [
      'SOURCE_REGISTRY_SIGNING_KEY_ID',
      'SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM',
      'SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM',
      'SOURCE_REGISTRY_ARTIFACT_PATH',
    ];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      for (const n of names) {
        const value = env[n];
        if (value === undefined) delete process.env[n];
        else process.env[n] = value;
      }
      await fn();
    } finally {
      for (const n of names) {
        const value = saved[n];
        if (value === undefined) delete process.env[n];
        else process.env[n] = value;
      }
    }
  }

  // ------------------------------------------------------------------ 1. RUNTIME READ

  it('loads a verified registry from the key id and the public key alone', async () => {
    const signed = await signedRegistryFile();

    const registry = await loadVerifiedSourceRegistry({
      registryPath: signed.path,
      signing: new LocalPemVerificationKeyProvider(signed.keyId, signed.publicKey),
    });

    expect(registry.sources).toHaveLength(1);
    expect(registry.sources[0].sourceId).toBe('domstolsverket-puh-mmod');
    expect(registry.getSource('domstolsverket-puh-mmod')).not.toBeNull();
  });

  // -------------------------------------------------- 2. PRIVATE KEY ABSENT FROM ENV

  it('the runtime path succeeds with the private key entirely absent from the environment', async () => {
    const signed = await signedRegistryFile();

    await withEnv(
      {
        SOURCE_REGISTRY_SIGNING_KEY_ID: signed.keyId,
        SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: signed.publicKey,
        SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: undefined,
        SOURCE_REGISTRY_ARTIFACT_PATH: signed.path,
      },
      async () => {
        // No `signing` argument: this exercises the default the production runtime uses.
        const registry = await loadVerifiedSourceRegistry();

        expect(
          registry.sources,
          'This is the whole unit. Before the capability split this call threw unless the host ' +
            'held the GOVERNOR private key, which made every harvest host a potential signer.',
        ).toHaveLength(1);
        expect(process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM).toBeUndefined();
      },
    );
  });

  it('the env-derived runtime provider has no sign capability at all', async () => {
    const signed = await signedRegistryFile();

    await withEnv(
      {
        SOURCE_REGISTRY_SIGNING_KEY_ID: signed.keyId,
        SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: signed.publicKey,
        // Present on purpose: the runtime must not be able to sign even when the material is
        // sitting right there in the environment.
        SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: signed.privateKey,
        SOURCE_REGISTRY_ARTIFACT_PATH: signed.path,
      },
      async () => {
        const provider = getSourceRegistryVerificationKeyFromEnv();

        expect(
          'sign' in provider,
          'A sign() that throws would keep the method on the type, so a consumer could still be ' +
            'written to call it and the failure would only surface at runtime. Absence makes it ' +
            'a compile error at the call site instead.',
        ).toBe(false);
        expect(provider.keyId).toBe(signed.keyId);
      },
    );
  });

  // ------------------------------------------------------------------ 3. FAIL CLOSED

  it('a missing public key FAILS CLOSED — an unverifiable registry is not a registry', async () => {
    await withEnv(
      {
        SOURCE_REGISTRY_SIGNING_KEY_ID: KEY_ID,
        SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: undefined,
        SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: undefined,
      },
      async () => {
        expect(
          () => getSourceRegistryVerificationKeyFromEnv(),
          'Without the public key nothing distinguishes an approved source from an invented one, ' +
            'so absence must stop the runtime rather than relax it.',
        ).toThrow(/SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM/);
      },
    );
  });

  it('a missing key id FAILS CLOSED — the signer must be the expected one', async () => {
    const signed = await signedRegistryFile();

    await withEnv(
      {
        SOURCE_REGISTRY_SIGNING_KEY_ID: undefined,
        SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: signed.publicKey,
        SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: undefined,
      },
      async () => {
        expect(() => getSourceRegistryVerificationKeyFromEnv()).toThrow(/SOURCE_REGISTRY_SIGNING_KEY_ID/);
      },
    );
  });

  // ---------------------------------------------------------------- 4. WRONG KEY

  it('a different public key FAILS verification — the split did not weaken the check', async () => {
    const signed = await signedRegistryFile();
    const other = LocalPemSigningKeyProvider.generate(signed.keyId);

    await expect(
      loadVerifiedSourceRegistry({
        registryPath: signed.path,
        // Same key id, different key material. Only the cryptography can tell them apart.
        signing: new LocalPemVerificationKeyProvider(signed.keyId, other.publicKey),
      }),
      'Dropping sign capability must not have dropped verification strength.',
    ).rejects.toThrow(/signature_valid/);
  });

  it('a mismatched key id FAILS verification even with the correct public key', async () => {
    const signed = await signedRegistryFile();

    await expect(
      loadVerifiedSourceRegistry({
        registryPath: signed.path,
        signing: new LocalPemVerificationKeyProvider('ed25519:some-other-governor', signed.publicKey),
      }),
      "verifySourceRegistryArtifact binds attestation.signer to the provider's keyId. A valid " +
        'signature from an unexpected key is still not this authority.',
    ).rejects.toThrow(/signer_key/);
  });

  // ------------------------------------------------------- 5. MINTING STILL GATED

  it('the approval path still requires the private key', async () => {
    await withEnv(
      {
        SOURCE_REGISTRY_SIGNING_KEY_ID: KEY_ID,
        SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----',
        SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: undefined,
      },
      async () => {
        expect(
          () => getSourceRegistrySigningKeyFromEnv(),
          'Read capability must not have become write capability. Approval remains a GOVERNOR act.',
        ).toThrow(/SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM/);
      },
    );
  });

  it('a verification-only provider cannot be used to approve a source', async () => {
    const signed = await signedRegistryFile();
    const verifyOnly = new LocalPemVerificationKeyProvider(signed.keyId, signed.publicKey);
    const draft = unsignedDraftFixture('puh');

    await expect(
      approveSourceRegistryEntry({
        entry: draft,
        approver_actor_id: APPROVER,
        // @ts-expect-error — P2-SR-VERIFY-ONLY-01: a VerificationKeyProvider is not assignable to
        // SourceApprovalRequest.signing. This is the proof: the refusal is a type error, so no
        // caller can reach the minting path with a verify-only capability. The runtime throw
        // below is the belt to that braces.
        signing: verifyOnly,
      }),
    ).rejects.toThrow();
  });

  // ------------------------------------------- 6. INSTALLED AUTHORITY IDENTITY PINNED

  it('pins the installed PUH v4 authority identity after atomic successor re-attestation', () => {
    const bytes = readFileSync(AUTHORITY_PATH);
    const registry = JSON.parse(bytes.toString('utf8')) as SourceRegistryArtifact[];
    const puh = registry.find((entry) => entry.source_id === 'domstolsverket-puh-mmod');

    expect(puh?.artifact_id).toBe('reg-dv-puh-mmod-004');
    expect(puh?.approval_attestation.subjectDigest).toBe(
      'sha256:5d9bc238ef9f0470ef48f30e5c470ef3b12ce638ccd16c6082834f01bae6f977',
    );
    expect(puh?.approval_attestation.signature).toBe(
      'ed25519:MeMmQ3AJ3W7odwHwOs3AqV0b0OWVVy++zZQosJU6eEdLAQ4gCP1nO1fQCytnoMG0oKv/bKbIIo656GAd4E0/CQ==',
    );
    expect(puh?.policy.max_object_size_bytes).toBe(134_217_728);
    expect(
      bytes.includes(Buffer.from('\r\n')),
      '`*.json text eol=lf` keeps the signed representation LF on every checkout.',
    ).toBe(false);
  });

  it('the installed authority still verifies through the runtime read path', async () => {
    // Uses the real file with the real signer key id, but a fixture public key: the point is that
    // the path reaches signature verification and fails there rather than failing earlier on a
    // missing private key. Proving it ACCEPTS the real authority needs the real public key, which
    // is the owner's to supply — see target 7 in the unit's proof list.
    const other = LocalPemSigningKeyProvider.generate('ed25519:source-registry-governor-2026-08-14');

    await expect(
      loadVerifiedSourceRegistry({
        registryPath: AUTHORITY_PATH,
        signing: new LocalPemVerificationKeyProvider(
          'ed25519:source-registry-governor-2026-08-14',
          other.publicKey,
        ),
      }),
    ).rejects.toThrow(/signature_valid/);
  });

  // ------------------------------------------------ 7. NO SECOND VERIFIER MODEL

  it('both providers accept exactly the same signature', async () => {
    const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
    const draft = unsignedDraftFixture('puh');
    const approved = await approveSourceRegistryEntry({
      entry: draft,
      approver_actor_id: APPROVER,
      signing: generated.provider,
    });

    const bySigner = await verifySourceRegistryArtifact(approved, generated.provider);
    const byVerifier = await verifySourceRegistryArtifact(
      approved,
      new LocalPemVerificationKeyProvider(KEY_ID, generated.publicKey),
    );

    expect(
      byVerifier,
      'Two verifiers that could disagree would be a second authority model. The verify-only ' +
        'provider must be the same check with less capability, not a different check.',
    ).toEqual(bySigner);
  });
});
