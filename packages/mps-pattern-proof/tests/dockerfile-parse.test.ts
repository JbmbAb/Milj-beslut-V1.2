import { describe, expect, it } from 'vitest';
import { isPatternProofError } from '../src/errors';
import {
  execFormTokens,
  findStage,
  instructionShellText,
  parseDockerfile,
  splitDockerfileWords,
} from '../src/docker/dockerfile-parse';
import { readRepoFile, SYNTHETIC_EDGE_CASE_DOCKERFILE } from './fixtures/dockerfiles';

describe('parseDockerfile: the real root Dockerfile', () => {
  const parsed = parseDockerfile(readRepoFile('Dockerfile'));

  it('finds every stage at its expected line with its parent', () => {
    expect(parsed.stages.map((stage) => [stage.name, stage.instructions[0].line])).toEqual([
      ['base', 1],
      ['builder', 16],
      ['production-base', 32],
      ['web', 58],
      ['gdpr-worker', 64],
      ['search-indexer-worker', 68],
      ['domstol-rss-worker', 72],
    ]);
    expect(parsed.stages[0].from).toEqual({ image: 'node:22-alpine' });
    expect(parsed.stages[1].from).toEqual({ image: 'base', parentStage: 'base' });
    expect(parsed.stages[2].from).toEqual({ image: 'base', parentStage: 'base' });
    expect(parsed.stages[3].from).toEqual({ image: 'production-base', parentStage: 'production-base' });
    expect(parsed.preamble).toEqual([]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.stages[0].instructions)).toBe(true);
  });

  it('base stage: multi-key ENV continuation (7-8) joined, raw kept verbatim, line/endLine tracked', () => {
    const base = parsed.stages[0];
    expect(base.instructions.map((instruction) => [instruction.keyword, instruction.line])).toEqual([
      ['FROM', 1],
      ['RUN', 4],
      ['ENV', 7],
      ['RUN', 11],
      ['WORKDIR', 13],
    ]);
    const env = base.instructions[2];
    expect(env.endLine).toBe(8);
    expect(env.args).toBe(
      'PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser',
    );
    expect(env.raw).toBe(
      'ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \\\n    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser',
    );
    expect(base.instructions[1].args).toBe('apk update && apk add --no-cache openssl curl chromium');
    expect(base.instructions[4].args).toBe('/app');
  });

  it('builder stage: COPY sources, the shell-form install RUN at line 20, COPY . . at 26', () => {
    const builder = parsed.stages[1];
    expect(builder.instructions.map((instruction) => [instruction.keyword, instruction.line])).toEqual([
      ['FROM', 16],
      ['COPY', 17],
      ['COPY', 18],
      ['RUN', 20],
      ['COPY', 22],
      ['RUN', 23],
      ['COPY', 26],
      ['RUN', 29],
    ]);
    expect(builder.instructions[1]).toMatchObject({ args: 'package*.json ./', flags: {} });
    expect(builder.instructions[3]).toMatchObject({
      args: 'npm ci --legacy-peer-deps',
      raw: 'RUN npm ci --legacy-peer-deps',
    });
    expect(execFormTokens(builder.instructions[3].args)).toBeNull();
  });

  it('production-base stage: COPY --from flags are separated from args (41-50)', () => {
    const production = parsed.stages[2];
    const fromLines = production.instructions.filter((instruction) => instruction.flags.from !== undefined);
    expect(fromLines.map((instruction) => instruction.line)).toEqual([
      41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    ]);
    expect(fromLines[0]).toMatchObject({
      keyword: 'COPY',
      flags: { from: 'builder' },
      args: '/app/node_modules/.prisma ./node_modules/.prisma',
    });
    expect(production.instructions.find((instruction) => instruction.line === 40)).toMatchObject({
      keyword: 'COPY',
      flags: {},
      args: 'prisma ./prisma',
    });
    expect(production.instructions.find((instruction) => instruction.line === 54)).toMatchObject({
      keyword: 'USER',
      args: 'appuser',
    });
  });

  it('final stages: exec-form CMD kept verbatim and tokenizable, EXPOSE/ENV verbatim', () => {
    const web = parsed.stages[3];
    expect(
      web.instructions.map((instruction) => [instruction.keyword, instruction.line, instruction.args]),
    ).toEqual([
      ['FROM', 58, 'production-base AS web'],
      ['ENV', 59, 'PORT=8080'],
      ['EXPOSE', 60, '8080'],
      ['CMD', 61, '["npm", "start"]'],
    ]);
    expect(execFormTokens(web.instructions[3].args)).toEqual(['npm', 'start']);
    expect(instructionShellText(web.instructions[3])).toBe('npm start');
  });
});

describe('parseDockerfile: Dockerfile.gcp', () => {
  const parsed = parseDockerfile(readRepoFile('Dockerfile.gcp'));

  it('has three stages at 12/17/36 and no preamble', () => {
    expect(parsed.stages.map((stage) => [stage.name, stage.instructions[0].line, stage.from])).toEqual([
      ['base', 12, { image: 'node:22-alpine' }],
      ['builder', 17, { image: 'base', parentStage: 'base' }],
      ['production', 36, { image: 'base', parentStage: 'base' }],
    ]);
    expect(parsed.preamble).toEqual([]);
  });

  it('joins the 51-54 RUN continuation into one shell text and keeps ARG/ENTRYPOINT verbatim', () => {
    const production = parsed.stages[2];
    const install = production.instructions.find((instruction) => instruction.line === 51);
    expect(install).toMatchObject({
      keyword: 'RUN',
      endLine: 54,
      args: 'npm ci --omit=dev --legacy-peer-deps --no-audit --prefer-offline --ignore-scripts && test -f node_modules/.bin/tsx && npx prisma generate && npm cache clean --force',
    });
    expect(install?.raw.split('\n')).toHaveLength(4);
    expect(production.instructions.find((instruction) => instruction.line === 50)).toMatchObject({
      keyword: 'ARG',
      args: 'CACHEBUST=1',
      raw: 'ARG CACHEBUST=1',
    });
    expect(production.instructions.find((instruction) => instruction.line === 72)).toMatchObject({
      keyword: 'ENTRYPOINT',
      args: '["/sbin/tini", "--"]',
      raw: 'ENTRYPOINT ["/sbin/tini", "--"]',
    });
    expect(parsed.stages[1].instructions.find((instruction) => instruction.line === 26)).toMatchObject({
      args: 'npm ci --legacy-peer-deps --no-audit --prefer-offline --ignore-scripts',
    });
  });
});

describe('parseDockerfile: synthetic edge cases', () => {
  const parsed = parseDockerfile(SYNTHETIC_EDGE_CASE_DOCKERFILE);

  it('keeps a global ARG in the preamble and ignores the syntax directive', () => {
    expect(parsed.preamble.map((instruction) => [instruction.keyword, instruction.args])).toEqual([
      ['ARG', 'NODE_IMAGE=node:22-alpine'],
    ]);
    expect(parsed.stages.map((stage) => stage.name)).toEqual(['deps', '1']);
    expect(parsed.stages[0].from).toEqual({ image: '${NODE_IMAGE}' });
  });

  it('skips a comment line inside a continuation and joins the remaining segments', () => {
    const stage = parsed.stages[1];
    const env = stage.instructions.find((instruction) => instruction.line === 10);
    expect(env).toMatchObject({ keyword: 'ENV', endLine: 12, args: 'QUOTED="a b" PLAIN=c THIRD=3' });
    expect(env?.raw.split('\n')).toHaveLength(3);
    expect(stage.instructions.find((instruction) => instruction.line === 9)).toMatchObject({
      args: 'LEGACY_KEY some value with spaces',
    });
  });

  it('separates leading flags and keeps exec-form RUN tokenizable', () => {
    const stage = parsed.stages[1];
    expect(stage.instructions.find((instruction) => instruction.line === 17)).toMatchObject({
      keyword: 'COPY',
      flags: { from: 'deps' },
      args: '/app/node_modules ./node_modules',
    });
    expect(stage.instructions.find((instruction) => instruction.line === 18)).toMatchObject({
      flags: { chown: '1000:1000' },
      args: 'tsconfig.json ./',
    });
    expect(instructionShellText(parsed.stages[0].instructions[3])).toBe('npm ci');
    expect(stage.instructions.find((instruction) => instruction.line === 20)).toMatchObject({
      endLine: 21,
      args: 'npm cache clean --force && npm run build',
    });
  });

  it('findStage resolves by name (case-insensitive) and by index string', () => {
    expect(findStage(parsed, 'DEPS')?.name).toBe('deps');
    expect(findStage(parsed, '1')?.name).toBe('1');
    expect(findStage(parsed, 'missing')).toBeUndefined();
    const byIndex = parseDockerfile('FROM alpine\nFROM 0\nRUN npm ci\n');
    expect(byIndex.stages[1].from).toEqual({ image: '0', parentStage: '0' });
  });

  it('bare flags yield an empty value and CRLF input is accepted', () => {
    const parsed2 = parseDockerfile('FROM alpine AS a\r\nCOPY --link src ./src\r\nRUN npm ci\r\n');
    expect(parsed2.stages[0].instructions[1]).toMatchObject({ flags: { link: '' }, args: 'src ./src' });
    expect(parsed2.stages[0].instructions[2].args).toBe('npm ci');
  });

  it('splitDockerfileWords handles quotes and escapes', () => {
    expect(splitDockerfileWords('A="x y" B=\'z w\' C=q\\ r D=""')).toEqual(['A=x y', 'B=z w', 'C=q r', 'D=']);
  });
});

describe('parseDockerfile: errors are PPE_DOCKERFILE_PARSE', () => {
  const cases: readonly [string, string][] = [
    ['no FROM', 'RUN npm ci\n'],
    ['empty file', ''],
    ['non-ARG instruction before FROM', 'ENV A=1\nFROM alpine\n'],
    ['FROM without image', 'FROM\n'],
    ['malformed FROM', 'FROM alpine AS\n'],
    ['duplicate stage name', 'FROM alpine AS a\nFROM alpine AS A\n'],
    ['invalid keyword', 'FROM alpine\n123 foo\n'],
    ['unsupported escape directive', '# escape=`\nFROM alpine\n'],
  ];
  for (const [label, text] of cases) {
    it(label, () => {
      expect.assertions(1);
      try {
        parseDockerfile(text);
      } catch (error) {
        expect(isPatternProofError(error, 'PPE_DOCKERFILE_PARSE')).toBe(true);
      }
    });
  }
});
