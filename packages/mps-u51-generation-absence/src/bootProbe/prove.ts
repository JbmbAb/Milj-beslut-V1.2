/**
 * Assembles u51-generation-derivation-1 from a real boot-probe run and asks C6 whether DECLARED_ABSENT holds.
 * Census, port blob and entrypoint derivation are read from the subject git tree. Nothing here is typed in by hand.
 */
import { createHash } from 'node:crypto';
import { LOCAL_GENERATION_BLOCKER } from '../../../../server/modules/ai/generation/LocalGenerationPort';
import { deriveGenerationStaticFacts } from '../../../mps-u51-manifest/src/adapters/generationStatic';
import { hashJcs } from '../../../mps-u51-manifest/src/canonical';
import { checkGeneration } from '../../../mps-u51-manifest/src/checks/generation';
import { validateGenerationDerivation } from '../../../mps-u51-manifest/src/evidenceSchemas';
import type { FreezePolicy } from '../../../mps-u51-manifest/src/policy';
import type { Manifest } from '../../../mps-u51-manifest/src/types';
import { GENERATION_DERIVATION_VERSION } from '../../../mps-u51-manifest/src/vocabulary';
import type { StaticCensus } from '../staticCensus.js';
import { assertExactCheckout, blobIdAt } from './exactCheckout.js';
import { runBootProbe, type BootAttempt, type BootProbeRun } from './harness.js';
import { productionStartupGateSeen } from './productionGates.js';
import { sealBootObservations, type ProbeObservation, type SealedEntrypoint } from './seal.js';

export const PROBE_SOURCE_PATHS = [
  'packages/mps-u51-generation-absence/src/bootProbe/exactCheckout.ts',
  'packages/mps-u51-generation-absence/src/bootProbe/harness.ts',
  'packages/mps-u51-generation-absence/src/bootProbe/preload.ts',
  'packages/mps-u51-generation-absence/src/bootProbe/productionGates.ts',
  'packages/mps-u51-generation-absence/src/bootProbe/prove.ts',
  'packages/mps-u51-generation-absence/src/bootProbe/seal.ts',
  'packages/mps-u51-generation-absence/src/bootProbe/types.ts',
  'scripts/ops/prove-u51-generation-real-boot-01.ts',
] as const;

const HEX40 = /^[0-9a-f]{40}$/;

export interface ProbeImplementationIdentity {
  readonly sha256: string;
  readonly blobs: readonly { readonly path: string; readonly blob: string }[];
}

export function probeImplementationIdentity(repo: string, commit: string): { ok: true; identity: ProbeImplementationIdentity } | { ok: false; blocker: 'PROBE_SOURCES_ABSENT' } {
  const blobs: { path: string; blob: string }[] = [];
  for (const source of PROBE_SOURCE_PATHS) {
    const blob = blobIdAt(repo, commit, source);
    if (blob === undefined) return { ok: false, blocker: 'PROBE_SOURCES_ABSENT' };
    blobs.push({ path: source, blob });
  }
  blobs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sha256 = createHash('sha256').update(blobs.map((item) => `${item.path} ${item.blob}`).join('\n')).digest('hex');
  return { ok: true, identity: { sha256, blobs } };
}

export interface GenerationDerivationPayload {
  readonly contract_version: typeof GENERATION_DERIVATION_VERSION;
  readonly subject: { readonly tree_sha: string };
  readonly port: { readonly source_blob_sha1: string };
  readonly registry: { readonly runtimes: readonly [] };
  readonly static_census: StaticCensus;
  readonly entrypoint_set: { readonly claimed_sha256: string; readonly derived_sha256: string };
  readonly boot_probe: { readonly entrypoints: readonly SealedEntrypoint[] };
}

export function assembleGenerationDerivation(input: {
  treeSha: string;
  portBlobSha1: string;
  census: StaticCensus;
  claimedSha256: string;
  derivedSha256: string;
  entrypoints: readonly SealedEntrypoint[];
}): { ok: true; payload: GenerationDerivationPayload } | { ok: false; blocker: string } {
  if (!HEX40.test(input.treeSha) || !HEX40.test(input.portBlobSha1)) return { ok: false, blocker: 'SUBJECT_IDENTITY_MALFORMED' };
  if (input.census.registration_identifier_files !== 0 || input.census.nonliteral_dynamic_imports !== 0) {
    return { ok: false, blocker: 'CENSUS_BLOCKS_ABSENCE' };
  }
  if (input.claimedSha256 !== input.derivedSha256) return { ok: false, blocker: 'HASH_NOT_EQUAL' };
  if (input.entrypoints.length === 0) return { ok: false, blocker: 'OMITTED_ENTRYPOINT' };
  return {
    ok: true,
    payload: {
      contract_version: GENERATION_DERIVATION_VERSION,
      subject: { tree_sha: input.treeSha },
      port: { source_blob_sha1: input.portBlobSha1 },
      registry: { runtimes: [] },
      static_census: input.census,
      entrypoint_set: { claimed_sha256: input.claimedSha256, derived_sha256: input.derivedSha256 },
      boot_probe: { entrypoints: input.entrypoints },
    },
  };
}

/** C6 for DECLARED_ABSENT. Undefined means the stage accepted the payload. */
export function checkDeclaredAbsent(treeSha: string, payload: unknown): string | undefined {
  const evidence = hashJcs(payload);
  return checkGeneration({
    manifest: {
      candidate: { commit_sha: treeSha, tree_sha: treeSha },
      generation: { posture: 'DECLARED_ABSENT', evidence_sha256: evidence },
    } as Manifest,
    policy: { generation_requirement: 'ABSENT_ADMISSIBLE' } as FreezePolicy,
    observations: { generation: { payload } },
  });
}

export interface BootProofReport {
  readonly proof_unit: 'U51-GENERATION-REAL-BOOT-PROBE-01';
  readonly status: 'NOT_EXECUTED' | 'EXECUTION_VERIFIED';
  readonly blocker: string;
  readonly exit_code: 0 | 1 | 2;
  readonly commit_sha?: string;
  readonly tree_sha?: string;
  readonly derived_sha256?: string;
  readonly claimed_sha256?: string;
  readonly probe_implementation_sha256?: string;
  readonly attempts: readonly BootAttempt[];
  readonly schema_valid: boolean;
  readonly c6?: string;
  readonly payload?: GenerationDerivationPayload;
  readonly run?: BootProbeRun;
}

function refused(blocker: string, partial: Partial<BootProofReport> = {}): BootProofReport {
  return {
    proof_unit: 'U51-GENERATION-REAL-BOOT-PROBE-01',
    exit_code: 2,
    attempts: [],
    schema_valid: false,
    ...partial,
    status: 'NOT_EXECUTED',
    blocker,
  };
}

export async function runGenerationBootProof(options: { repo: string; commit: string; timeoutMs: number }): Promise<BootProofReport> {
  const checkout = assertExactCheckout(options.repo, options.commit);
  if (checkout.ok === false) return refused(checkout.blocker);
  const identity = probeImplementationIdentity(options.repo, checkout.subject.commit_sha);
  if (identity.ok === false) return refused(identity.blocker, { commit_sha: checkout.subject.commit_sha, tree_sha: checkout.subject.tree_sha });

  const run = await runBootProbe({ repo: options.repo, commit: checkout.subject.commit_sha, timeoutMs: options.timeoutMs });
  const base = {
    commit_sha: run.commit_sha,
    tree_sha: run.tree_sha,
    derived_sha256: run.derived_sha256,
    probe_implementation_sha256: identity.identity.sha256,
    attempts: run.attempts,
    run,
  };
  if (!run.ok || run.blocker !== undefined || run.derived_sha256 === undefined || run.commit_sha === undefined || run.tree_sha === undefined) {
    return refused(run.blocker ?? run.attempts.find((attempt) => attempt.problem !== undefined)?.problem ?? 'BOOT_INCOMPLETE', base);
  }

  for (const attempt of run.attempts) {
    if (attempt.problem !== undefined) return refused(attempt.problem, base);
    const text = `${attempt.stderr_tail}\n${attempt.report?.stop_message ?? ''}`;
    if (!productionStartupGateSeen(attempt.entry.id, text)) return refused('STOPPED_BEFORE_ENTRY_GATE', base);
    if (attempt.observation?.registered_after_boot === true || attempt.observation?.generate_attempt.outcome === 'SUCCESS') {
      return refused('RUNTIME_REGISTERED', { ...base, exit_code: 1 });
    }
  }

  const observations = run.attempts.flatMap((attempt): ProbeObservation[] => (attempt.observation === undefined ? [] : [attempt.observation]));
  const sealed = sealBootObservations({
    derived: run.attempts.map((attempt) => attempt.entry),
    derived_sha256: run.derived_sha256,
    observations,
    subject_commit: run.commit_sha,
    subject_tree: run.tree_sha,
    fail_closed_code: LOCAL_GENERATION_BLOCKER,
  });
  if (sealed.ok === false) return refused(sealed.blocker, { ...base, claimed_sha256: undefined });

  const facts = deriveGenerationStaticFacts(options.repo, run.tree_sha);
  if (facts.port_source_blob_sha1 === undefined) return refused('PORT_BLOB_ABSENT', base);
  const assembled = assembleGenerationDerivation({
    treeSha: run.tree_sha,
    portBlobSha1: facts.port_source_blob_sha1,
    census: facts.static_census,
    claimedSha256: sealed.claimed_sha256,
    derivedSha256: run.derived_sha256,
    entrypoints: sealed.entrypoints,
  });
  if (assembled.ok === false) return refused(assembled.blocker, { ...base, claimed_sha256: sealed.claimed_sha256 });

  const schemaValid = validateGenerationDerivation(assembled.payload);
  if (!schemaValid) return refused('SCHEMA_NOT_ACCEPTED', { ...base, claimed_sha256: sealed.claimed_sha256, payload: assembled.payload });
  const c6 = checkDeclaredAbsent(run.tree_sha, assembled.payload);
  if (c6 !== undefined) {
    return refused(c6, { ...base, claimed_sha256: sealed.claimed_sha256, schema_valid: true, c6, payload: assembled.payload, exit_code: 1 });
  }

  return {
    proof_unit: 'U51-GENERATION-REAL-BOOT-PROBE-01',
    status: 'EXECUTION_VERIFIED',
    blocker: 'NONE',
    exit_code: 0,
    commit_sha: run.commit_sha,
    tree_sha: run.tree_sha,
    derived_sha256: run.derived_sha256,
    claimed_sha256: sealed.claimed_sha256,
    probe_implementation_sha256: identity.identity.sha256,
    attempts: run.attempts,
    schema_valid: true,
    c6: 'PASS',
    payload: assembled.payload,
    run,
  };
}
