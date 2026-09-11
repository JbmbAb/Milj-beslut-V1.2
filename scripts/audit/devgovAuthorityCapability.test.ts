import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AUTHORITY_CATALOG_SCHEMA,
  AUTHORITY_CONTENT_DIGEST_ALGORITHM,
  AUTHORITY_DENIAL,
  AUTHORITY_STATUS,
  authorityTreeDigest,
  catalogCapabilityEnvNames,
  loadProtectedAuthorityCatalog,
  planAuthority,
  probeMaterializationWritable,
  protectedCatalogPath,
  readAuthorityRequirement,
  resolveAuthorityCapability,
  validateAuthorityCatalog,
  WRITE_PROBE_OPERATIONS,
  WRITE_PROBE_SCHEMA,
} from '../devgov/authority.mjs';
import { sha256 } from '../devgov/trusted-attestation.mjs';

const AUTHORITY_ID = 'DEVGOV-AUTHORITY-FIXTURE-V1';
const REFERENCE_ENTRY = 'contracts/authority-reference-v1.json';

/**
 * The unprivileged test process cannot switch uid, so the proof identity's own
 * attestation is supplied through the probe launcher seam. The real uid-switched
 * probe is exercised by scripts/audit/e2e/devgovAuthorityRootTopology.e2e.mjs.
 */
const PROOF = { uid: 64123, gid: 64123 };
function attestingProbe() {
  return (_command: string, args: string[]) => {
    const [, , root, nonce] = args;
    const checks = WRITE_PROBE_OPERATIONS.map((operation: string) =>
      operation === 'read'
        ? { operation, attempted: true, targets: 1, result: 'ALLOWED', errnos: [], target: null }
        : {
            operation,
            attempted: true,
            targets: 1,
            result: 'DENIED',
            errnos: [operation === 'chmod' ? 'EPERM' : 'EACCES'],
            target: null,
          },
    );
    const report = {
      schema_version: WRITE_PROBE_SCHEMA,
      nonce,
      root,
      uid: PROOF.uid,
      gid: PROOF.gid,
      groups: [PROOF.gid],
      env_source: 'proc-self-environ',
      env_names: [],
      files: 1,
      directories: 1,
      checks,
    };
    return { status: 0, signal: null, stdout: JSON.stringify(report), stderr: '' };
  };
}
function proofIdentity() {
  return { proofUid: PROOF.uid, proofGid: PROOF.gid, probeRunner: attestingProbe() };
}

let scratch: string;
let archiveBytes: Buffer;
let archiveDigest: string;
let contentDigest: string;
let referenceDigest: string;

function makeArchive(mutate?: (sourceRoot: string) => void): Buffer {
  const workspace = mkdtempSync(join(scratch, 'src-'));
  const source = join(workspace, 'payload');
  mkdirSync(join(source, 'corpus'), { recursive: true });
  mkdirSync(join(source, 'contracts'), { recursive: true });
  writeFileSync(join(source, 'corpus', 'capture-manifest-v1.json'), '{"cases":["alpha","beta"]}\n');
  writeFileSync(join(source, 'corpus', 'alpha.json'), '{"case":"alpha"}\n');
  writeFileSync(join(source, ...REFERENCE_ENTRY.split('/')), '{"binding":"v1"}\n');
  mutate?.(source);
  // Relative operands with an explicit cwd: GNU tar treats an absolute Windows
  // path as a remote host specification.
  const packed = spawnSync('tar', ['-czf', 'payload.tar.gz', '-C', 'payload', '.'], {
    cwd: workspace,
    encoding: 'utf8',
  });
  if (packed.status !== 0) throw new Error(`fixture archive creation failed: ${packed.stderr}`);
  return readFileSync(join(workspace, 'payload.tar.gz'));
}

function catalogEntry(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'github-release-asset',
    source: {
      repository: 'JbmbAb/Milj-beslut-V1.2',
      release_tag: 'devgov-authority-fixture-v1',
      asset_name: 'authority-fixture-v1.tar.gz',
    },
    archive: { format: 'tar.gz', sha256: archiveDigest },
    content: { digest_algorithm: AUTHORITY_CONTENT_DIGEST_ALGORITHM, digest: contentDigest },
    reference: { digest_algorithm: 'sha256', digest: referenceDigest, entry: REFERENCE_ENTRY },
    capability_env: { root: 'FIXTURE_AUTHORITY_ROOT', reference: 'FIXTURE_AUTHORITY_REFERENCE' },
    required_entries: ['corpus/capture-manifest-v1.json'],
    ...overrides,
  };
}

function catalog(entry: Record<string, unknown> = catalogEntry(), id: string = AUTHORITY_ID) {
  return { schema_version: AUTHORITY_CATALOG_SCHEMA, authorities: { [id]: entry } };
}

/** Stands in for the release-asset HTTP round trip so the rest of the chain is exercised for real. */
function retriever(bytes: Buffer) {
  return async () => ({ bytes, source_identity: 'test-fixture' });
}

function materializationRoot(): string {
  return mkdtempSync(join(scratch, 'mat-'));
}

/** Expands fixture bytes the same way the resolver does, so expected digests are measured, never asserted. */
function expandArchive(bytes: Buffer): string {
  const workspace = mkdtempSync(join(scratch, 'exp-'));
  writeFileSync(join(workspace, 'payload.tar.gz'), bytes);
  mkdirSync(join(workspace, 'payload'));
  const unpacked = spawnSync('tar', ['-xzf', 'payload.tar.gz', '-C', 'payload', '--no-same-owner'], {
    cwd: workspace,
    encoding: 'utf8',
  });
  if (unpacked.status !== 0) throw new Error(`fixture expansion failed: ${unpacked.stderr}`);
  return join(workspace, 'payload');
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'devgov-authority-'));
  archiveBytes = makeArchive();
  archiveDigest = sha256(archiveBytes);
  // The expected content and reference digests are measured from a real
  // expansion of the real archive, not asserted by hand.
  const probeRoot = expandArchive(archiveBytes);
  contentDigest = authorityTreeDigest(probeRoot);
  referenceDigest = sha256(readFileSync(join(probeRoot, ...REFERENCE_ENTRY.split('/'))));
});

afterAll(() => {
  try {
    spawnSync(process.execPath, ['-e', 'require("node:fs").chmodSync(process.argv[1], 0o700)', scratch]);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // scratch cleanup is best effort
  }
});

describe('positive control: a valid authority resolves, verifies and materializes read-only', () => {
  it('10/11 materializes read-only and exposes only the capability the catalog declares', async () => {
    const resolved = await resolveAuthorityCapability({
      authorityId: AUTHORITY_ID,
      catalog: catalog(),
      materializationRoot: materializationRoot(),
      retrieve: retriever(archiveBytes),
      ...proofIdentity(),
    });

    expect(resolved.errors).toEqual([]);
    expect(resolved.status).toBe(AUTHORITY_STATUS.VERIFIED_READ_ONLY);
    expect(resolved.content_digest).toBe(contentDigest);
    expect(resolved.reference_digest).toBe(referenceDigest);
    // The verdict came from the proof identity's attempts, not from the controller.
    expect(resolved.probes[0]).toContain(`proof-identity uid=${PROOF.uid} gid=${PROOF.gid}`);

    // The proof receives the capability, and nothing beyond it.
    expect(Object.keys(resolved.capability_env).sort()).toEqual([
      'FIXTURE_AUTHORITY_REFERENCE',
      'FIXTURE_AUTHORITY_ROOT',
    ]);
    expect(resolved.capability_env.FIXTURE_AUTHORITY_ROOT).toBe(resolved.materialization_root);
    expect(readFileSync(resolved.capability_env.FIXTURE_AUTHORITY_REFERENCE, 'utf8')).toContain('binding');

    // Last, because a successful attempt is real: the materializing identity itself
    // probes the tree. Mode bits alone do not protect a tree from its owner, which is
    // why the verdict must be bound to a separate proof identity.
    const ownerProbe = probeMaterializationWritable(resolved.materialization_root);
    expect(ownerProbe.writable).toBe(true);
    expect(ownerProbe.verdict).toBe('WRITABLE');
  });

  it('positive control: the fixture digests are non-trivial and distinguish content', async () => {
    const differentBytes = makeArchive((source) => {
      writeFileSync(join(source, 'corpus', 'alpha.json'), '{"case":"alpha","extra":true}\n');
    });
    expect(sha256(differentBytes)).not.toBe(archiveDigest);
  });
});

describe('the github-release-asset provider itself, over a real HTTP round trip', () => {
  /** Serves the GitHub release + asset endpoints the provider actually calls. */
  async function withReleaseServer(
    assets: { name: string; bytes: Buffer }[],
    run: (apiBase: string, seen: string[]) => Promise<void>,
  ) {
    const seen: string[] = [];
    const server = createServer((request, response) => {
      seen.push(`${request.headers.authorization ?? ''} ${request.url}`);
      const asset = assets.find((candidate) => request.url === `/assets/${candidate.name}`);
      if (asset) {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(asset.bytes);
        return;
      }
      if (request.url?.includes('/releases/tags/')) {
        const port = (server.address() as AddressInfo).port;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            assets: assets.map((candidate) => ({
              name: candidate.name,
              url: `http://127.0.0.1:${port}/assets/${candidate.name}`,
            })),
          }),
        );
        return;
      }
      response.writeHead(404).end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('positive control: retrieves, verifies and materializes through the real provider', async () => {
    await withReleaseServer(
      [{ name: 'authority-fixture-v1.tar.gz', bytes: archiveBytes }],
      async (apiBase, seen) => {
        const resolved = await resolveAuthorityCapability({
          authorityId: AUTHORITY_ID,
          catalog: catalog(),
          materializationRoot: materializationRoot(),
          token: 'test-token',
          apiBase,
          ...proofIdentity(),
        });

        expect(resolved.errors).toEqual([]);
        expect(resolved.status).toBe(AUTHORITY_STATUS.VERIFIED_READ_ONLY);
        expect(resolved.content_digest).toBe(contentDigest);
        expect(resolved.source_identity).toContain('github-release-asset:');
        // The credential was presented, and only the catalog-named asset was fetched.
        expect(seen.every((entry) => entry.startsWith('Bearer test-token'))).toBe(true);
        expect(seen.some((entry) => entry.includes('/releases/tags/devgov-authority-fixture-v1'))).toBe(true);
      },
    );
  });

  it('3b denies when the release exists but the catalog-named asset does not', async () => {
    await withReleaseServer([{ name: 'some-other-asset.tar.gz', bytes: archiveBytes }], async (apiBase) => {
      const resolved = await resolveAuthorityCapability({
        authorityId: AUTHORITY_ID,
        catalog: catalog(),
        materializationRoot: materializationRoot(),
        token: 'test-token',
        apiBase,
      });
      expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
      expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.RETRIEVAL_UNAVAILABLE);
      expect(resolved.errors.join(' ')).toContain('authority-fixture-v1.tar.gz');
    });
  });

  it('denies retrieval when no credential is available to the controller', async () => {
    await withReleaseServer([{ name: 'authority-fixture-v1.tar.gz', bytes: archiveBytes }], async (apiBase) => {
      const resolved = await resolveAuthorityCapability({
        authorityId: AUTHORITY_ID,
        catalog: catalog(),
        materializationRoot: materializationRoot(),
        apiBase,
      });
      expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
      expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.RETRIEVAL_UNAVAILABLE);
      expect(resolved.errors.join(' ')).toContain('DEVGOV_AUTHORITY_TOKEN');
    });
  });

  it('4b denies a substituted asset served under the catalog-named asset name', async () => {
    const substituted = makeArchive((source) => {
      writeFileSync(join(source, 'corpus', 'alpha.json'), '{"case":"substituted-in-transit"}\n');
    });
    await withReleaseServer([{ name: 'authority-fixture-v1.tar.gz', bytes: substituted }], async (apiBase) => {
      const resolved = await resolveAuthorityCapability({
        authorityId: AUTHORITY_ID,
        catalog: catalog(),
        materializationRoot: materializationRoot(),
        token: 'test-token',
        apiBase,
      });
      expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
      expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.ARCHIVE_DIGEST_MISMATCH);
    });
  });
});

describe('negative controls: authority denial is fail-closed', () => {
  it('1 denies an authority id that is not in the protected catalog', async () => {
    const resolved = await resolveAuthorityCapability({
      authorityId: 'DEVGOV-AUTHORITY-NOT-REGISTERED',
      catalog: catalog(),
      materializationRoot: materializationRoot(),
      retrieve: retriever(archiveBytes),
    });
    expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
    expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.ID_UNKNOWN);
    expect(resolved.capability_env).toEqual({});
  });

  it('2 denies when the protected catalog holds no entry at all', async () => {
    const resolved = await resolveAuthorityCapability({
      authorityId: AUTHORITY_ID,
      catalog: { schema_version: AUTHORITY_CATALOG_SCHEMA, authorities: {} },
      materializationRoot: materializationRoot(),
      retrieve: retriever(archiveBytes),
    });
    expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
    expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.ID_UNKNOWN);
    expect(planAuthority(AUTHORITY_ID, { schema_version: AUTHORITY_CATALOG_SCHEMA, authorities: {} }).ok).toBe(
      false,
    );
  });

  it('3 denies when retrieval is unavailable', async () => {
    const resolved = await resolveAuthorityCapability({
      authorityId: AUTHORITY_ID,
      catalog: catalog(),
      materializationRoot: materializationRoot(),
      retrieve: async () => {
        throw new Error('release lookup failed with HTTP 404');
      },
    });
    expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
    expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.RETRIEVAL_UNAVAILABLE);
    expect(resolved.errors.join(' ')).toContain('404');
  });

  it('4 denies a retrieved archive whose bytes do not match the protected digest', async () => {
    const otherBytes = makeArchive((source) => {
      writeFileSync(join(source, 'corpus', 'alpha.json'), '{"case":"substituted"}\n');
    });
    const resolved = await resolveAuthorityCapability({
      authorityId: AUTHORITY_ID,
      catalog: catalog(),
      materializationRoot: materializationRoot(),
      retrieve: retriever(otherBytes),
    });
    expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
    expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.ARCHIVE_DIGEST_MISMATCH);
  });

  it('5 denies a single-byte tamper that survives the archive digest check', async () => {
    const tamperedBytes = makeArchive((source) => {
      writeFileSync(join(source, 'corpus', 'alpha.json'), '{"case":"alphb"}\n');
    });
    // The catalog pins the tampered archive, so archive verification passes and
    // only the expanded-content identity can detect the substitution.
    const tamperedCatalog = catalog(
      catalogEntry({ archive: { format: 'tar.gz', sha256: sha256(tamperedBytes) } }),
    );
    const resolved = await resolveAuthorityCapability({
      authorityId: AUTHORITY_ID,
      catalog: tamperedCatalog,
      materializationRoot: materializationRoot(),
      retrieve: retriever(tamperedBytes),
    });
    expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
    expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.CONTENT_DIGEST_MISMATCH);
  });

  it('5b denies a reference document whose digest does not match the protected reference identity', async () => {
    const referenceTampered = makeArchive((source) => {
      writeFileSync(join(source, ...REFERENCE_ENTRY.split('/')), '{"binding":"v2"}\n');
    });
    const probeRoot = expandArchive(referenceTampered);
    const tamperedCatalog = catalog(
      catalogEntry({
        archive: { format: 'tar.gz', sha256: sha256(referenceTampered) },
        content: { digest_algorithm: AUTHORITY_CONTENT_DIGEST_ALGORITHM, digest: authorityTreeDigest(probeRoot) },
      }),
    );
    const resolved = await resolveAuthorityCapability({
      authorityId: AUTHORITY_ID,
      catalog: tamperedCatalog,
      materializationRoot: materializationRoot(),
      retrieve: retriever(referenceTampered),
    });
    expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
    expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.REFERENCE_DIGEST_MISMATCH);
  });

  it('9 denies a materialization that is still writable by the proof identity', async () => {
    const resolved = await resolveAuthorityCapability({
      authorityId: AUTHORITY_ID,
      catalog: catalog(),
      materializationRoot: materializationRoot(),
      retrieve: retriever(archiveBytes),
      proofUid: PROOF.uid,
      proofGid: PROOF.gid,
      probeWritable: () => ({
        writable: true,
        detail: 'proof identity created a file in the authority materialization',
        probes: ['file-write', 'identity-create'],
      }),
    });
    expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
    expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.MATERIALIZATION_WRITABLE);
    expect(resolved.probes).toEqual(['file-write', 'identity-create']);
  });

  it('9b positive control: the writability probe really detects a writable tree', () => {
    const root = materializationRoot();
    mkdirSync(join(root, 'corpus'), { recursive: true });
    const file = join(root, 'corpus', 'writable.json');
    writeFileSync(file, '{}');
    chmodSync(file, 0o644);
    const probe = probeMaterializationWritable(root);
    expect(probe.writable).toBe(true);
    expect(probe.verdict).toBe('WRITABLE');
    expect(probe.probes).toContain('overwrite=ALLOWED');
  });

  it('denies a materialization root inside the candidate checkout', async () => {
    const candidateRoot = materializationRoot();
    const resolved = await resolveAuthorityCapability({
      authorityId: AUTHORITY_ID,
      catalog: catalog(),
      candidateRoot,
      materializationRoot: join(candidateRoot, 'nested'),
      retrieve: retriever(archiveBytes),
    });
    expect(resolved.status).toBe(AUTHORITY_STATUS.DENIED);
    expect(resolved.reason_code).toBe(AUTHORITY_DENIAL.MATERIALIZATION_UNSAFE);
  });
});

describe('candidate-declared requirement is limited to a capability id', () => {
  it('accepts a bare capability id', () => {
    const requirement = readAuthorityRequirement({ authority_requirement: { id: AUTHORITY_ID } });
    expect(requirement).toEqual({ required: true, id: AUTHORITY_ID, errors: [] });
  });

  it('6 denies a candidate that declares its own expected digest', () => {
    const requirement = readAuthorityRequirement({
      authority_requirement: { id: AUTHORITY_ID, expected_digest: 'a'.repeat(64) },
    });
    expect(requirement.id).toBeNull();
    expect(requirement.errors.join(' ')).toContain('expected_digest');
  });

  it('8 denies a candidate that declares its own provider or source location', () => {
    const provider = readAuthorityRequirement({
      authority_requirement: { id: AUTHORITY_ID, provider: 'github-release-asset' },
    });
    expect(provider.id).toBeNull();
    expect(provider.errors.join(' ')).toContain('provider');

    const source = readAuthorityRequirement({
      authority_requirement: { id: AUTHORITY_ID, source: { repository: 'attacker/repo' } },
    });
    expect(source.id).toBeNull();
    expect(source.errors.join(' ')).toContain('source');
  });

  it('8b denies a candidate that declares its own materialization path or signer', () => {
    for (const key of ['materialization_path', 'signer', 'catalog_path']) {
      const requirement = readAuthorityRequirement({
        authority_requirement: { id: AUTHORITY_ID, [key]: 'x' },
      });
      expect(requirement.id).toBeNull();
      expect(requirement.errors.join(' ')).toContain(key);
    }
  });

  it('treats an absent requirement as no authority, not as unverified authority', () => {
    expect(readAuthorityRequirement({ id: 'plain' })).toEqual({ required: false, id: null, errors: [] });
  });
});

describe('protected catalog integrity', () => {
  it('the catalog shipped with the controller is valid and reachable only from the controller root', () => {
    const loaded = loadProtectedAuthorityCatalog();
    expect(loaded.ok).toBe(true);
    expect(loaded.path).toBe(protectedCatalogPath());
    expect(validateAuthorityCatalog(loaded.catalog)).toEqual([]);
  });

  it('refuses a catalog that resolves inside the candidate checkout', () => {
    const loaded = loadProtectedAuthorityCatalog({ candidateRoot: process.cwd() });
    expect(loaded.ok).toBe(false);
    expect(loaded.reason_code).toBe(AUTHORITY_DENIAL.CATALOG_NOT_PROTECTED);
  });

  it('rejects a catalog entry that binds a reserved environment name', () => {
    const errors = validateAuthorityCatalog(
      catalog(catalogEntry({ capability_env: { root: 'PATH' } })),
    );
    expect(errors.join(' ')).toContain('reserved environment name PATH');
  });

  it('rejects a catalog entry that declares an unsupported provider', () => {
    const errors = validateAuthorityCatalog(catalog(catalogEntry({ provider: 'candidate-supplied' })));
    expect(errors.join(' ')).toContain('provider is unsupported');
  });

  it('enumerates every capability name so the controller can scrub inherited values', () => {
    expect([...catalogCapabilityEnvNames(catalog())].sort()).toEqual([
      'FIXTURE_AUTHORITY_REFERENCE',
      'FIXTURE_AUTHORITY_ROOT',
    ]);
  });
});
