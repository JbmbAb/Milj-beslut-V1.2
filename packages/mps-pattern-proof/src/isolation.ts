/**
 * PATTERN-PROOF-ENGINE-01 V1 -- writer/verifier isolation proof (frozen design section 4,
 * BOOTSTRAP section 4).
 *
 * The verifier lane may receive exactly: repository/base identity, frozen candidate identity/diff,
 * the frozen spec, the RedPlan identity and the declared verifier runtime inputs. It never receives
 * the writer's transcript, rationale or self-reported results. This module makes that boundary
 * STRUCTURAL rather than a prompt comment:
 *
 *  1. `VerifierInputBundle` is a closed field set. `validateVerifierInputBundle` rejects any key
 *     outside the set with PPE_ISOLATION_UNDECLARED_INPUT -- a writer-lane field cannot be smuggled
 *     into the verifier lane because there is no slot for it.
 *  2. The bundle is attested by a SIGNING provider (`attestVerifierInputBundle`) and consumed by a
 *     VERIFY-ONLY provider (`createVerifierContext`). The signer/verifier separation is the real one
 *     from mimers-brunn-core (P2-SR-VERIFY-ONLY-01): `LocalPemVerificationKeyProvider` has no `sign`
 *     member at all. Because `SigningKeyProvider extends VerificationKeyProvider`, the type system
 *     alone cannot keep a signer out of the verifier lane, so the runtime rejects any provider that
 *     carries a `sign` member (PPE_ISOLATION_SIGNER_IN_VERIFIER_LANE).
 *  3. `verifyArtifactAttestation` does not bind `attestation.signer` to anything; this module binds
 *     it to the expected signer key id AND to the verify-only provider's key id
 *     (PPE_ISOLATION_SIGNER_MISMATCH), and recomputes the bundle digest against the attestation
 *     subject and predicate (PPE_ISOLATION_BUNDLE_DIGEST_MISMATCH).
 *  4. `renderVerifierPrompt` is a deterministic function of `context.inputs` only; its digest is
 *     the evidence an adapter records for "the verifier saw exactly this".
 *  5. Declared slots are BOUNDED (R1 F12): `verifierRuntimeInputs` keys must match
 *     VERIFIER_RUNTIME_INPUT_KEY_RE and values must be single-line strings of at most
 *     VERIFIER_RUNTIME_INPUT_VALUE_MAX_LENGTH characters (PPE_ISOLATION_UNDECLARED_INPUT otherwise),
 *     so a transcript cannot be smuggled through a declared key; locator notes rendered into the
 *     prompt are capped at VERIFIER_PROMPT_NOTE_MAX_LENGTH characters with newlines folded.
 *
 * Reuse map (frozen design section 13): no parallel signer/verifier abstraction, no parallel
 * hashing. Everything cryptographic is `@miljobeslut/mimers-brunn-core`.
 */
import {
  attestationSubjectBinding,
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import { PatternProofError } from './errors';
import { validateEvidenceLocator, validateEvidenceLocators, type EvidenceLocator } from './evidence';
import { digestOf, isDigest, type Digest } from './identity';
import { isPlainObject } from './internal/plain-object';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface VerifierRepositoryIdentity {
  readonly remote: string;
  /** 40 hex characters. */
  readonly baseSha: string;
}

export interface VerifierCandidateIdentity {
  /** 40 hex characters. */
  readonly candidateSha: string;
  readonly diffRef: EvidenceLocator;
}

/**
 * The closed set of inputs a verifier context may be instantiated with (BOOTSTRAP section 4:
 * "The verifier's permitted inputs are explicit"). Nothing else exists on this type, and the
 * validator refuses anything else at runtime.
 */
export interface VerifierInputBundle {
  readonly repositoryIdentity: VerifierRepositoryIdentity;
  readonly candidate: VerifierCandidateIdentity;
  /** Non-empty. */
  readonly frozenSpec: readonly EvidenceLocator[];
  readonly redPlanDigest: Digest;
  readonly verifierRuntimeInputs: Readonly<Record<string, string>>;
}

export const VERIFIER_INPUT_BUNDLE_KEYS = [
  'repositoryIdentity',
  'candidate',
  'frozenSpec',
  'redPlanDigest',
  'verifierRuntimeInputs',
] as const;

export type VerifierInputBundleKey = (typeof VERIFIER_INPUT_BUNDLE_KEYS)[number];

export const VERIFIER_INPUT_BUNDLE_PREDICATE_TYPE = 'ppe/verifier-input-bundle/v1' as const;

export const VERIFIER_PROMPT_TEMPLATE_VERSION = 'ppe/verifier-prompt/v1' as const;

/** Declared runtime-input keys are PPE_-namespaced identifiers (R1 F12). */
export const VERIFIER_RUNTIME_INPUT_KEY_RE = /^PPE_[A-Z0-9_]{1,64}$/;
/** Declared runtime-input values are single-line and bounded (R1 F12). */
export const VERIFIER_RUNTIME_INPUT_VALUE_MAX_LENGTH = 512;
/** Locator notes rendered into the prompt are capped at this many characters (R1 F12). */
export const VERIFIER_PROMPT_NOTE_MAX_LENGTH = 200;

/**
 * Compile-time counterpart of the runtime `sign`-member rejection. A `SigningKeyProvider` is not
 * assignable to this type because its `sign` member is a function, not `undefined`. Use it for
 * parameters that must NEVER accept a signer; the runtime guard remains mandatory because a
 * `VerificationKeyProvider`-typed value may still be a signer at runtime.
 */
export type VerifyOnlyKeyProvider = VerificationKeyProvider & { readonly sign?: never };

export interface VerifierInputBundleAttestation {
  readonly attestation: ArtifactAttestation;
  readonly bundleDigest: Digest;
}

export interface VerifierContext {
  readonly inputs: VerifierInputBundle;
  readonly bundleDigest: Digest;
  /** The verify-only provider's key id: the authority the verifier lane was bound to. */
  readonly verifierAuthority: string;
  /** Exactly two locators: the signed attestation binding and the runtime context record. */
  readonly isolationEvidence: readonly [EvidenceLocator, EvidenceLocator];
}

export interface RenderedVerifierPrompt {
  readonly text: string;
  readonly digest: Digest;
}

// ---------------------------------------------------------------------------------------------
// Validation (closed field set, deep-frozen copy of PRESENT keys only)
// ---------------------------------------------------------------------------------------------

const SHA1_RE = /^[0-9a-f]{40}$/;
const LINE_BREAK_RE = /[\r\n\u2028\u2029]/;

function requirePlainObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'must be a plain object', { path });
  }
  return value;
}

/** Any key outside `allowed` is an undeclared verifier input: the structural exclusion of section 4. */
function rejectUndeclaredKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new PatternProofError(
        'PPE_ISOLATION_UNDECLARED_INPUT',
        `"${key}" is not a declared verifier input (declared: ${[...allowed].sort().join(', ')})`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'must be a non-empty string', { path });
  }
  return value;
}

function requireSha(value: unknown, path: string): string {
  const sha = requireNonEmptyString(value, path);
  if (!SHA1_RE.test(sha)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'must be 40 lowercase hex characters', { path });
  }
  return sha;
}

function validateRepositoryIdentity(input: unknown, path: string): VerifierRepositoryIdentity {
  const value = requirePlainObject(input, path);
  rejectUndeclaredKeys(value, ['remote', 'baseSha'], path);
  return Object.freeze({
    remote: requireNonEmptyString(value.remote, `${path}.remote`),
    baseSha: requireSha(value.baseSha, `${path}.baseSha`),
  });
}

function validateCandidateIdentity(input: unknown, path: string): VerifierCandidateIdentity {
  const value = requirePlainObject(input, path);
  rejectUndeclaredKeys(value, ['candidateSha', 'diffRef'], path);
  return Object.freeze({
    candidateSha: requireSha(value.candidateSha, `${path}.candidateSha`),
    diffRef: validateEvidenceLocator(value.diffRef, `${path}.diffRef`),
  });
}

/**
 * Runtime inputs are a declared slot, but not an unbounded one (R1 F12): a key outside the PPE_
 * namespace or a value that is multi-line or longer than the bound is an undeclared input, not a
 * schema typo -- it is the shape a writer transcript takes when it tries to ride a declared key.
 */
function validateRuntimeInputs(input: unknown, path: string): Readonly<Record<string, string>> {
  const value = requirePlainObject(input, path);
  const out: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    if (!VERIFIER_RUNTIME_INPUT_KEY_RE.test(key)) {
      throw new PatternProofError(
        'PPE_ISOLATION_UNDECLARED_INPUT',
        `runtime input key "${key}" is not a declared verifier input (keys must match ${VERIFIER_RUNTIME_INPUT_KEY_RE.source})`,
        { path: `${path}.${key}` },
      );
    }
    const entry = value[key];
    if (typeof entry !== 'string') {
      throw new PatternProofError('PPE_SCHEMA_INVALID', 'runtime input values must be strings', {
        path: `${path}.${key}`,
      });
    }
    if (LINE_BREAK_RE.test(entry) || entry.length > VERIFIER_RUNTIME_INPUT_VALUE_MAX_LENGTH) {
      throw new PatternProofError(
        'PPE_ISOLATION_UNDECLARED_INPUT',
        `runtime input "${key}" must be a single line of at most ${VERIFIER_RUNTIME_INPUT_VALUE_MAX_LENGTH} characters (got ${entry.length} characters${LINE_BREAK_RE.test(entry) ? ', multi-line' : ''})`,
        { path: `${path}.${key}` },
      );
    }
    out[key] = entry;
  }
  return Object.freeze(out);
}

/**
 * Validates a VerifierInputBundle. Closed field set at every level: any key outside the declared
 * set (e.g. `writerTranscript`, `writerRationale`, `writerSelfReportedResults`) is rejected with
 * PPE_ISOLATION_UNDECLARED_INPUT. Returns a deep-frozen copy containing only present keys.
 */
export function validateVerifierInputBundle(
  input: unknown,
  path = 'verifierInputBundle',
): VerifierInputBundle {
  const value = requirePlainObject(input, path);
  rejectUndeclaredKeys(value, VERIFIER_INPUT_BUNDLE_KEYS, path);
  for (const key of VERIFIER_INPUT_BUNDLE_KEYS) {
    if (!(key in value)) {
      throw new PatternProofError('PPE_SCHEMA_INVALID', `missing required field "${key}"`, { path });
    }
  }
  const redPlanDigest = value.redPlanDigest;
  if (!isDigest(redPlanDigest)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'redPlanDigest must be "sha256:<64 hex>"', {
      path: `${path}.redPlanDigest`,
    });
  }
  return Object.freeze({
    repositoryIdentity: validateRepositoryIdentity(value.repositoryIdentity, `${path}.repositoryIdentity`),
    candidate: validateCandidateIdentity(value.candidate, `${path}.candidate`),
    frozenSpec: validateEvidenceLocators(value.frozenSpec, `${path}.frozenSpec`),
    redPlanDigest,
    verifierRuntimeInputs: validateRuntimeInputs(
      value.verifierRuntimeInputs,
      `${path}.verifierRuntimeInputs`,
    ),
  });
}

// ---------------------------------------------------------------------------------------------
// Provider capability guards
// ---------------------------------------------------------------------------------------------

/**
 * True only for a provider that can verify and structurally cannot sign (no `sign` member at all,
 * not merely a `sign` that throws -- mirrors P2-SR-VERIFY-ONLY-01).
 */
export function isVerifyOnlyProvider(provider: unknown): provider is VerifyOnlyKeyProvider {
  if (typeof provider !== 'object' || provider === null) return false;
  if ('sign' in provider) return false;
  const candidate = provider as { keyId?: unknown; verify?: unknown };
  return typeof candidate.keyId === 'string' && typeof candidate.verify === 'function';
}

/** Runtime gate for the verifier lane: throws PPE_ISOLATION_SIGNER_IN_VERIFIER_LANE for any signer. */
export function assertVerifyOnlyProvider(
  provider: VerificationKeyProvider,
  path = 'verification',
): asserts provider is VerifyOnlyKeyProvider {
  if (typeof provider !== 'object' || provider === null) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'verification provider must be an object', { path });
  }
  if ('sign' in provider) {
    throw new PatternProofError(
      'PPE_ISOLATION_SIGNER_IN_VERIFIER_LANE',
      'a provider with a sign member is signing capability; the verifier lane accepts verify-only providers',
      { path, details: { keyId: provider.keyId } },
    );
  }
  if (typeof provider.verify !== 'function' || typeof provider.keyId !== 'string') {
    throw new PatternProofError(
      'PPE_SCHEMA_INVALID',
      'verification provider must expose keyId and verify()',
      {
        path,
      },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Attestation (signing lane) and context creation (verifier lane)
// ---------------------------------------------------------------------------------------------

function sortedBundleKeys(): readonly string[] {
  return Object.freeze([...VERIFIER_INPUT_BUNDLE_KEYS].sort());
}

/**
 * Signs the declared verifier inputs. The attestation subject is the canonical digest of the
 * validated bundle; the predicate records the digest and the sorted declared keys so that the
 * verifier lane can check that nothing beyond the closed set was declared.
 */
export async function attestVerifierInputBundle(
  bundle: VerifierInputBundle,
  signing: SigningKeyProvider,
): Promise<VerifierInputBundleAttestation> {
  const validated = validateVerifierInputBundle(bundle);
  const bundleDigest = digestOf(validated);
  const attestation = await createArtifactAttestation({
    subjectDigest: bundleDigest,
    predicateType: VERIFIER_INPUT_BUNDLE_PREDICATE_TYPE,
    predicate: { bundleDigest, declaredKeys: [...sortedBundleKeys()] },
    signing,
  });
  return Object.freeze({ attestation: deepFreezeAttestation(attestation), bundleDigest });
}

function deepFreezeAttestation(attestation: ArtifactAttestation): ArtifactAttestation {
  Object.freeze(attestation.predicate);
  for (const entry of Object.values(attestation.predicate)) {
    if (typeof entry === 'object' && entry !== null) Object.freeze(entry);
  }
  return Object.freeze(attestation);
}

export interface CreateVerifierContextArgs {
  readonly bundle: VerifierInputBundle;
  readonly attestation: ArtifactAttestation;
  /** Must be verify-only at runtime; a signer here is rejected before anything is verified. */
  readonly verification: VerificationKeyProvider;
  readonly expectedSignerKeyId: string;
}

/**
 * Instantiates the verifier context from the attested bundle, fail-closed in this order:
 *  (a) the verification provider must be verify-only (no `sign` member);
 *  (b) the attestation signature must verify under that provider;
 *  (c) the attestation signer must be the expected signer key id, and the verify-only provider
 *      must be keyed for that signer;
 *  (d) the bundle's recomputed digest must equal the attestation subject and predicate digest.
 */
export async function createVerifierContext(args: CreateVerifierContextArgs): Promise<VerifierContext> {
  const { attestation, verification, expectedSignerKeyId } = args;
  assertVerifyOnlyProvider(verification);

  const inputs = validateVerifierInputBundle(args.bundle);

  if (attestation.predicateType !== VERIFIER_INPUT_BUNDLE_PREDICATE_TYPE) {
    throw new PatternProofError(
      'PPE_ISOLATION_ATTESTATION_INVALID',
      `attestation predicateType must be ${VERIFIER_INPUT_BUNDLE_PREDICATE_TYPE}`,
      { path: 'attestation.predicateType', details: { predicateType: attestation.predicateType } },
    );
  }
  const signatureValid = await verifyArtifactAttestation(attestation, verification);
  if (!signatureValid) {
    throw new PatternProofError(
      'PPE_ISOLATION_ATTESTATION_INVALID',
      'attestation signature does not verify under the verifier-lane public key',
      { path: 'attestation.signature', details: { signer: attestation.signer, keyId: verification.keyId } },
    );
  }
  if (attestation.signer !== expectedSignerKeyId || verification.keyId !== expectedSignerKeyId) {
    throw new PatternProofError(
      'PPE_ISOLATION_SIGNER_MISMATCH',
      'attestation signer and verifier-lane key id must both equal the expected signer key id',
      {
        path: 'attestation.signer',
        details: { signer: attestation.signer, keyId: verification.keyId, expectedSignerKeyId },
      },
    );
  }

  const bundleDigest = digestOf(inputs);
  const predicateDigest = attestation.predicate.bundleDigest;
  if (attestation.subjectDigest !== bundleDigest || predicateDigest !== bundleDigest) {
    throw new PatternProofError(
      'PPE_ISOLATION_BUNDLE_DIGEST_MISMATCH',
      'recomputed bundle digest differs from the attested subject/predicate digest',
      {
        path: 'attestation.subjectDigest',
        details: { recomputed: bundleDigest, subjectDigest: attestation.subjectDigest, predicateDigest },
      },
    );
  }
  const declaredKeys = attestation.predicate.declaredKeys;
  const expectedKeys = sortedBundleKeys();
  if (
    !Array.isArray(declaredKeys) ||
    declaredKeys.length !== expectedKeys.length ||
    declaredKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new PatternProofError(
      'PPE_ISOLATION_UNDECLARED_INPUT',
      'attestation declaredKeys must be exactly the closed verifier input set',
      { path: 'attestation.predicate.declaredKeys', details: { declaredKeys, expectedKeys } },
    );
  }

  const isolationEvidence: readonly [EvidenceLocator, EvidenceLocator] = Object.freeze([
    validateEvidenceLocator(
      {
        kind: 'signed_attestation',
        ref: attestationSubjectBinding(attestation),
        note: 'verifier-input-bundle',
      },
      'isolationEvidence[0]',
    ),
    validateEvidenceLocator(
      { kind: 'runtime_result', ref: `verifier-context:${bundleDigest}` },
      'isolationEvidence[1]',
    ),
  ] as const);

  return Object.freeze({
    inputs,
    bundleDigest,
    verifierAuthority: verification.keyId,
    isolationEvidence,
  });
}

// ---------------------------------------------------------------------------------------------
// Prompt rendering (deterministic, inputs-only)
// ---------------------------------------------------------------------------------------------

/** A note as rendered into the prompt: newlines folded to spaces, capped (R1 F12). */
export function promptNoteText(note: string): string {
  const folded = note.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ');
  return folded.length > VERIFIER_PROMPT_NOTE_MAX_LENGTH
    ? `${folded.slice(0, VERIFIER_PROMPT_NOTE_MAX_LENGTH)}...`
    : folded;
}

function renderLocator(locator: EvidenceLocator): string {
  return locator.note === undefined
    ? `${locator.kind} ${locator.ref}`
    : `${locator.kind} ${locator.ref} (${promptNoteText(locator.note)})`;
}

/**
 * Renders the verifier prompt from `context.inputs` and nothing else. Same inputs => same text =>
 * same digest, so an adapter can record `digest` as evidence of exactly what the verifier saw.
 */
export function renderVerifierPrompt(context: VerifierContext): RenderedVerifierPrompt {
  const inputs = validateVerifierInputBundle(context.inputs, 'context.inputs');
  const runtimeKeys = Object.keys(inputs.verifierRuntimeInputs).sort();
  const lines: string[] = [
    `PATTERN-PROOF-ENGINE-01 verifier lane -- prompt template ${VERIFIER_PROMPT_TEMPLATE_VERSION}`,
    '',
    'You are the independent verifier. Your only inputs are listed below. No writer-lane output,',
    'reasoning or reported result is part of this context. Re-derive from source and spec alone what',
    'must be true of a correct candidate, then examine the candidate diff against that derivation.',
    'Every claim you make must cite its evidence ground (verifier-owned probe, independent code',
    'derivation or writer-test regression); a material invariant needs a probe or a derivation.',
    '',
    `Declared input bundle digest: ${digestOf(inputs)}`,
    `Repository remote: ${inputs.repositoryIdentity.remote}`,
    `Base sha: ${inputs.repositoryIdentity.baseSha}`,
    `Candidate sha: ${inputs.candidate.candidateSha}`,
    `Candidate diff: ${renderLocator(inputs.candidate.diffRef)}`,
    'Frozen spec:',
    ...inputs.frozenSpec.map((locator) => `  - ${renderLocator(locator)}`),
    `Red plan digest: ${inputs.redPlanDigest}`,
    'Verifier runtime inputs:',
    ...(runtimeKeys.length === 0
      ? ['  (none declared)']
      : runtimeKeys.map((key) => `  - ${key}=${inputs.verifierRuntimeInputs[key]}`)),
    '',
  ];
  const text = lines.join('\n');
  return Object.freeze({ text, digest: digestOf({ text }) });
}
