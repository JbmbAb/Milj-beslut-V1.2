// @vitest-environment node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  findStage,
  instructionShellText,
  parseDockerfile,
  splitDockerfileWords,
  type ParsedDockerfile,
  type ParsedInstruction,
  type ParsedStage,
} from '../../packages/mps-pattern-proof/src/docker/dockerfile-parse';
import {
  createProductReleaseIssuerArtifact,
  createProductReleaseManifestArtifactV3,
} from '../../packages/mps-governance/src/release/ProductReleaseAuthority';
import {
  REJECT_PRODUCT_RELEASE_BUILD_MISMATCH,
  RELEASE_IDENTITY_FILE_NAME,
  assertProductReleaseBuildIdentity,
  readReleaseIdentityFile,
  type ReleaseIdentityFile,
} from '../../server/modules/release/productReleaseBuildIdentity';
import { DELIVERED_ROOT_EXCLUSIONS } from '../../scripts/release/buildIdentityDigest.mjs';

/**
 * W-U42B (owner decision Round 21, alternative (a)) -- the build recipe EXECUTED AS A MODEL, without Docker:
 * release-identity.json must describe exactly the /app the runtime image delivers.
 *
 * The repository's own Dockerfile is interpreted instruction by instruction over a small model of the build context
 * (the `git archive <SHA>` that deploy/onprem/build-image.sh streams): COPY (from the context and --from a stage, with
 * the Docker rules for directories, globs and destinations), ARG/ENV scoping per stage, and every RUN through a closed
 * table of modelled effects (`npm ci` installs, `npm run build` writes dist/, `npm prune` rewrites the lock file, ...).
 * An instruction or RUN the table does not know fails the model instead of being ignored. The identity RUN is not
 * modelled: it EXECUTES the real scripts/release/write-build-identity.mjs (copied into the model context) over the
 * stage's file tree at that point, with the stage's own ARG/ENV values. Each final target's delivered /app is then
 * checked with the real start-up verification (assertProductReleaseBuildIdentity -- the check every product process
 * runs; only the CAS resolution of the signed manifest is left out).
 *
 * R-U402-14 (the defect this pins): the builder measured its own tree -- components/ and the lock file `npm prune`
 * rewrote -- while production-base delivers the context's lock file and no components/; every product process refused
 * to start on an UNTOUCHED image with REJECT_PRODUCT_RELEASE_BUILD_MISMATCH.
 *
 * W-U42C (owner decision Round 22, ÄF-U42B-2): every path the recipe delivers to /app is measured or explicitly
 * excluded -- decided file by file with the real start-up check over the modelled /app (R4), also for an injected
 * future COPY; a delivery outside /app or into an excluded path is reported, never silently unmeasured.
 *
 * Context model: build-image.sh pipes the archive to `docker build -`, which BuildKit loads as a remote context
 * ("load remote build context" / "copy /context /" in the U40-2 build log) WITHOUT applying .dockerignore -- the
 * builder measured the composition from /app/Dockerfile, /app/.dockerignore and /app/deploy/onprem (U40-2 P1:
 * composition source "measured", 8 files). The model therefore streams the context whole, composition files included.
 *
 * Hermetic: temporary directories under os.tmpdir(), child `node` processes for the real CLI. No Docker, no network,
 * no database, no CAS.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readRepo = (rel: string): Buffer => fs.readFileSync(path.join(REPO_ROOT, ...rel.split('/')));
const DOCKERFILE_TEXT = readRepo('Dockerfile').toString('utf8').replace(/\r\n/g, '\n');
const PARSED = parseDockerfile(DOCKERFILE_TEXT);
const FINAL_TARGETS = ['web', 'gdpr-worker', 'search-indexer-worker', 'domstol-rss-worker'] as const;
const IDENTITY_SCRIPT = 'scripts/release/write-build-identity.mjs';
const RELEASE_SCRIPTS = [IDENTITY_SCRIPT, 'scripts/release/buildIdentityDigest.mjs'] as const;
const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

const tempDirs: string[] = [];
function tmp(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `u42b-${label}-`));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A file tree: posix path (relative to /app, or to the context root) -> bytes. */
type Tree = Map<string, Buffer>;

function materialize(tree: Tree, label: string): string {
  const dir = tmp(label);
  for (const [rel, bytes] of tree) {
    const full = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
  }
  return dir;
}

/** The child `node` the real identity CLI runs in: the stage's ARG/ENV values, nothing of the host but what node needs. */
function runNode(script: string, args: readonly string[], cwd: string, env: Record<string, string>) {
  const hostNeeds: Record<string, string | undefined> = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };
  return spawnSync(process.execPath, [script, ...args], { cwd, env: { ...hostNeeds, ...env }, encoding: 'utf8' });
}

// ---- the build context: a small model of `git archive <SHA>` (tracked files only: no dist/, no node_modules/) ----

const CONTEXT_LOCK = '{"name":"model","lockfileVersion":3,"packages":{"":{},"node_modules/dev-only":{"dev":true},"node_modules/dep":{}}}\n';
const PRUNED_LOCK = '{"name":"model","lockfileVersion":3,"packages":{"":{},"node_modules/dep":{"peer":false}}}\n';

function contextTree(dockerfileText: string, extra: Readonly<Record<string, string>>): Tree {
  const text: Record<string, string> = {
    'package.json': '{"name":"model","version":"0.0.0","scripts":{"start":"node --import tsx server/index.ts"}}\n',
    'package-lock.json': CONTEXT_LOCK,
    'tsconfig.json': '{"compilerOptions":{}}\n',
    'server/index.ts': "import './loadEnvFirst';\n",
    'server/loadEnvFirst.ts': 'export {};\n',
    'server/workers/lu-geometry-supersession-worker.ts': 'worker\n',
    'src/main.tsx': 'main\n',
    'packages/mps-lu/package.json': '{"name":"@miljobeslut/mps-lu"}\n',
    'packages/mps-lu/src/index.ts': 'lu\n',
    'prisma/schema.prisma': 'datasource db {}\n',
    'components/App.tsx': 'built into dist/, not delivered as source\n',
    'components/map/Layer.tsx': 'built into dist/, not delivered as source\n',
    'services/propertyService.ts': 'svc\n',
    'scripts/postinstall-prisma-generate.mjs': 'postinstall\n',
    'app/page.ts': 'app\n',
    'config/database.ts': 'cfg\n',
    'types/index.d.ts': 'types\n',
    'stubs/empty.ts': 'stub\n',
    'db.server.ts': 'db\n',
    'constants.ts': 'constants\n',
    'public/cesium/Widgets/widgets.css': 'public\n',
    'docs/readme.md': 'docs\n',
    'tests/unit/x.test.ts': 'test\n',
    '.dockerignore': readRepo('.dockerignore').toString('utf8').replace(/\r\n/g, '\n'),
    'deploy/onprem/build-image.sh': '#!/bin/sh\n',
    Dockerfile: dockerfileText,
    ...extra,
  };
  const tree: Tree = new Map(Object.entries(text).map(([k, v]) => [k, Buffer.from(v, 'utf8')]));
  // the REAL measurement code, as the commit carries it
  for (const rel of RELEASE_SCRIPTS) tree.set(rel, readRepo(rel));
  return tree;
}

/** build-image.sh: `write-build-identity.mjs --root <export of Dockerfile .dockerignore deploy/onprem> --print composition`. */
function declaredComposition(context: Tree): string {
  const only: Tree = new Map([...context].filter(([rel]) => rel === 'Dockerfile' || rel === '.dockerignore' || rel.startsWith('deploy/onprem/')));
  const dir = materialize(only, 'composition');
  const r = runNode(path.join(REPO_ROOT, IDENTITY_SCRIPT), ['--root', dir, '--print', 'composition'], dir, {});
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

// ---- the model interpreter ----

class RecipeModelError extends Error {
  constructor(instruction: ParsedInstruction, reason: string) {
    super(`Dockerfile:${instruction.line} ${instruction.keyword} ${instruction.args}: ${reason}`);
  }
}

/**
 * `owners`: the user that owns a path under /app when it is not root ('' = the /app directory itself, a directory
 * such as 'storage' for an empty directory a RUN created). Absent = root:root, which is what COPY/ADD without
 * --chown and every RUN as root produce (W-U42C IN-5).
 */
type StageState = { tree: Tree; env: Map<string, string>; owners: Map<string, string> };
type Build = {
  /** the Dockerfile interpreted (the repository's own, or one with an injected instruction) */
  readonly parsed: ParsedDockerfile;
  readonly context: Tree;
  readonly buildArgs: Readonly<Record<string, string>>;
  readonly stages: Map<string, StageState>;
  /** every identity RUN the recipe executed: stage, line, the CLI's stdout */
  readonly identityRuns: { stage: string; line: number; stdout: string }[];
};

const hasGlob = (s: string) => /[*?[]/.test(s);
const join = (a: string, b: string) => (a === '' ? b : b === '' ? a : `${a}/${b}`);
function globRegExp(segment: string): RegExp {
  return new RegExp(`^${segment.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
}

/** A COPY source or destination as a path relative to /app (WORKDIR) or to the context root. */
function appRelative(ins: ParsedInstruction, p: string, absoluteOnly: boolean): string {
  let rel: string;
  if (p.startsWith('/')) {
    if (p === '/app' || p === '/app/') rel = '';
    else if (p.startsWith('/app/')) rel = p.slice('/app/'.length);
    else throw new RecipeModelError(ins, `path ${p} outside /app is not modelled`);
  } else {
    if (absoluteOnly) throw new RecipeModelError(ins, `a --from source must be absolute (${p})`);
    rel = p === '.' || p === './' ? '' : p.replace(/^\.\//, '');
  }
  return rel.replace(/\/+$/, '').replace(/\/\.$/, '');
}

/** The entries a COPY source names in `src`: a file, a directory (its contents are copied), or glob matches. */
function expand(src: Tree, rel: string): { kind: 'file' | 'dir'; rel: string }[] {
  const kindOf = (r: string): 'file' | 'dir' | null => {
    if (r === '') return 'dir';
    if (src.has(r)) return 'file';
    for (const k of src.keys()) if (k.startsWith(`${r}/`)) return 'dir';
    return null;
  };
  if (!hasGlob(rel)) {
    const kind = kindOf(rel);
    return kind ? [{ kind, rel }] : [];
  }
  const slash = rel.lastIndexOf('/');
  const dir = slash < 0 ? '' : rel.slice(0, slash);
  if (hasGlob(dir)) throw new Error(`glob in a directory segment is not modelled (${rel})`);
  const re = globRegExp(rel.slice(slash + 1));
  const names = new Set<string>();
  for (const k of src.keys()) {
    if (dir !== '' && !k.startsWith(`${dir}/`)) continue;
    const name = (dir === '' ? k : k.slice(dir.length + 1)).split('/')[0];
    if (re.test(name)) names.add(name);
  }
  return [...names].sort().map((name) => ({ kind: kindOf(join(dir, name))!, rel: join(dir, name) }));
}

function copy(build: Build, ins: ParsedInstruction, state: StageState): void {
  if (ins.args.trim().startsWith('[')) throw new RecipeModelError(ins, 'exec-form COPY is not modelled');
  const words = splitDockerfileWords(ins.args);
  if (words.length < 2) throw new RecipeModelError(ins, 'COPY needs a source and a destination');
  const destRaw = words[words.length - 1];
  const sources = words.slice(0, -1);
  const from = ins.flags.from;
  const src: Tree = from === undefined ? build.context : buildStage(build, from).tree;
  const dest = appRelative(ins, destRaw, false);
  const destIsDir = destRaw.endsWith('/') || destRaw === '.' || sources.length > 1 || sources.some(hasGlob);
  // --chown=<user>[:<group>] makes the copied files that user's; without it they are root:root
  const owner = ins.flags.chown === undefined ? null : ins.flags.chown.split(':')[0];
  const put = (p: string, bytes: Buffer) => {
    state.tree.set(p, bytes);
    if (owner === null || owner === 'root' || owner === '0') state.owners.delete(p);
    else state.owners.set(p, owner);
  };
  for (const source of sources) {
    const matches = expand(src, appRelative(ins, source, from !== undefined));
    if (matches.length === 0) throw new RecipeModelError(ins, `source ${source} does not exist${from ? ` in stage ${from}` : ' in the context'} (the build fails)`);
    for (const m of matches) {
      if (m.kind === 'file') {
        put(destIsDir ? join(dest, path.posix.basename(m.rel)) : dest, src.get(m.rel)!);
        continue;
      }
      for (const [p, bytes] of src) {
        if (m.rel !== '' && !p.startsWith(`${m.rel}/`)) continue;
        put(join(dest, m.rel === '' ? p : p.slice(m.rel.length + 1)), bytes);
      }
    }
  }
}

function substitute(text: string, env: Map<string, string>): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a: string | undefined, b: string | undefined) => env.get((a ?? b)!) ?? '');
}

/** The closed table of modelled RUN effects; the identity RUN executes the real CLI instead (see runIdentity). */
const RUN_EFFECTS: readonly { readonly match: RegExp; readonly apply: (tree: Tree, owners: Map<string, string>) => void }[] = [
  // the base image's packages and user: nothing under /app
  { match: /^apk update && apk add --no-cache\b/, apply: () => {} },
  { match: /^addgroup -S appgroup && adduser -S appuser -G appgroup$/, apply: () => {} },
  // owner of /app only (no -R): no bytes change, but appuser may then create, rename and remove entries in /app
  { match: /^chown appuser:appgroup \/app$/, apply: (_t, owners) => void owners.set('', 'appuser') },
  // W-U42C IN-5: the one writable runtime directory, created empty and owned by the process user
  { match: /^mkdir \/app\/storage && chown appuser:appgroup \/app\/storage$/, apply: (_t, owners) => void owners.set('storage', 'appuser') },
  {
    match: /^npm ci\b/,
    apply: (t) => {
      t.set('node_modules/dep/index.js', Buffer.from('dep\n'));
      t.set('node_modules/dev-only/index.js', Buffer.from('dev dependency\n'));
    },
  },
  {
    match: /^npm run postinstall$/,
    apply: (t) => {
      t.set('node_modules/.prisma/client/index.js', Buffer.from('generated\n'));
      t.set('public/cesium/Cesium.js', Buffer.from('cesium assets\n'));
    },
  },
  {
    match: /^npm run build$/,
    apply: (t) => {
      const app = Buffer.concat([...t].filter(([p]) => p.startsWith('src/') || p.startsWith('components/')).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, b]) => b));
      t.set('dist/index.html', Buffer.from('<html></html>\n'));
      t.set('dist/assets/app.js', Buffer.from(`/* ${sha256(app)} */\n`));
    },
  },
  {
    // U40-A F1: npm prune --omit=dev rewrites the lock file
    match: /^npm prune --omit=dev\b/,
    apply: (t) => {
      for (const p of [...t.keys()]) if (p.startsWith('node_modules/dev-only/')) t.delete(p);
      t.set('package-lock.json', Buffer.from(PRUNED_LOCK));
    },
  },
];

function runIdentity(build: Build, ins: ParsedInstruction, stage: ParsedStage, state: StageState): void {
  const words = splitDockerfileWords(substitute(instructionShellText(ins), state.env));
  if (words[0] !== 'node' || words[1] !== IDENTITY_SCRIPT) throw new RecipeModelError(ins, 'the identity RUN must be `node scripts/release/write-build-identity.mjs ...`');
  if (!state.tree.has(IDENTITY_SCRIPT)) throw new RecipeModelError(ins, `${IDENTITY_SCRIPT} is not in the stage (the RUN fails)`);
  const dir = materialize(state.tree, `run-${stage.name}`);
  const before = new Set(state.tree.keys());
  const r = runNode(path.join(dir, ...IDENTITY_SCRIPT.split('/')), words.slice(2), dir, Object.fromEntries(state.env));
  if (r.status !== 0) throw new RecipeModelError(ins, `the identity script failed (the build fails): ${r.stderr.trim()}`);
  state.tree.set(RELEASE_IDENTITY_FILE_NAME, fs.readFileSync(path.join(dir, RELEASE_IDENTITY_FILE_NAME)));
  state.owners.delete(RELEASE_IDENTITY_FILE_NAME); // a RUN runs as root unless a USER came before it (pinned in the recipe test)
  // the script writes exactly one file
  const written = listFiles(dir).filter((rel) => !before.has(rel));
  expect(written, 'the identity RUN writes release-identity.json and nothing else').toEqual([RELEASE_IDENTITY_FILE_NAME]);
  build.identityRuns.push({ stage: stage.name, line: ins.line, stdout: r.stdout.trim() });
}

function listFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, ...rel.split('/').filter(Boolean)), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

function parseEnv(ins: ParsedInstruction): [string, string][] {
  const words = splitDockerfileWords(ins.args);
  if (words.length > 0 && !words[0].includes('=')) return [[words[0], words.slice(1).join(' ')]];
  return words.map((w) => {
    const i = w.indexOf('=');
    if (i <= 0) throw new RecipeModelError(ins, `malformed ENV pair ${w}`);
    return [w.slice(0, i), w.slice(i + 1)] as [string, string];
  });
}

function buildStage(build: Build, ref: string): StageState {
  const stage = findStage(build.parsed, ref);
  if (!stage) throw new Error(`stage ${ref} is not in the Dockerfile`);
  const done = build.stages.get(stage.name);
  if (done) return done;
  const parent = stage.from.parentStage ? buildStage(build, stage.from.parentStage) : null;
  // FROM a parent stage: its files and ENV; ARGs never cross a FROM
  const state: StageState = { tree: new Map(parent?.tree ?? []), env: new Map(parent?.env ?? []), owners: new Map(parent?.owners ?? []) };
  for (const ins of stage.instructions.slice(1)) {
    switch (ins.keyword) {
      case 'WORKDIR':
        if (ins.args.trim() !== '/app') throw new RecipeModelError(ins, 'the model knows WORKDIR /app only');
        break;
      case 'ARG': {
        const [name, ...rest] = ins.args.trim().split('=');
        state.env.set(name, build.buildArgs[name] ?? (rest.length > 0 ? rest.join('=') : ''));
        break;
      }
      case 'ENV':
        for (const [k, v] of parseEnv(ins)) state.env.set(k, substitute(v, state.env));
        break;
      case 'USER':
      case 'EXPOSE':
      case 'CMD':
      case 'LABEL':
        break;
      case 'COPY':
        copy(build, ins, state);
        break;
      case 'RUN': {
        if (instructionShellText(ins).includes(IDENTITY_SCRIPT)) {
          runIdentity(build, ins, stage, state);
          break;
        }
        const text = instructionShellText(ins).trim();
        const effect = RUN_EFFECTS.find((e) => e.match.test(text));
        if (!effect) throw new RecipeModelError(ins, 'RUN not in the model table (add its effect on /app deliberately)');
        effect.apply(state.tree, state.owners);
        break;
      }
      default:
        throw new RecipeModelError(ins, 'instruction not modelled');
    }
  }
  build.stages.set(stage.name, state);
  return state;
}

function newBuild(dockerfileText: string = DOCKERFILE_TEXT, extraContext: Readonly<Record<string, string>> = {}): Build {
  const context = contextTree(dockerfileText, extraContext);
  const buildArgs = { SOURCE_COMMIT_SHA: 'c'.repeat(40), SOURCE_TREE_SHA: 'd'.repeat(40), COMPOSITION_MANIFEST_SHA256: declaredComposition(context) };
  const parsed = dockerfileText === DOCKERFILE_TEXT ? PARSED : parseDockerfile(dockerfileText);
  return { parsed, context, buildArgs, stages: new Map(), identityRuns: [] };
}

/** The start-up check every product process runs (CAS resolution of the signed manifest left out): null = accepted. */
const issuer = createProductReleaseIssuerArtifact('ed25519:u42b-recipe-model');
function startupRefusal(root: string, identity: ReleaseIdentityFile): string | null {
  const release = createProductReleaseManifestArtifactV3({
    product_name: 'Miljöbeslut',
    build_identity: identity.build_identity,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
  });
  try {
    assertProductReleaseBuildIdentity({ root, release, identity });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The identity the real CLI writes over a tree (any release-identity.json in it removed first). */
function identityOver(tree: Tree, build: Build, label: string): ReleaseIdentityFile {
  const t: Tree = new Map(tree);
  t.delete(RELEASE_IDENTITY_FILE_NAME);
  const dir = materialize(t, label);
  const a = build.buildArgs;
  const r = runNode(path.join(dir, ...IDENTITY_SCRIPT.split('/')), ['--source-commit', a.SOURCE_COMMIT_SHA, '--source-tree', a.SOURCE_TREE_SHA, '--composition-manifest-sha256', a.COMPOSITION_MANIFEST_SHA256], dir, {});
  expect(r.status, r.stderr).toBe(0);
  return readReleaseIdentityFile(dir)!;
}

describe('the build recipe as a model: the identity the Dockerfile writes verifies against the /app it delivers (W-U42B)', () => {
  it('model premises: the builder tree holds components/ and the lock file npm prune rewrote; the context lock is the commit\'s', () => {
    const build = newBuild();
    const builder = buildStage(build, 'builder').tree;
    expect([...builder.keys()].some((p) => p.startsWith('components/')), 'the builder copies the whole context (COPY . .)').toBe(true);
    expect(builder.get('package-lock.json')!.toString('utf8'), 'npm prune rewrote the lock file in the builder').toBe(PRUNED_LOCK);
    expect(build.context.get('package-lock.json')!.toString('utf8')).toBe(CONTEXT_LOCK);
    expect(builder.has('dist/assets/app.js'), 'npm run build wrote dist/').toBe(true);
  });

  it('the recipe runs the identity script exactly once, in production-base (the stage every final target is built on)', () => {
    const build = newBuild();
    for (const target of FINAL_TARGETS) buildStage(build, target);
    expect(build.identityRuns.map((r) => r.stage), 'identity RUNs executed while building every final target').toEqual(['production-base']);
  });

  it.each(FINAL_TARGETS)('%s: the UNTOUCHED delivered /app passes the start-up measurement (no REJECT_PRODUCT_RELEASE_BUILD_MISMATCH)', (target) => {
    const build = newBuild();
    const delivered = buildStage(build, target).tree;
    const root = materialize(delivered, `delivered-${target}`);
    const identity = readReleaseIdentityFile(root);
    expect(identity, `${target} delivers ${RELEASE_IDENTITY_FILE_NAME}`).not.toBeNull();
    expect(identity!.build_identity.source_commit_sha).toBe(build.buildArgs.SOURCE_COMMIT_SHA);
    expect(identity!.build_identity.source_tree_sha).toBe(build.buildArgs.SOURCE_TREE_SHA);
    expect(identity!.build_identity.composition_manifest_sha256).toBe(build.buildArgs.COMPOSITION_MANIFEST_SHA256);
    expect(startupRefusal(root, identity!), `${target}: the image as built must start`).toBeNull();
  });

  it('the identity describes the delivered files: no components/, the commit\'s lock file, the counted files are the delivered ones', () => {
    const build = newBuild();
    const delivered = buildStage(build, 'web').tree;
    const root = materialize(delivered, 'delivered-facts');
    const identity = readReleaseIdentityFile(root)!;
    expect([...delivered.keys()].filter((p) => p.startsWith('components/')), 'components/ is not delivered').toEqual([]);
    expect(delivered.get('package-lock.json')!.toString('utf8'), 'F1: the delivered lock file is the context\'s (the commit\'s)').toBe(CONTEXT_LOCK);
    expect(identity.build_identity.package_lock_sha256, 'the identity names the DELIVERED lock file').toBe(sha256(CONTEXT_LOCK));
    // ändrad semantik enligt ÄF-U42B-2 (W-U42C): counted over the whole delivered /app, not over six roots
    const measurement = identity.measurement as { source_digest?: { scope?: string; file_count?: number; symlink_count?: number } };
    expect(measurement.source_digest?.scope, 'measured over the whole delivered root').toBe('delivered-root');
    expect(measurement.source_digest?.file_count, 'every delivered file but the identity itself').toBe(delivered.size - 1);
    expect(measurement.source_digest?.symlink_count).toBe(0);
  });

  it('control: an identity measured over the builder tree does NOT verify against the delivered /app; one measured over the delivered /app does', () => {
    const build = newBuild();
    const builderModel = buildStage(build, 'builder').tree;
    const deliveredModel = buildStage(build, 'web').tree;
    const root = materialize(new Map([...deliveredModel].filter(([p]) => p !== RELEASE_IDENTITY_FILE_NAME)), 'delivered-control');
    const fromBuilder = identityOver(builderModel, build, 'builder-model');
    const fromDelivered = identityOver(deliveredModel, build, 'delivered-model');
    const refusal = startupRefusal(root, fromBuilder);
    expect(refusal).toContain(REJECT_PRODUCT_RELEASE_BUILD_MISMATCH);
    expect(refusal).toContain('source_digest_sha256');
    expect(refusal).toContain('package_lock_sha256');
    expect(startupRefusal(root, fromDelivered)).toBeNull();
  });

  it('manipulation: one changed delivered file (the identity file untouched) -> REJECT_PRODUCT_RELEASE_BUILD_MISMATCH', () => {
    const build = newBuild();
    const delivered = new Map(buildStage(build, 'web').tree);
    const identityBytes = delivered.get(RELEASE_IDENTITY_FILE_NAME)!;
    delivered.set('server/index.ts', Buffer.concat([delivered.get('server/index.ts')!, Buffer.from('// changed after the build\n')]));
    const root = materialize(delivered, 'manipulated');
    expect(fs.readFileSync(path.join(root, RELEASE_IDENTITY_FILE_NAME)).equals(identityBytes)).toBe(true);
    const refusal = startupRefusal(root, readReleaseIdentityFile(root)!);
    expect(refusal).toContain(REJECT_PRODUCT_RELEASE_BUILD_MISMATCH);
    expect(refusal).toContain('runtime_entrypoint_sha256');
  });
});

// ---- W-U42C IN-1: coverage of everything production-base delivers ----

/** The repository Dockerfile with `line` inserted in production-base just before the identity build args (= before the measurement). */
function withInstructionBeforeMeasurement(line: string): string {
  const marker = /^ARG SOURCE_COMMIT_SHA$/m;
  expect(marker.test(DOCKERFILE_TEXT), 'production-base declares the identity build args').toBe(true);
  return DOCKERFILE_TEXT.replace(marker, `${line}\nARG SOURCE_COMMIT_SHA`);
}

/**
 * Every path the target delivers to /app whose one-byte change the start-up measurement does NOT see, plus every
 * delivered path under an explicit exclusion (an exclusion is for runtime state, never for delivered files). Empty =
 * covered. The real measurement and start-up check decide, file by file, over the materialized /app.
 */
function uncoveredDeliveries(build: Build, target: string): string[] {
  const delivered = buildStage(build, target).tree;
  const root = materialize(delivered, `coverage-${target}`);
  const identity = readReleaseIdentityFile(root);
  expect(identity, `${target} delivers ${RELEASE_IDENTITY_FILE_NAME}`).not.toBeNull();
  expect(startupRefusal(root, identity!), `control: ${target}'s untouched /app verifies`).toBeNull();
  const exclusions = Object.keys(DELIVERED_ROOT_EXCLUSIONS ?? {}).filter((name) => name !== RELEASE_IDENTITY_FILE_NAME);
  const out: string[] = [];
  for (const rel of [...delivered.keys()].sort()) {
    if (rel === RELEASE_IDENTITY_FILE_NAME) continue;
    const excludedBy = exclusions.find((name) => rel === name || rel.startsWith(`${name}/`));
    if (excludedBy !== undefined) {
      out.push(`${rel} (delivered into the excluded ${excludedBy})`);
      continue;
    }
    const file = path.join(root, ...rel.split('/'));
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.concat([original, Buffer.from(' ')]));
    if (startupRefusal(root, identity!) === null) out.push(rel);
    fs.writeFileSync(file, original);
  }
  return out;
}

describe('W-U42C IN-1: every path production-base delivers to /app is measured or explicitly excluded', () => {
  it.each(FINAL_TARGETS)('R4 %s: one changed byte in ANY delivered file is REJECT_PRODUCT_RELEASE_BUILD_MISMATCH (services/, scripts/, app/, config/, types/, stubs/, root *.ts, tsconfig.json, node_modules/ ...)', (target) => {
    const build = newBuild();
    const delivered = buildStage(build, target).tree;
    // the model delivers what the briefing lists (the test cannot pass vacuously)
    for (const p of ['services/propertyService.ts', 'scripts/release/buildIdentityDigest.mjs', 'app/page.ts', 'config/database.ts', 'types/index.d.ts', 'stubs/empty.ts', 'db.server.ts', 'tsconfig.json', 'node_modules/dep/index.js', 'node_modules/.prisma/client/index.js']) {
      expect(delivered.has(p), `${target} delivers ${p}`).toBe(true);
    }
    expect(uncoveredDeliveries(build, target), `${target}: delivered but neither measured nor excluded`).toEqual([]);
  });

  it('R4: a NEW `COPY --from=builder /app/<new> ./<new>` is covered without touching the measurement (no list of roots to forget)', () => {
    const build = newBuild(withInstructionBeforeMeasurement('COPY --from=builder /app/plugins ./plugins'), { 'plugins/loader.ts': 'export const plugin = 1;\n' });
    expect(buildStage(build, 'web').tree.has('plugins/loader.ts'), 'the injected COPY delivers').toBe(true);
    expect(uncoveredDeliveries(build, 'web')).toEqual([]);
  });

  it('R4: a COPY that delivers files into an excluded path (the writable storage/) is reported', () => {
    const build = newBuild(withInstructionBeforeMeasurement('COPY --from=builder /app/scripts ./storage/scripts'));
    const uncovered = uncoveredDeliveries(build, 'web');
    expect(uncovered.length).toBeGreaterThan(0);
    for (const entry of uncovered) expect(entry.startsWith('storage/scripts/'), entry).toBe(true);
  });

  it('R4: a COPY whose destination lies outside /app fails the model -- it is never silently unmeasured', () => {
    const build = newBuild(withInstructionBeforeMeasurement('COPY --from=builder /app/scripts /opt/scripts'));
    expect(() => buildStage(build, 'web')).toThrow(/outside \/app is not modelled/);
  });
});

// ---- W-U42C IN-5: who owns the delivered /app (TOCTOU) ----

describe('W-U42C IN-5 (owner decision Ä1): in the modelled image every delivered path and /app itself are root-owned', () => {
  it.each(FINAL_TARGETS)('R6 %s: nothing the process user owns but the empty writable storage/ -- not /app, not a delivered file, not release-identity.json', (target) => {
    const build = newBuild();
    const state = buildStage(build, target);
    expect(state.tree.size, 'the model delivers files (the test cannot pass vacuously)').toBeGreaterThan(20);
    const notRoot = [...state.owners].map(([p, owner]) => `${p === '' ? '/app' : p} ${owner}`).sort();
    expect(notRoot, `${target}: paths not owned by root`).toEqual(['storage appuser']);
    expect([...state.tree.keys()].filter((p) => p === 'storage' || p.startsWith('storage/')), 'storage/ holds no delivered file').toEqual([]);
  });
});
