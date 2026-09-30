import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isPatternProofError } from '../src/errors';
import { parseDockerfile } from '../src/docker/dockerfile-parse';
import { classifyInstallProbeOutput } from '../src/docker/classify';
import {
  expandContextSource,
  hostFidelityLimitation,
  isDockerignored,
  loadDockerignore,
  materializeDockerContext,
  materializeHostLayout,
  parseDockerignore,
  runHostStagePrefixProbe,
} from '../src/docker/executors';
import { lifecycleScriptPaths } from '../src/docker/lifecycle-scripts';
import {
  caPreludeLines,
  deriveStagePrefix,
  isProjectInstallCommand,
  isProjectInstallShellText,
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

  it('carries the install RUN instruction itself (exec-form header matching, R1 F7)', () => {
    const prefix = derive(ROOT_DOCKERFILE, 'builder');
    expect(prefix.installInstruction).toBe(prefix.instructions.at(-1));
    expect(prefix.installInstruction.line).toBe(20);
    expect(prefix.installInstruction.args).toBe('npm ci --legacy-peer-deps');
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

describe('deriveStagePrefix: the install step is the PROJECT install, and exactly one (R1 F3)', () => {
  it('a preceding `RUN npm install -g npm@10` is not the install step: the real npm ci is still derived', () => {
    const text = ROOT_DOCKERFILE.replace(
      'RUN npm ci --omit=dev --legacy-peer-deps\n',
      'RUN npm install -g npm@10\nRUN npm ci --omit=dev --legacy-peer-deps\n',
    );
    expect(text).not.toBe(ROOT_DOCKERFILE);
    const prefix = derive(text, 'production-base');
    expect(prefix.installCommand).toBe(PRODUCTION_BASE_INSTALL_COMMAND);
    expect(prefix.installLine).toBe(38);
    expect(prefix.instructions.map((instruction) => instruction.line)).toEqual([
      1, 4, 7, 11, 13, 32, 33, 35, 37, 38,
    ]);
    expect(prefix.instructions.at(-2)?.args).toBe('npm install -g npm@10');
    // still no scripts/ in the derived context: the stage is still RED
    expect(prefix.contextSources).toEqual(['package*.json']);
  });

  it('two project-install RUNs in the target stage fail closed: PPE_INSTALL_STEP_NOT_FOUND "ambiguous install step"', () => {
    const text = ROOT_DOCKERFILE.replace(
      'RUN npm ci --legacy-peer-deps\n',
      'RUN npm ci --legacy-peer-deps\nRUN npm install --no-audit\n',
    );
    let caught: unknown;
    try {
      derive(text, 'builder');
    } catch (error) {
      caught = error;
    }
    expect(isPatternProofError(caught, 'PPE_INSTALL_STEP_NOT_FOUND')).toBe(true);
    expect((caught as Error).message).toContain('ambiguous install step');
    expect((caught as { details?: unknown }).details).toEqual({ stage: 'builder', lines: [20, 21] });
    // the other stage is unaffected
    expect(derive(text, 'production-base').installLine).toBe(38);
  });

  it('isProjectInstallCommand: flags only, no positional specs, no -g/--global', () => {
    for (const yes of [
      'npm ci',
      'npm install',
      'npm i',
      'npm ci --omit=dev --legacy-peer-deps',
      'npm install --no-audit --prefer-offline --ignore-scripts',
      'NODE_ENV=production npm ci',
      '  npm   ci  ',
      'npm ci $NPM_FLAGS',
      'npm ci --omit=dev ${NPM_FLAGS}',
    ]) {
      expect(isProjectInstallCommand(yes), yes).toBe(true);
    }
    for (const no of [
      'npm install -g npm@10',
      'npm i --global typescript',
      'npm install express',
      'npm install --save-dev vitest',
      'npm ci --omit=dev ./local-package',
      'npm install $PKG_SPEC extra',
      'npm cache clean --force',
      'npm run build',
      'npx prisma generate',
      'yarn install',
      'npm',
      '',
    ]) {
      expect(isProjectInstallCommand(no), no).toBe(false);
    }
    expect(isProjectInstallShellText('npm cache clean --force && npm run build')).toBe(false);
    expect(
      isProjectInstallShellText('npm install -g npm@10 && npm ci --omit=dev; npm cache clean --force'),
    ).toBe(true);
    expect(isProjectInstallShellText('mkdir -p x; npm ci')).toBe(true);
  });

  it('R2 F8: --location=global and combined short flags containing g are global installs; `||` and `|` split like lifecycle scripts', () => {
    for (const no of [
      'npm install --location=global npm@10',
      'npm install --location=global',
      'npm ci --location=global',
      'npm install -gf',
      'npm i -fg',
      'npm install -g',
    ]) {
      expect(isProjectInstallCommand(no), no).toBe(false);
      expect(isProjectInstallShellText(no), no).toBe(false);
    }
    // a short-flag group without g is still a project install; a long flag merely containing g too
    expect(isProjectInstallCommand('npm ci -f')).toBe(true);
    expect(isProjectInstallCommand('npm ci --ignore-scripts')).toBe(true);
    // the same separators as lifecycle-scripts.ts: `||` and `|` split commands
    expect(isProjectInstallShellText('npm ci --omit=dev --legacy-peer-deps || true')).toBe(true);
    expect(isProjectInstallShellText('npm ci --omit=dev --legacy-peer-deps | tee install.log')).toBe(true);
    expect(isProjectInstallShellText('npm install -g npm@10 || npm ci')).toBe(true);
    expect(isProjectInstallShellText('npm install --location=global npm@10 | cat')).toBe(false);
  });

  it('R2 F8: documented fail-closed shapes are NOT recognised (separate flag value, redirection, inline comment, aliases)', () => {
    for (const no of [
      'npm ci --loglevel verbose',
      'npm ci 2>&1',
      'npm ci > install.log',
      'npm ci --omit=dev # prod',
      'npm clean-install',
      'npm install-clean',
      'npm ci -- lodash',
    ]) {
      expect(isProjectInstallCommand(no), no).toBe(false);
      expect(isProjectInstallShellText(no), no).toBe(false);
    }
    // a stage whose only install is written that way has no derivable install step (BLOCKED at the CLI)
    const text = [
      'FROM node:22-alpine AS base',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm ci --loglevel verbose',
      '',
    ].join('\n');
    expectPpeError(() => derive(text, 'base'), 'PPE_INSTALL_STEP_NOT_FOUND');
  });

  it('a stage whose only npm RUNs are global or positional installs has no install step', () => {
    const text = [
      'FROM node:22-alpine AS base',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm install -g npm@10',
      'RUN npm install express',
      '',
    ].join('\n');
    expectPpeError(() => derive(text, 'base'), 'PPE_INSTALL_STEP_NOT_FOUND');
  });
});

describe('host executor preconditions: BLOCKED-classifiable refusals before spawning (R1 F2/F8)', () => {
  function tempRepo(files: Readonly<Record<string, string>>): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ppe-host-pre-'));
    tmpDirs.push(repo);
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
      fs.writeFileSync(path.join(repo, relative), content);
    }
    return repo;
  }
  const PACKAGE_JSON = JSON.stringify({
    name: 'x',
    version: '1.0.0',
    scripts: { postinstall: 'node scripts/x.mjs' },
  });
  const CLASSIFY_BASE = {
    timedOut: false,
    lifecyclePaths: ['scripts/x.mjs'],
    lifecycleScriptStrings: ['node scripts/x.mjs'],
    installCommand: 'npm ci',
    packageIdentity: { name: 'x', version: '1.0.0' },
  } as const;

  it('COPY --from in the prefix -> HOST_FIDELITY_UNSUPPORTED (documented docker outcome is BLOCKED, never a host FAIL)', async () => {
    const repo = tempRepo({ 'package.json': PACKAGE_JSON });
    const text = [
      'FROM node:22-alpine AS scripts-stage',
      'WORKDIR /src',
      'FROM node:22-alpine AS web',
      'WORKDIR /app',
      'COPY package*.json ./',
      'COPY --from=scripts-stage /src/scripts ./scripts',
      'RUN npm ci',
      '',
    ].join('\n');
    const prefix = derive(text, 'web');
    expect(hostFidelityLimitation(prefix)).toContain('COPY --from=scripts-stage at line 6');
    const execution = await runHostStagePrefixProbe(prefix, { repoRoot: repo, timeoutMs: 10_000 });
    expect(execution.fidelity).toBe('host-npm');
    expect(execution.installStepStarted).toBe(false);
    expect(execution.exitStatus).toBeNull();
    expect(execution.spawnError?.code).toBe('HOST_FIDELITY_UNSUPPORTED');
    expect(execution.contextFiles).toEqual([]);
    const classified = classifyInstallProbeOutput({
      ...CLASSIFY_BASE,
      output: execution.output,
      exitStatus: execution.exitStatus,
      spawnError: execution.spawnError as { code?: string; message: string },
      installStepStarted: execution.installStepStarted,
      workdir: execution.workdir,
    });
    expect(classified.classification).toBe('BLOCKED');
    expect(classified.reasonCode).toBe('HOST_FIDELITY_UNSUPPORTED');
  });

  it('an install command with an unexpanded $ -> HOST_FIDELITY_UNSUPPORTED', async () => {
    const repo = tempRepo({ 'package.json': PACKAGE_JSON });
    const text = [
      'FROM node:22-alpine AS web',
      'ARG NPM_FLAGS=--ignore-scripts',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm ci $NPM_FLAGS',
      '',
    ].join('\n');
    const prefix = derive(text, 'web');
    expect(prefix.installCommand).toBe('npm ci $NPM_FLAGS');
    expect(hostFidelityLimitation(prefix)).toContain('unexpanded $');
    const execution = await runHostStagePrefixProbe(prefix, { repoRoot: repo, timeoutMs: 10_000 });
    expect(execution.spawnError?.code).toBe('HOST_FIDELITY_UNSUPPORTED');
    expect(execution.installStepStarted).toBe(false);
    expect(hostFidelityLimitation(derive(ROOT_DOCKERFILE, 'builder'))).toBeUndefined();
    expect(hostFidelityLimitation(derive(ROOT_DOCKERFILE, 'production-base'))).toBeUndefined();
  });

  it('package.json not landing in the host root (broken COPY glob) -> CONTEXT_INCOMPLETE, not a spawned npm', async () => {
    const repo = tempRepo({ 'package.json': PACKAGE_JSON, 'package-lock.json': '{}' });
    const text = [
      'FROM node:22-alpine AS web',
      'WORKDIR /app',
      'COPY pakage*.json ./',
      'RUN npm ci',
      '',
    ].join('\n');
    const prefix = derive(text, 'web');
    expect(prefix.contextSources).toEqual(['pakage*.json']);
    const execution = await runHostStagePrefixProbe(prefix, { repoRoot: repo, timeoutMs: 10_000 });
    expect(execution.spawnError?.code).toBe('CONTEXT_INCOMPLETE');
    expect(execution.spawnError?.message).toContain('package.json did not land');
    expect(execution.installStepStarted).toBe(false);
    expect(execution.contextFiles).toEqual([]);
    expect(execution.output).toBe('');
    const classified = classifyInstallProbeOutput({
      ...CLASSIFY_BASE,
      output: execution.output,
      exitStatus: execution.exitStatus,
      spawnError: execution.spawnError as { code?: string; message: string },
      installStepStarted: execution.installStepStarted,
      workdir: execution.workdir,
    });
    expect(classified).toEqual({
      classification: 'BLOCKED',
      reasonCode: 'CONTEXT_INCOMPLETE',
      matched: [execution.spawnError?.message],
    });
    expect(fs.existsSync(execution.workdir)).toBe(false);
  });

  it('applies ARG defaults as environment defaults (args, then ENV, then the caller env; empty ARG never clobbers)', async () => {
    const repo = tempRepo({ 'package.json': PACKAGE_JSON });
    const text = [
      'ARG PPE_TEST_PREAMBLE=from-preamble',
      'FROM node:22-alpine AS web',
      'ARG PPE_TEST_FLAGS=--ignore-scripts',
      'ARG PPE_TEST_BOTH=from-arg',
      'ARG PPE_TEST_KEEP',
      'ENV PPE_TEST_BOTH=from-env',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN printenv PPE_TEST_PREAMBLE PPE_TEST_FLAGS PPE_TEST_BOTH PPE_TEST_KEEP',
      '',
    ].join('\n');
    const prefix = deriveStagePrefix(parseDockerfile(text), 'web', { installPattern: /^printenv\b/ });
    expect(prefix.args).toEqual({
      PPE_TEST_PREAMBLE: 'from-preamble',
      PPE_TEST_FLAGS: '--ignore-scripts',
      PPE_TEST_BOTH: 'from-arg',
      PPE_TEST_KEEP: '',
    });
    const execution = await runHostStagePrefixProbe(prefix, {
      repoRoot: repo,
      timeoutMs: 10_000,
      env: { PPE_TEST_KEEP: 'from-caller' },
    });
    expect(execution.spawnError).toBeUndefined();
    expect(execution.exitStatus).toBe(0);
    expect(execution.installStepStarted).toBe(true);
    expect(execution.contextFiles).toEqual(['package.json']);
    expect(execution.output.split('\n').filter((line) => line.length > 0)).toEqual([
      'from-preamble',
      '--ignore-scripts',
      'from-env',
      'from-caller',
    ]);
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
