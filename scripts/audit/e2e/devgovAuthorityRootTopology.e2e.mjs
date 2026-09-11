#!/usr/bin/env node
// DEV-GOV authority transport -- ROOT-TOPOLOGY END-TO-END REGRESSION (Tier B of the
// B1 / N12 / N13 repair).
//
// Reproduces the trusted-runner topology that unprivileged suites cannot:
//   controller   root (this process), with real privilege
//   proof        a real second, unprivileged uid/gid (devgov-candidate if present, else nobody)
//   catalog      a root-owned protected catalog file, loaded and validated by the controller
//   provider     the real github-release-asset provider over a real local HTTP round trip,
//                including a cross-origin redirect to the asset bytes
//   credentials  present in the controller environment, absent from every process of the proof uid
//
// Explicitly invoked and deliberately outside the declared-GREEN glob
// (scripts/audit/devgov*.test.ts): the trusted GREEN runs unprivileged. It HARD-FAILS with
// exit 2 -- it never skips -- when it cannot build this topology.
//
//   sudo node scripts/audit/e2e/devgovAuthorityRootTopology.e2e.mjs [--proof-user <name>] [--json <file>] [--keep]
//
// Exit codes: 0 every check passed; 1 a check failed; 2 topology unavailable.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTROLLER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'devgov');
const load = (file) => import(pathToFileURL(join(CONTROLLER, file)).href);
const authority = await load('authority.mjs');
const devgov = await load('devgov.mjs');
const oidc = await load('github-oidc.mjs');
const attestation = await load('trusted-attestation.mjs');

const AUTHORITY_ID = 'DEVGOV-ROOT-TOPOLOGY-E2E-V1';
const ROOT_ENV = 'E2E_AUTHORITY_ROOT';
const REFERENCE_ENV = 'E2E_AUTHORITY_REFERENCE';
const MARK = 'ghs_ROOT_TOPOLOGY_MARKER';
const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

function unavailable(reason) {
  console.error(`TOPOLOGY_UNAVAILABLE: ${reason}`);
  process.exit(2);
}

if (process.platform !== 'linux') unavailable('requires Linux (uid/gid switching and procfs)');
if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
  unavailable('must run as root: this regression is about a root controller and an unprivileged proof');
}
for (const tool of ['tar', 'git', 'id']) {
  if (spawnSync(tool, ['--version'], { encoding: 'utf8' }).error) unavailable(`${tool} is required`);
}
const userExists = (name) => spawnSync('id', ['-u', name], { encoding: 'utf8' }).status === 0;
const proofUser = option('--proof-user') || (userExists('devgov-candidate') ? 'devgov-candidate' : 'nobody');
if (!userExists(proofUser)) unavailable(`proof user ${proofUser} does not exist`);
const proofUid = Number(execFileSync('id', ['-u', proofUser], { encoding: 'utf8' }).trim());
const proofGid = Number(execFileSync('id', ['-g', proofUser], { encoding: 'utf8' }).trim());
if (!(proofUid >= 1 && proofGid >= 1))
  unavailable(`proof identity ${proofUser} (${proofUid}:${proofGid}) is not unprivileged`);

const checks = [];
function check(item, name, pass, detail = '') {
  checks.push({ item, name, pass: Boolean(pass), detail });
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${String(item).padStart(2)} ${name}${detail ? ` -- ${detail}` : ''}`,
  );
}

// ---- workspace: root-owned, traversable by the proof identity ------------------------------
const workspace = mkdtempSync(join(tmpdir(), 'devgov-root-topology-'));
chmodSync(workspace, 0o755);
const paths = {
  catalog: join(workspace, 'controller-catalog'),
  base: join(workspace, 'authority'),
  fixture: join(workspace, 'fixture'),
  repo: join(workspace, 'execution'),
  proofOut: join(workspace, 'proof-out'),
};
mkdirSync(paths.catalog, { mode: 0o755 });
mkdirSync(paths.base, { mode: 0o755 });
mkdirSync(paths.fixture, { mode: 0o700 });
mkdirSync(paths.proofOut, { mode: 0o700 });
chownSync(paths.proofOut, proofUid, proofGid);

// ---- protected authority fixture ----------------------------------------------------------
const payload = join(paths.fixture, 'payload');
mkdirSync(join(payload, 'corpus'), { recursive: true });
mkdirSync(join(payload, 'contracts'), { recursive: true });
writeFileSync(join(payload, 'corpus', 'capture-manifest-v1.json'), '{"cases":["alpha","beta"]}\n');
writeFileSync(join(payload, 'corpus', 'alpha.json'), '{"case":"alpha"}\n');
writeFileSync(join(payload, 'contracts', 'authority-reference-v1.json'), '{"binding":"root-topology-v1"}\n');
const packed = spawnSync('tar', ['-czf', 'authority.tar.gz', '-C', 'payload', '.'], {
  cwd: paths.fixture,
  encoding: 'utf8',
});
if (packed.status !== 0) unavailable(`fixture archive could not be built: ${packed.stderr}`);
const archiveBytes = readFileSync(join(paths.fixture, 'authority.tar.gz'));
mkdirSync(join(paths.fixture, 'measure'));
const measured = spawnSync('tar', ['-xzf', 'authority.tar.gz', '-C', 'measure', '--no-same-owner'], {
  cwd: paths.fixture,
  encoding: 'utf8',
});
if (measured.status !== 0) unavailable(`fixture archive could not be measured: ${measured.stderr}`);
const contentDigest = authority.authorityTreeDigest(join(paths.fixture, 'measure'));
const referenceDigest = attestation.sha256(
  readFileSync(join(paths.fixture, 'measure', 'contracts', 'authority-reference-v1.json')),
);

const catalogFile = join(paths.catalog, 'catalog-v1.json');
writeFileSync(
  catalogFile,
  `${JSON.stringify(
    {
      schema_version: 'dev-gov-v1-authority-catalog',
      authorities: {
        [AUTHORITY_ID]: {
          description: 'root-topology end-to-end fixture',
          provider: 'github-release-asset',
          source: {
            repository: 'JbmbAb/Milj-beslut-V1.2',
            release_tag: 'devgov-root-topology-e2e-v1',
            asset_name: 'authority.tar.gz',
          },
          archive: { format: 'tar.gz', sha256: attestation.sha256(archiveBytes) },
          content: { digest_algorithm: 'dev-gov-authority-tree-sha256-v1', digest: contentDigest },
          reference: {
            digest_algorithm: 'sha256',
            digest: referenceDigest,
            entry: 'contracts/authority-reference-v1.json',
          },
          capability_env: { root: ROOT_ENV, reference: REFERENCE_ENV },
          required_entries: ['corpus/capture-manifest-v1.json'],
        },
      },
    },
    null,
    2,
  )}\n`,
);
chmodSync(catalogFile, 0o444);

// ---- execution checkout: the candidate proof, frozen root-owned and read-only ---------------
const PROOF_PROGRAM = String.raw`'use strict';
// Candidate-side proof: reads the granted authority, attempts every mutation as its own
// identity, and records whether any controller credential reached it.
const fs = require('node:fs');
const path = require('node:path');
const [outDir, mark] = process.argv.slice(2);
const root = process.env.${ROOT_ENV};
const reference = process.env.${REFERENCE_ENV};
let environ = Buffer.alloc(0);
try { environ = fs.readFileSync('/proc/self/environ'); } catch {}
const envNames = environ.toString('utf8').split('\0').filter(Boolean).map((entry) => entry.split('=')[0]);
const attempts = {};
const files = [];
const walk = (directory) => {
  for (const name of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    if (fs.lstatSync(full).isDirectory()) walk(full); else files.push(full);
  }
};
let readable = false;
if (root) {
  try { walk(root); readable = files.length > 0 && files.every((file) => fs.readFileSync(file).length >= 0); } catch {}
  const first = files[0];
  const attempt = (name, run) => { try { run(); attempts[name] = 'SUCCEEDED'; } catch (error) { attempts[name] = 'DENIED:' + (error.code || error.message); } };
  attempt('overwrite', () => fs.writeFileSync(first, 'PWNED'));
  attempt('append', () => fs.appendFileSync(first, 'PWNED'));
  attempt('truncate', () => fs.truncateSync(first, 0));
  attempt('create', () => fs.writeFileSync(path.join(root, 'proof-new.txt'), 'x'));
  attempt('mkdir', () => fs.mkdirSync(path.join(root, 'proof-dir')));
  attempt('symlink', () => fs.symlinkSync('/etc/passwd', path.join(root, 'proof-link')));
  attempt('chmod', () => fs.chmodSync(first, 0o666));
  attempt('rename', () => fs.renameSync(first, first + '.moved'));
  attempt('rename-root', () => fs.renameSync(root, root + '.moved'));
  attempt('create-in-base', () => fs.writeFileSync(path.join(path.dirname(root), 'planted.txt'), 'x'));
  attempt('delete', () => fs.unlinkSync(first));
}
const allDenied = Object.keys(attempts).length > 0 && Object.values(attempts).every((value) => value.startsWith('DENIED'));
const report = {
  uid: process.getuid(),
  gid: process.getgid(),
  groups: process.getgroups(),
  env_names: envNames.sort(),
  token_seen: environ.includes(mark),
  root: root || null,
  reference: reference || null,
  readable,
  attempts,
  all_denied: allDenied,
};
fs.writeFileSync(path.join(outDir, 'proof-report.json'), JSON.stringify(report, null, 2));
process.exit(root && readable && allDenied && !report.token_seen ? 0 : 1);
`;
mkdirSync(paths.repo);
writeFileSync(join(paths.repo, 'proof.cjs'), PROOF_PROGRAM);
const git = (args) => execFileSync('git', args, { cwd: paths.repo, encoding: 'utf8' }).trim();
git(['init', '--quiet']);
git(['add', '.']);
git([
  '-c',
  'user.email=devgov@example.invalid',
  '-c',
  'user.name=devgov',
  'commit',
  '--quiet',
  '-m',
  'e2e proof',
]);
const repoSha = git(['rev-parse', 'HEAD']);
spawnSync('chmod', ['-R', 'a-w', paths.repo]);

// ---- the release-asset service: API origin plus a separate CDN origin ----------------------
const requests = [];
const listen = (server) =>
  new Promise((ready) => server.listen(0, '127.0.0.1', () => ready(server.address().port)));
const cdn = createServer((request, response) => {
  requests.push({ origin: 'cdn', path: request.url, authorization: Boolean(request.headers.authorization) });
  if (request.url === '/blob/authority') {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(archiveBytes);
  } else {
    response.writeHead(404).end();
  }
});
const cdnPort = await listen(cdn);
const api = createServer((request, response) => {
  requests.push({ origin: 'api', path: request.url, authorization: Boolean(request.headers.authorization) });
  const repo = '/repos/JbmbAb/Milj-beslut-V1.2';
  if (request.url === `${repo}/releases/tags/devgov-root-topology-e2e-v1`) {
    const port = api.address().port;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        assets: [
          { id: 1, name: 'authority.tar.gz', url: `http://127.0.0.1:${port}${repo}/releases/assets/1` },
        ],
      }),
    );
  } else if (request.url === `${repo}/releases/assets/1`) {
    response.writeHead(302, { location: `http://127.0.0.1:${cdnPort}/blob/authority` });
    response.end();
  } else {
    response.writeHead(404).end('{}');
  }
});
const apiPort = await listen(api);

// ---- controller credentials: what a trusted-runner controller may hold ----------------------
Object.assign(process.env, {
  DEVGOV_AUTHORITY_TOKEN: `${MARK}_retrieval`,
  GITHUB_TOKEN: `${MARK}_github`,
  GH_TOKEN: `${MARK}_ghcli`,
});

// ---- same-uid observer: reads /proc/<pid>/environ of every process of the proof uid ---------
const OBSERVER = String.raw`
const fs = require('node:fs');
const uid = Number(process.argv[1]); const mark = process.argv[2]; const me = process.pid;
const seen = new Map(); const exposed = new Map(); let stop = false;
process.on('SIGTERM', () => { stop = true; });
const scan = () => {
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === me) continue;
    try {
      if (fs.statSync('/proc/' + pid).uid !== uid) continue;
      const cmd = fs.readFileSync('/proc/' + pid + '/cmdline').toString().split('\0').join(' ');
      const env = fs.readFileSync('/proc/' + pid + '/environ');
      const kind = cmd.includes('devgov-write-probe') ? 'probe' : cmd.includes('proof.cjs') ? 'proof' : 'other';
      seen.set(pid, kind);
      if (env.includes(mark)) exposed.set(pid, kind);
    } catch {}
  }
};
process.stdout.write('READY\n');
const loop = () => {
  if (stop) { process.stdout.write(JSON.stringify({ seen: [...seen.values()], exposed: [...exposed.values()] }) + '\n'); process.exit(0); }
  for (let i = 0; i < 25; i++) scan();
  setImmediate(loop);
};
loop();
`;
const observer = spawn(process.execPath, ['-e', OBSERVER, String(proofUid), MARK], {
  uid: proofUid,
  gid: proofGid,
  env: {},
  cwd: '/',
  stdio: ['ignore', 'pipe', 'inherit'],
});
let observerOutput = '';
observer.stdout.on('data', (chunk) => (observerOutput += chunk));
await new Promise((ready) => {
  const wait = () => (observerOutput.includes('READY') ? ready() : setTimeout(wait, 10));
  wait();
});

// ---- 1-5: the root controller resolves, verifies and probes as the proof identity ----------
const loaded = authority.loadProtectedAuthorityCatalog({
  catalogPath: catalogFile,
  candidateRoot: paths.repo,
});
if (!loaded.ok) unavailable(`test catalog rejected: ${loaded.errors.join('; ')}`);
const resolution = await authority.resolveAuthorityCapability({
  authorityId: AUTHORITY_ID,
  catalog: loaded.catalog,
  materializationRoot: paths.base,
  candidateRoot: paths.repo,
  token: process.env.DEVGOV_AUTHORITY_TOKEN,
  apiBase: `http://127.0.0.1:${apiPort}`,
  proofUid,
  proofGid,
  enforceOwner: true,
});
const root = join(paths.base, AUTHORITY_ID);
const summary = {
  schema_version: 'dev-gov-authority-root-topology-e2e-v1',
  controller_module: CONTROLLER,
  controller_uid: process.getuid(),
  proof_identity: { user: proofUser, uid: proofUid, gid: proofGid },
  resolution: {
    status: resolution.status,
    reason_code: resolution.reason_code,
    errors: resolution.errors,
    probes: resolution.probes,
  },
};

const apiCalls = requests.filter((entry) => entry.origin === 'api');
check(
  1,
  'root controller fetches authority through the provider',
  apiCalls.length >= 2 &&
    apiCalls.every((entry) => entry.authorization) &&
    requests.some(
      (entry) => entry.origin === 'cdn' && entry.path === '/blob/authority' && !entry.authorization,
    ),
  `api requests with credential=${apiCalls.filter((entry) => entry.authorization).length}, cdn requests with credential=${requests.filter((entry) => entry.origin === 'cdn' && entry.authorization).length}`,
);
check(
  2,
  'archive verification succeeds',
  existsSync(join(root, 'corpus', 'capture-manifest-v1.json')) &&
    !['AUTHORITY_RETRIEVAL_UNAVAILABLE', 'AUTHORITY_ARCHIVE_DIGEST_MISMATCH'].includes(
      resolution.reason_code,
    ),
  resolution.reason_code || 'verified',
);
check(
  3,
  'authority materializes as VERIFIED_READ_ONLY',
  resolution.status === 'VERIFIED_READ_ONLY',
  resolution.status === 'VERIFIED_READ_ONLY'
    ? root
    : `${resolution.reason_code}: ${resolution.errors.join('; ')}`,
);
const probeHeader = `dev-gov-authority-write-probe-v1 proof-identity uid=${proofUid} gid=${proofGid}`;
check(
  4,
  'the writability probe executed as the proof identity',
  resolution.probes?.[0] === probeHeader,
  (resolution.probes || []).join(', '),
);

let proofReport = null;
let greenEvidence = null;
let greenRecord = null;
let gate = null;
let attestationValid = false;
let independentProbe = null;
if (resolution.status === 'VERIFIED_READ_ONLY') {
  independentProbe = authority.probeMaterializationWritable(root, { uid: proofUid, gid: proofGid });
  const expectedChecks = authority.WRITE_PROBE_OPERATIONS.map((operation) =>
    operation === 'read' ? 'read=ALLOWED' : `${operation}=DENIED`,
  );
  const observedChecks = resolution.probes.slice(1).map((line) => line.split(':')[0]);
  check(
    5,
    'probe report binds the exact expected uid/gid and every required check',
    independentProbe.report?.uid === proofUid &&
      independentProbe.report?.gid === proofGid &&
      JSON.stringify(observedChecks) === JSON.stringify(expectedChecks),
    `report uid=${independentProbe.report?.uid} gid=${independentProbe.report?.gid} groups=${JSON.stringify(independentProbe.report?.groups)}`,
  );

  // ---- 6-11: the proof runs as the proof identity with the capability ----------------------
  const issuer = 'github-actions:example/repo:devgov-v0-attest';
  const keyId = 'devgov-ci-ed25519-v1';
  const workflowRef = 'example/repo/.github/workflows/devgov-v0-attest.yml@refs/heads/main';
  const controllerSha = 'c'.repeat(40);
  const unit = {
    schema_version: 'dev-gov-v1-unit-definition',
    unit: 'DEVGOV-AUTHORITY-ROOT-TOPOLOGY-E2E',
    role: 'producer',
    mode: 'writer',
    branch: 'e2e',
    base_sha: repoSha,
    ancestry_policy: 'descendant_of_base',
    allowed_paths: ['**'],
    forbidden_paths: [],
    trusted_execution: { issuer, key_id: keyId },
    required_red: [
      {
        id: 'red',
        command: process.execPath,
        args: ['-e', 'process.exit(1)'],
        expected_classification: 'FAIL',
        required_head: 'any',
      },
    ],
    required_green: [
      {
        id: 'green',
        command: process.execPath,
        args: ['proof.cjs', paths.proofOut, MARK],
        required_head: 'any',
        authority_requirement: { id: AUTHORITY_ID },
      },
    ],
  };
  const common = {
    worktree: paths.repo,
    candidateSha: repoSha,
    uid: proofUid,
    gid: proofGid,
    env: { HOME: '/' },
    reservedEnvNames: authority.catalogCapabilityEnvNames(loaded.catalog),
  };
  const redEvidence = devgov.runManifestCommand(unit, unit.required_red[0], 'RED', common);
  await new Promise((settle) => setTimeout(settle, 20));
  greenEvidence = devgov.runManifestCommand(unit, unit.required_green[0], 'GREEN', {
    ...common,
    authority: resolution,
  });
  const reportFile = join(paths.proofOut, 'proof-report.json');
  proofReport = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
  check(
    6,
    'the proof reads the granted authority',
    proofReport?.readable === true && proofReport?.root === root && proofReport?.uid === proofUid,
    `proof uid=${proofReport?.uid} gid=${proofReport?.gid} root=${proofReport?.root}`,
  );
  check(
    7,
    'every mutation by the proof identity is denied',
    proofReport?.all_denied === true &&
      JSON.stringify(observedChecks) === JSON.stringify(expectedChecks) &&
      independentProbe.verdict === 'NOT_WRITABLE',
    JSON.stringify(proofReport?.attempts),
  );

  cdn.close();
  api.close();
  observer.kill('SIGTERM');
  await new Promise((done) => observer.on('exit', done));
  const observed = JSON.parse(
    observerOutput
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .pop() || '{}',
  );
  summary.observer = observed;
  check(
    8,
    'retrieval token absent from the probe process',
    independentProbe.report?.env_source === 'proc-self-environ' &&
      Array.isArray(independentProbe.report?.env_names) &&
      independentProbe.report.env_names.length === 0 &&
      (observed.seen || []).includes('probe') &&
      !(observed.exposed || []).includes('probe'),
    `probe env_names=${JSON.stringify(independentProbe.report?.env_names)}; observer saw ${(observed.seen || []).filter((kind) => kind === 'probe').length} probe process(es), token exposed in ${(observed.exposed || []).length}`,
  );
  check(
    9,
    'retrieval token absent from the proof process',
    proofReport?.token_seen === false &&
      !(proofReport?.env_names || []).some((name) =>
        /^(DEVGOV_AUTHORITY_TOKEN|GITHUB_TOKEN|GH_TOKEN)$/.test(name),
      ) &&
      !(observed.exposed || []).includes('proof'),
    `proof env credential names=${JSON.stringify((proofReport?.env_names || []).filter((name) => /TOKEN/.test(name)))}`,
  );
  const afterDigest = authority.authorityTreeDigest(root);
  check(10, 'tree digest unchanged after probe and proof', afterDigest === contentDigest, afterDigest);
  check(
    11,
    'the proof command executes successfully',
    greenEvidence.classification === 'PASS' && greenEvidence.exit_code === 0,
    `${greenEvidence.classification} exit=${greenEvidence.exit_code}`,
  );

  // ---- 12-14: record binding, attestation, gate -------------------------------------------
  const context = {
    runner_identity: 'github-hosted:ubuntu-latest',
    controller_sha: controllerSha,
    workflow_ref: workflowRef,
    workflow_run_id: '1',
    workflow_run_attempt: '1',
  };
  const redRecord = devgov.trustedExecutionRecord(unit, redEvidence, context);
  greenRecord = devgov.trustedExecutionRecord(unit, greenEvidence, context);
  const bindingErrors = devgov.validateExecutionRecordForManifest(unit, greenRecord, 'GREEN', 'green', {
    candidateSha: repoSha,
    authorityCatalog: loaded.catalog,
  });
  check(
    12,
    'the execution record binds the protected authority identity',
    bindingErrors.length === 0 &&
      greenRecord.authority_id === AUTHORITY_ID &&
      greenRecord.authority_content_digest === contentDigest &&
      greenRecord.authority_reference_digest === referenceDigest &&
      greenRecord.authority_materialization_result === 'VERIFIED_READ_ONLY',
    bindingErrors.join('; ') || `${greenRecord.schema_version} ${greenRecord.authority_binding_digest}`,
  );
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
  const verification = attestation.verifyExecutionAttestation(signed[1], policy);
  attestationValid = verification.valid;
  check(13, 'the attestation verifies', verification.valid, verification.errors.join('; '));
  gate = devgov.evaluateTrustedExecutionGate(unit, signed, policy, {
    candidateSha: repoSha,
    controllerSha,
    authorityCatalog: loaded.catalog,
  });
  check(14, 'the evidence gate returns PROVEN', gate.proof_status === 'PROVEN', gate.errors.join('; '));
} else {
  cdn.close();
  api.close();
  observer.kill('SIGTERM');
  await new Promise((done) => observer.on('exit', done));
  const notReached = `not reached: resolution ${resolution.status} ${resolution.reason_code}`;
  const names = [
    'probe report binds the exact expected uid/gid and every required check',
    'the proof reads the granted authority',
    'every mutation by the proof identity is denied',
    'retrieval token absent from the probe process',
    'retrieval token absent from the proof process',
    'tree digest unchanged after probe and proof',
    'the proof command executes successfully',
    'the execution record binds the protected authority identity',
    'the attestation verifies',
    'the evidence gate returns PROVEN',
  ];
  names.forEach((name, index) => check(index + 5, name, false, notReached));
}

summary.requests = requests;
summary.proof_report = proofReport;
summary.green = greenEvidence && {
  classification: greenEvidence.classification,
  exit_code: greenEvidence.exit_code,
  authority_id: greenRecord?.authority_id,
  authority_content_digest: greenRecord?.authority_content_digest,
  authority_reference_digest: greenRecord?.authority_reference_digest,
  authority_materialization_result: greenRecord?.authority_materialization_result,
};
summary.attestation_valid = attestationValid;
summary.gate = gate;
summary.checks = checks;
summary.passed = checks.filter((entry) => entry.pass).length;
summary.total = checks.length;
const jsonFile = option('--json');
if (jsonFile) writeFileSync(jsonFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${summary.passed}/${summary.total} root-topology checks passed`);
if (!argv.includes('--keep')) rmSync(workspace, { recursive: true, force: true });
process.exit(summary.passed === summary.total && summary.total === 14 ? 0 : 1);
