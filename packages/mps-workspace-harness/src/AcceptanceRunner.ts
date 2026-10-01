/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the acceptance harness (spec A5, A6, B5, Del D 7-9).
 *
 * This is the ONLY component that reads the frozen expectations. The Observer and the Classifier
 * never receive them, and that is what makes a passing comparison evidence rather than a tautology.
 *
 * The comparison is deliberately ASYMMETRIC (A6), and the asymmetry is the whole incentive design:
 *
 *   expected BLOCKED, got SAFE_TO_REMOVE          HARD FAILURE, always. A false safe is forbidden.
 *   expected SAFE_TO_REMOVE, got BLOCKED,
 *     and utilityRequired = false                 ALLOWED, recorded as a finding with a written
 *                                                 rationale. Being stricter is defensible.
 *   expected SAFE_TO_REMOVE, got BLOCKED,
 *     and utilityRequired = true                  HARD FAILURE. Without this arm, `return BLOCKED`
 *                                                 satisfies SAFETY for all 122 cases and the whole
 *                                                 suite passes while the controller is useless.
 *
 * `expectedSafetyClass` is the adjudicator's reasoning and is NEVER compared mechanically against
 * controller output: the controller's blocker vocabulary is its own, and forcing the two to line up
 * would make the facit a specification of the implementation rather than an independent hypothesis.
 *
 * LOCAL RUNS OF THIS HARNESS ARE DIAGNOSTIC. They create no verification authority. The
 * authoritative run executes outside the implementer's write domain and fetches the corpus and the
 * expectations by content hash; every report prints the eight authority digests it actually used, so
 * substitution shows up as a deviation in the artifact instead of as an invisible event.
 */
import { readFileSync } from 'node:fs';

import {
  CLASSIFIER_VERSION,
  POLICY_VERSION,
  classify,
} from '@miljobeslut/mps-workspace-classifier';
import type { ClassifiableSnapshot, Disposition, OperationScope } from '@miljobeslut/mps-workspace-classifier';
import { OBSERVER_VERSION, SNAPSHOT_SCHEMA_VERSION, observe, sha256Hex } from '@miljobeslut/mps-workspace-observer';

import { bindAuthority } from './AuthorityBinding.js';
import type { BoundAuthority } from './AuthorityBinding.js';
import { ReplayTransport, loadCorpus } from './ReplayTransport.js';
import type { LoadedCorpus } from './ReplayTransport.js';

export type CaseOutcome = 'PASS' | 'HARD_FAILURE' | 'FINDING_STRICTER' | 'CORPUS_DRIFT' | 'ERROR';

export interface FrozenExpectation {
  readonly caseId: string;
  readonly captureDigest: string;
  readonly preferredSpelling: string;
  readonly operation: OperationScope;
  readonly expectedDisposition: 'SAFE_TO_REMOVE' | 'BLOCKED';
  readonly expectedSafetyClass: string;
  readonly utilityRequired: boolean;
  readonly rationale: string;
  readonly adjudicationVersion: string;
}

export interface CaseResult {
  readonly caseId: string;
  readonly outcome: CaseOutcome;
  readonly expected: 'SAFE_TO_REMOVE' | 'BLOCKED';
  readonly actual: 'SAFE_TO_REMOVE' | 'BLOCKED' | 'NOT_CLASSIFIED';
  readonly utilityRequired: boolean;
  readonly expectedSafetyClass: string;
  readonly identityDigest?: string;
  readonly blockerCodes: readonly string[];
  readonly evidence: readonly string[];
  /** Present for FINDING_STRICTER: A6 requires a written justification for every stricter reading. */
  readonly stricterJustification?: string;
  readonly error?: string;
}

export interface AcceptanceReport {
  /** A25 fourfold versioning, in every report. */
  readonly versions: {
    readonly snapshotSchema: string;
    readonly observerVersion: string;
    readonly classifierVersion: string;
    readonly policyVersion: string;
  };
  /**
   * A26 visibility measure: the digest of the expectations and policy blobs actually used, so a
   * substitution becomes a deviation in the artifact rather than an invisible event.
   */
  readonly expectationsDigest: string;
  readonly policyDigest: string;
  readonly authority: {
    readonly authorityManifestDigest: string;
    readonly requiredBindings: Readonly<Record<string, string>>;
    readonly boundFileCount: number;
    readonly authorityReferenceDigest?: string;
  };
  readonly corpus: {
    readonly caseCount: number;
    readonly globalIdentityDigest: string;
    readonly commandSurfaceDigest: string;
  };
  readonly operation: OperationScope;
  readonly layer: 'REPLAY' | 'LIVE';
  readonly safety: {
    readonly satisfied: boolean;
    readonly falseSafeCaseIds: readonly string[];
  };
  readonly utility: {
    readonly satisfied: boolean;
    readonly requiredCaseIds: readonly string[];
    readonly missedCaseIds: readonly string[];
  };
  readonly totals: Readonly<Record<CaseOutcome, number>>;
  readonly cases: readonly CaseResult[];
  /**
   * Coverage the run could NOT exercise, named rather than implied. A green run over a corpus that
   * contains no timeout and no spawn failure proves nothing about the fail-closed path, and a report
   * that does not say so invites the reader to believe otherwise.
   */
  readonly unexercised: readonly string[];
}

export interface AcceptanceOptions {
  readonly authorityRoot: string;
  readonly authorityReferencePath?: string;
  readonly operation?: OperationScope;
}

function readExpectations(path: string): {
  readonly digest: string;
  readonly cases: readonly FrozenExpectation[];
  readonly adjudicationVersion: string;
} {
  const bytes = readFileSync(path);
  const parsed = JSON.parse(bytes.toString('utf8')) as {
    adjudicationVersion: string;
    cases: FrozenExpectation[];
  };
  return {
    digest: sha256Hex(bytes),
    cases: parsed.cases,
    adjudicationVersion: parsed.adjudicationVersion,
  };
}

/**
 * What the frozen corpus cannot exercise, measured rather than assumed.
 *
 * The Phase 0 handoff states that layers 1 and 2 reach no timeout path; this recomputes it from the
 * bytes so the claim in the report is this run's own measurement.
 */
function measureUnexercised(corpus: LoadedCorpus): readonly string[] {
  let timeouts = 0;
  let spawnErrors = 0;
  let base64 = 0;
  let truncations = 0;
  let nonEnoentErrors = 0;

  const scan = (records: readonly unknown[]): void => {
    for (const raw of records) {
      const r = raw as {
        outcome?: string;
        stdout?: { encoding?: string };
        stderr?: { encoding?: string };
        truncation?: unknown;
        result?: { outcome?: string; errorCode?: string | null; truncated?: boolean };
      };
      if (r.outcome === 'TIMEOUT' || r.result?.outcome === 'TIMEOUT') timeouts += 1;
      if (r.outcome === 'SPAWN_ERROR') spawnErrors += 1;
      if (r.stdout?.encoding === 'base64' || r.stderr?.encoding === 'base64') base64 += 1;
      if (r.truncation !== undefined || r.result?.truncated === true) truncations += 1;
      if (r.result?.outcome === 'ERROR' && r.result.errorCode !== 'ENOENT') nonEnoentErrors += 1;
    }
  };

  scan((corpus.global as unknown as { records: unknown[] }).records);
  for (const bundle of corpus.cases.values()) scan(bundle.records as unknown as unknown[]);

  const out: string[] = [];
  if (timeouts === 0) {
    out.push(
      'TIMEOUT: 0 records in the frozen corpus. The timeout path to a fail-closed classification — which the spec names as the most common route to a false safe result — is NOT exercised by this layer.',
    );
  }
  if (spawnErrors === 0) out.push('SPAWN_ERROR: 0 records. The spawn-failure path is not exercised by this layer.');
  if (base64 === 0) out.push('Non-UTF-8 output: 0 records. The base64 branch of every parser is not exercised by this layer.');
  if (truncations === 0) out.push('Truncation: 0 records. TR1, TR2 and the output limit are frozen but unexercised by this layer.');
  if (nonEnoentErrors === 0) {
    out.push(
      'Inconclusive filesystem errors: 0 records; every recorded filesystem error is ENOENT, the one code the contract calls conclusive. EACCES, EPERM, ELOOP and FS_TIMEOUT are not exercised by this layer.',
    );
  }
  return out;
}

export async function runReplayAcceptance(options: AcceptanceOptions): Promise<AcceptanceReport> {
  const operation: OperationScope = options.operation ?? 'WORKTREE_REMOVAL';

  // Fail closed before anything is observed: unverified bytes provide no acceptance value at all.
  const authority: BoundAuthority = bindAuthority({
    authorityRoot: options.authorityRoot,
    authorityReferencePath: options.authorityReferencePath,
  });

  const corpus = loadCorpus({
    corpusDir: `${options.authorityRoot}\\corpus`,
    commandSurfacePath: authority.requiredBindingPaths.commandSurfaceDigest,
    commandSurfaceDigest: authority.requiredBindings.commandSurfaceDigest,
  });

  const expectations = readExpectations(authority.requiredBindingPaths.expectationsDigest);
  const byCase = new Map(expectations.cases.map((c) => [c.caseId, c]));

  const results: CaseResult[] = [];
  for (const caseId of [...corpus.cases.keys()].sort()) {
    const expectation = byCase.get(caseId);
    if (expectation === undefined) {
      // A8: a workspace missing from the facit may still be classified, but it never counts toward
      // UTILITY and is reported separately rather than silently folded into the totals.
      results.push({
        caseId,
        outcome: 'FINDING_STRICTER',
        expected: 'BLOCKED',
        actual: 'NOT_CLASSIFIED',
        utilityRequired: false,
        expectedSafetyClass: 'NOT_IN_EXPECTATIONS',
        blockerCodes: [],
        evidence: [],
        stricterJustification: 'The corpus carries a case the frozen expectations do not adjudicate.',
      });
      continue;
    }

    const frozenDigest = corpus.captureDigests.get(caseId);
    if (frozenDigest !== expectation.captureDigest) {
      // A8: this is CORPUS_DRIFT, not CONTROLLER_FAILURE. The frozen expectation is not applied and
      // the observation may be registered as a new candidate case for separate adjudication. The
      // frozen expectation is never edited in place.
      results.push({
        caseId,
        outcome: 'CORPUS_DRIFT',
        expected: expectation.expectedDisposition,
        actual: 'NOT_CLASSIFIED',
        utilityRequired: expectation.utilityRequired,
        expectedSafetyClass: expectation.expectedSafetyClass,
        blockerCodes: [],
        evidence: [],
      });
      continue;
    }

    try {
      const port = new ReplayTransport(corpus, caseId);
      const { snapshot } = await observe({
        surface: corpus.surface,
        port,
        repoRoot: corpus.global.repoRoot,
        observationScope: { caseIds: [caseId] },
        globalObservationWindow: port.globalObservationWindow,
        transcriptRef: `corpus:${caseId}@${frozenDigest}`,
      });

      const classification = classify(snapshot as unknown as ClassifiableSnapshot, operation);
      const disposition = classification.dispositions.find((d) => d.caseId === caseId);
      results.push(compare(expectation, disposition, snapshot.identityDigest));
    } catch (e) {
      const err = e as Error & { code?: string };
      results.push({
        caseId,
        outcome: 'ERROR',
        expected: expectation.expectedDisposition,
        actual: 'NOT_CLASSIFIED',
        utilityRequired: expectation.utilityRequired,
        expectedSafetyClass: expectation.expectedSafetyClass,
        blockerCodes: [],
        evidence: [],
        error: `${String(err.code ?? err.name)}: ${err.message.slice(0, 300)}`,
      });
    }
  }

  const totals: Record<CaseOutcome, number> = {
    PASS: 0,
    HARD_FAILURE: 0,
    FINDING_STRICTER: 0,
    CORPUS_DRIFT: 0,
    ERROR: 0,
  };
  for (const r of results) totals[r.outcome] += 1;

  const falseSafe = results.filter(
    (r) => r.expected === 'BLOCKED' && r.actual === 'SAFE_TO_REMOVE',
  );
  const requiredCaseIds = expectations.cases.filter((c) => c.utilityRequired).map((c) => c.caseId);
  const missed = results
    .filter((r) => r.utilityRequired && r.actual !== 'SAFE_TO_REMOVE')
    .map((r) => r.caseId);

  return {
    versions: {
      snapshotSchema: SNAPSHOT_SCHEMA_VERSION,
      observerVersion: OBSERVER_VERSION,
      classifierVersion: CLASSIFIER_VERSION,
      policyVersion: POLICY_VERSION,
    },
    expectationsDigest: expectations.digest,
    // The policy is code at this version, so its digest is the classifier's declared policyVersion
    // bound to the classifier version that computed it. A26 asks for visibility, not a second
    // artifact store.
    policyDigest: sha256Hex(`${CLASSIFIER_VERSION}|${POLICY_VERSION}`),
    authority: {
      authorityManifestDigest: authority.authorityManifestDigest,
      requiredBindings: authority.requiredBindings,
      boundFileCount: authority.boundFileCount,
      authorityReferenceDigest: authority.authorityReference?.selfDigest,
    },
    corpus: {
      caseCount: corpus.caseCount,
      globalIdentityDigest: corpus.globalIdentity,
      commandSurfaceDigest: corpus.surface.digest,
    },
    operation,
    layer: 'REPLAY',
    safety: { satisfied: falseSafe.length === 0, falseSafeCaseIds: falseSafe.map((r) => r.caseId) },
    utility: { satisfied: missed.length === 0, requiredCaseIds, missedCaseIds: missed },
    totals,
    cases: results,
    unexercised: measureUnexercised(corpus),
  };
}

function compare(
  expectation: FrozenExpectation,
  disposition: Disposition | undefined,
  identityDigest: string,
): CaseResult {
  const blockerCodes = (disposition?.blockers ?? []).map((b) => b.code);
  const base = {
    caseId: expectation.caseId,
    expected: expectation.expectedDisposition,
    utilityRequired: expectation.utilityRequired,
    expectedSafetyClass: expectation.expectedSafetyClass,
    identityDigest,
    blockerCodes,
    evidence: disposition?.evidence ?? [],
  };

  if (disposition === undefined) {
    return { ...base, outcome: 'ERROR', actual: 'NOT_CLASSIFIED', error: 'no disposition produced' };
  }

  const actual = disposition.decision;
  if (expectation.expectedDisposition === actual) return { ...base, outcome: 'PASS', actual };

  if (expectation.expectedDisposition === 'BLOCKED' && actual === 'SAFE_TO_REMOVE') {
    return { ...base, outcome: 'HARD_FAILURE', actual };
  }

  // Stricter than the facit. Allowed outside the utilityRequired subset, and a hard failure inside
  // it — that arm is what stops a universally blocking controller from passing.
  if (expectation.utilityRequired) return { ...base, outcome: 'HARD_FAILURE', actual };
  return {
    ...base,
    outcome: 'FINDING_STRICTER',
    actual,
    stricterJustification: `The adjudicator expected SAFE_TO_REMOVE (${expectation.expectedSafetyClass}); this controller blocked on ${blockerCodes.join(', ') || 'no recorded blocker'}. A6 permits a stricter reading outside the utilityRequired subset, recorded here as a finding.`,
  };
}

/** A compact human-readable rendering for a terminal or a handoff report. */
export function renderAcceptanceReport(report: AcceptanceReport): string {
  const lines: string[] = [];
  lines.push(`LAYER                 ${report.layer}`);
  lines.push(`OPERATION             ${report.operation}`);
  lines.push(
    `VERSIONS              snapshot ${report.versions.snapshotSchema} / observer ${report.versions.observerVersion} / classifier ${report.versions.classifierVersion} / policy ${report.versions.policyVersion}`,
  );
  lines.push(`EXPECTATIONS DIGEST   ${report.expectationsDigest}`);
  lines.push(`POLICY DIGEST         ${report.policyDigest}`);
  lines.push(`AUTHORITY MANIFEST    ${report.authority.authorityManifestDigest}`);
  for (const [name, digest] of Object.entries(report.authority.requiredBindings).sort()) {
    lines.push(`  ${name.padEnd(28)}${digest}`);
  }
  if (report.authority.authorityReferenceDigest !== undefined) {
    lines.push(`AUTHORITY REFERENCE   ${report.authority.authorityReferenceDigest}`);
  }
  lines.push(`CORPUS                ${report.corpus.caseCount} cases, global identity ${report.corpus.globalIdentityDigest}`);
  lines.push('');
  lines.push(`SAFETY                ${report.safety.satisfied ? 'SATISFIED' : 'VIOLATED'}`);
  if (!report.safety.satisfied) {
    lines.push(`  false SAFE_TO_REMOVE: ${report.safety.falseSafeCaseIds.join(', ')}`);
  }
  lines.push(
    `UTILITY               ${report.utility.satisfied ? 'SATISFIED' : 'VIOLATED'} (${report.utility.requiredCaseIds.length} required)`,
  );
  if (!report.utility.satisfied) lines.push(`  missed: ${report.utility.missedCaseIds.join(', ')}`);
  lines.push('');
  lines.push(
    `TOTALS                pass ${report.totals.PASS} / hard failure ${report.totals.HARD_FAILURE} / stricter finding ${report.totals.FINDING_STRICTER} / corpus drift ${report.totals.CORPUS_DRIFT} / error ${report.totals.ERROR}`,
  );
  if (report.unexercised.length > 0) {
    lines.push('');
    lines.push('NOT EXERCISED BY THIS LAYER');
    for (const u of report.unexercised) lines.push(`  - ${u}`);
  }
  return lines.join('\n');
}
