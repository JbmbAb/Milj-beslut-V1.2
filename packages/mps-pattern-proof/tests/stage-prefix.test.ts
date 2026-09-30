import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isPatternProofError } from '../src/errors';
import { parseDockerfile } from '../src/docker/dockerfile-parse';
import {
  expandContextSource,
  isDockerignored,
  loadDockerignore,
  materializeDockerContext,
  materializeHostLayout,
  parseDockerignore,
} from '../src/docker/executors';
import { lifecycleScriptPaths } from '../src/docker/lifecycle-scripts';
import {
  caPreludeLines,
  deriveStagePrefix,
  renderStagePrefixDockerfile,
  type StagePrefix,
} from '../src/docker/stage-prefix';
import {
  PACKAGE_JSON_WITHOUT_POSTINSTALL,
  PACKAGE_JSON_WITH_POSTINSTALL,
  readRepoFile,
  REPO_ROOT,
  SYNTHETIC_EDGE_CASE_DOCKERFILE,
  SYNTHETIC_NO_INSTALL_DOCKERFILE,
  withCopyScriptsBeforeInstall,
  withIgnoreScripts,
} from './fixtures/dockerfiles';
import { BUILDER_INSTALL_COMMAND, PRODUCTION_BASE_INSTALL_COMMAND } from './fixtures/probe-signatures';

const ROOT_DOCKERFILE = readRepoFile('Dockerfile');
const tmpDirs: string[] = [];

afterAll(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

function derive(text: string, stage: string): StagePrefix {
  return deriveStagePrefix(parseDockerfile(text), stage);
}

function expectPpeError(fn: () => unknown, code: 'PPE_STAGE_NOT_FOUND' | 'PPE_INSTALL_STEP_NOT_FOUND'): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(isPatternProofError(caught, code)).toBe(true);
}

describe('deriveStagePrefix: the real root Dockerfile (today = RED state)', () => {
  it('builder: package*.json + tsconfig.json, `npm ci --legacy-peer-deps` at line 20', () => {
    const prefix = derive(ROOT_DOCKERFILE, 'builder');
    expect(prefix.stageName).toBe('builder');
    expect(prefix.lineage).toEqual(['base', 'builder']);
    expect(prefix.contextSources).toEqual(['package*.json', 'tsconfig.json']);
    expect(prefix.installCommand).toBe(BUILDER_INSTALL_COMMAND);
    expect(prefix.installLine).toBe(20);
    expect(prefix.workdir).toBe('/app');
    expect(prefix.baseImage).toBe('node:22-alpine');
    expect(prefix.args).toEqual({});
    expect(prefix.env).toEqual({
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
      PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser',
    });
    expect(prefix.instructions.map((instruction) => instruction.line)).toEqual([
      1, 4, 7, 11, 13, 16, 17, 18, 20,
    ]);
    expect(prefix.contextCopies).toEqual([
      { line: 17, keyword: 'COPY', sources: ['package*.json'], dest: './', resolvedDest: '/app' },
      { line: 18, keyword: 'COPY', sources: ['tsconfig.json'], dest: './', resolvedDest: '/app' },
    ]);
    expect(Object.isFrozen(prefix)).toBe(true);
    expect(Object.isFrozen(prefix.instructions)).toBe(true);
  });

  it('production-base: package*.json only, `npm ci --omit=dev --legacy-peer-deps` at line 37, NODE_ENV=production', () => {
    const prefix = derive(ROOT_DOCKERFILE, 'production-base');
    expect(prefix.lineage).toEqual(['base', 'production-base']);
    expect(prefix.contextSources).toEqual(['package*.json']);
    expect(prefix.installCommand).toBe(PRODUCTION_BASE_INSTALL_COMMAND);
    expect(prefix.installLine).toBe(37);
    expect(prefix.env).toEqual({
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
      PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser',
      NODE_ENV: 'production',
    });
    expect(prefix.instructions.map((instruction) => instruction.line)).toEqual([
      1, 4, 7, 11, 13, 32, 33, 35, 37,
    ]);
    // nothing after the install step leaks into the prefix (COPY prisma at 40, COPY --from at 41-50)
    expect(prefix.instructions.every((instruction) => instruction.line <= 37)).toBe(true);
  });

  it('web (three-level lineage) has no install step of its own -> PPE_INSTALL_STEP_NOT_FOUND', () => {
    expectPpeError(() => derive(ROOT_DOCKERFILE, 'web'), 'PPE_INSTALL_STEP_NOT_FOUND');
  });

  it('unknown stage -> PPE_STAGE_NOT_FOUND', () => {
    expectPpeError(() => derive(ROOT_DOCKERFILE, 'runtime'), 'PPE_STAGE_NOT_FOUND');
  });
});

describe('deriveStagePrefix: solution neutrality (each candidate reflects its own declared state)', () => {
  it('candidate A: --ignore-scripts on production-base changes only that install command', () => {
    const prefix = derive(withIgnoreScripts(ROOT_DOCKERFILE, 'production-base'), 'production-base');
    expect(prefix.installCommand).toBe(`${PRODUCTION_BASE_INSTALL_COMMAND} --ignore-scripts`);
    expect(prefix.installLine).toBe(37);
    expect(prefix.contextSources).toEqual(['package*.json']);
    // builder is untouched by that candidate
    const builder = derive(withIgnoreScripts(ROOT_DOCKERFILE, 'production-base'), 'builder');
    expect(builder.installCommand).toBe(BUILDER_INSTALL_COMMAND);
  });

  it('candidate A on builder', () => {
    const prefix = derive(withIgnoreScripts(ROOT_DOCKERFILE, 'builder'), 'builder');
    expect(prefix.installCommand).toBe(`${BUILDER_INSTALL_COMMAND} --ignore-scripts`);
    expect(prefix.installLine).toBe(20);
  });

  it('candidate B: COPY scripts ./scripts before the RUN adds scripts to the context and shifts the install line', () => {
    const text = withCopyScriptsBeforeInstall(ROOT_DOCKERFILE, 'builder');
    const prefix = derive(text, 'builder');
    expect(prefix.contextSources).toEqual(['package*.json', 'tsconfig.json', 'scripts']);
    expect(prefix.installLine).toBe(21);
    expect(prefix.installCommand).toBe(BUILDER_INSTALL_COMMAND);
    expect(prefix.contextCopies.at(-1)).toEqual({
      line: 20,
      keyword: 'COPY',
      sources: ['scripts'],
      dest: './scripts',
      resolvedDest: '/app/scripts',
    });
    const production = derive(withCopyScriptsBeforeInstall(text, 'production-base'), 'production-base');
    expect(production.contextSources).toEqual(['package*.json', 'scripts']);
    expect(production.installLine).toBe(39);
  });

  it('candidate C: removing the postinstall hook derives an empty lifecycle path set (Dockerfile untouched)', () => {
    expect(lifecycleScriptPaths(PACKAGE_JSON_WITH_POSTINSTALL)).toEqual([
      'scripts/postinstall-prisma-generate.mjs',
      'scripts/copy-cesium-assets.cjs',
    ]);
    expect(lifecycleScriptPaths(PACKAGE_JSON_WITHOUT_POSTINSTALL)).toEqual([]);
    expect(derive(ROOT_DOCKERFILE, 'production-base').installCommand).toBe(PRODUCTION_BASE_INSTALL_COMMAND);
  });
});

describe('deriveStagePrefix: Dockerfile.gcp (working precedent)', () => {
  const gcp = readRepoFile('Dockerfile.gcp');

  it('builder: install at line 26 with --ignore-scripts, prisma + prisma.config.ts in context, DATABASE_URL env', () => {
    const prefix = derive(gcp, 'builder');
    expect(prefix.lineage).toEqual(['base', 'builder']);
    expect(prefix.installLine).toBe(26);
    expect(prefix.installCommand).toBe(
      'npm ci --legacy-peer-deps --no-audit --prefer-offline --ignore-scripts',
    );
    expect(prefix.contextSources).toEqual(['package*.json', 'tsconfig.json', 'prisma', 'prisma.config.ts']);
    expect(prefix.env).toEqual({ DATABASE_URL: 'postgresql://localhost:5432/docker_build_dummy' });
    expect(prefix.workdir).toBe('/app');
    expect(prefix.instructions.map((instruction) => instruction.line)).toEqual([
      12, 13, 14, 17, 19, 20, 21, 22, 24, 26,
    ]);
  });

  it('production: the continued RUN at 51-54 is the install step; ARG CACHEBUST recorded', () => {
    const prefix = derive(gcp, 'production');
    expect(prefix.installLine).toBe(51);
    expect(prefix.installCommand).toBe(
      'npm ci --omit=dev --legacy-peer-deps --no-audit --prefer-offline --ignore-scripts && test -f node_modules/.bin/tsx && npx prisma generate && npm cache clean --force',
    );
    expect(prefix.args).toEqual({ CACHEBUST: '1' });
    expect(prefix.env).toEqual({
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: 'postgresql://localhost:5432/docker_build_dummy',
    });
    expect(prefix.instructions.at(-1)?.endLine).toBe(54);
  });
});

describe('deriveStagePrefix: synthetic edge cases', () => {
  it('COPY --from lines are kept in the prefix but excluded from the context; exec-form RUN matches', () => {
    const parsed = parseDockerfile(SYNTHETIC_EDGE_CASE_DOCKERFILE);
    const deps = deriveStagePrefix(parsed, 'deps');
    expect(deps.installCommand).toBe('npm ci');
    expect(deps.installLine).toBe(6);
    expect(deps.args).toEqual({ NODE_IMAGE: 'node:22-alpine' });
    expect(deps.baseImage).toBe('${NODE_IMAGE}');

    const stage = deriveStagePrefix(parsed, '1');
    expect(stage.lineage).toEqual(['1']);
    expect(stage.contextSources).toEqual(['tsconfig.json', 'scripts']);
    expect(stage.instructions.some((instruction) => instruction.flags.from === 'deps')).toBe(true);
    // `npm cache clean` / `npm run build` are NOT install steps; `npm install --omit=dev` is
    expect(stage.installCommand).toBe('npm install --omit=dev');
    expect(stage.installLine).toBe(22);
    expect(stage.workdir).toBe('/srv/app');
    expect(stage.env).toEqual({
      LEGACY_KEY: 'some value with spaces',
      QUOTED: 'a b',
      PLAIN: 'c',
      THIRD: '3',
    });
    expect(stage.args).toEqual({ NODE_IMAGE: 'node:22-alpine', CACHEBUST: '1', NO_DEFAULT: '' });
    expect(stage.contextCopies.map((copy) => copy.resolvedDest)).toEqual(['/srv/app', '/srv/app/scripts']);
  });

  it('a stage with only npm cache / npm run RUNs has no install step', () => {
    expectPpeError(() => derive(SYNTHETIC_NO_INSTALL_DOCKERFILE, 'web'), 'PPE_INSTALL_STEP_NOT_FOUND');
  });

  it('a custom install pattern is honored', () => {
    const prefix = deriveStagePrefix(parseDockerfile(SYNTHETIC_NO_INSTALL_DOCKERFILE), 'web', {
      installPattern: /\bnpm\s+run\s+build\b/,
    });
    expect(prefix.installLine).toBe(6);
  });
});

describe('renderStagePrefixDockerfile', () => {
  const prefix = derive(ROOT_DOCKERFILE, 'production-base');

  it('emits the verbatim raw lines, ending with the install step, without a prelude by default', () => {
    const rendered = renderStagePrefixDockerfile(prefix);
    const lines = rendered.split('\n');
    expect(lines[0].startsWith('# PPE stage-prefix probe')).toBe(true);
    expect(lines[1]).toBe('FROM node:22-alpine AS base');
    expect(rendered).toContain(
      'ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \\\n    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser',
    );
    expect(rendered.endsWith('RUN npm ci --omit=dev --legacy-peer-deps\n')).toBe(true);
    expect(rendered).not.toContain('ppe-ca-bundle');
    expect(rendered).not.toContain('COPY --from');
  });

  it('inserts the CA prelude immediately after the ROOT FROM only, changing neither npm flags nor context', () => {
    const rendered = renderStagePrefixDockerfile(prefix, { caBundleFileName: 'ppe-ca-bundle.crt' });
    const lines = rendered.split('\n');
    expect(lines.slice(1, 6)).toEqual([
      'FROM node:22-alpine AS base',
      ...caPreludeLines('ppe-ca-bundle.crt'),
    ]);
    expect(lines.filter((line) => line.includes('ppe-ca-bundle.crt'))).toHaveLength(3);
    const secondFrom = lines.indexOf('FROM base AS production-base');
    expect(secondFrom).toBeGreaterThan(6);
    expect(lines[secondFrom + 1]).toBe('ENV NODE_ENV=production');
    expect(rendered.endsWith('RUN npm ci --omit=dev --legacy-peer-deps\n')).toBe(true);
    expect(lines.filter((line) => line.startsWith('COPY '))).toEqual([
      'COPY ppe-ca-bundle.crt /ppe-ca-bundle.crt',
      'COPY package*.json ./',
    ]);
  });
});

describe('context materialization (.dockerignore + glob expansion)', () => {
  it('parses the repository .dockerignore and applies exact names, dir prefixes and globs', () => {
    const rules = loadDockerignore(REPO_ROOT);
    expect(rules.length).toBeGreaterThanOrEqual(20);
    for (const ignored of [
      'node_modules',
      'node_modules/x/y.js',
      '.git/HEAD',
      '.env',
      '.env.local',
      'foo.log',
      'public/build/app.js',
      'coverage/lcov.info',
      'scratch/x',
    ]) {
      expect(isDockerignored(rules, ignored), ignored).toBe(true);
    }
    for (const kept of [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'scripts/postinstall-prisma-generate.mjs',
      'prisma/schema.prisma',
      'public/index.html',
      // Docker semantics: `*.log` matches root-level files only (no `**/` prefix in the repo file)
      'a/b.log',
    ]) {
      expect(isDockerignored(rules, kept), kept).toBe(false);
    }
  });

  it('supports ** and negation (last match wins)', () => {
    const rules = parseDockerignore('**/node_modules\n*.md\n!README.md\n# comment\n\n/dist/\n');
    expect(isDockerignored(rules, 'a/b/node_modules/x')).toBe(true);
    expect(isDockerignored(rules, 'node_modules')).toBe(true);
    expect(isDockerignored(rules, 'CHANGELOG.md')).toBe(true);
    expect(isDockerignored(rules, 'README.md')).toBe(false);
    expect(isDockerignored(rules, 'dist/x.js')).toBe(true);
    expect(isDockerignored(rules, 'src/dist.js')).toBe(false);
  });

  it('expands package*.json against the repo root to exactly the two files', () => {
    const rules = loadDockerignore(REPO_ROOT);
    expect(expandContextSource(REPO_ROOT, 'package*.json', rules)).toEqual([
      'package-lock.json',
      'package.json',
    ]);
    expect(expandContextSource(REPO_ROOT, './tsconfig.json', rules)).toEqual(['tsconfig.json']);
    expect(expandContextSource(REPO_ROOT, 'does-not-exist-*.json', rules)).toEqual([]);
    expect(expandContextSource(REPO_ROOT, 'node_modules', rules)).toEqual([]);
  });

  it('lays out a candidate B prefix on the host with Docker COPY semantics and produces a docker context', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ppe-ctx-repo-'));
    tmpDirs.push(repo);
    fs.writeFileSync(path.join(repo, 'package.json'), '{}');
    fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(repo, 'tsconfig.json'), '{}');
    fs.mkdirSync(path.join(repo, 'scripts', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scripts', 'postinstall.mjs'), '');
    fs.writeFileSync(path.join(repo, 'scripts', 'nested', 'x.mjs'), '');
    fs.writeFileSync(path.join(repo, 'scripts', 'debug.log'), '');
    fs.mkdirSync(path.join(repo, 'node_modules', 'junk'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'node_modules', 'junk', 'index.js'), '');
    fs.writeFileSync(path.join(repo, '.dockerignore'), 'node_modules\n**/*.log\n');
    const prefix = derive(withCopyScriptsBeforeInstall(ROOT_DOCKERFILE, 'builder'), 'builder');

    const host = fs.mkdtempSync(path.join(os.tmpdir(), 'ppe-ctx-host-'));
    tmpDirs.push(host);
    expect(materializeHostLayout(prefix.contextCopies, prefix.workdir, repo, host)).toEqual([
      'package-lock.json',
      'package.json',
      'scripts/nested/x.mjs',
      'scripts/postinstall.mjs',
      'tsconfig.json',
    ]);

    const ctx = fs.mkdtempSync(path.join(os.tmpdir(), 'ppe-ctx-docker-'));
    tmpDirs.push(ctx);
    expect(materializeDockerContext(prefix, repo, ctx)).toEqual([
      'package-lock.json',
      'package.json',
      'scripts/nested/x.mjs',
      'scripts/postinstall.mjs',
      'tsconfig.json',
    ]);
    expect(fs.existsSync(path.join(ctx, 'node_modules'))).toBe(false);
  });
});
