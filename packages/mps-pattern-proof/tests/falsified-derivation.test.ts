/**
 * Plan section 12 D6 -- FALSIFIED by REAL derivation (not by an oracle table):
 *
 *   candidate Dockerfile = the root Dockerfile with `--ignore-scripts` added to the production-base
 *   install step only (tests/fixtures/dockerfiles.ts withIgnoreScripts); builder is unchanged.
 *   For each stage: deriveStagePrefix(parseDockerfile(candidate), stage) -> the stage's own install
 *   command; a STUBBED executor replays the verbatim output captured in this session for exactly that
 *   install command (tests/fixtures/probe-signatures.ts); classifyInstallProbeOutput classifies it
 *   with the derived installCommand and the lifecycle inputs derived from the real package.json.
 *   builder -> FAIL (MODULE_NOT_FOUND signature), production-base -> PASS (install completed).
 *   The verifier-owned results become a PatternVerificationArtifact (claims grounded in
 *   VERIFIER_OWNED_PROBE, materialInvariant true), verdict FALSIFIED, and the state machine reaches
 *   terminal FALSIFIED: the candidate closes only one of the two probes.
 *
 * DECLARATION (T3): the state machine runs in mode FULL_PATTERN_PROOF on SYNTHETIC artifacts as a
 * contract test of its stop semantics. No agent, no docker daemon, no npm process, no Dockerfile
 * change in the checkout, no WRITER against the target.
 */
import { describe, expect, it } from 'vitest';
import type { EvidenceLocator } from '../src/evidence';
import {
  classifyInstallProbeOutput,
  RED_REASON_CODE,
  type ProbeClassification,
} from '../src/docker/classify';
import { parseDockerfile } from '../src/docker/dockerfile-parse';
import {
  lifecycleScriptPaths,
  lifecycleScriptStrings,
  packageIdentity,
} from '../src/docker/lifecycle-scripts';
import { deriveStagePrefix, type StagePrefix } from '../src/docker/stage-prefix';
import { applyVerification, VERIFY_PHASE_LABEL } from '../src/state-machine';
import { validatePatternVerificationArtifact } from '../src/validators';
import { validCandidate, validDiscovery, validGraph, validRedPlan } from './fixtures/artifacts';
import { readRepoFile, withIgnoreScripts } from './fixtures/dockerfiles';
import {
  BUILDER_INSTALL_COMMAND,
  HOST_BUILDER_IGNORE_SCRIPTS_STDOUT,
  HOST_BUILDER_RED_STDERR,
  HOST_BUILDER_RED_STDOUT,
  HOST_BUILDER_WORKDIR,
  HOST_PRODUCTION_BASE_IGNORE_SCRIPTS_STDOUT,
  HOST_PRODUCTION_BASE_RED_STDERR,
  HOST_PRODUCTION_BASE_RED_STDOUT,
  HOST_PRODUCTION_BASE_WORKDIR,
  PRODUCTION_BASE_INSTALL_COMMAND,
} from './fixtures/probe-signatures';
import {
  buildVerificationFromStageProbes,
  driveToVerify,
  hasNoUndefinedKeys,
  isDeepFrozen,
  seededResolver,
  type StageProbeOutcome,
} from './fixtures/state';

const STAGES = ['builder', 'production-base'] as const;
type Stage = (typeof STAGES)[number];

const ISOLATION_EVIDENCE: readonly EvidenceLocator[] = [
  { kind: 'signed_attestation', ref: `sha256:${'ab'.repeat(32)}`, note: 'verifier-input-bundle' },
  { kind: 'runtime_result', ref: `verifier-context:sha256:${'cd'.repeat(32)}` },
];

// ---------------------------------------------------------------------------------------------
// Stubbed host executor: a replay table of the runs captured in this session, keyed by the EXACT
// install command that was executed (see the doc comments in probe-signatures.ts). It never looks
// at the stage name: the DERIVED install command selects the captured run.
// ---------------------------------------------------------------------------------------------

interface StubbedExecution {
  /** merged stdout+stderr as the host executor merges them */
  readonly output: string;
  readonly exitStatus: number;
  /** the directory the captured run executed in (the host executor reports its temp dir) */
  readonly workdir: string;
}

const CAPTURED_HOST_RUNS: Readonly<Record<string, StubbedExecution>> = Object.freeze({
  [BUILDER_INSTALL_COMMAND]: {
    output: `${HOST_BUILDER_RED_STDOUT}\n${HOST_BUILDER_RED_STDERR}`,
    exitStatus: 1,
    workdir: HOST_BUILDER_WORKDIR,
  },
  [PRODUCTION_BASE_INSTALL_COMMAND]: {
    output: `${HOST_PRODUCTION_BASE_RED_STDOUT}\n${HOST_PRODUCTION_BASE_RED_STDERR}`,
    exitStatus: 1,
    workdir: HOST_PRODUCTION_BASE_WORKDIR,
  },
  [`${BUILDER_INSTALL_COMMAND} --ignore-scripts`]: {
    output: HOST_BUILDER_IGNORE_SCRIPTS_STDOUT,
    exitStatus: 0,
    workdir: HOST_BUILDER_WORKDIR,
  },
  [`${PRODUCTION_BASE_INSTALL_COMMAND} --ignore-scripts`]: {
    output: HOST_PRODUCTION_BASE_IGNORE_SCRIPTS_STDOUT,
    exitStatus: 0,
    workdir: HOST_PRODUCTION_BASE_WORKDIR,
  },
});

function stubbedHostExecutor(prefix: StagePrefix): StubbedExecution {
  const captured = CAPTURED_HOST_RUNS[prefix.installCommand];
  if (captured === undefined) {
    throw new Error(`no captured run for derived install command "${prefix.installCommand}"`);
  }
  return captured;
}

// ---------------------------------------------------------------------------------------------
// Derivation from the candidate Dockerfile + the real package.json
// ---------------------------------------------------------------------------------------------

const ROOT_DOCKERFILE = readRepoFile('Dockerfile');
const CANDIDATE_DOCKERFILE = withIgnoreScripts(ROOT_DOCKERFILE, 'production-base');
const PACKAGE_JSON: unknown = JSON.parse(readRepoFile('package.json'));

const LIFECYCLE_PATHS = lifecycleScriptPaths(PACKAGE_JSON);
const LIFECYCLE_STRINGS = lifecycleScriptStrings(PACKAGE_JSON);
const PACKAGE_IDENTITY = packageIdentity(PACKAGE_JSON);

function derivePrefix(stage: Stage): StagePrefix {
  return deriveStagePrefix(parseDockerfile(CANDIDATE_DOCKERFILE), stage);
}

interface DerivedProbe {
  readonly stage: Stage;
  readonly prefix: StagePrefix;
  readonly execution: StubbedExecution;
  readonly result: ProbeClassification;
}

function probe(stage: Stage): DerivedProbe {
  const prefix = derivePrefix(stage);
  const execution = stubbedHostExecutor(prefix);
  const result = classifyInstallProbeOutput({
    output: execution.output,
    exitStatus: execution.exitStatus,
    timedOut: false,
    // host executor semantics: the process was spawned, so the install step started (executors.ts)
    installStepStarted: true,
    lifecyclePaths: LIFECYCLE_PATHS,
    lifecycleScriptStrings: LIFECYCLE_STRINGS,
    workdir: execution.workdir,
    installCommand: prefix.installCommand,
    packageIdentity: PACKAGE_IDENTITY,
  });
  return { stage, prefix, execution, result };
}

function toOutcome(derived: DerivedProbe): StageProbeOutcome {
  return {
    stageName: derived.stage,
    result: {
      classification: derived.result.classification,
      evidence: {
        kind: 'runtime_result',
        ref: `verifier-owned-probe:${derived.stage}:${derived.result.classification}:${derived.result.reasonCode}`,
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------

describe('D6: the candidate closes only one probe (derived from the candidate Dockerfile itself)', () => {
  it('the candidate differs from the root Dockerfile only in the production-base install step', () => {
    expect(CANDIDATE_DOCKERFILE).not.toBe(ROOT_DOCKERFILE);
    expect(CANDIDATE_DOCKERFILE.split('--ignore-scripts')).toHaveLength(2);
    expect(ROOT_DOCKERFILE).not.toContain('--ignore-scripts');
    const rootBuilder = deriveStagePrefix(parseDockerfile(ROOT_DOCKERFILE), 'builder');
    expect(derivePrefix('builder').installCommand).toBe(rootBuilder.installCommand);
  });

  it('derived install commands: production-base carries --ignore-scripts, builder does not', () => {
    const builder = derivePrefix('builder');
    const productionBase = derivePrefix('production-base');
    expect(builder.installCommand).toBe(BUILDER_INSTALL_COMMAND);
    expect(builder.installCommand).not.toContain('--ignore-scripts');
    expect(productionBase.installCommand).toBe(`${PRODUCTION_BASE_INSTALL_COMMAND} --ignore-scripts`);
    expect(productionBase.installCommand).toContain('--ignore-scripts');
    // both prefixes are real derivations of the target: lineage base -> stage, WORKDIR /app, no scripts/ copied
    expect(builder.lineage).toEqual(['base', 'builder']);
    expect(productionBase.lineage).toEqual(['base', 'production-base']);
    expect(builder.workdir).toBe('/app');
    expect(productionBase.workdir).toBe('/app');
    expect(builder.contextSources.some((source) => source.startsWith('scripts'))).toBe(false);
    expect(productionBase.contextSources.some((source) => source.startsWith('scripts'))).toBe(false);
  });

  it('lifecycle inputs are derived from the real package.json (not constants)', () => {
    expect(PACKAGE_IDENTITY).toEqual({ name: 'miljobeslut-se-2.0', version: '0.0.0' });
    expect(LIFECYCLE_PATHS).toContain('scripts/postinstall-prisma-generate.mjs');
    expect(LIFECYCLE_STRINGS.length).toBeGreaterThan(0);
  });

  it('builder -> FAIL on the captured MODULE_NOT_FOUND signature; production-base -> PASS (install completed)', () => {
    const builder = probe('builder');
    expect(builder.result.classification).toBe('FAIL');
    expect(builder.result.reasonCode).toBe(RED_REASON_CODE);
    expect(builder.result.matched.some((line) => line.includes('Cannot find module'))).toBe(true);

    const productionBase = probe('production-base');
    expect(productionBase.result.classification).toBe('PASS');
    expect(productionBase.result.reasonCode).toBe('INSTALL_COMPLETED');
    expect(productionBase.execution.exitStatus).toBe(0);
  });

  it('control: the root (unchanged) Dockerfile fails BOTH stages under the same derivation', () => {
    const parsed = parseDockerfile(ROOT_DOCKERFILE);
    for (const stage of STAGES) {
      const prefix = deriveStagePrefix(parsed, stage);
      const execution = stubbedHostExecutor(prefix);
      const result = classifyInstallProbeOutput({
        output: execution.output,
        exitStatus: execution.exitStatus,
        timedOut: false,
        installStepStarted: true,
        lifecyclePaths: LIFECYCLE_PATHS,
        lifecycleScriptStrings: LIFECYCLE_STRINGS,
        workdir: execution.workdir,
        installCommand: prefix.installCommand,
        packageIdentity: PACKAGE_IDENTITY,
      });
      expect(result.classification, stage).toBe('FAIL');
    }
  });
});

describe('D6: verifier-owned results -> PatternVerificationArtifact FALSIFIED -> terminal FALSIFIED', () => {
  const outcomes = STAGES.map((stage) => toOutcome(probe(stage)));

  it('the artifact is built only from verifier-owned probe results: material claims, verdict FALSIFIED', () => {
    const verification = validatePatternVerificationArtifact(
      buildVerificationFromStageProbes(outcomes, ISOLATION_EVIDENCE),
    );
    expect(verification.verdict).toBe('FALSIFIED');
    expect(verification.claims).toHaveLength(2);
    expect(verification.claims.every((claim) => claim.materialInvariant)).toBe(true);
    expect(verification.claims.every((claim) => claim.evidenceGrounds.includes('VERIFIER_OWNED_PROBE'))).toBe(
      true,
    );
    expect(
      verification.claims.every((claim) => !claim.evidenceGrounds.includes('WRITER_TEST_REGRESSION')),
    ).toBe(true);
    expect(verification.isolationEvidence).toEqual(ISOLATION_EVIDENCE);
    expect(verification.reasonCode).toBeUndefined();
  });

  it('the state machine reaches terminal FALSIFIED at VERIFY+ADVERSARIAL_PROBES with resolvable isolation evidence', async () => {
    const candidate = validCandidate();
    const resolver = seededResolver(
      validDiscovery(),
      validGraph(),
      validRedPlan(),
      candidate,
      ISOLATION_EVIDENCE,
    );
    const atVerify = await driveToVerify(resolver, candidate);
    expect(atVerify.phase).toBe('VERIFY');

    const verification = buildVerificationFromStageProbes(outcomes, ISOLATION_EVIDENCE);
    const halted = await applyVerification(atVerify, verification, resolver);

    expect(halted.terminal).toEqual({
      state: 'FALSIFIED',
      atPhase: VERIFY_PHASE_LABEL,
      evidence: ISOLATION_EVIDENCE,
    });
    expect(halted.phase).toBe('VERIFY');
    expect(halted.artifacts.verification?.verdict).toBe('FALSIFIED');
    expect(halted.artifacts.proofPackage).toBeUndefined();
    expect(halted.stoppedByMode).toBeUndefined();
    const last = halted.history[halted.history.length - 1];
    expect(last).toEqual({ from: 'VERIFY', to: 'FALSIFIED', via: 'applyVerification' });
    expect(halted.history.some((t) => t.to === 'ASSEMBLE_EVIDENCE' || t.to === 'DONE')).toBe(false);
    expect(isDeepFrozen(halted)).toBe(true);
    expect(hasNoUndefinedKeys(halted)).toBe(true);
  });

  it('closing the builder probe as well (both stages --ignore-scripts) derives ACCEPT, proving the verdict is not fixed', () => {
    const bothClosed = withIgnoreScripts(CANDIDATE_DOCKERFILE, 'builder');
    const parsed = parseDockerfile(bothClosed);
    const bothOutcomes = STAGES.map((stage) => {
      const prefix = deriveStagePrefix(parsed, stage);
      const execution = stubbedHostExecutor(prefix);
      const result = classifyInstallProbeOutput({
        output: execution.output,
        exitStatus: execution.exitStatus,
        timedOut: false,
        installStepStarted: true,
        lifecyclePaths: LIFECYCLE_PATHS,
        lifecycleScriptStrings: LIFECYCLE_STRINGS,
        workdir: execution.workdir,
        installCommand: prefix.installCommand,
        packageIdentity: PACKAGE_IDENTITY,
      });
      expect(prefix.installCommand).toContain('--ignore-scripts');
      return toOutcome({ stage, prefix, execution, result });
    });
    const verification = buildVerificationFromStageProbes(bothOutcomes, ISOLATION_EVIDENCE);
    expect(verification.verdict).toBe('ACCEPT');
  });
});
