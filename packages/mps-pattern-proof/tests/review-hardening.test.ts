/**
 * Regression tests for four findings of the PR #205 automated review that are reachable in
 * BOOTSTRAP_RED_ONLY (each was reproduced before it was fixed):
 *
 *  1. a huge `file_line` range allocated every line number (memory exhaustion in `ppe-cli run`);
 *  2. a COPY/ADD source such as `../secret.json` left the build context (host executor read it,
 *     docker materializer wrote outside its temporary context);
 *  3. a symlink inside the repository pointing outside it resolved as repository-governed evidence;
 *  4. a rejecting attestation lookup escaped `resolve`/`resolveAll` instead of failing closed.
 *
 * Section 2b covers a fifth finding raised by the review of the fix for (2): symlinks inside copied
 * context entries (an absolute link to an outside file, a path through a link to an outside
 * directory) carried outside content into the host layout and the docker context. The review of that
 * fix showed `fs.cpSync` also rewrites a relative link whose target stays INSIDE the repository to an
 * absolute path into the source checkout, so every symlink among copied entries is refused
 * (PPE_PROBE_BLOCKED), whatever its target.
 *
 * Sections 5 and 6 cover two findings raised by the review of the hardening delta itself, both
 * reproduced before they were fixed: a global ARG before the first FROM was dropped from the rendered
 * probe Dockerfile (`FROM ${ARG}` then had an empty base), and `dockerfilePath` accepted an absolute
 * path, a `..` escape or a symlink that resolves outside the repository root.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createArtifactAttestation,
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  attestationSubjectBinding,
} from '@miljobeslut/mimers-brunn-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_FILE_LINE_REF_LINES,
  parseFileLineRef,
  RepositoryAuthorityResolver,
  resolveAll,
} from '../src/authority';
import { parseDockerfile } from '../src/docker/dockerfile-parse';
import { executeRedProbe } from '../src/docker/red-probe';
import {
  expandContextSource,
  materializeDockerContext,
  materializeHostLayout,
} from '../src/docker/executors';
import {
  caPreludeLines,
  deriveStagePrefix,
  renderStagePrefixDockerfile,
  type StageContextCopy,
} from '../src/docker/stage-prefix';
import type { EvidenceLocator } from '../src/evidence';
import { digestOf } from '../src/identity';
import { readRepoFile } from './fixtures/dockerfiles';

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

const loc = (kind: EvidenceLocator['kind'], ref: string): EvidenceLocator => ({ kind, ref });

function elapsedMs(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('1. file_line ranges are bounded before anything is expanded', () => {
  it('refuses a range far beyond the bound without allocating it (it aborted a 256 MB heap before)', () => {
    let parsed: unknown = 'not run';
    expect(
      elapsedMs(() => {
        parsed = parseFileLineRef('Dockerfile:1-400000000');
      }),
    ).toBeLessThan(1_000);
    expect(parsed).toBeUndefined();
  });

  it('counts every range of a ref together, and stops at the bound exactly', () => {
    expect(MAX_FILE_LINE_REF_LINES).toBe(100_000);
    expect(parseFileLineRef(`Dockerfile:1-${MAX_FILE_LINE_REF_LINES}`)?.lines).toHaveLength(
      MAX_FILE_LINE_REF_LINES,
    );
    expect(parseFileLineRef(`Dockerfile:1-${MAX_FILE_LINE_REF_LINES + 1}`)).toBeUndefined();
    expect(parseFileLineRef('Dockerfile:1-60000,1-60000')).toBeUndefined();
    expect(parseFileLineRef('Dockerfile:1-50000,60001-110000')?.lines).toHaveLength(MAX_FILE_LINE_REF_LINES);
    expect(parseFileLineRef('Dockerfile:1-50000,60001-110001')).toBeUndefined();
  });

  it('refuses numbers that are not safe integers (they made the expansion loop forever)', () => {
    for (const ref of [
      'Dockerfile:1-99999999999999999999',
      'Dockerfile:99999999999999999999',
      `Dockerfile:${'9'.repeat(400)}`,
      'Dockerfile:9007199254740993-9007199254740994',
    ]) {
      expect(elapsedMs(() => expect(parseFileLineRef(ref), ref).toBeUndefined())).toBeLessThan(1_000);
    }
  });

  it('the resolver reports a hostile range as malformed, quickly; normal refs still resolve', async () => {
    const root = tmp('ppe-range-');
    writeFileSync(path.join(root, 'Dockerfile'), 'FROM base\nWORKDIR /app\nRUN npm ci\n');
    const resolver = new RepositoryAuthorityResolver({ repoRoot: root });
    const started = performance.now();
    const hostile = await resolver.resolve(loc('file_line', 'Dockerfile:1-1000000000'));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(hostile).toEqual({ resolved: false, reason: 'FILE_LINE_REF_MALFORMED' });
    expect(await resolver.resolve(loc('file_line', 'Dockerfile:1-3'))).toEqual({
      resolved: true,
      resolvedTo: 'Dockerfile:1-3',
    });
    expect(await resolver.resolve(loc('file_line', 'Dockerfile:1-4'))).toEqual({
      resolved: false,
      reason: 'LINE_OUT_OF_RANGE',
    });
  });
});

describe('2. COPY/ADD sources and destinations cannot leave their sandbox', () => {
  it('expandContextSource refuses sources that climb out of the context', () => {
    const base = tmp('ppe-ctx-');
    const repo = path.join(base, 'repo');
    mkdirSync(path.join(repo, 'a'), { recursive: true });
    writeFileSync(path.join(base, 'secret.json'), '{}');
    for (const source of [
      '../secret.json',
      './../secret.json',
      '..',
      'a/../../secret.json',
      '..\\secret.json',
    ]) {
      expect(() => expandContextSource(repo, source, []), source).toThrow(
        /PPE_PROBE_BLOCKED.*leaves the build context/,
      );
    }
  });

  it('still expands legitimate sources, normalizing inner `..` that stays inside', () => {
    const repo = tmp('ppe-ctx-ok-');
    mkdirSync(path.join(repo, 'a'), { recursive: true });
    writeFileSync(path.join(repo, 'b.txt'), 'b');
    writeFileSync(path.join(repo, 'package.json'), '{}');
    expect(expandContextSource(repo, '.', [])).toEqual(['']);
    expect(expandContextSource(repo, './', [])).toEqual(['']);
    expect(expandContextSource(repo, 'a/../b.txt', [])).toEqual(['b.txt']);
    expect(expandContextSource(repo, '/b.txt', [])).toEqual(['b.txt']);
    expect(expandContextSource(repo, 'package*.json', [])).toEqual(['package.json']);
    expect(expandContextSource(repo, 'missing.txt', [])).toEqual([]);
  });

  const DOCKERFILE = [
    'FROM node:22-alpine AS base',
    'WORKDIR /app',
    'FROM base AS production-base',
    'COPY ../secret.json ./',
    'RUN npm ci --omit=dev',
  ].join('\n');

  it('the docker materializer refuses before writing outside its context directory', () => {
    const base = tmp('ppe-docker-ctx-');
    const repo = path.join(base, 'repo');
    mkdirSync(repo);
    writeFileSync(path.join(repo, 'package.json'), '{}');
    writeFileSync(path.join(base, 'secret.json'), '{"secret":true}');
    const contextDir = path.join(base, 'work', 'ctx');
    mkdirSync(contextDir, { recursive: true });
    const prefix = deriveStagePrefix(parseDockerfile(DOCKERFILE), 'production-base');
    expect(() => materializeDockerContext(prefix, repo, contextDir)).toThrow(/PPE_PROBE_BLOCKED/);
    // nothing landed next to the context directory, nor inside it
    expect(existsSync(path.join(base, 'work', 'secret.json'))).toBe(false);
    expect(readdirSync(contextDir)).toEqual([]);
  });

  it('the host layout refuses before reading the outside file', () => {
    const base = tmp('ppe-host-ctx-');
    const repo = path.join(base, 'repo');
    mkdirSync(repo);
    writeFileSync(path.join(base, 'secret.json'), '{"secret":true}');
    const hostRoot = path.join(base, 'host');
    mkdirSync(hostRoot);
    const prefix = deriveStagePrefix(parseDockerfile(DOCKERFILE), 'production-base');
    expect(() => materializeHostLayout(prefix.contextCopies, prefix.workdir, repo, hostRoot)).toThrow(
      /PPE_PROBE_BLOCKED/,
    );
    expect(readdirSync(hostRoot)).toEqual([]);
  });

  it('a destination that would leave the host root is refused as well (defense in depth)', () => {
    const base = tmp('ppe-host-dest-');
    const repo = path.join(base, 'repo');
    mkdirSync(repo);
    writeFileSync(path.join(repo, 'package.json'), '{}');
    const hostRoot = path.join(base, 'host');
    mkdirSync(hostRoot);
    const escaping: StageContextCopy = {
      line: 4,
      keyword: 'COPY',
      sources: ['package.json'],
      dest: '../../x',
      resolvedDest: '/app/../../x', // a resolvedDest the derivation never produces
    };
    expect(() => materializeHostLayout([escaping], '/app', repo, hostRoot)).toThrow(
      /PPE_PROBE_BLOCKED.*destination/,
    );
    expect(readdirSync(base).sort()).toEqual(['host', 'repo']);
  });

  it('a normal stage still materializes (context root copy and named files)', () => {
    const repo = tmp('ppe-host-ok-');
    writeFileSync(path.join(repo, 'package.json'), '{"name":"x"}');
    writeFileSync(path.join(repo, 'package-lock.json'), '{}');
    const hostRoot = tmp('ppe-host-ok-root-');
    const prefix = deriveStagePrefix(
      parseDockerfile(
        ['FROM node:22-alpine AS base', 'WORKDIR /app', 'COPY package*.json ./', 'RUN npm ci'].join('\n'),
      ),
      'base',
    );
    expect(materializeHostLayout(prefix.contextCopies, prefix.workdir, repo, hostRoot)).toEqual([
      'package-lock.json',
      'package.json',
    ]);
  });
});

describe('2b. symlinks in copied context entries cannot carry outside content into the layout', () => {
  let base = '';
  let repo = '';
  beforeAll(() => {
    base = tmp('ppe-ctx-symlink-');
    repo = path.join(base, 'repo');
    mkdirSync(path.join(repo, 'pkgs'), { recursive: true });
    mkdirSync(path.join(repo, 'inside-dir'));
    writeFileSync(path.join(repo, 'package.json'), '{}');
    writeFileSync(path.join(repo, 'pkgs', 'ok.txt'), 'inside\n');
    writeFileSync(path.join(base, 'outside.txt'), 'OUTSIDE CONTENT\n');
    mkdirSync(path.join(base, 'outside-dir'));
    writeFileSync(path.join(base, 'outside-dir', 'inner.txt'), 'OUTSIDE DIR CONTENT\n');
    symlinkSync(path.join(base, 'outside.txt'), path.join(repo, 'pkgs', 'abs-leak.txt')); // absolute, outside
    symlinkSync('../../outside.txt', path.join(repo, 'pkgs', 'rel-leak.txt')); // relative, outside
    symlinkSync(path.join(base, 'outside-dir'), path.join(repo, 'linked-dir')); // directory link, outside
    mkdirSync(path.join(repo, 'dang'));
    symlinkSync(path.join(base, 'no-such-file'), path.join(repo, 'dang', 'dangling-out')); // dangling, outside
    mkdirSync(path.join(repo, 'good'));
    writeFileSync(path.join(repo, 'good', 'real.txt'), 'real\n');
    symlinkSync('real.txt', path.join(repo, 'good', 'alias.txt')); // inside
    symlinkSync('inside-dir', path.join(repo, 'inside-link')); // directory link, inside
    mkdirSync(path.join(repo, 'plain', 'nested'), { recursive: true });
    writeFileSync(path.join(repo, 'plain', 'real.txt'), 'plain\n');
    writeFileSync(path.join(repo, 'plain', 'nested', 'deep.txt'), 'deep\n');
  });

  function symlinksIn(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(root, entry.name);
      if (entry.isSymbolicLink()) return [full];
      return entry.isDirectory() ? symlinksIn(full) : [];
    });
  }

  const prefixFor = (copy: string) =>
    deriveStagePrefix(
      parseDockerfile(
        ['FROM node:22-alpine AS base', 'WORKDIR /app', `COPY ${copy}`, 'RUN npm ci'].join('\n'),
      ),
      'base',
    );

  function noOutsideContent(root: string): boolean {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    return walk(root).every((file) => {
      try {
        return !readFileSync(file, 'utf8').includes('OUTSIDE');
      } catch {
        return true;
      }
    });
  }

  it.each([
    ['an absolute symlink to an outside file', 'pkgs ./pkgs'],
    ['a path through a symlinked directory', 'linked-dir/inner.txt ./'],
    ['a directory link pointing outside', 'linked-dir ./linked'],
  ])('the host layout refuses %s', (_label, copy) => {
    const prefix = prefixFor(copy);
    const hostRoot = mkdtempSync(path.join(base, 'host-'));
    expect(() => materializeHostLayout(prefix.contextCopies, prefix.workdir, repo, hostRoot)).toThrow(
      /PPE_PROBE_BLOCKED.*symlink/,
    );
    expect(noOutsideContent(hostRoot)).toBe(true);
  });

  it.each([
    ['an absolute symlink to an outside file', 'pkgs ./pkgs'],
    ['a path through a symlinked directory', 'linked-dir/inner.txt ./'],
  ])('the docker context refuses %s', (_label, copy) => {
    const prefix = prefixFor(copy);
    const contextDir = mkdtempSync(path.join(base, 'ctx-'));
    expect(() => materializeDockerContext(prefix, repo, contextDir)).toThrow(/PPE_PROBE_BLOCKED.*symlink/);
    expect(noOutsideContent(contextDir)).toBe(true);
  });

  it('refuses a relative link that climbs out, and a directory holding a dangling link that points outside', () => {
    for (const copy of ['pkgs/rel-leak.txt ./', 'dang ./dang']) {
      const prefix = prefixFor(copy);
      const hostRoot = mkdtempSync(path.join(base, 'host-'));
      expect(() => materializeHostLayout(prefix.contextCopies, prefix.workdir, repo, hostRoot), copy).toThrow(
        /PPE_PROBE_BLOCKED/,
      );
    }
  });

  it.each([
    ['a relative link in a copied directory whose target stays inside the repository', 'good ./good'],
    ['an inside link given directly as the COPY source', 'good/alias.txt ./'],
    ['a symlinked directory that stays inside the repository', 'inside-link ./il'],
  ])('refuses %s (cpSync would rewrite it to an absolute link into the checkout)', (_label, copy) => {
    const prefix = prefixFor(copy);
    const hostRoot = mkdtempSync(path.join(base, 'host-'));
    expect(() => materializeHostLayout(prefix.contextCopies, prefix.workdir, repo, hostRoot)).toThrow(
      /PPE_PROBE_BLOCKED.*is a symlink/,
    );
    expect(symlinksIn(hostRoot)).toEqual([]);
    const contextDir = mkdtempSync(path.join(base, 'ctx-'));
    expect(() => materializeDockerContext(prefix, repo, contextDir)).toThrow(
      /PPE_PROBE_BLOCKED.*is a symlink/,
    );
    expect(symlinksIn(contextDir)).toEqual([]);
  });

  it('still copies regular files and directories (nested too), and the layout never holds a link', () => {
    const prefix = prefixFor('plain ./plain');
    const hostRoot = mkdtempSync(path.join(base, 'host-'));
    expect(materializeHostLayout(prefix.contextCopies, prefix.workdir, repo, hostRoot)).toEqual([
      'plain/nested/deep.txt',
      'plain/real.txt',
    ]);
    expect(symlinksIn(hostRoot)).toEqual([]);
    const contextDir = mkdtempSync(path.join(base, 'ctx-'));
    expect(materializeDockerContext(prefix, repo, contextDir)).toEqual([
      'plain/nested/deep.txt',
      'plain/real.txt',
    ]);
    expect(symlinksIn(contextDir)).toEqual([]);
    // a copied manifest that is a plain file keeps working
    const manifest = prefixFor('package.json ./');
    const root2 = mkdtempSync(path.join(base, 'host-'));
    expect(materializeHostLayout(manifest.contextCopies, manifest.workdir, repo, root2)).toEqual([
      'package.json',
    ]);
  });
});

describe('2c. a repository root that is itself reached through a symlink is not mistaken for a copied link', () => {
  it('copies a plain tree via COPY . when repoRoot is a symlink to it (host layout and docker context)', () => {
    const base = tmp('ppe-root-link-');
    const real = path.join(base, 'real-repo');
    mkdirSync(path.join(real, 'plain'), { recursive: true });
    writeFileSync(path.join(real, 'package.json'), '{}');
    writeFileSync(path.join(real, 'plain', 'real.txt'), 'plain\n');
    const viaLink = path.join(base, 'repo-link');
    symlinkSync(real, viaLink);
    const prefix = deriveStagePrefix(
      parseDockerfile(['FROM node:22-alpine AS base', 'WORKDIR /app', 'COPY . ./', 'RUN npm ci'].join('\n')),
      'base',
    );
    const hostRoot = mkdtempSync(path.join(base, 'host-'));
    expect(materializeHostLayout(prefix.contextCopies, prefix.workdir, viaLink, hostRoot)).toEqual([
      'package.json',
      'plain/real.txt',
    ]);
    const contextDir = mkdtempSync(path.join(base, 'ctx-'));
    expect(materializeDockerContext(prefix, viaLink, contextDir)).toEqual(['package.json', 'plain/real.txt']);
  });
});

describe('3. file_line evidence must stay below the repository after symlinks are followed', () => {
  let base = '';
  let repo = '';
  beforeAll(() => {
    base = tmp('ppe-symlink-');
    repo = path.join(base, 'repo');
    mkdirSync(path.join(repo, 'docs'), { recursive: true });
    writeFileSync(path.join(base, 'outside.txt'), 'outside line one\noutside line two\n');
    mkdirSync(path.join(base, 'outside-dir'));
    writeFileSync(path.join(base, 'outside-dir', 'inner.txt'), 'inner\n');
    writeFileSync(path.join(repo, 'real.txt'), 'real one\nreal two\n');
    symlinkSync(path.join(base, 'outside.txt'), path.join(repo, 'docs', 'source'));
    symlinkSync(path.join(base, 'outside-dir'), path.join(repo, 'linked-dir'));
    symlinkSync('real.txt', path.join(repo, 'alias.txt'));
    symlinkSync(path.join(base, 'does-not-exist'), path.join(repo, 'dangling'));
  });

  it('refuses a tracked symlink to a file outside the repository', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: repo });
    expect(await resolver.resolve(loc('file_line', 'docs/source:1-2'))).toEqual({
      resolved: false,
      reason: 'PATH_OUTSIDE_REPO_ROOT',
    });
  });

  it('refuses a path that goes through a symlinked directory pointing outside', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: repo });
    expect(await resolver.resolve(loc('file_line', 'linked-dir/inner.txt:1'))).toEqual({
      resolved: false,
      reason: 'PATH_OUTSIDE_REPO_ROOT',
    });
  });

  it('still resolves a symlink that stays inside the repository, and reports a dangling one as not found', async () => {
    const resolver = new RepositoryAuthorityResolver({ repoRoot: repo });
    expect(await resolver.resolve(loc('file_line', 'alias.txt:1-2'))).toEqual({
      resolved: true,
      resolvedTo: 'alias.txt:1-2',
    });
    expect(await resolver.resolve(loc('file_line', 'dangling:1'))).toEqual({
      resolved: false,
      reason: 'FILE_NOT_FOUND',
    });
  });

  it('works when repoRoot itself is reached through a symlink', async () => {
    const viaLink = path.join(base, 'repo-link');
    symlinkSync(repo, viaLink);
    const resolver = new RepositoryAuthorityResolver({ repoRoot: viaLink });
    expect((await resolver.resolve(loc('file_line', 'real.txt:1'))).resolved).toBe(true);
    expect(await resolver.resolve(loc('file_line', 'docs/source:1'))).toEqual({
      resolved: false,
      reason: 'PATH_OUTSIDE_REPO_ROOT',
    });
  });
});

describe('4. a failing attestation lookup is an unresolved authority, never an exception', () => {
  const KEY_ID = 'ed25519:ppe-hardening-fixture';
  let publicKey = '';
  let binding = '';
  beforeAll(async () => {
    const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
    publicKey = generated.publicKey;
    const attestation = await createArtifactAttestation({
      subjectDigest: digestOf({ bundle: 'verifier-input' }),
      predicateType: 'ppe/verifier-input-bundle/v1',
      predicate: { declaredKeys: ['candidate'] },
      signing: generated.provider,
    });
    binding = attestationSubjectBinding(attestation);
  });

  const resolverWith = (lookup: (key: string) => Promise<never> | never) =>
    new RepositoryAuthorityResolver({
      repoRoot: os.tmpdir(),
      attestations: {
        verification: new LocalPemVerificationKeyProvider(KEY_ID, publicKey),
        attestations: lookup as never,
      },
    });

  it('an asynchronously rejecting lookup (CAS or network outage) fails closed', async () => {
    const resolver = resolverWith(async () => {
      throw new Error('CAS backend unavailable');
    });
    expect(await resolver.resolve(loc('signed_attestation', binding))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_LOOKUP_UNAVAILABLE',
    });
  });

  it('a synchronously throwing lookup fails closed too', async () => {
    const resolver = resolverWith(() => {
      throw new Error('boom');
    });
    expect(await resolver.resolve(loc('signed_attestation', binding))).toEqual({
      resolved: false,
      reason: 'ATTESTATION_LOOKUP_UNAVAILABLE',
    });
  });

  it('resolveAll keeps going and lists the unavailable lookup with its reason', async () => {
    const root = tmp('ppe-resolveall-');
    writeFileSync(path.join(root, 'Dockerfile'), 'FROM base\n');
    const resolver = new RepositoryAuthorityResolver({
      repoRoot: root,
      attestations: {
        verification: new LocalPemVerificationKeyProvider(KEY_ID, publicKey),
        attestations: (async () => {
          throw new Error('outage');
        }) as never,
      },
    });
    const summary = await resolveAll(resolver, [
      loc('signed_attestation', binding),
      loc('file_line', 'Dockerfile:1'),
    ]);
    expect(summary.allResolved).toBe(false);
    expect(summary.unresolved.map((entry) => entry.reason)).toEqual(['ATTESTATION_LOOKUP_UNAVAILABLE']);
  });
});

describe('5. a global ARG before the first FROM is preserved in the rendered probe Dockerfile', () => {
  const render = (text: string, stage: string, caBundleFileName?: string): string[] =>
    renderStagePrefixDockerfile(
      deriveStagePrefix(parseDockerfile(text), stage),
      caBundleFileName === undefined ? {} : { caBundleFileName },
    ).split('\n');

  it('renders the pre-FROM ARG ahead of a parameterized FROM (it was dropped, leaving an empty base image)', () => {
    const lines = render(
      'ARG NODE_IMAGE=node:22-alpine\nFROM ${NODE_IMAGE} AS builder\nWORKDIR /app\nCOPY package.json ./\nRUN npm ci\n',
      'builder',
    );
    expect(lines.slice(1)).toEqual([
      'ARG NODE_IMAGE=node:22-alpine',
      'FROM ${NODE_IMAGE} AS builder',
      'WORKDIR /app',
      'COPY package.json ./',
      'RUN npm ci',
      '',
    ]);
  });

  it('keeps every global ARG (with and without default, continued lines) once, in order, before the first FROM', () => {
    const lines = render(
      [
        'ARG BASE=node:22',
        'ARG REGISTRY',
        'ARG FLAGS=--a \\',
        '    --b',
        'FROM ${REGISTRY}${BASE} AS base',
        'FROM base AS builder',
        'COPY package.json ./',
        'RUN npm ci',
        '',
      ].join('\n'),
      'builder',
    );
    const firstFrom = lines.findIndex((line) => line.startsWith('FROM '));
    expect(lines.slice(1, firstFrom)).toEqual([
      'ARG BASE=node:22',
      'ARG REGISTRY',
      'ARG FLAGS=--a \\',
      '    --b',
    ]);
    expect(lines.filter((line) => line.startsWith('ARG ')).length).toBe(3);
    expect(lines[firstFrom]).toBe('FROM ${REGISTRY}${BASE} AS base');
  });

  it('still puts the CA prelude immediately after the ROOT FROM, behind the global ARG', () => {
    const prelude = caPreludeLines('ppe-ca-bundle.crt');
    const lines = render(
      'ARG NODE_IMAGE=node:22-alpine\nFROM ${NODE_IMAGE} AS builder\nCOPY package.json ./\nRUN npm ci\n',
      'builder',
      'ppe-ca-bundle.crt',
    );
    expect(lines.slice(1, 3 + prelude.length)).toEqual([
      'ARG NODE_IMAGE=node:22-alpine',
      'FROM ${NODE_IMAGE} AS builder',
      ...prelude,
    ]);
  });

  it('renders a Dockerfile without a preamble exactly as before (no added line; the real root Dockerfile)', () => {
    const text = readRepoFile('Dockerfile');
    for (const stage of ['builder', 'production-base']) {
      const prefix = deriveStagePrefix(parseDockerfile(text), stage);
      expect(prefix.preambleArgs).toEqual([]);
      const legacy = [
        `# PPE stage-prefix probe: stage "${prefix.stageName}" (lineage ${prefix.lineage.join(' -> ')}), derived from the candidate Dockerfile up to and including the install step at line ${prefix.installLine}.`,
        ...prefix.instructions.map((instruction) => instruction.raw),
      ];
      expect(renderStagePrefixDockerfile(prefix)).toBe(`${legacy.join('\n')}\n`);
    }
  });
});

describe('6. dockerfilePath is bound to the repository root (absolute, .. and symlink escapes are refused)', () => {
  // The fixtures deliberately carry NO project install step: a guard that lets a path through ends in
  // PPE_INSTALL_STEP_NOT_FOUND after reading it, and nothing is ever executed.
  const STAGE_WITHOUT_INSTALL = 'FROM node:22-alpine AS builder\nRUN echo no-install-here\n';
  let base = '';
  let repo = '';
  beforeAll(() => {
    base = tmp('ppe-dockerfile-path-');
    repo = path.join(base, 'repo');
    mkdirSync(path.join(repo, 'sub'), { recursive: true });
    writeFileSync(path.join(base, 'outside.Dockerfile'), STAGE_WITHOUT_INSTALL);
    mkdirSync(path.join(base, 'outside-dir'));
    writeFileSync(path.join(base, 'outside-dir', 'Dockerfile'), STAGE_WITHOUT_INSTALL);
    writeFileSync(path.join(repo, 'Dockerfile'), STAGE_WITHOUT_INSTALL);
    writeFileSync(path.join(repo, 'sub', 'Dockerfile'), STAGE_WITHOUT_INSTALL);
    writeFileSync(path.join(repo, '..Dockerfile'), STAGE_WITHOUT_INSTALL);
    symlinkSync('Dockerfile', path.join(repo, 'alias.Dockerfile'));
    symlinkSync(path.join(base, 'outside.Dockerfile'), path.join(repo, 'linked.Dockerfile'));
    symlinkSync(path.join(base, 'outside-dir'), path.join(repo, 'linked-dir'));
    symlinkSync(path.join(base, 'does-not-exist'), path.join(repo, 'dangling.Dockerfile'));
  });

  const probe = (dockerfilePath: string, repoRoot: string = repo) =>
    executeRedProbe({ repoRoot, dockerfilePath, stageName: 'builder', executor: 'host' });
  const refused = (message: RegExp) => ({
    code: 'PPE_PROBE_BLOCKED',
    message: expect.stringMatching(message),
  });
  const admitted = { code: 'PPE_INSTALL_STEP_NOT_FOUND' };

  it('refuses a ..-escape, also one that re-enters through a sub directory', async () => {
    await expect(probe('../outside.Dockerfile')).rejects.toMatchObject(
      refused(/escapes the repository root/),
    );
    await expect(probe('sub/../../outside.Dockerfile')).rejects.toMatchObject(
      refused(/escapes the repository root/),
    );
  });

  it('refuses an absolute path, to an outside file and to a file inside the repository alike', async () => {
    await expect(probe(path.join(base, 'outside.Dockerfile'))).rejects.toMatchObject(
      refused(/absolute paths are refused/),
    );
    await expect(probe(path.join(repo, 'Dockerfile'))).rejects.toMatchObject(
      refused(/absolute paths are refused/),
    );
  });

  it('refuses a symlink to an outside file and a path through a symlinked directory pointing outside', async () => {
    await expect(probe('linked.Dockerfile')).rejects.toMatchObject(refused(/through a symlink/));
    await expect(probe('linked-dir/Dockerfile')).rejects.toMatchObject(refused(/through a symlink/));
  });

  it('reports a dangling symlink as unreadable (blocked), not as an escape and not as a pass', async () => {
    await expect(probe('dangling.Dockerfile')).rejects.toMatchObject(refused(/cannot read/));
  });

  it('admits paths that stay inside: plain, ./, re-entering, nested, a ..-prefixed file name, an inside symlink', async () => {
    for (const inside of [
      'Dockerfile',
      './Dockerfile',
      'sub/../Dockerfile',
      'sub/Dockerfile',
      '..Dockerfile',
      'alias.Dockerfile',
    ]) {
      await expect(probe(inside), inside).rejects.toMatchObject(admitted);
    }
  });

  it('applies the same rules when repoRoot itself is reached through a symlink', async () => {
    const viaLink = path.join(base, 'repo-link');
    symlinkSync(repo, viaLink);
    await expect(probe('Dockerfile', viaLink)).rejects.toMatchObject(admitted);
    await expect(probe('../outside.Dockerfile', viaLink)).rejects.toMatchObject(
      refused(/escapes the repository root/),
    );
    await expect(probe('linked.Dockerfile', viaLink)).rejects.toMatchObject(refused(/through a symlink/));
  });
});
