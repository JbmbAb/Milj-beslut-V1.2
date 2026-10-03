// @vitest-environment node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { InMemoryArtifactRepository } from '@miljobeslut/mps-runtime';
import { assertBootstrapAdmitFlagOnlyInExplicitTestProcess } from '@miljobeslut/mps-lu';
import {
  PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS,
  createProductReleaseIssuerArtifact,
  createProductReleaseManifestArtifact,
  createProductReleaseManifestArtifactV3,
  type ProductReleaseBuildIdentityV3,
  type ProductReleaseManifestArtifact,
} from '../../packages/mps-governance/src/release/ProductReleaseAuthority';
import { attestProductRelease } from '../../server/modules/release/productReleaseAuthority';
import {
  BUILD_ARGS_PREFIXES,
  COMPOSITION_MANIFEST_PATHS,
  DIGEST_EXCLUDED_DIR_NAMES,
  LEGACY_IDENTITY_FILES,
  SOURCE_DIGEST_ROOTS,
  digestListing,
  listDeliveredFiles,
  measureBuildArgs,
  measureCompositionManifest,
  measureLegacyIdentityHashes,
  measureSourceDigest,
} from '../../scripts/release/buildIdentityDigest.mjs';
import {
  PRODUCT_RELEASE_IDENTITY_UNAVAILABLE,
  REJECT_PRODUCT_RELEASE_BUILD_MISMATCH,
  RELEASE_IDENTITY_FILE_NAME,
  ProductReleaseBuildMismatchError,
  ProductReleaseIdentityUnavailableError,
  assertProductReleaseBuildIdentity,
  deliveredRootFromModule,
  measureDeliveredBuildIdentity,
  readReleaseIdentityFile,
} from '../../server/modules/release/productReleaseBuildIdentity';
import {
  isExplicitDevelopmentOrTestProcess,
  isExplicitDevelopmentProcess,
  isExplicitTestProcess,
} from '../../server/modules/release/processClassification';
import { assertProductReleaseIdentityAtStartup } from '../../server/modules/release/productReleaseStartup';
import { getRunningProductRelease, resetRunningProductReleaseForTests } from '../../server/modules/release/runningProductRelease';

/**
 * W-U42 (U42a, point 2) -- "Mätning, inte deklaration" (U40-U50B-SPEC §1.6; owner decision row 4: "processen vägrar
 * starta vid avvikelse").
 *
 *  - ONE digest algorithm (scripts/release/buildIdentityDigest.mjs) measures the delivered files; the build writes it
 *    into release-identity.json (scripts/release/write-build-identity.mjs); every process re-measures at start and
 *    compares with the file AND with the signed release manifest; a deviation refuses the start with
 *    REJECT_PRODUCT_RELEASE_BUILD_MISMATCH.
 *  - A dirty checkout gives no identity; an identity is never read from the current working directory (U40-A2 R8).
 *  - Outside an explicit development/test process a product process starts ONLY under a measured release identity.
 *
 * Hermetic: temporary directories under os.tmpdir(), temporary git repositories, in-memory artifact repository,
 * child `node` processes for the CLI. No CAS, no database, no network, no Docker.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'scripts', 'release', 'write-build-identity.mjs');
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const tempDirs: string[] = [];
function tmp(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `u42-${label}-`));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

/** A small delivered tree with every digest root, the three legacy identity files and the composition files. */
const DELIVERED: Record<string, string> = {
  'server/index.ts': "import './loadEnvFirst';\n",
  'server/modules/release/x.ts': 'export const x = 1;\n',
  'src/main.tsx': 'main\n',
  'packages/mps-lu/src/index.ts': 'lu\n',
  'packages/mps-lu/package.json': '{"name":"@miljobeslut/mps-lu"}\n',
  'prisma/schema.prisma': 'datasource db {}\n',
  'components/App.tsx': 'app\n',
  'dist/index.html': '<html></html>\n',
  'dist/assets/app.js': 'console.log(1)\n',
  'package.json': '{"name":"fixture","version":"0.0.0"}\n',
  'package-lock.json': '{"name":"fixture","lockfileVersion":3}\n',
  'public/cesium/Widgets/widgets.css': 'outside the digest roots\n',
  Dockerfile: 'FROM scratch\n',
  '.dockerignore': 'node_modules\n',
  'deploy/onprem/build-image.sh': '#!/bin/sh\n',
  'deploy/onprem/image-smoke/smoke.mjs': 'smoke\n',
};

function git(dir: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', dir, '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function initRepo(dir: string): { commit: string; tree: string } {
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=u42', '-c', 'user.email=u42@example.invalid', 'commit', '-q', '-m', 'fixture');
  return { commit: git(dir, 'rev-parse', 'HEAD'), tree: git(dir, 'rev-parse', 'HEAD^{tree}') };
}

function runCli(args: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  const env: Record<string, string | undefined> = { ...process.env, ...opts.env };
  for (const key of Object.keys(env)) if (key.startsWith('VITE_')) delete env[key];
  for (const [key, value] of Object.entries(opts.env ?? {})) env[key] = value;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd ?? os.tmpdir(), env, encoding: 'utf8' });
}

const keys = LocalPemSigningKeyProvider.generate('ed25519:product-release-build-identity-test');
const issuer = createProductReleaseIssuerArtifact(keys.provider.keyId);
const issuerRef = { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type } as const;
const RELEASE_ENV = { PRODUCT_RELEASE_ISSUER_KEY_ID: keys.provider.keyId, PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM: keys.publicKey };

async function signedV3(buildIdentity: ProductReleaseBuildIdentityV3) {
  const unsigned = createProductReleaseManifestArtifactV3({ product_name: 'Miljöbeslut', build_identity: buildIdentity, issuer_ref: issuerRef });
  return { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
}

async function repositoryWith(...releases: ProductReleaseManifestArtifact[]) {
  const repo = new InMemoryArtifactRepository();
  await repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  for (const r of releases) await repo.put({ artifact_id: r.artifact_id, content_hash: r.content_hash, body: r });
  return repo;
}

/** Writes an identity file for `root` the way the CLI does, through the CLI itself (declared source, measured composition). */
function writeIdentityViaCli(root: string, commit = 'a'.repeat(40), tree = 'b'.repeat(40)) {
  const r = runCli(['--root', root, '--source-commit', commit, '--source-tree', tree]);
  expect(r.status, r.stderr).toBe(0);
  return readReleaseIdentityFile(root)!;
}

describe('buildIdentityDigest.mjs: the one source-digest algorithm', () => {
  it('pins the roots, the exclusions, the composition paths, the build-arg prefix and the legacy files', () => {
    expect([...SOURCE_DIGEST_ROOTS]).toEqual(['server', 'src', 'packages', 'prisma', 'components', 'dist']);
    expect([...DIGEST_EXCLUDED_DIR_NAMES]).toEqual(['node_modules']);
    expect([...COMPOSITION_MANIFEST_PATHS]).toEqual(['Dockerfile', '.dockerignore', 'deploy/onprem']);
    expect([...BUILD_ARGS_PREFIXES]).toEqual(['VITE_']);
    expect(LEGACY_IDENTITY_FILES).toEqual({
      package_lock_sha256: 'package-lock.json',
      package_manifest_sha256: 'package.json',
      runtime_entrypoint_sha256: 'server/index.ts',
    });
  });

  it('the listing form is sha256 over "<posix path>\\0<sha256 of bytes>\\n" lines in byte order (pinned by hand)', () => {
    const root = tmp('listing');
    writeTree(root, { 'src/b.ts': 'B', 'server/a.ts': 'A', 'server/sub/Z.ts': 'Z', 'server/sub/a.ts': 'a2' });
    const files = listDeliveredFiles(root, ['server', 'src']);
    expect(files).toEqual(['server/a.ts', 'server/sub/Z.ts', 'server/sub/a.ts', 'src/b.ts']);
    const expected = sha256(
      `server/a.ts\0${sha256('A')}\n` + `server/sub/Z.ts\0${sha256('Z')}\n` + `server/sub/a.ts\0${sha256('a2')}\n` + `src/b.ts\0${sha256('B')}\n`,
    );
    expect(digestListing(root, files)).toEqual({ digest: expected, file_count: 4 });
    expect(measureSourceDigest(root)).toMatchObject({ source_digest_sha256: expected, file_count: 4, roots_present: ['server', 'src'] });
  });

  it('is deterministic and independent of creation order, and changes with any byte in any root', () => {
    const a = tmp('det-a');
    const b = tmp('det-b');
    writeTree(a, DELIVERED);
    writeTree(b, Object.fromEntries(Object.entries(DELIVERED).reverse()));
    const base = measureSourceDigest(a);
    expect(measureSourceDigest(b)).toEqual(base);
    expect(base.roots_present).toEqual(['server', 'src', 'packages', 'prisma', 'components', 'dist']);
    for (const rel of ['server/index.ts', 'src/main.tsx', 'packages/mps-lu/src/index.ts', 'prisma/schema.prisma', 'components/App.tsx', 'dist/assets/app.js']) {
      const c = tmp('det-c');
      writeTree(c, { ...DELIVERED, [rel]: `${DELIVERED[rel]}// changed\n` });
      expect(measureSourceDigest(c).source_digest_sha256, rel).not.toBe(base.source_digest_sha256);
    }
    const added = tmp('det-added');
    writeTree(added, { ...DELIVERED, 'server/new.ts': 'new\n' });
    expect(measureSourceDigest(added).source_digest_sha256, 'an added file changes the digest').not.toBe(base.source_digest_sha256);
    const removed = tmp('det-removed');
    const { 'components/App.tsx': _gone, ...withoutOne } = DELIVERED;
    writeTree(removed, withoutOne);
    expect(measureSourceDigest(removed).source_digest_sha256, 'a removed file changes the digest').not.toBe(base.source_digest_sha256);
  });

  it('ignores node_modules under any root, files outside the roots, and symbolic links', () => {
    const root = tmp('ignore');
    writeTree(root, DELIVERED);
    const base = measureSourceDigest(root);
    writeTree(root, { 'packages/mps-lu/node_modules/dep/index.js': 'installed\n', 'server/node_modules/x.js': 'x\n', 'public/cesium/Widgets/widgets.css': 'rewritten by postinstall\n', 'README.md': 'docs\n' });
    expect(measureSourceDigest(root)).toEqual(base);
    let linked = false;
    try {
      fs.symlinkSync(path.join(root, 'src', 'main.tsx'), path.join(root, 'server', 'link.ts'), 'file');
      linked = true;
    } catch {
      // symlink creation needs a privilege on some Windows hosts; the exclusion is then covered on hosts that can link
    }
    if (linked) expect(measureSourceDigest(root), 'a symbolic link is never part of the delivered identity').toEqual(base);
  });

  it('the composition manifest covers exactly Dockerfile, .dockerignore and deploy/onprem/**, and is null when they are not all delivered', () => {
    const root = tmp('comp');
    writeTree(root, DELIVERED);
    const files = listDeliveredFiles(root, COMPOSITION_MANIFEST_PATHS);
    expect(files).toEqual(['.dockerignore', 'Dockerfile', 'deploy/onprem/build-image.sh', 'deploy/onprem/image-smoke/smoke.mjs']);
    const base = measureCompositionManifest(root);
    expect(base).toEqual({ composition_manifest_sha256: digestListing(root, files).digest, file_count: 4 });
    const changed = tmp('comp-changed');
    writeTree(changed, { ...DELIVERED, Dockerfile: 'FROM scratch\nRUN true\n' });
    expect(measureCompositionManifest(changed)!.composition_manifest_sha256).not.toBe(base!.composition_manifest_sha256);
    const inImage = tmp('comp-image');
    const { Dockerfile: _d, '.dockerignore': _i, 'deploy/onprem/build-image.sh': _b, 'deploy/onprem/image-smoke/smoke.mjs': _s, ...withoutComposition } = DELIVERED;
    writeTree(inImage, withoutComposition);
    expect(measureCompositionManifest(inImage), 'inside the image the composition files are not delivered: nothing to measure').toBeNull();
    const partial = tmp('comp-partial');
    writeTree(partial, { ...withoutComposition, Dockerfile: 'FROM scratch\n' });
    expect(measureCompositionManifest(partial), 'a partial composition is not a measurement').toBeNull();
  });

  it('build args are the VITE_* variables only, sorted, value-sensitive, hashed as canonical JSON', () => {
    const empty = measureBuildArgs({ PATH: '/usr/bin', NODE_ENV: 'production' });
    expect(empty).toEqual({ build_args_sha256: sha256('{}'), names: [] });
    const withArgs = measureBuildArgs({ VITE_DEMO_LOGIN: 'true', VITE_API_BASE: '/api', NODE_ENV: 'production', PATH: '/x' });
    expect(withArgs.names).toEqual(['VITE_API_BASE', 'VITE_DEMO_LOGIN']);
    expect(withArgs.build_args_sha256).toBe(sha256(JSON.stringify({ VITE_API_BASE: '/api', VITE_DEMO_LOGIN: 'true' })));
    expect(measureBuildArgs({ VITE_DEMO_LOGIN: 'false', VITE_API_BASE: '/api' }).build_args_sha256).not.toBe(withArgs.build_args_sha256);
    expect(measureBuildArgs({ VITE_API_BASE: '/api', VITE_DEMO_LOGIN: 'true', OTHER: 'x' }).build_args_sha256, 'non-VITE variables never enter').toBe(withArgs.build_args_sha256);
  });

  it('the legacy hashes are sha256 of package-lock.json, package.json and server/index.ts under the root', () => {
    const root = tmp('legacy');
    writeTree(root, DELIVERED);
    expect(measureLegacyIdentityHashes(root)).toEqual({
      package_lock_sha256: sha256(DELIVERED['package-lock.json']),
      package_manifest_sha256: sha256(DELIVERED['package.json']),
      runtime_entrypoint_sha256: sha256(DELIVERED['server/index.ts']),
    });
    fs.rmSync(path.join(root, 'package-lock.json'));
    expect(() => measureLegacyIdentityHashes(root)).toThrow(/package-lock\.json/);
  });
});

describe('write-build-identity.mjs: the build writes release-identity.json, never from a dirty checkout, never from cwd', () => {
  it('in a clean git checkout: commit and tree from git, everything else measured; the file is canonical and re-runs are byte-identical', () => {
    const root = tmp('clean');
    writeTree(root, { ...DELIVERED, '.gitignore': `${RELEASE_IDENTITY_FILE_NAME}\n` });
    const { commit, tree } = initRepo(root);
    const first = runCli(['--root', root], { env: { VITE_DEMO_LOGIN: 'true' } });
    expect(first.status, first.stderr).toBe(0);
    const bytes1 = fs.readFileSync(path.join(root, RELEASE_IDENTITY_FILE_NAME));
    const identity = JSON.parse(bytes1.toString('utf8'));
    expect(identity.contract_version).toBe('product-release-v3');
    expect(Object.keys(identity.build_identity).sort()).toEqual([...PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS].sort());
    expect(identity.build_identity).toMatchObject({
      source_commit_sha: commit,
      source_tree_sha: tree,
      source_digest_sha256: measureSourceDigest(root).source_digest_sha256,
      composition_manifest_sha256: measureCompositionManifest(root)!.composition_manifest_sha256,
      build_args_sha256: measureBuildArgs({ VITE_DEMO_LOGIN: 'true' }).build_args_sha256,
      ...measureLegacyIdentityHashes(root),
    });
    expect(identity.measurement).toMatchObject({
      source: { kind: 'git-worktree' },
      composition_manifest: { source: 'measured', file_count: 4 },
      build_args: { names: ['VITE_DEMO_LOGIN'] },
      source_digest: { roots: [...SOURCE_DIGEST_ROOTS], excluded_dir_names: ['node_modules'] },
    });
    expect(bytes1.toString('utf8').endsWith('\n')).toBe(true);
    expect(bytes1.includes(Buffer.from('\r'))).toBe(false);
    expect(JSON.stringify(identity)).not.toMatch(/"(issued_at|timestamp|generated_at)"/);
    const second = runCli(['--root', root], { env: { VITE_DEMO_LOGIN: 'true' } });
    expect(second.status, second.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, RELEASE_IDENTITY_FILE_NAME)).equals(bytes1)).toBe(true);
    expect(first.stdout).not.toMatch(/PRIVATE|SECRET|PASSWORD/i);
  });

  it('a dirty checkout gives no identity: a modified tracked file or an untracked file refuses with REJECT_BUILD_IDENTITY_DIRTY_CHECKOUT', () => {
    const root = tmp('dirty');
    writeTree(root, { ...DELIVERED, '.gitignore': `${RELEASE_IDENTITY_FILE_NAME}\n` });
    initRepo(root);
    fs.appendFileSync(path.join(root, 'server', 'index.ts'), '// local edit\n');
    const modified = runCli(['--root', root]);
    expect(modified.status).not.toBe(0);
    expect(modified.stderr).toMatch(/REJECT_BUILD_IDENTITY_DIRTY_CHECKOUT/);
    expect(fs.existsSync(path.join(root, RELEASE_IDENTITY_FILE_NAME)), 'nothing is written for a dirty checkout').toBe(false);
    git(root, 'checkout', '--', 'server/index.ts');
    writeTree(root, { 'server/untracked.ts': 'not committed\n' });
    const untracked = runCli(['--root', root]);
    expect(untracked.status).not.toBe(0);
    expect(untracked.stderr).toMatch(/REJECT_BUILD_IDENTITY_DIRTY_CHECKOUT/);
    expect(fs.existsSync(path.join(root, RELEASE_IDENTITY_FILE_NAME))).toBe(false);
  });

  it('with a git checkout, declared --source-commit/--source-tree must equal HEAD (never trusted over the measurement)', () => {
    const root = tmp('declared-vs-git');
    writeTree(root, { ...DELIVERED, '.gitignore': `${RELEASE_IDENTITY_FILE_NAME}\n` });
    const { commit, tree } = initRepo(root);
    const wrong = runCli(['--root', root, '--source-commit', 'c'.repeat(40), '--source-tree', tree]);
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toMatch(/REJECT_BUILD_IDENTITY_SOURCE_MISMATCH/);
    expect(fs.existsSync(path.join(root, RELEASE_IDENTITY_FILE_NAME))).toBe(false);
    const right = runCli(['--root', root, '--source-commit', commit, '--source-tree', tree]);
    expect(right.status, right.stderr).toBe(0);
  });

  it('without a git checkout (the image build from git archive): the source must be declared, and the composition too when it is not delivered', () => {
    const root = tmp('archive');
    const { Dockerfile: _d, '.dockerignore': _i, 'deploy/onprem/build-image.sh': _b, 'deploy/onprem/image-smoke/smoke.mjs': _s, ...withoutComposition } = DELIVERED;
    writeTree(root, withoutComposition);
    const noSource = runCli(['--root', root]);
    expect(noSource.status).not.toBe(0);
    expect(noSource.stderr).toMatch(/REJECT_BUILD_IDENTITY_SOURCE_UNKNOWN/);
    const noComposition = runCli(['--root', root, '--source-commit', 'a'.repeat(40), '--source-tree', 'b'.repeat(40)]);
    expect(noComposition.status).not.toBe(0);
    expect(noComposition.stderr).toMatch(/REJECT_BUILD_IDENTITY_COMPOSITION_UNKNOWN/);
    expect(fs.existsSync(path.join(root, RELEASE_IDENTITY_FILE_NAME))).toBe(false);
    const malformed = runCli(['--root', root, '--source-commit', 'A'.repeat(40), '--source-tree', 'b'.repeat(40), '--composition-manifest-sha256', 'c'.repeat(64)]);
    expect(malformed.status, 'upper-case hex is not the canonical form').not.toBe(0);
    const ok = runCli(['--root', root, '--source-commit', 'a'.repeat(40), '--source-tree', 'b'.repeat(40), '--composition-manifest-sha256', 'c'.repeat(64)]);
    expect(ok.status, ok.stderr).toBe(0);
    const identity = JSON.parse(fs.readFileSync(path.join(root, RELEASE_IDENTITY_FILE_NAME), 'utf8'));
    expect(identity.build_identity).toMatchObject({ source_commit_sha: 'a'.repeat(40), source_tree_sha: 'b'.repeat(40), composition_manifest_sha256: 'c'.repeat(64) });
    expect(identity.measurement).toMatchObject({ source: { kind: 'declared' }, composition_manifest: { source: 'declared', file_count: null } });
  });

  it('a measured composition is never overridden by a different declared one', () => {
    const root = tmp('comp-conflict');
    writeTree(root, DELIVERED);
    const r = runCli(['--root', root, '--source-commit', 'a'.repeat(40), '--source-tree', 'b'.repeat(40), '--composition-manifest-sha256', 'c'.repeat(64)]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/REJECT_BUILD_IDENTITY_COMPOSITION_MISMATCH/);
  });

  it('--print composition prints the composition manifest hash of the root and writes nothing', () => {
    const root = tmp('print');
    writeTree(root, DELIVERED);
    const r = runCli(['--root', root, '--print', 'composition']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(measureCompositionManifest(root)!.composition_manifest_sha256);
    expect(fs.existsSync(path.join(root, RELEASE_IDENTITY_FILE_NAME))).toBe(false);
  });

  it('the root defaults to the repository the script lives in, not to the current working directory (R8)', () => {
    const foreignCwd = tmp('foreign-cwd');
    writeTree(foreignCwd, DELIVERED);
    const r = runCli(['--print', 'composition'], { cwd: foreignCwd });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(measureCompositionManifest(REPO_ROOT)!.composition_manifest_sha256);
    expect(r.stdout.trim()).not.toBe(measureCompositionManifest(foreignCwd)!.composition_manifest_sha256);
  });
});

describe('processClassification: explicit development or test process (the K0 model, both variables, exact)', () => {
  it.each([
    [{ NODE_ENV: 'test', APP_ENV: 'test' }, true, true],
    [{ NODE_ENV: 'test', APP_ENV: 'ci' }, true, true],
    [{ NODE_ENV: 'development', APP_ENV: 'development' }, false, true],
    [{ NODE_ENV: 'test' }, false, false],
    [{ NODE_ENV: 'test', APP_ENV: '' }, false, false],
    [{ NODE_ENV: 'test', APP_ENV: 'development' }, false, false],
    [{ NODE_ENV: 'development' }, false, false],
    [{ NODE_ENV: 'development', APP_ENV: 'test' }, false, false],
    [{ NODE_ENV: 'development', APP_ENV: 'Development' }, false, false],
    [{ NODE_ENV: 'production', APP_ENV: 'development' }, false, false],
    [{ NODE_ENV: 'production', APP_ENV: 'production' }, false, false],
    [{ APP_ENV: 'development' }, false, false],
    [{}, false, false],
    [{ NODE_ENV: 'Test', APP_ENV: 'test' }, false, false],
    [{ NODE_ENV: ' test', APP_ENV: 'test' }, false, false],
  ] as const)('%j -> test=%s, dev-or-test=%s', (env, test, devOrTest) => {
    expect(isExplicitTestProcess(env)).toBe(test);
    expect(isExplicitDevelopmentOrTestProcess(env)).toBe(devOrTest);
    expect(isExplicitDevelopmentProcess(env)).toBe(devOrTest && !test);
  });

  it('agrees with the mps-lu bootstrap-flag gate on what an explicit TEST process is (one rule, drift is red)', () => {
    const cases = [
      { NODE_ENV: 'test', APP_ENV: 'test' }, { NODE_ENV: 'test', APP_ENV: 'ci' }, { NODE_ENV: 'test' }, { NODE_ENV: 'test', APP_ENV: '' },
      { NODE_ENV: 'test', APP_ENV: 'development' }, { NODE_ENV: 'development', APP_ENV: 'development' }, { NODE_ENV: 'production', APP_ENV: 'production' },
      { NODE_ENV: 'Test', APP_ENV: 'test' }, { NODE_ENV: 'test', APP_ENV: 'TEST' }, {},
    ];
    for (const env of cases) {
      let refused = false;
      try {
        assertBootstrapAdmitFlagOnlyInExplicitTestProcess({ ...env, MPS_LU_BOOTSTRAP_ADMIT: '1' }, 'process_startup');
      } catch {
        refused = true;
      }
      expect(isExplicitTestProcess(env), JSON.stringify(env)).toBe(!refused);
    }
  });
});

describe('productReleaseBuildIdentity: every process re-measures at start and compares with the file and the manifest', () => {
  it('the delivered root is derived from the module location, never from the working directory', () => {
    const root = deliveredRootFromModule();
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'server', 'index.ts'))).toBe(true);
    expect(path.resolve(root)).toBe(REPO_ROOT);
    expect(path.resolve(root)).not.toBe(path.resolve(process.cwd()));
  });

  it('reads and validates release-identity.json: absent -> null; malformed -> PRODUCT_RELEASE_IDENTITY_UNAVAILABLE', () => {
    const root = tmp('read');
    writeTree(root, DELIVERED);
    expect(readReleaseIdentityFile(root)).toBeNull();
    const identity = writeIdentityViaCli(root);
    expect(identity.contract_version).toBe('product-release-v3');
    const file = path.join(root, RELEASE_IDENTITY_FILE_NAME);
    const original = fs.readFileSync(file, 'utf8');
    for (const broken of [
      '{not json',
      JSON.stringify({ ...JSON.parse(original), contract_version: 'product-release-v2' }),
      JSON.stringify({ ...JSON.parse(original), build_identity: { ...identity.build_identity, source_digest_sha256: undefined } }),
      JSON.stringify({ ...JSON.parse(original), build_identity: { ...identity.build_identity, source_commit_sha: 'X'.repeat(40) } }),
    ]) {
      fs.writeFileSync(file, broken);
      let thrown: unknown = null;
      try {
        readReleaseIdentityFile(root);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, broken.slice(0, 40)).toBeInstanceOf(ProductReleaseIdentityUnavailableError);
      expect((thrown as ProductReleaseIdentityUnavailableError).code).toBe(PRODUCT_RELEASE_IDENTITY_UNAVAILABLE);
    }
  });

  it('measures what the process can measure at start: the source digest and the three legacy hashes over the delivered root', () => {
    const root = tmp('measure');
    writeTree(root, DELIVERED);
    expect(measureDeliveredBuildIdentity(root)).toEqual({
      source_digest_sha256: measureSourceDigest(root).source_digest_sha256,
      file_count: measureSourceDigest(root).file_count,
      ...measureLegacyIdentityHashes(root),
    });
  });

  it('matching file, measurement and v3 manifest -> accepted; any deviation -> REJECT_PRODUCT_RELEASE_BUILD_MISMATCH naming the field', async () => {
    const root = tmp('compare');
    writeTree(root, DELIVERED);
    const identity = writeIdentityViaCli(root);
    const release = await signedV3(identity.build_identity);
    const accepted = assertProductReleaseBuildIdentity({ root, release });
    expect(accepted.measured.source_digest_sha256).toBe(identity.build_identity.source_digest_sha256);
    expect(accepted.identity).toEqual(identity);

    // (a) a delivered file changed after the build: measured digest != file
    fs.appendFileSync(path.join(root, 'server', 'modules', 'release', 'x.ts'), '// tampered\n');
    let thrown: unknown = null;
    try {
      assertProductReleaseBuildIdentity({ root, release });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProductReleaseBuildMismatchError);
    expect((thrown as ProductReleaseBuildMismatchError).code).toBe(REJECT_PRODUCT_RELEASE_BUILD_MISMATCH);
    expect((thrown as ProductReleaseBuildMismatchError).mismatches.join('\n')).toMatch(/source_digest_sha256/);
    expect((thrown as Error).message).toMatch(/REJECT_PRODUCT_RELEASE_BUILD_MISMATCH/);
    fs.writeFileSync(path.join(root, 'server', 'modules', 'release', 'x.ts'), DELIVERED['server/modules/release/x.ts']);
    expect(() => assertProductReleaseBuildIdentity({ root, release })).not.toThrow();

    // (b) a legacy identity file changed: measured != file
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3,"rewritten":true}\n');
    expect(() => assertProductReleaseBuildIdentity({ root, release })).toThrow(/package_lock_sha256/);
    fs.writeFileSync(path.join(root, 'package-lock.json'), DELIVERED['package-lock.json']);

    // (c) the manifest names another build: every v3 field is compared file vs manifest
    for (const field of PRODUCT_RELEASE_BUILD_IDENTITY_V3_FIELDS) {
      const other = await signedV3({ ...identity.build_identity, [field]: /sha$/.test(field) ? 'f'.repeat(40) : 'f'.repeat(64) });
      expect(() => assertProductReleaseBuildIdentity({ root, release: other }), field).toThrow(new RegExp(field));
    }

    // (d) the identity file itself was edited after the build: file vs manifest AND measurement
    const file = path.join(root, RELEASE_IDENTITY_FILE_NAME);
    fs.writeFileSync(file, JSON.stringify({ ...identity, build_identity: { ...identity.build_identity, build_args_sha256: 'e'.repeat(64) } }));
    expect(() => assertProductReleaseBuildIdentity({ root, release })).toThrow(/build_args_sha256/);

    // (e) a v2 manifest can never be the running release
    fs.writeFileSync(file, JSON.stringify(identity));
    const v2 = createProductReleaseManifestArtifact({ product_name: 'Miljöbeslut', ...measureLegacyIdentityHashes(root), issuer_ref: issuerRef });
    expect(() => assertProductReleaseBuildIdentity({ root, release: v2 })).toThrow(/REJECT_PRODUCT_RELEASE_BUILD_MISMATCH[\s\S]*contract_version/);

    // (f) no identity file at all
    fs.rmSync(file);
    expect(() => assertProductReleaseBuildIdentity({ root, release })).toThrow(ProductReleaseIdentityUnavailableError);
  });
});

describe('assertProductReleaseIdentityAtStartup: the process start-up gate', () => {
  const logs: { message: string; context: Record<string, unknown> }[] = [];
  const log = (message: string, context: Record<string, unknown>) => void logs.push({ message, context });
  beforeEach(() => {
    logs.length = 0;
    resetRunningProductReleaseForTests();
  });

  async function startup(env: Record<string, string | undefined>, root: string, repo?: InMemoryArtifactRepository) {
    return assertProductReleaseIdentityAtStartup({
      role: 'web',
      env: env as NodeJS.ProcessEnv,
      root,
      log,
      createArtifactRepository: async () => {
        if (!repo) throw new Error('the gate must not open a repository when it has nothing to compare');
        return repo;
      },
    });
  }

  it('explicit development/test process without identity file and without PRODUCT_RELEASE_ARTIFACT_ID -> starts without identity, says so', async () => {
    const root = tmp('startup-dev');
    writeTree(root, DELIVERED);
    for (const env of [{ NODE_ENV: 'development', APP_ENV: 'development' }, { NODE_ENV: 'test', APP_ENV: 'test' }]) {
      logs.length = 0;
      resetRunningProductReleaseForTests();
      await expect(startup(env, root)).resolves.toBeNull();
      expect(getRunningProductRelease()).toBeNull();
      expect(logs).toHaveLength(1);
      expect(logs[0].context).toMatchObject({ process_role: 'web', release_identity: 'none' });
    }
  });

  it.each([
    ['production, both set', { NODE_ENV: 'production', APP_ENV: 'production' }],
    ['development with APP_ENV unset (the worktree runtime)', { NODE_ENV: 'development' }],
    ['test with APP_ENV unset', { NODE_ENV: 'test' }],
    ['nothing set', {}],
    ['staging', { NODE_ENV: 'production', APP_ENV: 'staging' }],
  ])('%s without identity file and release id -> refuses to start (PRODUCT_RELEASE_IDENTITY_UNAVAILABLE)', async (_label, env) => {
    const root = tmp('startup-prod');
    writeTree(root, DELIVERED);
    await expect(startup(env, root)).rejects.toMatchObject({ code: PRODUCT_RELEASE_IDENTITY_UNAVAILABLE });
    expect(getRunningProductRelease()).toBeNull();
    expect(logs).toEqual([]);
  });

  it('identity file without PRODUCT_RELEASE_ARTIFACT_ID, or the id without the file -> refuses, also in an explicit development process', async () => {
    const withFile = tmp('startup-file-only');
    writeTree(withFile, DELIVERED);
    writeIdentityViaCli(withFile);
    await expect(startup({ NODE_ENV: 'development', APP_ENV: 'development' }, withFile)).rejects.toMatchObject({ code: PRODUCT_RELEASE_IDENTITY_UNAVAILABLE });
    const withoutFile = tmp('startup-id-only');
    writeTree(withoutFile, DELIVERED);
    await expect(startup({ NODE_ENV: 'development', APP_ENV: 'development', PRODUCT_RELEASE_ARTIFACT_ID: 'product-release-x', ...RELEASE_ENV }, withoutFile)).rejects.toMatchObject({
      code: PRODUCT_RELEASE_IDENTITY_UNAVAILABLE,
    });
    expect(getRunningProductRelease()).toBeNull();
  });

  it('file + configured v3 release that match the measurement -> running identity recorded and logged without secrets', async () => {
    const root = tmp('startup-ok');
    writeTree(root, DELIVERED);
    const identity = writeIdentityViaCli(root);
    const release = await signedV3(identity.build_identity);
    const casRoot = tmp('cas');
    const env = { NODE_ENV: 'production', APP_ENV: 'production', PRODUCT_RELEASE_ARTIFACT_ID: release.artifact_id, MIMERS_ROOT: casRoot, ...RELEASE_ENV, PRODUCT_RELEASE_ISSUER_PRIVATE_KEY_PEM: 'never-logged', JWT_ACCESS_SECRET: 'never-logged' };
    const running = await startup(env, root, await repositoryWith(release));
    expect(running).not.toBeNull();
    expect(running).toMatchObject({
      process_role: 'web',
      release_artifact_id: release.artifact_id,
      release_hash: release.release_hash.value,
      contract_version: 'product-release-v3',
      product_name: 'Miljöbeslut',
      build_identity: identity.build_identity,
      measured: { source_digest_sha256: identity.build_identity.source_digest_sha256 },
      cas_root: casRoot,
    });
    expect(getRunningProductRelease()).toEqual(running);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({
      process_role: 'web',
      release_artifact_id: release.artifact_id,
      release_hash: release.release_hash.value,
      source_digest_sha256: identity.build_identity.source_digest_sha256,
      cas_root: casRoot,
    });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toMatch(/never-logged/);
    expect(serialized).not.toMatch(/PRIVATE|SECRET|PASSWORD|PEM/);
    expect(serialized).not.toMatch(/authentic|äkthet|verified/i);
  });

  it('a deviation between the delivered files and the configured release -> REJECT_PRODUCT_RELEASE_BUILD_MISMATCH, nothing recorded', async () => {
    const root = tmp('startup-mismatch');
    writeTree(root, DELIVERED);
    const identity = writeIdentityViaCli(root);
    const release = await signedV3(identity.build_identity);
    fs.appendFileSync(path.join(root, 'dist', 'assets', 'app.js'), 'console.log(2)\n');
    const env = { NODE_ENV: 'production', APP_ENV: 'production', PRODUCT_RELEASE_ARTIFACT_ID: release.artifact_id, ...RELEASE_ENV };
    await expect(startup(env, root, await repositoryWith(release))).rejects.toMatchObject({ code: REJECT_PRODUCT_RELEASE_BUILD_MISMATCH });
    expect(getRunningProductRelease()).toBeNull();
    expect(logs).toEqual([]);
  });

  it('a configured v2 release (the pre-v3 ceremonies) can never start a process under v3', async () => {
    const root = tmp('startup-v2');
    writeTree(root, DELIVERED);
    writeIdentityViaCli(root);
    const unsigned = createProductReleaseManifestArtifact({ product_name: 'Miljöbeslut', ...measureLegacyIdentityHashes(root), issuer_ref: issuerRef });
    const v2 = { ...unsigned, attestation: await attestProductRelease({ release: unsigned, issuer, signing: keys.provider }) };
    const env = { NODE_ENV: 'production', APP_ENV: 'production', PRODUCT_RELEASE_ARTIFACT_ID: v2.artifact_id, ...RELEASE_ENV };
    await expect(startup(env, root, await repositoryWith(v2))).rejects.toMatchObject({ code: REJECT_PRODUCT_RELEASE_BUILD_MISMATCH });
    expect(getRunningProductRelease()).toBeNull();
  });
});

describe('R8 and forward-only pins on the sources', () => {
  const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

  it('nothing in the release identity surface reads an identity from process.cwd()', () => {
    const files = [
      ...fs.readdirSync(path.join(REPO_ROOT, 'server', 'modules', 'release')).map((f) => `server/modules/release/${f}`),
      ...fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'release')).map((f) => `scripts/release/${f}`),
      'scripts/ops/bootstrap-product-release-authority.ts',
    ];
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(read(file), file).not.toMatch(/process\.cwd\(\)/);
      expect(read(file), file).not.toMatch(/readFile(Sync)?\(\s*["'](package-lock\.json|package\.json|server\/index\.ts)["']/);
    }
  });

  it('the ceremony script issues v3 from the measured release-identity.json of its own repository root, never a v2 from cwd files', () => {
    const src = read('scripts/ops/bootstrap-product-release-authority.ts');
    expect(src).toMatch(/createProductReleaseManifestArtifactV3\(/);
    expect(src).not.toMatch(/createProductReleaseManifestArtifact\(/);
    expect(src).toMatch(/readReleaseIdentityFile|release-identity\.json/);
    expect(src).toMatch(/measureDeliveredBuildIdentity|assertProductReleaseBuildIdentity/);
  });
});
