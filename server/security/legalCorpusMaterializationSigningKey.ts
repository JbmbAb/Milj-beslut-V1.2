import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';

/**
 * LEGAL-CORPUS-MATERIALIZATION-V1 — the materialization execution-attestation authority.
 *
 * Deliberately a THIRD, separate key domain from both `governanceSigningKey.ts` (CAS
 * promotion) and `legalCorpusSigningKey.ts` (`legal.corpus.import`'s existing, distinct
 * human-approval-shaped key). This key signs a narrower, machine-verifiable claim:
 *
 *   "these exact governed acquisition bytes, resolved through this exact source manifest,
 *    projected with this exact TEXT-L1 version, chunked under this exact chunk policy version,
 *    produced this exact materialization result"
 *
 * It is NOT a legal or editorial judgment, and it is NOT source authority — it attests to a
 * deterministic transformation, not to the correctness or legal validity of the transformed
 * content. It must therefore never be able to: approve a new source, alter the source registry,
 * promote unapproved bytes, or bypass `CorpusImportGate`'s own checks (this key is handed TO the
 * gate as the thing the gate verifies attestations against — it does not let anything skip the
 * gate).
 *
 * Same capability split as `HarvestRuntimeCompositionRoot.ts` established for P2: a composition
 * root that needs to MINT attestations is given a `SigningKeyProvider`; anything downstream that
 * only needs to CHECK them is given a `VerificationKeyProvider` and nothing more.
 */
const REQUIRED_SIGNING_ENV_VARS = [
  'LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM',
  'LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM',
] as const;
const REQUIRED_VERIFICATION_ENV_VARS = [
  'LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM',
] as const;
const DEFAULT_KEY_ID = 'ed25519:legal-corpus-materialization-v1';

let cachedSigningProvider: SigningKeyProvider | null = null;
let cachedVerificationProvider: VerificationKeyProvider | null = null;

function resolveKeyId(): string {
  return process.env.LEGAL_CORPUS_MATERIALIZATION_SIGNING_KEY_ID || DEFAULT_KEY_ID;
}

/**
 * For the materialization composition root ONLY. Requires the private key; fails closed (loud,
 * at call time, never a silent fallback) if it is absent from the environment.
 */
export function getLegalCorpusMaterializationSigningProvider(): SigningKeyProvider {
  if (cachedSigningProvider) return cachedSigningProvider;

  const missing = REQUIRED_SIGNING_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing legal corpus materialization signing key configuration: ${missing.join(', ')} ` +
        '(PEM-encoded Ed25519 key pair). This key attests governed corpus materialization ' +
        'transformations and is deliberately separate from source-registry approval and CAS ' +
        'promotion keys — see server/security/legalCorpusMaterializationSigningKey.ts.',
    );
  }

  cachedSigningProvider = new LocalPemSigningKeyProvider(
    resolveKeyId(),
    process.env.LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM as string,
    process.env.LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM as string,
  );
  return cachedSigningProvider;
}

/**
 * For any downstream verifier (e.g. a future corpus-read path, an audit script). Holds only the
 * public key — this function's own import graph never reads the private-key env var, so a host
 * that only verifies cannot be handed signing capability by accident.
 */
export function getLegalCorpusMaterializationVerificationProvider(): VerificationKeyProvider {
  if (cachedVerificationProvider) return cachedVerificationProvider;

  const missing = REQUIRED_VERIFICATION_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing legal corpus materialization verification key configuration: ${missing.join(', ')}.`,
    );
  }

  cachedVerificationProvider = new LocalPemVerificationKeyProvider(
    resolveKeyId(),
    process.env.LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM as string,
  );
  return cachedVerificationProvider;
}

/** Test/dev-only escape hatch: reset cached providers between test runs / inject fakes. */
export function __resetLegalCorpusMaterializationSigningProvidersForTests(
  signing?: SigningKeyProvider | null,
  verification?: VerificationKeyProvider | null,
): void {
  cachedSigningProvider = signing ?? null;
  cachedVerificationProvider = verification ?? null;
}
