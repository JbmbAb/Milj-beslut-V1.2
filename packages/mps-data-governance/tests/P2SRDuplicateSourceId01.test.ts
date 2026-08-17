import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

import { approveSourceRegistryEntry } from '../src/SourceApproval';
import { unsignedDraftFixture } from './fixtures/unsignedSourceRegistryDrafts';
import { loadVerifiedSourceRegistry, type SourceRegistryArtifact } from '../src/SourceRegistry';

/**
 * ✅ P2-SR-DUP-ID-01 — A source_id RESOLVES TO EXACTLY ONE APPROVED AUTHORITY.
 *
 *   Invariant under test:
 *     Two APPROVED entries sharing a `source_id` in the active registry FAIL the load, naming the
 *     duplicated source_id and every conflicting artifact_id. The registry is refused whole; no
 *     entry is quietly preferred over another.
 *
 *   The defect this closes: `loadVerifiedSourceRegistry()` verified each entry independently and
 *   then resolved by first match — `sources.find(s => s.sourceId === sourceId)` in both
 *   `getSource` and `isUrlAllowedForSource`. An authority reissue that left the superseded entry
 *   APPROVED alongside its replacement produced NO error anywhere: the harvest simply ran under
 *   whichever entry happened to sit earlier in the JSON array, possibly the stale scope. Every
 *   signature still verified — both entries really were signed by the GOVERNOR — so nothing in the
 *   chain could catch it, and the download manifest went on to bind that entry's
 *   `registry_artifact_id` as the authority that permitted the run. The wrong authority version
 *   would be recorded as having authorised a harvest it never described.
 *
 *   Why fail closed rather than prefer the newest: the file states no ordering the loader may
 *   trust, and picking one would make the choice implicit again — just with a different rule.
 *   Ambiguity here is treated exactly as `verifySourceRegistryArtifact` treats a non-APPROVED
 *   lifecycle_state: the whole load fails.
 *
 *   ⚠️ FIXTURE KEYS ONLY. Keys are generated inside this file and the signed registries are
 *   written to a temp directory. `source-registry/national-registry.json` is never written by
 *   this test — a duplicate must be provable without producing a file that could be mistaken for
 *   the real authority.
 *
 *   @see ../src/SourceRegistry.ts
 *   @see ./P2SRVerifyOnly01.test.ts
 */
describe('P2-SR-DUP-ID-01 — duplicate source_id fails the registry load closed', () => {
  const KEY_ID = 'ed25519:test-governor';
  const APPROVER = 'governor:test-owner';

  interface SignedRegistry {
    readonly path: string;
    readonly signing: LocalPemVerificationKeyProvider;
  }

  /**
   * Signs each draft with one fixture key and writes them, in order, as a registry file.
   *
   * Each entry is individually valid: the point of the unit is that per-entry verification cannot
   * see a conflict that only exists between entries.
   */
  async function signedRegistryFile(
    entries: readonly Omit<SourceRegistryArtifact, 'approval_attestation'>[],
  ): Promise<SignedRegistry> {
    const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
    const approved: SourceRegistryArtifact[] = [];
    for (const entry of entries) {
      approved.push(
        await approveSourceRegistryEntry({
          entry,
          approver_actor_id: APPROVER,
          signing: generated.provider,
        }),
      );
    }

    const dir = mkdtempSync(join(tmpdir(), 'p2-sr-dup-id-'));
    const path = join(dir, 'registry.json');
    writeFileSync(path, JSON.stringify(approved, null, 2) + '\n', 'utf8');

    return { path, signing: new LocalPemVerificationKeyProvider(KEY_ID, generated.publicKey) };
  }

  /** Loads `path`, expecting the load to fail, and returns the error it failed with. */
  async function loadError(registry: SignedRegistry): Promise<Error> {
    try {
      await loadVerifiedSourceRegistry({ registryPath: registry.path, signing: registry.signing });
    } catch (caught) {
      return caught as Error;
    }
    throw new Error('Expected the registry load to fail, but it resolved.');
  }

  /**
   * The reissue shape: same logical source, new artifact_id, corrected scope.
   *
   * The domains differ so the two entries are genuinely different authorities over the same
   * source_id — a duplicate that changed nothing would not be able to cause harm, and would not
   * be worth failing on.
   */
  function puhReissue(artifactId: string, allowedDomains: readonly string[]): SourceRegistryArtifact {
    const draft = unsignedDraftFixture('puh');
    return {
      ...draft,
      artifact_id: artifactId,
      channel: { ...draft.channel, allowed_domains: [...allowedDomains] },
    };
  }

  // ------------------------------------------------------------------ 1. THE DEFECT

  it('FAILS CLOSED when a reissue leaves both the old and the new entry APPROVED', async () => {
    const registry = await signedRegistryFile([
      // Stale scope first — the entry `find()` used to silently win with.
      puhReissue('reg-dv-puh-mmod-001', ['stale.domstol.se']),
      puhReissue('reg-dv-puh-mmod-002', ['rattspraxis.etjanst.domstol.se']),
    ]);

    await expect(
      loadVerifiedSourceRegistry({ registryPath: registry.path, signing: registry.signing }),
      'Both entries are correctly signed, so no signature check can catch this. Only the loader ' +
        'can see that one source_id now has two authorities, and it must refuse rather than pick.',
    ).rejects.toThrow(/duplicate APPROVED source_id/);
  });

  it('names the duplicated source_id and every conflicting artifact_id', async () => {
    const registry = await signedRegistryFile([
      puhReissue('reg-dv-puh-mmod-001', ['stale.domstol.se']),
      puhReissue('reg-dv-puh-mmod-002', ['rattspraxis.etjanst.domstol.se']),
    ]);

    const error = await loadError(registry);

    // An operator has to know WHICH entry to withdraw. "duplicate source_id" alone would send
    // them back to diff the file by hand.
    expect(error.message).toContain('domstolsverket-puh-mmod');
    expect(error.message).toContain('reg-dv-puh-mmod-001');
    expect(error.message).toContain('reg-dv-puh-mmod-002');
    expect(error.message).toContain(registry.path);
  });

  it('reports every duplicated source_id, not only the first', async () => {
    const sfs = unsignedDraftFixture('sfs');
    const registry = await signedRegistryFile([
      puhReissue('reg-dv-puh-mmod-001', ['stale.domstol.se']),
      puhReissue('reg-dv-puh-mmod-002', ['rattspraxis.etjanst.domstol.se']),
      { ...sfs, artifact_id: 'reg-rk-sfs-1998-808-001' },
      {
        ...sfs,
        artifact_id: 'reg-rk-sfs-1998-808-002',
        channel: { ...sfs.channel, allowed_domains: ['stale.gov.se'] },
      },
    ]);

    const error = await loadError(registry);

    expect(
      error.message,
      'Surfacing one conflict at a time would make repairing a registry an iterative guess.',
    ).toContain('regeringskansliet-sfs-1998-808');
    expect(error.message).toContain('reg-rk-sfs-1998-808-002');
    expect(error.message).toContain('domstolsverket-puh-mmod');
  });

  it('fails the load whole — no partially usable registry is handed back', async () => {
    const registry = await signedRegistryFile([
      puhReissue('reg-dv-puh-mmod-001', ['stale.domstol.se']),
      puhReissue('reg-dv-puh-mmod-002', ['rattspraxis.etjanst.domstol.se']),
      unsignedDraftFixture('sfs'),
    ]);

    // The unambiguous SFS entry is NOT salvaged. A registry that loads with one authority
    // withheld is a registry whose contents depend on what failed, which is the same class of
    // silent divergence this guard exists to stop.
    await expect(
      loadVerifiedSourceRegistry({ registryPath: registry.path, signing: registry.signing }),
    ).rejects.toThrow(/duplicate APPROVED source_id/);
  });

  // --------------------------------------------------------------- 2. NOT OVER-BROAD

  it('accepts distinct source_ids — the guard is about identity, not about entry count', async () => {
    const registry = await signedRegistryFile([
      unsignedDraftFixture('puh'),
      unsignedDraftFixture('sfs'),
    ]);

    const loaded = await loadVerifiedSourceRegistry({
      registryPath: registry.path,
      signing: registry.signing,
    });

    expect(loaded.sources).toHaveLength(2);
    expect(loaded.getSource('domstolsverket-puh-mmod')?.registryArtifactId).toBe('reg-dv-puh-mmod-001');
    expect(loaded.getSource('regeringskansliet-sfs-1998-808')?.registryArtifactId).toBe(
      'reg-rk-sfs-1998-808-001',
    );
  });

  it('a completed reissue — superseded entry withdrawn — loads and resolves to the new authority', async () => {
    const registry = await signedRegistryFile([
      puhReissue('reg-dv-puh-mmod-002', ['rattspraxis.etjanst.domstol.se']),
    ]);

    const loaded = await loadVerifiedSourceRegistry({
      registryPath: registry.path,
      signing: registry.signing,
    });

    expect(loaded.getSource('domstolsverket-puh-mmod')?.registryArtifactId).toBe('reg-dv-puh-mmod-002');
    expect(
      loaded.isUrlAllowedForSource(
        'domstolsverket-puh-mmod',
        'https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar',
      ),
    ).toBe(true);
    expect(loaded.isUrlAllowedForSource('domstolsverket-puh-mmod', 'https://stale.domstol.se/x')).toBe(
      false,
    );
  });

  // ------------------------------------------------- 3. THE INSTALLED AUTHORITY IS CLEAN

  it('the installed national registry has no duplicate source_id', () => {
    // Read-only: proves the guard added here does not fail the file already in production, and
    // pins that property so a future reissue cannot introduce one unnoticed. The signature is not
    // checked here — that is P2-SR-VERIFY-ONLY-01's unit; this is purely about identity.
    const authorityPath = join(resolve(__dirname, '../../..'), 'source-registry', 'national-registry.json');
    const registry = JSON.parse(readFileSync(authorityPath, 'utf8')) as SourceRegistryArtifact[];

    const approvedIds = registry
      .filter((entry) => entry.lifecycle_state === 'APPROVED')
      .map((entry) => entry.source_id);

    expect(new Set(approvedIds).size).toBe(approvedIds.length);
  });
});
