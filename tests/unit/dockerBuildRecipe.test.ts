// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  findStage,
  parseDockerfile,
  type ParsedDockerfile,
  type ParsedInstruction,
  type ParsedStage,
} from '../../packages/mps-pattern-proof/src/docker/dockerfile-parse';
import { isDockerignored, parseDockerignore } from '../../packages/mps-pattern-proof/src/docker/executors';

/**
 * U40-A2: the on-prem image build recipe -- `Dockerfile`, `.dockerignore` and
 * `deploy/onprem/build-image.sh` -- read from the checkout and checked WITHOUT Docker. Each test pins
 * one finding of the independent U40-A verification (demo-runtime/u40/U40-A-DOCKER-VERIFICATION.md):
 *
 *   F1  the runtime image's `package-lock.json` must be the commit's. `npm prune --omit=dev` in the
 *       builder rewrites the lock file (omitted dependencies are written back with other flags), and the
 *       release identity (ProductReleaseAuthority: package.json, package-lock.json, server/index.ts) is
 *       measured over the files in the working directory. So the runtime stages take the lock file from
 *       the build context (`git archive <SHA>`, the commit's bytes), never from a stage that ran npm.
 *   F4  the comment above `TSX_TSCONFIG_PATH` must not claim what is not so: none of the five processes
 *       needs the tsconfig-paths-only packages, and tsx finds /app/tsconfig.json from the working
 *       directory anyway (the variable pins the choice, it does not make resolution cwd-independent).
 *   F6  the header must not claim that two builds of one commit get the same base while the base stage
 *       installs apk packages without versions.
 *   F7  `build-image.sh` must pin `tar.umask` (a user's git configuration must not change the bytes or
 *       the file modes of the build context).
 *   F8  `.dockerignore` must keep key material and npm/CAS state out of a build from a working tree.
 *
 * The real build and smoke (`sh deploy/onprem/build-image.sh`, `sh deploy/onprem/smoke-image.sh`) are a
 * separate, Docker-bound proof; these tests are the hermetic drift guard in front of it.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const DOCKERFILE = read('Dockerfile');
const DOCKERFILE_LINES = DOCKERFILE.split('\n');
const PARSED: ParsedDockerfile = parseDockerfile(DOCKERFILE);

/** The final stages a build may target (`--target`), each the image of one or more processes. */
const FINAL_TARGETS = ['web', 'gdpr-worker', 'search-indexer-worker', 'domstol-rss-worker'] as const;

/** The stage and its parents, nearest first. */
function lineage(stageRef: string): ParsedStage[] {
  const out: ParsedStage[] = [];
  let current = findStage(PARSED, stageRef);
  while (current) {
    out.push(current);
    current = current.from.parentStage ? findStage(PARSED, current.from.parentStage) : undefined;
  }
  return out;
}

/** COPY sources (every argument but the last, the destination). */
function copySources(instruction: ParsedInstruction): string[] {
  const words = instruction.args.trim().split(/\s+/);
  return words.slice(0, -1);
}

/** The `#` comment block directly above an instruction (nearest first reversed to file order). */
function commentAbove(instruction: ParsedInstruction): string {
  const lines: string[] = [];
  for (let i = instruction.line - 2; i >= 0; i -= 1) {
    const text = DOCKERFILE_LINES[i] ?? '';
    if (!text.startsWith('#')) break;
    lines.unshift(text);
  }
  return lines.join('\n');
}

const npmRuns = (stage: ParsedStage): ParsedInstruction[] =>
  stage.instructions.filter((i) => i.keyword === 'RUN' && /\bnpm\s+(ci|install|i|prune)\b/.test(i.args));

describe('image build recipe: Dockerfile (U40-A2)', () => {
  it('parses into the stages the recipe documents (it cannot pass vacuously)', () => {
    for (const target of FINAL_TARGETS) expect(findStage(PARSED, target), target).toBeDefined();
    expect(findStage(PARSED, 'builder')).toBeDefined();
    expect(findStage(PARSED, 'production-base')).toBeDefined();
    // the premise of F1: a stage runs npm (ci and prune) and the runtime takes its node_modules
    const npmStages = PARSED.stages.filter((s) => npmRuns(s).length > 0).map((s) => s.name);
    expect(npmStages).toEqual(['builder']);
    expect(npmRuns(findStage(PARSED, 'builder')!).some((i) => /npm\s+prune\b.*--omit=dev/.test(i.args))).toBe(true);
  });

  it('F1: every final target takes package-lock.json from the build context, never from a stage that ran npm', () => {
    const npmStages = new Set(PARSED.stages.filter((s) => npmRuns(s).length > 0).map((s) => s.name.toLowerCase()));
    for (const target of FINAL_TARGETS) {
      const copies = lineage(target)
        .flatMap((s) => s.instructions)
        .filter((i) => i.keyword === 'COPY' && copySources(i).some((src) => path.posix.basename(src) === 'package-lock.json'));
      expect(copies.length, `${target}: the runtime image carries package-lock.json`).toBeGreaterThan(0);
      for (const copy of copies) {
        const from = copy.flags.from;
        expect(
          from === undefined,
          `${target}: Dockerfile:${copy.line} copies package-lock.json with --from=${from}; the lock file must come from the build context (the commit's bytes), not from a stage ${npmStages.has((from ?? '').toLowerCase()) ? 'that ran npm (npm prune --omit=dev rewrites it)' : 'of the build'}`,
        ).toBe(true);
      }
    }
  });

  it('F6: the header does not claim an identical base while the base stage installs unpinned apk packages', () => {
    const base = findStage(PARSED, 'base')!;
    const apk = base.instructions.filter((i) => i.keyword === 'RUN' && /\bapk\s+(add|update)\b/.test(i.args));
    expect(apk.length, 'the base stage installs packages with apk').toBeGreaterThan(0);
    const packages = apk
      .flatMap((i) => i.args.split(/&&|;/))
      .filter((cmd) => /\bapk\s+add\b/.test(cmd))
      .flatMap((cmd) => cmd.trim().split(/\s+/).slice(2))
      .filter((w) => !w.startsWith('-'));
    expect(packages.length).toBeGreaterThan(0);
    const unpinned = packages.filter((p) => !p.includes('='));
    // the header comment: everything before the first FROM
    const header = DOCKERFILE_LINES.slice(0, base.instructions[0].line - 1).filter((l) => l.startsWith('#')).join('\n');
    expect(header.length).toBeGreaterThan(0);
    if (unpinned.length > 0) {
      expect(header, `apk packages without a version (${unpinned.join(', ')}): the header must not promise the same base`).not.toMatch(/samma bas/i);
      expect(header, 'the header says that the apk step is not version-pinned').toMatch(/apk[^\n]*inte versionspinna/i);
    }
  });

  it('F4: the comment above TSX_TSCONFIG_PATH states what is so, not what is not', () => {
    const runtime = findStage(PARSED, 'production-base')!;
    const env = runtime.instructions.find((i) => i.keyword === 'ENV' && /\bTSX_TSCONFIG_PATH=/.test(i.args));
    expect(env, 'production-base pins TSX_TSCONFIG_PATH').toBeDefined();
    const comment = commentAbove(env!);
    expect(comment.length, 'the ENV carries a comment').toBeGreaterThan(0);
    expect(comment, 'tsx finds tsconfig.json from the working directory as well; the variable does not make resolution cwd-independent').not.toMatch(/oberoende av working_dir/i);
    expect(comment, 'none of the five processes needs the tsconfig-paths-only packages').toMatch(/ingen av de fem processerna|0 av 5/i);
  });
});

describe('image build recipe: deploy/onprem/build-image.sh (U40-A2)', () => {
  const script = read('deploy/onprem/build-image.sh');

  it('F7: the context archive pins eol AND tar.umask, in the one place git archive runs', () => {
    const archives = script.split('\n').filter((l) => /\bgit\b[^\n]*\barchive\b/.test(l) && !l.trim().startsWith('#'));
    expect(archives.length, 'exactly one git archive command (the archive() function)').toBe(1);
    const [cmd] = archives;
    expect(cmd).toMatch(/-c core\.autocrlf=false/);
    expect(cmd).toMatch(/-c core\.eol=lf/);
    expect(cmd, 'tar.umask pinned to a fixed octal value').toMatch(/-c tar\.umask=0?[0-7]{3}(\s|$)/);
  });
});

describe('image build recipe: .dockerignore (U40-A2)', () => {
  const rules = parseDockerignore(read('.dockerignore'));
  const ignored = (p: string) => isDockerignored(rules, p);

  it('F8: key material and local npm/CAS state never enter a build context from a working tree', () => {
    const leaks = [
      // the verification's probes (F8)
      'config/app.key',
      'config/service.pem',
      'keys/id_rsa',
      'secrets/db-password.txt',
      '.mimers/cas/objects/ab',
      '.npmrc',
      // nested variants of the same shapes
      'server/security/issuer.pem',
      'packages/mps-lu/fixtures/private.key',
      'deploy/onprem/id_ed25519',
      'scripts/ops/secrets/token.json',
      'packages/mps-runtime/.mimers/index.json',
      'services/.npmrc',
      'config/client.p12',
      'app/store.pfx',
    ];
    const admitted = leaks.filter((p) => !ignored(p));
    expect(admitted, 'paths a working-tree build would copy into the image').toEqual([]);
  });

  it('F8 control: the files the image needs are not excluded by those patterns', () => {
    const needed = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'server/index.ts',
      'server/workers/lu-project-context-bootstrap-worker.ts',
      'packages/mps-lu/src/index.ts',
      'packages/mps-lu/package.json',
      'scripts/postinstall-prisma-generate.mjs',
      'scripts/copy-cesium-assets.cjs',
      'prisma/schema.prisma',
      'config/database.ts',
      'config/storage.ts',
      'src/main.tsx',
      'services/propertyService.ts',
      'db.server.ts',
    ];
    const excluded = needed.filter((p) => ignored(p));
    expect(excluded, 'runtime files a pattern excludes by mistake').toEqual([]);
  });

  it('regression: the exclusions U40-A added still hold', () => {
    for (const p of ['.env', '.env.local', 'server/.env.production', '.git/config', 'node_modules/x/index.js', 'packages/mps-lu/node_modules/y.js', '.worktrees/a/b.ts', 'Claude outputs/x.md', '.audit-r1/x', '.data/x', 'dist/index.html']) {
      expect(ignored(p), p).toBe(true);
    }
  });
});
