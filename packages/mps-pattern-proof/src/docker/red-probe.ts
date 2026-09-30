/**
 * PATTERN-PROOF-ENGINE-01 V1 -- executable, solution-neutral RED probe (BOOTSTRAP design section 5.4).
 *
 * executeRedProbe derives the target stage's prefix from the CANDIDATE Dockerfile, runs it through the
 * docker or host executor (auto: docker when `docker info` succeeds, else host -- plan T1), classifies
 * the merged output text (never exit codes alone) and returns a deep-frozen, canonicalizable result
 * (no undefined-valued keys, ISO timestamps, errors serialized as { code, message }).
 *
 * The result is EVIDENCE for the RED plan: FAIL means RED confirmed (the asserted behavior is violated
 * today), PASS means the candidate satisfies the asserted behavior for THIS probe, BLOCKED means the
 * probe could not execute -- never converted into PASS or FAIL.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RedProbe } from '../artifacts';
import { PatternProofError } from '../errors';
import { deepFreeze } from '../internal/deep-freeze';
import type { EvidenceLocator } from '../evidence';
import { digestOf } from '../identity';
import { classifyInstallProbeOutput, type ProbeClassificationKind } from './classify';
import { parseDockerfile } from './dockerfile-parse';
import {
  dockerAvailable,
  runDockerStagePrefixProbe,
  runHostStagePrefixProbe,
  type ProbeFidelity,
  type ProbeToolchain,
  type RawProbeExecution,
} from './executors';
import { lifecycleScriptPaths, lifecycleScriptStrings, packageIdentity } from './lifecycle-scripts';
import { redProbeForStage } from './red-plan-probes';
import { deriveStagePrefix } from './stage-prefix';

export type RedProbeExecutorChoice = 'docker' | 'host' | 'auto';
export type RedProbeExecutorUsed = 'docker' | 'host' | 'none';

export const DEFAULT_RED_PROBE_TIMEOUT_MS = 780_000;
export const OUTPUT_EXCERPT_MAX_LINES = 40;

export interface ExecuteRedProbeOptions {
  readonly repoRoot: string;
  /** relative to repoRoot (default Dockerfile) */
  readonly dockerfilePath?: string;
  readonly stageName: string;
  readonly executor?: RedProbeExecutorChoice;
  readonly timeoutMs?: number;
  readonly caBundlePath?: string;
  readonly dockerHost?: string;
  readonly network?: string;
  /** relative to repoRoot (default package.json) */
  readonly packageJsonPath?: string;
}

export interface RedProbePrefixSummary {
  readonly lineage: readonly string[];
  readonly contextSources: readonly string[];
  readonly installCommand: string;
  readonly installLine: number;
  readonly baseImage: string;
  readonly derivedDockerfileDigest?: string;
}

export interface RedProbeExecutionResult {
  readonly probeId: string;
  readonly stageName: string;
  readonly assertedBehavior: string;
  readonly authorityEvidence: EvidenceLocator;
  readonly classification: ProbeClassificationKind;
  readonly reasonCode: string;
  readonly matched: readonly string[];
  readonly fidelity: ProbeFidelity;
  readonly executorRequested: RedProbeExecutorChoice;
  readonly executorUsed: RedProbeExecutorUsed;
  readonly blockedReason?: string;
  readonly prefix: RedProbePrefixSummary;
  /** single line: node/npm/platform/docker versions/base image */
  readonly toolchainIdentity: string;
  readonly evidence: readonly EvidenceLocator[];
  readonly startedAt: string;
  readonly elapsedMs: number;
  /** the matched signature lines (or the output tail when nothing matched), at most 40 lines */
  readonly outputExcerpt: string;
  readonly exitStatus: number | null;
  readonly timedOut: boolean;
  readonly installStepStarted: boolean;
  readonly contextFiles: readonly string[];
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new PatternProofError('PPE_PROBE_BLOCKED', `cannot read ${file}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new PatternProofError('PPE_PROBE_BLOCKED', `cannot parse ${file}: ${(error as Error).message}`);
  }
}

/** Blob id of the WORKING-TREE Dockerfile content (what was actually probed), when git is available. */
function gitBlobIdOf(repoRoot: string, relativeFile: string): string | undefined {
  const result = spawnSync('git', ['-C', repoRoot, 'hash-object', '--', relativeFile], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error !== undefined || result.status !== 0) return undefined;
  const sha = result.stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}

export function toolchainIdentityLine(toolchain: ProbeToolchain): string {
  const parts = [`node ${toolchain.node}`, `npm ${toolchain.npm}`, toolchain.platform];
  if (toolchain.dockerClient !== undefined) parts.push(`docker client ${toolchain.dockerClient}`);
  if (toolchain.dockerServer !== undefined) parts.push(`docker server ${toolchain.dockerServer}`);
  if (toolchain.baseImage !== undefined) {
    parts.push(
      `base image ${toolchain.baseImage}${toolchain.baseImageDigest === undefined ? '' : `@${toolchain.baseImageDigest}`}`,
    );
  }
  return parts.join('; ');
}

function excerptOf(matched: readonly string[], output: string): string {
  const lines = matched.length > 0 ? [...matched] : output.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.slice(-OUTPUT_EXCERPT_MAX_LINES).join('\n');
}

export async function executeRedProbe(opts: ExecuteRedProbeOptions): Promise<RedProbeExecutionResult> {
  const probe: RedProbe = redProbeForStage(opts.stageName);
  const dockerfilePath = opts.dockerfilePath ?? 'Dockerfile';
  const packageJsonPath = opts.packageJsonPath ?? 'package.json';
  const executorRequested = opts.executor ?? 'auto';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RED_PROBE_TIMEOUT_MS;

  const dockerfileAbsolute = path.resolve(opts.repoRoot, dockerfilePath);
  let dockerfileText: string;
  try {
    dockerfileText = fs.readFileSync(dockerfileAbsolute, 'utf8');
  } catch (error) {
    throw new PatternProofError(
      'PPE_PROBE_BLOCKED',
      `cannot read ${dockerfileAbsolute}: ${(error as Error).message}`,
    );
  }
  const prefix = deriveStagePrefix(parseDockerfile(dockerfileText), opts.stageName);
  const packageJson = readJson(path.resolve(opts.repoRoot, packageJsonPath));
  const identity = packageIdentity(packageJson);
  const lifecyclePaths = lifecycleScriptPaths(packageJson);
  const scriptStrings = lifecycleScriptStrings(packageJson);

  const dockerfileEvidence: EvidenceLocator[] = [
    {
      kind: 'file_line',
      ref: `${dockerfilePath}:${prefix.installLine}`,
      note: 'install step of the probed stage',
    },
  ];
  const blobId = gitBlobIdOf(opts.repoRoot, dockerfilePath);
  if (blobId !== undefined) {
    dockerfileEvidence.push({ kind: 'git_object', ref: blobId, note: `blob of ${dockerfilePath} as probed` });
  }

  const prefixSummary = (derivedDockerfile?: string): RedProbePrefixSummary => {
    const summary: {
      lineage: readonly string[];
      contextSources: readonly string[];
      installCommand: string;
      installLine: number;
      baseImage: string;
      derivedDockerfileDigest?: string;
    } = {
      lineage: [...prefix.lineage],
      contextSources: [...prefix.contextSources],
      installCommand: prefix.installCommand,
      installLine: prefix.installLine,
      baseImage: prefix.baseImage,
    };
    if (derivedDockerfile !== undefined) summary.derivedDockerfileDigest = digestOf(derivedDockerfile);
    return summary;
  };

  let executorUsed: RedProbeExecutorUsed = 'none';
  let blockedReason: string | undefined;
  if (executorRequested === 'host') {
    executorUsed = 'host';
  } else {
    const availability = await dockerAvailable(opts.dockerHost);
    if (availability.ok) {
      executorUsed = 'docker';
    } else if (executorRequested === 'auto') {
      executorUsed = 'host';
    } else {
      blockedReason = availability.reason ?? 'docker daemon unavailable';
    }
  }

  if (executorUsed === 'none') {
    const startedAt = new Date().toISOString();
    const result: RedProbeExecutionResult = {
      probeId: probe.id,
      stageName: prefix.stageName,
      assertedBehavior: probe.assertedBehavior,
      authorityEvidence: { ...probe.authorityEvidence },
      classification: 'BLOCKED',
      reasonCode: 'DOCKER_UNAVAILABLE',
      matched: [],
      fidelity: 'docker-stage-prefix',
      executorRequested,
      executorUsed,
      blockedReason: blockedReason ?? 'docker daemon unavailable',
      prefix: prefixSummary(),
      toolchainIdentity: toolchainIdentityLine({
        node: process.version,
        npm: 'not-run',
        platform: `${process.platform} ${process.arch}`,
        baseImage: prefix.baseImage,
      }),
      evidence: [
        { kind: 'runtime_result', ref: `ppe-red-probe:${probe.id}:${startedAt}:BLOCKED` },
        ...dockerfileEvidence,
      ],
      startedAt,
      elapsedMs: 0,
      outputExcerpt: blockedReason ?? '',
      exitStatus: null,
      timedOut: false,
      installStepStarted: false,
      contextFiles: [],
    };
    return deepFreeze(result);
  }

  const execution: RawProbeExecution =
    executorUsed === 'docker'
      ? await runDockerStagePrefixProbe(prefix, {
          repoRoot: opts.repoRoot,
          timeoutMs,
          ...(opts.caBundlePath === undefined ? {} : { caBundlePath: opts.caBundlePath }),
          ...(opts.dockerHost === undefined ? {} : { dockerHost: opts.dockerHost }),
          ...(opts.network === undefined ? {} : { network: opts.network }),
        })
      : await runHostStagePrefixProbe(prefix, { repoRoot: opts.repoRoot, timeoutMs });

  const classified = classifyInstallProbeOutput({
    output: execution.output,
    exitStatus: execution.exitStatus,
    timedOut: execution.timedOut,
    ...(execution.spawnError === undefined ? {} : { spawnError: execution.spawnError }),
    installStepStarted: execution.installStepStarted,
    lifecyclePaths,
    lifecycleScriptStrings: scriptStrings,
    workdir: execution.workdir,
    installCommand: prefix.installCommand,
    packageIdentity: identity,
  });

  const result: {
    probeId: string;
    stageName: string;
    assertedBehavior: string;
    authorityEvidence: EvidenceLocator;
    classification: ProbeClassificationKind;
    reasonCode: string;
    matched: readonly string[];
    fidelity: ProbeFidelity;
    executorRequested: RedProbeExecutorChoice;
    executorUsed: RedProbeExecutorUsed;
    blockedReason?: string;
    prefix: RedProbePrefixSummary;
    toolchainIdentity: string;
    evidence: readonly EvidenceLocator[];
    startedAt: string;
    elapsedMs: number;
    outputExcerpt: string;
    exitStatus: number | null;
    timedOut: boolean;
    installStepStarted: boolean;
    contextFiles: readonly string[];
  } = {
    probeId: probe.id,
    stageName: prefix.stageName,
    assertedBehavior: probe.assertedBehavior,
    authorityEvidence: { ...probe.authorityEvidence },
    classification: classified.classification,
    reasonCode: classified.reasonCode,
    matched: [...classified.matched],
    fidelity: execution.fidelity,
    executorRequested,
    executorUsed,
    prefix: prefixSummary(execution.derivedDockerfile),
    toolchainIdentity: toolchainIdentityLine(execution.toolchain),
    evidence: [
      {
        kind: 'runtime_result',
        ref: `ppe-red-probe:${probe.id}:${execution.startedAt}:${classified.classification}`,
        note: `${execution.fidelity}; reason ${classified.reasonCode}`,
      },
      ...dockerfileEvidence,
    ],
    startedAt: execution.startedAt,
    elapsedMs: execution.elapsedMs,
    outputExcerpt: excerptOf(classified.matched, execution.output),
    exitStatus: execution.exitStatus,
    timedOut: execution.timedOut,
    installStepStarted: execution.installStepStarted,
    contextFiles: [...execution.contextFiles],
  };
  if (classified.classification === 'BLOCKED') {
    result.blockedReason =
      execution.spawnError?.message ??
      (classified.matched.length > 0 ? classified.matched[0] : `probe blocked: ${classified.reasonCode}`);
  }
  return deepFreeze(result);
}
