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
 *  - the builder stage runs `node scripts/release/write-build-identity.mjs` AFTER `npm run build` (dist/ is part of the
 *    digest) with the commit, tree and composition hash handed in as build args that have NO default (a build without
 *    them fails: no identity is ever guessed);
 *  - every final target carries the builder's release-identity.json;
 *  - a stale release-identity.json of a working tree never enters a build context, and the file is never tracked;
 *  - build-image.sh passes the three build args and computes the composition hash with the ONE algorithm
 *    (`write-build-identity.mjs --print composition`) over the commit's own Dockerfile, .dockerignore and deploy/onprem.
 *
 * The real build + start in a container is a separate, Docker-bound proof (no "docker go" in W-U42).
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

describe('Dockerfile: the builder measures and writes release-identity.json (W-U42)', () => {
  const builder = findStage(PARSED, 'builder')!;

  it('declares the three identity build args in the builder WITHOUT default values', () => {
    const args = builder.instructions.filter((i) => i.keyword === 'ARG').map((i) => i.args.trim());
    for (const name of BUILD_ARGS) {
      const declared = args.filter((a) => a === name || a.startsWith(`${name}=`));
      expect(declared, `ARG ${name} is declared in the builder`).toHaveLength(1);
      expect(declared[0], `ARG ${name} has no default: a build without it must fail, never guess an identity`).toBe(name);
    }
  });

  it('runs the identity script after `npm run build`, handing it exactly the three build args', () => {
    const runs = builder.instructions.filter((i) => i.keyword === 'RUN');
    const build = runs.find((i) => /\bnpm\s+run\s+build\b/.test(i.args));
    expect(build, 'the builder runs npm run build').toBeDefined();
    const identity = runs.filter((i) => i.args.includes(IDENTITY_SCRIPT));
    expect(identity, 'exactly one RUN writes the identity').toHaveLength(1);
    const [run] = identity;
    expect(run.line, 'the identity is measured over the built dist/: the script runs after npm run build').toBeGreaterThan(build!.line);
    expect(run.args).toMatch(new RegExp(`\\bnode\\s+${IDENTITY_SCRIPT.replace(/[./]/g, '\\$&')}\\b`));
    expect(run.args).toMatch(/--source-commit\s+"\$SOURCE_COMMIT_SHA"/);
    expect(run.args).toMatch(/--source-tree\s+"\$SOURCE_TREE_SHA"/);
    expect(run.args).toMatch(/--composition-manifest-sha256\s+"\$COMPOSITION_MANIFEST_SHA256"/);
    expect(run.args, 'the script decides the root from its own location; no --root from the recipe').not.toMatch(/--root\b/);
  });

  it.each(FINAL_TARGETS)('%s carries the builder-written release-identity.json (and only that one)', (target) => {
    const copies = lineage(target)
      .flatMap((s) => s.instructions)
      .filter((i) => i.keyword === 'COPY' && copySources(i).some((src) => path.posix.basename(src) === 'release-identity.json'));
    expect(copies, `${target}: one COPY of release-identity.json`).toHaveLength(1);
    expect(copies[0].flags.from, 'from the builder stage that measured it, never from the build context').toBe('builder');
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
