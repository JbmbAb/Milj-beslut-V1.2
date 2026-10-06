/**
 * Dockerfile fixtures for the stage-prefix / parser tests.
 *
 * The real root `Dockerfile` is read from the repository at test time (the
 * derivation must hold against the actual target). Dockerfile.gcp is retired and must be absent.
 * The synthetic variants below are the candidate
 * fixes the writer lane may choose (BOOTSTRAP section 5.3/5.4): the derivation must reflect each
 * candidate's own declared state -- solution neutrality.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

function replaceOnce(text: string, needle: string, replacement: string): string {
  const index = text.indexOf(needle);
  if (index === -1) throw new Error(`fixture: "${needle}" not found in Dockerfile text`);
  return `${text.slice(0, index)}${replacement}${text.slice(index + needle.length)}`;
}

export const ROOT_INSTALL_LINES = {
  builder: 'RUN npm ci --legacy-peer-deps --ignore-scripts\n',
} as const;

/** Candidate fix A: add `--ignore-scripts` to the install step of one stage (Dockerfile.gcp's pattern). */
export function withIgnoreScripts(text: string, stage: keyof typeof ROOT_INSTALL_LINES): string {
  const line = ROOT_INSTALL_LINES[stage];
  return replaceOnce(text, line, `${line.trimEnd()} --ignore-scripts\n`);
}

/** Candidate fix B: `COPY scripts ./scripts` immediately before the install step of one stage. */
export function withCopyScriptsBeforeInstall(text: string, stage: keyof typeof ROOT_INSTALL_LINES): string {
  const line = ROOT_INSTALL_LINES[stage];
  return replaceOnce(text, line, `COPY scripts ./scripts\n${line}`);
}

/** Candidate fix C is a package.json change: the hook is removed (the Dockerfile is untouched). */
export const PACKAGE_JSON_WITH_POSTINSTALL = {
  name: 'miljobeslut-se-2.0',
  version: '0.0.0',
  scripts: {
    build: 'vite build',
    postinstall: 'node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  },
};

export const PACKAGE_JSON_WITHOUT_POSTINSTALL = {
  name: 'miljobeslut-se-2.0',
  version: '0.0.0',
  scripts: {
    build: 'vite build',
    'prisma:generate': 'prisma generate',
  },
};

/** Parser edge cases: continuation with a comment inside, legacy ENV, exec-form RUN, COPY --from, ARG preamble. */
export const SYNTHETIC_EDGE_CASE_DOCKERFILE = [
  '# syntax=docker/dockerfile:1',
  'ARG NODE_IMAGE=node:22-alpine',
  'FROM ${NODE_IMAGE} AS deps',
  'WORKDIR /app',
  'COPY package*.json ./',
  'RUN ["npm", "ci"]',
  '',
  'FROM node:22-alpine',
  'ENV LEGACY_KEY some value with spaces',
  'ENV QUOTED="a b" PLAIN=c \\',
  '    # a comment inside the continuation',
  '    THIRD=3',
  'WORKDIR /srv',
  'WORKDIR app',
  'ARG CACHEBUST=1',
  'ARG NO_DEFAULT',
  'COPY --from=deps /app/node_modules ./node_modules',
  'COPY --chown=1000:1000 tsconfig.json ./',
  'ADD scripts ./scripts',
  'RUN npm cache clean --force \\',
  '  && npm run build',
  'RUN npm install --omit=dev',
  'CMD ["node", "server.js"]',
  '',
].join('\n');

/** A stage whose only RUNs are `npm cache` / `npm run`: no install step. */
export const SYNTHETIC_NO_INSTALL_DOCKERFILE = [
  'FROM node:22-alpine AS base',
  'WORKDIR /app',
  'FROM base AS web',
  'COPY package*.json ./',
  'RUN npm cache clean --force',
  'RUN npm run build',
  '',
].join('\n');
