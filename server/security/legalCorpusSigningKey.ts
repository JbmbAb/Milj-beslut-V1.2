import { LocalPemSigningKeyProvider, type SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

/**
 * Legal corpus import signing authority.
 * ADR: docs/architecture/ADR-LEGAL-CORPUS-IMPORT-GATE.md (ACCEPTED / FROZEN).
 *
 * Deliberately its OWN key/env block — separate from `governanceSigningKey.ts` (CAS
 * promotion) and any future harvest-plan signing key. A compromised legal-corpus-import key
 * should not be able to forge CAS promotions or harvest plans, and vice versa. Mechanically
 * identical pattern to `governanceSigningKey.ts` — same `LocalPemSigningKeyProvider`, same
 * lazy/fail-closed-on-use construction — only the env var names and key domain differ.
 */
const REQUIRED_ENV_VARS = [
  'LEGAL_CORPUS_SIGNING_PRIVATE_KEY_PEM',
  'LEGAL_CORPUS_SIGNING_PUBLIC_KEY_PEM',
] as const;
const DEFAULT_KEY_ID = 'ed25519:legal-corpus-import-v1';

let cachedProvider: SigningKeyProvider | null = null;

/**
 * Lazily constructs (and caches) the legal-corpus-import signing key provider from env. Not
 * called at module load anywhere — the `CorpusImportGate` (packages/mps-legal-corpus) takes
 * a `SigningKeyProvider` as a constructor argument and has no knowledge of env vars at all;
 * this function is only how the *server* wires a real provider into it when the pipeline is
 * actually connected. Until then, this module can exist, be imported, and be unit-tested
 * (via `__resetLegalCorpusSigningProviderForTests`) without requiring the env vars to be set.
 */
export function getLegalCorpusSigningProvider(): SigningKeyProvider {
  if (cachedProvider) return cachedProvider;

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing legal corpus signing key configuration: ${missing.join(', ')} (PEM-encoded ` +
        'Ed25519 key pair). This key authorizes writes to the canonical legal corpus and is ' +
        'deliberately separate from the governance/promotion signing key — see ' +
        'server/security/legalCorpusSigningKey.ts.',
    );
  }

  const keyId = process.env.LEGAL_CORPUS_SIGNING_KEY_ID || DEFAULT_KEY_ID;
  cachedProvider = new LocalPemSigningKeyProvider(
    keyId,
    process.env.LEGAL_CORPUS_SIGNING_PRIVATE_KEY_PEM as string,
    process.env.LEGAL_CORPUS_SIGNING_PUBLIC_KEY_PEM as string,
  );
  return cachedProvider;
}

/** Test/dev-only escape hatch: reset the cached provider between test runs / inject a fake one. */
export function __resetLegalCorpusSigningProviderForTests(provider?: SigningKeyProvider | null): void {
  cachedProvider = provider ?? null;
}
