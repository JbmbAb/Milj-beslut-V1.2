import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

import { approveSourceRegistryEntry } from '../src/SourceApproval';
import { loadSourceAuthorityHistory, APPROVED_HISTORICAL_STORES } from '../src/SourceAuthorityHistory';
import type { SourceRegistryArtifact } from '../src/SourceRegistry';

/**
 * ✅ VERIFIED_SOURCE_AUTHORITY_HISTORY_V1 — resolving a superseded acquiring authority.
 *
 *   Invariant under test:
 *     An artifact id resolves to the exact signed authority it names — active or archived —
 *     verified cryptographically, and the currently active authority is NEVER substituted for
 *     a historical one.
 *
 *   Why this exists: a quarantined object names the registry artifact that authorised its
 *   acquisition. 144 of the 514 harvested MMÖD judgments name `reg-dv-puh-mmod-002`, which was
 *   superseded by `-003` when the object-size bound was reissued. Resolving them against `-003`
 *   would attribute them to a scope they were not collected under.
 *
 *   ⚠️ FIXTURE KEYS for the negative cases; the real archived authorities are exercised with
 *   the GOVERNOR public key when it is available (see the real-material block).
 */
describe('VERIFIED_SOURCE_AUTHORITY_HISTORY_V1', () => {
  const REPO_ROOT = resolve(__dirname, '../../..');
  const DRAFT = join(REPO_ROOT, 'source-registry', 'drafts', 'puh-mmod-unsigned.json');
  const KEY_ID = 'ed25519:test-governor';

  async function signedStore(): Promise<{
    activePath: string;
    historicalPath: string;
    publicKey: string;
    keyId: string;
    dir: string;
  }> {
    const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
    const draft = JSON.parse(readFileSync(DRAFT, 'utf8'))[0] as SourceRegistryArtifact;

    const active = await approveSourceRegistryEntry({
      entry: { ...draft, artifact_id: 'reg-test-002' },
      approver_actor_id: 'governor:test',
      signing: generated.provider,
    });
    // A genuinely different signed artifact for the same logical source — the superseded one.
    const historical = await approveSourceRegistryEntry({
      entry: {
        ...draft,
        artifact_id: 'reg-test-001',
        policy: { ...draft.policy, max_object_size_bytes: 1024 },
      },
      approver_actor_id: 'governor:test',
      signing: generated.provider,
    });

    const dir = mkdtempSync(join(tmpdir(), 'authority-history-'));
    const activePath = join(dir, 'active.json');
    const historicalPath = join(dir, 'historical.json');
    writeFileSync(activePath, JSON.stringify([active], null, 2), 'utf8');
    writeFileSync(
      historicalPath,
      JSON.stringify(
        {
          _classification: 'LEGACY_SOURCE_DEFINITION',
          _authority: 'NOT_VERIFIED_SOURCE_AUTHORITY',
          _status: 'SUPERSEDED',
          _superseded_by: 'reg-test-002',
          entries: [historical],
        },
        null,
        2,
      ),
      'utf8',
    );

    return { activePath, historicalPath, publicKey: generated.publicKey, keyId: KEY_ID, dir };
  }

  const verifier = (s: { keyId: string; publicKey: string }) =>
    new LocalPemVerificationKeyProvider(s.keyId, s.publicKey);

  // ------------------------------------------------------- archived authority resolves

  it('resolves a SUPERSEDED authority from the approved historical store', async () => {
    const s = await signedStore();
    const history = await loadSourceAuthorityHistory({
      registryPath: s.activePath,
      historicalStorePaths: [s.historicalPath],
      signing: verifier(s),
    });

    const archived = history.findByArtifactId('reg-test-001');
    expect(archived).not.toBeNull();
    expect(archived!.registryArtifactId).toBe('reg-test-001');
    expect(archived!.superseded).toBe(true);
    expect(archived!.authorityName).toBe('Domstolsverket');

    const active = history.findByArtifactId('reg-test-002');
    expect(active!.superseded).toBe(false);
  });

  // ------------------------------------------------- active is NEVER substituted (item 7)

  it('does NOT substitute the active authority for a missing historical one', async () => {
    const s = await signedStore();
    // Historical store deliberately omitted: only -002 is loadable.
    const history = await loadSourceAuthorityHistory({
      registryPath: s.activePath,
      historicalStorePaths: [],
      signing: verifier(s),
    });

    expect(
      history.findByArtifactId('reg-test-001'),
      'An object stamped with the superseded id must fail to resolve rather than silently ' +
        'resolve to whichever authority happens to be active now.',
    ).toBeNull();
    expect(history.findByArtifactId('reg-test-002')).not.toBeNull();
  });

  // ------------------------------------------------------------- missing store fails closed

  it('FAILS CLOSED when an approved historical store is missing', async () => {
    const s = await signedStore();
    await expect(
      loadSourceAuthorityHistory({
        registryPath: s.activePath,
        historicalStorePaths: [join(s.dir, 'does-not-exist.json')],
        signing: verifier(s),
      }),
    ).rejects.toThrow(/REJECT_HISTORICAL_STORE_UNREADABLE/);
  });

  // ------------------------------------------------------------- tampering fails closed

  it('FAILS CLOSED when the archival wrapper alters the signed payload', async () => {
    const s = await signedStore();
    const doc = JSON.parse(readFileSync(s.historicalPath, 'utf8'));
    // Widen the signed scope inside the archive — exactly the attack the wrapper must not enable.
    doc.entries[0].policy.max_object_size_bytes = 999_999_999;
    const tamperedPath = join(s.dir, 'tampered.json');
    writeFileSync(tamperedPath, JSON.stringify(doc, null, 2), 'utf8');

    await expect(
      loadSourceAuthorityHistory({
        registryPath: s.activePath,
        historicalStorePaths: [tamperedPath],
        signing: verifier(s),
      }),
      'Verification recomputes the content hash from the entry, so an edited payload can no ' +
        'longer match its own subjectDigest.',
    ).rejects.toThrow(/subject_digest|source_content_hash|signature_valid/);
  });

  it('FAILS CLOSED on an archived entry with no approval attestation', async () => {
    const s = await signedStore();
    const doc = JSON.parse(readFileSync(s.historicalPath, 'utf8'));
    delete doc.entries[0].approval_attestation;
    const unsignedPath = join(s.dir, 'unsigned.json');
    writeFileSync(unsignedPath, JSON.stringify(doc, null, 2), 'utf8');

    await expect(
      loadSourceAuthorityHistory({
        registryPath: s.activePath,
        historicalStorePaths: [unsignedPath],
        signing: verifier(s),
      }),
    ).rejects.toThrow(/approval_attestation/);
  });

  it('FAILS CLOSED on a wrong-key signature in the historical store', async () => {
    const s = await signedStore();
    const other = LocalPemSigningKeyProvider.generate(KEY_ID);

    await expect(
      loadSourceAuthorityHistory({
        registryPath: s.activePath,
        historicalStorePaths: [s.historicalPath],
        signing: new LocalPemVerificationKeyProvider(KEY_ID, other.publicKey),
      }),
    ).rejects.toThrow(/signature_valid/);
  });

  // ------------------------------------------------------------- duplicate id fails closed

  it('FAILS CLOSED when one artifact id appears in two stores', async () => {
    const s = await signedStore();
    await expect(
      loadSourceAuthorityHistory({
        registryPath: s.activePath,
        historicalStorePaths: [s.historicalPath, s.historicalPath],
        signing: verifier(s),
      }),
      'Otherwise resolution silently depends on store order.',
    ).rejects.toThrow(/REJECT_DUPLICATE_AUTHORITY/);
  });

  // ------------------------------------------------------- the store list is an allowlist

  it('consults only explicitly approved stores, never a directory scan', () => {
    expect(APPROVED_HISTORICAL_STORES).toEqual([
      'source-registry/legacy/puh-mmod-001-superseded.json',
      'source-registry/legacy/puh-mmod-002-superseded.json',
    ]);
    expect(
      APPROVED_HISTORICAL_STORES.some((p) => p.includes('geo-sources')),
      'geo-sources-superseded.json predates the signed contract and carries no attestation. It ' +
        'is tracked as history but must never be consultable as authority.',
    ).toBe(false);
  });

  // ------------------------------------------------------ REAL archived authorities

  describe('real archived PUH authorities', () => {
    const hasKey =
      Boolean(process.env.SOURCE_REGISTRY_SIGNING_KEY_ID) &&
      Boolean(process.env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM);

    it.runIf(hasKey)('resolves reg-dv-puh-mmod-002 as superseded, -003 as active', async () => {
      const history = await loadSourceAuthorityHistory({});

      const superseded = history.findByArtifactId('reg-dv-puh-mmod-002');
      expect(superseded).not.toBeNull();
      expect(superseded!.superseded).toBe(true);
      expect(superseded!.sourceId).toBe('domstolsverket-puh-mmod');
      expect(superseded!.authorityName).toBe('Domstolsverket');

      const active = history.findByArtifactId('reg-dv-puh-mmod-003');
      expect(active!.superseded).toBe(false);

      const original = history.findByArtifactId('reg-dv-puh-mmod-001');
      expect(original!.superseded).toBe(true);

      expect(history.findByArtifactId('reg-does-not-exist')).toBeNull();
    });

    it.runIf(!hasKey && process.env.REQUIRE_REAL_AUTHORITY === '1')(
      'REQUIRE_REAL_AUTHORITY=1 but no GOVERNOR public key is configured',
      () => {
        expect(hasKey, 'Set SOURCE_REGISTRY_SIGNING_KEY_ID and _PUBLIC_KEY_PEM.').toBe(true);
      },
    );
  });
});
