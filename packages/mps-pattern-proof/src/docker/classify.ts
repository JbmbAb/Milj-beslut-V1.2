/**
 * PATTERN-PROOF-ENGINE-01 V1 -- install-probe output classification (grounding report section 6 + plan T1).
 *
 * Exit codes alone cannot classify: npm 10 exits 1 both for the RED failure and for network failures,
 * and `docker build` exits 1 for any inner failure. The predicate therefore parses the merged output
 * text. It is executor-agnostic: host-npm and docker-stage-prefix outputs of the same failure must
 * classify identically (tests assert this on the verbatim captured signatures).
 *
 * Order (fail closed; R1 F1/F2/F6/F11):
 *   1. BLOCKED  -- spawn error (including the executors' pre-spawn preconditions CONTEXT_INCOMPLETE and
 *                  HOST_FIDELITY_UNSUPPORTED), wall-clock timeout, a BLOCKED output signature on a
 *                  non-zero exit, the install step never started, killed by signal, or -- on a
 *                  non-zero exit -- the candidate declares lifecycle scripts none of which derives a
 *                  `node <path>` (LIFECYCLE_RUNNER_UNSUPPORTED: the FAIL predicate cannot be evaluated).
 *   2. FAIL     -- RED confirmed: exit status != 0 AND install step started AND lifecycle banner of the
 *                  probed package AND `Cannot find module '<path>'` (CJS or ESM loader shape, R2 F2)
 *                  where `<path>` is ITSELF a member of `L` (the lifecycle ENTRY paths, both sides
 *                  resolved against the workdir) AND `code: 'MODULE_NOT_FOUND'` (or
 *                  `ERR_MODULE_NOT_FOUND`) AND `npm error command sh -c <exact lifecycle script>`; at
 *                  docker fidelity the `did not complete successfully` line, when present, must name
 *                  the install command. A truncated log that still shows the banner followed by
 *                  `Cannot find module` on a lifecycle path is FAIL (…_TRUNCATED), never PASS.
 *                  Documented contract (R3 F4): ONLY the entry paths in `L` are detected. A transitive
 *                  script-local import failure -- an existing entry in `L` that imports an absent
 *                  sibling, the ESM shape `Cannot find module '<sibling>' imported from <entry>` --
 *                  is NOT the asserted failure and classifies PASS
 *                  INSTALL_FAILED_AFTER_LIFECYCLE_STARTED (the entry script was found and ran);
 *                  the `imported from` operand is deliberately not consulted.
 *   3. PASS     -- for THIS probe's asserted behavior only:
 *                  exit 0 (INSTALL_COMPLETED, or INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT when the
 *                  lifecycle error text is present although the install completed -- masking is made
 *                  visible in `matched`), or exit != 0 with the probed package's lifecycle banner present
 *                  but none of the FAIL signatures (INSTALL_FAILED_AFTER_LIFECYCLE_STARTED: the lifecycle
 *                  script was found; the asserted failure mode is absent).
 *   4. BLOCKED  -- exit != 0 without the probed package's lifecycle banner and without a BLOCKED
 *                  signature: INSTALL_FAILED_UNATTRIBUTED. A broken context or a signature/npm drift
 *                  is never reported as PASS.
 */
import path from 'node:path';
import { normalizeScriptPath, type PackageIdentity } from './lifecycle-scripts';

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

/**
 * BLOCKED output signatures (grounding section 6 item 1 + plan T1), checked line by line on a
 * non-zero exit only (R1 F11: a completed install whose log carries a retried-fetch warning is PASS).
 */
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
  // R1 F2: the probed context did not contain the package manifest -- never PASS
  { reasonCode: 'CONTEXT_INCOMPLETE', pattern: /npm error code ENOENT\b/ },
  { reasonCode: 'CONTEXT_INCOMPLETE', pattern: /Could not read package\.json/ },
]);

/**
 * Executor precondition codes carried in `spawnError.code` when a probe is refused BEFORE spawning
 * (R1 F2/F8). They classify BLOCKED under their own reasonCode.
 */
export const PROBE_PRECONDITION_CODES = Object.freeze(['CONTEXT_INCOMPLETE', 'HOST_FIDELITY_UNSUPPORTED']);

export const RED_REASON_CODE = 'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND';
export const RED_TRUNCATED_REASON_CODE = 'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND_TRUNCATED';
export const LIFECYCLE_RUNNER_UNSUPPORTED_REASON_CODE = 'LIFECYCLE_RUNNER_UNSUPPORTED';
export const INSTALL_FAILED_UNATTRIBUTED_REASON_CODE = 'INSTALL_FAILED_UNATTRIBUTED';
export const INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE = 'INSTALL_FAILED_AFTER_LIFECYCLE_STARTED';
export const INSTALL_COMPLETED_REASON_CODE = 'INSTALL_COMPLETED';
export const INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT_REASON_CODE =
  'INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT';

// R2 F2: the CJS loader prints `Error: Cannot find module '<path>'` / `code: 'MODULE_NOT_FOUND'`; the
// ESM loader prints `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<path>' imported from ...` /
// `code: 'ERR_MODULE_NOT_FOUND'`. Both are the asserted failure when `<path>` is a member of L (R3 F4:
// the `imported from` operand is not consulted; a missing sibling of an entry is not the asserted failure).
const CANNOT_FIND_MODULE = /Error(?: \[ERR_MODULE_NOT_FOUND\])?: Cannot find module '([^']+)'/;
const MODULE_NOT_FOUND_CODE = /code: '(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)'/;
const NPM_ERROR_COMMAND = /npm error command sh -c (.+?)\s*$/;
const NPM_ERROR_CODE = /npm error code (\S+)/;
const DOCKER_STEP_FAILED = /process "((?:[^"\\]|\\.)*)" did not complete successfully: exit code: (\d+)/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function relativeToWorkdir(modulePath: string, workdir: string): string {
  const base = workdir.endsWith('/') ? workdir : `${workdir}/`;
  return modulePath.startsWith(base) ? modulePath.slice(base.length) : modulePath;
}

/**
 * Canonical form of a lifecycle/module path for membership in `L` (R1 F1): posix-normalized, `./`
 * stripped, and an absolute path relativised to the (normalized) workdir.
 */
export function canonicalLifecyclePath(scriptPath: string, workdir: string): string {
  const normalized = normalizeScriptPath(scriptPath);
  if (!path.posix.isAbsolute(normalized)) return normalized;
  const relative = relativeToWorkdir(normalized, path.posix.normalize(workdir));
  return path.posix.isAbsolute(relative) ? relative : normalizeScriptPath(relative);
}

/**
 * Absolute form of a lifecycle/module path for membership in `L` (R2 F2): `path.posix.resolve` of
 * the (normalized) path against the workdir, so `../scripts/x.mjs` under `/app/nested` and the
 * `/app/scripts/x.mjs` node prints are the same member. The workdir is always absolute (an in-image
 * WORKDIR or a host temp dir); a relative one is rooted at `/` so the result never depends on cwd.
 */
export function resolvedLifecyclePath(scriptPath: string, workdir: string): string {
  const normalizedWorkdir = path.posix.normalize(workdir);
  const root = path.posix.isAbsolute(normalizedWorkdir) ? normalizedWorkdir : `/${normalizedWorkdir}`;
  return path.posix.resolve(root, normalizeScriptPath(scriptPath));
}

/** The command a BuildKit `did not complete successfully` line names (shell-form wrapper removed). */
function dockerFailedCommand(line: string): string | undefined {
  const match = DOCKER_STEP_FAILED.exec(line);
  if (match === null) return undefined;
  const command = match[1].replace(/\\(.)/g, '$1');
  return normalizeSpaces(command.replace(/^\/bin\/sh -c /, ''));
}

function classification(
  kind: ProbeClassificationKind,
  reasonCode: string,
  matched: readonly string[],
): ProbeClassification {
  return Object.freeze({ classification: kind, reasonCode, matched: Object.freeze([...matched]) });
}

function failureContextLines(lines: readonly string[]): string[] {
  const matched: string[] = [];
  const npmCode = lines.find((line) => NPM_ERROR_CODE.test(line));
  const dockerFailed = lines.find((line) => DOCKER_STEP_FAILED.test(line));
  if (npmCode !== undefined) matched.push(npmCode);
  if (dockerFailed !== undefined) matched.push(dockerFailed);
  return matched;
}

interface LifecycleErrorText {
  readonly cannotFind: string;
  readonly codeLine?: string;
  readonly commandLine?: string;
}

/** The lifecycle MODULE_NOT_FOUND text after the banner, on a path of `L`, if present. */
function lifecycleErrorTextOf(
  after: readonly string[],
  input: InstallProbeOutputInput,
): LifecycleErrorText | undefined {
  // R2 F2: both sides resolved against the workdir (`../` in L, absolute in the node output)
  const lifecycle = new Set(input.lifecyclePaths.map((p) => resolvedLifecyclePath(p, input.workdir)));
  const cannotFind = after.find((line) => {
    const match = CANNOT_FIND_MODULE.exec(line);
    return match !== null && lifecycle.has(resolvedLifecyclePath(match[1], input.workdir));
  });
  if (cannotFind === undefined) return undefined;
  const codeLine = after.find((line) => MODULE_NOT_FOUND_CODE.test(line));
  const commandLine = after.find((line) => {
    const match = NPM_ERROR_COMMAND.exec(line);
    return match !== null && input.lifecycleScriptStrings.includes(match[1]);
  });
  const text: { cannotFind: string; codeLine?: string; commandLine?: string } = { cannotFind };
  if (codeLine !== undefined) text.codeLine = codeLine;
  if (commandLine !== undefined) text.commandLine = commandLine;
  return text;
}

export function classifyInstallProbeOutput(input: InstallProbeOutputInput): ProbeClassification {
  const lines = input.output.split(/\r?\n/);
  const failed = input.exitStatus !== 0;

  // 1. BLOCKED -- the probe could not execute.
  if (input.spawnError !== undefined) {
    const code = input.spawnError.code;
    let reason = 'SPAWN_ERROR';
    if (code === 'ENOENT' || code === 'EACCES') reason = `SPAWN_${code}`;
    else if (code !== undefined && PROBE_PRECONDITION_CODES.includes(code)) reason = code;
    return classification('BLOCKED', reason, [input.spawnError.message]);
  }
  if (input.timedOut) return classification('BLOCKED', 'TIMEOUT', []);
  if (failed) {
    for (const signature of BLOCKED_OUTPUT_SIGNATURES) {
      const hits = lines.filter((line) => signature.pattern.test(line));
      if (hits.length > 0) return classification('BLOCKED', signature.reasonCode, hits);
    }
  }
  if (!input.installStepStarted) return classification('BLOCKED', 'INSTALL_STEP_NOT_STARTED', []);
  if (input.exitStatus === null) return classification('BLOCKED', 'KILLED_BY_SIGNAL', []);
  if (failed && input.lifecycleScriptStrings.length > 0 && input.lifecyclePaths.length === 0) {
    // The candidate runs its lifecycle through a runner this predicate cannot follow: the FAIL
    // predicate is not evaluable, so the failed install is BLOCKED (never PASS by absence).
    return classification('BLOCKED', LIFECYCLE_RUNNER_UNSUPPORTED_REASON_CODE, [
      ...input.lifecycleScriptStrings,
      ...failureContextLines(lines),
    ]);
  }

  // Lifecycle banner of the probed package (bound to the candidate's identity).
  const { name, version } = input.packageIdentity;
  const banner = new RegExp(
    `> ${escapeRegExp(name)}@${escapeRegExp(version)} (?:preinstall|install|postinstall|prepare)\\s*$`,
  );
  const bannerIndex = lines.findIndex((line) => banner.test(line));
  const after = bannerIndex === -1 ? [] : lines.slice(bannerIndex + 1);
  const errorText = bannerIndex === -1 ? undefined : lifecycleErrorTextOf(after, input);

  if (!failed) {
    // 3. PASS -- the install completed (exit 0).
    if (errorText === undefined) return classification('PASS', INSTALL_COMPLETED_REASON_CODE, []);
    const matched = [lines[bannerIndex], errorText.cannotFind];
    if (errorText.codeLine !== undefined) matched.push(errorText.codeLine);
    if (errorText.commandLine !== undefined) matched.push(errorText.commandLine);
    return classification('PASS', INSTALL_COMPLETED_WITH_LIFECYCLE_ERROR_TEXT_REASON_CODE, matched);
  }

  if (bannerIndex === -1) {
    // 4. BLOCKED -- a failed install that cannot be attributed to the lifecycle script.
    return classification('BLOCKED', INSTALL_FAILED_UNATTRIBUTED_REASON_CODE, failureContextLines(lines));
  }

  // 2. FAIL -- RED confirmed (exit != 0, banner, lifecycle error text on a path of L).
  if (errorText !== undefined) {
    const wanted = normalizeSpaces(input.installCommand);
    const dockerFailedLines = after.filter((line) => DOCKER_STEP_FAILED.test(line));
    const installFailedLine = dockerFailedLines.find((line) => dockerFailedCommand(line) === wanted);
    if (dockerFailedLines.length === 0 || installFailedLine !== undefined) {
      const matched = [lines[bannerIndex], errorText.cannotFind];
      if (errorText.codeLine !== undefined) matched.push(errorText.codeLine);
      if (errorText.commandLine !== undefined) matched.push(errorText.commandLine);
      if (installFailedLine !== undefined) matched.push(installFailedLine);
      const complete = errorText.codeLine !== undefined && errorText.commandLine !== undefined;
      return classification('FAIL', complete ? RED_REASON_CODE : RED_TRUNCATED_REASON_CODE, matched);
    }
  }

  // 3. PASS -- the lifecycle script was found and ran; the asserted failure mode is absent.
  return classification('PASS', INSTALL_FAILED_AFTER_LIFECYCLE_STARTED_REASON_CODE, [
    lines[bannerIndex],
    ...failureContextLines(lines),
  ]);
}
