/**
 * Regression tests for four findings of the PR #205 automated review that are reachable in
 * BOOTSTRAP_RED_ONLY (each was reproduced before it was fixed):
 *
 *  1. a huge `file_line` range allocated every line number (memory exhaustion in `ppe-cli run`);
 *  2. a COPY/ADD source such as `../secret.json` left the build context (host executor read it,
 *     docker materializer wrote outside its temporary context);
 *  3. a symlink inside the repository pointing outside it resolved as repository-governed evidence;
 *  4. a rejecting attestation lookup escaped `resolve`/`resolveAll` instead of failing closed.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import {
  expandContextSource,
  materializeDockerContext,
  materializeHostLayout,
} from '../src/docker/executors';
import { deriveStagePrefix, type StageContextCopy } from '../src/docker/stage-prefix';
import type { EvidenceLocator } from '../src/evidence';
import { digestOf } from '../src/identity';

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
