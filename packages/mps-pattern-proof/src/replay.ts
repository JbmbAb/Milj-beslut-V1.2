/**
 * PATTERN-PROOF-ENGINE-01 V1 -- clean-room replay comparison (frozen design section 7, plan D4/T11).
 *
 * A `ProofPackage` is not final until it can be regenerated from nothing but its declared
 * `InputManifest`. This module does NOT define a replay engine (frozen design sections 12-13:
 * ADR-24-23 / `DefaultReplayEngine` own replay semantics for candidates); it only computes PPE's own
 * result classification: regenerate N times, digest every regenerated package with the same
 * canonical identity as everything else in the package (./identity.ts), and compare to the digest
 * of the package under review.
 *
 * The comparison is BOUND (D4): it carries the digest of the declared manifest and the digest of the
 * expected package, so `applyProofPackage` (./state-machine.ts) can refuse a comparison that was
 * computed for a different manifest or a different package (PPE_REPLAY_UNBOUND). A comparison whose
 * observed digests all equal the expected digest is reproducible; any divergence is the evidence the
 * NON_REPRODUCIBLE terminal state records.
 *
 * Only `ReplayComparison` and `replayForReproducibility` (plus the shape validator) are exported --
 * no `ReplayEngine` / `ReplayVerifier` / `ReplayArtifact` / `ReplayResult` nouns (plan constraint 8).
 */
import type { InputManifest, ProofPackage } from './artifacts';
import { PatternProofError } from './errors';
import { digestOf, isDigest, type Digest } from './identity';
import { deepFreeze, validateInputManifest, validateProofPackage } from './validators';

export interface ReplayComparison {
  /** digestOf(the declared InputManifest the regenerations ran from) */
  readonly manifestDigest: Digest;
  /** digestOf(the ProofPackage under review, in validated canonical form) */
  readonly expectedPackageDigest: Digest;
  /** digestOf(each regenerated ProofPackage), in iteration order */
  readonly observedDigests: readonly Digest[];
  /** true iff every observed digest equals `expectedPackageDigest` */
  readonly reproducible: boolean;
}

export interface ReplayOptions {
  /** number of regenerations; default 2; integer >= 1 */
  readonly times?: number;
  /** the declared inputs; must be the package's own `inputManifest` (else PPE_REPLAY_UNBOUND) */
  readonly manifest: InputManifest;
  /** the package whose reproducibility is under review */
  readonly expectedPackage: ProofPackage;
}

export const DEFAULT_REPLAY_TIMES = 2;

const COMPARISON_KEYS = [
  'manifestDigest',
  'expectedPackageDigest',
  'observedDigests',
  'reproducible',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/** Digests that differ from `expected`, with their iteration index (deterministic order). */
export function divergentObservations(
  comparison: ReplayComparison,
): readonly { readonly iteration: number; readonly digest: Digest }[] {
  const out: { iteration: number; digest: Digest }[] = [];
  comparison.observedDigests.forEach((digest, iteration) => {
    if (digest !== comparison.expectedPackageDigest) out.push({ iteration, digest });
  });
  return Object.freeze(out);
}

/**
 * Shape check for a comparison supplied from outside (e.g. an orchestrator passing JSON). Every
 * digest must be `sha256:<64 hex>`, `observedDigests` must be non-empty (zero observations prove
 * nothing), and `reproducible` must agree with the digests -- a comparison that says one thing
 * and carries digests that say another is unbound evidence, not a verdict (fail closed).
 */
export function validateReplayComparison(input: unknown): ReplayComparison {
  const path = 'replay-comparison';
  if (!isPlainObject(input)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'ReplayComparison must be a plain object', { path });
  }
  for (const key of Object.keys(input)) {
    if (!(COMPARISON_KEYS as readonly string[]).includes(key)) {
      throw new PatternProofError('PPE_UNKNOWN_FIELD', `unknown field "${key}"`, { path });
    }
  }
  if (!isDigest(input.manifestDigest)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'manifestDigest must be sha256:<64 hex>', {
      path: `${path}.manifestDigest`,
    });
  }
  if (!isDigest(input.expectedPackageDigest)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'expectedPackageDigest must be sha256:<64 hex>', {
      path: `${path}.expectedPackageDigest`,
    });
  }
  if (!Array.isArray(input.observedDigests) || input.observedDigests.length === 0) {
    throw new PatternProofError('PPE_REPLAY_UNBOUND', 'observedDigests must contain at least one digest', {
      path: `${path}.observedDigests`,
    });
  }
  const observedDigests = input.observedDigests.map((digest, index): Digest => {
    if (!isDigest(digest)) {
      throw new PatternProofError('PPE_SCHEMA_INVALID', 'observed digest must be sha256:<64 hex>', {
        path: `${path}.observedDigests[${index}]`,
      });
    }
    return digest;
  });
  if (typeof input.reproducible !== 'boolean') {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'reproducible must be a boolean', {
      path: `${path}.reproducible`,
    });
  }
  const expectedPackageDigest = input.expectedPackageDigest;
  const derived = observedDigests.every((digest) => digest === expectedPackageDigest);
  if (derived !== input.reproducible) {
    throw new PatternProofError(
      'PPE_REPLAY_UNBOUND',
      `reproducible=${String(input.reproducible)} disagrees with the observed digests (derived ${String(derived)})`,
      { path: `${path}.reproducible` },
    );
  }
  return deepFreeze({
    manifestDigest: input.manifestDigest,
    expectedPackageDigest,
    observedDigests,
    reproducible: derived,
  });
}

/**
 * Regenerates the package `times` times from the declared manifest and compares. `regenerate`
 * receives the iteration index (T11: a fixture may spawn a program per iteration with an env
 * that differs, which is exactly the undeclared input NON_REPRODUCIBLE exists to catch). Each
 * regenerated value must be a valid `ProofPackage`; a value that is not one is a harness fault and
 * propagates as the validator's PatternProofError (never silently counted as a digest).
 */
export async function replayForReproducibility(
  regenerate: (iteration: number) => Promise<unknown>,
  opts: ReplayOptions,
): Promise<ReplayComparison> {
  const times = opts.times ?? DEFAULT_REPLAY_TIMES;
  if (!Number.isInteger(times) || times < 1) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'times must be an integer >= 1', {
      path: 'replay.times',
    });
  }
  const manifest = validateInputManifest(opts.manifest);
  const expectedPackage = validateProofPackage(opts.expectedPackage);
  const manifestDigest = digestOf(manifest);
  if (digestOf(expectedPackage.inputManifest) !== manifestDigest) {
    throw new PatternProofError(
      'PPE_REPLAY_UNBOUND',
      "the declared manifest is not the expected package's own inputManifest",
      { path: 'replay.manifest' },
    );
  }
  const expectedPackageDigest = digestOf(expectedPackage);
  const observedDigests: Digest[] = [];
  for (let iteration = 0; iteration < times; iteration += 1) {
    const regenerated = validateProofPackage(await regenerate(iteration));
    observedDigests.push(digestOf(regenerated));
  }
  return deepFreeze({
    manifestDigest,
    expectedPackageDigest,
    observedDigests,
    reproducible: observedDigests.every((digest) => digest === expectedPackageDigest),
  });
}
