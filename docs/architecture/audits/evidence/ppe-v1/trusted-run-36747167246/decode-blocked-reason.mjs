// Decodes the classification of a probe job whose output the DEV-GOV controller records only as hashes.
// usage: node decode-blocked-reason.mjs <local-passing-record.json> <stderr_sha256>:<stage>:<probe-id> ...
//
// The probe CLI ends with one deterministic stderr line
//   <CLASSIFICATION> <reasonCode> probe=<id> stage=<stage> fidelity=<f> executor=<e> elapsedMs=<n>
// and the proof wrapper appends one fixed HARNESS line when the probe exits 2 (BLOCKED). Only elapsedMs is
// unknown, so the recorded stderr_sha256 can be matched by enumeration. The method is first validated on a
// LOCAL record whose stderr is the one-line FAIL verdict (same hashing path), then applied to the real records.
import crypto from 'node:crypto';
import fs from 'node:fs';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// every reason code the classifier/executors of packages/mps-pattern-proof/src/docker can emit
const REASONS = [
  'BLOCKED',
  'CONTEXT_INCOMPLETE',
  'DOCKER_NETWORK_UNAVAILABLE',
  'DOCKER_UNAVAILABLE',
  'EACCES',
  'ENOENT',
  'ERR_MODULE_NOT_FOUND',
  'HOST_FIDELITY_UNSUPPORTED',
  'IMAGE_OR_FETCH_FAILED',
  'INSTALL_COMPLETED',
  'INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT',
  'INSTALL_FAILED_AFTER_LIFECYCLE_STARTED',
  'INSTALL_FAILED_UNATTRIBUTED',
  'INSTALL_STEP_NOT_STARTED',
  'KILLED_BY_SIGNAL',
  'LIFECYCLE_RUNNER_UNSUPPORTED',
  'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND',
  'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND_TRUNCATED',
  'MODULE_NOT_FOUND',
  'NETWORK_UNREACHABLE',
  'NPM_EXIT_HANDLER_NEVER_CALLED',
  'PPE_PROBE_BLOCKED',
  'SIGINT',
  'SIGKILL',
  'SPAWN_ERROR',
  'TIMEOUT',
  'TLS_NOT_TRUSTED',
];
const [localRecordPath, ...targets] = process.argv.slice(2);

const local = JSON.parse(fs.readFileSync(localRecordPath, 'utf8'));
let validated = null;
for (let ms = 0; ms < 200000 && !validated; ms++) {
  for (const executor of ['host', 'docker']) {
    for (const fidelity of ['host-npm', 'docker-stage-prefix']) {
      const line = `FAIL LIFECYCLE_SCRIPT_MODULE_NOT_FOUND probe=red-production-base-npm-ci-postinstall stage=production-base fidelity=${fidelity} executor=${executor} elapsedMs=${ms}\n`;
      if (sha(line) === local.stderr_sha256) validated = { elapsedMs: ms, executor, fidelity };
    }
  }
}
console.log(JSON.stringify({ methodValidatedOnLocalRecord: validated }));

const TAIL = 'HARNESS: RED probe BLOCKED (could not execute: no docker daemon and no host npm/network)\n';
for (const target of targets) {
  const [stderrSha, stage, probe] = target.split(':');
  let found = null;
  for (const reasonCode of REASONS) {
    for (const executor of ['host', 'docker', 'none']) {
      for (const fidelity of ['host-npm', 'docker-stage-prefix']) {
        for (let ms = 0; ms <= 20000 && !found; ms++) {
          const line = `BLOCKED ${reasonCode} probe=${probe} stage=${stage} fidelity=${fidelity} executor=${executor} elapsedMs=${ms}\n`;
          if (sha(line + TAIL) === stderrSha)
            found = { classification: 'BLOCKED', reasonCode, executor, fidelity, elapsedMs: ms };
        }
      }
    }
  }
  console.log(JSON.stringify({ stage, stderr_sha256: stderrSha, decoded: found }));
}
