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
      ['base', 4],
      ['builder', 19],
      ['production-base', 45],
      ['web', 86],
      ['gdpr-worker', 92],
      ['search-indexer-worker', 96],
      ['domstol-rss-worker', 100],
    ]);
    expect(parsed.stages[0].from).toEqual({
      image: 'node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402',
    });
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
      ['FROM', 4],
      ['RUN', 7],
      ['ENV', 10],
      ['RUN', 14],
      ['WORKDIR', 16],
    ]);
    const env = base.instructions[2];
    expect(env.endLine).toBe(11);
    expect(env.args).toBe(
      'PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser',
    );
    expect(env.raw).toBe(
      'ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \\\n    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser',
    );
    expect(base.instructions[1].args).toBe('apk update && apk add --no-cache openssl curl chromium');
    expect(base.instructions[4].args).toBe('/app');
  });

  it('builder stage: COPY sources, the shell-form install RUN at line 27, COPY . . at 30', () => {
    const builder = parsed.stages[1];
    expect(builder.instructions.map((instruction) => [instruction.keyword, instruction.line])).toEqual([
      ['FROM', 19],
      ['COPY', 20],
      ['COPY', 21],
      ['COPY', 24],
      ['RUN', 27],
      ['COPY', 30],
      ['RUN', 34],
      ['RUN', 37],
      ['RUN', 42],
    ]);
    expect(builder.instructions[1]).toMatchObject({ args: 'package*.json ./', flags: {} });
    expect(builder.instructions[4]).toMatchObject({
      args: 'npm ci --legacy-peer-deps --ignore-scripts',
      raw: 'RUN npm ci --legacy-peer-deps --ignore-scripts',
    });
    expect(execFormTokens(builder.instructions[4].args)).toBeNull();
  });

  it('production-base stage: COPY --from flags are separated from args (62-74)', () => {
    const production = parsed.stages[2];
    const fromLines = production.instructions.filter((instruction) => instruction.flags.from !== undefined);
    expect(fromLines.map((instruction) => instruction.line)).toEqual([
      61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74,
    ]);
    expect(fromLines[0]).toMatchObject({
      keyword: 'COPY',
      flags: { from: 'builder', chown: 'appuser:appgroup' },
      args: '/app/package.json /app/package-lock.json /app/tsconfig.json ./',
    });
    expect(production.instructions.find((instruction) => instruction.line === 60)).toMatchObject({
      keyword: 'RUN',
      flags: {},
      args: 'chown appuser:appgroup /app',
    });
    expect(production.instructions.find((instruction) => instruction.line === 76)).toMatchObject({
      keyword: 'USER',
      args: 'appuser',
    });
  });

  it('final stages: exec-form CMD kept verbatim and tokenizable, EXPOSE/ENV verbatim', () => {
    const web = parsed.stages[3];
    expect(
      web.instructions.map((instruction) => [instruction.keyword, instruction.line, instruction.args]),
    ).toEqual([
      ['FROM', 86, 'production-base AS web'],
      ['ENV', 87, 'PORT=8080'],
      ['EXPOSE', 88, '8080'],
      ['CMD', 89, '["npm", "start"]'],
    ]);
    expect(execFormTokens(web.instructions[3].args)).toEqual(['npm', 'start']);
    expect(instructionShellText(web.instructions[3])).toBe('npm start');
  });
});

describe('parseDockerfile: retired Dockerfile.gcp', () => {
  it('is not a current repository file after W-NO-GOOGLE-01', () => {
    expect(() => readRepoFile('Dockerfile.gcp')).toThrow(/ENOENT/);
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
