import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  classifySourceAuthority,
  createStaticAuthorizedSourceCatalog,
} from '@miljobeslut/mps-knowledge-corpus';

import { approveSourceRegistryEntry } from '../../packages/mps-data-governance/src/SourceApproval';
import { unsignedDraftFixture } from '../../packages/mps-data-governance/tests/fixtures/unsignedSourceRegistryDrafts';
import { createVerifiedRegistrySourceCatalog } from '../../server/modules/legal/knowledge/VerifiedRegistrySourceCatalogAdapter';

/**
 * K2.2 — the server-side source authority adapter, proven against a registry that is REALLY
 * signed and REALLY verified (fixture governor key, temp file), never against a hand-built
 * registry object. The test can therefore show the properties that matter at the authority
 * boundary: (1) only what the verified registry contains is ever authorized, with the signed
 * content hash as the anchor; (2) a registry that fails verification — or is empty — throws and
 * never becomes a permissive/empty catalog; (3) the origin is bound to the registry CONTENT, not
 * to the file's location, and no static catalog can wear it.
 */
const KEY_ID = 'ed25519:test-governor-k22';
const APPROVER = 'governor:test-owner';

async function signedRegistryFile(
  dirPrefix = 'k22-catalog-',
  which: 'puh' | 'sfs' = 'puh',
): Promise<{
  path: string;
  json: string;
  verification: LocalPemVerificationKeyProvider;
  sourceId: string;
}> {
  const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
  const draft = unsignedDraftFixture(which);
  const approved = await approveSourceRegistryEntry({
    entry: draft,
    approver_actor_id: APPROVER,
    signing: generated.provider,
  });
  const dir = mkdtempSync(join(tmpdir(), dirPrefix));
  const path = join(dir, 'registry.json');
  const json = JSON.stringify([approved], null, 2) + '\n';
  writeFileSync(path, json, 'utf8');
  return {
    path,
    json,
    verification: new LocalPemVerificationKeyProvider(KEY_ID, generated.publicKey),
    sourceId: draft.source_id,
  };
}

describe('K2.2 VerifiedRegistrySourceCatalogAdapter — signed registry is the only source authority', () => {
  it('resolves an APPROVED source to its verified binding, anchored on the signed content hash, with a content-addressed origin', async () => {
    const signed = await signedRegistryFile();
    const catalog = await createVerifiedRegistrySourceCatalog({
      registryPath: signed.path,
      signing: signed.verification,
      now: () => new Date('2026-09-06T00:00:00.000Z'),
    });
    expect(catalog.origin).toMatch(/^signed-source-registry:[0-9a-f]{64}$/);
    expect(catalog.origin).toBe(`signed-source-registry:${catalog.registry_digest}`);
    expect(catalog.registry_path).toBe(signed.path);
    expect(catalog.loaded_at).toBe('2026-09-06T00:00:00.000Z');

    const binding = await catalog.resolve(signed.sourceId);
    expect(binding).not.toBeNull();
    const onDisk = (
      JSON.parse(readFileSync(signed.path, 'utf8')) as Array<{
        artifact_id: string;
        producer: { name: string };
        artifact_types: string[];
      }>
    )[0]!;
    expect(binding!.registry_artifact_id).toBe(onDisk.artifact_id);
    expect(binding!.registry_source_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(binding!.authority_name).toBe(onDisk.producer.name);
    expect([...binding!.artifact_types]).toEqual(onDisk.artifact_types);
    expect(Object.isFrozen(binding)).toBe(true);
    expect((await catalog.list()).map((b) => b.source_id)).toEqual([signed.sourceId]);

    const outcome = await classifySourceAuthority(
      catalog,
      signed.sourceId,
      binding!.registry_source_content_hash,
    );
    expect(outcome.kind).toBe('AUTHORIZED');
  });

  it('the origin depends on the registry CONTENT, not on where the file lives: byte-identical registries at two paths share one origin', async () => {
    const a = await signedRegistryFile('k22-catalog-a-');
    const dirB = mkdtempSync(join(tmpdir(), 'k22-catalog-b-'));
    const pathB = join(dirB, 'national-registry.json');
    writeFileSync(pathB, a.json, 'utf8');
    const catalogA = await createVerifiedRegistrySourceCatalog({
      registryPath: a.path,
      signing: a.verification,
    });
    const catalogB = await createVerifiedRegistrySourceCatalog({
      registryPath: pathB,
      signing: a.verification,
    });
    expect(catalogA.registry_path).not.toBe(catalogB.registry_path);
    expect(catalogB.origin).toBe(catalogA.origin);
    // The origin binds the VERIFIED CONTENT (source_id, artifact_id, source_content_hash), not the signature:
    // a registry with different content is a different catalog; a re-signed identical one is the same.
    const resigned = await signedRegistryFile('k22-catalog-resigned-');
    const catalogResigned = await createVerifiedRegistrySourceCatalog({
      registryPath: resigned.path,
      signing: resigned.verification,
    });
    expect(catalogResigned.origin).toBe(catalogA.origin);
    const other = await signedRegistryFile('k22-catalog-c-', 'sfs');
    const catalogC = await createVerifiedRegistrySourceCatalog({
      registryPath: other.path,
      signing: other.verification,
    });
    expect(catalogC.origin).not.toBe(catalogA.origin);
  });

  it('a source that is not in the verified registry is SOURCE_AUTHORITY_REQUIRED (skipped), and a changed scope hash is SOURCE_SCOPE_CHANGED', async () => {
    const signed = await signedRegistryFile();
    const catalog = await createVerifiedRegistrySourceCatalog({
      registryPath: signed.path,
      signing: signed.verification,
    });
    expect(await catalog.resolve('naturvardsverket-handbok-2026')).toBeNull();
    expect((await classifySourceAuthority(catalog, 'naturvardsverket-handbok-2026')).kind).toBe(
      'SOURCE_AUTHORITY_REQUIRED',
    );
    expect((await classifySourceAuthority(catalog, signed.sourceId, 'f'.repeat(64))).kind).toBe(
      'SOURCE_SCOPE_CHANGED',
    );
  });

  it('fails closed: a tampered registry, a wrong key, a missing file, or an EMPTY registry throws at creation — never an empty or permissive catalog', async () => {
    const signed = await signedRegistryFile();
    const entries = JSON.parse(readFileSync(signed.path, 'utf8')) as Array<Record<string, unknown>>;
    const tampered = join(mkdtempSync(join(tmpdir(), 'k22-catalog-tampered-')), 'registry.json');
    writeFileSync(
      tampered,
      JSON.stringify([{ ...entries[0], artifact_types: ['LAW', 'DECISION', 'EVERYTHING'] }], null, 2),
      'utf8',
    );
    await expect(
      createVerifiedRegistrySourceCatalog({ registryPath: tampered, signing: signed.verification }),
    ).rejects.toThrow();

    const otherKey = LocalPemSigningKeyProvider.generate(KEY_ID);
    await expect(
      createVerifiedRegistrySourceCatalog({
        registryPath: signed.path,
        signing: new LocalPemVerificationKeyProvider(KEY_ID, otherKey.publicKey),
      }),
    ).rejects.toThrow();

    await expect(
      createVerifiedRegistrySourceCatalog({
        registryPath: join(tmpdir(), 'k22-does-not-exist', 'registry.json'),
        signing: signed.verification,
      }),
    ).rejects.toThrow();

    // An empty array verifies "successfully" upstream because no entry ever consults the keyring;
    // the adapter refuses it instead of returning a catalog that authorizes nothing.
    const empty = join(mkdtempSync(join(tmpdir(), 'k22-catalog-empty-')), 'registry.json');
    writeFileSync(empty, '[]\n', 'utf8');
    await expect(
      createVerifiedRegistrySourceCatalog({ registryPath: empty, signing: signed.verification }),
    ).rejects.toThrow(/REJECT_EMPTY_REGISTRY/);
  });

  it('no static catalog can wear the signed registry origin', async () => {
    const signed = await signedRegistryFile();
    const catalog = await createVerifiedRegistrySourceCatalog({
      registryPath: signed.path,
      signing: signed.verification,
    });
    const binding = (await catalog.resolve(signed.sourceId))!;
    expect(() =>
      createStaticAuthorizedSourceCatalog(
        [{ ...binding, source_id: 'evil-authority', registry_artifact_id: 'reg-evil-001' }],
        catalog.origin,
      ),
    ).toThrow(/REJECT_STATIC_ORIGIN/);
    expect(() => createStaticAuthorizedSourceCatalog([binding], 'static:<fixture:test>')).not.toThrow();
  });

  it('the origin binds SIGNED content only: an unsigned edit of the artifact_id label (K2.1b registry design: artifact_id is outside the governor signature) verifies, keeps the origin, and is carried as a label', async () => {
    const signed = await signedRegistryFile();
    const entries = JSON.parse(readFileSync(signed.path, 'utf8')) as Array<Record<string, unknown>>;
    const relabeled = join(mkdtempSync(join(tmpdir(), 'k22-catalog-relabel-')), 'registry.json');
    writeFileSync(
      relabeled,
      JSON.stringify([{ ...entries[0], artifact_id: 'reg-dv-puh-mmod-999-UNSIGNED-EDIT' }], null, 2),
      'utf8',
    );
    const a = await createVerifiedRegistrySourceCatalog({
      registryPath: signed.path,
      signing: signed.verification,
    });
    const b = await createVerifiedRegistrySourceCatalog({
      registryPath: relabeled,
      signing: signed.verification,
    });
    expect(b.origin).toBe(a.origin);
    expect((await b.resolve(signed.sourceId))!.registry_artifact_id).toBe(
      'reg-dv-puh-mmod-999-UNSIGNED-EDIT',
    );
    expect((await b.resolve(signed.sourceId))!.registry_source_content_hash).toBe(
      (await a.resolve(signed.sourceId))!.registry_source_content_hash,
    );
  });
});
