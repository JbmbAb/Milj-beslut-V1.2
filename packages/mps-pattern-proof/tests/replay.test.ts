import { describe, expect, it } from 'vitest';
import { isPatternProofError } from '../src/errors';
import { digestOf } from '../src/identity';
import {
  DEFAULT_REPLAY_TIMES,
  divergentObservations,
  replayForReproducibility,
  validateReplayComparison,
  type ReplayComparison,
} from '../src/replay';
import { applyProofPackage } from '../src/state-machine';
import { validateProofPackage } from '../src/validators';
import { validManifest, validProofPackage } from './fixtures/artifacts';
import { boundComparison, driveToAssembleEvidence, isDeepFrozen } from './fixtures/state';

const expectedDigest = () => digestOf(validateProofPackage(validProofPackage()));

describe('replayForReproducibility: bound comparison (D4)', () => {
  it('regenerating the identical package is reproducible; the result is frozen and bound', async () => {
    const calls: number[] = [];
    const comparison = await replayForReproducibility(
      async (iteration) => {
        calls.push(iteration);
        return validProofPackage();
      },
      { manifest: validManifest(), expectedPackage: validProofPackage() },
    );
    expect(calls).toEqual([0, 1]);
    expect(DEFAULT_REPLAY_TIMES).toBe(2);
    expect(comparison.reproducible).toBe(true);
    expect(comparison.expectedPackageDigest).toBe(expectedDigest());
    expect(comparison.manifestDigest).toBe(digestOf(validateProofPackage(validProofPackage()).inputManifest));
    expect(comparison.observedDigests).toEqual([expectedDigest(), expectedDigest()]);
    expect(isDeepFrozen(comparison)).toBe(true);
    expect(divergentObservations(comparison)).toEqual([]);
  });

  it('honours times and reports every divergent iteration', async () => {
    const comparison = await replayForReproducibility(
      async (iteration) =>
        iteration === 1
          ? { ...validProofPackage(), provenInvariants: ['something else was proven'] }
          : validProofPackage(),
      { times: 3, manifest: validManifest(), expectedPackage: validProofPackage() },
    );
    expect(comparison.observedDigests).toHaveLength(3);
    expect(comparison.reproducible).toBe(false);
    expect(comparison.observedDigests[0]).toBe(expectedDigest());
    expect(comparison.observedDigests[1]).not.toBe(expectedDigest());
    expect(comparison.observedDigests[2]).toBe(expectedDigest());
    expect(divergentObservations(comparison)).toEqual([
      { iteration: 1, digest: comparison.observedDigests[1] },
    ]);
  });

  it('a regenerated package whose manifest drifted is a divergence too', async () => {
    const comparison = await replayForReproducibility(
      async () => ({
        ...validProofPackage(),
        inputManifest: { ...validManifest(), toolchainIdentity: 'node v20; npm 9' },
      }),
      { manifest: validManifest(), expectedPackage: validProofPackage() },
    );
    expect(comparison.reproducible).toBe(false);
  });

  it("refuses a declared manifest that is not the expected package's own (PPE_REPLAY_UNBOUND)", async () => {
    await expect(
      replayForReproducibility(async () => validProofPackage(), {
        manifest: { ...validManifest(), toolchainIdentity: 'a different toolchain' },
        expectedPackage: validProofPackage(),
      }),
    ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_REPLAY_UNBOUND'));
  });

  it('rejects times < 1 or non-integer, and validates the expected package', async () => {
    for (const times of [0, -1, 1.5]) {
      await expect(
        replayForReproducibility(async () => validProofPackage(), {
          times,
          manifest: validManifest(),
          expectedPackage: validProofPackage(),
        }),
      ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_SCHEMA_INVALID'));
    }
    await expect(
      replayForReproducibility(async () => validProofPackage(), {
        manifest: validManifest(),
        expectedPackage: { ...validProofPackage(), tree: 'HEAD' },
      }),
    ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_CANDIDATE_SHA_INVALID'));
  });

  it('a regenerated value that is not a ProofPackage is a harness fault, never a digest', async () => {
    await expect(
      replayForReproducibility(async () => ({ ...validProofPackage(), extra: 1 }), {
        manifest: validManifest(),
        expectedPackage: validProofPackage(),
      }),
    ).rejects.toSatisfy((error) => isPatternProofError(error, 'PPE_UNKNOWN_FIELD'));
  });
});

describe('validateReplayComparison: fail closed on unbound or self-contradicting comparisons', () => {
  it('accepts a consistent comparison and freezes it', () => {
    const comparison = validateReplayComparison(boundComparison(validProofPackage()));
    expect(comparison.reproducible).toBe(true);
    expect(isDeepFrozen(comparison)).toBe(true);
  });

  it('rejects zero observations, a disagreeing flag, malformed digests and unknown fields', () => {
    const base = boundComparison(validProofPackage());
    expect(() => validateReplayComparison({ ...base, observedDigests: [] })).toThrow(/PPE_REPLAY_UNBOUND/);
    expect(() => validateReplayComparison({ ...base, reproducible: false })).toThrow(/PPE_REPLAY_UNBOUND/);
    expect(() =>
      validateReplayComparison({
        ...base,
        observedDigests: [base.expectedPackageDigest, `sha256:${'0'.repeat(64)}`],
        reproducible: true,
      }),
    ).toThrow(/PPE_REPLAY_UNBOUND/);
    expect(() => validateReplayComparison({ ...base, manifestDigest: 'sha256:nope' })).toThrow(
      /PPE_SCHEMA_INVALID/,
    );
    expect(() => validateReplayComparison({ ...base, observedDigests: ['x'], reproducible: false })).toThrow(
      /PPE_SCHEMA_INVALID/,
    );
    expect(() => validateReplayComparison({ ...base, extra: true })).toThrow(/PPE_UNKNOWN_FIELD/);
    expect(() => validateReplayComparison(null)).toThrow(/PPE_SCHEMA_INVALID/);
  });
});

describe('applyProofPackage: the comparison must be bound to THIS package', () => {
  it('a comparison computed for a different package is PPE_REPLAY_UNBOUND (expectedPackageDigest)', async () => {
    const state = await driveToAssembleEvidence();
    const other = { ...validProofPackage(), provenInvariants: ['other'] };
    expect(() => applyProofPackage(state, validProofPackage(), boundComparison(other))).toThrow(
      /PPE_REPLAY_UNBOUND/,
    );
  });

  it('a comparison computed for a different manifest is PPE_REPLAY_UNBOUND (manifestDigest)', async () => {
    const state = await driveToAssembleEvidence();
    const comparison: ReplayComparison = {
      ...boundComparison(validProofPackage()),
      manifestDigest: digestOf({ ...validManifest(), toolchainIdentity: 'drifted' }),
    };
    expect(() => applyProofPackage(state, validProofPackage(), comparison)).toThrow(/PPE_REPLAY_UNBOUND/);
  });

  it('a bound, reproducible comparison reaches DONE; a bound divergent one is NON_REPRODUCIBLE', async () => {
    const state = await driveToAssembleEvidence();
    const done = applyProofPackage(state, validProofPackage(), boundComparison(validProofPackage()));
    expect(done.phase).toBe('DONE');
    expect(done.terminal).toBeUndefined();

    const divergent = boundComparison(validProofPackage(), [expectedDigest(), `sha256:${'f'.repeat(64)}`]);
    const stopped = applyProofPackage(state, validProofPackage(), divergent);
    expect(stopped.terminal?.state).toBe('NON_REPRODUCIBLE');
    expect(stopped.terminal?.evidence).toEqual([
      {
        kind: 'runtime_result',
        ref: `replay-iteration:1:sha256:${'f'.repeat(64)}`,
        note: `expected ${expectedDigest()}`,
      },
    ]);
  });
});
