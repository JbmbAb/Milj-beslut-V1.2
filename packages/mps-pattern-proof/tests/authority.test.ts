import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createArtifactAttestation,
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  attestationSubjectBinding,
  type ArtifactAttestation,
} from '@miljobeslut/mimers-brunn-core';
import { CasBackedArtifactRepository, MemoryByteStorageBackend } from '@miljobeslut/mps-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryAuthorityResolver,
  NOT_SUPPORTED_IN_V1,
  parseFileLineRef,
  RepositoryAuthorityResolver,
  resolveAll,
  type AuthorityLocatorResolver,
} from '../src/authority';
import type { EvidenceLocator } from '../src/evidence';
import { digestOf } from '../src/identity';
import { PatternProofArtifactStore } from '../src/persistence';
import { validDiscovery } from './fixtures/artifacts';

const REPO_ROOT = process.cwd();
const tmpDirs: string[] = [];
let root = '';

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ppe-authority-'));
  tmpDirs.push(root);
  mkdirSync(path.join(root, 'sub'), { recursive: true });
  // five lines, trailing newline: line 6 does not exist
  writeFileSync(
    path.join(root, 'Dockerfile'),
    'FROM base\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCMD node\n',
  );
  // three lines, NO trailing newline
  writeFileSync(path.join(root, 'sub', 'compose.yml'), 'services:\n  web:\n    build: .');
  writeFileSync(path.join(root, 'empty.txt'), '');
  writeFileSync(path.join(os.tmpdir(), 'ppe-authority-outside.txt'), 'outside\n');
});

afterAll(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  rmSync(path.join(os.tmpdir(), 'ppe-authority-outside.txt'), { force: true });
});

const loc = (kind: EvidenceLocator['kind'], ref: string, note?: string): EvidenceLocator =>
  note === undefined ? { kind, ref } : { kind, ref, note };

describe('parseFileLineRef', () => {
  it('accepts path:N, path:N-M, path:N,M,... and mixed ranges', () => {
    expect(parseFileLineRef('Dockerfile:37')).toEqual({ path: 'Dockerfile', lines: [37] });
    expect(parseFileLineRef('Dockerfile:32-34')).toEqual({ path: 'Dockerfile', lines: [32, 33, 34] });
    expect(parseFileLineRef('Dockerfile.gcp:26,28,51')).toEqual({
      path: 'Dockerfile.gcp',
      lines: [26, 28, 51],
    });
    expect(parseFileLineRef('a/b.ts:1-2,5')).toEqual({ path: 'a/b.ts', lines: [1, 2, 5] });
    expect(parseFileLineRef('C:\\x\\y.ts:3')?.path).toBe('C:/x/y.ts');
  });

  it('rejects malformed refs', () => {
    for (const ref of [
      'Dockerfile',
      'Dockerfile:',
      ':3',
      'Dockerfile:0',
      'Dockerfile:5-3',
      'Dockerfile:a',
      'Dockerfile:1;2',
    ]) {
      expect(parseFileLineRef(ref), ref).toBeUndefined();
    }
  });
});

describe('RepositoryAuthorityResolver: file_line', () => {
  const resolver = () => new RepositoryAuthorityResolver({ repoRoot: root });

  it('resolves every named line that exists', async () => {
    expect(await resolver().resolve(loc('file_line', 'Dockerfile:1'))).toEqual({
      resolved: true,
      resolvedTo: 'Dockerfile:1',
    });
    expect((await resolver().resolve(loc('file_line', 'Dockerfile:3-5'))).resolved).toBe(true);
    expect((await resolver().resolve(loc('file_line', 'Dockerfile:1,5'))).resolved).toBe(true);
    expect((await resolver().resolve(loc('file_line', 'sub/compose.yml:3'))).resolved).toBe(true);
    expect(
      (await resolver().resolve(loc('file_line', './sub/compose.yml:1-3', 'note ignored'))).resolved,
    ).toBe(true);
  });

  it('fails closed on lines past the end of the file (trailing newline is not a line)', async () => {
    expect(await resolver().resolve(loc('file_line', 'Dockerfile:6'))).toEqual({
      resolved: false,
      reason: 'LINE_OUT_OF_RANGE',
    });
    expect(await resolver().resolve(loc('file_line', 'Dockerfile:4-6'))).toEqual({
      resolved: false,
      reason: 'LINE_OUT_OF_RANGE',
    });
    expect(await resolver().resolve(loc('file_line', 'Dockerfile:1,9'))).toEqual({
      resolved: false,
      reason: 'LINE_OUT_OF_RANGE',
    });
    expect(await resolver().resolve(loc('file_line', 'sub/compose.yml:4'))).toEqual({
      resolved: false,
      reason: 'LINE_OUT_OF_RANGE',
    });
    expect(await resolver().resolve(loc('file_line', 'empty.txt:1'))).toEqual({
      resolved: false,
      reason: 'LINE_OUT_OF_RANGE',
    });
  });

  it('fails closed on malformed refs, missing files and directories', async () => {
    expect(await resolver().resolve(loc('file_line', 'Dockerfile'))).toEqual({
      resolved: false,
      reason: 'FILE_LINE_REF_MALFORMED',
    });
    expect(await resolver().resolve(loc('file_line', 'missing.txt:1'))).toEqual({
      resolved: false,
      reason: 'FILE_NOT_FOUND',
    });
    expect(await resolver().resolve(loc('file_line', 'sub:1'))).toEqual({
      resolved: false,
      reason: 'NOT_A_FILE',
    });
  });

  it('rejects path traversal outside repoRoot', async () => {
    expect(await resolver().resolve(loc('file_line', '../ppe-authority-outside.txt:1'))).toEqual({
      resolved: false,
      reason: 'PATH_OUTSIDE_REPO_ROOT',
    });
    expect(await resolver().resolve(loc('file_line', 'sub/../../ppe-authority-outside.txt:1'))).toEqual({
      resolved: false,
      reason: 'PATH_OUTSIDE_REPO_ROOT',
    });
    expect(
      await resolver().resolve(loc('file_line', `${path.join(os.tmpdir(), 'ppe-authority-outside.txt')}:1`)),
    ).toEqual({ resolved: false, reason: 'PATH_OUTSIDE_REPO_ROOT' });
  });

  it('requires an absolute repoRoot', () => {
    expect(() => new RepositoryAuthorityResolver({ repoRoot: 'relative' })).toThrow(/PPE_SCHEMA_INVALID/);
  });

  it('resolves the frozen target citations against the real checkout (Dockerfile:32-37 etc.)', async () => {
    const real = new RepositoryAuthorityResolver({ repoRoot: REPO_ROOT });
    for (const ref of [
      'Dockerfile:32-37',
      'Dockerfile:17-20',
      'docker-compose.staging.yml:6-8',
      'Dockerfile:58',
    ]) {
      expect((await real.resolve(loc('file_line', ref))).resolved, ref).toBe(true);
    }
    expect((await real.resolve(loc('file_line', 'services/mapLayerSelection.ts:1'))).resolved).toBe(false);
  });
});

describe('RepositoryAuthorityResolver: git_object', () => {
  it('uses the gitObjectExists hook when supplied (true / false / throwing)', async () => {
    const sha = 'e617c7b7bb4613b95c6934004201eb14bec89ba0';
    const seen: string[] = [];
    const yes = new RepositoryAuthorityResolver({
      repoRoot: root,
      gitObjectExists: async (ref) => {
        seen.push(ref);
        return true;
      },
    });
    expect(await yes.resolve(loc('git_object', sha))).toEqual({ resolved: true, resolvedTo: sha });
    expect(await yes.resolve(loc('git_object', `${sha}:Dockerfile`))).toEqual({
      resolved: true,
      resolvedTo: `${sha}:Dockerfile`,
    });
    expect(seen).toEqual([sha, `${sha}:Dockerfile`]);
    const no = new RepositoryAuthorityResolver({ repoRoot: root, gitObjectExists: async () => false });
    expect(await no.resolve(loc('git_object', sha))).toEqual({
      resolved: false,
      reason: 'GIT_OBJECT_NOT_FOUND',
    });
    const broken = new RepositoryAuthorityResolver({
      repoRoot: root,
      gitObjectExists: async () => {
        throw new Error('git down');
      },
    });
    expect(await broken.resolve(loc('git_object', sha))).toEqual({
      resolved: false,
      reason: 'GIT_UNAVAILABLE',
    });
  });

  it('rejects malformed object refs before touching git', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root, gitObjectExists: async () => true });
    for (const ref of [
      'HEAD',
      'main',
      'abc',
      'e617c7b7bb4613b95c6934004201eb14bec89ba0:/etc/passwd',
      'e617c7b7:../x',
      'E617C7B7',
    ]) {
      expect(await resolver.resolve(loc('git_object', ref)), ref).toEqual({
        resolved: false,
        reason: 'GIT_OBJECT_REF_MALFORMED',
      });
    }
  });

  it('without a hook, shells out to `git cat-file -e` (no shell) against repoRoot', async () => {
    const head = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (head.status !== 0) {
      // git unavailable in this environment: the resolver must then report GIT_UNAVAILABLE / NOT_FOUND, never true
      const resolver = new RepositoryAuthorityResolver({ repoRoot: root });
      expect(
        (await resolver.resolve(loc('git_object', 'e617c7b7bb4613b95c6934004201eb14bec89ba0'))).resolved,
      ).toBe(false);
      return;
    }
    const sha = head.stdout.trim();
    const resolver = new RepositoryAuthorityResolver({ repoRoot: REPO_ROOT });
    expect(await resolver.resolve(loc('git_object', sha))).toEqual({ resolved: true, resolvedTo: sha });
    expect((await resolver.resolve(loc('git_object', `${sha}:Dockerfile`))).resolved).toBe(true);
    expect(await resolver.resolve(loc('git_object', '0'.repeat(40)))).toEqual({
      resolved: false,
      reason: 'GIT_OBJECT_NOT_FOUND',
    });
    // a temp dir that is not a git repository
    const notARepo = new RepositoryAuthorityResolver({ repoRoot: root });
    expect((await notARepo.resolve(loc('git_object', sha))).resolved).toBe(false);
  });
});

describe('RepositoryAuthorityResolver: cas_artifact', () => {
  it('resolves a persisted artifact by its content-addressed id, verifying content on read', async () => {
    const store = new PatternProofArtifactStore({
      repository: new CasBackedArtifactRepository(new MemoryByteStorageBackend()),
    });
    const ref = await store.persistArtifact('discovery', validDiscovery());
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root, artifactStore: store });
    expect(await resolver.resolve(ref.locator)).toEqual({ resolved: true, resolvedTo: ref.artifactId });
    expect(await resolver.resolve(loc('cas_artifact', `ppe:discovery:${'0'.repeat(64)}`))).toEqual({
      resolved: false,
      reason: 'CAS_ARTIFACT_NOT_FOUND',
    });
    expect(await resolver.resolve(loc('cas_artifact', 'replay-m1-attempt-m1-1'))).toEqual({
      resolved: false,
      reason: 'CAS_ARTIFACT_REF_MALFORMED',
    });
  });

  it('a body stored under a mismatching id is a content-hash mismatch, and an invalid body is invalid', async () => {
    const store = new PatternProofArtifactStore({
      repository: new CasBackedArtifactRepository(new MemoryByteStorageBackend()),
    });
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root, artifactStore: store });
    const mismatched = await store.persistUnderId(
      `ppe:discovery:${'a'.repeat(64)}`,
      'PPE_DISCOVERY',
      validDiscovery(),
    );
    expect(await resolver.resolve(mismatched.locator)).toEqual({
      resolved: false,
      reason: 'CAS_ARTIFACT_CONTENT_HASH_MISMATCH',
    });
    const invalidBody = { findings: [] };
    const invalidId = `ppe:discovery:${digestOf(invalidBody).slice('sha256:'.length)}`;
    const invalid = await store.persistUnderId(invalidId, 'PPE_DISCOVERY', invalidBody);
    expect(await resolver.resolve(invalid.locator)).toEqual({
      resolved: false,
      reason: 'CAS_ARTIFACT_INVALID',
    });
  });

  it('is unresolved when no store is configured', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root });
    expect(await resolver.resolve(loc('cas_artifact', `ppe:discovery:${'0'.repeat(64)}`))).toEqual({
      resolved: false,
      reason: 'CAS_ARTIFACT_STORE_NOT_CONFIGURED',
    });
  });
});

describe('RepositoryAuthorityResolver: signed_attestation (verify-only, signer bound)', () => {
  const KEY_ID = 'ed25519:ppe-verifier-fixture';
  let attestation: ArtifactAttestation;
  let binding: string;
  let publicKey = '';
  let signer: LocalPemSigningKeyProvider;

  beforeAll(async () => {
    const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
    signer = generated.provider;
    publicKey = generated.publicKey;
    attestation = await createArtifactAttestation({
      subjectDigest: digestOf({ bundle: 'verifier-input' }),
      predicateType: 'ppe/verifier-input-bundle/v1',
      predicate: { declaredKeys: ['candidate', 'frozenSpec'] },
      signing: signer,
    });
    binding = attestationSubjectBinding(attestation);
  });

  const verifyOnly = () => new LocalPemVerificationKeyProvider(KEY_ID, publicKey);

  it('resolves a verifiable attestation found by binding (map and function lookups)', async () => {
    const viaMap = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: { verification: verifyOnly(), attestations: new Map([[binding, attestation]]) },
    });
    expect(await viaMap.resolve(loc('signed_attestation', binding, 'verifier-input-bundle'))).toEqual({
      resolved: true,
      resolvedTo: binding,
    });
    const viaFn = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: {
        verification: verifyOnly(),
        attestations: async (key) => (key === binding ? attestation : undefined),
      },
    });
    expect((await viaFn.resolve(loc('signed_attestation', binding))).resolved).toBe(true);
    expect(await viaFn.resolve(loc('signed_attestation', `sha256:${'0'.repeat(64)}`))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_NOT_FOUND',
    });
  });

  it('fails closed on a signer key id mismatch even when the signature verifies', async () => {
    const resolver = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: {
        verification: verifyOnly(),
        expectedSignerKeyId: 'ed25519:someone-else',
        attestations: new Map([[binding, attestation]]),
      },
    });
    expect(await resolver.resolve(loc('signed_attestation', binding))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_SIGNER_MISMATCH',
    });
    const forgedSigner = { ...attestation, signer: 'ed25519:impostor' };
    const resolver2 = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: { verification: verifyOnly(), attestations: new Map([[binding, forgedSigner]]) },
    });
    expect(await resolver2.resolve(loc('signed_attestation', binding))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_SIGNER_MISMATCH',
    });
  });

  it('fails closed on a tampered predicate, a wrong public key and a binding mismatch', async () => {
    const tampered = { ...attestation, predicate: { declaredKeys: ['candidate', 'writerTranscript'] } };
    const tamperedResolver = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: { verification: verifyOnly(), attestations: new Map([[binding, tampered]]) },
    });
    expect(await tamperedResolver.resolve(loc('signed_attestation', binding))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_SIGNATURE_INVALID',
    });
    const otherKey = LocalPemSigningKeyProvider.generate(KEY_ID).publicKey;
    const wrongKey = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: {
        verification: new LocalPemVerificationKeyProvider(KEY_ID, otherKey),
        attestations: new Map([[binding, attestation]]),
      },
    });
    expect(await wrongKey.resolve(loc('signed_attestation', binding))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_SIGNATURE_INVALID',
    });
    const misfiled = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: { verification: verifyOnly(), attestations: new Map([['sha256:other', attestation]]) },
    });
    expect(await misfiled.resolve(loc('signed_attestation', 'sha256:other'))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_BINDING_MISMATCH',
    });
  });

  it('refuses to resolve through a provider that can sign (verifier lane is verify-only)', async () => {
    expect('sign' in verifyOnly()).toBe(false);
    expect('sign' in signer).toBe(true);
    const resolver = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: { verification: signer, attestations: new Map([[binding, attestation]]) },
    });
    expect(await resolver.resolve(loc('signed_attestation', binding))).toEqual({
      resolved: false,
      reason: 'VERIFICATION_PROVIDER_CAN_SIGN',
    });
  });

  it('is unresolved when no lookup is configured', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root });
    expect(await resolver.resolve(loc('signed_attestation', binding))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_LOOKUP_NOT_CONFIGURED',
    });
  });
});

describe('RepositoryAuthorityResolver: runtime_result and postgis_ref', () => {
  it('runtime_result resolves by exact ledger membership', async () => {
    const ledger = ['local npm-ci reproduction, 2026-09-30, exit 1, MODULE_NOT_FOUND'];
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root, runtimeLedger: ledger });
    expect(await resolver.resolve(loc('runtime_result', ledger[0]))).toEqual({
      resolved: true,
      resolvedTo: ledger[0],
    });
    expect(await resolver.resolve(loc('runtime_result', `  ${ledger[0]}  `))).toEqual({
      resolved: true,
      resolvedTo: ledger[0],
    });
    expect(await resolver.resolve(loc('runtime_result', 'some other run'))).toEqual({
      resolved: false,
      reason: 'RUNTIME_RESULT_NOT_IN_LEDGER',
    });
    const none = new RepositoryAuthorityResolver({ repoRoot: root });
    expect(await none.resolve(loc('runtime_result', ledger[0]))).toEqual({
      resolved: false,
      reason: 'RUNTIME_LEDGER_NOT_CONFIGURED',
    });
  });

  it('postgis_ref is NOT_SUPPORTED_IN_V1', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root, runtimeLedger: [] });
    expect(await resolver.resolve(loc('postgis_ref', 'lu.layer_selection'))).toEqual({
      resolved: false,
      reason: NOT_SUPPORTED_IN_V1,
    });
  });

  it('rejects an invalid locator instead of resolving it', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root });
    await expect(resolver.resolve({ kind: 'prose', ref: 'x' } as unknown as EvidenceLocator)).rejects.toThrow(
      /PPE_EVIDENCE_KIND_INVALID/,
    );
  });
});

describe('InMemoryAuthorityResolver and resolveAll', () => {
  it('matches by kind + trimmed ref, ignoring note', async () => {
    const resolver = new InMemoryAuthorityResolver([
      loc('file_line', 'docker-compose.staging.yml:6-8', 'declared'),
      loc('runtime_result', 'run-1'),
    ]);
    expect((await resolver.resolve(loc('file_line', 'docker-compose.staging.yml:6-8'))).resolved).toBe(true);
    expect(
      (await resolver.resolve(loc('file_line', ' docker-compose.staging.yml:6-8 ', 'other note'))).resolved,
    ).toBe(true);
    expect((await resolver.resolve(loc('runtime_result', 'run-1'))).resolved).toBe(true);
    expect(await resolver.resolve(loc('file_line', 'services/mapLayerSelection.ts:1'))).toEqual({
      resolved: false,
      reason: 'NOT_IN_KNOWN_SET',
    });
    expect(await resolver.resolve(loc('git_object', 'docker-compose.staging.yml:6-8'))).toEqual({
      resolved: false,
      reason: 'NOT_IN_KNOWN_SET',
    });
    expect(await resolver.resolve(loc('postgis_ref', 'x'))).toEqual({
      resolved: false,
      reason: NOT_SUPPORTED_IN_V1,
    });
  });

  it('accepts a predicate', async () => {
    const resolver = new InMemoryAuthorityResolver((locator) => locator.kind === 'runtime_result');
    expect((await resolver.resolve(loc('runtime_result', 'anything'))).resolved).toBe(true);
    expect(await resolver.resolve(loc('file_line', 'Dockerfile:1'))).toEqual({
      resolved: false,
      reason: 'NOT_IN_PREDICATE',
    });
  });

  it('validates the known set and the queried locator', async () => {
    expect(
      () => new InMemoryAuthorityResolver([{ kind: 'prose', ref: 'x' } as unknown as EvidenceLocator]),
    ).toThrow(/PPE_EVIDENCE_KIND_INVALID/);
    const resolver = new InMemoryAuthorityResolver([]);
    await expect(resolver.resolve({ kind: 'file_line', ref: '' })).rejects.toThrow(/PPE_SCHEMA_INVALID/);
  });

  it('resolveAll lists every unresolved locator with its reason, in order', async () => {
    const resolver: AuthorityLocatorResolver = new InMemoryAuthorityResolver([
      loc('file_line', 'Dockerfile:37'),
    ]);
    const ok = await resolveAll(resolver, [loc('file_line', 'Dockerfile:37')]);
    expect(ok).toEqual({ allResolved: true, unresolved: [] });
    const summary = await resolveAll(resolver, [
      loc('file_line', 'Dockerfile:37'),
      loc('file_line', 'services/mapLayerSelection.ts:1'),
      loc('postgis_ref', 'lu.layer'),
    ]);
    expect(summary.allResolved).toBe(false);
    expect(summary.unresolved).toEqual([
      { locator: loc('file_line', 'services/mapLayerSelection.ts:1'), reason: 'NOT_IN_KNOWN_SET' },
      { locator: loc('postgis_ref', 'lu.layer'), reason: NOT_SUPPORTED_IN_V1 },
    ]);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.unresolved)).toBe(true);
  });
});
