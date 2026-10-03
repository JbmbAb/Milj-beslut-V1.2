// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findStage, parseDockerfile, type ParsedInstruction, type ParsedStage } from '../../packages/mps-pattern-proof/src/docker/dockerfile-parse';
import { isDockerignored, parseDockerignore } from '../../packages/mps-pattern-proof/src/docker/executors';

/**
 * W-U42 (U42a, point 2) -- the build writes the release identity (U40-U50B-SPEC §1.3 step 1, §1.6 "Mätning, inte
 * deklaration"), read from the checkout and checked WITHOUT Docker:
 *
 *  - W-U42B (owner decision Round 21, alternative (a)): release-identity.json describes EXACTLY the /app the runtime
 *    image delivers. It is therefore written in `production-base`, AFTER every instruction that delivers files to /app,
 *    by `node scripts/release/write-build-identity.mjs` over the final delivered file set -- never in the builder,
 *    whose tree holds components/ and the lock file `npm prune` rewrote (R-U402-14: the builder-measured identity
 *    refused every product process on an untouched image). The commit, tree and composition hash are build args
 *    declared in production-base with NO default (a build without them fails: no identity is ever guessed);
 *  - no final target copies release-identity.json from anywhere (the measurement is the only source) and none
 *    delivers further files after it; components/ is not delivered;
 *  - a stale release-identity.json of a working tree never enters a build context, and the file is never tracked;
 *  - build-image.sh passes the three build args and computes the composition hash with the ONE algorithm
 *    (`write-build-identity.mjs --print composition`) over the commit's own Dockerfile, .dockerignore and deploy/onprem.
 *
 * The recipe executed as a model (identity written where the Dockerfile writes it, verified against what it delivers)
 * is tests/unit/releaseIdentityDeliveredTreeModel.test.ts; the real build + start in a container is the Docker-bound
 * proof (W-U42B report).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const PARSED = parseDockerfile(read('Dockerfile'));
const FINAL_TARGETS = ['web', 'gdpr-worker', 'search-indexer-worker', 'domstol-rss-worker'] as const;
const BUILD_ARGS = ['SOURCE_COMMIT_SHA', 'SOURCE_TREE_SHA', 'COMPOSITION_MANIFEST_SHA256'] as const;
const IDENTITY_SCRIPT = 'scripts/release/write-build-identity.mjs';

function lineage(stageRef: string): ParsedStage[] {
  const out: ParsedStage[] = [];
  let current = findStage(PARSED, stageRef);
  while (current) {
    out.push(current);
    current = current.from.parentStage ? findStage(PARSED, current.from.parentStage) : undefined;
  }
  return out;
}

const copySources = (i: ParsedInstruction) => i.args.trim().split(/\s+/).slice(0, -1);
const RUNTIME_STAGE = 'production-base';
/** Instructions that put files into (or change files in) the image's /app. */
const DELIVERING = new Set(['COPY', 'ADD', 'RUN']);
const identityRuns = (stage: ParsedStage) => stage.instructions.filter((i) => i.keyword === 'RUN' && i.args.includes(IDENTITY_SCRIPT));

describe('Dockerfile: production-base measures the delivered /app and writes release-identity.json (W-U42B, alternative (a))', () => {
  const builder = findStage(PARSED, 'builder')!;
  const runtime = findStage(PARSED, RUNTIME_STAGE)!;

  it('exactly one RUN in the whole Dockerfile writes the identity, and it runs in production-base, never in the builder', () => {
    expect(builder, 'the builder stage exists (the test cannot pass vacuously)').toBeDefined();
    expect(runtime, 'production-base exists').toBeDefined();
    const writers = PARSED.stages.flatMap((s) => identityRuns(s).map((i) => `${s.name}:${i.line}`));
    expect(writers, 'one identity RUN, in production-base').toHaveLength(1);
    expect(writers[0].startsWith(`${RUNTIME_STAGE}:`), `the identity is written in ${RUNTIME_STAGE}, found ${writers[0]}`).toBe(true);
    expect(identityRuns(builder), 'the builder tree (components/, the lock file npm prune rewrote) is not what the image delivers').toEqual([]);
  });

  it('declares the three identity build args in production-base WITHOUT default values, before the RUN; none in the builder', () => {
    const [run] = identityRuns(runtime);
    expect(run, 'production-base runs the identity script').toBeDefined();
    const args = runtime.instructions.filter((i) => i.keyword === 'ARG');
    for (const name of BUILD_ARGS) {
      const declared = args.filter((a) => a.args.trim() === name || a.args.trim().startsWith(`${name}=`));
      expect(declared, `ARG ${name} is declared in production-base`).toHaveLength(1);
      expect(declared[0].args.trim(), `ARG ${name} has no default: a build without it must fail, never guess an identity`).toBe(name);
      expect(declared[0].line, `ARG ${name} is declared before the RUN that uses it`).toBeLessThan(run.line);
    }
    const builderArgs = builder.instructions.filter((i) => i.keyword === 'ARG').map((i) => i.args.trim().split('=')[0]);
    for (const name of BUILD_ARGS) expect(builderArgs, `the builder no longer needs ${name}`).not.toContain(name);
  });

  it('hands the identity script exactly the three build args (no --root: the script decides the root from its own location)', () => {
    const [run] = identityRuns(runtime);
    expect(run, 'production-base runs the identity script').toBeDefined();
    expect(run.args).toMatch(new RegExp(`^node\\s+${IDENTITY_SCRIPT.replace(/[./]/g, '\\$&')}\\s`));
    expect(run.args).toMatch(/--source-commit\s+"\$SOURCE_COMMIT_SHA"/);
    expect(run.args).toMatch(/--source-tree\s+"\$SOURCE_TREE_SHA"/);
    expect(run.args).toMatch(/--composition-manifest-sha256\s+"\$COMPOSITION_MANIFEST_SHA256"/);
    expect(run.args).not.toMatch(/--root\b|--out\b/);
  });

  it('the identity is written AFTER every instruction that delivers files to /app: nothing in production-base follows it that copies, adds or runs', () => {
    const [run] = identityRuns(runtime);
    expect(run, 'production-base runs the identity script').toBeDefined();
    const delivering = runtime.instructions.filter((i) => DELIVERING.has(i.keyword) && i !== run);
    expect(delivering.length, 'production-base delivers files (the test cannot pass vacuously)').toBeGreaterThan(10);
    const after = delivering.filter((i) => i.line > run.line).map((i) => `Dockerfile:${i.line} ${i.keyword} ${i.flagsText} ${i.args}`.replace(/\s+/g, ' '));
    expect(after, 'instructions after the measurement change the delivered /app the identity describes').toEqual([]);
  });

  it.each(FINAL_TARGETS)('%s: release-identity.json comes only from that measurement -- no COPY of it from any stage or the context, and no later delivery', (target) => {
    const stages = lineage(target);
    expect(stages.map((s) => s.name)).toContain(RUNTIME_STAGE);
    const copies = stages
      .flatMap((s) => s.instructions)
      .filter((i) => (i.keyword === 'COPY' || i.keyword === 'ADD') && copySources(i).some((src) => path.posix.basename(src) === 'release-identity.json'));
    expect(copies.map((i) => `Dockerfile:${i.line}`), `${target}: the identity file is never copied in`).toEqual([]);
    // lineage() is nearest first: the stages before production-base are built ON it, i.e. after the measurement
    const builtOnTop = stages.slice(0, stages.findIndex((s) => s.name === RUNTIME_STAGE));
    const later = builtOnTop.flatMap((s) => s.instructions).filter((i) => DELIVERING.has(i.keyword));
    expect(later.map((i) => `Dockerfile:${i.line} ${i.keyword} ${i.args}`), `${target} changes /app after production-base measured it`).toEqual([]);
  });

  it('components/ is not delivered: no COPY/ADD into the runtime lineage names components or copies a whole tree', () => {
    for (const target of FINAL_TARGETS) {
      const copies = lineage(target)
        .filter((s) => s.name !== 'base')
        .flatMap((s) => s.instructions)
        .filter((i) => i.keyword === 'COPY' || i.keyword === 'ADD');
      for (const copy of copies) {
        for (const src of copySources(copy)) {
          const norm = src.replace(/\/+$/, '');
          expect(/(^|\/)components(\/|$)/.test(norm), `${target}: Dockerfile:${copy.line} delivers ${src}`).toBe(false);
          expect(['.', './', '/', '/app', '/app/.', '*', '/app/*'].includes(norm === '' ? '/' : norm), `${target}: Dockerfile:${copy.line} copies a whole tree (${src})`).toBe(false);
        }
      }
    }
  });
});

describe('.dockerignore and .gitignore: a stale identity file never enters a context and is never tracked (W-U42)', () => {
  const rules = parseDockerignore(read('.dockerignore'));
  const ignored = (p: string) => isDockerignored(rules, p);

  it('.dockerignore excludes release-identity.json and keeps the identity scripts', () => {
    expect(ignored('release-identity.json')).toBe(true);
    expect(ignored('scripts/release/write-build-identity.mjs')).toBe(false);
    expect(ignored('scripts/release/buildIdentityDigest.mjs')).toBe(false);
  });

  it('.gitignore lists release-identity.json as an exact root entry', () => {
    const lines = read('.gitignore').split('\n').map((l) => l.trim());
    expect(lines).toContain('release-identity.json');
  });
});

describe('deploy/onprem/build-image.sh: the commit identity reaches the build (W-U42)', () => {
  const script = read('deploy/onprem/build-image.sh');

  it('passes commit, tree and composition hash as build args from the commit it archives', () => {
    expect(script).toMatch(/--build-arg\s+"SOURCE_COMMIT_SHA=\$sha"/);
    expect(script).toMatch(/--build-arg\s+"SOURCE_TREE_SHA=\$tree"/);
    expect(script).toMatch(/--build-arg\s+"COMPOSITION_MANIFEST_SHA256=\$composition"/);
    expect(script).toMatch(/tree="\$\(git rev-parse "\$\{sha\}\^\{tree\}"\)"/);
  });

  it('computes the composition hash with the one algorithm over the commit\'s own composition files, not the working tree', () => {
    expect(script).toMatch(new RegExp(`node\\s+${IDENTITY_SCRIPT.replace(/[./]/g, '\\$&')}\\s+--root\\s+"\\$[a-z_]+"\\s+--print\\s+composition`));
    // the export of exactly the composition paths goes through the same archive() function (one `git archive` line)
    const archives = script.split('\n').filter((l) => /\bgit\b[^\n]*\barchive\b/.test(l) && !l.trim().startsWith('#'));
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatch(/"\$sha"\s+"\$@"/);
    expect(script).toMatch(/archive\s+Dockerfile\s+\.dockerignore\s+deploy\/onprem\s*\|\s*tar\s+-x/);
    expect(script, 'the temporary export is removed again').toMatch(/rm -rf "\$[a-z_]+"/);
    expect(script, 'the composition hash is printed with the other build facts').toMatch(/echo "composition_manifest_sha256=\$composition"/);
  });
});
