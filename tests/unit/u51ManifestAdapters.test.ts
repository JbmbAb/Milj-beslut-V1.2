/**
 * The static adapters of U51 (contract 14, step 7): subject (git objects), controller identity, dependency-manifest
 * scan, generation static facts (census reuse + OD-17), schema / parity extraction facts.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AdapterUnavailable,
  controllerIdentity,
  deriveGenerationStaticFacts,
  extractMigrationFacts,
  extractPrismaFacts,
  extractRuntimeFacts,
  filesetDigest,
  gitBlobSha1,
  gitToplevel,
  hashJcs,
  readBlobAtTree,
  scanDependencyManifests,
  stripSqlComments,
  subjectObservation,
  validateSchemaDerivation,
  U51_VERIFIER_VERSION,
} from '../../packages/mps-u51-manifest/src/index';
import { PORT_MODULE_PATH, REGISTRATION_IDENTIFIER } from '../../packages/mps-u51-generation-absence/src/index';
import { buildWorld } from '../../packages/mps-u51-manifest/tests/fixtures/u51Fixtures';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = mkdtempSync(path.join(tmpdir(), 'u51-adapters-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

function makeRepo(name: string): { dir: string; git: (...a: string[]) => string } {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  const git = (...a: string[]): string => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q');
  return { dir, git };
}
const put = (dir: string, rel: string, content: string | Buffer) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
};

describe('subject adapter: git objects, never the working tree', () => {
  const { dir, git } = makeRepo('subject');
  put(dir, 'a.txt', 'committed\n');
  put(dir, 'sub/b.txt', 'bee\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'one');
  const commit = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');

  it('resolves commit and tree', () => {
    expect(subjectObservation(dir, 'HEAD')).toEqual({ commit_sha: commit, commit_tree_sha: tree });
    expect(subjectObservation(dir, commit).commit_tree_sha).toBe(tree);
  });
  it('a dirty or emptied working copy changes nothing', () => {
    put(dir, 'a.txt', 'EDITED\n');
    rmSync(path.join(dir, 'sub'), { recursive: true });
    expect(readBlobAtTree(dir, tree, 'a.txt')?.toString('utf8')).toBe('committed\n');
    expect(readBlobAtTree(dir, tree, 'sub/b.txt')?.toString('utf8')).toBe('bee\n');
    expect(subjectObservation(dir, 'HEAD').commit_tree_sha).toBe(tree);
  });
  it('a missing path is undefined; a revision that is no commit is an unavailable adapter', () => {
    expect(readBlobAtTree(dir, tree, 'nope.txt')).toBeUndefined();
    expect(() => subjectObservation(dir, 'no-such-rev')).toThrow(AdapterUnavailable);
    expect(() => subjectObservation(dir, tree)).toThrow(AdapterUnavailable); // a tree is no commit
  });
  it('the git blob hash helper equals git hash-object', () => {
    const content = Buffer.from('hello\nworldå\n', 'utf8');
    put(dir, 'h.bin', content);
    expect(gitBlobSha1(content)).toBe(git('hash-object', 'h.bin'));
    expect(gitBlobSha1(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });
  it('gitToplevel returns the checkout and rejects a non-repository', () => {
    expect(realpathSync.native(gitToplevel(dir)).toLowerCase()).toBe(realpathSync.native(dir).toLowerCase());
    expect(() => gitToplevel(path.join(base, 'not-a-repo-' + Date.now()))).toThrow();
  });
});

describe('controller identity: the tree of a CLEAN controller checkout', () => {
  const { dir, git } = makeRepo('controller');
  put(dir, 'v.txt', 'verifier\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'v');
  it('is the HEAD tree with the verifier version label', () => {
    const id = controllerIdentity(dir);
    expect(id.implementation_tree_sha1).toBe(git('rev-parse', 'HEAD^{tree}'));
    expect(id.controller_commit_sha).toBe(git('rev-parse', 'HEAD'));
    expect(id.verifier_version).toBe(U51_VERIFIER_VERSION);
  });
  it('a modified tracked file makes the identity unavailable (the tree would not describe running code)', () => {
    put(dir, 'v.txt', 'changed\n');
    expect(() => controllerIdentity(dir)).toThrow(AdapterUnavailable);
    git('checkout', '--', 'v.txt');
    expect(() => controllerIdentity(dir)).not.toThrow();
  });
  it('an untracked file does too', () => {
    put(dir, 'extra.txt', 'x');
    expect(() => controllerIdentity(dir)).toThrow(AdapterUnavailable);
  });
  it('a directory that is no repository is unavailable', () => {
    expect(() => controllerIdentity(path.join(base, 'plain-' + Date.now()))).toThrow(AdapterUnavailable);
  });
});

describe('dependency-manifest scan (6.3)', () => {
  const pkg = (o: object) => ({ path: 'package.json', bytes: Buffer.from(JSON.stringify(o)) });
  const lock = (o: object) => ({ path: 'package-lock.json', bytes: Buffer.from(JSON.stringify(o)) });
  const policy = (patterns: string[], manifests = ['package.json']) => ({ manifests, forbidden_package_patterns: patterns });

  it('finds a forbidden package in every dependency section, case-insensitively, and counts once per (manifest, name)', () => {
    const f = scanDependencyManifests(
      [pkg({ dependencies: { 'Alpha-Lib': '1', ok: '1' }, devDependencies: { 'alpha-dev': '1' }, peerDependencies: { 'x-alpha': '1' }, optionalDependencies: { 'alpha-opt': '1' }, bundledDependencies: ['alpha-bundled'] })],
      policy(['alpha']),
    );
    expect(f.hits_count).toBe(5);
    expect(f.hits.map((h) => h.name).sort()).toEqual(['Alpha-Lib', 'alpha-bundled', 'alpha-dev', 'alpha-opt', 'x-alpha']);
  });
  it('sees an alias target of an npm: specifier', () => {
    const f = scanDependencyManifests([pkg({ dependencies: { innocent: 'npm:@scope/forbidden-thing@^1' } })], policy(['forbidden-thing']));
    expect(f.hits_count).toBe(1);
  });
  it('a clean manifest has zero hits and an empty pattern list matches nothing', () => {
    expect(scanDependencyManifests([pkg({ dependencies: { a: '1' } })], policy(['zzz'])).hits_count).toBe(0);
    expect(scanDependencyManifests([pkg({ dependencies: { a: '1' } })], policy([])).hits_count).toBe(0);
  });
  it('reads lockfile package keys (nested node_modules), names and the legacy dependency tree', () => {
    const f = scanDependencyManifests(
      [lock({ packages: { '': { name: 'root' }, 'node_modules/ok': {}, 'node_modules/a/node_modules/@s/alpha-x': {}, 'node_modules/b': { name: 'alpha-named' } }, dependencies: { 'alpha-legacy': { dependencies: { 'alpha-nested': {} } } } })],
      policy(['alpha'], ['package-lock.json']),
    );
    expect(f.hits.map((h) => h.name).sort()).toEqual(['@s/alpha-x', 'alpha-legacy', 'alpha-named', 'alpha-nested']);
  });
  it('any other manifest, or unparseable JSON, is scanned as text line by line (stricter, never looser)', () => {
    const text = { path: 'yarn.lock', bytes: Buffer.from('ok@1:\n  alpha-thing@2:\n    resolved x\n') };
    expect(scanDependencyManifests([text], policy(['alpha'], ['yarn.lock'])).hits_count).toBe(1);
    const broken = { path: 'package.json', bytes: Buffer.from('{ "dependencies": { "alpha-x": 1 ') };
    expect(scanDependencyManifests([broken], policy(['alpha'])).hits_count).toBe(1);
  });
  it('lists the manifests with their git blob sha1, hashes the pattern list, digests the set in bytewise path order', () => {
    const a = pkg({ dependencies: { a: '1' } });
    const b = lock({ packages: {} });
    const f = scanDependencyManifests([b, a], policy(['p1', 'p2'], ['package-lock.json', 'package.json']));
    expect(f.manifests).toEqual([
      { path: 'package-lock.json', blob_sha1: gitBlobSha1(b.bytes) },
      { path: 'package.json', blob_sha1: gitBlobSha1(a.bytes) },
    ]);
    expect(f.forbidden_patterns_sha256).toBe(hashJcs(['p1', 'p2']));
    expect(f.derived_digest_sha256).toBe(filesetDigest(f.manifests));
    expect(filesetDigest([...f.manifests].reverse())).toBe(f.derived_digest_sha256);
    expect(filesetDigest([{ path: 'x', blob_sha1: 'a'.repeat(40) }])).not.toBe(filesetDigest([{ path: 'x', blob_sha1: 'b'.repeat(40) }]));
  });
  it('the files must be exactly the manifests of the policy (a missing or extra manifest is not scannable)', () => {
    expect(() => scanDependencyManifests([pkg({})], policy([], ['package.json', 'package-lock.json']))).toThrow();
    expect(() => scanDependencyManifests([pkg({}), lock({})], policy([], ['package.json']))).toThrow();
  });
});

describe('generation static facts: the census is reused, including the OD-17 exception', () => {
  const { dir, git } = makeRepo('generation');
  const vendored = spawnSync('git', ['-C', ROOT, 'show', 'HEAD:public/cesium/Workers/createGeometry.js'], { maxBuffer: 1 << 26 }).stdout;
  put(dir, PORT_MODULE_PATH, 'export const port = 1;\n');
  put(dir, 'server/a.ts', 'export const a = 1;\n');
  put(dir, 'public/cesium/Workers/createGeometry.js', vendored);
  put(dir, 'tests/unit/t.test.ts', `${REGISTRATION_IDENTIFIER}();\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'g');
  const tree = git('rev-parse', 'HEAD^{tree}');

  it('port blob, the three census counts, and the exempt vendored sites in the audit part', () => {
    const f = deriveGenerationStaticFacts(dir, tree);
    expect(f.port_source_blob_sha1).toBe(git('rev-parse', `${tree}:${PORT_MODULE_PATH}`));
    expect(f.static_census).toEqual({ registration_identifier_files: 0, nonliteral_dynamic_imports: 0, test_registration_files: 1 });
    expect(f.detail.exempt_nonliteral_dynamic_import_sites).toHaveLength(2);
  });
  it('a first-party non-literal import and a changed vendored file are counted; no port file gives no blob', () => {
    put(dir, 'server/dyn.ts', 'export const f = (m: string) => import(m);\n');
    put(dir, 'public/cesium/Workers/createGeometry.js', Buffer.concat([vendored, Buffer.from('\n')]));
    git('rm', '-q', '-f', PORT_MODULE_PATH);
    git('add', '-A');
    git('commit', '-q', '-m', 'g2');
    const f = deriveGenerationStaticFacts(dir, git('rev-parse', 'HEAD^{tree}'));
    expect(f.static_census.nonliteral_dynamic_imports).toBe(3);
    expect(f.detail.exempt_nonliteral_dynamic_import_sites).toHaveLength(0);
    expect(f.port_source_blob_sha1).toBeUndefined();
  });
});

describe('schema / parity extraction facts (5.5)', () => {
  const pipelineColumns = { model_id: 'embedding_model_id', model_revision: 'embedding_model_version', pipeline_version: 'embedding_pipeline_version' };
  const options = { pipelineColumns, dimensionColumn: 'embedding_dimension' };
  const realMigration = readFileSync(path.join(ROOT, 'prisma/migrations/20261007120000_legal_corpus_chunk_embedding_local_v1/migration.sql'), 'utf8');
  const realSchema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');

  it('the real 02A migration: table, vector column, dimension CHECK and the one pinned triple', () => {
    const [t, ...rest] = extractMigrationFacts(realMigration, options);
    expect(rest).toEqual([]);
    expect(t!.table).toBe('legal_corpus_chunk_embeddings_local_v1');
    expect(t!.vector_columns).toEqual([{ column: 'embedding_vector', dimension: 1024 }]);
    expect(t!.dimension_checks).toEqual([{ name: 'lcel_v1_dimension_chk', dimension: 1024 }]);
    expect(t!.pipeline_binding_checks).toEqual([
      { name: 'lcel_v1_pipeline_binding_chk', triples: [{ model_id: 'BAAI/bge-m3', model_revision: '5617a9f61b028005a4858fdac845db406aefb181', pipeline_version: 'local-st-bge-m3-dense-v1' }] },
    ]);
  });
  it('the real Prisma schema: the model that maps to that table, with its vector column', () => {
    const facts = extractPrismaFacts(realSchema);
    const model = facts.prisma_models.find((m) => m.mapped_table === 'legal_corpus_chunk_embeddings_local_v1');
    expect(model).toEqual({ name: 'LegalCorpusChunkEmbeddingLocalV1', mapped_table: 'legal_corpus_chunk_embeddings_local_v1', vector_columns: [{ column: 'embedding_vector', declared_dimension: 1024 }] });
    // models with a vector column but without a declared dimension are reported, and carry 0 so a parity check fails closed
    const undeclared = facts.undeclared_dimension_columns.map((u) => u.model);
    expect(undeclared.length).toBeGreaterThan(0);
    for (const m of facts.prisma_models) for (const c of m.vector_columns) if (c.declared_dimension === 0) expect(undeclared).toContain(m.name);
  });
  it('the real runtime SQL of LocalEmbeddingPersistence: an INSERT into the table with a 1024 cast on the vector column', () => {
    const file = 'server/modules/legal/retrieval/LocalEmbeddingPersistence.ts';
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    const facts = extractRuntimeFacts([{ path: file, text, blob_sha1: gitBlobSha1(Buffer.from(text)) }], { embeddingTableFamily: /legal_corpus_chunk_embeddings(?:_local_v1)?(?![A-Za-z0-9_])/, vectorColumns: ['embedding_vector'] });
    expect(facts.embedding_table_references).toContain('legal_corpus_chunk_embeddings_local_v1');
    const insert = facts.statements.find((s) => s.kind === 'INSERT');
    expect(insert).toMatchObject({ table: 'legal_corpus_chunk_embeddings_local_v1', vector_columns: [{ column: 'embedding_vector', cast_dimension: 1024 }] });
  });
  it('the extracted facts fit the strict derivation schema', () => {
    const w = buildWorld();
    const payload = JSON.parse(JSON.stringify(w.observations.schema.payload));
    payload.prisma_models = extractPrismaFacts(realSchema).prisma_models;
    payload.migration.tables = extractMigrationFacts(realMigration, options);
    const text = readFileSync(path.join(ROOT, 'server/modules/legal/retrieval/LocalEmbeddingPersistence.ts'), 'utf8');
    payload.runtime_persistence = extractRuntimeFacts([{ path: 'x.ts', text, blob_sha1: gitBlobSha1(Buffer.from(text)) }], { embeddingTableFamily: /legal_corpus_chunk_embeddings(?:_local_v1)?(?![A-Za-z0-9_])/, vectorColumns: ['embedding_vector'] });
    expect(validateSchemaDerivation(payload)).toBe(true);
  });

  it('several triples (OR of AND groups) are all extracted; a CHECK missing a pinned column is not a binding check', () => {
    const sql = `CREATE TABLE "t" (
      "a" TEXT, "embedding_vector" vector(8) NOT NULL,
      CONSTRAINT "bind" CHECK (
        ("embedding_model_id" = 'm1' AND "embedding_model_version" = 'r1' AND "embedding_pipeline_version" = 'p1')
        OR ("embedding_pipeline_version" = 'p2' AND "embedding_model_id" = 'm2' AND "embedding_model_version" = 'r2')
      ),
      CONSTRAINT "partial" CHECK ("embedding_model_id" = 'm1'),
      CONSTRAINT "dim" CHECK (("embedding_dimension" = 8))
    );`;
    const [t] = extractMigrationFacts(sql, options);
    expect(t!.pipeline_binding_checks).toEqual([
      { name: 'bind', triples: [{ model_id: 'm1', model_revision: 'r1', pipeline_version: 'p1' }, { model_id: 'm2', model_revision: 'r2', pipeline_version: 'p2' }] },
    ]);
    expect(t!.dimension_checks).toEqual([{ name: 'dim', dimension: 8 }]);
  });
  it('an ALTER TABLE ADD CONSTRAINT CHECK is read; commented-out SQL is not', () => {
    const sql = `-- CREATE TABLE "ghost" ("v" vector(3));
      /* CREATE TABLE "ghost2" ("v" vector(4)); */
      CREATE TABLE "t" ("embedding_vector" vector(16) NOT NULL);
      ALTER TABLE "t" ADD CONSTRAINT "late_dim" CHECK ("embedding_dimension" = 16);`;
    const facts = extractMigrationFacts(sql, options);
    expect(facts.map((f) => f.table)).toEqual(['t']);
    expect(facts[0]!.dimension_checks).toEqual([{ name: 'late_dim', dimension: 16 }]);
    expect(stripSqlComments(`SELECT '-- not a comment' -- real\n, "a--b"`)).toBe(`SELECT '-- not a comment' \n, "a--b"`);
  });
  it('a table without a vector column yields none (nothing is invented); quoted names and escapes are handled', () => {
    const [t] = extractMigrationFacts(`CREATE TABLE "plain" ("id" TEXT NOT NULL, CONSTRAINT "c" CHECK ("embedding_model_id" = 'o''brien'));`, options);
    expect(t!.vector_columns).toEqual([]);
    expect(t!.pipeline_binding_checks).toEqual([]);
  });
  it('Prisma: @@map(name:) form, @map on the column, comments ignored, plain models without vectors omitted', () => {
    const facts = extractPrismaFacts(`
      // model Ghost { v Unsupported("vector(9)") }
      model Plain { id String @id }
      model Mapped {
        id String @id
        vec Unsupported("vector(32)") @map("vec_col")
        loose Unsupported("vector")? @map("loose_col")
        @@map(name: "mapped_tbl")
      }`);
    expect(facts.prisma_models).toEqual([{ name: 'Mapped', mapped_table: 'mapped_tbl', vector_columns: [{ column: 'loose_col', declared_dimension: 0 }, { column: 'vec_col', declared_dimension: 32 }] }]);
    expect(facts.undeclared_dimension_columns).toEqual([{ model: 'Mapped', column: 'loose_col' }]);
  });
  it('runtime: a second embedding table and a conflicting cast are surfaced, so the parity check can deny', () => {
    const text = 'const a = `SELECT 1 FROM "emb_old" WHERE v <=> $1::vector(3072)`;\nconst b = `INSERT INTO "emb_new" ("vec") VALUES ($1::vector(8), $2::vector(16))`;\nconst c = "no sql here";';
    const facts = extractRuntimeFacts([{ path: 'x.ts', text, blob_sha1: 'a'.repeat(40) }], { embeddingTableFamily: /emb_[a-z]+/, vectorColumns: ['v', 'vec'] });
    expect(facts.embedding_table_references).toEqual(['emb_new', 'emb_old']);
    expect(facts.statements.map((s) => [s.kind, s.table])).toEqual([['INSERT', 'emb_new'], ['SELECT', 'emb_old']]);
    expect(facts.statements.find((s) => s.table === 'emb_new')!.vector_columns).toEqual([{ column: 'vec', cast_dimension: 8 }, { column: 'vec', cast_dimension: 16 }]);
  });
});
