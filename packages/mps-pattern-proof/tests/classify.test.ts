import { describe, expect, it } from 'vitest';
import {
  BLOCKED_OUTPUT_SIGNATURES,
  canonicalLifecyclePath,
  classifyInstallProbeOutput,
  INSTALL_COMPLETED_REASON_CODE,
  INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT_REASON_CODE,
  INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE,
  INSTALL_FAILED_UNATTRIBUTED_REASON_CODE,
  LIFECYCLE_RUNNER_UNSUPPORTED_REASON_CODE,
  RED_REASON_CODE,
  RED_TRUNCATED_REASON_CODE,
  resolvedLifecyclePath,
  type InstallProbeOutputInput,
} from '../src/docker/classify';
import { parseDockerfile } from '../src/docker/dockerfile-parse';
import { dockerInstallStepStarted, installStepHeaders } from '../src/docker/executors';
import { lifecycleScriptPaths, lifecycleScriptStrings } from '../src/docker/lifecycle-scripts';
import {
  BUILDER_INSTALL_COMMAND,
  DOCKER_BUILDER_RED_OUTPUT,
  DOCKER_DAEMON_UNREACHABLE_STDERR,
  DOCKER_EXEC_FORM_STEP_HEADER,
  DOCKER_INNER_EXIT7_OUTPUT,
  DOCKER_NETWORK_BRIDGE_FAILURE_OUTPUT,
  DOCKER_PRODUCTION_BASE_RED_OUTPUT,
  DOCKER_TLS_FAILURE_OUTPUT,
  DOCKER_WORKDIR,
  HOST_BUILDER_IGNORE_SCRIPTS_STDOUT,
  HOST_BUILDER_RED_STDERR,
  HOST_BUILDER_RED_STDOUT,
  HOST_BUILDER_WORKDIR,
  HOST_MISSING_PACKAGE_JSON_STDERR,
  HOST_NETWORK_FAILURE_STDERR,
  HOST_NO_MANIFEST_EUSAGE_STDERR,
  HOST_PRODUCTION_BASE_IGNORE_SCRIPTS_STDOUT,
  HOST_PRODUCTION_BASE_RED_STDERR,
  HOST_PRODUCTION_BASE_RED_STDOUT,
  HOST_PRODUCTION_BASE_WORKDIR,
  PROBED_LIFECYCLE_PATHS,
  PROBED_PACKAGE_IDENTITY,
  PROBED_POSTINSTALL_SCRIPT,
  PRODUCTION_BASE_INSTALL_COMMAND,
} from './fixtures/probe-signatures';

const DOCKER_PB_BANNER = '#12 39.47 > miljobeslut-se-2.0@0.0.0 postinstall';
const DOCKER_PB_STEP_FAILED =
  '#12 ERROR: process "/bin/sh -c npm ci --omit=dev --legacy-peer-deps" did not complete successfully: exit code: 1';

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
  // R1 F2: these cases were PASS INSTALL_FAILED_OTHER before the fix round. A failed install is now
  // PASS only when the probed package's lifecycle banner proves the script was found and ran
  // (INSTALL_FAILED_AFTER_LIFECYCLE_STARTED); without the banner it is BLOCKED, never PASS.
  it('the same output with an empty lifecycle path set (hook removed) is not the asserted failure', () => {
    const result = classifyInstallProbeOutput(
      input({ ...DOCKER_PB, lifecyclePaths: [], lifecycleScriptStrings: [] }),
    );
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe(INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE);
    expect(result.matched[0]).toBe(DOCKER_PB_BANNER);
    expect(result.matched).toContain('#12 39.55 npm error code 1');
    expect(result.matched).toContain(DOCKER_PB_STEP_FAILED);
  });

  it('a Cannot-find-module on a path that is not a lifecycle path is not the asserted failure', () => {
    const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, lifecyclePaths: ['scripts/other.mjs'] }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe(INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE);
    expect(result.matched[0]).toBe(DOCKER_PB_BANNER);
  });

  it('the banner must name the probed package identity: without it a failed install is BLOCKED (R1 F2)', () => {
    const result = classifyInstallProbeOutput(
      input({ ...DOCKER_PB, packageIdentity: { name: 'other-package', version: '9.9.9' } }),
    );
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe(INSTALL_FAILED_UNATTRIBUTED_REASON_CODE);
    expect(result.matched).toEqual(['#12 39.55 npm error code 1', DOCKER_PB_STEP_FAILED]);
  });

  it('the Cannot-find-module path is relativised to the declared workdir', () => {
    const result = classifyInstallProbeOutput(input({ ...HOST_PB, workdir: '/somewhere/else' }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe(INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE);
    expect(result.matched[0]).toBe('> miljobeslut-se-2.0@0.0.0 postinstall');
  });
});

describe('classifyInstallProbeOutput: lifecycle-path normalization on the UNCHANGED captured RED output (R1 F1)', () => {
  const shapes: readonly [string, readonly string[]][] = [
    ['./-prefixed path', ['./scripts/postinstall-prisma-generate.mjs']],
    ['doubled separator', ['scripts//postinstall-prisma-generate.mjs']],
    ['dot segment', ['scripts/./postinstall-prisma-generate.mjs']],
    ['absolute path under the workdir', ['/app/scripts/postinstall-prisma-generate.mjs']],
    [
      'absolute path with trailing slash on the workdir side',
      ['/app/./scripts/postinstall-prisma-generate.mjs'],
    ],
  ];
  for (const [label, lifecyclePaths] of shapes) {
    it(`docker production-base stays FAIL when L is spelled as a ${label}`, () => {
      const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, lifecyclePaths }));
      expect(result.classification, label).toBe('FAIL');
      expect(result.reasonCode, label).toBe(RED_REASON_CODE);
    });
  }

  it('host production-base stays FAIL for the ./ shape (absolute module path relativised, then normalized)', () => {
    const result = classifyInstallProbeOutput(
      input({ ...HOST_PB, lifecyclePaths: ['./scripts/postinstall-prisma-generate.mjs'] }),
    );
    expect(result.classification).toBe('FAIL');
    expect(result.reasonCode).toBe(RED_REASON_CODE);
  });

  it('the workdir may carry a trailing slash or dot segments', () => {
    for (const workdir of ['/app/', '/app/.', '//app']) {
      const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, workdir }));
      expect(result.classification, workdir).toBe('FAIL');
    }
    expect(canonicalLifecyclePath('/app/scripts/x.mjs', '/app/')).toBe('scripts/x.mjs');
    expect(canonicalLifecyclePath('./scripts/x.mjs', '/app')).toBe('scripts/x.mjs');
    expect(canonicalLifecyclePath('/elsewhere/scripts/x.mjs', '/app')).toBe('/elsewhere/scripts/x.mjs');
  });

  it('package.json rewrites that keep the same script derive the same FAIL: ./, `npm run <name>`, `||`, `|`, absolute', () => {
    const rewrites: readonly Readonly<Record<string, string>>[] = [
      {
        postinstall: 'node ./scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs',
      },
      { postinstall: 'npm run gen', gen: 'node scripts/postinstall-prisma-generate.mjs' },
      { postinstall: 'node scripts/other.mjs || node scripts/postinstall-prisma-generate.mjs' },
      { postinstall: 'node scripts/postinstall-prisma-generate.mjs | cat' },
      { postinstall: 'node /app/scripts/postinstall-prisma-generate.mjs' },
    ];
    for (const scripts of rewrites) {
      const packageJson = { ...PROBED_PACKAGE_IDENTITY, scripts };
      const lifecyclePaths = lifecycleScriptPaths(packageJson);
      const result = classifyInstallProbeOutput(
        input({ ...DOCKER_PB, lifecyclePaths, lifecycleScriptStrings: lifecycleScriptStrings(packageJson) }),
      );
      expect(result.classification, scripts.postinstall).toBe('FAIL');
      // the captured `npm error command sh -c` line names the ORIGINAL script, so a rewrite is the
      // truncated variant unless the raw string is unchanged; RED is confirmed either way
      expect([RED_REASON_CODE, RED_TRUNCATED_REASON_CODE], scripts.postinstall).toContain(result.reasonCode);
    }
  });

  it('a lifecycle script without any `node <path>` (npx/tsx/sh runner) makes a FAILED install BLOCKED, never PASS', () => {
    const runners = ['npx prisma generate', 'tsx scripts/postinstall.ts', 'sh scripts/postinstall.sh'];
    for (const postinstall of runners) {
      const packageJson = { ...PROBED_PACKAGE_IDENTITY, scripts: { postinstall } };
      const lifecyclePaths = lifecycleScriptPaths(packageJson);
      expect(lifecyclePaths, postinstall).toEqual([]);
      const failed = classifyInstallProbeOutput(
        input({ ...DOCKER_PB, lifecyclePaths, lifecycleScriptStrings: lifecycleScriptStrings(packageJson) }),
      );
      expect(failed.classification, postinstall).toBe('BLOCKED');
      expect(failed.reasonCode, postinstall).toBe(LIFECYCLE_RUNNER_UNSUPPORTED_REASON_CODE);
      expect(failed.matched[0], postinstall).toBe(postinstall);
      // a completed install (exit 0) is still PASS: the asserted behavior holds regardless of the runner
      const completed = classifyInstallProbeOutput(
        input({
          output: HOST_PRODUCTION_BASE_IGNORE_SCRIPTS_STDOUT,
          exitStatus: 0,
          workdir: HOST_PRODUCTION_BASE_WORKDIR,
          lifecyclePaths,
          lifecycleScriptStrings: lifecycleScriptStrings(packageJson),
        }),
      );
      expect(completed, postinstall).toEqual({
        classification: 'PASS',
        reasonCode: INSTALL_COMPLETED_REASON_CODE,
        matched: [],
      });
    }
  });
});

describe('classifyInstallProbeOutput: R2 F2 shapes on the UNCHANGED captured RED output (exit 1) stay FAIL', () => {
  it('a `../` lifecycle path is resolved against the workdir on both sides', () => {
    // WORKDIR /app/nested with `node ../scripts/x.mjs`: node prints /app/scripts/x.mjs
    const nested = classifyInstallProbeOutput(
      input({
        ...DOCKER_PB,
        workdir: '/app/nested',
        lifecyclePaths: ['../scripts/postinstall-prisma-generate.mjs'],
      }),
    );
    expect(nested.classification).toBe('FAIL');
    expect(nested.reasonCode).toBe(RED_REASON_CODE);
    // WORKDIR /app with `node ../app/scripts/x.mjs`
    const roundTrip = classifyInstallProbeOutput(
      input({ ...DOCKER_PB, lifecyclePaths: ['../app/scripts/postinstall-prisma-generate.mjs'] }),
    );
    expect(roundTrip.classification).toBe('FAIL');
    expect(roundTrip.reasonCode).toBe(RED_REASON_CODE);
    expect(resolvedLifecyclePath('../scripts/x.mjs', '/app/nested')).toBe('/app/scripts/x.mjs');
    expect(resolvedLifecyclePath('/app/scripts/x.mjs', '/app/nested')).toBe('/app/scripts/x.mjs');
    expect(resolvedLifecyclePath('./scripts/x.mjs', '/app/')).toBe('/app/scripts/x.mjs');
    // a relative workdir never consults process.cwd()
    expect(resolvedLifecyclePath('scripts/x.mjs', 'app')).toBe('/app/scripts/x.mjs');
    // a `../` path that resolves to ANOTHER file is honestly not a member of L
    const elsewhere = classifyInstallProbeOutput(
      input({ ...DOCKER_PB, lifecyclePaths: ['../scripts/postinstall-prisma-generate.mjs'] }),
    );
    expect(elsewhere.classification).toBe('PASS');
    expect(elsewhere.reasonCode).toBe(INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE);
  });

  it('a quoted script path in package.json derives the unquoted member of L', () => {
    for (const postinstall of [
      "node 'scripts/postinstall-prisma-generate.mjs'",
      'node "scripts/postinstall-prisma-generate.mjs"',
    ]) {
      const packageJson = { ...PROBED_PACKAGE_IDENTITY, scripts: { postinstall } };
      const lifecyclePaths = lifecycleScriptPaths(packageJson);
      expect(lifecyclePaths, postinstall).toEqual(['scripts/postinstall-prisma-generate.mjs']);
      const result = classifyInstallProbeOutput(
        input({ ...DOCKER_PB, lifecyclePaths, lifecycleScriptStrings: lifecycleScriptStrings(packageJson) }),
      );
      expect(result.classification, postinstall).toBe('FAIL');
      expect([RED_REASON_CODE, RED_TRUNCATED_REASON_CODE], postinstall).toContain(result.reasonCode);
    }
  });

  it('the ESM loader shape (`Error [ERR_MODULE_NOT_FOUND]: ... imported from`, `code: ERR_MODULE_NOT_FOUND`) is the same FAIL', () => {
    const esm = DOCKER_PRODUCTION_BASE_RED_OUTPUT.replace(
      "Error: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs'",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs' imported from /app/scripts/postinstall.mjs",
    ).replace("code: 'MODULE_NOT_FOUND'", "code: 'ERR_MODULE_NOT_FOUND'");
    expect(esm).not.toBe(DOCKER_PRODUCTION_BASE_RED_OUTPUT);
    expect(esm).not.toContain("code: 'MODULE_NOT_FOUND'");
    const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, output: esm }));
    expect(result.classification).toBe('FAIL');
    expect(result.reasonCode).toBe(RED_REASON_CODE);
    expect(result.matched.some((line) => line.includes('[ERR_MODULE_NOT_FOUND]: Cannot find module'))).toBe(
      true,
    );
    expect(result.matched.some((line) => line.includes("code: 'ERR_MODULE_NOT_FOUND'"))).toBe(true);
    // the ESM shape on a path outside L is still not the asserted failure
    const foreign = classifyInstallProbeOutput(
      input({ ...DOCKER_PB, output: esm, lifecyclePaths: ['scripts/other.mjs'] }),
    );
    expect(foreign.classification).toBe('PASS');
    expect(foreign.reasonCode).toBe(INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE);
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

  it('exit 0 whose log carries a retried-fetch ETIMEDOUT warning is PASS, not BLOCKED (R1 F11)', () => {
    const output = `npm warn tarball tarball data for x seems to be corrupted. Trying again. ETIMEDOUT retrying\n${HOST_PRODUCTION_BASE_IGNORE_SCRIPTS_STDOUT}`;
    const completed = classifyInstallProbeOutput(
      input({ output, exitStatus: 0, workdir: HOST_PRODUCTION_BASE_WORKDIR }),
    );
    expect(completed).toEqual({ classification: 'PASS', reasonCode: 'INSTALL_COMPLETED', matched: [] });
    // the same text on a FAILED install is still the BLOCKED signature
    const failed = classifyInstallProbeOutput(
      input({ output, exitStatus: 1, workdir: HOST_PRODUCTION_BASE_WORKDIR }),
    );
    expect(failed.classification).toBe('BLOCKED');
    expect(failed.reasonCode).toBe('NETWORK_UNREACHABLE');
  });

  it('exit 0 with the lifecycle error text present is PASS INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT with the masked lines (R1 F6)', () => {
    const masked = DOCKER_PRODUCTION_BASE_RED_OUTPUT.split('\n')
      .filter((line) => !line.includes('npm error') && !line.includes('did not complete successfully'))
      .join('\n');
    const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, output: masked, exitStatus: 0 }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe(INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT_REASON_CODE);
    expect(result.matched).toEqual([
      DOCKER_PB_BANNER,
      "#12 39.54 Error: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs'",
      "#12 39.54   code: 'MODULE_NOT_FOUND',",
    ]);
    // the full RED text with exit 0 (e.g. `|| true` masking) is likewise never FAIL
    const full = classifyInstallProbeOutput(input({ ...DOCKER_PB, exitStatus: 0 }));
    expect(full.classification).toBe('PASS');
    expect(full.reasonCode).toBe(INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT_REASON_CODE);
    expect(full.matched).toHaveLength(4);
  });

  it('a failed install whose banner ran but shows none of the FAIL signatures is PASS INSTALL_FAILED_AFTER_LIFECYCLE_STARTED (R1 F2)', () => {
    const noModuleError = DOCKER_PRODUCTION_BASE_RED_OUTPUT.split('\n')
      .filter((line) => !line.includes('Cannot find module'))
      .join('\n');
    const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, output: noModuleError }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe(INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE);
    expect(result.matched).toEqual([DOCKER_PB_BANNER, '#12 39.55 npm error code 1', DOCKER_PB_STEP_FAILED]);
  });

  it('docker fidelity: the `did not complete successfully` line must name the install command for FAIL (R1 F6)', () => {
    const otherStep = DOCKER_PRODUCTION_BASE_RED_OUTPUT.replace(
      /process "\/bin\/sh -c npm ci --omit=dev --legacy-peer-deps" did not complete successfully: exit code: 1/g,
      'process "/bin/sh -c npm run build" did not complete successfully: exit code: 1',
    );
    expect(otherStep).not.toBe(DOCKER_PRODUCTION_BASE_RED_OUTPUT);
    const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, output: otherStep }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe(INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE);
  });
});

describe('classifyInstallProbeOutput: a failed install without attribution is BLOCKED, never PASS (R1 F2)', () => {
  it('an inner failure with none of the signatures and no banner is INSTALL_FAILED_UNATTRIBUTED', () => {
    // was PASS INSTALL_FAILED_OTHER before the fix round
    const result = classifyInstallProbeOutput(input({ output: DOCKER_INNER_EXIT7_OUTPUT, exitStatus: 1 }));
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe(INSTALL_FAILED_UNATTRIBUTED_REASON_CODE);
    expect(result.matched).toEqual([
      '#5 ERROR: process "/bin/sh -c exit 7" did not complete successfully: exit code: 7',
    ]);
  });

  it('npm ci in a context without the manifest (captured EUSAGE, no banner) is INSTALL_FAILED_UNATTRIBUTED', () => {
    const result = classifyInstallProbeOutput(
      input({ output: HOST_NO_MANIFEST_EUSAGE_STDERR, exitStatus: 1, workdir: '/x' }),
    );
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe(INSTALL_FAILED_UNATTRIBUTED_REASON_CODE);
    expect(result.matched).toEqual(['npm error code EUSAGE']);
  });

  it('the captured `npm error code ENOENT` / `Could not read package.json` text is CONTEXT_INCOMPLETE', () => {
    const result = classifyInstallProbeOutput(
      input({ output: HOST_MISSING_PACKAGE_JSON_STDERR, exitStatus: 254, workdir: '/x' }),
    );
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe('CONTEXT_INCOMPLETE');
    expect(result.matched[0]).toBe('npm error code ENOENT');
    const readFailure = classifyInstallProbeOutput(
      input({ output: 'npm error enoent Could not read package.json: boom', exitStatus: 1, workdir: '/x' }),
    );
    expect(readFailure.reasonCode).toBe('CONTEXT_INCOMPLETE');
  });

  it('executor precondition codes in spawnError classify under their own reasonCode', () => {
    for (const code of ['CONTEXT_INCOMPLETE', 'HOST_FIDELITY_UNSUPPORTED']) {
      const result = classifyInstallProbeOutput(
        input({
          output: '',
          exitStatus: null,
          installStepStarted: false,
          spawnError: { code, message: `refused: ${code}` },
        }),
      );
      expect(result).toEqual({ classification: 'BLOCKED', reasonCode: code, matched: [`refused: ${code}`] });
    }
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

  it('an ancestor `RUN npm` / `RUN npm ci` header with no target header is NOT the target install step (R2 F7)', () => {
    const output = [
      '#4 [base 2/3] RUN npm',
      '#4 DONE 1.0s',
      '#5 [base 3/3] RUN npm ci',
      '#5 DONE 9.0s',
      '#6 [production-base 1/2] COPY package*.json ./',
      '#6 DONE 0.1s',
      '',
    ].join('\n');
    // exact equality only: the ancestor headers are prefixes of the target command, never a match
    expect(dockerInstallStepStarted(output, PRODUCTION_BASE_INSTALL_COMMAND)).toBe(false);
    expect(dockerInstallStepStarted(output, BUILDER_INSTALL_COMMAND)).toBe(false);
    expect(dockerInstallStepStarted(output, 'npm ci')).toBe(true);
    // a header that extends the target command is not the target step either
    expect(
      dockerInstallStepStarted(
        `#7 [x 1/1] RUN ${PRODUCTION_BASE_INSTALL_COMMAND} --no-audit\n`,
        PRODUCTION_BASE_INSTALL_COMMAND,
      ),
    ).toBe(false);
  });

  it('matches the captured exec-form header `RUN ["node", "-e", "1"]` when given the install instruction (R1 F7)', () => {
    const parsed = parseDockerfile('FROM node:22-alpine\nWORKDIR /app\nRUN ["node", "-e", "1"]\n');
    const instruction = parsed.stages[0].instructions[2];
    expect(instruction.args).toBe('["node", "-e", "1"]');
    const output = `#5 [2/3] WORKDIR /app\n#5 DONE 0.0s\n\n${DOCKER_EXEC_FORM_STEP_HEADER}\n#6 DONE 0.2s\n`;
    // the shell text alone (what the executor matched before the fix) does not match the header
    expect(dockerInstallStepStarted(output, 'node -e 1')).toBe(false);
    expect(dockerInstallStepStarted(output, 'node -e 1', instruction)).toBe(true);
    // a compact spelling in the candidate Dockerfile is matched through the canonical re-serialization
    const compact = parseDockerfile('FROM node:22-alpine\nRUN ["node","-e","1"]\n').stages[0].instructions[1];
    expect(dockerInstallStepStarted(output, 'node -e 1', compact)).toBe(true);
    expect(installStepHeaders('npm ci', compact)).toEqual([
      'npm ci',
      'node -e 1',
      '["node","-e","1"]',
      '["node", "-e", "1"]',
    ]);
    // shell-form headers are unaffected
    expect(
      dockerInstallStepStarted(
        DOCKER_PRODUCTION_BASE_RED_OUTPUT,
        PRODUCTION_BASE_INSTALL_COMMAND,
        parseDockerfile('FROM x\nRUN npm ci --omit=dev --legacy-peer-deps\n').stages[0].instructions[1],
      ),
    ).toBe(true);
  });

  it('R3 F1: a RUN with BuildKit flags matches the header printed as written (flags re-attached), exact-match rule kept', () => {
    const flagged = parseDockerfile(
      'FROM x\nRUN --mount=type=cache,target=/root/.npm   npm ci --omit=dev --legacy-peer-deps\n',
    ).stages[0].instructions[1];
    expect(flagged.flags).toEqual({ mount: 'type=cache,target=/root/.npm' });
    expect(flagged.flagsText).toBe('--mount=type=cache,target=/root/.npm');
    expect(installStepHeaders(PRODUCTION_BASE_INSTALL_COMMAND, flagged)).toEqual([
      PRODUCTION_BASE_INSTALL_COMMAND,
      `--mount=type=cache,target=/root/.npm ${PRODUCTION_BASE_INSTALL_COMMAND}`,
    ]);
    // the captured RED output with its header line rewritten to the instruction as written
    const withFlagHeader = DOCKER_PRODUCTION_BASE_RED_OUTPUT.replace(
      '#12 [production-base 2/2] RUN npm ci --omit=dev --legacy-peer-deps',
      '#12 [production-base 2/2] RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --legacy-peer-deps',
    );
    expect(withFlagHeader).not.toBe(DOCKER_PRODUCTION_BASE_RED_OUTPUT);
    // without the instruction (shell text only) the flagged header is not recognised ...
    expect(dockerInstallStepStarted(withFlagHeader, PRODUCTION_BASE_INSTALL_COMMAND)).toBe(false);
    // ... with the instruction it is, and the verbatim RED text then classifies FAIL, not BLOCKED
    expect(dockerInstallStepStarted(withFlagHeader, PRODUCTION_BASE_INSTALL_COMMAND, flagged)).toBe(true);
    const result = classifyInstallProbeOutput(
      input({
        output: withFlagHeader,
        installStepStarted: dockerInstallStepStarted(
          withFlagHeader,
          PRODUCTION_BASE_INSTALL_COMMAND,
          flagged,
        ),
      }),
    );
    expect(result.classification).toBe('FAIL');
    expect(result.reasonCode).toBe(RED_REASON_CODE);
    // exact match still: a different flag value, an extra flag or a flag on a different command never matches
    for (const header of [
      '#12 [production-base 2/2] RUN --mount=type=cache,target=/root/.cache npm ci --omit=dev --legacy-peer-deps',
      '#12 [production-base 2/2] RUN --mount=type=cache,target=/root/.npm --network=none npm ci --omit=dev --legacy-peer-deps',
      '#12 [production-base 2/2] RUN --mount=type=cache,target=/root/.npm npm ci',
      '#12 [production-base 2/2] RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --legacy-peer-deps --no-audit',
    ]) {
      expect(dockerInstallStepStarted(`${header}\n`, PRODUCTION_BASE_INSTALL_COMMAND, flagged), header).toBe(
        false,
      );
    }
    // several flags are re-attached in the order written; an exec-form RUN gets every shape flagged
    const two = parseDockerfile('FROM x\nRUN --mount=type=cache,target=/r --network=none npm ci\n').stages[0]
      .instructions[1];
    expect(installStepHeaders('npm ci', two)).toEqual([
      'npm ci',
      '--mount=type=cache,target=/r --network=none npm ci',
    ]);
    const exec = parseDockerfile('FROM x\nRUN --network=none ["npm","ci"]\n').stages[0].instructions[1];
    expect(installStepHeaders('npm ci', exec)).toEqual([
      'npm ci',
      '["npm","ci"]',
      '["npm", "ci"]',
      '--network=none npm ci',
      '--network=none ["npm","ci"]',
      '--network=none ["npm", "ci"]',
    ]);
    // an unflagged instruction emits no flagged shapes
    expect(
      installStepHeaders('npm ci', parseDockerfile('FROM x\nRUN npm ci\n').stages[0].instructions[1]),
    ).toEqual(['npm ci']);
  });
});

describe('classifyInstallProbeOutput: documented contract on transitive script-local imports (R3 F4)', () => {
  it('an existing lifecycle entry importing an absent sibling (ESM `imported from <entry>`) is PASS INSTALL_FAILED_AFTER_LIFECYCLE_STARTED', () => {
    // the entry script in L was found and ran; the missing module is its sibling, not a member of L
    const sibling = DOCKER_PRODUCTION_BASE_RED_OUTPUT.replace(
      "Error: Cannot find module '/app/scripts/postinstall-prisma-generate.mjs'",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/scripts/lib/helper.mjs' imported from /app/scripts/postinstall-prisma-generate.mjs",
    ).replace("code: 'MODULE_NOT_FOUND'", "code: 'ERR_MODULE_NOT_FOUND'");
    expect(sibling).not.toBe(DOCKER_PRODUCTION_BASE_RED_OUTPUT);
    expect(sibling).toContain('imported from /app/scripts/postinstall-prisma-generate.mjs');
    const result = classifyInstallProbeOutput(input({ ...DOCKER_PB, output: sibling }));
    expect(result.classification).toBe('PASS');
    expect(result.reasonCode).toBe(INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE);
    expect(result.matched[0]).toBe(DOCKER_PB_BANNER);
    // the `imported from` operand is not consulted: naming the entry there does not make it the asserted failure
    expect(result.matched.some((line) => line.includes('Cannot find module'))).toBe(false);
    // the same shape on a path that IS in L stays FAIL (the R2 F2 contract)
    const entry = sibling.replace(
      "'/app/scripts/lib/helper.mjs'",
      "'/app/scripts/postinstall-prisma-generate.mjs'",
    );
    expect(classifyInstallProbeOutput(input({ ...DOCKER_PB, output: entry })).classification).toBe('FAIL');
  });
});
