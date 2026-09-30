/**
 * Verbatim probe output signatures captured in the Understand phase (task A3, 2026-09-30) from
 * <scratchpad>/evidence/a3/*. Each constant is the captured file's text, one array element per
 * line, joined with '\n' (trailing newline of the file dropped). Do not edit the lines: the
 * classification tests assert the predicate against exactly what npm 10.9.x / docker 29.3.1 /
 * BuildKit printed. Source file and capture context are named on every constant.
 */

/** dk-pb.log: docker build --network host --progress plain of the derived production-base prefix (Dockerfile.probe), docker exit 1, wall 117s. Extent: from the step "#11 [production-base 1/2]" to the end (the apk layer lines #1-#10 are omitted; they carry no signature). */
export const DOCKER_PRODUCTION_BASE_RED_OUTPUT = [
  '#11 [production-base 1/2] COPY package*.json ./',
  '#11 DONE 0.0s',
  '',
  '#12 [production-base 2/2] RUN npm ci --omit=dev --legacy-peer-deps',
  '#12 39.47 ',
  '#12 39.47 > miljobeslut-se-2.0@0.0.0 postinstall',
  '#12 39.47 > node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  '#12 39.47 ',
  '#12 39.54 node:internal/modules/cjs/loader:1433',
  '#12 39.54   throw err;',
  '#12 39.54   ^',
  '#12 39.54 ',
  "#12 39.54 Error: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs'",
  '#12 39.54     at Function._resolveFilename (node:internal/modules/cjs/loader:1430:15)',
  '#12 39.54     at defaultResolveImpl (node:internal/modules/cjs/loader:1040:19)',
  '#12 39.54     at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1045:22)',
  '#12 39.54     at Function._load (node:internal/modules/cjs/loader:1216:25)',
  '#12 39.54     at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)',
  '#12 39.54     at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)',
  '#12 39.54     at node:internal/main/run_main_module:36:49 {',
  "#12 39.54   code: 'MODULE_NOT_FOUND',",
  '#12 39.54   requireStack: []',
  '#12 39.54 }',
  '#12 39.54 ',
  '#12 39.54 Node.js v22.23.3',
  '#12 39.55 npm error code 1',
  '#12 39.55 npm error path /app',
  '#12 39.55 npm error command failed',
  '#12 39.55 npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  '#12 39.56 npm notice',
  '#12 39.56 npm notice New major version of npm available! 10.9.9 -> 12.1.0',
  '#12 39.56 npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.1.0',
  '#12 39.56 npm notice To update run: npm install -g npm@12.1.0',
  '#12 39.56 npm notice',
  '#12 39.56 npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T11_50_11_609Z-debug-0.log',
  '#12 ERROR: process "/bin/sh -c npm ci --omit=dev --legacy-peer-deps" did not complete successfully: exit code: 1',
  '------',
  ' > [production-base 2/2] RUN npm ci --omit=dev --legacy-peer-deps:',
  '39.55 npm error code 1',
  '39.55 npm error path /app',
  '39.55 npm error command failed',
  '39.55 npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  '39.56 npm notice',
  '39.56 npm notice New major version of npm available! 10.9.9 -> 12.1.0',
  '39.56 npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.1.0',
  '39.56 npm notice To update run: npm install -g npm@12.1.0',
  '39.56 npm notice',
  '39.56 npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T11_50_11_609Z-debug-0.log',
  '------',
  'Dockerfile.probe:16',
  '--------------------',
  '  14 |     ENV NODE_ENV=production',
  '  15 |     COPY package*.json ./',
  '  16 | >>> RUN npm ci --omit=dev --legacy-peer-deps',
  '  17 |     ',
  '--------------------',
  'ERROR: failed to build: failed to solve: process "/bin/sh -c npm ci --omit=dev --legacy-peer-deps" did not complete successfully: exit code: 1',
].join('\n');

/** dk-builder.log: docker build --network host --progress plain of the derived builder prefix (Dockerfile.builder.probe), docker exit 1, wall 46s. Extent: whole file. */
export const DOCKER_BUILDER_RED_OUTPUT = [
  '#0 building with "default" instance using docker driver',
  '',
  '#1 [internal] load build definition from Dockerfile.probe',
  '#1 transferring dockerfile: 789B done',
  '#1 DONE 0.0s',
  '',
  '#2 [internal] load metadata for docker.io/library/node:22-alpine',
  '#2 DONE 0.0s',
  '',
  '#3 [internal] load .dockerignore',
  '#3 transferring context: 2B done',
  '#3 DONE 0.0s',
  '',
  '#4 [base 1/6] FROM docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402',
  '#4 resolve docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 0.0s done',
  '#4 DONE 0.0s',
  '',
  '#5 [internal] load build context',
  '#5 transferring context: 228.71kB 0.0s done',
  '#5 DONE 0.0s',
  '',
  '#6 [base 5/6] RUN addgroup -S appgroup && adduser -S appuser -G appgroup',
  '#6 CACHED',
  '',
  '#7 [base 6/6] WORKDIR /app',
  '#7 CACHED',
  '',
  '#8 [base 2/6] COPY ca-bundle.crt /ppe-ca-bundle.crt',
  '#8 CACHED',
  '',
  '#9 [base 3/6] RUN cat /ppe-ca-bundle.crt >> /etc/ssl/certs/ca-certificates.crt',
  '#9 CACHED',
  '',
  '#10 [base 4/6] RUN apk update && apk add --no-cache openssl curl chromium',
  '#10 CACHED',
  '',
  '#11 [builder 1/3] COPY package*.json ./',
  '#11 CACHED',
  '',
  '#12 [builder 2/3] COPY tsconfig.json ./',
  '#12 DONE 0.0s',
  '',
  '#13 [builder 3/3] RUN npm ci --legacy-peer-deps',
  '#13 44.95 ',
  '#13 44.95 > miljobeslut-se-2.0@0.0.0 postinstall',
  '#13 44.95 > node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  '#13 44.95 ',
  '#13 45.04 node:internal/modules/cjs/loader:1433',
  '#13 45.04   throw err;',
  '#13 45.04   ^',
  '#13 45.04 ',
  "#13 45.04 Error: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs'",
  '#13 45.04     at Function._resolveFilename (node:internal/modules/cjs/loader:1430:15)',
  '#13 45.04     at defaultResolveImpl (node:internal/modules/cjs/loader:1040:19)',
  '#13 45.04     at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1045:22)',
  '#13 45.04     at Function._load (node:internal/modules/cjs/loader:1216:25)',
  '#13 45.04     at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)',
  '#13 45.04     at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)',
  '#13 45.04     at node:internal/main/run_main_module:36:49 {',
  "#13 45.04   code: 'MODULE_NOT_FOUND',",
  '#13 45.04   requireStack: []',
  '#13 45.04 }',
  '#13 45.04 ',
  '#13 45.04 Node.js v22.23.3',
  '#13 45.05 npm error code 1',
  '#13 45.05 npm error path /app',
  '#13 45.05 npm error command failed',
  '#13 45.05 npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  '#13 45.05 npm notice',
  '#13 45.05 npm notice New major version of npm available! 10.9.9 -> 12.1.0',
  '#13 45.05 npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.1.0',
  '#13 45.05 npm notice To update run: npm install -g npm@12.1.0',
  '#13 45.05 npm notice',
  '#13 45.05 npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T11_50_53_757Z-debug-0.log',
  '#13 ERROR: process "/bin/sh -c npm ci --legacy-peer-deps" did not complete successfully: exit code: 1',
  '------',
  ' > [builder 3/3] RUN npm ci --legacy-peer-deps:',
  '45.05 npm error code 1',
  '45.05 npm error path /app',
  '45.05 npm error command failed',
  '45.05 npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  '45.05 npm notice',
  '45.05 npm notice New major version of npm available! 10.9.9 -> 12.1.0',
  '45.05 npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.1.0',
  '45.05 npm notice To update run: npm install -g npm@12.1.0',
  '45.05 npm notice',
  '45.05 npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T11_50_53_757Z-debug-0.log',
  '------',
  'Dockerfile.probe:16',
  '--------------------',
  '  14 |     COPY package*.json ./',
  '  15 |     COPY tsconfig.json ./',
  '  16 | >>> RUN npm ci --legacy-peer-deps',
  '  17 |     ',
  '--------------------',
  'ERROR: failed to build: failed to solve: process "/bin/sh -c npm ci --legacy-peer-deps" did not complete successfully: exit code: 1',
].join('\n');

/** probe-pb.stdout: host `npm ci --omit=dev --legacy-peer-deps` in a temp dir holding package.json + package-lock.json, exit 1, wall 32.08s. Extent: whole file. */
export const HOST_PRODUCTION_BASE_RED_STDOUT = [
  '',
  '> miljobeslut-se-2.0@0.0.0 postinstall',
  '> node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  '',
].join('\n');

/** probe-pb.stderr: stderr of the same host production-base run. Extent: whole file. */
export const HOST_PRODUCTION_BASE_RED_STDERR = [
  'node:internal/modules/cjs/loader:1386',
  '  throw err;',
  '  ^',
  '',
  "Error: Cannot find module '/tmp/claude-0/-home-user-Milj-beslut-V1-2/615d3f00-15b1-5229-8425-a287dfd450e5/scratchpad/probe-pb/scripts/postinstall-prisma-generate.mjs'",
  '    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)',
  '    at defaultResolveImpl (node:internal/modules/cjs/loader:1025:19)',
  '    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1030:22)',
  '    at Function._load (node:internal/modules/cjs/loader:1192:37)',
  '    at TracingChannel.traceSync (node:diagnostics_channel:328:14)',
  '    at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)',
  '    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)',
  '    at node:internal/main/run_main_module:36:49 {',
  "  code: 'MODULE_NOT_FOUND',",
  '  requireStack: []',
  '}',
  '',
  'Node.js v22.22.2',
  'npm error code 1',
  'npm error path /tmp/claude-0/-home-user-Milj-beslut-V1-2/615d3f00-15b1-5229-8425-a287dfd450e5/scratchpad/probe-pb',
  'npm error command failed',
  'npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  'npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T11_35_28_843Z-debug-0.log',
].join('\n');

/** probe-builder.stdout: host `npm ci --legacy-peer-deps` in a temp dir holding package.json + package-lock.json + tsconfig.json, exit 1, wall 36.06s. Extent: whole file. */
export const HOST_BUILDER_RED_STDOUT = [
  '',
  '> miljobeslut-se-2.0@0.0.0 postinstall',
  '> node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  '',
].join('\n');

/** probe-builder.stderr: stderr of the same host builder run. Extent: whole file. */
export const HOST_BUILDER_RED_STDERR = [
  'node:internal/modules/cjs/loader:1386',
  '  throw err;',
  '  ^',
  '',
  "Error: Cannot find module '/tmp/claude-0/-home-user-Milj-beslut-V1-2/615d3f00-15b1-5229-8425-a287dfd450e5/scratchpad/probe-builder/scripts/postinstall-prisma-generate.mjs'",
  '    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)',
  '    at defaultResolveImpl (node:internal/modules/cjs/loader:1025:19)',
  '    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1030:22)',
  '    at Function._load (node:internal/modules/cjs/loader:1192:37)',
  '    at TracingChannel.traceSync (node:diagnostics_channel:328:14)',
  '    at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)',
  '    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)',
  '    at node:internal/main/run_main_module:36:49 {',
  "  code: 'MODULE_NOT_FOUND',",
  '  requireStack: []',
  '}',
  '',
  'Node.js v22.22.2',
  'npm error code 1',
  'npm error path /tmp/claude-0/-home-user-Milj-beslut-V1-2/615d3f00-15b1-5229-8425-a287dfd450e5/scratchpad/probe-builder',
  'npm error command failed',
  'npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
  'npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T11_36_51_172Z-debug-0.log',
].join('\n');

/** probe-pb-ignore.stdout: positive control: same file set, `npm ci --omit=dev --legacy-peer-deps --ignore-scripts`, exit 0, wall 26.9s. Extent: whole file. */
export const HOST_PRODUCTION_BASE_IGNORE_SCRIPTS_STDOUT = [
  '',
  'added 792 packages, and audited 822 packages in 26s',
  '',
  '179 packages are looking for funding',
  '  run `npm fund` for details',
  '',
  '10 vulnerabilities (2 moderate, 8 high)',
  '',
  'To address issues that do not require attention, run:',
  '  npm audit fix',
  '',
  'To address all issues (including breaking changes), run:',
  '  npm audit fix --force',
  '',
  'Run `npm audit` for details.',
].join('\n');

/** probe-builder-ignore.stdout: positive control: builder file set, `npm ci --legacy-peer-deps --ignore-scripts`, exit 0, wall 40.4s. Extent: whole file. */
export const HOST_BUILDER_IGNORE_SCRIPTS_STDOUT = [
  '',
  'added 1066 packages, and audited 1096 packages in 40s',
  '',
  '254 packages are looking for funding',
  '  run `npm fund` for details',
  '',
  '15 vulnerabilities (5 moderate, 10 high)',
  '',
  'To address issues that do not require attention, run:',
  '  npm audit fix',
  '',
  'To address all issues (including breaking changes), run:',
  '  npm audit fix --force',
  '',
  'Run `npm audit` for details.',
].join('\n');

/** probe-net3.stderr: network-blocked control: empty cache, registry ECONNREFUSED, npm 10.9.7 exit 1 ("Exit handler never called!"). Extent: whole file. */
export const HOST_NETWORK_FAILURE_STDERR = [
  'npm error Exit handler never called!',
  'npm error This is an error with npm itself. Please report this error at:',
  'npm error   <https://github.com/npm/cli/issues>',
  'npm error A complete log of this run can be found in: /tmp/claude-0/-home-user-Milj-beslut-V1-2/615d3f00-15b1-5229-8425-a287dfd450e5/scratchpad/emptycache/_logs/2026-09-30T11_48_56_488Z-debug-0.log',
].join('\n');

/** dk-npmview-host.log: `RUN npm view npm version` with --network host and NO CA prelude: SELF_SIGNED_CERT_IN_CHAIN, inner exit 1, docker exit 1. Extent: whole file. */
export const DOCKER_TLS_FAILURE_OUTPUT = [
  '#0 building with "default" instance using docker driver',
  '',
  '#1 [internal] load build definition from Dockerfile',
  '#1 transferring dockerfile: 82B done',
  '#1 DONE 0.0s',
  '',
  '#2 [internal] load metadata for docker.io/library/node:22-alpine',
  '#2 DONE 0.0s',
  '',
  '#3 [internal] load .dockerignore',
  '#3 transferring context: 2B done',
  '#3 DONE 0.0s',
  '',
  '#4 [1/2] FROM docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402',
  '#4 resolve docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 0.0s done',
  '#4 CACHED',
  '',
  '#5 [2/2] RUN npm view npm version',
  '#5 70.65 npm error code SELF_SIGNED_CERT_IN_CHAIN',
  '#5 70.66 npm error errno SELF_SIGNED_CERT_IN_CHAIN',
  '#5 70.66 npm error request to https://registry.npmjs.org/npm failed, reason: self-signed certificate in certificate chain',
  '#5 70.66 npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T11_45_51_874Z-debug-0.log',
  '#5 ERROR: process "/bin/sh -c npm view npm version" did not complete successfully: exit code: 1',
  '------',
  ' > [2/2] RUN npm view npm version:',
  '70.65 npm error code SELF_SIGNED_CERT_IN_CHAIN',
  '70.66 npm error errno SELF_SIGNED_CERT_IN_CHAIN',
  '70.66 npm error request to https://registry.npmjs.org/npm failed, reason: self-signed certificate in certificate chain',
  '70.66 npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T11_45_51_874Z-debug-0.log',
  '------',
  'Dockerfile:2',
  '--------------------',
  '   1 |     FROM node:22-alpine',
  '   2 | >>> RUN npm view npm version',
  '   3 |     ',
  '--------------------',
  'ERROR: failed to build: failed to solve: process "/bin/sh -c npm view npm version" did not complete successfully: exit code: 1',
].join('\n');

/** dk-trivial.log: trivial RUN under the default build network with a --bridge=none daemon: "network bridge not found", docker exit 1. Extent: whole file. */
export const DOCKER_NETWORK_BRIDGE_FAILURE_OUTPUT = [
  '#0 building with "default" instance using docker driver',
  '',
  '#1 [internal] load build definition from Dockerfile',
  '#1 transferring dockerfile: 86B done',
  '#1 DONE 0.0s',
  '',
  '#2 [internal] load metadata for docker.io/library/node:22-alpine',
  '#2 DONE 0.0s',
  '',
  '#3 [internal] load .dockerignore',
  '#3 transferring context: 2B done',
  '#3 DONE 0.0s',
  '',
  '#4 [1/2] FROM docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402',
  '#4 resolve docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 0.0s done',
  '#4 DONE 0.1s',
  '',
  '#5 [2/2] RUN node -e "console.log(1)"',
  '#5 ERROR: process "/bin/sh -c node -e \\"console.log(1)\\"" did not complete successfully: network bridge not found',
  '------',
  ' > [2/2] RUN node -e "console.log(1)":',
  '------',
  'Dockerfile:2',
  '--------------------',
  '   1 |     FROM node:22-alpine',
  '   2 | >>> RUN node -e "console.log(1)"',
  '   3 |     ',
  '--------------------',
  'ERROR: failed to build: failed to solve: process "/bin/sh -c node -e \\"console.log(1)\\"" did not complete successfully: network bridge not found',
].join('\n');

/** dk-exit7.log: `RUN exit 7`: docker exit 1, inner code only in text ("exit code: 7"). Extent: whole file. */
export const DOCKER_INNER_EXIT7_OUTPUT = [
  '#0 building with "default" instance using docker driver',
  '',
  '#1 [internal] load build definition from Dockerfile',
  '#1 transferring dockerfile: 68B done',
  '#1 DONE 0.0s',
  '',
  '#2 [internal] load metadata for docker.io/library/node:22-alpine',
  '#2 DONE 0.0s',
  '',
  '#3 [internal] load .dockerignore',
  '#3 transferring context: 2B done',
  '#3 DONE 0.0s',
  '',
  '#4 [1/2] FROM docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402',
  '#4 resolve docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402',
  '#4 resolve docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 0.0s done',
  '#4 CACHED',
  '',
  '#5 [2/2] RUN exit 7',
  '#5 ERROR: process "/bin/sh -c exit 7" did not complete successfully: exit code: 7',
  '------',
  ' > [2/2] RUN exit 7:',
  '------',
  'Dockerfile:2',
  '--------------------',
  '   1 |     FROM node:22-alpine',
  '   2 | >>> RUN exit 7',
  '   3 |     ',
  '--------------------',
  'ERROR: failed to build: failed to solve: process "/bin/sh -c exit 7" did not complete successfully: exit code: 7',
].join('\n');

/** Working directories of the host runs (the `Error: Cannot find module` paths are absolute under these). */
export const HOST_PRODUCTION_BASE_WORKDIR =
  '/tmp/claude-0/-home-user-Milj-beslut-V1-2/615d3f00-15b1-5229-8425-a287dfd450e5/scratchpad/probe-pb';
export const HOST_BUILDER_WORKDIR =
  '/tmp/claude-0/-home-user-Milj-beslut-V1-2/615d3f00-15b1-5229-8425-a287dfd450e5/scratchpad/probe-builder';
/** WORKDIR of the docker runs (Dockerfile:13). */
export const DOCKER_WORKDIR = '/app';

/** docker CLI 29.3.1 against the absent default socket (grounding report section 4; `docker info` exit 1). */
export const DOCKER_DAEMON_UNREACHABLE_STDERR =
  'failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory';

/** Identity and lifecycle scripts of the probed package.json (HEAD e617c7b7, package.json:2,4,46). */
export const PROBED_PACKAGE_IDENTITY = { name: 'miljobeslut-se-2.0', version: '0.0.0' } as const;
export const PROBED_POSTINSTALL_SCRIPT =
  'node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs';
export const PROBED_LIFECYCLE_PATHS = [
  'scripts/postinstall-prisma-generate.mjs',
  'scripts/copy-cesium-assets.cjs',
] as const;
export const PRODUCTION_BASE_INSTALL_COMMAND = 'npm ci --omit=dev --legacy-peer-deps';
export const BUILDER_INSTALL_COMMAND = 'npm ci --legacy-peer-deps';

/**
 * R1 fix-round captures (2026-09-30, npm 10.9.7 / node v22.22.2 / docker 29.3.1), verbatim.
 */

/** enoent/run-stderr.log: `npm run build` in a directory WITHOUT package.json, exit 254. Extent: whole file (the path redaction `***` is npm's own). */
export const HOST_MISSING_PACKAGE_JSON_STDERR = [
  'npm error code ENOENT',
  'npm error syscall open',
  'npm error path /tmp/claude-0/-home-user-Milj-beslut-V1-2/615d3f00-15b1-5229-8425-a287dfd450e5/scratchpad/enoent/package.json',
  'npm error errno -2',
  "npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/tmp/claude-0/-home-user-Milj-beslut-V1-2/***/scratchpad/enoent/package.json'",
  'npm error enoent This is related to npm not being able to find a file.',
  'npm error enoent',
  'npm error A complete log of this run can be found in: /root/.npm/_logs/2026-09-30T13_48_31_212Z-debug-0.log',
].join('\n');

/** enoent/stderr.log: `npm ci --omit=dev --legacy-peer-deps` in a directory holding neither package.json nor package-lock.json, exit 1: no lifecycle banner, none of the BLOCKED signatures. Extent: first 6 lines (the usage text that follows carries no signature). */
export const HOST_NO_MANIFEST_EUSAGE_STDERR = [
  'npm error code EUSAGE',
  'npm error',
  'npm error The `npm ci` command can only install with an existing package-lock.json or',
  'npm error npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or',
  'npm error later to generate a package-lock.json file, then try again.',
  'npm error',
].join('\n');

/** execform/build.log line 21: BuildKit plain-progress step header of `RUN ["node", "-e", "1"]` (Dockerfile: FROM node:22-alpine / WORKDIR /app / RUN ["node", "-e", "1"]), docker exit 0. */
export const DOCKER_EXEC_FORM_STEP_HEADER = '#6 [3/3] RUN ["node", "-e", "1"]';
