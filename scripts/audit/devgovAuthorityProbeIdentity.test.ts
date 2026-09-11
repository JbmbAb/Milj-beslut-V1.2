import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Namespace imports on purpose: this suite must also LOAD against the frozen parent
// (790fd0f0), so that its failures there are the semantic B1 / N12 / N13 defects
// rather than missing-export link errors.
import * as authority from '../devgov/authority.mjs';
import * as devgov from '../devgov/devgov.mjs';
import * as oidc from '../devgov/github-oidc.mjs';
import * as attestation from '../devgov/trusted-attestation.mjs';

// Tier A of the B1 / N12 / N13 repair: bootstrap-safe, unprivileged, no skips. The
// unprivileged process cannot switch uid, so the proof identity's report is supplied
// through the probe launcher seam wherever a second identity would be needed; every
// real-process behaviour that does not need a second identity is exercised for real.
// The uid-switched topology itself is Tier B: scripts/audit/e2e/devgovAuthorityRootTopology.e2e.mjs.

const OPERATIONS = [
  'read',
  'overwrite',
  'append',
  'truncate',
  'create',
  'mkdir',
  'symlink',
  'chmod',
  'rename',
  'delete',
];
const SCHEMA = 'dev-gov-authority-write-probe-v1';
const PROOF = { uid: 64123, gid: 64124 };
const AUTHORITY_ID = 'DEVGOV-AUTHORITY-PROBE-FIXTURE-V1';
const ROOT_ENV = 'PROBE_FIXTURE_AUTHORITY_ROOT';
const CREDENTIAL_NAME = /^(DEVGOV_|GITHUB_|GH_|ACTIONS_)/i;
const SECRETS: Record<string, string> = {
  DEVGOV_AUTHORITY_TOKEN: 'ghs_TIER_A_MARKER_retrieval',
  GITHUB_TOKEN: 'ghs_TIER_A_MARKER_github',
  GH_TOKEN: 'ghs_TIER_A_MARKER_ghcli',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'ghs_TIER_A_MARKER_oidc',
  DEVGOV_ATTESTATION_PRIVATE_KEY_PEM: 'ghs_TIER_A_MARKER_signer',
};
// libuv re-inserts exactly these into a Windows child given an empty environment.
const WINDOWS_RUNTIME_ENV = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
];

type Json = Record<string, any>;
type Call = { command: string; args: string[]; options: Json };
type Launched = Call & { root: string; nonce: string };

let scratch: string;
let archiveBytes: Buffer;
let contentDigest: string;
let referenceDigest: string;

function scratchDir(prefix: string): string {
  return mkdtempSync(join(scratch, prefix));
}

function walk(root: string, visit: (path: string, directory: boolean) => void) {
  const directory = lstatSync(root).isDirectory();
  if (directory) for (const name of readdirSync(root)) walk(join(root, name), visit);
  visit(root, directory);
}

/** A tree the test process can mutate. */
function writableTree(): string {
  const root = join(scratchDir('tree-'), 'ID');
  mkdirSync(join(root, 'corpus'), { recursive: true });
  writeFileSync(join(root, 'corpus', 'a.json'), '{"a":1}\n');
  writeFileSync(join(root, 'reference.json'), '{"ref":1}\n');
  return root;
}

/** Mode-only protection: read-only bits, but still owned by the test process. */
function readOnlyTree(): string {
  const root = writableTree();
  walk(root, (path, directory) => chmodSync(path, directory ? 0o555 : 0o444));
  return root;
}

function unlockAll(root: string) {
  try {
    chmodSync(root, 0o755);
    for (const name of readdirSync(root)) {
      const path = join(root, name);
      if (lstatSync(path).isDirectory()) unlockAll(path);
      else chmodSync(path, 0o644);
    }
  } catch {
    // cleanup is best effort
  }
}

function report(root: string, nonce: string, change?: (value: Json) => void): Json {
  const value: Json = {
    schema_version: SCHEMA,
    nonce,
    root,
    uid: PROOF.uid,
    gid: PROOF.gid,
    groups: [PROOF.gid],
    env_source: 'proc-self-environ',
    env_names: [],
    files: 2,
    directories: 2,
    checks: OPERATIONS.map((operation) =>
      operation === 'read'
        ? { operation, attempted: true, targets: 2, result: 'ALLOWED', errnos: [], target: null }
        : {
            operation,
            attempted: true,
            targets: 2,
            result: 'DENIED',
            errnos: [operation === 'chmod' ? 'EPERM' : 'EACCES'],
            target: null,
          },
    ),
  };
  change?.(value);
  return value;
}

const completed = (value: unknown) => ({
  status: 0,
  signal: null,
  stdout: JSON.stringify(value),
  stderr: '',
});

/** Records every launch and answers as the (simulated) proof identity. */
function launcher(calls: Call[], respond: (call: Launched) => unknown) {
  return (command: string, args: string[], options: Json) => {
    const call = { command, args, options };
    calls.push(call);
    return respond({ ...call, root: args[2], nonce: args[3] });
  };
}

const attesting = () => launcher([], ({ root, nonce }) => completed(report(root, nonce)));

/** Launches a REAL process as the current user (the seam cannot switch uid unprivileged). */
function realProcess(replace: (args: string[]) => { command?: string; args: string[]; timeout?: number }) {
  return (command: string, args: string[], options: Json) => {
    const own = { ...options };
    delete own.uid;
    delete own.gid;
    const substitute = replace(args);
    if (substitute.timeout !== undefined) own.timeout = substitute.timeout;
    return spawnSync(substitute.command ?? command, substitute.args, own);
  };
}

function withSecrets<T>(run: () => T): T {
  const previous = Object.fromEntries(Object.keys(SECRETS).map((name) => [name, process.env[name]]));
  Object.assign(process.env, SECRETS);
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function makeArchive(): Buffer {
  const workspace = scratchDir('src-');
  const source = join(workspace, 'payload');
  mkdirSync(join(source, 'corpus'), { recursive: true });
  mkdirSync(join(source, 'contracts'), { recursive: true });
  writeFileSync(join(source, 'corpus', 'capture-manifest-v1.json'), '{"cases":["alpha"]}\n');
  writeFileSync(join(source, 'corpus', 'alpha.json'), '{"case":"alpha"}\n');
  writeFileSync(join(source, 'contracts', 'authority-reference-v1.json'), '{"binding":"v1"}\n');
  // Relative operands with an explicit cwd: GNU tar reads C:\... as a remote host.
  const packed = spawnSync('tar', ['-czf', 'payload.tar.gz', '-C', 'payload', '.'], {
    cwd: workspace,
    encoding: 'utf8',
  });
  if (packed.status !== 0) throw new Error(`fixture archive creation failed: ${packed.stderr}`);
  return readFileSync(join(workspace, 'payload.tar.gz'));
}

function expand(bytes: Buffer): string {
  const workspace = scratchDir('exp-');
  writeFileSync(join(workspace, 'payload.tar.gz'), bytes);
  mkdirSync(join(workspace, 'payload'));
  const unpacked = spawnSync('tar', ['-xzf', 'payload.tar.gz', '-C', 'payload', '--no-same-owner'], {
    cwd: workspace,
    encoding: 'utf8',
  });
  if (unpacked.status !== 0) throw new Error(`fixture expansion failed: ${unpacked.stderr}`);
  return join(workspace, 'payload');
}

function catalog(): Json {
  return {
    schema_version: 'dev-gov-v1-authority-catalog',
    authorities: {
      [AUTHORITY_ID]: {
        provider: 'github-release-asset',
        source: {
          repository: 'JbmbAb/Milj-beslut-V1.2',
          release_tag: 'devgov-authority-probe-fixture-v1',
          asset_name: 'authority-probe-fixture-v1.tar.gz',
        },
        archive: { format: 'tar.gz', sha256: attestation.sha256(archiveBytes) },
        content: { digest_algorithm: 'dev-gov-authority-tree-sha256-v1', digest: contentDigest },
        reference: {
          digest_algorithm: 'sha256',
          digest: referenceDigest,
          entry: 'contracts/authority-reference-v1.json',
        },
        capability_env: { root: ROOT_ENV },
        required_entries: ['corpus/capture-manifest-v1.json'],
      },
    },
  };
}

async function resolveWith(extra: Json): Promise<Json> {
  return authority.resolveAuthorityCapability({
    authorityId: AUTHORITY_ID,
    catalog: catalog(),
    materializationRoot: scratchDir('mat-'),
    retrieve: async () => ({ bytes: archiveBytes, source_identity: 'tier-a-fixture' }),
    ...extra,
  });
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'devgov-probe-identity-'));
  archiveBytes = makeArchive();
  const measured = expand(archiveBytes);
  contentDigest = authority.authorityTreeDigest(measured);
  referenceDigest = attestation.sha256(
    readFileSync(join(measured, 'contracts', 'authority-reference-v1.json')),
  );
});

afterAll(() => {
  unlockAll(scratch);
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // cleanup is best effort
  }
});

describe('B1: the writability verdict is bound to the proof identity, never to the controller', () => {
  it('decides from the proof identity even when the controller itself could write the tree', () => {
    const calls: Call[] = [];
    const verdict = authority.probeMaterializationWritable(writableTree(), {
      uid: PROOF.uid,
      gid: PROOF.gid,
      runner: launcher(calls, ({ root, nonce }) => completed(report(root, nonce))),
    });
    // The controller's own ability to write is not the question and is never consulted.
    expect(calls).toHaveLength(1);
    expect(calls[0].options.uid).toBe(PROOF.uid);
    expect(calls[0].options.gid).toBe(PROOF.gid);
    expect(verdict.writable).toBe(false);
    expect(verdict.probes[0]).toContain(`proof-identity uid=${PROOF.uid} gid=${PROOF.gid}`);
  });

  it('denies an authority-bound resolution that names no proof identity', async () => {
    const resolved = await resolveWith({});
    expect(resolved.status).toBe('DENIED');
    expect(resolved.reason_code).toBe('AUTHORITY_PROOF_IDENTITY_REQUIRED');
    expect(resolved.capability_env).toEqual({});
  });

  it.each([
    ['root uid', 0, PROOF.gid],
    ['root gid', PROOF.uid, 0],
    ['negative uid', -1, PROOF.gid],
    ['fractional uid', 1.5, PROOF.gid],
    ['string uid', String(PROOF.uid), PROOF.gid],
    ['uid without gid', PROOF.uid, undefined],
    ['gid without uid', undefined, PROOF.gid],
  ])('denies an invalid proof identity: %s', async (_label, uid, gid) => {
    const resolved = await resolveWith({ proofUid: uid, proofGid: gid, probeRunner: attesting() });
    expect(resolved.status).toBe('DENIED');
    expect(resolved.reason_code).toBe('AUTHORITY_PROOF_IDENTITY_REQUIRED');

    const calls: Call[] = [];
    const verdict = authority.probeMaterializationWritable(readOnlyTree(), {
      uid,
      gid,
      runner: launcher(calls, ({ root, nonce }) => completed(report(root, nonce))),
    });
    expect(verdict.writable).toBe(true);
    expect(verdict.reason_code).toBe('AUTHORITY_PROOF_IDENTITY_REQUIRED');
    expect(calls).toHaveLength(0);
  });
});

describe('N12: the proof-identity probe receives an explicit, empty environment', () => {
  it('launches from an absolute executable with an explicit environment and a hard timeout', () => {
    const calls: Call[] = [];
    withSecrets(() =>
      authority.probeMaterializationWritable(readOnlyTree(), {
        uid: PROOF.uid,
        gid: PROOF.gid,
        runner: launcher(calls, ({ root, nonce }) => completed(report(root, nonce))),
      }),
    );
    expect(calls).toHaveLength(1);
    const { command, options } = calls[0];
    expect(isAbsolute(command)).toBe(true);
    // Explicit and empty: never a clone of the controller environment.
    expect(options.env).toEqual({});
    expect(Object.keys(options.env).filter((name) => CREDENTIAL_NAME.test(name))).toEqual([]);
    expect(JSON.stringify(options)).not.toContain('ghs_TIER_A_MARKER');
    expect(Number.isFinite(options.timeout) && options.timeout > 0).toBe(true);
    expect(options.killSignal).toBe('SIGKILL');
  });

  it('the real probe process carries no credential from the controller environment', () => {
    const verdict = withSecrets(() => authority.probeMaterializationWritable(writableTree()));
    expect(verdict.report).toBeTruthy();
    const names: string[] = verdict.report.env_names;
    for (const name of Object.keys(SECRETS)) expect(names).not.toContain(name);
    expect(names.filter((name) => CREDENTIAL_NAME.test(name))).toEqual([]);
    if (process.platform === 'win32') {
      expect(names.every((name) => WINDOWS_RUNTIME_ENV.includes(name.toUpperCase()))).toBe(true);
    } else {
      expect(names).toEqual([]);
    }
    if (process.platform === 'linux') {
      // The very bytes another process of the same uid could read from /proc/<pid>/environ.
      expect(verdict.report.env_source).toBe('proc-self-environ');
    }
  });
});

describe('N13: anything short of a complete positive attestation is a denial', () => {
  const failure = (code: string) => Object.assign(new Error(`spawn ${code}`), { code });
  const cases: [string, (call: Launched) => unknown, string][] = [
    [
      'launch failure ENOENT',
      () => ({ error: failure('ENOENT'), status: null, signal: null, stdout: '' }),
      'FAILED',
    ],
    [
      'launch failure EACCES',
      () => ({ error: failure('EACCES'), status: null, signal: null, stdout: '' }),
      'FAILED',
    ],
    [
      'launcher throws',
      () => {
        throw failure('ENOTSUP');
      },
      'FAILED',
    ],
    ['crash, exit 1', () => ({ status: 1, signal: null, stdout: '', stderr: 'boom' }), 'FAILED'],
    ['killed by signal', () => ({ status: null, signal: 'SIGKILL', stdout: '' }), 'FAILED'],
    [
      'timeout',
      () => ({ error: failure('ETIMEDOUT'), status: null, signal: 'SIGKILL', stdout: '' }),
      'FAILED',
    ],
    ['no result', () => undefined, 'FAILED'],
    ['empty stdout', () => ({ status: 0, signal: null, stdout: '' }), 'FAILED'],
    ['malformed JSON', () => ({ status: 0, signal: null, stdout: '{"schema_version":' }), 'FAILED'],
    ['JSON array', () => ({ status: 0, signal: null, stdout: '[]' }), 'FAILED'],
    [
      'trailing garbage',
      ({ root, nonce }) => ({ status: 0, signal: null, stdout: `${JSON.stringify(report(root, nonce))}x` }),
      'FAILED',
    ],
    [
      'wrong schema',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.schema_version = 'other'))),
      'FAILED',
    ],
    ['wrong nonce', ({ root }) => completed(report(root, 'f'.repeat(32))), 'FAILED'],
    ['wrong root', ({ nonce }) => completed(report('/elsewhere', nonce)), 'FAILED'],
    [
      'wrong uid',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.uid = PROOF.uid + 1))),
      'FAILED',
    ],
    [
      'wrong gid',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.gid = PROOF.gid + 1))),
      'FAILED',
    ],
    ['ran as root', ({ root, nonce }) => completed(report(root, nonce, (r) => (r.uid = 0))), 'FAILED'],
    [
      'missing check',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.checks = r.checks.slice(0, -1)))),
      'FAILED',
    ],
    [
      'repeated check',
      ({ root, nonce }) => completed(report(root, nonce, (r) => r.checks.push({ ...r.checks[1] }))),
      'FAILED',
    ],
    [
      'unknown check',
      ({ root, nonce }) =>
        completed(
          report(root, nonce, (r) =>
            r.checks.push({
              operation: 'chown',
              attempted: true,
              targets: 1,
              result: 'DENIED',
              errnos: ['EPERM'],
            }),
          ),
        ),
      'FAILED',
    ],
    [
      'check not attempted',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.checks[8].attempted = false))),
      'FAILED',
    ],
    [
      'unexpected errno ENOENT',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.checks[1].errnos = ['ENOENT']))),
      'FAILED',
    ],
    [
      'unexpected errno EIO',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.checks[9].errnos = ['EIO']))),
      'FAILED',
    ],
    [
      'ERROR result',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.checks[5].result = 'ERROR'))),
      'FAILED',
    ],
    [
      'denial without an errno',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.checks[6].errnos = []))),
      'FAILED',
    ],
    [
      'nothing attempted',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.checks[3].targets = 0))),
      'FAILED',
    ],
    [
      'credential in the probe environment',
      ({ root, nonce }) => completed(report(root, nonce, (r) => (r.env_names = ['DEVGOV_AUTHORITY_TOKEN']))),
      'FAILED',
    ],
    [
      'allowed mutation',
      ({ root, nonce }) =>
        completed(report(root, nonce, (r) => Object.assign(r.checks[1], { result: 'ALLOWED', errnos: [] }))),
      'WRITABLE',
    ],
    [
      'unreadable authority',
      ({ root, nonce }) =>
        completed(
          report(root, nonce, (r) => Object.assign(r.checks[0], { result: 'DENIED', errnos: ['EACCES'] })),
        ),
      'UNREADABLE',
    ],
  ];
  const reasons: Record<string, string> = {
    FAILED: 'AUTHORITY_WRITABILITY_PROBE_FAILED',
    WRITABLE: 'AUTHORITY_MATERIALIZATION_WRITABLE',
    UNREADABLE: 'AUTHORITY_MATERIALIZATION_UNREADABLE',
  };

  it.each(cases)('%s', (_label, respond, outcome) => {
    const verdict = authority.probeMaterializationWritable(readOnlyTree(), {
      uid: PROOF.uid,
      gid: PROOF.gid,
      runner: launcher([], respond),
    });
    expect(verdict.writable).toBe(true);
    expect(verdict.reason_code).toBe(reasons[outcome]);
  });

  it('a valid, complete, denied-mutation report is the only answer that passes', () => {
    const verdict = authority.probeMaterializationWritable(readOnlyTree(), {
      uid: PROOF.uid,
      gid: PROOF.gid,
      runner: attesting(),
    });
    expect(verdict.writable).toBe(false);
    expect(verdict.verdict).toBe('NOT_WRITABLE');
    expect(verdict.reason_code).toBeNull();
  });

  it.each([
    [
      'probe executable cannot be launched',
      () => ({ command: join(scratch, 'no-such-node-binary'), args: [] }),
    ],
    ['probe binary is not executable', () => ({ command: join(scratch, 'not-executable.txt'), args: [] })],
    ['probe crashes', () => ({ args: ['-e', 'process.exit(7)'] })],
    ['probe is killed by a signal', () => ({ args: ['-e', "process.kill(process.pid, 'SIGKILL')"] })],
    ['probe hangs past its timeout', () => ({ args: ['-e', 'setInterval(() => {}, 1000)'], timeout: 1500 })],
    [
      'probe prints malformed output',
      () => ({ args: ['-e', 'process.stdout.write(\'{"schema_version":\')'] }),
    ],
  ])(
    'real process: %s => DENIED',
    (_label, replace) => {
      writeFileSync(join(scratch, 'not-executable.txt'), 'plain text\n');
      const verdict = authority.probeMaterializationWritable(readOnlyTree(), {
        uid: PROOF.uid,
        gid: PROOF.gid,
        runner: realProcess(replace),
      });
      expect(verdict.writable).toBe(true);
      expect(verdict.reason_code).toBe('AUTHORITY_WRITABILITY_PROBE_FAILED');
    },
    20_000,
  );
});

describe('real probe behaviour, current identity', () => {
  it('N: a tree the identity can mutate is WRITABLE, found by real attempts', () => {
    const verdict = authority.probeMaterializationWritable(writableTree());
    expect(verdict.writable).toBe(true);
    expect(verdict.reason_code).toBe('AUTHORITY_MATERIALIZATION_WRITABLE');
    expect(verdict.report.checks.map((check: Json) => check.operation)).toEqual(OPERATIONS);
    expect(verdict.probes).toContain('overwrite=ALLOWED');
  });

  it('mode bits alone do not protect a tree from its owner', () => {
    const verdict = authority.probeMaterializationWritable(readOnlyTree());
    expect(verdict.writable).toBe(true);
    expect(verdict.verdict).toBe('WRITABLE');
    const allowed = verdict.report.checks
      .filter((check: Json) => check.result === 'ALLOWED')
      .map((check: Json) => check.operation);
    // Owners can always change the mode of what they own.
    expect(allowed).toContain('chmod');
  });
});

describe('integrity: the tree is re-verified after the probe', () => {
  it('denies when the materialization changes during the writability probe', async () => {
    const resolved = await resolveWith({
      proofUid: PROOF.uid,
      proofGid: PROOF.gid,
      probeWritable: (root: string) => {
        const target = join(root, 'corpus', 'alpha.json');
        chmodSync(target, 0o644);
        writeFileSync(target, '{"case":"changed-under-the-verdict"}\n');
        chmodSync(target, 0o444);
        return { writable: false, detail: null, probes: ['tampering-probe'] };
      },
    });
    expect(resolved.status).toBe('DENIED');
    expect(resolved.reason_code).toBe('AUTHORITY_CONTENT_DIGEST_MISMATCH');
    expect(resolved.errors.join(' ')).toContain('writability probe');
  });
});

describe('positive control: attested identity, granted capability, bound record, gate', () => {
  it('verifies, runs the proof with the capability, binds the record and passes the gate', async () => {
    const resolved = await resolveWith({
      proofUid: PROOF.uid,
      proofGid: PROOF.gid,
      probeRunner: attesting(),
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.status).toBe('VERIFIED_READ_ONLY');
    expect(resolved.content_digest).toBe(contentDigest);
    expect(resolved.probes[0]).toContain(`proof-identity uid=${PROOF.uid} gid=${PROOF.gid}`);

    const repo = scratchDir('repo-');
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git(['init', '--quiet']);
    git(['config', 'user.email', 'devgov@example.invalid']);
    git(['config', 'user.name', 'devgov']);
    writeFileSync(join(repo, 'surface.txt'), 'proof surface\n');
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'surface']);
    const sha = git(['rev-parse', 'HEAD']);

    const issuer = 'github-actions:example/repo:devgov-v0-attest';
    const keyId = 'devgov-ci-ed25519-v1';
    const workflowRef = 'example/repo/.github/workflows/devgov-v0-attest.yml@refs/heads/main';
    const reads = [
      "const fs = require('node:fs'); const path = require('node:path');",
      `const root = process.env['${ROOT_ENV}'];`,
      'if (!root) process.exit(21);',
      "if (!fs.existsSync(path.join(root, 'corpus', 'capture-manifest-v1.json'))) process.exit(22);",
    ].join(' ');
    const unit: Json = {
      schema_version: 'dev-gov-v1-unit-definition',
      unit: 'DEVGOV-AUTHORITY-PROBE-IDENTITY-TIER-A',
      role: 'producer',
      mode: 'writer',
      branch: 'tier-a',
      base_sha: sha,
      ancestry_policy: 'descendant_of_base',
      allowed_paths: ['**'],
      forbidden_paths: [],
      trusted_execution: { issuer, key_id: keyId },
      required_red: [
        { id: 'red', command: process.execPath, args: ['-e', 'process.exit(1)'], required_head: 'any' },
      ],
      required_green: [
        {
          id: 'green',
          command: process.execPath,
          args: ['-e', reads],
          required_head: 'any',
          authority_requirement: { id: AUTHORITY_ID },
        },
      ],
    };
    const redEvidence = devgov.runManifestCommand(unit, unit.required_red[0], 'RED', {
      worktree: repo,
      candidateSha: sha,
    });
    await new Promise((settle) => setTimeout(settle, 20));
    const greenEvidence = devgov.runManifestCommand(unit, unit.required_green[0], 'GREEN', {
      worktree: repo,
      candidateSha: sha,
      authority: resolved,
      reservedEnvNames: authority.catalogCapabilityEnvNames(catalog()),
    });
    expect({ exit: greenEvidence.exit_code, classification: greenEvidence.classification }).toEqual({
      exit: 0,
      classification: 'PASS',
    });

    const context = {
      runner_identity: 'github-hosted:ubuntu-latest',
      controller_sha: 'c'.repeat(40),
      workflow_ref: workflowRef,
      workflow_run_id: '100',
      workflow_run_attempt: '1',
    };
    const redRecord = devgov.trustedExecutionRecord(unit, redEvidence, context);
    const greenRecord = devgov.trustedExecutionRecord(unit, greenEvidence, context);
    expect(greenRecord.authority_id).toBe(AUTHORITY_ID);
    expect(greenRecord.authority_content_digest).toBe(contentDigest);
    expect(greenRecord.authority_reference_digest).toBe(referenceDigest);
    expect(greenRecord.authority_materialization_result).toBe('VERIFIED_READ_ONLY');
    expect(
      devgov.validateExecutionRecordForManifest(unit, greenRecord, 'GREEN', 'green', {
        candidateSha: sha,
        authorityCatalog: catalog(),
      }),
    ).toEqual([]);

    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const policy = {
      schema_version: 'dev-gov-v0-trust-policy',
      authority: oidc.PINNED_VERIFIER_AUTHORITY,
      trusted_issuers: [
        {
          issuer,
          key_id: keyId,
          algorithm: 'ed25519',
          public_key_pem: publicKey,
          workflow_ref: workflowRef,
          runner_identity: 'github-hosted:ubuntu-latest',
        },
      ],
    };
    const signed = [redRecord, greenRecord].map((record) =>
      devgov.signExecutionRecord(record, privateKey, { issuer, key_id: keyId }),
    );
    expect(
      devgov.evaluateTrustedExecutionGate(unit, signed, policy, {
        candidateSha: sha,
        controllerSha: 'c'.repeat(40),
        authorityCatalog: catalog(),
      }),
    ).toEqual({ result: 'PASS', proof_status: 'PROVEN', errors: [] });
  }, 60_000);
});

describe('probe report contract', () => {
  it('publishes the operations, the accepted denial errnos and the empty probe environment', () => {
    expect(authority.WRITE_PROBE_SCHEMA).toBe(SCHEMA);
    expect([...authority.WRITE_PROBE_OPERATIONS]).toEqual(OPERATIONS);
    expect([...authority.WRITE_PROBE_DENIAL_ERRNOS]).toEqual(['EACCES', 'EPERM', 'EROFS']);
    expect(authority.writeProbeEnvironment()).toEqual({});
    expect(authority.writeProbeEnvironmentAllowlist('linux')).toEqual([]);
  });

  it('validates a complete report and nothing less', () => {
    const expected = {
      nonce: 'n'.repeat(32),
      root: '/authority/ID',
      uid: PROOF.uid,
      gid: PROOF.gid,
      platform: 'linux',
    };
    expect(authority.validateWriteProbeReport(report(expected.root, expected.nonce), expected)).toEqual({
      verdict: 'NOT_WRITABLE',
      errors: [],
    });
    for (const operation of OPERATIONS) {
      const partial = report(expected.root, expected.nonce, (r) => {
        r.checks = r.checks.filter((check: Json) => check.operation !== operation);
      });
      expect(authority.validateWriteProbeReport(partial, expected).verdict).toBe('PROBE_FAILED');
    }
  });
});
