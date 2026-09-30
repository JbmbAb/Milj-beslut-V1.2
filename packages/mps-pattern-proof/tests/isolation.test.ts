import { describe, it, expect } from 'vitest';
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  attestationSubjectBinding,
} from '@miljobeslut/mimers-brunn-core';

import { isPatternProofError } from '../src/errors';
import { digestOf } from '../src/identity';
import {
  VERIFIER_INPUT_BUNDLE_KEYS,
  VERIFIER_INPUT_BUNDLE_PREDICATE_TYPE,
  VERIFIER_PROMPT_TEMPLATE_VERSION,
  assertVerifyOnlyProvider,
  attestVerifierInputBundle,
  createVerifierContext,
  isVerifyOnlyProvider,
  renderVerifierPrompt,
  validateVerifierInputBundle,
  type VerifierInputBundle,
  type VerifyOnlyKeyProvider,
} from '../src/isolation';

/**
 * PATTERN-PROOF-ENGINE-01 V1 -- isolation proof (frozen design section 4, BOOTSTRAP section 4).
 *
 *   Invariant under test:
 *     A verifier context can only be instantiated from the closed, attested input set, checked by a
 *     provider that structurally cannot sign. Writer-lane material has no slot to enter through and
 *     a signer has no lane to enter in.
 *
 *   FIXTURE KEYS ONLY. Every key is generated inside this file (mirrors P2SRVerifyOnly01.test.ts).
 */
describe('PATTERN-PROOF-ENGINE-01 -- verifier isolation', () => {
  const SIGNER_KEY_ID = 'ed25519:ppe-test-orchestrator';
  const BASE_SHA = 'e617c7b7bb4613b95c6934004201eb14bec89ba0';
  const CANDIDATE_SHA = '740b2fdf740b2fdf740b2fdf740b2fdf740b2fdf';

  function bundleFixture(): VerifierInputBundle {
    return {
      repositoryIdentity: { remote: 'https://github.com/JbmbAb/Milj-beslut-V1.2.git', baseSha: BASE_SHA },
      candidate: {
        candidateSha: CANDIDATE_SHA,
        diffRef: { kind: 'git_object', ref: `${BASE_SHA}..${CANDIDATE_SHA}` },
      },
      frozenSpec: [
        { kind: 'file_line', ref: 'docs/architecture/PATTERN-PROOF-ENGINE-01-DESIGN-V1-FROZEN.md:283-311' },
        {
          kind: 'file_line',
          ref: 'docs/architecture/PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY-DESIGN-FROZEN.md:345-384',
          note: 'orchestrator boundary',
        },
      ],
      redPlanDigest: digestOf({ probes: [] }),
      verifierRuntimeInputs: {
        zeta: 'last',
        alpha: 'first',
        PPE_DOCKER_CA_BUNDLE: '/root/.ccr/ca-bundle.crt',
      },
    };
  }

  async function attestedFixture() {
    const generated = LocalPemSigningKeyProvider.generate(SIGNER_KEY_ID);
    const bundle = validateVerifierInputBundle(bundleFixture());
    const attested = await attestVerifierInputBundle(bundle, generated.provider);
    const verifyOnly = new LocalPemVerificationKeyProvider(SIGNER_KEY_ID, generated.publicKey);
    return { generated, bundle, attested, verifyOnly };
  }

  async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
      return undefined;
    } catch (error) {
      return isPatternProofError(error) ? error.code : `not-a-PatternProofError: ${String(error)}`;
    }
  }

  // ------------------------------------------------------------- 1. CLOSED INPUT SET

  it('validates the closed bundle and returns a deep-frozen copy of present keys only', () => {
    const bundle = validateVerifierInputBundle({
      ...bundleFixture(),
      frozenSpec: [{ kind: 'file_line', ref: 'a:1' }],
    });

    expect(Object.keys(bundle).sort()).toEqual([...VERIFIER_INPUT_BUNDLE_KEYS].sort());
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.repositoryIdentity)).toBe(true);
    expect(Object.isFrozen(bundle.candidate)).toBe(true);
    expect(Object.isFrozen(bundle.candidate.diffRef)).toBe(true);
    expect(Object.isFrozen(bundle.frozenSpec)).toBe(true);
    expect(Object.isFrozen(bundle.frozenSpec[0])).toBe(true);
    expect(Object.isFrozen(bundle.verifierRuntimeInputs)).toBe(true);
    expect('note' in bundle.frozenSpec[0]).toBe(false);
    expect(() => digestOf(bundle)).not.toThrow();
  });

  it('rejects a bundle carrying writerTranscript with PPE_ISOLATION_UNDECLARED_INPUT', () => {
    const smuggled = { ...bundleFixture(), writerTranscript: 'I ran the tests and they pass, trust me' };
    expect(() => validateVerifierInputBundle(smuggled)).toThrow(/PPE_ISOLATION_UNDECLARED_INPUT/);
    expect(() => validateVerifierInputBundle(smuggled)).toThrow(/writerTranscript/);
  });

  it.each(['writerRationale', 'writerSelfReportedResults', 'selfReported'])(
    'rejects undeclared top-level key %s',
    (key) => {
      expect(() => validateVerifierInputBundle({ ...bundleFixture(), [key]: {} })).toThrow(
        /PPE_ISOLATION_UNDECLARED_INPUT/,
      );
    },
  );

  it('rejects undeclared keys nested inside repositoryIdentity and candidate', () => {
    const base = bundleFixture();
    expect(() =>
      validateVerifierInputBundle({
        ...base,
        repositoryIdentity: { ...base.repositoryIdentity, writerNotes: 'x' },
      }),
    ).toThrow(/PPE_ISOLATION_UNDECLARED_INPUT/);
    expect(() =>
      validateVerifierInputBundle({ ...base, candidate: { ...base.candidate, selfReportedExitCode: 0 } }),
    ).toThrow(/PPE_ISOLATION_UNDECLARED_INPUT/);
  });

  it('rejects malformed required fields with PPE_SCHEMA_INVALID / evidence codes', () => {
    const base = bundleFixture();
    const { verifierRuntimeInputs: _dropped, ...missing } = base;
    expect(() => validateVerifierInputBundle(missing)).toThrow(/PPE_SCHEMA_INVALID/);
    expect(() =>
      validateVerifierInputBundle({
        ...base,
        repositoryIdentity: { ...base.repositoryIdentity, baseSha: 'HEAD' },
      }),
    ).toThrow(/PPE_SCHEMA_INVALID/);
    expect(() => validateVerifierInputBundle({ ...base, frozenSpec: [] })).toThrow(/PPE_EVIDENCE_REQUIRED/);
    expect(() => validateVerifierInputBundle({ ...base, redPlanDigest: 'sha256:short' })).toThrow(
      /PPE_SCHEMA_INVALID/,
    );
    expect(() =>
      validateVerifierInputBundle({ ...base, verifierRuntimeInputs: { count: 1 as unknown as string } }),
    ).toThrow(/PPE_SCHEMA_INVALID/);
    expect(() =>
      validateVerifierInputBundle({
        ...base,
        candidate: { ...base.candidate, diffRef: { kind: 'url', ref: 'x' } },
      }),
    ).toThrow(/PPE_EVIDENCE_KIND_INVALID/);
  });

  // ------------------------------------------------------ 2. VERIFY-ONLY PROVIDER SHAPE

  it('a LocalPemVerificationKeyProvider has no sign member at all', () => {
    const generated = LocalPemSigningKeyProvider.generate(SIGNER_KEY_ID);
    const verifyOnly = new LocalPemVerificationKeyProvider(SIGNER_KEY_ID, generated.publicKey);

    expect(
      'sign' in verifyOnly,
      'A sign() that throws would keep the method on the type. Absence is the capability separation.',
    ).toBe(false);
    expect(isVerifyOnlyProvider(verifyOnly)).toBe(true);
    expect(isVerifyOnlyProvider(generated.provider)).toBe(false);
    expect(isVerifyOnlyProvider(null)).toBe(false);
    expect(isVerifyOnlyProvider({ keyId: 'k' })).toBe(false);
    expect(() => assertVerifyOnlyProvider(verifyOnly)).not.toThrow();
  });

  it('a SigningKeyProvider is rejected by the verify-only brand at compile time AND at runtime', () => {
    const generated = LocalPemSigningKeyProvider.generate(SIGNER_KEY_ID);
    const acceptVerifyOnly = (provider: VerifyOnlyKeyProvider): string => {
      assertVerifyOnlyProvider(provider);
      return provider.keyId;
    };

    expect(() =>
      acceptVerifyOnly(
        // @ts-expect-error -- PPE isolation: a SigningKeyProvider is not assignable to VerifyOnlyKeyProvider
        // because its `sign` member is a function, not `undefined`. The runtime throw is the belt to
        // that braces: a VerificationKeyProvider-typed value may still be a signer at runtime.
        generated.provider,
      ),
    ).toThrow(/PPE_ISOLATION_SIGNER_IN_VERIFIER_LANE/);
    expect(acceptVerifyOnly(new LocalPemVerificationKeyProvider(SIGNER_KEY_ID, generated.publicKey))).toBe(
      SIGNER_KEY_ID,
    );
  });

  // --------------------------------------------------------------- 3. ACCEPTED PATH

  it('attests the bundle with the declared predicate and binds the signer', async () => {
    const { attested, bundle } = await attestedFixture();

    expect(attested.bundleDigest).toBe(digestOf(bundle));
    expect(attested.attestation.subjectDigest).toBe(attested.bundleDigest);
    expect(attested.attestation.predicateType).toBe(VERIFIER_INPUT_BUNDLE_PREDICATE_TYPE);
    expect(attested.attestation.predicate).toEqual({
      bundleDigest: attested.bundleDigest,
      declaredKeys: [...VERIFIER_INPUT_BUNDLE_KEYS].sort(),
    });
    expect(attested.attestation.signer).toBe(SIGNER_KEY_ID);
    expect(Object.isFrozen(attested.attestation)).toBe(true);
  });

  it('attestation refuses to sign an undeclared input even with a legitimate signer', async () => {
    const generated = LocalPemSigningKeyProvider.generate(SIGNER_KEY_ID);
    const smuggled = { ...bundleFixture(), writerTranscript: 'x' } as unknown as VerifierInputBundle;
    expect(await codeOf(attestVerifierInputBundle(smuggled, generated.provider))).toBe(
      'PPE_ISOLATION_UNDECLARED_INPUT',
    );
  });

  it('creates a frozen verifier context from a verify-only provider', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();

    const context = await createVerifierContext({
      bundle,
      attestation: attested.attestation,
      verification: verifyOnly,
      expectedSignerKeyId: SIGNER_KEY_ID,
    });

    expect(context.inputs).toEqual(bundle);
    expect(context.bundleDigest).toBe(attested.bundleDigest);
    expect(context.verifierAuthority).toBe(SIGNER_KEY_ID);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.inputs)).toBe(true);
    expect(Object.isFrozen(context.isolationEvidence)).toBe(true);
    expect(Object.keys(context).sort()).toEqual([
      'bundleDigest',
      'inputs',
      'isolationEvidence',
      'verifierAuthority',
    ]);
  });

  // --------------------------------------------------------------- 4. REJECTED PATHS

  it('rejects a signing provider in the verifier lane before verifying anything', async () => {
    const { attested, bundle, generated } = await attestedFixture();

    expect(
      await codeOf(
        createVerifierContext({
          bundle,
          attestation: attested.attestation,
          // Type-valid (SigningKeyProvider extends VerificationKeyProvider); only the runtime can refuse it.
          verification: generated.provider,
          expectedSignerKeyId: SIGNER_KEY_ID,
        }),
      ),
    ).toBe('PPE_ISOLATION_SIGNER_IN_VERIFIER_LANE');
  });

  it('rejects a provider that merely carries a sign member, whatever it does', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();
    const decorated = Object.assign(Object.create(verifyOnly) as typeof verifyOnly, {
      sign: () => {
        throw new Error('disabled');
      },
    });

    expect(
      await codeOf(
        createVerifierContext({
          bundle,
          attestation: attested.attestation,
          verification: decorated,
          expectedSignerKeyId: SIGNER_KEY_ID,
        }),
      ),
    ).toBe('PPE_ISOLATION_SIGNER_IN_VERIFIER_LANE');
  });

  it('rejects a wrong expectedSignerKeyId with PPE_ISOLATION_SIGNER_MISMATCH', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();

    expect(
      await codeOf(
        createVerifierContext({
          bundle,
          attestation: attested.attestation,
          verification: verifyOnly,
          expectedSignerKeyId: 'ed25519:some-other-orchestrator',
        }),
      ),
    ).toBe('PPE_ISOLATION_SIGNER_MISMATCH');
  });

  it('rejects a verify-only provider keyed for another signer even with the correct public key', async () => {
    const { attested, bundle, generated } = await attestedFixture();
    const otherId = new LocalPemVerificationKeyProvider('ed25519:other', generated.publicKey);

    expect(
      await codeOf(
        createVerifierContext({
          bundle,
          attestation: attested.attestation,
          verification: otherId,
          expectedSignerKeyId: SIGNER_KEY_ID,
        }),
      ),
    ).toBe('PPE_ISOLATION_SIGNER_MISMATCH');
  });

  it('rejects a different public key under the same keyId with PPE_ISOLATION_ATTESTATION_INVALID', async () => {
    const { attested, bundle } = await attestedFixture();
    const other = LocalPemSigningKeyProvider.generate(SIGNER_KEY_ID);

    expect(
      await codeOf(
        createVerifierContext({
          bundle,
          attestation: attested.attestation,
          verification: new LocalPemVerificationKeyProvider(SIGNER_KEY_ID, other.publicKey),
          expectedSignerKeyId: SIGNER_KEY_ID,
        }),
      ),
    ).toBe('PPE_ISOLATION_ATTESTATION_INVALID');
  });

  it('rejects an attestation of another predicate type', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();

    expect(
      await codeOf(
        createVerifierContext({
          bundle,
          attestation: { ...attested.attestation, predicateType: 'mimers-brunn/source-approval/v1' },
          verification: verifyOnly,
          expectedSignerKeyId: SIGNER_KEY_ID,
        }),
      ),
    ).toBe('PPE_ISOLATION_ATTESTATION_INVALID');
  });

  it('rejects a tampered bundle with PPE_ISOLATION_BUNDLE_DIGEST_MISMATCH', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();
    const tampered: VerifierInputBundle = {
      ...bundle,
      candidate: { ...bundle.candidate, candidateSha: '0000000000000000000000000000000000000000' },
    };

    expect(
      await codeOf(
        createVerifierContext({
          bundle: tampered,
          attestation: attested.attestation,
          verification: verifyOnly,
          expectedSignerKeyId: SIGNER_KEY_ID,
        }),
      ),
    ).toBe('PPE_ISOLATION_BUNDLE_DIGEST_MISMATCH');
  });

  it('rejects a bundle with an extra key at context creation, even if the attestation is valid', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();
    const smuggled = { ...bundle, writerTranscript: 'x' } as unknown as VerifierInputBundle;

    expect(
      await codeOf(
        createVerifierContext({
          bundle: smuggled,
          attestation: attested.attestation,
          verification: verifyOnly,
          expectedSignerKeyId: SIGNER_KEY_ID,
        }),
      ),
    ).toBe('PPE_ISOLATION_UNDECLARED_INPUT');
  });

  // ------------------------------------------------------------ 5. ISOLATION EVIDENCE

  it('isolationEvidence has exactly two locators and the binding resolves against the attestation', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();
    const context = await createVerifierContext({
      bundle,
      attestation: attested.attestation,
      verification: verifyOnly,
      expectedSignerKeyId: SIGNER_KEY_ID,
    });

    expect(context.isolationEvidence).toHaveLength(2);
    expect(context.isolationEvidence[0]).toEqual({
      kind: 'signed_attestation',
      ref: attestationSubjectBinding(attested.attestation),
      note: 'verifier-input-bundle',
    });
    expect(context.isolationEvidence[1]).toEqual({
      kind: 'runtime_result',
      ref: `verifier-context:${attested.bundleDigest}`,
    });
    // The binding is a function of subjectDigest + predicateType only; a resolver holding the
    // attestation recomputes it and matches. A tampered attestation does not.
    expect(
      attestationSubjectBinding({ ...attested.attestation, subjectDigest: digestOf({ other: true }) }),
    ).not.toBe(context.isolationEvidence[0].ref);
    for (const locator of context.isolationEvidence) expect(Object.isFrozen(locator)).toBe(true);
  });

  // ---------------------------------------------------------------- 6. PROMPT RENDER

  it('renders a deterministic prompt from inputs only, free of writer-lane vocabulary', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();
    const context = await createVerifierContext({
      bundle,
      attestation: attested.attestation,
      verification: verifyOnly,
      expectedSignerKeyId: SIGNER_KEY_ID,
    });

    const first = renderVerifierPrompt(context);
    const second = renderVerifierPrompt(context);

    expect(first.digest).toBe(second.digest);
    expect(first.text).toBe(second.text);
    expect(first.digest).toBe(digestOf({ text: first.text }));
    expect(first.text).toContain(VERIFIER_PROMPT_TEMPLATE_VERSION);
    expect(first.text).toContain(BASE_SHA);
    expect(first.text).toContain(CANDIDATE_SHA);
    expect(first.text).toContain(`git_object ${BASE_SHA}..${CANDIDATE_SHA}`);
    expect(first.text).toContain('(orchestrator boundary)');
    expect(first.text).toContain(bundle.redPlanDigest);
    for (const forbidden of ['writerTranscript', 'writerRationale', 'selfReported']) {
      expect(first.text).not.toContain(forbidden);
    }
    // Runtime inputs are emitted sorted by key regardless of insertion order.
    const alpha = first.text.indexOf('alpha=first');
    const ca = first.text.indexOf('PPE_DOCKER_CA_BUNDLE=');
    const zeta = first.text.indexOf('zeta=last');
    expect(ca).toBeGreaterThan(-1);
    expect(ca).toBeLessThan(alpha);
    expect(alpha).toBeLessThan(zeta);
  });

  it('prompt digest changes when, and only when, a declared input changes', async () => {
    const { attested, bundle, verifyOnly } = await attestedFixture();
    const context = await createVerifierContext({
      bundle,
      attestation: attested.attestation,
      verification: verifyOnly,
      expectedSignerKeyId: SIGNER_KEY_ID,
    });
    const reordered: VerifierInputBundle = {
      ...bundle,
      verifierRuntimeInputs: {
        zeta: 'last',
        PPE_DOCKER_CA_BUNDLE: '/root/.ccr/ca-bundle.crt',
        alpha: 'first',
      },
    };
    const changed: VerifierInputBundle = { ...bundle, verifierRuntimeInputs: { alpha: 'changed' } };

    expect(renderVerifierPrompt({ ...context, inputs: reordered }).digest).toBe(
      renderVerifierPrompt(context).digest,
    );
    expect(renderVerifierPrompt({ ...context, inputs: changed }).digest).not.toBe(
      renderVerifierPrompt(context).digest,
    );
    expect(() =>
      renderVerifierPrompt({
        ...context,
        inputs: { ...bundle, writerTranscript: 'x' } as unknown as VerifierInputBundle,
      }),
    ).toThrow(/PPE_ISOLATION_UNDECLARED_INPUT/);
  });
});
