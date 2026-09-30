import { describe, expect, it } from 'vitest';
import {
  BLOCKED_OUTPUT_SIGNATURES,
  classifyInstallProbeOutput,
  RED_REASON_CODE,
  RED_TRUNCATED_REASON_CODE,
  type InstallProbeOutputInput,
} from '../src/docker/classify';
import { dockerInstallStepStarted } from '../src/docker/executors';
import {
  BUILDER_INSTALL_COMMAND,
  DOCKER_BUILDER_RED_OUTPUT,
  DOCKER_DAEMON_UNREACHABLE_STDERR,
  DOCKER_INNER_EXIT7_OUTPUT,
  DOCKER_NETWORK_BRIDGE_FAILURE_OUTPUT,
  DOCKER_PRODUCTION_BASE_RED_OUTPUT,
  DOCKER_TLS_FAILURE_OUTPUT,
  DOCKER_WORKDIR,
  HOST_BUILDER_IGNORE_SCRIPTS_STDOUT,
  HOST_BUILDER_RED_STDERR,
  HOST_BUILDER_RED_STDOUT,
  HOST_BUILDER_WORKDIR,
  HOST_NETWORK_FAILURE_STDERR,
  HOST_PRODUCTION_BASE_IGNORE_SCRIPTS_STDOUT,
  HOST_PRODUCTION_BASE_RED_STDERR,
  HOST_PRODUCTION_BASE_RED_STDOUT,
  HOST_PRODUCTION_BASE_WORKDIR,
  PROBED_LIFECYCLE_PATHS,
  PROBED_PACKAGE_IDENTITY,
  PROBED_POSTINSTALL_SCRIPT,
  PRODUCTION_BASE_INSTALL_COMMAND,
} from './fixtures/probe-signatures';

/** Defaults model the production-base docker probe; each case overrides what differs. */
function input(overrides: Partial<InstallProbeOutputInput>): InstallProbeOutputInput {
  return {
    output: DOCKER_PRODUCTION_BASE_RED_OUTPUT,
    exitStatus: 1,
    timedOut: false,
    installStepStarted: true,
    lifecyclePaths: [...PROBED_LIFECYCLE_PATHS],
    lifecycleScriptStrings: [PROBED_POSTINSTALL_SCRIPT],
    workdir: DOCKER_WORKDIR,
    installCommand: PRODUCTION_BASE_INSTALL_COMMAND,
    packageIdentity: PROBED_PACKAGE_IDENTITY,
    ...overrides,
  };
}

const DOCKER_PB = input({
  installStepStarted: dockerInstallStepStarted(
    DOCKER_PRODUCTION_BASE_RED_OUTPUT,
    PRODUCTION_BASE_INSTALL_COMMAND,
  ),
});
const DOCKER_BUILDER = input({
  output: DOCKER_BUILDER_RED_OUTPUT,
  installCommand: BUILDER_INSTALL_COMMAND,
  installStepStarted: dockerInstallStepStarted(DOCKER_BUILDER_RED_OUTPUT, BUILDER_INSTALL_COMMAND),
});
const HOST_PB = input({
  output: `${HOST_PRODUCTION_BASE_RED_STDOUT}\n${HOST_PRODUCTION_BASE_RED_STDERR}`,
  workdir: HOST_PRODUCTION_BASE_WORKDIR,
});
const HOST_BUILDER = input({
  output: `${HOST_BUILDER_RED_STDOUT}\n${HOST_BUILDER_RED_STDERR}`,
  workdir: HOST_BUILDER_WORKDIR,
  installCommand: BUILDER_INSTALL_COMMAND,
});

describe('classifyInstallProbeOutput: RED confirmed on the verbatim captured signatures', () => {
  it('docker production-base: FAIL with the four signature lines + the docker step error', () => {
    expect(DOCKER_PB.installStepStarted).toBe(true);
    const result = classifyInstallProbeOutput(DOCKER_PB);
    expect(result.classification).toBe('FAIL');
    expect(result.reasonCode).toBe(RED_REASON_CODE);
    expect(result.matched).toEqual([
      '#12 39.47 > miljobeslut-se-2.0@0.0.0 postinstall',
      "#12 39.54 Error: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs'",
      "#12 39.54   code: 'MODULE_NOT_FOUND',",
      '#12 39.55 npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
      '#12 ERROR: process "/bin/sh -c npm ci --omit=dev --legacy-peer-deps" did not complete successfully: exit code: 1',
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.matched)).toBe(true);
  });

  it('docker builder: FAIL with the identical signature', () => {
    expect(DOCKER_BUILDER.installStepStarted).toBe(true);
    const result = classifyInstallProbeOutput(DOCKER_BUILDER);
    expect(result.classification).toBe('FAIL');
    expect(result.reasonCode).toBe(RED_REASON_CODE);
    expect(result.matched).toEqual([
      '#13 44.95 > miljobeslut-se-2.0@0.0.0 postinstall',
      "#13 45.04 Error: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs'",
      "#13 45.04   code: 'MODULE_NOT_FOUND',",
      '#13 45.05 npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
      '#13 ERROR: process "/bin/sh -c npm ci --legacy-peer-deps" did not complete successfully: exit code: 1',
    ]);
  });

  it('host production-base: FAIL with the same signature (path relativised to the host temp dir)', () => {
    const result = classifyInstallProbeOutput(HOST_PB);
    expect(result.classification).toBe('FAIL');
    expect(result.reasonCode).toBe(RED_REASON_CODE);
    expect(result.matched).toEqual([
      '> miljobeslut-se-2.0@0.0.0 postinstall',
      `Error: Cannot find module '${HOST_PRODUCTION_BASE_WORKDIR}/scripts/postinstall-prisma-generate.mjs'`,
      "  code: 'MODULE_NOT_FOUND',",
      'npm error command sh -c node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
    ]);
  });

  it('host builder: FAIL', () => {
    const result = classifyInstallProbeOutput(HOST_BUILDER);
    expect(result.classification).toBe('FAIL');
    expect(result.reasonCode).toBe(RED_REASON_CODE);
    expect(result.matched[1]).toBe(
      `Error: Cannot find module '${HOST_BUILDER_WORKDIR}/scripts/postinstall-prisma-generate.mjs'`,
    );
  });

  it('host and docker samples of the same stage classify identically', () => {
    for (const [host, docker] of [
      [HOST_PB, DOCKER_PB],
      [HOST_BUILDER, DOCKER_BUILDER],
    ] as const) {
      const a = classifyInstallProbeOutput(host);
      const b = classifyInstallProbeOutput(docker);
      expect([a.classification, a.reasonCode]).toEqual([b.classification, b.reasonCode]);
      expect(a.matched.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('a truncated log (no code line, no npm error command) is still FAIL, never PASS', () => {
    const truncated = DOCKER_PRODUCTION_BASE_RED_OUTPUT.split('\n')
      .filter(
        (line) => !line.includes("code: 'MODULE_NOT_FOUND'") && !line.includes('npm error command sh -c'),
      )
      .join('\n');
    const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, output: truncated }));
    expect(result.classification).toBe('FAIL');
    expect(result.reasonCode).toBe(RED_TRUNCATED_REASON_CODE);
    expect(result.matched[0]).toBe('#12 39.47 > miljobeslut-se-2.0@0.0.0 postinstall');
  });
});

describe('classifyInstallProbeOutput: the FAIL predicate is bound to the candidate (solution neutrality)', () => {
  it('the same output with an empty lifecycle path set (hook removed) is not the asserted failure', () => {
    const result = classifyInstallProbeOutput(
      input({ ...DOCKER_PB, lifecyclePaths: [], lifecycleScriptStrings: [] }),
    );
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe('INSTALL_FAILED_OTHER');
    expect(result.matched).toContain('#12 39.55 npm error code 1');
  });

  it('a Cannot-find-module on a path that is not a lifecycle path is not the asserted failure', () => {
    const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, lifecyclePaths: ['scripts/other.mjs'] }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe('INSTALL_FAILED_OTHER');
  });

  it('the banner must name the probed package identity', () => {
    const result = classifyInstallProbeOutput(
      input({ ...DOCKER_PB, packageIdentity: { name: 'other-package', version: '9.9.9' } }),
    );
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe('INSTALL_FAILED_OTHER');
  });

  it('the Cannot-find-module path is relativised to the declared workdir', () => {
    const result = classifyInstallProbeOutput(input({ ...HOST_PB, workdir: '/somewhere/else' }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe('INSTALL_FAILED_OTHER');
  });
});

describe('classifyInstallProbeOutput: positive controls PASS', () => {
  it('--ignore-scripts host runs (exit 0) PASS as INSTALL_COMPLETED', () => {
    for (const output of [HOST_PRODUCTION_BASE_IGNORE_SCRIPTS_STDOUT, HOST_BUILDER_IGNORE_SCRIPTS_STDOUT]) {
      const result = classifyInstallProbeOutput(
        input({ output, exitStatus: 0, workdir: HOST_PRODUCTION_BASE_WORKDIR }),
      );
      expect(result).toEqual({ classification: 'PASS', reasonCode: 'INSTALL_COMPLETED', matched: [] });
    }
  });

  it('an inner failure with none of the signatures is INSTALL_FAILED_OTHER (visible, but PASS for this probe)', () => {
    const result = classifyInstallProbeOutput(input({ output: DOCKER_INNER_EXIT7_OUTPUT, exitStatus: 1 }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe('INSTALL_FAILED_OTHER');
    expect(result.matched).toEqual([
      '#5 ERROR: process "/bin/sh -c exit 7" did not complete successfully: exit code: 7',
    ]);
  });
});

describe('classifyInstallProbeOutput: BLOCKED (environment), never PASS or FAIL', () => {
  it('network-blocked npm (Exit handler never called!)', () => {
    const result = classifyInstallProbeOutput(input({ output: HOST_NETWORK_FAILURE_STDERR, workdir: '/x' }));
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe('NPM_EXIT_HANDLER_NEVER_CALLED');
    expect(result.matched).toEqual(['npm error Exit handler never called!']);
  });

  it('TLS interception without the CA prelude (SELF_SIGNED_CERT_IN_CHAIN)', () => {
    const result = classifyInstallProbeOutput(
      input({
        output: DOCKER_TLS_FAILURE_OUTPUT,
        installStepStarted: dockerInstallStepStarted(
          DOCKER_TLS_FAILURE_OUTPUT,
          PRODUCTION_BASE_INSTALL_COMMAND,
        ),
      }),
    );
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe('TLS_NOT_TRUSTED');
    expect(result.matched[0]).toBe('#5 70.65 npm error code SELF_SIGNED_CERT_IN_CHAIN');
  });

  it('default build network on a --bridge=none daemon (network bridge not found)', () => {
    const result = classifyInstallProbeOutput(
      input({ output: DOCKER_NETWORK_BRIDGE_FAILURE_OUTPUT, installStepStarted: false }),
    );
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe('DOCKER_NETWORK_UNAVAILABLE');
  });

  it('daemon unreachable (docker CLI stderr)', () => {
    const result = classifyInstallProbeOutput(
      input({ output: DOCKER_DAEMON_UNREACHABLE_STDERR, installStepStarted: false }),
    );
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe('DOCKER_UNAVAILABLE');
    expect(result.matched).toEqual([DOCKER_DAEMON_UNREACHABLE_STDERR]);
  });

  it('other T1 signatures: daemon socket permission, ECONNREFUSED/ENOTFOUND/EAI_AGAIN/ETIMEDOUT, failed to pull', () => {
    const cases: readonly [string, string][] = [
      [
        'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock',
        'DOCKER_UNAVAILABLE',
      ],
      [
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
        'DOCKER_UNAVAILABLE',
      ],
      [
        'npm error network request to https://registry.npmjs.org/x failed, reason: connect ECONNREFUSED 127.0.0.1:443',
        'NETWORK_UNREACHABLE',
      ],
      ['npm error errno ENOTFOUND', 'NETWORK_UNREACHABLE'],
      [
        'npm error FetchError: request to https://registry.npmjs.org/x failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org',
        'NETWORK_UNREACHABLE',
      ],
      ['npm error code ETIMEDOUT', 'NETWORK_UNREACHABLE'],
      [
        'ERROR: failed to solve: node:22-alpine: failed to resolve source metadata for docker.io/library/node:22-alpine',
        'IMAGE_OR_FETCH_FAILED',
      ],
      [
        'WARNING: updating https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/APKINDEX.tar.gz: TLS: server certificate not trusted',
        'TLS_NOT_TRUSTED',
      ],
    ];
    for (const [line, reasonCode] of cases) {
      const result = classifyInstallProbeOutput(
        input({ output: `noise\n${line}\nmore noise`, installStepStarted: false }),
      );
      expect(result.classification, line).toBe('BLOCKED');
      expect(result.reasonCode, line).toBe(reasonCode);
      expect(result.matched, line).toEqual([line]);
    }
    expect(BLOCKED_OUTPUT_SIGNATURES.length).toBeGreaterThanOrEqual(9);
  });

  it('spawn errors, timeouts, signal kills and a never-started install step', () => {
    expect(
      classifyInstallProbeOutput(
        input({ output: '', spawnError: { code: 'ENOENT', message: 'spawn docker ENOENT' } }),
      ),
    ).toEqual({
      classification: 'BLOCKED',
      reasonCode: 'SPAWN_ENOENT',
      matched: ['spawn docker ENOENT'],
    });
    expect(
      classifyInstallProbeOutput(
        input({ output: '', spawnError: { code: 'EACCES', message: 'spawn docker EACCES' } }),
      ).reasonCode,
    ).toBe('SPAWN_EACCES');
    expect(
      classifyInstallProbeOutput(input({ output: '', spawnError: { message: 'boom' } })).reasonCode,
    ).toBe('SPAWN_ERROR');
    expect(
      classifyInstallProbeOutput(input({ ...DOCKER_PB, timedOut: true, exitStatus: null })).reasonCode,
    ).toBe('TIMEOUT');
    expect(classifyInstallProbeOutput(input({ ...DOCKER_PB, exitStatus: null })).reasonCode).toBe(
      'KILLED_BY_SIGNAL',
    );
    const notStarted = classifyInstallProbeOutput(input({ ...DOCKER_PB, installStepStarted: false }));
    expect(notStarted).toEqual({
      classification: 'BLOCKED',
      reasonCode: 'INSTALL_STEP_NOT_STARTED',
      matched: [],
    });
  });

  it('a BLOCKED signature takes precedence over the FAIL signature (grounding section 6 order)', () => {
    const result = classifyInstallProbeOutput(
      input({
        ...DOCKER_PB,
        output: `${DOCKER_PRODUCTION_BASE_RED_OUTPUT}\nnpm error Exit handler never called!`,
      }),
    );
    expect(result.classification).toBe('BLOCKED');
  });
});

describe('dockerInstallStepStarted', () => {
  it('matches the BuildKit step header of the derived install command only', () => {
    expect(dockerInstallStepStarted(DOCKER_PRODUCTION_BASE_RED_OUTPUT, PRODUCTION_BASE_INSTALL_COMMAND)).toBe(
      true,
    );
    expect(dockerInstallStepStarted(DOCKER_PRODUCTION_BASE_RED_OUTPUT, BUILDER_INSTALL_COMMAND)).toBe(false);
    expect(dockerInstallStepStarted(DOCKER_BUILDER_RED_OUTPUT, BUILDER_INSTALL_COMMAND)).toBe(true);
    expect(dockerInstallStepStarted(DOCKER_BUILDER_RED_OUTPUT, PRODUCTION_BASE_INSTALL_COMMAND)).toBe(false);
    expect(dockerInstallStepStarted(DOCKER_TLS_FAILURE_OUTPUT, PRODUCTION_BASE_INSTALL_COMMAND)).toBe(false);
    expect(dockerInstallStepStarted(DOCKER_NETWORK_BRIDGE_FAILURE_OUTPUT, 'npm ci')).toBe(false);
  });
});
