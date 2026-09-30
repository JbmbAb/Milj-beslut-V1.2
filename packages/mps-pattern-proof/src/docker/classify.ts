/**
 * PATTERN-PROOF-ENGINE-01 V1 -- install-probe output classification (grounding report section 6 + plan T1).
 *
 * Exit codes alone cannot classify: npm 10 exits 1 both for the RED failure and for network failures,
 * and `docker build` exits 1 for any inner failure. The predicate therefore parses the merged output
 * text. It is executor-agnostic: host-npm and docker-stage-prefix outputs of the same failure must
 * classify identically (tests assert this on the verbatim captured signatures).
 *
 * Order (fail closed):
 *   1. BLOCKED  -- spawn error, wall-clock timeout, killed by signal, a BLOCKED output signature, or the
 *                  install step never started.
 *   2. FAIL     -- RED confirmed: install step started AND lifecycle banner AND `Cannot find module`
 *                  on a lifecycle-script path (relative to workdir) AND `code: 'MODULE_NOT_FOUND'` AND
 *                  `npm error command sh -c <exact lifecycle script>`. A truncated log that still shows
 *                  the banner followed by `Cannot find module` on a lifecycle path is FAIL, never PASS.
 *   3. PASS     -- exit 0 (install completed) or a failure carrying none of the above signatures
 *                  (INSTALL_FAILED_OTHER, with the captured `npm error code X` line).
 */
import type { PackageIdentity } from './lifecycle-scripts';

export type ProbeClassificationKind = 'PASS' | 'FAIL' | 'BLOCKED';

export interface ProbeClassification {
  readonly classification: ProbeClassificationKind;
  readonly reasonCode: string;
  /** the output lines that decided the classification */
  readonly matched: readonly string[];
}

export interface ProbeSpawnError {
  readonly code?: string;
  readonly message: string;
}

export interface InstallProbeOutputInput {
  /** merged stdout+stderr */
  readonly output: string;
  readonly exitStatus: number | null;
  readonly timedOut: boolean;
  readonly spawnError?: ProbeSpawnError;
  readonly installStepStarted: boolean;
  /** `L`: node script paths of the candidate's lifecycle scripts */
  readonly lifecyclePaths: readonly string[];
  /** the raw lifecycle script strings from the candidate's package.json */
  readonly lifecycleScriptStrings: readonly string[];
  /** the working directory the install command ran in (in-image WORKDIR or the host temp dir) */
  readonly workdir: string;
  readonly installCommand: string;
  readonly packageIdentity: PackageIdentity;
}

export interface BlockedOutputSignature {
  readonly reasonCode: string;
  readonly pattern: RegExp;
}

/** BLOCKED output signatures (grounding section 6 item 1 + plan T1), checked line by line. */
export const BLOCKED_OUTPUT_SIGNATURES: readonly BlockedOutputSignature[] = Object.freeze([
  { reasonCode: 'DOCKER_UNAVAILABLE', pattern: /failed to connect to the docker API/ },
  { reasonCode: 'DOCKER_UNAVAILABLE', pattern: /Cannot connect to the Docker daemon/ },
  {
    reasonCode: 'DOCKER_UNAVAILABLE',
    pattern: /permission denied while trying to connect to the Docker daemon socket/,
  },
  { reasonCode: 'DOCKER_NETWORK_UNAVAILABLE', pattern: /network bridge not found/ },
  { reasonCode: 'TLS_NOT_TRUSTED', pattern: /SELF_SIGNED_CERT_IN_CHAIN/ },
  { reasonCode: 'TLS_NOT_TRUSTED', pattern: /server certificate not trusted/ },
  { reasonCode: 'NETWORK_UNREACHABLE', pattern: /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b/ },
  { reasonCode: 'NPM_EXIT_HANDLER_NEVER_CALLED', pattern: /Exit handler never called/ },
  { reasonCode: 'IMAGE_OR_FETCH_FAILED', pattern: /failed to (?:resolve|fetch|pull)\b/ },
]);

export const RED_REASON_CODE = 'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND';
export const RED_TRUNCATED_REASON_CODE = 'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND_TRUNCATED';

const CANNOT_FIND_MODULE = /Error: Cannot find module '([^']+)'/;
const MODULE_NOT_FOUND_CODE = /code: 'MODULE_NOT_FOUND'/;
const NPM_ERROR_COMMAND = /npm error command sh -c (.+?)\s*$/;
const NPM_ERROR_CODE = /npm error code (\S+)/;
const DOCKER_STEP_FAILED = /did not complete successfully: exit code: (\d+)/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relativeToWorkdir(modulePath: string, workdir: string): string {
  const base = workdir.endsWith('/') ? workdir : `${workdir}/`;
  return modulePath.startsWith(base) ? modulePath.slice(base.length) : modulePath;
}

function classification(
  kind: ProbeClassificationKind,
  reasonCode: string,
  matched: readonly string[],
): ProbeClassification {
  return Object.freeze({ classification: kind, reasonCode, matched: Object.freeze([...matched]) });
}

export function classifyInstallProbeOutput(input: InstallProbeOutputInput): ProbeClassification {
  const lines = input.output.split(/\r?\n/);

  // 1. BLOCKED -- the probe could not execute.
  if (input.spawnError !== undefined) {
    const code = input.spawnError.code;
    const reason = code === 'ENOENT' || code === 'EACCES' ? `SPAWN_${code}` : 'SPAWN_ERROR';
    return classification('BLOCKED', reason, [input.spawnError.message]);
  }
  if (input.timedOut) return classification('BLOCKED', 'TIMEOUT', []);
  for (const signature of BLOCKED_OUTPUT_SIGNATURES) {
    const hits = lines.filter((line) => signature.pattern.test(line));
    if (hits.length > 0) return classification('BLOCKED', signature.reasonCode, hits);
  }
  if (!input.installStepStarted) return classification('BLOCKED', 'INSTALL_STEP_NOT_STARTED', []);
  if (input.exitStatus === null) return classification('BLOCKED', 'KILLED_BY_SIGNAL', []);

  // 2. FAIL -- RED confirmed.
  const { name, version } = input.packageIdentity;
  const banner = new RegExp(
    `> ${escapeRegExp(name)}@${escapeRegExp(version)} (?:preinstall|install|postinstall|prepare)\\s*$`,
  );
  const bannerIndex = lines.findIndex((line) => banner.test(line));
  if (bannerIndex !== -1) {
    const after = lines.slice(bannerIndex + 1);
    const cannotFind = after.find((line) => {
      const match = CANNOT_FIND_MODULE.exec(line);
      return match !== null && input.lifecyclePaths.includes(relativeToWorkdir(match[1], input.workdir));
    });
    if (cannotFind !== undefined) {
      const codeLine = after.find((line) => MODULE_NOT_FOUND_CODE.test(line));
      const commandLine = after.find((line) => {
        const match = NPM_ERROR_COMMAND.exec(line);
        return match !== null && input.lifecycleScriptStrings.includes(match[1]);
      });
      const dockerLine = after.find((line) => DOCKER_STEP_FAILED.test(line));
      const matched = [lines[bannerIndex], cannotFind];
      if (codeLine !== undefined) matched.push(codeLine);
      if (commandLine !== undefined) matched.push(commandLine);
      if (dockerLine !== undefined) matched.push(dockerLine);
      const complete = codeLine !== undefined && commandLine !== undefined;
      return classification('FAIL', complete ? RED_REASON_CODE : RED_TRUNCATED_REASON_CODE, matched);
    }
  }

  // 3. PASS -- for THIS probe's asserted behavior only (solution-neutral contract).
  if (input.exitStatus === 0) return classification('PASS', 'INSTALL_COMPLETED', []);
  const npmCode = lines.find((line) => NPM_ERROR_CODE.test(line));
  const dockerFailed = lines.find((line) => DOCKER_STEP_FAILED.test(line));
  const matched: string[] = [];
  if (npmCode !== undefined) matched.push(npmCode);
  if (dockerFailed !== undefined) matched.push(dockerFailed);
  return classification('PASS', 'INSTALL_FAILED_OTHER', matched);
}
